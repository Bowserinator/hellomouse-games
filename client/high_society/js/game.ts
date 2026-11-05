import { Engine, isForcedPass } from './engine.js';
import { decide } from './ai.js';
import { moneyCard, statusCard } from './ui/card-element.js';
import { seatElement } from './ui/seat.js';
import { scoreboard } from './ui/scoreboard.js';
import { snapshot, animate } from './ui/flight.js';
import { reveal } from './ui/reveal.js';
import { CameraController } from './ui/camera-input.js';
import { layout, contentSize } from './ui/polygon.js';
import { tableArt, tableArtExtent } from './ui/table-art.js';
import { tableGradient } from './ui/table-gradient.js';
import type { Sync, View, Move, StatusCard, MoneyCard, GameEvent } from './types.js';

declare function createConnection(): WebSocket;
declare function copyToClipboard(text: string): void;
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
interface NativeDialog extends HTMLDialogElement {
    open: boolean;
    showModal(): void;
    close(): void;
}
const dialog = (id: string): NativeDialog => $<NativeDialog>(id);
const params = new URLSearchParams(location.search);
const mock = params.get('mock');
let room = mock === null ? location.search.slice(1) : '';
let socket: WebSocket;
let sync: Sync | null = null;
let state: View | null = null;
let retry = 0;
let resumeSent = false;
let restoreName = true;
let noticeTimer = 0;
let selected: Array<number> = [];
let processing = false;
let gated = false;
let won = false;
let mockEngine: Engine | null = null;
let mockSeen = 0;
let mockTimer = 0;
let autoPassDeadline = 0;
let countdownTimer = 0;
const updates: Array<{ sync: Sync; received: number }> = [];
const log: Array<string> = [];
const SEAT_SIZE = { w: 300, h: 220 };
let camera: CameraController | null = null;
let tableKey = '';
let tableSize = { w: 1000, h: 1000 };

