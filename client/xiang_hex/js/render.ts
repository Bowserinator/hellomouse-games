/**
 * Canvas rendering of the wooden Xiang Hex board and round Xiangqi pieces.
 */
import { BOARD_HEIGHT, BOARD_WIDTH, CELLS, cellCorners } from './geometry.js';
import type { Cell, Side } from './geometry.js';
import { GLYPHS } from './rules.js';
import type { Board, Move, Piece } from './rules.js';
import { Rng } from '../../shared/ts/seeded-random.js';
import { valueNoise } from '../../shared/ts/value-noise.js';

/** Wood around the playable cells, in board units */
const SLAB_MARGIN = 0.85;
/** Space around the slab for its shadow, in board units */
const SHADOW_MARGIN = 0.55;

/** Width over height of the whole canvas */
export const ASPECT = (BOARD_WIDTH + 2 * (SLAB_MARGIN + SHADOW_MARGIN)) /
    (BOARD_HEIGHT + 2 * (SLAB_MARGIN + SHADOW_MARGIN));

/** Piece radius in board units, kept below the inscribed circle of a cell */
const PIECE_RADIUS = 0.74;

const ANIMATION_MS = 280;

export const PIECE_FONT = '"Noto Serif TC", "Noto Serif CJK TC", "Source Han Serif TC", "Songti TC", ' +
    '"PMingLiU", "AR PL UMing TW", serif';

const SIDE_INK = ['#a3261b', '#1f1914'];

export interface ViewState {
    board: Board;
    selected: number | null;
    /** Cells the selected piece may move to */
    destinations: ReadonlyArray<number>;
    hovered: number | null;
    lastMove: Move | null;
    /** The side whose general is in check */
    checked: Side | null;
}

interface Animation {
    move: Move;
    mover: Piece;
    captured: Piece | null;
    start: number;
}

/**
 * @param {number} t
 * @return {number} t eased out
 */
function easeOut(t: number) {
    return 1 - Math.pow(1 - t, 3);
}

export class BoardView {
    state: ViewState = {
        board: [], selected: null, destinations: [], hovered: null, lastMove: null, checked: null
    };

    private readonly context: CanvasRenderingContext2D;
    private width = 0;
    private height = 0;
    private pixelRatio = 1;
    private scale = 1;
    private flipped = false;
    private boardLayer: HTMLCanvasElement | null = null;
    private sprites = new Map<string, HTMLCanvasElement>();
    private shadowSprite: HTMLCanvasElement | null = null;
    private animation: Animation | null = null;
    private frame = 0;

    /**
     * @param {HTMLCanvasElement} canvas
     */
    constructor(private readonly canvas: HTMLCanvasElement) {
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas is not supported');
        this.context = context;
    }

    /**
     * Resize the canvas, keeping the board uniformly scaled
     * @param {number} width CSS pixels
     * @param {number} height CSS pixels
     */
    resize(width: number, height: number) {
        this.pixelRatio = window.devicePixelRatio || 1;
        this.width = width;
        this.height = height;
        const pad = 2 * (SLAB_MARGIN + SHADOW_MARGIN);
        this.scale = Math.min(width / (BOARD_WIDTH + pad), height / (BOARD_HEIGHT + pad));

        this.canvas.width = Math.round(width * this.pixelRatio);
        this.canvas.height = Math.round(height * this.pixelRatio);
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;

        this.invalidate();
        this.render();
    }

    /**
     * View the board with Black at the bottom
     * @param {boolean} flipped
     */
    setFlipped(flipped: boolean) {
        if (flipped === this.flipped) return;
        this.flipped = flipped;
        this.boardLayer = null;
        this.render();
    }

    /** Forget cached layers, call when the glyph font has loaded */
    invalidate() {
        this.boardLayer = null;
        this.shadowSprite = null;
        this.sprites.clear();
    }

