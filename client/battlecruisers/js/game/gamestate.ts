import { GAME_STATE, MoveMessage, ROTATION, TURN } from '../types.js';
import { BOARD_SIZE, SHIP_ALLOW_PLACE_COLOR, SHIP_NOT_ALLOW_PLACE_COLOR } from '../vars.js';
import { HitMarker, MaybeHitMarker, MaybeMissMarker, MaybeUnknownMarker, MissMarker } from './marker.js';
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

        this.state = GAME_STATE.BATTLE; // TODO: LOBBY
        this.placingShip = 0;
        this.placingRotation = ROTATION.R0;
    }

    getPlayer() {
        return this.players[this.playerIndex];
    }

    advancePlacingShip() {
        if (this.state !== GAME_STATE.PLACING)
            return;

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

    /**
     * Attack the target and update both player's boards
     * @param playerIndex Player to attack
     * @param pos Position to attack
     */
    attack(playerIndex: number, pos: [number, number]) {
        // damage ship for other player?

        const targetBoard = this.players[playerIndex].shipBoard;

        if (pos[0] < 0 || pos[1] < 0 || pos[0] >= BOARD_SIZE || pos[1] >= BOARD_SIZE)
            return;
        if (targetBoard.shipGrid[pos[1]][pos[0]])
            this.players[1 - playerIndex].markerBoard.addMarker(new HitMarker(pos));
        else
            this.players[1 - playerIndex].markerBoard.addMarker(new MissMarker(pos));
    }

    /**
     * Probe the target and update the other player's marker board
     * @param playerIndex The player being probed
     * @param pos Position to probe
     */
    probe(playerIndex: number, pos: [number, number]) {
        if (pos[0] < 0 || pos[1] < 0 || pos[0] >= BOARD_SIZE || pos[1] >= BOARD_SIZE)
            return;

        // Check if not stealthed
        let possibleHit = false;
        let stealthed = this.players[playerIndex].shipBoard.stealth[pos[1]][pos[0]];
        if (!stealthed && this.players[playerIndex].shipBoard.shipGrid[pos[1]][pos[0]])
            possibleHit = true;
        else if (stealthed) {
            this.players[1 - playerIndex].markerBoard.addMarker(new MaybeUnknownMarker(pos));
            return;
        }

        this.players[1 - playerIndex].markerBoard.addMarker(
            possibleHit
                ? new MaybeHitMarker(pos)
                : new MaybeMissMarker(pos)
        );
    }

    drawPlacementState(ctx: CanvasRenderingContext2D) {
        const board = this.getPlayer().shipBoard;
        board.draw(ctx);

        const placingShip = this.getPlayer().ships[this.placingShip];
        if (!placingShip) return;

        placingShip.setRotation(this.placingRotation);
        placingShip.drawBoundingBox(
            ctx, board.offset, board.gridSize, board.canPlace(placingShip)
                ? SHIP_ALLOW_PLACE_COLOR : SHIP_NOT_ALLOW_PLACE_COLOR
        );
        placingShip.drawPlacingRanges(ctx, board.offset, board.gridSize);
    }

    /** Draw the game state */
    draw(ctx: CanvasRenderingContext2D) {
        switch (this.state) {
            case GAME_STATE.PLACING: {
                this.drawPlacementState(ctx);
                break;
            }
            case GAME_STATE.BATTLE: {
                this.players[this.playerIndex].markerBoard.draw(ctx);
                break;
            }
        }
    }

    // TODO
    onMove(playerIndex: number, message: MoveMessage) {

    }
}
