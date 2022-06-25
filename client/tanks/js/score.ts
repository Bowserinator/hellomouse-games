import GameState from './tanks/gamestate';

let scoreElements: Array<HTMLElement> = [];

/**
 * Begin polling the score board
 * @param gameState GameState object (client side)
 */
export function startScoreKeeping(gameState: GameState) {
    setInterval(() => {
        if (gameState.tanks.length !== scoreElements.length)
            createScoreElements(gameState);
        else
            // Set scores
            for (let i = 0; i < gameState.tanks.length; i++) {
                const tank = gameState.tanks[i];
                // @ts-expect-error
                scoreElements[i].querySelector('.username').innerText = tank.username;
                // @ts-expect-error
                scoreElements[i].querySelector('.score-number').innerText = tank.score;

                if (tank.isDead)
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

        if (tank.isDead)
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
