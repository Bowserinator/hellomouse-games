import Game from '../game.js';
import Client from '../client.js';
import GameState from '../../client/battlecruisers/js/game/gamestate.js';
import { MoveMessage } from '../../client/battlecruisers/js/types.js';


class BattlecruiserGame extends Game {
    state: GameState;

    constructor() {
        super();
        this.state = new GameState();
    }

    onRoomCreate() {
        // Do nothing
    }

    onJoin(client: Client): boolean {
        if (this.players.filter(p => p !== null).length >= 2)
            return false;
        let canJoin = super.onJoin(client);
        if (!canJoin) return false;

        // Resync everything on rejoin
        let toSend = this.globalStateSync(client);
        toSend.state = this.state.sync(this.players.indexOf(client), false);
        client.connection.send(JSON.stringify(toSend))
        return true;
    }

    globalStateSync(player: Client) {
        return {
            type: 'SYNC',
            players: this.players.slice(0, 2).map(x => {
                if (!x) return null;
                return x.ready;
            }),
            playerIndex: this.players.indexOf(player),
            state: this.state.sync(this.players.indexOf(player))
        };
    }

    onMove(client: Client, message: MoveMessage) {
        // Not enough players
        if (this.players.filter(x => x !== null).length < 2)
            return;
        this.state.onMove(this.players.indexOf(client), message);
    }
}

export default BattlecruiserGame;
