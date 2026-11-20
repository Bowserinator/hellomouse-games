import type * as T from 'three';

export interface Particle {
    x: number; y: number; z: number;
    vx: number; vy: number; vz: number;
    life: number; size: number; endSize: number;
    color: number; endColor: number; alpha?: number; kind?: number;
}
export class ParticlePool {
    readonly mesh: T.Mesh;
    private cursor = 0;
    private dirty = true;
    private origin: Float32Array;
    private velocity: Float32Array;
    private timing: Float32Array;
    private props: Float32Array;
    private colors: Uint8Array;
    private ends: Uint8Array;
    private clock = { value: 0 };
    constructor(readonly capacity: number, additive: boolean) {
        const base = new THREE.PlaneGeometry(1, 1);
        const geometry = new THREE.InstancedBufferGeometry().copy(base); base.dispose();
        geometry.instanceCount = capacity;
        this.origin = new Float32Array(capacity * 3); this.velocity = new Float32Array(capacity * 3);
        this.timing = new Float32Array(capacity * 4); this.props = new Float32Array(capacity * 2);
        this.colors = new Uint8Array(capacity * 4); this.ends = new Uint8Array(capacity * 4);
        for (let i = 0; i < capacity; i++) this.timing[i * 4] = -1000;
        for (const [name, values, size] of [
            ['pOrigin', this.origin, 3], ['pVelocity', this.velocity, 3], ['pTiming', this.timing, 4],
            ['pProps', this.props, 2], ['pColor', this.colors, 4], ['pEnd', this.ends, 4]
        ] as const) geometry.setAttribute(name, new THREE.InstancedBufferAttribute(values, size, size === 4 &&
            (name === 'pColor' || name === 'pEnd')).setUsage(THREE.DynamicDrawUsage));
        this.mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
            transparent: true, depthTest: true, depthWrite: false,
            blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
            uniforms: { clock: this.clock },
            vertexShader: `attribute vec3 pOrigin,pVelocity; attribute vec4 pTiming,pColor,pEnd;
                attribute vec2 pProps; uniform float clock; varying vec2 coord; varying vec4 tint;
                void main(){ float age=clock-pTiming.x; float f=clamp(age/max(.001,pTiming.y),0.,1.);
                    float alive=step(0.,age)*(1.-step(pTiming.y,age));
                    float drag=mix(.3,1.4,step(1.5,pProps.y)); float travel=(1.-exp(-drag*age))/drag;
                    vec3 world=pOrigin+pVelocity*travel; world.y-=mix(2.5,-.15,step(1.5,pProps.y))*age*age;
                    vec4 view=modelViewMatrix*vec4(world,1.); float size=mix(pTiming.z,pTiming.w,f)*alive;
                    vec2 q=position.xy; float a=pProps.x+age*.5;
                    q=mat2(cos(a),-sin(a),sin(a),cos(a))*q;
                    if(pProps.y>.5&&pProps.y<1.5){vec2 v=(modelViewMatrix*vec4(pVelocity,0.)).xy;
                        vec2 d=normalize(v+vec2(.0001));q=vec2(d.y,-d.x)*q.x*size+d*q.y*max(size,length(v)*.035)*alive;}
                    else q*=size;
                    view.xy+=q;gl_Position=projectionMatrix*view;coord=uv*2.-1.;
                    tint=mix(pColor,pEnd,f);tint.a*=alive*(1.-smoothstep(.65,1.,f)); }`,
            fragmentShader: `varying vec2 coord; varying vec4 tint; void main(){float r=dot(coord,coord);
                float a=pow(max(0.,1.-r),1.7);if(a<.01)discard;gl_FragColor=vec4(tint.rgb,tint.a*a);}`
        }));
        this.mesh.frustumCulled = false;
    }
    emit(p: Particle, now: number) {
        const id = this.cursor++ % this.capacity; this.dirty = true;
        this.origin.set([p.x, p.y, p.z], id * 3); this.velocity.set([p.vx, p.vy, p.vz], id * 3);
        this.timing.set([now, p.life, p.size, p.endSize], id * 4);
        this.props.set([Math.random() * Math.PI * 2, p.kind ?? 0], id * 2);
        for (const [values, color, alpha] of [
            [this.colors, p.color, p.alpha ?? 1], [this.ends, p.endColor, 0]
        ] as const)
            values.set([color >>> 16 & 255, color >>> 8 & 255, color & 255, Math.round(alpha * 255)], id * 4);
    }
    update(now: number, visible: boolean) {
        this.clock.value = now; this.mesh.visible = visible;
        if (this.dirty) {
            const geometry = this.mesh.geometry as T.InstancedBufferGeometry;
            for (const name of ['pOrigin', 'pVelocity', 'pTiming', 'pProps', 'pColor', 'pEnd'])
                geometry.getAttribute(name).needsUpdate = true;
            this.dirty = false;
        }
    }
    destroy() {
        this.mesh.parent?.remove(this.mesh); this.mesh.geometry.dispose();
        (this.mesh.material as T.Material).dispose();
    }
}
