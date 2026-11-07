import type * as T from 'three';
import { FullscreenPass, RenderTargetPool, fullscreenVertexShader } from '../../../../shared/ts/fullscreen-pass.js';
import { Rng } from '../../../../shared/ts/seeded-random.js';
import { bloomThreshold, bloomSoftKnee, bloomIntensity, bloomBoostMaximum, bloomBoostDecayPerSecond,
    shockwaveMaximumCount, shockwaveDurationInSeconds, shockwaveThicknessFraction, ditherTextureSize,
    oceanFogDensity, oceanMaximumFogDensity, skyDriftRadiansPerSecond, renderingQualityPresets,
    oceanRenderHeightInVoxels, oceanEdgeFadeWidthInVoxels, xrayBackgroundColour } from '../../config.js';
import { Vector3 } from '../../sim/math/vector3.js';
import { transparentEffectsLayer } from '../effects-layer.js';
import { RenderingQuality } from '../scene-lighting.js';
import { skyPreset } from '../sky.js';
import { compositeFragmentShader, skyBackgroundFragmentShader } from './composite-shader.js';
import { shockwaveFragmentShader, bloomDownsampleFragmentShader, bloomUpsampleFragmentShader,
    finishFragmentShader } from './post-shaders.js';

export class PostProcess {
    readonly usesHighDynamicRange: boolean;
    private readonly sceneTarget: T.WebGLRenderTarget;
    private readonly effectsTarget: T.WebGLRenderTarget;
    private readonly pool: RenderTargetPool;
    private readonly fullscreen: FullscreenPass;
    private readonly composite: T.ShaderMaterial;
    private readonly background: T.ShaderMaterial;
    private readonly distortion: T.ShaderMaterial;
    private readonly downsample: T.ShaderMaterial;
    private readonly upsample: T.ShaderMaterial;
    private readonly finish: T.ShaderMaterial;
    private readonly dither: T.DataTexture;
    private readonly inverseProjection = new THREE.Matrix4();
    private readonly cameraWorld = new THREE.Matrix4();
    private readonly cameraPosition = new THREE.Vector3();
    private readonly projected = new THREE.Vector3();
    private readonly edge = new THREE.Vector3();
    private readonly cameraRight = new THREE.Vector3();
    private readonly viewPosition = new THREE.Vector3();
    private readonly resolution = new THREE.Vector2(1, 1);
    private readonly clearColour = new THREE.Color();
    private readonly rings = Array.from({ length: shockwaveMaximumCount }, () => new THREE.Vector4());
    private readonly strengths = new Float32Array(shockwaveMaximumCount);
    private readonly shockwaves = Array.from({ length: shockwaveMaximumCount }, () => ({
        position: new THREE.Vector3(), age: shockwaveDurationInSeconds, radius: 0, strength: 0
    }));
    private composition!: T.WebGLRenderTarget;
    private distorted!: T.WebGLRenderTarget;
    private down: Array<T.WebGLRenderTarget> = [];
    private upsamples: Array<T.WebGLRenderTarget> = [];
    private width = 0;
    private height = 0;
    private boost = 0;
    private disposed = false;

