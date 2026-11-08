import { matchSettingIntegerRanges, powerCentipercentMaximum, simulationTicksPerSecond, weaponIdentifierMaximumLength,
    turretPitchQuantizationSteps, turretYawQuantizationSteps } from './config.js';
import { MovementInput, PlanningPreview, PlayerPlan } from './types.js';

export function isPlanningPreview(value: unknown, mapEdgeLengthInVoxels: number): value is PlanningPreview {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        !Number.isFinite(mapEdgeLengthInVoxels) || mapEdgeLengthInVoxels <= 0) return false;
    const preview = value as Record<string, unknown>, pose = preview.pose;
    return Array.isArray(pose) && pose.length === 6 && pose.every(Number.isFinite) &&
        pose.slice(0, 3).every(component => Math.abs(component) <= mapEdgeLengthInVoxels * 2) &&
        pose.slice(3).every((component, index) => Number.isSafeInteger(component) && component >= 0 &&
            component < (index === 2 ? turretPitchQuantizationSteps : turretYawQuantizationSteps)) &&
        typeof preview.powerCentipercent === 'number' && Number.isSafeInteger(preview.powerCentipercent) &&
        preview.powerCentipercent >= 0 && preview.powerCentipercent <= powerCentipercentMaximum &&
        (preview.weaponIdentifier === null || typeof preview.weaponIdentifier === 'string' &&
            preview.weaponIdentifier.length > 0 && preview.weaponIdentifier.length <= weaponIdentifierMaximumLength);
}

export function isPlayerPlan(value: unknown, movementBudgetInTicks: number,
    maximumDurationInTicks = Math.max(matchSettingIntegerRanges.movePlanningTimeLimitInSeconds[1],
        matchSettingIntegerRanges.firePlanningTimeLimitInSeconds[1]) * simulationTicksPerSecond):
value is PlayerPlan {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        !Number.isSafeInteger(movementBudgetInTicks) || movementBudgetInTicks < 0 ||
        !Number.isSafeInteger(maximumDurationInTicks) || maximumDurationInTicks < 0) return false;
    const plan = value as Record<string, unknown>;
    const keys = ['movementSegments', 'turretYawQuantized', 'turretPitchQuantized',
        'powerCentipercent', 'weaponIdentifier'];
    if (Object.keys(plan).length !== keys.length || Object.keys(plan).some(key => !keys.includes(key))) return false;
    for (const [key, maximum] of [['turretYawQuantized', turretYawQuantizationSteps - 1],
        ['turretPitchQuantized', turretPitchQuantizationSteps - 1], ['powerCentipercent', powerCentipercentMaximum]] as const)
        if (typeof plan[key] !== 'number' || !Number.isSafeInteger(plan[key]) ||
            (plan[key] as number) < 0 || (plan[key] as number) > maximum) return false;
    if (plan.weaponIdentifier !== null && (typeof plan.weaponIdentifier !== 'string' ||
        plan.weaponIdentifier.length === 0 || plan.weaponIdentifier.length > weaponIdentifierMaximumLength))
        return false;
    if (!Array.isArray(plan.movementSegments) || plan.movementSegments.length > maximumDurationInTicks) return false;
    let duration = 0, drivingDuration = 0;
    for (const segment of plan.movementSegments) {
        if (!Array.isArray(segment) || segment.length !== 2 || !Number.isSafeInteger(segment[0]) ||
            segment[0] <= 0 || !Number.isSafeInteger(segment[1]) || segment[1] < 1 || segment[1] > 15) return false;
        duration += segment[0];
        if (((segment[1] & MovementInput.FORWARD) !== 0) !== ((segment[1] & MovementInput.BACKWARD) !== 0))
            drivingDuration += segment[0];
        if (duration > maximumDurationInTicks || drivingDuration > movementBudgetInTicks) return false;
    }
    return true;
}
