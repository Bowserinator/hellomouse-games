export function tableGradient(svg: SVGSVGElement): void {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `<radialGradient id="hs-felt">
        <stop offset="0" style="stop-color: var(--felt-centre)"/>
        <stop offset="1" style="stop-color: var(--felt-edge)"/>
    </radialGradient>
    <linearGradient id="hs-rim" x2="1" y2="1">
        <stop offset="0" style="stop-color: var(--rim)"/>
        <stop offset="1" style="stop-color: var(--midnight-deep)"/>
    </linearGradient>`;
    svg.prepend(defs);
}
