import { CoreType, HoleStyle, ObstacleStrategyType, ShapeKind, SurfaceType } from '../../../types.js';
import { HOLE_COVERAGE, JUMPABLE_FRACTION, JUMPABLE_MAX, SCATTER_DENSITY, WALL_DENSITY,
    WALL_MIN_GAP, WALL_SEG_LEN } from '../../../vars.js';
import { Rng } from '../../math/rng.js';
import { angDist, advance } from '../../math/sphere.js';
import { V3, dot, fromTuple, rotate, scale, tangentBasis, tuple, vec } from '../../math/vec3.js';
import { HoleDesc, ObstacleDesc, PlanetDesc } from '../map-desc.js';
import { SolidField } from '../solid-field.js';
export interface StrategyParams {
    wallDensity?: number;
    holeCoverage?: number;
    scatterDensity?: number;
    holeStyle?: HoleStyle;
}
export interface PlanetGenContext {
    rng: Rng; planet: PlanetDesc; keepOuts: Array<V3>; params: StrategyParams;
}
export interface PlanetFeatures {
    obstacles: Array<ObstacleDesc>; holes?: Array<HoleDesc>; crustThickness?: number;
    core?: { kind: CoreType; radiusFrac: number; seed: number };
}
export interface ObstacleStrategy {
    weight: number; generate: (ctx: PlanetGenContext) => PlanetFeatures;
}

const HOLE_STYLE_SALT = 4711;

