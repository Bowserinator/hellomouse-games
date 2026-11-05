import type * as T from 'three';
import { Rng } from '../sim/math/rng.js';
import { V3, clamp, dot, normalize, vec } from '../sim/math/vec3.js';
import { SkyType } from '../types.js';
import { cubeDirection } from './planet/sdf-bake.js';

const SUN = normalize(vec(), vec(-0.4, 0.8, 0.5));
const HORIZON = [0.74, 0.88, 1];
const ZENITH = [0.16, 0.44, 0.92];
const GROUND_HAZE = [0.62, 0.76, 0.92];

function hash3(x: number, y: number, z: number): number {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function valueNoise(x: number, y: number, z: number): number {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
    const at = (dx: number, dy: number, dz: number) => hash3(ix + dx, iy + dy, iz + dz);
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    return lerp(lerp(lerp(at(0, 0, 0), at(1, 0, 0), u), lerp(at(0, 1, 0), at(1, 1, 0), u), v),
        lerp(lerp(at(0, 0, 1), at(1, 0, 1), u), lerp(at(0, 1, 1), at(1, 1, 1), u), v), w);
}
function cloudCover(d: V3, offset: number): number {
    let sum = 0, amplitude = 0.5, frequency = 2.4;
    for (let octave = 0; octave < 4; octave++) {
        sum += valueNoise(d.x * frequency + offset, d.y * frequency * 1.6, d.z * frequency - offset) * amplitude;
        amplitude *= 0.5;
        frequency *= 2.1;
    }
    return sum;
}
const smooth = (a: number, b: number, x: number) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
};

/** Draws a blue sky with a sun glow and soft clouds */
function daySkyFaces(size: number): Array<HTMLCanvasElement> {
    const dir = vec(), offset = new Rng(2718).range(0, 100);
    return Array.from({ length: 6 }, (_, face) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const bytes = new Uint8ClampedArray(size * size * 4);
        for (let y = 0; y < size; y++)
            for (let x = 0; x < size; x++) {
                cubeDirection(face, 2 * (x + 0.5) / size - 1, 2 * (y + 0.5) / size - 1, dir);
                const elevation = dir.y;
                const rise = Math.pow(clamp(elevation, 0, 1), 0.55), sink = clamp(-elevation * 2, 0, 1);
                const color = [0, 1, 2].map(c => {
                    const sky = HORIZON[c] + (ZENITH[c] - HORIZON[c]) * rise;
                    return sky + (GROUND_HAZE[c] - sky) * sink;
                });
                const sunDot = Math.max(0, dot(dir, SUN));
                const glow = Math.pow(sunDot, 90) * 0.7 + Math.pow(sunDot, 8) * 0.14;
                const cloud = smooth(0.5, 0.78, cloudCover(dir, offset)) * smooth(-0.05, 0.3, elevation) * 0.85;
                const shade = 0.93 + 0.07 * sunDot;
                const i = (y * size + x) * 4;
                for (let c = 0; c < 3; c++) {
                    const lit = color[c] + glow * (c === 2 ? 0.8 : 1);
                    bytes[i + c] = (lit + (shade - lit) * cloud) * 255;
                }
                bytes[i + 3] = 255;
            }
        canvas.getContext('2d')!.putImageData(new ImageData(bytes, size, size), 0, 0);
        return canvas;
    });
}

const STAR_BACKDROP = [[8, 12, 32], [19, 18, 39], [3, 6, 16]];
const STAR_GRADIENT = normalize(vec(), vec(0.6, 0.5, 0.62));

/** Cube face and [-1, 1] face coordinates that a direction points at */
function cubeFace(d: V3): { face: number; u: number; v: number } {
    const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
    if (ax >= ay && ax >= az) return d.x > 0 ? { face: 0, u: -d.z / ax, v: -d.y / ax }
        : { face: 1, u: d.z / ax, v: -d.y / ax };
    if (ay >= az) return d.y > 0 ? { face: 2, u: d.x / ay, v: d.z / ay } : { face: 3, u: d.x / ay, v: -d.z / ay };
    return d.z > 0 ? { face: 4, u: d.x / az, v: -d.y / az } : { face: 5, u: -d.x / az, v: -d.y / az };
}

