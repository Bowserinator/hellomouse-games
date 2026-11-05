export { TANK_COLORS, TANK_TEXT_COLORS, MAX_PLAYERS, ROUND_ARRAY, UPDATE_EVERY_N_MS,
    POWERUPS_TO_SPAWN_AT_ONCE,
    PRE_ROUND_DELAY, SPECTATE_DELAY, SYNC_BULLETS_EVERY_N_TIMES,
    POS_SMOOTHING_RATE } from '../../tanks/js/vars.js';

export const DELAY_POWERUP_SPAWN = 20000;
export const MAX_POWERUP_ITEMS = 8;
export const TANK_SPEED = 9;
export const DASH_SPEED = TANK_SPEED * 3;
export const DASH_DURATION = .2;
export const DASH_COOLDOWN = 3;
export const TANK_RADIUS = 1.3;
export const TANK_HEIGHT = 1.5;
export const ACCEL = 14;
export const AIR_CONTROL = 0.35;
export const ICE_FRICTION = 0.06;
export const JUMP_V = 14;
export const GRAVITY = 28;
export const POUND_V = 42;
export const STEP_UP = 0.15;
export const JUMPABLE_MAX = 2.8;
export const JUMPABLE_FRACTION = 0.4;
export const SCATTER_DENSITY = 1;
export const HOLE_COVERAGE = 0.22;
export const WALL_DENSITY = 0.5;
export const WALL_SEG_LEN = 3.4;
export const WALL_MIN_GAP = 4.5;
export const PLANET_RADIUS_MIN = 14;
export const PLANET_RADIUS_MAX = 34;
export const PLANET_GAP = 55;
export const MUZZLE_H = 1.1;
export const MUZZLE_OFFSET = 1.9;
export const BULLET_SPEED = 26;
export const BULLET_LIFE = 5;
export const MAX_NORMAL_AMMO = 10;
export const CLIENT_JUMP_TIMEOUT = 5000;
export const TANK_FIRE_DELAY = 200;
export const TANK_TURN_RATE = Math.PI / 2;
export const ROUND_SETTLE_TIME = 1500;
export const DELAY_AFTER_WIN_ROUND = 600;
export const MAGNET_ARM_TIME = 2;
export const MAGNET_CHASE_SPEED = 24;
export const MAGNET_CHASE_ACCEL = 40;
export const MAGNET_TRACK_WIDTH = 0.22 * 0.6 * 0.6 * 0.5;
export const LASER_LENGTH = 70 * 3 * 2;
export const BULLET_OUTLINE_PX = 4;
export const ITEM_FLOAT_HEIGHT = 2;
export const IFRAMES_SPAWN = 1.5;
export const IFRAMES_LAND = 0.9;
export const STAR_TRIGGER_R = 2.4;
export const STAR_COOLDOWN = 1.5;
export const STAR_SPIN_RATE = 0.45;
export const STAR_NEAR_SPIN = 10;
export const STAR_HOLD_MS = 400;
export const STAR_HEIGHT = 2.3;
export const STAR_INSIDE_SPIN = 40;
export const STAR_TRAIL_END_HEIGHT = 16;
export const STAR_PATH_RISE = 4 * JUMP_V ** 2 / (2 * GRAVITY);
export const STAR_PATH_CLEARANCE = 5 * JUMP_V ** 2 / (2 * GRAVITY);
export const LANDING_OFFSET = 4;
export const FALL_DEATH_TIME = 0.9;
export const FALL_SPEED = 16;
export const LAVA_SURFACE_INSET = -0.1;
export const BLACK_HOLE_RADIUS_FRAC = 0.51;
/** Alpha that fully glowing pixels are drawn with, so the glow pass can find them */
export const GLOW_MASK_ALPHA = 0.5;
export const LAVA_GLOW = {
    COLOR: [1, 0.92, 0.55],
    STRENGTH: 0.5,
    SPREAD: 1.6,
    DOWNSCALE: 4
};
export const ATMOSPHERE = {
    HEIGHT_FRAC: 2,
    MIN_HEIGHT: 12,
    COLOR: [0.32, 0.67, 0.88],
    DENSITY: 0.4,
    SHARPNESS: 3
};
export const EDGE_FORGIVENESS = 0.35;
export const FLIGHT_VULNERABLE = false;
export const FLIGHT_CAN_FIRE = false;
export const SHIELD_BLOCKS_FIRE = false;
export const POUND_SHOCKWAVE_RADIUS = 0;
export const TREAD_LIFE = 1.6;
export const TREAD_SAMPLES = 40;
export const MAX_DEATH_EXPLOSIONS = 8;
export const DEATH_EXPLOSION_ON_FALL = false;
export const DEATH_EXPLOSION = {
    DURATION_MS: 1000,
    RADIUS: 8 * 0.4,
    FIREBALL_FRAC: 0.55,
    RING_WIDTH_FRAC: 0.16,
    TINT_MIX: 0.35,
    SHAKE: 0.35,
    VOXEL_CHUNKS: 48
};
export const CAM = {
    PITCH_DEG: 72,
    DIST_DEFAULT: 26,
    DIST_MIN: 14,
    DIST_MAX: 46,
    FOV: 50,
    SMOOTH: 6
};
