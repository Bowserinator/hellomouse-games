import { BabyModal } from './ui/baby.js';
import { CameraController } from './ui/camera-input.js';
import { CenterView } from './ui/center.js';
import { ChainBanner } from './ui/chain-banner.js';
import { ConfirmModal } from './ui/confirm.js';
import { TargetModal, targetWarning } from './ui/target-modal.js';
import { HandView, handInteraction } from './ui/hand.js';
import { applyHint, hints } from './ui/indicators.js';
import { Preview } from './ui/preview.js';
import { PromptModal } from './ui/prompt.js';
import { flyCard, showNeighWarning } from './ui/flight.js';
import { contentSize, layout } from './ui/polygon.js';
import type { TableLayout } from './ui/polygon.js';
import { seatElement, StatusTooltip } from './ui/seat.js';
import { tableArt, tableArtExtent } from './ui/table-art.js';
import { describeEvent } from './ui/log.js';
import { mockHandDefaults, mockView } from './ui/mock.js';
import { cardEntry, cardName } from './ui/card.js';
import { bindEffectToast, effectToast } from './ui/effect-toast.js';
import { canDraw } from './next-step.js';
import type { Answer } from './ui/prompt.js';
import type { PromptView, ViewModel } from './engine/view.js';
import type { LoggedEvent } from './engine/events.js';
import { DEFAULT_PACK, PACKS } from './catalog/index.js';
import { WILDCARD } from './vars.js';

interface SeatSync {
    username: string | null;
    ready: boolean;
    connected: boolean;
}

interface SyncMessage {
    type: string;
    error?: string;
    code?: string;
    started?: boolean;
    youAre?: number;
    isHost?: boolean;
    seats?: Array<SeatSync>;
    packs?: Array<string>;
    packNames?: Array<string>;
    minPlayers?: number;
    maxPlayers?: number;
    view?: ViewModel;
    events?: Array<LoggedEvent>;
}

const CARD_SIZE = { w: 143, h: 198 };
const MOCK_PLAYERS = Number(new URLSearchParams(window.location.search).get('mock') ?? '0');
const uuid = window.location.search.substr(1).split('=')[0];

// @ts-expect-error
let connection = createConnection();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const lobby = $('lobby');
const gameDiv = $('game');
const worldFrame = $('world-frame');
const world = $('world');
const artHost = $('table-art');
const seatsHost = $('seats');
const centerHost = $('center');
const bannerHost = $('chain-banner');
const handHost = $('hand');
const hud = $('hud');
const previewHost = $('preview-layer');
const flightLayer = $('flight-layer');
const logHost = $('log');
const logPanel = $('log-panel');
const logToggle = $('log-toggle') as HTMLButtonElement;
const logBadge = $('log-unread');
const chat = $('chat');
const chatToggle = $('chat-toggle') as HTMLButtonElement;
const chatBadge = $('chat-unread');
const chatHost = $('messages');
const chatInput = $('chat-input') as HTMLInputElement;
const playerList = $('lobby-player-list');
const packList = $('packs');
const startButton = $('start-game') as HTMLButtonElement;
const readyButton = $('ready') as HTMLButtonElement;
const usernameInput = $('username') as HTMLInputElement;
const inviteLink = $('link');
const winModal = $('win-modal');
const winText = $('win-text');
const rulesModal = $('rules-modal');
const disconnectBanner = $('disconnect-banner');
const endTurnButton = $('end-turn') as HTMLButtonElement;
const recenterButton = $('recenter') as HTMLButtonElement;
const zoomInButton = $('zoom-in') as HTMLButtonElement;
const zoomOutButton = $('zoom-out') as HTMLButtonElement;
const noteHost = $('game-note');
const hudBanner = $('hud-banner');

let view: ViewModel | null = null;
let names: Array<string | null> = [];
let connected: Array<boolean> = [];
let seats: Array<SeatSync> = [];
let youAre = 0;
let isHost = false;
let selectedHand: string | null = null;
let selectedTarget: number | null = null;
let pendingPlay: { iid: string; target: number | null } | null = null;
let picks: Array<string> = [];
let lastSeq = 0;
let lastTurn = -1;
let tableLayout: TableLayout | null = null;
let tableCount = -1;
let prevRects = new Map<string, DOMRect>();
let pendingRects: Map<string, DOMRect> | null = null;
const moved = new Set<string>();
let logOpen = false;
let logUnread = 0;
let chatOpen = false;
let chatUnread = 0;

const center = new CenterView(centerHost);
const banner = new ChainBanner(bannerHost);
const hand = new HandView(handHost);
const preview = new Preview(previewHost);
const statusTooltip = new StatusTooltip(document.body);
let camera: CameraController | null = null;