/** Draws a dark gradient backdrop that is continuous across faces, with stars scattered over the whole sphere */
function starSkyFaces(size: number, count: number, rng: Rng): Array<HTMLCanvasElement> {
    const dir = vec();
    const faces = Array.from({ length: 6 }, (_, face) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const bytes = new Uint8ClampedArray(size * size * 4);
        for (let y = 0; y < size; y++)
            for (let x = 0; x < size; x++) {
                cubeDirection(face, 2 * (x + 0.5) / size - 1, 2 * (y + 0.5) / size - 1, dir);
                const t = 0.5 + 0.5 * dot(dir, STAR_GRADIENT), upper = t > 0.5;
                const from = STAR_BACKDROP[upper ? 1 : 0], to = STAR_BACKDROP[upper ? 2 : 1];
                const k = upper ? (t - 0.5) * 2 : t * 2, i = (y * size + x) * 4;
                for (let c = 0; c < 3; c++) bytes[i + c] = from[c] + (to[c] - from[c]) * k;
                bytes[i + 3] = 255;
            }
        const ctx = canvas.getContext('2d')!;
        ctx.putImageData(new ImageData(bytes, size, size), 0, 0);
        return { canvas, ctx };
    });
    for (let i = 0; i < count; i++) {
        const { face, u, v } = cubeFace(rng.unitVec()), ctx = faces[face].ctx;
        ctx.globalAlpha = rng.range(0.2, 0.9);
        ctx.fillStyle = rng.pick(['#ffffff', '#b7d9ff', '#ffd4a3']);
        ctx.fillRect((u + 1) / 2 * size, (v + 1) / 2 * size, rng.range(0.5, 1.6), 1);
    }
    return faces.map(face => face.canvas);
}

export class Sky {
    points: T.Points<T.BufferGeometry, T.ShaderMaterial>;
    cube: T.CubeTexture;
    /** Texture drawn behind the scene, or null for the default space backdrop */
    background: T.CubeTexture | null = null;
    readonly cubes: Array<T.CubeTexture>;
    private starCube: T.CubeTexture;
    private dayCube: T.CubeTexture;
    constructor(low: boolean) {
        const rng = new Rng(314159), n = low ? 1300 : 2600;
        const pos = new Float32Array(n * 3), colors = new Float32Array(n * 3), phases = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const d = rng.unitVec();
            const c = new THREE.Color().setHSL(rng.pick([0.07, 0.58, 0.7]), 0.25, rng.range(0.65, 1));
            pos.set([d.x * 900, d.y * 900, d.z * 900], i * 3);
            colors.set([c.r, c.g, c.b], i * 3);
            phases[i] = rng.range(0, 100);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        g.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
        this.points = new THREE.Points(g, new THREE.ShaderMaterial({
            uniforms: { time: { value: 0 }, pixel: { value: 1 } }, vertexColors: true,
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
            vertexShader: `attribute float phase; uniform float time,pixel; varying vec3 vC; varying float vBright;
                void main(){vC=color;vBright=.65+.35*sin(time*(.5+fract(phase))+phase);
                    gl_PointSize=(1.+fract(phase*7.)*2.5)*pixel;
                    gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
            fragmentShader: `varying vec3 vC;varying float vBright;
                void main(){vec2 p=gl_PointCoord-.5;float r=length(p);float a=exp(-r*12.);
                    a+=.12*exp(-min(abs(p.x),abs(p.y))*90.)*(1.-smoothstep(.1,.5,r));
                    gl_FragColor=vec4(vC,vBright*a);}`
        }));
        this.points.frustumCulled = false;
        this.starCube = new THREE.CubeTexture(starSkyFaces(low ? 256 : 512, 2700, rng));
        this.starCube.needsUpdate = true;
        this.dayCube = new THREE.CubeTexture(daySkyFaces(low ? 256 : 384));
        this.dayCube.needsUpdate = true;
        this.cube = this.starCube;
        this.cubes = [this.starCube, this.dayCube];
    }
    setKind(kind: SkyType): void {
        const day = kind === SkyType.DAY;
        this.cube = day ? this.dayCube : this.starCube;
        this.background = day ? this.dayCube : null;
        this.points.visible = !day;
    }
    update(time: number, pixel: number, camera: T.Camera): void {
        this.points.material.uniforms.time.value = time;
        this.points.material.uniforms.pixel.value = pixel;
        this.points.position.copy(camera.position);
    }
    dispose(): void {
        this.points.geometry.dispose();
        this.points.material.dispose();
        this.starCube.dispose();
        this.dayCube.dispose();
    }
}
