import { AudioEngine, type AudioPosition } from '../../../shared/ts/audio-engine.js';
import { BULLET, GAS_SHELL, HEAVY_TANK_SHELL, POLICE_SHOT, SHELL, SNIPER_SHOT, TANK_SHELL,
    TOMAHAWK_SHOT } from '../sim/content/weapons.js';

const NORMAL = 'tank_fire_normal.mp3';
export const SHOCKWAVE = 'explode3.mp3';
export const EXPLOSION = 'explode2.mp3';
export const SONIC_HUM = 'dark_matter_hum.mp3';
const localSounds = new Set(['cash_register.mp3', 'fireworks.mp3', 'objective_under_attack.mp3', 'ping.mp3']);
const launches = new Map<number, readonly [string, number]>([
    [BULLET, ['tank_shotgun.mp3', 0.17]],
    [GAS_SHELL, [NORMAL, 0.38]],
    [HEAVY_TANK_SHELL, [NORMAL, 0.85]],
    [POLICE_SHOT, [NORMAL, 0.22]],
    [SHELL, [NORMAL, 1]],
    [SNIPER_SHOT, [NORMAL, 0.55]],
    [TANK_SHELL, [NORMAL, 0.62]],
    [TOMAHAWK_SHOT, ['radio.ogg', 0.8]]
]);

export class DefenseAudio extends AudioEngine {
    private bursts = new Set<ReturnType<typeof setTimeout>>();

    constructor(private listener: AudioPosition) {
        super({
            resolvePath: name => {
                if (localSounds.has(name)) return `/datacenter_defense/sound/${name}`;
                return `/${name === SONIC_HUM ? 'galaxy_tanks' : 'tanks'}/sound/${name}`;
            },
            attenuationPerUnit: 0.985,
            distanceMultiplier: 1,
            maximumShots: 24,
            maximumLoops: 12,
            maximumDesiredLoops: 8,
            initialVolume: 0.55
        });
    }

    play(name: string, position?: AudioPosition, gain = 1) {
        if (position && this.positionalGain(position, this.listener) * gain < 0.025) return;
        this.sound(name, position, this.listener, gain);
    }

    launch(projectile: number, position: AudioPosition) {
        const shot = launches.get(projectile);
        if (shot) this.play(shot[0], projectile === TOMAHAWK_SHOT ? undefined : position, shot[1]);
    }

    intercept(position: AudioPosition) {
        this.play(NORMAL, position, 0.32);
        for (const delay of [55, 110]) {
            const timer = setTimeout(() => {
                this.bursts.delete(timer);
                this.play(NORMAL, position, 0.32);
            }, delay);
            this.bursts.add(timer);
        }
    }

    override dispose() {
        for (const timer of this.bursts) clearTimeout(timer);
        this.bursts.clear();
        super.dispose();
    }
}
