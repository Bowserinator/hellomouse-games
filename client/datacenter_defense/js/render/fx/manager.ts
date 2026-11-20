import type * as T from 'three';
import { ParticlePool } from './particles.js';
import { EFFECTS } from './registry.js';

export class Effects {
    readonly additive = new ParticlePool(24576, true);
    readonly alpha = new ParticlePool(8192, false);
    readonly streak = new ParticlePool(8192, true);
    readonly rings: Array<{ x: number; z: number; radius: number; life: number; born: number; color: string }> = [];
    shakeEnabled = false;
    private shakeAmount = 0;
    private fade = 0;
    private quality = 1;
    private budget = 4096;
    private last = 0;
    constructor(scene: T.Scene) {
        scene.add(this.additive.mesh, this.alpha.mesh, this.streak.mesh);
    }
    trigger(name: string, point: T.Vector3, now: number) {
        const effect = EFFECTS.get(name); if (!effect || this.fade > 0.99) return;
        const tint = effect.palette?.[Math.floor(Math.random() * effect.palette.length)];
        for (const emit of effect.emit) {
            const count = Math.min(this.budget, Math.ceil(emit.count * this.quality)); this.budget -= count;
            for (let i = 0; i < count; i++) {
                const azimuth = Math.random() * Math.PI * 2, vertical = Math.random() * 2 - 1;
                const horizontal = Math.sqrt(Math.max(0, 1 - vertical * vertical));
                const speed = emit.speed * (emit.shell ? 0.92 + Math.random() * 0.08 : 0.3 + Math.random() * 0.7);
                this[emit.pool].emit({ x: point.x, y: point.y, z: point.z,
                    vx: Math.cos(azimuth) * horizontal * speed, vy: (vertical + (emit.up ?? 0)) * speed,
                    vz: Math.sin(azimuth) * horizontal * speed, life: emit.life, size: emit.size,
                    endSize: emit.endSize, color: emit.tinted && tint ? tint[0] : emit.color,
                    endColor: emit.tinted && tint ? tint[1] : emit.end, kind: emit.kind,
                    alpha: emit.alpha }, now + (emit.delay ?? 0));
            }
        }
        if (effect.ring) {
            if (this.rings.length >= 64) this.rings.shift();
            this.rings.push({ x: point.x, z: point.z, ...effect.ring, born: now });
        }
        this.shakeAmount = Math.min(0.5, this.shakeAmount + (effect.shake ?? 0));
    }
    trail(name: string, from: T.Vector3, to: T.Vector3, now: number) {
        if (this.fade > 0.99 || this.budget <= 0) return;
        if (name === 'tracer') {
            this.budget--;
            this.streak.emit({ x: from.x, y: from.y, z: from.z,
                vx: (to.x - from.x) * 20, vy: (to.y - from.y) * 20, vz: (to.z - from.z) * 20,
                life: 0.08, size: 0.035, endSize: 0.02, color: 0xffe4a5, endColor: 0xffbe65, kind: 1 }, now);
            return;
        }
        if (name === 'water') {
            // bright jet core plus droplets that arc downward (not grey smoke)
            const count = Math.min(this.budget, Math.max(1, Math.ceil(3 * this.quality))); this.budget -= count;
            this.streak.emit({ x: from.x, y: from.y, z: from.z, vx: (to.x - from.x) * 20,
                vy: (to.y - from.y) * 20, vz: (to.z - from.z) * 20, life: 0.1, size: 0.1, endSize: 0.06,
                color: 0xd8f2ff, endColor: 0x6ab4e8, kind: 1 }, now);
            for (let i = 0; i < count; i++) {
                const f = Math.random();
                this.alpha.emit({ x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f,
                    z: from.z + (to.z - from.z) * f, vx: (Math.random() - 0.5) * 1.2,
                    vy: Math.random() * 0.8, vz: (Math.random() - 0.5) * 1.2, life: 0.45,
                    size: 0.13, endSize: 0.06, color: 0xe4f6ff, endColor: 0x4a9ad4, alpha: 0.85 }, now);
            }
            return;
        }
        if (name === 'sparkler') {
            // rocket flight: hot spark tail that falls away behind it
            const count = Math.min(this.budget, Math.max(1, Math.ceil(4 * this.quality))); this.budget -= count;
            for (let i = 0; i < count; i++) {
                const f = i / count;
                this.additive.emit({ x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f,
                    z: from.z + (to.z - from.z) * f, vx: (Math.random() - 0.5) * 2, vy: Math.random() * 1.5,
                    vz: (Math.random() - 0.5) * 2, life: 0.5, size: 0.14, endSize: 0.02,
                    color: Math.random() < 0.3 ? 0xffffff : 0xffc860, endColor: 0xd04010 }, now);
            }
            return;
        }
        const water = false, gas = name === 'gas', smoke = name === 'missile';
        const count = Math.min(this.budget, Math.max(1, Math.ceil((smoke ? 2 : 4) * this.quality)));
        this.budget -= count;
        for (let i = 0; i < count; i++) {
            const f = i / count;
            this.alpha.emit({ x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f,
                z: from.z + (to.z - from.z) * f, vx: (Math.random() - 0.5) * 0.3, vy: 0.3, vz: 0,
                life: smoke ? 1.2 : gas ? 1.5 : 0.3, size: smoke ? 0.5 : 0.15, endSize: smoke ? 1.7 : 0.5,
                color: water ? 0xa5e9ff : gas ? 0xa1aa76 : 0xaaaaa5, endColor: 0x777777,
                kind: 2, alpha: 0.5 }, now);
        }
    }
    update(now: number, distance: number, fade: number) {
        this.fade = fade; this.quality = distance > 250 ? 0.15 : distance > 100 ? 0.4 : 1; this.budget = 4096;
        const dt = Math.min(0.1, Math.max(0, now - this.last)); this.last = now;
        this.shakeAmount *= Math.exp(-8 * dt);
        for (const pool of [this.additive, this.alpha, this.streak]) pool.update(now, fade < 0.99);
        for (let i = this.rings.length - 1; i >= 0; i--)
            if (now - this.rings[i].born > this.rings[i].life) this.rings.splice(i, 1);
    }
    shake(camera: T.PerspectiveCamera, now: number) {
        if (!this.shakeEnabled) return;
        camera.position.x += Math.sin(now * 79) * this.shakeAmount;
        camera.position.y += Math.sin(now * 103) * this.shakeAmount;
        camera.position.z += Math.cos(now * 89) * this.shakeAmount;
    }
    destroy() {
        this.additive.destroy(); this.alpha.destroy(); this.streak.destroy(); this.rings.length = 0;
    }
}
