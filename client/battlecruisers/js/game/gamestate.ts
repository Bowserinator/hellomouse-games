import { GAME_STATE, MoveMessage, ROTATION, TURN } from '../types.js';
import { BOARD_SIZE, SHIP_ALLOW_PLACE_COLOR, SHIP_NOT_ALLOW_PLACE_COLOR } from '../vars.js';
import { AbstractAbility, SALVO } from './ability.js';
import { HitMarker, MissMarker } from './marker.js';
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
    round: number;

    // Turn specific:
    // PLACING
    placingShip: number; // Client side
    placingRotation: ROTATION; // Client side

    // FIRING
    abilityMap: Record<string, Array<AbstractAbility>>;
    selectedAbility: AbstractAbility;
    firePos: [number, number]; // Grid coordinate

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

        this.turn = TURN.NORTH;
        this.state = GAME_STATE.FIRING; // TODO: LOBBY
        this.placingShip = 0;
        this.placingRotation = ROTATION.R0;
        this.firePos = [0, 0];
        this.round = 0;
        this.selectedAbility = SALVO;
        this.resetAbilities();
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

    /** Reset abilities for the turn */
    resetAbilities() {
        this.abilityMap = {};
        for (let ship of this.getPlayer().ships)
            for (let a of ship.abilities) {
                if (a.isNotActive(this.round))
                    continue;
                if (!this.abilityMap[a.name])
                    this.abilityMap[a.name] = [];
                this.abilityMap[a.name].push(a);
            }
    }

    useCurrentAbility() {
        this.selectedAbility.do(this.turn, this, this.firePos);
        this.selectedAbility.lastRoundActivated = this.round;
        this.resetAbilities();

        // Reset selectedAbility if needed
        if (!this.abilityMap[this.selectedAbility.name])
            this.selectedAbility = SALVO;
        else if (this.selectedAbility.isNotActive(this.round))
            this.selectedAbility = this.abilityMap[this.selectedAbility.name][0];
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
            case GAME_STATE.FIRING: {
                this.getPlayer().markerBoard.draw(ctx);
                this.selectedAbility.drawPreview(ctx, this.getPlayer().markerBoard, this.firePos);
                break;
            }
            case GAME_STATE.BATTLE: {
                this.getPlayer().markerBoard.draw(ctx);
                break;
            }
        }
    }

    // TODO
    onMove(playerIndex: number, message: MoveMessage) {

    }
}
