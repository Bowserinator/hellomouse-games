import type * as T from 'three';
import { circlePoint } from '../sim/math/sphere.js';
import { V3, tangentBasis, vec } from '../sim/math/vec3.js';
import { World } from '../sim/world/planet.js';
import { RING_SEGMENTS } from '../vars.js';
import { commitInstances, streamInstances } from './geometry.js';

/** Glowing circles drawn on a planet's surface */
export class RingLines {
    readonly mesh: T.InstancedMesh;
    private dummy = new THREE.Object3D();
    private radial = new THREE.Vector3(0, 1, 0);
    private start = new THREE.Vector3();
    private end = new THREE.Vector3();
    private direction = new THREE.Vector3();
    private point = vec();
    private pos = vec();
    constructor(color: number, opacity: number, private capacity: number) {
        this.mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6),
            new THREE.MeshBasicMaterial({ color, opacity, transparent: true,
                blending: THREE.AdditiveBlending, depthWrite: false }), capacity * RING_SEGMENTS);
        this.mesh.count = 0;
        this.mesh.frustumCulled = false;
        streamInstances(this.mesh);
    }
    begin(): void {
        this.mesh.count = 0;
    }
    /** Adds a circle whose edge is `arc` away from `center` along the surface */
    add(world: World, planet: number, center: V3, arc: number, altitude: number, thickness: number): void {
        const theta = Math.min(Math.PI, arc / (world.desc.planets[planet].radius + altitude));
        const [u, v] = tangentBasis(center);
        for (let i = 0; i <= RING_SEGMENTS; i++) {
            circlePoint(this.point, center, u, v, theta, i / RING_SEGMENTS * Math.PI * 2);
            world.position(planet, this.point, altitude, this.pos);
            this.end.set(this.pos.x, this.pos.y, this.pos.z);
            if (i > 0 && this.mesh.count < this.capacity * RING_SEGMENTS) {
                this.direction.subVectors(this.end, this.start);
                const length = this.direction.length();
                if (length > 1e-3) {
                    this.dummy.position.addVectors(this.start, this.end).multiplyScalar(0.5);
                    this.dummy.quaternion.setFromUnitVectors(this.radial, this.direction.divideScalar(length));
                    this.dummy.scale.set(thickness, length, thickness);
                    this.dummy.updateMatrix();
                    this.mesh.setMatrixAt(this.mesh.count++, this.dummy.matrix);
                }
            }
            this.start.copy(this.end);
        }
    }
    commit(): void {
        commitInstances(this.mesh);
    }
}
