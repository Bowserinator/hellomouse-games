import { CELL_SIZE, WALL_THICKNESS } from '../vars.js';
import Camera from './camera.js';
import Vector from '../tanks/vector2d.js';
import Wall from '../tanks/wall.js';

/**
 * Draw walls of the maze
 * @param {Array<Wall>} walls Array of walls of the maze
 * @param {number} width Width of maze in cells
 * @param {number} height Height of maze in cells
 * @return {HTMLCanvasElement}
 */
export function generateMazeImage(walls: Array<Wall>, width: number, height: number) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const camera = new Camera(new Vector(0, 0), ctx);

    canvas.width = CELL_SIZE * width + WALL_THICKNESS;
    canvas.height = CELL_SIZE * height + WALL_THICKNESS;

    walls.forEach((wall: Wall) => wall.draw(camera));
    return canvas;
}

// /**
//  * Draw shadow of the maze
//  * @param {Array<Wall>} walls Array of walls of the maze
//  * @param {number} width Width of maze in cells
//  * @param {number} height Height of maze in cells
//  * @return {HTMLCanvasElement}
//  */
// export function generateMazeShadowImage(walls: Array<Wall>, width: number, height: number) {
//     const canvas = document.createElement('canvas');
//     const ctx = canvas.getContext('2d');
//     if (!ctx) return;
//     const camera = new Camera(new Vector(0, 0), ctx);

//     canvas.width = CELL_SIZE * width + WALL_THICKNESS + SHADOW_SIZE_X;
//     canvas.height = CELL_SIZE * height + WALL_THICKNESS + SHADOW_SIZE_Y;

//     walls.forEach((wall: Wall) => wall.drawShadow(camera));
//     return canvas;
// }
