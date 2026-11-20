import type * as T from 'three';
import type { World } from '../mapx.js';
import { ENTITY as E, MAX_ENTITIES, RENDER_ENTITY_WORDS as STRIDE } from '../sim/layout.js';
import { entities } from '../sim/entity/registry.js';
import { Q } from '../sim/fixed.js';
import { elevation } from '../editor/world.js';
import { ScreenCopy } from './fx/screen-copy.js';

interface Bubble {
    generation: number;
    sphere: T.Mesh<T.SphereGeometry, T.ShaderMaterial>;
    ripple: T.Mesh<T.BufferGeometry, T.ShaderMaterial>;
}
export class Sonic {
    readonly scene = new THREE.Scene();
    private copy = new ScreenCopy();
    private bubbles = new Map<number, Bubble>();
    private sphere = new THREE.SphereGeometry(1, 48, 24);
    private frustum = new THREE.Frustum();
    private matrix = new THREE.Matrix4();
    private bound = new THREE.Sphere();
    private visible = false;
    constructor(private world: World, private mainScene: T.Scene) {}
    private create(x: number, z: number, radius: number, generation: number): Bubble {
        const uniforms = { screen: { value: this.copy.texture }, resolution: { value: this.copy.size },
            time: { value: 0 }, power: { value: 1 }, radius: { value: radius } };
        // The dome is only a proxy volume: the shader traces the view ray through it and refracts the
        // screen copy by the ray's thickness inside the dome, so strength fades to zero at the silhouette
        // and no surface, rim or tint is ever drawn. Air pulses travel outward in phase with the ground rings.
        const material = new THREE.ShaderMaterial({ transparent: true, depthTest: true, depthWrite: false,
            side: THREE.DoubleSide, uniforms,
            vertexShader: `varying vec3 wp,vc;varying vec2 sc;void main(){vec4 w=modelMatrix*vec4(position,1.);
                wp=w.xyz;vc=(modelMatrix*vec4(0.,0.,0.,1.)).xyz;
                vec4 pc=projectionMatrix*viewMatrix*vec4(vc,1.);sc=pc.xy/pc.w*.5+.5;
                gl_Position=projectionMatrix*viewMatrix*w;}`,
            fragmentShader: `uniform sampler2D screen;uniform vec2 resolution;uniform float time,power,radius;
                varying vec3 wp,vc;varying vec2 sc;void main(){
                vec3 ro=(cameraPosition-vc)/radius,rd=normalize(wp-cameraPosition);
                if((dot(ro,ro)>1.)!=gl_FrontFacing)discard;
                float b=dot(ro,rd),h=b*b-(dot(ro,ro)-1.);if(h<=0.)discard;
                float s=sqrt(h),t0=max(0.,-b-s),t1=-b+s;
                if(rd.y<0.){float tg=-ro.y/rd.y;if(tg>0.)t1=min(t1,tg);}
                if(t1<=t0)discard;
                float thick=(t1-t0)*.5;
                vec3 mid=ro+rd*(t0+t1)*.5;float r=length(mid.xz)*radius;
                float pulse=pow(max(0.,cos((r-time*2.5)/4.*6.283185)),12.)*(1.-pow(clamp(r/radius,0.,1.),3.));
                vec3 m=mid*radius;
                vec2 shimmer=vec2(sin(m.x*1.7+time*5.)*sin(m.y*2.3+time*3.),cos(m.z*1.9-time*4.)*sin(m.y*2.1-time*3.));
                vec2 dir=normalize(gl_FragCoord.xy-sc*resolution+vec2(.0001));
                vec2 off=(dir*pulse*14.+shimmer*3.)*thick*min(1.,power*5.);
                vec2 uv=gl_FragCoord.xy/resolution;
                vec3 image=vec3(texture2D(screen,clamp(uv+off*1.15/resolution,0.,1.)).r,
                    texture2D(screen,clamp(uv+off/resolution,0.,1.)).g,
                    texture2D(screen,clamp(uv+off*.85/resolution,0.,1.)).b);
                image*=1.+pulse*thick*.06;
                gl_FragColor=vec4(image,smoothstep(0.,.12,thick));}` });
        const sphere = new THREE.Mesh(this.sphere, material);
        sphere.position.set(x, elevation(this.world, { x, z }), z); sphere.scale.setScalar(radius);
        sphere.renderOrder = 20; this.scene.add(sphere);
        const positions: Array<number> = [], distances: Array<number> = [], indices: Array<number> = [];
        for (let ring = 0; ring <= 32; ring++) for (let spoke = 0; spoke <= 72; spoke++) {
            const r = radius * ring / 32, angle = spoke / 72 * Math.PI * 2;
            const px = x + Math.cos(angle) * r, pz = z + Math.sin(angle) * r;
            positions.push(px, elevation(this.world, { x: px, z: pz }) + 0.06, pz); distances.push(r);
            if (ring < 32 && spoke < 72) {
                const at = ring * 73 + spoke; indices.push(at, at + 73, at + 1, at + 1, at + 73, at + 74);
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('radial', new THREE.Float32BufferAttribute(distances, 1)); geometry.setIndex(indices);
        const ripple = new THREE.Mesh(geometry, new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
            depthTest: true, side: THREE.DoubleSide, uniforms, polygonOffset: true, polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
            vertexShader: `attribute float radial;varying float r;void main(){r=radial;
                gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
            fragmentShader: `uniform float time,power,radius;varying float r;void main(){
                float wave=pow(max(0.,cos((r-time*2.5)/4.*6.283185)),108.);
                float edge=smoothstep(0.,1.,r)*(1.-pow(clamp(r/radius,0.,1.),3.));
                gl_FragColor=vec4(1.,1.,1.,wave*edge*.2*min(1.,power*5.));}` }));
        this.mainScene.add(ripple); return { generation, sphere, ripple };
    }
    update(rows: Int32Array, camera: T.PerspectiveCamera, now: number, fade: number) {
        this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(this.matrix); this.visible = false;
        for (const [id, bubble] of this.bubbles) {
            const at = id * STRIDE;
            if (!rows[at + E.state] || (rows[at + E.flags] >>> 8) !== bubble.generation) {
                this.release(bubble); this.bubbles.delete(id);
            }
        }
        for (let id = 0; id < MAX_ENTITIES; id++) {
            const at = id * STRIDE, definition = entities[rows[at + E.def]];
            if (!rows[at + E.state] || definition?.kind !== 4) continue;
            const x = rows[at + E.x] / Q, z = rows[at + E.z] / Q, radius = (definition.options.radius ?? 0) / Q;
            let bubble = this.bubbles.get(id);
            if (!bubble && this.bubbles.size < 32) {
                bubble = this.create(x, z, radius, rows[at + E.flags] >>> 8); this.bubbles.set(id, bubble);
            }
            if (!bubble) continue;
            this.bound.center.copy(bubble.sphere.position); this.bound.radius = radius;
            const visible = rows[at + E.state] === 1 && rows[at + E.power] > 0 && fade < 0.99 &&
                this.frustum.intersectsSphere(this.bound);
            bubble.sphere.visible = visible; bubble.ripple.visible = visible;
            bubble.sphere.material.uniforms.time.value = now;
            bubble.sphere.material.uniforms.power.value = rows[at + E.power] /
                Math.max(1, definition.options.power ?? 1);
            this.visible ||= visible;
        }
    }
    render(renderer: T.WebGLRenderer, camera: T.Camera) {
        if (!this.visible) return;
        this.copy.capture(renderer);
        const clear = renderer.autoClear; renderer.autoClear = false;
        try {
            renderer.render(this.scene, camera);
        } finally {
            renderer.autoClear = clear;
        }
    }
    private release(bubble: Bubble) {
        this.scene.remove(bubble.sphere); this.mainScene.remove(bubble.ripple);
        bubble.sphere.material.dispose(); bubble.ripple.geometry.dispose(); bubble.ripple.material.dispose();
    }
    destroy() {
        for (const bubble of this.bubbles.values()) this.release(bubble);
        this.bubbles.clear(); this.sphere.dispose(); this.copy.destroy(); this.scene.clear();
    }
}