function remember(key: string, value?: string): string | null {
    try {
        if (value !== undefined) sessionStorage.setItem(key, value);
        return sessionStorage.getItem(key);
    } catch {
        return null;
    }
}
function notify(text: string): void {
    $('notice').textContent = text; $('notice').hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => {
        $('notice').hidden = true;
    }, 5000);
}
function send(message: Record<string, unknown>): void {
    if (mockEngine) {
        if (message.action === 'RETURN_TO_LOBBY') {
            location.assign('/high_society/');
            return;
        }
        if (message.type === 'MOVE') {
            const error = mockEngine.dispatch(0, { ...message, action: String(message.action) });
            if (error) notify(error);
            else mockSync();
        }
    } else if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    else notify('Connection lost. Wait for reconnection.');
}
function move(message: Move): void {
    send({ type: 'MOVE', ...message });
}
function name(seat: number): string {
    return sync?.seats[seat]?.username ?? `Player ${seat + 1}`;
}
function connect(): void {
    $('connection-status').textContent = retry ? 'Reconnecting… Your seat is held.' : 'Connecting…';
    socket = createConnection(); resumeSent = false; restoreName = true;
    socket.onopen = () => {
        retry = 0; $('connection-status').textContent = '';
        send(room ? { type: 'JOIN', gameID: room } : { type: 'CREATE', gameType: 'high_society' });
    };
    socket.onmessage = event => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch {
            notify('Invalid server response.'); return;
        }
        if (data.type === 'UUID') {
            room = data.uuid; history.replaceState(null, '', `?${room}`);
            $<HTMLInputElement>('invite').value = location.href;
            if (sync?.token) remember(`high_society:${room}`, sync.token);
        } else if (data.type === 'SYNC') {
            const next = data as Sync;
            if (next.token && room) remember(`high_society:${room}`, next.token);
            if (!next.started && next.youAre >= 0 && restoreName) {
                restoreName = false;
                const username = remember('high_society:username');
                if (username && username !== next.seats[next.youAre].username)
                    send({ type: 'USERNAME', username });
            }
            if (next.started && next.youAre < 0 && !resumeSent) {
                const token = remember(`high_society:${room}`);
                if (token) {
                    resumeSent = true; send({ type: 'MOVE', action: 'RESUME', token });
                }
            }
            updates.push({ sync: next, received: performance.now() }); void processUpdates();
        } else if (data.type === 'ERROR')
            if (data.code === 'NO_GAME') {
                room = ''; sync = null; history.replaceState(null, '', location.pathname);
                notify('That room has closed. A new room was created.');
                send({ type: 'CREATE', gameType: 'high_society' });
            } else {
                notify(data.error ?? 'The request was rejected.');
                if (data.code === 'NOT_ALLOWED') $('new-room').hidden = false;
                if (data.code === 'MOVE' && resumeSent && sync?.youAre === -1)
                    $('spectator').textContent = data.error ?? 'You are watching. Your seat could not be resumed.';
            }
    };
    socket.onclose = () => {
        $('connection-status').textContent = 'Disconnected. Reconnecting…';
        window.setTimeout(connect, Math.min(10000, 1000 * 2 ** retry++));
    };
    socket.onerror = () => socket.close();
}
function action(text: string, callback: () => void): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = text; button.onclick = callback;
    return button;
}
function renderLobby(): void {
    if (!sync) return;
    const host = sync.seats.findIndex(seat => !seat.ai && seat.connected);
    $('players').replaceChildren(...sync.seats.map((seat, i) => {
        const li = document.createElement('li');
        li.textContent = `${seat.username}${i === sync?.youAre ? ' (you)' : ''}${i === host ? ' · Host ♛' : ''} · ${
            seat.ai ? 'CPU · Ready ✓' : seat.ready ? 'Ready ✓' : 'Not ready'}`;
        return li;
    }));
    $('start-game').hidden = !sync.isHost;
    const waiting = sync.seats.filter(seat => !seat.ready).length;
    $<HTMLButtonElement>('start-game').disabled = waiting > 0;
    $('start-help').textContent = waiting ? `Waiting for ${waiting} guest${waiting === 1 ? '' : 's'} to be ready.`
        : 'All guests are ready.';
    $('ready').textContent = sync.seats[sync.youAre]?.ready ? 'Unready' : 'Ready';
    $('ready').hidden = sync.youAre < 0;
    $<HTMLSelectElement>('seats-option').value = String(sync.settings.seats);
    $<HTMLSelectElement>('seats-option').disabled = !sync.isHost;
    $('username-form').hidden = sync.youAre < 0;
}
function preview(node: HTMLElement, card: StatusCard | MoneyCard, seat = 0): void {
    const show = (): void => {
        const panel = $('preview');
        panel.replaceChildren('kind' in card ? statusCard(card) : moneyCard(card, seat)); panel.hidden = false;
        const rect = node.getBoundingClientRect();
        panel.style.left = `${Math.max(8, Math.min(innerWidth - 200, rect.left))}px`;
        panel.style.top = `${Math.max(8, Math.min(innerHeight - 300, rect.top - 285))}px`;
    };
    const hide = (): void => {
        $('preview').hidden = true;
    };
    let press = 0;
    let start = { x: 0, y: 0 };
    node.onpointerdown = event => {
        start = { x: event.clientX, y: event.clientY };
        press = window.setTimeout(show, 500);
    };
    node.onpointermove = event => {
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) clearTimeout(press);
    };
    node.onpointerup = node.onpointercancel = () => clearTimeout(press);
    node.onmouseenter = node.onfocus = show;
    node.onmouseleave = node.onblur = hide;
    node.oncontextmenu = event => {
        event.preventDefault(); show();
    };
}
function renderTable(): void {
    if (!sync || !state) return;
    const table = layout(state.players.length, SEAT_SIZE, Math.max(0, sync.youAre));
    const key = `${state.players.length}:${sync.youAre}`;
    if (key !== tableKey) {
        tableKey = key; tableSize = contentSize(table, SEAT_SIZE);
        $('world').style.width = `${tableSize.w}px`; $('world').style.height = `${tableSize.h}px`;
        const extent = tableArtExtent(table.radius * .86);
        Object.assign($('table-art').style, { width: `${extent * 2}px`, height: `${extent * 2}px`,
            left: `${tableSize.w / 2 - extent}px`, top: `${tableSize.h / 2 - extent}px` });
        const art = tableArt(Math.max(4, state.players.length), table.radius * .86);
        tableGradient(art); $('table-art').replaceChildren(art);
        $('center').style.left = `${tableSize.w / 2}px`; $('center').style.top = `${tableSize.h / 2}px`;
        if (!camera) camera = new CameraController({ frame: $('world-frame'), world: $('world'), content: () => tableSize });
        else camera.reset();
    }
    $('round-label').textContent = `Auction ${state.round} / ${state.round + state.deckRemaining}`;
    $('end-countdown').replaceChildren(...Array.from({ length: 4 }, (_, i) => {
        const node = document.createElement('span');
        node.className = `end-marker${i < state!.endCardsRevealed ? ' end-marker--filled' : ''}`;
        node.textContent = i < state!.endCardsRevealed ? '◆' : '◇';
        node.setAttribute('aria-label', `End card ${i + 1}${i < state!.endCardsRevealed ? ' revealed' : ' unrevealed'}`);
        return node;
    }));
    $('auction-card').replaceChildren(...(state.current ? [statusCard(state.current)] : []));
    $('highest').textContent = state.highest ? `${state.highest}K · ${name(state.highestBidder)}` : 'The bidding is open';
    $('auction-help').textContent = state.phase === 'gameEnd' ? 'The fourth end card. The evening is over.'
        : state.phase === 'disgrace' ? 'Bid to avoid it · First to pass takes the disgrace'
            : state.phase === 'fauxPas' ? `${name(state.turn)} must discard a luxury` : '';
    $('seats').replaceChildren(...state.players.map((player, i) => {
        const placement = table.seats[i];
        const seat = seatElement(player, sync!.seats[i], i, state!.turn === i && state!.phase !== 'gameEnd',
            i === sync!.youAre, placement.rotationDeg, preview);
        seat.style.left = `${tableSize.w / 2 + placement.anchor.x * .92}px`;
        seat.style.top = `${tableSize.h / 2 + placement.anchor.y * .92}px`;
        if (state!.autoPass?.seat === i) {
            const countdown = document.createElement('p'); countdown.dataset.autoPass = String(i);
            seat.querySelector('.seat-labels')?.append(countdown);
        }
        return seat;
    }));
    const offline = !sync.seats[state.turn].connected && state.phase !== 'gameEnd';
    $('waiting').hidden = !offline;
    $('waiting').textContent = `Waiting for ${name(state.turn)} to reconnect…`;
    renderCountdown();
    $('spectator').hidden = sync.youAre >= 0;
    $('spectator').textContent = 'You are watching. Only public information is shown.';
    $('table-rematch').hidden = state.phase !== 'gameEnd' || sync.youAre < 0;
    if (won && state.result) void reveal(sync, state.result, false);
}
function canAct(): boolean {
    return !!state && state.legal.canPass && !gated && socketReady();
}
function socketReady(): boolean {
    return !!mockEngine || socket?.readyState === WebSocket.OPEN;
}
function bid(): void {
    if (!canAct() || $<HTMLButtonElement>('bid').disabled) return;
    move({ action: 'BID', cards: [...selected] });
}
function pass(): void {
    if (canAct()) move({ action: 'PASS' });
}
function renderHand(): void {
    if (!state || !sync) return;
    selected = selected.filter(id => state!.myHand.some(c => c.id === id));
    $('hand').dataset.zone = `hand-${sync.youAre}`;
    $('discard-choices').replaceChildren(...(state.phase === 'fauxPas' && state.turn === sync.youAre
        ? state.players[sync.youAre].status.filter(c => c.kind === 'luxury').map(card => {
            const button = action(`Discard ${card.label}`, () => move({ action: 'CHOOSE_DISCARD', id: card.id }));
            button.className = 'discard-choice'; button.disabled = gated;
            preview(button, card); return button;
        }) : []));
    $('discard-choices').hidden = !$('discard-choices').childElementCount;
    $('replacement-controls').replaceChildren(...(sync.isHost && state.phase !== 'gameEnd'
        ? sync.seats.flatMap((seat, i) => !seat.ai && !seat.connected
            ? [action(`Replace ${seat.username} with CPU`, () => move({ action: 'REPLACE_WITH_CPU', seat: i }))] : []) : []));
    $('replacement-controls').hidden = !$('replacement-controls').childElementCount;
    $('hand').replaceChildren(...state.myHand.map(card => {
        const button = action('', () => {
            if (!canAct()) return;
            selected = selected.includes(card.id) ? selected.filter(id => id !== card.id) : [...selected, card.id];
            renderHand();
            $('hand').querySelector<HTMLButtonElement>(`[data-id="${card.id}"]`)?.focus();
        });
        button.className = `hand-card${selected.includes(card.id) ? ' selected' : ''}`;
        button.dataset.id = String(card.id);
        button.setAttribute('aria-label', `${card.value}K money card`);
        button.setAttribute('aria-pressed', String(selected.includes(card.id)));
        button.disabled = !canAct();
        button.append(moneyCard(card, sync!.youAre));
        return button;
    }));
    const old = state.players[sync.youAre]?.tableTotal ?? 0;
    const added = state.myHand.filter(c => selected.includes(c.id)).reduce((sum, c) => sum + c.value, 0);
    $('bid-total').textContent = `Your bid: ${old}K → ${old + added}K · Minimum ${state.legal.minNewTotal}K`;
    $<HTMLButtonElement>('bid').disabled = !canAct() || !state.legal.canBid || !selected.length || old + added <= state.highest;
    $('bid-reason').hidden = !state.legal.forcedPass;
    if (state.legal.forcedPass) $('bid').setAttribute('aria-describedby', 'bid-reason');
    else $('bid').removeAttribute('aria-describedby');
    $<HTMLButtonElement>('pass').disabled = !canAct();
    $('pass').textContent = state.legal.forcedPass ? 'Pass now [P]'
        : state.phase === 'disgrace' ? 'Pass — take the disgrace [P]' : 'Pass [P]';
    $('pass').classList.toggle('danger', state.phase === 'disgrace');
    $('turn-status').textContent = state.phase === 'gameEnd' ? 'The evening is over'
        : state.phase === 'fauxPas' ? `${name(state.turn)}: choose a luxury to discard`
            : sync.youAre < 0 ? 'You are watching' : state.turn === sync.youAre
                ? state.legal.forcedPass ? ''
                    : 'Your turn · Select money cards, then bid or pass'
                : `Waiting for ${name(state.turn)}…`;
}
function renderCountdown(): void {
    const passing = state?.autoPass;
    $('auto-pass').hidden = !passing;
    if (!passing) return;
    const remaining = Math.max(0, autoPassDeadline - performance.now());
    const seconds = Math.min(3, Math.ceil(remaining / 1000));
    const mine = passing.seat === sync?.youAre;
    const text = `${mine ? 'You can’t outbid' : `${name(passing.seat)} can’t outbid`} — passing in ${seconds}s…${
        state?.phase === 'disgrace' ? ` Passing will take ${state.current?.label ?? 'the disgrace'}.` : ''}`;
    $('auto-pass').classList.toggle('warning', state?.phase === 'disgrace');
    document.querySelectorAll<HTMLElement>('[data-auto-pass]').forEach(label => {
        const hint = `Passing in ${seconds}s…`;
        if (label.textContent !== hint) label.textContent = hint;
    });
    if ($('auto-pass-text').textContent !== text) $('auto-pass-text').textContent = text;
    $('auto-pass-bar').style.width = `${Math.min(1, remaining / 3000) * 100}%`;
}
function record(events: Array<GameEvent>): void {
    for (const event of events) {
        const who = event.seat === undefined ? '' : name(event.seat);
        const text = event.type === 'pass' ? `${who} passes${event.auto ? ' (unable to outbid)' : ''}`
            : ['award', 'disgrace'].includes(event.type) ? `${who} takes ${event.card!.label}`
                : event.type === 'fauxPasDiscard' ? `${who} discards ${event.card!.label}`
                    : event.type === 'reveal' ? `Revealed ${event.card?.label ?? 'End of deck'}` : '';
        if (text) log.push(text);
    }
    $<HTMLOListElement>('log').start = Math.max(1, log.length - 79);
    $('log').replaceChildren(...log.slice(-80).map(text => {
        const item = document.createElement('li'); item.textContent = text; return item;
    }));
}
async function processUpdates(): Promise<void> {
    if (processing) return;
    processing = true;
    try {
        while (updates.length) {
            const before = snapshot(camera?.current.scale ?? 1);
            const update = updates.shift()!;
            sync = update.sync; state = sync.view ?? null;
            clearInterval(countdownTimer);
            autoPassDeadline = state?.autoPass ? update.received + state.autoPass.remainingMs : 0;
            renderCountdown();
            if (autoPassDeadline) countdownTimer = window.setInterval(renderCountdown, 100);
            for (const id of ['game', 'hud', 'log-panel', 'camera-controls']) $(id).hidden = !sync.started;
            $('lobby').hidden = sync.started;
            if (!state) {
                won = false; selected = []; tableKey = ''; log.length = 0; $('preview').hidden = true;
                for (const id of ['waiting', 'spectator', 'table-rematch']) $(id).hidden = true;
                dialog('win-modal').close(); renderLobby(); continue;
            }
            gated = true;
            renderTable(); renderHand(); record(state.events);
            await animate(state.events, before, sync.youAre);
            gated = false;
            renderTable(); renderHand();
            if (state.phase === 'gameEnd' && !won && state.result) {
                won = true;
                await reveal(sync, state.result);
                $('win-title').textContent = `${state.result.winners.map(name).join(' & ')} win${
                    state.result.winners.length === 1 ? 's' : ''}!`;
                $('results').replaceChildren(...scoreboard(sync, state.result));
                $('tiebreak').textContent = state.result.tiebreak;
                $('win-rematch').hidden = sync.youAre < 0;
                if (!dialog('win-modal').open) dialog('win-modal').showModal();
            }
        }
    } finally {
        gated = false; processing = false;
    }
}
function mockSync(): void {
    if (!mockEngine) return;
    const view = mockEngine.view(0, mockSeen);
    mockSeen = mockEngine.events.at(-1)?.seq ?? 0;
    if (view.turn === 0 && isForcedPass(mockEngine, 0)) view.autoPass = { seat: 0, remainingMs: 4200 };
    updates.push({ received: performance.now(), sync: { type: 'SYNC', started: true, youAre: 0, isHost: true,
        settings: { seats: view.players.length },
        seats: view.players.map((_, i) => ({ username: i ? `CPU ${i}` : 'You',
            ready: true, connected: true, ai: i > 0 })), view } });
    void processUpdates();
    clearTimeout(mockTimer);
    if (view.phase !== 'gameEnd' && view.turn > 0)
        mockTimer = window.setTimeout(() => {
            const error = mockEngine!.dispatch(mockEngine!.turn, decide(mockEngine!.view(mockEngine!.turn, Infinity)));
            if (error) notify(error);
            else mockSync();
        }, 1800);
    else if (view.autoPass)
        mockTimer = window.setTimeout(() => {
            if (!mockEngine || !isForcedPass(mockEngine, 0)) return;
            mockEngine.dispatch(0, { action: 'PASS' }, true);
            mockSync();
        }, view.autoPass.remainingMs);
}
$('ready').onclick = () => send({ type: 'READY' });
$('start-game').onclick = () => move({ action: 'START_GAME' });
$('seats-option').onchange = () => move({ action: 'SET_OPTIONS',
    seats: Number($<HTMLSelectElement>('seats-option').value) });
