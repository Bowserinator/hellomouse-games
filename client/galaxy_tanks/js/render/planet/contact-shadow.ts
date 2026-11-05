import type * as T from 'three';
import { PlanetDesc } from '../../sim/mapgen/map-desc.js';
import { fromTuple, rotate, tangentBasis } from '../../sim/math/vec3.js';

const SEGMENTS = 16, PAD = 1.3, STRENGTH = 0.38;
/** Outline rings around the footprint as [outward offset, relative darkness] */
const RINGS = [[0, 1], [PAD * 0.5, 0.45], [PAD, 0]];

/** One merged mesh of soft dark patches hugging the base of every obstacle */
export function contactShadow(desc: PlanetDesc, sdf: T.CubeTexture): T.Mesh | null {
    if (!desc.obstacles.length) return null;
    const positions: Array<number> = [], alphas: Array<number> = [], indices: Array<number> = [];
    const lift = desc.radius + 0.03;
    const push = (x: number, y: number, z: number, alpha: number) => {
        const k = lift / Math.hypot(x, y, z);
        positions.push(x * k, y * k, z * k); alphas.push(alpha); return alphas.length - 1;
    };
    for (const o of desc.obstacles) {
        const dir = fromTuple(o.dir), [x, z] = tangentBasis(dir);
        rotate(x, x, dir, o.yaw); rotate(z, z, dir, o.yaw);
        const at = (a: number, b: number) => push(
            dir.x * desc.radius + x.x * a + z.x * b, dir.y * desc.radius + x.y * a + z.y * b,
            dir.z * desc.radius + x.z * a + z.z * b, 0);
        const center = push(dir.x * desc.radius, dir.y * desc.radius, dir.z * desc.radius, STRENGTH);
        const rings = RINGS.map(([offset, strength]) => Array.from({ length: SEGMENTS }, (_, i) => {
            const t = i / SEGMENTS * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
            const index = at(Math.sign(c) * Math.sqrt(Math.abs(c)) * (o.size[0] / 2 + offset),
                Math.sign(s) * Math.sqrt(Math.abs(s)) * (o.size[1] / 2 + offset));
            alphas[index] = strength * STRENGTH; return index;
        }));
        for (let i = 0; i < SEGMENTS; i++) {
            const j = (i + 1) % SEGMENTS;
            indices.push(center, rings[0][j], rings[0][i]);
            for (let r = 0; r < rings.length - 1; r++)
                indices.push(rings[r][i], rings[r][j], rings[r + 1][i], rings[r][j], rings[r + 1][j], rings[r + 1][i]);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aAlpha', new THREE.Float32BufferAttribute(alphas, 1));
    geometry.setIndex(indices);
    const mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
        uniforms: { uSdf: { value: sdf }, uHoles: { value: Number(Boolean(desc.holes?.length)) } },
        transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        vertexShader: `attribute float aAlpha; varying float vAlpha; varying vec3 vP;
            void main() { vAlpha=aAlpha; vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
        fragmentShader: `uniform samplerCube uSdf; uniform float uHoles; varying float vAlpha; varying vec3 vP;
            void main() {
                if(uHoles>.5 && textureCube(uSdf,normalize(vP)).r<.5) discard;
                gl_FragColor=vec4(0.,0.,0.,vAlpha);
            }`
    }));
    mesh.renderOrder = 1; return mesh;
}