    /**
     * Move a piece from its origin to its destination, purely visual
     * @param {Move} move
     * @param {Piece} mover
     * @param {Piece | null} captured
     */
    animateMove(move: Move, mover: Piece, captured: Piece | null) {
        this.animation = { move, mover, captured, start: performance.now() };
        this.render();
    }

    /**
     * @param {number} clientX
     * @param {number} clientY
     * @return {number | null} Cell under the position, null outside the playable cells
     */
    cellAtPoint(clientX: number, clientY: number) {
        const rect = this.canvas.getBoundingClientRect();
        const sign = this.flipped ? -1 : 1;
        const x = sign * (clientX - rect.left - this.width / 2) / this.scale;
        const y = sign * (clientY - rect.top - this.height / 2) / this.scale;

        let best: Cell | null = null;
        let bestDistance = Infinity;
        for (const cell of CELLS) {
            const distance = (cell.x - x) ** 2 + (cell.y - y) ** 2;
            if (distance < bestDistance) {
                bestDistance = distance;
                best = cell;
            }
        }
        if (!best) return null;

        // Inside the hexagon whose flat sides face up and down
        const dx = Math.abs(best.x - x);
        const dy = Math.abs(best.y - y);
        const inside = dy <= Math.sqrt(3) / 2 && dx + dy / Math.sqrt(3) <= 1;
        return inside ? best.id : null;
    }

    /**
     * @param {number} x Board unit
     * @param {number} y Board unit
     * @return {Array<number>} CSS pixel position
     */
    private toScreen(x: number, y: number) {
        const sign = this.flipped ? -1 : 1;
        return [this.width / 2 + sign * this.scale * x, this.height / 2 + sign * this.scale * y];
    }

    /**
     * @param {Cell} cell
     * @return {Array<number>} CSS pixel position of the cell center
     */
    private center(cell: Cell) {
        return this.toScreen(cell.x, cell.y);
    }

    /**
     * @param {Cell} cell
     * @param {number} inset 1 for the whole cell
     * @param {Path2D} path Path to add the hexagon to
     */
    private addHexagon(cell: Cell, inset: number, path: Path2D) {
        cellCorners(cell).forEach(([x, y], k) => {
            const [sx, sy] = this.toScreen(
                cell.x + (x - cell.x) * inset, cell.y + (y - cell.y) * inset);
            if (k === 0) path.moveTo(sx, sy);
            else path.lineTo(sx, sy);
        });
        path.closePath();
    }

    /** @return {HTMLCanvasElement} New canvas matching the main canvas, drawing in CSS pixels */
    private createLayer() {
        const layer = document.createElement('canvas');
        layer.width = this.canvas.width;
        layer.height = this.canvas.height;
        layer.getContext('2d')?.scale(this.pixelRatio, this.pixelRatio);
        return layer;
    }

