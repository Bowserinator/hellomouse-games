/** Short warning beeps built with the Web Audio API. */

const BEEP_FREQUENCY = 880;
const BEEP_SECONDS = 0.12;
const BEEP_VOLUME = 0.12;

let context: AudioContext | null = null;

export function unlockAudio(): void {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
}

export function beep(): void {
    if (!context || context.state !== 'running') return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = BEEP_FREQUENCY;
    gain.gain.value = BEEP_VOLUME;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + BEEP_SECONDS);
}
