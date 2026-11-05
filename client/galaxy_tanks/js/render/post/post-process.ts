import type * as T from 'three';
import { PlanetDesc } from '../../sim/mapgen/map-desc.js';
import { Rng } from '../../sim/math/rng.js';
import { CoreType } from '../../types.js';
import { ATMOSPHERE, LAVA_GLOW, GLOW_MASK_ALPHA } from '../../vars.js';

const MAX_PLANETS = 8;
const BLUR_SPREADS = [1, 2.2];
const SUN: [number, number, number] = [-0.4, 0.8, 0.5];

const VERTEX = `varying vec2 vUv;
    void main() {
        vUv=uv;
        gl_Position=vec4(position.xy,0.,1.);
    }`;

const MASK_FRAGMENT = `uniform sampler2D uScene; uniform vec2 uTexel; uniform vec3 uColor; varying vec2 vUv;
    void main() {
        float a=texture2D(uScene,vUv+uTexel*vec2(-1.,-1.)).a+texture2D(uScene,vUv+uTexel*vec2(1.,-1.)).a+
            texture2D(uScene,vUv+uTexel*vec2(-1.,1.)).a+texture2D(uScene,vUv+uTexel*vec2(1.,1.)).a;
        float glow=clamp((1.-a*.25)/(1.-${GLOW_MASK_ALPHA.toFixed(3)}),0.,1.);
        gl_FragColor=vec4(uColor*glow,1.);
    }`;

const BLUR_FRAGMENT = `uniform sampler2D uTex; uniform vec2 uStep; varying vec2 vUv;
    void main() {
        vec3 sum=texture2D(uTex,vUv).rgb*.227027;
        sum+=(texture2D(uTex,vUv+uStep*1.3846).rgb+texture2D(uTex,vUv-uStep*1.3846).rgb)*.3162162;
        sum+=(texture2D(uTex,vUv+uStep*3.2308).rgb+texture2D(uTex,vUv-uStep*3.2308).rgb)*.0702703;
        gl_FragColor=vec4(sum,1.);
    }`;

const composeFragment = (steps: number) => `#define MAX_PLANETS ${MAX_PLANETS}
    #define STEPS ${steps}
    uniform sampler2D uScene; uniform highp sampler2D uDepth; uniform sampler2D uGlow; uniform float uGlowAmount;
    uniform mat4 uInvProj; uniform mat4 uCamWorld; uniform vec3 uCamPos; uniform vec3 uSun;
    uniform int uCount; uniform vec4 uBody[MAX_PLANETS]; uniform float uHeight[MAX_PLANETS];
    uniform vec3 uAtmoColor; uniform float uDensity[MAX_PLANETS]; uniform float uSharpness;
    varying vec2 vUv;
    vec3 atmosphere(vec3 ro,vec3 rd,float hit) {
        vec3 acc=vec3(0.);
        for(int i=0;i<MAX_PLANETS;i++) {
            if(i>=uCount) break;
            if(uDensity[i]<=0.) continue;
            float radius=uBody[i].w,height=uHeight[i];
            vec3 oc=ro-uBody[i].xyz;
            float b=dot(oc,rd),h=b*b-dot(oc,oc)+(radius+height)*(radius+height);
            if(h<=0.) continue;
            float s=sqrt(h),t0=max(-b-s,0.),t1=min(-b+s,hit);
            if(t1<=t0) continue;
            float dt=(t1-t0)/float(STEPS),depth=0.;
            for(int k=0;k<STEPS;k++) {
                vec3 p=oc+rd*(t0+(float(k)+.5)*dt);
                depth+=exp(-max(length(p)-radius,0.)/height*3.)*dt;
            }
            float amount=1.-exp(-uDensity[i]*pow(max(depth/height,.0001),uSharpness));
            float lit=.35+.65*smoothstep(-.3,.8,dot(normalize(oc+rd*(t0+t1)*.5),uSun));
            vec3 haze=mix(uAtmoColor,vec3(.8,.96,1.),amount*amount*.6)*amount*lit;
            acc=acc+haze-acc*haze;
        }
        return acc;
    }
    void main() {
        vec3 color=texture2D(uScene,vUv).rgb+texture2D(uGlow,vUv).rgb*uGlowAmount;
        if(uCount>0) {
            vec4 view=uInvProj*vec4(vUv*2.-1.,1.,1.);
            vec3 dir=normalize((uCamWorld*vec4(view.xyz/view.w,0.)).xyz);
            float depth=texture2D(uDepth,vUv).r;
            vec4 surface=uInvProj*vec4(vUv*2.-1.,depth*2.-1.,1.);
            float hit=depth>=1.?1e9:length(surface.xyz/surface.w);
            vec3 haze=atmosphere(uCamPos,dir,hit);
            color=color+haze-color*haze;
        }
        gl_FragColor=vec4(color,1.);
    }`;

