import { type Command, orderedCommands } from './commands.js';
import { PROTOCOL_VERSION } from './fixed.js';
import { VARIANT_HASH } from './variants.js';
import { compileDefs } from './defs.js';

export interface TickBundle {
    tick: number; commands: Array<Command>; acknowledgements: Array<number>; control?: 'pause';
}
export interface Handshake {
    protocol: number; variants: number; map: number; defs: number;
}
export class Lockstep {
    tick = 0;
    frozen?: { tick: number; expected: number; actual: number };
    private bundles = new Map<number, TickBundle>();
    private sequences = new Map<number, number>();
    private hashes = new Map<number, number>();
    constructor(readonly players: ReadonlyArray<number>) {
        if (!players.length || new Set(players).size !== players.length ||
            players.some(id => !Number.isInteger(id) || id < 0 || id >= 8)) throw Error('Invalid lockstep players');
    }
    static handshake(map: number, defs = compileDefs().hash): Handshake {
        return { protocol: PROTOCOL_VERSION, variants: VARIANT_HASH, map, defs };
    }
    static compare(a: Handshake, b: Handshake) {
        if (a.protocol !== b.protocol || a.variants !== b.variants || a.map !== b.map || a.defs !== b.defs)
            throw Error('Simulation handshake mismatch');
    }
    submit(bundle: TickBundle) {
        if (this.frozen) throw Error(`Simulation frozen at tick ${this.frozen.tick}; restore a host snapshot`);
        if (!Number.isInteger(bundle.tick) || bundle.tick < this.tick || bundle.tick > this.tick + 1024 ||
            this.bundles.has(bundle.tick)) throw Error('Invalid or duplicate tick bundle');
        if (bundle.control !== undefined && bundle.control !== 'pause') throw Error('Invalid tick control');
        const acks = new Set(bundle.acknowledgements);
        if (acks.size !== this.players.length || !this.players.every(player => acks.has(player)))
            throw Error('Tick bundle requires every player acknowledgement');
        const commands = orderedCommands(bundle.commands, bundle.tick);
        if (commands.some(c => !this.players.includes(c.player))) throw Error('Unknown command player');
        this.bundles.set(bundle.tick, { tick: bundle.tick, commands,
            acknowledgements: [...acks], control: bundle.control });
    }
    take(): TickBundle | undefined {
        if (this.frozen) return;
        const bundle = this.bundles.get(this.tick);
        if (!bundle) return;
        for (const command of bundle.commands) {
            if (command.seq <= (this.sequences.get(command.player) ?? -1)) throw Error('Replayed command sequence');
            this.sequences.set(command.player, command.seq);
        }
        this.bundles.delete(this.tick++);
        return bundle;
    }
    recordHash(tick: number, hash: number) {
        this.hashes.set(tick, hash >>> 0);
        if (this.hashes.size > 1024) this.hashes.delete(this.hashes.keys().next().value);
    }
    receiveHash(tick: number, expected: number) {
        const actual = this.hashes.get(tick);
        if (actual === undefined) throw Error('State hash is not available for this tick');
        if (actual !== (expected >>> 0) && (!this.frozen || tick < this.frozen.tick))
            this.frozen = { tick, expected: expected >>> 0, actual };
        return !this.frozen;
    }
    restore(tick: number, sequences: Array<[number, number]>) {
        if (!Number.isInteger(tick) || tick < 0) throw Error('Invalid snapshot tick');
        this.tick = tick;
        this.frozen = undefined;
        this.bundles.clear();
        this.hashes.clear();
        this.sequences = new Map(sequences);
    }
    snapshotSequences() {
        return [...this.sequences.entries()];
    }
}
