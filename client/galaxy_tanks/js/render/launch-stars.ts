import type * as T from 'three';
import { World } from '../sim/world/planet.js';
import { fromTuple, vec } from '../sim/math/vec3.js';
import { STAR_HEIGHT, STAR_INSIDE_SPIN, STAR_NEAR_SPIN, STAR_SPIN_RATE, STAR_TRAIL_END_HEIGHT } from '../vars.js';
import { disposeTree, mergeGeometry } from './geometry.js';
export class LaunchStars {
    root = new THREE.Group();
    private stars: Array<{ mesh: T.Mesh<T.BufferGeometry, T.ShaderMaterial>; anchor: T.Vector3;
        up: T.Vector3; orientation: T.Quaternion; angle: number;
        line: T.Line<T.BufferGeometry, T.LineDashedMaterial>; }> = [];
    private dashOffset = { value: 0 };
    private previousTime = 0;
    private sparkles: T.Points;
    private sparklePositions: Float32Array;
    constructor(world: World, sky: T.CubeTexture) {
        this.sparklePositions = new Float32Array(world.stars.length * 16 * 3);
        const sparkleGeometry = new THREE.BufferGeometry();
        sparkleGeometry.setAttribute('position', new THREE.BufferAttribute(this.sparklePositions, 3));
        const sparkleColors = new Float32Array(this.sparklePositions.length);
        sparkleGeometry.setAttribute('color', new THREE.BufferAttribute(sparkleColors, 3));
        this.sparkles = new THREE.Points(sparkleGeometry, new THREE.PointsMaterial({ vertexColors: true,
            size: 0.12, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
        this.sparkles.frustumCulled = false;
        this.root.add(this.sparkles);
        if (!world.stars.length) return;
        const starPath = <P extends T.Shape | T.Path>(path: P, scale: number, reverse = false): P => {
            for (let n = 0; n < 10; n++) {
                const i = reverse ? 9 - n : n, a = Math.PI / 2 + i * Math.PI / 5, r = (i % 2 ? 0.5 : 1.35) * scale;
                if (n === 0) path.moveTo(Math.cos(a) * r, Math.sin(a) * r);
                else path.lineTo(Math.cos(a) * r, Math.sin(a) * r);
            }
            path.closePath();
            return path;
        };
        const layer = (outer: number, inner: number, depth: number) => {
            const shape = starPath(new THREE.Shape(), outer);
            shape.holes.push(starPath(new THREE.Path(), inner, true));
            return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 3, steps: 1,
                bevelSize: 0.04, bevelOffset: -0.04, bevelThickness: 0.04 }).translate(0, 0, -depth / 2);
        };
        const tips = [0, 2, 4, 6, 8].map(i => {
            const a = Math.PI / 2 + i * Math.PI / 5;
            return new THREE.SphereGeometry(0.17, 12, 8).translate(Math.cos(a) * 1.22, Math.sin(a) * 1.22, 0);
        });
        const geom = mergeGeometry([layer(1, 0.72, 0.2), layer(0.72, 0.46, 0.13),
            layer(0.46, 0.24, 0.07), ...tips]);
        geom.scale(1.1 * 1.5, 1.1 * 1.5, 1.1 * 1.5);
        const glowCanvas = document.createElement('canvas');
        glowCanvas.width = glowCanvas.height = 128;
        const g2d = glowCanvas.getContext('2d')!, gradient = g2d.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(255,255,255,1)');
        gradient.addColorStop(0.25, 'rgba(190,225,255,0.8)');
        gradient.addColorStop(0.6, 'rgba(70,140,255,0.25)');
        gradient.addColorStop(1, 'rgba(40,100,255,0)');
        g2d.fillStyle = gradient;
        g2d.fillRect(0, 0, 128, 128);
        const glowTexture = new THREE.CanvasTexture(glowCanvas);
        for (const [index, star] of world.stars.entries()) {
            const tint = new THREE.Color([0xffb433, 0x46e873, 0x4d9dff][star.destPlanet % 3]);
            const low = star.destPlanet % 3 === 0 ? new THREE.Color(.95, .38, .03) : tint.clone().multiplyScalar(.65);
            const high = star.destPlanet % 3 === 0 ? new THREE.Color(1, .78, .2)
                : tint.clone().lerp(new THREE.Color(0xffffff), .25);
            for (let n = 0; n < 16; n++) tint.toArray(sparkleColors, (index * 16 + n) * 3);
            const material = new THREE.ShaderMaterial({
                uniforms: { time: { value: 0 }, near: { value: 0 }, sky: { value: sky },
                    low: { value: low }, high: { value: high } },
                vertexShader: `varying vec3 vN,vV,vWN,vWV;void main(){vN=normalize(normalMatrix*normal);
                    vWN=normalize(mat3(modelMatrix)*normal);
                    vWV=cameraPosition-(modelMatrix*vec4(position,1.)).xyz;
                    vec4 p=modelViewMatrix*vec4(position,1.);vV=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,
                fragmentShader: `varying vec3 vN,vV,vWN,vWV;uniform float time,near;uniform samplerCube sky;
                    uniform vec3 low,high;
                    void main(){float f=1.-abs(dot(normalize(vN),normalize(vV)));
                        vec3 c=mix(low,high,.55+.45*sin(f*4.+time*.2));
                        float spec=pow(max(0.,dot(normalize(vN),normalize(vec3(.2,1.,1.)))),28.);
                        vec3 env=textureCube(sky,reflect(-normalize(vWV),normalize(vWN))).rgb;
                        gl_FragColor=vec4(c*(.9+near*.3)+env*.35*c+f*high*.35+spec*.8,1.);}`
            });
            const mesh = new THREE.Mesh(geom, material);
            const p = world.position(star.planet, fromTuple(star.dir), STAR_HEIGHT);
            const anchor = new THREE.Vector3(p.x, p.y, p.z), up = new THREE.Vector3(...star.dir);
            const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: tint, transparent: true,
                depthWrite: false, blending: THREE.AdditiveBlending }));
            glow.scale.setScalar(5 * 1.5);
            mesh.add(glow);
            mesh.position.copy(anchor);
            this.root.add(mesh);
            const path = world.paths.get(star)!, pos = vec(), u = vec(), f = vec();
            const dst = world.desc.planets[star.destPlanet];
            let end = 1;
            for (let i = 0; i <= 512; i++) {
                path.sample(i / 512, pos, u, f);
                const fromDst = Math.hypot(pos.x - dst.center[0], pos.y - dst.center[1], pos.z - dst.center[2]);
                if (fromDst <= dst.radius + STAR_TRAIL_END_HEIGHT && i > 256) {
                    end = i / 512;
                    break;
                }
            }
            const curve = new class extends THREE.Curve<T.Vector3> {
                getPoint(t: number, target = new THREE.Vector3()): T.Vector3 {
                    path.sample(t * end, pos, u, f);
                    return target.set(pos.x, pos.y, pos.z);
                }
            }();
            const fadeEnds = (trailMaterial: T.Material, progress: string): void => {
                trailMaterial.onBeforeCompile = shader => {
                    shader.vertexShader = 'attribute float aTrailProgress;varying float vTrailProgress;\n' +
                        shader.vertexShader.replace('#include <begin_vertex>',
                            `#include <begin_vertex>\nvTrailProgress=${progress};`);
                    shader.fragmentShader = 'varying float vTrailProgress;\n' + shader.fragmentShader.replace(
                        '#include <premultiplied_alpha_fragment>',
                        `gl_FragColor.a*=smoothstep(0.,.08,vTrailProgress)*(1.-smoothstep(.85,1.,vTrailProgress));
                        #include <premultiplied_alpha_fragment>`);
                };
            };
            const points = curve.getSpacedPoints(192);
            const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
                new THREE.LineDashedMaterial({ color: tint, transparent: true, opacity: 0.7,
                    dashSize: 1.4, gapSize: 1.1, depthWrite: false }));
            line.geometry.setAttribute('aTrailProgress', new THREE.Float32BufferAttribute(
                points.map((_, i) => i / (points.length - 1)), 1));
            fadeEnds(line.material, 'aTrailProgress');
            const fade = line.material.onBeforeCompile;
            line.material.onBeforeCompile = (shader, renderer) => {
                fade(shader, renderer);
                shader.uniforms.uDashOffset = this.dashOffset;
                shader.vertexShader = 'uniform float uDashOffset;\n' + shader.vertexShader.replace(
                    'vLineDistance = scale * lineDistance;', 'vLineDistance = scale * (lineDistance + uDashOffset);');
            };
            line.computeLineDistances();
            this.root.add(line);
            for (const [radius, opacity] of [[0.4, 0.1], [0.15, 0.28]] as const) {
                const tubeMaterial = new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity,
                    depthWrite: false, blending: THREE.AdditiveBlending });
                fadeEnds(tubeMaterial, 'uv.x');
                this.root.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 192, radius, 8, false), tubeMaterial));
            }
            const orientation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), up);
            this.stars.push({ mesh, anchor, up, line, orientation, angle: 0 });
        }
    }
    update(now: number, focus?: T.Vector3, occupied = new Set<number>()): void {
        const dt = this.previousTime ? Math.min(.1, Math.max(0, (now - this.previousTime) / 1000)) : 0;
        this.previousTime = now;
        for (const [index, s] of this.stars.entries()) {
            const near = focus ? THREE.MathUtils.clamp((14 - focus.distanceTo(s.anchor)) / 10, 0, 1) : 0;
            s.mesh.material.uniforms.near.value = near;
            s.mesh.material.uniforms.time.value = now / 1000;
            s.mesh.position.copy(s.anchor).addScaledVector(s.up, Math.sin(now / 450) * (0.15 + near * 0.15));
            s.angle += dt * STAR_SPIN_RATE * (occupied.has(index) ? STAR_INSIDE_SPIN : 1 + near * (STAR_NEAR_SPIN - 1));
            s.mesh.quaternion.setFromAxisAngle(s.up, s.angle).multiply(s.orientation);
            s.line.material.opacity = 0.5 + near * 0.45;
        }
        this.dashOffset.value = now / 1000 % 2.5;
        for (let star = 0; star < this.stars.length; star++) for (let n = 0; n < 16; n++) {
            const anchor = this.stars[star].anchor, phase = now / 1100 + n * 2.399;
            const radius = 2 + Math.sin(n * 5.13 + now / 700);
            const i = (star * 16 + n) * 3;
            this.sparklePositions[i] = anchor.x + Math.cos(phase) * radius;
            this.sparklePositions[i + 1] = anchor.y + Math.sin(phase * 1.7) * radius;
            this.sparklePositions[i + 2] = anchor.z + Math.sin(phase) * radius;
        }
        this.sparkles.geometry.getAttribute('position').needsUpdate = true;
    }
    dispose(sky: T.CubeTexture): void {
        disposeTree(this.root, new Set([sky]));
    }
}
