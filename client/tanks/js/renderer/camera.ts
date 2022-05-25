import Vector from '../tanks/vector2d.js';

export default class Camera {
    constructor(position: Vector, ctx: CanvasRenderingContext2D) {
        // Where the camera is centered
        this.position = position;
        this.ctx = ctx;
    }

    render() {

    }

    /**
     * Transform world coordinates to screen coordinates
     * @param {number} x World x
     * @param {number} y World y
     * @return {[number, number]} [screen x, screen y]
     */
    worldToScreen(x: number, y: number) {
        return [
            x - this.position.x,
            y - this.position.y
        ];
    }

    /**
     * Render an image with given world coordinates
     * @param {HTMLCanvasElement | Image | null} img If null ignored
     * @param {number} x Top left corner x
     * @param {number} y Top left corner y
     */
    drawImage(img: HTMLCanvasElement | Image | null, x: number, y: number) {
        if (img === null) return;
        [x, y] = this.worldToScreen(x, y);
        this.ctx.drawImage(img, x, y);
    }

    /**
     * Render an image with given world coordinates with rotation
     * @param {HTMLCanvasElement | Image | null} img If null ignored
     * @param {number} x Center x
     * @param {number} y Center y
     * @param {rotation} rotation Rotation CCW in radians
     */
    drawImageRotated(img: HTMLCanvasElement | Image | null, x: number, y: number, rotation: number) {
        if (img === null) return;

        [x, y] = this.worldToScreen(x, y);
        this.ctx.setTransform(1, 0, 0, 1, x, y); // Sets scale=1 and origin
        this.ctx.rotate(rotation);
        this.ctx.drawImage(img, -img.width / 2, -img.height / 2);
        this.ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
    }

    /**
     * Stroke a rectangle at a given world location
     * @param {[number, number]} position [x, y] top-left
     * @param {[number, number]} size [w, h]
     * @param {string} color Color to stroke
     */
    drawRect(position: [number, number], size: [number, number], color: string) {
        let ctx = this.ctx;
        position = this.worldToScreen(...position);

        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.rect(position[0], position[1], size[0], size[1]);
        ctx.stroke();
    }
}
