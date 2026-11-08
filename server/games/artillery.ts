import crypto from 'crypto';
import { readFileSync } from 'fs';
import Game from '../game.js';
import Client from '../client.js';
import { defaultMatchSettings, isMatchSettingValid, loadTimeoutInSeconds, lobbyMaximumPlayerCount,
    lobbyMinimumPlayerCount, planningPreviewUpdatesPerSecond, protocolVersion,
    reconnectAuthenticationTimeoutInSeconds, resolveReportTimeoutInSeconds, serverDeadlineCheckIntervalInMilliseconds,
    simulationTicksPerSecond } from '../../client/artillery/js/config.js';
import type { MatchSettings } from '../../client/artillery/js/config.js';
import { ArtillerySync } from '../../client/artillery/js/types.js';
import type { LobbySeat, MatchPhase, MatchSnapshot, PlayerPlan, PlayerStatistics, ResolveReport,
    TurnKind, TurnLogEntry } from '../../client/artillery/js/types.js';
import { isPlanningPreview, isPlayerPlan } from '../../client/artillery/js/plan-validation.js';
import { validateWeaponData } from '../../client/artillery/js/data/dsl-validator.js';
import { weaponDataHash } from '../../client/artillery/js/data/weapon-data-hash.js';
import { isResolveReport, selectReportMajority } from './_artillery-referee.js';

interface ServerSeat extends LobbySeat {
    reconnectToken: string | null;
}
let cachedWeaponHash: number | null = null;

export default class ArtilleryGame extends Game {
    public phase: MatchPhase = 'LOBBY';
    public settings: MatchSettings = { ...defaultMatchSettings };
    public seats: Array<ServerSeat> = [];
    public planLog: Array<TurnLogEntry> = [];
    public turnIndex = 0;
    public turnKind: TurnKind = 'MOVING';
    public deadlineInMilliseconds = 0;
    public lastMatchResult: Record<string, unknown> | null = null;
    public interval: ReturnType<typeof setInterval> | null = null;
    private matchSeed = 0;
    private physicsHash = 0;
    private seatByClient = new Map<string, number>();
    private pendingJoins = new Map<Client, number>();
    private snapshotVersions = new Map<Client, string>();
    private loaded = new Set<number>();
    private alive = new Set<number>();
    private plans = new Map<number, PlayerPlan>();
    private reports = new Map<number, ResolveReport>();
    private previewTimes = new Map<number, number>();
    private statistics: Array<PlayerStatistics> = [];
    private roundsCompleted = 0;
    private eliminatedAtTurn = new Map<number, number>();

    constructor() {
        super({ syncAfterMove: false });
    }
    onRoomCreate(): void {/* State is initialized before the first join. */}
    globalStateSync(): MessageData {
        return {} as MessageData;
    }
    onMove(): void {/* Gameplay accepts only event-specific plan messages. */}

