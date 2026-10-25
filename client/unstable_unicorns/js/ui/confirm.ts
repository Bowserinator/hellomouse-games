function element(tag: string, className: string, text?: string): HTMLElement {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export class ConfirmModal {
    private host: HTMLElement;
    private onConfirm: () => void;
    private question: string | null = null;

    constructor(host: HTMLElement, onConfirm: () => void) {
        this.host = host;
        this.onConfirm = onConfirm;
        host.addEventListener('click', event => this.onClick(event));
        document.addEventListener('keydown', event => this.onKey(event));
    }

    get isOpen(): boolean {
        return this.question !== null;
    }

    open(question: string): void {
        this.question = question;
        const overlay = this.host.closest<HTMLElement>('.modal-darken');
        if (overlay) overlay.style.display = 'block';
        this.draw();
    }

    close(): void {
        this.question = null;
        this.host.replaceChildren();
        const overlay = this.host.closest<HTMLElement>('.modal-darken');
        if (overlay) overlay.style.display = 'none';
    }

    private draw(): void {
        const question = this.question;
        if (question === null) return;
        this.host.replaceChildren();

        const header = element('header', 'prompt-header');
        header.append(element('h2', 'prompt-reason', question));
        this.host.append(header);

        const body = element('div', 'prompt-body prompt-body-confirm');
        const row = element('div', 'prompt-confirm-actions');
        row.append(this.button('Yes', 'yes'), this.button('Cancel', 'cancel'));
        body.append(row);
        this.host.append(body);
    }

    private button(label: string, step: string): HTMLButtonElement {
        const node = document.createElement('button');
        node.textContent = label;
        node.dataset.step = step;
        return node;
    }

    private onKey(event: KeyboardEvent): void {
        if (!this.question || event.key !== 'Escape') return;
        this.close();
    }

    private onClick(event: Event): void {
        if (this.question === null) return;
        const buttonNode = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-step]');
        if (!buttonNode) return;
        if (buttonNode.dataset.step !== 'yes') {
            this.close();
            return;
        }
        this.close();
        this.onConfirm();
    }
}