    /** Paint the wooden slab, its engravings and markings */
    private buildBoardLayer() {
        const layer = this.createLayer();
        const ctx = layer.getContext('2d') as CanvasRenderingContext2D;
        const unit = this.scale;
        const margin = SLAB_MARGIN * unit;

        const cells = new Path2D();
        for (const cell of CELLS) this.addHexagon(cell, 1, cells);

        // Wood, cut to the playable cells grown by the margin, with rounded corners
        const mask = this.createLayer();
        const maskCtx = mask.getContext('2d') as CanvasRenderingContext2D;
        maskCtx.fillStyle = maskCtx.strokeStyle = '#000';
        maskCtx.lineJoin = 'round';
        maskCtx.lineWidth = 2 * margin;
        maskCtx.fill(cells);
        maskCtx.stroke(cells);

        const wood = this.createLayer();
        const woodCtx = wood.getContext('2d') as CanvasRenderingContext2D;
        this.paintWood(woodCtx);
        woodCtx.globalCompositeOperation = 'destination-in';
        woodCtx.setTransform(1, 0, 0, 1, 0, 0);
        woodCtx.drawImage(mask, 0, 0);

        ctx.save();
        ctx.shadowColor = 'rgba(30, 15, 5, 0.5)';
        ctx.shadowBlur = 0.4 * unit * this.pixelRatio;
        ctx.shadowOffsetY = 0.18 * unit * this.pixelRatio;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(wood, 0, 0);
        ctx.restore();

        // Beveled rim, lit from the top left
        const rim = this.createLayer();
        const rimCtx = rim.getContext('2d') as CanvasRenderingContext2D;
        rimCtx.fillStyle = rimCtx.strokeStyle = '#000';
        rimCtx.lineJoin = 'round';
        rimCtx.lineWidth = 2 * margin;
        rimCtx.fill(cells);
        rimCtx.stroke(cells);
        rimCtx.globalCompositeOperation = 'destination-out';
        rimCtx.lineWidth = 2 * (margin - 0.16 * unit);
        rimCtx.fill(cells);
        rimCtx.stroke(cells);
        rimCtx.globalCompositeOperation = 'source-in';
        const light = rimCtx.createLinearGradient(0, 0, this.width, this.height);
        light.addColorStop(0, 'rgba(255, 238, 200, 0.75)');
        light.addColorStop(0.5, 'rgba(120, 70, 25, 0.2)');
        light.addColorStop(1, 'rgba(45, 22, 6, 0.65)');
        rimCtx.fillStyle = light;
        rimCtx.fillRect(0, 0, this.width, this.height);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(rim, 0, 0);
        ctx.restore();

        this.paintEngravings(ctx, cells);
        this.boardLayer = layer;
    }

    /**
     * Honey colored maple with grain running along the board
     * @param {CanvasRenderingContext2D} ctx
     */
    private paintWood(ctx: CanvasRenderingContext2D) {
        const { width, height } = this;
        const base = ctx.createLinearGradient(0, 0, width, height);
        base.addColorStop(0, '#e8bf80');
        base.addColorStop(0.5, '#d9a965');
        base.addColorStop(1, '#c98f4d');
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, width, height);

        const rng = new Rng(79);

        // Broad bands of lighter and darker wood
        for (let band = 0; band < 46; band++) {
            const x = rng.range(-20, width);
            const w = rng.range(6, 60);
            ctx.fillStyle = rng.float() < 0.5 ?
                `rgba(120, 66, 20, ${rng.range(0.02, 0.07)})` :
                `rgba(255, 232, 180, ${rng.range(0.03, 0.09)})`;
            ctx.fillRect(x, 0, w, height);
        }

