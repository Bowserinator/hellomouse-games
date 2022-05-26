import { TANK_SIZE, TANK_TURRET_SIZE } from '../vars.js';
import Tank from '../tanks/tank.js';
import Camera from './camera.js';
import { getImage } from './img.js';

let TANK_BODY: HTMLCanvasElement | undefined | null = null;
let TANK_TURRET: HTMLCanvasElement | undefined | null = null;

(async () => {
    if (typeof Image === 'undefined') return; // Server side, Image doesn't exist

    TANK_BODY = await getImage('/tanks/img/tank-body.png', TANK_SIZE, TANK_SIZE);
    TANK_TURRET = await getImage('/tanks/img/tank-turret.png', TANK_TURRET_SIZE, TANK_TURRET_SIZE);
})();

export default function drawTank(tank: Tank, camera: Camera) {
    if (!TANK_BODY || !TANK_TURRET) return; // Image hasn't loaded yet

    // Tank position x, y is center of the tank
    camera.drawImageRotated(TANK_BODY, tank.position.x, tank.position.y, tank.realBaseRotation);
    camera.drawImageRotated(TANK_TURRET, tank.position.x, tank.position.y, tank.visualTurretRotation);
}