    constructor(private readonly renderer: T.WebGLRenderer, sky: T.CubeTexture,
        preset: ReturnType<typeof skyPreset>, private quality: RenderingQuality = 'high', mapEdgeLengthInVoxels = 0) {
        if (!renderer.capabilities.isWebGL2 && !renderer.extensions.has('WEBGL_depth_texture'))
            throw new Error('Depth textures are required for Artillery rendering');
        this.usesHighDynamicRange = renderer.capabilities.isWebGL2
            ? renderer.extensions.has('EXT_color_buffer_float')
            : renderer.extensions.has('EXT_color_buffer_half_float') &&
                renderer.extensions.has('OES_texture_half_float') && renderer.extensions.has('OES_texture_half_float_linear');
        const options = { type: this.usesHighDynamicRange ? THREE.HalfFloatType : THREE.UnsignedByteType,
            minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, stencilBuffer: false };
        this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, options);
        this.sceneTarget.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
        this.effectsTarget = new THREE.WebGLRenderTarget(1, 1, options);
        this.effectsTarget.depthTexture = this.sceneTarget.depthTexture;
        this.pool = new RenderTargetPool({ ...options, depthBuffer: false });
        const material = (fragmentShader: string, uniforms: Record<string, T.IUniform>): T.ShaderMaterial =>
            new THREE.ShaderMaterial({ vertexShader: fullscreenVertexShader, fragmentShader, uniforms,
                depthTest: false, depthWrite: false });
        this.composite = material(compositeFragmentShader, {
            uScene: { value: this.sceneTarget.texture }, uDepth: { value: this.sceneTarget.depthTexture },
            uEffects: { value: this.effectsTarget.texture },
            uSky: { value: sky }, uInverseProjection: { value: this.inverseProjection },
            uCameraWorld: { value: this.cameraWorld }, uSunDirection: { value: new THREE.Vector3(
                preset.sunDirection.x, preset.sunDirection.y, preset.sunDirection.z).normalize() },
            uFogColour: { value: new THREE.Color(preset.horizonColour).convertSRGBToLinear() },
            uTexel: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
            uWaterHeight: { value: oceanRenderHeightInVoxels }, uFogDensity: { value: oceanFogDensity },
            uMapEdge: { value: mapEdgeLengthInVoxels }, uEdgeFadeWidth: { value: oceanEdgeFadeWidthInVoxels },
            uSkyRotation: { value: 0 }, uStarDensity: { value: preset.starDensity ?? 0 }, uWaterStrength: { value: 1 }, uLightLevel: { value: preset.lightLevel ?? 1 }, uXrayAmount: { value: 0 }
        });
        this.background = material(skyBackgroundFragmentShader, {
            uSky: this.composite.uniforms.uSky, uInverseProjection: this.composite.uniforms.uInverseProjection,
            uCameraWorld: this.composite.uniforms.uCameraWorld, uSkyRotation: this.composite.uniforms.uSkyRotation,
            uStarDensity: this.composite.uniforms.uStarDensity, uXrayAmount: this.composite.uniforms.uXrayAmount,
            uXrayBackground: { value: new THREE.Color(xrayBackgroundColour).convertSRGBToLinear() }
        });
        this.distortion = material(shockwaveFragmentShader, { uScene: { value: null },
            uResolution: { value: this.resolution }, uRings: { value: this.rings },
            uStrengths: { value: this.strengths } });
        const threshold = this.usesHighDynamicRange ? bloomThreshold : bloomThreshold * .7;
        this.downsample = material(bloomDownsampleFragmentShader, { uScene: { value: null },
            uTexel: { value: new THREE.Vector2() }, uPrefilter: { value: false },
            uThreshold: { value: threshold }, uKnee: { value: threshold * bloomSoftKnee } });
        this.upsample = material(bloomUpsampleFragmentShader, { uLow: { value: null },
            uHigh: { value: null }, uTexel: { value: new THREE.Vector2() } });
        this.dither = this.createDitherTexture();
        this.finish = material(finishFragmentShader, { uScene: { value: null }, uBloom: { value: null },
            uDither: { value: this.dither }, uResolution: { value: this.resolution },
            uBloomIntensity: { value: bloomIntensity } });
        this.fullscreen = new FullscreenPass(this.finish);
        this.setSize(1, 1);
    }

    setSize(width: number, height: number): void {
        if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1)
            throw new RangeError('Invalid post-processing size');
        width = Math.min(this.renderer.capabilities.maxTextureSize, Math.floor(width));
        height = Math.min(this.renderer.capabilities.maxTextureSize, Math.floor(height));
        if (this.width === width && this.height === height &&
            this.down.length === renderingQualityPresets[this.quality].bloomMipCount) return;
        this.width = width;
        this.height = height;
        this.resolution.set(width, height);
        this.composite.uniforms.uTexel.value.set(1 / width, 1 / height);
        this.sceneTarget.setSize(width, height);
        this.effectsTarget.setSize(width, height);
        this.pool.dispose();
        this.composition = this.pool.acquire(width, height);
        this.distorted = this.pool.acquire(width, height);
        this.down.length = this.upsamples.length = 0;
        const preset = renderingQualityPresets[this.quality];
        for (let index = 0; index < preset.bloomMipCount; index++) {
            const scale = preset.bloomScale / Math.pow(2, index);
            const mipWidth = Math.max(1, Math.floor(width * scale));
            const mipHeight = Math.max(1, Math.floor(height * scale));
            this.down.push(this.pool.acquire(mipWidth, mipHeight));
            if (index < preset.bloomMipCount - 1) this.upsamples.push(this.pool.acquire(mipWidth, mipHeight));
        }
    }

    setQuality(quality: RenderingQuality): void {
        if (this.quality === quality) return;
        this.quality = quality;
        this.setSize(this.width, this.height);
    }

    setFogDensity(density: number): void {
        if (!Number.isFinite(density) || density < 0 || density > oceanMaximumFogDensity)
            throw new RangeError('Invalid fog density');
        this.composite.uniforms.uFogDensity.value = density;
    }

    setXray(amount: number): void {
        if (!Number.isFinite(amount)) throw new Error('Invalid x-ray amount');
        const value = THREE.MathUtils.clamp(amount, 0, 1);
        this.composite.uniforms.uWaterStrength.value = 1 - value;
        this.composite.uniforms.uXrayAmount.value = value;
    }

    addExplosion(position: Vector3, radius: number, strength = 1): void {
        if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(strength) || strength < 0 ||
            !Number.isFinite(position.x + position.y + position.z)) return;
        const count = renderingQualityPresets[this.quality].shockwaveCount;
        let selected = this.shockwaves[0];
        for (let index = 1; index < count; index++)
            if (this.shockwaves[index].age > selected.age) selected = this.shockwaves[index];
        selected.position.set(position.x, position.y, position.z);
        selected.age = 0;
        selected.radius = radius;
        selected.strength = strength;
        const distance = this.cameraPosition.distanceTo(selected.position);
        this.boost = Math.min(bloomBoostMaximum, this.boost + strength * radius / Math.max(radius, distance));
    }

    render(scene: T.Scene, camera: T.Camera, elapsedSeconds: number, deltaSeconds: number,
        target: T.WebGLRenderTarget | null = null): void {
        if (this.disposed) throw new Error('Post-processing has been disposed');
        camera.updateMatrixWorld();
        this.inverseProjection.copy(camera.projectionMatrix).invert();
        this.cameraWorld.copy(camera.matrixWorld);
        this.cameraPosition.setFromMatrixPosition(camera.matrixWorld);
        this.cameraRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
        const delta = Math.max(0, Math.min(deltaSeconds, .25));
        this.boost *= Math.exp(-bloomBoostDecayPerSecond * delta);
        this.composite.uniforms.uTime.value = elapsedSeconds;
        this.composite.uniforms.uSkyRotation.value = elapsedSeconds * skyDriftRadiansPerSecond;
        this.updateShockwaves(camera, delta);
        const previousTarget = this.renderer.getRenderTarget(), previousAutoClear = this.renderer.autoClear;
        const previousToneMapping = this.renderer.toneMapping, previousEncoding = this.renderer.outputEncoding;
        const previousBackground = scene.background, previousLayers = camera.layers.mask;
        try {
            this.renderer.autoClear = true;
            this.renderer.toneMapping = THREE.NoToneMapping;
            this.renderer.outputEncoding = THREE.LinearEncoding;
            // Draw sky first so transparent effects are retained even where the depth buffer is empty.
            this.fullscreen.render(this.renderer, this.background, this.sceneTarget);
            this.renderer.autoClear = false;
            scene.background = null;
            camera.layers.set(0);
            this.renderer.render(scene, camera);
            // Transparent effects are depth-tested against the opaque scene but kept out of the water pass.
            this.renderer.setRenderTarget(this.effectsTarget);
            const previousClearAlpha = this.renderer.getClearAlpha();
            this.renderer.getClearColor(this.clearColour);
            this.renderer.setClearColor(0x000000, 0);
            this.renderer.clearColor();
            this.renderer.setClearColor(this.clearColour, previousClearAlpha);
            camera.layers.set(transparentEffectsLayer);
            this.renderer.render(scene, camera);
            camera.layers.mask = previousLayers;
            scene.background = previousBackground;
            this.renderer.autoClear = true;
            this.fullscreen.render(this.renderer, this.composite, this.composition);
            this.distortion.uniforms.uScene.value = this.composition.texture;
            this.fullscreen.render(this.renderer, this.distortion, this.distorted);
            let input = this.distorted;
            for (let index = 0; index < this.down.length; index++) {
                this.downsample.uniforms.uScene.value = input.texture;
                this.downsample.uniforms.uTexel.value.set(1 / input.width, 1 / input.height);
                this.downsample.uniforms.uPrefilter.value = index === 0;
                this.fullscreen.render(this.renderer, this.downsample, this.down[index]);
                input = this.down[index];
            }
            for (let index = this.upsamples.length - 1; index >= 0; index--) {
                this.upsample.uniforms.uLow.value = input.texture;
                this.upsample.uniforms.uHigh.value = this.down[index].texture;
                this.upsample.uniforms.uTexel.value.set(1 / input.width, 1 / input.height);
                this.fullscreen.render(this.renderer, this.upsample, this.upsamples[index]);
                input = this.upsamples[index];
            }
            this.finish.uniforms.uScene.value = this.distorted.texture;
            this.finish.uniforms.uBloom.value = input.texture;
            this.finish.uniforms.uBloomIntensity.value = bloomIntensity + this.boost;
            this.fullscreen.render(this.renderer, this.finish, target);
        } finally {
            camera.layers.mask = previousLayers;
            scene.background = previousBackground;
            this.renderer.setRenderTarget(previousTarget);
            this.renderer.autoClear = previousAutoClear;
            this.renderer.toneMapping = previousToneMapping;
            this.renderer.outputEncoding = previousEncoding;
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.sceneTarget.dispose();
        this.effectsTarget.dispose();
        this.pool.dispose();
        this.fullscreen.dispose();
        this.dither.dispose();
        this.background.dispose(); this.composite.dispose(); this.distortion.dispose(); this.downsample.dispose();
        this.upsample.dispose(); this.finish.dispose();
    }

    private updateShockwaves(camera: T.Camera, delta: number): void {
        const count = renderingQualityPresets[this.quality].shockwaveCount;
        for (let index = 0; index < shockwaveMaximumCount; index++) {
            const wave = this.shockwaves[index];
            wave.age += delta;
            this.strengths[index] = 0;
            if (index >= count || wave.age >= shockwaveDurationInSeconds) continue;
            this.viewPosition.copy(wave.position).applyMatrix4(camera.matrixWorldInverse);
            if (this.viewPosition.z >= 0) continue;
            const progress = wave.age / shockwaveDurationInSeconds;
            this.projected.copy(wave.position).project(camera);
            this.edge.copy(wave.position).addScaledVector(this.cameraRight, wave.radius * progress).project(camera);
            const radius = Math.hypot((this.edge.x - this.projected.x) * this.width / this.height,
                this.edge.y - this.projected.y) * .5;
            this.rings[index].set(this.projected.x * .5 + .5, this.projected.y * .5 + .5,
                radius, Math.max(1 / this.height, radius * shockwaveThicknessFraction));
            this.strengths[index] = wave.strength * (1 - progress) * .015;
        }
    }

    private createDitherTexture(): T.DataTexture {
        const size = ditherTextureSize, count = size * size, random = new Rng(8003);
        const white = Float32Array.from({ length: count }, () => random.float());
        const highPass = new Float32Array(count);
        const order = Array.from(white.keys());
        for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
            const index = column + row * size;
            highPass[index] = white[index] - (white[(column + 1) % size + row * size] +
                white[(column + size - 1) % size + row * size] + white[column + (row + 1) % size * size] +
                white[column + (row + size - 1) % size * size]) * .25;
        }
        order.sort((left, right) => highPass[left] - highPass[right]);
        const pixels = new Uint8Array(count * 4);
        for (let rank = 0; rank < count; rank++) {
            const index = order[rank] * 4, value = Math.floor(rank * 256 / count);
            pixels[index] = pixels[index + 1] = pixels[index + 2] = value;
            pixels[index + 3] = 255;
        }
        const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.needsUpdate = true;
        return texture;
    }
}
