import Game from '../game.js';
import Client from '../client.js';

enum DetentionState {
    LOBBY,
    GAME
}

interface DetentionMessage {
    action?: string;
    name?: string;
    score?: number;
    alive?: boolean;
}

class IndefiniteDetentionGame extends Game {
    state: DetentionState;
    names: { [id: string]: string };
    scores: { [id: string]: { name: string, score: number, alive: boolean } };

    constructor() {
        super();
        this.state = DetentionState.LOBBY;
        this.names = {};
        this.scores = {};
    }

    onRoomCreate() {
        this.state = DetentionState.LOBBY;
        this.names = {};
        this.scores = {};
    }

    globalStateSync(player: Client) {
        return {
            type: 'SYNC',
            state: this.state === DetentionState.LOBBY ? 'LOBBY' : 'GAME',
            isHost: this.players[0] === player,
            youAre: this.players.indexOf(player),
            players: this.players.filter(x => x !== null)
                .map(x => this.names[(x as Client).id] || (x as Client).username),
            scores: Object.keys(this.scores).map(id => this.scores[id])
        };
    }

    onMove(client: Client, message: DetentionMessage) {
        if (message.action === 'NAME') {
            if (!message.name) return;
            this.names[client.id] = message.name
                .replace(/&/g, '&amp;').replace(/</g, '&lt;')
                .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
                .slice(0, 24);
        } else if (message.action === 'START') {
            if (this.players[0] !== client || this.state !== DetentionState.LOBBY) return;
            this.state = DetentionState.GAME;
        } else if (message.action === 'REPLAY') {
            if (this.players[0] !== client || this.state !== DetentionState.GAME) return;
            this.state = DetentionState.LOBBY;
            this.scores = {};
        } else if (message.action === 'SCORE') {
            if (typeof message.score !== 'number') return;
            this.scores[client.id] = {
                name: this.names[client.id] || client.username,
                score: message.score,
                alive: !!message.alive
            };
        }
    }

    onDisconnect(client: Client) {
        super.onDisconnect(client);
        if (this.state === DetentionState.LOBBY) {
            this.players = this.players.filter(x => x !== null);
            this.playerCount = this.players.length;
        }
    }
}

export default IndefiniteDetentionGame;
