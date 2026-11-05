import { Powerup } from '../../types.js';
import { MUZZLE_H, MUZZLE_OFFSET, TANK_RADIUS } from '../../vars.js';
import { Tuple3 } from '../../sim/math/vec3.js';
export enum ColorSlot {
    PRIMARY, SECONDARY, ACCENT, DARK, LIGHT, GLOW, FIXED
}
export enum PartGroup {
    BASE, TREAD_VISUAL, TURRET, ATTACHMENT
}
export interface ColorSpec {
    slot: ColorSlot; blend?: number; neutral?: number; fixed?: number;
}
export interface PartDef {
    shape: 'box' | 'cylinder' | 'ring'; size: Tuple3; position: Tuple3;
    color: ColorSpec; rotation?: Tuple3; group?: PartGroup;
}
export interface TurretDef {
    parts: Array<PartDef>; muzzle: Tuple3; recoil: number;
}
export interface TankStyle {
    id: string; hitRadius: number; parts: Array<PartDef>; turret: Record<Powerup, TurretDef>;
    anchors: { muzzle: Tuple3; thrusterL: Tuple3; thrusterR: Tuple3; shieldCenter: Tuple3;
        nameplate: Tuple3; treadL: Tuple3; treadR: Tuple3; };
    palette: { secondary: number; accent: number };
}
const part = (size: Tuple3, position: Tuple3, slot: ColorSlot, shape: PartDef['shape'] = 'box',
    rotation?: Tuple3): PartDef => ({ shape, size, position, color: { slot }, rotation });
const barrel = (x = 0, length = 1.6, width = 0.28): PartDef => ({
    shape: 'box', size: [width, width, length], position: [x, MUZZLE_H, -1.1],
    color: { slot: ColorSlot.PRIMARY, blend: 0.7, neutral: 0x949daa }
});
const crossArm = (x: number, z: number, length = 1.6, width = 0.28): PartDef => ({
    shape: 'box', size: [x ? length : width, width, z ? length : width],
    position: [x * (length / 2 + 0.3), MUZZLE_H, z * (length / 2 + 0.3)],
    color: { slot: ColorSlot.PRIMARY, blend: 0.7, neutral: 0x949daa }
});
const turretBase = part([1.15, 0.45, 1.05], [0, 0.97, 0], ColorSlot.PRIMARY);
const turret = (parts: Array<PartDef>): TurretDef =>
    ({ parts: [turretBase, ...parts], muzzle: [0, MUZZLE_H, -MUZZLE_OFFSET], recoil: 0.14 });
const standard = turret([barrel()]);
/** Extra parts shown on top of whichever turret the tank already has */
const attachment = (parts: Array<PartDef>): TurretDef =>
    ({ parts, muzzle: [0, MUZZLE_H, -MUZZLE_OFFSET], recoil: 0.14 });
