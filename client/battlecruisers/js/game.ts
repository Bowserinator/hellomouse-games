import { SALVO } from './game/ability.js';
import { Board } from './game/board.js';
import GameState from './game/gamestate.js';
import { HitMarker, MissMarker } from './game/marker.js';
import { DRAWN_BOARD, GAME_STATE, MOVE_TYPE, WINNER } from './types.js';
import { BOARD_SIZE, SALVOS_PER_TURN } from './vars.js';

const canvas: HTMLCanvasElement = document.getElementById('board') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

// url?<GAME UUID>=
const uuid = window.location.search.substr(1).split('=')[0];

const gameState = new GameState(true);
// @ts-ignore
window.gameState = gameState;

// Render loop
let lastDraw = 0;
function draw() {
    if (performance.now() - lastDraw > 1000 / 20) { // Draw at 20 fps
        lastDraw = performance.now();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        gameState.draw(ctx);
    }
    window.requestAnimationFrame(draw);
}

window.requestAnimationFrame(draw);

/**
 * Display the winner modal
 */
function showWinModal() {
    // @ts-expect-error
    document.getElementById('win-modal').style.display = 'block';
    // @ts-expect-error
    document.getElementById('win-img').src = '/battlecruisers/img/flag' + (gameState.winner - 1) + '.png';
    // @ts-expect-error
    document.getElementById('win-h1').innerText =
        gameState.winner === WINNER.TIE ? 'Tied!' : (
            gameState.winner - 1 === gameState.playerIndex
                ? 'You Win!' : 'You Lose!');
    // @ts-expect-error
    document.getElementById('win-h3').innerText =
        gameState.winner - 1 === gameState.playerIndex
            ? 'All the enemy ships have been sunk!' : 'All your ships have been sunk!';
}


/**
 * Chat sending
 */
const chatInput = document.getElementById('chat-input') as HTMLInputElement;
chatInput.onkeydown = e => {
    if (e.key === 'Enter') {
        if (!chatInput.value) return;
        connection.send(JSON.stringify({
            type: 'CHAT',
            message: chatInput.value
        }));
        chatInput.value = '';
    }
};


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


/*
 * ----------------------------------
 * Disconnect banner
 * - Appears when no longer connected to server
 * - Poll every 500ms for disconnect
 * ----------------------------------
 */
const DISCONNECT_BANNER = document.getElementById('disconnect-banner');
setInterval(() => {
    if (!DISCONNECT_BANNER) return;
    if (connection.readyState !== WebSocket.CLOSED)
        DISCONNECT_BANNER.style.top = '-100px';
    else
        DISCONNECT_BANNER.style.top = '0';
}, 500);


// @ts-expect-error
const jsState = [...document.getElementsByClassName('js-state')];
const placingBlock = document.getElementById('bottom-placing') as HTMLDivElement;
const battleBlock = document.getElementById('bottom-battle') as HTMLDivElement;

const flagImg = document.getElementById('you-are-img') as HTMLImageElement;
const youAreLabel = document.getElementById('you-are') as HTMLSpanElement;
const stateLabel = document.getElementById('turn') as HTMLSpanElement;
const disconnectBanner = document.getElementById('missing-player-banner') as HTMLDivElement;

const lobby = document.getElementById('lobby') as HTMLDivElement;
const inviteLink = document.getElementById('link') as HTMLParagraphElement;
const gameLink = document.getElementById('game-link') as HTMLParagraphElement;

const chatMessages = document.getElementById('messages') as HTMLDivElement;

/**
 * Used in the copy link to clipboard
 * @param {string} text Text to copy
 */
function copyLinkToClipboard(text: string) {
    gameLink.classList.add('flash');
    setTimeout(() => gameLink.classList.remove('flash'), 500);
    // @ts-expect-error
    copyToClipboard(text);
}

gameLink.onclick = () => copyLinkToClipboard(inviteLink.innerText);

