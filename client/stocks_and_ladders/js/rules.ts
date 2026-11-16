/** Rules dialog opened from the lobby and the match screen. */
import { el, setText } from '../../shared/ts/dom.js';
import type { NativeDialog } from '../../shared/ts/dom.js';
import type { StockMode } from './types.js';

const LOBBY_HELP: Record<StockMode, string> = {
    fixed: 'Five stocks, each with its own hidden personality. Every round, split your money across them, ' +
        'then watch the day play out. Prices carry over between rounds, so learn who is who.',
    dynamic: 'Five identical stocks. Every round, split your money across them. Each day closes by popularity: ' +
        'stocks with more than the average share of the money rise, the rest fall, and the total change is zero. ' +
        'Pick popular stocks, but not too popular.'
};

const STOCK_RULE: Record<StockMode, string> = {
    fixed: 'Each stock has a hidden personality, and tickers are random every match. One climbs slowly, ' +
        'one swings wildly, one moves in waves, one is calm until a sudden crash or spike, and one rises then falls. ' +
        'Watch the charts to work out who is who.',
    dynamic: 'All stocks behave the same, and tickers are random every match. Prices wander during the day, ' +
        'but the close depends on where everyone put their money. A stock with more than the average share ' +
        'of the money rises, one with less falls, and the total change across all money is zero. ' +
        'If everyone picks the same stock, nobody profits. Pick popular stocks, but not too popular.'
};

export function renderRules(mode: StockMode): void {
    setText('lobby-help', LOBBY_HELP[mode]);
    setText('rules-stocks', STOCK_RULE[mode]);
}

export function bindRules(): void {
    const dialog = el<NativeDialog>('rules-modal');
    for (const id of ['rules-open-lobby', 'rules-open-game']) el(id).onclick = () => dialog.showModal();
    el('rules-close').onclick = () => dialog.close();
}
