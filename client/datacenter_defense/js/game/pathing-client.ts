import type { PathBody, PathPoint, PathStructure } from './pathing.js';

export class PathingClient {
    private worker = new Worker(new URL('./pathing-worker.js', import.meta.url), { type: 'module' });
    private sequence = 0;
    private error?: Error;
    private pending = new Map<number, { resolve: (paths: Array<{ id: number; points: Array<PathPoint> }>) => void;
        reject: (error: Error) => void; }>();
    constructor(columns: number, rows: number, costs: Uint8Array, airCosts?: Uint8Array) {
        this.worker.onmessage = ({ data }: MessageEvent<{ id: number; error?: string;
            paths: Array<{ id: number; points: Array<PathPoint> }>; }>) => {
            if (data.error && data.id === -1) {
                this.fail(Error(data.error)); return;
            }
            const request = this.pending.get(data.id); if (!request) return;
            this.pending.delete(data.id);
            if (data.error) request.reject(Error(data.error));
            else request.resolve(data.paths);
        };
        this.worker.onerror = event => this.fail(Error(`Path worker failed: ${event.message}`));
        const copy = costs.slice(), air = airCosts?.slice();
        this.worker.postMessage({ type: 'init', columns, rows, costs: copy, airCosts: air },
            air ? [copy.buffer, air.buffer] : [copy.buffer]);
    }
    private fail(error: Error) {
        this.error = error;
        this.worker.terminate();
        for (const request of this.pending.values()) request.reject(error);
        this.pending.clear();
    }
    structures(structures: Array<PathStructure>) {
        if (!this.error) this.worker.postMessage({ type: 'structures', structures });
    }
    find(starts: Array<PathPoint & { id: number }>, goal: PathPoint, body: PathBody,
        units: Array<PathStructure & { id: number }> = []) {
        if (this.error) return Promise.reject(this.error);
        const id = this.sequence++;
        return new Promise<Array<{ id: number; points: Array<PathPoint> }>>((resolve, reject) => {
            this.pending.set(id, { resolve, reject }); this.worker.postMessage({ type: 'find', id, starts, goal, body, units });
        });
    }
    destroy() {
        this.fail(Error('Path worker stopped'));
    }
}
