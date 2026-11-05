import type * as T from 'three';
import { Tank } from '../../sim/tank.js';
import { World } from '../../sim/world/planet.js';
import { TankState, TreadStyle } from '../../types.js';
import { SURFACE_TABLE } from '../../sim/mapgen/surfaces.js';
import { DEFAULT_TANK_STYLE as STYLE } from './tank-style.js';
import { TREAD_LIFE, TREAD_SAMPLES } from '../../vars.js';
import { V3, fromTuple, normalize, sub, vec } from '../../sim/math/vec3.js';
import { streamInstances } from '../geometry.js';

export function treadSurface(world: World, planet: number, points: Array<V3>, maxHeight: number): V3 | undefined {
    const center = fromTuple(world.desc.planets[planet].center);
    let height: number | undefined;
    let contact: V3 | undefined;
    for (const point of points) {
        const dir = normalize(vec(), sub(vec(), point, center));
        if (!world.fields[planet].isSolid(dir)) return;
        const support = world.colliders.supportHeight(planet, dir, 0, maxHeight);
        if (height !== undefined && Math.abs(support - height) > .05) return;
        if (!contact) {
            height = support;
            contact = world.position(planet, dir, support + .015);
        }
    }
    return contact;
}

interface Mark {
    matrix: T.Matrix4; born: number; style: TreadStyle;
}
export class TreadTrails {
    mesh: T.InstancedMesh<T.PlaneGeometry, T.ShaderMaterial>;
    private marks: Array<Mark> = [];
    private changed = false;
    private last = new Map<number, T.Vector3>();
    constructor() {
        const g = new THREE.PlaneGeometry(0.5, 0.5, 2, 3), cap = TREAD_SAMPLES * 2 * 8;
        g.setAttribute('aBirth', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
        g.setAttribute('aStyle', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
        this.mesh = new THREE.InstancedMesh(g, new THREE.ShaderMaterial({
            uniforms: { time: { value: 0 }, life: { value: TREAD_LIFE } },
            transparent: true, depthWrite: false, side: THREE.DoubleSide, extensions: { derivatives: true },
            vertexShader: `attribute float aBirth,aStyle;uniform float time;varying vec2 vUv;
                varying float vAge,vStyle;void main(){vUv=uv;vAge=time-aBirth;vStyle=aStyle;
                    vec3 p=position;
                    gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(p,1.);}`,
            fragmentShader: `uniform float life;varying vec2 vUv;varying float vAge,vStyle;
                void main(){float cleat=.5+.5*sin((vUv.y+abs(vUv.x-.5)*.3)*31.4);
                    float shade=.15+cleat*.17;vec3 c=vec3(shade);
                    if(vStyle>.5&&vStyle<1.5)c=vec3(.5,.8,.9);
                    if(vStyle>1.5&&vStyle<2.5)c=vec3(.12,.18,.24);
                    if(vStyle>2.5)c=vec3(.7,.8,.9);
                    float fade=1.-smoothstep(life*.6,life,vAge);
                    float edge=smoothstep(0.,.16,vUv.x)*(1.-smoothstep(.84,1.,vUv.x));
                    gl_FragColor=vec4(c,fade*edge*(.2+cleat*.3));}`
        }), cap);
        this.mesh.frustumCulled = false;
        this.mesh.count = 0;
        streamInstances(this.mesh);
    }
    update(tanks: Array<Tank>, rigs: Map<number, { root: T.Object3D }>, world: World, now: number): void {
        for (const tank of tanks) {
            const rig = rigs.get(tank.id);
            if (!rig) continue;
            const previous = this.last.get(tank.id);
            if (tank.state !== TankState.GROUNDED || tank.isDead) {
                this.last.delete(tank.id);
                continue;
            }
            if (previous && previous.distanceTo(rig.root.position) < 0.35) continue;
            this.last.set(tank.id, rig.root.position.clone());
            if (!world.fields[tank.planet].isSolid(tank.dir)) continue;
            rig.root.updateMatrixWorld();
            for (const anchor of [STYLE.anchors.treadL, STYLE.anchors.treadR]) {
                const pos = new THREE.Vector3(...anchor).applyMatrix4(rig.root.matrixWorld);
                const q = rig.root.quaternion.clone().multiply(new THREE.Quaternion()
                    .setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
                const points = [pos];
                for (const x of [-.25, .25])
                    for (const y of [-.25, .25])
                        points.push(new THREE.Vector3(x, y, 0).applyQuaternion(q).add(pos));
                const contact = treadSurface(world, tank.planet, points, tank.h);
                if (!contact) continue;
                pos.set(contact.x, contact.y, contact.z);
                const up = pos.clone().sub(new THREE.Vector3(...world.desc.planets[tank.planet].center)).normalize();
                const oldUp = new THREE.Vector3(0, 1, 0).applyQuaternion(rig.root.quaternion);
                q.premultiply(new THREE.Quaternion().setFromUnitVectors(oldUp, up));
                this.changed = true;
                this.marks.push({ matrix: new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1)),
                    born: now / 1000, style: SURFACE_TABLE[world.desc.planets[tank.planet].surface].treadStyle });
            }
        }
        let kept = 0;
        for (const mark of this.marks) if (now / 1000 - mark.born < TREAD_LIFE) this.marks[kept++] = mark;
        if (kept !== this.marks.length) {
            this.marks.length = kept;
            this.changed = true;
        }
        const overflow = this.marks.length - TREAD_SAMPLES * 16;
        if (overflow > 0) this.marks.splice(0, overflow);
        this.mesh.material.uniforms.time.value = now / 1000;
        if (!this.changed) return;
        this.changed = false;
        const birth = this.mesh.geometry.getAttribute('aBirth') as T.InstancedBufferAttribute;
        const style = this.mesh.geometry.getAttribute('aStyle') as T.InstancedBufferAttribute;
        this.marks.forEach((m, i) => {
            this.mesh.setMatrixAt(i, m.matrix);
            birth.setX(i, m.born);
            style.setX(i, m.style);
        });
        this.mesh.count = this.marks.length;
        if (!this.mesh.count) return;
        this.mesh.instanceMatrix.updateRange.count = this.mesh.count * 16;
        this.mesh.instanceMatrix.needsUpdate = true;
        birth.updateRange.count = style.updateRange.count = this.mesh.count;
        birth.needsUpdate = true;
        style.needsUpdate = true;
    }
    clear(): void {
        this.marks.length = 0;
        this.changed = true;
        this.last.clear();
    }
    dispose(): void {
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}
