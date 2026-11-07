export interface MeshingInput {
    voxels: Uint8Array;
    size: readonly [number, number, number];
    /** Faces (by face index) that are not emitted where they lie on the outer boundary of the grid. */
    omittedFaceMask?: number;
    includeAmbientOcclusion?: boolean;
}
export interface PackedVoxelMesh {
    positions: Uint8Array;
    information: Uint8Array;
    indices: Uint16Array | Uint32Array;
}

/** Mesh a grid with one padding voxel on every side. Face indices are +X, -X, +Y, -Y, +Z, -Z. */
export function meshChunk(input: MeshingInput): PackedVoxelMesh {
    const dimensions = input.size;
    if (!dimensions.every(size => Number.isInteger(size) && size > 0 && size <= 254))
        throw new RangeError('Mesh dimensions must be integers from 1 to 254');
    const paddedWidth = dimensions[0] + 2, paddedDepth = dimensions[2] + 2;
    if (input.voxels.length !== paddedWidth * paddedDepth * (dimensions[1] + 2))
        throw new RangeError('Padded voxel dimensions do not match');
    const strides = [1, paddedWidth * paddedDepth, paddedWidth];
    const positions: Array<number> = [], information: Array<number> = [], indices: Array<number> = [];
    const vertex = [0, 0, 0];
    for (let faceIndex = 0; faceIndex < 6; faceIndex++) {
        const isBoundaryOmitted = ((input.omittedFaceMask ?? 0) & (1 << faceIndex)) !== 0;
        const axis = Math.floor(faceIndex / 2), sign = faceIndex % 2 === 0 ? 1 : -1;
        const tangentAxis = (axis + 1) % 3, otherAxis = (axis + 2) % 3;
        const maskWidth = dimensions[tangentAxis], maskHeight = dimensions[otherAxis];
        const mask = new Uint32Array(maskWidth * maskHeight);
        const boundarySlice = sign > 0 ? dimensions[axis] - 1 : 0;
        for (let slice = 0; slice < dimensions[axis]; slice++) {
            if (isBoundaryOmitted && slice === boundarySlice) continue;
            for (let row = 0; row < maskHeight; row++) for (let column = 0; column < maskWidth; column++) {
                const maskIndex = column + row * maskWidth;
                const cellIndex = (slice + 1) * strides[axis] + (column + 1) * strides[tangentAxis] +
                    (row + 1) * strides[otherAxis];
                const material = input.voxels[cellIndex], outsideIndex = cellIndex + sign * strides[axis];
                if (material === 0 || input.voxels[outsideIndex] !== 0) {
                    mask[maskIndex] = 0;
                    continue;
                }
                let occlusionCorners = 255;
                if (input.includeAmbientOcclusion !== false) {
                    occlusionCorners = 0;
                    for (let cornerIndex = 0; cornerIndex < 4; cornerIndex++) {
                        const tangentSign = cornerIndex === 1 || cornerIndex === 2 ? 1 : -1;
                        const otherSign = cornerIndex >= 2 ? 1 : -1;
                        const tangentOffset = tangentSign * strides[tangentAxis];
                        const otherOffset = otherSign * strides[otherAxis];
                        const sideFirst = input.voxels[outsideIndex + tangentOffset] !== 0 ? 1 : 0;
                        const sideSecond = input.voxels[outsideIndex + otherOffset] !== 0 ? 1 : 0;
                        const corner = input.voxels[outsideIndex + tangentOffset + otherOffset] !== 0 ? 1 : 0;
                        const occlusion = sideFirst && sideSecond ? 0 : 3 - sideFirst - sideSecond - corner;
                        occlusionCorners |= occlusion << (cornerIndex * 2);
                    }
                }
                mask[maskIndex] = (material << 8) | occlusionCorners;
            }
            for (let row = 0; row < maskHeight; row++) for (let column = 0; column < maskWidth;) {
                const key = mask[column + row * maskWidth];
                if (key === 0) {
                    column++; continue;
                }
                let width = 1, height = 1;
                while (column + width < maskWidth && mask[column + width + row * maskWidth] === key) width++;
                while (row + height < maskHeight) {
                    let isMatching = true;
                    for (let offset = 0; offset < width; offset++)
                        if (mask[column + offset + (row + height) * maskWidth] !== key) {
                            isMatching = false;
                            break;
                        }
                    if (!isMatching) break;
                    height++;
                }
                const firstVertex = positions.length / 4, material = key >>> 8;
                const occlusion = [key & 3, (key >>> 2) & 3, (key >>> 4) & 3, (key >>> 6) & 3];
                vertex[axis] = slice + (sign > 0 ? 1 : 0);
                for (let cornerIndex = 0; cornerIndex < 4; cornerIndex++) {
                    vertex[tangentAxis] = column + (cornerIndex === 1 || cornerIndex === 2 ? width : 0);
                    vertex[otherAxis] = row + (cornerIndex >= 2 ? height : 0);
                    positions.push(vertex[0], vertex[1], vertex[2], 0);
                    information.push(material, occlusion[cornerIndex], faceIndex, 0);
                }
                const corners = occlusion[0] + occlusion[2] > occlusion[1] + occlusion[3]
                    ? [0, 1, 3, 1, 2, 3] : [0, 1, 2, 0, 2, 3];
                for (let triangle = 0; triangle < 6; triangle += 3)
                    indices.push(firstVertex + corners[triangle],
                        firstVertex + corners[triangle + (sign > 0 ? 1 : 2)],
                        firstVertex + corners[triangle + (sign > 0 ? 2 : 1)]);

                for (let heightOffset = 0; heightOffset < height; heightOffset++)
                    mask.fill(0, column + (row + heightOffset) * maskWidth,
                        column + width + (row + heightOffset) * maskWidth);
                column += width;
            }
        }
    }
    return { positions: new Uint8Array(positions), information: new Uint8Array(information),
        indices: positions.length / 4 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices) };
}
