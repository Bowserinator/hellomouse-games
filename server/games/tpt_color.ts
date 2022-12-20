import Game from '../game.js';
import Client from '../client.js';
import {
    UPDATE_EVERY_N_MS,
    MAX_PLAYERS,
    GUESS_TIME,
    GRACE_LAG,
    REVEAL_TIME,
    COLORS,
    COLORS_MAP,
    TOTAL_ROUNDS,
    OTHER_NAMES,
    OTHER_NAMES_INV
} from '../../client/tpt_color/js/data.js';

// States:
// Lobby - waiting for players
// Guessing - Send all players a guess
// Reveal - Reval the correct answer
enum TPTState {
    LOBBY,
    GUESSING,
    REVEAL
}

interface TPTColorMessage {
    answer: string;
}

class TPTColorGame extends Game {
    round: number;
    state: TPTState;
    guessStartTime: number;
    revealStartTime: number;
    interval: ReturnType<typeof setInterval> | null;
    color: string;
    scores: any; // player id: number (score)
    guesses: any; // player id: string
    gotit: any; // player id: boolean
    picked: Array<string>;

    constructor() {
        super();
        this.round = 0;
        this.interval = null;
    }

    onRoomCreate() {
        this.round = 0;
        this.interval = null;
        this.guessStartTime = -1;
        this.revealStartTime = -1;
        this.scores = {};
        this.guesses = {};
        this.gotit = {};
        this.picked = [];
    }

    globalStateSync(player: Client) {
        return {
            type: 'SYNC',
            players: this.players.slice(0, MAX_PLAYERS).map(x => {
                if (!x) return null;
                return {
                    username: x.username,
                    ready: x.ready
                };
            })
        };
    }

    onMove(client: Client, message: TPTColorMessage) {
        // Message format:
        // { type: 'MOVE', answer: string }
        if (!message.answer || this.state !== TPTState.GUESSING) return;

        // Check if correct
        let guess = message.answer;
        // @ts-expect-error
        guess = OTHER_NAMES[guess] || guess;
        guess = guess.trim().toUpperCase();

        if (this.scores[client.id] === undefined)
            this.scores[client.id] = 0;
        this.guesses[client.id] = guess || '???';

        // @ts-expect-error
        if (COLORS_MAP[this.color].includes(guess)) {
            this.gotit[client.id] = true;
            this.scores[client.id]++;
        } else
            this.gotit[client.id] = false;
    }

    forceResync(client: Client) {
        if (this.players[0]) // Host always ready
            this.players[0].ready = true;

        let msg = this.globalStateSync(client);
        msg.type = 'SYNC';
        this.broadcast(msg);
        this.broadcastWhoYouAre();
    }

    onJoin(client: Client) {
        if (this.playerCount > MAX_PLAYERS)
            return false;

        const r = super.onJoin(client);
        if (r) this.forceResync(client);
        return r;
    }
    onUsernameChange(client: Client) {
        super.onUsernameChange(client);
        this.forceResync(client);
    }
    onReady(client: Client) {
        super.onReady(client);

        // Force host always ready - host is "ready" when game starts
        if (this.players.indexOf(client) === 0) {
            client.ready = true;
            if (this.everyoneReady())
                this.startGame();
        }

        this.forceResync(client);
    }
    onDisconnect(client: Client) {
        super.onDisconnect(client);
        this.forceResync(client);
    }

    // Switch current round to pick a guess
    // Also pick a random guess
    toGuessState() {
        this.guesses = {};
        this.gotit = {};

        this.round++;
        if (this.round > TOTAL_ROUNDS) {
            this.endGameLoop();
            this.onRoomCreate();
            this.broadcast({ type: 'STATE', state: 'LOBBY' });
            return;
        }

        this.color = COLORS[Math.floor(Math.random() * COLORS.length)];
        while (this.picked.includes(this.color)) // No duplicate colors in a round
            this.color = COLORS[Math.floor(Math.random() * COLORS.length)];
        this.picked.push(this.color);

        this.broadcast({
            type: 'TURN_QUESTION',
            color: this.color,
            round: this.round,
            players: this.players.slice(0, MAX_PLAYERS)
                .filter(p => p !== null)
                // @ts-expect-error
                .map(p => [p.username, this.scores[p.id] || 0, '???', false])
        });
        this.guessStartTime = Date.now();
        this.state = TPTState.GUESSING;
    }

    // Switch to reveal state
    // Send correct answer to all players
    // Increment scores of all players with a correct guess
    toRevealState() {
        // @ts-ignore-error
        let answer = COLORS_MAP[this.color];
        answer = answer[Math.floor(Math.random() * answer.length)];
        answer = OTHER_NAMES_INV[answer] || answer;

        this.revealStartTime = Date.now();
        this.state = TPTState.REVEAL;
        this.broadcast({
            type: 'TURN_ANSWER',
            answer,
            color: this.color,
            players: this.players.slice(0, MAX_PLAYERS)
                .filter(p => p !== null)
                // @ts-expect-error
                .map(p => [p.username, this.scores[p.id] || 0, this.guesses[p.id] || '???', this.gotit[p.id]])
        });
    }

    gameLoop() {
        if (this.state === TPTState.GUESSING && Date.now() - this.guessStartTime > (GUESS_TIME + GRACE_LAG) * 1000)
            this.toRevealState();
        else if (this.state === TPTState.REVEAL && Date.now() - this.revealStartTime > REVEAL_TIME * 1000)
            this.toGuessState();
    }

    /** Start main game loop */
    startGameLoop() {
        if (this.interval !== null)
            this.endGameLoop();
        this.interval = setInterval(this.gameLoop.bind(this), UPDATE_EVERY_N_MS);
    }

    /** End main game loop */
    endGameLoop() {
        if (this.interval !== null)
            clearInterval(this.interval);
    }

    /**  Exit the lobby state and initiate the main game board */
    startGame() {
        if (this.everyoneReady()) {
            this.broadcast({ type: 'STATE', state: 'GAME' });
            this.toGuessState();
            this.startGameLoop();
        }
    }

    onRemove() {
        this.endGameLoop();
    }
}

export default TPTColorGame;
