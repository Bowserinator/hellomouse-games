export function updateCounter(node: HTMLElement, total: number, animate = true): void {
    const changed = node.textContent !== String(total);
    node.textContent = String(total);
    node.classList.toggle('warm', total >= 80 && total < 95);
    node.classList.toggle('danger', total >= 95);
    if (changed && animate && !matchMedia('(prefers-reduced-motion: reduce)').matches)
        node.animate([{ transform: 'rotateX(-65deg)', opacity: .3 }, { transform: 'rotateX(0)', opacity: 1 }],
            { duration: 300, easing: 'ease-out' });
}
