import type { View } from '../types.js';
import { label } from './card-element.js';

export function splash(previous: View | null, view: View): void {
    let words: [string, string] | null = null;
    if (previous && previous.round === view.round && previous.revolution !== view.revolution)
        words = view.revolution ? ['革命', 'REVOLUTION'] : ['革命返し', 'COUNTER-REVOLUTION'];
    else if (view.bankrupt !== null && previous?.bankrupt !== view.bankrupt) words = ['都落ち', 'BANKRUPTCY'];
    else if (!previous || previous.round !== view.round) words = [`第${view.round}回`, `ROUND ${view.round}`];
    else if (previous.phase !== view.phase && ['roundEnd', 'gameEnd'].includes(view.phase))
        words = ['決着', 'ROUND COMPLETE'];
    const target = document.getElementById('fx');
    if (!target || !words || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const bannerLabel = label(...words);
    target.replaceChildren(bannerLabel);
    const bankruptcy = words[1] === 'BANKRUPTCY';
    target.style.clipPath = bankruptcy ? 'polygon(0 0,38% 15%,43% 0,65% 20%,100% 0,95% 100%,56% 80%,50% 100%,0 85%)' : '';
    if (words[1].includes('REVOLUTION')) document.getElementById('table-viewport')?.animate([
        { transform: 'translateX(0)' }, { transform: 'translateX(-8px)' },
        { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }
    ], { duration: 240, iterations: 2 });
    target.animate([{ visibility: 'visible', transform: 'rotate(-8deg)' },
        { visibility: 'visible', transform: 'rotate(-8deg)' }], { duration: 1000 });
    bannerLabel.animate([{ transform: 'translateX(-120vw)' },
        { transform: 'translateX(0)', offset: .2 },
        { transform: 'translateX(0)', offset: .75 },
        { transform: 'translateX(120vw)' }], { duration: 1000 });
}
