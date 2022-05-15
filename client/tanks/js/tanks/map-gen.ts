import Wall from './wall.js';
import Vector from './vector2d.js';

const CELL_SIZE = 120;
const MIN_GAP_SIZE = 1; // In cells
const WALL_THICKNESS = 10;

const BWIDTH = 16;
const BHEIGHT = 8;

function makeWall(a, b) {
    return new Wall(new Vector(a[0], a[1]), new Vector(b[0], b[1]));
}

function mazeGen(size) {
    size = size.map(Math.floor);
    // returns grid
    let maze = {
        horizontal: [],
        vertical: [] //x1 y1 x2 y2
    }
    let maxDepth = Math.floor(Math.random() * 3) + 3;
    
    function step(maze, corner, size, depth=0) {
        if (depth > maxDepth) return;

        corner = corner.map(Math.floor);
        size = size.map(Math.floor);

        let horizontal = size[1] > size[0];
        let grid = maze;

        if (horizontal) {
            // Add 2 horizontal lines
            let y = Math.floor(corner[1] + size[1] / 2);
            let start = corner[0] + Math.floor(Math.random() * size[0]);
            maze.horizontal.push([corner[0], y, start, y]);
            maze.horizontal.push([start + 1, y, corner[0] + size[0], y]);

            // Recursion
            
            step(grid, corner, [size[0], size[1] / 2], depth + 1);
            step(grid, [corner[0], corner[1] + size[1] / 2], [size[0], size[1] / 2], depth + 1);
        }
        else {
            // Add 2 vertical lines
            let x = Math.floor(corner[0] + size[0] / 2);
            let start = corner[1] + Math.floor(Math.random() * size[1]);
            maze.vertical.push([x, corner[1], x, start]);
            maze.vertical.push([x, start + 1, x, corner[1] + size[1]]);

            // Recursion
            step(grid, corner, [size[0] / 2, size[1]], depth + 1);
            step(grid, [corner[0] + size[0] / 2, corner[1]], [size[0] / 2, size[1]], depth + 1);
        }
    }

    step(maze, [0,0], size);
    return maze;
}

export default function generateMap(symmetry=0) {
    // TODO: left-right symmetry
    let maze = mazeGen([BWIDTH / 2, BHEIGHT]);

    for (let horz of maze.horizontal) {
        
        let [x1, y1, x2, y2] = horz;
        if (x2 - x1 === 0) continue;
        window.gameState.walls.push(makeWall(
            [x1 * CELL_SIZE + WALL_THICKNESS / 2, y1 * CELL_SIZE - WALL_THICKNESS / 2],
            [(x2 - x1) * CELL_SIZE, WALL_THICKNESS]));
        window.gameState.walls.push(makeWall(
            [(BWIDTH - x1 - 1 - (x2 - x1)) * CELL_SIZE - WALL_THICKNESS / 2, y1 * CELL_SIZE - WALL_THICKNESS / 2],
            [(x2 - x1) * CELL_SIZE, WALL_THICKNESS]));
    }
    for (let horz of maze.vertical) {
        let [x1, y1, x2, y2] = horz;
        if (y2 - y1 === 0) continue;
        window.gameState.walls.push(makeWall(
            [x1 * CELL_SIZE - WALL_THICKNESS / 2, y1 * CELL_SIZE - WALL_THICKNESS / 2],
            [WALL_THICKNESS, (y2 - y1) * CELL_SIZE]));
        window.gameState.walls.push(makeWall(
            [(BWIDTH - x1 - 1) * CELL_SIZE - WALL_THICKNESS / 2, y1 * CELL_SIZE - WALL_THICKNESS / 2],
            [WALL_THICKNESS, (y2 - y1) * CELL_SIZE]));
    }
}

