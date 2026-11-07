const TARGET_MS = 1000 / 60;
const SLOW_FRAME_MS = 18;
const WINDOW_SECONDS = 1;
const MIN_FRAMES = 12;
const WARMUP_SECONDS = 2;
const SLOW_FRACTION = 0.15;
const CLEAN_FRACTION = 0.02;
const MAX_STEP_DOWN = 0.8;
const STEP_UP = 0.05;
const PROBE_SECONDS = 5;
const PROBE_MAX_SECONDS = 80;

/** Trades render resolution for frame time to hold 60 fps, never exceeding the chosen quality's resolution */
export class AdaptiveResolution {
    private seconds = 0;
    private frames = 0;
    private slow = 0;
    private totalMs = 0;
    private clean = 0;
    private warmup = WARMUP_SECONDS;
    private probeDelay = PROBE_SECONDS;
    private fallback: number | undefined;
    constructor(public ratio: number, private min: number, private max: number) {}
    /** Ignores frames for a moment, such as while shaders compile for a new map */
    settle(): void {
        this.warmup = WARMUP_SECONDS;
        this.seconds = this.frames = this.slow = this.totalMs = 0;
    }
    /** Records a frame and returns the new resolution ratio if it changed */
    update(frameMs: number): number | undefined {
        if (this.warmup > 0) {
            this.warmup -= frameMs / 1000;
            return;
        }
        this.seconds += frameMs / 1000;
        this.frames++;
        this.totalMs += frameMs;
        if (frameMs > SLOW_FRAME_MS) this.slow++;
        if (this.seconds < WINDOW_SECONDS || this.frames < MIN_FRAMES) return;
        const slow = this.slow / this.frames, average = this.totalMs / this.frames, span = this.seconds;
        this.seconds = this.frames = this.slow = this.totalMs = 0;
        if (slow > SLOW_FRACTION) return this.lower(average);
        if (slow > CLEAN_FRACTION) {
            this.clean = 0;
            return;
        }
        this.clean += span;
        if (this.fallback !== undefined && this.clean >= PROBE_SECONDS) {
            this.fallback = undefined;
            this.probeDelay = PROBE_SECONDS;
        }
        if (this.clean >= this.probeDelay && this.ratio < this.max) return this.raise();
    }
    private lower(averageMs: number): number | undefined {
        this.clean = 0;
        if (this.fallback !== undefined) {
            this.ratio = this.fallback;
            this.fallback = undefined;
            this.probeDelay = Math.min(PROBE_MAX_SECONDS, this.probeDelay * 2);
            return this.ratio;
        }
        const next = Math.max(this.min, this.ratio * Math.max(MAX_STEP_DOWN, Math.sqrt(TARGET_MS / averageMs)));
        if (next >= this.ratio) return;
        this.ratio = next;
        return next;
    }
    private raise(): number {
        this.clean = 0;
        this.fallback = this.ratio;
        this.ratio = Math.min(this.max, Math.round((this.ratio + STEP_UP) * 100) / 100);
        return this.ratio;
    }
}
