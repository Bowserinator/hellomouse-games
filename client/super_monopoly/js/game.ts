import { connectToGame } from '../../shared/ts/game-connection.js';
import type { GameConnection } from '../../shared/ts/game-connection.js';
import { copyInviteLink } from '../../shared/ts/copy-invite-link.js';
import { boards, isProperty } from './boards/index.js';
import { settingBounds, tokens, tokenImage, seatColors, upgrades } from './types.js';
import type { Pose, Settings } from './types.js';
import type { Sync } from './protocol.js';
import { byId, button, cancelable, confirmPanel, el, money, panel, panelActions, panelBack, tokenIcon } from './ui/dom.js';
import type { GameDialog } from './ui/dom.js';
import {
    BoardView, dicePoint, dieTransform, hellPoint, location, origin, place, readerPoint, readerRadius, scatterDice, settleDie,
    wheelPoint
} from './ui/board.js';
import { CameraController } from './ui/camera-input.js';
import type { Camera } from './ui/camera-math.js';
import { validPose } from './card-pose.js';
import { station } from './stations.js';
import { tableArt, tableArtExtent } from './ui/table-art.js';
import { interest, management } from './engine/propertyManagement.js';
import { cards, deckOf } from './engine/decks.js';
import { mortgageFee } from './engine/trades.js';
import { calculateRent } from './engine/rent.js';
import { sectors } from './engine/stockMarket.js';
import { fly } from './ui/flight.js';
import { closeAuction, showAuction } from './ui/auction.js';
import { closeFundraiser, fundraiserOpen, showFundraiser } from './ui/gofundme.js';
import { ROLL_MS, SPIN_MS, eventDuration } from './ui/timing.js';
import { tooltip } from './ui/tooltip.js';
import type { GameEvent } from './engine/state.js';

let state: Sync | null = null;
let clock = 0;
let reconnect: ReturnType<typeof setTimeout>;
let deadline: number | null = null;
let deadlineSpan = 1;
let scanAudio: AudioContext | undefined;
let scanDisplayTimer: ReturnType<typeof setTimeout>;
let localScanUntil = 0;
let log: Array<GameEvent> = [];
let readSeq = 0;
let chatUnread = 0;
const board = boards.classicUs;
const properties = [...board.spaces, ...board.hell.spaces].filter(isProperty);
const world = byId('world');
const stationHost = el('div');
const deedFans = el('div');
const felt = tableArt(1210);
const feltExtent = tableArtExtent(1210);
felt.style.width = `${feltExtent * 2}px`;
felt.style.height = `${feltExtent * 2}px`;
world.prepend(felt);
const FAN_DEED_WIDTH = 78;
const FAN_DISTANCE = 150;
const FAN_OVERLAP = 8;
const FAN_ROW_SIZE = 5;
const FAN_ROW_STEP = 112;
const creditCards: Array<HTMLButtonElement> = [];
const tokenKey = () => `super_monopoly:${locationSearch()}`;
const locationSearch = () => window.location.search.slice(1);
const cash = () => {
    const player = state?.view?.players[state.youAre];
    return (player?.cash ?? 0) - (player?.reserved ?? 0);
};

const hudActions = new Set(['ROLL', 'BAIL', 'DRAW', 'BUY', 'DECLINE', 'END', 'UNABLE', 'KEEP_MORTGAGE',
    'RELEASE_MORTGAGE', 'SELECT']);
let hudSentSeq = -1;
let hudSentTimer = 0;
let hudWait = 0;

let hudHiddenAt = 0;
let controlsTimer = 0;

function isAnimating(): boolean {
    return performance.now() < animationUntil || movingPieces.size > 0 || pendingRolls.size > 0;
}

function updateHudAway(): void {
    const view = state?.view;
    const animating = isAnimating();
    const hud = byId('hud');
    const away = !view || animating || hudSentSeq === view.seq;
    if (away && !hud.classList.contains('away')) hudHiddenAt = performance.now();
    hud.classList.toggle('away', away);
    clearTimeout(hudWait);
    if (animating) hudWait = window.setTimeout(updateHudAway, 120);
}

function send(action: string, fields: Record<string, unknown> = {}): void {
    if (action === 'ROLL') camera.focus({ x: dicePoint.x + origin.x, y: dicePoint.y + origin.y }, 0.9);
    if (hudActions.has(action) && state?.view) {
        hudSentSeq = state.view.seq;
        clearTimeout(hudSentTimer);
        hudSentTimer = window.setTimeout(() => {
            hudSentSeq = -1;
            updateHudAway();
        }, 2500);
        updateHudAway();
    }
    if (action === 'SCAN' && typeof AudioContext !== 'undefined') {
        scanAudio ??= new AudioContext();
        void scanAudio.resume().catch(() => undefined);
    }
    const actionId = crypto.getRandomValues(new Uint32Array(4)).join('-');
    connection.send({ type: 'MOVE', action, actionId, seq: state?.view?.seq ?? 0,
        generation: state?.generation, ...fields });
}

const toastStyles: Record<string, string> = {
    info: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
    error: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z',
    draw: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z',
    chest: 'M20 2H4c-1 0-2 .9-2 2v3.01c0 .72.43 1.34 1 1.69V20c0 1.1 1.1 2 2 2h14c.9 0 2-.9 2-2V8.7c.57-.35 1-.97 1-1.69V4c0-1.1-1-2-2-2zm-5 12H9v-2h6v2zm5-7H4V4h16v3z',
    stock: 'M3 3h2v16h16v2H3zm4 10 4-4 4 3 5-6 1.5 1.3-6.2 7.4-4.1-3.1-2.8 2.8z',
    upgrade: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
    hell: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
    release: 'M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z',
    swap: 'M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z',
    destroy: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
    bankrupt: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9C4.63 15.55 4 13.85 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1C19.37 8.45 20 10.15 20 12c0 4.42-3.58 8-8 8z'
};

function toastIcon(path: string): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', path);
    svg.append(shape);
    return svg;
}

function toast(text: string, kind = 'info'): void {
    const style = kind in toastStyles ? kind : 'info';
    const node = el('div', '', `toast toast--${style}`);
    node.append(toastIcon(toastStyles[style]), el('span', text));
    byId('toast-stack').append(node);
    node.animate([{ opacity: 0, translate: '0 -48px' }, { opacity: 1, translate: '0 0' }],
        { duration: 300, easing: 'ease-out' });
    setTimeout(() => {
        const fade = node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' });
        void fade.finished.catch(() => undefined).finally(() => dismissToast(node));
    }, 3000);
}

function dismissToast(node: HTMLElement): void {
    const rest = [...byId('toast-stack').children].filter(item => item !== node);
    const tops = rest.map(item => item.getBoundingClientRect().top);
    node.remove();
    rest.forEach((item, i) => {
        const shift = tops[i] - item.getBoundingClientRect().top;
        if (shift) item.animate([{ translate: `0 ${shift}px` }, { translate: '0 0' }],
            { duration: 250, easing: 'ease-out' });
    });
}

const eventToast = (event: GameEvent): string =>
    event.kind === 'draw' && event.card && deckOf(event.card) === 'chest' ? 'chest' : event.kind;

let scanSelection: 'card' | 'reader' | null = null;
let escapeSelection: string | null = null;
const table = new BoardView(world, propertyClick, action => {
    if (action === 'WHEEL') openWheel();
    else if (action === 'SCAN') selectScan('reader');
    else if (action === 'MARKET') shop();
    else send(action);
}, seat => {
    if (escapeSelection && escapeTargets().includes(seat)) confirmEscape(escapeSelection, seat);
    else if (state?.view?.swapTargets.includes(seat)) swapPicker();
    else focusSeat(seat);
});

function pickPlayer(title: string, eligible: ReadonlyArray<number>, pick: (seat: number) => void): void {
    const view = state?.view;
    if (!view) return;
    const row = el('div', '', 'player-picker');
    view.players.forEach((player, seat) => {
        const node = button('', () => {
            byId<GameDialog>('panel').close();
            pick(seat);
        }, !eligible.includes(seat));
        node.className = 'player-pick';
        node.style.setProperty('--seat', seatColors[seat]);
        const name = el('strong', player.name);
        name.style.color = seatColors[seat];
        node.append(tokenIcon(player.token, 'player-pick__icon'), name);
        row.append(node);
    });
    panel(title, row);
    cancelable();
}

function swapPicker(): void {
    pickPlayer('Identity Theft - Swap with another player', state?.view?.swapTargets ?? [], target => send('SWAP', { target }));
}

function confirmArson(): void {
    confirmPanel('Arson', 'Destroy one house before paying rent?', () => {
        byId<GameDialog>('panel').close();
        send('ARSON');
    });
}

function selectScan(part: 'card' | 'reader'): void {
    if (scanSelection && scanSelection !== part) {
        scanSelection = null;
        send('SCAN');
    } else scanSelection = scanSelection === part ? null : part;
    table.reader.classList.toggle('scan-target', scanSelection === 'card');
    creditCards[state?.youAre ?? -1]?.classList.toggle('scan-target', scanSelection === 'reader');
}

function escapeTargets(): Array<number> {
    const view = state?.view;
    if (!state || !view || !['roll', 'extra', 'end'].includes(view.phase.kind)) return [];
    return view.players.flatMap((player, seat) => !player.eliminated && player.bail !== null &&
        (seat === state?.youAre || state?.settings.hell) ? [seat] : []);
}

function highlightEscapes(): void {
    table.pieces.forEach((piece, seat) => piece.classList.toggle('escape-target',
        !!escapeSelection && escapeTargets().includes(seat)));
}

function confirmEscape(card: string, target: number): void {
    const view = state?.view;
    if (!view || !escapeTargets().includes(target)) return;
    confirmPanel('Get out of hell', `Free ${view.players[target].name}?`, () => {
        send('ESCAPE', { card, target });
        escapeSelection = null;
        highlightEscapes();
        byId<GameDialog>('panel').close();
    });
}

function escapeCard(card: string, textless = false): HTMLButtonElement {
    const node = button(textless ? '' : 'Get out of hell', () => pickPlayer('Get out of hell', escapeTargets(), target => {
        send('ESCAPE', { card, target });
        escapeSelection = null;
        highlightEscapes();
    }), !escapeTargets().length);
    node.className = 'escape-card';
    node.setAttribute('aria-label', 'Get out of hell');
    let start: PointerEvent | undefined;
    let ghost: HTMLElement | undefined;
    node.onpointerdown = event => {
        if (event.button !== 0) return;
        event.stopPropagation();
        start = event;
        node.setPointerCapture(event.pointerId);
    };
    node.onpointermove = event => {
        if (!start || Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) < 5 && !ghost) return;
        if (!ghost) {
            ghost = el('div', '', 'escape-ghost');
            byId('flight-layer').append(ghost);
            escapeSelection = card;
            highlightEscapes();
        }
        place(ghost, event.clientX, event.clientY);
    };
    node.onpointercancel = node.onlostpointercapture = () => {
        start = undefined;
        if (!ghost) return;
        ghost.remove();
        ghost = undefined;
        escapeSelection = null;
        highlightEscapes();
    };
    node.onpointerup = event => {
        start = undefined;
        if (!ghost) return;
        ghost.remove();
        ghost = undefined;
        const hit = document.elementFromPoint(event.clientX, event.clientY);
        const target = table.pieces.findIndex(piece => piece === hit);
        node.addEventListener('click', click => click.stopImmediatePropagation(), { capture: true, once: true });
        if (escapeTargets().includes(target)) confirmEscape(card, target);
        else {
            escapeSelection = null;
            highlightEscapes();
        }
    };
    return node;
}
table.root.append(deedFans, stationHost);
table.root.prepend(felt);
interface Grab {
    id: number;
    node: HTMLElement;
    from: Pose;
    pose: Pose;
    shown: number;
    x: number;
    y: number;
    moved: boolean;
    turn: number;
    raf: number;
    own: boolean;
}
let drag: Grab | null = null;
const tweens = new WeakMap<HTMLElement, () => void>();
let previewTime = 0;
let ignoreClick = false;
const anchors = new Map<HTMLElement, Camera>();
function aimPerspective(now: Camera): void {
    const frame = byId('world-frame');
    table.setVantage((frame.clientWidth / 2 - now.x) / now.scale - origin.x,
        (frame.clientHeight / 2 - now.y) / now.scale - origin.y);
}

