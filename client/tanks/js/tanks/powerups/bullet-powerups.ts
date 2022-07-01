import Tank from '../tank.js';
import GameState from '../gamestate.js';
import { PowerupState } from './powerup.js';
import { Powerup, BulletType, PowerupCategory } from '../../types.js';
import { playSoundAt, addSoundsToPreload } from '../../sound/sound.js';

addSoundsToPreload([
    '/tanks/sound/railgun.mp3',
    '/tanks/sound/laser.ogg',
    '/tanks/sound/tank_shotgun.mp3',
    '/tanks/sound/tank_fire_normal.mp3',
    '/tanks/sound/radio.ogg',
    '/tanks/sounds/teleport.mp3'
]);

// @ts-expect-error TS is stupid
export const TANK_TURRET_IMAGE_URLS: Record<Powerup, string> = {};
TANK_TURRET_IMAGE_URLS[Powerup.NONE] = '/tanks/img/tank-turret.png';
TANK_TURRET_IMAGE_URLS[Powerup.LASER] = '/tanks/img/turrets/laser.png';
TANK_TURRET_IMAGE_URLS[Powerup.SHOTGUN] = '/tanks/img/turrets/shotgun.png';
TANK_TURRET_IMAGE_URLS[Powerup.BOMB] = '/tanks/img/turrets/bomb.png';
TANK_TURRET_IMAGE_URLS[Powerup.MAGNET] = '/tanks/img/turrets/magnet.png';
TANK_TURRET_IMAGE_URLS[Powerup.FAST] = '/tanks/img/turrets/fast.png';
TANK_TURRET_IMAGE_URLS[Powerup.ROCKET] = '/tanks/img/turrets/rocket.png';
TANK_TURRET_IMAGE_URLS[Powerup.TELEPORT] = '/tanks/img/turrets/teleport.png';


/** An abstract bullet type powerup  */
class AbstractBulletPowerup extends PowerupState {
    bulletType: BulletType;
    fireSound: string;

    /**
     * @param tank Tank
     * @param bulletType Type of bullet to assign to type
     * @param powerup Powerup enum type
     * @param fireSound Src of sound to play when fired (client side only)
     */
    constructor(tank: Tank, bulletType: BulletType, powerup: Powerup, fireSound = '') {
        super(tank, powerup, PowerupCategory.BULLET);
        if (this.constructor === AbstractBulletPowerup)
            throw new Error('AbstractBulletPowerup is abstract');

        this.bulletType = bulletType;
        this.fireSound = fireSound;
        this.tank.changeBulletType(this.bulletType);
        this.tank.firedBullets = [];
        this.tank.turretImageUrl = TANK_TURRET_IMAGE_URLS[powerup] || TANK_TURRET_IMAGE_URLS[Powerup.NONE];
    }

    /**
     * Called when the bullet is fired (Both server & client side)
     * @param gameState GameState
     */
    onFire(gameState: GameState) {
        this.stop();
        if (this.fireSound)
            playSoundAt(this.fireSound, this.tank.position, gameState);
    }

    stop(isRecursive = false) {
        this.tank.turretImageUrl = TANK_TURRET_IMAGE_URLS[Powerup.NONE];
        this.tank.changeBulletType(BulletType.NORMAL);
        super.stop(isRecursive);
    }
}

export class FastBulletPowerup extends AbstractBulletPowerup {
    constructor(tank: Tank) {
        super(tank, BulletType.FAST, Powerup.FAST, '/tanks/sound/railgun.mp3');
    }
}

export class LaserPowerup extends AbstractBulletPowerup {
    constructor(tank: Tank) {
        super(tank, BulletType.LASER, Powerup.LASER, '/tanks/sound/laser.ogg');
    }
}

export class ShotgunPowerup extends AbstractBulletPowerup {
    constructor(tank: Tank) {
        super(tank, BulletType.SMALL, Powerup.SHOTGUN, '/tanks/sound/tank_shotgun.mp3');
    }
}

export class MagnetPowerup extends AbstractBulletPowerup {
    constructor(tank: Tank) {
        super(tank, BulletType.MAGNET, Powerup.MAGNET, '/tanks/sound/tank_fire_normal.mp3');
    }
}

export class BombPowerup extends AbstractBulletPowerup {
    constructor(tank: Tank) {
        super(tank, BulletType.BOMB, Powerup.BOMB, '/tanks/sound/tank_fire_normal.mp3');
    }
}

export class RocketPowerup extends AbstractBulletPowerup {
    constructor(tank: Tank) {
        super(tank, BulletType.ROCKET, Powerup.ROCKET, '/tanks/sound/radio.ogg');
    }
}

export class TeleportPowerup extends AbstractBulletPowerup {
    constructor(tank: Tank) {
        super(tank, BulletType.TELEPORT, Powerup.TELEPORT, '/tanks/sound/teleport.mp3');
    }
}
