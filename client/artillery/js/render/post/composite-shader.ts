import { oceanDepthBandWidthInVoxels, oceanFoamRadiusInVoxels, oceanFoamReachDepthInVoxels, oceanFoamWaveCount,
    oceanFoamWaveSpeed, oceanReflectionBandCount, oceanReflectionBrightnessBoost } from '../../config.js';

const worldRayShader = `
    uniform samplerCube uSky;
    uniform mat4 uInverseProjection;
    uniform mat4 uCameraWorld;
    uniform float uSkyRotation;
    uniform float uStarDensity;
    varying vec2 vUv;
    vec3 worldPoint(vec2 coordinates, float depth) {
        vec4 view = uInverseProjection * vec4(coordinates * 2. - 1., depth * 2. - 1., 1.);
        return (uCameraWorld * vec4(view.xyz / view.w, 1.)).xyz;
    }
    float starHash(vec3 cell) {
        cell = fract(cell * .3183099 + .1) * 17.;
        return fract(cell.x * cell.y * cell.z * (cell.x + cell.y + cell.z));
    }
    vec3 starLight(vec3 direction) {
        vec3 point = direction * 250.;
        vec3 cell = floor(point);
        if (starHash(cell) >= uStarDensity) return vec3(0.);
        vec3 centre = vec3(starHash(cell + 17.3), starHash(cell + 41.7), starHash(cell + 73.1)) * .5 + .25;
        float spot = 1. - smoothstep(.1, .22, length(fract(point) - centre));
        float brightness = .35 + .55 * starHash(cell + 5.9);
        return vec3(.85, .9, 1.) * spot * brightness * smoothstep(0., .15, direction.y);
    }
    vec3 sky(vec3 direction) {
        float cosine = cos(uSkyRotation), sine = sin(uSkyRotation);
        direction.xz = mat2(cosine, -sine, sine, cosine) * direction.xz;
        vec3 colour = pow(textureCube(uSky, direction).rgb, vec3(2.2));
        if (uStarDensity > 0.) {
            float cover = clamp(1. - dot(colour, vec3(.2126, .7152, .0722)) * 14., 0., 1.);
            colour += starLight(direction) * cover;
        }
        return colour;
    }
`;

export const skyBackgroundFragmentShader = `${worldRayShader}
    uniform float uXrayAmount;
    uniform vec3 uXrayBackground;
    void main() {
        vec3 direction = normalize(worldPoint(vUv, 1.) - worldPoint(vUv, 0.));
        gl_FragColor = vec4(mix(sky(direction), uXrayBackground, uXrayAmount), 1.);
    }
`;

