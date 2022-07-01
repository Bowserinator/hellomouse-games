// Lobby logic, does not interact with main game

import { ROUND_ARRAY, TANK_COLORS, TANK_TEXT_COLORS } from './vars.js';
import { TankSync } from './types.js';
import GameState from './tanks/gamestate.js';
import { getScoreElements } from './score.js';
import Renderable from './renderer/renderable.js';


/**
 * Check if window connection is open
 * @returns Is the connection open?
 */
function connectionOpen() {
    // @ts-expect-error
    return window.connection && window.connection.readyState === WebSocket.OPEN;
}


// Create color buttons from tank colors
const buttonDiv = document.getElementById('color-buttons');
const colorButtons: Array<HTMLButtonElement> = [];

for (let i = 0; i < TANK_COLORS.length; i++) {
    if (!buttonDiv) break;

    const color = TANK_COLORS[i];
    const button = document.createElement('button');
    button.ariaLabel = 'Button of color ' + Renderable.rgbToStr(color);
    button.classList.add('color-button', 'selectable-button');
    button.onclick = () => {
        if (!connectionOpen()) return;

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
const usernameInput: HTMLInputElement = document.getElementById('username') as HTMLInputElement;
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
        if (!connectionOpen()) return;

        // @ts-expect-error
        window.connection.send(JSON.stringify({
            type: TankSync.CHANGE_ROUNDS,
            round: i
        }));
    };
});


/**
 * Update the leaderboard table in the winner modal
 * @param scores Array of [username, score]
 */
function updateWinnersModal(scores: Array<[string, number]>) {
    const table = document.getElementById('leaderboard');
    if (!table) return;

    let newHTML = `<tr><th>Rank</th><th>Player</th><th>Score</th></tr>`;

    let winnerCount = 0;
    let startIndex = 0;
    let position = 1;

    scores.sort((a, b) => b[1] - a[1]);
    while (scores[startIndex]) {
        // Consume all with same score
        const matchScore = scores[startIndex][1];
        const noClass = winnerCount >= 3; // Too many ties

        while (scores[startIndex] && scores[startIndex][1] === matchScore) {
            let className = [
                '',
                ' class="first"',
                ' class="second"',
                ' class="third"'
            ][position] || '';
            if (noClass)
                className = ''; // Too many ties

            newHTML += `<tr${className}>
                <td>${position}</td>
                <td>${scores[startIndex][0]}</td>
                <td>${scores[startIndex][1]}</td>
            </tr>`;
            startIndex++;
            winnerCount++;
        }
        position++;
    }
    table.innerHTML = newHTML;
}


// Handle connections
interface LobbyMessage {
    type: TankSync | string;
    colors: Array<number>; // Array of the color index of each tank in the game
    round: number;
    ready: string;
    id: number;
    scores: Array<[string, number]>;
}

const startGameButton: HTMLButtonElement = document.getElementById('start-game') as HTMLButtonElement;

export function handleLobbyMessage(message: LobbyMessage, gameState: GameState) {
    switch (message.type) {
        // Update colors
        case TankSync.CHANGE_COLOR: {
            colorButtons.forEach(btn => {
                btn.disabled = false;
                btn.innerText = '';
            });
            const scoreElements = getScoreElements();

            for (let i = 0; i < message.colors.length; i++) {
                const colorIndex = message.colors[i];
                if (i === gameState.tankIndex) {
                    colorButtons.forEach(btn => btn.classList.remove('selected'));
                    colorButtons[colorIndex].classList.add('selected');
                    colorButtons[colorIndex].disabled = false;
                    colorButtons[colorIndex].innerText = '';
                } else {
                    colorButtons[colorIndex].disabled = true;
                    colorButtons[colorIndex].innerText = '⛔';
                }

                if (!scoreElements[i])
                    continue;
                scoreElements[i].style.backgroundColor = Renderable.rgbToStr(TANK_COLORS[colorIndex]);
                scoreElements[i].style.color = TANK_TEXT_COLORS[colorIndex] || 'black';
            }
            break;
        }

        // Change round number
        case TankSync.CHANGE_ROUNDS: {
            gameState.totalRounds = ROUND_ARRAY[message.round];
            roundButtons.forEach(b => b.classList.remove('selected'));
            roundButtons[message.round].classList.add('selected');
            roundButtons.forEach(b => b.disabled = gameState.tankIndex !== 0);
            break;
        }

        // Change in tank ready state
        case TankSync.CREATE_ALL_TANKS:
        case TankSync.GENERIC_TANK_SYNC: {
            // Only two message types that cause a ready state change
            if (gameState.tankIndex === 0) {
                startGameButton.innerText = 'Start Game!';
                startGameButton.disabled = !gameState.tanks.every(tank => tank.ready) || gameState.tanks.length < 2;
            } else
                startGameButton.innerText = gameState.tanks[gameState.tankIndex].ready
                    ? 'Unready Self' : 'Ready Self';

            // Update round buttons
            roundButtons.forEach(b => b.disabled = gameState.tankIndex !== 0);
            break;
        }

        // Change in is in lobby, hide / show user config screen
        case TankSync.STATE_SYNC: {
            // @ts-expect-error
            document.getElementById('lobby').style.display = gameState.inLobby ? 'block' : 'none';
            break;
        }

        // Announce winners
        case TankSync.ANNOUNCE_WINNER: {
            // @ts-expect-error
            document.getElementById('winner-modal').style.display = 'block';
            updateWinnersModal(message.scores);
            break;
        }
    }
}

// Repeat requesting a color until loaded
const requestInitialColor = setInterval(() => {
    if (!getScoreElements().length) return;
    if (!connectionOpen()) return;

    // @ts-expect-error
    window.connection.send(JSON.stringify({
        type: TankSync.CHANGE_COLOR,
        color: 0
    }));
    clearInterval(requestInitialColor);
}, 50);


// Username change
const usernameButton = document.getElementById('username-button') as HTMLButtonElement;
usernameButton.onclick = submitUsername;
usernameInput.onkeydown = e => {
    if (e.key === 'Enter') submitUsername();
};

/** Attempt to submit a username change */
function submitUsername() {
    if (!connectionOpen()) return;

    // @ts-expect-error
    window.connection.send(JSON.stringify({
        type: 'USERNAME',
        username: usernameInput.value
    }));
}


// Ready or start game
startGameButton.onclick = () => {
    if (!connectionOpen()) return;

    // @ts-expect-error
    window.connection.send(JSON.stringify({
        type: 'READY'
    }));
};
