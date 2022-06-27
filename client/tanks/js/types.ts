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
    NONE, FAST, LASER, SHOTGUN, BOMB, MAGNET, ROCKET,
    STEALTH, SHIELD
}

// Powerups within the same category silent override each other
export enum PowerupCategory {
    BULLET, TANK
}

export enum TankSync {
    // Lobby
    CHANGE_COLOR,
    CHANGE_ROUNDS,

    // Game
    ADD_BULLET,
    REMOVE_BULLETS,
    MAP_UPDATE,
    UPDATE_ALL_TANKS,
    SYNC_ALL_BULLETS,
    ADD_EXPLOSIONS,
    ADD_POWERUP_ITEM,
    DELETE_POWERUP_ITEM,
    GIVE_POWERUP,
    TANK_FIRED,
    GENERIC_TANK_SYNC
}

export enum BulletType {
    NORMAL, MAGNET, BOMB, SMALL, LASER, FAST, ROCKET
}

export enum ExplosionGraphics {
    SIMPLE,  // An expanding circle, good for small explosions
    CLUSTER, // Cluster of many explosions, good for large explosions
    CIRCLE,  // Like cluster, but circular
    SHOCKWAVE, // Railgun shockwave
    PARTICLES  // Tank death explosion
}

export enum ParticleGraphics {
    SIMPLE, // Black circles, used for stuff like tanks
    SPARKS, // Used for hotter stuff breaking apart
    WARNING // Used for rocket artillery impact zone
}
