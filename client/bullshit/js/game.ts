import { GET_SYMBOL, RED_SUITS, SUIT_SYMBOL_MAP, SUIT_POSITIONS } from './game/card-data.js';
import { addSoundsToPreload, playSound } from './sound/sound.js';
import { CardLike, LastEvent, LastPlay, PlayerSync } from './types.js';
import {
    BS_FLIP_MS, DECK_SIZE, EMOJI_IMAGES, EMOTE_RATE_MAX, EMOTE_RATE_WINDOW_MS,
    MIN_PLAYERS, PROFILE_PICTURES, REVEAL_DELAY_MS, TURN_TIME_SECONDS
} from './vars.js';

interface SyncMessage {
    type: 'SYNC';
    started: boolean;
    turn: number;
    youAre: number;
    isHost: boolean;
    valueToPlace: number;
    secondsRemaining: number;
    centerDeckSize: number;
    winner: number;
    bsCalled: boolean;
    /** Staged play the next BS challenge judges (null before the first move) */
    lastPlay: LastPlay | null;
    lastEvent: LastEvent | null;
    players: Array<PlayerSync | null>;
    selfDeck: Array<CardLike>;
}

const MAX_STAGGER_TOTAL_MS = 2500;

const SUBMIT_UNLOCK_DELAY_MS = 2000;

const BURST_SIZE_PX = 110;
const BURST_OFFSET_X_PX = -15;
const BURST_OFFSET_Y_PX = 15;
const BURST_DURATION_MS = 1400;

const BULLSHIT_SOUND = '/bullshit/sound/bullshit.mp3';
const ALARM_SOUND = '/bullshit/sound/alarm.mp3';
const SHUFFLE_SOUNDS = [1, 2, 3, 4].map(n => `/bullshit/sound/shuffle${n}.mp3`);

addSoundsToPreload([BULLSHIT_SOUND, ALARM_SOUND, ...SHUFFLE_SOUNDS]);

function computeCardStagger(count: number, baseStaggerMs: number): number {
    return count > 1 ? Math.min(baseStaggerMs, MAX_STAGGER_TOTAL_MS / (count - 1)) : baseStaggerMs;
}

// url?<GAME UUID>=
const uuid = window.location.search.substr(1).split('=')[0];

// createConnection() is in a shared JS file
// @ts-expect-error
const connection = createConnection();

/**
 * Check if window connection is open
 * @returns Is the connection open?
 */
function connectionOpen() {
    return connection && connection.readyState === WebSocket.OPEN;
}

/**
 * ---------------------------
 * Chat (reused pattern from client/tpt_code/js/game.ts)
 * ---------------------------
 */
const chatInput = document.getElementById('chat-input') as HTMLInputElement;
chatInput.onkeydown = e => {
    if (e.key === 'Enter') {
        if (!chatInput.value) return;
        connection.send(JSON.stringify({
            type: 'CHAT',
            message: chatInput.value
        }));
        chatInput.value = '';
    }
};
const chatMessages = document.getElementById('messages') as HTMLDivElement;

function usernameHue(username: string): number {
    let hash = 0;
    for (let i = 0; i < username.length; i++)
        hash = (hash * 31 + username.charCodeAt(i)) >>> 0;
    return hash % 360;
}

function usernameColor(username: string): string {
    return `hsl(${usernameHue(username)}, 65%, 72%)`;
}

/**
 * ---------------------------
 * Connection handling
 * ---------------------------
 */
connection.onopen = () => {
    if (uuid.length === 0) // Create a new game
        connection.send(JSON.stringify({ type: 'CREATE', gameType: 'bullshit' }));
    else // Join existing game
        connection.send((JSON.stringify({ type: 'JOIN', gameID: uuid })));
};

connection.onerror = (error: any) => console.error(error);

/*
 * ----------------------------------
 * Disconnect banner
 * ----------------------------------
 */
const DISCONNECT_BANNER = document.getElementById('disconnect-banner');
setInterval(() => {
    if (!DISCONNECT_BANNER) return;
    if (connection.readyState !== WebSocket.CLOSED)
        DISCONNECT_BANNER.style.top = '-100px';
    else
        DISCONNECT_BANNER.style.top = '0';
}, 500);

const lobby = document.getElementById('lobby') as HTMLDivElement;
const gameDiv = document.getElementById('game') as HTMLDivElement;
const inviteLink = document.getElementById('link') as HTMLParagraphElement;
const gameLink = document.getElementById('game-link') as HTMLParagraphElement;

/** Used in the copy link to clipboard */
function copyLinkToClipboard(text: string) {
    gameLink.classList.add('flash');
    setTimeout(() => gameLink.classList.remove('flash'), 500);
    // @ts-expect-error
    copyToClipboard(text);
}
gameLink.onclick = () => copyLinkToClipboard(inviteLink.innerText);

/**
 * ---------------------------
 * Username + ready + start game
 * ---------------------------
 */
const usernameInput = document.getElementById('username') as HTMLInputElement;
usernameInput.onkeydown = e => {
    if (e.key === 'Enter') submitUsername();
};
document.getElementById('set-username')!.onclick = submitUsername;

function submitUsername() {
    if (!connectionOpen() || !usernameInput.value) return;
    connection.send(JSON.stringify({ type: 'USERNAME', username: usernameInput.value }));
    usernameInput.value = '';
}

const readyButton = document.getElementById('ready') as HTMLButtonElement;
readyButton.onclick = () => {
    if (!connectionOpen()) return;
    connection.send(JSON.stringify({ type: 'READY' }));
};

const startGameButton = document.getElementById('start-game') as HTMLButtonElement;
const startGameHint = document.getElementById('start-game-hint') as HTMLParagraphElement;
startGameButton.onclick = () => {
    if (!connectionOpen() || startGameButton.disabled) return;
    connection.send(JSON.stringify({ type: 'MOVE', action: 'START_GAME' }));
};

const pfpButtonsDiv = document.getElementById('pfp-buttons') as HTMLDivElement;
const pfpButtons: Array<HTMLButtonElement> = [];

for (let i = 0; i < PROFILE_PICTURES.length; i++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pfp-button selectable-button';
    button.style.backgroundImage = `url("${PROFILE_PICTURES[i]}")`;
    button.onclick = () => {
        if (!connectionOpen()) return;
        connection.send(JSON.stringify({ type: 'PFP', index: i }));
    };
    pfpButtonsDiv.appendChild(button);
    pfpButtons.push(button);
}

function updatePfpButtons(message: SyncMessage) {
    const self = message.players[message.youAre];
    const own = self ? PROFILE_PICTURES.indexOf(self.profilePicture) : -1;
    const taken = new Set<number>();

    message.players.forEach((player, index) => {
        if (!player || index === message.youAre) return;
        const pfp = PROFILE_PICTURES.indexOf(player.profilePicture);
        if (pfp !== -1) taken.add(pfp);
    });

    pfpButtons.forEach((button, index) => {
        button.classList.toggle('selected', index === own);
        button.disabled = taken.has(index);
    });
}

/**
 * ---------------------------
 * Card rendering (own hand)
 * Ported from the original bullshit src/Card.js (React component)
 * to plain DOM element construction.
 * ---------------------------
 */

/**
 * Build the suit pattern (pips) shown in the middle of a card front
 * @param {number} value 1-13
 * @param {string} suit
 * @return {HTMLDivElement}
 */
function buildSuitPattern(value: number, suit: string): HTMLDivElement {
    let pattern = SUIT_POSITIONS[value - 1];
    let container = document.createElement('div');
    container.className = 'suit-pattern-container';

    // Allow more room along the y axis when there are more symbols
    let [xOffset, yOffset] = pattern.length <= 8 ? [20, 19] : [20, 28];

    for (let pos of pattern) {
        let symbol = document.createElement('div');
        symbol.className = 'suit-pattern-symbol';
        symbol.style.top = (50 + pos[1] * yOffset) + '%';
        symbol.style.left = (50 + pos[0] * xOffset) + '%';
        symbol.style.transform = pos[2] ? 'rotate(180deg)' : 'none';
        symbol.innerText = SUIT_SYMBOL_MAP[suit];
        container.appendChild(symbol);
    }
    return container;
}

