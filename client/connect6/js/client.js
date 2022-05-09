window.WebSocket = window.WebSocket || window.MozWebSocket;

const connection = new WebSocket(`ws://${window.location.host || 'localhost:8124'}`);
const uuid = window.location.search.substr(1).split('=')[0]; // TODO: replace with global arg parsing


function setPlayer(id, index) {
    let div = document.getElementById(id);
    div.innerText = IDToName(index).toUpperCase();
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
    document.getElementsByClassName('game-link')[0].classList.add('flash');
    setTimeout(() => {
        document.getElementsByClassName('game-link')[0].classList.remove('flash');
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
    
    let reason = document.getElementById('disabled-reason');
    reason.style.visibility = 'visible';
    if (!gameState.started)
        reason.innerText = '⚠️' + "[ Game has not started ]";
    else if (gameState.turn !== gameState.currentTurn)
        reason.innerText = '⚠️' + "[ It's not your turn ]";
    else if (gameState.maxMoves !== gameState.moves.length)
        reason.innerText = '⚠️' + "[ You still need to make some moves! ]";
    else
        reason.style.visibility = 'hidden';
}

function updateHTML() {
    setPlayer('youare', gameState.turn);
    updateButtonDisabled();

    // Update turn
    setPlayer('turn', gameState.currentTurn);
    if (gameState.currentTurn === gameState.turn)
        document.getElementById('turn').innerText = 'IT IS YOUR TURN — (Move 1/2)';
    else
        document.getElementById('turn').innerText = `IT IS ${IDToName(gameState.currentTurn).toUpperCase()}'S TURN`;
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

        document.title = "Connect6 | " + IDToName(gameState.currentTurn) + "'s turn";

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