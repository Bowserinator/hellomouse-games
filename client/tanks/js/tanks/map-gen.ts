import Wall from './wall.js';
import Vector from './vector2d.js';

import { Maze } from '../maze_generator/mod.js';

const CELL_SIZE = 120;
const WALL_THICKNESS = 10;


/**
 * Construct a wall with given position (top left corner)
 * and size vector
 * @param {Vector} pos
 * @param {Vector} size
 * @return {Wall}
 */
function makeWall(pos, size) {
    return new Wall(new Vector(...pos), new Vector(...size));
}


/**
 * Create walls in the gameState to generate a maze
 * with a given random seed
 * @param {GameState} gameState Will modify .walls
 * @param {number} seed
 */
function generateMaze(gameState: GameState, seed: number) {
    let size = seed % 5 + 10;
    let m = new Maze({
        width: size,
        height: size,
        seed: seed,
        algorithm: ['recursive division', 'hunt and kill', 'growing tree'][seed % 3]
    });
    m.generate();

    const mazeStr = m.getString();
    const mazeRows = mazeStr.split('\n');

    // Generate horizontal walls
    for (let y = 0; y < mazeRows.length; y++) {
        // Find continious arrays of '_'
        let firstLine = -1; // Start of first _
        let row = mazeRows[y];

        for (let x = 0; x < row.length; x++) {
            if (row[x] === '_' && firstLine < 0) {
                firstLine = x;
                // Handle |_ case, should start before
                if (x > 0 && row[x - 1] === '|')
                    firstLine--;
                // Handle
                //  _ case, should start before
                // |
                else if (x > 0 && y < row.length - 1 && mazeRows[y][x - 1] === ' ' && mazeRows[y + 1][x - 1] === '|')
                    firstLine--;
            }
            if (firstLine >= 0 && (x === row.length - 1 || row[x + 1] !== '_')) {
                // Divide by 2 since walls are 0 thickness in diagram but take up 1
                // cell space anyways (only horizontally)
                let firstLine2 = Math.round(firstLine / 2);
                let x2 = Math.round(x / 2);
                gameState.walls.push(makeWall(
                    [firstLine2 * CELL_SIZE, (y + 1) * CELL_SIZE],
                    [(x2 - firstLine2) * CELL_SIZE + WALL_THICKNESS, WALL_THICKNESS]
                ));
                firstLine = -1;
            }
        }
    }

    // Generate vertical walls
    for (let x = 0; x < mazeRows[0].length; x++) {
        let firstLine = -1; // Start of first |
        let col = mazeRows.map(row => row[x]);

        for (let y = 0; y < col.length; y++)
            if (col[y] === '|') {
                if (firstLine < 0)
                    firstLine = y;
                if (y === col.length - 1 || col[y + 1] !== '|') {
                    gameState.walls.push(makeWall(
                        [Math.round(x / 2) * CELL_SIZE, firstLine * CELL_SIZE],
                        [WALL_THICKNESS, (y - firstLine + 1) * CELL_SIZE + WALL_THICKNESS]
                    ));
                    firstLine = -1;
                }
            }
    }
}


export default function generateMap(symmetry = 0) {
    generateMaze(window.gameState, Math.round(Math.random() * 100000));
}