function clear(ctx: PlanetGenContext, d: V3, radius: number): boolean {
    return ctx.keepOuts.every(k => angDist(k, d) * ctx.planet.radius > radius + 5);
}
function obstacle(ctx: PlanetGenContext, d: V3, kind: ShapeKind, low: boolean): ObstacleDesc {
    const r = ctx.rng, height = low ? r.range(0.9, JUMPABLE_MAX) : r.range(3.6, 6);
    return { kind, dir: tuple(d), yaw: r.range(0, Math.PI * 2),
        size: [r.range(1.8, 3.5), r.range(1.8, 3.5), height], height, variant: r.int(0, 255) };
}
function scatter(ctx: PlanetGenContext, density = ctx.params.scatterDensity ?? SCATTER_DENSITY): PlanetFeatures {
    const obstacles: Array<ObstacleDesc> = [], r = ctx.rng;
    const count = Math.round(14 * (ctx.planet.radius / 20) ** 2 * density);
    const kinds = [ShapeKind.BOX];
    for (let attempt = 0; attempt < count * 100 && obstacles.length < count; attempt++) {
        const d = r.unitVec();
        if (!clear(ctx, d, 3) || obstacles.some(o => angDist(d, fromTuple(o.dir)) * ctx.planet.radius < 5)) continue;
        const seed = obstacle(ctx, d, r.pick(kinds),
            r.float() < JUMPABLE_FRACTION);
        obstacles.push(seed);
        if (r.float() < 0.3) for (let i = 0, siblings = r.int(1, 3); i < siblings && obstacles.length < count; i++) {
            const sibling = { ...d }, [heading] = tangentBasis(d);
            rotate(heading, heading, d, r.range(0, Math.PI * 2));
            scale(heading, heading, r.range(4.5, 6));
            advance(sibling, heading, 1, ctx.planet.radius);
            if (clear(ctx, sibling, 3) && obstacles.every(o =>
                angDist(sibling, fromTuple(o.dir)) * ctx.planet.radius >= 4.5))
                obstacles.push(obstacle(ctx, sibling, ShapeKind.BOX,
                    r.float() < JUMPABLE_FRACTION));
        }
    }
    return { obstacles };
}
function randomHoles(ctx: PlanetGenContext, target: number): Array<HoleDesc> {
    const hs: Array<HoleDesc> = [], r = ctx.rng;
    const circular = ctx.planet.surface === SurfaceType.MIRROR || ctx.planet.surface === SurfaceType.PLASTIC;
    let area = 0;
    for (let i = 0; i < 2000 && area < target; i++) {
        const d = r.unitVec(), radius = r.range(0.12, 0.38);
        if (!clear(ctx, d, (radius + 0.05) * ctx.planet.radius + 1)) continue;
        const harmonics: HoleDesc['harmonics'] = [[0.015, 3, r.range(0, 6.28)], [0.012, 5, r.range(0, 6.28)]];
        hs.push({ dir: tuple(d), angRadius: radius, harmonics: circular ? [] : harmonics });
        area += (1 - Math.cos(radius)) / 2;
    }
    return hs;
}
function circularHoles(ctx: PlanetGenContext, target: number): Array<HoleDesc> {
    const r = ctx.rng, goldenAngle = 2.399963229728653;
    let best: Array<HoleDesc> = [], bestArea = 0;
    for (let count = r.int(5, 9); count <= 26; count += 2) {
        const spacing = Math.sqrt(4 * Math.PI / count);
        const radius = Math.min(Math.acos(1 - 2 * target / count), spacing * 0.42);
        const base = Array.from({ length: count }, (_, i) => {
            const y = 1 - 2 * (i + 0.5) / count, ring = Math.sqrt(1 - y * y);
            return vec(Math.cos(i * goldenAngle) * ring, y, Math.sin(i * goldenAngle) * ring);
        });
        let placed: Array<V3> = [];
        for (let attempt = 0; attempt < 25 && placed.length < count * 0.85; attempt++) {
            const axis = r.unitVec(), angle = r.range(0, Math.PI * 2);
            const fitted = base.map(d => rotate(vec(), d, axis, angle))
                .filter(d => clear(ctx, d, (radius + 0.05) * ctx.planet.radius + 1));
            if (fitted.length > placed.length) placed = fitted;
        }
        const area = placed.length * (1 - Math.cos(radius));
        if (area > bestArea) {
            bestArea = area;
            best = placed.map(d => ({ dir: tuple(d), angRadius: radius, harmonics: [] }));
        }
        if (placed.length >= count * 0.85) break;
    }
    return best.length ? best : randomHoles(ctx, target);
}
function holes(ctx: PlanetGenContext): PlanetFeatures {
    const result = scatter(ctx, 0.2), r = ctx.rng;
    const target = ctx.params.holeCoverage ?? HOLE_COVERAGE;
    const rolled = r.fork(HOLE_STYLE_SALT).float() < 0.5 ? HoleStyle.RANDOM : HoleStyle.CIRCULAR;
    const style = ctx.params.holeStyle ?? rolled;
    const hs = style === HoleStyle.CIRCULAR ? circularHoles(ctx, target) : randomHoles(ctx, target);
    result.holes = hs;
    const field = new SolidField(hs, ctx.planet.radius);
    result.obstacles = result.obstacles.filter(o => field.signedDistance(fromTuple(o.dir)) > 3);
    result.crustThickness = Math.max(2.5, Math.min(4.5, ctx.planet.radius * 0.12));
    result.core = { kind: r.pick([CoreType.BLACK_HOLE, CoreType.LAVA, CoreType.DARK_MATTER]),
        radiusFrac: r.range(0.3, 0.55), seed: r.int(0, 0x7fffffff) };
    return result;
}
function walls(ctx: PlanetGenContext): PlanetFeatures {
    const obstacles: Array<ObstacleDesc> = [], placed: Array<V3> = [], r = ctx.rng, radius = ctx.planet.radius;
    const budget = Math.ceil((ctx.params.wallDensity ?? WALL_DENSITY) * 85 * (radius / 20) ** 2 / WALL_SEG_LEN);
    for (let attempt = 0; attempt < 80 && obstacles.length < budget; attempt++) {
        const count = Math.min(r.int(1, 9), budget - obstacles.length);
        const seed = obstacle(ctx, r.unitVec(), ShapeKind.WALL_SEGMENT, r.float() < .35);
        // Overlap the outer edges so curvature does not open gaps between segments.
        const step = 2 * radius * Math.atan((WALL_SEG_LEN - .1) / (2 * (radius + seed.height)));
        let best: Array<ObstacleDesc> = [], bestSpacing = -1;
        // Best-candidate Poisson sampling spreads whole chains without a grid.
        for (let candidate = 0; candidate < 24; candidate++) {
            const d = r.unitVec(), [heading] = tangentBasis(d);
            rotate(heading, heading, d, r.range(0, Math.PI * 2));
            advance(d, heading, -step * (count - 1) / 2, radius);
            const chain: Array<ObstacleDesc> = [];
            let spacing = Infinity;
            for (let i = 0; i < count; i++) {
                if (!clear(ctx, d, 3)) break;
                for (const other of placed)
                    spacing = Math.min(spacing, angDist(other, d) * radius);
                if (spacing < WALL_MIN_GAP + WALL_SEG_LEN) break;
                const [x, z] = tangentBasis(d);
                chain.push({ ...seed, dir: tuple(d), yaw: Math.atan2(-dot(heading, z), dot(heading, x)),
                    size: [WALL_SEG_LEN, .8, seed.height] });
                advance(d, heading, step, radius);
            }
            if (chain.length === count && spacing > bestSpacing) {
                best = chain;
                bestSpacing = spacing;
            }
        }
        obstacles.push(...best);
        for (const wall of best) placed.push(fromTuple(wall.dir));
    }
    return { obstacles };
}
export const STRATEGIES: Record<ObstacleStrategyType, ObstacleStrategy> = {
    [ObstacleStrategyType.SCATTER]: { weight: 1, generate: ctx => scatter(ctx) },
    [ObstacleStrategyType.HOLES]: { weight: 1, generate: holes },
    [ObstacleStrategyType.WALLS]: { weight: 1, generate: walls }
};
