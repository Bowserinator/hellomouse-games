export enum Direction {
    UP, DOWN, LEFT, RIGHT, NONE
}

export enum Action {
    MOVE_BEGIN,
    MOVE_END,
    FIRE,
    STOP_FIRE,
    UPDATE_ROTATION
}

export enum Powerup {
    NONE, FAST, LASER, SHOTGUN, BOMB, MAGNET,
    CLOAK, SHIELD
}

export enum TankSync {
    ADD_BULLET,
    REMOVE_BULLETS,
    TANK_POS,
    MAP_UPDATE,
    UPDATE_ALL_TANKS,
    TANK_DIED,
    SYNC_ALL_BULLETS,
    ADD_EXPLOSIONS
}

export enum BulletType {
    NORMAL, MAGNET, BOMB, SMALL, LASER, FAST
}

export enum ExplosionGraphics {
    SIMPLE,  // An expanding circle, good for small explosions
    CLUSTER, // Cluster of many explosions, good for large explosions
    CIRCLE,  // Like cluster, but circular
    SHOCKWAVE // Railgun shockwave
}