// @ts-expect-error
const stateLabelMap: Record<GAME_STATE, string> = {};
stateLabelMap[GAME_STATE.PLACING] = 'You are currently placing ships';
stateLabelMap[GAME_STATE.FIRING] = '<will be overwritten>';
stateLabelMap[GAME_STATE.LOBBY] = '';

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
        case 'CHAT': {
            // @ts-expect-error
            let msg = chatToHTML(message.message);

            if (message.i === gameState.playerIndex)
                msg.style.backgroundColor = '#333';
            if (message.i > -1)
                msg.innerHTML = `<img src="/battlecruisers/img/flag${message.i}.png">` + msg.innerHTML;
            chatMessages.appendChild(msg);

            break;
        }
        case 'UUID': {
            // Game UUID recieved
            let url = window.location.href.split('?')[0] + '?' + message.uuid;
            history.pushState({}, '', url);
            inviteLink.innerText = url;
            break;
        }
        case 'SYNC': {
            // Update ready states
            for (let i = 0; i < 2; i++) {
                let btn = document.getElementById(`ready${i}`) as HTMLButtonElement;
                if (message.players[i]) {
                    btn.classList.add('active');
                    btn.innerText = '✓';
                } else {
                    btn.classList.remove('active');
                    btn.innerText = '';
                }
            }

            // Sync gamestate
            let previousState = gameState.state;
            let previousTurn = gameState.turn;
            gameState.playerIndex = message.playerIndex;
            gameState.fromSync(message.state);

            // Update if enemy disconnected
            if (gameState.state !== GAME_STATE.LOBBY && message.players.filter((p: any) => p !== null).length !== 2)
                disconnectBanner.style.top = '0px';
            else
                disconnectBanner.style.top = '-100px';

            // Enemy player made a turn
            updateShipHP();

            // Update header stuff
            flagImg.src = '/battlecruisers/img/flag' + gameState.playerIndex + '.png';
            youAreLabel.innerText = `You are ${['NORTHLANDIA', 'SOUTHANIA'][gameState.playerIndex]}`;

            // Switch players
            if (previousTurn !== gameState.turn)
                gameState.displayBoard = gameState.turn === gameState.playerIndex
                    ? DRAWN_BOARD.FIRING : DRAWN_BOARD.SELF;

            // Change state
            if (previousState !== gameState.state) {
                let turn = gameState.turn === gameState.playerIndex ? 'your' : 'the enemy\'s';
                stateLabelMap[GAME_STATE.FIRING] = `It is ${turn} turn (Move ${gameState.round + 1})`;
                stateLabel.innerText = stateLabelMap[gameState.state];
                lobby.style.display = 'none';

                jsState.forEach(d => d.style.display = 'none');
                if (gameState.state === GAME_STATE.PLACING) {
                    updatePlacementButtons();
                    placingBlock.style.display = 'block';
                } else if (gameState.state === GAME_STATE.FIRING) {
                    updateShipHP();
                    battleBlock.style.display = 'block';
                } else if (gameState.state === GAME_STATE.LOBBY && gameState.winner !== WINNER.UNKNOWN)
                    showWinModal();

                if (gameState.state === GAME_STATE.LOBBY)
                    lobby.style.display = 'block';
            }
            if (gameState.state === GAME_STATE.FIRING) {
                gameState.regenAbilityMaps();
                updateAbilityButtons();
            } else if (gameState.state === GAME_STATE.LOBBY) {
                let playerDivs = [
                    document.getElementById('player0') as HTMLDivElement,
                    document.getElementById('player1') as HTMLDivElement
                ];
                for (let i = 0; i < 2; i++)
                    if (message.players[i] !== null && message.players[i] !== undefined)
                        playerDivs[i].classList.add('active');
                    else
                        playerDivs[i].classList.remove('active');
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

// @ts-expect-error
window.ready = (index: number) => {
    if (index !== gameState.playerIndex) return;
    connection.send(JSON.stringify({
        type: 'READY'
    }));
};

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

            const img = document.createElement('img') as HTMLImageElement;
            img.src = ships.filter(ship => ship.name === key)[0].imageUrl;
            btn.prepend(img);

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
const movesRemainingLabel = document.getElementById('moves-remaining') as HTMLLabelElement;
const shipHP = document.getElementById('ship-healths') as HTMLDivElement;

function updateShipHP() {
    shipHP.replaceChildren(...gameState.getPlayer().ships.map(ship => {
        let div = document.createElement('div') as HTMLDivElement;
        let img = document.createElement('img') as HTMLImageElement;
        div.innerText = `${ship.lives} / ${ship.totalLives}`;

        if (ship.lives <= ship.totalLives / 2)
            div.style.color = 'red';
        if (ship.lives === 0)
            div.style.opacity = '0.3';
        img.src = ship.imageUrl;
        div.prepend(img);
        return div;
    }));
}

function updateAbilityButtons() {
    // Moves remaining
    movesRemainingLabel.innerText = `You have ${gameState.salvosLeft[gameState.playerIndex]} / ${SALVOS_PER_TURN} moves remaining`;

    // Ability buttons
    fireBtns = Object.keys(gameState.allAbilityMap)
        .filter(key => gameState.allAbilityMap[key])
        .map(key => {
            const btn = document.createElement('button') as HTMLButtonElement;
            const label = gameState.allAbilityMap[key].map(a => {
                if (a.disabled)
                    return 'X';
                if (a.isNotActive(gameState.round))
                    return a.cooldown - (gameState.round - a.lastRoundActivated);
                return 'R';
            }).join(', ');

            btn.innerText = `${key} (${label})`;

            if (gameState.allAbilityMap[key][0].imageUrl) {
                const img = document.createElement('img') as HTMLImageElement;
                img.src = gameState.allAbilityMap[key][0].imageUrl;
                btn.prepend(img);
            }

            btn.onclick = () => {
                fireBtns.forEach(e => e.classList.remove('focused'));
                gameState.selectedAbility = gameState.abilityMap[key][0] || SALVO;
                btn.classList.add('focused');
            };
            if (!gameState.abilityMap[key] || gameState.playerIndex !== gameState.turn)
                btn.disabled = true;
            if (!btn.disabled && key === gameState.selectedAbility.name)
                btn.classList.add('focused');
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
    if (gameState.playerIndex !== gameState.turn)
        sbtn.disabled = true;
    else if (SALVO.name === gameState.selectedAbility.name)
        sbtn.classList.add('focused');

    fireBtns.unshift(document.createElement('hr'));
    fireBtns.unshift(sbtn);
    shipPlacementButtons.replaceChildren(...fireBtns);
}


document.onkeydown = e => {
    if (gameState.state === GAME_STATE.PLACING)
        if (e.key === 'r')
            gameState.placingRotation = (gameState.placingRotation + 1) % 4;
        else if (e.key === 'Escape')
            // @ts-expect-error
            [...document.getElementsByClassName('modal-darken')].forEach(element => element.style.display = 'none');
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
            // Not showing right board
            if (gameState.displayBoard !== DRAWN_BOARD.FIRING)
                return;
            // Not left click
            if (e.button !== 0)
                return;

            const board = gameState.getPlayer().markerBoard;
            if (!board.isOnBoard(...mousepos)) return;
            let loc = mousePosToGrid(mousepos, board, [1, 1]);

            // Targetted location was already hit + using salvo
            if (gameState.selectedAbility === SALVO &&
                board.markers.some(m => (m instanceof HitMarker || m instanceof MissMarker) &&
                    m.position[0] === loc[0] && m.position[1] === loc[1]))
                return;

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
