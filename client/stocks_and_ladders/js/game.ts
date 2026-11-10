/** Page logic for Stocks and Ladders: server connection, state syncing and the render loop. */
import { connectToGame } from '../../shared/ts/game-connection.js';
import type { GameConnection } from '../../shared/ts/game-connection.js';
import { el, setNodeText, setText } from '../../shared/ts/dom.js';
import { AllocationBar } from './allocation-bar.js';
import { dayWidth, drawChart, followScroll } from './chart.js';
import { GAME_CONFIG, STOCK_COLORS } from './config.js';
import { formatChange, formatClock, formatMoney, formatPrice, formatWhole } from './format.js';
import { Lobby } from './lobby.js';
import { Results } from './results.js';
import { bindRules } from './rules.js';
import { valueAt } from './series.js';
import { beep, unlockAudio } from './sound.js';
import type { Move, Sync, View } from './types.js';

interface Live {
    view: View;
    names: Array<string>;
    seat: number;
    visible: number;
    remaining: number;
    planningMilliseconds: number;
}

interface Snapshot {
    prices: Array<number>;
    priceChange: Array<number>;
    money: Array<number>;
    ranking: Array<number>;
}

const NOTICE_MILLISECONDS = 5000;
const PING_INTERVAL_MILLISECONDS = 5000;
const DRAFT_INTERVAL_MILLISECONDS = 150;
const PANEL_INTERVAL_MILLISECONDS = 100;
const MILLISECONDS_PER_SECOND = 1000;
const NEW_ROUND = -1;
const NO_BEEP = -1;
const SCROLL_FOLLOW_TOLERANCE = 2;

let sync: Sync | null = null;
let receivedAt = 0;
let adoptedRound = NEW_ROUND;
let draftSentAt = 0;
let lastPanelsAt = 0;
let lastBeepSecond = NO_BEEP;
let tabsKey = '';
let resultsShown = false;
let restoreName = true;
let noticeTimer = 0;
let dirty = true;
let following = true;
let followTarget = 0;
let spacerWidth = 0;
let connection: GameConnection;

const chart = el<HTMLCanvasElement>('chart');
const scroller = el('chart-scroll');
const spacer = el('chart-spacer');
const tickerRows = Array.from(document.querySelectorAll<HTMLElement>('.ticker li')).map(row => ({
    time: row.querySelector('.time') as HTMLElement,
    text: row.querySelector('.text') as HTMLElement
}));

function notify(text: string): void {
    el('notice').textContent = text;
    el('notice').hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => {
        el('notice').hidden = true;
    }, NOTICE_MILLISECONDS);
}

function send(message: Record<string, unknown>): void {
    if (!connection.send(message)) notify('Connection lost.');
}

function move(message: Move): void {
    send({ type: 'MOVE', ...message });
}

const lobby = new Lobby(send);
const results = new Results(move);
const bar = new AllocationBar(el('allocation-bar'), (allocation, final) => {
    const now = performance.now();
    if (!final && now - draftSentAt < DRAFT_INTERVAL_MILLISECONDS) return;
    draftSentAt = now;
    move({ action: 'SET_ALLOCATION', allocation });
});

function live(): Live | null {
    const view = sync?.view;
    if (!sync || !view) return null;
    const sinceSync = performance.now() - receivedAt;
    const progress = Math.min(1, (sync.elapsedMilliseconds + sinceSync) / GAME_CONFIG.animationMilliseconds);
    const round = view.phase === 'settling' ? view.completedRounds - 1 + progress : view.completedRounds;
    return {
        view,
        names: sync.seats.map(seat => seat.username),
        seat: sync.youAre,
        visible: round * GAME_CONFIG.ticksPerRound,
        remaining: sync.remainingMilliseconds - sinceSync,
        planningMilliseconds: sync.settings.timerSeconds * MILLISECONDS_PER_SECOND
    };
}

function currentDay(model: Live): number {
    return Math.max(1, Math.ceil(model.visible / GAME_CONFIG.ticksPerRound));
}

function snapshot(model: Live): Snapshot {
    const { view, visible } = model;
    const reference = Math.max(0, view.completedRounds - 1) * GAME_CONFIG.ticksPerRound;
    const prices = view.prices.map(values => valueAt(values, visible));
    const money = view.worth.map(values => valueAt(values, visible));
    return {
        prices,
        priceChange: prices.map((price, stock) => price / view.prices[stock][reference] - 1),
        money,
        ranking: money.map((_, seat) => seat).sort((a, b) => money[b] - money[a] || a - b)
    };
}

function tableRow(color: string, cells: Array<string>, change: number): HTMLLIElement {
    const item = document.createElement('li');
    item.style.setProperty('--chip-color', color);
    item.append(...cells.map(text => {
        const span = document.createElement('span');
        span.textContent = text;
        return span;
    }));
    (item.lastElementChild as HTMLElement).className = change >= 0 ? 'up' : 'down';
    return item;
}

