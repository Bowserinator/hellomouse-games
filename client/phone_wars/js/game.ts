/** Page logic for Phone Wars: server connection, state syncing and the render loop. */
import { connectToGame } from '../../shared/ts/game-connection.js';
import type { GameConnection } from '../../shared/ts/game-connection.js';
import { GAME_CONFIG, companyTheme } from './config.js';
import { abilityById, computeRates } from './engine.js';
import { formatExact, formatNumber, formatPercent, formatSeconds } from './format.js';
import { Lobby } from './lobby.js';
import { Screens, dialog } from './screens.js';
import type { Live } from './screens.js';
import type { GameEvent, Move, Sync } from './types.js';

const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

let sync: Sync | null = null;
let receivedAt = 0;
let sentClicks = 0;
let lastSentAt = 0;
let lastEventId = -1;
let wasStarted = false;
let shownCompany = '';
let finishedShown = false;
let restoreName = true;
let noticeTimer = 0;
let toastTimer = 0;
let connection: GameConnection;

function notify(text: string): void {
    el('notice').textContent = text;
    el('notice').hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => {
        el('notice').hidden = true;
    }, 5000);
}

function send(message: Record<string, unknown>): void {
    if (!connection.send(message)) notify('Connection lost.');
}

function move(message: Move): void {
    send({ type: 'MOVE', ...message });
}

const lobby = new Lobby(send);
const screens: Screens = new Screens({ move, details: id => screens.openDetails(id) });

function showToast(text: string, withAction: boolean): void {
    el('toast-text').textContent = text;
    el('toast-action').hidden = !withAction;
    el('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
        el('toast').hidden = true;
    }, 6000);
}

function names(): Array<string> {
    return sync?.seats.map(seat => seat.username) ?? [];
}

function announce(event: GameEvent): void {
    const seat = sync?.youAre ?? -1;
    const who = names()[event.seat] ?? 'A rival';
    const ability = abilityById(event.ref ?? '')?.name ?? 'Attack';
    if (event.type === 'shipment') showToast(`FINAL SHIPMENT · ${who} is at ${formatPercent(GAME_CONFIG.finalShipmentFraction)}`, false);
    else if (event.type === 'attack' && event.target === seat)
        if (event.outcome === 'landed')
            showToast(`ATTACKED · ${ability} · -${formatPercent(event.slow ?? 0)} · ${formatSeconds(event.duration ?? 0)}`, true);
        else if (event.outcome === 'blocked' || event.outcome === 'whiff' || event.outcome === 'immune')
            showToast(`BLOCKED · ${ability} from ${who}`, false);
}

function live(): Live | null {
    const view = sync?.view;
    if (!sync || !view) return null;
    const elapsed = view.winner >= 0 ? 0 : Math.min(2, (performance.now() - receivedAt) / 1000);
    const now = view.time + elapsed;
    const rates = computeRates(view.you, now, view.settings.moneyMultiplier);
    if (sentClicks > view.you.clicks && performance.now() - lastSentAt > 1000) sentClicks = view.you.clicks;
    const clickPhones = Math.max(0, sentClicks - view.you.clicks) * rates.clickPhones;
    const phones = rates.effectivePps * elapsed + clickPhones;
    const you = {
        ...view.you,
        phonesMade: view.you.phonesMade + phones,
        cash: view.you.cash + phones * rates.salePrice,
        research: view.you.research + rates.rps * elapsed,
        influence: Math.min(GAME_CONFIG.influence.cap, view.you.influence + GAME_CONFIG.influence.regenPerSecond * elapsed)
    };
    return { view, you, rates, now, names: names(), seat: view.you.seat, spectating: sync.youAre < 0, context: { settings: view.settings, leaderPhones: view.leaderPhones } };
}

function hint(model: Live): string {
    if (!lobby.hintsEnabled || model.spectating) return '';
    const { you } = model;
    const machines = Object.values(you.machines).reduce((sum, count) => sum + count, 0);
    if (!machines && you.phonesMade < 1) return 'Click Assemble phone to build your first phones.';
    if (!machines) return 'Buy a Hand Assembly Bench in Economy to build phones automatically.';
    if (!you.owned.some(id => id.startsWith('def_')) && you.phonesMade > 5000)
        return 'Rivals can slow your factories. Defense upgrades reduce sabotage.';
    if (!you.owned.some(id => id.startsWith('atk_')) && you.phonesMade > 20000 && model.view.settings.mode === 'standard')
        return 'Offense projects let you slow a rival using cash and influence.';
    return '';
}

function showResults(model: Live): void {
    const { view } = model;
    const winner = view.winner === model.seat && !model.spectating ? 'You won!' : `${model.names[view.winner] ?? 'A rival'} wins!`;
    el('win-title').textContent = winner;
    el('results').replaceChildren(...view.placements.map(seat => {
        const player = view.players.find(candidate => candidate.seat === seat)!;
        const item = document.createElement('li');
        const theme = companyTheme(player.companyId);
        item.style.setProperty('--chip-color', theme.primary);
        item.textContent = `${model.names[seat] ?? theme.name} (${theme.name}) · ${formatExact(player.phonesMade)} phones · ${formatNumber(player.pps)} PPS`;
        return item;
    }));
    dialog('win-modal').showModal();
}

function frame(): void {
    const model = live();
    if (!model) return;
    screens.render(model);
    screens.setHint(hint(model));
    const { view } = model;
    if (view.winner >= 0 && !finishedShown) {
        finishedShown = true;
        showResults(model);
    }
    if (model.you.companyId !== shownCompany) {
        shownCompany = model.you.companyId;
        screens.setCompany(shownCompany);
    }
    el('back-to-lobby').hidden = model.spectating || !(view.winner >= 0 && !dialog('win-modal').open);
}

function onSync(next: Sync): void {
    sync = next;
    receivedAt = performance.now();
    if (restoreName && next.youAre >= 0) {
        restoreName = false;
        const username = localStorage.getItem('username');
        if (username && username !== next.seats[next.youAre].username) send({ type: 'USERNAME', username });
    }
    const view = next.view;
    const playing = next.started && view !== undefined;
    el('lobby').hidden = playing;
    el('game').hidden = !playing;
    el('game').classList.toggle('is-spectating', next.youAre < 0);
    el('win-rematch').hidden = next.youAre < 0;
    if (!playing) {
        lobby.render(next);
        if (wasStarted) {
            wasStarted = false;
            finishedShown = false;
            lastEventId = -1;
            dialog('win-modal').close();
            el('back-to-lobby').hidden = true;
        }
        return;
    }
    if (!wasStarted) {
        wasStarted = true;
        sentClicks = view.you.clicks;
        lastEventId = view.events.length ? view.events[view.events.length - 1].id : 0;
    }
    for (const event of view.events)
        if (event.id > lastEventId) {
            lastEventId = event.id;
            announce(event);
        }
    frame();
}

connection = connectToGame({
    gameType: 'phone_wars',
    pingIntervalInMilliseconds: 5000,
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

el('assemble').onclick = () => {
    const model = live();
    if (!model || model.view.winner >= 0) return;
    sentClicks++;
    lastSentAt = performance.now();
    const gain = model.rates.clickPhones;
    screens.floatGain(`+${gain >= 10 ? formatNumber(gain) : String(Number(gain.toFixed(1)))}`);
    move({ action: 'make_phone' });
};
el('win-close').onclick = () => dialog('win-modal').close();
el('win-rematch').onclick = el('back-to-lobby').onclick = () => move({ action: 'RETURN_TO_LOBBY' });
el<HTMLInputElement>('invite').value = location.href;
setInterval(frame, 100);
