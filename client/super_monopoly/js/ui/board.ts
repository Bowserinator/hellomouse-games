import { boards } from '../boards/index.js';
import { seatColors, tokenImage, upgrades } from '../types.js';
import type { Position } from '../types.js';
import type { View } from '../engine/state.js';
import { button, el, money } from './dom.js';

export const origin = { x: 1050, y: 930 };
export const readerPoint = { x: 720, y: 111 };
export const readerRadius = 150;
export const dicePoint = { x: 330, y: -330 };
export const wheelPoint = { x: 744, y: 460 };
const board = boards.classicUs;
const artByType: Record<string, string> = {
    go: 'go', parking: 'free_parking', detention: 'go_to_hell', visiting: 'hell_gate',
    chance: 'chance', chest: 'chest', railroad: 'railroad'
};
const artById: Record<string, string> = {
    electric_company: 'electric_company', water_works: 'water_works', income_tax: 'income_tax', luxury_tax: 'luxury_tax',
    hell_entry: 'hell_corner_1', torment: 'hell_corner_2', ash_fields: 'hell_corner_3', limbo: 'hell_corner_4'
};
const { width, cornerSize } = board.dimensions;
const hellWidth = 2 * cornerSize + 98;
export const hellPoint = { x: 829, y: -391 };

const pipLayouts = [[5], [1, 9], [1, 5, 9], [1, 3, 7, 9], [1, 3, 5, 7, 9], [1, 3, 4, 6, 7, 9]];
const faceTurns = [[0, 0], [-90, 0], [0, -90], [0, 90], [90, 0], [0, 180]];
const faceSides = [
    'rotateY(0deg)', 'rotateX(90deg)', 'rotateY(90deg)', 'rotateY(-90deg)', 'rotateX(-90deg)', 'rotateY(180deg)'
];
const restAngles = [0, 0];
const PIECE_LAYERS = 10;
const PIECE_HOP = 26;

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

/** Flat color of a piece layer at the given shade, from 0 (darkest) to 1 (lightest). */
function layerColor(shade: number): string {
    const saturation = 2.2;
    const matrices = [
        [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131],
        [0.213 + 0.787 * saturation, 0.715 - 0.715 * saturation, 0.072 - 0.072 * saturation,
            0.213 - 0.213 * saturation, 0.715 + 0.285 * saturation, 0.072 - 0.072 * saturation,
            0.213 - 0.213 * saturation, 0.715 - 0.715 * saturation, 0.072 + 0.928 * saturation]
    ];
    let color = [0.62, 0.62, 0.62];
    for (const m of matrices) {
        const [r, g, b] = color;
        color = [0, 3, 6].map(i => clamp(m[i] * r + m[i + 1] * g + m[i + 2] * b));
    }
    const channels = color.map(value => Math.round(clamp(value * (0.6 + shade * 0.4)) * 255));
    return `rgb(${channels.join(' ')})`;
}

const tintedLayers = new Map<string, Promise<string>>();

function tintedLayer(image: string, shade: number): Promise<string> {
    const key = `${image}|${shade}`;
    let result = tintedLayers.get(key);
    if (!result) {
        const source = new Image();
        source.src = image;
        result = source.decode().then(() => {
            const canvas = document.createElement('canvas');
            canvas.width = source.naturalWidth;
            canvas.height = source.naturalHeight;
            const context = canvas.getContext('2d') as CanvasRenderingContext2D;
            context.drawImage(source, 0, 0);
            context.globalCompositeOperation = 'source-in';
            context.fillStyle = layerColor(shade);
            context.fillRect(0, 0, canvas.width, canvas.height);
            return canvas.toDataURL();
        });
        tintedLayers.set(key, result);
    }
    return result;
}

export function scatterDice(): void {
    restAngles.forEach((_, i) => {
        restAngles[i] = Math.round(Math.random() * 90 - 45);
    });
}
scatterDice();

