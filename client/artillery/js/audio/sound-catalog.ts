export const soundCatalog = {
    normalFire: '/tanks/sound/tank_fire_normal.mp3',
    scatterFire: '/tanks/sound/tank_shotgun.mp3',
    precisionFire: '/tanks/sound/railgun.mp3',
    beam: '/tanks/sound/laser.ogg',
    smallExplosion: '/tanks/sound/explode1.mp3',
    mediumExplosion: '/tanks/sound/explode2.mp3',
    largeExplosion: '/tanks/sound/explode3.mp3',
    bounce: '/tanks/sound/bullet_bounce.ogg',
    engine: '/tanks/sound/tank_hum.ogg',
    beacon: '/tanks/sound/beep.mp3',
    materialise: '/tanks/sound/teleport.mp3',
    clink: '/galaxy_tanks/sound/shield_hit.mp3',
    burning: '/galaxy_tanks/sound/lava_sfx.mp3',
    hop: '/galaxy_tanks/sound/jump.mp3',
    missileLaunch: '/galaxy_tanks/sound/launch_star_launch.mp3',
    stormIdle: '/galaxy_tanks/sound/launch_star_idle.mp3',
    tunnel: '/galaxy_tanks/sound/dark_matter_hum.mp3',
    empty: '/galaxy_tanks/sound/ammunition_zero.mp3',
    turnStart: '/tanks/sound/radio.ogg',
    radioBeep: '/tanks/sound/radio.ogg'
} as const;

export type SoundIdentifier = keyof typeof soundCatalog;
