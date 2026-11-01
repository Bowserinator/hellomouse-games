const SVG = 'http://www.w3.org/2000/svg';

function seeded(seed: number): () => number {
    let value = seed >>> 0;
    return () => {
        value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
        return value / 0x100000000;
    };
}

function ringPath(radius: number, count: number, jitter: number, rng: () => number): string {
    const parts: Array<string> = [];
    for (let index = 0; index < count; index++) {
        const angle = (2 * Math.PI * index) / count + Math.PI / count;
        const wobble = 1 + (rng() - 0.5) * jitter;
        const x = Math.sin(angle) * radius * wobble;
        const y = Math.cos(angle) * radius * wobble;
        parts.push(`${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`);
    }
    parts.push('Z');
    return parts.join(' ');
}

function path(className: string, data: string, extra: Record<string, string> = {}): SVGPathElement {
    const node = document.createElementNS(SVG, 'path');
    node.setAttribute('class', className);
    node.setAttribute('d', data);
    for (const [name, value] of Object.entries(extra)) node.setAttribute(name, value);
    return node;
}

export function tableArtExtent(feltRadius: number): number {
    return feltRadius + feltRadius * 0.12 + 24;
}

export function tableArt(count: number, feltRadius: number): SVGSVGElement {
    const rng = seeded(count * 7919 + 13);
    const outline = rng();
    const extent = tableArtExtent(feltRadius);
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'table-art');
    svg.setAttribute('viewBox', `${-extent} ${-extent} ${extent * 2} ${extent * 2}`);

    const rim = ringPath(feltRadius, count, 0.05, () => outline);
    const felt = ringPath(feltRadius * 0.95, count, 0.05, () => outline);

    svg.append(
        path('table-shadow', rim, { transform: 'translate(10 14)' }),
        path('table-rim', rim),
        path('table-felt', felt)
    );
    return svg;
}
