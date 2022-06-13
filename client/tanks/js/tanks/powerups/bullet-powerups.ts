import Tank from '../tank.js';
import GameState from '../gamestate.js';
import { PowerupState } from './powerup.js';
import { Powerup, BulletType, PowerupCategory } from '../../types.js';

// @ts-expect-error TS is stupid
export const TANK_TURRET_IMAGE_URLS: Record<Powerup, string> = {};
TANK_TURRET_IMAGE_URLS[Powerup.NONE] = '/tanks/img/tank-turret.png';
TANK_TURRET_IMAGE_URLS[Powerup.LASER] = '/tanks/img/turrets/laser.png';
TANK_TURRET_IMAGE_URLS[Powerup.SHOTGUN] = '/tanks/img/turrets/shotgun.png';
TANK_TURRET_IMAGE_URLS[Powerup.BOMB] = '/tanks/img/turrets/bomb.png';
TANK_TURRET_IMAGE_URLS[Powerup.MAGNET] = '/tanks/img/turrets/magnet.png';
TANK_TURRET_IMAGE_URLS[Powerup.FAST] = '/tanks/img/turrets/fast.png';
TANK_TURRET_IMAGE_URLS[Powerup.ROCKET] = '/tanks/img/turrets/rocket.png';


/** An abstract bullet type powerup  */
class AbstractBulletPowerup extends PowerupState {
    bulletType: BulletType;

    /**
     * @param tank Tank
     * @param bulletType Type of bullet to assign to type
     * @param powerup Powerup enum type
     */
    constructor(tank: Tank, bulletType: BulletType, powerup: Powerup) {
        super(tank, powerup, PowerupCategory.BULLET);
        if (this.constructor === AbstractBulletPowerup)
            throw new Error('AbstractBulletPowerup is abstract');

        this.bulletType = bulletType;
        this.tank.changeBulletType(this.bulletType);
        this.tank.turretImageUrl = TANK_TURRET_IMAGE_URLS[powerup] || TANK_TURRET_IMAGE_URLS[Powerup.NONE];
    }

    /**
     * Called when the bullet is fired (SERVER-SIDE ONLY!)
     * @param gameState GameState
     */
    onFire(gameState: GameState) {
        this.stop();
    }

    stop(isRecursive = false) {
        this.tank.turretImageUrl = TANK_TURRET_IMAGE_URLS[Powerup.NONE];
        this.tank.changeBulletType(BulletType.NORMAL);
        super.stop(isRecursive);
    }
}

export class FastBulletPowerup extends AbstractBulletPowerup {
    constructor(tank: Tank) {
        super(tank, BulletType.FAST, Powerup.FAST);
    }
}

export class LaserPowerup extends AbstractBulletPowerup {
    constructor(tank: Tank) {
        super(tank, BulletType.LASER, Powerup.LASER);
    }
}

export class ShotgunPowerup extends AbstractBulletPowerup {
    constructor(tank: Tank) {
        super(tank, BulletType.SMALL, Powerup.SHOTGUN);
    }
}

export class MagnetPowerup extends AbstractBulletPowerup {
    constructor(tank: Tank) {
        super(tank, BulletType.MAGNET, Powerup.MAGNET);
    }
}

export class BombPowerup extends AbstractBulletPowerup {
    constructor(tank: Tank) {
        super(tank, BulletType.BOMB, Powerup.BOMB);
    }
}

export class RocketPowerup extends AbstractBulletPowerup {
    constructor(tank: Tank) {
        super(tank, BulletType.ROCKET, Powerup.ROCKET);
    }
}
