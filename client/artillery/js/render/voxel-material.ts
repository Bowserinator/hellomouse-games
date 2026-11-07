import type * as T from 'three';
import { materialTable } from '../sim/world/material-table.js';
import { explosionMaximumLightCount, terrainUnderwaterVariationMultiplier, worldWaterSurfaceHeightInVoxels,
    xrayTerrainOpacity } from '../config.js';
import { PackedVoxelMesh } from './meshing/greedy-mesher.js';

export const teamPrimaryMaterialIdentifier = 254;
export const teamSecondaryMaterialIdentifier = 255;

export function packedVoxelGeometry(mesh: PackedVoxelMesh): T.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 4, false));
    geometry.setAttribute('voxelInformation', new THREE.BufferAttribute(mesh.information, 4, false));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
}

const vertexDeclarations = `
attribute vec4 voxelInformation;
varying vec3 vVoxelWorldPosition;
varying vec3 vVoxelWorldNormal;
varying float vVoxelMaterial;
varying float vVoxelOcclusion;
#ifdef VOXEL_INSTANCE_COLOURS
attribute vec2 voxelInstanceColours;
varying vec2 vVoxelInstanceColours;
#endif
vec3 voxelFaceNormal(float face) {
    if (face < 0.5) return vec3(1.0, 0.0, 0.0);
    if (face < 1.5) return vec3(-1.0, 0.0, 0.0);
    if (face < 2.5) return vec3(0.0, 1.0, 0.0);
    if (face < 3.5) return vec3(0.0, -1.0, 0.0);
    if (face < 4.5) return vec3(0.0, 0.0, 1.0);
    return vec3(0.0, 0.0, -1.0);
}
`;
const fragmentDeclarations = `
uniform sampler2D uVoxelPalette;
uniform vec3 uTeamPrimary;
uniform vec3 uTeamSecondary;
uniform vec4 uExplosionLights[${explosionMaximumLightCount}];
uniform vec3 uExplosionColours[${explosionMaximumLightCount}];
uniform vec4 uScorchRegions[${explosionMaximumLightCount}];
uniform float uXrayAmount;
uniform float uXrayOpacity;
uniform float uTerrainMapEdge;
varying vec3 vVoxelWorldPosition;
varying vec3 vVoxelWorldNormal;
varying float vVoxelMaterial;
varying float vVoxelOcclusion;
#ifdef VOXEL_INSTANCE_COLOURS
varying vec2 vVoxelInstanceColours;
vec3 voxelPackedColour(float packed) {
    return pow(vec3(floor(packed / 65536.0), mod(floor(packed / 256.0), 256.0), mod(packed, 256.0)) / 255.0,
        vec3(2.2));
}
#endif
float voxelHash(vec3 cell) {
    return fract(sin(dot(cell, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
`;
const voxelColour = `
vec3 voxelNormal = normalize(vVoxelWorldNormal);
vec3 voxelCell = floor(vVoxelWorldPosition - voxelNormal * 0.5);
vec4 voxelPalette = texture2D(uVoxelPalette, vec2((vVoxelMaterial + 0.5) / 256.0, 0.5));
vec3 voxelBase = pow(voxelPalette.rgb, vec3(2.2));
vec3 voxelPrimary = uTeamPrimary, voxelSecondary = uTeamSecondary;
#ifdef VOXEL_INSTANCE_COLOURS
voxelPrimary = voxelPackedColour(vVoxelInstanceColours.x);
voxelSecondary = voxelPackedColour(vVoxelInstanceColours.y);
#endif
if (vVoxelMaterial > 253.5 && vVoxelMaterial < 254.5) voxelBase = voxelPrimary;
if (vVoxelMaterial > 254.5) voxelBase = voxelSecondary;
float voxelVariation = voxelPalette.a;
if (uTerrainMapEdge > 0.0 && voxelCell.y <= ${worldWaterSurfaceHeightInVoxels.toFixed(1)})
    voxelVariation = min(1.0, voxelVariation * ${terrainUnderwaterVariationMultiplier.toFixed(1)});
float voxelJitter = (voxelHash(voxelCell) * 2.0 - 1.0) * voxelVariation;
vec3 voxelHue = vec3(voxelHash(voxelCell + 19.0), voxelHash(voxelCell + 43.0),
    voxelHash(voxelCell + 97.0)) - 0.5;
diffuseColor.rgb *= max(vec3(0.0), voxelBase * (1.0 + voxelJitter) + voxelHue * voxelVariation * 0.12);
diffuseColor.rgb *= 0.55 + clamp(vVoxelOcclusion, 0.0, 3.0) * 0.15;
for (int scorchIndex = 0; scorchIndex < ${explosionMaximumLightCount}; scorchIndex++) {
    vec4 region = uScorchRegions[scorchIndex];
    float strength = (1.0 - smoothstep(0.0, max(region.w, 0.001),
        distance(vVoxelWorldPosition, region.xyz))) * step(0.001, region.w);
    diffuseColor.rgb *= 1.0 - strength * 0.65;
}
for (int lightIndex = 0; lightIndex < ${explosionMaximumLightCount}; lightIndex++) {
    vec4 light = uExplosionLights[lightIndex];
    vec3 difference = light.xyz - vVoxelWorldPosition;
    float lightDistance = length(difference);
    float attenuation = max(0.0, 1.0 - lightDistance / max(light.w, 0.001));
    float facing = max(0.0, dot(voxelNormal, difference / max(lightDistance, 0.001)));
    totalEmissiveRadiance += uExplosionColours[lightIndex] * attenuation * attenuation * (0.2 + 0.8 * facing);
}
diffuseColor.a *= mix(1.0, uXrayOpacity, uXrayAmount);
`;

