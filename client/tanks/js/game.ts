import Vector from './tanks/vector2d.js';
import GameState from './tanks/gamestate.js';
import { Direction, Action } from './types.js';
import Camera from './renderer/camera.js';
import { CAMERA_EDGE_MARGIN, CONTROL_KEYS, ROTATE_FAST, ROTATE_SLOW, SPECTATE_DELAY, UPDATE_EVERY_N_MS } from './vars.js';

import { setGlobalVolume } from './sound/sound.js';
import { startScoreKeeping } from './score.js';
import { handleLobbyMessage } from './lobby.js';
import Tank from './tanks/tank.js';

// createConnection() is in a shared JS file
// @ts-expect-error
const connection = createConnection();

const canvas: HTMLCanvasElement = document.getElementById('board') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

// url?<GAME UUID>=
const uuid = window.location.search.substr(1).split('=')[0];

// Game state, shared with client.js
const gameState = new GameState(true);
// Hack
// @ts-expect-error
window.gameState = gameState;
// @ts-expect-error
window.connection = connection;


/**
 * ----------------------------------
 * Invite link
 * - Click to copy invite link
 * ----------------------------------
 */
const inviteLink = document.getElementById('link') as HTMLParagraphElement;
const gameLink = document.getElementById('game-link') as HTMLParagraphElement;

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


/**
 * ----------------------------------
 * Board + gamestate updating and rendering
 * ----------------------------------
 */

/**
 * Center a camera on a tank + take into account arena size
 * @param tank? Tank to center camera on
 */
function centerCamera(tank?: Tank) {
    if (!tank) return;

    gameState.camera.position = tank.position.add(new Vector(-canvas.width / 2, -canvas.height / 2));
    gameState.camera.position.x = Math.max(-CAMERA_EDGE_MARGIN, gameState.camera.position.x);
    gameState.camera.position.y = Math.max(-CAMERA_EDGE_MARGIN, gameState.camera.position.y);

    if (gameState.mazeLayer) {
        // Center on tank for large mazes, snapping to edges
        if (gameState.mazeLayer.width > canvas.width - 2 * CAMERA_EDGE_MARGIN)
            gameState.camera.position.x =
                Math.min(gameState.mazeLayer.width - canvas.width + CAMERA_EDGE_MARGIN, gameState.camera.position.x);
        else // Center on maze is screen is wide enough
            gameState.camera.position.x = -canvas.width / 2 + gameState.mazeLayer.width / 2;

        gameState.camera.position.y =
            Math.min(gameState.mazeLayer.height - canvas.height + CAMERA_EDGE_MARGIN, gameState.camera.position.y);
    }
}

let spectateIndex = 0; // Who are you spectating?
let lastDieTime = -1; // Last time you died, or -1 if alive

/**
 * Get a tank to currently spectate based on spectateIndex
 * @returns Tank
 */
function getSpectateTank() {
    const aliveTanks = gameState.getAliveTanks();
    const l = aliveTanks.length;
    if (!l) return undefined;
    return aliveTanks[((spectateIndex % l) + l) % l];
}


function drawBoard() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!gameState.camera)
        gameState.camera = new Camera(new Vector(0, 0), ctx);

    // Center on self, or if dead, spectate another player
    let tankToCenterOn: Tank | undefined = gameState.tanks[gameState.tankIndex];
    if (tankToCenterOn && tankToCenterOn.isDead) {
        if (lastDieTime < 0)
            lastDieTime = Date.now();
    } else
        lastDieTime = -1;

    // Spectate after a short delay after dying
    const isSpectating = lastDieTime > 0 && Date.now() - lastDieTime > SPECTATE_DELAY;
    if (isSpectating) tankToCenterOn = getSpectateTank();

    centerCamera(tankToCenterOn);

    // Actually draw the state
    gameState.draw();

    // Render if spectating message
    if (tankToCenterOn && isSpectating) {
        ctx.font = '14pt Rajdhani';

        const spectatingMessage = `You are spectating ${tankToCenterOn.username}`;
        const helpString = 'Press LEFT or RIGHT to switch user';
        const x = canvas.width / 2;
        const y = canvas.height - 100;

        const width = Math.max(
            ctx.measureText(helpString).width,
            ctx.measureText(spectatingMessage).width
        ) + 25;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(x - width / 2, y - 20, width, 50);

        ctx.fillStyle = 'white';
        ctx.fillText(spectatingMessage, x, y);
        ctx.fillText(helpString, x, y + 23);
    }

    window.requestAnimationFrame(drawBoard);
}

