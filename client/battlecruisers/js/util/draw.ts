
export function drawLine(ctx: CanvasRenderingContext2D, p1: [number, number], p2: [number, number], color: string) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.moveTo(...p1);
    ctx.lineTo(...p2);
    ctx.stroke();
}


export function drawRectangle(ctx: CanvasRenderingContext2D,
    pos: [number, number], size: [number, number], color: string) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.rect(...pos, ...size);
    ctx.stroke();
}


export function fillRectangle(ctx: CanvasRenderingContext2D,
    pos: [number, number], size: [number, number], color: string) {
    ctx.fillStyle = color;
    ctx.fillRect(...pos, ...size);
}



export function drawCircle(ctx: CanvasRenderingContext2D, center: [number, number], radius: number, color: string) {
    ctx.beginPath();
    ctx.arc(...center, radius, 0, 2 * Math.PI, false);
    ctx.strokeStyle = color;
    ctx.stroke();
}


export function fillCircle(ctx: CanvasRenderingContext2D, center: [number, number], radius: number, color: string) {
    ctx.beginPath();
    ctx.arc(...center, radius, 0, 2 * Math.PI, false);
    ctx.fillStyle = color;
    ctx.fill();
}
