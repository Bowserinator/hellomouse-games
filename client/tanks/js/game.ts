import { Bullet, NormalBullet } from './tanks/bullets.js';
import Vector from './tanks/vector2d.js';
import Wall from './tanks/wall.js';
import Tank from './tanks/tank.js';
import Collider from './tanks/collision.js';
import GameState from './tanks/gamestate.js';
import { Direction, Action, TankSync } from './types.js';
import Camera from './renderer/camera.js';

import connection from './client.js';

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

// url?<GAME UUID>=
const uuid = window.location.search.substr(1).split('=')[0];


/**
 * Fill square centered on (x, y)
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {string} color
 */
function drawCenteredSquare(x, y, width, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x - width / 2, y - width / 2, width, width);
}




// Game state, shared with client.js
const gameState = new GameState(true);
window.gameState = gameState;


function drawBoard() {
    // if (gameState.tanks[0]) {
    //     if (keys['a'])
    //         gameState.tanks[0].movement[0] = Direction.LEFT;
    //     else if (keys['d'])
    //         gameState.tanks[0].movement[0] = Direction.RIGHT;
    //     else
    //         gameState.tanks[0].movement[0] = Direction.NONE;
    //     if (keys['w'])
    //         gameState.tanks[0].movement[1] = Direction.UP;
    //     else if (keys['s'])
    //         gameState.tanks[0].movement[1] = Direction.DOWN;
    //     else
    //         gameState.tanks[0].movement[1] = Direction.NONE;
    // }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!gameState.camera) // TODO move
        gameState.camera = new Camera(new Vector(0, 0), ctx);

    if (gameState.tanks[0])
        gameState.camera.position = gameState.tanks[0].position.add(
            new Vector(-canvas.width / 2, -canvas.height / 2));

    gameState.update();

    gameState.draw();

    if (keys[' ']) // Fire
        console.log('Fire');
}


connection.onopen = () => {
    if (uuid.length === 0) // Create a new game
        connection.send(JSON.stringify({ type: 'CREATE', gameType: 'tanks' }));
    else // Join existing game
        connection.send((JSON.stringify({ type: 'JOIN', gameID: uuid })));
};


connection.onmessage = message => {
    message = JSON.parse(message.data);
    console.log(message);

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
};


function keyToDirection(key) {
    if (key === 'a') return Direction.LEFT;
    else if (key === 'd') return Direction.RIGHT;
    else if (key === 'w') return Direction.UP;
    else if (key === 's') return Direction.DOWN;
    return null;
}

const keys = {};
window.onkeydown = e => {
    e = e || window.event;

    let dir = keyToDirection(e.key);
    if (dir !== null)
        connection.send(JSON.stringify({ type: 'MOVE', action: Action.MOVE_BEGIN, dir: dir }));

    keys[e.key] = 1;
    // TODO: send if valid
};

window.onkeyup = e => {
    e = e || window.event;
    if (keys[e.key]) {
        keys[e.key] = 0;

        let dir = keyToDirection(e.key);
        if (dir !== null)
            connection.send(JSON.stringify({ type: 'MOVE', action: Action.MOVE_END, dir: dir }));
    }
};


window.onmousemove = e => {
    // TODO aim gun
};

window.onmousedown = e => {
    // Fire gun TODO
    // TODO: get curent tank position & shit
    const rect = canvas.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;
    let dir = [
        x - canvas.width / 2,
        y - canvas.height / 2
    ]; // TODO

    connection.send(JSON.stringify({ type: 'MOVE', action: Action.FIRE, direction: dir }));
};

window.onmouseup = e => {
    // Fire gun TODO
    // TODO: get curent tank position & shit
    connection.send(JSON.stringify({ type: 'MOVE', action: Action.STOP_FIRE }));
};

window.onresize = () => {
    // TODO aspect ratio this shit
    canvas.width = window.innerWidth;
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