export const DEFAULT_TANK_STYLE: TankStyle = {
    id: 'galaxy-voxel', hitRadius: TANK_RADIUS,
    parts: [
        part([1.8, 0.55, 2], [0, 0.52, 0], ColorSlot.PRIMARY),
        part([1.35, 0.15, 1.65], [0, 0.85, 0.1], ColorSlot.ACCENT),
        part([0.5, 0.65, 2.3], [-1.02, 0.38, 0], ColorSlot.DARK),
        part([0.5, 0.65, 2.3], [1.02, 0.38, 0], ColorSlot.DARK),
        ...[-1.02, 1.02].flatMap(x => [-0.75, -0.25, 0.25, 0.75].map(z =>
            part([0.53, 0.1, 0.14], [x, 0.72, z], ColorSlot.LIGHT))),
        part([0.28, 0.25, 0.22], [-0.65, 0.66, -1.02], ColorSlot.GLOW),
        part([0.28, 0.25, 0.22], [0.65, 0.66, -1.02], ColorSlot.GLOW),
        part([1.1, 0.2, 0.22], [0, 0.42, 1.07], ColorSlot.SECONDARY)
    ],
    turret: {
        [Powerup.NONE]: standard,
        [Powerup.FAST]: turret([barrel(-0.26, 2, 0.18), barrel(0.26, 2, 0.18),
            part([0.3, 0.15, 1.6], [0, 1.1, -1.15], ColorSlot.GLOW)]),
        [Powerup.LASER]: turret([barrel(0, 2.2, 0.32),
            part([0.4, 0.4, 0.2], [0, 1.1, -2.1], ColorSlot.GLOW)]),
        [Powerup.SHOTGUN]: turret([-0.4, 0, 0.4].map(x => barrel(x, 1.35, 0.26))),
        [Powerup.BOMB]: turret([part([0.68, 0.68, 1.1], [0, 1.2, -0.8], ColorSlot.SECONDARY),
            barrel(0, 1.4, 0.65)]),
        [Powerup.MAGNET]: turret([barrel(-0.45, 1.1, 0.3), barrel(0.45, 1.1, 0.3),
            part([1.1, 0.3, 0.3], [0, 1.1, -0.6], ColorSlot.ACCENT)]),
        [Powerup.ROCKET]: turret([-0.45, 0, 0.45].map(x =>
            part([0.35, 0.45, 1.45], [x, 1.1, -0.4], ColorSlot.SECONDARY))),
        [Powerup.METEOR_RAIN]: turret([
            ...[-0.45, 0, 0.45].map(x => part([0.35, 0.45, 1.45], [x, 1.1, -0.4], ColorSlot.SECONDARY)),
            ...[-0.22, 0.22].map(x => part([0.35, 0.45, 1.45], [x, 1.55, -0.4], ColorSlot.ACCENT)),
            part([0.35, 0.45, 1.45], [0, 2, -0.4], ColorSlot.SECONDARY)]),
        [Powerup.CROSS_FIRE]: turret([crossArm(0, -1), crossArm(0, 1), crossArm(-1, 0), crossArm(1, 0),
            part([0.5, 0.4, 0.5], [0, 1.1, 0], ColorSlot.ACCENT)]),
        [Powerup.TELEPORT]: turret([barrel(),
            part([0.48, 0.16, 0.48], [0, 1.1, -1.85], ColorSlot.GLOW, 'ring', [Math.PI / 2, 0, 0])]),
        [Powerup.LANDMINE]: turret([barrel(0, 1.1, 0.6),
            part([0.4, 0.3, 0.4], [0, 1.35, 0.3], ColorSlot.GLOW, 'cylinder')]),
        [Powerup.SEISMIC_SHOCKWAVE]: turret([barrel(0, 1.2, 0.5),
            part([0.6, 0.12, 0.6], [0, MUZZLE_H, -1.55], ColorSlot.GLOW, 'ring'),
            part([0.42, 0.1, 0.42], [0, MUZZLE_H, -1.2], ColorSlot.ACCENT, 'ring')]),
        [Powerup.CHRONO_DAMPENER]: attachment([
            part([0.62, 0.09, 0.62], [0, 1.6, 0.05], ColorSlot.GLOW, 'ring', [Math.PI / 2, 0, 0]),
            part([0.1, 0.4, 0.1], [0, 1.32, 0.05], ColorSlot.SECONDARY),
            part([0.46, 0.07, 0.46], [0, MUZZLE_H, -0.85], ColorSlot.ACCENT, 'ring')]),
        [Powerup.SHIELD]: standard,
        [Powerup.STEALTH]: standard
    },
    anchors: { muzzle: [0, MUZZLE_H, -MUZZLE_OFFSET], thrusterL: [-0.7, 0.25, 0.7],
        thrusterR: [0.7, 0.25, 0.7], shieldCenter: [0, 0.75, 0], nameplate: [0, 2.8, 0],
        treadL: [-1.02, 0.04, 0], treadR: [1.02, 0.04, 0] },
    palette: { secondary: 0.62, accent: 0.35 }
};