const camera = new CameraController({
    frame: byId('world-frame'), world, content: () => ({ w: 2290, h: 1860 }),
    onChange: now => {
        anchorFlights(now);
        aimPerspective(now);
    }
});
window.addEventListener('resize', () => aimPerspective(camera.current));

function pieceCenter(node: HTMLElement): { x: number; y: number } {
    return { x: origin.x + node.offsetLeft, y: origin.y + node.offsetTop };
}

function anchorFlights(now: Camera): void {
    if (!anchors.size) return;
    const frame = byId('world-frame').getBoundingClientRect();
    for (const [node, base] of anchors)
        node.style.transform = `translate(${frame.left + now.x}px, ${frame.top + now.y}px) ` +
            `scale(${now.scale / base.scale}) translate(${-(frame.left + base.x)}px, ${-(frame.top + base.y)}px)`;
}

function flightLayer(duration: number, layer = 'flight-layer'): HTMLElement {
    const node = el('div', '', 'flight-anchor');
    byId(layer).append(node);
    anchors.set(node, { ...camera.current });
    window.setTimeout(() => {
        anchors.delete(node);
        node.remove();
    }, duration + 100);
    return node;
}

function focusSeat(seat: number): void {
    const player = state?.view?.players[seat];
    if (!player || player.eliminated) return;
    const point = location(player.position);
    camera.focus({ x: point.x + origin.x, y: point.y + origin.y }, 0.84);
}

function poseCard(node: HTMLElement, pose: Pose): void {
    tweens.get(node)?.();
    place(node, pose.x, pose.y, pose.angle);
}

const turnBetween = (from: number, to: number): number => ((to - from) % 360 + 540) % 360 - 180;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Eases a card from one pose to another. */
function glide(node: HTMLElement, from: Pose, to: Pose, done: () => void, ms = 300): void {
    tweens.get(node)?.();
    if (reducedMotion()) {
        place(node, to.x, to.y, to.angle);
        done();
        return;
    }
    const start = performance.now();
    let raf = 0;
    const stop = () => {
        cancelAnimationFrame(raf);
        tweens.delete(node);
        done();
    };
    const step = (now: number) => {
        const t = Math.min(1, (now - start) / ms);
        const eased = 1 - (1 - t) ** 3;
        place(node, from.x + (to.x - from.x) * eased, from.y + (to.y - from.y) * eased,
            from.angle + turnBetween(from.angle, to.angle) * eased);
        if (t < 1) raf = requestAnimationFrame(step);
        else stop();
    };
    tweens.set(node, stop);
    raf = requestAnimationFrame(step);
}

/** Turns the grabbed card toward its target angle. */
function spin(grab: Grab): void {
    cancelAnimationFrame(grab.raf);
    const from = grab.shown;
    const delta = turnBetween(from, grab.pose.angle);
    const start = performance.now();
    const step = (now: number) => {
        const t = reducedMotion() ? 1 : Math.min(1, (now - start) / 220);
        grab.shown = from + delta * (1 - (1 - t) ** 3);
        place(grab.node, grab.pose.x, grab.pose.y, grab.shown);
        if (t < 1) grab.raf = requestAnimationFrame(step);
    };
    grab.raf = requestAnimationFrame(step);
}

function raise(node: HTMLElement, lifted: boolean): void {
    node.classList.toggle('grabbed', lifted);
    const parent = node.parentElement;
    if (parent?.classList.contains('deed-fan')) parent.style.zIndex = lifted ? '5' : '';
}

/** Picks the card up and turns it to face the viewer. */
function lift(grab: Grab): void {
    grab.moved = true;
    grab.pose = { ...grab.pose, angle: ((-grab.turn % 360) + 360) % 360 };
    raise(grab.node, true);
    spin(grab);
}

/**
 * Lets a card be picked up and moved locally. On release it either stays where the drop handler put it
 * or eases back to its home pose.
 */
function attachGrab(node: HTMLButtonElement, home: () => Pose | null, own: () => boolean,
    drop: (grab: Grab) => boolean): void {
    node.addEventListener('pointerdown', event => {
        const from = home();
        if (event.button !== 0 || drag || !from) return;
        event.stopPropagation();
        ignoreClick = false;
        tweens.get(node)?.();
        const { x, y } = camera.point(event);
        drag = { id: event.pointerId, node, from, pose: { ...from }, shown: from.angle, x, y, moved: false,
            turn: angleOf(node.parentElement), raf: 0, own: own() };
        node.setPointerCapture(event.pointerId);
    });
    node.addEventListener('pointermove', event => {
        if (drag?.node !== node || drag.id !== event.pointerId) return;
        const point = camera.point(event);
        const dx = point.x - drag.x, dy = point.y - drag.y;
        if (!drag.moved) {
            if (Math.hypot(dx, dy) * camera.current.scale < 5) return;
            lift(drag);
        }
        const radians = drag.turn * Math.PI / 180;
        const cos = Math.cos(radians), sin = Math.sin(radians);
        drag.pose = { x: drag.from.x + dx * cos + dy * sin, y: drag.from.y - dx * sin + dy * cos,
            angle: drag.pose.angle };
        place(node, drag.pose.x, drag.pose.y, drag.shown);
        if (drag.own && performance.now() - previewTime >= 70) {
            previewTime = performance.now();
            send('PREVIEW', { pose: drag.pose });
        }
    });
    const finish = (event: PointerEvent, canceled: boolean) => {
        if (drag?.node !== node || drag.id !== event.pointerId) return;
        const grab = drag;
        drag = null;
        cancelAnimationFrame(grab.raf);
        ignoreClick = grab.moved;
        if (!grab.moved) return;
        if (grab.own) send('PREVIEW_END');
        if (!canceled && drop(grab)) {
            raise(node, false);
            return;
        }
        glide(node, { x: grab.pose.x, y: grab.pose.y, angle: grab.shown }, grab.from, () => raise(node, false));
    };
    node.addEventListener('pointerup', event => finish(event, false));
    node.addEventListener('pointercancel', event => finish(event, true));
    node.addEventListener('lostpointercapture', event => finish(event, true));
}

function addCreditCard(seat: number): HTMLButtonElement {
    const node = button('', () => {
        if (!ignoreClick && state?.youAre === seat) selectScan('card');
        ignoreClick = false;
    });
    node.className = 'credit-card';
    const mine = () => {
        const player = state?.view?.players[seat];
        return seat === state?.youAre && !!player && !player.eliminated && state.view?.phase.kind !== 'over';
    };
    attachGrab(node, () => state?.view?.players[seat]?.pose ?? null, mine, ({ from, pose, own }) => {
        if (Math.hypot(pose.x - readerPoint.x, pose.y - readerPoint.y) < readerRadius) {
            const home = node.getBoundingClientRect();
            poseCard(node, { ...readerPoint, angle: pose.angle });
            const start = node.getBoundingClientRect();
            poseCard(node, from);
            localScanUntil = performance.now() + 2000;
            scanFlight(node, start, home, eventDuration({ kind: 'scan', seq: 0, timestamp: 0, text: '' }), pose.angle);
            send('SCAN', own ? {} : { target: seat });
            return true;
        }
        if (own && validPose(pose, board.dimensions.width, board.dimensions.height)) {
            send('POSE', { pose });
            poseCard(node, pose);
            return true;
        }
        return false;
    });
    stationHost.append(node);
    return node;
}

function propertyClick(id: string, back?: () => void): void {
    const view = state?.view;
    if (!state || !view) return;
    if (view.phase.kind === 'arson' && view.turn === state.youAre && view.phase.property === id)
        return confirmArson();
    if (view.phase.kind === 'select' && view.turn === state.youAre && view.phase.properties.includes(id))
        return send('SELECT', { property: id });
    const property = properties.find(item => item.id === id);
    const deed = view.deeds[id];
    if (!property || !deed) return;
    const blocked = view.phase.kind === 'select' && view.turn === state.youAre;
    const group = properties.filter(item => view.deeds[item.id] && item.deed.groupId === property.deed.groupId);
    const face = deedFace(property, deed.lifetimeRent);
    const actionBar = el('div', '', 'property-actions');
    if (blocked) actionBar.append(el('p', deed.destroyed ? 'Deed destroyed'
        : deed.owner !== null ? 'Already owned' : 'Protected set', 'property-actions__note'));
    const phase = view.phase;
    const actor = phase.kind === 'debt' ? phase.debt.payer : view.turn;
    const classic = !state.settings.hell && !state.settings.market && !state.settings.specialAuctions;
    const allowed = (actor === state.youAre || (classic && phase.kind !== 'debt')) &&
        ['roll', 'extra', 'end', 'purchase', 'debt'].includes(phase.kind);
    const choices = allowed ? management(property, group, view.deeds, state.youAre, cash(),
        view.houses, view.hotels, phase.kind === 'debt') : [];
    const owned = deed.owner === state.youAre;
    const waiting = 'Wait for a management window';
    const addAction = (label: string, action: string, reason: string) => {
        const enabled = choices.includes(action);
        const item = el('div', '', 'property-actions__item');
        item.append(button(label, () => {
            send(action, { property: id });
            panelBack();
            byId<GameDialog>('panel').close();
        }, !enabled));
        if (!enabled && reason) tooltip(item, reason);
        actionBar.append(item);
    };
    if (owned && !deed.destroyed) {
        const terms = property.deed;
        const built = group.some(item => view.deeds[item.id].level > 0);
        if (terms.buildingCost) {
            const half = money(terms.buildingCost / 2);
            addAction(`Build ${deed.level < 4 ? 'house' : 'hotel'} · ${money(terms.buildingCost)}`, 'BUILD',
                !allowed ? waiting : phase.kind === 'debt' ? 'Settle debt first'
                    : cash() < terms.buildingCost ? 'Not enough cash'
                        : !(deed.level < 4 ? view.houses : view.hotels) ? 'Bank stock exhausted'
                            : 'Needs a full unmortgaged set and even building');
            if (choices.includes('LIQUIDATE')) {
                const levels = group.reduce((total, item) => total + view.deeds[item.id].level, 0);
                addAction(`Sell all buildings in set · +${money(terms.buildingCost * levels / 2)}`, 'LIQUIDATE', '');
            } else if (built)
                addAction(`Sell ${deed.level === 5 ? 'hotel' : 'house'} · +${half}`, 'SELL',
                    allowed ? 'Sell from the most developed deed first' : waiting);
        }
        if (deed.mortgaged) addAction(`Unmortgage · ${money(terms.mortgageValue + interest(terms.mortgageValue))}`,
            'UNMORTGAGE', !allowed ? waiting : phase.kind === 'debt' ? 'Settle debt first' : 'Not enough cash');
        else addAction(`Mortgage · +${money(terms.mortgageValue)}`, 'MORTGAGE',
            !allowed ? waiting : 'Sell set buildings first');
        const trade = el('div', '', 'property-actions__item');
        trade.append(button('Trade property', () => offerTrade(id), !allowed || built));
        if (built) tooltip(trade, 'Sell all buildings before trading');
        actionBar.append(trade);
    } else actionBar.append(el('p', deed.destroyed ? 'Deed destroyed' : 'Only the owner can manage this deed',
        'property-actions__note'));
    const content = el('div', '', 'property-view');
    content.append(face, actionBar);
    panel('', content);
    if (back) {
        panelBack(back);
        byId('panel-close').textContent = 'Back';
    }
}

