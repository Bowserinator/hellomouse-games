import type * as T from 'three';
import { modelPaintColours } from '../config.js';
import { VoxelModelSpec } from '../sim/model-collision.js';
import { compileVoxelModel } from '../data/voxel-model-compiler.js';
import { materialTable } from '../sim/world/material-table.js';
import { meshChunk } from './meshing/greedy-mesher.js';
import { VoxelMaterials, packedVoxelGeometry, teamPrimaryMaterialIdentifier,
    teamSecondaryMaterialIdentifier } from './voxel-material.js';

export class VoxelModelBuilder {
    private readonly geometries = new Map<string, T.BufferGeometry>();
    private readonly paintIdentifiers = new Map<string, number>([
        ['team', teamPrimaryMaterialIdentifier], ['TEAM_PRIMARY', teamPrimaryMaterialIdentifier],
        ['team_dark', teamSecondaryMaterialIdentifier], ['TEAM_SECONDARY', teamSecondaryMaterialIdentifier]
    ]);
    private nextPaintIdentifier = materialTable.length;

    private readonly models: Readonly<Record<string, VoxelModelSpec>>;

    constructor(models: Readonly<Record<string, unknown>>, private readonly materials: VoxelMaterials) {
        this.models = Object.fromEntries(Object.entries(models)
            .map(([identifier, specification]) => [identifier, compileVoxelModel(specification)]));
    }

    geometry(identifier: string): T.BufferGeometry {
        const existing = this.geometries.get(identifier);
        if (existing !== undefined) return existing;
        const specification = this.specification(identifier);
        const [width, height, depth] = specification.size;
        const paddedWidth = width + 2, paddedDepth = depth + 2;
        const voxels = new Uint8Array(paddedWidth * (height + 2) * paddedDepth);
        for (const [x, y, z, paint] of specification.voxels)
            voxels[x + 1 + paddedWidth * (z + 1 + paddedDepth * (y + 1))] = this.paintIdentifier(paint);
        const geometry = packedVoxelGeometry(meshChunk({ voxels, size: specification.size,
            includeAmbientOcclusion: true }));
        this.geometries.set(identifier, geometry);
        return geometry;
    }

    specification(identifier: string): VoxelModelSpec {
        if (!Object.prototype.hasOwnProperty.call(this.models, identifier))
            throw new Error(`Unknown voxel model: ${identifier}`);
        return this.models[identifier];
    }

    create(identifier: string, material: T.Material): T.Group {
        const group = new THREE.Group(), mesh = new THREE.Mesh(this.geometry(identifier), material);
        const pivot = this.specification(identifier).pivot;
        mesh.position.set(-pivot[0], -pivot[1], -pivot[2]);
        mesh.castShadow = mesh.receiveShadow = true;
        group.add(mesh);
        return group;
    }

    dispose(): void {
        for (const geometry of this.geometries.values()) geometry.dispose();
        this.geometries.clear();
    }

    private paintIdentifier(paint: string): number {
        const existing = this.paintIdentifiers.get(paint);
        if (existing !== undefined) return existing;
        const colour = Object.prototype.hasOwnProperty.call(modelPaintColours, paint) ? modelPaintColours[paint]
            : /^#[0-9a-f]{6}$/i.test(paint) ? Number.parseInt(paint.slice(1), 16) : null;
        if (colour === null) throw new Error(`Unknown model paint: ${paint}`);
        if (this.nextPaintIdentifier >= teamPrimaryMaterialIdentifier) throw new Error('Model palette is full');
        const identifier = this.nextPaintIdentifier++;
        this.materials.setPaletteColour(identifier, colour, 0);
        this.paintIdentifiers.set(paint, identifier);
        return identifier;
    }
}