seatsHost.addEventListener('pointermove', event => {
    const item = (event.target as HTMLElement | null)?.closest<HTMLElement>('.seat-status li[data-tip]');
    const text = item?.dataset.tip;
    if (text) statusTooltip.show(text, event.clientX + 16, event.clientY);
    else statusTooltip.hide();
});
seatsHost.addEventListener('pointerleave', () => statusTooltip.hide());

bindEffectToast($('effect-toast'));

const promptModal = new PromptModal($('prompt-body'), (answer: Answer) => {
    if (!view?.prompt) return;
    if (answer === 'cancel') sendMove('CANCEL_PROMPT', { promptId: view.prompt.id });
    else sendMove('RESPOND', { promptId: view.prompt.id, selection: answer });
}, () => names, () => view?.players.map(player => player.handCount) ?? []);

const babyModal = new BabyModal($('baby-overlay'), $('baby-modal'), (iid: string) => {
    sendMove('PICK_BABY', { iid });
});

const confirmModal = new ConfirmModal($('confirm-body'), () => {
    if (!pendingPlay) return;
    const play = pendingPlay;
    sendMove('PLAY_CARD', play.target !== null ? { iid: play.iid, target: play.target } : { iid: play.iid });
    selectionReset();
    note('');
    render();
});

const targetModal = new TargetModal($('target-body'), () => names, seat => {
    if (!view || selectedHand === null) return;
    selectedTarget = seat;
    note(`Target set to ${nameOf(seat)}.`);
    render();
    playHandCard(selectedHand);
}, () => {
    selectedHand = null;
    selectedTarget = null;
    note('');
    render();
});

function sendMove(action: string, extra: Record<string, unknown> = {}) {
    if (MOCK_PLAYERS > 0) return;
    connection.send(JSON.stringify({ type: 'MOVE', action, ...extra }));
}

function note(text: string): void {
    if (!noteHost) return;
    noteHost.textContent = text;
    noteHost.hidden = text === '';
}

function setLogUnread(count: number): void {
    logUnread = count;
    logBadge.hidden = count === 0;
    logBadge.textContent = count > 99 ? '99+' : String(count);
}

function setLogOpen(open: boolean): void {
    logOpen = open;
    logPanel.dataset.state = open ? 'open' : 'collapsed';
    logToggle.setAttribute('aria-expanded', String(open));
    logHost.hidden = !open;
    if (open) {
        setLogUnread(0);
        logHost.scrollTop = logHost.scrollHeight;
    }
}

function chatLabel(): string {
    if (chatOpen) return 'Close chat';
    return chatUnread > 0 ? `Open chat, ${chatUnread} unread` : 'Open chat';
}

function setChatUnread(count: number): void {
    chatUnread = count;
    chatBadge.hidden = count === 0;
    chatBadge.textContent = count > 99 ? '99+' : String(count);
    chatToggle.setAttribute('aria-label', chatLabel());
}

function setChatOpen(open: boolean): void {
    if (!open && chat.contains(document.activeElement)) chatToggle.focus();
    chatOpen = open;
    document.body.classList.toggle('chat-open', open);
    chatToggle.setAttribute('aria-expanded', String(open));
    chatToggle.setAttribute('aria-label', chatLabel());
    chat.setAttribute('aria-hidden', String(!open));
    chat.toggleAttribute('inert', !open);
    if (open) {
        setChatUnread(0);
        chatHost.scrollTop = chatHost.scrollHeight;
    }
}

function selectionReset(): void {
    selectedHand = null;
    selectedTarget = null;
    pendingPlay = null;
    picks = [];
    targetModal.close();
}

function nameOf(seat: number): string {
    return names[seat] ?? `Seat ${seat + 1}`;
}

function buildTable(count: number): void {
    tableCount = count;
    tableLayout = layout(count, CARD_SIZE, view?.seat ?? 0);
    const size = contentSize(tableLayout, CARD_SIZE);
    world.style.width = `${size.w.toFixed(0)}px`;
    world.style.height = `${size.h.toFixed(0)}px`;

    const artRadius = tableLayout.radius + CARD_SIZE.h * 0.9;
    const artSize = tableArtExtent(artRadius) * 2;
    artHost.style.width = `${artSize.toFixed(0)}px`;
    artHost.style.height = `${artSize.toFixed(0)}px`;
    artHost.replaceChildren(tableArt(count, artRadius));
    camera?.reset();
}