window.requestAnimationFrame(drawBoard);


// Update rate should be the same as server
setInterval(() => {
    gameState.update();
    gameState.clearDeltas();
}, UPDATE_EVERY_N_MS);


/**
 * ----------------------------------
 * Connection handling
 * ----------------------------------
 */

/**
 * @returns Is connection currently connected
 */
function isConnected() {
    return connection.readyState === WebSocket.OPEN;
}

connection.onopen = () => {
    if (uuid.length === 0) // Create a new game
        connection.send(JSON.stringify({ type: 'CREATE', gameType: 'tanks' }));
    else // Join existing game
        connection.send((JSON.stringify({ type: 'JOIN', gameID: uuid })));
};

interface ServerMessage {
    type: string;
    data: string;
    code: string;
    uuid: string;
    error: string;
    ping: number;
}

connection.onmessage = (msg: { data: string }) => {
    let message = JSON.parse(msg.data) as ServerMessage;

    if (message.type === 'ERROR') {
        if (message.code === 'NO_GAME')
            window.location.href = window.location.href.split('?')[0];
        alert(message.error);
    } else if (message.type === 'UUID') {
        // Game UUID recieved
        let url = window.location.href.split('?')[0] + '?' + message.uuid;
        history.pushState({}, '', url);
        inviteLink.innerText = url;
    } else if (message.type === 'PING') {
        const ping = document.getElementById('ping') as HTMLParagraphElement;
        ping.innerText = 'Ping: ' + (Date.now() - +message.ping) + ' ms';
    }

    gameState.syncFromMessage(message as any);
    handleLobbyMessage(message as any, gameState);
};


/**
 * ----------------------------------
 * User controls (keyboard, mouse, etc...)
 * ----------------------------------
 */

/**
 * Convert an asbsolute screen position to a delta from the tank
 * Basically, convert mouse coord -> vector from tank center
 * @param x screen x
 * @param y screen y
 * @returns [dx, dy]
 */
function getDir(x: number, y: number) {
    if (!gameState.camera || !gameState.tanks || !gameState.tanks[gameState.tankIndex])
        return;
    let pos = gameState.camera.worldToScreen(...gameState.tanks[gameState.tankIndex].position.l());
    return [x - pos[0], y - pos[1]];
}

/**
 * Convert key name -> direction
 * @param key Key press code
 * @returns Direction or null if not a valid key
 */
function keyToDirection(key: string) {
    if (key === CONTROL_KEYS[1]) return Direction.LEFT;
    else if (key === CONTROL_KEYS[3]) return Direction.RIGHT;
    else if (key === CONTROL_KEYS[0]) return Direction.UP;
    else if (key === CONTROL_KEYS[2]) return Direction.DOWN;
    return null;
}

/** Move the client pre-emptively client side */
function moveTankClientSide() {
    const tank = gameState.tanks[gameState.tankIndex];
    if (tank && !tank.isDead) {
        // Get a direction given a key that is active
        const checkKeys = (a: string, b: string) => keys[a] ? a : (keys[b] ? b : '');
        let dx = keyToDirection(checkKeys(CONTROL_KEYS[1], CONTROL_KEYS[3]));
        let dy = keyToDirection(checkKeys(CONTROL_KEYS[0], CONTROL_KEYS[2]));
        if (dx === null) dx = Direction.NONE;
        if (dy === null) dy = Direction.NONE;
        tank.clientSideMove(gameState, [dx, dy]);
    }
}


const keys: Record<string, number> = {};
window.onkeydown = e => {
    if (!isConnected()) return;
    e = e || window.event;

    keys[e.key.toLowerCase()] = 1;
    let dir = keyToDirection(e.key.toLowerCase());

    if (dir !== null) { // Can send a move request in a valid direction
        connection.send(JSON.stringify({ type: 'MOVE', action: Action.MOVE_BEGIN, dir: dir, time: Date.now() }));
        moveTankClientSide();
    }

    // Spectator change tank
    if (e.key.toLowerCase() === 'arrowleft')
        spectateIndex++;
    else if (e.key.toLowerCase() === 'arrowright')
        spectateIndex--;

    if (keys[' '])
        fireGun();
};

window.onkeyup = e => {
    if (!isConnected()) return;
    e = e || window.event;
    if (keys[e.key.toLowerCase()]) {
        keys[e.key.toLowerCase()] = 0;

        let dir = keyToDirection(e.key.toLowerCase());
        if (dir !== null) {
            connection.send(JSON.stringify({ type: 'MOVE', action: Action.MOVE_END, dir: dir, time: Date.now() }));
            moveTankClientSide();
        }
        if (!keys[' '])
            connection.send(JSON.stringify({ type: 'MOVE', action: Action.STOP_FIRE }));
    }
};

