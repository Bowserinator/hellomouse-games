

// TODO: load stuff

import GameState from './game/gamestate.js';
import { HitMarker, MaybeHitMarker, MissMarker, ShotDownMarker, MaybeMissMarker } from './game/marker.js';
import { GAME_STATE } from './types.js';
import { BOARD_SIZE } from './vars.js';

const canvas: HTMLCanvasElement = document.getElementById('board') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

// url?<GAME UUID>=
const uuid = window.location.search.substr(1).split('=')[0];


const gameState = new GameState(true);
// @ts-ignore
window.gameState = gameState;

for (let i = 0; i < BOARD_SIZE; i++)
    gameState.getPlayer().markerBoard.addMarker(new HitMarker([i, i]));
for (let i = 0; i < BOARD_SIZE; i++)
    gameState.getPlayer().markerBoard.addMarker(new MissMarker([i, i + 1]));
for (let i = 0; i < BOARD_SIZE; i++)
    gameState.getPlayer().markerBoard.addMarker(new ShotDownMarker([i, i + 2]));
for (let i = 0; i < BOARD_SIZE; i++)
    gameState.getPlayer().markerBoard.addMarker(new MaybeHitMarker([i, i + 3]));
for (let i = 0; i < BOARD_SIZE; i++)
    gameState.getPlayer().markerBoard.addMarker(new MaybeMissMarker([i, i + 4]));


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
const shipPlacementButtons = document.getElementById('ship-placement-buttons') as HTMLElement;

function getMousePos(e: MouseEvent): [number, number] {
    const rect = canvas.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;
    return [x, y];
}

function updatePlacementButtons() {
    const ships = gameState.getPlayer().ships.filter(ship => !ship.isPlaced);
    const shipCount: Record<string, number> = {};
    for (let ship of ships) {
        if (!shipCount[ship.name])
            shipCount[ship.name] = 0;
        shipCount[ship.name]++;
    }
    const shipNameArr = gameState.getPlayer().ships.map(ship => ship.isPlaced ? '' : ship.name);
    shipPlacementButtons.replaceChildren(...Object.keys(shipCount)
        .filter(key => shipCount[key])
        .map(key => {
            const btn = document.createElement('button') as HTMLButtonElement;
            btn.innerText = `${key} (${shipCount[key]})`;
            btn.onclick = () => gameState.placingShip = shipNameArr.indexOf(key);
            return btn;
        }));
}


document.onkeydown = e => {
    if (gameState.state === GAME_STATE.PLACING)
        if (e.key === 'r')
            gameState.placingRotation = (gameState.placingRotation + 1) % 4;
};

document.onmousedown = e => {
    const mousepos = getMousePos(e);

    // Ship placements
    if (gameState.state === GAME_STATE.PLACING) {
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

        updatePlacementButtons();
    }
};

document.onmousemove = e => {
    const mousepos = getMousePos(e);

    if (gameState.state === GAME_STATE.PLACING) {
        const board = gameState.getPlayer().shipBoard;
        if (!board.isOnBoard(...mousepos)) return;

        const ship = gameState.getPlayer().ships[gameState.placingShip];
        if (!ship || ship.isPlaced) {
            gameState.placingShip = -1;
            return;
        }
        const loc = board.getClickLocation(...mousepos);
        loc[0] = Math.min(BOARD_SIZE - ship.size[0], loc[0]);
        loc[1] = Math.min(BOARD_SIZE - ship.size[1], loc[1]);
        ship.position = loc;
    }
};


/**
 * ---------------------------
 * Window resizing
 * ---------------------------
 */
window.onresize = () => {
    canvas.width = window.innerWidth;
    canvas.style.width = canvas.width + 'px';
    canvas.height = window.innerHeight;
    canvas.style.height = canvas.height + 'px';
};
// @ts-expect-error
window.onresize();
