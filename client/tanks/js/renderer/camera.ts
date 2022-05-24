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
     * Render a perspective aligned rectangle
     * @param {[number, number, number]} position World location to draw this rectangle (top-left corner)
     * @param {[number, number, number]} size Size of rectangle
     * @param {number} layers Number of layers to draw, set to -1 to equal height (maxes out at height of prism)
     * @param {[number, number, number]} color RGB color
     * @param {number} darken Float 0-1, 0 = bottom becomes black, 1 = uniform color
     */
    drawRectangularPrism(
        position: [number, number, number],
        size: [number, number, number],
        layers: number, color: [number, number, number], darken: number) {
        // Determine if rectangle is offscreen

        // Draw based on camera position
        let ctx = this.ctx;

        const FOV = 0.0005; // TODO

        for (let layer = position[2];
            layer < position[2] + size[2];
            layer += Math.max(1, Math.round(size[2] / layers))) {
            let correctedPos = [position[0] + size[0] / 2, position[1] + size[1] / 2];
            let offsetX = -layer * this.position.x - correctedPos[0];
            let offsetY = -layer * this.position.y - correctedPos[1];

            let d = (layer - position[2]) / size[2];
            d = (1 - darken) * d + darken;

            ctx.fillStyle = `rgb(${color[0] * d}, ${color[1] * d}, ${color[2] * d})`;
            ctx.fillRect(
                position[0] - this.position.x - offsetX * FOV,
                position[1] - this.position.y - offsetY * FOV - layer,
                size[0], size[1]);
        }
    }
}
