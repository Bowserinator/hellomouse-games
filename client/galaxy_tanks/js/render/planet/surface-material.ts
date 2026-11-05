import type * as T from 'three';
import { PlanetDesc } from '../../sim/mapgen/map-desc.js';
import { Rng } from '../../sim/math/rng.js';
import { cross, tangentBasis, vec } from '../../sim/math/vec3.js';
import { SurfaceType } from '../../types.js';
import { GRASS_TONES, SURFACE_STYLES, SurfaceStyle } from './surface-styles.js';

const PATTERN_CELL = 3.6;
const TEXTURE_FREQUENCY = 0.17;
const DARK_SQUARE = 0.7;

export interface SurfaceOptions {
    /** Draws the planet's surface pattern, if its surface has one */
    pattern?: boolean;
    /** Darkens vertical faces near the ground */
    occlusion?: boolean;
}

function mowing(p: PlanetDesc) {
    const up = new Rng(p.surfaceSeed).unitVec(), [side] = tangentBasis(up), across = cross(vec(), up, side);
    const bands = Math.round(Math.PI * p.radius / 3);
    return {
        pattern: (p.surfaceSeed >> 4 & 1) + 1,
        basis: new THREE.Matrix3().set(side.x, side.y, side.z, up.x, up.y, up.z, across.x, across.y, across.z),
        freq: new THREE.Vector2(bands, 2 * Math.round(Math.PI * p.radius / 3.5))
    };
}

