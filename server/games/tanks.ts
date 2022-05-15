import Game from '../game.js';
import Client from '../client.js';

import GameState from '../../client/tanks/js/tanks/gamestate.js';
import { Direction, Action, TankSync } from '../../client/tanks/js/types.js';
import Tank from '../../client/tanks/js/tanks/tank.js';
import Vector from '../../client/tanks/js/tanks/vector2d.js';

class TankGame extends Game {
    constructor() {
        super();
        this.state = new GameState();
        this.interval = null;
        this.syncAfterMove = false;

        this.playerTankIDMap = {};

        this.startGameLoop();
    }

    onRoomCreate() {

    }

    onJoin(client: Client): boolean {
        // TODO check on join first if true then do thsio
        if (!this.playerTankIDMap[client.id])
            this.playerTankIDMap[client.id] = this.state.addTank(new Tank(
                new Vector(0, 0), 0
            )) - 1;

        return super.onJoin(client);
    }

    globalStateSync(player: Client) {
        return {
            type: 'SYNC'
        };
    }

    gameLoop() {
        // TODO: send changed tank actions to all clients
        // Send all added bullets
        // send all deleted bullets

        // advance simulation (the players do this too)
        // Temp back
        if(this.state.addedTanks.length) {
            this.broadcast({
                type: TankSync.UPDATE_ALL_TANKS,
                positions: this.state.tanks.map(tank => tank.position.l()),
                rotations: this.state.tanks.map(tank => tank.rotation)
            });
        }
        for (let tankID of this.state.changedTanks) {
            // TODO: broadcast: position, rotation
            let tank = this.state.tanks[tankID];
            this.broadcast({
                type: TankSync.TANK_POS,
                position: tank.position.l(),
                rotation: tank.rotation,
                movement: tank.movement,
                id: tankID
            });
        }

        this.state.update();

        for (let bullet of this.state.addedBullets)
            this.broadcast({
                type: TankSync.ADD_BULLET,
                position: bullet.collider.position.l(),
                velocity: bullet.velocity.l(),
                type: 0
            });


        this.state.clearDeltas();
    }

    startGameLoop() {
        if (this.interval !== null)
            this.endGameLoop();
        setInterval(this.gameLoop.bind(this), 10); // TODO
    }

    endGameLoop() {
        if (this.interval !== null)
            clearInterval(this.interval);
    }

    onMove(client: Client, message: Connect6Message) {
        /**
         * Message formats:
         * 1. Move request start
         *  { type: MOVE_BEGIN, dir: DIR }
         * 2. Move request end
         *  { type: MOVE_END, dir: DIR }
         */
        if (message.action === undefined || !(message.action in Action))
            return;
        if ([Action.MOVE_BEGIN, Action.MOVE_END].includes(message.action))
            if (message.dir === undefined || !(message.dir in Direction) || message.dir === Direction.NONE)
                return;

        let clientID = this.playerTankIDMap[client.id];
        let isVertical = [Direction.UP, Direction.DOWN].includes(message.dir) ? 1 : 0;
        console.log(this.playerTankIDMap);

        if (message.action === Action.MOVE_BEGIN)
            this.state.tanks[clientID].movement[isVertical] = message.dir;
        else if (message.action === Action.MOVE_END)
            this.state.tanks[clientID].movement[isVertical] = Direction.NONE;
        else if (message.action === Action.FIRE) { // TODO neatify code + check dir
            this.state.tanks[clientID].isFiring = true;
            this.state.tanks[clientID].rotation = Math.atan2(message.direction[1], message.direction[0]);
        } else if (message.action === Action.STOP_FIRE)
            this.state.tanks[clientID].isFiring = false;
        this.state.changedTanks.add(clientID);
    }
}

export default TankGame;