/**
 * Create a card element (face up, in-hand)
 * @param {number} value 1-13
 * @param {string} suit
 * @return {HTMLDivElement}
 */
function createCardElement(value: number, suit: string): HTMLDivElement {
    let div = document.createElement('div');
    div.className = 'card card-hover front' + (RED_SUITS.includes(suit) ? ' red' : '');

    let topLeft = document.createElement('h1');
    topLeft.className = 'num_top_left';
    topLeft.innerHTML = `${GET_SYMBOL(value)}<br>${SUIT_SYMBOL_MAP[suit]}`;
    div.appendChild(topLeft);

    div.appendChild(buildSuitPattern(value, suit));

    let botRight = document.createElement('h1');
    botRight.className = 'num_bot_right';
    botRight.innerHTML = `${GET_SYMBOL(value)}<br>${SUIT_SYMBOL_MAP[suit]}`;
    div.appendChild(botRight);

    return div;
}

/**
 * ---------------------------
 * Hand rendering + card selection
 * Grid layout math reused from the original bullshit src/Game.js
 * ---------------------------
 */
const TOP_OFFSET = 0;
const WIDTH_MULTI = 50;
const HEIGHT_MULTI = 40;
const GRID_WIDTH = 14; // Cards per grid row
const CARD_WIDTH = 250;   // .card width in css
const CARD_SCALE = 0.5;   // .card transform: scale() in css

const handContainer = document.getElementById('hand-container') as HTMLDivElement;
const submitButton = document.getElementById('submit-cards') as HTMLButtonElement;
const callBsButton = document.getElementById('call-bs') as HTMLButtonElement;

let selfDeck: Array<CardLike> = [];
let selectedCards: Array<CardLike> = [];
let latestSync: SyncMessage | null = null;
const handCards = new Map<string, HTMLDivElement>();
let handExitSeq = 0;

/** @return {string} Unique key for a card (value + suit) */
function cardKey(card: CardLike) {
    return card.value + card.suit;
}

function readHandTune() {
    const s = getComputedStyle(handContainer);
    return {
        fanDeg: parseFloat(s.getPropertyValue('--hand-fan-deg')) || 18,
        rowStagger: parseFloat(s.getPropertyValue('--hand-row-stagger')) || 32,
        fanArc: parseFloat(s.getPropertyValue('--hand-fan-arc')) || 10,
        fadeMs: parseFloat(s.getPropertyValue('--hand-card-fade-ms')) || 250
    };
}

function applyHandCardLayout(el: HTMLDivElement, index: number, total: number,
        tune: { fanDeg: number, rowStagger: number, fanArc: number }) {
    const visualWidth = CARD_WIDTH * CARD_SCALE;
    const scaleOffset = (CARD_WIDTH - visualWidth) / 2;
    const containerWidth = handContainer.clientWidth;

    const row = Math.floor(index / GRID_WIDTH);
    const col = index % GRID_WIDTH;
    const rowLen = Math.min(GRID_WIDTH, total - row * GRID_WIDTH);
    const rowWidth = visualWidth + WIDTH_MULTI * (rowLen - 1);
    const rowLeft = (containerWidth - rowWidth) / 2 + row * tune.rowStagger;

    const t = rowLen <= 1 ? 0.5 : col / (rowLen - 1);
    const rotate = (t - 0.5) * tune.fanDeg;
    const arc = Math.abs(t - 0.5) * 2 * tune.fanArc;

    el.style.top = (TOP_OFFSET + HEIGHT_MULTI * row + arc) + 'px';
    el.style.left = (rowLeft + WIDTH_MULTI * col - scaleOffset) + 'px';
    el.style.setProperty('--card-rotate', rotate + 'deg');
    el.style.zIndex = String(index);
}

/** Re-render the current player's hand based on selfDeck + selectedCards */
function renderHand() {
    const sorted = [...selfDeck].sort((a, b) => a.value - b.value);
    const desired = new Set(sorted.map(c => cardKey(c)));
    const tune = readHandTune();

    for (const [key, el] of handCards) {
        if (desired.has(key)) {
            el.classList.remove('card-exit');
            continue;
        }
        if (el.classList.contains('card-exit')) continue;
        el.classList.add('card-exit');
        const token = String(++handExitSeq);
        el.dataset.exitToken = token;
        setTimeout(() => {
            if (el.dataset.exitToken !== token) return;
            if (!el.classList.contains('card-exit')) return;
            handCards.delete(key);
            el.remove();
        }, tune.fadeMs + 50);
    }

    sorted.forEach((card, index) => {
        const key = cardKey(card);
        let el = handCards.get(key);
        const selected = selectedCards.some(c => cardKey(c) === key);
        if (!el) {
            el = createCardElement(card.value, card.suit);
            el.dataset.cardKey = key;
            el.classList.add('card-enter');
            el.onclick = () => {
                if (selectedCards.some(c => cardKey(c) === key))
                    selectedCards = selectedCards.filter(c => cardKey(c) !== key);
                else
                    selectedCards = [...selectedCards, card];
                renderHand();
                updateButtonStates();
            };
            handContainer.appendChild(el);
            handCards.set(key, el);
            el.style.transition = 'none';
            applyHandCardLayout(el, index, sorted.length, tune);
            void el.offsetWidth;
            el.style.transition = '';
            const entering = el;
            requestAnimationFrame(() => entering.classList.remove('card-enter'));
        } else {
            el.classList.remove('card-exit');
            delete el.dataset.exitToken;
            applyHandCardLayout(el, index, sorted.length, tune);
        }
        el.classList.toggle('card-selected', selected);
    });
}

let myTurnStartedAt = 0;
let wasMyTurn = false;
let submitUnlockTimer: ReturnType<typeof setTimeout> | null = null;

function trackMyTurnDelay(isMyTurn: boolean) {
    if (isMyTurn && !wasMyTurn) myTurnStartedAt = Date.now();
    wasMyTurn = isMyTurn;

    if (submitUnlockTimer !== null) clearTimeout(submitUnlockTimer);
    submitUnlockTimer = null;

    const remaining = SUBMIT_UNLOCK_DELAY_MS - (Date.now() - myTurnStartedAt);
    if (isMyTurn && remaining > 0)
        submitUnlockTimer = setTimeout(() => updateButtonStates(), remaining);
}

function updateButtonStates() {
    let isMyTurn = !!latestSync && latestSync.started && latestSync.turn === latestSync.youAre;
    trackMyTurnDelay(isMyTurn);
    submitButton.disabled = !isMyTurn || selectedCards.length === 0 || bsPhase !== null ||
        Date.now() - myTurnStartedAt < SUBMIT_UNLOCK_DELAY_MS;

    // Can't challenge your own play; the server judges the staged play
    // (see BullshitGame.handleCallBs)
    callBsButton.disabled = !latestSync || !latestSync.started || latestSync.bsCalled ||
        latestSync.centerDeckSize === 0 ||
        judgedPlayerIndex(latestSync) === latestSync.youAre;
}

/**
 * Index of the player a BS challenge would judge: the staged play's player,
 * or - when no play is staged - whoever moved last. Must mirror
 * BullshitGame.handleCallBs exactly. `turn` indexes the full players array
 * (null seats after a disconnect included), so never reduce it modulo the
 * number of seated players.
 * @param {SyncMessage} sync
 * @return {number} Seat index, or -1 if no player can be judged
 */
function judgedPlayerIndex(sync: SyncMessage): number {
    const staged = sync.lastPlay;
    if (staged && sync.players[staged.player]) return staged.player;

    const total = sync.players.length;
    let index = sync.turn;
    for (let i = 0; i < total; i++) {
        index = (index - 1 + total) % total;
        if (sync.players[index] !== null) return index;
    }
    return -1;
}

