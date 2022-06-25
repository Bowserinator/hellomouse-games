import GameState from '../tanks/gamestate.js';
import BufferLoader from './buffer-loader.js';
import Vector from '../tanks/vector2d.js';

const SOUND_DISTANCE_DECAY = 0.999; // Sound volume *= this ^ (distance to sound)

let globalVolume = 1;

/**
 * Set global volume level
 * @param val Value (0 = 0%, 1 = 100%, 2 = 200%) for global volume
 */
export function setGlobalVolume(val: number) {
    globalVolume = val;
}


let context = typeof AudioContext !== 'undefined' ? new AudioContext() : null;
let buffers: Record<string, AudioBuffer> = {};

let preloadSrcs: Set<string> = new Set();
let preloadAttemptCount = 0;
let preloadInterval = setInterval(() => {
    if (typeof AudioContext === 'undefined' || preloadAttemptCount > 10) {
        clearInterval(preloadInterval);
        return;
    }

    preloadAttemptCount++;
    if (!context) context = new AudioContext();
    if (!context) return;

    let audioSrcs = [...preloadSrcs];
    let bufferLoader = new BufferLoader(
        context, audioSrcs,
        (bufferArray: Array<AudioBuffer>) => {
            preloadSrcs.clear();
            for (let i = 0; i < audioSrcs.length; i++)
                buffers[audioSrcs[i]] = bufferArray[i];
        }
    );
    bufferLoader.load();
}, 50);


/**
 * Add resources to be preloaded when audio context is created
 * @param {Array<string>} audioSrcs Array of audio srcs to load
 */
export function addSoundsToPreload(audioSrcs: Array<string>) {
    for (let src of audioSrcs)
        preloadSrcs.add(src);
}

/**
 * Directly play a buffer without checking
 * @param buffer Buffer to play
 * @param volume Volume, 1 = 100%, 0 = mute
 * @param time Delay before playing
 */
async function playSoundRaw(buffer: AudioBuffer, volume = 1, time = 0) {
    if (!context) return;
    const source = context.createBufferSource();
    const gainNode = context.createGain();
    source.buffer = buffer;
    source.connect(gainNode);
    gainNode.connect(context.destination);
    gainNode.gain.value = volume * globalVolume;
    source.start(time);
}


/**
 * Play a sound, will try to load the sound if not pre-loaded
 * @param {string} src Src to audio file
 */
export async function playSound(src: string, volume = 1, time = 0) {
    if (typeof AudioContext === 'undefined' || context === null) return;
    if (!context) context = new AudioContext();
    if (!context) return;

    const buffer = buffers[src];
    if (!buffer) {
        let bufferLoader = new BufferLoader(
            context, [src],
            (bufferArray: Array<AudioBuffer>) => {
                let buff = bufferArray[0];
                buffers[src] = buff;
                playSoundRaw(buff, volume, time);
            }
        );
        bufferLoader.load();
        return;
    }
    if (!buffer) return;
    playSoundRaw(buffer, volume, time);
}


/**
 * Play a sound at a certain distance away from the player's tank
 * @param src Src to audio file
 * @param position Position to play sound at
 * @param gameState Gamestate
 * @param volume Volume to play sound at
 * @param time Delay before playing sound
 */
export async function playSoundAt(src: string, position: Vector, gameState: GameState, volume = 1, time = 0) {
    if (!gameState.isClientSide) return;

    const tankPos = gameState.tanks[gameState.tankIndex].position;
    const distance = tankPos.distance(position);
    volume *= Math.pow(SOUND_DISTANCE_DECAY, distance);
    playSound(src, volume, time);
}
