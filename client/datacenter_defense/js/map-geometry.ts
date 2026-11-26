import type * as T from 'three';
import { contains, type Entity, type Point, type World } from './mapx.js';
import { bounds, center, elevation, seededRandom } from './editor/world.js';
import { valueNoise } from '../../shared/ts/value-noise.js';
import { clip } from './polygon-clip.js';

export const MAP_FOG_COLOR = '#dce0d8';

const colors: Record<string, string> = {
    grass: '#b8c7a2', road: '#eeeade', water: '#96becd', building: '#cdcdc7'
};
type TerrainCover = { polygon: ClipPolygon; bounds: ReturnType<typeof bounds>; color: string };
const ring = (points: Array<Point>): ClipPolygon => [points.map(p => [p.x, p.z])];
function shapes(polygons: ClipMultiPolygon) {
    return polygons.map(polygon => {
        const shape = new THREE.Shape(polygon[0].map(p => new THREE.Vector2(p[0], -p[1])));
        shape.holes = polygon.slice(1).map(hole => new THREE.Path(hole.map(p => new THREE.Vector2(p[0], -p[1]))));
        return shape;
    });
}
function dispose(group: T.Object3D) {
    group.traverse(object => {
        if (object instanceof THREE.Mesh) {
            object.geometry.dispose();
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach(material => material.dispose());
        }
    });
}

