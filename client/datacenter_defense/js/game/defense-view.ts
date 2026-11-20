import type * as T from 'three';
import { instanceOpacity } from '../render/instance-opacity.js';
import type { World } from '../mapx.js';
import type { RenderSnapshot } from '../sim/core.js';
import { ENTITY as E, isLive, RENDER_AIMS, RENDER_ORDERS, ENTITY_DESTROYED, MAX_ENTITIES,
    RENDER_ENTITY_WORDS as STRIDE, RENDER_EXPLOSION_WORDS, RENDER_SALE_EFFECT,
    RENDER_CHARGE_SHIFT, RENDER_PROJECTILE_WORDS, ECONOMY as C, zombieHp } from '../sim/layout.js';
import { BALANCE } from '../sim/balance.js';
import { defaults, entities, type EntityDef } from '../sim/entity/registry.js';
import { projectiles } from '../sim/projectile/registry.js';
import { weapons, weaponTable, WEAPON_STRIDE, WEAPON } from '../sim/weapon/registry.js';
import { Q, TICK_HZ } from '../sim/fixed.js';
import { VARIANTS } from '../sim/variants.js';
import { ORDER_WAYPOINT } from '../sim/commands.js';
import { elevation } from '../editor/world.js';
import { RtsCamera } from './input/rts-camera.js';
import { iconUrl } from './ui/icons.js';
import { Models } from '../render/models.js';
import { Effects } from '../render/fx/manager.js';
import { EFFECTS } from '../render/fx/registry.js';
import { Sonic } from '../render/sonic.js';
import { PLAYER_COLORS, type LobbyPlayer } from '../shared/protocol.js';

const WRECK = { blacken: 0.4, gravity: 1.5, topple: 1.6, margin: 0.4, bodies: 256 };
interface Wreck {
    definition: number;
    x: number;
    z: number;
    facing: number;
    aims: Float32Array;
    axis: number;
    born: number;
    altitude: number;
}
const bodyColor = (definition: EntityDef) => definition.name === 'Police man' ? '#3268b7'
    : definition.kind === 5 ? '#81735c' : '#657a87';
const BARREL_COLOR = '#454f56';

