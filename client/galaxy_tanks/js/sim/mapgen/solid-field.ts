import { V3, dot, fromTuple, tangentBasis } from '../math/vec3.js';
import { angDist } from '../math/sphere.js';
import { HoleDesc } from './map-desc.js';

export class SolidField {
    private holes;
    constructor(holes: Array<HoleDesc> = [], readonly radius = 1) {
        this.holes = holes.map(h => ({ ...h, anchor: fromTuple(h.dir), basis: tangentBasis(fromTuple(h.dir)) }));
    }
    signedDistance(dir: V3): number {
        let result = Math.PI;
        for (const hole of this.holes) {
            const angle = hole.harmonics.length ? Math.atan2(dot(dir, hole.basis[1]), dot(dir, hole.basis[0])) : 0;
            let boundary = hole.angRadius;
            for (const [amplitude, frequency, phase] of hole.harmonics)
                boundary += amplitude * Math.sin(angle * frequency + phase);
            result = Math.min(result, angDist(dir, hole.anchor) - boundary);
        }
        return result * this.radius;
    }
    isSolid(dir: V3): boolean {
        return this.signedDistance(dir) >= 0;
    }
}
