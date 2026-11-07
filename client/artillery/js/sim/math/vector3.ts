export interface Vector3 {
    x: number;
    y: number;
    z: number;
}

export function createVector3(x = 0, y = 0, z = 0): Vector3 {
    return { x, y, z };
}

export function setVector3(output: Vector3, x: number, y: number, z: number): Vector3 {
    output.x = x;
    output.y = y;
    output.z = z;
    return output;
}

export function addVectors(output: Vector3, first: Vector3, second: Vector3): Vector3 {
    return setVector3(output, first.x + second.x, first.y + second.y, first.z + second.z);
}

export function subtractVectors(output: Vector3, first: Vector3, second: Vector3): Vector3 {
    return setVector3(output, first.x - second.x, first.y - second.y, first.z - second.z);
}

export function scaleVector(output: Vector3, vector: Vector3, multiplier: number): Vector3 {
    return setVector3(output, vector.x * multiplier, vector.y * multiplier, vector.z * multiplier);
}

export function dotProduct(first: Vector3, second: Vector3): number {
    return first.x * second.x + first.y * second.y + first.z * second.z;
}

export function vectorLength(vector: Vector3): number {
    return Math.sqrt(dotProduct(vector, vector));
}

export function distanceBetweenVectors(first: Vector3, second: Vector3): number {
    const x = first.x - second.x, y = first.y - second.y, z = first.z - second.z;
    return Math.sqrt(x * x + y * y + z * z);
}

export function normalizeVector(output: Vector3, vector: Vector3): Vector3 {
    const magnitude = vectorLength(vector);
    return scaleVector(output, vector, magnitude > 0 ? 1 / magnitude : 0);
}

export function crossProduct(output: Vector3, first: Vector3, second: Vector3): Vector3 {
    return setVector3(output, first.y * second.z - first.z * second.y,
        first.z * second.x - first.x * second.z, first.x * second.y - first.y * second.x);
}
