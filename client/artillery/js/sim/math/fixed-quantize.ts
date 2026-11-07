import { turretPitchMaximumDegrees, turretPitchMinimumDegrees, turretPitchQuantizationSteps,
    turretYawQuantizationSteps } from '../../config.js';
import { fullCircleInRadians, radiansPerDegree } from './deterministic-math.js';

export function quantizeYaw(angleInRadians: number): number {
    const turns = angleInRadians / fullCircleInRadians;
    return Math.round((turns - Math.floor(turns)) * turretYawQuantizationSteps) % turretYawQuantizationSteps;
}

export function decodeYaw(quantized: number): number {
    return quantized * fullCircleInRadians / turretYawQuantizationSteps;
}

export function quantizePitch(angleInRadians: number): number {
    const degrees = Math.max(turretPitchMinimumDegrees,
        Math.min(turretPitchMaximumDegrees, angleInRadians / radiansPerDegree));
    return Math.round((degrees - turretPitchMinimumDegrees) /
        (turretPitchMaximumDegrees - turretPitchMinimumDegrees) * (turretPitchQuantizationSteps - 1));
}

export function decodePitch(quantized: number): number {
    return (turretPitchMinimumDegrees + quantized / (turretPitchQuantizationSteps - 1) *
        (turretPitchMaximumDegrees - turretPitchMinimumDegrees)) * radiansPerDegree;
}