        // Fine fibres, wandering gently as they run down the board
        ctx.lineCap = 'round';
        for (let fibre = 0; fibre < 520; fibre++) {
            const x0 = rng.range(-10, width + 10);
            const dark = rng.float() < 0.7;
            const phase = rng.range(0, 1000);
            const amplitude = rng.range(6, 26);
            const lean = rng.range(-0.05, 0.05);

            ctx.strokeStyle = dark ?
                `rgba(105, 58, 18, ${rng.range(0.03, 0.17)})` :
                `rgba(255, 236, 190, ${rng.range(0.05, 0.14)})`;
            ctx.lineWidth = rng.range(0.4, 1.6) * Math.max(1, this.scale / 30);
            ctx.beginPath();
            for (let y = 0; y <= height; y += 14) {
                const wander = (valueNoise(x0 * 0.012 + phase, y * 0.006, 0.5) - 0.5) * 2 * amplitude;
                const x = x0 + wander + lean * y;
                if (y === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        // Pores
        for (let pore = 0; pore < 900; pore++) {
            ctx.fillStyle = `rgba(90, 48, 12, ${rng.range(0.05, 0.16)})`;
            ctx.fillRect(rng.range(0, width), rng.range(0, height), rng.range(0.6, 1.4), rng.range(3, 12));
        }

        // Darker toward the edges
        const vignette = ctx.createRadialGradient(
            width / 2, height / 2, Math.min(width, height) * 0.25,
            width / 2, height / 2, Math.max(width, height) * 0.7);
        vignette.addColorStop(0, 'rgba(60, 28, 6, 0)');
        vignette.addColorStop(1, 'rgba(60, 28, 6, 0.3)');
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, width, height);
    }

    /**
     * Cell grooves, the river inlay, palace inlays and calligraphy
     * @param {CanvasRenderingContext2D} ctx
     * @param {Path2D} cells Outline of every cell
     */
    private paintEngravings(ctx: CanvasRenderingContext2D, cells: Path2D) {
        const unit = this.scale;
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        // River, a slightly darker band of inlaid wood
        for (const cell of CELLS) {
            if (!cell.river) continue;
            const path = new Path2D();
            this.addHexagon(cell, 1, path);
            ctx.fillStyle = 'rgba(92, 50, 16, 0.2)';
            ctx.fill(path);

            const inner = new Path2D();
            this.addHexagon(cell, 0.8, inner);
            ctx.strokeStyle = 'rgba(70, 36, 8, 0.4)';
            ctx.lineWidth = Math.max(1, 0.025 * unit);
            ctx.stroke(inner);
        }

        // Palaces, tinted with an inlaid outline around the whole group
        for (const cell of CELLS) {
            if (cell.palace === null) continue;
            const path = new Path2D();
            this.addHexagon(cell, 1, path);
            ctx.fillStyle = 'rgba(130, 78, 26, 0.12)';
            ctx.fill(path);
        }
        const palaceEdges = new Path2D();
        const palaceInner = new Path2D();
        for (const cell of CELLS) {
            if (cell.palace === null) continue;
            const corners = cellCorners(cell);
            for (let k = 0; k < 6; k++) {
                const neighbor = cell.neighbors[k];
                if (neighbor >= 0 && CELLS[neighbor].palace === cell.palace) continue;

                // Outer edge, with a thinner line inset along it
                const [ax, ay] = this.toScreen(corners[k][0], corners[k][1]);
                const [bx, by] = this.toScreen(corners[(k + 1) % 6][0], corners[(k + 1) % 6][1]);
                palaceEdges.moveTo(ax, ay);
                palaceEdges.lineTo(bx, by);

                const [px, py] = this.center(cell);
                const pull = 0.14;
                palaceInner.moveTo(ax + (px - ax) * pull, ay + (py - ay) * pull);
                palaceInner.lineTo(bx + (px - bx) * pull, by + (py - by) * pull);
            }
        }
        ctx.strokeStyle = 'rgba(58, 28, 6, 0.78)';
        ctx.lineWidth = Math.max(1.5, 0.08 * unit);
        ctx.stroke(palaceEdges);
        ctx.strokeStyle = 'rgba(58, 28, 6, 0.45)';
        ctx.lineWidth = Math.max(1, 0.025 * unit);
        ctx.stroke(palaceInner);

        // Grooves between the cells, with a faint lit edge below and right
        ctx.save();
        ctx.translate(0.035 * unit, 0.045 * unit);
        ctx.strokeStyle = 'rgba(255, 236, 190, 0.38)';
        ctx.lineWidth = Math.max(1, 0.04 * unit);
        ctx.stroke(cells);
        ctx.restore();
        ctx.strokeStyle = 'rgba(62, 32, 8, 0.72)';
        ctx.lineWidth = Math.max(1, 0.04 * unit);
        ctx.stroke(cells);

        this.paintCalligraphy(ctx);
        ctx.restore();
    }

    /**
     * Engraved river text on the margins beside the river
     * @param {CanvasRenderingContext2D} ctx
     */
    private paintCalligraphy(ctx: CanvasRenderingContext2D) {
        const unit = this.scale;
        const size = 0.56 * unit;
        const columnX = (BOARD_WIDTH / 2 + SLAB_MARGIN * 0.5) * unit;

        ctx.font = `900 ${size}px ${PIECE_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const engrave = (text: string, x: number) => {
            [...text].forEach((glyph, i) => {
                const y = this.height / 2 + (i - 0.5) * size * 1.15;
                ctx.fillStyle = 'rgba(255, 236, 190, 0.45)';
                ctx.fillText(glyph, x + 0.7, y + 0.9);
                ctx.fillStyle = 'rgba(62, 32, 8, 0.6)';
                ctx.fillText(glyph, x, y);
            });
        };
        engrave('楚河', this.width / 2 - columnX);
        engrave('漢界', this.width / 2 + columnX);
    }

    /**
     * Turned wooden disc, without its shadow
     * @param {Piece} piece
     * @return {HTMLCanvasElement}
     */
    private getSprite(piece: Piece) {
        const key = `${piece.side}${piece.type}`;
        const cached = this.sprites.get(key);
        if (cached) return cached;

        const radius = PIECE_RADIUS * this.scale;
        const size = Math.ceil(radius * 2 + 6);
        const sprite = document.createElement('canvas');
        sprite.width = size * this.pixelRatio;
        sprite.height = size * this.pixelRatio;

        const ctx = sprite.getContext('2d') as CanvasRenderingContext2D;
        ctx.scale(this.pixelRatio, this.pixelRatio);
        ctx.translate(size / 2, size / 2);

        // Darker rim, lit from the top left
        const rim = ctx.createLinearGradient(-radius, -radius, radius, radius);
        rim.addColorStop(0, '#e2b777');
        rim.addColorStop(0.45, '#a9733a');
        rim.addColorStop(1, '#5e3714');
        ctx.fillStyle = rim;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();

        // Light wooden face
        const faceRadius = radius * 0.87;
        const face = ctx.createRadialGradient(-radius * 0.25, -radius * 0.3, radius * 0.1, 0, 0, faceRadius);
        face.addColorStop(0, '#f8e6bd');
        face.addColorStop(0.7, '#ecd09b');
        face.addColorStop(1, '#d8b479');
        ctx.fillStyle = face;
        ctx.beginPath();
        ctx.arc(0, 0, faceRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, faceRadius, 0, Math.PI * 2);
        ctx.clip();

        // Concentric grain, off center like turned wood
        const rng = new Rng(piece.side * 7 + piece.type.length * 131 + piece.type.charCodeAt(0));
        const grainX = rng.range(-0.25, 0.25) * radius;
        const grainY = rng.range(-0.25, 0.25) * radius;
        for (let ring = 1; ring <= 11; ring++) {
            ctx.strokeStyle = `rgba(120, 76, 28, ${rng.range(0.06, 0.16)})`;
            ctx.lineWidth = rng.range(0.4, 1.1);
            ctx.beginPath();
            ctx.arc(grainX, grainY, faceRadius * ring / 9, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Inner shadow along the rim
        const inner = ctx.createRadialGradient(0, 0, faceRadius * 0.7, 0, 0, faceRadius);
        inner.addColorStop(0, 'rgba(70, 38, 10, 0)');
        inner.addColorStop(1, 'rgba(70, 38, 10, 0.4)');
        ctx.fillStyle = inner;
        ctx.fillRect(-radius, -radius, radius * 2, radius * 2);

        // Warm highlight
        const shine = ctx.createRadialGradient(-radius * 0.38, -radius * 0.45, 0, -radius * 0.38, -radius * 0.45, radius * 0.6);
        shine.addColorStop(0, 'rgba(255, 250, 230, 0.55)');
        shine.addColorStop(1, 'rgba(255, 250, 230, 0)');
        ctx.fillStyle = shine;
        ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
        ctx.restore();

        // Engraved ring and character
        const ink = SIDE_INK[piece.side];
        ctx.strokeStyle = ink;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = Math.max(1, radius * 0.045);
        ctx.beginPath();
        ctx.arc(0, 0, faceRadius * 0.86, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.font = `900 ${radius * 1.08}px ${PIECE_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const glyph = GLYPHS[piece.type][piece.side];
        const offset = radius * 0.04;
        const lift = radius * 0.04; // Glyphs sit a little low in most fonts
        ctx.fillStyle = 'rgba(255, 245, 215, 0.7)';
        ctx.fillText(glyph, offset, offset + lift);
        ctx.fillStyle = 'rgba(40, 18, 4, 0.45)';
        ctx.fillText(glyph, -offset * 0.6, -offset * 0.6 + lift);
        ctx.fillStyle = ink;
        ctx.fillText(glyph, 0, lift);

        this.sprites.set(key, sprite);
        return sprite;
    }

    /** @return {HTMLCanvasElement} Soft round contact shadow */
    private getShadow() {
        if (this.shadowSprite) return this.shadowSprite;

        const radius = PIECE_RADIUS * this.scale * 1.3;
        const size = Math.ceil(radius * 2);
        const shadow = document.createElement('canvas');
        shadow.width = size * this.pixelRatio;
        shadow.height = size * this.pixelRatio;

        const ctx = shadow.getContext('2d') as CanvasRenderingContext2D;
        ctx.scale(this.pixelRatio, this.pixelRatio);
        const gradient = ctx.createRadialGradient(size / 2, size / 2, radius * 0.55, size / 2, size / 2, radius);
        gradient.addColorStop(0, 'rgba(25, 10, 0, 0.55)');
        gradient.addColorStop(1, 'rgba(25, 10, 0, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);

        this.shadowSprite = shadow;
        return shadow;
    }

    /**
     * @param {Piece} piece
     * @param {number} x CSS pixel center
     * @param {number} y CSS pixel center
     * @param {number} lift 0 to 1, how far the piece is raised off the board
     * @param {number} alpha
     */
    private drawPiece(piece: Piece, x: number, y: number, lift: number, alpha = 1) {
        const ctx = this.context;
        const radius = PIECE_RADIUS * this.scale;
        const shadow = this.getShadow();
        const sprite = this.getSprite(piece);

        ctx.globalAlpha = alpha;
        const shadowSize = shadow.width / this.pixelRatio;
        const shadowShift = radius * (0.1 + 0.22 * lift);
        ctx.drawImage(shadow, x - shadowSize / 2 + shadowShift * 0.5, y - shadowSize / 2 + shadowShift,
            shadowSize, shadowSize);

        const spriteSize = sprite.width / this.pixelRatio;
        const raised = radius * 0.1 * lift;
        ctx.drawImage(sprite, x - spriteSize / 2, y - spriteSize / 2 - raised, spriteSize, spriteSize);
        ctx.globalAlpha = 1;
    }

    /** Redraw everything, and keep redrawing while a move is animating */
    render() {
        if (!this.width) return;

        const ctx = this.context;
        const dpr = this.pixelRatio;
        if (!this.boardLayer) this.buildBoardLayer();

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.drawImage(this.boardLayer as HTMLCanvasElement, 0, 0);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const { board, selected, destinations, hovered, lastMove, checked } = this.state;
        const unit = this.scale;

        // Previous move, a honey tint on the origin and destination
        if (lastMove)
            for (const id of [lastMove.from, lastMove.to]) {
                const path = new Path2D();
                this.addHexagon(CELLS[id], 0.97, path);
                ctx.fillStyle = 'rgba(255, 196, 70, 0.32)';
                ctx.fill(path);
            }

        // Hovered cell the selected piece can reach
        if (hovered !== null && destinations.includes(hovered)) {
            const path = new Path2D();
            this.addHexagon(CELLS[hovered], 0.97, path);
            ctx.fillStyle = 'rgba(255, 170, 40, 0.22)';
            ctx.fill(path);
        }

        // Underglow beneath a general in check
        if (checked !== null) {
            const general = board.findIndex(piece => piece?.type === 'general' && piece.side === checked);
            if (general >= 0) {
                const [x, y] = this.center(CELLS[general]);
                const glow = ctx.createRadialGradient(x, y, unit * 0.4, x, y, unit * 1.25);
                glow.addColorStop(0, 'rgba(210, 30, 20, 0.7)');
                glow.addColorStop(1, 'rgba(210, 30, 20, 0)');
                ctx.fillStyle = glow;
                ctx.beginPath();
                ctx.arc(x, y, unit * 1.25, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Empty destinations, marked in the center of the cell
        for (const id of destinations) {
            if (board[id]) continue;
            const [x, y] = this.center(CELLS[id]);
            ctx.fillStyle = 'rgba(255, 170, 40, 0.62)';
            ctx.strokeStyle = 'rgba(120, 66, 8, 0.7)';
            ctx.lineWidth = Math.max(1, 0.03 * unit);
            ctx.beginPath();
            ctx.arc(x, y, 0.2 * unit, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }

        // Pieces, with the moving one drawn between its origin and destination
        const now = performance.now();
        let progress = 1;
        const animation = this.animation;
        if (animation) {
            progress = Math.min(1, (now - animation.start) / ANIMATION_MS);
            if (progress >= 1) this.animation = null;
        }
        const moving = this.animation;

        for (let id = 0; id < board.length; id++) {
            const piece = board[id];
            if (!piece || (moving && id === moving.move.to)) continue;

            const [x, y] = this.center(CELLS[id]);
            this.drawPiece(piece, x, y, id === selected ? 1 : 0);
        }

        if (moving) {
            const eased = easeOut(progress);
            const [fromX, fromY] = this.center(CELLS[moving.move.from]);
            const [toX, toY] = this.center(CELLS[moving.move.to]);

            if (moving.captured) {
                const fade = Math.max(0, (progress - 0.6) / 0.4);
                this.drawPiece(moving.captured, toX, toY, 0, 1 - fade);
            }
            this.drawPiece(moving.mover, fromX + (toX - fromX) * eased, fromY + (toY - fromY) * eased,
                Math.sin(Math.PI * progress));
        }

        // Selected piece outline
        if (selected !== null && board[selected] && !moving) {
            const [x, y] = this.center(CELLS[selected]);
            ctx.strokeStyle = 'rgba(255, 190, 70, 0.95)';
            ctx.shadowColor = 'rgba(255, 170, 40, 0.8)';
            ctx.shadowBlur = 0.2 * unit;
            ctx.lineWidth = Math.max(2, 0.07 * unit);
            ctx.beginPath();
            ctx.arc(x, y - PIECE_RADIUS * unit * 0.1, PIECE_RADIUS * unit * 1.04, 0, Math.PI * 2);
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        // Pieces that can be captured, ringed in burgundy and gold
        for (const id of destinations) {
            if (!board[id] || moving) continue;
            const [x, y] = this.center(CELLS[id]);
            const path = new Path2D();
            this.addHexagon(CELLS[id], 0.97, path);
            ctx.fillStyle = 'rgba(122, 28, 40, 0.14)';
            ctx.fill(path);

            ctx.strokeStyle = 'rgba(122, 28, 40, 0.92)';
            ctx.lineWidth = Math.max(2, 0.1 * unit);
            ctx.beginPath();
            ctx.arc(x, y, PIECE_RADIUS * unit * 1.12, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(232, 183, 58, 0.95)';
            ctx.lineWidth = Math.max(1, 0.04 * unit);
            ctx.beginPath();
            ctx.arc(x, y, PIECE_RADIUS * unit * 1.12, 0, Math.PI * 2);
            ctx.stroke();
        }

        if (this.animation) {
            cancelAnimationFrame(this.frame);
            this.frame = requestAnimationFrame(() => this.render());
        }
    }
}
