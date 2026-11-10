function element(tag: string, className: string, text?: string): HTMLElement {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export interface Notice {
    text: string;
    source?: string;
}

export class NoticeModal {
    private host: HTMLElement;
    private queue: Array<Notice> = [];

    constructor(host: HTMLElement) {
        this.host = host;
        host.addEventListener('click', event => this.onClick(event));
        document.addEventListener('keydown', event => this.onKey(event), true);
    }

    get isOpen(): boolean {
        return this.queue.length > 0;
    }

    open(notice: Notice): void {
        this.queue.push(notice);
        if (this.queue.length === 1) this.draw();
    }

    close(): void {
        this.queue = [];
        this.hide();
    }

    private hide(): void {
        this.host.replaceChildren();
        const overlay = this.host.closest<HTMLElement>('.modal-darken');
        if (overlay) overlay.style.display = 'none';
    }

    private draw(): void {
        const notice = this.queue[0];
        if (!notice) return;
        this.host.replaceChildren();
        const overlay = this.host.closest<HTMLElement>('.modal-darken');
        if (overlay) overlay.style.display = 'block';

        const header = element('header', 'prompt-header');
        header.append(element('h2', 'prompt-reason', notice.text));
        if (notice.source) header.append(element('span', 'prompt-source', notice.source));
        this.host.append(header);

        const body = element('div', 'prompt-body prompt-body-confirm');
        const row = element('div', 'prompt-choice-actions');
        const ok = document.createElement('button');
        ok.textContent = 'OK';
        ok.dataset.step = 'ok';
        row.append(ok);
        body.append(row);
        this.host.append(body);
        ok.focus();
    }

    private dismiss(): void {
        this.queue.shift();
        if (this.queue.length > 0) this.draw();
        else this.hide();
    }

    private onKey(event: KeyboardEvent): void {
        if (this.queue.length === 0 || (event.key !== 'Escape' && event.key !== 'Enter')) return;
        event.preventDefault();
        event.stopPropagation();
        this.dismiss();
    }

    private onClick(event: Event): void {
        if (!(event.target as HTMLElement | null)?.closest('button[data-step="ok"]')) return;
        this.dismiss();
    }
}