function renderWorld(): void {
    if (!view || !tableLayout) return;

    seatsHost.replaceChildren();
    const targetable = selectedHand !== null && view.needsTarget.includes(selectedHand)
        ? view.targets[selectedHand] ?? [] : null;
    const info = {
        view,
        names,
        connected,
        selectedTarget,
        targetable,
        radius: tableLayout.radius,
        cardW: CARD_SIZE.w
    };
    view.players.forEach((_player, index) => {
        seatsHost.append(seatElement(info, index, tableLayout!.seats[index]));
    });

    center.render(view);
    banner.render(view, names);
}

function renderHud(): void {
    if (!view) return;
    const viewHints = hints(view);
    hand.render(view, {
        selected: selectedHand,
        picks,
        noActions: viewHints.noActions
    });
    applyHint(center.deck, viewHints.deck);
    center.setDrawCue(viewHints.drawCue);
    center.setDrawAvailable(viewHints.deckAvailable);
    hudBanner.textContent = viewHints.banner ?? '';
    hudBanner.hidden = !viewHints.banner;

    if (view.phase === 'DISCARD_LIMIT' && view.turn.player === view.seat) {
        endTurnButton.textContent = 'Discard';
        endTurnButton.disabled = picks.length === 0;
        applyHint(endTurnButton, picks.length > 0 ? 'highlight' : null);
        return;
    }
    endTurnButton.textContent = 'End turn';
    applyHint(endTurnButton, viewHints.endTurn);
    endTurnButton.disabled = viewHints.endTurn === null;
}

function captureRects(): Map<string, DOMRect> {
    const rects = new Map<string, DOMRect>();
    for (const slot of gameDiv.querySelectorAll<HTMLElement>('.card-slot[data-iid]')) {
        const iid = slot.dataset.iid;
        if (iid) rects.set(iid, slot.getBoundingClientRect());
    }
    return rects;
}

function preserveRectsForEvents(): void {
    pendingRects = captureRects();
    prevRects = pendingRects;
}

function animateMoves(): void {
    if (!view) return;
    for (const iid of moved) {
        const slot = gameDiv.querySelector<HTMLElement>(`.card-slot[data-iid="${iid}"]`);
        const before = prevRects.get(iid);
        const defId = view.cards[iid]?.defId;
        if (!slot || !before || !defId) continue;
        const after = slot.getBoundingClientRect();
        if (Math.abs(before.left - after.left) < 2 && Math.abs(before.top - after.top) < 2) continue;
        flyCard(flightLayer, defId, before, after);
    }
    moved.clear();
}

function winLine(): string {
    if (!view) return '';
    if (view.winner === null) return 'The deck ran out and it is a perfect tie. Everyone loses.';
    if (view.winReason === 'most')
        return `The deck ran out. ${nameOf(view.winner)} wins with the most unicorns.`;
    if (view.winReason === 'letters')
        return `The deck ran out. ${nameOf(view.winner)} wins the letter count.`;
    return `${nameOf(view.winner)} collected ${view.winTarget} unicorns.`;
}

function render(): void {
    if (!view) return;
    if (view.players.length !== tableCount) buildTable(view.players.length);
    if (selectedHand !== null && !(view.players[view.seat].hand ?? []).includes(selectedHand))
        selectedHand = null;
    if (selectedTarget !== null && !view.players[selectedTarget]) selectedTarget = null;
    if (pendingPlay !== null &&
        (view.phase !== 'ACTION' || view.turn.player !== view.seat ||
            !(view.players[view.seat].hand ?? []).includes(pendingPlay.iid))) {
        pendingPlay = null;
        confirmModal.close();
    }
    if (targetModal.isOpen &&
        (selectedHand === null || !view.needsTarget.includes(selectedHand)))
        targetModal.close();

    if (pendingRects) {
        prevRects = pendingRects;
        pendingRects = null;
    } else
        prevRects = captureRects();
    renderWorld();
    renderHud();
    animateMoves();

    promptModal.render(view.prompt, view.cards);
    if (!view.prompt && promptModal.isOpen) promptModal.close();
    babyModal.render(view);

    if (view.over) {
        winText.textContent = winLine();
        winModal.style.display = 'block';
    } else
        winModal.style.display = 'none';
}

function applyView(next: ViewModel): void {
    view = next;
    document.body.classList.add('in-game');
    lobby.style.display = 'none';
    gameDiv.style.display = 'flex';
    hud.style.display = 'flex';

    if (MOCK_PLAYERS === 0 && lastTurn !== -1 && next.turn.player !== lastTurn)
        // @ts-expect-error
        beep(next.turn.player === next.seat ? 2 : undefined);
    lastTurn = next.turn.player;

    render();
}

