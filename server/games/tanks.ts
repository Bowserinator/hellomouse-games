import Game from '../game.js';
import Client from '../client.js';

import GameState from '../../client/tanks/js/tanks/gamestate.js';
import { Direction, Action, TankSync } from '../../client/tanks/js/types.js';
import Tank from '../../client/tanks/js/tanks/tank.js';
import Vector from '../../client/tanks/js/tanks/vector2d.js';

interface IntentMessage {
    action: Action;
    dir: Direction;
    direction: [number, number];
}

const MAX_PLAYERS = 4;
const UPDATE_EVERY_N_MS = 20; // Game tick length


class TankGame extends Game {
    state: GameState;
    interval: ReturnType<typeof setInterval> | null;
    playerTankIDMap: Record<string, number>;

    constructor() {
        super();
        this.state = new GameState();
        this.interval = null;
        this.syncAfterMove = false; // Syncing handled in game loop

        this.playerTankIDMap = {}; // Map client.id -> index in tank array

        this.startGameLoop();
    }

    onRoomCreate() {

    }

    globalStateSync(player: Client) {
        return {};
    }

    onJoin(client: Client): boolean {
        if (this.players.length >= MAX_PLAYERS)
            return false;

        let canJoin = super.onJoin(client);
        if (canJoin && !this.playerTankIDMap[client.id])
            this.playerTankIDMap[client.id] = this.state.addTank(new Tank(
                new Vector(0, 0), 0
            )) - 1;

        return canJoin;
    }

    sendTankUpdates() {
        // TODO use a flag tank numbers modified or something
        // TODO: also send other data like powerups
        if (this.state.addedTanks.length)
            this.broadcast({
                type: TankSync.UPDATE_ALL_TANKS,
                positions: this.state.tanks.map(tank => tank.position.l()),
                rotations: this.state.tanks.map(tank => tank.rotation)
            });
        // Update tank movements
        // TODO: batch this as well
        for (let tankID of this.state.changedTankIDs) {
            let tank = this.state.tanks[tankID];
            this.broadcast({
                type: TankSync.TANK_POS,
                position: tank.position.l(),
                rotation: tank.rotation,
                movement: tank.movement,
                id: tankID
            });
        }
    }

    sendBulletUpdates() {
        // Send created / deleted bullets after state update
        for (let bullet of this.state.addedBullets)
            this.broadcast({
                type: TankSync.ADD_BULLET,
                position: bullet.collider.position.l(),
                velocity: bullet.velocity.l(),
                bulletType: bullet.type
            });
    }

    gameLoop() {
        // TODO:
        // Send all added bullets
        // send all deleted bullets

        this.sendTankUpdates();
        this.state.update();
        this.sendBulletUpdates();

        this.state.clearDeltas();
    }

    startGameLoop() {
        if (this.interval !== null)
            this.endGameLoop();
        setInterval(this.gameLoop.bind(this), UPDATE_EVERY_N_MS); // TODO
    }

    endGameLoop() {
        if (this.interval !== null)
            clearInterval(this.interval);
    }

    /**
     * On recieve a player move intent. Only updates movement intent,
     * actual moving/firing is done in the next game tick
     * @param {Client} client
     * @param {IntentMessage} message
     */
    onMove(client: Client, message: IntentMessage) {
        if (message.action === undefined || !(message.action in Action))
            return;
        if (message.action === Action.MOVE_BEGIN)
            if (message.dir === undefined || !(message.dir in Direction) || message.dir === Direction.NONE)
                return;

        let clientID = this.playerTankIDMap[client.id];
        let isVertical = [Direction.UP, Direction.DOWN].includes(message.dir) ? 1 : 0;

        if (message.action === Action.MOVE_BEGIN)
            // Request to move in a certain direction
            this.state.tanks[clientID].movement[isVertical] = message.dir;
        else if (message.action === Action.MOVE_END)
            // Request to stop moving in a certain direction
            this.state.tanks[clientID].movement[isVertical] = Direction.NONE;
        else if (message.action === Action.FIRE) {
            // Request to begin firing, setting the tank's rotation to that direction
            if (message.direction === undefined)
                return;
            let angle = Math.atan2(message.direction[1], message.direction[0]);
            if (Number.isNaN(angle))
                return;

            this.state.tanks[clientID].isFiring = true;
            this.state.tanks[clientID].rotation = angle;
        } else if (message.action === Action.STOP_FIRE)
            // Request to cease firing
            this.state.tanks[clientID].isFiring = false;
            // TODO: test if this would mean quick taps dont register
            // test with higher update
        this.state.changedTankIDs.add(clientID);
    }
}

export default TankGame;
