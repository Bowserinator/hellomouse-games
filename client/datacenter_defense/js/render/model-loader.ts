import type * as T from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import type { ModelSpec } from './model-registry.js';

export interface RigPart {
    name: string;
    parent: number;
    rest: T.Matrix4;
    geometry: T.BufferGeometry;
    kind: 'static' | 'aim' | 'recoil' | 'spin' | 'roll' | 'walk';
    mount: number;
    axis: T.Vector3;
    rate: number;
    travel: number;
    sign: number;
}
export interface Rig {
    parts: Array<RigPart>;
    muzzles: Array<{ mount: number; part: number; position: T.Vector3 }>;
    material: T.MeshToonMaterial;
    dispose(): void;
}
export async function loadModel(spec: ModelSpec): Promise<Rig> {
    // SAFETY: the matching r128 global extensions are loaded before the module entry point.
    const extensions = THREE as typeof THREE & { GLTFLoader: typeof GLTFLoader;
        BufferGeometryUtils: { mergeBufferGeometries(geometries: Array<T.BufferGeometry>): T.BufferGeometry | null }; };
    if (!extensions.GLTFLoader || !extensions.BufferGeometryUtils) throw Error('Model helpers are unavailable');
    const root = await new Promise<T.Group>((ok, bad) => new extensions.GLTFLoader().load(
        new URL(`../../models/${spec.url}`, import.meta.url).href, gltf => ok(gltf.scene), undefined, bad));
    const sourceMaterials = new Set<T.Material>(), sourceGeometries = new Set<T.BufferGeometry>();
    const textures = new Set<T.Texture>();
    const parts: Array<RigPart> = [], nodes: Array<T.Object3D> = [new THREE.Group()];
    const inputs: Array<Array<T.BufferGeometry>> = [[]];
    const muzzles: Rig['muzzles'] = [];
    const material = new THREE.MeshToonMaterial({ vertexColors: true });
    const addPart = (name: string, parent: number, node: T.Object3D): number => {
        const aim = /^turret(?:_([0-3]))?$/.exec(name), recoil = /^barrel_([0-3])$/.exec(name);
        const spin = /^spin_([xyz])_(.+)$/.exec(name);
        const kind = aim ? 'aim' : recoil ? 'recoil' : spin ? 'spin' : name.startsWith('roll_') ? 'roll'
            : /^walk_[lr]$/.test(name) ? 'walk' : 'static';
        const rest = parent < 0 ? new THREE.Matrix4()
            : nodes[parent].matrixWorld.clone().invert().multiply(node.matrixWorld);
        rest.elements[12] *= spec.scale; rest.elements[13] *= spec.scale; rest.elements[14] *= spec.scale;
        parts.push({ name, parent, rest, geometry: new THREE.BufferGeometry(), kind,
            mount: Number(aim?.[1] ?? recoil?.[1] ?? 0), axis: new THREE.Vector3(
                Number(spin?.[1] === 'x'), Number(!spin || spin[1] === 'y'), Number(spin?.[1] === 'z')),
            rate: spec.spin?.[spin?.[2] ?? name] ?? 25, travel: 0.16, sign: name === 'walk_r' ? -1 : 1 });
        return parts.length - 1;
    };
    addPart('body', -1, nodes[0]); root.updateMatrixWorld(true);
    const visit = (node: T.Object3D, parent: number, hidden: boolean) => {
        const locator = /^muzzle_([0-3])$/.exec(node.name);
        const named = /^(turret(?:_[0-3])?|barrel_[0-3]|spin_[xyz]_.+|roll_.+|walk_[lr])$/.test(node.name);
        let part = parent;
        if (named && !hidden) {
            part = addPart(node.name, parent, node); nodes.push(node); inputs.push([]);
        }
        if (locator) {
            const position = new THREE.Vector3().setFromMatrixPosition(
                nodes[part].matrixWorld.clone().invert().multiply(node.matrixWorld)).multiplyScalar(spec.scale);
            muzzles.push({ mount: Number(locator[1]), part, position });
        }
        if (node instanceof THREE.Mesh) {
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            if (!hidden && !locator) {
                const source = materials[0] as T.MeshStandardMaterial;
                const geometry = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
                inputs[part].push(geometry);
                geometry.applyMatrix4(nodes[part].matrixWorld.clone().invert().multiply(node.matrixWorld));
                geometry.scale(spec.scale, spec.scale, spec.scale);
                if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
                const count = geometry.getAttribute('position').count;
                if (!geometry.getAttribute('uv')) geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
                const colors = new Float32Array(count * 3), tint = source.color ?? new THREE.Color(0xffffff);
                const authored = geometry.getAttribute('color');
                for (let i = 0; i < count; i++) colors.set([
                    tint.r * (authored?.getX(i) ?? 1), tint.g * (authored?.getY(i) ?? 1),
                    tint.b * (authored?.getZ(i) ?? 1)
                ], i * 3);
                geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
                for (const attribute of Object.keys(geometry.attributes))
                    if (!['position', 'normal', 'uv', 'color'].includes(attribute)) geometry.deleteAttribute(attribute);
                if (source.map) {
                    if (material.map && material.map !== source.map) throw Error('Models must use one texture');
                    material.map = source.map; textures.add(source.map);
                    source.map.encoding = THREE.LinearEncoding; source.map.magFilter = THREE.NearestFilter;
                    source.map.minFilter = THREE.NearestFilter; source.map.needsUpdate = true;
                }
            }
        }
        node.children.forEach(child => visit(child, part, hidden || !!locator));
    };
    const dispose = () => {
        parts.forEach(part => part.geometry.dispose()); material.dispose();
        textures.forEach(texture => texture.dispose());
    };
    try {
        root.traverse(node => {
            if (!(node instanceof THREE.Mesh)) return;
            sourceGeometries.add(node.geometry);
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            for (const value of materials) {
                sourceMaterials.add(value);
                const map = (value as T.MeshStandardMaterial).map;
                if (map) textures.add(map);
            }
        });
        visit(root, 0, false);
        parts.forEach((part, i) => {
            if (!inputs[i].length) return;
            const merged = extensions.BufferGeometryUtils.mergeBufferGeometries(inputs[i]);
            if (!merged) throw Error('Incompatible model geometry');
            part.geometry.dispose(); part.geometry = merged;
        });
        return { parts, muzzles, material, dispose };
    } catch (error) {
        dispose(); textures.clear(); throw error;
    } finally {
        inputs.flat().forEach(geometry => geometry.dispose());
        sourceGeometries.forEach(geometry => geometry.dispose()); sourceMaterials.forEach(value => value.dispose());
        for (const texture of textures) if (texture !== material.map) {
            texture.dispose(); textures.delete(texture);
        }
    }
}
