import type { SimDriver } from '../../sim/driver.js';

export class SimulationControls {
    private button = document.createElement('button');
    private icon = document.createElement('span');
    private shade = document.createElement('div');
    private timer?: ReturnType<typeof setInterval>;
    private mockPaused = false;
    constructor(private driver: SimDriver | undefined, host: HTMLElement) {
        this.button.type = 'button'; this.button.className = 'simulation-pause';
        this.icon.className = 'material-icons'; this.icon.setAttribute('aria-hidden', 'true');
        this.shade.style.cssText = 'position:absolute;inset:0;background:rgb(0 0 0 / 5%);pointer-events:none;z-index:1';
        this.button.append(this.icon); host.append(this.shade, this.button);
        this.button.onclick = () => {
            if (driver) driver.requestPause();
            else {
                this.mockPaused = !this.mockPaused;
                this.refresh();
            }
        };
        if (driver) {
            driver.onPauseChange = () => this.refresh();
            this.timer = setInterval(() => this.refresh(), 1000);
        }
        this.refresh();
    }
    private refresh() {
        const paused = this.driver?.isPaused ?? this.mockPaused;
        this.shade.hidden = !paused;
        this.icon.textContent = paused ? 'play_arrow' : 'pause';
        const remaining = paused ? 0 : Math.ceil((this.driver?.pauseCooldownRemaining ?? 0) / 1000);
        this.button.title = paused ? 'Resume simulation' : remaining
            ? `Pausing is limited to once every 30 s. Available in ${remaining} s.` : 'Pause simulation';
        this.button.setAttribute('aria-disabled', String(remaining > 0 || !!this.driver?.result ||
            !!this.driver?.core.lockstep.frozen));
        if (this.driver?.core.lockstep.frozen) this.button.title = 'Simulation stopped: desync';
        this.button.setAttribute('aria-label', this.button.title);
        this.button.setAttribute('aria-pressed', String(paused));
    }
    destroy() {
        clearInterval(this.timer);
        if (this.driver) this.driver.onPauseChange = undefined;
        this.shade.remove();
        this.button.remove();
    }
}
