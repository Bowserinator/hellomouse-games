import { Rng } from '../../../shared/ts/seeded-random.js';
import { audioGapAttackInSeconds, audioGapProfiles, audioGapSampleRate } from '../config.js';

export type GapSoundIdentifier = keyof typeof audioGapProfiles;

export function createGapSoundBuffer(identifier: GapSoundIdentifier, seed: number): ArrayBuffer {
    const profile = audioGapProfiles[identifier], count = Math.ceil(profile.durationSeconds * audioGapSampleRate);
    const buffer = new ArrayBuffer(44 + count * 2), bytes = new Uint8Array(buffer), view = new DataView(buffer);
    const writeTag = (offset: number, tag: string): void => {
        for (let index = 0; index < tag.length; index++) bytes[offset + index] = tag.charCodeAt(index);
    };
    writeTag(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); writeTag(8, 'WAVE'); writeTag(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, audioGapSampleRate, true); view.setUint32(28, audioGapSampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); writeTag(36, 'data');
    view.setUint32(40, count * 2, true);
    const random = new Rng(seed).fork(identifier === 'splash' ? 8006 : 8007);
    let filtered = 0;
    for (let index = 0; index < count; index++) {
        const time = index / audioGapSampleRate;
        filtered += profile.filterCoefficient * (random.float() * 2 - 1 - filtered);
        const envelope = Math.min(1, time / audioGapAttackInSeconds,
            (profile.durationSeconds - time) / audioGapAttackInSeconds) * Math.exp(-time * profile.decayPerSecond);
        view.setInt16(44 + index * 2, Math.round(Math.max(-1, Math.min(1, filtered * envelope)) * 32767), true);
    }
    return buffer;
}

export class GapSounds {
    readonly urls: Readonly<Record<GapSoundIdentifier, string>>;
    private disposed = false;

    constructor(seed: number) {
        this.urls = {
            splash: URL.createObjectURL(new Blob([createGapSoundBuffer('splash', seed)], { type: 'audio/wav' })),
            thunder: URL.createObjectURL(new Blob([createGapSoundBuffer('thunder', seed)], { type: 'audio/wav' }))
        };
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const url of Object.values(this.urls)) URL.revokeObjectURL(url);
    }
}
