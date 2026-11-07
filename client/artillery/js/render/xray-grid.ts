import type * as T from 'three';
import {
    lobbyMaximumPlayerCount, worldWaterSurfaceHeightInVoxels, xrayEasePerSecond, xrayEaseSnapThreshold,
    xrayGlowIntensity, xrayGridColour, xrayGridOpacity, xrayGridRadiusInVoxels, xrayGridSpacingInVoxels,
    xrayRingRadiusInVoxels, xrayRingSegments, xrayRingWidthFraction, xrayStemWidthInVoxels
} from '../config.js';
import { Vector3 } from '../sim/math/vector3.js';
import { Tank } from '../sim/tank.js';

export class XrayGrid {
    readonly group = new THREE.Group();
    private readonly grid: T.Mesh<T.PlaneGeometry, T.ShaderMaterial>;
    private readonly stems: T.InstancedMesh;
    private readonly rings: T.InstancedMesh;
    private readonly material = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false,
        depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
        side: THREE.DoubleSide });
    private readonly matrix = new THREE.Matrix4();
    private readonly position = new THREE.Vector3();
    private readonly rotation = new THREE.Quaternion();
    private readonly scale = new THREE.Vector3();
    private readonly colour = new THREE.Color();
    private enabled = false;
    private level = 0;
    private disposed = false;

    constructor(private readonly seatColours: ReadonlyMap<number, number>) {
        this.grid = new THREE.Mesh(new THREE.PlaneGeometry(xrayGridRadiusInVoxels * 2,
            xrayGridRadiusInVoxels * 2), new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
            side: THREE.DoubleSide, extensions: { derivatives: true },
            uniforms: { uAmount: { value: 0 }, uFocus: { value: new THREE.Vector2() },
                uSpacing: { value: xrayGridSpacingInVoxels }, uRadius: { value: xrayGridRadiusInVoxels },
                uColour: { value: new THREE.Color(xrayGridColour).convertSRGBToLinear() },
                uOpacity: { value: xrayGridOpacity } },
            vertexShader: `varying vec2 vWorldXZ;
                void main() {
                    vec4 world = modelMatrix * vec4(position, 1.);
                    vWorldXZ = world.xz;
                    gl_Position = projectionMatrix * viewMatrix * world;
                }`,
            fragmentShader: `varying vec2 vWorldXZ;
                uniform float uAmount, uSpacing, uRadius, uOpacity;
                uniform vec2 uFocus;
                uniform vec3 uColour;
                void main() {
                    vec2 coordinate = vWorldXZ / uSpacing;
                    vec2 distanceToLine = abs(fract(coordinate - .5) - .5) / max(fwidth(coordinate), vec2(.0001));
                    float line = 1. - min(min(distanceToLine.x, distanceToLine.y), 1.);
                    float fade = 1. - smoothstep(uRadius * .5, uRadius, length(vWorldXZ - uFocus));
                    gl_FragColor = vec4(uColour, line * fade * uAmount * uOpacity);
                }` }));
        this.grid.rotation.x = -Math.PI / 2;
        this.stems = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.material, lobbyMaximumPlayerCount);
        this.rings = new THREE.InstancedMesh(new THREE.RingGeometry(1 - xrayRingWidthFraction, 1,
            xrayRingSegments).rotateX(-Math.PI / 2), this.material, lobbyMaximumPlayerCount);
        for (const mesh of [this.stems, this.rings]) {
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(lobbyMaximumPlayerCount * 3), 3);
            mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
            mesh.frustumCulled = false; mesh.count = 0; mesh.renderOrder = 100;
        }
        this.group.add(this.grid, this.stems, this.rings); this.group.visible = false;
    }

    get amount(): number {
        return this.level;
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    update(tanks: ReadonlyArray<Tank>, focus: Vector3, deltaSeconds: number): void {
        if (this.disposed) return;
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error('Invalid x-ray time step');
        const target = this.enabled ? 1 : 0;
        this.level += (target - this.level) * (1 - Math.exp(-xrayEasePerSecond * deltaSeconds));
        if (Math.abs(target - this.level) < xrayEaseSnapThreshold) this.level = target;
        this.group.visible = this.level > 0;
        this.stems.count = 0; this.rings.count = 0;
        if (!this.group.visible) return;
        this.grid.position.set(Math.round(focus.x / xrayGridSpacingInVoxels) * xrayGridSpacingInVoxels,
            worldWaterSurfaceHeightInVoxels, Math.round(focus.z / xrayGridSpacingInVoxels) * xrayGridSpacingInVoxels);
        this.grid.material.uniforms.uFocus.value.set(focus.x, focus.z);
        this.grid.material.uniforms.uAmount.value = this.level;
        this.material.opacity = this.level;
        this.rotation.identity();
        for (const tank of tanks) {
            if (this.stems.count >= lobbyMaximumPlayerCount) break;
            this.colour.setHex(this.seatColours.get(tank.seatIndex) ?? 0xffffff).convertSRGBToLinear()
                .multiplyScalar(xrayGlowIntensity);
            this.position.set(tank.position.x, (tank.position.y + worldWaterSurfaceHeightInVoxels) / 2,
                tank.position.z);
            this.scale.set(xrayStemWidthInVoxels, Math.abs(tank.position.y - worldWaterSurfaceHeightInVoxels),
                xrayStemWidthInVoxels);
            this.append(this.stems);
            this.position.y = worldWaterSurfaceHeightInVoxels;
            this.scale.setScalar(xrayRingRadiusInVoxels); this.append(this.rings);
        }
        for (const mesh of [this.stems, this.rings]) {
            mesh.instanceMatrix.updateRange.count = mesh.count * 16; mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) {
                mesh.instanceColor.updateRange.count = mesh.count * 3; mesh.instanceColor.needsUpdate = true;
            }
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.grid.geometry.dispose(); this.grid.material.dispose(); this.material.dispose();
        this.stems.dispose(); this.stems.geometry.dispose(); this.rings.dispose(); this.rings.geometry.dispose();
        this.group.parent?.remove(this.group); this.group.clear();
    }

    private append(mesh: T.InstancedMesh): void {
        this.matrix.compose(this.position, this.rotation, this.scale);
        mesh.setMatrixAt(mesh.count, this.matrix); mesh.setColorAt(mesh.count, this.colour); mesh.count++;
    }
}
