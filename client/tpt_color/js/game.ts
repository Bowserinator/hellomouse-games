import { ELEMENT_NAMES, GUESS_TIME, TOTAL_ROUNDS } from './data.js';

// url?<GAME UUID>=
const uuid = window.location.search.substr(1).split('=')[0];

// createConnection() is in a shared JS file
// @ts-expect-error
const connection = createConnection();

// @ts-expect-error
window.connection = connection;

// Global state
let isHost = false;
let lastRoundStart = 0;
let state = 'lobby';

/**
 * Check if window connection is open
 * @returns Is the connection open?
 */
function connectionOpen() {
    // @ts-expect-error
    return window.connection && window.connection.readyState === WebSocket.OPEN;
}

/**
 * Chat sending
 */
const chatInput = document.getElementById('chat-input') as HTMLInputElement;
chatInput.onkeydown = e => {
    if (e.key === 'Enter') {
        if (!chatInput.value) return;
        connection.send(JSON.stringify({
            type: 'CHAT',
            message: chatInput.value
        }));
        chatInput.value = '';
    }
};


/**
 * ---------------------------
 * Connection handling
 * ---------------------------
 */
connection.onopen = () => {
    if (uuid.length === 0) // Create a new game
        connection.send(JSON.stringify({ type: 'CREATE', gameType: 'tpt_color' }));
    else // Join existing game
        connection.send((JSON.stringify({ type: 'JOIN', gameID: uuid })));
};

connection.onerror = (error: any) => console.error(error);


/*
 * ----------------------------------
 * Disconnect banner
 * - Appears when no longer connected to server
 * - Poll every 500ms for disconnect
 * ----------------------------------
 */
const DISCONNECT_BANNER = document.getElementById('disconnect-banner');
setInterval(() => {
    if (!DISCONNECT_BANNER) return;
    if (connection.readyState !== WebSocket.CLOSED)
        DISCONNECT_BANNER.style.top = '-100px';
    else
        DISCONNECT_BANNER.style.top = '0';
}, 500);


const lobby = document.getElementById('lobby') as HTMLDivElement;
const inviteLink = document.getElementById('link') as HTMLParagraphElement;
const gameLink = document.getElementById('game-link') as HTMLParagraphElement;

const chatMessages = document.getElementById('messages') as HTMLDivElement;

/**
 * Used in the copy link to clipboard
 * @param {string} text Text to copy
 */
function copyLinkToClipboard(text: string) {
    gameLink.classList.add('flash');
    setTimeout(() => gameLink.classList.remove('flash'), 500);
    // @ts-expect-error
    copyToClipboard(text);
}

gameLink.onclick = () => copyLinkToClipboard(inviteLink.innerText);


/** Attempt to submit a username change */
const usernameInput = document.getElementById('username') as HTMLInputElement;
usernameInput.onkeydown = e => {
    if (e.key === 'Enter' || e.keyCode === 13) {
        submitUsername();
        usernameInput.value = '';
    }
};

function submitUsername() {
    if (!connectionOpen()) return;

    // @ts-expect-error
    window.connection.send(JSON.stringify({
        type: 'USERNAME',
        username: usernameInput.value
    }));
}

/* Ready state update */
// Ready or start game
const startGameButton = document.getElementById('ready') as HTMLButtonElement;
const solutionLabel = document.getElementById('solution') as HTMLDivElement;
const elementGuessInput = document.getElementById('element-guess') as HTMLInputElement;
const playerScores = document.getElementById('game-player-scores') as HTMLDivElement;

startGameButton.onclick = () => {
    if (!connectionOpen()) return;

    // @ts-expect-error
    window.connection.send(JSON.stringify({
        type: 'READY'
    }));
};

function renderPlayerList(message: any) {
    playerScores.innerHTML = message.players
        .sort((a: any, b: any) => b[1] - a[1])
        .map((p: any) =>
            `<div class="player ${p[3] ? 'got-it' : ''}">
            <span class="score">${p[1]}</span>${p[0]}
            <span class="guess">${p[2]}</span></div>`)
        .join('\n');
}