$('copy-invite').onclick = () => {
    copyToClipboard(location.href); $('copy-invite').textContent = 'Copied ✓';
    window.setTimeout(() => {
        $('copy-invite').textContent = 'Copy invite';
    }, 2000);
};
$('new-room').onclick = () => {
    location.assign('/high_society/');
};
$('username-form').onsubmit = event => {
    event.preventDefault();
    const username = $<HTMLInputElement>('username').value;
    remember('high_society:username', username);
    send({ type: 'USERNAME', username });
};
$('rules-button').onclick = () => dialog('rules-modal').showModal();
$('rules-close').onclick = () => dialog('rules-modal').close();
$('win-close').onclick = () => dialog('win-modal').close();
$('table-rematch').onclick = $('win-rematch').onclick = () => move({ action: 'RETURN_TO_LOBBY' });
$('zoom-out').onclick = () => camera?.zoom(1 / 1.2);
$('recenter').onclick = () => camera?.reset();
$('zoom-in').onclick = () => camera?.zoom(1.2);
$('bid').onclick = bid;
$('pass').onclick = pass;
document.addEventListener('keydown', event => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement ||
        event.ctrlKey || event.metaKey || event.altKey || event.repeat ||
        dialog('rules-modal').open || dialog('win-modal').open) return;
    if (event.key.toLowerCase() === 'b') {
        event.preventDefault(); bid();
    }
    if (event.key.toLowerCase() === 'p') {
        event.preventDefault(); pass();
    }
    if (event.key === 'Escape') $('preview').hidden = true;
});
$<HTMLInputElement>('invite').value = location.href;
$<HTMLInputElement>('username').value = remember('high_society:username') ?? '';
if (mock !== null) {
    mockEngine = new Engine({ seats: Math.max(3, Math.min(5, Math.trunc(Number(mock)) || 4)) });
    $('connection-status').textContent = 'Offline preview'; mockSync();
} else connect();
