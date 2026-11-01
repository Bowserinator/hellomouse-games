/* exported findForcedWin */

/**
 * Threat-based search for forced wins. A forced win is a sequence of
 * turns where each turn of the attacker threatens to win on the next one,
 * leaving the opponent only replies that stop every threat, until
 * the opponent has no such reply left.
 *
 * The attacker only plays threatening moves, so wins that need a quiet move
 * can be missed, but every reply the opponent has is considered, so a win that
 * is found cannot be escaped. Searches that run out of time find nothing.
 *
 * Wins are searched up to a few turns deep against any reply. Past that, only
 * lines where the opponent's replies are completely dictated are followed,
 * since those stay cheap to search.
 */

const ANALYSIS_SIZE = 19;
const WINDOW_LEN = 6;
const MAX_ATTACKER_CELLS = 30;
const FREE_TURNS = 5;
const NODE_BUDGET = 5000;
const TIME_BUDGET_MS = 1000;

/** All lines of six cells, as arrays of cell indices */
const WINDOWS = (() => {
    let windows = [];
    for (let [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]])
        for (let y = 0; y < ANALYSIS_SIZE; y++)
            for (let x = 0; x < ANALYSIS_SIZE; x++) {
                let xEnd = x + (WINDOW_LEN - 1) * dx;
                let yEnd = y + (WINDOW_LEN - 1) * dy;
                if (xEnd < 0 || xEnd >= ANALYSIS_SIZE || yEnd < 0 || yEnd >= ANALYSIS_SIZE)
                    continue;

                let cells = [];
                for (let i = 0; i < WINDOW_LEN; i++)
                    cells.push((y + i * dy) * ANALYSIS_SIZE + x + i * dx);
                windows.push(cells);
            }
    return windows;
})();

/** For each cell, the indices of the windows containing it */
const CELL_WINDOWS = (() => {
    let map = [];
    for (let i = 0; i < ANALYSIS_SIZE * ANALYSIS_SIZE; i++) map.push([]);
    WINDOWS.forEach((cells, w) => cells.forEach(c => map[c].push(w)));
    return map;
})();

class BudgetExceeded extends Error {}

class Position {
    /** @param {Array<Array<number>>} board 2D array of 0, 1 or 2 */
    constructor(board) {
        this.cells = new Uint8Array(ANALYSIS_SIZE * ANALYSIS_SIZE);
        // counts[color][window] = stones of that color in the window
        this.counts = [null, new Uint8Array(WINDOWS.length), new Uint8Array(WINDOWS.length)];
        this.nodes = 0;
        this.deadline = Infinity;

        for (let y = 0; y < ANALYSIS_SIZE; y++)
            for (let x = 0; x < ANALYSIS_SIZE; x++)
                if (board[y][x]) this.place(y * ANALYSIS_SIZE + x, board[y][x]);
    }

    place(cell, color) {
        this.cells[cell] = color;
        for (let w of CELL_WINDOWS[cell]) this.counts[color][w]++;
    }

    remove(cell) {
        let color = this.cells[cell];
        this.cells[cell] = 0;
        for (let w of CELL_WINDOWS[cell]) this.counts[color][w]--;
    }

    /**
     * Windows where color needs at most two more stones to make six
     * and the opponent has none
     * @param {number} color
     * @param {Iterable<number>} [windows] Windows to check, defaults to all
     * @return {Array<number>}
     */
    threats(color, windows) {
        let mine = this.counts[color];
        let theirs = this.counts[3 - color];
        let found = [];

        if (!windows) windows = WINDOWS.keys();
        for (let w of windows)
            if (mine[w] >= 4 && theirs[w] === 0) found.push(w);
        return found;
    }

    /** Distinct windows touching any of the cells */
    windowsThrough(cells) {
        let seen = new Set();
        for (let c of cells) for (let w of CELL_WINDOWS[c]) seen.add(w);
        return seen;
    }

    /**
     * Every empty cell that is in some window not holding both colors, the
     * only cells where a stone can matter
     * @return {Array<number>}
     */
    liveCells() {
        let live = new Set();
        for (let w = 0; w < WINDOWS.length; w++) {
            if (this.counts[1][w] > 0 && this.counts[2][w] > 0) continue;
            for (let c of WINDOWS[w]) if (this.cells[c] === 0) live.add(c);
        }
        return [...live];
    }

