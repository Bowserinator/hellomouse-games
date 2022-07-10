

// TODO: load stuff

import { SALVO } from './game/ability.js';
import { Board } from './game/board.js';
import GameState from './game/gamestate.js';
import { GAME_STATE, MOVE_TYPE } from './types.js';
import { BOARD_SIZE } from './vars.js';

const canvas: HTMLCanvasElement = document.getElementById('board') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

// url?<GAME UUID>=
const uuid = window.location.search.substr(1).split('=')[0];


const gameState = new GameState(true);
// @ts-ignore
window.gameState = gameState;


// Temp place ships:
function place(j: number) {
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
 * Connection handling
 * ---------------------------
 */
// @ts-expect-error
const connection = createConnection();
connection.onopen = () => {
    if (uuid.length === 0) // Create a new game
        connection.send(JSON.stringify({ type: 'CREATE', gameType: 'battlecruisers' }));
    else // Join existing game
        connection.send((JSON.stringify({ type: 'JOIN', gameID: uuid })));
};

connection.onerror = (error: any) => console.error(error);

// @ts-expect-error
const jsState = [...document.getElementsByClassName('js-state')];
const placingBlock = document.getElementById('bottom-placing') as HTMLDivElement;
const battleBlock = document.getElementById('bottom-battle') as HTMLDivElement;

connection.onmessage = (message: any) => {
    message = JSON.parse(message.data);
    console.log(message);

    switch (message.type) {
        case 'ERROR': {
            if (message.code === 'NO_GAME')
                window.location.href = window.location.href.split('?')[0];
            alert(message.error);
            break;
        }
        case 'UUID': {
            // Game UUID recieved
            let url = window.location.href.split('?')[0] + '?' + message.uuid;
            history.pushState({}, '', url);
            // TODO
            // document.getElementById('link').innerText = url;
            break;
        }
        case 'SYNC': {
            // TODO sync ready players
            let previousState = gameState.state;
            previousState = -1; // Temp
            gameState.playerIndex = message.playerIndex;
            gameState.fromSync(message.state);

            if (previousState !== gameState.state) {
                jsState.forEach(d => d.style.display = 'none');
                if (gameState.state === GAME_STATE.PLACING) {
                    updatePlacementButtons();
                    placingBlock.style.display = 'block';
                } else if (gameState.state === GAME_STATE.FIRING)
                    battleBlock.style.display = 'block';
            }
            if (gameState.state === GAME_STATE.FIRING) {
                gameState.resetAbilities();
                updateAbilityButtons();
            }
            break;
        }
    }
};


// @ts-expect-error
window.submitShips = () => {
    connection.send(JSON.stringify({
        type: 'MOVE',
        action: MOVE_TYPE.PLACE,
        placements: gameState.getPlayer().ships.filter(s => s.isPlaced).map(s => [...s.position, s.rotation])
    }));
};


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

let fireBtns: Array<HTMLElement> = [];

function updateAbilityButtons() {
    fireBtns = Object.keys(gameState.allAbilityMap)
        .filter(key => gameState.allAbilityMap[key])
        .map(key => {
            const btn = document.createElement('button') as HTMLButtonElement;
            const label = gameState.allAbilityMap[key].map(a => {
                if (a.isNotActive(gameState.round))
                    return a.cooldown - (gameState.round - a.lastRoundActivated);
                return 'R';
            }).join(', ');

            btn.innerText = `${key} (${label})`;
            btn.onclick = () => {
                fireBtns.forEach(e => e.classList.remove('focused'));
                gameState.selectedAbility = gameState.abilityMap[key][0] || SALVO;
                btn.classList.add('focused');
            };
            if (key === gameState.selectedAbility.name)
                btn.classList.add('focused');
            if (!gameState.abilityMap[key])
                btn.disabled = true;
            return btn;
        });

    // Special salvo button
    const sbtn = document.createElement('button') as HTMLButtonElement;
    sbtn.innerText = 'Salvo';
    sbtn.onclick = () => {
        fireBtns.forEach(e => e.classList.remove('focused'));
        gameState.selectedAbility = SALVO;
        sbtn.classList.add('focused');
    };
    sbtn.classList.add('salvo');
    if (SALVO.name === gameState.selectedAbility.name)
        sbtn.classList.add('focused');

    fireBtns.unshift(document.createElement('hr'));
    fireBtns.unshift(sbtn);
    shipPlacementButtons.replaceChildren(...fireBtns);
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
            // Not your turn
            if (gameState.turn !== gameState.playerIndex)
                return;

            const board = gameState.getPlayer().markerBoard;
            if (!board.isOnBoard(...mousepos)) return;
            let loc = mousePosToGrid(mousepos, board, [1, 1]);
            console.log('Firing at', loc);

            connection.send(JSON.stringify({
                type: 'MOVE',
                action: MOVE_TYPE.FIRE,
                abilityName: gameState.selectedAbility.name,
                firePos: loc
            }));
            // gameState.useCurrentAbility();
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
