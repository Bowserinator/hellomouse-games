export const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

export interface NativeDialog extends HTMLDialogElement {
    open: boolean;
    showModal(): void;
    close(): void;
}

export function setNodeText(node: HTMLElement, text: string): void {
    if (node.textContent !== text) node.textContent = text;
}

export function setText(id: string, text: string): void {
    setNodeText(el(id), text);
}
