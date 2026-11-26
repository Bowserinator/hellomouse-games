import { button, byId, el, money } from './dom.js';
import { timerBar } from './timer-bar.js';

export interface AuctionView {
    bid: number;
    leader: string | null;
    history: Array<{ name: string; amount: number }>;
    limit: number;
    balance: number | null;
    abstained: boolean;
    hasBid: boolean;
}

export interface AuctionOptions {
    key: string;
    title: string;
    deed: HTMLElement;
    remaining: () => number;
    total: () => number;
    bid: (amount: number) => void;
    abstain: () => void;
}

const presets = [1, 5, 10, 50];
const BID_COOLDOWN_MS = 3000;

let active: { key: string; dock: HTMLElement; update: (auction: AuctionView) => void; stop: () => void } | null = null;

export function closeAuction(): void {
    if (!active) return;
    const { dock } = active;
    active.stop();
    active = null;
    dock.classList.add('away');
    setTimeout(() => dock.remove(), 400);
}

/** Shows the auction dock, or refreshes it if already shown. */
export function showAuction(options: AuctionOptions, auction: AuctionView): void {
    if (active?.key === options.key) {
        active.update(auction);
        return;
    }
    closeAuction();

    const topBid = el('p', '', 'auction__top');
    const leader = el('small', '', 'auction__leader');
    const history = el('ol', '', 'auction__history');
    const chips = presets.map(amount => ({ amount, node: button(`+${money(amount)}`, () => select(amount)) }));
    const customChip = button('Custom amount', () => select('custom'));
    const custom = el('input', '', 'fund__custom');
    Object.assign(custom, { type: 'number', step: '1', placeholder: 'Enter amount' });
    const error = el('small', '', 'fund__error');
    const amounts = el('div', '', 'fund__amounts');
    amounts.append(...chips.map(chip => chip.node), customChip, custom, error);
    const bid = el('button', '', 'auction__bid');
    bid.type = 'button';
    const abstain = el('button', 'Abstain', 'auction__abstain');
    abstain.type = 'button';

    const main = el('div', '', 'fund auction__main');
    const deed = el('div', '', 'auction__deed');
    deed.append(options.deed);
    main.append(deed, amounts);
    const side = el('div', '', 'auction__side');
    side.append(el('small', 'Highest bid', 'auction__label'), topBid, leader,
        history);
    const actions = el('div', '', 'auction__actions');
    actions.append(abstain, bid);
    const balance = el('strong', '', 'balance');
    const root = el('div', '', 'auction');
    const arrow = el('span', '▼', 'auction__arrow');
    const label = el('span');
    const handle = el('button', '', 'auction__handle');
    handle.type = 'button';
    handle.append(label, arrow);
    const dock = el('div', '', 'auction-dock away');
    dock.append(handle, root);
    const timer = timerBar(options.remaining, options.total, (left, urgent) => {
        label.textContent = `Auction (${Math.ceil(left / 1000)}s)`;
        dock.classList.toggle('urgent', urgent);
    });
    const title = el('h2', options.title, 'auction__title');
    title.append(balance);
    root.append(timer.node, title, main, side, actions);
    handle.addEventListener('click', () => {
        dock.classList.toggle('collapsed');
        arrow.textContent = dock.classList.contains('collapsed') ? '▲' : '▼';
    });

    let selected: number | 'custom' = presets[0];
    let cooldownUntil = 0;
    let cooldownTimer: ReturnType<typeof setInterval> | undefined;
    let current: AuctionView = auction;
    const minimum = () => current.bid + 1;
    const chosen = () => selected === 'custom' ? Math.floor(custom.valueAsNumber) : current.bid + selected;
    const valid = () => chosen() >= minimum() && chosen() <= current.limit;

    function select(value: number | 'custom'): void {
        selected = value;
        refresh();
        if (value === 'custom') custom.focus();
    }

    function refresh(): void {
        const bidder = current.limit >= minimum();
        amounts.hidden = !bidder;
        bid.hidden = !bidder;
        abstain.hidden = current.balance === null;
        abstain.disabled = current.abstained || current.hasBid;
        abstain.textContent = current.abstained ? 'Abstained' : 'Abstain';
        if (typeof selected === 'number' && current.bid + selected > current.limit)
            selected = chips.find(chip => current.bid + chip.amount <= current.limit)?.amount ?? 'custom';
        chips.forEach(chip => {
            chip.node.disabled = current.abstained || current.bid + chip.amount > current.limit;
            chip.node.classList.toggle('selected', selected === chip.amount);
        });
        customChip.disabled = current.abstained;
        customChip.classList.toggle('selected', selected === 'custom');
        custom.disabled = current.abstained || selected !== 'custom';
        custom.min = String(minimum());
        custom.max = String(current.limit);
        error.textContent = selected === 'custom' && custom.valueAsNumber > current.limit
            ? `You can bid up to ${money(current.limit)}` : '';
        const cooldown = Math.max(0, cooldownUntil - Date.now());
        bid.disabled = current.abstained || !valid() || cooldown > 0;
        bid.textContent = cooldown > 0 ? `Bid (${Math.ceil(cooldown / 1000)}s)`
            : !current.abstained && valid() ? `Bid ${money(chosen())}` : 'Bid';
    }

    const update = (next: AuctionView): void => {
        current = next;
        balance.hidden = next.balance === null;
        balance.textContent = `Bal: ${money(next.balance)}`;
        topBid.textContent = next.history.length ? money(next.bid) : '—';
        leader.textContent = next.leader ?? 'No bids yet';
        history.replaceChildren(...[...next.history].reverse().map(entry => {
            const row = el('li');
            row.append(el('strong', entry.name), document.createTextNode(' bid '),
                el('span', money(entry.amount), 'auction__money'));
            return row;
        }));
        refresh();
    };

    custom.addEventListener('input', refresh);
    abstain.addEventListener('click', () => options.abstain());
    bid.addEventListener('click', () => {
        if (!valid() || Date.now() < cooldownUntil) return;
        options.bid(chosen());
        cooldownUntil = Date.now() + BID_COOLDOWN_MS;
        clearInterval(cooldownTimer);
        cooldownTimer = setInterval(() => {
            if (Date.now() >= cooldownUntil) clearInterval(cooldownTimer);
            refresh();
        }, 100);
        refresh();
    });
    update(auction);
    byId('game').append(dock);
    void dock.offsetHeight;
    dock.classList.remove('away');
    active = { key: options.key, dock, update, stop: () => {
        timer.stop();
        clearInterval(cooldownTimer);
    } };
}
