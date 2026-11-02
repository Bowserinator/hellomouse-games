import { BACK, CARDS, CARD_BY_ID, COLORS, image } from './cards.js';
import type { Color } from './cards.js';
import { Engine } from './engine.js';
import type { CardView, Move, Place, Prompt, View } from './engine.js';
import type { Sync } from '../../../server/games/fuck_you.js';
import { CameraController } from './ui/camera-input.js';
import { contentSize, layout } from './ui/polygon.js';
import { tableArt, tableArtExtent } from './ui/table-art.js';

declare function createConnection(): WebSocket;
declare function copyToClipboard(text: string): void;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
// This project's TypeScript DOM library predates the native dialog API.
interface NativeDialog extends HTMLDialogElement {
    open: boolean;
    showModal(): void;
    close(): void;
    oncancel: ((event: Event) => void) | null;
}
const dialog = (id: string): NativeDialog => $<NativeDialog>(id);
let socket: WebSocket;
let room = location.search.slice(1);
const mock = new URLSearchParams(location.search).get('mock');
let sync: Sync | null = null;
let state: View | null = null;
let retry = 0;
let promptKey = '';
let won = false;
let winTimer = 0;
let noticeTimer = 0;
let resumeSent = false;
let camera: CameraController | null = null;
let tableSize = { w: 1000, h: 1000 };
let tableKey = '';
let taunts: Array<number> = [];
const voiceContext = typeof AudioContext === 'undefined' ? null : new AudioContext();
const voiceBuffer = voiceContext ? fetch('audio/fuck-you.wav').then(response => {
    if (!response.ok) throw new Error('Voice clip could not be loaded');
    return response.arrayBuffer();
}).then(bytes => voiceContext.decodeAudioData(bytes)).catch(() => null) : Promise.resolve(null);

for (const event of ['pointerdown', 'keydown']) document.addEventListener(event, () => {
    if (voiceContext?.state === 'suspended') void voiceContext.resume().catch(() => {});
});

async function playTaunt(): Promise<void> {
    const buffer = await voiceBuffer;
    if (!voiceContext || !buffer) return notify('Voice audio is unavailable in this browser.');
    if (voiceContext.state !== 'running') return notify('Click anywhere in the page to enable voice audio.');
    const source = voiceContext.createBufferSource();
    const gain = voiceContext.createGain();
    source.buffer = buffer;
    gain.gain.value = .3;
    source.connect(gain); gain.connect(voiceContext.destination);
    source.onended = () => {
        source.disconnect(); gain.disconnect();
    };
    source.start();
}

