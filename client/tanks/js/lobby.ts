// Lobby logic, does not interact with main game

import { ROUND_ARRAY, TANK_COLORS, TANK_TEXT_COLORS } from './vars.js';
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

// Char counter + validation
const usernameInput: HTMLInputElement | null = document.getElementById('username') as HTMLInputElement | null;
if (usernameInput)
    usernameInput.oninput = () => {
        // Delete non-alphanumeric _
        usernameInput.value = usernameInput.value.replace(/[^A-Za-z0-9_]/g, '');

        const label = document.getElementById('username-char-count');
        if (label) label.innerText = `(${usernameInput.value.length} / 16)`;
    };

// Round selection
// @ts-expect-error
const roundButtons = [...document.getElementById('round-buttons').getElementsByTagName('button')];
roundButtons.forEach((btn, i) => {
    btn.onclick = () => {
        // @ts-expect-error
        window.connection.send(JSON.stringify({
            type: TankSync.CHANGE_ROUNDS,
            round: i
        }));
    };
});


// Handle connections
interface LobbyMessage {
    type: TankSync;
    colors: Array<number>; // Array of the color index of each tank in the game
    round: number;
}

export function handleLobbyMessage(message: LobbyMessage, gameState: GameState) {
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
    } else if (message.type === TankSync.CHANGE_ROUNDS) {
        gameState.totalRounds = ROUND_ARRAY[message.round];
        roundButtons.forEach(b => b.classList.remove('selected'));
        roundButtons[message.round].classList.add('selected');

        if (gameState.tankIndex !== 0)
            roundButtons.forEach(b => b.disabled = true);
    }
}

// Repeat requesting a color until loaded
const requestInitialColor = setInterval(() => {
    if (!getScoreElements().length) return;
    // @ts-expect-error
    window.connection.send(JSON.stringify({
        type: TankSync.CHANGE_COLOR,
        color: 0
    }));
    clearInterval(requestInitialColor);
}, 50);


// Username change
const usernameButton = document.getElementById('username-button');
// @ts-expect-error
usernameButton.onclick = submitUsername;
// @ts-expect-error
usernameInput.onkeydown = e => {
    if (e.key === 'Enter') submitUsername();
};

/** Attempt to submit a username change */
function submitUsername() {
    if (!usernameInput) return;

    // @ts-expect-error
    window.connection.send(JSON.stringify({
        type: 'USERNAME',
        username: usernameInput.value
    }));
}
