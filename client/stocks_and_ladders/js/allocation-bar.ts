/** Vertical bar whose draggable dividers split a balance across the stocks. */
import { GAME_CONFIG, STOCK_COLORS } from './config.js';
import { evenAllocation } from './engine.js';
import { formatMoney } from './format.js';

const KEY_STEP = 1;
const LARGE_KEY_STEP = 5;
const MINIMUM_LABEL_SHARE = 8;
const NOT_DRAGGING = -1;

function createElement<K extends keyof HTMLElementTagNameMap>(
    tag: K, className: string, parent: HTMLElement
): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    element.className = className;
    parent.appendChild(element);
    return element;
}

export class AllocationBar {
    private allocation = evenAllocation();
    private tickers: Array<string> = [];
    private balance = 0;
    private locked = false;
    private dragging = NOT_DRAGGING;
    private segments: Array<HTMLElement> = [];
    private handles: Array<HTMLButtonElement> = [];

    constructor(
        private container: HTMLElement,
        private onChange: (allocation: Array<number>, final: boolean) => void
    ) {
        const track = createElement('div', 'segments', container);
        for (let stock = 0; stock < GAME_CONFIG.stockCount; stock++) {
            const segment = createElement('div', 'segment', track);
            segment.style.background = STOCK_COLORS[stock];
            for (const part of ['ticker', 'share', 'amount']) createElement('span', `segment-${part}`, segment);
            this.segments.push(segment);
        }
        for (let divider = 0; divider < GAME_CONFIG.stockCount - 1; divider++) {
            const handle = createElement('button', 'divider', container);
            handle.type = 'button';
            handle.setAttribute('role', 'slider');
            handle.setAttribute('aria-orientation', 'vertical');
            handle.setAttribute('aria-valuemin', '0');
            handle.setAttribute('aria-valuemax', String(GAME_CONFIG.percentTotal));
            handle.setAttribute('aria-label', `Divider ${divider + 1}`);
            this.bindHandle(handle, divider);
            this.handles.push(handle);
        }
        this.render();
    }

    setAllocation(allocation: Array<number>): void {
        this.allocation = [...allocation];
        this.render();
    }

    getAllocation(): Array<number> {
        return [...this.allocation];
    }

    setTickers(tickers: Array<string>): void {
        this.tickers = tickers;
        this.render();
    }

    setBalance(balance: number): void {
        this.balance = balance;
        this.render();
    }

    setLocked(locked: boolean): void {
        this.locked = locked;
        this.render();
    }

    private edges(): Array<number> {
        const edges = [0];
        for (const share of this.allocation) edges.push(edges[edges.length - 1] + share);
        return edges;
    }

    private moveDivider(divider: number, percent: number): void {
        const edges = this.edges();
        edges[divider + 1] = Math.min(edges[divider + 2], Math.max(edges[divider], percent));
        this.allocation = this.allocation.map((_, stock) => edges[stock + 1] - edges[stock]);
        this.render();
    }

    private bindHandle(handle: HTMLButtonElement, divider: number): void {
        handle.onpointerdown = event => {
            if (this.locked) return;
            event.preventDefault();
            handle.setPointerCapture(event.pointerId);
            this.dragging = divider;
        };
        handle.onpointermove = event => {
            if (this.dragging !== divider) return;
            const rect = this.container.getBoundingClientRect();
            this.moveDivider(divider, Math.round((event.clientY - rect.top) / rect.height * GAME_CONFIG.percentTotal));
            this.onChange(this.allocation, false);
        };
        handle.onpointerup = handle.onpointercancel = () => {
            if (this.dragging !== divider) return;
            this.dragging = NOT_DRAGGING;
            this.onChange(this.allocation, true);
        };
        handle.onkeydown = event => {
            const step = event.shiftKey ? LARGE_KEY_STEP : KEY_STEP;
            const direction = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1
                : ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : 0;
            if (this.locked || direction === 0) return;
            event.preventDefault();
            this.moveDivider(divider, this.edges()[divider + 1] + direction * step);
            this.onChange(this.allocation, true);
        };
    }

    private render(): void {
        const edges = this.edges();
        this.container.classList.toggle('locked', this.locked);
        this.segments.forEach((segment, stock) => {
            const share = this.allocation[stock];
            segment.style.top = `${edges[stock]}%`;
            segment.style.height = `${share}%`;
            segment.classList.toggle('compact', share < MINIMUM_LABEL_SHARE);
            const [ticker, percent, amount] = Array.from(segment.children);
            ticker.textContent = this.tickers[stock] ?? '';
            percent.textContent = `${share}%`;
            amount.textContent = formatMoney(this.balance * share / GAME_CONFIG.percentTotal);
        });
        this.handles.forEach((handle, divider) => {
            handle.style.top = `${edges[divider + 1]}%`;
            handle.setAttribute('aria-valuenow', String(edges[divider + 1]));
            handle.setAttribute('aria-disabled', String(this.locked));
        });
    }
}