setInterval(() => {
    if (!gameState.tanks[gameState.tankIndex])
        return;

    // Keyboard rotation
    const turnRate = keys['shift'] ? ROTATE_SLOW : ROTATE_FAST;
    let changedRot = false;

    if (keys['arrowleft']) {
        gameState.tanks[gameState.tankIndex].rotation -= turnRate;
        changedRot = true;
    } else if (keys['arrowright']) {
        gameState.tanks[gameState.tankIndex].rotation += turnRate;
        changedRot = true;
    }

    if (changedRot) {
        if (gameState.tanks[gameState.tankIndex].rotation > Math.PI * 2)
            gameState.tanks[gameState.tankIndex].rotation -= Math.PI * 2;
        if (gameState.tanks[gameState.tankIndex].rotation < 0)
            gameState.tanks[gameState.tankIndex].rotation += Math.PI * 2;
        UPDATE_ROTATION.call();
    }
}, 50);

// @ts-expect-error
const UPDATE_ROTATION = new RateLimited(
    100, () => {
        if (!isConnected()) return;
        let rotation = gameState.tanks[gameState.tankIndex].rotation;
        connection.send(JSON.stringify({
            type: 'MOVE',
            action: Action.UPDATE_ROTATION,
            rotation
        }));
    }
);

/** Fire tank gun */
function fireGun() {
    let rot = gameState.tanks[gameState.tankIndex].rotation;
    let dir = [Math.cos(rot), Math.sin(rot)];
    UPDATE_ROTATION.f();
    connection.send(JSON.stringify({ type: 'MOVE', action: Action.FIRE, direction: dir }));
}

window.onmousemove = e => {
    const rect = canvas.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;

    let dir = getDir(x, y);
    if (!dir || (dir[0] === 0 && dir[1] === 0)) return;

    let rot = Math.atan2(dir[1], dir[0]);
    if (rot < 0) rot += Math.PI * 2; // Makes turning less jittery

    gameState.tanks[gameState.tankIndex].rotation =
        gameState.tanks[gameState.tankIndex].visualTurretRotation =
        rot;
    UPDATE_ROTATION.call();
};

canvas.onmousedown = e => {
    if (!isConnected()) return;

    // Only fire on left click
    if (e.button !== 0) return;
    fireGun();
};

canvas.onmouseup = e => {
    if (!isConnected()) return;
    connection.send(JSON.stringify({ type: 'MOVE', action: Action.STOP_FIRE }));
};


/**
 * ---------------------------
 * Window resizing
 * ---------------------------
 */
window.onresize = () => {
    canvas.width = window.innerWidth - 250; // Space for sidebar
    canvas.style.width = canvas.width + 'px';
    canvas.height = window.innerHeight;
    canvas.style.height = canvas.height + 'px';
};
// @ts-expect-error
window.onresize();


/**
 * ----------------------------------
 * Disconnect banner
 * - Appears when no longer connected to server
 * - Poll every 500ms for disconnect
 * ----------------------------------
 */
const DISCONNECT_BANNER = document.getElementById('disconnect-banner');
setInterval(() => {
    // Ping server
    if (isConnected())
        // @ts-expect-error
        window.connection.send(JSON.stringify({ type: 'PING', ping: Date.now() }));

    if (!DISCONNECT_BANNER) return;
    if (connection.readyState !== WebSocket.CLOSED)
        DISCONNECT_BANNER.style.top = '-100px';
    else
        DISCONNECT_BANNER.style.top = '0';
}, 500);


/**
 * ----------------------------------
 * Close modals on ESC
 * ----------------------------------
 */
const tutorialModal = document.getElementById('tutorial');
const settingsModal = document.getElementById('settings');
const winnerModal = document.getElementById('winner-modal');

document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && tutorialModal && settingsModal && winnerModal) {
        tutorialModal.style.display = 'none';
        settingsModal.style.display = 'none';
        winnerModal.style.display = 'none';
    }
});


/**
 * ----------------------------------
 * Volume slider in settings
 * ----------------------------------
 */
const volumeSlider = document.getElementById('volume') as HTMLInputElement;
volumeSlider.onchange = e => {
    setGlobalVolume(+volumeSlider.value / 100);
};


/**
 * ----------------------------------
 * Score keeping sidebar
 * ----------------------------------
 */
startScoreKeeping(gameState);
