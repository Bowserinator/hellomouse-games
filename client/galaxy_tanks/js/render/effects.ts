import type * as T from 'three';
import { DEATH_EXPLOSION, GLOW_MASK_ALPHA, MAX_DEATH_EXPLOSIONS } from '../vars.js';
import { V3, tangentBasis } from '../sim/math/vec3.js';
import { commitInstances, streamInstances } from './geometry.js';

export class Effects {
    root = new THREE.Group();
    private capacity: number;
    private data: Float32Array;
    private free: Array<number> = [];
    private active: Array<number> = [];
    private bursts = Array.from({ length: MAX_DEATH_EXPLOSIONS }, () => ({
        pos: new THREE.Vector3(), up: new THREE.Vector3(), tint: new THREE.Color(),
        start: -Infinity, duration: 1, radius: 1
    }));
    private nextBurst = 0;
    private voxels: T.InstancedMesh;
    private fireballs: T.InstancedMesh<T.SphereGeometry, T.ShaderMaterial>;
    private dummy = new THREE.Object3D();
    private radial = new THREE.Vector3(0, 1, 0);
    private color = new THREE.Color();
    constructor(low: boolean) {
        this.capacity = low ? 480 : 1200;
        this.data = new Float32Array(this.capacity * 17);
        for (let i = this.capacity - 1; i >= 0; i--) this.free.push(i);
        this.voxels = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshBasicMaterial(), this.capacity);
        const geometry = new THREE.SphereGeometry(1, low ? 16 : 24, low ? 12 : 16);
        geometry.setAttribute('aProgress', new THREE.InstancedBufferAttribute(new Float32Array(MAX_DEATH_EXPLOSIONS), 1));
        this.fireballs = new THREE.InstancedMesh(geometry, new THREE.ShaderMaterial({
            vertexShader: `attribute float aProgress;varying float vT;varying vec3 vP,vColor,vN;
                void main(){vT=aProgress;vP=position;vColor=instanceColor;vN=normal;
                    gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
            fragmentShader: `varying float vT;varying vec3 vP,vColor,vN;
                void main(){float bands=sin(vP.y*48.+sin(vP.x*4.+vP.z*3.+vT*6.)*.8-vT*10.);
                    float gaps=smoothstep(.1,1.,vT);
                    vec3 p=vP*vec3(18.,58.,18.);
                    float chunks=sin(p.x+sin(p.y*1.7+vT*5.))*sin(p.z+sin(p.x*1.3-vT*8.))
                        *sin(p.y+sin(p.z*1.9+vT*6.));
                    if(chunks > 1.01-gaps*1.49)discard;
                    float cooling=clamp(vT*(1.+bands*.18),0.,1.);
                    vec3 flame=mix(vec3(1.,.88,.16),vec3(1.,.22,.015),cooling);
                    vec3 c=mix(vec3(1.),flame,smoothstep(0.,.6,cooling));
                    c=mix(c,vColor,vT*.04);
                    float glow=1.-smoothstep(.2,1.,vT);
                    gl_FragColor=vec4(c,1.-${(1 - GLOW_MASK_ALPHA).toFixed(3)}*glow);}`
        }), MAX_DEATH_EXPLOSIONS);
        this.fireballs.setColorAt(0, this.color.set(0xffffff));
        this.voxels.setColorAt(0, this.color);
        streamInstances(this.voxels);
        this.fireballs.count = this.voxels.count = 0;
        this.voxels.frustumCulled = this.fireballs.frustumCulled = false;
        this.root.add(this.voxels, this.fireballs);
    }
    get exploding(): boolean {
        return this.fireballs.count > 0;
    }
    private particle(pos: V3, up: V3, now: number, strength: number, tint?: T.Color, outward = false,
        velocity?: V3): void {
        const slot = this.free.pop();
        if (slot === undefined) return;
        this.active.push(slot);
        const n = slot * 17, d = this.data;
        d[n] = pos.x;
        d[n + 1] = pos.y;
        d[n + 2] = pos.z;
        const impulse = outward ? strength * 2 : -3 * strength;
        d[n + 3] = velocity ? velocity.x : (Math.random() - .5) * 6 * strength + up.x * impulse;
        d[n + 4] = velocity ? velocity.y : (Math.random() - .5) * 6 * strength + up.y * impulse;
        d[n + 5] = velocity ? velocity.z : (Math.random() - .5) * 6 * strength + up.z * impulse;
        // Particles with a set velocity ignore gravity so they travel flat along the ground
        d[n + 6] = velocity ? 0 : up.x;
        d[n + 7] = velocity ? 0 : up.y;
        d[n + 8] = velocity ? 0 : up.z;
        // Relative times avoid millisecond precision loss in the Float32 pool.
        d[n + 9] = 0;
        d[n + 10] = .35 + Math.random() * .55;
        d[n + 11] = (.08 + Math.random() * .12) * strength;
        d[n + 12] = tint?.r ?? 1;
        d[n + 13] = tint?.g ?? .55;
        d[n + 14] = tint?.b ?? .06;
        d[n + 15] = now % 1000;
        d[n + 16] = outward ? 1 : 0;
    }
    emit(pos: T.Vector3, up: T.Vector3, now: number, strength = 1): void {
        this.particle(pos, up, now, strength);
    }
    sparks(pos: V3, up: V3, tint: T.Color, now: number, count = 16, strength = 1): void {
        for (let i = 0; i < count; i++) this.particle(pos, up, now, strength, tint, true);
    }
    shockwave(pos: V3, up: V3, tint: T.Color, now: number, speeds = [7, 11], count = 36): void {
        const [axis, side] = tangentBasis(up), velocity = { x: 0, y: 0, z: 0 };
        for (const speed of speeds)
            for (let i = 0; i < count; i++) {
                const angle = (i + Math.random() * .5) / count * Math.PI * 2;
                const c = Math.cos(angle) * speed, s = Math.sin(angle) * speed;
                velocity.x = axis.x * c + side.x * s;
                velocity.y = axis.y * c + side.y * s;
                velocity.z = axis.z * c + side.z * s;
                this.particle(pos, up, now, 2, tint, true, velocity);
            }
    }
    death(pos: V3, up: V3, tint: T.Color, now: number,
        opts: { radius?: number; durationMs?: number; chunks?: number } = {}): void {
        const burst = this.bursts[this.nextBurst++ % MAX_DEATH_EXPLOSIONS];
        burst.pos.set(pos.x, pos.y, pos.z);
        burst.up.set(up.x, up.y, up.z).normalize();
        burst.tint.copy(tint);
        burst.start = now;
        burst.duration = (opts.durationMs ?? DEATH_EXPLOSION.DURATION_MS) * 1.4;
        burst.radius = opts.radius ?? DEATH_EXPLOSION.RADIUS;
        this.sparks(pos, up, tint, now, opts.chunks ?? DEATH_EXPLOSION.VOXEL_CHUNKS, burst.radius * .65);
    }
    update(dt: number, now: number): void {
        const d = this.data;
        for (let i = this.active.length - 1; i >= 0; i--) {
            const slot = this.active[i], n = slot * 17;
            d[n + 9] += dt;
            if (d[n + 9] >= d[n + 10]) {
                this.free.push(slot);
                this.active[i] = this.active[this.active.length - 1];
                this.active.pop();
            }
        }
        for (let i = 0; i < this.active.length; i++) {
            const n = this.active[i] * 17, age = d[n + 9] / d[n + 10];
            for (let j = 0; j < 3; j++) {
                d[n + 3 + j] -= d[n + 6 + j] * 6 * dt;
                d[n + j] += d[n + 3 + j] * dt;
            }
            this.dummy.position.set(d[n], d[n + 1], d[n + 2]);
            this.dummy.rotation.set(age * 9, age * 5, age * 3);
            this.dummy.scale.setScalar(d[n + 11] * (1 - age));
            this.dummy.updateMatrix();
            this.voxels.setMatrixAt(i, this.dummy.matrix);
            this.color.setRGB(d[n + 12], d[n + 13], d[n + 14]).multiplyScalar(1 - age * .65);
            this.voxels.setColorAt(i, this.color);
        }
        this.voxels.count = this.active.length;
        commitInstances(this.voxels);
        const progress = this.fireballs.geometry.getAttribute('aProgress') as T.InstancedBufferAttribute;
        let count = 0;
        for (const b of this.bursts) {
            const t = Math.max(0, (now - b.start) / b.duration);
            if (t >= 1) continue;
            this.dummy.position.copy(b.pos);
            this.dummy.quaternion.setFromUnitVectors(this.radial, b.up);
            this.dummy.scale.setScalar(b.radius * (.12 + .88 * (1 - (1 - t) ** 2)));
            this.dummy.updateMatrix();
            this.fireballs.setMatrixAt(count, this.dummy.matrix);
            this.fireballs.setColorAt(count, b.tint);
            progress.setX(count++, t);
        }
        this.fireballs.count = count;
        progress.needsUpdate = true;
        this.fireballs.instanceMatrix.needsUpdate = true;
        if (this.fireballs.instanceColor) this.fireballs.instanceColor.needsUpdate = true;
    }
    clear(): void {
        this.active.length = this.free.length = 0;
        for (let i = this.capacity - 1; i >= 0; i--) this.free.push(i);
        this.bursts.forEach(b => {
            b.start = -Infinity;
        });
        this.voxels.count = this.fireballs.count = 0;
    }
    dispose(): void {
        this.voxels.geometry.dispose();
        (this.voxels.material as T.Material).dispose();
        this.fireballs.geometry.dispose();
        this.fireballs.material.dispose();
    }
}
