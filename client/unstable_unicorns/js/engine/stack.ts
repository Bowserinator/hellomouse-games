import type { Iid } from './ids.js';
import type { GameState } from './state.js';

export interface PendingEntry {
    id: number;
    card: Iid;
    by: number;
    kind: 'play' | 'neigh';
    actionCost: 0 | 1;
    immune: boolean;
    before: GameState;
}

export class PlayStack {
    private entries: Array<PendingEntry> = [];
    private nextId = 1;

    push(entry: Omit<PendingEntry, 'id'>): PendingEntry {
        const full: PendingEntry = { id: this.nextId++, ...entry };
        this.entries.push(full);
        return full;
    }

    top(): PendingEntry | null {
        const last = this.entries.length - 1;
        return last >= 0 ? this.entries[last] : null;
    }

    get size(): number {
        return this.entries.length;
    }

    list(): Array<PendingEntry> {
        return [...this.entries];
    }

    clear() {
        this.entries = [];
    }
}