submitButton.onclick = () => {
    if (!connectionOpen() || selectedCards.length === 0) return;
    connection.send(JSON.stringify({
        type: 'MOVE',
        action: 'SUBMIT',
        cards: selectedCards.map(c => ({ value: c.value, suit: c.suit }))
    }));
    selectedCards = [];
};

callBsButton.onclick = () => {
    if (!connectionOpen()) return;
    connection.send(JSON.stringify({ type: 'MOVE', action: 'BS' }));
};

/**
 * ---------------------------
 * Avatars
 * ---------------------------
 */

function avatarSlotId(index: number) {
    return `avatar-slot-${index}`;
}

const AVATAR_TABLE_EDGE_GAP_PX = 150;

function computeAvatarColumnX(): { leftX: number, rightX: number } {
    const arena = document.getElementById('game-arena');
    const table = document.getElementById('table');
    const arenaRect = arena ? arena.getBoundingClientRect() : null;
    const tableRect = table ? table.getBoundingClientRect() : null;
    if (!arenaRect || !tableRect || arenaRect.width === 0) return { leftX: 15, rightX: 85 };

    return {
        leftX: ((tableRect.left - arenaRect.left - AVATAR_TABLE_EDGE_GAP_PX) / arenaRect.width) * 100,
        rightX: ((tableRect.right - arenaRect.left + AVATAR_TABLE_EDGE_GAP_PX) / arenaRect.width) * 100
    };
}

/**
 * Distribute n seats into columns to the left and right of the table
 * @return {Array<{left: number, top: number}>} Percent positions, in seat order
 */
function computeAvatarPositions(n: number): Array<{ left: number, top: number }> {
    if (n <= 0) return [];

    const CENTER_X = 50;
    const { leftX: LEFT_X, rightX: RIGHT_X } = computeAvatarColumnX();
    const COL_TOP = 20;
    const COL_BOTTOM = 85;
    const MAX_SPACING = 40;

    const hasCenter = n % 2 === 1;
    const sideSeats = hasCenter ? n - 1 : n;
    const leftCount = sideSeats / 2;
    const rightCount = sideSeats / 2;

    const columnPositions = (x: number, count: number) => {
        if (count <= 0) return [];
        const centerY = (COL_TOP + COL_BOTTOM) / 2;
        const spacing = count > 1 ? Math.min(MAX_SPACING, (COL_BOTTOM - COL_TOP) / (count - 1)) : 0;
        const col: Array<{ left: number, top: number }> = [];
        for (let i = 0; i < count; i++)
            col.push({ left: x, top: centerY + (i - (count - 1) / 2) * spacing });
        return col;
    };

    const positions = columnPositions(LEFT_X, leftCount).reverse();
    if (hasCenter) positions.push({ left: CENTER_X, top: COL_TOP });
    positions.push(...columnPositions(RIGHT_X, rightCount));
    return positions;
}

const FAN_RADIUS = 28;
const FAN_MAX_CARDS = DECK_SIZE;
const FAN_FADE_MS = 350;
const FAN_STAGGER_MS = 40;

const avatarCardFans = new Map<number, HTMLDivElement>();
const avatarPrevCounts = new Map<number, number>();

function fanAngle(index: number, count: number): number {
    const t = count <= 1 ? 0.5 : index / (count - 1);
    return (t - 0.5) * 100;
}

function randomFanRotation(playerIndex: number): number {
    const slot = document.getElementById(avatarSlotId(playerIndex));
    const count = slot ? slot.querySelectorAll('.card-fan-card').length : 0;
    if (count <= 0) return 0;
    return fanAngle(Math.floor(Math.random() * count), count);
}

function renderAvatarCardFan(playerIndex: number, count: number) {
    if (bsPhase !== null && playerIndex === bsLoser) return;

    const clamped = Math.min(count, FAN_MAX_CARDS);
    const prev = avatarPrevCounts.get(playerIndex) ?? 0;
    avatarPrevCounts.set(playerIndex, count);

    let fan = avatarCardFans.get(playerIndex);
    if (!fan) {
        fan = document.createElement('div');
        fan.className = 'card-fan';
        avatarCardFans.set(playerIndex, fan);
    }

    if (prev === clamped && fan.isConnected && fan.childElementCount === clamped)
        return;

    fan.replaceChildren();

    const animIncrease = clamped > prev;
    const fadeMs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-fan-fade-ms')) || FAN_FADE_MS;
    const fanStagger = computeCardStagger(animIncrease ? clamped - prev : 0, FAN_STAGGER_MS);

    for (let i = 0; i < clamped; i++) {
        const angle = fanAngle(i, clamped);

        const card = document.createElement('div');
        card.className = 'card-fan-card' + (animIncrease && i >= prev ? ' card-fan-enter' : '');
        card.style.setProperty('--fan-card-transform', `rotate(${angle}deg) translateY(-${FAN_RADIUS}px)`);
        fan.appendChild(card);

        if (animIncrease && i >= prev) {
            const delay = (i - prev) * fanStagger;
            card.style.animationDelay = delay + 'ms';
            setTimeout(() => {
                card.classList.remove('card-fan-enter');
                card.style.animationDelay = '';
            }, fadeMs + delay + 50);
        }
    }
}

function resetAvatarCardFans() {
    avatarCardFans.clear();
    avatarPrevCounts.clear();
}

const avatarSlotEls = new Map<number, HTMLDivElement>();

function renderAvatars(message: SyncMessage) {
    const avatars = document.getElementById('avatars') as HTMLDivElement;

    const seated = message.players
        .map((player, index) => ({ player, index }))
        .filter((p): p is { player: PlayerSync, index: number } => p.player !== null);

    const positions = computeAvatarPositions(seated.length);
    const selfSeat = seated.findIndex(s => s.index === message.youAre);
    const seatedIndices = new Set(seated.map(s => s.index));

    for (const [index, slot] of avatarSlotEls)
        if (!seatedIndices.has(index)) {
            slot.remove();
            avatarSlotEls.delete(index);
        }

    seated.forEach(({ player, index }, seat) => {
        let slot = avatarSlotEls.get(index);
        let avatar: HTMLDivElement;
        let letter: HTMLSpanElement;
        let name: HTMLDivElement;
        let score: HTMLDivElement;

        if (!slot) {
            slot = document.createElement('div');
            slot.id = avatarSlotId(index);

            renderAvatarCardFan(index, player.numCards);
            const fan = avatarCardFans.get(index);
            if (fan) slot.appendChild(fan);

            avatar = document.createElement('div');
            avatar.className = 'avatar';
            letter = document.createElement('span');
            letter.className = 'avatar-letter';
            avatar.appendChild(letter);
            slot.appendChild(avatar);

            name = document.createElement('div');
            name.className = 'avatar-name';
            slot.appendChild(name);

            score = document.createElement('div');
            score.className = 'avatar-score';
            slot.appendChild(score);

            avatarSlotEls.set(index, slot);
            avatars.appendChild(slot);
        } else {
            renderAvatarCardFan(index, player.numCards);
            const fan = avatarCardFans.get(index);
            if (fan && fan.parentElement !== slot) slot.prepend(fan);
            avatar = slot.querySelector('.avatar') as HTMLDivElement;
            letter = avatar.querySelector('.avatar-letter') as HTMLSpanElement;
            name = slot.querySelector('.avatar-name') as HTMLDivElement;
            score = slot.querySelector('.avatar-score') as HTMLDivElement;
        }

        slot.className = 'avatar-slot' +
            (index === message.turn ? ' current-turn' : '') +
            (player.disconnected ? ' disconnected' : '');
        const rel = selfSeat === -1 ? seat :
            (seat - selfSeat + seated.length) % seated.length;
        slot.style.left = positions[rel].left + '%';
        slot.style.top = positions[rel].top + '%';

        let bg = player.profilePicture ? `url("${player.profilePicture}")` : null;
        if (bg) {
            avatar.style.setProperty('--avatar-img', bg);
            letter.innerText = '';
        } else {
            avatar.style.removeProperty('--avatar-img');
            letter.innerText = player.username.charAt(0).toUpperCase();
        }

        let icon = avatar.querySelector('.avatar-disconnected-icon') as HTMLDivElement | null;
        if (player.disconnected) {
            if (!icon) {
                icon = document.createElement('div');
                icon.className = 'avatar-disconnected-icon';
                icon.title = 'Disconnected';
                icon.innerText = '\u26A0';
                avatar.appendChild(icon);
            }
        } else if (icon) icon.remove();

        name.innerText = player.username + (index === message.youAre ? ' (You)' : '');
        score.innerText = player.disconnected ?
            `Reconnecting... ${player.graceSecondsRemaining}s` : `${player.numCards} cards`;
    });
}

