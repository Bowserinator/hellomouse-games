import type { SimDriver } from '../../sim/driver.js';
import { timeline } from '../../sim/timeline.js';

export class TimelineHud {
    private clock = document.createElement('div');
    private editorToast?: HTMLElement;
    private displayed = '';
    constructor(private driver: SimDriver | undefined, host: HTMLElement) {
        this.clock.className = 'wave-clock';
        if (!driver || driver.core.nav.winTick !== undefined) host.append(this.clock);
        if (driver?.core.unlimitedEconomy && driver.core.nav.winTick !== undefined) {
            this.editorToast = document.createElement('div');
            this.editorToast.className = 'result-toast';
            this.editorToast.setAttribute('role', 'status');
            this.editorToast.hidden = true;
            host.append(this.editorToast);
        }
    }
    update(mockTick = 0, mockEnded = false) {
        const nav = this.driver?.core.nav;
        const winTick = this.driver ? nav?.winTick : 12000;
        if (winTick === undefined) return;
        const result = this.driver?.result;
        this.clock.hidden = !!result || mockEnded;
        if (result && this.editorToast?.hidden) {
            this.editorToast.textContent = result.outcome === 'victory' ? 'VICTORY' : 'DEFEAT';
            this.editorToast.hidden = false;
        }
        if (this.clock.hidden) return;
        const state = timeline(this.driver?.core.tick ?? mockTick, nav?.firstWaveTick ?? 1200, winTick);
        const hours = Math.floor(state.seconds / 3600), minutes = Math.floor(state.seconds / 60) % 60;
        const time = `${hours ? `${hours}:` : ''}${String(minutes).padStart(2, '0')}:${String(state.seconds % 60).padStart(2, '0')}`;
        const title = state.phase === 'prep' ? 'Waves start in' : 'Time remaining';
        const displayed = `${title}:${time}`;
        if (displayed !== this.displayed) {
            this.displayed = displayed;
            this.clock.replaceChildren(document.createTextNode(title), document.createElement('br'), time);
        }
    }
    destroy() {
        this.clock.remove(); this.editorToast?.remove();
    }
}