function renderControls(model: Live): void {
    const { view, remaining, planningMilliseconds } = model;
    const planning = view.phase === 'planning';
    const lockIn = el<HTMLButtonElement>('lock-in');
    setText('day-label', view.phase === 'finished' ? 'FINAL RESULTS' : `DAY ${view.round} OF ${view.rounds}`);
    setText('clock', planning ? formatClock(remaining) : '');
    el('timer-fill').style.width = planning ? `${Math.max(0, Math.min(1, remaining / planningMilliseconds)) * 100}%` : '0';
    lockIn.hidden = view.phase === 'finished';
    lockIn.disabled = !planning;
    lockIn.classList.toggle('submitted', view.submitted);
    setNodeText(lockIn, view.submitted ? 'Unready' : 'Ready');
    el('show-results').hidden = view.phase !== 'finished';
}

function renderQuote(model: Live, state: Snapshot): void {
    const { view, names, seat, visible } = model;
    const worth = view.worth[seat];
    const value = state.money[seat];
    const change = value / GAME_CONFIG.startingMoney - 1;
    const reached = worth.slice(0, Math.floor(visible) + 1);
    el('quote').classList.toggle('down', change < 0);
    setText('quote-name', `${names[seat].toUpperCase()} US`);
    setText('quote-arrow', change < 0 ? '↓' : '↑');
    setText('quote-value', formatWhole(value));
    setText('quote-change', formatChange(change));
    setText('quote-rank', `${state.ranking.indexOf(seat) + 1}/${view.players.length}`);
    setText('quote-open', formatWhole(worth[(view.round - 1) * GAME_CONFIG.ticksPerRound]));
    setText('quote-high', formatWhole(Math.max(value, ...reached)));
    setText('quote-low', formatWhole(Math.min(value, ...reached)));
    setText('quote-day', `${view.round}/${view.rounds}`);
    setText('balance', formatMoney(value));
}

function renderTables(model: Live, state: Snapshot): void {
    const { view, names, seat } = model;
    el('stocks').replaceChildren(...view.tickers.map((ticker, stock) => tableRow(
        STOCK_COLORS[stock],
        [ticker, formatPrice(state.prices[stock]), formatChange(state.priceChange[stock])],
        state.priceChange[stock]
    )));
    el('scores').replaceChildren(...state.ranking.map((index, place) => {
        const change = state.money[index] / GAME_CONFIG.startingMoney - 1;
        const mark = view.phase === 'planning' && view.players[index].submitted ? ' ✓' : '';
        const item = tableRow(
            view.players[index].color,
            [`${place + 1}) ${names[index]}${mark}`, formatWhole(state.money[index]), formatChange(change)],
            change
        );
        item.classList.toggle('you', index === seat);
        return item;
    }));
}

function renderTicker(model: Live, state: Snapshot): void {
    const { view, names, remaining } = model;
    const day = `D${String(currentDay(model)).padStart(2, '0')}`;
    const best = state.priceChange.indexOf(Math.max(...state.priceChange));
    const worst = state.priceChange.indexOf(Math.min(...state.priceChange));
    const leader = names[state.ranking[0]];
    const ready = view.players.filter(player => player.submitted).length;
    const status = view.phase === 'planning'
        ? `ORDER BOOK OPEN: ${ready}/${view.players.length} READY, ${formatClock(remaining)}S TO CLOSE`
        : view.phase === 'settling' ? `MARKET CLOSING: SETTLING DAY ${view.round} POSITIONS`
            : `MATCH COMPLETE: ${leader} TAKES THE TITLE`;
    const lines = [
        view.completedRounds === 0
            ? `MARKET OPENS: FIVE STOCKS LISTED AT ${formatPrice(GAME_CONFIG.startingPrice)}`
            : `BIGGEST MOVERS: ${view.tickers[best]} ${formatChange(state.priceChange[best])}, ` +
                `${view.tickers[worst]} ${formatChange(state.priceChange[worst])}`,
        `${leader} LEADS THE FIELD AT ${formatMoney(state.money[state.ranking[0]])}`,
        status
    ];
    tickerRows.forEach((row, index) => {
        setNodeText(row.time, day);
        setNodeText(row.text, lines[index].toUpperCase());
    });
}

function renderTabs(model: Live): void {
    const days = currentDay(model);
    const firstDay = Math.round(scroller.scrollLeft / dayWidth(chart.clientWidth)) + 1;
    const key = `${days}:${firstDay}`;
    if (key === tabsKey) return;
    tabsKey = key;
    el('day-tabs').replaceChildren(...Array.from({ length: days }, (_, index) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.textContent = `Day ${index + 1}`;
        tab.setAttribute('aria-selected', String(index + 1 >= firstDay && index + 1 < firstDay + GAME_CONFIG.visibleDays));
        tab.onclick = () => {
            if (live()?.view.phase !== 'settling') scroller.scrollLeft = index * dayWidth(chart.clientWidth);
        };
        return tab;
    }));
}