export class VoxelMaterials {
    readonly palette: T.DataTexture;
    readonly explosionLights = Array.from({ length: explosionMaximumLightCount }, () => new THREE.Vector4());
    readonly explosionColours = Array.from({ length: explosionMaximumLightCount }, () => new THREE.Color(0));
    readonly scorchRegions = Array.from({ length: explosionMaximumLightCount }, () => new THREE.Vector4());
    private readonly paletteBytes = new Uint8Array(256 * 4);
    private readonly materials = new Set<T.MeshLambertMaterial>();
    private readonly terrainMaterials = new Set<T.MeshLambertMaterial>();
    private readonly xrayAmount = { value: 0 };
    private readonly mapEdge = { value: 0 };

    constructor() {
        this.palette = new THREE.DataTexture(this.paletteBytes, 256, 1, THREE.RGBAFormat);
        this.palette.magFilter = this.palette.minFilter = THREE.NearestFilter;
        this.palette.generateMipmaps = false;
        for (let index = 0; index < 256; index++) this.setPaletteColour(index, 0xffffff);
        materialTable.forEach((material, index) =>
            this.setPaletteColour(index, material.baseColour, material.colourVariationStrength));
    }

    setWorldBounds(mapEdgeLengthInVoxels: number): void {
        if (!Number.isFinite(mapEdgeLengthInVoxels) || mapEdgeLengthInVoxels <= 0)
            throw new RangeError('Invalid terrain map size');
        this.mapEdge.value = mapEdgeLengthInVoxels;
    }

    setPaletteColour(identifier: number, colour: number, variation = 0): void {
        if (!Number.isInteger(identifier) || identifier < 0 || identifier > 255 ||
            !Number.isInteger(colour) || colour < 0 || colour > 0xffffff ||
            !Number.isFinite(variation) || variation < 0 || variation > 1)
            throw new RangeError('Palette entry is invalid');
        const offset = identifier * 4;
        this.paletteBytes[offset] = (colour >>> 16) & 255;
        this.paletteBytes[offset + 1] = (colour >>> 8) & 255;
        this.paletteBytes[offset + 2] = colour & 255;
        this.paletteBytes[offset + 3] = Math.round(variation * 255);
        this.palette.needsUpdate = true;
    }

    create(isTerrain = true, primaryColour = 0xffffff, secondaryColour = 0x888888): T.MeshLambertMaterial {
        const material = new THREE.MeshLambertMaterial({ color: 0xffffff, toneMapped: false });
        const uniforms = {
            uVoxelPalette: { value: this.palette },
            uTeamPrimary: { value: new THREE.Color(primaryColour).convertSRGBToLinear() },
            uTeamSecondary: { value: new THREE.Color(secondaryColour).convertSRGBToLinear() },
            uExplosionLights: { value: this.explosionLights }, uExplosionColours: { value: this.explosionColours },
            uScorchRegions: { value: this.scorchRegions },
            uXrayAmount: isTerrain ? this.xrayAmount : { value: 0 }, uXrayOpacity: { value: xrayTerrainOpacity },
            uTerrainMapEdge: isTerrain ? this.mapEdge : { value: 0 }
        };
        material.onBeforeCompile = shader => {
            Object.assign(shader.uniforms, uniforms);
            shader.vertexShader = vertexDeclarations + shader.vertexShader
                .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = voxelFaceNormal(voxelInformation.z);')
                .replace('#include <begin_vertex>', `#include <begin_vertex>
                     vec4 voxelLocalPosition = vec4(transformed, 1.0);
                     vec3 voxelLocalNormal = objectNormal;
                     #ifdef USE_INSTANCING
                         voxelLocalPosition = instanceMatrix * voxelLocalPosition;
                         voxelLocalNormal = mat3(instanceMatrix) * voxelLocalNormal;
                     #endif
                     vVoxelWorldPosition = (modelMatrix * voxelLocalPosition).xyz;
                     vVoxelWorldNormal = normalize(mat3(modelMatrix) * voxelLocalNormal);
                    vVoxelMaterial = voxelInformation.x;
                    vVoxelOcclusion = voxelInformation.y;
                    #ifdef VOXEL_INSTANCE_COLOURS
                    vVoxelInstanceColours = voxelInstanceColours;
                    #endif`);
            shader.fragmentShader = fragmentDeclarations + shader.fragmentShader
                .replace('#include <color_fragment>', '#include <color_fragment>\n' + voxelColour);
        };
        material.customProgramCacheKey = () => 'artillery-packed-voxel-r128';
        this.materials.add(material);
        if (isTerrain) this.terrainMaterials.add(material);
        material.addEventListener('dispose', () => {
            this.materials.delete(material); this.terrainMaterials.delete(material);
        });
        this.setXray(this.xrayAmount.value);
        return material;
    }

    setXray(amount: number): void {
        this.xrayAmount.value = Math.max(0, Math.min(1, amount));
        const isTransparent = this.xrayAmount.value > 0;
        for (const material of this.terrainMaterials) {
            if (material.transparent !== isTransparent) material.needsUpdate = true;
            material.transparent = isTransparent;
            material.depthWrite = !isTransparent;
        }
    }

    dispose(): void {
        for (const material of this.materials) material.dispose();
        this.palette.dispose();
    }
}
