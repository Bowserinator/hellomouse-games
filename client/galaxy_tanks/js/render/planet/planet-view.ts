import type * as T from 'three';
import { CoreType, ShapeKind, SurfaceType } from '../../types.js';
import { ObstacleDesc, PlanetDesc } from '../../sim/mapgen/map-desc.js';
import { SolidField } from '../../sim/mapgen/solid-field.js';
import { Rng } from '../../sim/math/rng.js';
import { fromTuple, rotate, tangentBasis, vec } from '../../sim/math/vec3.js';
import { BLACK_HOLE_RADIUS_FRAC, GLOW_MASK_ALPHA, LAVA_SURFACE_INSET } from '../../vars.js';
import { mergeGeometry } from '../geometry.js';
import { bakeSdf, cubeDirection } from './sdf-bake.js';
import { contactShadow } from './contact-shadow.js';
import { surfaceMaterial } from './surface-material.js';
import { DIRT_STYLE, STONE_STYLE, makeTextures } from './surface-styles.js';

/** Draws layers hidden under the planet surface after it, so they cost nothing where covered */
const HIDDEN_ORDER = 1;
const box = (d: ObstacleDesc) => new THREE.BoxGeometry(d.size[0], d.height, d.size[1]);
export const SHAPE_BUILDERS: Record<ShapeKind, (d: ObstacleDesc) => T.BufferGeometry> = {
    [ShapeKind.BOX]: box,
    [ShapeKind.WALL_SEGMENT]: box,
    [ShapeKind.CYLINDER]: d => new THREE.CylinderGeometry(d.size[0] / 2, d.size[0] / 2, d.height, 12),
    [ShapeKind.CONE]: d => new THREE.ConeGeometry(d.size[0] / 2, d.height, 10),
    [ShapeKind.ROCK]: d => {
        const g = new THREE.IcosahedronGeometry(1, 1), pos = g.getAttribute('position'), rng = new Rng(d.variant);
        for (let i = 0; i < pos.count; i++) {
            const n = 0.9 + rng.float() * 0.15;
            pos.setXYZ(i, pos.getX(i) * d.size[0] / 2 * n, pos.getY(i) * d.height / 2 * n,
                pos.getZ(i) * d.size[2] / 2 * n);
        }
        g.computeVertexNormals();
        return g;
    },
    [ShapeKind.ZIGGURAT]: d => mergeGeometry([1, 0.7, 0.4].map((f, i) =>
        new THREE.BoxGeometry(d.size[0] * f, d.height / 3, d.size[2] * f).translate(0, (i - 1) * d.height / 3, 0))),
    [ShapeKind.CAPSULE_PILLAR]: d => {
        const radius = Math.min(d.size[0] / 2, d.height / 2);
        return mergeGeometry([
            new THREE.CylinderGeometry(radius, radius, Math.max(0.01, d.height - radius * 2), 10),
            new THREE.SphereGeometry(radius, 10, 8).translate(0, d.height / 2 - radius, 0),
            new THREE.SphereGeometry(radius, 10, 8).translate(0, -d.height / 2 + radius, 0)
        ]);
    }
};
export function rimGeometry(field: SolidField, radius: number, thickness: number, steps: number): T.BufferGeometry {
    const positions: Array<number> = [], dir = vec();
    for (let face = 0; face < 6; face++)
        for (let y = 0; y < steps; y++)
            for (let x = 0; x < steps; x++) {
                const corners = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
                const values = corners.map(([cx, cy]) =>
                    field.signedDistance(cubeDirection(face, cx / steps * 2 - 1, cy / steps * 2 - 1, dir)));
                const hits: Array<T.Vector3> = [];
                for (let e = 0; e < 4; e++) {
                    const next = (e + 1) % 4;
                    if ((values[e] < 0) === (values[next] < 0)) continue;
                    const f = values[e] / (values[e] - values[next]);
                    const u = (corners[e][0] + (corners[next][0] - corners[e][0]) * f) / steps * 2 - 1;
                    const v = (corners[e][1] + (corners[next][1] - corners[e][1]) * f) / steps * 2 - 1;
                    cubeDirection(face, u, v, dir);
                    hits.push(new THREE.Vector3(dir.x, dir.y, dir.z));
                }
                for (let i = 0; i + 1 < hits.length; i += 2) {
                    const a = hits[i].clone().multiplyScalar(radius), b = hits[i + 1].clone().multiplyScalar(radius);
                    const c = hits[i].clone().multiplyScalar(radius - thickness);
                    const d = hits[i + 1].clone().multiplyScalar(radius - thickness);
                    for (const p of [a, b, c, c, b, d]) positions.push(p.x, p.y, p.z);
                }
            }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    return geometry;
}
const CORE_FLOW = `
        float t=flowTime*1.1;
        vec3 p=vP*26.+vec3(t*.9,-t*.7,t*.8);
        vec3 q=p+vec3(sin(p.y*.8+t*.6),sin(p.z*.7-t*.8),sin(p.x*.9+t*.5))*1.8;
        q+=vec3(sin(q.z*1.7-t*1.1),sin(q.x*1.5+t*.9),sin(q.y*1.9-t))*.6;
        float f=(sin(q.x*1.13+sin(q.y*.93+t*.7))+sin(q.y*1.31+sin(q.z*1.07-t*.6))+
            sin(q.z*.89+sin(q.x*1.27+t*.8)))/6.+.5;
        f+=(.5+.5*sin(q.x*3.1+q.y*2.3+sin(q.z*2.7+t*1.4)*1.3)-.5)*.18;
        f+=.07*sin(flowTime*1.6+q.x*.9+q.z*.7);
`;
export const CORE_VIEWS: Record<CoreType, { color: number; fragment: string }> = {
    [CoreType.BLACK_HOLE]: { color: 0xffad4c, fragment: `
        vec3 c=vec3(0.);` },
    [CoreType.LAVA]: { color: 0xff7019, fragment: `
        float flowTime=time;
        ${CORE_FLOW}
        vec3 c=mix(vec3(.55,.06,.01),vec3(1.,.36,.03),smoothstep(.15,.55,f));
        c=mix(c,vec3(1.,.8,.22),smoothstep(.55,.95,f)*.85);
        c+=vec3(1.,.55,.1)*pow(smoothstep(.7,1.,f),2.)*.5;` },
    [CoreType.DARK_MATTER]: { color: 0x9d4fff, fragment: `
        float flowTime=time/3.;
        ${CORE_FLOW}
        vec3 c=mix(vec3(26./255.),vec3(.38,.035,.6),smoothstep(.65,.72,f));
        c=mix(c,vec3(.62,.17,.85),smoothstep(.85,1.,f)*.7);` }
};
export class PlanetView {
    root = new THREE.Group();
    occluders: Array<T.Object3D> = [];
    core: T.Mesh<T.SphereGeometry, T.ShaderMaterial> | null = null;
    private accretion?: T.Mesh<T.PlaneGeometry, T.ShaderMaterial>;
    private start?: number;
    constructor(public desc: PlanetDesc, sky: T.CubeTexture, low: boolean,
        textures: ReturnType<typeof makeTextures>, stoneTextures: ReturnType<typeof makeTextures>) {
        this.root.position.fromArray(desc.center);
        const field = new SolidField(desc.holes, desc.radius), bake = bakeSdf(field, low ? 128 : 192);
        const canvases = bake.faces.map(bytes => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = bake.size;
            canvas.getContext('2d')!.putImageData(new ImageData(bytes, bake.size, bake.size), 0, 0);
            return canvas;
        });
        const sdf = new THREE.CubeTexture(canvases);
        sdf.needsUpdate = true;
        sdf.minFilter = sdf.magFilter = THREE.LinearFilter;
        sdf.generateMipmaps = false;
        const material = surfaceMaterial(desc, textures.albedo, textures.bump, sky, sdf);
        this.root.add(new THREE.Mesh(new THREE.SphereGeometry(desc.radius, low ? 48 : 72, low ? 32 : 48), material));
        if (desc.holes?.length) {
            const thickness = desc.crustThickness ?? 3;
            if (desc.core?.kind !== CoreType.DARK_MATTER) {
                const inner = surfaceMaterial(desc, textures.albedo, textures.bump, sky, sdf,
                    undefined, { pattern: false });
                inner.side = THREE.DoubleSide;
                if (desc.core?.kind !== CoreType.BLACK_HOLE) inner.uniforms.uUnderside.value = 1;
                const bottom = new THREE.Mesh(new THREE.SphereGeometry(desc.radius - thickness, 72, 48), inner);
                bottom.name = 'Crust underside';
                bottom.renderOrder = HIDDEN_ORDER;
                this.root.add(bottom);
            }
            const soil = desc.surface === SurfaceType.GRASS ? DIRT_STYLE : undefined;
            const wall = soil ? stoneTextures : textures;
            const rim = surfaceMaterial(desc, wall.albedo, wall.bump, sky, sdf, soil, { pattern: false });
            rim.side = THREE.DoubleSide;
            rim.uniforms.uHoles.value = 0;
            if (desc.core?.kind === CoreType.LAVA) {
                rim.uniforms.uGlow.value = 1;
                rim.uniforms.uGlowRange.value.set(desc.radius, thickness);
            }
            this.root.add(new THREE.Mesh(rimGeometry(field, desc.radius + 0.015, thickness, low ? 64 : 128), rim));
            if (desc.core) {
                const def = CORE_VIEWS[desc.core.kind];
                const alpha = desc.core.kind === CoreType.LAVA ? GLOW_MASK_ALPHA : 1;
                const coreMaterial = new THREE.ShaderMaterial({
                    uniforms: { time: { value: 0 }, tint: { value: new THREE.Color(def.color) } },
                    vertexShader: `varying vec3 vP; void main(){vP=normalize(position);
                        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
                    fragmentShader: `uniform float time; uniform vec3 tint; varying vec3 vP;
                        void main(){${def.fragment} gl_FragColor=vec4(c,${alpha.toFixed(3)});}`
                });
                this.core = new THREE.Mesh(new THREE.SphereGeometry(
                    desc.core.kind === CoreType.BLACK_HOLE ? (desc.radius - thickness) * BLACK_HOLE_RADIUS_FRAC
                        : desc.radius - thickness - LAVA_SURFACE_INSET, 40, 24), coreMaterial);
                this.core.renderOrder = HIDDEN_ORDER;
                this.root.add(this.core);
                if (desc.core.kind === CoreType.BLACK_HOLE) {
                    const extent = desc.radius - thickness;
                    coreMaterial.colorWrite = coreMaterial.depthWrite = false;
                    this.accretion = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
                        uniforms: { time: { value: 0 },
                            size: { value: extent * BLACK_HOLE_RADIUS_FRAC } },
                        transparent: true, depthWrite: false,
                        vertexShader: `uniform float size;varying vec2 vUv;
                            void main(){vUv=position.xy;
                                vec4 mv=modelViewMatrix*vec4(0.,0.,0.,1.);mv.xy+=position.xy*size;
                                gl_Position=projectionMatrix*mv;}`,
                        fragmentShader: `uniform float time;varying vec2 vUv;
                            void main(){
                                float rn=length(vUv),rr=rn/.3,a=atan(vUv.y,vUv.x);
                                float phase=a*5.+log(rr)*7.-time*9.;
                                phase+=.9*sin(a*3.+rr*3.-time*4.2);
                                float streak=pow(.5+.5*sin(phase),1.5);
                                float fade=1.-smoothstep(.35,1.,rn);
                                vec3 c=mix(vec3(1.,.22,.02),vec3(1.,.5,.08),smoothstep(.3,.6,rn));
                                c=mix(c,vec3(.45,.1,.55),smoothstep(.45,.85,rn));
                                c*=.3+.7*streak;
                                float alpha=fade*(.45+.55*streak)*smoothstep(1.,1.1,rr);
                                float ring=exp(-pow((rr-1.07)*11.,2.))*(.65+.35*sin(a*2.-time*12.));
                                c+=ring*vec3(1.,.5,.1);
                                alpha=max(alpha,ring);
                                float inner=1.-smoothstep(.97,1.04,rr);
                                c*=1.-inner;alpha=max(alpha,inner);
                                gl_FragColor=vec4(c,alpha);}`
                    }));
                    this.accretion.frustumCulled = false;
                    this.root.add(this.accretion);
                }
            }
        }
        const geometries = desc.obstacles.map(d => {
            const geometry = SHAPE_BUILDERS[d.kind](d), dir = fromTuple(d.dir);
            const embed = .12 + (d.size[0] ** 2 + d.size[1] ** 2) / (8 * desc.radius);
            geometry.scale(1, 1 + embed / d.height, 1);
            const [x, z] = tangentBasis(dir);
            rotate(x, x, dir, d.yaw);
            rotate(z, z, dir, d.yaw);
            geometry.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(x.x, x.y, x.z),
                new THREE.Vector3(dir.x, dir.y, dir.z), new THREE.Vector3(z.x, z.y, z.z)));
            const height = desc.radius + (d.height - embed) / 2;
            geometry.translate(dir.x * height, dir.y * height, dir.z * height);
            return geometry;
        });
        if (geometries.length) {
            const keepsSurface = desc.surface === SurfaceType.PLASTIC || desc.surface === SurfaceType.MIRROR;
            const options = { pattern: false, occlusion: true };
            const obstacleMaterial = keepsSurface
                ? surfaceMaterial(desc, textures.albedo, textures.bump, sky, sdf, undefined, options)
                : surfaceMaterial(desc, stoneTextures.albedo, stoneTextures.bump, sky, sdf, STONE_STYLE, options);
            const obstacles = new THREE.Mesh(mergeGeometry(geometries), obstacleMaterial);
            this.occluders.push(obstacles);
            this.root.add(obstacles);
            const shadow = desc.surface === SurfaceType.MIRROR ? null : contactShadow(desc, sdf);
            if (shadow) this.root.add(shadow);
        }
    }
    update(time: number, frustum: T.Frustum): void {
        if (this.start === undefined) this.start = time;
        const local = time - this.start;
        if (this.accretion) this.accretion.material.uniforms.time.value = local;
        if (this.core) {
            this.core.visible = frustum.intersectsObject(this.core);
            if (this.accretion) this.accretion.visible = this.core.visible;
            if (this.core.visible) this.core.material.uniforms.time.value = local;
        }
    }
}
