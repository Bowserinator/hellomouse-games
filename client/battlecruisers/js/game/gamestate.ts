import { DRAWN_BOARD, GAME_STATE, MoveMessage, MOVE_TYPE, ROTATION, TURN, WINNER } from '../types.js';
import { BOARD_SIZE, SALVOS_PER_TURN, SHIP_ALLOW_PLACE_COLOR, SHIP_NOT_ALLOW_PLACE_COLOR } from '../vars.js';
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
    winner: WINNER;

    // Server side
    salvosLeft: [number, number];

    // Client side:
    displayBoard: DRAWN_BOARD;

    // Turn specific:
    // PLACING
    placingShip: number; // Client side
    placingRotation: ROTATION; // Client side

    // FIRING
    abilityMap: Record<string, Array<AbstractAbility>>; // Client side
    allAbilityMap: Record<string, Array<AbstractAbility>>; // Client side
    selectedAbility: AbstractAbility; // Client side
    firePos: [number, number]; // Client side, Grid coordinate

    /**
     * Construct a new GameState
     * @param isClientSide Is this on the client?
     */
    constructor(isClientSide = false) {
        this.isClientSide = isClientSide;
        this.playerIndex = 0;
        this.winner = WINNER.UNKNOWN;
        this.reset();
    }

    reset() {
        this.players = [
            new Player(),
            new Player()
        ];

        this.turn = TURN.NORTH;
        this.state = GAME_STATE.PLACING; // TODO: LOBBY
        this.placingShip = 0;
        this.placingRotation = ROTATION.R0;
        this.firePos = [0, 0];
        this.round = 0;
        this.selectedAbility = SALVO;
        this.displayBoard = DRAWN_BOARD.FIRING;
        this.salvosLeft = [SALVOS_PER_TURN, SALVOS_PER_TURN];
        this.regenAbilityMaps();
    }

    setBoardSize(offset: [number, number], gridSize: number) {
        this.players.forEach(p => {
            p.markerBoard.gridSize = gridSize;
            p.shipBoard.gridSize = gridSize;
            p.markerBoard.offset = offset;
            p.shipBoard.offset = offset;
        });
    }

    getPlayer() {
        return this.players[this.playerIndex];
    }

    advancePlacingShip() {
        if (this.state !== GAME_STATE.PLACING)
            return;

        const ships = this.getPlayer().ships;

        // First find a ship of the same type
        for (let i = 0; i < ships.length; i++)
            if (ships[i].name === ships[this.placingShip].name && !ships[i].isPlaced) {
                this.placingShip = i;
                return;
            }

        // Otherwise advance forward
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
    regenAbilityMaps() {
        this.abilityMap = {};
        this.allAbilityMap = {};
        for (let ship of this.getPlayer().ships)
            for (let a of ship.abilities) {
                if (!this.allAbilityMap[a.name])
                    this.allAbilityMap[a.name] = [];
                this.allAbilityMap[a.name].push(a);
                if (!a.isNotActive(this.round)) {
                    if (!this.abilityMap[a.name])
                        this.abilityMap[a.name] = [];
                    this.abilityMap[a.name].push(a);
                }
            }
    }

    useCurrentAbility() {
        this.selectedAbility.do(this.turn, this, this.firePos);
        this.selectedAbility.lastRoundActivated = this.round;
        this.regenAbilityMaps();

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

    switchBoard() {
        this.displayBoard = 1 - this.displayBoard;
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
        placingShip.drawPlacingRanges(board, ctx);
    }

    /** Draw the game state */
    draw(ctx: CanvasRenderingContext2D) {
        const boards = [
            this.getPlayer().markerBoard,
            this.getPlayer().shipBoard
        ];
        switch (this.state) {
            case GAME_STATE.PLACING: {
                this.drawPlacementState(ctx);
                break;
            }
            case GAME_STATE.FIRING: {
                boards[this.displayBoard].draw(ctx);
                if (this.displayBoard === DRAWN_BOARD.FIRING) {
                    if (this.turn === this.playerIndex)
                        this.selectedAbility.drawPreview(ctx, this.getPlayer().markerBoard, this.firePos);
                } else
                    this.players[1 - this.playerIndex].markerBoard.draw(ctx, false);
                break;
            }
        }
    }

    /**
     * Returns an object to be synced after each move
     * @returns object
     */
    sync(playerIndex: number) {
        return {
            state: this.state,
            round: this.round,
            turn: this.turn,
            salvosLeft: this.salvosLeft,
            yourShips: this.players[playerIndex].ships.map(s => s.sync()),
            markerBoard: this.players[playerIndex].markerBoard.sync(),
            enemyMarkerBoard: this.players[1 - playerIndex].markerBoard.sync(),
            winner: this.winner
        };
    }

    /**
     * Update client with data from server
     * @param data Data from server
     */
    fromSync(data: any) {
        this.state = data.state;
        this.turn = data.turn;
        this.round = data.round;
        this.salvosLeft = data.salvosLeft;
        this.winner = data.winner;

        // Update ships only if not placing (otherwise board gets cleared)
        if (this.state !== GAME_STATE.PLACING) {
            for (let i = 0; i < data.yourShips.length; i++)
                this.getPlayer().ships[i].fromSync(data.yourShips[i]);
            this.getPlayer().shipBoard.ships = [];
            this.getPlayer().shipBoard.resetMaps();
            for (let ship of this.getPlayer().ships.filter(s => s.isPlaced))
                this.getPlayer().shipBoard.place(ship);

            this.getPlayer().shipBoard.resetMaps();
            this.getPlayer().shipBoard.ships.forEach(s => this.getPlayer().shipBoard.computeShipMaps(s));
        }

        this.getPlayer().markerBoard.fromSync(data.markerBoard);
        this.players[1 - this.playerIndex].markerBoard.fromSync(data.enemyMarkerBoard);
    }

    /**
     * Called on server when client -> server
     * @param playerIndex Player who's turn it is
     * @param message Message recieved
     */
    onMove(playerIndex: number, message: MoveMessage) {
        const player = this.players[playerIndex];

        switch (message.action) {
            // Player places all their ships down
            case MOVE_TYPE.PLACE: {
                // Not placing turn
                if (this.state !== GAME_STATE.PLACING)
                    return;
                // Player already submitted
                if (player.ships.every(s => s.isPlaced))
                    return;
                // Bad message
                if (!message.placements || message.placements.length !== player.ships.length)
                    return;

                player.shipBoard.reset();
                for (let i = 0; i < message.placements.length; i++) {
                    const p = message.placements[i];

                    // Validate that placement is an array of 4 numbers in range
                    if (p.length !== 3 || !p.every(x => Number.isInteger(x)) || p[2] >= 4)
                        return;

                    player.ships[i].isPlaced = false;
                    player.ships[i].position = [p[0], p[1]];
                    player.ships[i].setRotation(p[2]);
                    player.shipBoard.place(player.ships[i]);
                }

                // All players have placed their ships
                // eslint-disable-next-line @typescript-eslint/no-shadow
                if (this.players.every(player => player.ships.every(s => s.isPlaced)))
                    this.state = GAME_STATE.FIRING;
                break;
            }
            // Player fires
            case MOVE_TYPE.FIRE: {
                // Not firing turn
                if (this.state !== GAME_STATE.FIRING)
                    return;
                // Check if it's the player's turn
                if (this.turn !== playerIndex)
                    return;
                // Invalid
                if (!message.abilityName || !message.firePos || message.firePos.length !== 2 ||
                    message.firePos[0] < 0 || message.firePos[1] < 0 ||
                    message.firePos[0] >= BOARD_SIZE || message.firePos[1] >= BOARD_SIZE)
                    return;
                message.firePos = message.firePos.map(x => Math.floor(+x || 0)) as [number, number];

                let abilities = [];
                if (message.abilityName === SALVO.name)
                    abilities = [SALVO];
                else
                    for (let ship of player.ships)
                        for (let a of ship.abilities)
                            if (!a.isNotActive(this.round) && a.name === message.abilityName)
                                abilities.push(a);
                if (!abilities[0]) return; // Ability not ready
                abilities[0].do(this.turn, this, message.firePos);
                abilities[0].lastRoundActivated = this.round;

                const shipBoard = this.players[1 - playerIndex].shipBoard;
                this.players[1 - playerIndex].ships.forEach(ship => ship.checkHits(shipBoard, player.markerBoard));

                // Switch turns when salvos left changes
                this.salvosLeft[this.turn]--;

                if (this.players[1 - playerIndex].allSunk()) {
                    // Someone won!
                    this.state = GAME_STATE.LOBBY;

                    let p1AllDead = this.players[0].allSunk() ? 2 : 0;
                    let p2AllDead = this.players[1].allSunk() ? 1 : 0;
                    this.winner = [WINNER.UNKNOWN, WINNER.P1, WINNER.P2, WINNER.TIE][p1AllDead + p2AllDead];
                    return;
                }

                if (this.salvosLeft[this.turn] === 0) {
                    this.salvosLeft = [SALVOS_PER_TURN, SALVOS_PER_TURN];
                    this.turn = 1 - this.turn;
                    this.round++;
                }
                break;
            }
        }
    }
}
