import { cardFace } from './card.js';

export const PREVIEW_SCALE = 1.8;

export class Preview {
    private host: HTMLElement;
    private node: HTMLElement;
    private face: HTMLElement | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private shownFor: string | null = null;

    constructor(host: HTMLElement) {
        this.host = host;
        this.node = document.createElement('div');
        this.node.className = 'preview';
        this.node.hidden = true;
        this.host.append(this.node);
    }

    show(defId: string, anchor: DOMRect): void {
        if (this.shownFor !== defId) {
            this.face?.remove();
            this.face = cardFace(defId);
            this.face.classList.add('preview-card');
            this.node.append(this.face);
            this.shownFor = defId;
        }
        this.node.hidden = false;
        this.place(anchor);
    }

    hide(): void {
        this.node.hidden = true;
    }

    hideSoon(): void {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.hide(), 120);
    }

    cancelHide(): void {
        if (this.timer === null) return;
        clearTimeout(this.timer);
        this.timer = null;
    }

    private place(anchor: DOMRect): void {
        const width = this.node.offsetWidth;
        const height = this.node.offsetHeight;
        const margin = 12;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        const spaceRight = viewportWidth - anchor.right;
        const left = spaceRight > width + margin
            ? anchor.right + margin : Math.max(margin, anchor.left - width - margin);
        const top = Math.min(
            Math.max(margin, anchor.top + anchor.height / 2 - height / 2),
            viewportHeight - height - margin
        );

        this.node.style.transform = `translate(${left.toFixed(0)}px, ${top.toFixed(0)}px)`;
        this.node.dataset.side = left >= anchor.right ? 'right' : 'left';
    }
}
