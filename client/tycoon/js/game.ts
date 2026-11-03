import { strength, TITLE_LABELS, TITLES } from './cards.js';
import { checkPlay, Engine } from './engine.js';
import type { CardView, Move, Sync, View } from './types.js';
import { createCardElement, label } from './ui/card-element.js';
import { FlightQueue } from './ui/flights.js';
import { leaderboard, setName } from './ui/leaderboard.js';
import { splash } from './ui/fx.js';
import { CameraController } from './ui/camera-input.js';
import { layout, contentSize } from './ui/polygon.js';
import { tableArt, tableArtExtent } from './ui/table-art.js';

declare function createConnection(): WebSocket;
declare function copyToClipboard(text: string): void;
interface NativeDialog extends HTMLDialogElement {
    open: boolean; showModal(): void; close(): void; oncancel: ((event: Event) => void) | null;
}
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const dialog = (id: string): NativeDialog => $<NativeDialog>(id);
let socket: WebSocket;
let room = location.search.slice(1), retry = 0, resumeSent = false;
let sync: Sync | null = null, state: View | null = null, completed: View | null = null;
let resultKey = '', noticeTimer = 0;
const selected = new Set<string>();
const mock = new URLSearchParams(location.search).get('mock');
let tableSize = { w: 1200, h: 1200 }, camera: CameraController | null = null;
const flights = new FlightQueue(renderTable, busy => {
    document.body.classList.toggle('animating', flights.blocksInput); updateControls();
    if (!busy && state) {
        splash(completed, state); completed = state; showDialogs();
    }
});
function letteringRandom(text: string): () => number {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    return () => {
        hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0;
        return hash / 0x100000000;
    };
}
function setLetterFonts(letters: Iterable<HTMLElement>, random: () => number): void {
    let previous = -1, run = 0;
    for (const letter of letters) {
        let font = random() < 0.5 ? 0 : 1;
        if (font === previous && run === 2) font = 1 - font;
        run = font === previous ? run + 1 : 1;
        previous = font;
        letter.style.fontFamily = font === 0 ? '"Times New Roman", serif' : '"Luckiest Guy", sans-serif';
        letter.style.fontWeight = font === 0 ? '700' : '400';
    }
}
function setButtonLabel(button: HTMLButtonElement, text: string): void {
    if (button.dataset.buttonLabel === text) return;
    if (button.classList.contains('button-plain') || button.classList.contains('button-action')) {
        if (button.classList.contains('button-action')) button.querySelector<HTMLElement>('.action-label')!.textContent = text;
        else button.textContent = text;
        button.dataset.buttonLabel = text;
        return;
    }
    const random = letteringRandom(text);
    const characters = [...text];
    button.classList.toggle('single-character', [...text.trim()].length === 1);
    const indices = characters.flatMap((character, index) => /\p{L}/u.test(character) ? [index] : []);
    const boxed = indices[Math.floor(random() * indices.length)];
    const lettering = document.createElement('span'); lettering.className = 'button-label';
    lettering.append(...characters.map((character, index) => {
        const letter = document.createElement('span');
        letter.className = 'button-letter'; letter.textContent = character;
        letter.classList.toggle('boxed', index === boxed);
        letter.style.setProperty('--letter-angle', `${random() * 16 - 8}deg`);
        letter.style.setProperty('--letter-scale', String(0.9 + random() * 0.2));
        return letter;
    }));
    setLetterFonts(lettering.querySelectorAll<HTMLElement>('.button-letter'), random);
    const overlay = document.createElement('span');
    overlay.className = 'button-hover'; overlay.setAttribute('aria-hidden', 'true');
    overlay.append(lettering.cloneNode(true));
    button.replaceChildren(lettering, overlay);
    button.dataset.buttonLabel = text;
}
function notify(text: string): void {
    $('notice').textContent = text; $('notice').hidden = false; clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => {
        $('notice').hidden = true;
    }, 5000);
}
function send(message: Record<string, unknown>): void {
    if (mock !== null) return notify('Mock preview only. Remove ?mock=4 to play online.');
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    else notify('Connection lost. Wait for reconnection.');
}
function move(data: Move): void {
    send({ type: 'MOVE', ...data });
}
function name(seat: number): string {
    return sync?.seats[seat]?.username ?? `Player ${seat + 1}`;
}
function remember(value?: string): string | null {
    try {
        if (value !== undefined) sessionStorage.setItem(`tycoon:${room}`, value);
        return sessionStorage.getItem(`tycoon:${room}`);
    } catch {
        return null;
    }
}
function accept(data: Sync): void {
    const wasStarted = sync?.started; sync = data;
    $('lobby').hidden = data.started; $('game').hidden = !data.started;
    if (data.token) remember(data.token);
    if (data.started && data.youAre < 0 && !resumeSent && mock === null) {
        const token = remember();
        if (token) {
            resumeSent = true; send({ type: 'MOVE', action: 'RESUME', token });
        }
    }
    if (!data.started) {
        flights.reset(); state = completed = null; selected.clear(); resultKey = '';
        $('preview').hidden = true;
        dialog('results').close(); dialog('exchange-dialog').close(); renderLobby();
    } else if (data.view) {
        if (!wasStarted) {
            tableSize = contentSize(layout(4, { w: 360, h: 170 }, data.youAre < 0 ? 0 : data.youAre),
                { w: 360, h: 170 });
            $('table-world').style.width = `${tableSize.w}px`; $('table-world').style.height = `${tableSize.h}px`;
            if (!camera) camera = new CameraController({
                frame: $('table-viewport'), world: $('table-world'), content: () => tableSize,
                home: () => ({ top: tableSize.h / 2 - 100, bottom: tableSize.h - 20 })
            });
            camera.reset();
        }
        flights.enqueue(data.view);
    }
}
function connect(): void {
    $('connection-status').hidden = false;
    $('connection-status').textContent = retry ? 'Reconnecting… Your seat is held.' : 'Connecting…';
    document.body.classList.add('disconnected'); socket = createConnection(); resumeSent = false;
    socket.onopen = () => {
        retry = 0; $('connection-status').hidden = true; document.body.classList.remove('disconnected');
        send(room ? { type: 'JOIN', gameID: room } : { type: 'CREATE', gameType: 'tycoon' });
    };
    socket.onmessage = event => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch {
            return notify('Invalid server response.');
        }
        if (data.type === 'UUID') {
            room = data.uuid; history.replaceState(null, '', `?${room}`);
            $<HTMLInputElement>('invite').value = location.href;
        } else if (data.type === 'SYNC') accept(data as Sync);
        else if (data.type === 'ERROR')
            if (data.code === 'NO_GAME') {
                room = ''; history.replaceState(null, '', location.pathname);
                notify('That room has closed. A new room was created.'); send({ type: 'CREATE', gameType: 'tycoon' });
            } else notify(data.error);
    };
    socket.onclose = () => {
        document.body.classList.add('disconnected'); $('connection-status').hidden = false;
        $('connection-status').textContent = 'Disconnected. Reconnecting…';
        window.setTimeout(connect, Math.min(10000, 1000 * 2 ** retry++)); updateControls();
    };
    socket.onerror = () => socket.close();
}
function renderLobby(): void {
    if (!sync) return;
    $('seat-list').replaceChildren();
    for (const [index, seat] of sync.seats.entries()) {
        const row = document.createElement('li'); row.classList.toggle('local', index === sync.youAre);
        const username = document.createElement('strong'); username.textContent = seat.username;
        const status = document.createElement('span');
        status.textContent = seat.ai ? 'AI (player replaces)' : seat.ready ? 'Ready ✓' : 'Not ready';
        row.append(username, status); $('seat-list').append(row);
    }
    $<HTMLInputElement>('rounds').value = String(sync.settings.rounds);
    $<HTMLInputElement>('jokers').checked = sync.settings.jokers;
    for (const id of ['rounds', 'jokers']) $<HTMLInputElement>(id).disabled = !sync.isHost;
    $('round-chips').replaceChildren();
    for (const n of [1, 2, 3, 5, 8, 10]) {
        const chip = document.createElement('button'); chip.className = 'button-plain'; setButtonLabel(chip, String(n));
        chip.classList.toggle('selected', n === sync.settings.rounds); chip.disabled = !sync.isHost;
        chip.onclick = () => {
            $<HTMLInputElement>('rounds').value = String(n); options();
        };
        $('round-chips').append(chip);
    }
    $<HTMLButtonElement>('start').disabled = !sync.isHost || !sync.seats.every(s => s.ready);
    setButtonLabel($<HTMLButtonElement>('ready'), sync.seats[sync.youAre]?.ready ? 'Not ready' : 'Ready');
}
function options(): void {
    const input = $<HTMLInputElement>('rounds'); const raw = Number(input.value);
    const rounds = Math.max(1, Math.min(20, Math.round(Number.isFinite(raw) ? raw : 5)));
    if (!input.value || rounds !== raw) notify('Rounds must be a whole number from 1 to 20.');
    input.value = String(rounds);
    send({ type: 'MOVE', action: 'SET_OPTIONS', rounds, jokers: $<HTMLInputElement>('jokers').checked });
}
function sorted(hand: Array<CardView>): Array<CardView> {
    return [...hand].sort((a, b) => (a.value === null ? 0 : strength(a)) -
        (b.value === null ? 0 : strength(b)) || (a.suit ?? '').localeCompare(b.suit ?? ''));
}
function selectable(card: CardView): boolean {
    if (!state || state.youAre < 0 || flights.blocksInput) return false;
    if (state.exchange) return true;
    if (!state.playable.includes(card.iid)) return false;
    if (selected.has(card.iid)) return true;
    const cards = state.hands[state.youAre].filter(c => selected.has(c.iid));
    return cards.length < 4 && (card.joker || cards.every(c => c.joker || c.value === card.value));
}
function choose(card: CardView, rank = false): void {
    if (!state || !selectable(card)) return;
    if (rank && !state.exchange) {
        selected.clear();
        const matching = state.hands[state.youAre].filter(c => c.value === card.value && c.joker === card.joker);
        for (const c of matching.slice(0, 4)) selected.add(c.iid);
    } else if (selected.has(card.iid)) selected.delete(card.iid);
    else selected.add(card.iid);
    updateControls(); showExchange();
}
function showPreview(card: CardView, anchor: HTMLElement): void {
    const preview = $('preview');
    if (card.value === null) return;
    const rect = anchor.getBoundingClientRect();
    preview.replaceChildren(createCardElement(card)); preview.hidden = false;
    preview.style.left = `${Math.max(8, Math.min(innerWidth - 138, rect.left + rect.width / 2 - 65))}px`;
    preview.style.top = `${Math.max(8, rect.top - 192)}px`;
}
function handCard(card: CardView, own: boolean): HTMLElement {
    const face = createCardElement(card);
    if (!own) return face;
    const button = document.createElement('button'); button.className = 'hand-card'; button.dataset.iid = card.iid;
    delete face.dataset.iid; button.append(face); button.setAttribute('aria-label', face.getAttribute('aria-label') ?? 'Card');
    button.setAttribute('aria-pressed', String(selected.has(card.iid)));
    button.classList.toggle('selected', selected.has(card.iid)); button.classList.toggle('unplayable', !selectable(card));
    button.onclick = () => choose(card); button.ondblclick = () => choose(card, true);
    button.onpointerenter = event => {
        if (event.pointerType !== 'touch') showPreview(card, button);
    };
    button.onfocus = () => showPreview(card, button);
    button.onpointerleave = button.onblur = () => {
        $('preview').hidden = true;
    };
    if (state?.exchange?.received.includes(card.iid)) {
        const badge = document.createElement('small');
        badge.textContent = `From ${TITLE_LABELS[state.titles[state.exchange.to] ?? 'beggar'].en}`;
        button.append(badge);
    }
    return button;
}
function renderTable(view: View): void {
    if (!sync) return;
    state = view;
    const own = view.hands[view.youAre] ?? [];
    for (const iid of selected) if (!own.some(c => c.iid === iid)) selected.delete(iid);
    const focus = document.activeElement as HTMLElement | null;
    const focusIID = focus?.dataset.iid;
    $('preview').hidden = true;
    const localHand = $('local-hand'), scroll = localHand.scrollLeft;
    localHand.dataset.zone = `hand-${view.youAre}`; localHand.hidden = view.youAre < 0;
    localHand.replaceChildren(...sorted(own).map(c => handCard(c, true))); localHand.scrollLeft = scroll;
    const highlight = $('turn-highlight');
    const previousStyle = getComputedStyle(highlight);
    const highlightFrom = highlight.hidden ? null : { left: previousStyle.left, top: previousStyle.top,
        height: previousStyle.height, transform: previousStyle.transform };
    const world = $('table-world'); world.replaceChildren(highlight); world.classList.toggle('revolution', view.revolution);
    const geometry = layout(4, { w: 360, h: 170 }, view.youAre < 0 ? 0 : view.youAre);
    const active = geometry.seats[view.turn];
    const previousAngle = Number(highlight.dataset.angle ?? active.rotationDeg);
    const highlightAngle = active.rotationDeg + 360 * Math.round((previousAngle - active.rotationDeg) / 360);
    const next = { left: `${tableSize.w / 2 + active.anchor.x - 210}px`,
        top: `${tableSize.h / 2 + active.anchor.y - 90}px`,
        height: view.turn === view.youAre ? '170px' : '270px', transform: `rotate(${highlightAngle}deg)` };
    Object.assign(highlight.style, next); highlight.hidden = view.phase !== 'play';
    if (highlightFrom && !highlight.hidden && highlight.dataset.seat !== String(view.turn)) {
        for (const animation of highlight.getAnimations()) animation.cancel();
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
            highlight.animate([highlightFrom, next], { duration: 350, easing: 'ease-in-out' });
    }
    highlight.dataset.seat = String(view.turn); highlight.dataset.angle = String(highlightAngle);
    const art = tableArt(4, geometry.radius); art.classList.add('table-art');
    art.style.left = `${tableSize.w / 2}px`; art.style.top = `${tableSize.h / 2}px`;
    art.style.width = art.style.height = `${tableArtExtent(geometry.radius) * 2}px`; world.append(art);
    for (const [seat, placement] of geometry.seats.entries()) {
        const area = document.createElement('section'); area.className = 'seat';
        if (seat !== view.youAre) area.dataset.zone = `hand-${seat}`;
        area.style.left = `${tableSize.w / 2 + placement.anchor.x}px`;
        area.style.top = `${tableSize.h / 2 + placement.anchor.y}px`;
        area.style.setProperty('--seat-angle', `${placement.rotationDeg}deg`);
        const angle = (placement.rotationDeg % 360 + 360) % 360;
        const labels = document.createElement('div'); labels.className = 'seat-labels';
        labels.style.transform = angle > 90 && angle < 270 ? 'rotate(180deg)' : 'none';
        const heading = document.createElement('h3');
        heading.textContent = `${name(seat)}${seat === view.youAre ? ' (you)' : ''}${sync.seats[seat].ai ? ' · AI' : ''}`;
        const count = document.createElement('span'); count.dataset.count = `hand-${seat}`; count.textContent = String(view.counts[seat]);
        heading.append(' · ', count, ' cards'); labels.append(heading);
        const status = document.createElement('p');
        status.textContent = view.bankrupt === seat ? '都落ち BANKRUPT' : view.out.includes(seat) ? 'OUT'
            : view.passed.includes(seat) ? 'パス PASS' : seat === view.turn ? 'TURN' : '';
        const currentTitle = view.bankrupt === seat ? 'beggar' : view.out.includes(seat)
            ? TITLES[view.out.indexOf(seat)] : view.titles[seat];
        if (currentTitle) {
            const title = TITLE_LABELS[currentTitle]; status.append(label(title.jp, title.en));
        }
        labels.append(status); area.append(labels);
        if (seat !== view.youAre) {
            const hand = document.createElement('div'); hand.className = 'hand';
            for (const card of view.hands[seat].slice(0, 14)) hand.append(handCard(card, false));
            area.append(hand);
        }
        world.append(area);
    }
    const center = document.createElement('section'); center.className = 'table-center';
    center.style.left = `${tableSize.w / 2}px`; center.style.top = `${tableSize.h / 2}px`;
    const description = document.createElement('p'); description.textContent = view.table ? `${setName(view)} · ${name(view.table.owner)}` : `Lead: ${name(view.leader)}`;
    center.append(description);
    if (view.previous && !view.tablePile.some(c => view.previous?.cards.some(p => p.iid === c.iid))) {
        const previous = document.createElement('div'); previous.className = 'previous-set';
        for (const card of view.previous.cards) {
            const face = createCardElement(card); delete face.dataset.iid; previous.append(face);
        }
        center.append(previous);
    }
    for (const zone of ['deck', 'table', 'discard']) {
        const pile = document.createElement('div'); pile.dataset.zone = zone; pile.className = `pile ${zone}`;
        const cards = zone === 'table' ? view.tablePile : zone === 'discard' ? view.discard : [];
        for (const card of cards) {
            const face = createCardElement(zone === 'discard' ? { ...card, value: null, joker: null, suit: null } : card);
            face.classList.toggle('older-set', zone === 'table' && !view.table?.cards.some(c => c.iid === card.iid));
            if (zone === 'table') {
                const index = view.table?.cards.findIndex(c => c.iid === card.iid) ?? -1;
                if (index >= 0) {
                    face.style.left = `${index * 25}px`; face.style.transform = `rotate(${index * 5 - 7}deg)`;
                }
            }
            face.style.zIndex = String(cards.indexOf(card)); pile.append(face);
        }
        if (zone !== 'table') {
            if (zone === 'deck' && view.deckCount) pile.append(createCardElement({ iid: 'deck-back', value: null, suit: null, joker: null }));
            const caption = document.createElement('p'); caption.append(zone === 'deck' ? 'DECK ' : 'DISCARD ');
            const count = document.createElement('span'); count.dataset.count = zone;
            count.textContent = String(zone === 'deck' ? view.deckCount : view.discard.length); caption.append(count); pile.append(caption);
        }
        center.append(pile);
    }
    if (view.revolution) center.append(label('革命', 'REVOLUTION'));
    world.append(center); leaderboard($('leaderboard'), sync, view);
    const log = $('game-log');
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 8;
    log.replaceChildren();
    for (const line of view.log) {
        const li = document.createElement('li'); li.textContent = line;
        li.classList.toggle('round-start', /^Round \d+ \/ \d+$/.test(line)); log.append(li);
    }
    if (atBottom) log.scrollTop = log.scrollHeight;
    if (focusIID) localHand.querySelector<HTMLElement>(`[data-iid="${focusIID}"]`)?.focus({ preventScroll: true });
    updateControls();
}
function updateControls(): void {
    if (!state) return;
    const seated = state.youAre >= 0;
    $('hand-controls').hidden = !seated || state.phase !== 'play';
    const connected = mock !== null || socket?.readyState === WebSocket.OPEN;
    const turn = seated && state.turn === state.youAre && state.phase === 'play' && !flights.blocksInput && connected;
    for (const button of document.querySelectorAll<HTMLElement>('#local-hand .hand-card')) {
        const card = state.hands[state.youAre]?.find(c => c.iid === button.dataset.iid);
        if (!card) continue;
        button.classList.toggle('selected', selected.has(card.iid));
        button.classList.toggle('unplayable', !selectable(card));
        button.setAttribute('aria-pressed', String(selected.has(card.iid)));
    }
    const validation = checkPlay(state, state.youAre, [...selected]);
    $<HTMLButtonElement>('play').disabled = !turn || !('ok' in validation);
    $('play-reason').textContent = !connected ? 'Disconnected. Reconnecting…' : flights.blocksInput
        ? 'Wait for the cards to finish moving.' : 'error' in validation ? validation.error : '';
    setButtonLabel($<HTMLButtonElement>('play'), `Play${selected.size ? ` ${selected.size} Cards` : ''}`);
    $<HTMLButtonElement>('pass').disabled = !turn || !state.table;
    $<HTMLButtonElement>('clear').disabled = !selected.size || flights.blocksInput;
    $<HTMLButtonElement>('exchange-confirm').disabled = flights.busy || !connected || selected.size !== state.exchange?.count;
    const donor = state.titles[state.youAre];
    const exchangeNotice = donor === 'beggar' || donor === 'poor'
        ? `Your highest ${donor === 'beggar' ? 2 : 1} card(s) go to ${name(state.titles.indexOf(donor === 'beggar' ? 'tycoon' : 'rich'))}`
        : 'Class exchange in progress…';
    $('turn-status').textContent = flights.busy ? 'Cards in motion…' : state.exchange
        ? `Exchange: choose ${state.exchange.count} cards to give to ${name(state.exchange.to)}`
        : state.phase === 'exchange' ? exchangeNotice
            : !seated ? 'Watching · Your view contains no private hands'
                : state.phase !== 'play' ? 'Round complete'
                    : state.turn === state.youAre ? state.table ? `Beat the ${setName(state)} or pass` : 'Your turn — lead any set'
                        : `Waiting for ${name(state.turn)}…`;
    if (state.revolution) $('turn-status').append(' · Values inverted · Hand remains in normal order');
}
function showExchange(): void {
    if (!state?.exchange || flights.busy) {
        dialog('exchange-dialog').close(); return;
    }
    const focusedIID = dialog('exchange-dialog').contains(document.activeElement)
        ? (document.activeElement as HTMLElement | null)?.dataset.iid : undefined;
    $('exchange-heading').textContent = `Choose ${state.exchange.count} cards for ${name(state.exchange.to)}`;
    $('exchange-hand').replaceChildren(...sorted(state.hands[state.youAre]).map(c => handCard(c, true)));
    if (!dialog('exchange-dialog').open) dialog('exchange-dialog').showModal();
    if (focusedIID) $('exchange-hand').querySelector<HTMLElement>(`[data-iid="${focusedIID}"]`)?.focus();
}
function showDialogs(): void {
    if (!state) return;
    showExchange();
    const end = state.phase === 'gameEnd', key = `${state.round}:${state.phase}`;
    $('table-rematch').hidden = !end || state.youAre < 0;
    if (!['roundEnd', 'gameEnd'].includes(state.phase)) {
        dialog('results').close(); return;
    }
    if (resultKey === key) return; resultKey = key;
    $('results-heading').textContent = end ? `WINNER${state.winners.length > 1 ? 'S' : ''}: ${state.winners.map(name).join(' & ')}` : `ROUND ${state.round} COMPLETE`;
    $('results-body').replaceChildren();
    for (const seat of [0, 1, 2, 3].sort((a, b) => (state?.scores[b] ?? 0) - (state?.scores[a] ?? 0))) {
        const row = document.createElement('p'); const title = TITLE_LABELS[state.titles[seat] ?? 'beggar'];
        const gain = Math.max(0, 3 - state.out.indexOf(seat)), finalScore = state.scores[seat];
        const total = document.createElement('strong'); total.textContent = String(finalScore);
        row.append(label(title.jp, title.en), ` ${name(seat)} · +${gain} · Total `, total);
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
            const start = performance.now();
            const tick = (now: number): void => {
                const progress = Math.min(1, (now - start) / 650);
                total.textContent = String(finalScore - gain + Math.round(gain * progress));
                if (progress < 1 && total.isConnected) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        }
        row.classList.toggle('winner', end && state.winners.includes(seat)); $('results-body').append(row);
    }
    if (state.bankrupt !== null) {
        const bankruptcy = document.createElement('p'); bankruptcy.textContent = `都落ち BANKRUPTCY · ${name(state.bankrupt)}`;
        $('results-body').append(bankruptcy);
    }
    if (!end) $('results-body').append('Continues after all connected humans confirm, or about 8 seconds.');
    $('continue').hidden = end || state.youAre < 0; $('back-lobby').hidden = !end || state.youAre < 0;
    $<HTMLButtonElement>('continue').disabled = false;
    dialog('results').showModal();
}
$<HTMLDetailsElement>('log-panel').ontoggle = () => {
    if ($<HTMLDetailsElement>('log-panel').open) requestAnimationFrame(() => {
        $('game-log').scrollTop = $('game-log').scrollHeight;
    });
};
$('local-hand').onscroll = $('exchange-hand').onscroll = () => {
    $('preview').hidden = true;
};
$('name-form').onsubmit = event => {
    event.preventDefault(); send({ type: 'USERNAME', username: $<HTMLInputElement>('username').value });
};
const titleLetters = document.querySelectorAll<HTMLElement>('.title-en > span');
setLetterFonts(titleLetters, letteringRandom([...titleLetters].map(letter => letter.textContent).join('')));
for (const button of document.querySelectorAll<HTMLButtonElement>('button:not(.hand-card)'))
    setButtonLabel(button, button.textContent ?? '');