function spawnBsBurst(playerIndex: number) {
    const slot = avatarSlotEls.get(playerIndex);
    if (!slot) return;

    const burst = document.createElement('div');
    burst.className = 'bullshit-burst';
    burst.style.setProperty('--burst-size', BURST_SIZE_PX + 'px');
    burst.style.setProperty('--burst-x', BURST_OFFSET_X_PX + 'px');
    burst.style.setProperty('--burst-y', BURST_OFFSET_Y_PX + 'px');
    burst.style.setProperty('--burst-duration', BURST_DURATION_MS + 'ms');
    burst.addEventListener('animationend', () => burst.remove());
    slot.appendChild(burst);
}

const emoteBar = document.getElementById('emote-bar') as HTMLDivElement;
const emoteSendTimes: Array<number> = [];

function canSendEmote(now: number): boolean {
    while (emoteSendTimes.length > 0 && now - emoteSendTimes[0] >= EMOTE_RATE_WINDOW_MS)
        emoteSendTimes.shift();
    if (emoteSendTimes.length >= EMOTE_RATE_MAX) return false;
    emoteSendTimes.push(now);
    return true;
}

EMOJI_IMAGES.forEach((src, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'emote-button';
    button.style.backgroundImage = `url("${src}")`;
    button.title = (src.split('/').pop() || '').replace(/\.png$/, '');
    button.onclick = () => {
        if (!connectionOpen() || !canSendEmote(Date.now())) return;
        connection.send(JSON.stringify({ type: 'EMOTE', index }));
    };
    emoteBar.appendChild(button);
});

function spawnEmote(playerIndex: number, index: number) {
    if (typeof playerIndex !== 'number' || playerIndex < 0) return;
    if (typeof index !== 'number' || !EMOJI_IMAGES[index]) return;

    const slot = avatarSlotEls.get(playerIndex);
    if (!slot) return;

    const emote = document.createElement('div');
    emote.className = 'emote-float';
    emote.style.backgroundImage = `url("${EMOJI_IMAGES[index]}")`;
    emote.addEventListener('animationend', () => emote.remove());
    slot.appendChild(emote);
}

/**
 * ---------------------------
 * Pile
 * ---------------------------
 */
const pileStack = document.getElementById('pile-stack') as HTMLDivElement;
const pileCount = document.getElementById('pile-count') as HTMLDivElement;

const PILE_OFFSET_X = 0;          // px horizontal shift per pile slot
const PILE_OFFSET_Y = -2;         // px vertical shift per pile slot (each card sits 2px above the last)
const PILE_MAX_STACK_CARDS = 16;  // slots >= this share the topmost position, so the stack
                                  // can't grow into the turn info above the pile

interface PileCard {
    el: HTMLDivElement;
    slot: number;
    /** resting = settled, flying = mid-transition,
     *  spread = in the BS fan row face-down, flipped = in the fan row face-up */
    state: 'resting' | 'flying' | 'spread' | 'flipped';
}

/** Pile cards currently on screen, keyed by pile slot */
const pileBySlot = new Map<number, PileCard>();
/** Next free pile slot (mirrors the server's centerDeckSize) */
let logicalPileCount = 0;
/** Bumped when the pile is wiped so pending animation timers bail out */
let pileEpoch = 0;
/** Timestamp until which sync-driven pile re-renders are suppressed */
let animatingPileUntil = 0;

const BS_SPREAD_STAGGER_MAX_MS = 25;
const BS_SPREAD_STAGGER_TOTAL_MS = 300;

type BsPhase = 'spread' | 'flip' | 'payout';
let bsPhase: BsPhase | null = null;
let bsLoser = -1;
let fanPositions: Array<{ left: number, top: number }> = [];
let payoutTimer: ReturnType<typeof setTimeout> | null = null;
let bsEndTimer: ReturnType<typeof setTimeout> | null = null;
/** Events that arrived while a BS sequence was animating, replayed in order */
let pendingEvents: Array<LastEvent> = [];
let hasSyncedOnce = false;

/**
 * Viewport top-left of the card sitting at pile slot `slot`. Clamped to the
 * topmost slot, so a card is never targeted above the top of the stack.
 * @return {{left: number, top: number}}
 */
function pileSlotPosition(slot: number) {
    const rect = pileStack.getBoundingClientRect();
    const depth = Math.min(Math.max(slot, 0), PILE_MAX_STACK_CARDS - 1);
    return {
        left: rect.left + depth * PILE_OFFSET_X,
        top: rect.top + depth * PILE_OFFSET_Y
    };
}

/**
 * Reposition every pile card that isn't mid-flight. The pile is drawn in the
 * fixed fx layer, so it has to follow #game when the page scrolls or resizes.
 * Transitions are disabled for the write: a 0.5s ease would make the pile lag
 * behind the scroll instead of staying glued to #pile-stack.
 */
function layoutPile() {
    if (bsPhase === 'spread' || bsPhase === 'flip') {
        const fanned = [...pileBySlot.values()]
            .filter(card => card.state === 'spread' || card.state === 'flipped')
            .sort((a, b) => a.slot - b.slot);
        if (fanned.length === 0) return;

        fanPositions = computeFanPositions(fanned.length);
        for (const card of fanned) card.el.style.transition = 'none';
        fanned.forEach((card, i) => {
            card.el.style.left = fanPositions[i].left + 'px';
            card.el.style.top = fanPositions[i].top + 'px';
        });
        void pileStack.offsetWidth;
        for (const card of fanned) card.el.style.transition = '';
        return;
    }

    const cards = [...pileBySlot.values()].filter(card => card.state === 'resting');
    if (cards.length === 0) return;

    for (const card of cards) card.el.style.transition = 'none';
    for (const card of cards) {
        const pos = pileSlotPosition(card.slot);
        card.el.style.left = pos.left + 'px';
        card.el.style.top = pos.top + 'px';
    }
    void pileStack.offsetWidth;
    for (const card of cards) card.el.style.transition = '';
}

/** Label counts the cards physically shown in the pile (in-flight excluded) */
function updatePileLabel() {
    let visible = 0;
    for (const card of pileBySlot.values())
        if (card.state !== 'flying') visible++;
    pileCount.innerText = visible > 0 ? `${visible} cards` : '';
}

/** Reconcile the pile to exactly `count` cards (sync path, animations idle) */
function setPileCount(count: number) {
    count = Math.max(count, 0);
    logicalPileCount = count;

    for (const [slot, card] of [...pileBySlot.entries()]) {
        if (slot < count) continue;
        releaseCard(card.el);
        pileBySlot.delete(slot);
    }

    for (let slot = 0; slot < count; slot++) {
        if (pileBySlot.has(slot)) continue;
        const el = acquireCard();
        if (!el) continue;
        pileBySlot.set(slot, { el, slot, state: 'resting' });
        placeCard(el, pileSlotPosition(slot), 1);
    }

    // Sweep any pooled card that's in use but no longer part of the pile -
    // eg. an element orphaned by a raced/cancelled animation. Without this
    // it stays visible forever (it's not in the map, so nothing else can
    // release it). Cards mid-return-flight are already faded to opacity 0
    // by the time we get here (animations are idle), so parking them early
    // is invisible.
    const used = new Set([...pileBySlot.values()].map(card => card.el));
    for (const el of cardPool)
        if (el.style.display !== 'none' && !used.has(el)) releaseCard(el);

    layoutPile();
    updatePileLabel();
}