function renderBar(model: Live): void {
    const { view, seat } = model;
    bar.setBalance(view.worth[seat][(view.round - 1) * GAME_CONFIG.ticksPerRound]);
    bar.setLocked(view.phase !== 'planning' || view.submitted);
}

function warnTimeLow(model: Live): void {
    const secondsLeft = Math.ceil(model.remaining / MILLISECONDS_PER_SECOND);
    const warning = model.view.phase === 'planning' && !model.view.submitted &&
        secondsLeft >= 1 && secondsLeft <= GAME_CONFIG.warningSeconds;
    if (!warning) lastBeepSecond = NO_BEEP;
    else if (secondsLeft !== lastBeepSecond) {
        lastBeepSecond = secondsLeft;
        beep();
    }
}

function syncScroll(model: Live, animating: boolean): void {
    if (animating) following = true;
    scroller.classList.toggle('animating', animating);
    followTarget = followScroll(chart.clientWidth, model.visible);
    const needed = Math.round(chart.clientWidth + followTarget);
    if (needed !== spacerWidth) {
        spacerWidth = needed;
        spacer.style.width = `${needed}px`;
    }
    if (following && Math.abs(scroller.scrollLeft - followTarget) > 0.5) scroller.scrollLeft = followTarget;
}

function frame(): void {
    requestAnimationFrame(frame);
    const model = live();
    if (!model) return;
    const now = performance.now();
    const animating = model.view.phase === 'settling';
    warnTimeLow(model);
    syncScroll(model, animating);
    if (dirty || now - lastPanelsAt >= PANEL_INTERVAL_MILLISECONDS) {
        lastPanelsAt = now;
        const state = snapshot(model);
        renderControls(model);
        renderQuote(model, state);
        renderTables(model, state);
        renderTicker(model, state);
        renderTabs(model);
    }
    if (dirty || animating)
        drawChart(chart, {
            prices: model.view.prices,
            worth: model.view.worth,
            tickers: model.view.tickers,
            names: model.names,
            playerColors: model.view.players.map(player => player.color),
            youSeat: model.seat,
            visible: model.visible,
            scrollLeft: scroller.scrollLeft
        });
    dirty = false;
}

function onSync(next: Sync): void {
    sync = next;
    receivedAt = performance.now();
    dirty = true;
    if (restoreName && next.youAre >= 0) {
        restoreName = false;
        const username = localStorage.getItem('username');
        if (username && username !== next.seats[next.youAre].username) send({ type: 'USERNAME', username });
    }
    const view = next.view;
    const playing = next.started && view !== undefined;
    el('lobby').hidden = playing;
    el('game').hidden = !playing;
    if (!playing) {
        lobby.render(next);
        adoptedRound = NEW_ROUND;
        resultsShown = false;
        tabsKey = '';
        results.close();
        return;
    }
    setText('match-name', `Stocks and Ladders · ${next.seats.length} players`);
    setText('match-rounds', String(next.settings.rounds));
    setText('match-timer', `${next.settings.timerSeconds}s`);
    if (view.phase === 'planning' && view.round !== adoptedRound) {
        adoptedRound = view.round;
        bar.setAllocation(view.allocation);
    }
    if (view.phase !== 'planning') bar.setAllocation(view.allocation);
    bar.setTickers(view.tickers);
    renderBar(live() as Live);
    results.update(next);
    if (view.phase === 'finished' && !resultsShown) {
        resultsShown = true;
        results.show(next);
    }
}

connection = connectToGame({
    gameType: 'stocks_and_ladders',
    pingIntervalInMilliseconds: PING_INTERVAL_MILLISECONDS,
    disconnectBanner: el('disconnect-banner'),
    onMessage: message => {
        if (message.type === 'UUID') el<HTMLInputElement>('invite').value = location.href;
        else if (message.type === 'SYNC') onSync(message as unknown as Sync);
        else if (message.type === 'ERROR') {
            notify(String(message.error ?? 'The request was rejected.'));
            if (message.code === 'NOT_ALLOWED') el('new-room').hidden = false;
        }
    }
});

el('lock-in').onclick = () => {
    const model = live();
    if (!model || model.view.phase !== 'planning') return;
    if (model.view.submitted) move({ action: 'UNSUBMIT' });
    else move({ action: 'SUBMIT', allocation: bar.getAllocation() });
};
scroller.onscroll = () => {
    following = Math.abs(scroller.scrollLeft - followTarget) < SCROLL_FOLLOW_TOLERANCE;
    dirty = true;
};
new ResizeObserver(() => {
    dirty = true;
}).observe(chart);
for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, unlockAudio);
bindRules();
el<HTMLInputElement>('invite').value = location.href;
requestAnimationFrame(frame);
