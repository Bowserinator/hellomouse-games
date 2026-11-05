import { CoreType, ObstacleStrategyType, ShapeKind, SkyType, SurfaceType } from '../../types.js';
import { Tuple3 } from '../math/vec3.js';

export interface MapDesc {
    version: 1;
    seed: number;
    sky?: SkyType;
    planets: Array<PlanetDesc>;
    rings: Array<LaunchRingDesc>;
}
export interface PlanetDesc {
    id: number;
    center: Tuple3;
    radius: number;
    surface: SurfaceType;
    surfaceSeed: number;
    strategy: ObstacleStrategyType;
    obstacles: Array<ObstacleDesc>;
    holes?: Array<HoleDesc>;
    crustThickness?: number;
    core?: CoreDesc;
    spawnPoints: Array<Tuple3>;
    tuning: { friction: number };
}
export interface ObstacleDesc {
    kind: ShapeKind;
    dir: Tuple3;
    yaw: number;
    size: Tuple3;
    height: number;
    variant: number;
}
export interface HoleDesc {
    dir: Tuple3;
    angRadius: number;
    harmonics: Array<[number, number, number]>;
}
export interface CoreDesc {
    kind: CoreType; radiusFrac: number; seed: number;
}
export interface LaunchStarDesc {
    planet: number; dir: Tuple3; landDir: Tuple3; destPlanet: number; accent: number;
}
export interface LaunchRingDesc {
    id: number; a: LaunchStarDesc; b: LaunchStarDesc; durationMs: number;
}
