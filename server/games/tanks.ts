/*
TODO:
- players have:
    - position
    - rotation
    - last fire time
    - powerup
    - ammo
    - score
    - color
    - score
board is just an arrangement of mazes
    - vary walls + open spaces + mirror 4 fold symmetry
    - generate from seed so server can just send seed

game has
- round count
- list of bullets

set interval on event loop
- interpolate bullets and stuff based on time since last call
- since can be unreliable ig

- helper functions:
    - ray trace bounces up until a certain length

*/

import Game from '../game.js';
import Client from '../client.js';

import GameState from '../../client/atnks/js/tanks/gamestate.js';

interface Connect6Message {
    restart?: boolean;
    moves?: Array<Array<number>>;
}

class TankGame extends Game {
    constructor() {
        super();
        this.state = new GameState();
    }

    onRoomCreate() {

    }

    globalStateSync(player: Client) {
        return {
            type: 'SYNC'
        };
    }

    onMove(client: Client, message: Connect6Message) {
        /**
         * Message formats:
         * 1. Move request start
         *  { type: MOVE_START, dir: DIR }
         * 2. Move request end
         *  { type: MOVE_END, dir: DIR }
         */
    }
}

export default TankGame;
