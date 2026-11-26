export function fly(layer: HTMLElement, face: HTMLElement, from: DOMRect, to: DOMRect,
    duration: number, mode: 'one-way' | 'draw' | 'hold' | 'scan' = 'one-way', end = from, angle = 0,
    tilt: [number, number] = [0, 0]): void {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    face.classList.add('flight');
    Object.assign(face.style, {
        left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`
    });
    layer.append(face);
    const x = to.left - from.left + (to.width - from.width) / 2;
    const y = to.top - from.top + (to.height - from.height) / 2;
    const finish = `translate(${end.left - from.left}px, ${end.top - from.top}px)`;
    const center = `translate(${x}px, ${y}px)`;
    const travel = Math.min(0.4, 450 / duration);
    const move = { easing: 'ease-in-out' };
    const animation = face.animate(mode === 'draw' || mode === 'hold' ? [
        { transform: `translate(0, 0) rotateY(0deg) rotate(${tilt[0]}deg)`, ...move },
        { transform: `translate(${x}px, ${y}px) rotateY(180deg) rotate(0deg)`, offset: travel },
        { transform: `translate(${x}px, ${y}px) rotateY(180deg) rotate(0deg)`, offset: 1 - travel, ...move },
        { transform: `${finish} rotateY(${mode === 'hold' ? 180 : 360}deg) rotate(${tilt[1]}deg)` }
    ] : mode === 'scan' ? [
        { transform: `translate(0, 0) rotate(${angle}deg)`, ...move },
        { transform: `${center} rotate(${angle}deg)`, offset: 0.25 },
        { transform: `${center} rotate(${angle}deg)`, offset: 0.72, ...move },
        { transform: `${finish} rotate(${angle}deg)` }
    ] : [
        { transform: `translate(0, 0) rotate(${tilt[0]}deg)` },
        { transform: `translate(${x / 2}px, ${y / 2 - 40}px) scale(1.1) rotate(${(tilt[0] + tilt[1]) / 2}deg)` },
        { transform: `translate(${x}px, ${y}px) rotate(${tilt[1]}deg)`, opacity: 0.35 }
    ], { duration, easing: mode === 'one-way' ? 'ease-in-out' : 'linear' });
    void animation.finished.catch(() => undefined).finally(() => face.remove());
}