    private send(client: Client, message: Record<string, unknown>): void {
        client.connection.sendUTF(JSON.stringify(message));
    }
    private publicSeats(): Array<LobbySeat> {
        return this.seats.map(({ seatIndex, username, teamIndex, isReady, isMissing }) =>
            ({ seatIndex, username, teamIndex, isReady, isMissing }));
    }
    private hostSeat(): number {
        return this.players.findIndex(client => client !== null);
    }
    private connectedSeats(): Array<number> {
        return this.seats.filter(seat => !seat.isMissing && this.loaded.has(seat.seatIndex))
            .map(seat => seat.seatIndex);
    }
    private smallestTeam(): number {
        const counts = Array<number>(this.settings.teamCount).fill(0);
        for (const seat of this.seats) if (seat.teamIndex < counts.length) counts[seat.teamIndex]++;
        return counts.indexOf(Math.min(...counts));
    }
    private syncLobby(): void {
        if (this.phase !== 'LOBBY') return;
        const host = this.hostSeat();
        for (const seat of this.seats) seat.isReady = seat.seatIndex === host || !!this.players[seat.seatIndex]?.ready;
        this.broadcast({ type: ArtillerySync.LOBBY_STATE, seats: this.publicSeats(), settings: this.settings,
            hostSeatIndex: host, canStart: this.canStart(), lastMatchResult: this.lastMatchResult });
    }
    private canStart(): boolean {
        return this.playerCount >= lobbyMinimumPlayerCount &&
            this.seats.every(seat => seat.seatIndex === this.hostSeat() || this.players[seat.seatIndex]?.ready) &&
            Array.from({ length: this.settings.teamCount }, (_, team) => team)
                .every(team => this.seats.some(seat => seat.teamIndex === team));
    }
    private rebuildLobbySeats(): void {
        const kept = this.seats.filter(seat => this.players[seat.seatIndex] !== null);
        this.players = this.players.filter(client => client !== null);
        this.seats = kept;
        this.seatByClient.clear();
        this.seats.forEach((seat, index) => {
            seat.seatIndex = index;
            this.seatByClient.set(this.players[index]!.id, index);
        });
        this.playerCount = this.players.length;
        this.broadcastWhoYouAre();
    }
    onJoin(client: Client): boolean {
        if (this.seatByClient.has(client.id) || this.pendingJoins.has(client)) return false;
        if (this.phase === 'LOBBY') {
            if (this.playerCount >= lobbyMaximumPlayerCount) return false;
            const teamIndex = this.smallestTeam();
            if (!super.onJoin(client)) return false;
            const seatIndex = this.players.indexOf(client);
            const reconnectToken = crypto.randomBytes(32).toString('hex');
            this.seats.push({ seatIndex, username: client.username, teamIndex, isReady: false,
                isMissing: false, reconnectToken });
            this.seatByClient.set(client.id, seatIndex);
            this.send(client, { type: ArtillerySync.RECONNECT_TOKEN, reconnectToken });
            this.syncLobby();
            return true;
        }
        const missing = this.seats.filter(seat => seat.isMissing);
        if (!missing.length || this.pendingJoins.size >= missing.length) return false;
        client.gameID = this.uuid;
        const legacy = missing.find(seat => seat.reconnectToken === null);
        if (legacy) this.reconnect(client, legacy.seatIndex);
        else this.pendingJoins.set(client, Date.now() + reconnectAuthenticationTimeoutInSeconds * 1000);
        return true;
    }
    private reconnect(client: Client, seatIndex: number): void {
        this.pendingJoins.delete(client);
        this.players[seatIndex] = client;
        this.playerCount++;
        const seat = this.seats[seatIndex];
        seat.isMissing = false;
        seat.reconnectToken ??= crypto.randomBytes(32).toString('hex');
        client.username = seat.username;
        this.seatByClient.set(client.id, seatIndex);
        this.send(client, { type: ArtillerySync.RECONNECT_TOKEN, reconnectToken: seat.reconnectToken });
        this.broadcastWhoYouAre();
        this.broadcast({ type: ArtillerySync.SEAT_STATUS, seatIndex, isMissing: false });
        this.sendSnapshot(client);
    }
    private rejectPending(client: Client): void {
        this.pendingJoins.delete(client);
        client.gameID = '';
        this.send(client, { type: 'ERROR', code: 'RECONNECT_TOKEN_REQUIRED', message: 'A valid reconnect token is required' });
    }
    private markMissing(seatIndex: number): void {
        const client = this.players[seatIndex];
        if (!client) return;
        this.players[seatIndex] = null;
        this.playerCount--;
        this.seatByClient.delete(client.id);
        this.snapshotVersions.delete(client);
        this.loaded.delete(seatIndex);
        this.reports.delete(seatIndex);
        this.plans.delete(seatIndex);
        this.seats[seatIndex].isMissing = true;
        client.gameID = '';
        this.broadcast({ type: ArtillerySync.SEAT_STATUS, seatIndex, isMissing: true });
    }
    onDisconnect(client: Client): void {
        this.pendingJoins.delete(client);
        const index = this.seatByClient.get(client.id);
        if (index === undefined) return;
        this.markMissing(index);
        if (this.phase === 'LOBBY') {
            this.rebuildLobbySeats(); this.syncLobby();
        } else this.checkPhaseProgress();
    }
    onReady(client: Client): void {
        if (this.phase !== 'LOBBY' || !this.seatByClient.has(client.id)) return;
        if (this.seatByClient.get(client.id) === this.hostSeat()) {
            client.ready = true;
            if (this.canStart()) this.startMatch();
        }
        this.syncLobby();
    }
    onUsernameChange(client: Client): void {
        const index = this.seatByClient.get(client.id);
        if (index === undefined) return;
        if (this.seats.some(seat => seat.seatIndex !== index && seat.username === client.username)) {
            client.username = this.seats[index].username;
            this.send(client, { type: 'ERROR', code: 'ALREADY_TAKEN_USERNAME', message: 'Username already taken' });
        } else this.seats[index].username = client.username;
        this.syncLobby();
    }
    onMessage(client: Client, value: Record<string, unknown>): void {
        if (!value || Array.isArray(value)) return;
        const message = value as Record<string, unknown>;
        if (this.pendingJoins.has(client)) {
            if (message.type === ArtillerySync.RECONNECT_TOKEN) {
                const seat = this.seats.find(entry => entry.isMissing && typeof message.reconnectToken === 'string' &&
                    entry.reconnectToken === message.reconnectToken);
                if (seat) this.reconnect(client, seat.seatIndex);
                else this.rejectPending(client);
            }
            return;
        }
        const seatIndex = this.seatByClient.get(client.id);
        if (seatIndex === undefined) return;
        const seat = this.seats[seatIndex];
        if (this.phase === 'LOBBY') {
            if (message.type === ArtillerySync.CHANGE_TEAM &&
                (!client.ready || seatIndex === this.hostSeat()) && Number.isInteger(message.teamIndex) &&
                (message.teamIndex as number) >= 0 && (message.teamIndex as number) < this.settings.teamCount)
                seat.teamIndex = message.teamIndex as number;
            if (message.type === ArtillerySync.CHANGE_SETTING && seatIndex === this.hostSeat() &&
                typeof message.setting === 'string' && isMatchSettingValid(message.setting, message.value)) {
                Object.assign(this.settings, { [message.setting]: message.value });
                for (const entry of this.seats) {
                    if (entry.teamIndex >= this.settings.teamCount) entry.teamIndex = this.smallestTeam();
                    this.players[entry.seatIndex]!.ready = false;
                }
            }
            this.syncLobby();
            return;
        }
        if (message.type === ArtillerySync.MATCH_SNAPSHOT) {
            this.sendSnapshot(client); return;
        }
        if (message.type === ArtillerySync.LOAD_COMPLETE) {
            if (message.protocolVersion !== protocolVersion || message.weaponDataHash !== this.physicsHash) {
                this.send(client, { type: ArtillerySync.VERSION_MISMATCH });
                this.markMissing(seatIndex);
            } else {
                if (this.snapshotVersions.has(client) && this.snapshotVersions.get(client) !== this.snapshotVersion()) {
                    this.sendSnapshot(client);
                    return;
                }
                this.snapshotVersions.delete(client);
                this.loaded.add(seatIndex);
                if (this.phase === 'PLANNING') this.send(client, { type: ArtillerySync.PLAN_LOCK_STATE,
                    turnIndex: this.turnIndex, lockedSeatIndices: this.lockedSeats() });
            }
            this.checkPhaseProgress();
            return;
        }
        if (!this.loaded.has(seatIndex) || message.turnIndex !== this.turnIndex) return;
        if (this.phase === 'RESOLVING' && message.type === ArtillerySync.RESOLVE_REPORT &&
            !this.reports.has(seatIndex) && isResolveReport(message.report, this.turnIndex,
            this.publicSeats(), this.settings.hitPointsPerTank)) {
            const report = message.report;
            if (report.aliveSeatIndices.some(index => !this.alive.has(index))) return;
            if (report.statistics.some(entry => {
                const previous = this.statistics.find(item => item.seatIndex === entry.seatIndex);
                return previous && (entry.damageDealt < previous.damageDealt ||
                    entry.damageTaken < previous.damageTaken ||
                    entry.friendlyFireDamage < previous.friendlyFireDamage ||
                    entry.shotsFired < previous.shotsFired);
            })) return;
            this.reports.set(seatIndex, { ...report, aliveSeatIndices: [...report.aliveSeatIndices],
                armedSeatIndices: [...report.armedSeatIndices],
                statistics: report.statistics.map(entry => ({ ...entry })) });
            this.checkPhaseProgress();
            return;
        }
        if (this.phase !== 'PLANNING' || !this.alive.has(seatIndex)) return;
        if (message.type === ArtillerySync.PLAN_UNLOCK) this.plans.delete(seatIndex);
        else if (message.type === ArtillerySync.PLAN_LOCK && !this.plans.has(seatIndex) &&
            isPlayerPlan(message.plan, this.settings.movementTimePerTurnInSeconds * simulationTicksPerSecond,
                this.turnKind === 'FIRING' ? 0 : this.settings.movePlanningTimeLimitInSeconds * simulationTicksPerSecond))
            this.plans.set(seatIndex, { ...message.plan, movementSegments:
                message.plan.movementSegments.map(([duration, mask]): [number, number] => [duration, mask]) });
        else if (message.type === ArtillerySync.PLAN_PREVIEW && !this.plans.has(seatIndex)) {
            const now = Date.now();
            if (!isPlanningPreview(message, this.settings.mapEdgeLengthInVoxels) ||
                now - (this.previewTimes.get(seatIndex) ?? -Infinity) < 1000 / planningPreviewUpdatesPerSecond) return;
            this.previewTimes.set(seatIndex, now);
            for (const teammate of this.seats) if (teammate.seatIndex !== seatIndex &&
                teammate.teamIndex === seat.teamIndex && this.players[teammate.seatIndex])
                this.send(this.players[teammate.seatIndex]!, { type: ArtillerySync.PLAN_PREVIEW,
                    turnIndex: this.turnIndex, seatIndex, pose: message.pose,
                    powerCentipercent: message.powerCentipercent, weaponIdentifier: message.weaponIdentifier });
            return;
        } else return;
        this.broadcast({ type: ArtillerySync.PLAN_LOCK_STATE, turnIndex: this.turnIndex,
            lockedSeatIndices: this.lockedSeats() });
        this.checkPhaseProgress();
    }
    private startMatch(): void {
        if (cachedWeaponHash === null)
            try {
                const files: Record<string, unknown> = {};
                for (const name of ['weapons', 'models', 'turrets', 'terrain-profiles',
                    'damage-profiles', 'effect-profiles'])
                    files[name] = JSON.parse(readFileSync(`client/artillery/data/${name}.json`, 'utf8'));
                cachedWeaponHash = weaponDataHash(validateWeaponData({ weapons: files.weapons, models: files.models,
                    turrets: files.turrets, terrainProfiles: files['terrain-profiles'],
                    damageProfiles: files['damage-profiles'] }, Object.keys(files['effect-profiles'] as object)));
            } catch (error) {
                console.error('Artillery data could not be loaded', error);
                const host = this.players[this.hostSeat()];
                if (host) this.send(host, { type: 'ERROR', code: 'ARTILLERY_DATA',
                    message: 'Artillery data could not be loaded' });
                return;
            }
        this.physicsHash = cachedWeaponHash;
        this.matchSeed = crypto.randomBytes(4).readUInt32LE(0);
        this.phase = 'LOADING';
        this.turnIndex = 0;
        this.turnKind = 'MOVING';
        this.planLog = [];
        this.loaded.clear(); this.plans.clear(); this.reports.clear(); this.previewTimes.clear();
        this.roundsCompleted = 0; this.eliminatedAtTurn.clear();
        this.alive = new Set(this.seats.map(seat => seat.seatIndex));
        this.statistics = this.seats.map(seat => ({ seatIndex: seat.seatIndex, damageDealt: 0, damageTaken: 0,
            friendlyFireDamage: 0, shotsFired: 0 }));
        this.deadlineInMilliseconds = Date.now() + loadTimeoutInSeconds * 1000;
        this.interval = setInterval(() => this.tick(), serverDeadlineCheckIntervalInMilliseconds);
        this.broadcast({ type: ArtillerySync.MATCH_START, protocolVersion, weaponDataHash: this.physicsHash,
            matchSeed: this.matchSeed, settings: this.settings, seats: this.publicSeats() });
    }
    private lockedSeats(): Array<number> {
        return this.seats.filter(seat => this.alive.has(seat.seatIndex) &&
            (seat.isMissing || !this.loaded.has(seat.seatIndex) || this.plans.has(seat.seatIndex)))
            .map(seat => seat.seatIndex);
    }
    private checkPhaseProgress(): void {
        if (this.phase === 'LOADING' && this.seats.every(seat => seat.isMissing || this.loaded.has(seat.seatIndex)))
            this.beginNextTurn();
        else if (this.phase === 'PLANNING' && this.seats.filter(seat => this.alive.has(seat.seatIndex))
            .every(seat => this.lockedSeats().includes(seat.seatIndex)))
            this.resolveCurrentTurn();
        else if (this.phase === 'RESOLVING' && this.connectedSeats().every(index => this.reports.has(index)))
            this.finishReports();
    }
    private beginNextTurn(): void {
        this.phase = 'PLANNING';
        this.plans.clear(); this.reports.clear(); this.previewTimes.clear();
        const planSeconds = this.turnKind === 'MOVING' ? this.settings.movePlanningTimeLimitInSeconds
            : this.settings.firePlanningTimeLimitInSeconds;
        this.deadlineInMilliseconds = Date.now() + planSeconds * 1000;
        this.broadcast({ type: ArtillerySync.TURN_BEGIN, turnIndex: this.turnIndex, kind: this.turnKind,
            deadlineInMilliseconds: this.deadlineInMilliseconds, lockedSeatIndices: this.lockedSeats() });
        this.checkPhaseProgress();
    }
    private resolveCurrentTurn(): void {
        const empty: PlayerPlan = { movementSegments: [], turretYawQuantized: 0, turretPitchQuantized: 0,
            powerCentipercent: 0, weaponIdentifier: null };
        const entry: TurnLogEntry = { turnIndex: this.turnIndex, kind: this.turnKind,
            plans: this.seats.filter(seat => this.alive.has(seat.seatIndex))
                .map(seat => ({ seatIndex: seat.seatIndex, plan: this.plans.get(seat.seatIndex) ?? empty })) };
        this.planLog.push(entry);
        this.phase = 'RESOLVING';
        const movementTicks = entry.plans.reduce((maximum, seat) => Math.max(maximum,
            seat.plan.movementSegments.reduce((total, [duration]) => total + duration, 0)), 0);
        this.deadlineInMilliseconds = Date.now() +
            (movementTicks / simulationTicksPerSecond + resolveReportTimeoutInSeconds) * 1000;
        this.broadcast({ type: ArtillerySync.TURN_RESOLVE, ...entry });
        this.checkPhaseProgress();
    }
    private finishReports(): void {
        const votes = new Map([...this.reports].filter(([seat]) => this.connectedSeats().includes(seat)));
        const majority = selectReportMajority(votes);
        if (!majority) {
            this.broadcast({ type: ArtillerySync.DESYNC_DETECTED, turnIndex: this.turnIndex, reason: 'NO_MAJORITY' });
            this.finishMatch([], 'NO_MAJORITY');
            return;
        }
        for (const seat of this.connectedSeats()) if (!majority.seatIndices.includes(seat)) {
            this.send(this.players[seat]!, { type: ArtillerySync.DESYNC_DETECTED,
                turnIndex: this.turnIndex, stateHash: majority.report.stateHash });
            this.markMissing(seat);
        }
        const report = majority.report;
        this.alive = new Set(report.aliveSeatIndices);
        this.statistics = report.statistics.map(entry => ({ ...entry }));
        for (let team = 0; team < this.settings.teamCount; team++)
            if (!this.eliminatedAtTurn.has(team) && this.seats.some(seat => seat.teamIndex === team) &&
                !this.seats.some(seat => seat.teamIndex === team && this.alive.has(seat.seatIndex)))
                this.eliminatedAtTurn.set(team, this.turnIndex);
        const teams = new Set(this.seats.filter(seat => this.alive.has(seat.seatIndex)).map(seat => seat.teamIndex));
        if (teams.size <= 1) {
            this.finishMatch([...teams], 'ELIMINATION'); return;
        }
        if (this.turnKind === 'MOVING') {
            this.turnKind = 'FIRING'; this.turnIndex++;
            this.beginNextTurn();
            return;
        }
        if (!report.hasAmmunitionRemaining && !this.settings.isInfiniteRounds) {
            this.finishMatch(this.scoreWinners(), 'SCORE'); return;
        }
        if (!report.hasAmmunitionRemaining) {
            const totals = Array<number>(this.settings.teamCount).fill(0);
            for (const seat of this.seats) totals[seat.teamIndex] += this.settings.hitPointsPerTank -
                this.statistics.find(entry => entry.seatIndex === seat.seatIndex)!.damageTaken;
            const best = Math.max(...totals);
            this.finishMatch([...teams].filter(team => totals[team] === best), 'STALEMATE');
            return;
        }
        this.roundsCompleted++;
        if (!this.settings.isInfiniteRounds && this.roundsCompleted >= this.settings.roundCount) {
            this.finishMatch(this.scoreWinners(), 'SCORE'); return;
        }
        this.turnKind = 'MOVING'; this.turnIndex++;
        this.beginNextTurn();
    }
    /** Teams with the best score under the configured scoring mode. */
    private scoreWinners(): Array<number> {
        const teams = [...new Set(this.seats.map(seat => seat.teamIndex))];
        const total = (team: number, value: (seatIndex: number) => number): number =>
            this.seats.filter(seat => seat.teamIndex === team).reduce((sum, seat) => sum + value(seat.seatIndex), 0);
        const entry = (seatIndex: number): PlayerStatistics | undefined =>
            this.statistics.find(item => item.seatIndex === seatIndex);
        const hitPoints = (team: number): number => total(team, seatIndex =>
            this.settings.hitPointsPerTank - (entry(seatIndex)?.damageTaken ?? 0));
        const score = (team: number): [number, number] => {
            if (this.settings.scoreMode === 0)
                return [total(team, seatIndex => Math.max(0, (entry(seatIndex)?.damageDealt ?? 0) -
                    (entry(seatIndex)?.friendlyFireDamage ?? 0))), 0];
            if (this.settings.scoreMode === 1) return [hitPoints(team), 0];
            return [this.eliminatedAtTurn.get(team) ?? Infinity, hitPoints(team)];
        };
        const isBetter = (first: [number, number], second: [number, number]): boolean =>
            first[0] > second[0] || first[0] === second[0] && first[1] > second[1];
        let best = score(teams[0]);
        for (const team of teams) if (isBetter(score(team), best)) best = score(team);
        return teams.filter(team => !isBetter(best, score(team)));
    }
    private finishMatch(winningTeamIndices: Array<number>, reason: string): void {
        this.phase = 'ENDED';
        const teamRanking = [...Array<number>(this.settings.teamCount).keys()].map(teamIndex => ({ teamIndex,
            remainingHitPoints: this.seats.filter(seat => seat.teamIndex === teamIndex).reduce((sum, seat) =>
                sum + this.settings.hitPointsPerTank -
                (this.statistics.find(entry => entry.seatIndex === seat.seatIndex)?.damageTaken ?? 0), 0) }))
            .sort((left, right) => right.remainingHitPoints - left.remainingHitPoints ||
                left.teamIndex - right.teamIndex);
        this.lastMatchResult = { winningTeamIndices, reason, teamRanking, statistics: this.statistics };
        this.broadcast({ type: ArtillerySync.MATCH_END, ...this.lastMatchResult });
        if (this.interval) clearInterval(this.interval);
        this.interval = null;
        for (const client of [...this.pendingJoins.keys()]) this.rejectPending(client);
        this.rebuildLobbySeats();
        for (const client of this.players) if (client) client.ready = false;
        this.phase = 'LOBBY';
        this.loaded.clear(); this.snapshotVersions.clear(); this.plans.clear(); this.reports.clear();
        this.syncLobby();
    }
    private snapshotVersion(): string {
        return `${this.phase}:${this.turnIndex}:${this.planLog.length}`;
    }
    private sendSnapshot(client: Client): void {
        const seat = this.seatByClient.get(client.id);
        if (seat === undefined) return;
        this.loaded.delete(seat);
        this.snapshotVersions.set(client, this.snapshotVersion());
        const snapshot: MatchSnapshot = { protocolVersion, weaponDataHash: this.physicsHash, matchSeed: this.matchSeed,
            settings: { ...this.settings }, seats: this.publicSeats(), planLog: this.planLog, phase: this.phase,
            turnIndex: this.turnIndex, kind: this.turnKind,
            planMillisecondsRemaining: Math.max(0, this.deadlineInMilliseconds - Date.now()) };
        this.send(client, { type: ArtillerySync.MATCH_SNAPSHOT, snapshot });
    }
    public tick(now = Date.now()): void {
        for (const [client, deadline] of this.pendingJoins) if (now >= deadline) this.rejectPending(client);
        if (now < this.deadlineInMilliseconds) return;
        if (this.phase === 'LOADING') {
            for (const seat of this.seats) if (!this.loaded.has(seat.seatIndex)) {
                const client = this.players[seat.seatIndex];
                if (client) this.send(client, { type: 'ERROR', code: 'LOAD_TIMEOUT',
                    message: 'Loading timed out. Reload to reconnect.' });
                this.markMissing(seat.seatIndex);
            }
            this.checkPhaseProgress();
        } else if (this.phase === 'PLANNING') this.resolveCurrentTurn();
        else if (this.phase === 'RESOLVING') {
            for (const index of this.connectedSeats()) if (!this.reports.has(index)) {
                const client = this.players[index];
                if (client) this.send(client, { type: 'ERROR', code: 'REPORT_TIMEOUT',
                    message: 'The resolve report timed out. Reload to reconnect.' });
                this.markMissing(index);
            }
            this.finishReports();
        }
    }
    onRemove(): void {
        if (this.interval) clearInterval(this.interval);
        this.interval = null;
        for (const client of this.pendingJoins.keys()) client.gameID = '';
        this.pendingJoins.clear(); this.snapshotVersions.clear();
    }
}
