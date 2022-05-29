/**
 * Given an array of colors + percentage it occurs at, linearly interpolate
 * a gradient color
 * @param {Array<[[number, number, number], number]>} colors Array of RBG colors + percentage, ie
 *      a gradient from red (0%) -> blue (at 50%) -> green (at 100%) would be:
 *      [[[255, 0, 0], 0], [[0, 0, 255], 0.5], [[0, 255, 0], 1]]
 *      First color must have percentage = 0, last = 1 otherwise it might break
 * @param {number} percent Percentage in the gradient
 * @return {string} Valid color str, or "white" if colors arr is invalid
 */
export default function gradient(colors: Array<[[number, number, number], number]>, percent: number) {
    for (let i = 0; i < colors.length - 1; i++)
        if (percent >= colors[i][1] && percent <= colors[i + 1][1]) {
            let percentageIn = (percent - colors[i][1]) / (colors[i + 1][1] - colors[i][1]);
            let c1 = colors[i][0];
            let c2 = colors[i + 1][0];
            let r = c1[0] + (c2[0] - c1[0]) * percentageIn;
            let g = c1[1] + (c2[1] - c1[1]) * percentageIn;
            let b = c1[2] + (c2[2] - c1[2]) * percentageIn;

            let normalize = (color: number) => Math.max(0, Math.min(255, Math.round(color)));
            r = normalize(r);
            g = normalize(g);
            b = normalize(b);

            return `rgb(${r}, ${g}, ${b})`;
        }
    return 'white';
}
