import { ShapeKind } from '../../types.js';
import { ObstacleDesc } from './map-desc.js';
import { V3, fromTuple, rotate, tangentBasis } from '../math/vec3.js';
export interface ColliderPrim {
    t: 'circle' | 'obb';
    dir: V3;
    x: V3;
    z: V3;
    hx: number;
    hz: number;
    top: number;
    bottom: number;
}
function prim(o: ObstacleDesc, t: 'circle' | 'obb', fraction = 1, top = o.height): ColliderPrim {
    const dir = fromTuple(o.dir), [x, z] = tangentBasis(dir);
    rotate(x, x, dir, o.yaw);
    rotate(z, z, dir, o.yaw);
    return { t, dir, x, z, hx: o.size[0] * fraction / 2, hz: o.size[1] * fraction / 2, top, bottom: 0 };
}
export const SHAPE_COLLIDERS: Record<ShapeKind, (o: ObstacleDesc) => Array<ColliderPrim>> = {
    [ShapeKind.BOX]: o => [prim(o, 'obb')],
    [ShapeKind.CYLINDER]: o => [prim(o, 'circle')],
    [ShapeKind.CONE]: o => [prim(o, 'circle')],
    [ShapeKind.ROCK]: o => [prim(o, 'circle')],
    [ShapeKind.CAPSULE_PILLAR]: o => [prim(o, 'circle')],
    [ShapeKind.WALL_SEGMENT]: o => [prim(o, 'obb')],
    [ShapeKind.ZIGGURAT]: o => [prim(o, 'obb', 1, o.height / 3),
        prim(o, 'obb', 0.7, o.height * 2 / 3), prim(o, 'obb', 0.4, o.height)]
};
