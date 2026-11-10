/** Canvas rendering of the stock price chart and the player score chart over a one-day scrolling window. */
import { GAME_CONFIG, STOCK_COLORS } from './config.js';
import { formatCompactMoney } from './format.js';
import { valueAt, visiblePoints } from './series.js';

export interface ChartModel {
    prices: Array<Array<number>>;
    worth: Array<Array<number>>;
    tickers: Array<string>;
    names: Array<string>;
    playerColors: Array<string>;
    youSeat: number;
    visible: number;
    scrollLeft: number;
}

interface Series {
    values: Array<number>;
    color: string;
    label: string;
    width: number;
}

interface Panel {
    title: string;
    top: number;
    bottom: number;
    series: Array<Series>;
    format: (value: number) => string;
}

interface Frame {
    ctx: CanvasRenderingContext2D;
    left: number;
    right: number;
    visible: number;
    leftTick: number;
    rightTick: number;
    xOf: (tick: number) => number;
}

const BACKGROUND = '#000';
const MUTED = '#9a9a9a';
const AMBER = '#ffa028';
const TAG_TEXT = '#000';
const DAY_LINE = 'rgba(255, 255, 255, 0.5)';
const HOUR_LINE = 'rgba(255, 255, 255, 0.22)';
const DIVIDER_COLOR = '#fff';
const GRID_LINE = 'rgba(255, 255, 255, 0.16)';
const FONT = '600 11px "DejaVu Sans Mono", Consolas, Menlo, monospace';
const PADDING = { left: 56, right: 78, top: 26, bottom: 22 };
const PANEL_GAP = 38;
const PRICE_PANEL_SHARE = 0.58;
const GRID_LINES = 3;
const LABEL_GAP = 16;
const STOCK_LINE_WIDTH = 2;
const RIVAL_LINE_WIDTH = 1.5;
const YOU_LINE_WIDTH = 2.5;
const STATION_RADIUS = 3.5;
const RANGE_MARGIN = 0.03;
const CLIP_ALLOWANCE = 4;
const AXIS_OFFSET = 8;
const TAG_OFFSET = 6;
const TAG_PADDING = 4;
const TAG_HEIGHT = 14;
const DAY_LABEL_OFFSET = 6;
const DAY_LABEL_WIDTH = 56;
const GRID_DASH = [2, 4];
const DIVIDER_WIDTH = 2;
const DIVIDER_OFFSET = 10;

function plotWidth(canvasWidth: number): number {
    return Math.max(1, canvasWidth - PADDING.left - PADDING.right);
}

export function dayWidth(canvasWidth: number): number {
    return plotWidth(canvasWidth) / GAME_CONFIG.visibleDays;
}

export function followScroll(canvasWidth: number, visible: number): number {
    const hiddenDays = visible / GAME_CONFIG.ticksPerRound - GAME_CONFIG.visibleDays;
    return Math.max(0, hiddenDays * dayWidth(canvasWidth));
}

function spreadLabels(positions: Array<number>, top: number, bottom: number): Array<number> {
    const order = positions.map((_, index) => index).sort((a, b) => positions[a] - positions[b]);
    const spread = new Array<number>(positions.length);
    let previous = top - LABEL_GAP;
    for (const index of order) {
        previous = Math.max(positions[index], previous + LABEL_GAP);
        spread[index] = previous;
    }
    let limit = bottom;
    for (const index of [...order].reverse()) {
        limit = Math.min(spread[index], limit);
        spread[index] = limit;
        limit -= LABEL_GAP;
    }
    return spread;
}

function drawTag(ctx: CanvasRenderingContext2D, text: string, color: string, x: number, y: number): void {
    ctx.fillStyle = color;
    ctx.fillRect(x, y - TAG_HEIGHT / 2, ctx.measureText(text).width + TAG_PADDING * 2, TAG_HEIGHT);
    ctx.fillStyle = TAG_TEXT;
    ctx.fillText(text, x + TAG_PADDING, y);
}