function appendLog(events: Array<LoggedEvent>, next: ViewModel | null = view): void {
    if (!next) return;
    let appended = 0;
    for (const event of events) {
        if (event.seq <= lastSeq) continue;
        lastSeq = event.seq;

        const card = event.card;
        const defId = card === undefined ? undefined : next.cards[card]?.defId;
        if (card !== undefined && prevRects.has(card) && defId && defId !== WILDCARD) moved.add(card);
        if (event.type === 'neigh' && event.targetCard &&
            event.targetPlayer !== undefined && event.player !== undefined) {
            const original = next.cards[event.targetCard]?.defId;
            showNeighWarning(flightLayer, nameOf(event.player), nameOf(event.targetPlayer),
                original && original !== WILDCARD ? cardName(original) : 'a card', event.superNeigh);
        }

        effectToast(event, next, names);
        const text = describeEvent(event, next.cards, names);
        if (!text) continue;
        const line = document.createElement('div');
        line.className = 'log-line';
        line.textContent = text;
        logHost.append(line);
        appended++;
    }
    if (appended === 0) return;
    if (logOpen)
        logHost.scrollTop = logHost.scrollHeight;
    else
        setLogUnread(logUnread + appended);
}

function previewFor(target: HTMLElement | null): void {
    const slot = target?.closest<HTMLElement>('.card-slot') ??
        target?.closest<HTMLElement>('.banner-card[data-iid]');
    const defId = slot?.dataset.defId ?? (slot?.dataset.iid ? view?.cards[slot.dataset.iid]?.defId : undefined);
    if (!slot || !defId || defId === WILDCARD || slot.closest('#hand')) {
        if (!target?.closest('.preview')) preview.hideSoon();
        return;
    }
    preview.cancelHide();
    preview.show(defId, slot.getBoundingClientRect());
}

function targetReason(model: ViewModel, iid: string, seat: number): string | null {
    const legal = model.targets[iid];
    if (!legal || legal.includes(seat)) return null;
    if (legal.length === 1 && legal[0] === model.seat) return 'That card must go into your own stable.';
    if (!legal.includes(model.seat)) return 'That card must go into another stable.';
    return 'That is not a legal target for that card.';
}

function playHandCard(iid: string): void {
    if (!view) return;
    const needsTarget = view.needsTarget.includes(iid);
    if (needsTarget && selectedTarget === null) {
        selectedHand = iid;
        note(`Choose a target for ${cardName(view.cards[iid].defId)}.`);
        targetModal.open(view, iid);
        render();
        return;
    }
    const target = needsTarget && selectedTarget !== null ? selectedTarget : view.seat;
    if (needsTarget) {
        const reason = targetReason(view, iid, target);
        if (reason) {
            selectedHand = iid;
            selectedTarget = null;
            note(reason);
            render();
            return;
        }
    }
    const kind = cardEntry(view.cards[iid]?.defId ?? '')?.kind;
    const warning = targetWarning(kind, target === view.seat);
    const ineffective = view.futile[iid] || view.cards[iid]?.inertAt?.includes(target);
    if (warning || ineffective) {
        pendingPlay = { iid, target: needsTarget ? target : null };
        confirmModal.open([warning, ineffective ? 'This card currently can have no effect. Continue?' : '']
            .filter(Boolean).join(' '));
        return;
    }
    sendMove('PLAY_CARD', needsTarget && selectedTarget !== null
        ? { iid, target: selectedTarget }
        : { iid });
    selectionReset();
    note('');
    render();
}

function onHandCard(iid: string): void {
    if (!view) return;

    switch (handInteraction(view, iid)) {
        case 'discard':
            picks = picks.includes(iid) ? picks.filter(card => card !== iid) : [...picks, iid];
            render();
            return;
        case 'neigh':
            if (!view.chain.top) return;
            sendMove('NEIGH', { iid, targetEntryId: view.chain.top.id });
            selectionReset();
            render();
            return;
        case 'play':
            return playHandCard(iid);
        default:
            selectedHand = null;
            note(describeBlocker(iid));
            render();
    }
}

function describeBlocker(iid: string): string {
    if (!view) return '';
    if (view.promptOpen) return 'Answer the open prompt first.';
    if (view.chain.top && view.cards[iid]?.neighable && !view.chain.canNeigh)
        return 'That play cannot be neighed by you.';
    const reason = view.blockers[iid];
    if (reason) return reason;
    if (view.turn.player !== view.seat) return 'It is not your turn.';
    if (view.phase !== 'ACTION') return 'You cannot play that card now.';
    return 'That card cannot be played right now.';
}

