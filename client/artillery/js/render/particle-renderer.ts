import type * as T from 'three';
import { sunlightDirection } from '../config.js';
import { additiveEffectBlending, transparentEffectsLayer } from './effects-layer.js';
import { ParticlePool } from './particle-pool.js';

export const particleKinds = ['debris', 'smoke', 'fire', 'sparks'] as const;
export type ParticleKind = typeof particleKinds[number];

const vertexShader = `
    attribute vec4 particlePositionAge;
    attribute vec4 particleVelocityLife;
    attribute vec4 particleSizeSpinGlow;
    attribute vec2 particleColours;
    uniform vec3 uSunDirection;
    uniform float uLightLevel;
    varying vec3 vColour;
    varying float vAlpha;
    varying vec2 vParticleUv;
    vec3 unpackColour(float colour) {
        return pow(vec3(floor(colour / 65536.), mod(floor(colour / 256.), 256.),
            mod(colour, 256.)) / 255., vec3(2.2));
    }
    void main() {
        float progress = clamp(particlePositionAge.w / particleVelocityLife.w, 0., 1.);
        float size = mix(particleSizeSpinGlow.x, particleSizeSpinGlow.y, progress);
        float angle = particleSizeSpinGlow.z * particlePositionAge.w;
        mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
        vec3 colour = mix(unpackColour(particleColours.x), unpackColour(particleColours.y), progress);
        vec4 centre = modelViewMatrix * vec4(particlePositionAge.xyz, 1.);
        #if PARTICLE_KIND == 0
            vec3 local = position * size;
            local.xz = rotation * local.xz;
            vec3 rotatedNormal = normal;
            rotatedNormal.xz = rotation * rotatedNormal.xz;
            vec3 worldNormal = normalize(mat3(modelMatrix) * rotatedNormal);
            centre += viewMatrix * modelMatrix * vec4(local, 0.);
            colour *= .4 + .6 * max(0., dot(worldNormal, uSunDirection));
        #elif PARTICLE_KIND == 3
            vec2 direction = (viewMatrix * modelMatrix * vec4(particleVelocityLife.xyz, 0.)).xy;
            float speed = length(direction);
            direction = speed > .0001 ? direction / speed : vec2(0., 1.);
            centre.xy += vec2(direction.y, -direction.x) * position.x * size + direction *
                position.y * size * (1. + speed * .08);
        #else
            centre.xy += rotation * position.xy * size;
        #endif
        #if PARTICLE_KIND < 2
            colour *= uLightLevel;
        #endif
        gl_Position = projectionMatrix * centre;
        vParticleUv = position.xy + .5;
        vColour = colour;
        #if PARTICLE_KIND >= 2
            vColour *= particleSizeSpinGlow.w;
        #endif
        vAlpha = 1. - progress;
    }
`;

const fragmentShader = `
    varying vec3 vColour;
    varying float vAlpha;
    varying vec2 vParticleUv;
    void main() {
        #if PARTICLE_KIND == 0
            gl_FragColor = vec4(vColour, 1.);
        #else
            float softness = 1. - smoothstep(.15, .5, length(vParticleUv - .5));
            float alpha = softness * vAlpha;
            if (alpha < .005) discard;
            gl_FragColor = vec4(vColour, alpha);
        #endif
    }
`;

export class ParticleRenderer {
    readonly geometry = new THREE.InstancedBufferGeometry();
    readonly material: T.ShaderMaterial;
    readonly mesh: T.Mesh<T.InstancedBufferGeometry, T.ShaderMaterial>;
    private readonly positionAge: T.InstancedBufferAttribute;
    private readonly velocityLife: T.InstancedBufferAttribute;
    private readonly sizeSpinGlow: T.InstancedBufferAttribute;
    private readonly colours: T.InstancedBufferAttribute;
    private readonly streams: ReadonlyArray<T.InstancedBufferAttribute>;

    constructor(readonly pool: ParticlePool, readonly kind: ParticleKind) {
        const base = kind === 'debris' ? new THREE.BoxGeometry(1, 1, 1) : new THREE.PlaneGeometry(1, 1);
        this.geometry.setIndex(base.getIndex());
        this.geometry.setAttribute('position', base.getAttribute('position'));
        this.geometry.setAttribute('normal', base.getAttribute('normal'));
        base.dispose();
        const attribute = (size: number): T.InstancedBufferAttribute =>
            new THREE.InstancedBufferAttribute(new Float32Array(pool.capacity * size), size)
                .setUsage(THREE.DynamicDrawUsage);
        this.positionAge = attribute(4);
        this.velocityLife = attribute(4);
        this.sizeSpinGlow = attribute(4);
        this.colours = attribute(2);
        this.streams = [this.positionAge, this.velocityLife, this.sizeSpinGlow, this.colours];
        this.geometry.setAttribute('particlePositionAge', this.positionAge);
        this.geometry.setAttribute('particleVelocityLife', this.velocityLife);
        this.geometry.setAttribute('particleSizeSpinGlow', this.sizeSpinGlow);
        this.geometry.setAttribute('particleColours', this.colours);
        this.geometry.instanceCount = 0;
        this.material = new THREE.ShaderMaterial({ vertexShader, fragmentShader,
            defines: { PARTICLE_KIND: particleKinds.indexOf(kind) },
            uniforms: { uSunDirection: { value: new THREE.Vector3(sunlightDirection.x,
                sunlightDirection.y, sunlightDirection.z).normalize() }, uLightLevel: { value: 1 } },
            transparent: kind !== 'debris', depthWrite: kind === 'debris',
            ...(kind === 'fire' || kind === 'sparks' ? additiveEffectBlending() : { blending: THREE.NormalBlending }) });
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        if (kind !== 'debris') this.mesh.layers.set(transparentEffectsLayer);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = kind === 'debris' ? 0 : kind === 'smoke' ? 5 : 6;
    }

    update(): void {
        const pool = this.pool, count = pool.liveCount;
        for (let index = 0; index < count; index++) {
            const triple = index * 3;
            this.positionAge.setXYZW(index, pool.positions[triple], pool.positions[triple + 1],
                pool.positions[triple + 2], pool.ages[index]);
            this.velocityLife.setXYZW(index, pool.velocities[triple], pool.velocities[triple + 1],
                pool.velocities[triple + 2], pool.lifetimes[index]);
            this.sizeSpinGlow.setXYZW(index, pool.startSizes[index], pool.endSizes[index], pool.spins[index],
                pool.glows[index]);
            this.colours.setXY(index, pool.startColours[index], pool.endColours[index]);
        }
        this.geometry.instanceCount = count;
        for (let index = 0; index < this.streams.length; index++) {
            const stream = this.streams[index];
            stream.updateRange.offset = 0;
            stream.updateRange.count = count * stream.itemSize;
            if (count > 0) stream.needsUpdate = true;
        }
    }

    dispose(): void {
        this.geometry.dispose();
        this.material.dispose();
        this.mesh.parent?.remove(this.mesh);
    }
}
