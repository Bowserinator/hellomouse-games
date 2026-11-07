import type * as T from 'three';
import { liquidMaximumCellCount, liquidSurfaceThicknessInVoxels, liquidSurfaceInsetInVoxels,
    liquidOilColour, liquidLavaColour, liquidLavaGlow, liquidFireColour, liquidFireGlow, liquidFireFadeSeconds,
    simulationTicksPerSecond } from '../config.js';
import { LiquidCell } from '../sim/liquid-field.js';

export class LiquidRenderer {
    readonly mesh: T.InstancedMesh;
    private readonly matrix = new THREE.Matrix4();
    private readonly position = new THREE.Vector3();
    private readonly rotation = new THREE.Quaternion();
    private readonly scale = new THREE.Vector3(1, liquidSurfaceThicknessInVoxels, 1);
    private readonly oil = new THREE.Color(liquidOilColour).convertSRGBToLinear();
    private readonly lava = new THREE.Color(liquidLavaColour).convertSRGBToLinear().multiplyScalar(liquidLavaGlow);
    private readonly fire = new THREE.Color(liquidFireColour).convertSRGBToLinear();
    private readonly shade = new THREE.Color();
    private readonly material = new THREE.MeshBasicMaterial({ toneMapped: false });
    private disposed = false;

    constructor() {
        this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.material, liquidMaximumCellCount);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(liquidMaximumCellCount * 3), 3);
        this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        this.mesh.frustumCulled = false;
        this.mesh.count = 0;
    }

    update(cells: ReadonlyMap<number, LiquidCell>): void {
        if (this.disposed) return;
        this.mesh.count = 0;
        for (const cell of cells.values()) {
            if (this.mesh.count === liquidMaximumCellCount) throw new Error('Liquid rendering capacity exceeded');
            this.position.set(cell.x + .5, cell.y + liquidSurfaceThicknessInVoxels / 2 +
                liquidSurfaceInsetInVoxels, cell.z + .5);
            this.matrix.compose(this.position, this.rotation, this.scale);
            this.mesh.setMatrixAt(this.mesh.count, this.matrix);
            if (cell.kind === 'fire')
                this.shade.copy(this.fire).multiplyScalar(liquidFireGlow * Math.min(1,
                    cell.remainingTicks / (liquidFireFadeSeconds * simulationTicksPerSecond)));
            this.mesh.setColorAt(this.mesh.count, cell.kind === 'fire' ? this.shade
                : cell.kind === 'lava' ? this.lava : this.oil);
            this.mesh.count++;
        }
        this.mesh.instanceMatrix.updateRange.count = this.mesh.count * 16;
        this.mesh.instanceMatrix.needsUpdate = true;
        if (this.mesh.instanceColor) {
            this.mesh.instanceColor.updateRange.count = this.mesh.count * 3;
            this.mesh.instanceColor.needsUpdate = true;
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.mesh.parent?.remove(this.mesh);
        this.mesh.dispose(); this.mesh.geometry.dispose(); this.material.dispose();
    }
}
