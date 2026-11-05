import { BulletType, Powerup, TankState } from '../types.js';
import { BULLETS } from '../sim/bullet.js';
import { CROSS_FIRE_ANGLES, POWERUPS } from '../sim/powerups.js';
import { advance } from '../sim/math/sphere.js';
import { copy, reflect, reproject, rotate, scale, vec } from '../sim/math/vec3.js';
import { nearestTarget, rocketTargets } from '../sim/targeting.js';
import { Tank } from '../sim/tank.js';
import { World } from '../sim/world/planet.js';
import { MUZZLE_H, MUZZLE_OFFSET } from '../vars.js';
import { disposeTree } from './geometry.js';
import { makePalette } from './tank/tank-rig.js';

export class AimPreview {
    root = new THREE.Group();
    private cubes = new THREE.InstancedMesh(new THREE.BoxGeometry(.2, .2, .2),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: .65 }), 180);
    private rings = new THREE.InstancedMesh(new THREE.RingGeometry(3.2, 3.5, 40),
        new THREE.MeshBasicMaterial({ color: 0xff3c18, side: THREE.DoubleSide,
            transparent: true, opacity: .8, depthWrite: false }), 3);
    private dummy = new THREE.Object3D();
    private pos = vec();
    private dir = vec();
    private vel = vec();
    private previous = vec();
    private normal = vec();
    private axis = new THREE.Vector3(0, 0, 1);
    private up = new THREE.Vector3();
    private start = new THREE.Vector3();
    private end = new THREE.Vector3();
    private side = new THREE.Vector3();
    private previewColor = new THREE.Color(0xffe4a0);
    constructor() {
        this.cubes.setColorAt(0, this.previewColor);
        this.cubes.count = this.rings.count = 0;
        this.cubes.frustumCulled = this.rings.frustumCulled = false;
        this.root.add(this.cubes, this.rings);
    }
    update(tank: Tank | undefined, tanks: Array<Tank>, world: World, now: number): void {
        this.cubes.count = this.rings.count = 0;
        if (!tank || tank.isDead || tank.state === TankState.FLYING || tank.state === TankState.FALLING) return;
        if (tank.bulletPowerup === Powerup.ROCKET) {
            for (const target of rocketTargets(tank, tanks, world)) {
                world.position(target.planet, target.dir, .1, this.pos);
                this.dummy.position.set(this.pos.x, this.pos.y, this.pos.z);
                this.up.set(target.dir.x, target.dir.y, target.dir.z);
                this.dummy.quaternion.setFromUnitVectors(this.axis, this.up);
                this.dummy.scale.setScalar(1);
                this.dummy.updateMatrix();
                this.rings.setMatrixAt(this.rings.count++, this.dummy.matrix);
            }
            this.rings.instanceMatrix.needsUpdate = true;
            return;
        }
        if (tank.bulletPowerup === Powerup.METEOR_RAIN) return;
        if (tank.bulletPowerup === Powerup.TELEPORT) {
            const target = nearestTarget(tank, tanks, world);
            if (!target) return;
            world.position(tank.planet, tank.dir, tank.h + 1, this.pos);
            this.start.set(this.pos.x, this.pos.y, this.pos.z);
            world.position(target.planet, target.dir, target.h + 1, this.pos);
            this.end.set(this.pos.x, this.pos.y, this.pos.z);
            this.up.set(tank.dir.x, tank.dir.y, tank.dir.z);
            this.side.subVectors(this.end, this.start).cross(this.up);
            if (this.side.lengthSq() < .001) this.side.crossVectors(this.up, this.axis);
            if (this.side.lengthSq() < .001) this.side.set(1, 0, 0);
            this.side.normalize();
            const height = Math.min(12, this.start.distanceTo(this.end) * .2);
            const colors = [makePalette(tank.color)[0], makePalette(target.color)[0]];
            for (let lane = 0; lane < 2; lane++) for (let i = 0; i < 24; i++) {
                const progress = (i / 24 + now / 1800) % 1, t = lane ? 1 - progress : progress;
                this.dummy.position.lerpVectors(this.start, this.end, t).addScaledVector(this.side, lane ? -.6 : .6);
                this.dummy.position.y += Math.sin(t * Math.PI) * height;
                this.dummy.quaternion.identity();
                this.dummy.scale.setScalar(1);
                this.dummy.updateMatrix();
                this.cubes.setMatrixAt(this.cubes.count, this.dummy.matrix);
                this.cubes.setColorAt(this.cubes.count++, colors[lane]);
            }
        } else {
            const type = POWERUPS[tank.bulletPowerup].bullet, config = BULLETS[type];
            const spread = 14 * Math.PI / 180;
            const angles = tank.bulletPowerup === Powerup.SHOTGUN ? [-spread, 0, spread]
                : tank.bulletPowerup === Powerup.CROSS_FIRE ? CROSS_FIRE_ANGLES : [0];
            const altitude = tank.h + MUZZLE_H, radius = world.desc.planets[tank.planet].radius;
            for (const angle of angles) {
                copy(this.dir, tank.dir);
                rotate(this.vel, tank.aim, tank.dir, angle);
                scale(this.vel, this.vel, MUZZLE_OFFSET);
                advance(this.dir, this.vel, 1, radius + altitude);
                const speed = type === BulletType.LASER ? 40 : config.speed;
                scale(this.vel, this.vel, speed / MUZZLE_OFFSET);
                for (let i = 0; i < 6; i++) {
                    copy(this.previous, this.dir);
                    advance(this.dir, this.vel, 1.2 / speed, radius + altitude);
                    const stopsAtWall = type === BulletType.FAST;
                    const wall = world.colliders.raycastAltitude(tank.planet, this.previous, this.dir, altitude,
                        config.radius, stopsAtWall ? undefined : this.normal);
                    if (wall !== null) {
                        if (stopsAtWall) break;
                        advance(this.dir, this.vel, -(1 - wall) * 1.2 / speed, radius + altitude);
                        reproject(this.normal, this.normal, this.dir);
                        reflect(this.vel, this.vel, this.normal);
                    }
                    world.position(tank.planet, this.dir, altitude, this.pos);
                    this.dummy.position.set(this.pos.x, this.pos.y, this.pos.z);
                    this.dummy.quaternion.identity();
                    this.dummy.scale.setScalar(1 - i / 12);
                    this.dummy.updateMatrix();
                    this.cubes.setMatrixAt(this.cubes.count, this.dummy.matrix);
                    this.cubes.setColorAt(this.cubes.count++, this.previewColor);
                }
            }
        }
        this.cubes.instanceMatrix.needsUpdate = true;
        if (this.cubes.instanceColor) this.cubes.instanceColor.needsUpdate = true;
    }
    dispose(): void {
        disposeTree(this.root);
    }
}