function openDeeds(seat: number): void {
    const view = state?.view;
    const player = view?.players[seat];
    if (!view || !player) return;
    const owned = properties.filter(property => view.deeds[property.id]?.owner === seat);
    const sets = new Set(owned.filter(property => property.type === 'street' &&
        properties.filter(item => item.deed.groupId === property.deed.groupId)
            .every(item => view.deeds[item.id]?.owner === seat)).map(property => property.deed.groupId));
    const stats = el('div', '', 'deeds-stats');
    const section = (title: string, rows: Array<[string, string]>) => {
        const node = el('section', '', 'deeds-stats__group');
        node.append(el('h3', title));
        for (const [label, value] of rows) {
            const row = el('div', '', 'deeds-stats__row');
            row.append(el('span', label), el('strong', value));
            node.append(row);
        }
        stats.append(node);
    };
    section('Wealth', [['Net worth', money(player.netWorth)], ['Color sets', String(sets.size)],
        ['Stock profit', money(player.stockNet)]]);
    section('Rent', [['Collected', money(player.rentEarned)], ['Paid', money(player.rentPaid)]]);
    section('Activity', [['Laps', String(player.laps)], ['Auctions won', String(player.auctionsWon)],
        ['Turns in Hell', String(player.hellTurns)]]);

    const search = el('input');
    search.type = 'search';
    search.setAttribute('aria-label', 'Search deeds');
    search.placeholder = 'Search deeds';
    const sort = el('select');
    sort.setAttribute('aria-label', 'Sort deeds');
    ['Group', 'Name', 'Price', 'Lifetime rent'].forEach((label, index) => sort.add(new Option(label, String(index))));
    const toolbar = el('div', '', 'deeds-toolbar');
    toolbar.append(search, sort);

    const list = el('div', '', 'deeds-list');
    const render = () => {
        const query = search.value.toLowerCase().trim();
        const choices = owned.filter(item => item.name.toLowerCase().includes(query));
        choices.sort((x, y) => {
            if (sort.value === '1') return x.name.localeCompare(y.name);
            if (sort.value === '2') return x.deed.price - y.deed.price;
            if (sort.value === '3') return view.deeds[y.id].lifetimeRent - view.deeds[x.id].lifetimeRent;
            return x.deed.groupId.localeCompare(y.deed.groupId) || x.name.localeCompare(y.name);
        });
        const rows = choices.map(property => {
            const deed = view.deeds[property.id];
            const group = properties.filter(item => view.deeds[item.id] && item.deed.groupId === property.deed.groupId);
            const rent = calculateRent(property, group, view.deeds, -1, 1);
            const details = [deed.destroyed ? 'Destroyed' : deed.mortgaged ? 'Mortgaged' : '',
                `Price ${money(property.deed.price)}`,
                `Rent ${property.type === 'utility' && rent > 0 ? `${rent}× dice` : money(rent)}`].filter(Boolean);
            const row = button('', () => propertyClick(property.id, () => openDeeds(seat)));
            row.className = 'deeds-list__row';
            row.style.setProperty('--group', board.colors[property.deed.groupId] ?? '#c6c5b5');
            row.append(el('span', property.name, 'deeds-list__name'), el('small', details.join(' · ')));
            return row;
        });
        list.replaceChildren(...rows);
        if (!rows.length) list.append(el('p', owned.length ? 'No matching deeds' : 'No deeds', 'deeds-list__empty'));
    };
    search.oninput = sort.onchange = render;
    render();
    const root = el('div', '', 'deeds-view');
    root.append(stats, el('small', 'Net worth includes cash, deed prices less mortgages, and building costs.',
        'deeds-view__note'), toolbar, list);
    panel(player.name, root);
}

function deedFace(property: typeof properties[number], lifetimeRent?: number): HTMLElement {
    const terms = property.deed;
    const title = el('strong', property.name);
    title.style.backgroundColor = board.colors[terms.groupId] ?? '#ccc';
    const face = el('section', '', 'deed');
    const appendRentRow = (label: string, value: string) => {
        const row = el('div', '', 'deed__rent-row');
        row.append(el('span', label), el('span', value));
        face.append(row);
    };
    face.append(title);
    if (property.type === 'street') {
        const [base, ...improved] = terms.rent;
        face.append(el('p', `RENT ${money(base)}`));
        improved.slice(0, 4).forEach((rent, i) =>
            appendRentRow(`With ${i + 1} ${i === 0 ? 'House' : 'Houses'}`, money(rent)));
        face.append(el('p', `With HOTEL ${money(improved[4])}`));
    } else {
        face.append(el('p', `Price ${money(terms.price)}`));
        terms.rent.forEach((rent, i) => appendRentRow(`${i + 1} owned`,
            property.type === 'utility' ? `${rent}× dice` : money(rent)));
    }
    face.append(el('p', `Mortgage Value ${money(terms.mortgageValue)}`));
    const footer = el('div', '', 'deed__footer');
    if (lifetimeRent !== undefined) footer.append(el('p', `Lifetime rent ${money(lifetimeRent)}`));
    if (property.type === 'street') {
        const cost = money(terms.buildingCost);
        face.append(el('div', `Houses cost ${cost} each`), el('div', `Hotels, ${cost} plus 4 houses`));
        footer.append(el('small',
            'If a player owns all the lots in a color group, rent doubles on unimproved lots in that group.'));
    }
    if (footer.hasChildNodes()) face.append(footer);
    return face;
}

function deedButton(property: typeof properties[number], click: () => void): HTMLButtonElement {
    const node = button('', click);
    node.className = 'deed-pick';
    node.append(deedFace(property));
    return node;
}

function angleOf(node: Element | null): number {
    let total = 0;
    for (let item = node; item && item !== world; item = item.parentElement)
        total += Number.parseFloat((item as HTMLElement).style.getPropertyValue('--angle')) || 0;
    return total;
}

function numberInput(label: string, min: number, max: number, value = min): [HTMLLabelElement, HTMLInputElement] {
    const wrapper = el('label', label);
    const input = el('input');
    Object.assign(input, { type: 'number', min: String(min), max: String(max), step: '1', value: String(value) });
    input.required = true;
    wrapper.append(input);
    return [wrapper, input];
}

const wheel = el('div', '', 'wheel');
const wedges = 360 / sectors.length;
wheel.style.background = `conic-gradient(${sectors.map((value, i) => {
    const strong = Math.abs(value) >= 30;
    const color = value < 0 ? (strong ? '#e53935' : '#ef5350') : value > 0 ? (strong ? '#43a047' : '#66bb6a') : '#bdbdbd';
    return `${color} ${i * wedges}deg ${(i + 1) * wedges}deg`;
}).join(',')})`;
sectors.forEach((sector, i) => {
    const text = el('span', `${sector > 0 ? '+' : ''}${sector}%`);
    text.style.transform = `translate(-50%, -50%) rotate(${(i + 0.5) * wedges}deg) translateY(-113px)`;
    wheel.append(text);
});
const ring = el('div', '', 'wheel-ring');
ring.append(wheel);
const chartIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
const chartPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
chartIcon.setAttribute('viewBox', '0 0 24 24');
chartPath.setAttribute('d', 'M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z');
chartIcon.append(chartPath);
const wheelLabel = el('strong', '', 'wheel-label');
wheelLabel.append(chartIcon, document.createTextNode('STOCK MARKET'));
table.wheel.replaceChildren(ring, wheelLabel);

function focusWheel(): void {
    camera.follow(() => ({ x: wheelPoint.x + origin.x, y: wheelPoint.y + origin.y }), 0.78, 3000, 600);
}

let spinning = -1;
let spinAnimation: Animation | undefined;
function animateWheel(): void {
    const phase = state?.view?.phase;
    if (phase?.kind !== 'spin' || spinning === phase.started) return;
    spinning = phase.started;
    const end = 1800 - (phase.sector + 0.5) * wedges;
    wheel.style.transform = `rotate(${end}deg)`;
    if (Date.now() + clock - phase.started < SPIN_MS) focusWheel();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const elapsed = Date.now() + clock - phase.started;
    if (elapsed >= SPIN_MS) return;
    spinAnimation?.cancel();
    spinAnimation = wheel.animate([{ transform: 'rotate(0)' }, { transform: `rotate(${end}deg)` }],
        { duration: SPIN_MS, easing: 'cubic-bezier(.14,.66,.24,1)' });
    spinAnimation.currentTime = Math.max(0, elapsed);
    void new Audio('audio/spinner.mp3').play().catch(() => undefined);
}

function confirmGamble(): void {
    confirmPanel('Gamble', 'You are about to bet all your money on the stock market spinner. Are you sure?', () => {
        byId<GameDialog>('panel').close();
        send('SPIN');
    });
}

function openWheel(): void {
    if (!state?.view || !state.settings.stock) return;
    const { view } = state;
    if (view.spins && view.turn === state.youAre && ['end', 'extra'].includes(view.phase.kind) && cash() > 0)
        confirmGamble();
    else focusWheel();
}

let marketList: HTMLElement | undefined;

function shop(): void {
    if (!state?.view) return;
    const player = state.view.players[state.youAre];
    const list = el('div', '', 'market');
    for (const [id, item] of Object.entries(upgrades)) {
        const card = button('', () => send('SHOP', { upgrade: id }),
            !player || player.upgrades.some(upgrade => upgrade === id) || cash() < item.price ||
            player.upgrades.length >= state.settings.upgradeLimit);
        card.className = 'market__card';
        card.append(el('strong', item.name), el('span', money(item.price), 'market__price'),
            el('small', item.description));
        list.append(card);
    }
    marketList = list;
    panel('Black Market', list);
    byId('panel-title').append(el('strong', `Bal: ${money(cash())}`, 'balance'));
}

