const SVG = 'http://www.w3.org/2000/svg';

function circle(className: string, radius: number, extra: Record<string, string> = {}): SVGCircleElement {
    const node = document.createElementNS(SVG, 'circle');
    node.setAttribute('class', className);
    node.setAttribute('r', radius.toFixed(2));
    for (const [name, value] of Object.entries(extra)) node.setAttribute(name, value);
    return node;
}

export function tableArtExtent(feltRadius: number): number {
    return feltRadius + feltRadius * 0.12 + 24;
}

export function tableArt(feltRadius: number): SVGSVGElement {
    const extent = tableArtExtent(feltRadius);
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'table-art');
    svg.setAttribute('viewBox', `${-extent} ${-extent} ${extent * 2} ${extent * 2}`);
    svg.append(
        circle('table-shadow', feltRadius, { transform: 'translate(10 14)' }),
        circle('table-rim', feltRadius),
        circle('table-felt', feltRadius * 0.95)
    );
    return svg;
}
