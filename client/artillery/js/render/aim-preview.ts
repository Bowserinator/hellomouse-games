import type * as T from 'three';
import {
    aimPreviewArrowLengthInVoxels, aimPreviewArrowWidthInVoxels, aimPreviewDotSizeInVoxels,
    aimPreviewDotOutlineColour, aimPreviewDotOutlineScale, aimPreviewDotSpacingInVoxels,
    aimPreviewImpactRadiusInVoxels, aimPreviewMaximumDotCount,
    aimPreviewMinimumBrightness, aimPreviewRingSegments, aimPreviewRingWidthFraction,
    aimPreviewSelfRadiusInVoxels, aimPreviewTeammateBrightness, lobbyMaximumPlayerCount,
    powerCentipercentMaximum, projectileDefaultLifetimeInSeconds, projectileFiringSpeedMultiplier, resolveMaximumDurationInSeconds,
    simulationTicksPerSecond
} from '../config.js';
import { launchVelocity, stepProjectileBallistics } from '../sim/math/projectile-ballistics.js';
import { Vector3, createVector3, vectorLength } from '../sim/math/vector3.js';
import { VoxelRayHit, raycastVoxels } from '../sim/world/voxel-raycast.js';
import { VoxelWorld } from '../sim/world/voxel-world.js';
import { ProjectileDefinition, WeaponDefinition } from '../sim/weapon-types.js';

export interface AimPreviewInput {
    seatIndex: number;
    teamIndex: number;
    colour: number;
    position: Vector3;
    origin: Vector3;
    yawInRadians: number;
    pitchInRadians: number;
    powerCentipercent: number;
    weapon: WeaponDefinition;
}

export function traceAimPreview(world: VoxelWorld, input: AimPreviewInput): {
    dots: Array<Vector3>; impact: VoxelRayHit | null;
} {
    const dots: Array<Vector3> = [];
    let impact: VoxelRayHit | null = null;
    const weapon = input.weapon;
    if (weapon.aimPreviewMode === 'none' || weapon.aimPreviewMode === 'self' ||
        weapon.aimPreviewMode === 'direction') return { dots, impact };
    let untilNext = aimPreviewDotSpacingInVoxels;
    const sample = (previous: Vector3, next: Vector3): boolean => {
        const direction = createVector3(next.x - previous.x, next.y - previous.y, next.z - previous.z);
        impact = raycastVoxels(world, previous, direction, vectorLength(direction));
        const end = impact ? impact.position : next;
        const distance = Math.hypot(end.x - previous.x, end.y - previous.y, end.z - previous.z);
        if (dots.length < aimPreviewMaximumDotCount && distance > 0) {
            let travelled = 0, remaining = distance;
            while (untilNext <= remaining && dots.length < aimPreviewMaximumDotCount) {
                travelled += untilNext;
                remaining -= untilNext;
                const fraction = travelled / distance;
                dots.push(createVector3(previous.x + (end.x - previous.x) * fraction,
                    previous.y + (end.y - previous.y) * fraction, previous.z + (end.z - previous.z) * fraction));
                untilNext = aimPreviewDotSpacingInVoxels;
            }
            untilNext -= remaining;
        }
        return impact === null && dots.length < aimPreviewMaximumDotCount;
    };
    if (weapon.aimPreviewMode === 'straight') {
        const direction = launchVelocity(input.yawInRadians, input.pitchInRadians, powerCentipercentMaximum, 1);
        const ray = weapon.onFire.find(action => action.action === 'fireRay');
        const length = ray?.action === 'fireRay' ? ray.lengthInVoxels
            : aimPreviewDotSpacingInVoxels * aimPreviewMaximumDotCount;
        const scale = Math.min(length, aimPreviewDotSpacingInVoxels * aimPreviewMaximumDotCount) /
            vectorLength(direction);
        sample(input.origin, createVector3(input.origin.x + direction.x * scale,
            input.origin.y + direction.y * scale, input.origin.z + direction.z * scale));
        return { dots, impact };
    }
    const launch = weapon.onFire.find(action => action.action === 'launchProjectile' ||
        action.action === 'spawnProjectiles');
    let definition: ProjectileDefinition | undefined;
    let fixedSpeed: number | undefined;
    let speedScale = 1;
    if (launch && (launch.action === 'launchProjectile' || launch.action === 'spawnProjectiles')) {
        definition = weapon.projectiles[launch.projectileIdentifier];
        fixedSpeed = launch.speedInVoxelsPerSecond ?? definition.speedInVoxelsPerSecond;
        speedScale = definition.speedScale ?? 1;
        if (launch.action === 'launchProjectile') speedScale *= launch.speedScale ?? 1;
    }
    const velocity = launchVelocity(input.yawInRadians, input.pitchInRadians, input.powerCentipercent,
        definition?.massClass ?? weapon.massClass ?? 1, speedScale);
    if (fixedSpeed !== undefined) {
        const direction = launchVelocity(input.yawInRadians, input.pitchInRadians, powerCentipercentMaximum, 1);
        const scale = fixedSpeed * projectileFiringSpeedMultiplier / vectorLength(direction);
        velocity.x = direction.x * scale; velocity.y = direction.y * scale; velocity.z = direction.z * scale;
    }
    if (launch?.action === 'launchProjectile' && launch.velocity) {
        [velocity.x, velocity.y, velocity.z] = launch.velocity;
        velocity.x *= projectileFiringSpeedMultiplier;
        velocity.y *= projectileFiringSpeedMultiplier;
        velocity.z *= projectileFiringSpeedMultiplier;
    }
    const state = { position: { ...input.origin }, velocity };
    const ticks = Math.ceil(Math.min(resolveMaximumDurationInSeconds,
        definition?.lifetimeSeconds ?? projectileDefaultLifetimeInSeconds) * simulationTicksPerSecond);
    for (let tick = 0; tick < ticks; tick++)
        if (!stepProjectileBallistics(state, definition?.gravityScale ?? 1, sample)) break;
    return { dots, impact };
}

