import type * as T from 'three';

const patched = new WeakSet<T.Material>();
export function instanceOpacity(mesh: T.InstancedMesh, previous?: T.InstancedMesh) {
    const before = previous?.geometry.getAttribute('constructionAlpha');
    mesh.geometry = mesh.geometry.clone();
    const values = new Float32Array(mesh.instanceMatrix.count).fill(1);
    if (before) values.set(before.array);
    const alpha = new THREE.InstancedBufferAttribute(values, 1).setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute('constructionAlpha', alpha);
    const material = mesh.material as T.Material;
    if (patched.has(material)) return;
    patched.add(material);
    const compile = material.onBeforeCompile;
    material.onBeforeCompile = (shader: T.Shader, renderer: T.WebGLRenderer) => {
        compile.call(material, shader, renderer);
        shader.vertexShader = 'attribute float constructionAlpha; varying float buildAlpha;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
            '#include <begin_vertex>\nbuildAlpha = constructionAlpha;');
        shader.fragmentShader = 'varying float buildAlpha;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
            '#include <color_fragment>\ndiffuseColor.a *= buildAlpha;');
    };
    material.needsUpdate = true;
}
