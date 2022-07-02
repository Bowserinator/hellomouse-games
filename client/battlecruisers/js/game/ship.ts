import { ROTATION } from '../types.js';
import { drawLine } from '../util/draw.js';

interface ShipConfig {
    shape: Array<Array<number>>;
    cwis: number; // CWIS range
    aa: number;   // Anti-air range
    abilities: Array<any>; // TODO
}

export class AbstractShip {
    name: string;
    config: ShipConfig;
    position: [number, number];
    size: [number, number];
    rotation: ROTATION;
    shape: Array<Array<number>>;

    /**
     * Construct a ship (abstract)
     * @param name Name of the ship
     * @param position Position (grid coord, [0, 0] = top left)
     * @param rotation Rotation of placement
     * @param config Config of ship
     */
    constructor(name: string, position: [number, number], rotation: ROTATION, config: ShipConfig) {
        if (this.constructor === AbstractShip)
            throw new Error('Can\'t instantiate abstract class!');

        this.name = name;
        this.position = position;
        this.rotation = rotation;
        this.config = config;

        this.shape = config.shape.map(row => [...row]);
        for (let i = 0; i < rotation; i++)
            this.shape = this.shape[0].map((val, index) => this.shape.map(row => row[index]).reverse());
        this.size = [this.shape[0].length, this.shape.length];
    }

    /**
     * Check if a coordinate lands on this ship
     * @param x x coordinate
     * @param y y coordinate
     * @returns Coordinate lands on ship?
     */
    checkSpot(x: number, y: number) {
        // Not in bounding box
        if (x < this.position[0] || y < this.position[0] ||
            x >= this.position[0] + this.size[0] || y >= this.position[1] + this.size[1])
            return false;
        return this.shape[y - this.position[1]][x - this.position[0]] !== 0;
    }

    /**
     * Draw the ship bounding box
     * @param ctx CTX
     * @param offset Offset (top left corner) for the grid
     * @param gridSize Grid cell size
     */
    draw(ctx: CanvasRenderingContext2D, offset: [number, number], gridSize: number) {
        // Draw the ship bounding box
        const shouldPlaceEdge = (x: number, y: number) => {
            if (!this.shape[y]) return true;
            if (!this.shape[y][x]) return true;
            return false;
        };

        for (let dy = 0; dy < this.size[1]; dy++)
            for (let dx = 0; dx < this.size[0]; dx++) {
                if (this.shape[dy][dx] === 0) continue;

                const tx = offset[0] + (this.position[0] + dx) * gridSize;
                const ty = offset[1] + (this.position[1] + dy) * gridSize;

                if (shouldPlaceEdge(dx, dy - 1)) // Top
                    drawLine(ctx, [tx, ty], [tx + gridSize, ty], 'red');
                if (shouldPlaceEdge(dx, dy + 1)) // Bottom
                    drawLine(ctx, [tx, ty + gridSize], [tx + gridSize, ty + gridSize], 'red');
                if (shouldPlaceEdge(dx - 1, dy)) // Left
                    drawLine(ctx, [tx, ty], [tx, ty + gridSize], 'red');
                if (shouldPlaceEdge(dx + 1, dy)) // Right
                    drawLine(ctx, [tx + gridSize, ty], [tx + gridSize, ty + gridSize], 'red');
            }
    }

    onHit() {

    }
}