/** Renders the scene with a glow over visible lava and explosions and a blue atmosphere around planets */
export class PostProcess {
    private sceneTarget: T.WebGLRenderTarget;
    private glow: Array<T.WebGLRenderTarget>;
    private screen = new THREE.Scene();
    private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    private quad: T.Mesh<T.PlaneGeometry, T.ShaderMaterial>;
    private mask: T.ShaderMaterial;
    private blur: T.ShaderMaterial;
    private compose: T.ShaderMaterial;
    private size = new THREE.Vector2();
    explosions = false;
    private lava = false;
    private bodies: Array<T.Vector4> = Array.from({ length: MAX_PLANETS }, () => new THREE.Vector4());
    private heights: Array<number> = new Array(MAX_PLANETS).fill(0);
    private densities: Array<number> = new Array(MAX_PLANETS).fill(0);
    private blackHoles = new Set<number>();
    constructor(private renderer: T.WebGLRenderer, low: boolean) {
        const options = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat, stencilBuffer: false };
        // Sample rendered depth so holes, rims and obstacles occlude atmosphere correctly.
        this.sceneTarget = renderer.capabilities.isWebGL2 && !low
            ? new THREE.WebGLMultisampleRenderTarget(1, 1, options) : new THREE.WebGLRenderTarget(1, 1, options);
        this.sceneTarget.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
        this.glow = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, { ...options, depthBuffer: false }));
        const sceneTexture = { value: this.sceneTarget.texture };
        this.mask = new THREE.ShaderMaterial({
            uniforms: { uScene: sceneTexture, uTexel: { value: new THREE.Vector2() },
                uColor: { value: new THREE.Color().fromArray(LAVA_GLOW.COLOR) } },
            vertexShader: VERTEX, fragmentShader: MASK_FRAGMENT, depthTest: false, depthWrite: false
        });
        this.blur = new THREE.ShaderMaterial({
            uniforms: { uTex: { value: null }, uStep: { value: new THREE.Vector2() } },
            vertexShader: VERTEX, fragmentShader: BLUR_FRAGMENT, depthTest: false, depthWrite: false
        });
        this.compose = new THREE.ShaderMaterial({
            uniforms: {
                uScene: sceneTexture, uDepth: { value: this.sceneTarget.depthTexture },
                uGlow: { value: this.glow[0].texture }, uGlowAmount: { value: 0 },
                uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
                uCamPos: { value: new THREE.Vector3() }, uSun: { value: new THREE.Vector3(...SUN).normalize() },
                uCount: { value: 0 }, uBody: { value: this.bodies }, uHeight: { value: this.heights },
                uAtmoColor: { value: new THREE.Color().fromArray(ATMOSPHERE.COLOR) },
                uDensity: { value: this.densities }, uSharpness: { value: ATMOSPHERE.SHARPNESS }
            },
            vertexShader: VERTEX, fragmentShader: composeFragment(low ? 4 : 8), depthTest: false, depthWrite: false
        });
        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mask);
        this.quad.frustumCulled = false;
        this.screen.add(this.quad);
        renderer.info.autoReset = false;
    }
    setPlanets(planets: Array<PlanetDesc>): void {
        this.blackHoles.clear();
        const count = Math.min(planets.length, MAX_PLANETS);
        for (let i = 0; i < count; i++) {
            const { center, radius } = planets[i];
            this.bodies[i].set(center[0], center[1], center[2], radius);
            this.heights[i] = Math.max(ATMOSPHERE.MIN_HEIGHT, radius * ATMOSPHERE.HEIGHT_FRAC);
            if (planets[i].core?.kind === CoreType.BLACK_HOLE) this.blackHoles.add(i);
            this.setAtmosphere(i, new Rng(planets[i].surfaceSeed ^ 0x5bd1e995).float());
        }
        this.compose.uniforms.uCount.value = count;
        this.lava = planets.some(p => p.core?.kind === CoreType.LAVA);
    }
    /** Atmosphere strength of a planet as a fraction of the maximum */
    atmosphere(planet: number): number {
        return this.densities[planet] / ATMOSPHERE.DENSITY;
    }
    setAtmosphere(planet: number, fraction: number): void {
        this.densities[planet] = this.blackHoles.has(planet) ? 0 : ATMOSPHERE.DENSITY * fraction;
    }
    resize(): void {
        this.renderer.getDrawingBufferSize(this.size);
        const width = Math.max(1, this.size.x), height = Math.max(1, this.size.y);
        if (width === this.sceneTarget.width && height === this.sceneTarget.height) return;
        this.sceneTarget.setSize(width, height);
        const glowWidth = Math.max(1, Math.ceil(width / LAVA_GLOW.DOWNSCALE));
        const glowHeight = Math.max(1, Math.ceil(height / LAVA_GLOW.DOWNSCALE));
        this.glow.forEach(target => target.setSize(glowWidth, glowHeight));
        this.mask.uniforms.uTexel.value.set(1 / width, 1 / height);
    }
    render(scene: T.Scene, camera: T.PerspectiveCamera): void {
        const renderer = this.renderer;
        renderer.info.reset();
        renderer.setRenderTarget(this.sceneTarget);
        renderer.render(scene, camera);
        const glowing = this.lava || this.explosions;
        if (glowing) this.blurGlow();
        const u = this.compose.uniforms;
        u.uGlowAmount.value = glowing ? LAVA_GLOW.STRENGTH : 0;
        u.uInvProj.value.copy(camera.projectionMatrixInverse);
        u.uCamWorld.value.copy(camera.matrixWorld);
        u.uCamPos.value.copy(camera.position);
        this.pass(this.compose, null);
    }
    dispose(): void {
        this.sceneTarget.dispose();
        this.glow.forEach(target => target.dispose());
        this.mask.dispose();
        this.blur.dispose();
        this.compose.dispose();
        this.quad.geometry.dispose();
        this.renderer.info.autoReset = true;
    }
    private blurGlow(): void {
        const [a, b] = this.glow, step = this.blur.uniforms.uStep.value as T.Vector2;
        this.pass(this.mask, a);
        for (const spread of BLUR_SPREADS) {
            this.blur.uniforms.uTex.value = a.texture;
            step.set(spread * LAVA_GLOW.SPREAD / a.width, 0);
            this.pass(this.blur, b);
            this.blur.uniforms.uTex.value = b.texture;
            step.set(0, spread * LAVA_GLOW.SPREAD / a.height);
            this.pass(this.blur, a);
        }
    }
    private pass(material: T.ShaderMaterial, target: T.WebGLRenderTarget | null): void {
        this.quad.material = material;
        this.renderer.setRenderTarget(target);
        this.renderer.render(this.screen, this.camera);
    }
}
