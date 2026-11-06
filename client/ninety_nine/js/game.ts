import { Engine } from './engine.js';
import { decide } from './ai.js';
import { VARIANTS, getVariant } from './variants/index.js';
import type { Sync, View, Move, CardView, GameEvent } from './types.js';
import { CameraController } from './ui/camera-input.js';
import { layout, contentSize } from './ui/polygon.js';
import { tableArt, tableArtExtent } from './ui/table-art.js';
import { createCardElement } from './ui/card-element.js';
import { pill, variantTable } from './ui/variant-table.js';
import { scorecard } from './ui/scorecard.js';
import { chips } from './ui/chips.js';
import { updateCounter } from './ui/counter.js';
import { animate, snapshot } from './ui/flight.js';

declare function createConnection(): WebSocket;
declare function copyToClipboard(text: string): void;
interface NativeDialog extends HTMLDialogElement {
    open: boolean; showModal(): void; close(): void;
}
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const dialog = (id: string): NativeDialog => $<NativeDialog>(id);
const params = new URLSearchParams(location.search);
const mock = params.get('mock');
let room = mock === null ? location.search.slice(1) : '';
let socket: WebSocket;
let sync: Sync | null = null;
let state: View | null = null;
let retry = 0;
let resumeSent = false;
let noticeTimer = 0;
let camera: CameraController | null = null;
let tableKey = '';
let tableSize = { w: 1000, h: 1000 };
let processing = false;
let gated = false;
let won = false;
let combineMode = false;
let selected: Array<string> = [];
const updates: Array<Sync> = [];
let mockEngine: Engine | null = null;
let mockSeen = 0;
let mockTimer = 0;

