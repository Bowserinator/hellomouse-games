window.WebSocket = window.WebSocket || window.MozWebSocket;

const connection = new WebSocket('ws://127.0.0.1:1337');
const uuid = window.location.search.substr(1);


function setPlayer(id, index) {
    if (index >= 2) return;
    let div = document.getElementById(id);
    div.innerText = index === 0 ? 'BLACK' : 'WHITE';
    div.classList.remove('black');
    div.classList.remove('white');
    div.classList.add(index === 0 ? 'black' : 'white');
}

function IDToName(i) {
    if (i === 0) return 'Black';
    else if (i === 1) return 'White';
    return 'Spectator'
}

function copyToClipboard(text) {
    document.getElementById('link').classList.add('flash');
    setTimeout(() => {
        document.getElementById('link').classList.remove('flash');
    }, 500);    

    if (window.clipboardData && window.clipboardData.setData) {
        // Internet Explorer-specific code path to prevent textarea being shown while dialog is visible.
        return window.clipboardData.setData("Text", text);
    }
    else if (document.queryCommandSupported && document.queryCommandSupported("copy")) {
        var textarea = document.createElement("textarea");
        textarea.textContent = text;
        textarea.style.position = "fixed";  // Prevent scrolling to bottom of page in Microsoft Edge.
        document.body.appendChild(textarea);
        textarea.select();
        try {
            return document.execCommand("copy");  // Security exception may be thrown by some browsers.
        }
        catch (ex) {
            console.warn("Copy to clipboard failed.", ex);
            return prompt("Copy to clipboard: Ctrl+C, Enter", text);
        }
        finally {
            document.body.removeChild(textarea);
        }
    }
}

function updateButtonDisabled() {
    document.getElementById('submit').disabled =
        (!gameState.started || (gameState.turn !== gameState.currentTurn) ||
         gameState.maxMoves !== gameState.moves.length);
}

function updateHTML() {
    setPlayer('youare', gameState.turn);
    setPlayer('turn', gameState.currentTurn);
    updateButtonDisabled();
}

/** Finalize moves to server */
function submitMoves() {
    if (gameState.moves.length !== gameState.maxMoves) return;
    connection.send(JSON.stringify({ type: 'MOVE', moves: gameState.moves }));
}

function restart() {
    connection.send(JSON.stringify({ type: 'MOVE', restart: true }));
}

// Connection handling
connection.onopen = () => {
    if (uuid.length === 0) // Create a new game
        connection.send(JSON.stringify({ type: 'CREATE', gameType: 'connect6' }));
    else // Join existing game
        connection.send((JSON.stringify({ type: 'JOIN', gameID: uuid })));
};

connection.onerror = error => console.error(error);

connection.onmessage = message => {
    message = JSON.parse(message.data);
    console.log(message);

    if (message.type === 'ERROR') {
        if (message.error.includes('GameID of') && message.error.includes('exist'))
            window.location.href = window.location.href.split('?')[0];
        alert(message.error);
    }
    else if (message.type === 'UUID') {
        let url = window.location.href.split('?')[0] + '?' + message.uuid;
        history.pushState({}, '', url);
        document.getElementById('link').innerText = url;
    }
    else if (message.type === 'SYNC') {
        gameState.started = message.players[0] && message.players[1];
        gameState.board = message.board;
        gameState.turn = message.youAre;
        gameState.currentTurn = message.turn;
        gameState.currentRound = message.round;

        if (!message.players[0]) document.getElementById('player0').classList.add('missing');
        else document.getElementById('player0').classList.remove('missing');
        if (!message.players[1]) document.getElementById('player1').classList.add('missing');
        else document.getElementById('player1').classList.remove('missing');

        gameState.placing = !message.winner && message.turn === message.youAre && message.players[1];
        gameState.maxMoves = message.round === 0 ? 1 : 2;
        gameState.moves = [];
        gameState.winner = message.winner;
        gameState.winningLine = message.winningLine;

        if (gameState.winner) {
            document.getElementById('modals').style.display = 'block';
            document.getElementById('winner').innerText = `${['Black', 'White'][gameState.winner - 1]} wins!`;
        } else {
            document.getElementById('modals').style.display = 'none';
        }

        drawBoard();
        updateHTML();
    }
};

updateHTML();

document.addEventListener('keyup', event => {
    if (event.key === 'Enter')
        submitMoves();
});