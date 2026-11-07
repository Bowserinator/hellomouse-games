import type * as Three from 'three';

export const fullscreenVertexShader = `varying vec2 vUv;
    void main() {
        vUv=uv;
        gl_Position=vec4(position.xy,0.,1.);
    }`;

export class FullscreenPass {
    private scene = new THREE.Scene();
    private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    private triangle: Three.Mesh<Three.BufferGeometry, Three.ShaderMaterial>;

    constructor(material: Three.ShaderMaterial) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
        this.triangle = new THREE.Mesh(geometry, material);
        this.triangle.frustumCulled = false;
        this.scene.add(this.triangle);
    }

    render(
        renderer: Three.WebGLRenderer, material: Three.ShaderMaterial, target: Three.WebGLRenderTarget | null
    ): void {
        this.triangle.material = material;
        renderer.setRenderTarget(target);
        renderer.render(this.scene, this.camera);
    }

    dispose(): void {
        this.triangle.geometry.dispose();
        this.scene.remove(this.triangle);
    }
}

export class RenderTargetPool {
    private available: Array<Three.WebGLRenderTarget> = [];
    private acquired = new Set<Three.WebGLRenderTarget>();

    constructor(private options: Three.WebGLRenderTargetOptions = {}) {}

    acquire(width: number, height: number): Three.WebGLRenderTarget {
        const index = this.available.findIndex(target => target.width === width && target.height === height);
        const target = index < 0 ? new THREE.WebGLRenderTarget(width, height, this.options)
            : this.available.splice(index, 1)[0];
        this.acquired.add(target);
        return target;
    }

    release(target: Three.WebGLRenderTarget): void {
        if (!this.acquired.delete(target)) throw new Error('Render target does not belong to this pool');
        this.available.push(target);
    }

    dispose(): void {
        for (const target of this.available) target.dispose();
        for (const target of this.acquired) target.dispose();
        this.available.length = 0;
        this.acquired.clear();
    }
}
