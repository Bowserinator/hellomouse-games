import { AudioEngine, LoopSound } from '../../../shared/ts/audio-engine.js';
import { audioAttenuationPerVoxel, audioDefaultVolume, audioEngineMaximumRate, audioEngineMinimumRate,
    audioEngineMinimumSpeedInVoxelsPerSecond, audioMaximumConcurrentVoices, audioPanDistanceInVoxels,
    lobbyMaximumPlayerCount, tankMovementSpeedInVoxelsPerSecond } from '../config.js';
import { SimulationEvent } from '../types.js';
import { Vector3 } from '../sim/math/vector3.js';
import { WeaponDefinition } from '../sim/weapon-types.js';
import { WeaponRuntime } from '../sim/weapon-runtime.js';
import { EffectProfile } from '../render/particle-emitter.js';
import { GapSoundIdentifier, GapSounds } from './gap-sounds.js';
import { soundCatalog } from './sound-catalog.js';

export class ArtilleryAudio {
    private readonly gaps: GapSounds;
    private readonly engine: AudioEngine;
    private readonly listener = { x: 0, y: 0, z: 0 };
    private readonly right = { x: 1, y: 0, z: 0 };
    private readonly previousPositions = new Map<number, Vector3>();
    private readonly playedProfiles = new Set<string>();
    private lastEventTick = -1;

    constructor(seed: number, private readonly effects: Readonly<Record<string, EffectProfile>>) {
        this.gaps = new GapSounds(seed);
        this.engine = new AudioEngine({
            resolvePath: identifier => {
                const path = soundCatalog[identifier as keyof typeof soundCatalog] ??
                    this.gaps.urls[identifier as GapSoundIdentifier];
                if (typeof path !== 'string') throw new Error(`Unknown Artillery sound: ${identifier}`);
                return path;
            },
            attenuationPerUnit: audioAttenuationPerVoxel, distanceMultiplier: 1,
            maximumShots: audioMaximumConcurrentVoices - lobbyMaximumPlayerCount,
            maximumLoops: lobbyMaximumPlayerCount, maximumDesiredLoops: audioMaximumConcurrentVoices,
            initialVolume: audioDefaultVolume,
            stereoPan: (position, listener) => ((position.x - listener.x) * this.right.x +
                (position.y - listener.y) * this.right.y + (position.z - listener.z) * this.right.z) /
                audioPanDistanceInVoxels
        });
    }

    setListener(position: Vector3, right: Vector3): void {
        Object.assign(this.listener, position);
        const length = Math.hypot(right.x, right.y, right.z);
        if (length > 0) {
            this.right.x = right.x / length; this.right.y = right.y / length; this.right.z = right.z / length;
        }
    }

    setVolume(volume: number): void {
        this.engine.setGlobalVolume(volume);
    }

    unlock(): void {
        this.engine.unlockLoops();
    }

    play(identifier: string, position?: Vector3): void {
        this.engine.sound(identifier, position, this.listener);
    }

    fire(weapon: WeaponDefinition, position: Vector3): void {
        this.play(weapon.fireSoundIdentifier ?? 'normalFire', position);
    }

    event(event: SimulationEvent): void {
        if (event.tick !== this.lastEventTick) {
            this.lastEventTick = event.tick; this.playedProfiles.clear();
        }
        if (event.type === 'bounce') this.play('bounce', event.position);
        else if (event.type === 'splash') this.play('splash', event.position);
        else if (event.type === 'teleport') this.play('materialise', event.position);
        if (event.type !== 'beam' && event.type !== 'explosion' && event.type !== 'effect') return;
        const identifier = event.effectProfileIdentifier ?? '';
        const key = `${event.serial}:${identifier}`;
        if (this.playedProfiles.has(key)) return;
        this.playedProfiles.add(key);
        let position = event.position;
        if (event.type === 'beam' && event.endpoint) {
            const squaredDistance = (point: Vector3): number => (point.x - this.listener.x) ** 2 +
                (point.y - this.listener.y) ** 2 + (point.z - this.listener.z) ** 2;
            if (squaredDistance(event.endpoint) < squaredDistance(position)) position = event.endpoint;
        }
        const sounds = this.effects[identifier]?.soundIdentifiers ?? [];
        for (const sound of sounds) this.play(sound, position);
        if (event.type === 'explosion' && !sounds.some(sound => sound.endsWith('Explosion')))
            this.play('smallExplosion', position);
    }

    update(runtime: WeaponRuntime, deltaSeconds: number): void {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error('Invalid audio delta');
        const requests: Array<LoopSound> = [];
        for (const tank of runtime.tanks) {
            let previous = this.previousPositions.get(tank.seatIndex);
            if (!previous) {
                previous = { ...tank.position }; this.previousPositions.set(tank.seatIndex, previous);
            }
            const speed = deltaSeconds > 0 ? Math.hypot(tank.position.x - previous.x,
                tank.position.z - previous.z) / deltaSeconds : 0;
            if (!tank.isWreck && tank.isGrounded && speed > audioEngineMinimumSpeedInVoxelsPerSecond) {
                const fraction = Math.min(1, speed / tankMovementSpeedInVoxelsPerSecond);
                requests.push({ key: `engine:${tank.seatIndex}`, name: 'engine', position: tank.position,
                    gain: fraction, rate: audioEngineMinimumRate +
                        (audioEngineMaximumRate - audioEngineMinimumRate) * fraction });
            }
            Object.assign(previous, tank.position);
        }
        for (const projectile of runtime.projectiles) {
            const profile = this.effects[projectile.definition.trailEffectIdentifier ?? ''];
            if (projectile.isAlive && profile?.loopSoundIdentifier)
                requests.push({ key: `projectile:${projectile.serial}`, name: profile.loopSoundIdentifier,
                    position: projectile.position, gain: 1, rate: 1 });
        }
        for (const deployable of runtime.deployables) {
            const profile = this.effects[deployable.definition.effectProfileIdentifier];
            if (deployable.isAlive && profile?.loopSoundIdentifier)
                requests.push({ key: `deployable:${deployable.serial}`, name: profile.loopSoundIdentifier,
                    position: deployable.context.position, gain: 1, rate: 1 });
        }
        let nearest = Infinity, burning: Vector3 | null = null;
        for (const cell of runtime.liquids.cells.values()) {
            if (cell.kind === 'oil') continue;
            const distance = Math.hypot(cell.x - this.listener.x, cell.y - this.listener.y, cell.z - this.listener.z);
            if (distance < nearest) {
                nearest = distance; burning = { x: cell.x, y: cell.y, z: cell.z };
            }
        }
        if (burning) requests.push({ key: 'burning', name: 'burning', position: burning, gain: 1, rate: 1 });
        this.engine.updateLoops(requests, this.listener, deltaSeconds);
    }

    stop(): void {
        this.engine.stopLoops(); this.previousPositions.clear(); this.playedProfiles.clear();
    }

    dispose(): void {
        this.stop(); this.engine.dispose(); this.gaps.dispose();
    }
}