function send(message: Record<string, unknown>): void {
    if (mock !== null) {
        notify('Mock preview only. Remove the mock parameter to play online.');
        return;
    }
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    else notify('Connection lost. Wait for reconnection.');
}
function move(data: Move): void {
    send({ type: 'MOVE', ...data });
}
function notify(text: string): void {
    $('notice').textContent = text;
    $('notice').hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => {
        $('notice').hidden = true;
    }, 5000);
}
function name(seat: number): string {
    return sync?.seats[seat]?.username ?? `Player ${seat + 1}`;
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
    document.body.classList.add('disconnected');
    socket = createConnection();
    resumeSent = false;
    socket.onopen = () => {
        retry = 0;
        $('connection-status').textContent = '';
        document.body.classList.remove('disconnected');
        send(room ? { type: 'JOIN', gameID: room } : { type: 'CREATE', gameType: 'fuck_you' });
    };
    socket.onmessage = event => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch {
            notify('Invalid server response.');
            return;
        }
        if (data.type === 'UUID') {
            room = data.uuid;
            history.replaceState(null, '', `?${room}`);
            $<HTMLInputElement>('invite').value = location.href;
            if (sync?.token) remember(`fuck_you:${room}`, sync.token);
        } else if (data.type === 'SYNC') {
            sync = data as Sync;
            if (sync.token && room) remember(`fuck_you:${room}`, sync.token);
            if (sync.started && sync.youAre < 0 && !resumeSent) {
                const token = remember(`fuck_you:${room}`);
                if (token) {
                    resumeSent = true; send({ type: 'MOVE', action: 'RESUME', token });
                }
            }
            render();
        } else if (data.type === 'TAUNT') void playTaunt();
        else if (data.type === 'ERROR')
            if (data.code === 'NO_GAME') {
                room = ''; history.replaceState(null, '', location.pathname);
                notify('That room has closed. A new room was created.');
                send({ type: 'CREATE', gameType: 'fuck_you' });
            } else notify(data.error);
    };
    socket.onclose = () => {
        $('connection-status').textContent = 'Disconnected. Reconnecting…';
        document.body.classList.add('disconnected');
        window.setTimeout(connect, Math.min(10000, 1000 * 2 ** retry++));
    };
    socket.onerror = () => socket.close();
}
function preview(card: CardView, target: HTMLElement): void {
    if (!card.defId) return;
    const def = CARD_BY_ID[card.defId];
    const img = document.createElement('img'); img.src = image(def.id); img.alt = def.name;
    const box = target.getBoundingClientRect();
    const panel = $('preview'); panel.replaceChildren(img); panel.hidden = false;
    panel.style.left = `${Math.max(8, Math.min(innerWidth - panel.offsetWidth - 8, box.left))}px`;
    panel.style.top = `${Math.max(8, Math.min(innerHeight - panel.offsetHeight - 8, box.top - panel.offsetHeight - 15))}px`;
}
function cardButton(card: CardView): HTMLButtonElement {
    const button = document.createElement('button'); button.className = 'card'; button.type = 'button';
    button.dataset.iid = card.iid;
    const img = document.createElement('img');
    img.src = card.defId ? image(card.defId) : BACK;
    img.alt = card.defId ? CARD_BY_ID[card.defId].name : 'Hidden card';
    button.append(img);
    if (card.defId) button.title = `${CARD_BY_ID[card.defId].name}: ${CARD_BY_ID[card.defId].text}`;
    button.onmouseenter = () => preview(card, button);
    button.onfocus = () => preview(card, button);
    button.onmouseleave = button.onblur = () => {
        $('preview').hidden = true;
    };
    return button;
}
function render(): void {
    if (!sync) return;
    $('lobby').hidden = sync.started;
    $<HTMLButtonElement>('taunt').disabled = voiceContext === null || sync.youAre < 0;
    $('game').hidden = $('hud').hidden = $('log-panel').hidden = $('camera-controls').hidden = !sync.started;
    $('players').replaceChildren(...sync.seats.map((seat, i) => {
        const li = document.createElement('li');
        li.classList.toggle('not-ready', !seat.ready);
        const row = document.createElement('span'); row.className = 'player-row';
        const player = document.createElement('span');
        player.textContent = `${seat.username}${i === sync?.youAre ? ' (you)' : ''}`;
        const status = document.createElement('span'); status.className = 'player-ready';
        status.textContent = seat.ready ? 'Ready ✓' : 'Not ready';
        row.append(player, status); li.append(row);
        return li;
    }));
    $('start-game').hidden = !sync.isHost;
    $<HTMLButtonElement>('start-game').disabled = sync.seats.length < 2 || !sync.seats.every(seat => seat.ready);
    $('ready').textContent = sync.seats[sync.youAre]?.ready ? 'Unready' : 'Ready';
    if (!sync.view) {
        state = null; won = false; promptKey = '';
        clearTimeout(winTimer);
        dialog('win-modal').close(); dialog('choice').close();
        $('preview').hidden = true;
        $('flight-layer').replaceChildren();
        $<HTMLInputElement>('announce').checked = false;
        return;
    }
    const before = new Map<string, DOMRect>();
    document.querySelectorAll<HTMLElement>('[data-iid], [data-place]').forEach(el => {
        if (el.dataset.iid) before.set(el.dataset.iid, el.getBoundingClientRect());
        if (el.dataset.place) before.set(`place:${el.dataset.place}`, el.getBoundingClientRect());
    });
    const wasStarted = state !== null;
    state = sync.view;
    renderTable(); renderHand(); renderPrompt();
    $('log').replaceChildren(...state.log.map(text => {
        const p = document.createElement('p');
        p.textContent = text.replace(/Player (\d+)/g, (_, i) => name(Number(i) - 1));
        return p;
    }));
    $('log').scrollTop = $('log').scrollHeight;
    if (wasStarted) animate(state.events, before);
    if (state.winner !== null && !won) {
        won = true;
        $('win-title').textContent = state.winner === sync.youAre ? 'You win!' : `${name(state.winner)} wins!`;
        $('win-text').textContent = 'The final card and all its effects have resolved.';
        winTimer = window.setTimeout(() => dialog('win-modal').showModal(), wasStarted ? 650 : 0);
    }
}
function renderTable(): void {
    if (!state || !sync) return;
    const key = `${state.players.length}:${sync.youAre}`;
    if (key !== tableKey) {
        tableKey = key;
        const table = layout(state.players.length, { w: 230, h: 175 }, Math.max(0, sync.youAre));
        tableSize = contentSize(table, { w: 230, h: 175 });
        $('world').style.width = `${tableSize.w}px`; $('world').style.height = `${tableSize.h}px`;
        const extent = tableArtExtent(table.radius * .78);
        Object.assign($('table-art').style, {
            width: `${extent * 2}px`, height: `${extent * 2}px`,
            left: `${tableSize.w / 2 - extent}px`, top: `${tableSize.h / 2 - extent}px`
        });
        $('table-art').replaceChildren(tableArt(state.players.length === 2 ? 4 : state.players.length, table.radius * .78));
        $('center').style.left = `${tableSize.w / 2}px`; $('center').style.top = `${tableSize.h / 2}px`;
        if (!camera) camera = new CameraController({ frame: $('world-frame'), world: $('world'), content: () => tableSize });
        else camera.reset();
    }
    const center = $('center'); center.replaceChildren();
    const piles = document.createElement('div'); piles.className = 'center-piles';
    for (const place of ['deck', 'discard'] as const) {
        const pile = document.createElement('div'); pile.className = 'pile';
        const button = document.createElement('button'); button.type = 'button'; button.dataset.place = place;
        const img = document.createElement('img');
        img.src = place === 'deck' ? BACK : image(state.top.defId);
        img.alt = place === 'deck' ? 'Draw a card' : CARD_BY_ID[state.top.defId].name;
        if (place === 'discard') {
            button.dataset.iid = state.top.iid;
            const top = state.top;
            button.onmouseenter = button.onfocus = () => preview(top, button);
            button.onmouseleave = button.onblur = () => {
                $('preview').hidden = true;
            };
        } else {
            button.disabled = !canAct() || state.drawn !== null;
            button.onclick = () => move({ action: 'DRAW' });
        }
        button.append(img);
        const label = document.createElement('span');
        label.textContent = `${place === 'deck' ? 'Draw' : 'Discard'} · ${place === 'deck' ? state.deckCount : state.discardCount}`;
        pile.append(button, label); piles.append(pile);
    }
    const indicator = document.createElement('div'); indicator.className = 'color-indicator';
    const dot = document.createElement('span'); dot.className = `color-dot ${state.color}`;
    indicator.append(dot, document.createTextNode(`${state.color} ${state.direction === 1 ? '↻' : '↺'}`));
    center.append(piles, indicator);
    const table = layout(state.players.length, { w: 230, h: 175 }, Math.max(0, sync.youAre));
    const seatSpacing = (table.radius + 24) / table.radius;
    $('seats').replaceChildren(...state.players.map((player, i) => {
        const seat = document.createElement('div'); seat.className = `seat${state?.turn === i ? ' active' : ''}${player.revealed ? ' revealed' : ''}`;
        seat.style.left = `${tableSize.w / 2 + table.seats[i].anchor.x * seatSpacing}px`;
        seat.style.top = `${tableSize.h / 2 + table.seats[i].anchor.y * seatSpacing}px`;
        const rotation = table.seats[i].rotationDeg;
        const angle = ((rotation % 360) + 360) % 360;
        seat.style.setProperty('--seat-rotation', `${rotation}deg`);
        seat.style.setProperty('--label-flip', angle > 90 && angle < 270 ? '180deg' : '0deg');
        const label = document.createElement('h3');
        label.textContent = `${name(i)}${i === sync?.youAre ? ' (you)' : ''}${sync?.seats[i]?.connected ? '' : ' · offline'}`;
        const hand = document.createElement('div'); hand.className = 'seat-hand'; hand.dataset.place = String(i);
        for (const card of player.hand.slice(0, player.revealed ? player.hand.length : 8)) {
            const img = document.createElement('img'); img.src = card.defId ? image(card.defId) : BACK;
            img.alt = card.defId ? CARD_BY_ID[card.defId].name : 'Hidden card';
            if (i !== sync?.youAre) img.dataset.iid = card.iid;
            if (card.defId) {
                img.tabIndex = 0;
                img.onmouseenter = img.onfocus = () => preview(card, img);
                img.onmouseleave = img.onblur = () => {
                    $('preview').hidden = true;
                };
            }
            hand.append(img);
        }
        const count = document.createElement('p'); count.className = 'seat-count';
        count.textContent = `${player.count} card${player.count === 1 ? '' : 's'}${player.revealed ? ' · Revealed' : ''}`;
        seat.append(label, hand, count); return seat;
    }));
}
function canAct(): boolean {
    return state !== null && state.turn === sync?.youAre && state.winner === null && !state.waiting;
}
function renderHand(): void {
    if (!state || !sync) return;
    $('preview').hidden = true;
    $('hand').dataset.place = String(sync.youAre);
    const mine = state.players[sync.youAre];
    const view = state;
    $('hand').replaceChildren(...(mine?.hand ?? []).map(card => {
        const button = cardButton(card);
        const legal = state?.playable.includes(card.iid) ?? false;
        if (legal) button.classList.add('playable');
        button.setAttribute('aria-disabled', String(!legal));
        if (!legal && card.defId) {
            const def = CARD_BY_ID[card.defId];
            let reason = `Match ${view.color}, the number, or the symbol on the discard pile.`;
            if (view.winner !== null) reason = 'The game has ended.';
            else if (view.waiting) reason = 'Resolve the current card effect before playing from your hand.';
            else if (view.turn !== sync?.youAre) reason = 'Wait for your turn.';
            else if (view.drawn !== null && view.drawn !== card.iid) reason = 'You may only play the card you just drew, or pass.';
            else if (def.id === 'draw-four') reason = `You still have a ${view.color} card. Play it before Draw Four.`;
            else if ((def.effect.op === 'gift' && mine.count < 6) ||
                (def.effect.op === 'philanthropist' && mine.count < view.players.length + 2))
                reason = 'You need enough cards to give the gift and keep at least two afterward.';
            button.title = `${def.name}: ${reason}`;
        }
        button.onclick = () => {
            if (!legal) {
                notify(button.title); return;
            }
            play(card);
        };
        return button;
    }));
    let status = `${name(state.turn)}'s turn`;
    if (sync.youAre < 0) status += ' · You are watching';
    else if (state.turn === sync.youAre)
        status = state.drawn ? 'Play the drawn card or pass' : 'Your turn — match the color, number, or symbol';
    if (state.waiting) status = state.waiting.replace(/Player (\d+)/g, (_, i) => name(Number(i) - 1));
    if (state.winner !== null) status = `${name(state.winner)} won!`;
    $('turn-status').textContent = status;
    $<HTMLButtonElement>('draw').disabled = !canAct() || state.drawn !== null;
    $<HTMLButtonElement>('pass').disabled = !canAct() || state.drawn === null;
    $<HTMLButtonElement>('uno').disabled = state.vulnerable !== sync.youAre;
    $('catch').hidden = state.vulnerable === null || state.vulnerable === sync.youAre || sync.youAre < 0;
    $<HTMLInputElement>('announce').disabled = sync.youAre < 0 || state.winner !== null;
}
function play(card: CardView): void {
    const uno = $<HTMLInputElement>('announce').checked;
    const submit = (color?: Color): void => {
        move({ action: 'PLAY', iid: card.iid, color, uno });
        $<HTMLInputElement>('announce').checked = false;
    };
    if (card.defId && CARD_BY_ID[card.defId].color === null) {
        promptKey = `color:${card.iid}`;
        openChoice('Choose the active color', [...COLORS], value => value, values => submit(values[0] as Color));
    } else submit();
}
function openChoice(title: string, options: Array<string>, label: (value: string) => string,
    done: (values: Array<string>) => void, count = 1, cards = false, required = false): void {
    const modal = dialog('choice');
    $('choice-uno-label').hidden = true;
    $<HTMLInputElement>('choice-uno').checked = false;
    $('choice-title').textContent = title;
    $('choice-help').textContent = count > 1 ? `Select exactly ${count} cards, then confirm.` : 'Choose one option.';
    const selected = new Set<string>();
    $('choice-options').replaceChildren(...options.map(value => {
        const card = state?.players.flatMap(player => player.hand).find(c => c.iid === value);
        const button = cards && card ? cardButton(card) : document.createElement('button');
        if (!cards || !card) button.textContent = label(value);
        if (COLORS.includes(value as Color)) button.classList.add(value);
        button.onclick = () => {
            $('preview').hidden = true;
            if (count === 1) {
                modal.close(); done([value]); return;
            }
            if (selected.has(value)) selected.delete(value);
            else if (selected.size < count) selected.add(value);
            button.classList.toggle('selected', selected.has(value));
            button.setAttribute('aria-pressed', String(selected.has(value)));
            $<HTMLButtonElement>('choice-submit').disabled = selected.size !== count;
        };
        return button;
    }));
    $('choice-submit').hidden = count === 1;
    $<HTMLButtonElement>('choice-submit').disabled = true;
    $('choice-submit').onclick = () => {
        modal.close(); $('preview').hidden = true; done([...selected]);
    };
    $('choice-cancel').hidden = required;
    $('choice-cancel').onclick = () => {
        modal.close(); promptKey = '';
    };
    modal.oncancel = event => {
        if (required) event.preventDefault(); else promptKey = '';
    };
    if (!modal.open) modal.showModal();
}
function renderPrompt(): void {
    const prompt: Prompt | null = state?.prompt ?? null;
    if (!prompt) {
        if (promptKey && !promptKey.startsWith('color:')) {
            dialog('choice').close(); promptKey = '';
        }
        return;
    }
    const key = `prompt:${prompt.id}`;
    if (promptKey === key) return;
    promptKey = key;
    openChoice(prompt.text, prompt.options, value => prompt.kind === 'player' ? name(Number(value)) : value,
        selection => move({ action: 'RESPOND', promptId: prompt.id, selection, uno: $<HTMLInputElement>('choice-uno').checked }), prompt.count,
        prompt.kind === 'cards' || prompt.kind === 'play', true);
    $('choice-uno-label').hidden = prompt.kind !== 'play';
}
function animate(events: View['events'], before: Map<string, DOMRect>): void {
    if (!events.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const boxFor = (place: Place, iid: string, old: boolean): DOMRect | undefined => {
        if (old) return before.get(iid) ?? before.get(`place:${place}`);
        return document.querySelector<HTMLElement>(`[data-iid="${iid}"]`)?.getBoundingClientRect() ??
            document.querySelector<HTMLElement>(`[data-place="${place}"]`)?.getBoundingClientRect();
    };
    for (const [index, event] of events.entries()) {
        const from = boxFor(event.from, event.card.iid, true), to = boxFor(event.to, event.card.iid, false);
        if (!from || !to || !from.width || !to.width) continue;
        const ghost = document.createElement('div'); ghost.className = 'flight';
        const img = document.createElement('img'); img.src = event.card.defId ? image(event.card.defId) : BACK;
        ghost.append(img); $('flight-layer').append(ghost);
        const transform = (box: DOMRect): string => `translate(${box.x}px, ${box.y}px) scale(${Math.min(box.width, 103) / 103})`;
        const animation = ghost.animate([
            { transform: transform(from), opacity: 1 },
            { transform: `translate(${(from.x + to.x) / 2}px, ${(from.y + to.y) / 2 - 65}px) scale(.9)`, opacity: 1 },
            { transform: transform(to), opacity: .85 }
        ], { duration: 420, delay: Math.min(index * 25, 200), easing: 'ease-in-out', fill: 'both' });
        animation.onfinish = animation.oncancel = () => ghost.remove();
    }
}

$('copy-invite').onclick = () => {
    copyToClipboard(location.href); notify('Invite link copied.');
};
$('ready').onclick = () => send({ type: 'READY' });
$('start-game').onclick = () => move({ action: 'START_GAME' });
$('username-form').onsubmit = event => {
    event.preventDefault(); send({ type: 'USERNAME', username: $<HTMLInputElement>('username').value });
};
$('draw').onclick = () => move({ action: 'DRAW' });
$('pass').onclick = () => move({ action: 'PASS' });
$('uno').onclick = () => move({ action: 'UNO' });
$('catch').onclick = () => move({ action: 'CATCH' });
$('zoom-in').onclick = () => camera?.zoom(1.2);
$('zoom-out').onclick = () => camera?.zoom(1 / 1.2);
$('recenter').onclick = () => camera?.fit();
$('rules-button').onclick = () => dialog('rules-modal').showModal();
$('rules-close').onclick = () => dialog('rules-modal').close();
$('win-close').onclick = () => dialog('win-modal').close();
$('win-rematch').onclick = () => move({ action: 'RETURN_TO_LOBBY' });
$('taunt').onclick = () => {
    const now = Date.now();
    taunts = taunts.filter(time => time > now - 1000);
    if (taunts.length >= 3) return;
    taunts.push(now);
    move({ action: 'TAUNT' });
};
for (const def of CARDS) {
    const entry = document.createElement('div'); entry.className = 'catalog-card';
    const img = document.createElement('img'); img.src = image(def.id); img.alt = def.name; img.loading = 'lazy';
    const title = document.createElement('b'); title.textContent = `${def.name[0].toUpperCase()}${def.name.slice(1)} ×${def.copies}`;
    const text = document.createElement('p'); text.textContent = def.text;
    entry.append(img, document.createElement('br'), title, text); $('catalog').append(entry);
}
if (mock === null) connect();
else try {
    const count = Number(mock);
    const engine = new Engine(count);
    sync = {
        type: 'SYNC', started: true, youAre: 0, isHost: false,
        seats: Array.from({ length: count }, (_, i) => ({ username: `Player ${i + 1}`, ready: true, connected: true })),
        view: engine.view(0)
    };
    $('connection-status').textContent = '';
    render();
    $('turn-status').textContent = `Mock table · ${count} players · Offline preview`;
} catch {
    $('connection-status').textContent = 'Mock preview requires a whole number of players from 2 to 8. Use ?mock=4.';
}