export function surfaceMaterial(p: PlanetDesc, albedo: T.Texture, bump: T.Texture,
    sky: T.CubeTexture, sdf: T.CubeTexture, override?: SurfaceStyle, options: SurfaceOptions = {}): T.ShaderMaterial {
    const { pattern = true, occlusion = false } = options;
    const style = override ?? SURFACE_STYLES[p.surface], tint = new THREE.Color(style.tint);
    if (!override && p.surface === SurfaceType.PLASTIC) tint.setHSL((p.surfaceSeed % 1000) / 1000, 0.65, 0.58);
    const checks = pattern && !override && p.surface === SurfaceType.PLASTIC;
    const grass = pattern && !override && p.surface === SurfaceType.GRASS ? mowing(p) : null;
    const latCells = Math.max(2, Math.round(Math.PI * p.radius / PATTERN_CELL));
    return new THREE.ShaderMaterial({
        uniforms: {
            uAlbedo: { value: albedo }, uBump: { value: bump }, uSky: { value: sky }, uSdf: { value: sdf },
            uTint: { value: tint }, uSpec: { value: style.spec }, uShine: { value: style.shine },
            uReflect: { value: style.reflect }, uBumpStrength: { value: style.bump },
            uTexScale: { value: TEXTURE_FREQUENCY / (style.scale ?? 1) }, uVariety: { value: style.variety ?? 0 },
            uSnow: { value: Number(!override && p.surface === SurfaceType.SNOW) }, uUnderside: { value: 0 },
            uHoles: { value: Number(Boolean(p.holes?.length)) }, uSeed: { value: p.surfaceSeed % 1000 },
            uCheck: { value: new THREE.Vector2(checks ? latCells * 2 : 0, latCells) },
            uPattern: { value: grass?.pattern ?? 0 }, uBasis: { value: grass?.basis ?? new THREE.Matrix3() },
            uPatternFreq: { value: grass?.freq ?? new THREE.Vector2() },
            uPatternTone: { value: new THREE.Vector2(GRASS_TONES.dark, GRASS_TONES.bright) },
            uAo: { value: occlusion ? 0.28 : 0 }, uAoRadius: { value: p.radius }, uAoHeight: { value: 1.5 },
            uGlow: { value: 0 }, uGlowRange: { value: new THREE.Vector2(p.radius, 1) }
        },
        extensions: { derivatives: true },
        vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vWorld;
            void main() {
                vP=position; vN=normalize(mat3(modelMatrix)*normal);
                vWorld=(modelMatrix*vec4(position,1.)).xyz;
                gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);
            }`,
        fragmentShader: `uniform sampler2D uAlbedo; uniform sampler2D uBump;
            uniform samplerCube uSky; uniform samplerCube uSdf;
            uniform vec3 uTint; uniform float uSpec,uShine,uReflect,uBumpStrength,uSnow,uUnderside,uHoles,uSeed;
            uniform vec2 uCheck;
            uniform float uPattern,uAo,uAoRadius,uAoHeight,uGlow,uTexScale,uVariety; uniform mat3 uBasis;
            uniform vec2 uPatternFreq,uPatternTone,uGlowRange;
            varying vec3 vP; varying vec3 vN; varying vec3 vWorld;
            float hash(vec3 p) { return fract(sin(dot(p,vec3(12.9898,78.233,39.425)))*43758.5453); }
            float noise(vec3 p) {
                vec3 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
                return mix(mix(mix(hash(i),hash(i+vec3(1.,0.,0.)),f.x),
                    mix(hash(i+vec3(0.,1.,0.)),hash(i+vec3(1.,1.,0.)),f.x),f.y),
                    mix(mix(hash(i+vec3(0.,0.,1.)),hash(i+vec3(1.,0.,1.)),f.x),
                    mix(hash(i+vec3(0.,1.,1.)),hash(i+vec3(1.,1.,1.)),f.x),f.y),f.z);
            }
            vec3 albedoAt(vec3 p,vec3 w) {
                return texture2D(uAlbedo,p.yz).rgb*w.x+texture2D(uAlbedo,p.xz).rgb*w.y+texture2D(uAlbedo,p.xy).rgb*w.z;
            }
            float heightAt(vec3 p,vec3 w) {
                return texture2D(uBump,p.yz).r*w.x+texture2D(uBump,p.xz).r*w.y+texture2D(uBump,p.xy).r*w.z;
            }
            float square(float x) {
                float w=min(fwidth(x)*1.6+.02,.3);
                return smoothstep(-w,w,sin(x*3.14159265));
            }
            void main() {
                vec3 dir=normalize(vP);
                if(uHoles>.5 && textureCube(uSdf,dir).r<.5) discard;
                vec3 weights=abs(vN); weights*=weights; weights*=weights; weights/=max(dot(weights,vec3(1.)),.001);
                vec3 p=vP*uTexScale+uSeed*.013;
                vec3 albedo=albedoAt(p,weights);
                float height=heightAt(p,weights);
                if(uVariety>0.) {
                    vec3 p2=p.zxy*.43+17.3;
                    float m=smoothstep(.35,.65,noise(vP*.045+uSeed*.013))*uVariety;
                    albedo=mix(albedo,albedoAt(p2,weights),m);
                    height=mix(height,heightAt(p2,weights),m);
                    albedo*=1.+(noise(vP*.08+uSeed*.029)-.5)*.3*uVariety;
                }
                vec3 faceN=gl_FrontFacing?vN:-vN;
                vec3 n=normalize(faceN-cross(dFdx(vWorld),faceN)*dFdx(height)*uBumpStrength*7.-
                    cross(faceN,dFdy(vWorld))*dFdy(height)*uBumpStrength*7.);
                vec3 tint=uTint;
                if(uCheck.x>0.){
                    float lat=asin(clamp(dir.y,-1.,1.));
                    float lonScale=length(dir.xz);
                    vec2 g=vec2(atan(dir.z,dir.x)/6.2831853+.5,lat/3.1415927+.5)*uCheck;
                    vec2 w=vec2((length(dFdx(dir.xz))+length(dFdy(dir.xz)))/max(lonScale,.0001)/6.2831853*uCheck.x,
                        (abs(dFdx(lat))+abs(dFdy(lat)))/3.1415927*uCheck.y)+.001;
                    vec2 q=2.*(abs(fract((g-.5*w)*.5)-.5)-abs(fract((g+.5*w)*.5)-.5))/w;
                    tint*=mix(1.,${DARK_SQUARE.toFixed(2)},.5-.5*q.x*q.y);
                }
                if(uPattern>.5) {
                    vec3 q=uBasis*dir;
                    float band=square(asin(clamp(q.y,-1.,1.))/3.14159265*uPatternFreq.x);
                    float cell=square((atan(q.z,q.x)/6.2831853+.5)*uPatternFreq.y);
                    float bright=uPattern>1.5?band*cell+(1.-band)*(1.-cell):band;
                    tint*=mix(uPatternTone.x,uPatternTone.y,bright);
                }
                float bands=.06*(1.-.6*uSnow);
                float macro=1.-bands+bands*sin(dir.x*19.+uSeed)*sin(dir.z*13.+dir.y*8.);
                vec3 sun=normalize(vec3(-.4,.8,.5)),view=normalize(cameraPosition-vWorld);
                float diffuse=max(dot(n,sun),0.);
                float spec=pow(max(dot(n,normalize(sun+view)),0.),uShine)*uSpec;
                float rim=1.-max(dot(n,view),0.),fresnel=rim*rim*rim;
                vec3 lit=albedo*tint*macro*(.48+.60*diffuse)+spec*.8;
                lit*=1.+uSnow*.1;
                lit+=uSnow*albedo*vec3(.05,.12,.26)*(1.-diffuse);
                lit*=1.-uAo*(1.-smoothstep(0.,uAoHeight,length(vP)-uAoRadius));
                float perfect=step(.999,uReflect);
                vec3 env=textureCube(uSky,reflect(-view,n)).rgb;
                env+=vec3(.15,.19,.28)*(max(0.,reflect(-view,n).y)*.5+.5)*(1.-perfect);
                lit=mix(lit,env,uReflect)+fresnel*.08*(1.-perfect);
                lit+=vec3(1.,.93,.55)*uGlow*mix(.3,1.,clamp((uGlowRange.x-length(vP))/uGlowRange.y,0.,1.))*.6;
                if(uUnderside>.5) lit=mix(vec3(.19,.12,.075),vec3(.32,.23,.15),albedo.r)*
                    (.7+.3*abs(dot(n,sun)));
                gl_FragColor=vec4(lit,1.);
            }`
    });
}
