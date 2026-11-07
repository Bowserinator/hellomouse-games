import { addSoundsToPreload, playSound, setGlobalVolume as setTankVolume } from '../../../tanks/js/sound/sound.js';
import { AudioEngine, LoopSound } from '../../../shared/ts/audio-engine.js';
import { V3 } from '../sim/math/vec3.js';
export type { LoopSound } from '../../../shared/ts/audio-engine.js';

const ASSETS = ['tank_fire_normal.mp3', 'tank_shotgun.mp3', 'railgun.mp3', 'laser.ogg', 'radio.ogg',
    'teleport.mp3', 'shield.mp3', 'stealth.ogg', 'beep.mp3', 'explode1.mp3', 'explode2.mp3',
    'explode3.mp3', 'tank_hum.ogg'];
const GALAXY_ASSETS = ['ammunition_zero.mp3', 'black_hole_woosh.mp3', 'dark_matter_hum.mp3', 'jump.mp3',
    'launch_star_idle.mp3', 'launch_star_launch.mp3', 'lava_sfx.mp3', 'shield_hit.mp3'];
const path = (name: string): string => `/${GALAXY_ASSETS.includes(name) ? 'galaxy_tanks' : 'tanks'}/sound/${name}`;
addSoundsToPreload([...ASSETS, ...GALAXY_ASSETS].map(path));
const engine = new AudioEngine({
    resolvePath: path,
    attenuationPerUnit: .997,
    distanceMultiplier: 10,
    maximumShots: 12,
    maximumLoops: 24,
    maximumDesiredLoops: 16,
    initialVolume: .5,
    setLegacyVolume: setTankVolume,
    playLegacy: (name, gain) => {
        if (GALAXY_ASSETS.includes(name)) return false;
        void playSound(path(name), gain);
        return true;
    }
});

export function setGlobalVolume(value: number): void {
    engine.setGlobalVolume(value);
}

export function sound(name: string, position?: V3, listener?: V3, gain = 1): void {
    engine.sound(name, position, listener, gain);
}

export function unlockLoops(): void {
    engine.unlockLoops();
}

export function stopLoops(): void {
    engine.stopLoops();
}

export function updateLoops(requests: Array<LoopSound>, listener: V3, dt: number): void {
    engine.updateLoops(requests, listener, dt);
}
