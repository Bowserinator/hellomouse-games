import { addSoundsToPreload, playSound, setGlobalVolume as setTankVolume } from '../../../tanks/js/sound/sound.js';
import { V3, distance } from '../sim/math/vec3.js';
const ASSETS = ['tank_fire_normal.mp3', 'tank_shotgun.mp3', 'railgun.mp3', 'laser.ogg', 'radio.ogg',
    'teleport.mp3', 'shield.mp3', 'stealth.ogg', 'beep.mp3', 'explode1.mp3', 'explode2.mp3',
    'explode3.mp3', 'tank_hum.ogg'];
const GALAXY_ASSETS = ['ammunition_zero.mp3', 'black_hole_woosh.mp3', 'dark_matter_hum.mp3', 'jump.mp3',
    'launch_star_idle.mp3', 'launch_star_launch.mp3', 'lava_sfx.mp3', 'shield_hit.mp3'];
const path = (name: string): string => `/${GALAXY_ASSETS.includes(name) ? 'galaxy_tanks' : 'tanks'}/sound/${name}`;
addSoundsToPreload([...ASSETS, ...GALAXY_ASSETS].map(path));
let volume = .5;
export function setGlobalVolume(value: number): void {
    volume = Math.max(0, Math.min(1, Number.isFinite(value) ? value : .5));
    setTankVolume(volume);
    for (const voice of loops.values()) voice.audio.volume = Math.min(1, voice.gain * volume);
    for (const [audio, gain] of shots) audio.volume = Math.min(1, gain * volume);
}
const shots = new Map<HTMLAudioElement, number>();
export function sound(name: string, position?: V3, listener?: V3, gain = 1): void {
    const attenuation = position && listener ? Math.pow(0.997, distance(position, listener) * 10) : 1;
    if (!GALAXY_ASSETS.includes(name)) {
        void playSound(path(name), attenuation * gain);
        return;
    }
    if (!volume) return;
    if (shots.size >= 12) {
        const oldest = shots.keys().next().value as HTMLAudioElement;
        oldest.pause();
        shots.delete(oldest);
    }
    const audio = new Audio(path(name)), level = Math.max(0, attenuation * gain);
    shots.set(audio, level);
    audio.volume = Math.min(1, level * volume);
    audio.addEventListener('ended', () => shots.delete(audio), { once: true });
    audio.addEventListener('error', () => shots.delete(audio), { once: true });
    void audio.play().catch(() => shots.delete(audio));
}
export interface LoopSound {
    key: string;
    name: string;
    position: V3;
    gain: number;
    rate: number;
}
interface LoopVoice {
    audio: HTMLAudioElement;
    gain: number;
    playing: boolean;
    blocked: boolean;
}
const loops = new Map<string, LoopVoice>(), failed = new Set<string>();
function start(voice: LoopVoice): void {
    if (voice.playing || voice.blocked) return;
    voice.playing = true;
    void voice.audio.play().catch(() => {
        voice.playing = false;
        voice.blocked = true;
    });
}
export function unlockLoops(): void {
    for (const voice of loops.values()) {
        voice.blocked = false;
        start(voice);
    }
}
export function stopLoops(): void {
    for (const voice of loops.values()) voice.audio.pause();
    loops.clear();
}
export function updateLoops(requests: Array<LoopSound>, listener: V3, dt: number): void {
    const desired = new Map(requests.map(request => [request.key, {
        ...request, gain: request.gain * Math.pow(0.997, distance(request.position, listener) * 10)
    }] as const).filter(([, request]) => request.gain > .001).sort((a, b) => b[1].gain - a[1].gain).slice(0, 16));
    const blend = 1 - Math.exp(-dt * 12);
    for (const [key, request] of desired) {
        let voice = loops.get(key);
        if (!voice && loops.size < 24 && !failed.has(request.name)) {
            const audio = new Audio(path(request.name));
            audio.loop = true;
            Object.assign(audio, { preservesPitch: false });
            audio.volume = 0;
            audio.addEventListener('error', () => {
                failed.add(request.name);
                audio.pause();
                if (loops.get(key)?.audio === audio) loops.delete(key);
                console.warn(`Could not load sound ${request.name}`);
            }, { once: true });
            voice = { audio, gain: 0, playing: false, blocked: false };
            loops.set(key, voice);
        }
        if (voice) {
            voice.audio.playbackRate += (Math.max(.5, Math.min(3, request.rate)) - voice.audio.playbackRate) * blend;
            start(voice);
        }
    }
    for (const [key, voice] of loops) {
        voice.gain += ((desired.get(key)?.gain ?? 0) - voice.gain) * blend;
        voice.audio.volume = Math.max(0, Math.min(1, voice.gain * volume));
        if (!desired.has(key) && voice.gain < .001) {
            voice.audio.pause();
            loops.delete(key);
        }
    }
}