export function dieTransform(index: number, value: number,
    drift = { x: 0, y: 0, z: 0, turnsX: 0, turnsY: 0, turnsZ: 0 }, angle = restAngles[index]): string {
    const [turnX, turnY] = faceTurns[Math.min(Math.max(value, 1), 6) - 1];
    return `translate3d(${drift.x}px, ${drift.y}px, ${drift.z}px) rotateX(0deg) rotateY(0deg) ` +
        `rotateX(${turnX + 360 * drift.turnsX}deg) rotateY(${turnY + 360 * drift.turnsY}deg) ` +
        `rotateZ(${angle + 360 * drift.turnsZ}deg)`;
}

export function settleDie(cube: HTMLElement, index: number, value: number): void {
    cube.dataset.value = String(value);
    cube.dataset.angle = String(restAngles[index]);
    cube.classList.add('flat');
    cube.style.transform = dieTransform(index, 1);
}

function dieCube(): HTMLElement {
    const cube = el('span', '', 'die');
    faceSides.forEach((side, i) => {
        const face = el('span', '', 'die__face');
        face.style.setProperty('--side', side);
        const pips = pipLayouts[i];
        for (let cell = 1; cell <= 9; cell++)
            face.append(el('i', '', pips.includes(cell) ? 'pip' : ''));
        cube.append(face);
    });
    return cube;
}

function sideGeometry(hell: boolean): { perSide: number; edge: number; step: number } {
    const perSide = (hell ? board.hell.spaces.length : board.spaces.length) / 4;
    const edge = (hell ? hellWidth : width) / 2;
    return { perSide, edge, step: (2 * edge - 2 * cornerSize + 1) / (perSide - 1) };
}

export function location(position: Position): { x: number; y: number; angle: number } {
    const hell = position.board === 'hell';
    const { perSide, edge, step } = sideGeometry(hell);
    const side = Math.floor(position.index / perSide);
    const along = position.index % perSide;
    const x = along ? edge - cornerSize + 0.5 - (along - 0.5) * step : edge - cornerSize / 2;
    const y = edge - cornerSize / 2;
    const point = [
        { x, y, angle: 0 }, { x: -y, y: x, angle: 90 },
        { x: -x, y: -y, angle: 180 }, { x: y, y: -x, angle: 270 }
    ][side];
    return hell ? { x: point.x + hellPoint.x, y: point.y + hellPoint.y, angle: point.angle } : point;
}

export function place(node: HTMLElement, x: number, y: number, angle = 0): void {
    Object.assign(node.style, { left: `${x}px`, top: `${y}px` });
    node.style.setProperty('--angle', `${angle}deg`);
}

export class BoardView {
    readonly tiles = new Map<string, HTMLButtonElement>();
    readonly pieces: Array<HTMLButtonElement> = [];
    private piecePlaces: Array<{ x: number; y: number }> = [];
    private vantage = { x: 0, y: 0 };
    private shineUntil = 0;
    private shining = false;
    readonly root = el('div', '', 'board-origin');
    private pieceLayer = el('div', '', 'piece-layer');
    readonly dice: HTMLButtonElement;
    readonly diceCubes: Array<HTMLElement>;
    readonly reader: HTMLButtonElement;
    readonly readerDisplay = el('span', '', 'reader-display');
    readonly wheel: HTMLButtonElement;
    readonly decks: Record<'chance' | 'chest', HTMLDivElement>;
    readonly hell = el('div', '', 'hell-board');

