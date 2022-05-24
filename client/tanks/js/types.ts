export enum Direction {
    UP, DOWN, LEFT, RIGHT, NONE
}

export enum Action {
    MOVE_BEGIN,
    MOVE_END,
    FIRE,
    STOP_FIRE
}

export enum Powerup {
    NONE, MISSILE, LASER, SHOTGUN, BOMB,
    CLOAK
}

export enum TankSync {
    ADD_BULLET, REMOVE_BULLETS, TANK_POS, MAP_UPDATE,
    UPDATE_ALL_TANKS, TANK_DIED, SYNC_ALL_BULLETS
}

export enum BulletType {
    NORMAL, MISSILE, BOMB, SMALL, LASER, FAST
}
