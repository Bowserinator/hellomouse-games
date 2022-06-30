import Wall from './wall.js';
import Vector from './vector2d.js';
import GameState from './gamestate.js';

import { Maze } from '../maze_generator/mod.js';
import { CELL_SIZE, WALL_THICKNESS, MIN_MAZE_SIZE, MAX_MAZE_SIZE } from '../vars.js';


/**
 * Construct a wall with given position (top left corner)
 * and size vector
 * @param {[number, number]} pos
 * @param {[number, number]} size
 * @return {Wall}
 */
function makeWall(pos: [number, number], size: [number, number]) {
    return new Wall(new Vector(...pos), new Vector(...size));
}


/**
 * Cut some holes in the maze to create a more "open" map
 * @param mazeStr Output str of maze generator
 * @param seed RNG seed
 * @returns New mazeStr
 */
function punchHoles(mazeStr: string, seed: number) {
    let lines = mazeStr.split('\n');
    let index = seed % 3;

    const modAmount = Math.ceil(lines.length / 2);

    for (let i = 1; i < lines.length - 1; i++)
        for (let j = 1; j < lines[i].length - 1; j++) {
            if (index % modAmount === 0)
                lines[i] = lines[i].substring(0, j) + ' ' + lines[i].substring(j + 1);
            index = (index * 101 + 17) % 59; // Arbritrary
        }
    return lines.join('\n');
}


/**
 * Get size of maze from seed
 * @param {number} seed Random seed
 * @returns Size of maze in cells
 */
export function getMazeSize(seed: number) {
    return seed % (MAX_MAZE_SIZE - MIN_MAZE_SIZE) + MIN_MAZE_SIZE;
}


/**
 * Create walls in the gameState to generate a maze
 * with a given random seed
 * @param {GameState} gameState Will modify .walls
 * @param {number} seed
 * @return {[number, number]} width, height of maze (in cells)
 */
export function generateMaze(gameState: GameState, seed: number) {
    let size = getMazeSize(seed);
    let m = new Maze({
        width: size,
        height: size,
        seed: seed,
        algorithm: ['recursive division', 'hunt and kill', 'growing tree'][seed % 3]
    });
    m.generate();

    let mazeStr = m.getString();
    if (seed % 3 === 0)
        mazeStr = punchHoles(mazeStr, seed);

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
                    [firstLine2 * CELL_SIZE, (y + 1) * CELL_SIZE - CELL_SIZE],
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
                        [Math.round(x / 2) * CELL_SIZE, firstLine * CELL_SIZE - CELL_SIZE],
                        [WALL_THICKNESS, (y - firstLine + 1) * CELL_SIZE + WALL_THICKNESS]
                    ));
                    firstLine = -1;
                }
            }
    }
    return [size, size];
}
