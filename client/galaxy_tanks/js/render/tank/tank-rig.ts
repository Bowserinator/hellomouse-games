import type * as T from 'three';
import { Tank } from '../../sim/tank.js';
import { Powerup, TankState } from '../../types.js';
import { FALL_SPEED, STAR_HOLD_MS, STAR_INSIDE_SPIN, STAR_SPIN_RATE, TANK_COLORS } from '../../vars.js';
import { World } from '../../sim/world/planet.js';
import { copy, vec } from '../../sim/math/vec3.js';
import { mergeGeometry } from '../geometry.js';
import { ColorSlot, DEFAULT_TANK_STYLE as STYLE, PartDef } from './tank-style.js';

import { angDist, slerpDir } from '../../sim/math/sphere.js';

const cache = new Map<string, T.BufferGeometry>();
export function buildParts(parts: Array<PartDef>): T.BufferGeometry {
    return mergeGeometry(parts.map(p => {
        let g: T.BufferGeometry;
        if (p.shape === 'ring') g = new THREE.TorusGeometry(p.size[0], p.size[1], 6, 16);
        else if (p.shape === 'cylinder') g = new THREE.CylinderGeometry(p.size[0], p.size[2], p.size[1], 10);
        else g = new THREE.BoxGeometry(...p.size);
        if (p.rotation) {
            g.rotateX(p.rotation[0]);
            g.rotateY(p.rotation[1]);
            g.rotateZ(p.rotation[2]);
        }
        g.translate(...p.position);
        const count = g.getAttribute('position').count;
        g.setAttribute('aSlot', new THREE.Float32BufferAttribute(new Float32Array(count).fill(p.color.slot), 1));
        g.setAttribute('aBlend', new THREE.Float32BufferAttribute(new Float32Array(count).fill(p.color.blend ?? 0), 1));
        for (const [name, hex] of [['aNeutral', p.color.neutral ?? 0], ['aFixed', p.color.fixed ?? 0]] as const) {
            const c = new THREE.Color(hex), array = new Float32Array(count * 3);
            for (let i = 0; i < count; i++) array.set([c.r, c.g, c.b], i * 3);
            g.setAttribute(name, new THREE.Float32BufferAttribute(array, 3));
        }
        return g;
    }));
}
function geometry(key: string, parts: Array<PartDef>): T.BufferGeometry {
    if (!cache.has(key)) cache.set(key, buildParts(parts));
    return cache.get(key)!;
}
export function makePalette(color: number): Array<T.Color> {
    const rgb = TANK_COLORS[color] ?? [255, 255, 255];
    const primary = new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
    return [primary, primary.clone().multiplyScalar(STYLE.palette.secondary),
        primary.clone().lerp(new THREE.Color(0xffffff), STYLE.palette.accent),
        new THREE.Color(0x252a32), new THREE.Color(0xa0a7b5), primary.clone().lerp(new THREE.Color(0xffffff), 0.65),
        new THREE.Color(0xffffff)];
}
export class TankRig {
    root = new THREE.Group();
    turretPivot = new THREE.Group();
    private body = new THREE.Group();
    private shieldHitAt = -Infinity;
    material: T.ShaderMaterial;
    shield: T.Mesh<T.SphereGeometry, T.ShaderMaterial>;
    private turrets = new Map<Powerup, T.Mesh>();
    private matrix = new THREE.Matrix4();
    private right = new THREE.Vector3();
    private forward = new THREE.Vector3();
    private up = new THREE.Vector3();
    private pos = vec();
    private color = -1;
    private displayDir = vec();
    private displayHeight = 0;
    private previousPlanet = -1;
    private lastFrame = 0;
    constructor() {
        // Custom shaders use the same authored sRGB-like palette as the planet shaders.
        this.material = new THREE.ShaderMaterial({
            uniforms: { uPalette: { value: makePalette(0) }, uCoverage: { value: 1 }, uPulse: { value: 0 } },
            vertexShader: `attribute float aSlot,aBlend; attribute vec3 aNeutral,aFixed;
                uniform vec3 uPalette[7]; varying vec3 vColor,vNormal;
                void main(){vec3 c=uPalette[0];
                    if(aSlot>.5)c=uPalette[1]; if(aSlot>1.5)c=uPalette[2]; if(aSlot>2.5)c=uPalette[3];
                    if(aSlot>3.5)c=uPalette[4]; if(aSlot>4.5)c=uPalette[5]; if(aSlot>5.5)c=aFixed;
                    vColor=mix(c,aNeutral,aBlend); vNormal=normalize(mat3(modelMatrix)*normal);
                    gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
            fragmentShader: `uniform float uCoverage,uPulse; varying vec3 vColor,vNormal;
                void main(){float d=mod(gl_FragCoord.x+mod(gl_FragCoord.y,4.)*2.,4.)/4.;
                    if(d>=uCoverage)discard;
                    float light=.4+.6*max(0.,dot(vNormal,normalize(vec3(-.4,.8,.5))));
                    gl_FragColor=vec4(vColor*light+uPulse*.3,1.);}`
        });
        this.root.add(this.body);
        this.body.add(new THREE.Mesh(geometry('base', STYLE.parts), this.material), this.turretPivot);
        for (const [key, turret] of Object.entries(STYLE.turret)) {
            const mesh = new THREE.Mesh(geometry(`turret-${key}`, turret.parts), this.material);
            this.turrets.set(Number(key), mesh);
            mesh.visible = false;
            this.turretPivot.add(mesh);
        }
        this.shield = new THREE.Mesh(new THREE.SphereGeometry(STYLE.hitRadius * 1.5, 24, 16),
            new THREE.ShaderMaterial({
                uniforms: { time: { value: 0 }, hit: { value: 0 }, tint: { value: new THREE.Color(0x77dfff) } },
                transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
                vertexShader: `varying vec3 vN,vV,vP; void main(){vN=normalize(normalMatrix*normal);vP=position;
                    vec4 p=modelViewMatrix*vec4(position,1.);vV=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,
                fragmentShader: `varying vec3 vN,vV,vP; uniform vec3 tint; uniform float time,hit;
                    void main(){float rim=pow(1.-abs(dot(normalize(vN),normalize(vV))),2.);
                    float cells=step(.92,abs(sin(vP.x*14.)*sin(vP.y*12.+vP.z*7.)));
                    float ripple=pow(max(0.,cos(length(vP.xz)*10.-hit*24.)),8.)*hit;
                    gl_FragColor=vec4(tint+vec3(ripple),
                        (rim*.65+cells*.15+ripple*.7)*(.9+.1*sin(time*10.)));}`
            }));
        this.shield.position.fromArray(STYLE.anchors.shieldCenter);
        this.body.add(this.shield);
    }
    sync(tank: Tank, world: World, own: boolean, now: number): void {
        const dt = Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
        this.lastFrame = now;
        const snap = own || this.previousPlanet !== tank.planet || tank.state === TankState.FLYING ||
            angDist(this.displayDir, tank.dir) > 0.5;
        const factor = snap ? 1 : 1 - Math.exp(-18 * dt);
        if (snap) copy(this.displayDir, tank.dir);
        else slerpDir(this.displayDir, this.displayDir, tank.dir, factor);
        this.displayHeight += (tank.h - this.displayHeight) * factor;
        this.previousPlanet = tank.planet;
        this.up.set(this.displayDir.x, this.displayDir.y, this.displayDir.z);
        this.forward.set(tank.fwd.x, tank.fwd.y, tank.fwd.z);
        if (tank.state === TankState.FLYING) {
            const star = world.stars[tank.flightStar], path = world.paths.get(star);
            if (path) {
                const up = vec(), fwd = vec();
                path.sample((now - tank.flightStart - STAR_HOLD_MS) / (path.duration * 1000), this.pos, up, fwd);
                if (now < tank.flightStart + STAR_HOLD_MS)
                    slerpDir(fwd, tank.fwd, fwd, THREE.MathUtils.smoothstep(now - tank.flightStart, 0, STAR_HOLD_MS));
                this.up.set(up.x, up.y, up.z);
                this.forward.set(fwd.x, fwd.y, fwd.z).projectOnPlane(this.up).normalize();
            }
        } else world.position(tank.planet, this.displayDir,
            tank.state === TankState.FALLING ? -tank.fallTime * FALL_SPEED : this.displayHeight, this.pos);
        this.root.position.set(this.pos.x, this.pos.y, this.pos.z);
        this.right.crossVectors(this.forward, this.up).normalize();
        this.forward.negate();
        this.matrix.makeBasis(this.right, this.up, this.forward);
        this.root.quaternion.setFromRotationMatrix(this.matrix);
        const path = tank.state === TankState.FLYING ? world.paths.get(world.stars[tank.flightStar]) : undefined;
        const elapsed = Math.max(0, now - tank.flightStart);
        const progress = path ? THREE.MathUtils.clamp((elapsed - STAR_HOLD_MS) / (path.duration * 1000), 0, 1) : 0;
        const release = 1 - THREE.MathUtils.smoothstep(progress, 0, .15);
        const heldPose = path ? THREE.MathUtils.smoothstep(elapsed, 0, STAR_HOLD_MS) * release : 0;
        const spin = path ? Math.min(elapsed, STAR_HOLD_MS) / 1000 * STAR_SPIN_RATE * STAR_INSIDE_SPIN * release : 0;
        this.body.rotation.set(Math.PI / 2 * heldPose, spin, progress * Math.PI * 4, 'YXZ');
        const aim = new THREE.Vector3(tank.aim.x, tank.aim.y, tank.aim.z);
        this.turretPivot.rotation.y = Math.atan2(-aim.dot(this.right), -aim.dot(this.forward)) * (1 - heldPose);
        this.turretPivot.position.z = Math.max(0, tank.fireCd - 0.12) * 1.5;
        this.root.visible = !tank.isDead && (tank.iFrames <= 0 || Math.floor(now / 100) % 2 === 0);
        this.root.scale.setScalar(tank.state === TankState.FALLING ? Math.max(0.05, 1 - tank.fallTime) : 1);
        const stealth = tank.stealth > 0 && (tank.stealth > 1 || Math.floor(now / 100) % 2 === 0);
        this.material.uniforms.uCoverage.value = stealth ? (own ? 0.25 : 0) : 1;
        this.material.uniforms.uPulse.value = tank.iFrames > 0 ? 0.5 + 0.5 * Math.sin(now / 80) : 0;
        if (this.color !== tank.color) {
            this.color = tank.color;
            this.material.uniforms.uPalette.value = makePalette(tank.color);
            this.shield.material.uniforms.tint.value.copy(makePalette(tank.color)[0])
                .lerp(new THREE.Color(0x77dfff), 0.5);
        }
        this.turrets.forEach((mesh, key) => {
            mesh.visible = key === tank.bulletPowerup || (key === Powerup.CHRONO_DAMPENER && tank.chrono > 0);
        });
        this.shield.visible = tank.shield > 0 && (tank.shield > 1 || Math.floor(now / 80) % 2 === 0);
        this.shield.material.uniforms.time.value = now / 1000;
        this.shield.material.uniforms.hit.value = Math.max(0, 1 - (now - this.shieldHitAt) / 500);
    }
    hitShield(now: number): void {
        if (now - this.shieldHitAt >= 500) this.shieldHitAt = now;
    }
    dispose(): void {
        this.material.dispose();
        this.shield.geometry.dispose();
        this.shield.material.dispose();
    }
}
export function disposeTankGeometries(): void {
    cache.forEach(g => g.dispose());
    cache.clear();
}
export { ColorSlot };