function onClick(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (!view || !target) return;

    const card = target.closest<HTMLElement>('.card-slot');
    const iid = card?.dataset.iid;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;

    if (card?.closest('#hand') && iid) return onHandCard(iid);

    if (action === 'deck') {
        if (view.promptOpen || view.over || view.winner !== null) return;
        if (view.phase === 'AWAIT_BEGIN' && view.turn.player === view.seat) return sendMove('BEGIN_TURN');
        if (view.phase === 'ACTION' && view.turn.player === view.seat) {
            if (view.pendingWinner !== null) return note('Let the current play resolve first.');
            if (view.turn.actionsLeft <= 0) return note('You already used your action this turn.');
            if (!canDraw(view)) return note('There are no cards left to draw.');
            return sendMove('DRAW_ACTION');
        }
        return;
    }

    if (card?.closest('.nursery')) return;

    if (card?.closest('.seat-stable')) {
        const seatNode = card.closest<HTMLElement>('.seat');
        const seat = Number(seatNode?.dataset.seat);
        if (Number.isNaN(seat)) return;
        if (selectedHand !== null && view.needsTarget.includes(selectedHand)) {
            const reason = targetReason(view, selectedHand, seat);
            if (reason) return note(reason);
            selectedTarget = seat;
            note(`Target set to ${nameOf(seat)}. Click the card again to play it.`);
            render();
            return;
        }
        selectedTarget = selectedTarget === seat ? null : seat;
        render();
    }
}

function renderLobby(sync: SyncMessage): void {
    seats = sync.seats ?? [];
    youAre = sync.youAre ?? 0;
    isHost = sync.isHost ?? false;

    document.body.classList.remove('in-game');
    lobby.style.display = 'block';
    gameDiv.style.display = 'none';
    hud.style.display = 'none';
    view = null;

    playerList.replaceChildren();
    seats.forEach((seat, index) => {
        const row = document.createElement('div');
        row.className = 'lobby-row';
        if (!seat.connected) row.classList.add('offline');

        const name = document.createElement('span');
        name.textContent = seat.username ?? 'empty seat';
        if (index === 0) {
            const host = document.createElement('span');
            host.className = 'host-tag';
            host.textContent = '[HOST]';
            name.append(host);
        }
        const state = document.createElement('span');
        state.textContent = seat.ready ? 'ready' : 'not ready';
        row.append(name, state);
        playerList.append(row);
    });

    const packs = sync.packNames ?? [];
    if (packList.childElementCount !== packs.length) {
        packList.replaceChildren();
        for (const pack of packs) {
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = `pack-tile${pack === DEFAULT_PACK ? ' locked' : ''}`;
            const check = document.createElement('span');
            check.className = 'pack-check';
            check.textContent = '✓';
            const label = document.createElement('span');
            label.textContent = `${pack} (${PACKS[pack].cards.reduce((total, entry) => total + entry.copies, 0)} cards)`;
            const description = document.createElement('span');
            description.className = 'pack-description';
            description.textContent = PACKS[pack].dsc;
            tile.append(check, label, description);
            tile.dataset.pack = pack;
            packList.append(tile);
        }
    }
    for (const tile of Array.from(packList.children) as Array<HTMLElement>)
        tile.classList.toggle('selected', (sync.packs ?? []).includes(tile.dataset.pack ?? ''));

    const everyoneReady = seats.every(seat => !seat.connected || seat.ready);
    startButton.style.display = isHost ? 'inline-block' : 'none';
    startButton.disabled = !isHost || seats.length < (sync.minPlayers ?? 3) || !everyoneReady;

    readyButton.textContent = seats[youAre]?.ready ? 'Not ready' : 'Ready';
}

function tryReconnect(): void {
    reconnectTimer = null;
    // @ts-expect-error
    connection = createConnection();
    bindConnection();
}

function bindConnection(): void {
    connection.onopen = () => {
        if (uuid) connection.send(JSON.stringify({ type: 'JOIN', gameID: uuid }));
        else connection.send(JSON.stringify({ type: 'CREATE', gameType: 'unstable_unicorns' }));
    };
    connection.onmessage = handleMessage;
    connection.onclose = () => {
        disconnectBanner.style.top = '0';
        if (reconnectTimer === null) reconnectTimer = setTimeout(tryReconnect, 3000);
    };
}

chatInput.onkeydown = event => {
    if (event.key !== 'Enter' || !chatInput.value) return;
    connection.send(JSON.stringify({ type: 'CHAT', message: chatInput.value }));
    chatInput.value = '';
};