    constructor(world: HTMLElement, tileClick: (id: string) => void, private action: (action: string) => void,
        pieceClick: (seat: number) => void) {
        place(this.root, origin.x, origin.y);
        world.append(this.root);
        this.root.append(el('div', '', 'board-surface'), this.hell);
        this.hell.append(el('strong', 'HELL'));
        this.hell.style.setProperty('--hell-width', `${hellWidth}px`);
        place(this.hell, hellPoint.x, hellPoint.y);
        for (const name of ['main', 'hell'] as const) {
            const spaces = name === 'main' ? board.spaces : board.hell.spaces;
            spaces.forEach((space, index) => {
                const node = button('', () => tileClick(space.id));
                const perSide = spaces.length / 4;
                const corner = index % perSide === 0;
                node.className = `tile tile--${name}${corner ? ' tile--corner' : ''}` +
                    (space.type === 'street' ? ' tile--street' : '');
                if (!corner) node.style.width = `${sideGeometry(name === 'hell').step + 1}px`;
                if (!corner && Math.floor(index / perSide) === 2) node.classList.add('tile--flip');
                node.setAttribute('aria-label', space.name);
                const point = location({ board: name, index });
                place(node, point.x, point.y, point.angle);
                if (space.deed) node.style.setProperty('--group', board.colors[space.deed.groupId] ?? '#c6c5b5');
                const art = artById[space.id] ?? artByType[space.type];
                node.append(el('span', '', 'tile__strip'));
                if (!corner) node.append(el('span', space.name, 'tile__name'));
                if (art) {
                    const image = el('img', '', 'tile__art');
                    image.src = `img/tiles/${art}.png`;
                    image.alt = '';
                    image.draggable = false;
                    node.append(image);
                }
                const cost = space.deed ? money(space.deed.price) : space.tax ? money(space.tax) : '';
                node.append(el('small', cost, 'tile__price'), el('span', '', 'tile__owner'));
                this.tiles.set(space.id, node);
                this.root.append(node);
            });
        }
        const center = el('strong', 'BOWSEROPOLY', 'board-brand');
        place(center, 0, 0, -45);
        this.root.append(center);
        this.dice = button('', () => action('ROLL'));
        this.dice.className = 'dice-dome';
        this.diceCubes = [dieCube(), dieCube()];
        this.diceCubes.forEach((cube, i) => cube.style.setProperty('--shift', `${i ? 46 : -46}px`));
        this.dice.append(el('span', '', 'dice-base'), el('span', '', 'dice-floor'), ...this.diceCubes,
            el('span', '', 'dice-glass'));
        this.dice.setAttribute('aria-label', 'Roll dice');
        place(this.dice, dicePoint.x, dicePoint.y);
        this.reader = button('', () => action('SCAN'));
        this.reader.className = 'reader';
        this.reader.setAttribute('aria-label', 'Scan your card');
        this.readerDisplay.setAttribute('role', 'status');
        this.reader.append(this.readerDisplay, el('strong', 'CARD READER', 'reader-label'));
        place(this.reader, readerPoint.x, readerPoint.y);
        this.wheel = button('Stock market', () => action('WHEEL'));
        this.wheel.className = 'wheel-target';
        place(this.wheel, wheelPoint.x, wheelPoint.y);
        const market = button('', () => action('MARKET'));
        market.className = 'black-market';
        market.setAttribute('aria-label', 'Black Market');
        Object.keys(upgrades).forEach((_, i) => {
            const layer = el('span', '', 'black-market__card');
            layer.style.setProperty('--i', String(i));
            market.append(layer);
        });
        place(market, -330, 330, -45);
        this.decks = { chance: el('div'), chest: el('div') };
        const deckSpots: Record<string, number> = { chance: 290, chest: -290 };
        Object.entries(this.decks).forEach(([key, node]) => {
            node.className = `deck deck--${key}`;
            place(node, deckSpots[key], deckSpots[key], -45);
        });
        this.root.append(this.dice, this.reader, this.wheel, market, ...Object.values(this.decks));
        for (let seat = 0; seat < 8; seat++) {
            const node = button('', () => pieceClick(seat));
            node.className = 'piece';
            const stack = el('span', '', 'piece__stack');
            for (let layer = 0; layer < PIECE_LAYERS; layer++) {
                const slice = el('img', '', 'piece__layer');
                slice.alt = '';
                slice.draggable = false;
                slice.dataset.shade = String(layer / (PIECE_LAYERS - 1));
                slice.style.setProperty('--depth', String(layer));
                stack.append(slice);
            }
            const sheen = el('span', '', 'piece__sheen');
            sheen.style.setProperty('--depth', String(PIECE_LAYERS - 0.9));
            sheen.append(el('span', '', 'piece__sheen-fill'));
            stack.append(sheen);
            const lift = el('span', '', 'piece__lift');
            lift.append(stack);
            node.append(el('span', '', 'piece__shadow'), lift);
            node.style.setProperty('--seat', seatColors[seat]);
            node.hidden = true;
            this.pieces.push(node);
            this.pieceLayer.append(node);
        }
        this.root.append(this.pieceLayer);
        const moved = new MutationObserver(records => {
            for (const { target } of records) {
                const node = target as HTMLElement;
                const spot = `${node.style.left} ${node.style.top}`;
                if (node.dataset.spot === spot) continue;
                node.dataset.spot = spot;
                this.wake(50);
            }
        });
        for (const node of this.pieces) moved.observe(node, { attributes: true, attributeFilter: ['style'] });
        this.wake(100);
    }

