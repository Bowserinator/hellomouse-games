import { Bullet, NormalBullet } from './tanks/bullets.js';
import Vector from './tanks/vector2d.js';
import Wall from './tanks/wall.js';
import Collider from './tanks/collision.js';
import generateMap from './tanks/map-gen.js';
import GameState from './tanks/gamestate.js';

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');


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

    gameState.enemyTanks.forEach(tank => tank.update());
    gameState.playerTank.update();
    gameState.bullets.forEach(bullet => bullet.update());

    gameState.enemyTanks.forEach(tank => tank.draw(ctx));
    gameState.playerTank.draw(ctx);
    gameState.walls.forEach(wall => wall.draw(ctx));
    gameState.bullets.forEach(bullet => bullet.draw(ctx));

    if (keys[' ']) // Fire
        console.log('Fire');
    if (keys['a'])
        gameState.playerTank.velocity.x = -5;
    else if (keys['d'])
        gameState.playerTank.velocity.x = 5;
    else
        gameState.playerTank.velocity.x *= 0.9;
    if (keys['w'])
        gameState.playerTank.velocity.y = -5;
    else if (keys['s'])
        gameState.playerTank.velocity.y = 5;
    else
        gameState.playerTank.velocity.y *= 0.9;
}


const keys = {};
window.onkeydown = e => {
    e = e || window.event;
    keys[e.key] = 1;
}

window.onkeyup = e => {
    e = e || window.event;
    if (keys[e.key])
        keys[e.key] = 0;
}


window.onmousemove = e => {
    // TODO aim gun
};

window.onmousedown = e => {
    // Fire gun TODO
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