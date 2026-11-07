import type * as T from 'three';
import { renderingQualityPresets, skyCubeFaceResolution, sunlightShadowBias,
    worldHeightInVoxels } from '../config.js';
import { createSkyCube, skyPreset } from './sky.js';

export type RenderingQuality = keyof typeof renderingQualityPresets;

export class SceneLighting {
    readonly group = new THREE.Group();
    readonly sun: T.DirectionalLight;
    readonly ambient: T.HemisphereLight;
    readonly preset: ReturnType<typeof skyPreset>;
    readonly sky: T.CubeTexture;
    private readonly previousBackground: T.Scene['background'];
    private readonly sunDirection: T.Vector3;

    constructor(private readonly scene: T.Scene, seed: number, mapEdgeLengthInVoxels: number,
        quality: RenderingQuality = 'high', preset = skyPreset(seed)) {
        this.preset = preset;
        this.sun = new THREE.DirectionalLight(this.preset.sunColour, this.preset.sunIntensity);
        this.ambient = new THREE.HemisphereLight(this.preset.cloudColour, this.preset.groundColour ?? 0x5b604c, this.preset.ambientIntensity);
        this.sunDirection = new THREE.Vector3(this.preset.sunDirection.x, this.preset.sunDirection.y,
            this.preset.sunDirection.z).normalize();
        this.sky = createSkyCube(seed, skyCubeFaceResolution, preset);
        this.previousBackground = scene.background;
        scene.background = this.sky;
        this.group.add(this.sun, this.sun.target, this.ambient);
        scene.add(this.group);
        // The shadow frustum encloses the whole map so terrain shadows are visible at any distance.
        const radius = Math.hypot(mapEdgeLengthInVoxels, mapEdgeLengthInVoxels, worldHeightInVoxels) / 2;
        const camera = this.sun.shadow.camera;
        camera.left = camera.bottom = -radius;
        camera.right = camera.top = radius;
        camera.near = 1;
        camera.far = radius * 2;
        camera.updateProjectionMatrix();
        this.sun.shadow.bias = sunlightShadowBias;
        this.sun.target.position.set(mapEdgeLengthInVoxels / 2, worldHeightInVoxels / 2, mapEdgeLengthInVoxels / 2);
        this.sun.position.copy(this.sunDirection).multiplyScalar(radius).add(this.sun.target.position);
        this.sun.target.updateMatrixWorld();
        this.setQuality(quality);
    }

    setQuality(quality: RenderingQuality): void {
        const size = renderingQualityPresets[quality].shadowMapSize;
        const mapSize = Math.max(1, size);
        this.sun.castShadow = size > 0;
        if (this.sun.shadow.mapSize.x !== mapSize) {
            this.releaseShadowTargets();
            this.sun.shadow.mapSize.set(mapSize, mapSize);
        }
        this.sun.shadow.needsUpdate = true;
    }

    dispose(): void {
        this.scene.remove(this.group);
        this.group.clear();
        if (this.scene.background === this.sky) this.scene.background = this.previousBackground;
        this.releaseShadowTargets();
        this.sky.dispose();
    }

    private releaseShadowTargets(): void {
        for (const target of [this.sun.shadow.map, this.sun.shadow.mapPass])
            if (target instanceof THREE.WebGLRenderTarget) target.dispose();
        // The r128 typings incorrectly exclude null for shadow targets.
        Object.assign(this.sun.shadow, { map: null, mapPass: null });
    }
}
