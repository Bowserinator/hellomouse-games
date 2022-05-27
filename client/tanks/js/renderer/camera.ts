import Vector from '../tanks/vector2d.js';

export default class Camera {
    position: Vector;
    ctx: CanvasRenderingContext2D;

    /**
     * Construct a new camera, which can draw stuff with a global offset
     * @param {Vector} position Where the camera is centered
     * @param {CanvasRenderingContext2D} ctx ctx to draw to
     */
    constructor(position: Vector, ctx: CanvasRenderingContext2D) {
        // Where the camera is centered
        this.position = position;
        this.ctx = ctx;
    }

    /**
     * Transform world coordinates to screen coordinates
     * @param {number} x World x
     * @param {number} y World y
     * @return {[number, number]} [screen x, screen y]
     */
    worldToScreen(x: number, y: number): [number, number] {
        return [
            x - this.position.x,
            y - this.position.y
        ];
    }

    /**
     * Render an image with given world coordinates
     * @param {HTMLCanvasElement | CanvasImageSource | null} img If null ignored
     * @param {number} x Top left corner x
     * @param {number} y Top left corner y
     */
    drawImage(img: HTMLCanvasElement | CanvasImageSource | null, x: number, y: number) {
        if (img === null) return;
        [x, y] = this.worldToScreen(x, y);
        this.ctx.drawImage(img, x, y);
    }

    /**
     * Render an image with given world coordinates with rotation
     * @param {HTMLCanvasElement | CanvasImageSource | null} img If null ignored
     * @param {number} x Center x
     * @param {number} y Center y
     * @param {rotation} rotation Rotation CCW in radians
     */
    drawImageRotated(img: HTMLCanvasElement | CanvasImageSource | null,
        x: number, y: number, rotation: number) {
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

    /**
     * Fill a rectangle at a given world location
     * @param {[number, number]} position [x, y] top-left
     * @param {[number, number]} size [w, h]
     * @param {string} color Color to fill
     */
    fillRect(position: [number, number], size: [number, number], color: string) {
        let ctx = this.ctx;
        position = this.worldToScreen(...position);

        ctx.fillStyle = color;
        ctx.fillRect(position[0], position[1], size[0], size[1]);
    }

    /**
     * Fill a circle at given world location
     * @param {[number, number]} position [x, y] center
     * @param {number} radius Radius of circle (px)
     * @param {string} color Color to fill
     */
    fillCircle(position: [number, number], radius: number, color: string) {
        let ctx = this.ctx;
        position = this.worldToScreen(...position);

        ctx.beginPath();
        ctx.arc(position[0], position[1], radius, 0, 2 * Math.PI, false);
        ctx.fillStyle = color;
        ctx.fill();
    }
}