    emptyCellsOf(window) {
        return WINDOWS[window].filter(c => this.cells[c] === 0);
    }

    /**
     * Empty cells in windows that the color could still fill, best first
     * @param {number} color
     * @param {number} minStones Minimum stones of color in the window
     * @param {number} limit
     * @return {Array<number>}
     */
    candidateCells(color, minStones, limit) {
        let mine = this.counts[color];
        let theirs = this.counts[3 - color];
        let score = new Map();

        for (let w = 0; w < WINDOWS.length; w++) {
            if (mine[w] < minStones || theirs[w] > 0) continue;
            for (let c of WINDOWS[w])
                if (this.cells[c] === 0)
                    score.set(c, (score.get(c) || 0) + mine[w] * mine[w]);
        }
        return [...score.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(e => e[0]);
    }
}

/**
 * Cell pairs the defender can play to stop every threat window
 * @param {Position} pos
 * @param {Array<number>} threats Windows to stop
 * @param {Array<number>} freeCells Cells to try as a spare stone, when one
 *     stone is enough to stop every threat. Must hold every cell that could matter
 * @return {Array<Array<number>>} Pairs of cells
 */
function defenderReplies(pos, threats, freeCells) {
    let replies = [];
    let seen = new Set();
    let add = (a, b) => {
        let key = Math.min(a, b) * 1000 + Math.max(a, b);
        if (seen.has(key)) return;
        seen.add(key);
        replies.push([a, b]);
    };

    let blockers = new Set();
    for (let w of threats) for (let c of pos.emptyCellsOf(w)) blockers.add(c);

    for (let c of blockers) {
        let remaining = threats.filter(w => !WINDOWS[w].includes(c));
        if (remaining.length === 0) {
            for (let d of blockers) if (d !== c) add(c, d);
            for (let d of freeCells) if (d !== c) add(c, d);
            let spare = pos.cells.findIndex((v, cell) => v === 0 && cell !== c);
            if (spare >= 0) add(c, spare);
            continue;
        }

        let second = pos.emptyCellsOf(remaining[0]);
        for (let w of remaining.slice(1))
            second = second.filter(d => WINDOWS[w].includes(d));
        for (let d of second) add(c, d);
    }
    return replies;
}

/**
 * Whether the color could fill four of a window with its next two stones,
 * which is what makes a move forcing
 * @param {Position} pos
 * @param {number} color
 * @return {boolean}
 */
function canForce(pos, color) {
    let mine = pos.counts[color];
    let theirs = pos.counts[3 - color];
    for (let w = 0; w < WINDOWS.length; w++)
        if (mine[w] >= 2 && theirs[w] === 0) return true;
    return false;
}

/**
 * The two cells that stop the most threat windows
 * @param {Position} pos
 * @param {Array<number>} threats
 * @return {Array<number>}
 */
function bestEffortBlock(pos, threats) {
    let picked = [];
    let open = threats.slice();

    for (let n = 0; n < 2; n++) {
        let tally = new Map();
        for (let w of open)
            for (let c of pos.emptyCellsOf(w)) tally.set(c, (tally.get(c) || 0) + 1);

        let best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
        if (!best) break;
        picked.push(best[0]);
        open = open.filter(w => !WINDOWS[w].includes(best[0]));
    }
    return picked;
}

/**
 * Stones that complete six right now, if the player can
 * @param {Position} pos
 * @param {number} color
 * @return {Array<number>|null}
 */
function immediateWin(pos, color) {
    let threats = pos.threats(color);
    if (threats.length === 0) return null;

    return threats.map(w => pos.emptyCellsOf(w)).sort((a, b) => a.length - b.length)[0];
}

/**
 * A line of play that wins for the attacker whatever the defender does
 * @typedef {object} WinNode
 * @property {Array<number>} move Cells the attacker plays
 * @property {Array<{reply: Array<number>, next: WinNode}>|null} branches
 *     Every defender reply with how the attacker wins after it. Null when no
 *     reply can stop the win
 * @property {Array<Array<number>>} [tail] When there are no branches, the
 *     defender's best effort block and the attacker's winning stones
 * @property {boolean} useful Whether both stones of the move take part in a
 *     threat or stop one
 */

/**
 * Whether one stone alone could stop all the threats, leaving a spare stone
 * @param {Position} pos
 * @param {Array<number>} threats
 * @return {boolean}
 */
function hasSpareStone(pos, threats) {
    return pos.emptyCellsOf(threats[0])
        .some(c => threats.every(w => WINDOWS[w].includes(c)));
}

/**
 * Play a pair of stones for the attacker and see if it wins by force
 * @param {Position} pos
 * @param {number} attacker Color 1 or 2
 * @param {Array<number>} move The two cells to play
 * @param {number} forcingLeft Threatening turns the attacker may still play
 *     counting this one
 * @param {number} used Threatening turns already played
 * @param {Array<number>} defenderThreats Windows the defender would complete
 * @return {WinNode|null}
 */
function tryMove(pos, attacker, move, forcingLeft, used, defenderThreats) {
    let defender = 3 - attacker;
    let [a, b] = move;
    pos.place(a, attacker);
    pos.place(b, attacker);

    let touched = pos.windowsThrough([a, b]);
    let stopsDefender = defenderThreats.every(w => pos.counts[attacker][w] > 0);
    let threats = stopsDefender ? pos.threats(attacker, touched) : [];
    // Deep lines only count if the defender has no spare stone to play freely
    let allowed = threats.length > 0 &&
        (used < FREE_TURNS - 1 || !hasSpareStone(pos, threats));

    let node = null;
    if (allowed) {
        let useful = move.every(c => CELL_WINDOWS[c].some(
            w => threats.includes(w) || defenderThreats.includes(w)));
        let free = [];
        if (used < FREE_TURNS - 1)
            // Likeliest refutations first so a failing move is dropped quickly
            free = [...new Set([
                ...pos.candidateCells(attacker, 2, MAX_ATTACKER_CELLS),
                ...pos.candidateCells(defender, 2, MAX_ATTACKER_CELLS),
                ...pos.liveCells()
            ])];
        let replies = defenderReplies(pos, threats, free);

        if (replies.length === 0) {
            let block = bestEffortBlock(pos, threats);
            for (let c of block) pos.place(c, defender);
            let finish = immediateWin(pos, attacker);
            for (let c of block) pos.remove(c);

            node = { move, branches: null, tail: finish ? [block, finish] : [block], useful };
        } else {
            let branches = [];
            for (let [c, d] of replies) {
                pos.place(c, defender);
                pos.place(d, defender);
                let counter = pos.threats(defender, pos.windowsThrough([c, d]));
                let next = searchForcingMove(pos, attacker, forcingLeft - 1, used + 1, counter);
                pos.remove(c);
                pos.remove(d);

                if (!next) {
                    branches = null;
                    break;
                }
                branches.push({ reply: [c, d], next });
            }
            if (branches) node = { move, branches, useful };
        }
    }

    pos.remove(a);
    pos.remove(b);
    return node;
}

/**
 * Pairs of cells the attacker may try, most promising first
 * @param {Position} pos
 * @param {number} attacker
 * @param {Array<number>} defenderThreats
 * @return {Array<Array<number>>}
 */
function attackerMoves(pos, attacker, defenderThreats) {
    let cands = pos.candidateCells(attacker, 2, MAX_ATTACKER_CELLS);
    for (let w of defenderThreats)
        for (let c of pos.emptyCellsOf(w))
            if (!cands.includes(c)) cands.push(c);

    let moves = [];
    for (let i = 0; i < cands.length; i++)
        for (let j = i + 1; j < cands.length; j++)
            moves.push([cands[i], cands[j]]);
    return moves;
}

function checkBudget(pos) {
    if (++pos.nodes > NODE_BUDGET || Date.now() > pos.deadline) throw new BudgetExceeded();
}

/**
 * Find a way for the attacker, to move, to force a win
 * @param {Position} pos
 * @param {number} attacker Color 1 or 2
 * @param {number} forcingLeft Threatening turns the attacker may still play
 * @param {number} used Threatening turns already played
 * @param {Array<number>} defenderThreats Windows the defender would complete
 * @return {WinNode|null}
 */
function searchForcingMove(pos, attacker, forcingLeft, used, defenderThreats) {
    if (forcingLeft === 0) return null;
    checkBudget(pos);

    for (let move of attackerMoves(pos, attacker, defenderThreats)) {
        let node = tryMove(pos, attacker, move, forcingLeft, used, defenderThreats);
        if (node) return node;
    }
    return null;
}

/**
 * Find every first move that forces a win. Stops early if time runs out,
 * keeping what was found.
 * @param {Position} pos
 * @param {number} attacker Color 1 or 2
 * @param {number} forcingLeft Threatening turns the attacker may play
 * @param {Array<number>} defenderThreats Windows the defender would complete
 * @return {Array<WinNode>}
 */
function searchAllFirstMoves(pos, attacker, forcingLeft, defenderThreats) {
    let nodes = [];
    try {
        checkBudget(pos);
        for (let move of attackerMoves(pos, attacker, defenderThreats)) {
            let node = tryMove(pos, attacker, move, forcingLeft, 0, defenderThreats);
            if (node) nodes.push(node);
        }
    } catch (e) {
        if (!(e instanceof BudgetExceeded) || nodes.length === 0) throw e;
    }

    let useful = nodes.filter(n => n.useful);
    return useful.length > 0 ? useful : nodes;
}

/**
 * Number of different games a win node leads to
 * @param {WinNode} node
 * @return {number}
 */
function countGames(node) {
    if (!node.branches) return 1;
    return node.branches.reduce((n, b) => n + countGames(b.next), 0);
}

/**
 * Turn a win node into games, each a list of the cells played on every turn
 * @param {WinNode} node
 * @param {Array<Array<number>>} prefix Turns played to get here
 * @param {Array<Array<Array<number>>>} out Games found are added here
 * @param {number} limit Stop once out has this many games
 */
function collectGames(node, prefix, out, limit) {
    let turns = [...prefix, node.move];
    if (!node.branches) {
        out.push([...turns, ...node.tail]);
        return;
    }
    for (let branch of node.branches) {
        if (out.length >= limit) return;
        collectGames(branch.next, [...turns, branch.reply], out, limit);
    }
}

/**
 * Look for a forced win for the player about to place two stones. Gives up
 * right away if neither player has a move that forces a reply.
 * @param {Array<Array<number>>} board 2D array of 0, 1 or 2
 * @param {number} player 0 = black, 1 = white
 * @param {number} maxTurns Most turns of the player allowed, including the winning one
 * @param {number} maxGames Most games to return
 * @return {{turns: number, total: number, games: Array<Array<Array<Array<number>>>>}|null}
 *     Fewest turns needed, how many different games the win leads to and some of
 *     them, longest first. Each game is the stones [x, y] placed on every turn
 *     starting with the player's. Null if no win was found
 */
function findForcedWin(board, player, maxTurns, maxGames) {
    let attacker = player + 1;
    let pos = new Position(board);
    let toXY = c => [c % ANALYSIS_SIZE, Math.floor(c / ANALYSIS_SIZE)];
    let result = (turns, total, games) => ({
        turns,
        total,
        games: games.map(game => game.map(turn => turn.map(toXY)))
    });

    if (!canForce(pos, attacker) && !canForce(pos, 3 - attacker)) return null;

    let win = immediateWin(pos, attacker);
    if (win) return result(1, 1, [[win]]);

    let defenderThreats = pos.threats(3 - attacker);
    pos.deadline = Date.now() + TIME_BUDGET_MS;
    for (let turns = 2; turns <= maxTurns; turns++) {
        pos.nodes = 0;
        let nodes;
        try {
            nodes = searchAllFirstMoves(pos, attacker, turns - 1, defenderThreats);
        } catch (e) {
            if (!(e instanceof BudgetExceeded)) throw e;
            return null;
        }
        if (nodes.length === 0) continue;

        let games = [];
        for (let node of nodes) collectGames(node, [], games, maxGames * 5);
        games.sort((a, b) => b.length - a.length);
        let total = nodes.reduce((n, node) => n + countGames(node), 0);
        return result(turns, total, games.slice(0, maxGames));
    }
    return null;
}