/** Wipe the pile + cancel in-flight pile animations (returned to lobby) */
function resetPile() {
    pileEpoch++;
    if (payoutTimer !== null) clearTimeout(payoutTimer);
    if (bsEndTimer !== null) clearTimeout(bsEndTimer);
    payoutTimer = null;
    bsEndTimer = null;
    bsPhase = null;
    bsLoser = -1;
    fanPositions = [];
    pendingEvents = [];
    for (const card of pileBySlot.values()) releaseCard(card.el);
    pileBySlot.clear();
    logicalPileCount = 0;
    animatingPileUntil = 0;
    updatePileLabel();
    for (const slot of avatarSlotEls.values()) slot.remove();
    avatarSlotEls.clear();
    const avatarsEl = document.getElementById('avatars');
    if (avatarsEl) avatarsEl.replaceChildren();
    resetAvatarCardFans();
}

gameDiv.addEventListener('scroll', layoutPile);
window.addEventListener('resize', layoutPile);

/**
 * ---------------------------
 * Flying card animation (player -> pile, pile -> player)
 * ---------------------------
 */
const fxLayer = document.getElementById('fx-layer') as HTMLDivElement;

const CARD_FLY_TRAVEL_MS = 550; // must equal the card fly transition in css
const CARD_FLY_STAGGER_MS = 220;       // delay between cards, player -> pile
const CARD_FLY_STAGGER_BACK_MS = 100;  // delay between cards, pile -> player (return trip is snappier)
const CARD_FAN_SCALE = 60 / 112.5;
const POOL_SIZE = DECK_SIZE; // Full deck: the pile + in-flight cards never exceed this

/** Pooled cards, hidden and parked off screen until acquired */
const cardPool: Array<HTMLDivElement> = [];

/** Hide a pooled card, cancel any transition it was running, park it off screen */
function parkCard(card: HTMLDivElement) {
    card.style.transition = 'none';
    card.style.display = 'none';
    card.style.left = '-9999px';
    card.style.top = '-9999px';
    card.style.opacity = '0';
    card.style.transform = '';
    card.style.zIndex = '';

    const flip = card.querySelector('.fx-card-flip') as HTMLElement | null;
    if (flip) {
        flip.style.transition = 'none';
        flip.style.transform = '';
        void flip.offsetWidth;
        flip.style.transition = '';
    }
    const front = card.querySelector('.fx-face-front') as HTMLElement | null;
    if (front) {
        front.className = 'fx-face fx-face-front';
        front.innerHTML = '';
    }
}

function initCardPool() {
    for (let i = 0; i < POOL_SIZE; i++) {
        const card = document.createElement('div');
        card.className = 'fx-flying-card';
        card.innerHTML =
            '<div class="fx-card-flip">' +
            '<div class="fx-face fx-face-back"></div>' +
            '<div class="fx-face fx-face-front"></div>' +
            '</div>';
        parkCard(card);
        fxLayer.appendChild(card);
        cardPool.push(card);
    }
}

/** @return {HTMLDivElement | null} A hidden pooled card, now made visible */
function acquireCard(): HTMLDivElement | null {
    const card = cardPool.find(c => c.style.display === 'none') || null;
    if (card) card.style.display = 'block';
    return card;
}

/** Hand a card back to the hidden pool */
function releaseCard(card: HTMLDivElement) {
    parkCard(card);
}

/**
 * @param {DOMRect} rect Area to center on
 * @param {HTMLDivElement} card Card being positioned (measured for its half size)
 * @return {{left: number, top: number}} Viewport top-left of `card` centered on `rect`
 */
function centeredOn(rect: DOMRect, card: HTMLDivElement) {
    return {
        left: rect.left + rect.width / 2 - card.offsetWidth / 2,
        top: rect.top + rect.height / 2 - card.offsetHeight / 2
    };
}

/**
 * Viewport position for a card centered on a player's avatar slot. Avatar
 * slots can be removed (player leaves) or added between syncs, so each card
 * must look the element up fresh at the moment it actually moves - holding
 * a reference from event time gives a detached node with an empty rect.
 * @return {{left: number, top: number} | null} null if the avatar is gone
 */
function avatarTarget(playerIndex: number, card: HTMLDivElement) {
    const avatar = document.getElementById(avatarSlotId(playerIndex));
    return avatar ? centeredOn(avatar.getBoundingClientRect(), card) : null;
}

/**
 * Commit start values with transitions disabled, then apply end values on the
 * next frame with the CSS transition active. The disable/flush is required:
 * a forced layout alone doesn't stop an already-scheduled transition, so a
 * recycled pool card would sweep in from its parked -9999px position instead
 * of appearing at its start point (and the browser can also race paint
 * scheduling and skip straight to the end state - the original "snap" bug).
 */
function transitionCard(card: HTMLDivElement, applyStart: () => void, applyEnd: () => void) {
    card.style.transition = 'none';
    applyStart();
    void card.offsetWidth;
    card.style.transition = '';
    requestAnimationFrame(applyEnd);
}

/** Spawn `card` at `from` with `startOpacity`, then fly it to `to` + `endOpacity` */
function animateCard(card: HTMLDivElement, from: { left: number, top: number },
        to: { left: number, top: number }, startOpacity: number, endOpacity: number,
        onLand?: () => void, startAngle: number = 0, startScale: number = 1) {
    transitionCard(card, () => {
        card.style.left = from.left + 'px';
        card.style.top = from.top + 'px';
        card.style.opacity = String(startOpacity);
        card.style.transform = `rotate(${startAngle}deg) scale(${startScale})`;
    }, () => {
        card.style.left = to.left + 'px';
        card.style.top = to.top + 'px';
        card.style.opacity = String(endOpacity);
        card.style.transform = 'rotate(0deg) scale(1)';
    });
    if (onLand) setTimeout(onLand, CARD_FLY_TRAVEL_MS);
}

/**
 * Retarget a card that's already on screen (eg. still inbound from an earlier
 * submit) to `to`. No start commit: the transition continues from the card's
 * current position/opacity instead of jumping.
 */
function flyCardTo(card: HTMLDivElement, to: { left: number, top: number },
        endOpacity: number, onLand?: () => void,
        endAngle: number = 0, endScale: number = 1) {
    card.style.left = to.left + 'px';
    card.style.top = to.top + 'px';
    card.style.opacity = String(endOpacity);
    card.style.transform = `rotate(${endAngle}deg) scale(${endScale})`;
    if (onLand) setTimeout(onLand, CARD_FLY_TRAVEL_MS);
}

/** Put a card at `pos` + `opacity` instantly (transitions disabled) */
function placeCard(card: HTMLDivElement, pos: { left: number, top: number }, opacity: number) {
    transitionCard(card, () => {
        card.style.left = pos.left + 'px';
        card.style.top = pos.top + 'px';
        card.style.opacity = String(opacity);
        card.style.transform = 'rotate(0deg) scale(1)';
    }, () => { /* placed, nothing to transition to */ });
}

/** @return {number} ms until the last card of a `count`-card stagger lands */
function flyCardsDuration(count: number, staggerMs: number): number {
    return count > 0 ? (count - 1) * staggerMs + CARD_FLY_TRAVEL_MS : 0;
}

interface CardAnimOptions {
    count: number;
    playerIndex: number;
    startOpacity: number;
    endOpacity: number;
}

/**
 * Fly `count` pooled cards from the player's avatar to their own pile slots.
 * Slots are claimed up front, so a move made while cards are still in the
 * air targets the slots above them.
 */