document.getElementById('set-username')?.addEventListener('click', () => {
    connection.send(JSON.stringify({ type: 'USERNAME', username: usernameInput.value }));
});

readyButton.addEventListener('click', () => {
    connection.send(JSON.stringify({ type: 'READY' }));
});

startButton.addEventListener('click', () => {
    sendMove('START_GAME');
});

packList.addEventListener('click', event => {
    const tile = (event.target as HTMLElement).closest<HTMLElement>('.pack-tile');
    if (!tile || tile.dataset.pack === DEFAULT_PACK) return;
    tile.classList.toggle('selected');
    const chosen = Array.from(packList.querySelectorAll<HTMLElement>('.pack-tile.selected'))
        .map(el => el.dataset.pack ?? '');
    if (!chosen.includes(DEFAULT_PACK)) chosen.unshift(DEFAULT_PACK);
    sendMove('SET_PACKS', { packs: chosen });
});

document.getElementById('rules-button')?.addEventListener('click', event => {
    event.preventDefault();
    rulesModal.style.display = 'block';
});

document.getElementById('rules-close')?.addEventListener('click', () => {
    rulesModal.style.display = 'none';
});

rulesModal.addEventListener('click', event => {
    if (event.target === rulesModal) rulesModal.style.display = 'none';
});

logToggle.addEventListener('click', () => setLogOpen(!logOpen));
chatToggle.addEventListener('click', () => setChatOpen(!chatOpen));

document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (rulesModal.style.display !== 'none') {
        rulesModal.style.display = 'none';
        return;
    }
    if (chatOpen) setChatOpen(false);
});

inviteLink.addEventListener('click', () => {
    // @ts-expect-error
    copyToClipboard(inviteLink.innerText);
});

endTurnButton.addEventListener('click', () => {
    if (view?.phase === 'DISCARD_LIMIT') {
        if (picks.length === 0) return note('Pick cards from your hand to discard.');
        sendMove('DISCARD', { iids: picks });
        picks = [];
        note('');
        render();
        return;
    }
    sendMove('END_TURN');
});
recenterButton.addEventListener('click', () => camera?.reset());
zoomInButton.addEventListener('click', () => camera?.zoom(1.15));
zoomOutButton.addEventListener('click', () => camera?.zoom(1 / 1.15));

gameDiv.addEventListener('click', onClick);
hud.addEventListener('click', onClick);
center.deck.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onClick(event);
});
gameDiv.addEventListener('pointerover', event => previewFor(event.target as HTMLElement | null));
gameDiv.addEventListener('focusin', event => previewFor(event.target as HTMLElement | null));
gameDiv.addEventListener('focusout', () => preview.hideSoon());
hud.addEventListener('pointerover', event => previewFor(event.target as HTMLElement | null));
hud.addEventListener('pointerout', event => {
    if ((event.target as HTMLElement | null)?.closest('.card-slot')) preview.hideSoon();
});
gameDiv.addEventListener('pointerout', event => {
    if ((event.target as HTMLElement | null)?.closest('.card-slot, .banner-card[data-iid]')) preview.hideSoon();
});
previewHost.addEventListener('pointerenter', () => preview.cancelHide());
previewHost.addEventListener('pointerleave', () => preview.hideSoon());

function handleMessage(raw: { data: string }): void {
    let message: SyncMessage & { uuid?: string; username?: string; message?: string };
    try {
        message = JSON.parse(raw.data) as SyncMessage & { uuid?: string; username?: string; message?: string };
    } catch (e) {
        return;
    }

    switch (message.type) {
        case 'ERROR': {
            if (message.code === 'NO_GAME') {
                connection.send(JSON.stringify({ type: 'CREATE', gameType: 'unstable_unicorns' }));
                break;
            }
            if (message.error) note(message.error);
            break;
        }
        case 'CHAT': {
            const line = document.createElement('div');
            line.className = 'chat-line';
            line.textContent = `[${message.username ?? '?'}] ${message.message ?? ''}`;
            chatHost.append(line);
            if (chatOpen)
                chatHost.scrollTop = chatHost.scrollHeight;
            else
                setChatUnread(chatUnread + 1);
            break;
        }
        case 'UUID': {
            const url = `${window.location.href.split('?')[0]}?${message.uuid}`;
            history.pushState({}, '', url);
            inviteLink.innerText = url;
            break;
        }
        case 'SYNC': {
            disconnectBanner.style.top = '-100px';
            names = (message.seats ?? []).map(seat => seat.username);
            connected = (message.seats ?? []).map(seat => seat.connected);
            if (!message.started) {
                renderLobby(message);
                break;
            }
            if (message.events?.length) {
                preserveRectsForEvents();
                appendLog(message.events, message.view ?? view);
            }
            if (message.view) applyView(message.view);
            break;
        }
        default:
            break;
    }
}