const settingGroups: Array<{ title: string; items: Array<[keyof Settings, string, string]> }> = [
    { title: 'Game', items: [
        ['playerLimit', 'Max players', 'Seats available in the lobby'],
        ['startingBalance', 'Starting cash', 'Money each player begins with'],
        ['goSalary', 'GO salary', 'Collected when passing GO'],
        ['roundCap', 'Round limit', 'The richest player wins after this many rounds. 0 for no limit'],
        ['minuteCap', 'Time limit (minutes)', 'The richest player wins when time runs out. 0 for no limit']
    ] },
    { title: 'Timers', items: [
        ['turnSeconds', 'Turn timer (seconds)', 'Time to act before a turn times out'],
        ['afkForfeit', 'Forfeit on timeout', 'A player who runs out of time goes bankrupt'],
        ['auctionSeconds', 'Auction timer (seconds)', 'Time for bidding on an auction'],
        ['rescueSeconds', 'GoFundMe timer (seconds)', 'Time for others to donate to a player in debt']
    ] },
    { title: 'Bank', items: [
        ['houses', 'Houses', 'Houses available to build'],
        ['hotels', 'Hotels', 'Hotels available to build']
    ] },
    { title: 'Features', items: [
        ['stock', 'Stock market', 'Spin the wheel to gamble on the market'],
        ['market', 'Black market', 'Buy upgrades with cash'],
        ['upgradeLimit', 'Upgrades per player', 'How many black market upgrades a player can hold'],
        ['hell', 'Hell board', 'Detention sends players to a second board'],
        ['specialAuctions', 'Special auctions', 'Landing on GO, Chance, Chest or Free Parking triggers an auction'],
        ['hiddenBalances', 'Hidden balances', 'Players cannot see each other\'s cash']
    ] },
    { title: 'Bankruptcy', items: [
        ['rescue', 'GoFundMe rescue', 'Other players can donate to save a player in debt'],
        ['rescueLimit', 'Rescues per player', 'How many times a player can be rescued'],
        ['literalDeadHand', 'Literal Dead Hand', 'Dead Hand destroys the deed and eliminates players on the same space. ' +
            'Otherwise they pay $500']
    ] }
];

function renderLobby(sync: Sync): void {
    const { seats, youAre, isHost, settings } = sync;
    const rows = seats.map((seat, i) => {
        const row = el('div', '', 'seat-row');
        row.style.setProperty('--seat', seatColors[i]);
        const label = el('span', '', 'seat-row__name');
        const name = el('strong', i === youAre ? `${seat.username} (you)` : seat.username);
        name.style.color = seatColors[i];
        label.append(tokenIcon(seat.token, 'seat-row__icon'), name);
        const status = el('small', seat.bot ? 'CPU' : seat.ready ? 'Ready' : 'Not ready', 'seat-row__status');
        status.classList.toggle('seat-row__status--ready', seat.ready);
        row.append(label, status);
        if (isHost && seat.bot) row.append(button('Remove', () => send('REMOVE_BOT', { target: i })));
        else if (isHost && i !== youAre) row.append(button('Kick', () => send('KICK', { target: i })));
        return row;
    });
    byId('lobby-players').replaceChildren(...rows);
    const ready = byId<HTMLButtonElement>('ready'), start = byId<HTMLButtonElement>('start-game');
    ready.disabled = !seats[youAre];
    ready.textContent = seats[youAre]?.ready ? 'Not ready' : 'Ready';
    start.hidden = !isHost;
    const addCpu = byId<HTMLButtonElement>('add-cpu');
    addCpu.hidden = !isHost;
    addCpu.disabled = seats.length >= settings.playerLimit;
    start.disabled = seats.length < 2 || seats.some(seat => !seat.ready);
    byId('settings').hidden = false;
    for (const id of ['token', 'skin'] as const) {
        for (const choice of byId(id).querySelectorAll<HTMLButtonElement>('button')) {
            const value = Number(choice.dataset.value);
            const selected = seats[youAre]?.[id] === value;
            choice.classList.toggle('selected', selected);
            choice.setAttribute('aria-checked', String(selected));
            choice.disabled = id === 'token' && seats.some((seat, i) => i !== youAre && seat.token === value);
        }
    }
    const form = byId<HTMLFormElement>('options');
    if (form.contains(document.activeElement)) return;
    const groups = settingGroups.map(group => {
        const section = el('section', '', 'settings-group');
        section.append(el('h4', group.title));
        for (const [key, title, help] of group.items) {
            const input = el('input');
            input.name = key;
            input.disabled = !isHost;
            if (typeof settings[key] === 'boolean') {
                input.type = 'checkbox';
                input.checked = Boolean(settings[key]);
            } else {
                const [min, max] = settingBounds[key as keyof typeof settingBounds];
                Object.assign(input, { type: 'number', min: String(min), max: String(max), value: String(settings[key]) });
            }
            const row = el('label', '', 'setting');
            const text = el('span', '', 'setting__text');
            text.append(el('strong', title), el('small', help));
            row.append(text, input);
            section.append(row);
        }
        return section;
    });
    form.replaceChildren(...groups, ...isHost ? [el('button', 'Apply settings', 'primary')] : []);
}

let auctionPicker: { key: string; root: HTMLElement } | null = null;
let auctionPickerDismissed = '';
byId<GameDialog>('panel').addEventListener('close', () => {
    if (auctionPicker) auctionPickerDismissed = auctionPicker.key;
    auctionPicker = null;
});

function closeAuctionPicker(): void {
    if (!auctionPicker) return;
    const showing = byId('panel-content').contains(auctionPicker.root);
    auctionPicker = null;
    if (showing) byId<GameDialog>('panel').close();
}

function openAuctionPicker(ids: ReadonlyArray<string>, key: string, force = false): void {
    if (!force && (auctionPickerDismissed === key ||
        (auctionPicker?.key === key && byId('panel-content').contains(auctionPicker.root)))) return;
    const root = el('div', '', 'deed-picker');
    for (const property of properties.filter(item => ids.includes(item.id)))
        root.append(deedButton(property, () => {
            byId<GameDialog>('panel').close();
            send('SELECT', { property: property.id });
        }));

    panel('Select a property to auction', root);
    auctionPicker = { key, root };
}

const deckName = (deck: string): string => deck === 'chance' ? 'Chance' : 'Community Chest';

const phaseTitles: Record<string, string> = {
    roll: 'Roll', extra: 'Bonus roll', end: 'End turn', draw: 'Draw card', purchase: 'Buy property',
    arson: 'Arson', select: 'Select property', auction: 'Auction', mortgageTransfer: 'Mortgage transfer',
    debt: 'In debt', rescue: 'GoFundMe', spin: 'Stock wheel', over: 'Game over'
};

let hudPhase = '';

/** The HUD stays hidden during auctions and while the rescue modal is open. */
function updateHud(): void {
    byId('hud').hidden = hudPhase === 'auction' || (hudPhase === 'rescue' && fundraiserOpen());
}
byId<GameDialog>('panel').addEventListener('close', updateHud);

function renderControls(sync: Sync): void {
    clearTimeout(controlsTimer);
    updateHudAway();
    const wait = isAnimating() ? 120 : hudHiddenAt + 400 - performance.now();
    if (wait > 0) {
        controlsTimer = window.setTimeout(() => {
            if (state) renderControls(state);
        }, wait);
        return;
    }
    drawControls(sync);
}

function drawControls(sync: Sync): void {
    const view = sync.view;
    if (!view) return;
    if (deadline !== view.deadline) {
        deadline = view.deadline;
        deadlineSpan = Math.max(1, (deadline ?? Date.now()) - Date.now() - clock);
    }
    const { phase, turn, players } = view;
    const me = sync.youAre;
    const player = players[me];
    let actor = turn;
    if (phase.kind === 'mortgageTransfer') actor = phase.seat;
    if (phase.kind === 'debt' || phase.kind === 'rescue') actor = phase.debt.payer;
    const own = actor === me && !player?.eliminated;
    const main: Array<HTMLElement> = [], optional: Array<HTMLElement> = [];
    const act = (label: string, action: string, fields = {}, disabled = false) =>
        main.push(button(label, () => send(action, fields), disabled));
    const title = phase.kind === 'draw' ? `Draw ${deckName(phase.deck)}` : phaseTitles[phase.kind] ?? phase.kind;
    let status = `${players[actor].name} · ${title}`;
    if (own && ['roll', 'extra'].includes(phase.kind)) {
        const roll = button('Roll dice', () => send('ROLL'));
        roll.className = 'end-turn';
        main.push(roll);
        if (phase.kind === 'roll' && player.bail !== null)
            act(`Pay bail ${money(player.bail)}`, 'BAIL', {}, cash() < player.bail);
        if (view.swapTargets.length) main.push(button('Identity Theft', swapPicker));
    }
    if (own && phase.kind === 'draw') act(`Draw ${deckName(phase.deck)}`, 'DRAW');
    if (own && phase.kind === 'purchase') {
        const property = properties.find(item => item.id === phase.property);
        if (property) act(`Buy ${property.name} · ${money(property.deed.price)}`, 'BUY', {}, cash() < property.deed.price);
        act('Pass to auction', 'DECLINE');
    }
    if (own && phase.kind === 'arson') {
        main.push(button('Use Arson', confirmArson));
        const landed = properties.find(item => item.id === phase.property);
        const group = properties.filter(item => item.deed.groupId === landed?.deed.groupId);
        act(`Pay rent (${money(landed ? calculateRent(landed, group, view.deeds, me, phase.dice) : null)})`, 'DECLINE');
    }
    if (!(own && phase.kind === 'select')) closeAuctionPicker();
    if (own && phase.kind === 'select') {
        status = 'Select a property to auction';
        const key = `${view.round}:${view.turn}:${phase.properties.join()}`;
        main.push(button('Choose property', () => openAuctionPicker(phase.properties, key, true)));
        openAuctionPicker(phase.properties, key);
    }
    if (phase.kind !== 'auction') closeAuction();
    if (phase.kind === 'auction') {
        const property = properties.find(item => item.id === phase.property);
        status = `${property?.name} · List ${money(property?.deed.price ?? null)} · Bid ${money(phase.bid)}` +
            (phase.leader === null ? '' : ` · ${players[phase.leader].name}`);
        if (player && !player.eliminated) status += ` · Available ${money(cash())}`;
        if (property) {
            const options = {
                key: `${phase.property}:${view.round}:${view.turn}`,
                title: `Auction for ${property.name}`,
                deed: deedFace(property),
                remaining: () => (deadline ?? Date.now()) - Date.now() - clock,
                total: () => sync.settings.auctionSeconds * 1000,
                bid: (amount: number) => send('BID', { amount }),
                abstain: () => send('ABSTAIN')
            };
            const auction = {
                bid: phase.bid,
                leader: phase.leader === null ? null : players[phase.leader].name,
                history: phase.history.map(bid => ({ name: players[bid.seat].name, amount: bid.amount })),
                limit: player && !player.eliminated ? cash() + (phase.leader === me ? phase.bid : 0) : 0,
                balance: player && !player.eliminated ? cash() : null,
                abstained: phase.abstained.includes(me)
            };
            showAuction(options, auction);
        }
    }
    if (phase.kind === 'mortgageTransfer') {
        const property = properties.find(item => item.id === phase.property);
        if (property) {
            status = `${players[actor].name} inherited ${property.name} with a mortgage`;
            if (own) {
                act(`Keep mortgage · ${money(mortgageFee(property, false))}`, 'KEEP_MORTGAGE');
                act(`Unmortgage · ${money(mortgageFee(property, true))}`, 'RELEASE_MORTGAGE');
            }
        }
    }
    if (phase.kind === 'debt') {
        status = phase.debt.amount === null ? `${players[actor].name} · In debt`
            : `${players[actor].name} owes ${money(phase.debt.amount)} · ${phase.debt.reason}`;
        if (own && phase.debt.amount !== null)
            status += ` · Available ${money(cash())} · Shortfall ${money(Math.max(0, phase.debt.amount - cash()))}`;
        if (own) act('Unable to pay', 'UNABLE');
    }
    const donating = phase.kind === 'rescue' && !!player && !player.eliminated && !own &&
        !phase.declined.includes(me);
    if (!donating) closeFundraiser();
    if (phase.kind === 'rescue') {
        const pledged = Object.values(phase.pledges).reduce((sum, amount) => sum + amount, 0);
        status = donating ? '' : `GoFundMe · ${players[actor].name}`;
        if (!donating && phase.target !== null) status += ` · ${money(pledged)} / ${money(phase.target)}`;
        if (donating) showFundraiser(phase, players[actor].name, `${phase.debt.payer}:${view.deadline}`,
            players[actor].upgrades.includes('deadHand'), cash,
            amount => send('DONATE', { amount }),
            { remaining: () => (deadline ?? Date.now()) - Date.now() - clock,
                total: () => sync.settings.rescueSeconds * 1000 },
            () => send('OPT_OUT'));
    }
    hudPhase = phase.kind;
    updateHud();
    if (own && phase.kind === 'end') {
        const end = button('End turn', () => send('END'));
        end.className = 'end-turn';
        main.push(end);
    }
    if (own && ['end', 'extra'].includes(phase.kind)) {
        if (view.spins && cash() > 0) optional.push(button('Gamble', openWheel));
        if (view.shops) optional.push(button('Black Market', shop));
        for (const target of view.robber)
            optional.push(button(`Rob ${players[target].name}`, () => send('ROB', { target })));
    }
    const classicTrades = !sync.settings.hell && !sync.settings.market && !sync.settings.specialAuctions;
    if ((own && phase.kind === 'debt') || (player && !player.eliminated &&
        (own || classicTrades) && phase.kind === 'end'))
        optional.push(button('Trade', offerTrade));
    if (player && !player.eliminated && escapeTargets().length)
        for (const card of player.cards) optional.push(escapeCard(card));
    if (view.trade) optional.push(button('Trade offer', showTrade));
    if (phase.kind === 'over') {
        status = phase.winners.length ? `Winner: ${phase.winners.map(i => players[i].name).join(', ')}` : 'No winner';
        main.push(button('Results', results));
        if (sync.isHost) act('Return to lobby', 'RETURN_TO_LOBBY');
    }
    byId('hud-banner').textContent = status;
    const controls = byId('phase-controls');
    const before = controls.querySelector('input');
    const after = main.flatMap(node => [...node.querySelectorAll('input')])[0];
    const restoreFocus = before !== null && before === document.activeElement;
    if (restoreFocus && after && Number.isFinite(before.valueAsNumber))
        after.value = String(Math.max(Number(after.min), Math.min(Number(after.max), before.valueAsNumber)));
    controls.replaceChildren(...main);
    if (restoreFocus && after) after.focus({ preventScroll: true });
    byId('optional-controls').replaceChildren(...optional);
    updateHudAway();
}

