import { button, byId, el, money, panel } from './dom.js';
import type { GameDialog } from './dom.js';
import { timerBar } from './timer-bar.js';

export interface Fundraiser {
    target: number | null;
    pledges: Record<number, number>;
}

export interface FundraiserTimer {
    remaining: () => number;
    total: () => number;
}

const headlines = [
    'I\'m homeress pls help',
    'Don\'t let my empire end in bankruptcy',
    'I\'ll be sleeping in a box unless you help',
    'Please, I don\'t wanna die!',
    'Please help, I\'m homeless'
];
const threats = [
    'Let me live or I take you all down with me',
    'Save me or perish.'
];
const presets = [10, 25, 50, 100];

let active: { key: string; root: HTMLElement; update: (fund: Fundraiser) => void; stop: () => void } | null = null;
let dismissed = '';

const pick = (lines: Array<string>): string => lines[Math.floor(Math.random() * lines.length)];

function release(): void {
    active?.stop();
    active = null;
}

/** Whether the donation modal is currently on screen. */
export function fundraiserOpen(): boolean {
    return active !== null && byId('panel-content').contains(active.root);
}

export function closeFundraiser(): void {
    if (!active) return;
    const showing = byId('panel-content').contains(active.root);
    release();
    if (showing) byId<GameDialog>('panel').close();
}

byId<GameDialog>('panel').addEventListener('close', () => {
    if (active) dismissed = active.key;
    release();
});

/** Shows the donation modal for a campaign, or refreshes it if already open. */
export function showFundraiser(fund: Fundraiser, organizer: string, key: string, threatening: boolean,
    available: () => number, donate: (amount: number) => void, timer: FundraiserTimer, optOut: () => void): void {
    if (active && !byId('panel-content').contains(active.root)) {
        dismissed = active.key;
        release();
    }
    if (active?.key === key) {
        active.update(fund);
        return;
    }
    if (dismissed === key || available() < 1 || timer.remaining() <= 0) return;

    const root = el('div', '', 'fund');
    const bar = el('div', '', 'fund__bar');
    const fill = el('span');
    bar.append(fill);
    const raised = el('p', '', 'fund__raised');
    const donors = el('small', '', 'fund__donors');
    const chips = presets.map(amount => ({ amount, node: button(money(amount), () => select(amount)) }));
    const customChip = button('Custom amount', () => select('custom'));
    const custom = el('input', '', 'fund__custom');
    Object.assign(custom, { type: 'number', step: '1', min: '1', placeholder: 'Enter amount' });
    const error = el('small', '', 'fund__error');
    const pledge = el('button', '', 'fund__pledge');
    pledge.type = 'button';
    const decline = button('Not this time', () => {
        optOut();
        byId<GameDialog>('panel').close();
    });
    decline.className = 'fund__decline';
    const amounts = el('div', '', 'fund__amounts');
    amounts.append(...chips.map(chip => chip.node), customChip, custom, error);
    root.append(
        el('h3', pick(threatening ? threats : headlines), 'fund__headline'),
        el('p', `${organizer} is organizing this fundraiser to avoid bankruptcy`, 'fund__organizer'),
        bar, raised, donors, amounts, el('div', '', 'fund__actions'));
    root.lastElementChild?.append(decline, pledge);

    let selected: number | 'custom' = presets[0];
    let limit = 0;
    const chosen = () => Math.min(limit, Math.floor(selected === 'custom' ? custom.valueAsNumber : selected));
    const valid = () => limit >= 1 && chosen() >= 1;

    function select(value: number | 'custom'): void {
        selected = value;
        refresh();
        if (value === 'custom') custom.focus();
    }

    function refresh(): void {
        chips.forEach(chip => {
            chip.node.disabled = chip.amount > limit;
            chip.node.classList.toggle('selected', selected === chip.amount);
        });
        if (typeof selected === 'number' && selected > limit) {
            selected = chips.find(chip => chip.amount <= limit)?.amount ?? 'custom';
            refresh();
            return;
        }
        customChip.classList.toggle('selected', selected === 'custom');
        custom.disabled = selected !== 'custom';
        error.textContent = selected === 'custom' && custom.valueAsNumber > available()
            ? `You only have ${money(available())}` : '';
        custom.max = String(limit);
        pledge.disabled = !valid();
        pledge.textContent = valid() ? `Pledge ${money(chosen())}` : 'Pledge';
    }

    custom.addEventListener('input', refresh);
    custom.addEventListener('blur', () => {
        if (Number.isFinite(custom.valueAsNumber) && limit >= 1) custom.value = String(Math.max(1, chosen()));
        refresh();
    });
    pledge.addEventListener('click', () => {
        if (!valid()) return;
        const amount = chosen();
        byId<GameDialog>('panel').close();
        donate(amount);
    });

    const balance = el('strong', '', 'balance');
    const update = (next: Fundraiser): void => {
        balance.textContent = `Bal: ${money(available())}`;
        const pledged = Object.values(next.pledges).reduce((sum, amount) => sum + amount, 0);
        const count = Object.keys(next.pledges).length;
        limit = Math.max(0, next.target === null ? available() : Math.min(available(), next.target - pledged));
        bar.hidden = next.target === null;
        fill.style.width = `${next.target ? Math.min(100, pledged / next.target * 100) : 0}%`;
        raised.replaceChildren(el('strong', money(pledged)),
            document.createTextNode(next.target === null ? ' raised' : ` raised of ${money(next.target)} goal`));
        donors.textContent = `${count} ${count === 1 ? 'donation' : 'donations'}`;
        refresh();
    };

    const countdown = timerBar(timer.remaining, timer.total, left => {
        if (left <= 0) closeFundraiser();
    });
    update(fund);
    panel('GoFundMe', root);
    byId('panel-title').append(balance);
    byId('panel').prepend(countdown.node);
    active = { key, root, update, stop: () => {
        countdown.stop();
        countdown.node.remove();
    } };
}