const mockPanel = $('mock-panel');
const mockPlayersSelect = $('mock-players') as HTMLSelectElement;
const mockSeatSelect = $('mock-seat') as HTMLSelectElement;
const mockHandList = $('mock-hand');
const mockAddSelect = $('mock-add-card') as HTMLSelectElement;
const mockAddButton = $('mock-add') as HTMLButtonElement;
const mockPlayBySelect = $('mock-play-by') as HTMLSelectElement;
const mockPlaySelect = $('mock-play-card') as HTMLSelectElement;
const mockPlayButton = $('mock-play') as HTMLButtonElement;

let mockPlayers = MOCK_PLAYERS;
let mockSeat = 0;
let mockSeq = 0;
const mockHands = new Map<number, Array<string>>();

function fillSelect(select: HTMLSelectElement, entries: Array<{ value: string; label: string }>): void {
    select.replaceChildren();
    for (const entry of entries) {
        const option = document.createElement('option');
        option.value = entry.value;
        option.textContent = entry.label;
        select.append(option);
    }
}

function catalogOptions(select: HTMLSelectElement): void {
    select.replaceChildren();
    let group: HTMLOptGroupElement | null = null;
    let currentKind = '';
    for (const entry of PACKS[DEFAULT_PACK].cards) {
        if (group === null || entry.kind !== currentKind) {
            currentKind = entry.kind;
            group = document.createElement('optgroup');
            group.label = currentKind;
            select.append(group);
        }
        const option = document.createElement('option');
        option.value = entry.id;
        option.textContent = entry.name;
        group.append(option);
    }
}

function mockHand(): Array<string> {
    return mockHands.get(mockSeat) ?? mockHandDefaults();
}

function applyMock(): void {
    names = Array.from({ length: mockPlayers }, (_, index) => `Player ${index + 1}`);
    connected = names.map(() => true);
    applyView(mockView(mockPlayers, mockSeat, mockHand()));
}

function refreshMockPanel(): void {
    mockPlayersSelect.value = String(mockPlayers);
    fillSelect(mockSeatSelect, Array.from({ length: mockPlayers }, (_, index) => ({
        value: String(index),
        label: `Seat ${index + 1}${index === mockSeat ? ' (you)' : ''}`
    })));
    mockSeatSelect.value = String(mockSeat);
    fillSelect(mockPlayBySelect, Array.from({ length: mockPlayers }, (_, index) =>
        ({ value: String(index), label: names[index] ?? `Seat ${index + 1}` })));
    mockPlayBySelect.value = String(mockSeat);

    mockHandList.replaceChildren();
    mockHand().forEach((defId, index) => {
        const row = document.createElement('div');
        row.className = 'mock-hand-row';
        const label = document.createElement('span');
        label.textContent = cardName(defId);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = 'X';
        remove.dataset.index = String(index);
        row.append(label, remove);
        mockHandList.append(row);
    });
}

function startMock(): void {
    lobby.style.display = 'none';
    gameDiv.style.display = 'flex';
    hud.style.display = 'flex';
    mockPanel.hidden = false;
    catalogOptions(mockAddSelect);
    catalogOptions(mockPlaySelect);
    applyMock();
    refreshMockPanel();
}

mockPlayersSelect.addEventListener('change', () => {
    mockPlayers = Number(mockPlayersSelect.value);
    if (mockSeat >= mockPlayers) mockSeat = mockPlayers - 1;
    for (const seat of [...mockHands.keys()])
        if (seat >= mockPlayers) mockHands.delete(seat);
    applyMock();
    refreshMockPanel();
});

mockSeatSelect.addEventListener('change', () => {
    mockSeat = Number(mockSeatSelect.value);
    applyMock();
    refreshMockPanel();
});

mockAddButton.addEventListener('click', () => {
    const defId = mockAddSelect.value;
    if (!defId) return;
    mockHands.set(mockSeat, [...mockHand(), defId]);
    applyMock();
    refreshMockPanel();
});

mockHandList.addEventListener('click', event => {
    const buttonNode = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-index]');
    if (!buttonNode) return;
    const nextHand = [...mockHand()];
    nextHand.splice(Number(buttonNode.dataset.index), 1);
    mockHands.set(mockSeat, nextHand);
    applyMock();
    refreshMockPanel();
});

