import { COLORS_MAP } from './data.js';

/**
 * Hex to HSL
 * @param hex Hex string as #RRGGBB
 * @return [h, s, l]
 */
export function hexToHSL(hex: string): [number, number, number] {
    let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return [0, 0, 0];

    let r = parseInt(result[1], 16);
    let g = parseInt(result[2], 16);
    let b = parseInt(result[3], 16);
    r /= 255, g /= 255, b /= 255;

    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min)
        h = s = 0; // achromatic
    else {
        let d = max - min;
        h = 0;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [h, s, l];
}

const palette = document.getElementById('palette') as HTMLDivElement;

const hslMap = {};
let colors = Object.keys(COLORS_MAP);
for (let color of colors)
    // @ts-expect-error
    hslMap[color] = hexToHSL(color);

// @ts-expect-error
document.getElementById('color-count').innerText = colors.length + ' unique colors';

const JUMP_RANGE = 0.5;
let satStart = 0;

while (satStart <= 1) {
    let group = '';

    // @ts-expect-error
    const FILTERED = colors.filter(c => hslMap[c][1] >= satStart && hslMap[c][1] < satStart + JUMP_RANGE);
    let lightStart = 0;
    while (lightStart <= 1) {
        let row = '';
        // @ts-expect-error
        for (let color of FILTERED.filter(c => hslMap[c][2] >= lightStart && hslMap[c][2] < lightStart + JUMP_RANGE)
            // @ts-expect-error
            .sort((a, b) => hslMap[a][0] - hslMap[b][0]))
            // @ts-expect-error
            row += `<div class="palette"style="color: ${hslMap[color][2] > 0.6 ? 'black' : 'white'}; background-color: ${color}">${COLORS_MAP[color].length}</div>`;
        lightStart += JUMP_RANGE;
        group += `${row}<br>`;
    }
    palette.innerHTML += group;
    satStart += JUMP_RANGE;
}