function houseIcons(level: number): HTMLElement | null {
    if (!level) return null;
    const node = el('span', '', 'trade-check__houses');
    const hotel = level === 5;
    for (let i = 0; i < (hotel ? 1 : level); i++) {
        const image = el('img');
        image.src = `img/buildings/${hotel ? 'hotel' : 'house'}.png`;
        image.alt = '';
        image.draggable = false;
        node.append(image);
    }
    return node;
}

function offerTrade(preselected?: string): void {
    const sync = state;
    const view = sync?.view;
    if (!sync || !view) return;
    const me = sync.youAre;
    const form = el('form', '', 'trade-form');
    const classic = !sync.settings.hell && !sync.settings.market && !sync.settings.specialAuctions;
    const partners = view.players.flatMap((player, i) => i !== me && !player.eliminated &&
        (classic || [i, me].includes(view.turn) || view.phase.kind === 'debt') ? [i] : []);
    if (!partners.length) return;
    let partner = partners[0];
    const picker = el('div', '', 'trade-partners');
    const pickers = partners.map(seat => {
        const choice = el('button', '', 'trade-partner');
        choice.type = 'button';
        choice.append(tokenIcon(view.players[seat].token, 'trade-partner__icon'));
        const name = el('strong', view.players[seat].name);
        name.style.color = seatColors[seat];
        choice.append(name);
        choice.onclick = () => {
            partner = seat;
            rebuild();
        };
        return choice;
    });
    picker.append(...pickers);
    const sides = el('div', '', 'trade-sides');
    const sendButton = el('button', 'Send offer', 'primary');
    form.append(picker, sides, sendButton);
    function side(seat: number, name: string) {
        const field = el('section', '', 'trade-side');
        const cash = view?.players[seat].cash ?? null;
        const [amount, input] = numberInput('Cash ', 0, cash ?? 100000);
        if (seat !== me) input.removeAttribute('max');
        amount.className = 'trade-side__cash';
        const slider = el('input');
        Object.assign(slider, { type: 'range', min: '0', max: String(cash ?? board.startingBalance), step: '1',
            value: '0' });
        slider.setAttribute('aria-label', `${name} cash`);
        const fill = () => slider.style.setProperty('--fill', `${Number(slider.value) / Number(slider.max || 1) * 100}%`);
        slider.oninput = () => {
            input.value = slider.value;
            fill();
        };
        input.oninput = () => {
            if (input.valueAsNumber < 0) input.value = '0';
            slider.value = String(Math.min(Math.max(input.valueAsNumber || 0, 0), Number(slider.max)));
            fill();
        };
        fill();
        const list = el('div', '', 'trade-side__list');
        field.append(el('h3', name), amount, slider, list);
        const deeds = properties.filter(property => view?.deeds[property.id]?.owner === seat);
        const items = deeds.map(property => {
            const groupDeveloped = properties.some(item => item.deed.groupId === property.deed.groupId &&
                (view?.deeds[item.id]?.level ?? 0) > 0);
            const row = el('label', property.name, 'trade-check trade-check--deed');
            row.style.setProperty('--group', board.colors[property.deed.groupId] ?? '#c6c5b5');
            const include = el('input');
            include.type = 'checkbox';
            include.disabled = groupDeveloped;
            include.checked = !groupDeveloped && seat === me && property.id === preselected;
            row.prepend(include);
            const houses = houseIcons(view?.deeds[property.id]?.level ?? 0);
            if (houses) row.append(houses);
            list.append(row);
            const release = el('input');
            release.type = 'checkbox';
            if (seat !== me && view?.deeds[property.id].mortgaged) {
                const option = el('label', `Unmortgage ${property.name} · ${money(mortgageFee(property, true))}`,
                    'trade-check trade-check--sub');
                option.prepend(release);
                list.append(option);
            }
            return { id: property.id, include, release };
        });
        const escape = (view?.players[seat].cards ?? []).map(card => {
            const check = el('input');
            check.type = 'checkbox';
            const entry = el('label', `Get out of hell (${card})`, 'trade-check');
            entry.prepend(check);
            list.append(entry);
            return { card, check };
        });
        if (!list.hasChildNodes()) list.append(el('small', 'No deeds or cards', 'trade-side__empty'));
        sides.append(field);
        return () => ({ cash: input.valueAsNumber,
            deeds: items.filter(item => item.include.checked).map(item => item.id),
            release: items.filter(item => item.include.checked && item.release.checked).map(item => item.id),
            cards: escape.filter(item => item.check.checked).map(item => item.card) });
    }
    let give: ReturnType<typeof side>, take: ReturnType<typeof side>;
    const rebuild = () => {
        pickers.forEach((choice, i) => choice.classList.toggle('active', partners[i] === partner));
        sides.replaceChildren();
        give = side(me, 'You give');
        take = side(partner, 'You receive');
    };
    rebuild();
    form.onsubmit = event => {
        event.preventDefault();
        send('OFFER', { to: partner, give: give(), take: take() });
        byId<GameDialog>('panel').close();
    };
    panel('Trade', form);
}

function showTrade(): void {
    const view = state?.view, offer = view?.trade;
    if (!offer || !view) return;
    const me = state?.youAre;
    const column = (seat: number, side: typeof offer.give) => {
        const node = el('section', '', 'trade-side');
        node.append(el('h3', seat === me ? 'You give' : `${view.players[seat].name} gives`));
        const items = el('ul', '', 'trade-summary');
        if (side.cash) items.append(el('li', money(side.cash), 'trade-check'));
        for (const id of side.deeds) {
            const property = properties.find(item => item.id === id);
            const row = el('li', `${property?.name ?? id}${side.release.includes(id) ? ' (release mortgage)' : ''}`,
                'trade-check trade-check--deed');
            row.style.setProperty('--group', property ? board.colors[property.deed.groupId] ?? '#c6c5b5' : '#c6c5b5');
            const houses = houseIcons(view.deeds[id]?.level ?? 0);
            if (houses) row.append(houses);
            items.append(row);
        }
        for (const card of side.cards) items.append(el('li', card, 'trade-check'));
        if (!items.hasChildNodes()) items.append(el('li', 'Nothing', 'trade-check'));
        node.append(items);
        return node;
    };
    const sides = el('div', '', 'trade-sides');
    sides.append(column(offer.from, offer.give), column(offer.to, offer.take));
    const releaseList = el('div', '', 'trade-release');
    const release: Array<HTMLInputElement> = [];
    if (me === offer.to) for (const id of offer.give.deeds) {
        const property = properties.find(item => item.id === id);
        if (!property || !view.deeds[id].mortgaged) continue;
        const input = el('input');
        input.type = 'checkbox';
        input.value = id;
        const label = el('label', `Unmortgage ${property.name} · ${money(mortgageFee(property, true))}` +
            ` (otherwise ${money(mortgageFee(property, false))})`, 'trade-check');
        label.prepend(input);
        releaseList.append(label);
        release.push(input);
    }
    const act = (action: string) => {
        send(action, { id: offer.id, release: release.filter(input => input.checked).map(input => input.value) });
        byId<GameDialog>('panel').close();
    };
    const root = el('div', '', 'trade-form');
    root.append(sides, ...(release.length ? [releaseList] : []));
    panel(me === offer.to ? `Trade offer from ${view.players[offer.from].name}` : 'Trade offer', root);
    if (me === offer.to) {
        const accept = button('Accept', () => act('ACCEPT_TRADE'));
        accept.classList.add('primary');
        panelActions([button('Decline', () => act('CANCEL_TRADE')), accept]);
    } else panelActions([button('Cancel offer', () => act('CANCEL_TRADE'))], true);
}

function results(): void {
    const view = state?.view;
    if (view?.phase.kind !== 'over') return;
    const max = Math.max(1, ...view.players.map(player => player.netWorth ?? 0));
    const standings = el('div', '', 'results');
    view.phase.placements.forEach((seat, place) => {
        const player = view.players[seat];
        const deeds = Object.values(view.deeds).filter(deed => deed.owner === seat).length;
        const card = el('section', '', 'results__player');
        card.classList.toggle('results__player--winner', place === 0);
        card.classList.toggle('results__player--out', player.eliminated);
        const head = el('div', '', 'results__head');
        head.append(el('span', String(place + 1), 'results__rank'), el('strong', player.name),
            el('span', money(player.netWorth), 'results__worth'));
        card.append(head);
        if (player.netWorth !== null) {
            const bar = el('progress');
            bar.max = max;
            bar.value = Math.max(0, player.netWorth);
            card.append(bar);
        }
        const stats = el('div', '', 'results__stats');
        const rows: Array<[string, string]> = [['Deeds', String(deeds)], ['Rent collected', money(player.rentEarned)],
            ['Rent paid', money(player.rentPaid)], ['Stock profit', money(player.stockNet)],
            ['Auctions won', String(player.auctionsWon)], ['Turns in Hell', String(player.hellTurns)],
            ['Rescues', String(player.rescues)], ['Donations', money(player.donations)],
            ['Upgrades used', String(player.upgradesUsed)]];
        for (const [label, value] of rows) {
            const stat = el('div', '', 'results__stat');
            stat.append(el('span', label), el('strong', value));
            stats.append(stat);
        }
        card.append(stats);
        standings.append(card);
    });
    const mostRent = view.players.reduce((best, player) => player.rentEarned > best.rentEarned ? player : best);
    const minutes = Math.floor((view.phase.ended - view.started) / 60000);
    const root = el('div', '', 'results-view');
    root.append(el('small', `${view.round} rounds · ${minutes} min`, 'results-view__note'), standings,
        ...(mostRent.rentEarned ? [el('small', `Most rent collected: ${mostRent.name}`, 'results-view__note')] : []));
    panel('Results', root);
}

