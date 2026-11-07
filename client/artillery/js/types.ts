import type { MatchSettings } from './config.js';
import type { Vector3 } from './sim/math/vector3.js';

export enum ArtillerySync {
    LOBBY_STATE = 'LOBBY_STATE',
    CHANGE_TEAM = 'CHANGE_TEAM',
    CHANGE_SETTING = 'CHANGE_SETTING',
    MATCH_START = 'MATCH_START',
    LOAD_COMPLETE = 'LOAD_COMPLETE',
    VERSION_MISMATCH = 'VERSION_MISMATCH',
    TURN_BEGIN = 'TURN_BEGIN',
    PLAN_PREVIEW = 'PLAN_PREVIEW',
    PLAN_LOCK = 'PLAN_LOCK',
    PLAN_UNLOCK = 'PLAN_UNLOCK',
    PLAN_LOCK_STATE = 'PLAN_LOCK_STATE',
    TURN_RESOLVE = 'TURN_RESOLVE',
    RESOLVE_REPORT = 'RESOLVE_REPORT',
    DESYNC_DETECTED = 'DESYNC_DETECTED',
    MATCH_END = 'MATCH_END',
    MATCH_SNAPSHOT = 'MATCH_SNAPSHOT',
    SEAT_STATUS = 'SEAT_STATUS',
    RECONNECT_TOKEN = 'RECONNECT_TOKEN'
}

export type MatchPhase = 'LOBBY' | 'LOADING' | 'PLANNING' | 'RESOLVING' | 'ENDED';

export enum MovementInput {
    FORWARD = 1,
    LEFT = 2,
    BACKWARD = 4,
    RIGHT = 8
}

export interface PlayerPlan {
    movementSegments: Array<[number, number]>;
    turretYawQuantized: number;
    turretPitchQuantized: number;
    powerCentipercent: number;
    weaponIdentifier: string | null;
}

export interface PlanningPreview {
    pose: [number, number, number, number, number, number];
    powerCentipercent: number;
    weaponIdentifier: string | null;
}

export interface SeatPlan {
    seatIndex: number;
    plan: PlayerPlan;
}

export interface LobbySeat {
    seatIndex: number;
    username: string;
    teamIndex: number;
    isReady: boolean;
    isMissing: boolean;
}

export interface PlayerStatistics {
    seatIndex: number;
    damageDealt: number;
    damageTaken: number;
    friendlyFireDamage: number;
    shotsFired: number;
}

export interface ResolveReport {
    turnIndex: number;
    stateHash: number;
    aliveSeatIndices: Array<number>;
    armedSeatIndices: Array<number>;
    statistics: Array<PlayerStatistics>;
    shotsFired: number;
    hasAmmunitionRemaining: boolean;
}

export interface TurnLogEntry {
    turnIndex: number;
    teamIndex: number;
    plans: Array<SeatPlan>;
}

export interface MatchSnapshot {
    protocolVersion: number;
    weaponDataHash: number;
    matchSeed: number;
    settings: MatchSettings;
    seats: Array<LobbySeat>;
    planLog: Array<TurnLogEntry>;
    phase: MatchPhase;
    turnIndex: number;
    teamIndex: number;
    planMillisecondsRemaining: number;
}

export interface RemovedVoxelSample {
    position: Vector3;
    materialIdentifier: number;
}

export interface SimulationEvent {
    type: 'explosion' | 'projectileSpawn' | 'projectileRemoved' | 'beam' | 'burnStart' |
    'tankDamaged' | 'tankKilled' | 'bounce' | 'splash' | 'terrainAdded' | 'teleport' | 'deployable' | 'effect' |
    'line' | 'lineEnd';
    tick: number;
    serial: number;
    position: Vector3;
    endpoint?: Vector3;
    radiusInVoxels?: number;
    amount?: number;
    seatIndex?: number;
    effectProfileIdentifier?: string;
    weaponIdentifier?: string;
    removedVoxelSamples?: Array<RemovedVoxelSample>;
}
