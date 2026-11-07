import { simulationTicksPerSecond, weaponMaximumSpawnsPerFire } from '../config.js';
import { Rng } from '../../../shared/ts/seeded-random.js';
import { cosineOfRadians, fullCircleInRadians, radiansPerDegree, sineOfRadians } from './math/deterministic-math.js';
import { Vector3, createVector3 } from './math/vector3.js';
import { WeaponAction } from './weapon-types.js';

const goldenAngleInRadians = 2.399963229728653;

export interface PatternLaunch {
    offset: Vector3;
    direction: Vector3;
    delayInTicks: number;
}

export function projectilePattern(action: Extract<WeaponAction, { action: 'spawnProjectiles' }>,
    yawInRadians: number, pitchInRadians: number, random: Rng): Array<PatternLaunch> {
    if (!Number.isInteger(action.count) || action.count < 1 || action.count > weaponMaximumSpawnsPerFire)
        throw new RangeError('Invalid projectile pattern count');
    const result: Array<PatternLaunch> = [];
    const sphereRotation = action.pattern === 'sphereShell' ? random.float() * fullCircleInRadians : 0;
    const columns = action.gridColumns ?? action.count;
    const rows = Math.ceil(action.count / columns);
    for (let index = 0; index < action.count; index++) {
        const fraction = action.count === 1 ? 0 : index / (action.count - 1) - .5;
        let yaw = yawInRadians, pitch = pitchInRadians;
        const offset = createVector3();
        let direction: Vector3 | null = null;
        switch (action.pattern) {
            case 'single': break;
            case 'spread': {
                const columnFraction = action.randomSpread ? random.float() - .5
                    : columns === 1 ? 0 : (index % columns) / (columns - 1) - .5;
                const rowFraction = action.randomSpread ? random.float() - .5
                    : rows === 1 ? 0 : Math.floor(index / columns) / (rows - 1) - .5;
                yaw += columnFraction * (action.yawSpreadDegrees ?? 0) * radiansPerDegree;
                pitch += rowFraction * (action.pitchSpreadDegrees ?? 0) * radiansPerDegree;
                break;
            }
            case 'cone': {
                if (action.pitchDegrees !== undefined) pitch = action.pitchDegrees * radiansPerDegree;
                const halfAngle = (action.coneDegrees ?? 0) * radiansPerDegree / 2;
                const polar = halfAngle * Math.sqrt(action.randomSpread ? random.float() : (index + .5) / action.count);
                const azimuth = action.randomSpread ? random.float() * fullCircleInRadians
                    : index * goldenAngleInRadians;
                const forwardX = sineOfRadians(yaw) * cosineOfRadians(pitch);
                const forwardY = sineOfRadians(pitch);
                const forwardZ = cosineOfRadians(yaw) * cosineOfRadians(pitch);
                const rightX = cosineOfRadians(yaw), rightZ = -sineOfRadians(yaw);
                const upX = forwardY * rightZ, upY = forwardZ * rightX - forwardX * rightZ, upZ = -forwardY * rightX;
                const across = sineOfRadians(polar) * cosineOfRadians(azimuth);
                const vertical = sineOfRadians(polar) * sineOfRadians(azimuth);
                const along = cosineOfRadians(polar);
                direction = createVector3(forwardX * along + rightX * across + upX * vertical,
                    forwardY * along + upY * vertical, forwardZ * along + rightZ * across + upZ * vertical);
                break;
            }
            case 'ring':
            case 'fountain': {
                const turn = action.randomSpread ? random.float() : index / action.count;
                yaw += turn * (action.yawSpreadDegrees ?? 360) * radiansPerDegree;
                const pitchVariation = (action.randomSpread ? random.float() - .5 : 0) *
                    (action.pitchSpreadDegrees ?? 0);
                pitch = ((action.pitchDegrees ?? (action.pattern === 'fountain' ? 45 : 0)) +
                    pitchVariation) * radiansPerDegree;
                if (action.pattern === 'ring') {
                    offset.x = sineOfRadians(yaw) * (action.radiusInVoxels ?? 0);
                    offset.z = cosineOfRadians(yaw) * (action.radiusInVoxels ?? 0);
                }
                break;
            }
            case 'sphereShell': {
                const vertical = 1 - 2 * (index + .5) / action.count;
                const horizontal = Math.sqrt(Math.max(0, 1 - vertical * vertical));
                const angle = index * 2.399963229728653 + sphereRotation;
                direction = createVector3(sineOfRadians(angle) * horizontal, vertical,
                    cosineOfRadians(angle) * horizontal);
                break;
            }
            case 'randomArea': {
                const angle = random.float() * fullCircleInRadians;
                const radius = Math.sqrt(random.float()) * (action.radiusInVoxels ?? 0);
                offset.x = sineOfRadians(angle) * radius;
                offset.z = cosineOfRadians(angle) * radius;
                direction = createVector3(0, -1, 0);
                break;
            }
            case 'line': {
                const distance = fraction * 2 * (action.radiusInVoxels ?? 1);
                offset.x = sineOfRadians(yaw) * distance;
                offset.z = cosineOfRadians(yaw) * distance;
                break;
            }
        }
        if (!direction) {
            const horizontal = cosineOfRadians(pitch);
            direction = createVector3(sineOfRadians(yaw) * horizontal, sineOfRadians(pitch),
                cosineOfRadians(yaw) * horizontal);
        }
        result.push({ offset, direction,
            delayInTicks: Math.ceil(((action.intervalSeconds ?? 0) * simulationTicksPerSecond) * index) });
    }
    return result;
}