const silentKinds = new Set(['phase', 'scan', 'pose', 'action', 'stockResult']);

interface LogLine {
    seq: number;
    seat?: number;
    text: string;
}

function logLines(): Array<LogLine> {
    const charged = new Set(log.filter(event => event.kind === 'ledger')
        .map(event => `${event.seq}:${event.seat}:${event.property}`));
    return log.flatMap(event => {
        if (!event.text || silentKinds.has(event.kind) || pendingRolls.has(event.seq)) return [];
        if (event.kind === 'deed' && charged.has(`${event.seq}:${event.seat}:${event.property}`)) return [];
        const property = properties.find(item => item.id === event.property)?.name;
        const text = `${event.text}${property ? `: ${property}` : ''}` +
            `${event.amount === undefined ? '' : ` · ${money(event.amount)}`}`;
        return [{ seq: event.seq, seat: event.seat, text }];
    });
}

function nameCell(seat: number | null | undefined): HTMLElement {
    const view = state?.view;
    const known = seat !== null && seat !== undefined;
    const cell = el('span', known ? view?.players[seat]?.name ?? '' : '', 'log-content_name');
    if (known) cell.style.color = seatColors[seat];
    return cell;
}

function renderLog(forceScroll = false): void {
    const modal = byId<GameDialog>('log-modal');
    const query = byId<HTMLInputElement>('log-filter').value.trim().toLowerCase();
    const lines = logLines();
    if (modal.open) readSeq = log[log.length - 1]?.seq ?? readSeq;
    const columns = [byId('log-moves'), byId('log-ledger')];
    const atBottom = columns.map(node => forceScroll || node.scrollHeight - node.scrollTop - node.clientHeight < 40);

    byId('log').replaceChildren(...lines.filter(line => {
        const name = line.seat === undefined ? '' : state?.view?.players[line.seat]?.name ?? '';
        return `${name} ${line.text}`.toLowerCase().includes(query);
    }).map(line => {
        const row = el('li');
        row.append(nameCell(line.seat), el('span', line.text));
        return row;
    }));

    const view = state?.view;
    const entries = (view?.ledger ?? []).filter(entry => !pendingRolls.has(entry.seq));
    byId('ledger-list').replaceChildren(...entries.map(entry => {
        const property = properties.find(item => item.id === entry.property)?.name;
        const parties = el('span');
        const payer = nameCell(entry.payer);
        const creditor = nameCell(entry.creditor);
        payer.textContent ||= 'Bank';
        creditor.textContent ||= 'Bank';
        parties.append(payer, ' → ', creditor);
        const row = el('li');
        row.append(parties, el('span', money(entry.amount), 'log-content_amount'),
            el('span', property ? `${entry.reason}: ${property}` : entry.reason));
        return row;
    }));

    columns.forEach((node, i) => {
        if (atBottom[i]) node.scrollTop = node.scrollHeight;
    });
    const unread = lines.filter(line => line.seq > readSeq).length;
    byId('log-panel').textContent = unread ? `Log (${unread})` : 'Log';
}

const movingPieces = new Map<number, number>();
const pendingRolls = new Set<number>();

function showDice(dice: ReadonlyArray<number>): void {
    const values = dice.length ? dice : [5, 3];
    table.diceCubes.forEach((cube, i) => settleDie(cube, i, values[i] ?? 1));
}

function tumbleDice(dice: Array<number>, duration: number): void {
    const previous = table.diceCubes.map(cube => ({
        value: Number(cube.dataset.value) || 1, angle: Number(cube.dataset.angle) || 0
    }));
    scatterDice();
    showDice(dice);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const hops = [
        { x: 20, y: -22, z: 40, offset: 0.16 }, { x: 30, y: 12, z: 0, offset: 0.36 },
        { x: 8, y: 24, z: 26, offset: 0.54 }, { x: 24, y: -10, z: 0, offset: 0.72 },
        { x: 12, y: 6, z: 8, offset: 0.86 }, { x: 0, y: 0, z: 0, offset: 1 }
    ];
    const last = hops.length - 1;
    table.diceCubes.forEach((cube, i) => {
        const side = i ? -1 : 1;
        const turns = (step: number) => (last - step) * (0.35 + Math.random() * 0.45);
        const frames: Array<Keyframe> = [{
            transform: dieTransform(i, previous[i].value, undefined, previous[i].angle), offset: 0
        }];
        hops.forEach(({ x, y, z, offset }, step) => frames.push({
            transform: dieTransform(i, dice[i] ?? 1, step === last ? undefined
                : { x: x * side, y: y * side, z, turnsX: turns(step), turnsY: turns(step), turnsZ: turns(step) }),
            offset,
            easing: step % 2 ? 'ease-out' : 'ease-in'
        }));
        cube.classList.remove('flat');
        cube.style.transform = frames[frames.length - 1].transform as string;
        void cube.animate(frames, { duration }).finished.catch(() => undefined)
            .finally(() => settleDie(cube, i, dice[i] ?? 1));
    });
}

let animationUntil = 0;
let animationGeneration = 0;
function scanFlight(card: HTMLElement, start: DOMRect, home: DOMRect, duration: number,
    angle = Number.parseFloat(card.style.getPropertyValue('--angle')) || 0): void {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const { scale } = camera.current;
    const aligned = (rect: DOMRect) => new DOMRect(rect.x + (rect.width - card.offsetWidth * scale) / 2,
        rect.y + (rect.height - card.offsetHeight * scale) / 2, card.offsetWidth * scale, card.offsetHeight * scale);
    const face = el('div', '', 'scan-flight');
    face.append(el('span', card.textContent ?? '', 'credit-card__name'));
    face.style.backgroundImage = card.style.backgroundImage;
    face.style.setProperty('--zoom', String(scale));
    card.animate([{ opacity: 0 }, { opacity: 0 }], { duration });
    fly(flightLayer(duration), face, aligned(start), table.reader.getBoundingClientRect(), duration, 'scan',
        aligned(home), angle);
}

function upright(node: Element): DOMRect {
    const box = node.getBoundingClientRect();
    const { offsetWidth, offsetHeight } = node as HTMLElement;
    const { scale } = camera.current;
    return new DOMRect(box.x + (box.width - offsetWidth * scale) / 2, box.y + (box.height - offsetHeight * scale) / 2,
        offsetWidth * scale, offsetHeight * scale);
}

function flashWhite(node: HTMLElement | undefined, duration: number): void {
    if (!node) return;
    const overlay = el('span', '', 'build-flash');
    node.append(overlay);
    const remove = (): void => overlay.remove();
    overlay.animate([{ opacity: .9 }, { opacity: 0 }], { duration }).finished.then(remove, remove);
}

function explode(node: HTMLElement | undefined, duration: number): void {
    if (!node) return;
    const box = upright(node);
    const blast = el('div', '', 'explosion');
    blast.style.left = `${box.x + box.width / 2}px`;
    blast.style.top = `${box.y + box.height / 2}px`;
    blast.style.setProperty('--size', `${Math.max(box.width, box.height) * 4.4}px`);
    const parts = [el('span', '', 'explosion__fire'), el('span', '', 'explosion__ring')];
    const sparks = Array.from({ length: 14 }, () => el('span', '', 'explosion__spark'));
    blast.append(...parts, ...sparks);
    flightLayer(duration + 100, 'explosion-layer').append(blast);
    const [fire, ring] = parts;
    const grow = (from: number, to: number) => [{ scale: from, opacity: 1 }, { scale: to, opacity: 0 }];
    fire.animate([{ scale: .1, opacity: 1 }, { scale: 1, opacity: .9, offset: .35 }, { scale: 1.25, opacity: 0 }],
        { duration: duration * .8, easing: 'ease-out', fill: 'forwards' });
    ring.animate(grow(.1, 1.6), { duration, easing: 'ease-out', fill: 'forwards' });
    sparks.forEach((spark, index) => {
        const angle = index / sparks.length * Math.PI * 2 + Math.random() * .4;
        const reach = box.width * (.9 + Math.random() * 1.1);
        spark.animate([{ translate: '0 0', opacity: 1 },
            { translate: `${Math.cos(angle) * reach}px ${Math.sin(angle) * reach}px`, opacity: 0 }],
        { duration: duration * (.6 + Math.random() * .4), easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'forwards' });
    });
    window.setTimeout(() => blast.remove(), duration + 100);
}