connection.onmessage = (message: any) => {
    message = JSON.parse(message.data);

    switch (message.type) {
        case 'ERROR': {
            if (message.code === 'NO_GAME')
                window.location.href = window.location.href.split('?')[0];
            alert(message.error);
            break;
        }
        case 'CHAT': {
            // @ts-expect-error
            let msg = chatToHTML(`[${message.username}] ${message.message}`);
            let isAtBottom =
                Math.abs(chatMessages.scrollTop - chatMessages.scrollHeight + chatMessages.offsetHeight) < 10;
            chatMessages.appendChild(msg);

            if (isAtBottom) // Auto scroll down
                chatMessages.scrollTop = chatMessages.scrollHeight;
            break;
        }
        case 'UUID': {
            // Game UUID recieved
            let url = window.location.href.split('?')[0] + '?' + message.uuid;
            history.pushState({}, '', url);
            inviteLink.innerText = url;
            break;
        }
        case 'SYNC': {
            let playerList = '<ol>';
            for (let player of message.players) {
                if (!player) continue;
                playerList += `<li id="userlist-${player.username}" class="${player.ready ? 'active' : ''}">
                    <span style="font-size: 12pt; color: ${player.ready ? '#66ff52' : 'gray'}">█ &nbsp;</span>${player.username}
                </li>`;
            }
            playerList += '</ol>';
            (document.getElementById('lobby-player-list') as HTMLDivElement).innerHTML = playerList;

            if (isHost)
                startGameButton.disabled = message.players.length < 2 ||
                    message.players.filter((p: any) => p !== null).some((p: any) => !p.ready);
            break;
        }
        case 'YOUARE': {
            // You are host
            if (message.index === 0) {
                isHost = true;
                startGameButton.innerText = 'Start Game';
            }

            // Update ready button
            if (!isHost)
                if (message.ready)
                    startGameButton.classList.add('active');
                else
                    startGameButton.classList.remove('active');

            const self = document.getElementById(`userlist-${message.username}`);
            if (self) self.style.color = 'gold';
            break;
        }

        case 'STATE': {
            const showGame = message.state === 'GAME';
            lobby.style.display = showGame ? 'none' : 'block';
            (document.getElementById('game') as HTMLDivElement).style.display = !showGame ? 'none' : 'block';

            if (!showGame && state !== 'lobby') {
                // Show winner modal
                // @ts-expect-error
                document.getElementById('win-modal').style.display = 'block';
                state = 'lobby';
            } else if (showGame)
                state = 'game';

            break;
        }

        // Get question
        case 'TURN_QUESTION': {
            solutionLabel.innerText = '';
            (document.getElementById('element-color') as HTMLDivElement).style.backgroundColor = message.color;
            elementGuessInput.disabled = false;
            elementGuessInput.value = '';
            dropdown.innerHTML = '';
            lastRoundStart = Date.now();
            (document.getElementById('game-round') as HTMLDivElement).innerText = `${message.round} / ${TOTAL_ROUNDS}`;
            renderPlayerList(message);
            break;
        }

        // Get answer
        case 'TURN_ANSWER': {
            let color = message.color.replace('#', '');
            let red = Number.parseInt(color.substring(0, 2), 16);
            let green = Number.parseInt(color.substring(2, 4), 16);
            let blue = Number.parseInt(color.substring(4, 6), 16);

            solutionLabel.style.color = 'white';
            solutionLabel.innerText = message.answer;
            elementGuessInput.value = submittedGuess.innerText;
            elementGuessInput.disabled = true;
            submittedGuess.innerText = '';

            if ((red * 0.299 + green * 0.587 + blue * 0.114) > 150)
                solutionLabel.style.color = 'black';

            // Update player list
            renderPlayerList(message);

            (document.getElementById('winner-list') as HTMLOListElement).innerHTML = message.players
                .sort((a: any, b: any) => b[1] - a[1])
                .map((p: any) => `<li>${p[0]}  <span style="float:right">${p[1]}</span></li>`)
                .join('\n');
            break;
        }
    }
};

// Update the clock
const timeLeft = document.getElementById('time-left') as HTMLDivElement;
setInterval(() => {
    const diff = lastRoundStart + GUESS_TIME * 1000 - Date.now();
    timeLeft.innerText = diff < 0 ? 'Time\'s up' : (diff / 1000).toFixed(1);
}, 100);

// Element dropdown preview
const dropdown = document.getElementById('filtered-results') as HTMLDivElement;
const submittedGuess = document.getElementById('submitted-guess') as HTMLSpanElement;

// Dropdown state
let dropdownI = -1;
let dropdownSize = 1;

/**
 * Submit the guess for an element
 * @param guess Guess
 */
// @ts-expect-error
window.submitGuess = (guess: string) => {
    if (!guess) return;
    elementGuessInput.value = guess;
    dropdown.innerHTML = '';
    connection.send(JSON.stringify({
        type: 'MOVE',
        answer: guess
    }));
    submittedGuess.innerText = guess.toUpperCase().trim();
};

// @ts-expect-error
elementGuessInput.onkeyup =
elementGuessInput.onfocus = e => {
    // @ts-expect-error
    if (e.key === 'Enter' && dropdownI < 0)
        // @ts-expect-error
        window.submitGuess(elementGuessInput.value);
    // @ts-expect-error
    else if (!['Enter', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const val = elementGuessInput.value.toUpperCase().trim();
        const possible = val.length === 0 ? [] : ELEMENT_NAMES.filter(name => name.startsWith(val))
            .concat(ELEMENT_NAMES.filter(name => !name.startsWith(val) && name.includes(val)));
        dropdown.innerHTML = possible.map(x => `<div onclick="submitGuess('${x}')">${x}</div>`).join('\n');

        if (dropdownSize !== possible.length)
            dropdownI = -1;
        dropdownSize = possible.length || 1;
    }
};

// Dropdown keyboard controls
window.onkeydown = e => {
    // @ts-expect-error
    let options = [...dropdown.getElementsByTagName('div')];

    function redrawOptions() {
        let option = options[dropdownI];
        if (option) {
            options.forEach(o => o.classList.remove('active'));
            option.classList.add('active');
            option.scrollIntoView();
        }
    }

    switch (e.key) {
        case 'ArrowDown':
            dropdownI++;
            dropdownI = Math.min(dropdownI, dropdownSize - 1);
            redrawOptions();
            break;
        case 'ArrowUp':
            dropdownI--;
            dropdownI = Math.max(0, dropdownI);
            redrawOptions();
            break;
        case '`':
            setTimeout(() => chatInput.focus(), 100);
            break;
        case 'Enter': {
            let option = options[dropdownI];
            if (option)
                // @ts-expect-error
                window.submitGuess(option.innerText);
            break;
        }
    }
};
