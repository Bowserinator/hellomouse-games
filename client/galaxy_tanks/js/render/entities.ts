import type * as T from 'three';
import { Bullet, BULLETS, PowerupItem, isStrike, shockwaveArc, strikeAltitude } from '../sim/bullet.js';
import { Tank } from '../sim/tank.js';
import { World } from '../sim/world/planet.js';
import { BulletType, TankState } from '../types.js';
import { POWERUPS } from '../sim/powerups.js';
import { makePalette } from './tank/tank-rig.js';
import { V3, vec } from '../sim/math/vec3.js';
import { commitInstances, disposeTree, mergeGeometry, streamInstances } from './geometry.js';
import { BULLET_OUTLINE_PX, CHRONO_RADIUS, CHRONO_RING, ITEM_FLOAT_HEIGHT, LANDMINE_ARMED_COLOR,
    LANDMINE_ARM_TIME, LANDMINE_FLASH_PERIOD, MAGNET_ARM_TIME, MAGNET_TRACK_WIDTH, MAX_PLAYERS,
    MAX_POWERUP_ITEMS, SEISMIC_MAX_ACTIVE, SEISMIC_RING, TANK_COLORS } from '../vars.js';
import { RingLines } from './ring-lines.js';
import { magnetTarget } from '../sim/targeting.js';
import { angDist, slerpDir } from '../sim/math/sphere.js';
const ATLAS_SLOTS = Object.keys(POWERUPS).length, METEOR_TINT = 0xff6a1a;
export class Entities {
    root = new THREE.Group();
    private bullets = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial(), 512);
    private outlines: T.InstancedMesh<T.SphereGeometry, T.ShaderMaterial>;
    private shadows: T.InstancedMesh<T.PlaneGeometry, T.ShaderMaterial>;
    private fuses = new THREE.InstancedMesh(new THREE.CylinderGeometry(.07, .07, .3, 6),
        new THREE.MeshBasicMaterial({ color: 0x37302c }), 512);
    private lights = new THREE.InstancedMesh(new THREE.SphereGeometry(.14, 6, 4),
        new THREE.MeshBasicMaterial(), 512);
    private tracks = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: .95,
            blending: THREE.AdditiveBlending, depthWrite: false }), 2048);
    private trackGlow = new THREE.InstancedMesh(this.tracks.geometry,
        new THREE.MeshBasicMaterial({ transparent: true, opacity: .22,
            blending: THREE.AdditiveBlending, depthWrite: false }), 2048);
    private chronoFields = new RingLines(CHRONO_RING.COLOR, CHRONO_RING.OPACITY, MAX_PLAYERS);
    private shockwaves = new RingLines(SEISMIC_RING.COLOR, SEISMIC_RING.OPACITY, MAX_PLAYERS * SEISMIC_MAX_ACTIVE);
    private itemMeshes = new Map<number, T.InstancedMesh>();
    private streamed: Array<T.InstancedMesh> = [];
    private disposed = false;
    private atlas: T.CanvasTexture;
    private dummy = new THREE.Object3D();
    private pos = vec();
    private axis = new THREE.Vector3(0, 0, 1);
    private up = new THREE.Vector3();
    private radial = new THREE.Vector3(0, 1, 0);
    private start = new THREE.Vector3();
    private end = new THREE.Vector3();
    private direction = vec();
    private tint = new THREE.Color();
    private red = new THREE.Color(0xff1717);
    private inactiveRed = new THREE.Color(0x4d0505);
    private colors = TANK_COLORS.map((_, color) => makePalette(color)[0]);
    constructor() {
        this.bullets.setColorAt(0, new THREE.Color(0xffffff));
        this.tracks.setColorAt(0, new THREE.Color(0xffffff));
        this.trackGlow.setColorAt(0, new THREE.Color(0xffffff));
        this.lights.setColorAt(0, new THREE.Color(0xffffff));
        const canvas = document.createElement('canvas');
        canvas.width = ATLAS_SLOTS * 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d')!;
        this.atlas = new THREE.CanvasTexture(canvas);
        const material = new THREE.MeshBasicMaterial({ map: this.atlas, vertexColors: true, alphaTest: .15 });
        for (const [key, p] of Object.entries(POWERUPS)) {
            if (!p.icon) continue;
            const mesh = new THREE.InstancedMesh(new THREE.BufferGeometry(), material, MAX_POWERUP_ITEMS);
            mesh.count = 0;
            mesh.frustumCulled = false;
            this.root.add(mesh);
            this.itemMeshes.set(Number(key), mesh);
            const img = new Image();
            img.onload = () => {
                if (this.disposed) return;
                ctx.drawImage(img, Number(key) * 64, 0, 64, 64);
                this.atlas.needsUpdate = true;
                mesh.geometry.dispose();
                mesh.geometry = this.pickupGeometry(img, Number(key));
            };
            img.src = `/tanks/img/items/${p.icon}.png`;
        }
        this.root.add(this.chronoFields.mesh, this.shockwaves.mesh);
        this.outlines = new THREE.InstancedMesh(this.bullets.geometry, new THREE.ShaderMaterial({
            side: THREE.BackSide, uniforms: { uOutline: { value: new THREE.Vector2() } },
            vertexShader: `uniform vec2 uOutline;
                void main(){mat4 m=modelViewMatrix*instanceMatrix;vec4 p=projectionMatrix*m*vec4(position,1.);
                vec2 d=(projectionMatrix*vec4(mat3(m)*normal,0.)).xy;
                if(length(d)>1e-4)p.xy+=normalize(d)*uOutline*p.w;
                gl_Position=p;}`,
            fragmentShader: 'void main(){gl_FragColor=vec4(1.);}'
        }), 512);
        const shadowGeometry = new THREE.PlaneGeometry(2, 2);
        shadowGeometry.setAttribute('aWarning', new THREE.InstancedBufferAttribute(new Float32Array(64), 1));
        this.shadows = new THREE.InstancedMesh(shadowGeometry, new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, side: THREE.DoubleSide,
            vertexShader: `attribute float aWarning;varying float vWarning;varying vec2 vUv;
                void main(){vUv=uv;vWarning=aWarning;
                gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
            fragmentShader: `varying float vWarning;varying vec2 vUv;void main(){float r=length(vUv-.5)*2.;
                float blob=.33*exp(-r*r*4.)*(1.-smoothstep(.7,1.,r));
                float ring=(1.-smoothstep(.03,.08,abs(r-.88)))*.85;
                gl_FragColor=vec4(mix(vec3(0.,.01,.03),vec3(1.,.16,.03),vWarning),mix(blob,ring,vWarning));}`
        }), 64);
        for (const mesh of [this.bullets, this.outlines, this.shadows, this.fuses, this.lights,
            this.tracks, this.trackGlow]) {
            mesh.count = 0;
            mesh.frustumCulled = false;
            this.root.add(mesh);
            if (mesh === this.shadows) continue;
            streamInstances(mesh);
            this.streamed.push(mesh);
        }
    }
    setViewport(width: number, height: number): void {
        this.outlines.material.uniforms.uOutline.value.set(
            2 * BULLET_OUTLINE_PX / width, 2 * BULLET_OUTLINE_PX / height);
    }
    update(bullets: Array<Bullet>, items: Array<PowerupItem>, tanks: Array<Tank>, world: World,
        now: number): void {
        let bi = 0, si = 0;
        this.fuses.count = this.lights.count = this.tracks.count = this.trackGlow.count = 0;
        this.chronoFields.begin();
        this.shockwaves.begin();
        for (let i = 0; i < Math.min(bullets.length, 512); i++) {
            const b = bullets[i];
            if (b.type === BulletType.SEISMIC) {
                this.shockwaves.add(world, b.planet, b.dir, shockwaveArc(b), b.altitude, SEISMIC_RING.THICKNESS);
                continue;
            }
            const altitude = isStrike(b.type) ? strikeAltitude(b) : b.altitude;
            world.position(b.planet, b.dir, altitude, this.pos);
            this.dummy.position.set(this.pos.x, this.pos.y, this.pos.z);
            this.dummy.quaternion.identity();
            const size = b.type === BulletType.METEOR ? 1.3 : b.type === BulletType.ROCKET ? 0.65 : BULLETS[b.type].radius;
            if (b.type === BulletType.FAST) {
                this.up.set(b.vel.x, b.vel.y, b.vel.z).normalize();
                this.dummy.quaternion.setFromUnitVectors(this.axis, this.up);
                this.dummy.scale.set(size, size, 1.6);
            } else this.dummy.scale.setScalar(size);
            this.dummy.updateMatrix();
            this.tint.copy(this.colors[b.color]);
            if (b.type === BulletType.MAGNET) this.tint.multiplyScalar(.35);
            if (b.type === BulletType.METEOR) this.tint.setHex(METEOR_TINT);
            if (b.type === BulletType.BOMB && b.age % .45 < .2) this.tint.copy(this.red);
            if (b.type === BulletType.LANDMINE &&
                (b.age < LANDMINE_ARM_TIME || Math.floor(b.age / LANDMINE_FLASH_PERIOD) % 2))
                this.tint.setHex(LANDMINE_ARMED_COLOR);
            this.bullets.setMatrixAt(bi, this.dummy.matrix);
            this.outlines.setMatrixAt(bi, this.dummy.matrix);
            this.bullets.setColorAt(bi++, this.tint);
            if (b.type === BulletType.MAGNET || b.type === BulletType.BOMB) this.bombDetails(b);
            if (b.type === BulletType.MAGNET) this.magnetTrack(b, tanks, world);
            if (b.type === BulletType.ROCKET) this.shadow(world, b.planet, b.dir, 3.5, si++, true);
            if (b.type === BulletType.METEOR) {
                const growth = Math.min(1, b.age / BULLETS[b.type].life);
                this.shadow(world, b.planet, b.dir, BULLETS[b.type].radius / .88 * Math.max(.02, growth), si++, true);
            }
        }
        this.bullets.count = this.outlines.count = bi;
        this.trackGlow.count = this.tracks.count;
        this.streamed.forEach(commitInstances);
        this.itemMeshes.forEach(mesh => {
            mesh.count = 0;
        });
        for (let i = 0; i < Math.min(items.length, MAX_POWERUP_ITEMS); i++) {
            const item = items[i], mesh = this.itemMeshes.get(item.powerup);
            if (!mesh) continue;
            world.position(item.planet, item.dir, ITEM_FLOAT_HEIGHT + Math.sin(now / 400 + item.id) * 0.2, this.pos);
            this.dummy.position.set(this.pos.x, this.pos.y, this.pos.z);
            this.up.set(item.dir.x, item.dir.y, item.dir.z);
            this.dummy.quaternion.setFromUnitVectors(this.radial, this.up);
            this.dummy.rotateY(now / 1000 * 1.35 + item.id);
            this.dummy.scale.setScalar(1);
            this.dummy.updateMatrix();
            mesh.setMatrixAt(mesh.count++, this.dummy.matrix);
            this.shadow(world, item.planet, item.dir, 1.5, si++);
        }
        this.itemMeshes.forEach(commitInstances);
        for (const tank of tanks)
            if (!tank.isDead && tank.stealth <= 0 && tank.state !== TankState.FLYING && si < 64)
                this.shadow(world, tank.planet, tank.dir, 1.7, si++);
        for (const tank of tanks)
            if (tank.chrono > 0 && !tank.isDead && tank.state !== TankState.FLYING &&
                tank.state !== TankState.FALLING && (tank.chrono > 1 || Math.floor(now / 80) % 2 === 0))
                this.chronoFields.add(world, tank.planet, tank.dir, CHRONO_RADIUS, tank.h + 0.15,
                    CHRONO_RING.THICKNESS);
        this.chronoFields.commit();
        this.shockwaves.commit();
        this.shadows.count = Math.min(si, 64);
        this.shadows.instanceMatrix.needsUpdate = true;
        this.shadows.geometry.getAttribute('aWarning').needsUpdate = true;
    }
    private bombDetails(bullet: Bullet): void {
        const size = BULLETS[bullet.type].radius;
        this.up.set(bullet.dir.x, bullet.dir.y, bullet.dir.z);
        this.dummy.position.set(this.pos.x, this.pos.y, this.pos.z).addScaledVector(this.up, size + .1);
        this.dummy.quaternion.setFromUnitVectors(this.radial, this.up);
        this.dummy.scale.setScalar(1);
        this.dummy.updateMatrix();
        this.fuses.setMatrixAt(this.fuses.count++, this.dummy.matrix);
        this.dummy.position.addScaledVector(this.up, .17);
        const inactive = bullet.type === BulletType.MAGNET && bullet.age < MAGNET_ARM_TIME;
        const period = bullet.type === BulletType.BOMB ? .45 : .35;
        this.dummy.scale.setScalar(inactive ? 1 : bullet.age % period < .12 ? 1.4 : .3);
        this.dummy.updateMatrix();
        this.lights.setMatrixAt(this.lights.count, this.dummy.matrix);
        this.lights.setColorAt(this.lights.count++, inactive ? this.inactiveRed : this.red);
    }
    private magnetTrack(bullet: Bullet, tanks: Array<Tank>, world: World): void {
        const target = magnetTarget(bullet, tanks);
        if (!target) return;
        const radius = world.desc.planets[bullet.planet].radius;
        const steps = Math.max(1, Math.ceil(angDist(bullet.dir, target.dir) * (radius + bullet.altitude) / 2));
        world.position(bullet.planet, bullet.dir, bullet.altitude, this.pos);
        this.start.set(this.pos.x, this.pos.y, this.pos.z);
        for (let i = 1; i <= steps && this.tracks.count < 2048; i++) {
            const t = i / steps;
            slerpDir(this.direction, bullet.dir, target.dir, t);
            world.position(bullet.planet, this.direction, bullet.altitude * (1 - t) + (target.h + 1.1) * t, this.pos);
            this.end.set(this.pos.x, this.pos.y, this.pos.z);
            this.up.subVectors(this.end, this.start);
            const length = this.up.length();
            if (length > .001) {
                this.dummy.position.copy(this.start).add(this.end).multiplyScalar(.5);
                this.dummy.quaternion.setFromUnitVectors(this.radial, this.up.divideScalar(length));
                this.dummy.scale.set(MAGNET_TRACK_WIDTH, length, MAGNET_TRACK_WIDTH);
                this.dummy.updateMatrix();
                this.tracks.setMatrixAt(this.tracks.count, this.dummy.matrix);
                this.tracks.setColorAt(this.tracks.count, this.colors[target.color]);
                this.dummy.scale.x *= 3.5;
                this.dummy.scale.z *= 3.5;
                this.dummy.updateMatrix();
                this.trackGlow.setMatrixAt(this.tracks.count, this.dummy.matrix);
                this.trackGlow.setColorAt(this.tracks.count++, this.colors[target.color]);
            }
            this.start.copy(this.end);
        }
    }
    private pickupGeometry(image: HTMLImageElement, icon: number): T.BufferGeometry {
        const mask = document.createElement('canvas');
        mask.width = mask.height = 16;
        const ctx = mask.getContext('2d')!;
        ctx.drawImage(image, 0, 0, 16, 16);
        const pixels = ctx.getImageData(0, 0, 16, 16).data, parts: Array<T.BufferGeometry> = [];
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
            if (pixels[(y * 16 + x) * 4 + 3] < 100) continue;
            const g = new THREE.BoxGeometry(2.2 / 16, 2.2 / 16, .55);
            g.translate(((x + .5) / 16 - .5) * 2.2, (.5 - (y + .5) / 16) * 2.2, 0);
            const pos = g.getAttribute('position'), uv = g.getAttribute('uv'), colors = new Float32Array(pos.count * 3);
            for (let j = 0; j < pos.count; j++) {
                const face = j >= 16, u = face ? pos.getX(j) / 2.2 + .5 : (x + .5) / 16;
                const v = face ? pos.getY(j) / 2.2 + .5 : 1 - (y + .5) / 16;
                uv.setXY(j, (icon + u) / ATLAS_SLOTS, v);
                colors.fill(face ? 1 : .6, j * 3, j * 3 + 3);
            }
            g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            parts.push(g);
        }
        return mergeGeometry(parts);
    }
    private shadow(world: World, planet: number, dir: V3, size: number, i: number, warning = false): void {
        if (i >= 64) return;
        (this.shadows.geometry.getAttribute('aWarning') as T.InstancedBufferAttribute).setX(i, warning ? 1 : 0);
        if (!world.fields[planet].isSolid(dir)) {
            this.dummy.scale.setScalar(0);
            this.dummy.updateMatrix();
            this.shadows.setMatrixAt(i, this.dummy.matrix);
            return;
        }
        const h = world.colliders.supportHeight(planet, dir, 0.1);
        world.position(planet, dir, h + 0.045, this.pos);
        this.dummy.position.set(this.pos.x, this.pos.y, this.pos.z);
        this.up.set(dir.x, dir.y, dir.z);
        this.dummy.quaternion.setFromUnitVectors(this.axis, this.up);
        this.dummy.scale.setScalar(size);
        this.dummy.updateMatrix();
        this.shadows.setMatrixAt(i, this.dummy.matrix);
    }
    dispose(): void {
        this.disposed = true;
        disposeTree(this.root);
    }
}
