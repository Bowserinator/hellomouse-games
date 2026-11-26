import type * as T from 'three';

export interface ConstructionCircle {
    x: number; z: number; radius: number;
}
export function inConstructionRange(x: number, z: number, circles: ReadonlyArray<ConstructionCircle>): boolean {
    return circles.some(circle => {
        const dx = Math.floor(x) - Math.floor(circle.x), dz = Math.floor(z) - Math.floor(circle.z);
        return dx * dx + dz * dz <= circle.radius * circle.radius;
    });
}

export class ConstructionOverlay {
    private patched = new WeakSet<T.Material>();
    private count = { value: 0 };
    private circles = { value: Array.from({ length: 64 }, () => new THREE.Vector3()) };
    setCircles(circles: ReadonlyArray<ConstructionCircle> | undefined) {
        if (!circles) {
            this.count.value = -1;
            return;
        }
        // shortcut: Show the 64 largest radii; use a texture if larger crane networks need exact shading.
        const visible = [...circles].sort((a, b) => b.radius - a.radius).slice(0, 64);
        this.count.value = visible.length;
        visible.forEach((circle, i) => this.circles.value[i].set(circle.x, circle.z, circle.radius));
    }
    apply(group: T.Object3D) {
        group.traverse(object => {
            if (!(object instanceof THREE.Mesh)) return;
            for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
                if (this.patched.has(material)) continue;
                this.patched.add(material);
                const previous = material.onBeforeCompile;
                material.onBeforeCompile = (shader: T.Shader, renderer: T.WebGLRenderer) => {
                    previous.call(material, shader, renderer);
                    shader.uniforms.constructionCount = this.count;
                    shader.uniforms.constructionCircles = this.circles;
                    shader.vertexShader = `varying vec2 constructionPosition;\n${shader.vertexShader}`
                        .replace('#include <project_vertex>', `constructionPosition = (modelMatrix * vec4(transformed, 1.0)).xz;
#include <project_vertex>`);
                    shader.fragmentShader = `varying vec2 constructionPosition;
uniform int constructionCount;
uniform vec3 constructionCircles[64];\n${shader.fragmentShader}`.replace('#include <dithering_fragment>', `
float constructionInside = constructionCount < 0 ? 1.0 : 0.0;
for (int i = 0; i < 64; i++) {
    if (i >= constructionCount) break;
    vec3 circle = constructionCircles[i];
    if (distance(constructionPosition, circle.xy) <= circle.z) {
        constructionInside = 1.0;
        break;
    }
}
gl_FragColor.rgb *= mix(0.97, 1.0, constructionInside);
#include <dithering_fragment>`);
                };
                material.customProgramCacheKey = () => 'construction-overlay-v1';
                material.needsUpdate = true;
            }
        });
    }
}