document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('button:not(.hand-card)');
    if (!button || button.disabled || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    button.animate([{ rotate: '0deg' }, { rotate: '-5deg' }, { rotate: '5deg' }, { rotate: '0deg' }], { duration: 180 });
}, { capture: true });
$<HTMLInputElement>('invite').value = location.href;
$('invite').onclick = () => $<HTMLInputElement>('invite').select();
$('copy-invite').onclick = () => {
    copyToClipboard(location.href); notify('Invite copied.');
};
$('ready').onclick = () => send({ type: 'READY' });
$('start').onclick = () => move({ action: 'START_GAME' });
$('rounds').onchange = options; $('jokers').onchange = options;
$('play').onclick = () => {
    move({ action: 'PLAY', iids: [...selected] }); selected.clear(); updateControls();
};
$('pass').onclick = () => {
    move({ action: 'PASS' }); selected.clear(); updateControls();
};
$('clear').onclick = () => {
    selected.clear(); updateControls();
};
$('exchange-confirm').onclick = () => {
    move({ action: 'EXCHANGE', iids: [...selected] }); selected.clear(); updateControls();
};
$('continue').onclick = () => {
    move({ action: 'CONTINUE' }); $<HTMLButtonElement>('continue').disabled = true;
};
for (const id of ['back-lobby', 'table-rematch']) $(id).onclick = () => move({ action: 'RETURN_TO_LOBBY' });
$('rules-open').onclick = () => dialog('rules').showModal(); $('rules-close').onclick = () => dialog('rules').close();
dialog('rules').onclick = event => {
    const rules = dialog('rules'), bounds = rules.getBoundingClientRect();
    if (event.target === rules && (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom)) rules.close();
};
dialog('exchange-dialog').oncancel = event => event.preventDefault();
$('camera-reset').onclick = () => camera?.reset(); $('camera-fit').onclick = () => camera?.fit();
$('zoom-in').onclick = () => camera?.zoom(1.2); $('zoom-out').onclick = () => camera?.zoom(1 / 1.2);
if (mock !== null) {
    $('connection-status').textContent = 'MOCK PREVIEW';
    const engine = new Engine();
    accept({ type: 'SYNC', started: true, youAre: 0, isHost: true, settings: { rounds: 5, jokers: true },
        seats: ['You', 'Ann', 'CPU 1', 'CPU 2'].map((username, i) => ({ username, ready: true, connected: true, ai: i >= 2 })),
        view: engine.view(0, Infinity) });
} else connect();
