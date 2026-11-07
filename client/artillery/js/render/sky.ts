import type * as T from 'three';
import { Rng } from '../../../shared/ts/seeded-random.js';
import { cloudCover } from '../../../shared/ts/value-noise.js';
import { SkyPreset, skyCubeFaceResolution, skyCloudSoftness, skySunAngularRadiusInDegrees,
    skyPresets } from '../config.js';
import { ThemeSky } from '../sim/world/themes.js';

export function skyPreset(seed: number): typeof skyPresets[number] {
    return skyPresets[Math.floor(new Rng(seed).fork(8002).float() * skyPresets.length)];
}

/** Moves the preset's colours toward the theme's, keeping dark presets dark. */
export function themedSkyPreset(preset: Readonly<SkyPreset>, sky: Readonly<ThemeSky>): Readonly<SkyPreset> {
    const strength = sky.strength ?? 1, brightness = preset.lightLevel ?? 1;
    const blend = (base: number, target: number | undefined): number => {
        if (target === undefined) return base;
        let result = 0;
        for (const shift of [16, 8, 0]) {
            const from = (base >> shift) & 255, to = Math.round(((target >> shift) & 255) * brightness);
            result |= Math.round(from + (to - from) * strength) << shift;
        }
        return result;
    };
    return { ...preset, zenithColour: blend(preset.zenithColour, sky.zenithColour),
        horizonColour: blend(preset.horizonColour, sky.horizonColour),
        cloudColour: blend(preset.cloudColour, sky.cloudColour),
        sunColour: blend(preset.sunColour, sky.sunColour),
        ...sky.lightLevelScale === undefined ? {} : { lightLevel: brightness * sky.lightLevelScale } };
}

export function createSkyCube(seed: number, resolution = skyCubeFaceResolution,
    preset = skyPreset(seed)): T.CubeTexture {
    if (!Number.isInteger(resolution) || resolution < 2 || resolution > 512)
        throw new RangeError('Invalid sky cube resolution');
    const zenith = new THREE.Color(preset.zenithColour), horizon = new THREE.Color(preset.horizonColour);
    const clouds = new THREE.Color(preset.cloudColour), colour = new THREE.Color();
    const disc = new THREE.Color(preset.sunDiscColour ?? preset.cloudColour);
    const direction = new THREE.Vector3(), sun = new THREE.Vector3(preset.sunDirection.x,
        preset.sunDirection.y, preset.sunDirection.z).normalize();
    const offset = new Rng(seed).fork(8001).range(0, 1000);
    const sunEdge = Math.cos(skySunAngularRadiusInDegrees * Math.PI / 180);
    const faces: Array<T.DataTexture> = [];
    for (let face = 0; face < 6; face++) {
        const pixels = new Uint8Array(resolution * resolution * 4);
        for (let row = 0; row < resolution; row++) for (let column = 0; column < resolution; column++) {
            const horizontal = (column + .5) / resolution * 2 - 1;
            const vertical = (row + .5) / resolution * 2 - 1;
            switch (face) {
                case 0: direction.set(1, -vertical, -horizontal); break;
                case 1: direction.set(-1, -vertical, horizontal); break;
                case 2: direction.set(horizontal, 1, vertical); break;
                case 3: direction.set(horizontal, -1, -vertical); break;
                case 4: direction.set(horizontal, -vertical, 1); break;
                case 5: direction.set(-horizontal, -vertical, -1); break;
            }
            direction.normalize();
            colour.copy(horizon).lerp(zenith, Math.pow(Math.max(0, direction.y), .65));
            const cloud = THREE.MathUtils.smoothstep(cloudCover(direction, offset),
                preset.cloudThreshold, preset.cloudThreshold + skyCloudSoftness) *
                THREE.MathUtils.smoothstep(direction.y, -.02, .2);
            colour.lerp(clouds, cloud * .88);
            const sunAmount = THREE.MathUtils.smoothstep(direction.dot(sun), sunEdge - .001, sunEdge);
            colour.lerp(disc, sunAmount);
            const index = (column + resolution * row) * 4;
            pixels[index] = Math.round(colour.r * 255);
            pixels[index + 1] = Math.round(colour.g * 255);
            pixels[index + 2] = Math.round(colour.b * 255);
            pixels[index + 3] = 255;
        }
        faces.push(new THREE.DataTexture(pixels, resolution, resolution, THREE.RGBAFormat));
    }
    const texture = new THREE.CubeTexture(faces);
    texture.format = THREE.RGBAFormat;
    texture.encoding = THREE.sRGBEncoding;
    texture.needsUpdate = true;
    texture.addEventListener('dispose', () => faces.forEach(face => face.dispose()));
    return texture;
}
