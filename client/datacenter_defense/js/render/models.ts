import type * as T from 'three';
import { ENTITY as E, MAX_ENTITIES, RENDER_ENTITY_WORDS } from '../sim/layout.js';
import { Q } from '../sim/fixed.js';
import { MODELS } from './model-registry.js';
import { loadModel } from './model-loader.js';
import { RigBatch, type Fall } from './rig.js';

export class Models {
    readonly muzzles = new Float32Array(MAX_ENTITIES * 4 * 3).fill(NaN);
    private odometers = new Float32Array(MAX_ENTITIES);
    private batches = new Map<string, RigBatch>();
    private closed = false;
    constructor(private group: T.Group) {
        for (const [name, spec] of MODELS)
            void loadModel(spec).then(rig => {
                if (this.closed) {
                    rig.dispose(); return;
                }
                this.batches.set(name, new RigBatch(rig, spec, this.group));
            }).catch(error => {
                if (!this.closed) console.warn(`Model fallback: ${name}`, error);
            });
    }
    accept(rows: Int32Array, previous?: Int32Array) {
        for (let id = 0; id < MAX_ENTITIES; id++) {
            const at = id * RENDER_ENTITY_WORDS;
            if (!rows[at + E.state] || !previous?.[at + E.state] ||
                (rows[at + E.flags] >>> 8) !== (previous[at + E.flags] >>> 8)) {
                this.odometers[id] = 0; continue;
            }
            this.odometers[id] += Math.hypot(rows[at + E.x] - previous[at + E.x],
                rows[at + E.z] - previous[at + E.z]) / Q;
        }
    }
    begin(fade: number) {
        this.muzzles.fill(NaN);
        for (const batch of this.batches.values()) batch.begin(fade);
    }
    spec(name: string) {
        return this.batches.get(name)?.spec;
    }
    pose(name: string, id: number, x: number, y: number, z: number, facing: number,
        aims: Float32Array, kicks: Float32Array, time: number, attacking: boolean, fall?: Fall, opacity = 1, color?: string): boolean {
        const batch = this.batches.get(name);
        if (!batch) return false;
        batch.pose(id, x, y, z, facing, aims, kicks, fall ? 0 : this.odometers[id], time, attacking,
            fall ? undefined : this.muzzles, fall, opacity, color);
        return true;
    }
    end() {
        for (const batch of this.batches.values()) batch.end();
    }
    destroy() {
        this.closed = true;
        for (const batch of this.batches.values()) batch.destroy();
        this.batches.clear(); this.muzzles.fill(NaN);
    }
}
