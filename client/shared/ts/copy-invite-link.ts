declare function copyToClipboard(text: string): boolean | string | null | undefined;

export async function copyInviteLink(
    container: HTMLElement, text: string, flashDurationInMilliseconds = 500
): Promise<void> {
    let copied = false;
    try {
        await navigator.clipboard.writeText(text);
        copied = true;
    } catch {
        try {
            const result = copyToClipboard(text);
            copied = result !== false && result !== undefined;
        } catch {
            copied = false;
        }
    }
    if (!copied) window.prompt('Copy invite link: Ctrl+C, Enter', text);
    container.classList.add('flash');
    setTimeout(() => container.classList.remove('flash'), flashDurationInMilliseconds);
}