export const compositeFragmentShader = `${worldRayShader}
    uniform sampler2D uScene;
    uniform sampler2D uDepth;
    uniform sampler2D uEffects;
    uniform vec3 uSunDirection;
    uniform vec3 uFogColour;
    uniform vec3 uLiquidAbsorption;
    uniform vec3 uLiquidScatter;
    uniform vec3 uFoamColour;
    uniform float uLiquidEmissive;
    uniform vec2 uTexel;
    uniform float uTime;
    uniform float uWaterHeight;
    uniform float uWaterStrength;
    uniform float uLightLevel;
    uniform float uFogDensity;
    uniform float uXrayAmount;
    uniform float uMapEdge;
    uniform float uEdgeFadeWidth;
    float hash(vec2 point) {
        return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise(vec2 point) {
        vec2 cell = floor(point), blend = fract(point);
        blend = blend * blend * (3. - 2. * blend);
        return mix(mix(hash(cell), hash(cell + vec2(1., 0.)), blend.x),
            mix(hash(cell + vec2(0., 1.)), hash(cell + vec2(1.)), blend.x), blend.y);
    }
    float waves(vec2 point) {
        return noise(point * .12 + vec2(uTime * .035, 0.)) * .6 +
            noise(point * .31 + vec2(0., -uTime * .06)) * .28 +
            noise(point * .81 + vec2(uTime * .09)) * .12;
    }
    float shoreLandCoverage(vec3 origin, vec3 direction, float planeDistance, vec3 waterPoint) {
        float pixelSize = planeDistance * length(normalize(worldPoint(vUv + vec2(uTexel.x, 0.), 1.) - origin) - direction);
        float worldRadius = ${oceanFoamRadiusInVoxels.toFixed(1)};
        vec2 reach = uTexel * clamp(worldRadius / max(pixelSize, .0001), 2., 48.);
        float land = 0.;
        for (int index = 0; index < 20; index++) {
            float angle = float(index) * 2.399963, radius = sqrt((float(index) + .5) / 20.);
            vec2 tap = clamp(vUv + vec2(cos(angle), sin(angle)) * radius * reach, uTexel, 1. - uTexel);
            float tapDepth = texture2D(uDepth, tap).r;
            if (tapDepth >= .999999) continue;
            vec3 tapPoint = worldPoint(tap, tapDepth);
            // Land only counts when it is actually close to this water point, not merely close on screen
            if (tapPoint.y > uWaterHeight && tapPoint.y < uWaterHeight + worldRadius &&
                distance(tapPoint, waterPoint) < worldRadius * 1.5) land += 1.;
        }
        return land / 20.;
    }
    float liquidLight() {
        return mix(uLightLevel, 1., uLiquidEmissive);
    }
    vec3 absorption(vec3 colour, float column) {
        vec3 transmission = exp(-uLiquidAbsorption * max(column, 0.));
        return colour * transmission + uLiquidScatter * liquidLight() * (1. - transmission);
    }
    void main() {
        float depth = texture2D(uDepth, vUv).r;
        vec3 origin = worldPoint(vUv, 0.);
        vec3 direction = normalize(worldPoint(vUv, 1.) - origin);
        vec3 scenePoint = worldPoint(vUv, depth);
        float sceneDistance = depth >= .999999 ? 1e7 : max(0., dot(scenePoint - origin, direction));
        vec3 sceneColour = texture2D(uScene, vUv).rgb;
        vec3 colour = sceneColour;
        float planeDistance = abs(direction.y) > .000001 ? (uWaterHeight - origin.y) / direction.y : -1.;
        bool covered = origin.y >= uWaterHeight && planeDistance > 0. && planeDistance < sceneDistance;
        float hazeDistance = sceneDistance;
        if (covered) {
            vec3 point = origin + direction * planeDistance;
            float column = depth >= .999999 ? 200. : max(0., (sceneDistance - planeDistance) * -direction.y);
            if (uMapEdge > 0.) {
                float edgeDistance = min(min(point.x, point.z), min(uMapEdge - point.x, uMapEdge - point.z));
                float edgeFade = 1. - smoothstep(0., uEdgeFadeWidth, max(0., edgeDistance));
                column = mix(column, 200., edgeFade);
            }
            float sampleStep = .3;
            vec3 normal = normalize(vec3((waves(point.xz - vec2(sampleStep, 0.)) -
                waves(point.xz + vec2(sampleStep, 0.))) * 1.4, 1.,
                (waves(point.xz - vec2(0., sampleStep)) - waves(point.xz + vec2(0., sampleStep))) * 1.4));
            vec2 refractedUv = clamp(vUv + normal.xz * .012 * min(column, 3.), uTexel, 1. - uTexel);
            float refractedDepth = texture2D(uDepth, refractedUv).r;
            vec3 refractedPoint = worldPoint(refractedUv, refractedDepth);
            vec3 refracted = refractedDepth < .999999 && refractedPoint.y < uWaterHeight
                ? texture2D(uScene, refractedUv).rgb : texture2D(uScene, vUv).rgb;
            float fresnel = .025 + .975 * pow(1. - clamp(dot(-direction, normal), 0., 1.), 5.);
            const float depthBand = ${oceanDepthBandWidthInVoxels.toFixed(3)};
            vec3 water = absorption(refracted, floor(column / depthBand + .5) * depthBand);
            float sunHighlight = step(.5, pow(max(0., dot(reflect(-uSunDirection, normal), -direction)), 64.));
            float reflectance = clamp(max(fresnel, sunHighlight), 0., 1.);
            const float bandCount = ${oceanReflectionBandCount.toFixed(1)};
            colour = water * (1. + ${oceanReflectionBrightnessBoost.toFixed(3)} * floor(reflectance * bandCount + .5) / bandCount);
            float foam = 0.;
            if (column < ${oceanFoamReachDepthInVoxels.toFixed(1)}) {
                float shoreDistance = 1. - clamp(shoreLandCoverage(origin, direction, planeDistance, point) * 2., 0., 1.);
                float ripple = fract(shoreDistance * ${oceanFoamWaveCount.toFixed(1)} - uTime * ${oceanFoamWaveSpeed.toFixed(3)} +
                    (waves(point.xz * .6) - .5) * .35);
                float lip = step(shoreDistance, .12);
                foam = step(.25, max(step(ripple, .22) * (1. - shoreDistance), lip)) * step(shoreDistance, .999);
            }
            colour = mix(colour, uFoamColour * liquidLight(), foam * .8);
            hazeDistance = planeDistance;
        } else if (origin.y < uWaterHeight) {
            float column = planeDistance > 0. ? min(sceneDistance, planeDistance) : sceneDistance;
            colour = absorption(colour, min(column, 200.));
        } else if (depth < .999999 && scenePoint.y < uWaterHeight) {
            colour = absorption(colour, uWaterHeight - scenePoint.y);
        }
        colour = mix(sceneColour, colour, uWaterStrength);
        float haze = (1. - exp(-hazeDistance * uFogDensity)) * (1. - uXrayAmount);
        if (depth < .999999 || covered) colour = mix(colour, uFogColour, clamp(haze, 0., 1.));
        vec4 effects = texture2D(uEffects, vUv);
        colour = colour * (1. - effects.a) + effects.rgb;
        gl_FragColor = vec4(colour, 1.);
    }
`;
