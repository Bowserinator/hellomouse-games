import BufferLoader from './buffer-loader.js';

let context = typeof AudioContext !== 'undefined' ? new AudioContext() : null;
let buffers: Record<string, AudioBuffer> = {};

let preloadSrcs: Set<string> = new Set();
let preloadInterval = setInterval(() => {
    if (typeof AudioContext === 'undefined') {
        clearInterval(preloadInterval);
        return;
    }

    if (!context) context = new AudioContext();

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
    clearInterval(preloadInterval);
}, 50);

export function addSoundsToPreload(audioSrcs: Array<string>) {
    for (let src of audioSrcs)
        preloadSrcs.add(src);
}

async function playSoundRaw(buffer: AudioBuffer, volume = 1) {
    if (!context) return;
    const source = context.createBufferSource();
    const gainNode = context.createGain();
    source.buffer = buffer;
    source.connect(gainNode);
    gainNode.connect(context.destination);
    gainNode.gain.value = volume;
    source.start(0);
}

export async function playSound(src: string, volume = 1) {
    if (typeof AudioContext === 'undefined' || context === null) return;

    if (context.state === 'suspended') {
        try {
            await context.resume();
        } catch {
            return;
        }
    }

    const buffer = buffers[src];
    if (!buffer) {
        let bufferLoader = new BufferLoader(
            context, [src],
            (bufferArray: Array<AudioBuffer>) => {
                let buff = bufferArray[0];
                buffers[src] = buff;
                playSoundRaw(buff, volume);
            }
        );
        bufferLoader.load();
        return;
    }
    playSoundRaw(buffer, volume);
}
