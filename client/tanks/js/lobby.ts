// Lobby logic, does not interact with main game

import { TANK_COLORS, TANK_TEXT_COLORS } from './vars.js';
import { TankSync } from './types.js';
import GameState from './tanks/gamestate.js';
import { getScoreElements } from './score.js';
import Renderable from './renderer/renderable.js';


// Create color buttons from tank colors
const buttonDiv = document.getElementById('color-buttons');
const colorButtons: Array<HTMLButtonElement> = [];

for (let i = 0; i < TANK_COLORS.length; i++) {
    if (!buttonDiv) break;

    const color = TANK_COLORS[i];
    const button = document.createElement('button');
    button.classList.add('color-button', 'selectable-button');
    button.onclick = () => {
        // @ts-expect-error
        window.connection.send(JSON.stringify({
            type: TankSync.CHANGE_COLOR,
            color: i
        }));
    };
    button.style.backgroundColor = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
    buttonDiv.appendChild(button);
    colorButtons.push(button);
}

// Char counter
const usernameInput = document.getElementById('username');
if (usernameInput)
    usernameInput.oninput = () => {
        const label = document.getElementById('username-char-count');
        // @ts-expect-error
        if (label) label.innerText = `(${usernameInput.value.length} / 16)`;
    };

// Round selection
// @ts-expect-error
const roundButtons = [...document.getElementById('round-buttons').getElementsByTagName('button')];
roundButtons.forEach((btn, i) => {
    btn.onclick = () => {
        console.log('Round number', i);
        roundButtons.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
    };
});


// Handle connections
export function handleLobbyMessage(message, gameState: GameState) {
    // Update colors
    if (message.type === TankSync.CHANGE_COLOR) {
        colorButtons.forEach(btn => btn.disabled = false);
        const scoreElements = getScoreElements();

        for (let i = 0; i < message.colors.length; i++) {
            const colorIndex = message.colors[i];
            if (i === gameState.tankIndex) {
                colorButtons.forEach(btn => btn.classList.remove('selected'));
                colorButtons[colorIndex].classList.add('selected');
                colorButtons[colorIndex].disabled = false;
            } else
                colorButtons[colorIndex].disabled = true;
            scoreElements[i].style.backgroundColor = Renderable.rgbToStr(TANK_COLORS[colorIndex]);
            scoreElements[i].style.color = TANK_TEXT_COLORS[colorIndex];
        }
    }
}

// Repeat requesting a color
const requestInitialColor = setInterval(() => {
    if (!getScoreElements().length) return;
    // @ts-expect-error
    window.connection.send(JSON.stringify({
        type: TankSync.CHANGE_COLOR,
        color: 0
    }));
    clearInterval(requestInitialColor);
}, 50);
