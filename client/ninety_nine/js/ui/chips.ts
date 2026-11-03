export function chips(count: number): HTMLElement {
    const holder = document.createElement('span');
    holder.className = 'chips';
    holder.setAttribute('aria-label', `${count} tokens`);
    for (let i = 0; i < count; i++) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.setAttribute('aria-hidden', 'true');
        holder.append(chip);
    }
    holder.append(document.createTextNode(` ${count}`));
    return holder;
}
