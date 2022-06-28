import Renderable from './renderer/renderable.js';
import GameState from './tanks/gamestate.js';
import { TANK_COLORS, TANK_TEXT_COLORS } from './vars.js';

let scoreElements: Array<HTMLElement> = [];

/**
 * Ref to score elements
 * @returns score elements
 */
export function getScoreElements() {
    return scoreElements;
}

/**
 * Begin polling the score board
 * @param gameState GameState object (client side)
 */
export function startScoreKeeping(gameState: GameState) {
    setInterval(() => {
        // Update round number
        const roundLabel = document.getElementById('round');
        const newRoundText = `ROUND ${gameState.round} / ${gameState.totalRounds}`;
        if (roundLabel && roundLabel.innerText !== newRoundText)
            roundLabel.innerText = newRoundText;

        // Update score board
        if (gameState.tanks.length !== scoreElements.length)
            createScoreElements(gameState);
        else
            // Set scores
            for (let i = 0; i < gameState.tanks.length; i++) {
                const tank = gameState.tanks[i];
                const usernameLabel: HTMLParagraphElement | null = scoreElements[i].querySelector('.username');
                const scoreLabel: HTMLParagraphElement | null = scoreElements[i].querySelector('.score-number');

                if (usernameLabel && usernameLabel.innerText !== tank.username)
                    usernameLabel.innerText = tank.username;
                if (scoreLabel && scoreLabel.innerText !== '' + tank.score)
                    scoreLabel.innerText = tank.score + '';

                if (tank.isDead || !tank.ready)
                    scoreElements[i].classList.add('dead');
                else scoreElements[i].classList.remove('dead');
            }
    }, 100);
}

/**
 * Recreate the entire scoreboard (call only when tank is added or removed)
 * @param gameState GameState client obj
 */
export function createScoreElements(gameState: GameState) {
    scoreElements = [];
    for (let i = 0; i < gameState.tanks.length; i++) {
        const tank = gameState.tanks[i];
        const newScore = document.createElement('p');

        newScore.classList.add('score');
        newScore.style.backgroundColor = tank.tintPrefix;
        // Convert colors to strings so indexOf works
        newScore.style.color = TANK_TEXT_COLORS[TANK_COLORS.map(Renderable.rgbToStr).indexOf(Renderable.rgbToStr(tank.tint))] || 'black';

        if (tank.isDead || !tank.ready)
            newScore.classList.add('dead');
        if (i === gameState.tankIndex)
            newScore.classList.add('you');

        const username = document.createElement('span');
        username.classList.add('username');
        username.innerText = tank.username;
        const score = document.createElement('span');
        score.classList.add('score-number');
        // @ts-expect-error
        score.innerText = tank.score;

        newScore.appendChild(username);
        newScore.appendChild(score);
        scoreElements.push(newScore);
    }

    const container = document.getElementById('scores');
    // @ts-expect-error
    container.replaceChildren(...scoreElements);
}
