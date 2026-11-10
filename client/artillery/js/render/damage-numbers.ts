import type * as T from 'three';
import { Rng } from '../../../shared/ts/seeded-random.js';
import { Vector3 } from '../sim/math/vector3.js';
import { transparentEffectsLayer } from './effects-layer.js';

const maximumNumberCount = 64;
const lifetimeInSeconds = 4;
const riseSpeedInVoxelsPerSecond = 2.5;
const scatterRadiusInVoxels = 4;
const scatterHeightInVoxels = 4;
const heightInVoxels = 2.4;
const distanceScaleStartInVoxels = 90;
const textureWidth = 352, textureHeight = 96;
const repairFillColour = '#60ff90';

interface FloatingNumber {
    sprite: T.Sprite;
    age: number;
    isAlive: boolean;
}

/** Numbers with a black outline that float up around a tank when it takes damage or is repaired. */
export class DamageNumbers {
    readonly group = new THREE.Group();
    private readonly numbers: Array<FloatingNumber>;
    private readonly textures = new Map<string, T.CanvasTexture>();
    private nextIndex = 0;
    private disposed = false;

    constructor(private readonly random: Rng) {
        this.numbers = Array.from({ length: maximumNumberCount }, () => {
            const material = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false,
                toneMapped: false });
            const sprite = new THREE.Sprite(material);
            sprite.layers.set(transparentEffectsLayer);
            sprite.renderOrder = 10;
            sprite.visible = false;
            sprite.frustumCulled = false;
            this.group.add(sprite);
            return { sprite, age: 0, isAlive: false };
        });
    }

    /** A hitCount above one is shown as a combined "5x 1" label; repairs are shown as a green negative number. */
    spawn(tankPosition: Vector3, amount: number, hitCount = 1, isRepair = false): void {
        if (this.disposed || !(amount > 0)) return;
        const entry = this.numbers[this.nextIndex++ % this.numbers.length];
        const angle = this.random.float() * Math.PI * 2;
        const radius = (.4 + this.random.float() * .6) * scatterRadiusInVoxels;
        const material = entry.sprite.material as T.SpriteMaterial;
        const text = String(Math.max(1, Math.round(amount)));
        material.map = isRepair ? this.texture(`-${text}`, repairFillColour)
            : this.texture(hitCount > 1 ? `${hitCount}x ${text}` : text);
        material.opacity = 1;
        material.needsUpdate = true;
        entry.sprite.position.set(tankPosition.x + Math.cos(angle) * radius,
            tankPosition.y + 2 + this.random.float() * scatterHeightInVoxels, tankPosition.z + Math.sin(angle) * radius);
        entry.age = 0; entry.isAlive = true; entry.sprite.visible = true;
    }

    update(deltaSeconds: number, cameraPosition: T.Vector3): void {
        if (this.disposed) return;
        for (const entry of this.numbers) {
            if (!entry.isAlive) continue;
            entry.age += deltaSeconds;
            if (entry.age >= lifetimeInSeconds) {
                entry.isAlive = false; entry.sprite.visible = false;
                continue;
            }
            const progress = entry.age / lifetimeInSeconds;
            entry.sprite.position.y += riseSpeedInVoxelsPerSecond * deltaSeconds;
            (entry.sprite.material as T.SpriteMaterial).opacity = 1 - progress;
            // Grows with distance so the text stays legible from far away
            const scale = heightInVoxels * Math.max(1,
                entry.sprite.position.distanceTo(cameraPosition) / distanceScaleStartInVoxels);
            entry.sprite.scale.set(scale * textureWidth / textureHeight, scale, 1);
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.group.parent?.remove(this.group);
        for (const entry of this.numbers) (entry.sprite.material as T.SpriteMaterial).dispose();
        for (const texture of this.textures.values()) texture.dispose();
        this.textures.clear();
    }

    private texture(text: string, fill = '#ffffff'): T.CanvasTexture {
        const key = `${fill}${text}`;
        let texture = this.textures.get(key);
        if (texture) return texture;
        const canvas = document.createElement('canvas');
        canvas.width = textureWidth; canvas.height = textureHeight;
        const context = canvas.getContext('2d')!;
        context.font = `bold ${textureHeight * .7}px sans-serif`;
        context.textAlign = 'center'; context.textBaseline = 'middle';
        context.lineJoin = 'round'; context.lineWidth = textureHeight * .16;
        context.strokeStyle = '#000000'; context.fillStyle = fill;
        context.strokeText(text, textureWidth / 2, textureHeight / 2);
        context.fillText(text, textureWidth / 2, textureHeight / 2);
        texture = new THREE.CanvasTexture(canvas);
        this.textures.set(key, texture);
        return texture;
    }
}