mockPlayButton.addEventListener('click', () => {
    if (!view) return;
    const defId = mockPlaySelect.value;
    const player = Number(mockPlayBySelect.value);
    if (!defId || Number.isNaN(player)) return;
    const iid = `mocksim${++mockSeq}`;
    view.cards[iid] = { defId, owner: player, zone: 'discard', revealed: true, neighable: false };
    appendLog([{ type: 'play', player, card: iid, seq: lastSeq + 1 }]);
});

const MOCK_PROMPT_KINDS = ['cards', 'order', 'player', 'yesno', 'options'];
const MOCK_PROMPT_LIMITS: Record<string, { min: number; max: number }> = {
    cards: { min: 1, max: 2 },
    player: { min: 1, max: 1 },
    yesno: { min: 0, max: 1 },
    options: { min: 1, max: 3 }
};
const MOCK_PROMPT_REASONS: Record<string, string> = {
    cards: 'Choose a card to destroy',
    order: 'Choose the order to resolve these cards',
    player: 'Choose a player to swap hands with',
    yesno: 'Shuffle the discard pile into the deck?',
    options: 'Draw how many cards?'
};
function openPromptPreview(kind: string): void {
    const current = view;
    if (!current || !MOCK_PROMPT_KINDS.includes(kind)) return;
    const orderCards = current.players.flatMap(player => player.stable.slice(0, 2));
    const limits = kind === 'order'
        ? { min: orderCards.length, max: orderCards.length }
        : MOCK_PROMPT_LIMITS[kind];
    const prompt: PromptView = {
        id: 9000 + ++mockSeq,
        player: current.seat,
        kind,
        reason: MOCK_PROMPT_REASONS[kind] ?? 'Preview',
        source: current.chain.top ? current.chain.top.card : null,
        cards: kind === 'cards' || kind === 'order' ? orderCards : [],
        players: current.players.map(player => player.id).filter(id => id !== current.seat),
        min: limits.min,
        max: limits.max
    };
    promptModal.render(prompt, current.cards);
}

function openTargetPreview(): void {
    const current = view;
    if (!current) return;
    const iid = 'mocktarget';
    current.cards[iid] = {
        defId: mockPlaySelect.value || 'raid',
        owner: current.seat,
        zone: 'hand',
        revealed: true,
        neighable: false
    };
    current.targets[iid] = current.players.map(player => player.id).filter(id => id !== current.seat);
    targetModal.open(current, iid);
}

function openBabyPreview(): void {
    const current = view;
    if (!current) return;
    babyModal.render({
        ...current,
        phase: 'PICK_BABY',
        prompt: null,
        promptOpen: false,
        winner: null,
        players: current.players.map((player, index) => ({ ...player, babyChosen: index !== current.seat }))
    });
}

function openWinPreview(): void {
    const current = view;
    if (!current) return;
    winText.textContent = `${nameOf(1)} collected ${current.winTarget} unicorns.`;
    winModal.style.display = 'block';
}

function closeMockModals(): void {
    promptModal.close();
    confirmModal.close();
    targetModal.close();
    if (view) babyModal.render(view);
    winModal.style.display = 'none';
    rulesModal.style.display = 'none';
    disconnectBanner.style.top = '-100px';
}

$('mock-modals').addEventListener('click', event => {
    const buttonNode = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-modal]');
    if (!buttonNode) return;
    const which = buttonNode.dataset.modal ?? '';
    if (which.startsWith('prompt-'))
        openPromptPreview(which.slice('prompt-'.length));
    else if (which === 'confirm')
        confirmModal.open('This card currently can have no effect. Continue?');
    else if (which === 'target')
        openTargetPreview();
    else if (which === 'baby')
        openBabyPreview();
    else if (which === 'win')
        openWinPreview();
    else if (which === 'neigh') {
        const player = Number(mockPlayBySelect.value);
        const defId = mockPlaySelect.value;
        if (defId && Number.isInteger(player) && player >= 0 && player < mockPlayers)
            showNeighWarning(flightLayer, nameOf((player + 1) % mockPlayers), nameOf(player), cardName(defId));
    } else if (which === 'rules')
        rulesModal.style.display = 'block';
    else if (which === 'disconnect')
        disconnectBanner.style.top = '0';
    else if (which === 'close')
        closeMockModals();
});

camera = new CameraController({
    frame: worldFrame,
    world,
    content: () => ({ w: world.clientWidth, h: world.clientHeight }),
    home: () => {
        if (!tableLayout) return null;
        const mid = world.clientHeight / 2;
        return {
            top: mid - CARD_SIZE.h / 2,
            bottom: mid + tableLayout.radius + CARD_SIZE.h * 0.75
        };
    }
});

if (MOCK_PLAYERS >= 3)
    startMock();
else
    bindConnection();