export class AimPreview {
    readonly group = new THREE.Group();
    private readonly dots: T.InstancedMesh;
    private readonly outlines: T.InstancedMesh;
    private readonly rings: T.InstancedMesh;
    private readonly arrows: T.InstancedMesh;
    private readonly matrix = new THREE.Matrix4();
    private readonly position = new THREE.Vector3();
    private readonly rotation = new THREE.Quaternion();
    private readonly scale = new THREE.Vector3();
    private readonly outlineScale = new THREE.Vector3();
    private readonly normal = new THREE.Vector3();
    private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
    private readonly forward = new THREE.Vector3(0, 0, 1);
    private readonly colour = new THREE.Color();
    private readonly baseColour = new THREE.Color();
    private disposed = false;

    constructor(private readonly world: VoxelWorld) {
        const arrow = new THREE.Shape();
        arrow.moveTo(-.15, 0); arrow.lineTo(.15, 0); arrow.lineTo(.15, .65);
        arrow.lineTo(.5, .65); arrow.lineTo(0, 1); arrow.lineTo(-.5, .65);
        arrow.lineTo(-.15, .65); arrow.closePath();
        this.dots = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshBasicMaterial({ vertexColors: true }), lobbyMaximumPlayerCount * aimPreviewMaximumDotCount);
        this.rings = new THREE.InstancedMesh(new THREE.RingGeometry(1 - aimPreviewRingWidthFraction, 1,
            aimPreviewRingSegments), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide,
            depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
        lobbyMaximumPlayerCount);
        this.arrows = new THREE.InstancedMesh(new THREE.ShapeGeometry(arrow),
            new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true,
                polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), lobbyMaximumPlayerCount);
        this.outlines = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({
            color: aimPreviewDotOutlineColour, side: THREE.BackSide }), this.dots.instanceMatrix.count);
        for (const mesh of [this.dots, this.rings, this.arrows]) {
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 3), 3);
            mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
            mesh.frustumCulled = false; mesh.count = 0;
            this.group.add(mesh);
        }
        this.outlines.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.outlines.frustumCulled = false; this.outlines.count = 0;
        this.group.add(this.outlines);
    }

    update(inputs: ReadonlyArray<AimPreviewInput>, viewerTeamIndex: number, viewerSeatIndex: number): void {
        if (this.disposed) return;
        this.dots.count = 0; this.rings.count = 0; this.arrows.count = 0; this.outlines.count = 0;
        let visibleSeats = 0;
        for (const input of inputs) {
            if (input.teamIndex !== viewerTeamIndex || input.weapon.aimPreviewMode === 'none') continue;
            if (++visibleSeats > lobbyMaximumPlayerCount) break;
            this.baseColour.setHex(input.colour).convertSRGBToLinear()
                .multiplyScalar(input.seatIndex === viewerSeatIndex ? 1 : aimPreviewTeammateBrightness);
            const mode = input.weapon.aimPreviewMode;
            if (mode === 'self') {
                this.position.set(input.position.x, input.position.y, input.position.z);
                this.rotation.setFromEuler(this.euler.set(-Math.PI / 2, 0, 0));
                this.scale.setScalar(aimPreviewSelfRadiusInVoxels);
                this.append(this.rings, this.baseColour);
            } else if (mode === 'direction') {
                this.position.set(input.position.x, input.position.y, input.position.z);
                this.rotation.setFromEuler(this.euler.set(Math.PI / 2, input.yawInRadians, 0));
                this.scale.set(aimPreviewArrowWidthInVoxels, aimPreviewArrowLengthInVoxels, 1);
                this.append(this.arrows, this.baseColour);
            } else {
                const result = traceAimPreview(this.world, input);
                this.rotation.identity(); this.scale.setScalar(aimPreviewDotSizeInVoxels);
                this.outlineScale.setScalar(aimPreviewDotSizeInVoxels * aimPreviewDotOutlineScale);
                for (let index = 0; index < result.dots.length; index++) {
                    const point = result.dots[index];
                    this.position.set(point.x, point.y, point.z);
                    this.colour.copy(this.baseColour).multiplyScalar(1 - (1 - aimPreviewMinimumBrightness) *
                        index / Math.max(1, result.dots.length - 1));
                    this.append(this.dots, this.colour);
                    this.matrix.compose(this.position, this.rotation, this.outlineScale);
                    this.outlines.setMatrixAt(this.outlines.count++, this.matrix);
                }
                if (result.impact) {
                    this.position.set(result.impact.position.x, result.impact.position.y, result.impact.position.z);
                    this.normal.set(result.impact.normal.x, result.impact.normal.y, result.impact.normal.z);
                    if (!this.normal.lengthSq()) this.normal.set(0, 1, 0);
                    this.position.addScaledVector(this.normal, Number.EPSILON * this.world.mapEdgeLengthInVoxels);
                    this.rotation.setFromUnitVectors(this.forward, this.normal);
                    this.scale.setScalar(aimPreviewImpactRadiusInVoxels);
                    this.append(this.rings, this.baseColour);
                }
            }
        }
        for (const mesh of [this.dots, this.rings, this.arrows, this.outlines]) {
            mesh.visible = mesh.count > 0;
            mesh.instanceMatrix.updateRange.count = mesh.count * 16;
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) {
                mesh.instanceColor.updateRange.count = mesh.count * 3;
                mesh.instanceColor.needsUpdate = true;
            }
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const mesh of [this.dots, this.rings, this.arrows, this.outlines]) {
            mesh.dispose(); mesh.geometry.dispose();
            (mesh.material as T.MeshBasicMaterial).dispose();
        }
        this.group.parent?.remove(this.group); this.group.clear();
    }

    private append(mesh: T.InstancedMesh, colour: T.Color): void {
        this.matrix.compose(this.position, this.rotation, this.scale);
        mesh.setMatrixAt(mesh.count, this.matrix); mesh.setColorAt(mesh.count, colour); mesh.count++;
    }
}
