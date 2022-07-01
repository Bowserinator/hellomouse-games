import { GAME_STATE, TURN } from '../types.js';
import Player from './player.js';


/**
 * GameState class, stores almost everything related to the game
 * @author Bowserinator
 */
export default class GameState {
    isClientSide: boolean;
    turn: TURN;
    state: GAME_STATE;
    players: Array<Player>;

    /**
     * Construct a new GameState
     * @param isClientSide Is this on the client?
     */
    constructor(isClientSide = false) {
        this.isClientSide = isClientSide;
        this.reset();
    }

    reset() {

    }

    /** Draw the game state */
    draw() {

    }
}
