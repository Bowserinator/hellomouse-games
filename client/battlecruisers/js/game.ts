


// TODO: load stuff

import { ShipBoard } from './game/board.js';
import { Ship } from './game/ship.js';

const canvas: HTMLCanvasElement = document.getElementById('board') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

// url?<GAME UUID>=
const uuid = window.location.search.substr(1).split('=')[0];


const board = new ShipBoard();
window.ship = Ship;
window.board = board;

function drawBoard() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    board.draw(ctx, 30);
    window.requestAnimationFrame(drawBoard);
}

window.requestAnimationFrame(drawBoard);


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
