
export function drawLine(ctx: CanvasRenderingContext2D, p1: [number, number], p2: [number, number], color: string) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.moveTo(...p1);
    ctx.lineTo(...p2);
    ctx.stroke();
}