function animateEvents(events: Array<GameEvent>): void {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        for (const event of events)
            if (event.kind === 'draw' || event.kind === 'upgrade') toast(event.text, eventToast(event));
        return;
    }
    const generation = animationGeneration;
    let cursor = Math.max(performance.now(), animationUntil);
    for (const event of events) {
        if (event.kind === 'upgrade') toast(event.text, event.kind);
        const duration = eventDuration(event);
        if (!duration || event.kind === 'spin') continue;
        const delay = cursor - performance.now();
        if (delay > 8000) break;
        cursor += duration;
        const deed = event.kind === 'deed' ? properties.find(property => property.id === event.property) : undefined;
        const deedOrigin = deed && (deedFans.querySelector(`[data-deed="${deed.id}"]`) ?? table.tiles.get(deed.id));
        const deedSource = deedOrigin && upright(deedOrigin);
        const deedFrom = deedOrigin && angleOf(deedOrigin);
        const seats = ['move', 'hell', 'release', 'swap'].includes(event.kind)
            ? [event.seat, event.kind === 'swap' ? event.target : undefined].filter((seat): seat is number =>
                seat !== undefined) : [];
        for (const seat of seats) movingPieces.set(seat, (movingPieces.get(seat) ?? 0) + 1);
        if (event.kind === 'roll' && event.dice) pendingRolls.add(event.seq);
        window.setTimeout(() => {
            if (generation !== animationGeneration) return;
            const card = event.seat === undefined ? undefined : creditCards[event.seat];
            const piece = event.seat === undefined ? undefined : table.pieces[event.seat];
            const layer = event.kind === 'draw' || event.kind === 'deed' ? flightLayer(duration) : byId('flight-layer');
            if (event.kind === 'roll' && event.dice) tumbleDice(event.dice, ROLL_MS);
            for (const seat of seats)
                table.pieces[seat].getAnimations().find(item => item.id === 'piece-reflow')?.cancel();
            if (event.kind === 'build' && event.property) flashWhite(table.tiles.get(event.property), duration);

            if (event.kind === 'ledger')
                for (const seat of [event.seat, event.target]) {
                    if (seat === undefined) continue;
                    const balance = byId('leaderboard').children.item(seat)?.querySelector('.balance');
                    const entry = state?.view?.ledger.find(item => item.seq === event.seq);
                    const start = event.seat === seat ? entry?.payerBefore : entry?.creditorBefore;
                    const end = event.seat === seat ? entry?.payerAfter : entry?.creditorAfter;
                    if (!balance || typeof start !== 'number' || typeof end !== 'number') continue;
                    const began = performance.now();
                    const tick = (time: number) => {
                        if (!balance.isConnected || generation !== animationGeneration) return;
                        const progress = Math.max(0, Math.min(1, (time - began) / duration));
                        balance.textContent = money(Math.round(start + (end - start) * progress));
                        if (progress < 1) requestAnimationFrame(tick);
                    };
                    requestAnimationFrame(tick);
                }

            if (event.kind === 'move' && piece && event.path?.length) {
                const points = event.path.map(location);
                const end = points[points.length - 1];
                place(piece, end.x, end.y);
                piece.animate(points.map(p => ({ left: `${p.x}px`, top: `${p.y}px` })), { duration });
                table.hop(piece, points.length - 1, duration);
                if (!drag) camera.follow(() => pieceCenter(piece), 0.84, duration + 800);
            }
            if (event.kind === 'draw' && event.card) {
                const key = deckOf(event.card);
                const stack = table.decks[key];
                const deck = upright(stack.lastElementChild ?? stack);
                const flip = el('div', '', 'draw-flight');
                const face = el('div', '', `draw-face reveal draw-face--${key}`);
                const art = el('img', '', 'draw-face__art');
                art.src = `img/card_faces/${key === 'chest' ? 'community_chest' : 'chance'}.png`;
                art.alt = '';
                art.draggable = false;
                face.append(el('span', event.text, 'draw-face__text'), art);
                flip.append(el('div', '', `draw-back deck--${key}`), face);
                const held = cards[key].find(item => item.id === event.card)?.effect.kind === 'escape';
                const hand = event.seat === undefined ? null : deedFans.children.item(event.seat);
                const destination = held ? hand?.querySelector(`[data-card="${event.card}"]`) ?? card : null;
                flip.style.setProperty('--zoom', String(deck.width / 190));
                const above = new DOMRect(deck.x, deck.y - deck.height * 1.1, deck.width, deck.height);
                fly(layer, flip, deck, above, duration, held ? 'hold' : 'draw',
                    destination?.getBoundingClientRect() ?? deck,
                    0, [-45, held ? 0 : -45]);
            }
            if (deed && event.seat !== undefined) {
                const hand = deedFans.children.item(event.seat);
                const target = hand?.querySelector(`[data-deed="${deed.id}"]`) ?? hand;
                if (deedSource && target) {
                    const face = deedFace(deed);
                    const width = FAN_DEED_WIDTH * camera.current.scale;
                    face.style.setProperty('--deed-width', `${width}px`);
                    byId('flight-layer').append(face);
                    const height = face.offsetHeight;
                    face.remove();
                    const fit = (rect: DOMRect) => new DOMRect(rect.x + (rect.width - width) / 2,
                        rect.y + (rect.height - height) / 2, width, height);
                    fly(layer, face, fit(deedSource), fit(upright(target)), duration, 'one-way', undefined, 0,
                        [deedFrom ?? 0, angleOf(target)]);
                }
            }
            const scanned = event.kind === 'scan' ? creditCards[event.target ?? event.seat ?? -1] : undefined;
            if (scanned) {
                const home = scanned.getBoundingClientRect();
                if (event.seat !== state?.youAre || performance.now() >= localScanUntil)
                    scanFlight(scanned, home, home, duration);
                else localScanUntil = 0;
            }
            if ((event.kind === 'hell' || event.kind === 'release') && event.path?.length) {
                const point = location(event.path[event.path.length - 1]);
                if (piece) place(piece, point.x, point.y);
                if (!drag)
                    camera.follow(() => ({ x: origin.x + point.x, y: origin.y + point.y }), 0.7, duration + 1200);
                table.root.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(.75)' },
                    { filter: 'brightness(1)' }], { duration });
                const tile = [...table.tiles.values()].find(node => node.style.left === `${point.x}px` &&
                    node.style.top === `${point.y}px`);
                tile?.animate([{ filter: 'brightness(2)' }, { filter: 'brightness(1)' }], { duration });
                piece?.animate([
                    { opacity: 0, transform: 'translate(-50%, -50%) scale(.2)' },
                    { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' }
                ], { duration });
            }
            if (event.kind === 'swap' && event.path?.length === 2 && event.target !== undefined) {
                const [to, from] = event.path.map(location);
                const x = from.x - to.x, y = from.y - to.y;
                if (piece) place(piece, to.x, to.y);
                place(table.pieces[event.target], from.x, from.y);
                const ease = { duration, easing: 'ease-in-out' };
                piece?.animate([{ translate: `${x}px ${y}px` }, { translate: '0 0' }], ease);
                table.pieces[event.target].animate([{ translate: `${-x}px ${-y}px` }, { translate: '0 0' }], ease);
                if (piece) table.hop(piece, 1, duration);
                table.hop(table.pieces[event.target], 1, duration);
            }
            if (event.kind === 'deadHand') explode(event.property ? table.tiles.get(event.property) : undefined, duration);
            if ((event.kind === 'destroy' || event.kind === 'deadHand') && event.property)
                table.tiles.get(event.property)?.animate([{ filter: 'brightness(2) sepia(1)' },
                    { filter: 'brightness(.5)' }, { filter: 'brightness(1)' }], { duration });
            if (event.kind === 'bankrupt' && card)
                card.animate([{ opacity: 1, scale: '1' }, { opacity: .45, scale: '.86' },
                    { opacity: .45, scale: '1' }], { duration });
            if (['draw', 'hell', 'release', 'swap', 'destroy', 'deadHand', 'bankrupt'].includes(event.kind)) toast(event.text, eventToast(event));
        }, Math.max(0, delay));
        const rolled = event.kind === 'roll' ? event.dice : undefined;
        if (seats.length || rolled) window.setTimeout(() => {
            if (generation !== animationGeneration) return;
            if (rolled) {
                pendingRolls.delete(event.seq);
                showDice(pendingRolls.size ? rolled : state?.view?.dice ?? rolled);
                renderLog();
            }
            for (const seat of seats) {
                const remaining = (movingPieces.get(seat) ?? 1) - 1;
                if (remaining) movingPieces.set(seat, remaining);
                else {
                    movingPieces.delete(seat);
                    table.settlePiece(seat, true);
                }
            }
        }, Math.max(0, delay) + (rolled ? ROLL_MS : duration));
    }
    animationUntil = cursor;
}