export class MapGeometry {
    group = new THREE.Group();
    details = true;
    overlays = true;
    private cache = new Map<string, { signature: string; group: T.Group; objective: boolean }>();
    private merged?: T.Group;
    setObjectiveFall(progress: number) {
        for (const entry of this.cache.values())
            if (entry.objective) entry.group.rotation.z = -Math.PI / 2 * progress * progress;
    }
    sync(world: World, showSpawns = true) {
        let changed = false;
        const keep = new Set<string>();
        const update = (key: string, signature: string, create: () => T.Group, objective = false) => {
            keep.add(key);
            const cached = this.cache.get(key);
            if (cached?.signature === signature) return;
            const group = create();
            changed = true;
            if (cached) {
                this.group.remove(cached.group);
                dispose(cached.group);
            }
            if (objective) this.group.add(group);
            this.cache.set(key, { signature, group, objective });
        };
        const regions = world.objects.filter(e => e.kind === 'region' && e.type !== 'placeable').map(e => ({
            polygon: ring(e.polygon), bounds: bounds(e.polygon), color: colors[e.type] || colors.grass
        }));
        const t = world.terrain;
        const dx = world.width / (t.columns - 1), dz = world.depth / (t.rows - 1);
        for (let z = 0; z < t.rows - 1; z += 16) for (let x = 0; x < t.columns - 1; x += 16) {
            const heights: Array<number> = [];
            for (let j = z; j <= Math.min(z + 16, t.rows - 1); j++)
                heights.push(...t.heights.slice(j * t.columns + x, j * t.columns + Math.min(x + 17, t.columns)));

            const covers = regions.filter(e => e.bounds.maxX >= x * dx && e.bounds.minX <= (x + 16) * dx &&
                e.bounds.maxZ >= z * dz && e.bounds.minZ <= (z + 16) * dz);
            update(`terrain-${x}-${z}`, JSON.stringify([world.width, world.depth, t.columns, t.rows, heights, covers]),
                () => this.terrain(world, x, z, covers));
        }
        let sum = 0, squares = 0;
        const edge: Array<number> = [];
        for (let z = 0; z < t.rows; z++) for (let x = 0; x < t.columns; x++) {
            const h = t.heights[z * t.columns + x];
            sum += h;
            squares += h * h;
            if (x < 2 || z < 2 || x >= t.columns - 2 || z >= t.rows - 2) edge.push(h);
        }
        const variance = Math.max(0, squares / t.heights.length - (sum / t.heights.length) ** 2);
        update('surroundings', JSON.stringify([world.width, world.depth, world.origin, t.columns, t.rows, edge, variance]),
            () => this.surroundings(world, Math.sqrt(variance)));
        const dimensions = `${world.width},${world.depth}`;
        for (const e of world.objects) {
            if (e.kind === 'passage' || e.kind === 'region' || (!showSpawns && e.kind === 'spawn')) continue;
            const passages = world.objects.filter(p => p.kind === 'passage' && p.parent === e.id);
            const ground = elevation(world, center(e));
            let bottom = -1;
            if (e.kind === 'building') {
                const b = bounds(e.polygon);
                const endZ = Math.min(t.rows - 1, Math.ceil(b.maxZ / dz));
                const endX = Math.min(t.columns - 1, Math.ceil(b.maxX / dx));
                for (let z = Math.max(0, Math.floor(b.minZ / dz)); z <= endZ; z++)
                    for (let x = Math.max(0, Math.floor(b.minX / dx)); x <= endX; x++)
                        bottom = Math.min(bottom, t.heights[z * t.columns + x] - ground - 1);
            }
            const signature = JSON.stringify([e, passages, ground, bottom, this.details, this.overlays, dimensions]);
            update(e.id, signature, () => e.kind === 'building'
                ? this.building(e, passages, ground, bottom) : this.marker(e, ground), e.kind === 'objective');
        }
        for (const [key, cached] of this.cache) if (!keep.has(key)) {
            changed = true;
            this.group.remove(cached.group);
            dispose(cached.group);
            this.cache.delete(key);
        }
        if (changed) {
            if (this.merged) {
                this.group.remove(this.merged);
                dispose(this.merged);
            }
            this.merged = this.merge(world);
            this.group.add(this.merged);
        }
    }
    private merge(world: World) {
        type Part = {
            geometry: T.BufferGeometry; matrix: T.Matrix4; start: number; count: number;
            material: T.MeshToonMaterial | T.MeshBasicMaterial;
        };
        const batches = new Map<string, { parts: Array<Part>; count: number; mesh: T.Mesh }>();
        for (const cached of this.cache.values()) {
            if (cached.objective) continue;
            cached.group.updateMatrixWorld(true);
            cached.group.traverse(object => {
                if (!(object instanceof THREE.Mesh) || !(object.geometry instanceof THREE.BufferGeometry)) return;
                const geometry = object.geometry;
                const materials = Array.isArray(object.material) ? object.material : [object.material];
                const ranges = Array.isArray(object.material) && geometry.groups.length ? geometry.groups : [{
                    start: 0, count: geometry.index?.count || geometry.getAttribute('position').count, materialIndex: 0
                }];
                for (const range of ranges) {
                    const material = materials[range.materialIndex || 0];
                    if (!(material instanceof THREE.MeshToonMaterial ||
                        material instanceof THREE.MeshBasicMaterial)) continue;
                    const key = JSON.stringify([material.type, material.side, material.opacity, material.transparent,
                        material.depthTest, material.depthWrite, material.polygonOffset, material.polygonOffsetFactor,
                        material.polygonOffsetUnits,
                        object.castShadow, object.receiveShadow, object.renderOrder]);
                    let batch = batches.get(key);
                    if (!batch) {
                        const mergedMaterial = material.clone();
                        mergedMaterial.color.set(0xffffff);
                        mergedMaterial.vertexColors = true;
                        mergedMaterial.onBeforeCompile = shader => {
                            shader.uniforms.mapExtent = { value: new THREE.Vector3(world.width, world.depth,
                                Math.max(500, Math.max(world.width, world.depth) * 1.5) * 0.9) };
                            shader.uniforms.mapFogColor = { value: new THREE.Color(MAP_FOG_COLOR) };
                            shader.vertexShader = 'uniform vec3 mapExtent; varying float vMapFog;\n' +
                                shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
                                    vMapFog = max(0.0, max(max(-position.x, position.x - mapExtent.x),
                                        max(-position.z, position.z - mapExtent.y))) / mapExtent.z;`);
                            shader.fragmentShader = 'uniform vec3 mapFogColor; varying float vMapFog;\n' +
                                shader.fragmentShader.replace('#include <fog_fragment>', `#include <fog_fragment>
                                    gl_FragColor.rgb = mix(gl_FragColor.rgb, mapFogColor,
                                        smoothstep(0.0, 1.0, vMapFog));`);
                        };
                        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mergedMaterial);
                        mesh.castShadow = object.castShadow;
                        mesh.receiveShadow = object.receiveShadow;
                        mesh.renderOrder = object.renderOrder;
                        batch = { parts: [], count: 0, mesh };
                        batches.set(key, batch);
                    }
                    batch.parts.push({ geometry, matrix: object.matrixWorld,
                        start: range.start, count: range.count, material });
                    batch.count += range.count;
                }
            });
        }
        const group = new THREE.Group(), position = new THREE.Vector3(), normal = new THREE.Vector3();
        const normalMatrix = new THREE.Matrix3(), color = new THREE.Color();
        for (const batch of batches.values()) {
            const positions = new Float32Array(batch.count * 3), normals = new Float32Array(batch.count * 3);
            const shades = new Float32Array(batch.count * 3);
            let offset = 0;
            for (const part of batch.parts) {
                const p = part.geometry.getAttribute('position'), n = part.geometry.getAttribute('normal');
                const c = part.material.vertexColors ? part.geometry.getAttribute('color') : undefined;
                normalMatrix.getNormalMatrix(part.matrix);
                for (let j = part.start; j < part.start + part.count; j++) {
                    const i = part.geometry.index ? part.geometry.index.getX(j) : j;
                    position.fromBufferAttribute(p, i).applyMatrix4(part.matrix).toArray(positions, offset);
                    normal.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize().toArray(normals, offset);
                    if (c) color.setRGB(c.getX(i), c.getY(i), c.getZ(i)).multiply(part.material.color);
                    else color.copy(part.material.color);
                    color.toArray(shades, offset);
                    offset += 3;
                }
            }
            batch.mesh.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            batch.mesh.geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
            batch.mesh.geometry.setAttribute('color', new THREE.BufferAttribute(shades, 3));
            batch.mesh.geometry.computeBoundingSphere();
            group.add(batch.mesh);
        }
        return group;
    }
    private terrain(world: World, startX: number, startZ: number, regions: Array<TerrainCover>) {
        const t = world.terrain, positions: Array<number> = [];
        const overlayPositions: Array<number> = [], shades: Array<number> = [];
        const dx = world.width / (t.columns - 1), dz = world.depth / (t.rows - 1);
        const relevant = regions.map(e => ({ ...e, shade: new THREE.Color(e.color) })).reverse();
        for (let z = startZ; z < Math.min(startZ + 16, t.rows - 1); z++)
            for (let x = startX; x < Math.min(startX + 16, t.columns - 1); x++)
                for (const corners of [[[0, 0], [0, 1], [1, 0]], [[1, 0], [0, 1], [1, 1]]]) {
                    const triangle = corners.map(([ox, oz]) => ({
                        x: (x + ox) * dx, z: (z + oz) * dz, y: t.heights[(z + oz) * t.columns + x + ox]
                    }));
                    triangle.forEach(p => positions.push(p.x, p.y, p.z));
                    const [a, b, c] = triangle;
                    const determinant = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
                    let remaining: ClipMultiPolygon = [ring(triangle)];
                    for (const cover of relevant) {
                        if (cover.bounds.maxX < x * dx || cover.bounds.minX > (x + 1) * dx ||
                            cover.bounds.maxZ < z * dz || cover.bounds.minZ > (z + 1) * dz) continue;
                        const clipped = clip('intersection', remaining, cover.polygon);
                        if (!clipped.length) continue;
                        for (const shape of shapes(clipped)) {
                            const fragment = new THREE.ShapeGeometry(shape);
                            const attr = fragment.getAttribute('position'), indices = fragment.index;
                            for (let i = 0; i < (indices ? indices.count : attr.count); i++) {
                                const index = indices ? indices.getX(i) : i;
                                const px = attr.getX(index), pz = -attr.getY(index);
                                const u = ((px - a.x) * (c.z - a.z) - (c.x - a.x) * (pz - a.z)) / determinant;
                                const v = ((b.x - a.x) * (pz - a.z) - (px - a.x) * (b.z - a.z)) / determinant;
                                overlayPositions.push(px, a.y + u * (b.y - a.y) + v * (c.y - a.y), pz);
                                shades.push(cover.shade.r, cover.shade.g, cover.shade.b);
                            }
                            fragment.dispose();
                        }
                        remaining = clip('difference', remaining, cover.polygon);
                        if (!remaining.length) break;
                    }
                }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, new THREE.MeshToonMaterial({ color: colors.grass }));
        mesh.receiveShadow = true;
        const group = new THREE.Group();
        group.add(mesh);
        if (overlayPositions.length) {
            const overlayGeometry = new THREE.BufferGeometry();
            overlayGeometry.setAttribute('position', new THREE.Float32BufferAttribute(overlayPositions, 3));
            overlayGeometry.setAttribute('color', new THREE.Float32BufferAttribute(shades, 3));
            overlayGeometry.computeVertexNormals();
            const overlay = new THREE.Mesh(overlayGeometry, new THREE.MeshToonMaterial({
                vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
            }));
            overlay.receiveShadow = true;
            overlay.renderOrder = 1;
            group.add(overlay);
        }
        return group;
    }
    private surroundings(world: World, deviation: number) {
        const t = world.terrain, dx = world.width / (t.columns - 1), dz = world.depth / (t.rows - 1);
        const extent = Math.max(500, Math.max(world.width, world.depth) * 1.5);
        const wavelength = Math.max(dx, dz, Math.min(world.width, world.depth) / 6);
        const height = (x: number, z: number) => {
            const edge = { x: Math.max(0, Math.min(world.width, x)), z: Math.max(0, Math.min(world.depth, z)) };
            const base = elevation(world, edge), ox = x - edge.x, oz = z - edge.z;
            const distance = Math.hypot(ox, oz), blend = 1 - Math.exp(-distance / wavelength);
            let slope = 0;
            if (ox) slope += (base - elevation(world, { x: edge.x - Math.sign(ox) * dx, z: edge.z })) *
                Math.abs(ox) / dx;
            if (oz) slope += (base - elevation(world, { x: edge.x, z: edge.z - Math.sign(oz) * dz })) *
                Math.abs(oz) / dz;
            const noise = (valueNoise(x / wavelength, world.origin.lat, z / wavelength) * 0.75 +
                valueNoise(x / wavelength * 2.1, world.origin.lon, z / wavelength * 2.1) * 0.25 - 0.5) * 4;
            const drift = Math.max(1, deviation * 2);
            return base + drift * Math.tanh(slope / (1 + distance / wavelength) / drift) +
                noise * deviation * blend * blend;
        };
        const boundary: Array<Point> = [];
        for (let x = 0; x < t.columns - 1; x++) boundary.push({ x: x * dx, z: 0 });
        for (let z = 0; z < t.rows - 1; z++) boundary.push({ x: world.width, z: z * dz });
        for (let x = t.columns - 1; x > 0; x--) boundary.push({ x: x * dx, z: world.depth });
        for (let z = t.rows - 1; z > 0; z--) boundary.push({ x: 0, z: z * dz });
        let inner = boundary.map(p => ({ ...p, y: elevation(world, p) }));
        const positions: Array<number> = [], step = Math.min(dx, dz);
        for (let layer = 1; layer <= 16; layer++) {
            const distance = step * ((1 + extent / step) ** (layer / 16) - 1);
            const outer = boundary.map(p => {
                const x = p.x + (p.x / world.width * 2 - 1) * distance;
                const z = p.z + (p.z / world.depth * 2 - 1) * distance;
                return { x, y: height(x, z), z };
            });
            for (let i = 0; i < inner.length; i++) {
                const next = (i + 1) % inner.length;
                for (const p of [inner[i], inner[next], outer[i], inner[next], outer[next], outer[i]])
                    positions.push(p.x, p.y, p.z);
            }
            inner = outer;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, new THREE.MeshToonMaterial({ color: colors.grass }));
        mesh.receiveShadow = true;
        const group = new THREE.Group();
        group.add(mesh);
        return group;
    }
    private box(group: T.Group, x: number, y: number, z: number, w: number, h: number, d: number, color: string) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
            new THREE.MeshToonMaterial({ color }));
        mesh.position.set(x, y + h / 2, z);
        mesh.castShadow = mesh.receiveShadow = true;
        group.add(mesh);
        return mesh;
    }
    private building(e: Entity, passages: Array<Entity>, ground: number, foundation: number) {
        const group = new THREE.Group();
        group.position.y = ground;
        const passageLevels = passages.flatMap(p => [p.floor, p.floor + p.clearance]);
        const levels = [...new Set([foundation, e.height, ...passageLevels])]
            .filter(y => y >= foundation && y <= e.height).sort((a, b) => a - b);
        for (let i = 1; i < levels.length; i++) {
            const bottom = levels[i - 1], top = levels[i], mid = (bottom + top) / 2;
            const openings = passages.filter(p => p.floor < mid && p.floor + p.clearance > mid);
            const solid = openings.length
                ? clip('difference', ring(e.polygon), ...openings.map(p => ring(p.polygon)))
                : [ring(e.polygon)];
            for (const shape of shapes(solid)) {
                const geometry = new THREE.ExtrudeGeometry(shape, { depth: top - bottom, bevelEnabled: false });
                geometry.rotateX(-Math.PI / 2);
                geometry.translate(0, bottom, 0);
                const mesh = new THREE.Mesh(geometry, [
                    new THREE.MeshToonMaterial({ color: colors.building }),
                    new THREE.MeshToonMaterial({ color: '#c5c5bf' })
                ]);
                mesh.castShadow = mesh.receiveShadow = true;
                group.add(mesh);
            }
        }
        const b = bounds(e.polygon), c = center(e);
        if (e.roof === 'pitched') {
            const mid = (b.minX + b.maxX) / 2, roofHeight = Math.min(5, (b.maxX - b.minX) / 4);
            const roofY = (x: number) => e.height + roofHeight *
                (1 - Math.abs(x - mid) / Math.max(0.01, mid - b.minX));
            const walls: Array<number> = [];
            for (let i = 0; i < e.polygon.length; i++) {
                const a = e.polygon[i], next = e.polygon[(i + 1) % e.polygon.length];
                const edge = [a];
                if ((a.x - mid) * (next.x - mid) < 0) edge.push({
                    x: mid, z: a.z + (next.z - a.z) * (mid - a.x) / (next.x - a.x)
                });
                edge.push(next);
                for (let j = 1; j < edge.length; j++) {
                    const p = edge[j - 1], q = edge[j];
                    walls.push(p.x, e.height, p.z, q.x, e.height, q.z, q.x, roofY(q.x), q.z,
                        p.x, e.height, p.z, q.x, roofY(q.x), q.z, p.x, roofY(p.x), p.z);
                }
            }
            const wallGeometry = new THREE.BufferGeometry();
            wallGeometry.setAttribute('position', new THREE.Float32BufferAttribute(walls, 3));
            wallGeometry.computeVertexNormals();
            const gables = new THREE.Mesh(wallGeometry,
                new THREE.MeshToonMaterial({ color: '#c5c5bf', side: THREE.DoubleSide }));
            gables.castShadow = gables.receiveShadow = true;
            group.add(gables);
            for (const [left, right] of [[b.minX, mid], [mid, b.maxX]]) {
                const half: ClipPolygon = [[[left, b.minZ], [right, b.minZ], [right, b.maxZ], [left, b.maxZ]]];
                for (const shape of shapes(clip('intersection', ring(e.polygon), half))) {
                    const g = new THREE.ShapeGeometry(shape);
                    const p = g.getAttribute('position');
                    for (let i = 0; i < p.count; i++) {
                        const x = p.getX(i), z = -p.getY(i);
                        p.setXYZ(i, x, roofY(x), z);
                    }
                    g.computeVertexNormals();
                    const roof = new THREE.Mesh(g,
                        new THREE.MeshToonMaterial({ color: colors.building, side: THREE.DoubleSide }));
                    roof.castShadow = roof.receiveShadow = true;
                    group.add(roof);
                }
            }
        } else if (this.details && e.detail) {
            for (let i = 0; i < e.polygon.length; i++) {
                const a = e.polygon[i], next = e.polygon[(i + 1) % e.polygon.length];
                const wall = this.box(group, (a.x + next.x) / 2, e.height, (a.z + next.z) / 2,
                    Math.hypot(next.x - a.x, next.z - a.z), 0.7, 0.25, '#c1c2bb');
                wall.rotation.y = -Math.atan2(next.z - a.z, next.x - a.x);
            }
            let angle = 0, longest = 0;
            for (let i = 0; i < e.polygon.length; i++) {
                const a = e.polygon[i], next = e.polygon[(i + 1) % e.polygon.length];
                const length = Math.hypot(next.x - a.x, next.z - a.z);
                if (length > longest) {
                    longest = length;
                    angle = Math.atan2(next.z - a.z, next.x - a.x);
                }
            }
            const cos = Math.cos(angle), sin = Math.sin(angle);
            const local = bounds(e.polygon.map(p => ({
                x: (p.x - c.x) * cos + (p.z - c.z) * sin, z: -(p.x - c.x) * sin + (p.z - c.z) * cos
            })));
            const random = seededRandom(e.seed), width = local.maxX - local.minX, depth = local.maxZ - local.minZ;
            const unit = Math.min(10, Math.max(0.8, Math.sqrt(width * depth) / 35)) * (1 + random() * 2);
            const w = unit * (1.5 + random() * 0.4), d = unit * (1 + random() * 0.3), margin = unit + 2;
            const spacing = Math.min(w, d) * (0.2 + random() * 0.8);
            const maxColumns = Math.min(24, Math.max(1, Math.floor((width - 2 * margin + spacing) / (w + spacing))));
            const maxRows = Math.min(24, Math.max(1, Math.floor((depth - 2 * margin + spacing) / (d + spacing))));
            const density = e.detail === 2 ? 0.5 : 0.2;
            const columns = Math.max(1, Math.ceil(maxColumns * (density + random() * (1 - density))));
            const rows = Math.max(1, Math.ceil(maxRows * (density + random() * (1 - density))));
            const pattern = Math.floor(random() * 4);
            const point = (x: number, z: number) => ({ x: c.x + x * cos - z * sin, z: c.z + x * sin + z * cos });
            for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
                const x = (local.minX + local.maxX) / 2 + (col - (columns - 1) / 2) * (w + spacing);
                const z = (local.minZ + local.maxZ) / 2 + (row - (rows - 1) / 2) * (d + spacing);
                const footprint = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
                    .map(([ox, oz]) => point(x + ox * w / 2, z + oz * d / 2));
                if (!footprint.every(p => contains(e.polygon, p)) ||
                    clip('difference', ring(footprint), ring(e.polygon)).length) continue;
                const p = point(x, z), variant = (row + pattern) % 4;
                const h = unit * [0.65, 1.5, 0.15, 0.25][variant];
                const base = this.box(group, p.x, e.height + 0.05, p.z, w, h, d,
                    variant === 2 ? '#bfc9cb' : '#bfc1ba');
                base.rotation.y = -angle;
                if (variant === 0 || variant === 1) {
                    const cap = this.box(group, p.x, e.height + h + 0.05, p.z,
                        w * 0.75, unit * 0.1, d * 0.75, '#b0b4ae');
                    cap.rotation.y = -angle;
                }
            }
        }
        return group;
    }
    private marker(e: Entity, ground: number) {
        const group = new THREE.Group();
        group.position.set(e.x, ground, e.z);
        group.rotation.y = e.rotation;
        group.scale.setScalar(e.scale * (e.kind === 'prop' && (e.type === 'tree' || e.type === 'cluster') ? 0.5 : 1));
        if (e.kind === 'prop')
            if (e.type === 'tree' || e.type === 'cluster')
                for (let i = 0; i < (e.type === 'cluster' ? 5 : 1); i++) {
                    const x = i ? Math.cos(i * 2.4) * 7 : 0, z = i ? Math.sin(i * 2.4) * 7 : 0;
                    this.box(group, x, 0, z, 1, 7, 1, '#827567');
                    const tree = new THREE.Mesh(new THREE.IcosahedronGeometry(5, 1),
                        new THREE.MeshToonMaterial({ color: '#718b60' }));
                    tree.position.set(x, 10, z);
                    tree.castShadow = true;
                    group.add(tree);
                }
            else if (e.type === 'tank') {
                const tank = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 10, 20),
                    new THREE.MeshToonMaterial({ color: '#b4b9b5' }));
                tank.position.y = 5;
                tank.castShadow = true;
                group.add(tank);
            } else if (e.type === 'rock') {
                const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(5),
                    new THREE.MeshToonMaterial({ color: '#96998d' }));
                rock.position.y = 2;
                rock.scale.set(1.4, 0.8, 1);
                group.add(rock);
            } else if (e.type === 'tower') {
                for (const x of [-3, 3]) for (const z of [-3, 3]) this.box(group, x, 0, z, 0.8, 30, 0.8, '#858b86');
                this.box(group, 0, 27, 0, 14, 1, 2, '#858b86');
            } else this.box(group, 0, 0, 0, e.type === 'container' ? 12 : 25, e.type === 'container' ? 4 : 3,
                e.type === 'container' ? 5 : 1, '#8a9188');
        else if (this.overlays) {
            const color = e.kind === 'objective' ? '#aa7550' : '#a45565';
            const geometry = e.kind === 'spawn' ? new THREE.RingGeometry(Math.max(0.1, e.radius - 0.4), e.radius, 48)
                : new THREE.CircleGeometry(5, 4);
            geometry.rotateX(-Math.PI / 2);
            const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
            mesh.position.y = 0.4;
            group.add(mesh);
            this.box(group, 0, 0, 0, 1, 8, 1, color);
        }
        return group;
    }
}
