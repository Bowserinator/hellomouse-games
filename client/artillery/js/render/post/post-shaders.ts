import { shockwaveMaximumCount, ditherTextureSize } from '../../config.js';

export const shockwaveFragmentShader = `
    uniform sampler2D uScene;
    uniform vec2 uResolution;
    uniform vec4 uRings[${shockwaveMaximumCount}];
    uniform float uStrengths[${shockwaveMaximumCount}];
    varying vec2 vUv;
    void main() {
        vec2 offset = vec2(0.);
        float aspect = uResolution.x / uResolution.y;
        for (int index = 0; index < ${shockwaveMaximumCount}; index++) {
            vec4 ring = uRings[index];
            vec2 delta = (vUv - ring.xy) * vec2(aspect, 1.);
            float distance = length(delta);
            float envelope = 1. - smoothstep(0., max(ring.w, .00001), abs(distance - ring.z));
            offset += delta / max(distance, .00001) / vec2(aspect, 1.) *
                sin((distance - ring.z) / max(ring.w, .00001) * 3.14159265) * envelope * uStrengths[index];
        }
        gl_FragColor = texture2D(uScene, clamp(vUv + offset, vec2(0.), vec2(1.)));
    }
`;

export const bloomDownsampleFragmentShader = `
    uniform sampler2D uScene;
    uniform vec2 uTexel;
    uniform bool uPrefilter;
    uniform float uThreshold;
    uniform float uKnee;
    varying vec2 vUv;
    vec3 sampleColour(vec2 offset) { return texture2D(uScene, vUv + offset * uTexel).rgb; }
    void main() {
        vec3 first = sampleColour(vec2(-.5, -.5));
        vec3 second = sampleColour(vec2(.5, -.5));
        vec3 third = sampleColour(vec2(-.5, .5));
        vec3 fourth = sampleColour(vec2(.5, .5));
        vec3 colour;
        if (uPrefilter) {
            vec3 luma = vec3(.2126, .7152, .0722);
            vec4 weights = 1. / (1. + vec4(dot(first, luma), dot(second, luma),
                dot(third, luma), dot(fourth, luma)));
            colour = (first * weights.x + second * weights.y + third * weights.z + fourth * weights.w) /
                (weights.x + weights.y + weights.z + weights.w);
            float brightness = max(colour.r, max(colour.g, colour.b));
            float knee = max(uKnee, .00001);
            float soft = clamp(brightness - uThreshold + knee, 0., 2. * knee);
            soft = soft * soft / (4. * knee);
            colour *= max(soft, brightness - uThreshold) / max(brightness, .00001);
        } else colour = (first + second + third + fourth) * .25;
        gl_FragColor = vec4(colour, 1.);
    }
`;

export const bloomUpsampleFragmentShader = `
    uniform sampler2D uLow;
    uniform sampler2D uHigh;
    uniform vec2 uTexel;
    varying vec2 vUv;
    void main() {
        vec3 colour = texture2D(uLow, vUv).rgb * 4.;
        colour += (texture2D(uLow, vUv + uTexel * vec2(-1., 0.)).rgb +
            texture2D(uLow, vUv + uTexel * vec2(1., 0.)).rgb +
            texture2D(uLow, vUv + uTexel * vec2(0., -1.)).rgb +
            texture2D(uLow, vUv + uTexel * vec2(0., 1.)).rgb) * 2.;
        colour += texture2D(uLow, vUv + uTexel * vec2(-1., -1.)).rgb +
            texture2D(uLow, vUv + uTexel * vec2(1., -1.)).rgb +
            texture2D(uLow, vUv + uTexel * vec2(-1., 1.)).rgb +
            texture2D(uLow, vUv + uTexel * vec2(1., 1.)).rgb;
        gl_FragColor = vec4(texture2D(uHigh, vUv).rgb + colour / 16., 1.);
    }
`;

export const finishFragmentShader = `
    uniform sampler2D uScene;
    uniform sampler2D uBloom;
    uniform sampler2D uDither;
    uniform vec2 uResolution;
    uniform float uBloomIntensity;
    varying vec2 vUv;
    vec3 colourAt(vec2 uv) {
        vec3 colour = texture2D(uScene, uv).rgb + texture2D(uBloom, uv).rgb * uBloomIntensity;
        colour = clamp((colour * (2.51 * colour + .03)) / (colour * (2.43 * colour + .59) + .14), 0., 1.);
        return mix(colour * 12.92, 1.055 * pow(colour, vec3(1. / 2.4)) - .055, step(vec3(.0031308), colour));
    }
    void main() {
        vec2 texel = 1. / uResolution;
        vec3 centre = colourAt(vUv);
        vec3 northWest = colourAt(vUv + vec2(-1., -1.) * texel);
        vec3 northEast = colourAt(vUv + vec2(1., -1.) * texel);
        vec3 southWest = colourAt(vUv + vec2(-1., 1.) * texel);
        vec3 southEast = colourAt(vUv + vec2(1., 1.) * texel);
        vec3 luma = vec3(.299, .587, .114);
        float nw = dot(northWest, luma), ne = dot(northEast, luma);
        float sw = dot(southWest, luma), se = dot(southEast, luma), mid = dot(centre, luma);
        vec2 direction = vec2(-((nw + ne) - (sw + se)), (nw + sw) - (ne + se));
        float reduce = max((nw + ne + sw + se) * .03125, .0078125);
        direction = clamp(direction / (min(abs(direction.x), abs(direction.y)) + reduce), -8., 8.) * texel;
        vec3 first = (colourAt(vUv + direction * (-1. / 6.)) + colourAt(vUv + direction * (1. / 6.))) * .5;
        vec3 second = first * .5 + (colourAt(vUv - direction * .5) + colourAt(vUv + direction * .5)) * .25;
        float secondLuma = dot(second, luma);
        float minimum = min(mid, min(min(nw, ne), min(sw, se)));
        float maximum = max(mid, max(max(nw, ne), max(sw, se)));
        vec3 colour = secondLuma < minimum || secondLuma > maximum ? first : second;
        vec2 edge = vUv * (1. - vUv);
        colour *= .93 + .07 * pow(clamp(edge.x * edge.y * 16., 0., 1.), .3);
        float dither = texture2D(uDither, gl_FragCoord.xy / ${ditherTextureSize.toFixed(1)}).r - .5;
        gl_FragColor = vec4(clamp(colour + dither / 255., 0., 1.), 1.);
    }
`;
