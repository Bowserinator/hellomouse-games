import type * as T from 'three';
import {
    cameraCollisionPaddingInVoxels, cameraDefaultDistanceInVoxels, cameraDefaultPitchInRadians,
    cameraFieldOfViewInDegrees, cameraFrameMargin, cameraMaximumDistanceInVoxels, cameraMaximumPitchInRadians,
    cameraMinimumDistanceInVoxels, cameraMinimumPitchInRadians, cameraOrbitSensitivity,
    cameraOrthographicFarPlane, cameraOrthographicNearPlane, cameraPerspectiveFarPlane, cameraPerspectiveNearPlane,
    cameraShakeDecayPerSecond, cameraShakeEnabled, cameraShakeNoiseFrequency, cameraShakeRadiusScale,
    cameraTargetEasePerSecond, cameraZoomSensitivity, worldHeightInVoxels
} from '../config.js';
import { Vector3 } from '../sim/math/vector3.js';
import { MaterialFlag, materialTable } from '../sim/world/material-table.js';
import { VoxelWorld } from '../sim/world/voxel-world.js';
import { raycastVoxels } from '../sim/world/voxel-raycast.js';
import { valueNoise } from '../../../shared/ts/value-noise.js';

export class CameraRig {
    readonly targetPoint = new THREE.Vector3();
    orbitYawInRadians = 0;
    orbitPitchInRadians = cameraDefaultPitchInRadians;
    distanceInVoxels = cameraDefaultDistanceInVoxels;
    autoEnabled = false;
    shakeEnabled = cameraShakeEnabled;
    private readonly perspective = new THREE.PerspectiveCamera(cameraFieldOfViewInDegrees, 1,
        cameraPerspectiveNearPlane, cameraPerspectiveFarPlane);
    private readonly orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1,
        cameraOrthographicNearPlane, cameraOrthographicFarPlane);
    private isOrthographic = false;
    private width = 1;
    private height = 1;
    private seconds = 0;
    private readonly teamTarget = new THREE.Vector3();
    private teamDistance = cameraDefaultDistanceInVoxels;
    private shakeAmount = 0;
    private readonly desiredTarget = new THREE.Vector3();
    private readonly direction = new THREE.Vector3();
    private readonly collisionStart = new THREE.Vector3();
    private readonly collisionEnd = new THREE.Vector3();
    private readonly look = new THREE.Vector3();

    constructor(private readonly world: VoxelWorld) {
        this.targetPoint.set(world.mapEdgeLengthInVoxels / 2, worldHeightInVoxels / 2,
            world.mapEdgeLengthInVoxels / 2);
        this.teamTarget.copy(this.targetPoint);
        this.update(0);
    }

    get camera(): T.PerspectiveCamera | T.OrthographicCamera {
        return this.isOrthographic ? this.orthographic : this.perspective;
    }

    resize(width: number, height: number): void {
        if (!Number.isFinite(width + height) || width <= 0 || height <= 0) throw new Error('Invalid camera size');
        this.width = width; this.height = height;
        this.updateProjection();
    }

    toggleProjection(): void {
        this.isOrthographic = !this.isOrthographic;
        this.camera.position.copy(this.isOrthographic ? this.perspective.position : this.orthographic.position);
        this.camera.quaternion.copy(this.isOrthographic ? this.perspective.quaternion : this.orthographic.quaternion);
        this.updateProjection();
        this.camera.updateMatrixWorld();
    }

    orbit(deltaX: number, deltaY: number): void {
        if (!Number.isFinite(deltaX + deltaY)) throw new Error('Invalid camera input');
        this.orbitYawInRadians -= deltaX * cameraOrbitSensitivity;
        this.orbitPitchInRadians = THREE.MathUtils.clamp(this.orbitPitchInRadians + deltaY * cameraOrbitSensitivity,
            cameraMinimumPitchInRadians, cameraMaximumPitchInRadians);
        this.autoEnabled = false;
    }

    pan(deltaX: number, deltaY: number): void {
        if (!Number.isFinite(deltaX + deltaY)) throw new Error('Invalid camera input');
        const scale = 2 * this.distanceInVoxels * Math.tan(cameraFieldOfViewInDegrees * Math.PI / 360) / this.height;
        const vertical = deltaY / Math.sin(this.orbitPitchInRadians);
        const sine = Math.sin(this.orbitYawInRadians), cosine = Math.cos(this.orbitYawInRadians);
        this.targetPoint.x += (-deltaX * cosine - vertical * sine) * scale;
        this.targetPoint.z += (deltaX * sine - vertical * cosine) * scale;
        this.autoEnabled = false;
    }

    zoom(delta: number): void {
        if (!Number.isFinite(delta)) throw new Error('Invalid camera input');
        this.distanceInVoxels = THREE.MathUtils.clamp(this.distanceInVoxels * Math.exp(delta * cameraZoomSensitivity),
            cameraMinimumDistanceInVoxels, cameraMaximumDistanceInVoxels);
        this.autoEnabled = false;
        this.updateProjection();
    }

    moveTo(points: ReadonlyArray<Vector3>, minimumDistance = cameraDefaultDistanceInVoxels): void {
        this.focus(points, minimumDistance);
        this.autoEnabled = true;
    }

    focus(points: ReadonlyArray<Vector3>, minimumDistance = cameraDefaultDistanceInVoxels): void {
        if (!points.length) return;
        this.teamTarget.set(0, 0, 0);
        for (const point of points) {
            this.teamTarget.x += point.x;
            this.teamTarget.y += point.y;
            this.teamTarget.z += point.z;
        }
        this.teamTarget.multiplyScalar(1 / points.length);
        let radius = 0;
        for (const point of points) radius = Math.max(radius, Math.hypot(point.x - this.teamTarget.x,
            point.y - this.teamTarget.y, point.z - this.teamTarget.z));
        const tangent = Math.tan(cameraFieldOfViewInDegrees * Math.PI / 360) * Math.min(1, this.width / this.height);
        this.teamDistance = THREE.MathUtils.clamp(Math.max(minimumDistance,
            radius * cameraFrameMargin / tangent), cameraMinimumDistanceInVoxels, cameraMaximumDistanceInVoxels);
    }

    addExplosion(position: Vector3, radius: number, shakeStrength = 1): void {
        const weight = Math.max(0, radius);
        if (!weight) return;
        const distance = Math.hypot(position.x - this.targetPoint.x, position.y - this.targetPoint.y,
            position.z - this.targetPoint.z);
        this.shakeAmount = Math.max(this.shakeAmount,
            weight * cameraShakeRadiusScale * shakeStrength / (1 + distance / weight));
    }

    update(deltaSeconds: number): void {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error('Invalid camera time step');
        this.seconds += deltaSeconds;
        if (this.autoEnabled) {
            const amount = 1 - Math.exp(-cameraTargetEasePerSecond * deltaSeconds);
            this.desiredTarget.copy(this.teamTarget);
            this.targetPoint.lerp(this.desiredTarget, amount);
            this.distanceInVoxels += (this.teamDistance - this.distanceInVoxels) * amount;
        }
        this.direction.set(Math.sin(this.orbitYawInRadians) * Math.cos(this.orbitPitchInRadians),
            Math.sin(this.orbitPitchInRadians), Math.cos(this.orbitYawInRadians) * Math.cos(this.orbitPitchInRadians));
        this.collisionStart.copy(this.targetPoint);
        let startDistance = 0;
        if (this.world.isSolid(Math.floor(this.targetPoint.x), Math.floor(this.targetPoint.y),
            Math.floor(this.targetPoint.z))) {
            const edge = this.world.mapEdgeLengthInVoxels;
            const boundaryX = this.direction.x > 0 ? edge : 0;
            const boundaryZ = this.direction.z > 0 ? edge : 0;
            const escapeDistance = Math.min((worldHeightInVoxels - this.targetPoint.y) / this.direction.y,
                this.direction.x === 0 ? Infinity : (boundaryX - this.targetPoint.x) / this.direction.x,
                this.direction.z === 0 ? Infinity : (boundaryZ - this.targetPoint.z) / this.direction.z);
            const empty = raycastVoxels(this.world, this.targetPoint, this.direction, Math.max(0, escapeDistance),
                material => (materialTable[material].flags & MaterialFlag.SOLID) === 0);
            startDistance = empty ? empty.distance + Number.EPSILON * cameraPerspectiveFarPlane
                : Math.max(0, escapeDistance) + cameraCollisionPaddingInVoxels;
            this.collisionStart.addScaledVector(this.direction, startDistance);
        }
        let distance = Math.max(startDistance, this.distanceInVoxels);
        this.collisionEnd.copy(this.targetPoint).addScaledVector(this.direction, distance);
        const endpointIsSolid = this.world.isSolid(Math.floor(this.collisionEnd.x), Math.floor(this.collisionEnd.y),
            Math.floor(this.collisionEnd.z));
        const probeStart = endpointIsSolid ? startDistance
            : Math.max(startDistance, distance - cameraCollisionPaddingInVoxels * 2);
        this.collisionStart.copy(this.targetPoint).addScaledVector(this.direction, probeStart);
        const hit = raycastVoxels(this.world, this.collisionStart, this.direction, distance - probeStart);
        if (hit) distance = Math.max(startDistance, probeStart + hit.distance - cameraCollisionPaddingInVoxels);
        this.camera.position.copy(this.targetPoint).addScaledVector(this.direction, distance);
        this.look.copy(this.targetPoint);
        if (this.shakeEnabled && this.shakeAmount > 0) {
            const time = this.seconds * cameraShakeNoiseFrequency;
            this.look.x += (valueNoise(time, 11, 3) * 2 - 1) * this.shakeAmount;
            this.look.y += (valueNoise(7, time, 19) * 2 - 1) * this.shakeAmount;
        }
        this.shakeAmount *= Math.exp(-cameraShakeDecayPerSecond * deltaSeconds);
        this.camera.lookAt(this.look);
        this.updateProjection();
        this.camera.updateMatrixWorld();
    }

    private updateProjection(): void {
        const aspect = this.width / this.height;
        this.perspective.aspect = aspect;
        this.perspective.updateProjectionMatrix();
        const range = Math.max(cameraPerspectiveNearPlane, this.camera.position.distanceTo(this.targetPoint));
        const halfHeight = range * Math.tan(cameraFieldOfViewInDegrees * Math.PI / 360);
        this.orthographic.left = -halfHeight * aspect; this.orthographic.right = halfHeight * aspect;
        this.orthographic.top = halfHeight; this.orthographic.bottom = -halfHeight;
        this.orthographic.updateProjectionMatrix();
    }
}
