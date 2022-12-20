// Cycle header colors
const CYCLE_RATES = [0.01, 0.015, 0.017];
const TITLES = [1, 2, 3].map(n => document.getElementById(`main-title-${n}`)) as Array<HTMLDivElement>;
let hues = [0, 0, 0];

setInterval(() => {
    for (let i = 0; i < TITLES.length; i++) {
        TITLES[i].style.backgroundColor = `hsl(${(hues[i] * 180 / Math.PI) % 360}deg 100% 50%)`;
        hues[i] += CYCLE_RATES[i];
    }
}, 50);
