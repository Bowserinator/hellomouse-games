import type * as T from 'three';
import {
    autoAimedLabel, autoAimerWeaponIdentifier, nameTagHeadClearanceInVoxels,
    nameTagMaximumDistanceInVoxels, nameTagMaximumScale,
    nameTagMinimumScale, nameTagOccludedOpacity, nameTagOcclusionCheckIntervalInFrames,
    nameTagOpacityEasePerSecond, nameTagScaleDistanceInVoxels, tankHullHeightInVoxels
} from '../config.js';
import { Tank } from '../sim/tank.js';
import { Deployable } from '../sim/deployable.js';
import { Projectile } from '../sim/projectile.js';
import { Vector3 } from '../sim/math/vector3.js';
import { radiansPerDegree } from '../sim/math/deterministic-math.js';
import { VoxelWorld } from '../sim/world/voxel-world.js';
import { raycastVoxels } from '../sim/world/voxel-raycast.js';
import { LobbySeat } from '../types.js';

interface NameTag {
    element: HTMLDivElement;
    name: HTMLSpanElement;
    health: HTMLDivElement;
    fill: HTMLDivElement;
    opacity: number;
    occluded: boolean;
}

export class NameTags {
    private readonly tags = new Map<number, NameTag>();
    private readonly projectileTags = new Map<number, HTMLDivElement>();
    private readonly head = new THREE.Vector3();
    private readonly projected = new THREE.Vector3();
    private readonly origin = new THREE.Vector3();
    private readonly direction = new THREE.Vector3();
    private frame = 0;
    private disposed = false;

    constructor(private readonly world: VoxelWorld, private readonly container: HTMLElement,
        seats: ReadonlyArray<LobbySeat>, seatColours: ReadonlyMap<number, number>) {
        for (const seat of seats) {
            const element = container.ownerDocument.createElement('div');
            element.className = 'artillery-name-tag';
            element.dataset.seatIndex = String(seat.seatIndex);
            element.style.setProperty('--team-colour', `#${(seatColours.get(seat.seatIndex) ?? 0xffffff)
                .toString(16).padStart(6, '0')}`);
            const name = container.ownerDocument.createElement('span');
            name.className = 'artillery-name-tag__name'; name.textContent = seat.username;
            const health = container.ownerDocument.createElement('div');
            health.className = 'artillery-name-tag__health';
            health.setAttribute('role', 'progressbar');
            health.setAttribute('aria-label', `${seat.username} hit points`);
            health.setAttribute('aria-valuemin', '0');
            const fill = container.ownerDocument.createElement('div');
            fill.className = 'artillery-name-tag__fill'; health.append(fill);
            element.append(name, health); container.append(element);
            this.tags.set(seat.seatIndex, { element, name, health, fill, opacity: 1, occluded: false });
        }
    }

