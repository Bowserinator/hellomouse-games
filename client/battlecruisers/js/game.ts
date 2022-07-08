

// TODO: load stuff

import { Board } from './game/board.js';
import GameState from './game/gamestate.js';
import { GAME_STATE } from './types.js';
import { BOARD_SIZE } from './vars.js';

const canvas: HTMLCanvasElement = document.getElementById('board') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

// url?<GAME UUID>=
const uuid = window.location.search.substr(1).split('=')[0];


const gameState = new GameState(true);
// @ts-ignore
window.gameState = gameState;


// Temp place ships:
function place(j) {
    let y = 0;
    for (let i = 0; i < gameState.players[j].ships.length; i++) {
        const s = gameState.players[j].ships[i];
        s.position = [0, y];
        y += s.size[1];
        gameState.players[j].shipBoard.place(s);
    }
}
place(0);
place(1);

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    gameState.draw(ctx);
    window.requestAnimationFrame(draw);
}

window.requestAnimationFrame(draw);


/**
 * ---------------------------
 * Controls
 * ---------------------------
 */

function mousePosToGrid(mousepos: [number, number], board: Board, size: [number, number]): [number, number] {
    const loc = board.getClickLocation(...mousepos);
    loc[0] = Math.min(BOARD_SIZE - size[0], loc[0]);
    loc[1] = Math.min(BOARD_SIZE - size[1], loc[1]);
    return loc;
}

const shipPlacementButtons = document.getElementById('ship-placement-buttons') as HTMLElement;
let shipPlacementButtonArr: Array<HTMLButtonElement> = [];

function getMousePos(e: MouseEvent): [number, number] {
    const rect = canvas.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;
    return [x, y];
}

function updatePlacementButtons() {
    const ships = gameState.getPlayer().ships; // .filter(ship => !ship.isPlaced);
    const shipCount: Record<string, number> = {};
    const tshipCount: Record<string, number> = {};
    for (let ship of ships) {
        if (!tshipCount[ship.name]) {
            shipCount[ship.name] = 0;
            tshipCount[ship.name] = 0;
        }
        if (!ship.isPlaced)
            shipCount[ship.name]++;
        tshipCount[ship.name]++;
    }
    const shipNameArr = gameState.getPlayer().ships.map(ship => ship.isPlaced ? '' : ship.name);
    shipPlacementButtonArr = [];
    shipPlacementButtons.replaceChildren(...Object.keys(shipCount)
        .map(key => {
            const btn = document.createElement('button') as HTMLButtonElement;
            btn.innerText = `${key} (${shipCount[key]} / ${tshipCount[key]})`;
            btn.onclick = () => {
                gameState.placingShip = shipNameArr.indexOf(key);
                shipPlacementButtonArr.forEach(b => b.classList.remove('focused'));
                btn.classList.add('focused');
            };

            if (!shipCount[key])
                btn.disabled = true;

            let ship = gameState.getPlayer().ships[gameState.placingShip];
            if (ship && ship.name === key)
                btn.classList.add('focused');
            shipPlacementButtonArr.push(btn);
            return btn;
        }));
}

function updateAbilityButtons() {
    shipPlacementButtons.replaceChildren(...Object.keys(gameState.abilityMap)
        .filter(key => gameState.abilityMap[key])
        .map(key => {
            const btn = document.createElement('button') as HTMLButtonElement;
            btn.innerText = `${key} (${gameState.abilityMap[key].length})`;
            btn.onclick = () => gameState.selectedAbility = gameState.abilityMap[key][0];
            return btn;
        }));
}


document.onkeydown = e => {
    if (gameState.state === GAME_STATE.PLACING)
        if (e.key === 'r')
            gameState.placingRotation = (gameState.placingRotation + 1) % 4;
};

canvas.onmousedown = e => {
    const mousepos = getMousePos(e);

    switch (gameState.state) {
        // Ship placements
        case GAME_STATE.PLACING: {
            const board = gameState.getPlayer().shipBoard;
            if (!board.isOnBoard(...mousepos)) return;

            const ships = gameState.getPlayer().ships;
            let loc = board.getClickLocation(...mousepos);

            // Did we select an existing ship? Switch to it
            for (let s of board.ships)
                if (s.checkSpot(...loc)) {
                    board.removeShip(s);
                    if (e.button !== 2) { // Pick with LEFT, just delete with RIGHT
                        gameState.placingShip = ships.indexOf(s);
                        gameState.placingRotation = s.rotation;
                    }
                    updatePlacementButtons();
                    return;
                }

            const ship = ships[gameState.placingShip];
            if (e.button === 2 || !ship || ship.isPlaced) { // Right click = cancel, else nothing to place
                gameState.placingShip = -1;
                return;
            }

            loc[0] = Math.min(BOARD_SIZE - ship.size[0], loc[0]);
            loc[1] = Math.min(BOARD_SIZE - ship.size[1], loc[1]);
            ship.position = loc;

            if (board.place(ship))
                // Place a new ship on the board
                gameState.advancePlacingShip();

            // Update placement button + current ship pos
            updatePlacementButtons();
            const nship = ships[gameState.placingShip];
            if (nship && !nship.isPlaced)
                nship.position = mousePosToGrid(mousepos, board, [1, 1]);
            break;
        }
        // Fire
        case GAME_STATE.FIRING: {
            const board = gameState.getPlayer().markerBoard;
            if (!board.isOnBoard(...mousepos)) return;
            let loc = mousePosToGrid(mousepos, board, [1, 1]);
            console.log('Firing at', loc);
            gameState.useCurrentAbility();
            updateAbilityButtons();
            break;
        }
    }
};

canvas.onmousemove = e => {
    const mousepos = getMousePos(e);

    switch (gameState.state) {
        // Ship placements
        case GAME_STATE.PLACING: {
            const board = gameState.getPlayer().shipBoard;
            if (!board.isOnBoard(...mousepos)) return;

            const ship = gameState.getPlayer().ships[gameState.placingShip];
            if (!ship || ship.isPlaced) {
                gameState.placingShip = -1;
                return;
            }
            ship.position = mousePosToGrid(mousepos, board, ship.size);
            break;
        }
        // Fire
        case GAME_STATE.FIRING: {
            const board = gameState.getPlayer().markerBoard;
            if (!board.isOnBoard(...mousepos)) return;
            gameState.firePos = mousePosToGrid(mousepos, board, [1, 1]);
            break;
        }
    }
};


/**
 * ---------------------------
 * Window resizing
 * ---------------------------
 */
window.onresize = () => {
    let size = Math.min(window.innerWidth, window.innerHeight);
    if (window.innerWidth > 992)
        size -= 100; // Shrink on large screens
    canvas.width = size;
    canvas.style.width = size + 'px';
    canvas.height = size;
    canvas.style.height = size + 'px';

    let gridSize = size / (BOARD_SIZE + 3);
    gameState.setBoardSize([gridSize, gridSize], gridSize);
};
// @ts-expect-error
window.onresize();
