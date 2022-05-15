import { Bullet, NormalBullet } from './tanks/bullets.js';
import Vector from './tanks/vector2d.js';
import Wall from './tanks/wall.js';
import Tank from './tanks/Tank.js';
import Collider from './tanks/collision.js';
import generateMap from './tanks/map-gen.js';
import GameState from './tanks/gamestate.js';
import { Direction, Action, TankSync } from './types.js';

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
const gameState = new GameState();
window.gameState = gameState;

for (let i = 0; i < 50; i++)
    gameState.bullets.push(new NormalBullet(new Vector(10, 10), new Vector(Math.random() * 10, Math.random() * 10)));

// Add bounding colliders
// gameState.walls.push(new Wall([-100, 0], [100, 1000]));
// gameState.walls.push(new Wall([1000, 0], [1000, 1000]));
// gameState.walls.push(new Wall([0, -100], [1000, 100]));
// gameState.walls.push(new Wall([0, 500], [1000, 100]));

generateMap();

function drawBoard() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    gameState.update();

    gameState.bullets.forEach(bullet => bullet.update());

    gameState.tanks.forEach(tank => tank.draw(ctx));
    gameState.walls.forEach(wall => wall.draw(ctx));
    gameState.bullets.forEach(bullet => bullet.draw(ctx));

    if (keys[' ']) // Fire
        console.log('Fire');
    // if (keys['a'])
    //     gameState.playerTank.velocity.x = -5;
    // else if (keys['d'])
    //     gameState.playerTank.velocity.x = 5;
    // else
    //     gameState.playerTank.velocity.x *= 0.9;
    // if (keys['w'])
    //     gameState.playerTank.velocity.y = -5;
    // else if (keys['s'])
    //     gameState.playerTank.velocity.y = 5;
    // else
    //     gameState.playerTank.velocity.y *= 0.9;
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

    if (message.type === TankSync.TANK_POS) {
        if (!gameState.tanks[message.id]) return; // TODO hack
        gameState.tanks[message.id].movement = message.movement;
        gameState.tanks[message.id].position = new Vector(...message.position);
        gameState.tanks[message.id].rotation = message.rotation;
    }
    else if (message.type === TankSync.UPDATE_ALL_TANKS) { // TODO batch
        gameState.tanks = [];
        for (let i = 0; i < message.positions.length; i++) {
            gameState.addTank(new Tank(new Vector(...message.positions[i]), message.rotations[i]));
        }
    }
    else if (message.type === TankSync.ADD_BULLET) {
        // TODO check type
        let bullet = new NormalBullet(new Vector(...message.position), new Vector(...message.velocity));
        gameState.addBullet(bullet);
    }

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
    connection.send(JSON.stringify({ type: 'MOVE', action: Action.FIRE, direction: [1, 1] }));
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