    private wake(ms: number): void {
        this.shineUntil = Math.max(this.shineUntil, performance.now() + ms);
        if (this.shining) return;
        this.shining = true;
        requestAnimationFrame(this.shine);
    }

    private shine = (): void => {
        for (const node of this.pieces) {
            if (node.hidden) continue;
            const dx = node.offsetLeft - this.vantage.x;
            const dy = node.offsetTop - this.vantage.y;
            const view = [dx, dy].map(value => Math.max(-1, Math.min(1, value / 700)).toFixed(2)).join(' ');
            if (node.dataset.view === view) continue;
            node.dataset.view = view;
            const [x, y] = view.split(' ');
            node.style.setProperty('--view-x', x);
            node.style.setProperty('--view-y', y);
        }
        if (performance.now() < this.shineUntil) requestAnimationFrame(this.shine);
        else this.shining = false;
    };

    /** Moves the point the board is viewed from, in board coordinates. */
    setVantage(x: number, y: number): void {
        this.vantage = { x, y };
        this.pieceLayer.style.perspectiveOrigin = `${x}px ${y}px`;
        this.wake(50);
    }

    hop(piece: HTMLElement, steps: number, duration: number): void {
        if (steps < 1) return;
        const keyframes: Array<Keyframe> = [];
        for (let step = 0; step < steps; step++)
            keyframes.push({ '--hop': '0', offset: step / steps, easing: 'ease-out' },
                { '--hop': String(PIECE_HOP), offset: (step + 0.5) / steps, easing: 'ease-in' });
        keyframes.push({ '--hop': '0', offset: 1 });
        piece.animate(keyframes, { duration });
        this.wake(duration + 50);
    }

    settlePiece(seat: number, reflow = false): void {
        const point = this.piecePlaces[seat];
        if (!point) return;
        const node = this.pieces[seat];
        const animation = node.getAnimations().find(item => item.id === 'piece-reflow');
        if (!reflow) animation?.cancel();
        if (node.style.left === `${point.x}px` && node.style.top === `${point.y}px`) return;
        const { left, top } = getComputedStyle(node);
        const from = { left, top };
        animation?.cancel();
        place(node, point.x, point.y);
        if (reflow) {
            node.animate([from, { left: node.style.left, top: node.style.top }],
                { id: 'piece-reflow', duration: 200, easing: 'ease-out' });
            this.wake(250);
        }
    }