export class DefenseView {
    roster: ReadonlyArray<LobbyPlayer> = [];
    localSlot = 0;
    teammateSelections: ReadonlyMap<number, Array<number>> = new Map();
    readonly group = new THREE.Group();
    readonly overlay = document.createElement('canvas');
    readonly selected = new Set<number>();
    readonly logicalOrders = new Set<number>();
    readonly attacking = new Set<number>();
    private targets: Array<{ x: number; z: number; attack: boolean; born: number }> = [];
    private etaLabels: Array<{ x: number; z: number; seconds: number }> = [];
    snapshot?: RenderSnapshot;
    private zombieColors = VARIANTS.map(variant => new THREE.Color(variant.color ?? 0xd43b3b).getStyle());
    private previous?: RenderSnapshot;
    private bodies = new Map<number, T.InstancedMesh>();
    private models: Models;
    private modelAims = new Float32Array(4);
    private modelKicks = new Float32Array(4);
    private barrels: T.InstancedMesh;
    private wreckBodies: T.InstancedMesh;
    private wreckBarrels: T.InstancedMesh;
    private wrecks: Array<Wreck> = [];
    private saleEffects: Array<{ x: number; z: number; height: number; born: number }> = [];
    private rotors: T.InstancedMesh;
    private airShadows: T.InstancedMesh;
    private shots: T.InstancedMesh;
    private missiles: T.InstancedMesh;
    private beams: T.InstancedMesh;
    private tracerLines: T.InstancedMesh;
    private tracers: Array<{ from: T.Vector3; to: T.Vector3; born: number }> = [];
    private explosions: T.InstancedMesh;
    private flashes: Array<{ x: number; y: number; z: number; radius: number; born: number }> = [];
    private explosionSeen = new Int32Array(0);
    private flashAlphas = new Float32Array(128);
    private markers = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial({
        transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
        vertexShader: `attribute vec4 tint; varying vec4 markerColor;
            void main() { markerColor=tint; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `varying vec4 markerColor; void main() { gl_FragColor=markerColor; }`
    }));
    private markerPositions = new Float32Array(4096 * 3);
    private markerColors = new Float32Array(4096 * 4);
    private markerCount = 0;
    private beamAxis = new THREE.Vector3(0, 1, 0);
    private beamDirection = new THREE.Vector3();
    private matrix = new THREE.Matrix4();
    private rotation = new THREE.Quaternion();
    private position = new THREE.Vector3();
    private scale = new THREE.Vector3();
    private iconTint = document.createElement('canvas');
    private icons = new Map<number, HTMLImageElement>();
    readonly effects: Effects;
    private sonic: Sonic;
    private ring = Math.max(1, ...weaponTable().filter((_, i) => i % WEAPON_STRIDE === WEAPON.slots));
    private context: CanvasRenderingContext2D;
    private paths: Array<{ id: number; segment: number; x: number; y: number; sx: number; sy: number }> = [];
    constructor(readonly camera: RtsCamera, scene: T.Scene, host: HTMLElement, private world: World) {
        const context = this.overlay.getContext('2d');
        if (!context) throw Error('A 2D canvas is required for Defense controls');
        this.context = context; this.overlay.className = 'defense-overlay'; host.append(this.overlay);
        entities.forEach((definition, id) => {
            const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
                new THREE.MeshToonMaterial({ color: bodyColor(definition) }), MAX_ENTITIES);
            mesh.count = 0; mesh.frustumCulled = false; mesh.receiveShadow = true;
            mesh.instanceColor = new THREE.InstancedBufferAttribute(
                new Float32Array(MAX_ENTITIES * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); instanceOpacity(mesh);
            this.bodies.set(id, mesh); this.group.add(mesh);
            const icon = document.createElement('img'); icon.src = iconUrl(definition.name, 'map_icons');
            this.icons.set(id, icon);
        });
        const barrel = new THREE.BoxGeometry(0.24, 0.24, 1.5); barrel.translate(0, 0, 0.6);
        this.barrels = new THREE.InstancedMesh(barrel, new THREE.MeshToonMaterial({ color: '#454f56' }), 4096);
        this.rotors = new THREE.InstancedMesh(barrel.clone(), new THREE.MeshToonMaterial({ color: '#454f56' }),
            MAX_ENTITIES * 2);
        for (const mesh of [this.barrels, this.rotors])
            mesh.instanceColor = new THREE.InstancedBufferAttribute(
                new Float32Array(mesh.instanceMatrix.count * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
        const disc = new THREE.CircleGeometry(1, 24); disc.rotateX(-Math.PI / 2);
        this.airShadows = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({
            color: '#000000', transparent: true, opacity: 0.24, depthWrite: false
        }), MAX_ENTITIES);
        this.iconTint.width = this.iconTint.height = 24;
        instanceOpacity(this.barrels); instanceOpacity(this.rotors);
        this.wreckBodies = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshToonMaterial({ color: '#ffffff' }), WRECK.bodies);
        this.wreckBarrels = new THREE.InstancedMesh(barrel.clone(),
            new THREE.MeshToonMaterial({ color: '#ffffff' }), WRECK.bodies * 4);
        for (const mesh of [this.wreckBodies, this.wreckBarrels]) {
            mesh.count = 0; mesh.frustumCulled = false; mesh.receiveShadow = true;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mesh.instanceColor = new THREE.InstancedBufferAttribute(
                new Float32Array(mesh.instanceMatrix.count * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
            this.group.add(mesh);
        }
        this.shots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.18, 6, 4),
            new THREE.MeshBasicMaterial({ color: '#efba4c' }), 40000);
        this.shots.instanceColor = new THREE.InstancedBufferAttribute(
            new Float32Array(this.shots.instanceMatrix.count * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
        this.missiles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.2, 1, 8),
            new THREE.MeshToonMaterial({ color: '#d6d8d6' }), 2048);
        for (const mesh of [this.barrels, this.rotors, this.shots, this.missiles, this.airShadows]) {
            mesh.count = 0; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            this.group.add(mesh);
        }
        this.beams = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.08, 1, 6),
            new THREE.MeshBasicMaterial({ color: '#ff443b', depthTest: true }), 4096);
        this.beams.count = 0; this.beams.frustumCulled = false;
        this.beams.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.tracerLines = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.07, 1, 6),
            new THREE.MeshBasicMaterial({ color: '#ffe433' }), 256);
        this.tracerLines.count = 0; this.tracerLines.frustumCulled = false;
        this.tracerLines.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        const flashGeometry = new THREE.SphereGeometry(1, 12, 8);
        flashGeometry.setAttribute('flashAlpha',
            new THREE.InstancedBufferAttribute(this.flashAlphas, 1).setUsage(THREE.DynamicDrawUsage));
        this.explosions = new THREE.InstancedMesh(flashGeometry, new THREE.ShaderMaterial({
            transparent: true, depthTest: true, depthWrite: false,
            vertexShader: `attribute float flashAlpha; varying float alpha;
                void main() { alpha=flashAlpha;
                    gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0); }`,
            fragmentShader: `varying float alpha; void main() { gl_FragColor=vec4(1.0,1.0,1.0,alpha); }`
        }), 128);
        this.explosions.count = 0; this.explosions.frustumCulled = false;
        this.explosions.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.effects = new Effects(scene); this.sonic = new Sonic(world, scene);
        this.markers.frustumCulled = false;
        this.markers.geometry.setAttribute('position',
            new THREE.BufferAttribute(this.markerPositions, 3).setUsage(THREE.DynamicDrawUsage));
        this.markers.geometry.setAttribute('tint',
            new THREE.BufferAttribute(this.markerColors, 4).setUsage(THREE.DynamicDrawUsage));
        this.markers.geometry.setDrawRange(0, 0);
        scene.add(this.group, this.beams, this.tracerLines, this.markers, this.explosions);
        this.models = new Models(this.group);
    }
    accept(snapshot: RenderSnapshot) {
        if (!snapshot.defense) return;
        this.previous = this.snapshot; this.snapshot = snapshot;
        this.models.accept(snapshot.defense.entities, this.previous?.defense?.entities);
        this.collectWrecks(snapshot);
        for (const id of this.selected) if (!isLive(this.entity(id))) this.selected.delete(id);
        this.attacking.clear();
        const shots = snapshot.defense.projectiles, old = this.previous?.defense?.projectiles;
        const now = performance.now() / 1000;
        const impacts = snapshot.defense.explosions;
        if (impacts) {
            const count = impacts.length / RENDER_EXPLOSION_WORDS;
            if (this.explosionSeen.length !== count) this.explosionSeen = new Int32Array(count);
            for (let index = 0; index < count; index++) {
                const at = index * RENDER_EXPLOSION_WORDS, stamp = impacts[at];
                if (!stamp || stamp <= this.explosionSeen[index]) continue;
                this.explosionSeen[index] = stamp;
                const age = (snapshot.tick - stamp + 1) / TICK_HZ;
                if (impacts[at + 5] === RENDER_SALE_EFFECT) {
                    if (age < 0.8) this.saleEffects.push({ x: impacts[at + 1] / Q, z: impacts[at + 2] / Q,
                        height: impacts[at + 3] / Q + 1, born: now - age });
                    continue;
                }
                if (age >= 4) continue;
                const x = impacts[at + 1] / Q, z = impacts[at + 2] / Q;
                const definition = projectiles[impacts[at + 5]];
                const point = new THREE.Vector3(x, elevation(this.world, { x, z }) + impacts[at + 3] / Q, z);
                this.effects.trigger(definition?.impactFx ?? 'bullet', point, now - age);
                if (impacts[at + 4] < 0 && age < 0.3) this.tracer(-impacts[at + 4] - 1, point, now - age);
                if (age < 0.55 && impacts[at + 4] > 0 && definition?.motion !== 2 && definition?.impactFx !== 'gas' &&
                    EFFECTS.get(definition?.impactFx ?? '')?.flash !== false) {
                    if (this.flashes.length === 128) this.flashes.shift();
                    this.flashes.push({ x, z, y: point.y, radius: impacts[at + 4] / Q, born: now - age });
                }
            }
        }
        for (let at = 0; at < shots.length; at += RENDER_PROJECTILE_WORDS) {
            if (shots[at] === 3 && projectiles[shots[at + 4]]?.impactFx === 'gas') {
                const point = new THREE.Vector3(shots[at + 1] / Q,
                    shots[at + 3] / Q + 0.5, shots[at + 2] / Q);
                point.y += elevation(this.world, point);
                this.effects.trail('gas', point, point, now);
            }
            if (shots[at] !== 1) continue;
            this.attacking.add(Math.floor(at / RENDER_PROJECTILE_WORDS / this.ring / 4));
            const end = new THREE.Vector3(shots[at + 1] / Q, shots[at + 3] / Q + 0.6, shots[at + 2] / Q);
            const same = snapshot.tick === (this.previous?.tick ?? -2) + 1 && old?.[at] === 1 &&
                old[at + 4] === shots[at + 4] && old[at + 5] === shots[at + 5];
            const owner = this.entity(Math.floor(at / RENDER_PROJECTILE_WORDS / this.ring / 4));
            const start = same ? new THREE.Vector3(old[at + 1] / Q, old[at + 3] / Q + 0.6, old[at + 2] / Q)
                : isLive(owner) ? new THREE.Vector3(owner[E.x] / Q,
                    1.1 + (entities[owner[E.def]].options.flightHeight ?? 0) / Q, owner[E.z] / Q) : end;
            const muzzle = Math.floor(at / RENDER_PROJECTILE_WORDS / this.ring) * 3;
            if (!same && Number.isFinite(this.models.muzzles[muzzle])) {
                start.set(this.models.muzzles[muzzle], this.models.muzzles[muzzle + 1],
                    this.models.muzzles[muzzle + 2]);
                start.y -= elevation(this.world, start);
            }
            start.y += elevation(this.world, start); end.y += elevation(this.world, end);
            const definition = projectiles[shots[at + 4]];
            if (definition?.trailFx) this.effects.trail(definition.trailFx, start, end, now);
            if (!same && definition?.muzzleFx) this.effects.trigger(definition.muzzleFx, start, now);
        }
        for (let at = 0; at < snapshot.defense.beams.length; at += 8) {
            const beam = snapshot.defense.beams;
            if (beam[at] <= 0) continue;
            this.attacking.add(Math.floor(at / 32));
        }
    }
    private collectWrecks(snapshot: RenderSnapshot) {
        const rows = snapshot.defense?.entities, old = this.previous?.defense?.entities;
        if (!rows || !old) return;
        for (let id = 0; id < MAX_ENTITIES; id++) {
            const at = id * STRIDE;
            if (rows[at + E.state] || !old[at + E.state] || !(rows[at + E.flags] & ENTITY_DESTROYED) ||
                old[at + E.flags] >>> 8 !== rows[at + E.flags] >>> 8) continue;
            const definition = entities[old[at + E.def]];
            if (!definition || definition.kind < 1 || definition.kind > 4) continue;
            const facing = old[at + E.facing] * Math.PI / 32768;
            const aims = new Float32Array(4).fill(facing);
            definition.weapons.forEach((_, index) => {
                aims[index] = (old[at + RENDER_AIMS + index] & 65535) * Math.PI / 32768;
            });
            if (this.wrecks.length === WRECK.bodies) this.wrecks.shift();
            this.wrecks.push({ definition: old[at + E.def], x: old[at + E.x] / Q, z: old[at + E.z] / Q,
                facing, aims, axis: Math.random() * Math.PI * 2, born: performance.now() / 1000,
                altitude: this.altitude(old.subarray(at, at + STRIDE), snapshot.tick) });
        }
    }
    private drawWrecks(seconds: number) {
        this.wreckBodies.count = 0; this.wreckBarrels.count = 0;
        const axis = new THREE.Vector3(), pivot = new THREE.Vector3(), offset = new THREE.Vector3();
        const tilt = new THREE.Quaternion(), turn = new THREE.Quaternion(), colour = new THREE.Color();
        this.wrecks = this.wrecks.filter(wreck => {
            const definition = entities[wreck.definition], spec = this.models.spec(definition.name);
            const person = definition.kind === 2 && definition.footprint.width === 1;
            const tall = spec?.height ?? (definition.kind === 4 ? 2.5 : person ? 2 : 1.1);
            const half = Math.max(spec?.halfWidth ?? definition.footprint.width * 0.45,
                spec?.halfDepth ?? definition.footprint.depth * 0.45);
            const altitude = wreck.altitude;
            return seconds - wreck.born < WRECK.blacken +
                Math.sqrt(2 * (altitude + Math.hypot(tall, half) + WRECK.margin) / WRECK.gravity);
        });
        for (const wreck of this.wrecks) {
            const definition = entities[wreck.definition];
            const age = seconds - wreck.born, fall = Math.max(0, age - WRECK.blacken);
            const sink = WRECK.gravity * fall * fall / 2;
            const roll = WRECK.topple * fall * fall / 2;
            const shade = 1 - Math.min(1, age / WRECK.blacken);
            const altitude = wreck.altitude;
            const ground = elevation(this.world, { x: wreck.x, z: wreck.z });
            this.modelKicks.fill(0);
            if (this.models.pose(definition.name, MAX_ENTITIES, wreck.x, ground + altitude, wreck.z,
                wreck.facing, wreck.aims, this.modelKicks, seconds, false,
                { roll, sink, shade, axis: wreck.axis })) continue;
            const person = definition.kind === 2 && definition.footprint.width === 1;
            const tall = definition.kind === 4 ? 2.5 : person ? 2 : 1.1;
            const cos = Math.cos(wreck.facing), sin = Math.sin(wreck.facing);
            axis.set(Math.cos(wreck.axis), 0, Math.sin(wreck.axis)); tilt.setFromAxisAngle(axis, roll);
            pivot.set(wreck.x, ground + altitude - sink, wreck.z);
            if (this.wreckBodies.count < WRECK.bodies) {
                offset.set(0, tall / 2, 0).applyQuaternion(tilt).add(pivot);
                turn.setFromAxisAngle(THREE.Object3D.DefaultUp, -wreck.facing).premultiply(tilt);
                this.scale.set(person ? 0.7 : definition.footprint.width * 0.9, tall,
                    person ? 0.7 : definition.footprint.depth * 0.9);
                this.matrix.compose(offset, turn, this.scale);
                this.wreckBodies.setMatrixAt(this.wreckBodies.count, this.matrix);
                this.wreckBodies.setColorAt(this.wreckBodies.count++,
                    colour.set(bodyColor(definition)).multiplyScalar(shade));
            }
            definition.weapons.forEach((mount, index) => {
                const mx = mount.x / Q, mz = mount.z / Q;
                offset.set(mx * cos - mz * sin, tall, mx * sin + mz * cos).applyQuaternion(tilt).add(pivot);
                turn.setFromAxisAngle(THREE.Object3D.DefaultUp, Math.PI / 2 - wreck.aims[index]).premultiply(tilt);
                this.scale.set(1, 1, 1); this.matrix.compose(offset, turn, this.scale);
                this.wreckBarrels.setMatrixAt(this.wreckBarrels.count, this.matrix);
                this.wreckBarrels.setColorAt(this.wreckBarrels.count++,
                    colour.set(BARREL_COLOR).multiplyScalar(shade));
            });
        }
        for (const mesh of [this.wreckBodies, this.wreckBarrels]) {
            mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
    }
    private tracer(mount: number, to: T.Vector3, born: number) {
        const owner = this.entity(Math.floor(mount / 4)), from = new THREE.Vector3();
        if (Number.isFinite(this.models.muzzles[mount * 3]))
            from.set(this.models.muzzles[mount * 3], this.models.muzzles[mount * 3 + 1],
                this.models.muzzles[mount * 3 + 2]);
        else if (isLive(owner)) {
            const x = owner[E.x] / Q, z = owner[E.z] / Q;
            from.set(x, elevation(this.world, { x, z }) + 1.1 +
                (entities[owner[E.def]].options.flightHeight ?? 0) / Q, z);
        } else return;
        if (this.tracers.length === 64) this.tracers.shift();
        this.tracers.push({ from, to: to.clone(), born });
    }
    private circle(x: number, z: number, radius: number, color: string,
        others: Array<{ x: number; z: number; radius: number }> = [], thickness = 2) {
        const count = Math.max(128, Math.min(4096, Math.ceil(2 * Math.PI * radius / 0.5)));
        const width = Math.max(0.025, this.camera.distance * 0.001 * thickness);
        for (let i = 1; i <= count; i++) {
            const angle = i * 2 * Math.PI / count, previous = (i - 1) * 2 * Math.PI / count;
            const mid = (angle + previous) / 2;
            if (others.some(other => Math.hypot(x + Math.cos(mid) * radius - other.x,
                z + Math.sin(mid) * radius - other.z) < other.radius - 0.001)) continue;
            this.terrainLine({ x: x + Math.cos(previous) * radius, z: z + Math.sin(previous) * radius },
                { x: x + Math.cos(angle) * radius, z: z + Math.sin(angle) * radius },
                color, width, this.context.globalAlpha);
        }
    }
    private terrainLine(from: { x: number; z: number }, to: { x: number; z: number },
        color: string, width: number, alpha = 1) {
        const dx = to.x - from.x, dz = to.z - from.z, distance = Math.hypot(dx, dz);
        if (distance < 0.00001) return;
        const count = Math.min(4096, Math.max(1, Math.ceil(distance / 0.5)));
        const required = this.markerCount + count * 6;
        if (required * 3 > this.markerPositions.length) {
            const capacity = Math.max(required, this.markerPositions.length / 3 * 2);
            const positions = new Float32Array(capacity * 3), colors = new Float32Array(capacity * 4);
            positions.set(this.markerPositions); colors.set(this.markerColors);
            this.markers.geometry.dispose(); this.markerPositions = positions; this.markerColors = colors;
            this.markers.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
            this.markers.geometry.setAttribute('tint', new THREE.BufferAttribute(colors, 4).setUsage(THREE.DynamicDrawUsage));
        }
        const ox = -dz / distance * width / 2, oz = dx / distance * width / 2, tint = new THREE.Color(color);
        for (let i = 0; i < count; i++) {
            const a = { x: from.x + dx * i / count, z: from.z + dz * i / count };
            const b = { x: from.x + dx * (i + 1) / count, z: from.z + dz * (i + 1) / count };
            for (const [point, sign] of [[a, -1], [b, -1], [b, 1], [a, -1], [b, 1], [a, 1]] as const) {
                const x = point.x + ox * sign, z = point.z + oz * sign;
                this.markerPositions.set([x, elevation(this.world, { x, z }) + 0.08, z], this.markerCount * 3);
                this.markerColors.set([tint.r, tint.g, tint.b, alpha], this.markerCount++ * 4);
            }
        }
        this.markers.geometry.setDrawRange(0, this.markerCount);
        this.markers.geometry.getAttribute('position').needsUpdate = true;
        this.markers.geometry.getAttribute('tint').needsUpdate = true;
    }
    private rangesAt(definition: number, x: number, z: number) {
        const unit = entities[definition];
        const ranges = [...new Set(unit.weapons.flatMap(mount =>
            [weapons[mount.definition].minRange / Q, weapons[mount.definition].maxRange / Q]))]
            .filter(radius => radius > 0).map(radius => ({ x, z, radius, color: '#c74840' }));
        if (unit.kind === 4 && unit.options.radius)
            ranges.push({ x, z, radius: unit.options.radius / Q, color: '#438bd1' });
        return ranges;
    }
    private drawTintedIcon(definition: number, x: number, y: number, color: string) {
        const icon = this.icons.get(definition), buffer = this.iconTint.getContext('2d');
        if (!icon?.complete || !icon.naturalWidth || !buffer) return;
        buffer.globalCompositeOperation = 'source-over';
        buffer.clearRect(0, 0, 24, 24); buffer.drawImage(icon, 0, 0, 24, 24);
        buffer.globalCompositeOperation = 'multiply'; buffer.fillStyle = color;
        buffer.fillRect(0, 0, 24, 24);
        buffer.globalCompositeOperation = 'destination-in'; buffer.drawImage(icon, 0, 0, 24, 24);
        this.context.drawImage(this.iconTint, x, y);
    }
    ghostIcon(definition: number, x: number, z: number) {
        const point = this.camera.project(x, z, 0.2);
        if (!point.visible) return;
        const bounds = this.camera.canvas.getBoundingClientRect();
        this.context.save(); this.context.globalAlpha = 0.55;
        this.drawTintedIcon(definition, point.x - bounds.left - 12, point.y - bounds.top - 12, '#69d98c');
        this.context.restore();
    }
    rangePreview(definition: number, x: number, z: number) {
        for (const range of this.rangesAt(definition, x, z))
            this.circle(range.x, range.z, range.radius, range.color);
    }
    targetFeedback(x: number, z: number, attack: boolean) {
        this.targets.push({ x, z, attack, born: performance.now() });
        if (this.targets.length > 24) this.targets.shift();
    }
    orderLine(from: { x: number; z: number }, to: { x: number; z: number }, attack: boolean, now: number, alpha = 1) {
        const dx = to.x - from.x, dz = to.z - from.z, distance = Math.hypot(dx, dz);
        if (distance < 0.01) return;
        const ux = dx / distance, uz = dz / distance, color = attack ? '#d26b68' : '#286b9c';
        this.terrainLine(from, to, color, 1.5, alpha * 0.25);
        for (let step = now / 500 % 4; step < distance; step += 4) {
            const tip = { x: from.x + ux * step, z: from.z + uz * step };
            this.terrainLine({ x: tip.x - ux * 1.2 - uz * 0.75, z: tip.z - uz * 1.2 + ux * 0.75 },
                tip, color, 0.18, alpha);
            this.terrainLine(tip,
                { x: tip.x - ux * 1.2 + uz * 0.75, z: tip.z - uz * 1.2 - ux * 0.75 }, color, 0.18, alpha);
        }
    }
    orderETA(x: number, z: number, seconds: number) {
        const point = this.camera.project(x, z, 0.3);
        if (!point.visible || this.etaLabels.some(label => Math.abs(label.seconds - seconds) <= 3 &&
            Math.hypot(label.x - x, label.z - z) <= 3)) return;
        this.etaLabels.push({ x, z, seconds });
        const bounds = this.camera.canvas.getBoundingClientRect();
        this.etaLabel(point.x - bounds.left, point.y - bounds.top - 8, 'ETA', seconds);
    }
    private etaLabel(x: number, y: number, name: string, seconds?: number) {
        const ctx = this.context, total = Math.max(0, Math.ceil(seconds ?? 0));
        const minutes = String(Math.floor(total / 60)).padStart(2, '0');
        const time = String(total % 60).padStart(2, '0');
        const text = `${name} ${seconds === undefined ? '—:—' : `${minutes}:${time}`}`;
        ctx.save(); ctx.font = '11px monospace'; ctx.textAlign = 'center';
        ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.fillStyle = '#fff';
        ctx.strokeText(text, x, y); ctx.fillText(text, x, y); ctx.restore();
    }
    private healthBar(x: number, y: number, width: number, height: number, hp: number) {
        const ctx = this.context;
        ctx.fillStyle = '#343d37'; ctx.fillRect(x - width / 2, y, width, height);
        ctx.fillStyle = hp < 0.3 ? '#bb4c40' : '#75a57a';
        ctx.fillRect(x - width / 2, y, width * hp, height);
    }
    explodeObjective(x: number, z: number, radius: number, now: number) {
        const y = elevation(this.world, { x, z }) + 3;
        this.effects.trigger('explosion', new THREE.Vector3(x, y, z), now);
        if (this.flashes.length === 128) this.flashes.shift();
        this.flashes.push({ x, y, z, radius: Math.max(4, radius), born: now });
    }
    drawObjective(site: { x: number; z: number; radius: number }, hp: number, selected: boolean,
        tick: number, paused: boolean) {
        const economy = this.snapshot?.defense?.economy;
        if (!economy) return;
        const x = site.x / Q, z = site.z / Q, radius = site.radius / Q;
        const centre = this.camera.project(x, z), edge = this.camera.project(x + radius, z);
        if (!centre.visible) return;
        const ctx = this.context, bounds = this.camera.canvas.getBoundingClientRect();
        const px = centre.x - bounds.left, py = centre.y - bounds.top;
        const screenRadius = Math.max(20, Math.hypot(edge.x - centre.x, edge.y - centre.y));
        if (selected) {
            ctx.beginPath(); ctx.strokeStyle = '#377eaf'; ctx.lineWidth = 2;
            ctx.arc(px, py, screenRadius, 0, Math.PI * 2); ctx.stroke();
        }
        const width = Math.min(140, screenRadius * 2), barY = py + 11;
        this.healthBar(px, barY, width, 4, Math.min(1, hp / BALANCE.objective.hp));
        const tier = economy[C.objectiveTier] + 1;
        if (tier > economy[C.upgradeTarget]) return;
        const total = defaults(tier).buildSeconds * TICK_HZ * 256;
        const progress = economy[C.upgradeProgress], gain = economy[C.upgradeGain];
        const y = barY + 6;
        ctx.fillStyle = '#4a4326'; ctx.fillRect(px - width / 2, y, width, 4);
        ctx.fillStyle = '#d7b84b'; ctx.fillRect(px - width / 2, y, width * progress / total, 4);
        const name = `T${tier} Upgrade`;
        const held = economy[C.objectiveHold] !== 0;
        const label = paused || held ? `${name} (Paused)` : name;
        this.etaLabel(px, y + 16, label, gain && !held ? (total - progress) / (gain * TICK_HZ) : undefined);
        if (!gain || held) return;
        ctx.save(); ctx.fillStyle = '#ffdc73';
        for (let i = 0; i < 60; i++) {
            const age = ((tick / TICK_HZ + i / 60) % 1 + 1) % 1;
            const angle = i * 2.4 + tick / TICK_HZ * 5 + age * 3;
            const spread = radius * (0.75 + age / 3);
            const spark = this.camera.project(x + Math.cos(angle) * spread, z + Math.sin(angle) * spread, 1 + age * 6);
            if (!spark.visible) continue;
            ctx.globalAlpha = 1 - age;
            ctx.fillRect(spark.x - bounds.left, spark.y - bounds.top, 3 - age, 3 - age);
        }
        ctx.restore();
    }
    entity(id: number) {
        return this.snapshot?.defense?.entities.subarray(id * STRIDE, id * STRIDE + STRIDE);
    }
    altitude(row: Int32Array, tick: number): number {
        if (row[E.state] === 2) return 0;
        const height = (entities[row[E.def]].options.flightHeight ?? 0) / Q;
        if (!height || !row[E.progress]) return height;
        const ascent = Math.max(0, Math.min(1, (tick - row[E.decay] - 1) / 20));
        return height * ascent * (2 - ascent);
    }
    hit(x: number, y: number) {
        let result = -1, distance = Infinity;
        for (let id = 0; id < MAX_ENTITIES; id++) {
            const row = this.entity(id); if (!isLive(row)) continue;
            const definition = entities[row[E.def]], spec = this.models.spec(definition.name);
            const altitude = this.altitude(row, this.snapshot?.tick ?? 0);
            const point = this.camera.project(row[E.x] / Q, row[E.z] / Q, altitude + (spec?.height ?? 2) / 2);
            const edge = this.camera.project(row[E.x] / Q + (spec?.halfWidth ?? 0), row[E.z] / Q,
                altitude + (spec?.height ?? 2));
            const radius = Math.max(20, Math.hypot(edge.x - point.x, edge.y - point.y));
            const d = Math.hypot(x - point.x, y - point.y);
            if (point.visible && d < radius && d < distance) {
                result = id; distance = d;
            }
        }
        return result;
    }
    zombie(x: number, y: number) {
        const words = this.snapshot?.words; if (!words) return -1;
        let result = -1, distance = 14;
        for (let id = 0; id < words.length / 3; id++) {
            if (!zombieHp(words[id * 3 + 2])) continue;
            const point = this.camera.project(words[id * 3] / Q, words[id * 3 + 1] / Q, 1);
            const d = Math.hypot(x - point.x, y - point.y);
            if (point.visible && d < distance) {
                result = id; distance = d;
            }
        }
        return result;
    }
    pathHit(x: number, y: number) {
        return this.paths.find(point => {
            const dx = point.x - point.sx, dy = point.y - point.sy;
            const fraction = Math.max(0, Math.min(1, ((x - point.sx) * dx + (y - point.sy) * dy) /
                Math.max(1, dx * dx + dy * dy)));
            return Math.hypot(x - point.sx - dx * fraction, y - point.sy - dy * fraction) < 12;
        });
    }
    private transform(mesh: T.InstancedMesh, index: number, x: number, z: number,
        height: number, angle: number, width: number, tall: number, depth: number, opacity = 1, tint?: T.Color) {
        this.position.set(x, elevation(this.world, { x, z }) + height, z);
        this.rotation.setFromAxisAngle(THREE.Object3D.DefaultUp, angle);
        this.scale.set(width, tall, depth); this.matrix.compose(this.position, this.rotation, this.scale);
        mesh.setMatrixAt(index, this.matrix);
        if (tint) mesh.setColorAt(index, tint);
        mesh.geometry.getAttribute('constructionAlpha')?.setX(index, opacity);
    }
    draw(now: number, tick: number, shift: boolean) {
        this.markerCount = 0; this.markers.geometry.setDrawRange(0, 0); this.etaLabels.length = 0;
        const snapshot = this.snapshot, defense = snapshot?.defense;
        if (!snapshot || !defense) return;
        const bounds = this.camera.canvas.getBoundingClientRect();
        const ratio = Math.min(devicePixelRatio, 2);
        const width = Math.round(bounds.width * ratio), height = Math.round(bounds.height * ratio);
        if (this.overlay.width !== width || this.overlay.height !== height) {
            this.overlay.width = width; this.overlay.height = height;
        }
        const ctx = this.context; ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, bounds.width, bounds.height);
        const project = (x: number, z: number, h = 0) => {
            const point = this.camera.project(x, z, h);
            return { x: point.x - bounds.left, y: point.y - bounds.top, visible: point.visible };
        };
        const span = snapshot.tick - (this.previous?.tick ?? snapshot.tick);
        const alpha = span > 0 ? Math.max(0, Math.min(1, (tick - (this.previous?.tick ?? tick)) / span)) : 1;
        for (const mesh of this.bodies.values()) mesh.count = 0;
        this.airShadows.count = 0;
        (this.airShadows.material as T.Material).opacity = 0.24 * (1 - this.camera.fade);
        this.barrels.count = 0; this.rotors.count = 0; this.shots.count = 0;
        this.missiles.count = 0; this.beams.count = 0; this.paths = [];
        this.group.visible = this.camera.fade < 0.99;
        this.models.begin(this.camera.fade);
        this.effects.update(now / 1000, this.camera.distance, this.camera.fade);
        this.sonic.update(defense.entities, this.camera.camera, now / 1000, this.camera.fade);
        for (const ring of this.effects.rings) {
            const age = Math.max(0, (now / 1000 - ring.born) / ring.life);
            ctx.globalAlpha = 1 - age;
            this.circle(ring.x, ring.z, Math.max(0.1, ring.radius * age), ring.color);
        }
        ctx.globalAlpha = 1;
        this.flashes = this.flashes.filter(flash => now / 1000 - flash.born < 0.55);
        this.explosions.count = 0;
        this.rotation.identity();
        for (const flash of this.flashes) {
            const age = Math.max(0, Math.min(1, (now / 1000 - flash.born) / 0.55));
            const radius = Math.max(0.05, flash.radius * (1 - Math.pow(1 - age, 3)));
            const index = this.explosions.count++;
            this.position.set(flash.x, flash.y, flash.z); this.scale.setScalar(radius);
            this.matrix.compose(this.position, this.rotation, this.scale);
            this.explosions.setMatrixAt(index, this.matrix);
            this.flashAlphas[index] = Math.min(1, (1 - age) * 0.55 / 0.05);
        }
        this.explosions.instanceMatrix.needsUpdate = true;
        this.explosions.geometry.getAttribute('flashAlpha').needsUpdate = true;
        const circles: Array<{ x: number; z: number; radius: number; color: string }> = [];
        const ranges: Array<{ x: number; z: number; radius: number; color: string; owner: number }> = [];
        for (const mesh of [...this.bodies.values(), this.barrels, this.rotors, this.shots,
            this.wreckBodies, this.wreckBarrels]) {
            const material = mesh.material as T.Material;
            material.transparent = true; material.opacity = 1 - this.camera.fade;
        }
        const tint = new THREE.Color();
        for (let id = 0; id < MAX_ENTITIES; id++) {
            const row = this.entity(id); if (!isLive(row)) continue;
            const definition = entities[row[E.def]], body = this.bodies.get(row[E.def]);
            if (!definition || !body) continue;
            const old = this.previous?.defense?.entities.subarray(id * STRIDE, id * STRIDE + STRIDE);
            const same = isLive(old) && old[E.flags] >>> 8 === row[E.flags] >>> 8;
            const x = (same ? old[E.x] + (row[E.x] - old[E.x]) * alpha : row[E.x]) / Q;
            const z = (same ? old[E.z] + (row[E.z] - old[E.z]) * alpha : row[E.z]) / Q;
            const facing = (same ? old[E.facing] +
                (((row[E.facing] - old[E.facing] + 32768) & 65535) - 32768) * alpha : row[E.facing]) * Math.PI / 32768;
            const person = definition.kind === 2 && definition.footprint.width === 1;
            const spec = this.models.spec(definition.name);
            const tall = spec?.height ??
                (person ? 2 : definition.kind === 5 ? 0.15 : definition.kind === 4 ? 2.5 : 1.1);
            const complete = row[E.state] !== 2;
            const altitude = this.altitude(row, tick);
            const opacity = complete ? 1 : 0.5;
            const source = row[E.rotation] >>> 2;
            const color = PLAYER_COLORS[this.roster.find(player => player.slot === source)?.color ?? source % 8];
            tint.set(color);
            this.modelAims.fill(facing); this.modelKicks.fill(0);
            if (complete) definition.weapons?.forEach((_, index) => {
                const currentAim = row[RENDER_AIMS + index] & 65535;
                const previousAim = (old?.[RENDER_AIMS + index] ?? 0) & 65535;
                const turn = same ? previousAim +
                    (((currentAim - previousAim + 32768) & 65535) - 32768) * alpha : currentAim;
                this.modelAims[index] = turn * Math.PI / 32768;
                const charge = (row[RENDER_AIMS + index] >>> RENDER_CHARGE_SHIFT) & 255;
                this.modelKicks[index] = Math.max(0, 1 - charge / 32);
            });
            const modelled = this.models.pose(definition.name, id, x, elevation(this.world, { x, z }) + altitude,
                z, facing, this.modelAims, this.modelKicks, complete ? now / 1000 : 0,
                complete && this.attacking.has(id), undefined, opacity, color);
            if (!modelled) this.transform(body, body.count++, x, z, altitude + tall / 2, -facing,
                person ? 0.7 : definition.footprint.width * 0.9, tall,
                person ? 0.7 : definition.footprint.depth * 0.9, opacity, tint);
            if ((definition.options.flightHeight ?? 0) > 0) {
                if (complete && altitude > 0.05) {
                    const radius = Math.max(definition.footprint.width, definition.footprint.depth) / 2;
                    this.transform(this.airShadows, this.airShadows.count++, x, z, 0.05, 0, radius, 1, radius);
                }
                if (!modelled) {
                    this.transform(this.rotors, this.rotors.count++, x, z, altitude + tall + 0.2,
                        complete ? now / 100 : 0, 1, 0.4, 3, opacity, tint);
                    this.transform(this.rotors, this.rotors.count++, x, z, altitude + tall + 0.2,
                        (complete ? now / 100 : 0) + Math.PI / 2, 1, 0.4, 3, opacity, tint);
                }
            }
            if (!modelled) definition.weapons?.forEach((mount, index) => {
                const currentAim = row[RENDER_AIMS + index] & 65535;
                const previousAim = (old?.[RENDER_AIMS + index] ?? 0) & 65535;
                const turn = same ? previousAim +
                    (((currentAim - previousAim + 32768) & 65535) - 32768) * alpha : currentAim;
                const angle = turn * Math.PI / 32768;
                const mx = (mount.x ?? 0) / Q, mz = (mount.z ?? 0) / Q;
                this.transform(this.barrels, this.barrels.count++, x + mx * Math.cos(facing) - mz * Math.sin(facing),
                    z + mx * Math.sin(facing) + mz * Math.cos(facing), altitude + tall,
                    Math.PI / 2 - angle, 1, 1, 1, opacity, tint);
            });
            const point = project(x, z, altitude + tall + 0.4);
            if (!point.visible && !(shift && !this.logicalOrders.has(id))) continue;
            const selected = this.selected.has(id), hp = Math.max(0, row[E.hp] / definition.maxHp);
            if (point.visible) {
                ctx.fillStyle = color; ctx.fillRect(point.x - 4, point.y + 4, 8, 4);
            }
            if (selected) {
                const mine = this.roster.find(player => player.slot === this.localSlot);
                const selectionColor = PLAYER_COLORS[mine?.color ?? 0];
                circles.push({ x, z, color: selectionColor,
                    radius: Math.hypot(definition.footprint.width, definition.footprint.depth) * 0.6 });
                ranges.push(...this.rangesAt(row[E.def], x, z).map(range => ({ ...range, owner: id })));
            }
            if (this.camera.fade > 0.01) {
                ctx.save(); ctx.globalAlpha = this.camera.fade; ctx.translate(point.x, point.y);
                ctx.translate(-12, -12);
                ctx.globalAlpha *= opacity;
                this.drawTintedIcon(row[E.def], 0, 0, color);
                ctx.fillStyle = hp < 0.3 ? '#bb4c40' : '#35596b';
                for (let pip = 0; pip < definition.tier; pip++) ctx.fillRect(4 + pip * 6, 25, 3, 3);
                ctx.restore();
            }
            let charge = 1, cooldownBar = false;
            definition.weapons?.forEach((mount, index) => {
                const weapon = weapons[mount.definition];
                if ((weapon.fire.kind !== 0 && weapon.fire.kind !== 3) ||
                    weapon.cooldown < BALANCE.cooldownBarMinTicks) return;
                const value = (row[RENDER_AIMS + index] >>> RENDER_CHARGE_SHIFT) & 255;
                const before = same ? ((old[RENDER_AIMS + index] >>> RENDER_CHARGE_SHIFT) & 255) : value;
                charge = Math.min(charge, (value < before ? value : before + (value - before) * alpha) / 255);
                cooldownBar = true;
            });
            if (point.visible) {
                const ground = elevation(this.world, { x, z });
                const centre = new THREE.Vector3(x, ground + altitude + tall / 2, z)
                    .applyMatrix4(this.camera.camera.matrixWorldInverse);
                const pixels = bounds.height / (2 * Math.tan(this.camera.camera.fov * Math.PI / 360) *
                    Math.max(0.01, -centre.z));
                const barWidth = definition.footprint.width * pixels, barHeight = pixels * 0.13;
                let barY = project(x, z, altitude + tall / 2).y;
                const halfWidth = spec?.halfWidth ?? (person ? 0.7 : definition.footprint.width * 0.9) / 2;
                const halfDepth = spec?.halfDepth ?? (person ? 0.7 : definition.footprint.depth * 0.9) / 2;
                for (const dx of [-halfWidth, halfWidth]) for (const dz of [-halfDepth, halfDepth])
                    for (const h of [altitude, altitude + tall]) {
                        const cx = x + dx * Math.cos(facing) - dz * Math.sin(facing);
                        const cz = z + dx * Math.sin(facing) + dz * Math.cos(facing);
                        const corner = project(cx, cz, h + ground - elevation(this.world, { x: cx, z: cz }));
                        if (corner.visible) barY = Math.max(barY, corner.y);
                    }
                if (this.camera.fade > 0.01) barY = Math.max(barY, point.y + 30);
                barY += Math.max(2, pixels * 0.06);
                this.healthBar(point.x, barY, barWidth, barHeight, hp);
                if (definition.kind === 4) {
                    const shield = Math.max(0, Math.min(1, row[E.power] / Math.max(1, definition.options.power ?? 0)));
                    const y = barY + barHeight + pixels * 0.06;
                    ctx.fillStyle = '#263b4a'; ctx.fillRect(point.x - barWidth / 2, y, barWidth, barHeight);
                    ctx.fillStyle = '#438bd1'; ctx.fillRect(point.x - barWidth / 2, y, barWidth * shield, barHeight);
                }
                if (cooldownBar) {
                    const y = barY + (barHeight + pixels * 0.06) * (definition.kind === 4 ? 2 : 1);
                    ctx.fillStyle = '#4a4326'; ctx.fillRect(point.x - barWidth / 2, y, barWidth, barHeight);
                    ctx.fillStyle = '#d7b84b'; ctx.fillRect(point.x - barWidth / 2, y, barWidth * charge, barHeight);
                }
            }
            if (shift && !this.logicalOrders.has(id)) {
                let start = point, origin = { x, z }, seconds = 0;
                for (let segment = 0; segment < row[E.orderCount]; segment++) {
                    const at = RENDER_ORDERS + segment * 4, kind = row[at];
                    let tx = row[at + 1] / Q, tz = row[at + 2] / Q;
                    if (kind === 1) {
                        const victim = row[at + 1], words = snapshot.words;
                        tx = words[victim * 3] / Q; tz = words[victim * 3 + 1] / Q;
                    }
                    const end = project(tx, tz, 0.4);
                    this.orderLine(origin, { x: tx, z: tz }, kind === 1 || kind === 2 || kind === 3, now);
                    seconds += Math.hypot(tx - origin.x, tz - origin.z) /
                        Math.max(0.01, (definition.options.speed ?? 0) / Q);
                    if (kind === 0 && ((row[at + 3] & 2) === 0 || (row[at + 3] & ORDER_WAYPOINT) !== 0))
                        this.orderETA(tx, tz, seconds);
                    origin = { x: tx, z: tz };
                    this.paths.push({ id, segment, x: end.x + bounds.left, y: end.y + bounds.top,
                        sx: start.x + bounds.left, sy: start.y + bounds.top }); start = end;
                }
            }
        }
        circles.forEach((circle, index) => this.circle(circle.x, circle.z, circle.radius, circle.color,
            circles.filter((_, other) => other !== index), 2.5));
        for (const [slot, ids] of this.teammateSelections) {
            if (slot === this.localSlot) continue;
            const color = PLAYER_COLORS[this.roster.find(player => player.slot === slot)?.color ?? slot % 8];
            for (const id of ids) {
                const row = this.entity(id);
                if (!isLive(row)) continue;
                const definition = entities[row[E.def]], x = row[E.x] / Q, z = row[E.z] / Q;
                const radius = Math.hypot(definition.footprint.width, definition.footprint.depth) * 0.6 + 0.15;
                this.circle(x, z, radius, color, [], 1.5);
            }
        }
        for (const range of ranges) this.circle(range.x, range.z, range.radius, range.color,
            ranges.filter(other => other.owner !== range.owner && other.color === range.color));
        this.targets = this.targets.filter(target => now - target.born < 1000);
        for (const target of this.targets) {
            const age = Math.max(0, now - target.born) / 1000;
            ctx.globalAlpha = 1 - age;
            this.circle(target.x, target.z, 1.5 + age * 2, target.attack ? '#d26b68' : '#286b9c');
            const centre = project(target.x, target.z, 0.08);
            ctx.beginPath(); ctx.moveTo(centre.x - 5, centre.y); ctx.lineTo(centre.x + 5, centre.y);
            ctx.moveTo(centre.x, centre.y - 5); ctx.lineTo(centre.x, centre.y + 5); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        this.saleEffects = this.saleEffects.filter(effect => now / 1000 - effect.born < 0.8);
        if (this.saleEffects.length) {
            ctx.save();
            ctx.font = 'bold 16px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#ffcf55';
            ctx.strokeStyle = '#403019';
            ctx.lineWidth = 2;
            for (const effect of this.saleEffects) {
                const point = project(effect.x, effect.z, effect.height);
                if (!point.visible) continue;
                for (let i = -1; i <= 1; i++) {
                    const age = Math.max(0, now / 1000 - effect.born - Math.abs(i) * 0.08) / 0.72;
                    if (age >= 1) continue;
                    ctx.globalAlpha = 1 - age;
                    const x = point.x + i * (8 + 10 * age), y = point.y - (26 + 7 * (i + 1)) * age;
                    ctx.strokeText('$', x, y);
                    ctx.fillText('$', x, y);
                }
            }
            ctx.restore();
        }
        this.drawWrecks(now / 1000);
        this.models.end();
        this.airShadows.instanceMatrix.needsUpdate = true;
        for (const mesh of [...this.bodies.values(), this.barrels, this.rotors]) {
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
            mesh.geometry.getAttribute('constructionAlpha').needsUpdate = true;
        }
        let warnings = 0;
        for (let at = 0; at < defense.projectiles.length && this.shots.count < 40000;
            at += RENDER_PROJECTILE_WORDS) {
            if (!defense.projectiles[at]) continue;
            const old = this.previous?.defense?.projectiles;
            const same = span === 1 && old?.[at] === 1 && defense.projectiles[at] === 1 &&
                old[at + 4] === defense.projectiles[at + 4] && old[at + 5] === defense.projectiles[at + 5];
            const coordinate = (word: number) => (same ? old[at + word] +
                (defense.projectiles[at + word] - old[at + word]) * alpha : defense.projectiles[at + word]) / Q;
            const x = coordinate(1), z = coordinate(2), h = coordinate(3) + 0.6;
            const definition = projectiles[defense.projectiles[at + 4]];
            if (definition?.motion === 4 && warnings++ < 32) {
                const targetX = defense.projectiles[at + 6] / Q, targetZ = defense.projectiles[at + 7] / Q;
                const fraction = Math.max(0, Math.min(1, coordinate(3) / Math.max(1, (definition.altitude ?? Q) / Q)));
                ctx.globalAlpha = fraction <= 5 / definition.ttl ? 1 : 0.55 + 0.4 * Math.sin(now * Math.PI * 8 / 1000);
                this.circle(targetX, targetZ, definition.splashRadius / Q, '#df3030', [], 3);
                this.circle(targetX, targetZ, Math.max(0.1, definition.splashRadius / Q * fraction), '#df3030');
                ctx.globalAlpha = 1;
            }
            if (definition?.motion === 4) {
                if (this.missiles.count >= 2048) continue;
                this.beamDirection.set(defense.projectiles[at + 6] / Q - x, -h,
                    defense.projectiles[at + 7] / Q - z).normalize();
                this.rotation.setFromUnitVectors(this.beamAxis, this.beamDirection);
                this.position.set(x, elevation(this.world, { x, z }) + h, z); this.scale.set(1, 6, 1);
                this.matrix.compose(this.position, this.rotation, this.scale);
                this.missiles.setMatrixAt(this.missiles.count++, this.matrix); continue;
            }
            if (definition?.motion !== 2) {
                if (this.camera.strategic && defense.projectiles[at] === 1) {
                    const point = project(x, z, h), edge = project(x + 0.18, z, h);
                    if (point.visible) {
                        const radius = Math.max(2, Math.hypot(edge.x - point.x, edge.y - point.y));
                        ctx.fillStyle = '#e9b448'; ctx.beginPath();
                        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.fill();
                    }
                }
                continue;
            }
            this.transform(this.shots, this.shots.count, x, z, h, 0, 1.8, 1.8, 1.8);
            this.shots.setColorAt(this.shots.count++, new THREE.Color('#81cadd'));
        }
        this.shots.instanceMatrix.needsUpdate = true; this.missiles.instanceMatrix.needsUpdate = true;
        if (this.shots.instanceColor) this.shots.instanceColor.needsUpdate = true;
        for (let at = 0; at < defense.beams.length; at += 8) {
            if (defense.beams[at] <= 0) continue;
            const x = defense.beams[at + 1] / Q, z = defense.beams[at + 2] / Q;
            const angle = defense.beams[at + 5] * Math.PI / 32768;
            const range = defense.beams[at + 3] / Q;
            if (!range) continue;
            this.beamDirection.set(Math.cos(angle), 0, Math.sin(angle));
            this.position.set(x + this.beamDirection.x * range / 2,
                elevation(this.world, { x, z }) + 1.2, z + this.beamDirection.z * range / 2);
            this.rotation.setFromUnitVectors(this.beamAxis, this.beamDirection);
            this.scale.set(1, range, 1); this.matrix.compose(this.position, this.rotation, this.scale);
            this.beams.setMatrixAt(this.beams.count++, this.matrix);
        }
        this.beams.instanceMatrix.needsUpdate = true;
        this.tracers = this.tracers.filter(tracer => now / 1000 - tracer.born < 0.3);
        this.tracerLines.count = 0;
        for (const tracer of this.tracers) {
            if (Math.floor((now / 1000 - tracer.born) * 40) % 2) continue;
            this.beamDirection.subVectors(tracer.to, tracer.from);
            const length = this.beamDirection.length(); if (length < 0.01) continue;
            this.beamDirection.divideScalar(length);
            this.position.addVectors(tracer.from, tracer.to).multiplyScalar(0.5);
            this.rotation.setFromUnitVectors(this.beamAxis, this.beamDirection);
            this.scale.set(1, length, 1); this.matrix.compose(this.position, this.rotation, this.scale);
            this.tracerLines.setMatrixAt(this.tracerLines.count++, this.matrix);
        }
        this.tracerLines.instanceMatrix.needsUpdate = true;
        if (this.camera.zombieFade > 0.01) {
            ctx.globalAlpha = this.camera.zombieFade;
            const { words } = snapshot, { cell, columns, rows, density } = defense;
            for (let i = 0; i < words.length; i += 3) {
                const packed = words[i + 2];
                if (!zombieHp(packed)) continue;
                const x = words[i] / Q, z = words[i + 1] / Q;
                const col = Math.min(columns - 1, Math.max(0, Math.floor(x / cell)));
                const row = Math.min(rows - 1, Math.max(0, Math.floor(z / cell)));
                if (density[row * columns + col] > 50) continue;
                const point = project(x, z);
                if (!point.visible) continue;
                ctx.fillStyle = this.zombieColors[packed & 255];
                ctx.beginPath(); ctx.arc(point.x, point.y, 2, 0, Math.PI * 2); ctx.fill();
            }
            ctx.globalAlpha *= 0.65;
            ctx.fillStyle = '#b2463b';
            for (let i = 0; i < density.length; i++) {
                const count = density[i]; if (count <= 50) continue;
                const point = project((i % columns + 0.5) * cell, (Math.floor(i / columns) + 0.5) * cell);
                if (!point.visible) continue;
                ctx.beginPath(); ctx.arc(point.x, point.y, Math.min(7, 1 + Math.sqrt(count)) * 0.65,
                    0, Math.PI * 2); ctx.fill();
            }
            ctx.globalAlpha = 1;
        }
    }
    renderRefraction(renderer: T.WebGLRenderer) {
        this.sonic.render(renderer, this.camera.camera);
    }
    destroy() {
        this.group.parent?.remove(this.group); this.overlay.remove();
        this.effects.destroy(); this.sonic.destroy(); this.beams.parent?.remove(this.beams);
        this.tracerLines.parent?.remove(this.tracerLines); this.explosions.parent?.remove(this.explosions);
        this.markers.parent?.remove(this.markers); this.markers.geometry.dispose(); this.markers.material.dispose();

        for (const mesh of [...this.bodies.values(), this.barrels, this.rotors, this.wreckBodies, this.wreckBarrels,
            this.shots, this.missiles, this.beams, this.tracerLines, this.explosions, this.airShadows]) {
            mesh.dispose(); mesh.geometry.dispose(); (mesh.material as T.Material).dispose();
        }
        this.models.destroy();
        this.group.clear(); this.bodies.clear(); this.icons.clear();
        this.snapshot = undefined; this.previous = undefined; this.wrecks = [];
        this.flashes = []; this.tracers = []; this.saleEffects = []; this.explosionSeen = new Int32Array(0);
    }
}