function runCardAnimation(options: CardAnimOptions) {
    const { count, playerIndex, startOpacity, endOpacity } = options;
    if (count <= 0) return;

    const stagger = computeCardStagger(count, CARD_FLY_STAGGER_MS);
    const epoch = pileEpoch;
    animatingPileUntil = Math.max(animatingPileUntil,
        Date.now() + flyCardsDuration(count, stagger));

    const base = logicalPileCount;
    logicalPileCount += count;

    for (let i = 0; i < count; i++) {
        const slot = base + i;
        setTimeout(() => {
            if (epoch !== pileEpoch) return;
            // A BS may have freed this slot while the spawn was queued -
            // materialising the card now would leave it stranded in an
            // already-cleared pile (and overwrite any card that took
            // its place, orphaning that element for good)
            if (slot >= logicalPileCount || pileBySlot.has(slot)) return;

            const card = acquireCard();
            if (!card) return;

            const entry: PileCard = { el: card, slot, state: 'flying' };
            pileBySlot.set(slot, entry);

            const from = avatarTarget(playerIndex, card);
            if (!from) { // Avatar gone (player left): drop straight into the pile
                entry.state = 'resting';
                placeCard(card, pileSlotPosition(slot), 1);
                updatePileLabel();
                return;
            }

            animateCard(card, from, pileSlotPosition(slot), startOpacity, endOpacity, () => {
                if (epoch !== pileEpoch || pileBySlot.get(slot) !== entry) return;
                if (entry.state !== 'flying') return;
                entry.state = 'resting';
                layoutPile();
                updatePileLabel();
            }, randomFanRotation(playerIndex), CARD_FAN_SCALE);
        }, i * stagger);
    }
}

initCardPool();

/**
 * ---------------------------
 * BS reveal sequence: fan out -> flip -> payout
 * ---------------------------
 */
function computeFanPositions(count: number): Array<{ left: number, top: number }> {
    const rect = pileStack.getBoundingClientRect();
    const cardW = rect.width || 112.5;
    const MARGIN = 16;
    const chatWidth = chatColumnWidth();
    const usableWidth = window.innerWidth - chatWidth;
    const spacing = count > 1 ?
        Math.max(4, Math.min(cardW * 0.5, (usableWidth - 2 * MARGIN - cardW) / (count - 1))) : 0;
    const rowWidth = cardW + spacing * (count - 1);
    const startX = Math.max(MARGIN, (usableWidth - rowWidth) / 2);

    return Array.from({ length: count },
        (_, i) => ({ left: startX + i * spacing, top: rect.top }));
}

function runBsSpread(loser: number) {
    const entries = [...pileBySlot.values()].sort((a, b) => a.slot - b.slot);
    if (entries.length === 0) return;

    bsPhase = 'spread';
    bsLoser = loser;
    fanPositions = computeFanPositions(entries.length);

    const stagger = entries.length > 1 ?
        Math.min(BS_SPREAD_STAGGER_MAX_MS, BS_SPREAD_STAGGER_TOTAL_MS / (entries.length - 1)) : 0;
    animatingPileUntil = Math.max(animatingPileUntil,
        Date.now() + stagger * (entries.length - 1) + CARD_FLY_TRAVEL_MS + 100);
    const epoch = pileEpoch;

    entries.forEach((entry, i) => {
        entry.state = 'spread';
        entry.el.style.zIndex = String(i);
        setTimeout(() => {
            if (epoch !== pileEpoch || bsPhase !== 'spread') return;
            flyCardTo(entry.el, fanPositions[i], 1);
        }, i * stagger);
    });
    updatePileLabel();
}

function renderRevealFace(el: HTMLDivElement, card: CardLike) {
    const front = el.querySelector('.fx-face-front') as HTMLElement | null;
    if (!front) return;

    const suit = SUIT_SYMBOL_MAP[card.suit] || '';
    const rank = GET_SYMBOL(card.value);
    front.className = 'fx-face fx-face-front' + (RED_SUITS.includes(card.suit) ? ' red' : '');
    front.innerHTML =
        `<div class="fx-front-corner fx-corner-top">${rank}<br>${suit}</div>` +
        `<div class="fx-front-corner fx-corner-bottom">${rank}<br>${suit}</div>` +
        `<div class="fx-front-suit">${suit}</div>`;
}

function runBsReveal(cards: Array<CardLike>, loser: number) {
    const entries = [...pileBySlot.values()].sort((a, b) => a.slot - b.slot);
    if (entries.length === 0) return;

    if (bsPhase === null) {
        // Missed the BS event (reconnect mid-reveal): snap into the row first
        fanPositions = computeFanPositions(entries.length);
        entries.forEach((entry, i) => {
            entry.state = 'spread';
            entry.el.style.zIndex = String(i);
            placeCard(entry.el, fanPositions[i], 1);
        });
    }

    bsPhase = 'flip';
    bsLoser = loser;
    const epoch = pileEpoch;

    const revealStart = Math.max(0, logicalPileCount - cards.length);
    const toFlip: Array<PileCard> = [];
    entries.forEach(entry => {
        const cardIndex = entry.slot - revealStart;
        if (cardIndex < 0 || !cards[cardIndex]) return;
        renderRevealFace(entry.el, cards[cardIndex]);
        entry.state = 'flipped';
        toFlip.push(entry);
    });

    requestAnimationFrame(() => {
        if (epoch !== pileEpoch) return;
        for (const entry of toFlip) {
            const flip = entry.el.querySelector('.fx-card-flip') as HTMLElement | null;
            if (flip) flip.style.transform = 'rotateY(180deg)';
        }
    });

    animatingPileUntil = Math.max(animatingPileUntil, Date.now() +
        BS_FLIP_MS + REVEAL_DELAY_MS +
        flyCardsDuration(entries.length, CARD_FLY_STAGGER_BACK_MS) + 100);

    payoutTimer = setTimeout(() => {
        if (epoch !== pileEpoch) return;
        runBsPayout();
    }, BS_FLIP_MS + REVEAL_DELAY_MS);
}

function runBsPayout() {
    const entries = [...pileBySlot.values()].sort((a, b) => a.slot - b.slot);
    if (entries.length === 0) {
        endBsSequence();
        return;
    }

    bsPhase = 'payout';
    const epoch = pileEpoch;
    const loser = bsLoser;
    const stagger = computeCardStagger(entries.length, CARD_FLY_STAGGER_BACK_MS);

    playSound(SHUFFLE_SOUNDS[Math.floor(Math.random() * SHUFFLE_SOUNDS.length)], 0.6);

    entries.forEach((entry, i) => setTimeout(() => {
        if (epoch !== pileEpoch) return;
        if (pileBySlot.get(entry.slot) === entry) pileBySlot.delete(entry.slot);
        updatePileLabel();

        const to = loser >= 0 ? avatarTarget(loser, entry.el) : null;
        if (!to) {
            releaseCard(entry.el);
            return;
        }
        flyCardTo(entry.el, to, 0, () => {
            if (epoch !== pileEpoch) return;
            releaseCard(entry.el);
        }, randomFanRotation(loser), CARD_FAN_SCALE);
    }, i * stagger));

    bsEndTimer = setTimeout(() => {
        if (epoch !== pileEpoch) return;
        endBsSequence();
    }, flyCardsDuration(entries.length, stagger) + 50);
}

function endBsSequence() {
    if (payoutTimer !== null) clearTimeout(payoutTimer);
    if (bsEndTimer !== null) clearTimeout(bsEndTimer);
    payoutTimer = null;
    bsEndTimer = null;
    bsPhase = null;
    bsLoser = -1;
    fanPositions = [];
    logicalPileCount = 0;
    updatePileLabel();
    updateButtonStates();
    if (latestSync && latestSync.started) renderAvatars(latestSync);

    // Replay everything that arrived mid-animation in arrival order - a
    // single slot dropped every event but the last (eg. a submit followed
    // by the next challenge), leaving the pile to reconcile on a later sync
    while (pendingEvents.length) {
        const event = pendingEvents.shift() as LastEvent;
        handleEvent(event);
    }
}


