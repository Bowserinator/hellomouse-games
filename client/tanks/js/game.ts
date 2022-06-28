import { Bullet } from './tanks/bullets/bullets.js';
import Vector from './tanks/vector2d.js';
import Wall from './tanks/wall.js';
import Tank from './tanks/tank.js';
import Collider from './tanks/collision.js';
import GameState from './tanks/gamestate.js';
import { Direction, Action, TankSync } from './types.js';
import Camera from './renderer/camera.js';
import { CAMERA_EDGE_MARGIN, ROTATE_FAST, ROTATE_SLOW } from './vars.js';;

import connection from './client.js';
import { setGlobalVolume } from './sound/sound.js';
import { startScoreKeeping } from './score.js';
import { handleLobbyMessage } from './lobby.js';

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

// url?<GAME UUID>=
const uuid = window.location.search.substr(1).split('=')[0];


// Game state, shared with client.js
const gameState = new GameState(true);
window.gameState = gameState;
window.connection = connection;

startScoreKeeping(gameState);

function getDir(x, y) {
    if (!gameState.camera || !gameState.tanks || !gameState.tanks[gameState.tankIndex])
        return;
    let pos = gameState.camera.worldToScreen(...gameState.tanks[gameState.tankIndex].position.l());
    return [
        x - pos[0],
        y - pos[1]
    ];
}

function isConnected() {
    return connection.readyState === WebSocket.OPEN;
}


function drawBoard() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!gameState.camera) // TODO move
        gameState.camera = new Camera(new Vector(0, 0), ctx);

    if (gameState.tanks[gameState.tankIndex])
        gameState.camera.position = gameState.tanks[gameState.tankIndex].position.add(
            new Vector(-canvas.width / 2, -canvas.height / 2));

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

    gameState.draw();
}


connection.onopen = () => {
    if (uuid.length === 0) // Create a new game
        connection.send(JSON.stringify({ type: 'CREATE', gameType: 'tanks' }));
    else // Join existing game
        connection.send((JSON.stringify({ type: 'JOIN', gameID: uuid })));
};


connection.onmessage = message => {
    message = JSON.parse(message.data);
    // console.log(message);

    if (message.type === 'ERROR') {
        if (message.code === 'NO_GAME')
            window.location.href = window.location.href.split('?')[0];
        alert(message.error);
    } else if (message.type === 'UUID') {
        // Game UUID recieved
        let url = window.location.href.split('?')[0] + '?' + message.uuid;
        history.pushState({}, '', url);
    }

    gameState.syncFromMessage(message);
    handleLobbyMessage(message, gameState);
};


function keyToDirection(key) {
    if (key === 'a') return Direction.LEFT;
    else if (key === 'd') return Direction.RIGHT;
    else if (key === 'w') return Direction.UP;
    else if (key === 's') return Direction.DOWN;
    return null;
}

const keys: Record<string, number> = {};
window.onkeydown = e => {
    if (!isConnected()) return;
    e = e || window.event;

    let dir = keyToDirection(e.key.toLowerCase());
    if (dir !== null)
        connection.send(JSON.stringify({ type: 'MOVE', action: Action.MOVE_BEGIN, dir: dir }));

    keys[e.key.toLowerCase()] = 1;

    if (keys[' ']) { // Fire
        // Fire gun
        let rot = gameState.tanks[gameState.tankIndex].rotation;
        let dir = [Math.cos(rot), Math.sin(rot)];

        UPDATE_ROTATION.f();
        connection.send(JSON.stringify({ type: 'MOVE', action: Action.FIRE, direction: dir }));
    }
    // TODO: send if valid
};

window.onkeyup = e => {
    if (!isConnected()) return;
    e = e || window.event;
    if (keys[e.key.toLowerCase()]) {
        keys[e.key.toLowerCase()] = 0;

        let dir = keyToDirection(e.key.toLowerCase());
        if (dir !== null)
            connection.send(JSON.stringify({ type: 'MOVE', action: Action.MOVE_END, dir: dir }));

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


window.onmousemove = e => {
    const rect = canvas.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;

    let dir = getDir(x, y);
    if (!dir) return;
    if (dir[0] === 0 && dir[1] === 0)
        return;

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

    // Fire gun
    // TODO: abstract
    let rot = gameState.tanks[gameState.tankIndex].rotation;
    let dir = [Math.cos(rot), Math.sin(rot)];

    UPDATE_ROTATION.f();
    connection.send(JSON.stringify({ type: 'MOVE', action: Action.FIRE, direction: dir }));
};

canvas.onmouseup = e => {
    if (!isConnected()) return;

    // Fire gun TODO
    // TODO: get curent tank position & shit
    connection.send(JSON.stringify({ type: 'MOVE', action: Action.STOP_FIRE }));
};

window.onresize = () => {
    // TODO aspect ratio this shit
    canvas.width = window.innerWidth - 250; // Space for sidebar
    canvas.style.width = canvas.width + 'px';
    canvas.height = window.innerHeight;
    canvas.style.height = canvas.height + 'px';
};
window.onresize();

function animFrame(timestamp) {
    drawBoard();
    window.requestAnimationFrame(animFrame);
}
window.requestAnimationFrame(animFrame);


// TODO
setInterval(() => {
    gameState.update();
}, 30);


const DISCONNECT_BANNER = document.getElementById('disconnect-banner');
setInterval(() => {
    if (!DISCONNECT_BANNER) return;
    if (connection.readyState !== WebSocket.CLOSED)
        DISCONNECT_BANNER.style.top = '-100px';
    else
        DISCONNECT_BANNER.style.top = '0';
}, 500);


// Close modals on ESC
const tutorialModal = document.getElementById('tutorial');
const settingsModal = document.getElementById('settings');

document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && tutorialModal && settingsModal) {
        tutorialModal.style.display = 'none';
        settingsModal.style.display = 'none';
    }
});

// Volume slider
const volumeSlider = document.getElementById('volume');
if (volumeSlider)
    volumeSlider.onchange = e => {
        setGlobalVolume(volumeSlider.value / 100);
    };
