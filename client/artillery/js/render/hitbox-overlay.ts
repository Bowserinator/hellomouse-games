import type * as T from 'three';
import { hitboxOpacity, teamPrimaryColours } from '../config.js';
import { CollisionModel, ModelPose } from '../sim/model-collision.js';
import { ProjectileTarget } from '../sim/projectile-step.js';

export class HitboxOverlay {
    readonly group = new THREE.Group();
    private readonly geometries = new Map<CollisionModel, T.BufferGeometry>();
    private readonly materials = new Map<number, T.LineBasicMaterial>();
    private readonly boxes: Array<T.LineSegments> = [];

    constructor() {
        this.group.visible = false;
    }

    setEnabled(enabled: boolean): void {
        this.group.visible = enabled;
    }

    update(targets: ReadonlyArray<ProjectileTarget>): void {
        if (!this.group.visible) return;
        let index = 0;
        for (const target of targets) {
            if (target.tank.isWreck) continue;
            const colour = teamPrimaryColours[target.tank.teamIndex];
            const parts: Array<{ model: CollisionModel; pose: ModelPose }> = [{ model: target.hullModel,
                pose: { position: target.tank.position, yawInRadians: target.tank.hullYawInRadians,
                    pitchInRadians: 0 } }, ...target.additionalModels ?? []];
            for (const { model, pose } of parts) this.place(index++, model, pose, colour);
        }
        for (let hidden = index; hidden < this.boxes.length; hidden++) this.boxes[hidden].visible = false;
    }

    dispose(): void {
        this.group.parent?.remove(this.group);
        for (const geometry of this.geometries.values()) geometry.dispose();
        for (const material of this.materials.values()) material.dispose();
        this.boxes.length = 0;
    }

    private place(index: number, model: CollisionModel, pose: ModelPose, colour: number): void {
        let box = this.boxes[index];
        if (!box) {
            box = new THREE.LineSegments(new THREE.BufferGeometry(), this.material(colour));
            box.rotation.order = 'YXZ'; box.renderOrder = 1000;
            this.boxes[index] = box; this.group.add(box);
        }
        box.geometry = this.geometry(model); box.material = this.material(colour);
        box.position.set(pose.position.x, pose.position.y, pose.position.z);
        box.rotation.set(-pose.pitchInRadians, pose.yawInRadians, 0);
        box.visible = true;
    }

    private geometry(model: CollisionModel): T.BufferGeometry {
        let geometry = this.geometries.get(model);
        if (!geometry) {
            const box = new THREE.BoxGeometry(model.size.x, model.size.y, model.size.z);
            box.translate(model.size.x / 2 - model.pivot.x, model.size.y / 2 - model.pivot.y,
                model.size.z / 2 - model.pivot.z);
            geometry = new THREE.EdgesGeometry(box); box.dispose();
            this.geometries.set(model, geometry);
        }
        return geometry;
    }

    private material(colour: number): T.LineBasicMaterial {
        let material = this.materials.get(colour);
        if (!material) {
            material = new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: hitboxOpacity,
                depthTest: false, toneMapped: false });
            this.materials.set(colour, material);
        }
        return material;
    }
}