    render(view: View, seat: number, hell: boolean, moving: ReadonlyMap<number, number>, reflow: boolean): void {
        const { phase } = view;
        this.wake(300);
        const active = view.turn === seat && !view.players[seat]?.eliminated;
        this.hell.hidden = !hell;
        this.dice.disabled = !active || !['roll', 'extra'].includes(phase.kind);
        this.dice.classList.toggle('required', !this.dice.disabled);
        this.reader.disabled = !view.players[seat] || view.players[seat].eliminated;
        for (const key of ['chance', 'chest'] as const) {
            const deck = this.decks[key];
            const count = view.deckCounts[key];
            const side = key === 'chance' ? -1 : 1;
            const scale = 0.5;
            if (deck.childElementCount !== count) {
                const stack = Array.from({ length: count }, (_, i) => {
                    const top = i === count - 1;
                    const card = top ? button('', () => this.action('DRAW')) : el('span');
                    card.className = 'deck-card';
                    card.style.transform = `translate(${(i - count + 1) * 0.7 * scale}px, ${(count - i - 1) * 1.5 * scale * side}px)`;
                    if (top) card.setAttribute('aria-label', key === 'chance' ? 'Draw Chance' : 'Draw Community Chest');
                    else card.setAttribute('aria-hidden', 'true');
                    return card;
                });
                deck.replaceChildren(...stack);
            }
            const top = deck.querySelector('button');
            if (top) {
                top.disabled = !active || phase.kind !== 'draw' || phase.deck !== key;
                top.classList.toggle('required', !top.disabled);
            }
        }
        const spaces = [...board.spaces, ...board.hell.spaces];
        for (const space of spaces) {
            const node = this.tiles.get(space.id) as HTMLButtonElement;
            const deed = view.deeds[space.id];
            const owner = deed?.owner ?? null;
            node.classList.toggle('legal', active && phase.kind === 'select' && phase.properties.includes(space.id));
            node.classList.toggle('mortgaged', !!deed?.mortgaged);
            node.classList.toggle('destroyed', !!deed?.destroyed);
            node.style.setProperty('--owner', owner === null ? 'transparent' : seatColors[owner]);
            (node.querySelector('.tile__owner') as HTMLElement).textContent = owner === null ? '' : String(owner + 1);
            node.querySelectorAll('.building').forEach(item => item.remove());
            const built = deed?.level === 5 ? 1 : deed?.level ?? 0;
            for (let i = 0; i < built; i++) {
                const image = el('img', '', 'building');
                image.src = `img/buildings/${deed?.level === 5 ? 'hotel' : 'house'}.png`;
                image.alt = '';
                image.style.left = `calc(50% + ${(i - (built - 1) / 2) * 24}px)`;
                node.append(image);
            }
            node.hidden = node.classList.contains('tile--hell') && !hell;
            const blocked = active && phase.kind === 'select' && !!deed && !phase.properties.includes(space.id);
            const reason = blocked ? deed.destroyed ? 'Destroyed' : owner !== null ? 'Already owned' : 'Protected set' : '';
            const arson = active && phase.kind === 'arson' && phase.property === space.id;
            node.classList.toggle('upgrade-target', arson);
            const hint = arson ? 'Use Arson' : reason;
            node.setAttribute('aria-label', hint ? `${space.name}: ${hint}` : space.name);
        }
        this.pieces.forEach((node, i) => {
            const player = view.players[i];
            const visible = !node.hidden;
            node.hidden = !player || player.eliminated;
            if (!player || player.eliminated) return;
            const image = tokenImage(player.token);
            node.querySelectorAll<HTMLImageElement>('.piece__layer').forEach(layer => {
                if (layer.dataset.image === image) return;
                layer.dataset.image = image;
                void tintedLayer(image, Number(layer.dataset.shade)).then(url => {
                    if (layer.dataset.image === image) layer.src = url;
                });
            });
            (node.querySelector('.piece__sheen') as HTMLElement).style.setProperty('mask-image', `url("${image}")`);
            const swap = view.swapTargets.includes(i);
            node.classList.toggle('upgrade-target', swap);
            node.setAttribute('aria-label', swap ? `Swap with ${player.name}` : player.name);
            const peers = view.players.filter(other => !other.eliminated &&
                other.position.board === player.position.board && other.position.index === player.position.index);
            const slot = peers.indexOf(player);
            const point = location(player.position);
            const row = Math.floor(slot / 3);
            const columns = Math.min(3, peers.length - row * 3);
            this.piecePlaces[i] = {
                x: point.x + (slot % 3 - (columns - 1) / 2) * 30,
                y: point.y + (row - (Math.ceil(peers.length / 3) - 1) / 2) * 30
            };
            if (!moving.has(i)) this.settlePiece(i, reflow && visible);
        });
    }
}