/** Handle a (new, not-yet-seen) event from the server for animation purposes */
function handleEvent(event: LastEvent) {
    if (event.type === 'SUBMIT' && event.player !== undefined && event.count !== undefined) {
        playSound(SHUFFLE_SOUNDS[Math.floor(Math.random() * SHUFFLE_SOUNDS.length)], 0.6);
        runCardAnimation({
            count: event.count,
            playerIndex: event.player,
            startOpacity: 0,   // fades in as it leaves the avatar
            endOpacity: 1
        });
    }
    else if (event.type === 'BS' && event.loser !== undefined)
        runBsSpread(event.loser);
    else if (event.type === 'REVEAL' && event.cards !== undefined)
        runBsReveal(event.cards, event.loser !== undefined ? event.loser : bsLoser);
}

/**
 * ---------------------------
 * Lobby rendering
 * ---------------------------
 */
function renderLobby(message: SyncMessage) {
    let playerList = '<ol>';
    for (let player of message.players) {
        if (!player) continue;
        const pfp = player.profilePicture;
        const thumb = PROFILE_PICTURES.includes(pfp) ?
            `<span class="lobby-pfp" style="background-image: url('${pfp}')"></span>` : '';
        playerList += `<li class="${player.ready ? 'active' : ''}">
            <span style="font-size: 12pt; color: ${player.ready ? '#66ff52' : 'gray'}">█ &nbsp;</span>${thumb}${player.username}
        </li>`;
    }
    playerList += '</ol>';
    (document.getElementById('lobby-player-list') as HTMLDivElement).innerHTML = playerList;

    updatePfpButtons(message);

    let self = message.players[message.youAre];
    readyButton.innerText = self && self.ready ? 'Unready' : 'Ready';
    if (self && self.ready) readyButton.classList.add('active');
    else readyButton.classList.remove('active');

    let count = message.players.filter(p => p !== null).length;
    let everyoneReady = message.players.filter(p => p !== null).every(p => (p as PlayerSync).ready);
    let canStart = count >= MIN_PLAYERS && everyoneReady;

    startGameButton.style.display = message.isHost ? 'inline-block' : 'none';
    startGameButton.disabled = !canStart;

    if (message.isHost)
        startGameHint.innerText = canStart ? 'Everyone is ready - click start!' :
            (count < MIN_PLAYERS ? `Need at least ${MIN_PLAYERS} players` : 'Waiting for everyone to ready up...');
    else
        startGameHint.innerText = everyoneReady ? 'Waiting for the host to start the game...' : '';
}

function renderTurnInfo(message: SyncMessage) {
    const turnLabel = document.getElementById('turn-label') as HTMLSpanElement;
    const valueToPlace = document.getElementById('value-to-place') as HTMLSpanElement;

    let turnPlayer = message.players[message.turn];
    turnLabel.innerText = message.turn === message.youAre ? 'Your turn!' :
        `${turnPlayer ? turnPlayer.username : '???'}'s turn`;
    valueToPlace.innerText = GET_SYMBOL(message.valueToPlace);
}

const TIMER_SIZE = 52;
const TIMER_GAP = 14;
const TIMER_MOVE_MS = 750;
const CHAT_WIDTH = 325;
const NAVBAR_HEIGHT = 35.4;

/** The chat column only exists on wide layouts; nothing may assume 250px */
function chatColumnWidth(): number {
    return window.innerWidth > 700 ? CHAT_WIDTH : 0;
}

const turnTimer = document.getElementById('turn-timer') as HTMLDivElement;
const turnTimerRing = turnTimer.querySelector('.timer-ring') as SVGCircleElement;
const turnTimerHand = turnTimer.querySelector('.timer-hand-wrap') as SVGGElement;

interface TimerPos {
    x: number;
    y: number;
}

interface TimerRect {
    left: number;
    right: number;
    top: number;
    height: number;
}

let timerPos: TimerPos | null = null;
let timerMove: { from: TimerPos, ctrl: TimerPos, to: TimerPos, start: number } | null = null;
let lastTimerTurn = -1;
let timerSeconds = TURN_TIME_SECONDS;
let timerSecondsAt = 0;
let timerTotal = TURN_TIME_SECONDS;
let timerRaf = 0;
let alarmPlayed = false;

function quadBez(from: TimerPos, ctrl: TimerPos, to: TimerPos, t: number): TimerPos {
    const u = 1 - t;
    return {
        x: u * u * from.x + 2 * u * t * ctrl.x + t * t * to.x,
        y: u * u * from.y + 2 * u * t * ctrl.y + t * t * to.y
    };
}

function applyTimerPos(pos: TimerPos) {
    turnTimer.style.left = pos.x + 'px';
    turnTimer.style.top = pos.y + 'px';
}

function curveControl(from: TimerPos, to: TimerPos): TimerPos {
    const mx = (from.x + to.x) / 2;
    const my = (from.y + to.y) / 2;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy) || 1;
    let nx = -dy / dist;
    let ny = dx / dist;
    const arena = document.getElementById('game-arena');
    const ar = arena ? arena.getBoundingClientRect() : {
        left: 0, top: 0, width: window.innerWidth, height: window.innerHeight
    };
    const cx = ar.left + ar.width / 2;
    const cy = ar.top + ar.height / 2;
    if (nx * (cx - mx) + ny * (cy - my) > 0) {
        nx = -nx;
        ny = -ny;
    }
    const bulge = Math.min(160, dist * 0.4);
    return { x: mx + nx * bulge, y: my + ny * bulge };
}

function timerBeside(rect: TimerRect, preferLeft: boolean): TimerPos {
    const leftX = rect.left - TIMER_GAP - TIMER_SIZE / 2;
    const rightX = rect.right + TIMER_GAP + TIMER_SIZE / 2;
    const minX = TIMER_SIZE / 2 + 10;
    const maxX = window.innerWidth - chatColumnWidth() - TIMER_SIZE / 2 - 10;
    let x = preferLeft ? leftX : rightX;
    if (x < minX) x = Math.min(maxX, rightX);
    if (x > maxX) x = Math.max(minX, leftX);
    x = Math.max(minX, Math.min(maxX, x));
    const minY = NAVBAR_HEIGHT + TIMER_SIZE / 2 + 8;
    const maxY = window.innerHeight - TIMER_SIZE / 2 - 8;
    const y = Math.max(minY, Math.min(maxY, rect.top + rect.height / 2));
    return { x, y };
}

function computeTimerTarget(message: SyncMessage): TimerPos {
    if (message.turn === message.youAre) {
        const cards = [...handContainer.querySelectorAll('.card:not(.card-exit)')] as HTMLElement[];
        if (cards.length > 0) {
            let left = Infinity;
            let top = Infinity;
            let bottom = -Infinity;
            for (const el of cards) {
                const r = el.getBoundingClientRect();
                left = Math.min(left, r.left);
                top = Math.min(top, r.top);
                bottom = Math.max(bottom, r.bottom);
            }
            return timerBeside({ left, right: left + 1, top, height: bottom - top }, true);
        }
        const r = handContainer.getBoundingClientRect();
        return timerBeside({
            left: r.left + 24,
            right: r.left + 25,
            top: r.top + 36,
            height: 140
        }, true);
    }

    const slot = document.getElementById(avatarSlotId(message.turn));
    const avatar = slot ? slot.querySelector('.avatar') as HTMLElement | null : null;
    if (avatar) {
        const r = avatar.getBoundingClientRect();
        const arena = document.getElementById('game-arena');
        const ar = arena ? arena.getBoundingClientRect() : r;
        const preferLeft = (r.left + r.width / 2) < (ar.left + ar.width / 2);
        return timerBeside({
            left: r.left,
            right: r.right,
            top: r.top,
            height: r.height
        }, preferLeft);
    }

    const arena = document.getElementById('game-arena');
    if (arena) {
        const r = arena.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + 80 };
    }
    return { x: window.innerWidth / 2, y: 120 };
}

