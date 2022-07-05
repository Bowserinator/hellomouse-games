import { GAME_STATE, MoveMessage, ROTATION, TURN } from '../types.js';
import { SHIP_ALLOW_PLACE_COLOR, SHIP_NOT_ALLOW_PLACE_COLOR } from '../vars.js';
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
    playerIndex: number;

    // Turn specific:
    // PLACING
    placingShip: number; // Client side
    placingRotation: ROTATION; // Client side

    /**
     * Construct a new GameState
     * @param isClientSide Is this on the client?
     */
    constructor(isClientSide = false) {
        this.isClientSide = isClientSide;
        this.playerIndex = 0;
        this.reset();
    }

    reset() {
        this.players = [
            new Player(),
            new Player()
        ];

        this.state = GAME_STATE.PLACING; // TODO: LOBBY
        this.placingShip = 0;
        this.placingRotation = ROTATION.R0;
    }

    getPlayer() {
        return this.players[this.playerIndex];
    }

    advancePlacingShip() {
        const ships = this.getPlayer().ships;
        this.placingShip++;
        if (!ships[this.placingShip] || ships[this.placingShip].isPlaced) {
            this.placingShip = 0;
            while (this.placingShip < ships.length &&
                (!ships[this.placingShip] || ships[this.placingShip].isPlaced))
                this.placingShip++;
            if (this.placingShip >= ships.length)
                this.placingShip = -1;
        }
    }

    drawPlacementState(ctx: CanvasRenderingContext2D) {
        this.players[this.playerIndex].shipBoard.draw(ctx);

        // TODO:
        const placingShip = this.getPlayer().ships[this.placingShip];
        if (!placingShip) return;

        placingShip.setRotation(this.placingRotation);
        placingShip.drawBoundingBox(
            // TODO: dont hard code these
            ctx, [10, 10], 20, this.getPlayer().shipBoard.canPlace(placingShip)
                ? SHIP_ALLOW_PLACE_COLOR : SHIP_NOT_ALLOW_PLACE_COLOR
        );
        placingShip.drawPlacingRanges(ctx, [10, 10], 20);
    }

    /** Draw the game state */
    draw(ctx: CanvasRenderingContext2D) {
        switch (this.state) {
            case GAME_STATE.PLACING: {
                this.drawPlacementState(ctx);
                break;
            }
        }
    }

    // TODO
    onMove(playerIndex: number, message: MoveMessage) {

    }
}