function notify(text: string): void {
    $('notice').textContent = text; $('notice').hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => {
        $('notice').hidden = true;
    }, 5000);
}
function send(message: Record<string, unknown>): void {
    if (mockEngine) {
        if (message.type === 'MOVE') {
            const error = mockEngine.dispatch(0, { ...message, action: String(message.action) });
            if (error) notify(error);
            else mockSync();
        }
    } else if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    else notify('Connection lost. Wait for reconnection.');
}
function move(message: Move): void {
    selected = []; combineMode = false;
    send({ type: 'MOVE', ...message });
}
function name(seat: number): string {
    return sync?.seats[seat]?.username ?? `Player ${seat + 1}`;
}
function names(text: string): string {
    return text.replace(/Player (\d+)/g, (_, seat) => name(Number(seat) - 1));
}
function remember(key: string, value?: string): string | null {
    try {
        if (value !== undefined) sessionStorage.setItem(key, value);
        return sessionStorage.getItem(key);
    } catch {
        return null;
    }
}
function connect(): void {
    $('connection-status').textContent = retry ? 'Reconnecting… Your seat is held.' : 'Connecting…';
    socket = createConnection(); resumeSent = false;
    socket.onopen = () => {
        retry = 0; $('connection-status').textContent = '';
        send(room ? { type: 'JOIN', gameID: room } : { type: 'CREATE', gameType: 'ninety_nine' });
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
            if (sync?.token) remember(`ninety_nine:${room}`, sync.token);
        } else if (data.type === 'SYNC') {
            const next = data as Sync;
            if (next.token && room) remember(`ninety_nine:${room}`, next.token);
            if (next.started && next.youAre < 0 && !resumeSent) {
                const token = remember(`ninety_nine:${room}`);
                if (token) {
                    resumeSent = true; send({ type: 'MOVE', action: 'RESUME', token });
                }
            }
            updates.push(next); void processUpdates();
        } else if (data.type === 'ERROR')
            if (data.code === 'NO_GAME') {
                room = ''; history.replaceState(null, '', location.pathname);
                notify('That room has closed. A new room was created.');
                send({ type: 'CREATE', gameType: 'ninety_nine' });
            } else notify(data.error);
    };
    socket.onclose = () => {
        $('connection-status').textContent = 'Disconnected. Reconnecting…';
        window.setTimeout(connect, Math.min(10000, 1000 * 2 ** retry++));
    };
    socket.onerror = () => socket.close();
}
function action(text: string, callback: () => void, disabled = false): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = text; button.onclick = callback; button.disabled = disabled;
    return button;
}
function options(): void {
    if (!sync?.isHost) return;
    send({ type: 'MOVE', action: 'SET_OPTIONS',
        variantId: document.querySelector<HTMLInputElement>('input[name="variant"]:checked')!.value,
        seats: Number($<HTMLSelectElement>('seats-option').value),
        tokens: Number($<HTMLInputElement>('tokens-option').value) });
}
function renderLobby(): void {
    if (!sync) return;
    $('players').replaceChildren(...sync.seats.map((seat, i) => {
        const li = document.createElement('li');
        li.textContent = `${seat.username}${i === sync?.youAre ? ' (you)' : ''} · ${seat.ai ? 'AI · Ready ✓'
            : seat.ready ? 'Ready ✓' : 'Not ready'}`;
        return li;
    }));
    $('start-game').hidden = !sync.isHost;
    $<HTMLButtonElement>('start-game').disabled = !sync.seats.every(seat => seat.ready);
    $('ready').textContent = sync.seats[sync.youAre]?.ready ? 'Unready' : 'Ready';
    $('settings-help').hidden = sync.isHost;
    $('settings-help').textContent = 'The host chooses these settings.';
    $('variants').replaceChildren(...(sync.variants ?? VARIANTS).map(variant => {
        const label = document.createElement('label'); label.className = 'variant-option';
        const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'variant';
        radio.value = variant.id; radio.checked = variant.id === sync?.settings.variantId;
        radio.disabled = !sync?.isHost; radio.onchange = options;
        const title = document.createElement('strong'); title.textContent = variant.name;
        const description = document.createElement('span');
        description.textContent = `${variant.description}${variant.tier === 'B' ? ' · Special rules' : ''}`;
        label.append(radio, title, description); return label;
    }));
    $<HTMLSelectElement>('seats-option').value = String(sync.settings.seats);
    $<HTMLInputElement>('tokens-option').value = String(sync.settings.tokens);
    $<HTMLSelectElement>('seats-option').disabled = $<HTMLInputElement>('tokens-option').disabled = !sync.isHost;
    $('token-chips').replaceChildren(...[1, 2, 3, 5].map(count => {
        const button = action(String(count), () => {
            $<HTMLInputElement>('tokens-option').value = String(count); options();
        }, !sync?.isHost);
        button.setAttribute('aria-label', `${count} starting tokens`);
        button.append(chips(1).firstElementChild!);
        return button;
    }));
    const variant = getVariant(sync.settings.variantId)!;
    $('variant-preview').replaceChildren(variantTable(variant));
    $('rules-cards').replaceChildren(variantTable(variant));
}
function preview(card: CardView, target: HTMLElement): void {
    if (!card.rank || !target.isConnected || target.style.visibility === 'hidden') return;
    const panel = $('preview');
    const description = document.createElement('p'); description.textContent = card.def?.label ?? '';
    panel.replaceChildren(createCardElement(card), description); panel.hidden = false;
    const box = target.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(innerWidth - panel.offsetWidth - 8, box.left))}px`;
    panel.style.top = `${Math.max(8, box.top - panel.offsetHeight - 12)}px`;
}
function hover(node: HTMLElement, card: CardView): void {
    node.onmouseenter = node.onfocus = () => preview(card, node);
    node.onmouseleave = node.onblur = () => {
        $('preview').hidden = true;
    };
}
function renderTable(): void {
    if (!state || !sync) return;
    const key = `${state.players.length}:${sync.youAre}`;
    const table = layout(Math.max(4, state.players.length), { w: 230, h: 175 }, Math.max(0, sync.youAre));
    if (key !== tableKey) {
        tableKey = key; tableSize = contentSize(table, { w: 230, h: 175 });
        $('world').style.width = `${tableSize.w}px`; $('world').style.height = `${tableSize.h}px`;
        const extent = tableArtExtent(table.radius * .86);
        Object.assign($('table-art').style, {
            width: `${extent * 2}px`, height: `${extent * 2}px`,
            left: `${tableSize.w / 2 - extent}px`, top: `${tableSize.h / 2 - extent}px`
        });
        $('table-art').replaceChildren(tableArt(Math.max(4, state.players.length), table.radius * .86));
        $('center').style.left = `${tableSize.w / 2}px`; $('center').style.top = `${tableSize.h / 2}px`;
        if (!camera) camera = new CameraController({ frame: $('world-frame'), world: $('world'), content: () => tableSize });
        else camera.reset();
    }
    const total = document.createElement('div'); total.id = 'total'; total.className = 'counter';
    total.setAttribute('aria-label', 'Running total'); updateCounter(total, state.total, false);
    const piles = document.createElement('div'); piles.className = 'center-piles';
    for (const place of ['deck', 'discard'] as const) {
        const pile = document.createElement('div'); pile.className = 'pile';
        const stack = document.createElement('div'); stack.className = 'pile__stack'; stack.dataset.place = place;
        const cards: Array<CardView> = place === 'deck' ? [{ iid: 'deck-back' }] : state.discard.slice(-3);
        for (const [i, card] of cards.entries()) {
            const face = createCardElement(card); face.style.setProperty('--fan', `${(i - cards.length + 1) * 5}deg`);
            if (place === 'discard') {
                face.dataset.iid = card.iid; face.tabIndex = 0; hover(face, card);
            }
            stack.append(face);
        }
        const label = document.createElement('span'); label.id = `${place}-count`;
        label.textContent = `${place === 'deck' ? 'Draw' : 'Discard'} · ${place === 'deck' ? state.deckCount : state.discardCount}`;
        pile.append(stack, label); piles.append(pile);
    }
    const direction = document.createElement('div'); direction.id = 'direction'; direction.className = 'direction-ring';
    direction.textContent = state.direction === 1 ? '↻ Clockwise' : '↺ Counter-clockwise';
    const caption = document.createElement('p'); caption.className = 'last-play';
    caption.textContent = names(state.log[state.log.length - 1] ?? '');
    $('center').replaceChildren(total, piles, direction, caption);
    $('seats').replaceChildren(...state.players.map((player, i) => {
        const seat = document.createElement('section');
        seat.className = `seat${state?.turn === i ? ' active' : ''}${player.eliminated ? ' out' : ''}`;
        seat.dataset.seat = String(i);
        seat.style.left = `${tableSize.w / 2 + table.seats[i].anchor.x * 1.08}px`;
        seat.style.top = `${tableSize.h / 2 + table.seats[i].anchor.y * 1.08}px`;
        const angle = (table.seats[i].rotationDeg % 360 + 360) % 360;
        seat.style.setProperty('--seat-angle', `${table.seats[i].rotationDeg}deg`);
        const title = document.createElement('h3');
        title.textContent = `${name(i)}${i === sync?.youAre ? ' (you)' : ''}${sync?.seats[i]?.ai ? ' · AI'
            : !sync?.seats[i]?.connected ? ' · offline' : ''}`;
        if (i === state?.dealer) {
            const dealer = document.createElement('span'); dealer.className = 'dealer';
            dealer.textContent = 'D'; dealer.title = 'Dealer'; title.append(' ', dealer);
        }
        const fan = document.createElement('div'); fan.className = 'seat-hand';
        if (i !== sync?.youAre) fan.dataset.place = String(i);
        for (const [j, card] of player.hand.slice(0, player.revealed ? player.hand.length : 5).entries()) {
            const face = createCardElement(card, i === sync?.youAre);
            if (i !== sync?.youAre) face.dataset.iid = card.iid;
            face.style.setProperty('--fan', `${(j - Math.min(player.count - 1, 4) / 2) * 7}deg`);
            if (card.rank) {
                face.tabIndex = 0; hover(face, card);
            }
            fan.append(face);
        }
        const count = document.createElement('p'); count.dataset.count = String(i);
        count.textContent = `${player.count} cards${player.eliminated ? ' · OUT'
            : state?.skipped.includes(i) ? ' · SKIPPED' : ''}`;
        const tokens = chips(player.tokens); tokens.dataset.chips = String(i);
        if (angle > 90 && angle < 270) for (const label of [title, tokens, count]) label.classList.add('flip');
        seat.append(title, tokens, fan, count);
        if (state?.prompt?.options.includes(i)) {
            seat.classList.add('target');
            seat.append(action(`Choose ${name(i)}`, () => move({ action: 'CHOOSE',
                promptId: state!.prompt!.id, value: i })));
        }
        return seat;
    }));
}
function canAct(): boolean {
    return !!state && !gated && state.phase === 'play' && !state.prompt && state.turn === sync?.youAre;
}
function playSelected(): void {
    if (!state || !canAct()) return;
    if (combineMode) {
        if (state.combinations.some(ids => ids.length === selected.length && ids.every(id => selected.includes(id))))
            move({ action: 'COMBINE', iids: [...selected] });
        return;
    }
    const legal = state.legal.filter(play => play.iid === selected[0]);
    if (legal.length === 1) move({ action: 'PLAY', ...legal[0] });
    else if (legal.length) $('hand-tools').querySelector('button')?.focus();
}
function renderTools(): void {
    if (!state || !sync) return;
    const tools = $('hand-tools'); tools.replaceChildren();
    if (state.phase === 'bust') {
        tools.append(action('Continue', () => move({ action: 'CONTINUE' }), sync.youAre < 0 || gated));
        return;
    }
    if (!canAct()) return;
    if (combineMode) tools.append(action('Play combined +10', playSelected, selected.length !== 2));
    else for (const legal of state.legal.filter(play => play.iid === selected[0]))
        tools.append(action(legal.choice === undefined ? 'Play' : `Play as ${legal.choice >= 0 ? '+' : ''}${legal.choice}`,
            () => move({ action: 'PLAY', ...legal })));
    if (state.combinations.length) tools.append(action(combineMode ? 'Cancel combination' : 'Combine two faces', () => {
        combineMode = !combineMode; selected = []; renderHand();
    }));
}
function renderHand(): void {
    if (!state || !sync) return;
    $('preview').hidden = true;
    $('hand').dataset.place = String(sync.youAre);
    const mine = state.players[sync.youAre];
    $('hand').replaceChildren(...(mine?.hand ?? []).map(card => {
        const button = action('', () => {
            if (!canAct()) return;
            if (combineMode) selected = selected.includes(card.iid) ? selected.filter(id => id !== card.iid)
                : [...selected.slice(-1), card.iid];
            else selected = [card.iid];
            document.querySelectorAll<HTMLElement>('.hand-card').forEach(node => {
                node.classList.toggle('selected', selected.includes(node.dataset.iid!));
                node.setAttribute('aria-pressed', String(selected.includes(node.dataset.iid!)));
            });
            renderTools();
        });
        button.className = 'hand-card'; button.dataset.iid = card.iid;
        button.classList.toggle('selected', selected.includes(card.iid));
        button.classList.toggle('illegal', !state!.playable.includes(card.iid));
        button.setAttribute('aria-pressed', String(selected.includes(card.iid)));
        button.setAttribute('aria-label', `${card.rank} of ${card.suit}: ${card.def?.label}`);
        button.ondblclick = () => {
            selected = [card.iid]; playSelected();
        };
        button.append(createCardElement(card));
        const badge = document.createElement('span'); badge.className = 'effect-pill'; badge.textContent = pill(card.def!);
        button.append(badge); hover(button, card); return button;
    }));
    const status = state.phase === 'bust' || state.phase === 'gameEnd'
        ? `${name(state.turn)} cannot play without passing 99${state.players[state.turn].eliminated ? ' · OUT' : ' · loses a token'}`
        : state.prompt ? state.prompt.text : state.turn === sync.youAre ? 'Your turn'
            : `Waiting for ${name(state.turn)}… · total ${state.total}`;
    $('turn-status').textContent = status;
    renderTools();
}
function land(group: Array<GameEvent>, counts: Array<number>, piles: { deck: number; discard: number }): void {
    for (const event of group) {
        if (event.group === 'reveal') {
            const stack = document.querySelector<HTMLElement>(`[data-chips="${event.seat}"]`);
            const chip = document.createElement('span'); chip.className = 'chip';
            stack?.append(chip);
            if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
                chip.animate([{ transform: 'translateY(0)', opacity: 1 },
                    { transform: 'translate(30px, -70px) rotate(120deg)', opacity: 0 }],
                { duration: 600 }).onfinish = () => chip.remove();
            else chip.remove();
            stack?.replaceChildren(...chips(state!.players[event.seat].tokens).childNodes, chip);
            continue;
        }
        if (typeof event.from === 'string') piles[event.from]--; else counts[event.from.hand]--;
        if (typeof event.to === 'string') piles[event.to]++; else counts[event.to.hand]++;
    }
    for (const [seat, count] of counts.entries())
        document.querySelectorAll<HTMLElement>(`[data-count="${seat}"]`).forEach(node => {
            node.textContent = node.tagName === 'TD' ? String(count) : `${count} cards${state!.players[seat].eliminated
                ? ' · OUT' : state!.skipped.includes(seat) ? ' · SKIPPED' : ''}`;
        });
    $('deck-count').textContent = `Draw · ${piles.deck}`;
    $('discard-count').textContent = `Discard · ${piles.discard}`;
    if (group[0]?.group === 'play' || group[0]?.group === 'combine') {
        updateCounter($('total'), state!.total);
        const delta = document.createElement('span'); delta.className = 'delta';
        delta.textContent = state!.lastPlay!.def.value.type === 'set' ? `→${state!.total}`
            : `${state!.lastPlay!.delta >= 0 ? '+' : ''}${state!.lastPlay!.delta}`;
        $('center').append(delta);
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
            delta.animate([{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-70px)' }],
                { duration: 1000 }).onfinish = () => delta.remove();
        else delta.remove();
    }
}
async function processUpdates(): Promise<void> {
    if (processing) return;
    processing = true;
    try {
        while (updates.length) {
            const before = snapshot(); const previous = state;
            sync = updates.shift()!; state = sync.view ?? null;
            $('preview').hidden = true;
            for (const id of ['game', 'hud', 'log-panel', 'camera-controls', 'scorecard']) $(id).hidden = !sync.started;
            $('lobby').hidden = sync.started;
            $('table-rematch').hidden = state?.phase !== 'gameEnd' || sync.youAre < 0;
            if (!state) {
                won = false; selected = []; tableKey = '';
                dialog('win-modal').close(); renderLobby(); continue;
            }
            gated = state.events.some(event => ['deal', 'gather', 'recycle', 'shuffle'].includes(event.group));
            selected = selected.filter(id => state!.players[sync!.youAre]?.hand.some(card => card.iid === id));
            renderTable(); renderHand();
            $('scorecard').replaceChildren(scorecard(sync, state));
            $('rules-cards').replaceChildren(variantTable(state.variant));
            $('log').replaceChildren(...state.log.map(text => {
                const p = document.createElement('p'); p.textContent = names(text); return p;
            }));
            const counts = previous?.players.map(player => player.count) ?? state.players.map(() => 0);
            const piles = { deck: previous?.deckCount ?? state.deckCount + counts.length * state.variant.rules.handSize,
                discard: previous?.discardCount ?? 0 };
            if (state.events.length) {
                updateCounter($('total'), previous?.total ?? 0, false);
                land([], counts, piles);
                for (const event of state.events) if (event.group === 'reveal') {
                    const stack = document.querySelector<HTMLElement>(`[data-chips="${event.seat}"]`);
                    stack?.replaceChildren(...chips(state.players[event.seat].tokens + 1).childNodes);
                }
                if (previous && previous.direction !== state.direction &&
                    !matchMedia('(prefers-reduced-motion: reduce)').matches)
                    $('direction').animate([{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(0)' }], { duration: 500 });
                await animate(state.events, before, group => land(group, counts, piles));
            }
            gated = false;
            updateCounter($('total'), state.total, false);
            $('scorecard').replaceChildren(scorecard(sync, state)); renderHand();
            if (state.phase === 'gameEnd' && !won) {
                won = true;
                $('win-title').textContent = state.winner === sync.youAre ? 'You win!' : `${name(state.winner!)} wins!`;
                $('win-rematch').hidden = sync.youAre < 0;
                dialog('win-modal').showModal();
            }
        }
    } finally {
        processing = false;
    }
}
function mockSync(): void {
    if (!mockEngine) return;
    const view = mockEngine.view(0, mockSeen);
    mockSeen = mockEngine.events.at(-1)?.seq ?? 0;
    updates.push({ type: 'SYNC', started: true, youAre: 0, isHost: true,
        seats: view.players.map((player, i) => ({ username: i ? `CPU ${i}` : 'You', ready: true,
            connected: true, ai: i > 0, eliminated: player.eliminated })),
        settings: { variantId: view.variant.id, ...view.options }, view });
    void processUpdates();
    clearTimeout(mockTimer);
    if (view.phase === 'play' && (view.prompt?.seat ?? view.turn) > 0)
        mockTimer = window.setTimeout(() => {
            const seat = mockEngine!.pending?.seat ?? mockEngine!.turn;
            mockEngine!.dispatch(seat, decide(mockEngine!.view(seat))); mockSync();
        }, 3500);
}
$('ready').onclick = () => send({ type: 'READY' });
$('start-game').onclick = () => send({ type: 'MOVE', action: 'START_GAME' });
$('seats-option').onchange = $('tokens-option').onchange = options;
$('copy-invite').onclick = () => copyToClipboard(location.href);
$('username-form').onsubmit = event => {
    event.preventDefault(); send({ type: 'USERNAME', username: $<HTMLInputElement>('username').value });
};
$('rules-button').onclick = () => dialog('rules-modal').showModal();
$('rules-close').onclick = () => dialog('rules-modal').close();
$('win-close').onclick = () => dialog('win-modal').close();
$('table-rematch').onclick = $('win-rematch').onclick = () => send({ type: 'MOVE', action: 'RETURN_TO_LOBBY' });
$('zoom-in').onclick = () => camera?.zoom(1.2);
$('zoom-out').onclick = () => camera?.zoom(1 / 1.2);
$('recenter').onclick = () => camera?.reset();
document.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !(event.target instanceof HTMLInputElement) &&
        (!(event.target instanceof HTMLButtonElement) || event.target.classList.contains('hand-card')) &&
        !dialog('rules-modal').open && !dialog('win-modal').open) {
        event.preventDefault(); playSelected();
    }
});
$<HTMLInputElement>('invite').value = location.href;
if (mock !== null) {
    mockEngine = new Engine({ variant: getVariant(params.get('variant') ?? 'standard') ?? VARIANTS[0],
        seats: Math.max(2, Math.min(8, Number(mock) || 4)), tokens: 3 });
    $('connection-status').textContent = 'Offline preview'; mockSync();
} else connect();
