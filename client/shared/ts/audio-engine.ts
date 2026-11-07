export interface AudioPosition {
    x: number;
    y: number;
    z: number;
}

export interface LoopSound {
    key: string;
    name: string;
    position: AudioPosition;
    gain: number;
    rate: number;
}

interface LoopVoice {
    audio: HTMLAudioElement;
    gain: number;
    playing: boolean;
    blocked: boolean;
}

export interface AudioEngineOptions {
    resolvePath: (name: string) => string;
    attenuationPerUnit: number;
    distanceMultiplier: number;
    maximumShots: number;
    maximumLoops: number;
    maximumDesiredLoops: number;
    initialVolume: number;
    playLegacy?: (name: string, gain: number) => boolean;
    setLegacyVolume?: (volume: number) => void;
    stereoPan?: (position: AudioPosition, listener: AudioPosition) => number;
}

export class AudioEngine {
    private volume: number;
    private shots = new Map<HTMLAudioElement, number>();
    private loops = new Map<string, LoopVoice>();
    private failed = new Set<string>();
    private context: AudioContext | null = null;
    private panners = new Map<HTMLAudioElement, {
        source: MediaElementAudioSourceNode;
        panner: StereoPannerNode;
    }>();

    constructor(private options: AudioEngineOptions) {
        this.volume = options.initialVolume;
        if (!options.stereoPan || typeof AudioContext === 'undefined') return;
        try {
            this.context = new AudioContext();
        } catch {
            console.warn('Could not initialise positional audio');
        }
    }

    private pan(audio: HTMLAudioElement, position?: AudioPosition, listener?: AudioPosition): void {
        if (!this.context?.createStereoPanner) return;
        let nodes = this.panners.get(audio);
        if (!nodes) {
            const panner = this.context.createStereoPanner();
            const source = this.context.createMediaElementSource(audio);
            source.connect(panner); panner.connect(this.context.destination);
            nodes = { source, panner };
            this.panners.set(audio, nodes);
        }
        const value = position && listener ? this.options.stereoPan?.(position, listener) ?? 0 : 0;
        nodes.panner.pan.value = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    }

    private release(audio: HTMLAudioElement): void {
        const nodes = this.panners.get(audio);
        nodes?.source.disconnect(); nodes?.panner.disconnect();
        this.panners.delete(audio);
    }

    setGlobalVolume(value: number): void {
        this.volume = Math.max(0, Math.min(1, Number.isFinite(value) ? value : this.options.initialVolume));
        this.options.setLegacyVolume?.(this.volume);
        for (const voice of this.loops.values()) voice.audio.volume = Math.min(1, voice.gain * this.volume);
        for (const [audio, gain] of this.shots) audio.volume = Math.min(1, gain * this.volume);
    }

    positionalGain(position: AudioPosition, listener: AudioPosition): number {
        const x = position.x - listener.x, y = position.y - listener.y, z = position.z - listener.z;
        return Math.pow(this.options.attenuationPerUnit,
            Math.hypot(x, y, z) * this.options.distanceMultiplier);
    }

    sound(name: string, position?: AudioPosition, listener?: AudioPosition, gain = 1): void {
        const attenuation = position && listener ? this.positionalGain(position, listener) : 1;
        if (this.options.playLegacy?.(name, attenuation * gain)) return;
        if (!this.volume) return;
        if (this.shots.size >= this.options.maximumShots) {
            const oldest = this.shots.keys().next().value as HTMLAudioElement;
            oldest.pause();
            this.release(oldest);
            this.shots.delete(oldest);
        }
        const audio = new Audio(this.options.resolvePath(name)), level = Math.max(0, attenuation * gain);
        this.shots.set(audio, level);
        audio.volume = Math.min(1, level * this.volume);
        const finish = (): void => {
            this.shots.delete(audio);
            this.release(audio);
        };
        audio.addEventListener('ended', finish, { once: true });
        audio.addEventListener('error', finish, { once: true });
        this.pan(audio, position, listener);
        void audio.play().catch(finish);
    }

    private start(voice: LoopVoice): void {
        if (voice.playing || voice.blocked) return;
        voice.playing = true;
        void voice.audio.play().catch(() => {
            voice.playing = false;
            voice.blocked = true;
        });
    }

    unlockLoops(): void {
        if (this.context?.state === 'suspended') void this.context.resume().catch(() => {});
        for (const voice of this.loops.values()) {
            voice.blocked = false;
            this.start(voice);
        }
    }

    stopLoops(): void {
        for (const voice of this.loops.values()) {
            voice.audio.pause();
            this.release(voice.audio);
        }
        this.loops.clear();
    }

    updateLoops(requests: Array<LoopSound>, listener: AudioPosition, deltaTimeInSeconds: number): void {
        const desired = new Map(requests.map(request => [request.key, {
            ...request, gain: request.gain * this.positionalGain(request.position, listener)
        }] as const).filter(([, request]) => request.gain > .001)
            .sort((first, second) => second[1].gain - first[1].gain).slice(0, this.options.maximumDesiredLoops));
        const blend = 1 - Math.exp(-deltaTimeInSeconds * 12);
        for (const [key, request] of desired) {
            let voice = this.loops.get(key);
            if (!voice && this.loops.size < this.options.maximumLoops && !this.failed.has(request.name)) {
                const audio = new Audio(this.options.resolvePath(request.name));
                audio.loop = true;
                Object.assign(audio, { preservesPitch: false });
                audio.volume = 0;
                audio.addEventListener('error', () => {
                    this.failed.add(request.name);
                    audio.pause();
                    this.release(audio);
                    if (this.loops.get(key)?.audio === audio) this.loops.delete(key);
                    console.warn(`Could not load sound ${request.name}`);
                }, { once: true });
                voice = { audio, gain: 0, playing: false, blocked: false };
                this.loops.set(key, voice);
            }
            if (voice) {
                this.pan(voice.audio, request.position, listener);
                voice.audio.playbackRate +=
                    (Math.max(.5, Math.min(3, request.rate)) - voice.audio.playbackRate) * blend;
                this.start(voice);
            }
        }
        for (const [key, voice] of this.loops) {
            voice.gain += ((desired.get(key)?.gain ?? 0) - voice.gain) * blend;
            voice.audio.volume = Math.max(0, Math.min(1, voice.gain * this.volume));
            if (!desired.has(key) && voice.gain < .001) {
                voice.audio.pause();
                this.release(voice.audio);
                this.loops.delete(key);
            }
        }
    }

    dispose(): void {
        this.stopLoops();
        for (const audio of this.shots.keys()) {
            audio.pause();
            this.release(audio);
        }
        this.shots.clear();
        if (this.context) void this.context.close().catch(() => {});
        this.context = null;
    }
}
