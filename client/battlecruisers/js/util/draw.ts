/**
 * Draw a line
 * @param ctx CTX
 * @param p1 Point 1
 * @param p2 Point 2
 * @param color Color
 */
export function drawLine(ctx: CanvasRenderingContext2D, p1: [number, number], p2: [number, number], color: string) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.moveTo(...p1);
    ctx.lineTo(...p2);
    ctx.stroke();
}

/**
 * Stroke a rectangle
 * @param ctx CTX
 * @param pos Top left corner
 * @param size [w, h]
 * @param color Color
 */
export function drawRectangle(ctx: CanvasRenderingContext2D,
    pos: [number, number], size: [number, number], color: string) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.rect(...pos, ...size);
    ctx.stroke();
}

/**
 * Fill a rectangle
 * @param ctx CTX
 * @param pos Top left corner
 * @param size [w, h]
 * @param color Color
 */
export function fillRectangle(ctx: CanvasRenderingContext2D,
    pos: [number, number], size: [number, number], color: string) {
    ctx.fillStyle = color;
    ctx.fillRect(...pos, ...size);
}

/**
 * Stroke a circle
 * @param ctx CTX
 * @param center Circle center
 * @param radius Radius
 * @param color Color
 */
export function drawCircle(ctx: CanvasRenderingContext2D, center: [number, number], radius: number, color: string) {
    ctx.beginPath();
    ctx.arc(...center, radius, 0, 2 * Math.PI, false);
    ctx.strokeStyle = color;
    ctx.stroke();
}

/**
 * Fill a circle
 * @param ctx CTX
 * @param center Circle center
 * @param radius Radius
 * @param color Color
 */
export function fillCircle(ctx: CanvasRenderingContext2D, center: [number, number], radius: number, color: string) {
    ctx.beginPath();
    ctx.arc(...center, radius, 0, 2 * Math.PI, false);
    ctx.fillStyle = color;
    ctx.fill();
}