function drawPanel(frame: Frame, panel: Panel): void {
    const { ctx, left, right, xOf } = frame;
    const paths = panel.series.map(series => visiblePoints(series.values, frame.visible));
    const values = paths.flatMap(points => points.map(point => point[1]));
    let low = Math.min(...values);
    let high = Math.max(...values);
    if (high - low < 1e-9) {
        low -= 1;
        high += 1;
    }
    const margin = (high - low) * RANGE_MARGIN;
    low -= margin;
    high += margin;
    const yOf = (value: number): number =>
        panel.bottom - (value - low) / (high - low) * (panel.bottom - panel.top);

    ctx.fillStyle = AMBER;
    ctx.textAlign = 'left';
    ctx.fillText(panel.title, left, panel.top - AXIS_OFFSET - LABEL_GAP / 2);
    ctx.textAlign = 'right';
    ctx.setLineDash(GRID_DASH);
    for (let line = 0; line < GRID_LINES; line++) {
        const value = low + (high - low) * line / (GRID_LINES - 1);
        const y = yOf(value);
        ctx.strokeStyle = GRID_LINE;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        ctx.fillStyle = MUTED;
        ctx.fillText(panel.format(value), left - AXIS_OFFSET, y);
    }
    ctx.setLineDash([]);

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, panel.top - CLIP_ALLOWANCE, right - left, panel.bottom - panel.top + CLIP_ALLOWANCE * 2);
    ctx.clip();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    panel.series.forEach((series, index) => {
        ctx.strokeStyle = series.color;
        ctx.lineWidth = series.width;
        ctx.beginPath();
        paths[index].forEach(([tick, value], step) => {
            if (step === 0) ctx.moveTo(xOf(tick), yOf(value));
            else ctx.lineTo(xOf(tick), yOf(value));
        });
        ctx.stroke();
    });
    ctx.restore();

    const labelTick = Math.min(frame.visible, frame.rightTick);
    const labelY = spreadLabels(panel.series.map(series =>
        yOf(valueAt(series.values, labelTick))), panel.top, panel.bottom);
    ctx.textAlign = 'left';
    panel.series.forEach((series, index) => {
        const head = paths[index][paths[index].length - 1];
        const x = xOf(head[0]);
        if (x >= left && x <= right) {
            ctx.fillStyle = series.color;
            ctx.beginPath();
            ctx.arc(x, yOf(head[1]), STATION_RADIUS, 0, Math.PI * 2);
            ctx.fill();
        }
        drawTag(ctx, series.label, series.color, xOf(labelTick) + TAG_OFFSET, labelY[index]);
    });
}

function drawTimeLines(frame: Frame, top: number, bottom: number, labelY: number): void {
    const { ctx, left, right, xOf } = frame;
    const ticksPerDay = GAME_CONFIG.ticksPerRound;
    const firstTick = Math.max(0, Math.floor(frame.leftTick));
    const lastTick = Math.min(Math.ceil(frame.rightTick), Math.ceil(frame.visible));
    const line = (tick: number): void => {
        const x = xOf(tick);
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
    };

    ctx.lineWidth = 1;
    ctx.strokeStyle = HOUR_LINE;
    for (let tick = firstTick; tick <= lastTick; tick++)
        if (tick % GAME_CONFIG.hoursPerDivider === 0 && tick % ticksPerDay !== 0) line(tick);

    ctx.strokeStyle = DAY_LINE;
    ctx.fillStyle = MUTED;
    ctx.textAlign = 'left';
    for (let day = Math.floor(firstTick / ticksPerDay); day * ticksPerDay <= lastTick; day++) {
        const x = xOf(day * ticksPerDay);
        if (x >= left - 1 && x <= right + 1) line(day * ticksPerDay);
        const labelX = Math.max(x, left) + DAY_LABEL_OFFSET;
        const nextX = xOf((day + 1) * ticksPerDay);
        if (labelX < right - DAY_LABEL_WIDTH && nextX > left + DAY_LABEL_WIDTH) ctx.fillText(`DAY ${day + 1}`, labelX, labelY);
    }
}

export function drawChart(canvas: HTMLCanvasElement, model: ChartModel): void {
    const scale = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * scale) || canvas.height !== Math.round(height * scale)) {
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
    }
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, width, height);
    ctx.font = FONT;
    ctx.textBaseline = 'middle';

    const left = PADDING.left;
    const right = width - PADDING.right;
    if (right <= left) return;
    const plot = plotWidth(width);
    const dayPixels = dayWidth(width);
    const ticksPerDay = GAME_CONFIG.ticksPerRound;
    const frame: Frame = {
        ctx, left, right, visible: model.visible,
        leftTick: model.scrollLeft / dayPixels * ticksPerDay,
        rightTick: (model.scrollLeft + plot) / dayPixels * ticksPerDay,
        xOf: tick => left + tick / ticksPerDay * dayPixels - model.scrollLeft
    };

    const usable = height - PADDING.top - PADDING.bottom - PANEL_GAP;
    const priceBottom = PADDING.top + usable * PRICE_PANEL_SHARE;
    const scoreTop = priceBottom + PANEL_GAP;
    const scoreBottom = height - PADDING.bottom;
    drawTimeLines(frame, PADDING.top, scoreBottom, height - PADDING.bottom / 2);
    ctx.strokeStyle = DIVIDER_COLOR;
    ctx.lineWidth = DIVIDER_WIDTH;
    ctx.beginPath();
    ctx.moveTo(0, priceBottom + DIVIDER_OFFSET);
    ctx.lineTo(width, priceBottom + DIVIDER_OFFSET);
    ctx.stroke();

    const seats = model.worth.map((_, seat) => seat).sort((a, b) =>
        Number(a === model.youSeat) - Number(b === model.youSeat));
    drawPanel(frame, {
        title: 'PRICE',
        top: PADDING.top,
        bottom: priceBottom,
        format: value => value.toFixed(0),
        series: model.prices.map((values, index) => ({
            values, color: STOCK_COLORS[index], label: model.tickers[index], width: STOCK_LINE_WIDTH
        }))
    });
    drawPanel(frame, {
        title: 'SCORE',
        top: scoreTop,
        bottom: scoreBottom,
        format: formatCompactMoney,
        series: seats.map(seat => ({
            values: model.worth[seat],
            color: model.playerColors[seat],
            label: model.names[seat],
            width: seat === model.youSeat ? YOU_LINE_WIDTH : RIVAL_LINE_WIDTH
        }))
    });
}