function hideTurnTimer() {
    turnTimer.classList.remove('is-on', 'urgent');
    if (timerRaf) {
        cancelAnimationFrame(timerRaf);
        timerRaf = 0;
    }
    timerPos = null;
    timerMove = null;
    lastTimerTurn = -1;
    alarmPlayed = false;
}

function syncTimerSeconds(message: SyncMessage) {
    // Re-anchor to the server's value on *every* sync, not just when it
    // changes: syncs also arrive mid-second for events, and after a reveal
    // the server restarts the timer at TURN_TIME_SECONDS - waiting for a
    // change left the local RAF counting against a stale anchor
    if (message.turn !== lastTimerTurn || message.secondsRemaining > timerSeconds)
        timerTotal = Math.max(message.secondsRemaining, 1);
    timerSeconds = message.secondsRemaining;
    timerSecondsAt = performance.now();
}

function tickTurnTimer(now: number) {
    // The server freezes the turn timer while a reveal resolves: don't count
    // down or run the urgent alarm during that window (the syncs arriving
    // with an unchanged secondsRemaining gave the RAF nothing to re-sync to)
    if (bsPhase === null) {
        const remaining = Math.max(0, timerSeconds - (now - timerSecondsAt) / 1000);
        const frac = remaining / timerTotal;
        turnTimerRing.style.strokeDashoffset = String(1 - frac);
        turnTimerHand.style.transform = `rotate(${(frac) * 360}deg)`;
        const urgent = remaining < 5;
        turnTimer.classList.toggle('urgent', urgent);
        if (!urgent) alarmPlayed = false;
        else if (!alarmPlayed) {
            alarmPlayed = true;
            playSound(ALARM_SOUND, 0.7);
        }
    }

    const sync = latestSync;
    const target = sync && sync.started ? computeTimerTarget(sync) : null;

    if (timerMove) {
        if (target) timerMove.to = target;
        const t = Math.min(1, (now - timerMove.start) / TIMER_MOVE_MS);
        timerPos = quadBez(timerMove.from, timerMove.ctrl, timerMove.to,
            t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        if (t >= 1) timerMove = null;
    } else if (target) {
        if (!timerPos) timerPos = target;
        else {
            timerPos = {
                x: timerPos.x + (target.x - timerPos.x) * 0.18,
                y: timerPos.y + (target.y - timerPos.y) * 0.18
            };
        }
    }

    if (timerPos) applyTimerPos(timerPos);

    if (sync && sync.started)
        timerRaf = requestAnimationFrame(tickTurnTimer);
    else
        timerRaf = 0;
}

function updateTurnTimer(message: SyncMessage) {
    if (!message.started) {
        hideTurnTimer();
        return;
    }

    syncTimerSeconds(message);
    const target = computeTimerTarget(message);
    const turnChanged = message.turn !== lastTimerTurn;
    lastTimerTurn = message.turn;

    turnTimer.classList.add('is-on');

    if (!timerPos) {
        timerPos = target;
        applyTimerPos(timerPos);
        timerMove = null;
    } else if (turnChanged) {
        timerMove = {
            from: { x: timerPos.x, y: timerPos.y },
            ctrl: curveControl(timerPos, target),
            to: target,
            start: performance.now()
        };
    }

    if (!timerRaf)
        timerRaf = requestAnimationFrame(tickTurnTimer);
}

/**
 * ---------------------------
 * Win modal
 * ---------------------------
 */
function showWinModal(message: SyncMessage) {
    let winner = message.players[message.winner];
    (document.getElementById('win-modal') as HTMLDivElement).style.display = 'block';
    (document.getElementById('win-h1') as HTMLHeadingElement).innerText = 'Round Over';
    (document.getElementById('win-text') as HTMLParagraphElement).innerText = winner ?
        `${winner.username}${message.winner === message.youAre ? ' (You)' : ''} got rid of all their cards!` :
        'The round ended early (not enough players).';
}

/**
 * ---------------------------
 * Main message handler
 * ---------------------------
 */
let wasStarted = false;
let handledEventSeq = 0;
let lastBeepTurn: number | null = null;

connection.onmessage = (message: any) => {
    message = JSON.parse(message.data);

    switch (message.type) {
        case 'ERROR': {
            if (message.code === 'NO_GAME')
                window.location.href = window.location.href.split('?')[0];
            alert(message.error);
            break;
        }
        case 'CHAT': {
            const color = usernameColor(message.username);
            // @ts-expect-error
            let msg = chatToHTML(`<span style="color:${color}">[${message.username}] ${message.message}</span>`);
            let isAtBottom =
                Math.abs(chatMessages.scrollTop - chatMessages.scrollHeight + chatMessages.offsetHeight) < 10;
            chatMessages.appendChild(msg);

            if (isAtBottom) // Auto scroll down
                chatMessages.scrollTop = chatMessages.scrollHeight;
            break;
        }
        case 'EMOTE': {
            spawnEmote(message.i, message.index);
            break;
        }
        case 'UUID': {
            // Game UUID recieved
            let url = window.location.href.split('?')[0] + '?' + message.uuid;
            history.pushState({}, '', url);
            inviteLink.innerText = url;
            break;
        }
        case 'SYNC': {
            const sync = message as SyncMessage;

            if (!hasSyncedOnce) {
                // Adopt the event counter silently so a reconnect doesn't
                // replay animations for events that already happened
                hasSyncedOnce = true;
                if (sync.lastEvent) handledEventSeq = sync.lastEvent.seq;
            }

            lobby.style.display = sync.started ? 'none' : 'block';
            gameDiv.style.display = sync.started ? 'block' : 'none';
            emoteBar.style.display = sync.started ? 'flex' : 'none';

            if (!sync.started) {
                renderLobby(sync);
                resetPile(); // Cancels any pile animation still running from the last round
                hideTurnTimer();
                lastBeepTurn = null;
            }
            else {
                let newEvent = sync.lastEvent && sync.lastEvent.seq > handledEventSeq ? sync.lastEvent : null;
                if (newEvent) handledEventSeq = newEvent.seq;

                renderAvatars(sync);
                renderTurnInfo(sync);

                if (lastBeepTurn !== null && sync.turn !== lastBeepTurn) {
                    // @ts-expect-error
                    beep(sync.turn === sync.youAre ? 2 : undefined);
                }
                lastBeepTurn = sync.turn;

                if (newEvent && newEvent.type === 'BS' && newEvent.caller !== undefined) {
                    spawnBsBurst(newEvent.caller);
                    playSound(BULLSHIT_SOUND, 0.8);
                }

                if (newEvent) {
                    if (newEvent.type === 'REVEAL' && bsPhase === 'spread')
                        handleEvent(newEvent);
                    else if (bsPhase !== null) pendingEvents.push(newEvent);
                    else handleEvent(newEvent);
                } else if (bsPhase === null && Date.now() >= animatingPileUntil)
                    setPileCount(sync.centerDeckSize);
            }

            selfDeck = sync.selfDeck;
            // Drop any selected cards that are no longer in hand (eg. after a move)
            selectedCards = selectedCards.filter(c => selfDeck.some(d => cardKey(d) === cardKey(c)));
            if (sync.started) renderHand();

            // Adopt the sync before deriving button state from it - it used
            // to run against the previous SYNC, lagging a full tick (~1 s)
            // behind the actual turn change
            latestSync = sync;
            updateButtonStates();

            if (wasStarted && !sync.started)
                showWinModal(sync);
            wasStarted = sync.started;

            if (sync.started) updateTurnTimer(sync);

            document.title = sync.started ?
                `Bullshit | ${sync.turn === sync.youAre ? 'Your turn' : 'Waiting...'}` : 'Bullshit | Lobby';
            break;
        }
    }
};
