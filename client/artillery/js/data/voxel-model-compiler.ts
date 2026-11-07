import { modelMaximumDimensionInVoxels, modelMaximumPrimitiveCount } from '../config.js';
import { CollisionModel, ModelVoxel, VoxelModelSpec } from '../sim/model-collision.js';

type Point = readonly [number, number, number];
export type ModelPrimitive =
    { kind: 'box'; position: Point; size: Point; colour: string } |
    { kind: 'sphere'; center: Point; radius: number; colour: string } |
    { kind: 'cylinder' | 'cone'; from: Point; to: Point; radius: number; colour: string } |
    { kind: 'line'; from: Point; to: Point; thickness: number; colour: string } |
    { kind: 'mirror'; axis: 'x' | 'y' | 'z'; plane: number } |
    { kind: 'voxels'; voxels: ReadonlyArray<ModelVoxel> };

export interface VoxelModelSource {
    size: Point;
    pivot: Point;
    palette?: Readonly<Record<string, string>>;
    primitives: ReadonlyArray<ModelPrimitive>;
}

function object(input: unknown, required: ReadonlyArray<string>, optional: ReadonlyArray<string> = []):
Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid model object');
    const value = input as Record<string, unknown>;
    if (required.some(key => !Object.prototype.hasOwnProperty.call(value, key)) ||
        Object.keys(value).some(key => !required.includes(key) && !optional.includes(key)))
        throw new Error('Unknown or missing model field');
    return value;
}

function point(input: unknown): Point {
    if (!Array.isArray(input) || input.length !== 3 || input.some(value =>
        typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > modelMaximumDimensionInVoxels * 2))
        throw new Error('Invalid model coordinate');
    return [input[0], input[1], input[2]];
}

