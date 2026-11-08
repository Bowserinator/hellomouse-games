import { isMatchSettingValid, lobbyMaximumPlayerCount, lobbyMinimumPlayerCount, matchSettingKeys,
    MatchSettings, simulationTicksPerSecond, usernameMaximumLength } from './config.js';
import { isPlayerPlan } from './plan-validation.js';
import { MatchSnapshot, TurnKind, TurnLogEntry } from './types.js';

export type MatchDescription = Pick<MatchSnapshot,
'protocolVersion' | 'weaponDataHash' | 'matchSeed' | 'settings' | 'seats'>;

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

export interface LobbyState {
    settings: MatchSettings;
    seats: MatchDescription['seats'];
    hostSeatIndex: number;
    canStart: boolean;
}

function validateRoster(value: unknown, minimumPlayers: number): asserts value is
    Pick<MatchDescription, 'settings' | 'seats'> {
    if (!record(value) || !record(value.settings) || !Array.isArray(value.seats) ||
        value.seats.length < minimumPlayers || value.seats.length > lobbyMaximumPlayerCount)
        throw new Error('Invalid match description');
    const settings = value.settings;
    if (!matchSettingKeys.every(key => isMatchSettingValid(key, settings[key])) ||
        Object.keys(settings).some(key => !matchSettingKeys.includes(key as keyof MatchSettings)))
        throw new Error('Invalid match settings');
    const indices = new Set<number>();
    for (const seat of value.seats) {
        if (!record(seat) || !integer(seat.seatIndex, 0, lobbyMaximumPlayerCount - 1) ||
            !integer(seat.teamIndex, 0, Number(settings.teamCount) - 1) || indices.has(seat.seatIndex) ||
            typeof seat.username !== 'string' || seat.username.length < 1 ||
            seat.username.length > usernameMaximumLength || !/^[A-Za-z0-9_]+$/.test(seat.username) ||
            typeof seat.isReady !== 'boolean' || typeof seat.isMissing !== 'boolean')
            throw new Error('Invalid match seats');
        indices.add(seat.seatIndex);
    }
}

export function validateMatchDescription(value: unknown): asserts value is MatchDescription {
    if (!record(value) || !integer(value.protocolVersion, 0, 0xffffffff) ||
        !integer(value.weaponDataHash, 0, 0xffffffff) || !integer(value.matchSeed, 0, 0xffffffff))
        throw new Error('Invalid match description');
    validateRoster(value, lobbyMinimumPlayerCount);
}

export function validateLobbyState(value: unknown): asserts value is LobbyState {
    validateRoster(value, 0);
    const lobby = value as Partial<LobbyState>;
    if (!integer(lobby.hostSeatIndex, -1, lobbyMaximumPlayerCount - 1) || typeof lobby.canStart !== 'boolean' ||
        (value.seats.length > 0 ? !value.seats.some(seat => seat.seatIndex === lobby.hostSeatIndex && !seat.isMissing)
            : lobby.hostSeatIndex !== -1)) throw new Error('Invalid lobby authority');
}

/** Turns alternate between moving and firing, starting with moving. */
export function expectedTurnKind(turnIndex: number): TurnKind {
    return turnIndex % 2 === 0 ? 'MOVING' : 'FIRING';
}

export function validateTurnEntry(value: unknown, description: MatchDescription,
    expectedTurnIndex: number): asserts value is TurnLogEntry {
    if (!record(value) || value.turnIndex !== expectedTurnIndex || value.kind !== expectedTurnKind(expectedTurnIndex) ||
        !Array.isArray(value.plans) || value.plans.length > description.seats.length)
        throw new Error('Invalid turn entry');
    const maximumTicks = value.kind === 'FIRING' ? 0
        : description.settings.movePlanningTimeLimitInSeconds * simulationTicksPerSecond;
    const indices = new Set<number>();
    for (const entry of value.plans) {
        if (!record(entry) || !integer(entry.seatIndex, 0, lobbyMaximumPlayerCount - 1) ||
            indices.has(entry.seatIndex) || !description.seats.some(seat => seat.seatIndex === entry.seatIndex) ||
            !isPlayerPlan(entry.plan, description.settings.movementTimePerTurnInSeconds * simulationTicksPerSecond,
                maximumTicks))
            throw new Error('Invalid turn plan');
        indices.add(entry.seatIndex);
    }
}

export function validateMatchSnapshot(value: unknown): asserts value is MatchSnapshot {
    validateMatchDescription(value);
    const snapshot = value as MatchDescription & Partial<MatchSnapshot>;
    if (!['LOADING', 'PLANNING', 'RESOLVING'].includes(snapshot.phase ?? '') ||
        !integer(snapshot.turnIndex, 0, Number.MAX_SAFE_INTEGER) ||
        snapshot.kind !== expectedTurnKind(snapshot.turnIndex) ||
        typeof snapshot.planMillisecondsRemaining !== 'number' ||
        !Number.isFinite(snapshot.planMillisecondsRemaining) || snapshot.planMillisecondsRemaining < 0 ||
        !Array.isArray(snapshot.planLog) ||
        snapshot.planLog.length !== snapshot.turnIndex + (snapshot.phase === 'RESOLVING' ? 1 : 0) ||
        snapshot.phase === 'LOADING' && snapshot.turnIndex !== 0)
        throw new Error('Invalid match snapshot');
    snapshot.planLog.forEach((entry, turnIndex) => validateTurnEntry(entry, snapshot, turnIndex));
}
