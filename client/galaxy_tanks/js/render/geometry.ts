import type * as T from 'three';

export function mergeGeometry(parts: Array<T.BufferGeometry>): T.BufferGeometry {
    const result = new THREE.BufferGeometry();
    if (!parts.length) return result;
    const expanded = parts.map(p => p.index ? p.toNonIndexed() : p);
    for (const key of Object.keys(expanded[0].attributes)) {
        const size = expanded[0].getAttribute(key).itemSize;
        const data = new Float32Array(expanded.reduce((n, p) => n + p.getAttribute(key).array.length, 0));
        let offset = 0;
        for (const p of expanded) {
            data.set(p.getAttribute(key).array, offset);
            offset += p.getAttribute(key).array.length;
        }
        result.setAttribute(key, new THREE.BufferAttribute(data, size));
    }
    expanded.forEach(p => p.dispose());
    parts.forEach(p => p.dispose());
    result.computeBoundingSphere();
    return result;
}
/** Hints that an instanced mesh changes every frame; call before its first draw */
export function streamInstances(mesh: T.InstancedMesh): void {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
}
/** Uploads only the instances in use, and nothing while the mesh is empty */
export function commitInstances(mesh: T.InstancedMesh): void {
    if (!mesh.count) return;
    mesh.instanceMatrix.updateRange.count = mesh.count * 16;
    mesh.instanceMatrix.needsUpdate = true;
    const color = mesh.instanceColor;
    if (!color) return;
    color.updateRange.count = mesh.count * 3;
    color.needsUpdate = true;
}
export function disposeTree(root: T.Object3D, preserve: Set<T.Texture> = new Set()): void {
    const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>(), textures = new Set<T.Texture>();
    root.traverse(obj => {
        const mesh = obj as T.Mesh;
        if (mesh.geometry) geometries.add(mesh.geometry);
        if (mesh.material) {
            const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            list.forEach(m => materials.add(m));
        }
    });
    materials.forEach(m => {
        if (m instanceof THREE.ShaderMaterial)
            Object.values(m.uniforms).forEach(u => {
                if (u.value instanceof THREE.Texture) textures.add(u.value);
            });
        else {
            const basic = m as T.MeshBasicMaterial;
            if (basic.map) textures.add(basic.map);
        }
        m.dispose();
    });
    geometries.forEach(g => g.dispose());
    textures.forEach(t => {
        if (!preserve.has(t)) t.dispose();
    });
    root.clear();
}