function renderSync(message: Sync): void {
    const prior = state;
    state = message;
    if (prior?.youAre !== message.youAre || prior?.generation !== message.generation)
        table.readerDisplay.textContent = '';
    if (!message.started) sessionStorage.removeItem(tokenKey());
    if (message.resumeToken && message.view)
        sessionStorage.setItem(tokenKey(), JSON.stringify({ token: message.resumeToken,
            seq: message.view.seq, generation: message.generation }));
    byId('lobby').hidden = message.started;
    byId('game').hidden = !message.started;
    if (prior?.generation !== message.generation || prior?.started !== message.started) {
        animationGeneration++;
        animationUntil = 0;
        movingPieces.clear();
        pendingRolls.clear();
        world.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
        log = [];
        readSeq = 0;
        panelBack();
        byId<GameDialog>('panel').close();
        byId<GameDialog>('log-modal').close();
        if (message.started) camera.fit();
    }
    if (!message.view) return renderLobby(message);
    const view = message.view;
    const next = message.events.filter(event => !log.length || event.seq > log[log.length - 1].seq);
    const sameGame = !!prior?.view && prior.generation === message.generation && prior.started === message.started;
    if (sameGame) {
        animateEvents(next);
        for (const event of next) {
            if (event.kind !== 'stockResult' || event.seat !== message.youAre || event.amount === undefined) continue;
            const gain = event.amount;
            toast(gain ? `${gain > 0 ? 'Won' : 'Lost'} ${money(Math.abs(gain))} on stocks` : 'Broke even on stocks',
                'stock');
        }
    }
    if (!pendingRolls.size) showDice(view.dice);
    log = [...log, ...next].slice(-400);
    renderLog();
    if (prior?.view && prior.youAre === message.youAre && next.some(event => event.kind === 'scan')) {
        const scanned = [...next].reverse().find(event => event.kind === 'scan');
        const balance = scanned?.target === undefined ? view.players[message.youAre]?.cash : scanned.amount;
        table.readerDisplay.textContent = scanned?.seat === message.youAre && balance != null ? money(balance) : '';
        clearTimeout(scanDisplayTimer);
        scanDisplayTimer = setTimeout(() => {
            table.readerDisplay.textContent = '';
        }, 3500);
        if (scanAudio?.state === 'running') {
            const tone = scanAudio.createOscillator();
            const gain = scanAudio.createGain();
            const now = scanAudio.currentTime;
            tone.frequency.value = 850;
            gain.gain.setValueAtTime(0.05, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
            tone.connect(gain).connect(scanAudio.destination);
            tone.start(now);
            tone.stop(now + 0.12);
        }
    }
    table.render(view, message.youAre, message.settings.hell, movingPieces,
        sameGame && !matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (!view.players[message.youAre]?.cards.includes(escapeSelection ?? '')) escapeSelection = null;
    highlightEscapes();
    table.wheel.hidden = !message.settings.stock;
    (table.root.querySelector('.black-market') as HTMLElement).hidden = !message.settings.market;
    byId('focus-hell').hidden = !message.settings.hell;
    const fans: Array<HTMLElement> = [];
    const leader = view.players.map((player, seat) => {
        const row = el('div', '', 'player-card');
        row.style.setProperty('--seat', seatColors[seat]);
        const stats = el('small', '', 'player-card__stats');
        const owned = properties.filter(property => view.deeds[property.id]?.owner === seat);
        const sets = new Set(owned.filter(property => property.type === 'street' &&
            properties.filter(item => item.deed.groupId === property.deed.groupId)
                .every(item => view.deeds[item.id]?.owner === seat)).map(property => property.deed.groupId));
        const name = button('', () => focusSeat(seat));
        name.className = 'player-card__name';
        name.append(el('span', `P${seat + 1}`, 'player-card__tag'),
            el('span', seat === message.youAre ? `${player.name} (YOU)` : player.name));
        const deedsLink = button(`${owned.length} deeds`, () => openDeeds(seat));
        deedsLink.className = 'link';
        stats.append(`${sets.size} sets · `, deedsLink, ` · Net ${money(player.netWorth)}`);
        if (player.bail !== null) stats.append(` · Bail ${money(player.bail)}`);
        if (player.eliminated) stats.append(' · Out');
        const badge = button('', () => focusSeat(seat));
        badge.className = 'player-card__icon';
        badge.setAttribute('aria-label', `Focus on P${seat + 1}: ${player.name}`);
        badge.append(tokenIcon(player.token));
        row.append(badge, name,
            el('span', money(player.cash), 'balance'), stats);
        for (const upgrade of player.upgrades) {
            const icon = el('span', upgrades[upgrade].icon);
            icon.title = upgrades[upgrade].name;
            stats.append(' ', icon);
        }
        row.classList.toggle('current', seat === view.turn);
        row.classList.toggle('player-card--out', player.eliminated);
        if (!message.seats[seat].connected) row.classList.add('offline');
        const pose = station(seat, view.players.length);
        const fan = el('div', '', 'deed-fan');
        fan.style.setProperty('--deed-width', `${FAN_DEED_WIDTH}px`);
        const sideways = pose.angle === 90;
        place(fan, pose.x + (sideways ? -FAN_DISTANCE : 0), pose.y + (sideways ? 0 : Math.sign(pose.y) * FAN_DISTANCE), pose.angle);
        const step = FAN_DEED_WIDTH - FAN_OVERLAP;
        const reach = (Math.min(owned.length, FAN_ROW_SIZE) - 1) * step / 2 + FAN_DEED_WIDTH / 2;
        for (const [i, property] of owned.entries()) {
            const card = deedButton(property, () => {
                if (!ignoreClick) propertyClick(property.id);
                ignoreClick = false;
            });
            card.dataset.deed = property.id;
            const line = Math.floor(i / FAN_ROW_SIZE);
            const inLine = Math.min(FAN_ROW_SIZE, owned.length - line * FAN_ROW_SIZE);
            const home = { x: (i % FAN_ROW_SIZE - (inLine - 1) / 2) * step, y: line * FAN_ROW_STEP, angle: 0 };
            place(card, home.x, home.y, home.angle);
            attachGrab(card, () => home, () => false, () => false);
            fan.append(card);
        }
        if (seat === message.youAre) player.cards.forEach((card, i) => {
            const held = escapeCard(card, true);
            held.dataset.card = card;
            place(held, reach + 75 + i * 20, 0);
            fan.append(held);
        });
        else if (player.cards.length) {
            const held = el('span', `↗ ×${player.cards.length}`, 'escape-count');
            held.dataset.card = player.cards.at(-1);
            fan.append(held);
        }
        fans.push(fan);
        return row;
    });
    deedFans.replaceChildren(...fans);
    byId('leaderboard').replaceChildren(...leader);
    view.players.forEach((player, seat) => {
        const card = creditCards[seat] ?? (creditCards[seat] = addCreditCard(seat));
        card.hidden = false;
        card.style.backgroundImage = `url(img/cards/${player.skin}.png)`;
        card.replaceChildren(el('span', player.name, 'credit-card__name'));
        card.classList.toggle('inactive', player.eliminated);
        card.classList.toggle('mine', seat === message.youAre);
        card.title = seat === message.youAre ? `${player.name} · ${money(player.cash)}` : player.name;
        if (drag?.node !== card) poseCard(card, player.pose);
    });
    for (const card of creditCards.slice(view.players.length)) card.hidden = true;
    renderControls(message);
    animateWheel();
    if (marketList?.isConnected && byId<GameDialog>('panel').open) shop();
}

const mockMode = new URLSearchParams(window.location.search).has('mock');
let mockHandler: ((action: string, fields: Record<string, unknown>) => void) | undefined;

function offlineConnection(): GameConnection {
    return {
        // SAFETY: Nothing reads the socket while the sandbox is offline.
        socket: undefined as unknown as WebSocket,
        send: message => {
            if (message.type === 'MOVE') mockHandler?.(String(message.action), message);
            return true;
        },
        dispose: () => undefined
    };
}

function connect() {
    let resume: { resumeToken: string; nextTick: number } | undefined;
    const stored = sessionStorage.getItem(tokenKey());
    if (stored) try {
        const saved = JSON.parse(stored) as { token?: unknown; seq?: unknown } | null;
        if (typeof saved?.token === 'string' && typeof saved.seq === 'number')
            resume = { resumeToken: saved.token, nextTick: saved.seq };
    } catch {
        sessionStorage.removeItem(tokenKey());
    }
    return connectToGame({
        resume,
        gameType: 'super_monopoly', pingIntervalInMilliseconds: 5000,
        disconnectBanner: byId('disconnect-banner'),
        onOpen: () => {
            byId('disconnect-banner').hidden = true;
        },
        onClose: () => {
            clearTimeout(reconnect);
            reconnect = setTimeout(() => {
                connection = connect();
            }, 1200);
        },
        onMessage: message => {
            if (message.type === 'UUID') byId<HTMLInputElement>('invite').value = window.location.href;
            else if (message.type === 'SYNC')
                // SAFETY: The game server produces SYNC messages using the shared protocol type.
                renderSync(message as unknown as Sync);
            else if (message.type === 'PING' && typeof message.serverTime === 'number' && typeof message.ping === 'number')
                clock = message.serverTime - (Date.now() + message.ping) / 2;
            else if (message.type === 'ERROR') toast(String(message.error), 'error');
            else if (message.type === 'KICKED') window.location.replace(window.location.pathname);
            else if (message.type === 'PREVIEW' && typeof message.seat === 'number' && creditCards[message.seat] &&
                drag?.node !== creditCards[message.seat])
                poseCard(creditCards[message.seat], message.pose as Pose);
            else if (message.type === 'CHAT') appendChat(String(message.username), String(message.message));
        }
    });
}

let lastChatName = '';

function appendChat(name: string, text: string): void {
    const messages = byId('messages');
    const mine = !!state && name === state.seats[state.youAre]?.username;
    const follow = mine || messages.scrollHeight - messages.scrollTop - messages.clientHeight < 40;
    const parts = { 'amp': '&', 'lt': '<', 'gt': '>', 'quot': '"' };
    const decoded = text.replace(/&(amp|lt|gt|quot);/g, (_, key: keyof typeof parts) => parts[key]);
    const row = el('div', '', 'chat-message');
    row.classList.toggle('chat-message--mine', mine);
    if (name === lastChatName) row.classList.add('chat-message--grouped');
    else {
        const seat = state?.seats.findIndex(item => item.username === name) ?? -1;
        const author = el('strong', name);
        if (seat >= 0) author.style.color = seatColors[seat];
        const head = el('div', '', 'chat-message__head');
        head.append(author, el('time', new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
        row.append(head);
    }
    lastChatName = name;
    row.append(el('p', decoded, 'chat-message__text'));
    messages.append(row);
    if (messages.childElementCount > 150) messages.firstElementChild?.remove();
    if (follow) messages.scrollTop = messages.scrollHeight;
    const badge = byId('chat-unread');
    if (byId('chat').hidden) chatUnread++;
    badge.textContent = chatUnread > 99 ? '99+' : String(chatUnread);
    badge.hidden = !chatUnread;
}

let connection = mockMode ? offlineConnection() : connect();
if (mockMode) void import('./mock.js').then(({ startMock }) => {
    mockHandler = startMock(renderSync);
});
byId<HTMLInputElement>('invite').value = window.location.href;
byId<HTMLInputElement>('invite').onclick = event => (event.currentTarget as HTMLInputElement).select();
byId('copy-link').onclick = () => {
    void copyInviteLink(byId('game-link'), window.location.href);
};
byId<HTMLFormElement>('profile').onsubmit = event => {
    event.preventDefault();
    connection.send({ type: 'USERNAME', username: byId<HTMLInputElement>('username').value });
};
function buildPicker(id: 'token' | 'skin', choices: Array<{ value: number; label: string; image: string }>): void {
    const root = byId(id);
    for (const { value, label, image } of choices) {
        const choice = button('', () => {
            const seat = state?.seats[state.youAre];
            if (seat) send('PROFILE', { token: seat.token, skin: seat.skin, [id]: value });
        });
        choice.className = 'picker__choice';
        choice.type = 'button';
        choice.dataset.value = String(value);
        choice.setAttribute('role', 'radio');
        choice.setAttribute('aria-label', label);
        const picture = el('img');
        picture.src = image;
        picture.alt = '';
        picture.draggable = false;
        choice.append(picture);
        root.append(choice);
    }
}
buildPicker('token', tokens.map((label, value) => ({ value, label, image: tokenImage(value) })));
buildPicker('skin', Array.from({ length: 10 }, (_, i) => ({ value: i + 1, label: `Card ${i + 1}`,
    image: `img/cards/${i + 1}.png` })));
byId('ready').onclick = () => {
    connection.send({ type: 'READY' });
};
byId('start-game').onclick = () => send('START_GAME');
byId('add-cpu').onclick = () => send('ADD_BOT');
byId<HTMLFormElement>('options').onsubmit = event => {
    event.preventDefault();
    const fields = (event.currentTarget as HTMLFormElement).querySelectorAll('input');
    send('SET_OPTIONS', { settings: Object.fromEntries([...fields].map(input =>
        [input.name, input.type === 'checkbox' ? input.checked : input.valueAsNumber])) });
};
byId('recenter').onclick = () => camera.fit();
byId('zoom-in').onclick = () => camera.zoom(1.2);
byId('zoom-out').onclick = () => camera.zoom(1 / 1.2);
byId('focus-board').onclick = () => camera.focus(origin, 0.53);
byId('focus-hell').onclick = () => camera.focus({ x: origin.x + hellPoint.x, y: origin.y + hellPoint.y }, 0.95);
byId('chat-toggle').onclick = () => {
    const chat = byId('chat');
    chat.hidden = !chat.hidden;
    byId('chat-toggle').setAttribute('aria-expanded', String(!chat.hidden));
    chatUnread = 0;
    byId('chat-unread').hidden = true;
    if (chat.hidden) return;
    byId('messages').scrollTop = byId('messages').scrollHeight;
    byId('chat-input').focus();
};
byId('chat-input').onkeydown = event => {
    if (event.key !== 'Escape') return;
    byId('chat').hidden = true;
    byId('chat-toggle').setAttribute('aria-expanded', 'false');
    byId('chat-toggle').focus();
};
byId<HTMLFormElement>('chat-form').onsubmit = event => {
    event.preventDefault();
    const input = byId<HTMLInputElement>('chat-input');
    if (input.value.trim() && connection.send({ type: 'CHAT', message: input.value.trim() })) input.value = '';
};
byId('log-filter').oninput = () => renderLog();
byId('log-panel').onclick = () => {
    byId<GameDialog>('log-modal').showModal();
    renderLog(true);
};
byId<GameDialog>('log-modal').addEventListener('click', event => {
    if (event.target === event.currentTarget) byId<GameDialog>('log-modal').close();
});
byId('rules-button').onclick = () => byId<GameDialog>('rules-modal').showModal();
function setHudCollapsed(collapsed: boolean): void {
    byId('hud-actions').hidden = collapsed;
    const toggle = byId('hud-toggle');
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.textContent = collapsed ? 'Show controls' : 'Hide controls';
}

byId('hud-toggle').onclick = () => setHudCollapsed(!byId('hud-actions').hidden);
matchMedia('(max-width: 650px)').addEventListener('change', event => {
    if (!event.matches) setHudCollapsed(false);
});
byId('skip-motion').onclick = () => {
    animationGeneration++;
    animationUntil = 0;
    spinAnimation?.cancel();
    world.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
    for (const seat of movingPieces.keys()) table.settlePiece(seat);
    movingPieces.clear();
    pendingRolls.clear();
    showDice(state?.view?.dice ?? []);
    renderLog();
    byId('flight-layer').replaceChildren();
    byId('explosion-layer').replaceChildren();
    state?.view?.players.forEach((player, seat) => {
        const balance = byId('leaderboard').children.item(seat)?.querySelector('.balance');
        if (balance) balance.textContent = money(player.cash);
    });
};
window.setInterval(() => {
    byId('skip-motion').hidden = performance.now() >= animationUntil && spinAnimation?.playState !== 'running';
    const bar = byId<HTMLProgressElement>('deadline');
    bar.hidden = deadline === null;
    if (deadline === null) return;
    const remaining = Math.max(0, deadline - Date.now() - clock);
    bar.max = deadlineSpan;
    bar.value = remaining;
    bar.title = `${Math.ceil(remaining / 1000)} seconds`;
}, 100);
