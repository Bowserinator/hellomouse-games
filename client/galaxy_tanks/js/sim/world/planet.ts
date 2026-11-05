import { CoreType } from '../../types.js';
import { LAVA_SURFACE_INSET } from '../../vars.js';
import { MapDesc, LaunchStarDesc } from '../mapgen/map-desc.js';
import { SolidField } from '../mapgen/solid-field.js';
import { FlightPath } from '../math/flight-path.js';
import { V3, vec } from '../math/vec3.js';
import { ColliderWorld } from './collider-world.js';

export class World {
    readonly colliders: ColliderWorld;
    readonly fields: Array<SolidField>;
    readonly stars: Array<LaunchStarDesc>;
    readonly paths: Map<LaunchStarDesc, FlightPath>;
    constructor(readonly desc: MapDesc) {
        this.colliders = new ColliderWorld(desc.planets);
        this.fields = desc.planets.map(p => new SolidField(p.holes, p.radius));
        this.stars = desc.rings.flatMap(r => [r.a, r.b]);
        this.paths = new Map(desc.rings.flatMap(r => [
            [r.a, new FlightPath(desc, r, r.a)], [r.b, new FlightPath(desc, r, r.b)]
        ]));
    }
    lavaHeight(planet: number): number | undefined {
        const p = this.desc.planets[planet];
        return p.core?.kind === CoreType.LAVA ? -((p.crustThickness ?? 3) + LAVA_SURFACE_INSET) : undefined;
    }
    position(planet: number, dir: V3, height: number, out = vec()): V3 {
        const p = this.desc.planets[planet], r = p.radius + height;
        out.x = p.center[0] + dir.x * r;
        out.y = p.center[1] + dir.y * r;
        out.z = p.center[2] + dir.z * r;
        return out;
    }
}
