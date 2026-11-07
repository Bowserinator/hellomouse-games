import type * as T from 'three';
import { headingArrowHeadLengthInVoxels, headingArrowHeadRadiusInVoxels, headingArrowHeightInVoxels,
    headingArrowOffsetInVoxels, headingArrowShaftLengthInVoxels, headingArrowShaftRadiusInVoxels,
    tankHullLengthInVoxels } from '../config.js';
import { Vector3 } from '../sim/math/vector3.js';

export class HeadingArrow {
    readonly group = new THREE.Group();
    private readonly material: T.MeshBasicMaterial;
    private readonly geometries: Array<T.BufferGeometry> = [];

    constructor(colour: number) {
        this.material = new THREE.MeshBasicMaterial({ color: colour, toneMapped: false });
        const shaft = new THREE.CylinderGeometry(headingArrowShaftRadiusInVoxels, headingArrowShaftRadiusInVoxels,
            headingArrowShaftLengthInVoxels, 8);
        const head = new THREE.ConeGeometry(headingArrowHeadRadiusInVoxels, headingArrowHeadLengthInVoxels, 8);
        shaft.rotateX(Math.PI / 2); shaft.translate(0, 0, headingArrowShaftLengthInVoxels / 2);
        head.rotateX(Math.PI / 2);
        head.translate(0, 0, headingArrowShaftLengthInVoxels + headingArrowHeadLengthInVoxels / 2);
        this.geometries.push(shaft, head);
        const pivot = new THREE.Group();
        pivot.position.set(0, headingArrowHeightInVoxels, tankHullLengthInVoxels / 2 + headingArrowOffsetInVoxels);
        pivot.add(new THREE.Mesh(shaft, this.material), new THREE.Mesh(head, this.material));
        this.group.add(pivot);
        this.group.visible = false;
    }

    update(visible: boolean, position: Vector3, hullYawInRadians: number): void {
        this.group.visible = visible;
        if (!visible) return;
        this.group.position.set(position.x, position.y, position.z);
        this.group.rotation.y = hullYawInRadians;
    }

    dispose(): void {
        this.group.parent?.remove(this.group);
        for (const geometry of this.geometries) geometry.dispose();
        this.material.dispose();
    }
}
