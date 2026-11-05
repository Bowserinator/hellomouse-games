import { SurfaceType, TreadStyle } from '../../types.js';
import { ICE_FRICTION } from '../../vars.js';
export interface SurfaceDef {
    weight: number; friction: number; treadStyle: TreadStyle; topSideSplit: boolean;
}
export const SURFACE_TABLE: Record<SurfaceType, SurfaceDef> = {
    [SurfaceType.ROCK]: { weight: 1, friction: 1, treadStyle: TreadStyle.NORMAL, topSideSplit: false },
    [SurfaceType.ICE]: { weight: 0.7, friction: ICE_FRICTION, treadStyle: TreadStyle.SCRATCH, topSideSplit: false },
    [SurfaceType.GRASS]: { weight: 1, friction: 1, treadStyle: TreadStyle.NORMAL, topSideSplit: false },
    [SurfaceType.MIRROR]: { weight: 0.06, friction: 1, treadStyle: TreadStyle.ETCHED, topSideSplit: false },
    [SurfaceType.SNOW]: { weight: 0.8, friction: 1, treadStyle: TreadStyle.GROOVE, topSideSplit: false },
    [SurfaceType.PLASTIC]: { weight: 0.7, friction: 1, treadStyle: TreadStyle.NORMAL, topSideSplit: false },
    [SurfaceType.SAND]: { weight: 0.9, friction: 1, treadStyle: TreadStyle.GROOVE, topSideSplit: false }
};