export function compileVoxelModel(input: unknown): VoxelModelSpec {
    const source = object(input, ['size', 'pivot'], ['voxels', 'primitives', 'palette']);
    const size = point(source.size), pivot = point(source.pivot);
    if (size.some(value => !Number.isInteger(value) || value < 1 || value > modelMaximumDimensionInVoxels))
        throw new Error('Invalid model dimensions');
    if (source.voxels !== undefined) {
        if (source.primitives !== undefined || source.palette !== undefined || !Array.isArray(source.voxels) ||
            source.voxels.length > size[0] * size[1] * size[2]) throw new Error('Invalid compiled voxel model');
        const compiled: VoxelModelSpec = { size, pivot, voxels: Array.from(source.voxels) };
        new CollisionModel(compiled);
        return input as VoxelModelSpec;
    }
    if (!Array.isArray(source.primitives) || source.primitives.length > modelMaximumPrimitiveCount)
        throw new Error('Invalid model primitive count');
    const palette: Record<string, string> = {};
    if (source.palette !== undefined) {
        if (!source.palette || typeof source.palette !== 'object' || Array.isArray(source.palette))
            throw new Error('Invalid model palette');
        for (const [key, value] of Object.entries(source.palette)) {
            if (typeof value !== 'string' || !value.length) throw new Error('Invalid model palette entry');
            Object.defineProperty(palette, key, { value, enumerable: true });
        }
    }
    const paints: Array<string | undefined> = new Array(size[0] * size[1] * size[2]);
    const paint = (value: unknown): string => {
        if (typeof value !== 'string' || !value.length) throw new Error('Invalid model paint');
        return Object.prototype.hasOwnProperty.call(palette, value) ? palette[value] : value;
    };
    const set = (x: number, y: number, z: number, colour: string): void => {
        if (x >= 0 && y >= 0 && z >= 0 && x < size[0] && y < size[1] && z < size[2])
            paints[x + size[0] * (z + size[2] * y)] = colour;
    };
    const keys: Readonly<Record<string, ReadonlyArray<string>>> = {
        box: ['position', 'size', 'colour'], sphere: ['center', 'radius', 'colour'],
        cylinder: ['from', 'to', 'radius', 'colour'], cone: ['from', 'to', 'radius', 'colour'],
        line: ['from', 'to', 'thickness', 'colour'], mirror: ['axis', 'plane'], voxels: ['voxels']
    };
    for (const entry of source.primitives) {
        if (!entry || typeof entry !== 'object' || typeof entry.kind !== 'string' ||
            !Object.prototype.hasOwnProperty.call(keys, entry.kind)) throw new Error('Unknown model primitive');
        const primitive = object(entry, ['kind', ...keys[entry.kind]]);
        if (primitive.kind === 'voxels') {
            const list = new CollisionModel({ size, pivot, voxels: primitive.voxels as ReadonlyArray<ModelVoxel> });
            for (const [x, y, z, colour] of list.voxels) set(x, y, z, paint(colour));
            continue;
        }
        if (primitive.kind === 'mirror') {
            const axis = typeof primitive.axis === 'string' ? ['x', 'y', 'z'].indexOf(primitive.axis) : -1;
            if (axis < 0 || typeof primitive.plane !== 'number' || !Number.isFinite(primitive.plane) ||
                !Number.isInteger(primitive.plane * 2) || Math.abs(primitive.plane) > modelMaximumDimensionInVoxels)
                throw new Error('Invalid model mirror');
            const snapshot = paints.slice();
            for (let y = 0; y < size[1]; y++) for (let z = 0; z < size[2]; z++) for (let x = 0; x < size[0]; x++) {
                const colour = snapshot[x + size[0] * (z + size[2] * y)];
                if (colour === undefined) continue;
                set(axis === 0 ? primitive.plane * 2 - x : x,
                    axis === 1 ? primitive.plane * 2 - y : y, axis === 2 ? primitive.plane * 2 - z : z, colour);
            }
            continue;
        }
        const colour = paint(primitive.colour);
        const start = primitive.kind === 'box' ? point(primitive.position)
            : primitive.kind === 'sphere' ? point(primitive.center) : point(primitive.from);
        const extent = primitive.kind === 'box' ? point(primitive.size)
            : primitive.kind === 'sphere' ? start : point(primitive.to);
        const radius = primitive.kind === 'line'
            ? typeof primitive.thickness === 'number' ? primitive.thickness / 2 : undefined : primitive.radius;
        if (primitive.kind === 'box') {
            if (start.some(value => !Number.isInteger(value)) ||
                extent.some(value => !Number.isInteger(value) || value < 1))
                throw new Error('Invalid model box');
        } else if (typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0 ||
            radius > modelMaximumDimensionInVoxels || primitive.kind === 'line' && typeof primitive.thickness !== 'number')
            throw new Error('Invalid model radius');
        const axisX = extent[0] - start[0], axisY = extent[1] - start[1], axisZ = extent[2] - start[2];
        const lengthSquared = axisX * axisX + axisY * axisY + axisZ * axisZ;
        if (primitive.kind !== 'box' && primitive.kind !== 'sphere' && lengthSquared === 0)
            throw new Error('Invalid model segment');
        for (let y = 0; y < size[1]; y++) for (let z = 0; z < size[2]; z++) for (let x = 0; x < size[0]; x++) {
            let inside: boolean;
            if (primitive.kind === 'box')
                inside = x >= start[0] && y >= start[1] && z >= start[2] &&
                    x < start[0] + extent[0] && y < start[1] + extent[1] && z < start[2] + extent[2];
            else {
                const offsetX = x + .5 - start[0], offsetY = y + .5 - start[1], offsetZ = z + .5 - start[2];
                let along = primitive.kind === 'sphere' ? 0
                    : (offsetX * axisX + offsetY * axisY + offsetZ * axisZ) / lengthSquared;
                if (primitive.kind === 'line') along = Math.max(0, Math.min(1, along));
                const localRadius = (radius as number) * (primitive.kind === 'cone' ? 1 - along : 1);
                const radialSquared = (offsetX - axisX * along) ** 2 + (offsetY - axisY * along) ** 2 +
                    (offsetZ - axisZ * along) ** 2;
                inside = along >= 0 && along <= 1 && radialSquared <= localRadius * localRadius;
            }
            if (inside) set(x, y, z, colour);
        }
    }
    const voxels: Array<ModelVoxel> = [];
    for (let y = 0; y < size[1]; y++) for (let z = 0; z < size[2]; z++) for (let x = 0; x < size[0]; x++) {
        const colour = paints[x + size[0] * (z + size[2] * y)];
        if (colour !== undefined) voxels.push([x, y, z, colour]);
    }
    return { size, pivot, voxels };
}
