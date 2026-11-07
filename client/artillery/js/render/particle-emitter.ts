import { ParticleKind, particleKinds } from './particle-renderer.js';
import { soundCatalog } from '../audio/sound-catalog.js';
import { audioGapProfiles } from '../config.js';

export interface ParticleEmitterSpec {
    pool: ParticleKind;
    count: number;
    shape: 'shell' | 'cone' | 'ring';
    speed: readonly [number, number];
    lifetime: readonly [number, number];
    size: readonly [number, number];
    colours: readonly [string, string];
    drag: number;
    gravityScale: number;
    spin: readonly [number, number];
    glow: number;
    delaySeconds?: number;
    offset?: readonly [number, number, number];
    radius?: readonly [number, number];
    radialSpeed?: readonly [number, number];
    coneAngleInDegrees?: number;
}

export interface EffectProfile {
    kind: string;
    colour: string;
    durationSeconds: number;
    particleCount: number;
    glowIntensity: number;
    shakeStrength: number;
    emitters: ReadonlyArray<ParticleEmitterSpec>;
    soundIdentifiers?: ReadonlyArray<string>;
    loopSoundIdentifier?: string;
    /** Draws a fading glowing line behind a projectile this wide, lasting for the profile's duration. */
    streakWidthInVoxels?: number;
}

export function validateEffectProfiles(value: unknown): asserts value is Readonly<Record<string, EffectProfile>> {
    const bounded = (input: unknown, minimum: number, maximum: number): input is number =>
        typeof input === 'number' && Number.isFinite(input) && input >= minimum && input <= maximum;
    const pair = (input: unknown, minimum: number, maximum: number, ordered = true): boolean =>
        Array.isArray(input) && input.length === 2 && bounded(input[0], minimum, maximum) &&
            bounded(input[1], minimum, maximum) && (!ordered || input[0] <= input[1]);
    const colour = (input: unknown): boolean => typeof input === 'string' && /^#[0-9a-f]{6}$/i.test(input);
    const record = (input: unknown): input is Record<string, unknown> =>
        typeof input === 'object' && input !== null && !Array.isArray(input);
    if (!record(value)) throw new Error('Invalid effect catalog');
    const sounds = new Set([...Object.keys(soundCatalog), ...Object.keys(audioGapProfiles)]);
    const profileKeys = ['kind', 'colour', 'durationSeconds', 'particleCount', 'glowIntensity', 'shakeStrength',
        'emitters', 'soundIdentifiers', 'loopSoundIdentifier', 'streakWidthInVoxels'];
    const emitterKeys = ['pool', 'count', 'shape', 'speed', 'lifetime', 'size', 'colours', 'drag', 'gravityScale',
        'spin', 'glow', 'delaySeconds', 'offset', 'radius', 'radialSpeed', 'coneAngleInDegrees'];
    for (const [identifier, profile] of Object.entries(value)) {
        if (!/^[a-z][a-z0-9_]*$/.test(identifier) || !record(profile) ||
            Object.keys(profile).some(key => !profileKeys.includes(key)) || typeof profile.kind !== 'string' ||
            !colour(profile.colour) || !bounded(profile.durationSeconds, 0, 60) ||
            !bounded(profile.particleCount, 0, 12000) || !Number.isInteger(profile.particleCount) ||
            !bounded(profile.glowIntensity, 0, 32) ||
            profile.streakWidthInVoxels !== undefined && !bounded(profile.streakWidthInVoxels, .01, 16) ||
            !bounded(profile.shakeStrength, 0, 10) ||
            !Array.isArray(profile.emitters) || profile.emitters.length > 64 ||
            profile.soundIdentifiers !== undefined && (!Array.isArray(profile.soundIdentifiers) ||
                profile.soundIdentifiers.length > 4 || !profile.soundIdentifiers.every(sound =>
                typeof sound === 'string' && sounds.has(sound))) ||
            profile.loopSoundIdentifier !== undefined && (typeof profile.loopSoundIdentifier !== 'string' ||
                !sounds.has(profile.loopSoundIdentifier)))
            throw new Error(`Invalid effect profile: ${identifier}`);
        for (const emitter of profile.emitters)
            if (!record(emitter) || Object.keys(emitter).some(key => !emitterKeys.includes(key)) ||
                !particleKinds.some(kind => kind === emitter.pool) || !bounded(emitter.count, 0, 12000) ||
                !Number.isInteger(emitter.count) || !['shell', 'cone', 'ring'].includes(String(emitter.shape)) ||
                !pair(emitter.speed, 0, 500) || !pair(emitter.lifetime, .01, 60) ||
                !pair(emitter.size, 0, 100, false) ||
                !Array.isArray(emitter.colours) || emitter.colours.length !== 2 || !emitter.colours.every(colour) ||
                !bounded(emitter.drag, 0, 30) || !bounded(emitter.gravityScale, -5, 5) ||
                !pair(emitter.spin, -50, 50) || !bounded(emitter.glow, 0, 32) ||
                emitter.delaySeconds !== undefined && !bounded(emitter.delaySeconds, 0, 30) ||
                emitter.radius !== undefined && !pair(emitter.radius, 0, 200) ||
                emitter.radialSpeed !== undefined && !pair(emitter.radialSpeed, 0, 200) ||
                emitter.coneAngleInDegrees !== undefined && !bounded(emitter.coneAngleInDegrees, 0, 180) ||
                emitter.offset !== undefined && (!Array.isArray(emitter.offset) || emitter.offset.length !== 3 ||
                    !emitter.offset.every(component => bounded(component, -200, 200))))
                throw new Error(`Invalid particle emitter: ${identifier}`);
    }
}
