import { LOBBY_LIMIT } from '../shared/protocol.js';
import { MAX_ZOMBIES } from './fixed.js';
import { MAX_ENTITIES, MAX_ORDERS } from './layout.js';

export enum CommandType {
    MoveInput, PlaceWeapon, UpgradeWeapon, SellWeapon, Ready, DebugProjectile, ActivateField,
    Place, Sell, PlaceRow, Order, RemoveOrder, FireAt, ClearOverride, SetPriority, SetStance,
    RemoveGhost, Gift, CraneUpgrade, Inherit
}
export enum OrderType {
    Move, Attack, AttackMove, FireAt, Stop, Assist
}
export interface Command {
    player: number; seq: number; targetTick: number; type: CommandType; payload: Array<number>; blob?: Array<number>;
    source?: number; clientSeq?: number;
}
export const ORDER_WAYPOINT = 4;
export const ORDER_RECOVER = 8;
export const ORDER_TARGET_SHIFT = 4;
export const COMMAND_DELAY_TICKS = 5;
export const MAX_PLAYERS = 8;
export const MAX_COMMANDS = 64;
export const SALE_EFFECT_SLOTS = MAX_COMMANDS * 4;
export const COMMAND_WORDS = 12;
export const COMMAND_BLOB_WORDS = 32;
export const COMMAND_STRIDE = COMMAND_WORDS + COMMAND_BLOB_WORDS;
export const MAX_ROW = 64;
export const COMMAND_RING = 32;
export const COMMAND_SLOT_WORDS = 1 + MAX_COMMANDS * COMMAND_STRIDE;
export function orderedCommands(commands: ReadonlyArray<Command>, tick: number): Array<Command> {
    if (!Number.isInteger(tick) || tick < 0 || tick > 0xffffffff) throw Error('Invalid command tick');
    if (commands.length > MAX_COMMANDS) throw Error('Too many commands in one tick');
    const result = commands.map(command => {
        const value = { ...command, payload: command.payload.slice() };
        if (command.blob) value.blob = command.blob.slice();
        return value;
    }).sort((a, b) => a.player - b.player || a.seq - b.seq);
    for (let i = 0; i < result.length; i++) {
        const c = result[i];
        if (![c.player, c.seq, c.targetTick, c.type, ...c.payload].every(Number.isInteger) ||
            c.player < 0 || c.player >= MAX_PLAYERS || c.seq < 0 || c.seq > 0xffffffff ||
            c.source !== undefined && (!Number.isInteger(c.source) || c.source < 0 || c.source >= 32) ||
            c.targetTick !== tick || c.type < CommandType.MoveInput || c.type > CommandType.Inherit ||
            c.payload.length > 8 || c.payload.some(n => n < -2147483648 || n > 2147483647) ||
            i > 0 && result[i - 1].player === c.player && result[i - 1].seq === c.seq)
            throw Error('Invalid or duplicate simulation command');
        const a = c.payload[0], b = c.payload[1], d = c.payload[3];
        const lengths = [1, 4, 2, 1, 0, 4, 1, 6, 2, 7, 4, 2, 3, 0, 3, 1, 2, 3, 4, 2];
        const selected = [CommandType.Order, CommandType.FireAt, CommandType.ClearOverride,
            CommandType.SetPriority, CommandType.SetStance, CommandType.Place, CommandType.PlaceRow].includes(c.type);
        if ((c.blob?.length ?? 0) !== (selected ? COMMAND_BLOB_WORDS : 0) ||
            c.blob?.some(n => !Number.isInteger(n) || n < 0 || n > 0xffffffff)) throw Error('Invalid selection blob');
        if (c.type === CommandType.Place && (a < 0 || b < 0 || c.payload[2] < 0 || d < 0 || d > 3 ||
                c.payload[4] < 0 || c.payload[4] > 1 || c.payload[5] < 0 || c.payload[5] > 1) ||
            c.type === CommandType.PlaceRow && (c.payload.some(n => n < 0) || c.payload[5] > 1 || c.payload[6] > 1) ||
            c.type === CommandType.RemoveGhost && (a < 0 || b < 0) ||
            [CommandType.Sell, CommandType.RemoveOrder, CommandType.Gift].includes(c.type) &&
                (a < 0 || a >= MAX_ENTITIES) ||
            [CommandType.Sell, CommandType.Gift].includes(c.type) && (b < 0 || b > 0xffffff) ||
            c.type === CommandType.Gift && (c.payload[2] < 0 || c.payload[2] >= LOBBY_LIMIT ||
                c.payload[2] === (c.source ?? c.player)) ||
            c.type === CommandType.RemoveOrder && (b < 0 || b >= MAX_ORDERS) ||
            c.type === CommandType.Order && (a < 0 || a > OrderType.Assist || b < 0 || c.payload[2] < 0 || d < 0 ||
                (d >>> ORDER_TARGET_SHIFT) > MAX_ZOMBIES ||
                (d >>> ORDER_TARGET_SHIFT) !== 0 && a !== OrderType.AttackMove) ||
            c.type === CommandType.FireAt && (a < 0 || b < 0 || c.payload[2] < 0 || c.payload[2] > 1) ||
            c.type === CommandType.SetPriority && (a < 0 || a > 3) ||
            c.type === CommandType.SetStance && (a < 0 || a > 1)) throw Error('Invalid entity command');
        if (c.type === CommandType.Order && a === OrderType.Assist &&
            (b >= MAX_ENTITIES || c.payload[2] > 1 || d !== 0)) throw Error('Invalid assist command');
        if (c.payload.length !== lengths[c.type]) throw Error('Invalid command payload length');
        if (c.type === CommandType.CraneUpgrade && (a < 0 || a >= MAX_ENTITIES || b < 0 || b > 0xffffff ||
            c.payload[2] < 2 || c.payload[2] > 3 || d < 0 || d > 1) ||
            c.type === CommandType.Inherit && (a < 1 || a >= 1 << LOBBY_LIMIT || b < 1 || b >= 1 << LOBBY_LIMIT ||
                (a & b) !== 0 || (b & (1 << (c.source ?? c.player))) === 0))
            throw Error('Invalid upgrade or inheritance command');
        if (c.type === CommandType.MoveInput && (a < -1 || a > 255))
            throw Error('Invalid movement direction');
        if ([CommandType.PlaceWeapon, CommandType.UpgradeWeapon, CommandType.SellWeapon,
            CommandType.DebugProjectile].includes(c.type) && (a < 0 || a >= 64))
            throw Error('Invalid weapon owner slot');
        if (c.type === CommandType.PlaceWeapon && (b < 0 || c.payload[2] < 0 || d < 1 || d > 10) ||
            c.type === CommandType.UpgradeWeapon && (b < 1 || b > 10) ||
            c.type === CommandType.ActivateField && (a < 0 || a > 1) ||
            c.type === CommandType.DebugProjectile && (b < 0 || b >= MAX_ZOMBIES ||
                c.payload[2] < 1 || c.payload[2] > 1000000 || d < 1 || d > 200))
            throw Error('Invalid command payload');
    }
    return result;
}
export function encodeCommands(commands: ReadonlyArray<Command>, tick: number): Uint32Array {
    const ordered = orderedCommands(commands, tick), words = new Uint32Array(COMMAND_SLOT_WORDS);
    words[0] = ordered.length;
    ordered.forEach((c, i) => {
        const at = 1 + i * COMMAND_STRIDE;
        words.set([c.player | ((c.source ?? c.player) << 3), c.seq, c.targetTick, c.type, ...c.payload], at);
        if (c.blob) words.set(c.blob, at + COMMAND_WORDS);
    });
    return words;
}