    update(tanks: ReadonlyArray<Tank>, camera: T.Camera, width: number, height: number, deltaSeconds: number): void {
        if (this.disposed) return;
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error('Invalid name-tag time step');
        const amount = 1 - Math.exp(-nameTagOpacityEasePerSecond * deltaSeconds);
        camera.getWorldPosition(this.origin);
        for (const [seatIndex, tag] of this.tags) {
            const tank = tanks.find(candidate => candidate.seatIndex === seatIndex);
            if (!tank) {
                tag.element.hidden = true;
                continue;
            }
            this.head.set(tank.position.x, tank.position.y + tankHullHeightInVoxels + nameTagHeadClearanceInVoxels,
                tank.position.z);
            const distance = this.head.distanceTo(this.origin);
            this.projected.copy(this.head).project(camera);
            const hidden = distance > nameTagMaximumDistanceInVoxels || this.projected.z < -1 ||
                this.projected.z > 1 || Math.abs(this.projected.x) > 1 || Math.abs(this.projected.y) > 1;
            tag.element.hidden = hidden;
            if (hidden) continue;
            if (this.frame % nameTagOcclusionCheckIntervalInFrames === Math.floor(seatIndex / 2)) {
                this.direction.copy(this.head).sub(this.origin);
                tag.occluded = raycastVoxels(this.world, this.origin, this.direction, distance) !== null;
            }
            tag.opacity += ((tag.occluded ? nameTagOccludedOpacity : 1) - tag.opacity) * amount;
            tag.element.style.opacity = String(tag.opacity);
            const scale = THREE.MathUtils.clamp(nameTagScaleDistanceInVoxels / Math.max(1, distance),
                nameTagMinimumScale, nameTagMaximumScale);
            const x = (this.projected.x * .5 + .5) * width;
            const y = (-this.projected.y * .5 + .5) * height;
            tag.element.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%) scale(${scale})`;
            tag.element.classList.toggle('artillery-name-tag--wreck', tank.isWreck);
            tag.health.hidden = tank.isWreck;
            tag.fill.style.width = `${Math.max(0, Math.min(100, tank.hitPoints / tank.maximumHitPoints * 100))}%`;
            tag.health.setAttribute('aria-valuemax', String(tank.maximumHitPoints));
            tag.health.setAttribute('aria-valuenow', String(Math.max(0, Math.round(tank.hitPoints))));
        }
        this.frame++;
    }

    updateProjectiles(projectiles: ReadonlyArray<Projectile>, deployables: ReadonlyArray<Deployable>,
        camera: T.Camera, width: number, height: number): void {
        if (this.disposed) return;
        const labelled: Array<{ serial: number; weaponIdentifier: string; position: Vector3; yawOffset: number;
            pitchOffset: number }> = [];
        for (const projectile of projectiles)
            if (projectile.isAlive && projectile.weaponIdentifier === 'tracer' ||
                projectile.isAlive && projectile.weaponIdentifier === autoAimerWeaponIdentifier)
                labelled.push({ serial: projectile.serial, weaponIdentifier: projectile.weaponIdentifier,
                    position: projectile.position,
                    yawOffset: projectile.yawOffsetInRadians, pitchOffset: projectile.pitchOffsetInRadians });
        for (const deployable of deployables)
            if (deployable.isPersistent && deployable.weaponIdentifier === 'tracer')
                labelled.push({ serial: deployable.serial, weaponIdentifier: deployable.weaponIdentifier,
                    position: deployable.context.position,
                    yawOffset: deployable.yawOffsetInRadians, pitchOffset: deployable.pitchOffsetInRadians });
        for (const [serial, element] of this.projectileTags)
            if (!labelled.some(entry => entry.serial === serial)) {
                element.remove(); this.projectileTags.delete(serial);
            }
        for (const entry of labelled) {
            let element = this.projectileTags.get(entry.serial);
            if (!element) {
                element = this.container.ownerDocument.createElement('div');
                element.className = 'artillery-projectile-tag';
                if (entry.weaponIdentifier === autoAimerWeaponIdentifier) element.textContent = autoAimedLabel;
                else {
                    const angles = [-entry.yawOffset, entry.pitchOffset].map(value => {
                        const degrees = Math.round(value / radiansPerDegree * 10) / 10;
                        return `${degrees > 0 ? '+' : ''}${degrees}°`;
                    });
                    element.textContent = `${angles[0]} / ${angles[1]}`;
                    element.setAttribute('aria-label', `Bearing offset ${angles[0]}, elevation offset ${angles[1]}`);
                }
                this.container.append(element); this.projectileTags.set(entry.serial, element);
            }
            this.head.set(entry.position.x, entry.position.y + nameTagHeadClearanceInVoxels, entry.position.z);
            this.projected.copy(this.head).project(camera);
            element.hidden = this.projected.z < -1 || this.projected.z > 1 ||
                Math.abs(this.projected.x) > 1 || Math.abs(this.projected.y) > 1;
            const x = (this.projected.x * .5 + .5) * width;
            const y = (-this.projected.y * .5 + .5) * height;
            element.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%)`;
        }
    }

    setUsername(seatIndex: number, username: string): void {
        const tag = this.tags.get(seatIndex);
        if (tag) {
            tag.name.textContent = username;
            tag.health.setAttribute('aria-label', `${username} hit points`);
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const tag of this.tags.values()) tag.element.remove();
        this.tags.clear();
        for (const element of this.projectileTags.values()) element.remove();
        this.projectileTags.clear();
    }
}
