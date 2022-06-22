import Game from '../game.js';
import Client from '../client.js';

import GameState from '../../client/tanks/js/tanks/gamestate.js';
import { Direction, Action, TankSync } from '../../client/tanks/js/types.js';
import Tank from '../../client/tanks/js/tanks/tank.js';
import Vector from '../../client/tanks/js/tanks/vector2d.js';
import { generateMaze } from '../../client/tanks/js/tanks/map-gen.js';

interface IntentMessage {
    action: Action;
    dir: Direction;
    direction: [number, number];
    rotation: number;
}

const MAX_PLAYERS = 4;

// If tick length is too high tank collision becomes buggy
// Recommended: 30 ms or below
const UPDATE_EVERY_N_MS = 30; // Game tick length
const SYNC_BULLETS_EVERY_N_TIMES = 10; // How many iterations to sync bullets


class TankGame extends Game {
    state: GameState;
    interval: ReturnType<typeof setInterval> | null;
    playerTankIDMap: Record<string, number>;
    mapSeed: number;

    dontSyncBullets: boolean; // Temp flag
    syncCount: number;

    constructor() {
        super();
        this.state = new GameState();
        this.interval = null;
        this.syncAfterMove = false; // Syncing handled in game loop

        this.playerTankIDMap = {}; // Map client.id -> index in tank array
        this.syncCount = 0;
        this.dontSyncBullets = false;

        this.startGameLoop();
    }

    onRoomCreate() {
        this.mapSeed = Math.floor(Math.random() * 100000000);
        generateMaze(this.state, this.mapSeed);
        this.state.mazeSeed = this.mapSeed;
    }

    // @ts-ignore:next-line
    globalStateSync(player: Client) {
        // Literally never called, type doesn't matter
        return {};
    }

    onJoin(client: Client): boolean {
        if (this.players.length >= MAX_PLAYERS)
            return false;

        let canJoin = super.onJoin(client);
        if (canJoin && !this.playerTankIDMap[client.id])
            this.playerTankIDMap[client.id] = this.state.addTank(new Tank(
                new Vector(20, 20), 0
            )) - 1;

        client.connection.send(JSON.stringify({
            type: TankSync.MAP_UPDATE,
            seed: this.mapSeed,
            id: this.playerTankIDMap[client.id]
        }));


        // Send all current powerups + tanks
        for (let tank of this.state.tanks) {
            let syncMessage = tank.sync(false);
            if (syncMessage.length)
                client.connection.send(JSON.stringify({
                    type: TankSync.GENERIC_TANK_SYNC,
                    id: tank.id,
                    data: syncMessage
                }));
        }
        for (let powerup of this.state.powerupItems)
            client.connection.send(JSON.stringify({
                type: TankSync.ADD_POWERUP_ITEM,
                position: powerup.position.l(),
                powerup: powerup.powerup,
                id: powerup.randomID
            }));


        return canJoin;
    }

    sendPowerupUpdates() {
        // Powerup items
        for (let add of this.state.addedPowerupItems)
            this.broadcast({
                type: TankSync.ADD_POWERUP_ITEM,
                position: add.position.l(),
                powerup: add.powerup,
                id: add.randomID
            });
        for (let remove of this.state.removedPowerupItems)
            this.broadcast({
                type: TankSync.DELETE_POWERUP_ITEM,
                id: remove.randomID
            });

        // Powerups
        for (let add of this.state.addedPowerups)
            this.broadcast({
                type: TankSync.GIVE_POWERUP,
                id: add[1],
                powerup: add[0]
            });
    }

    sendTankUpdates() {
        // Added tanks
        if (this.state.addedTanks.length)
            this.broadcast({
                type: TankSync.UPDATE_ALL_TANKS,
                positions: this.state.tanks.map(tank => tank.position.l()),
                rotations: this.state.tanks.map(tank => tank.rotation)
            });

        // Send generic updates
        for (let tank of this.state.tanks) {
            let syncMessage = tank.sync();
            if (syncMessage.length)
                this.broadcast({
                    type: TankSync.GENERIC_TANK_SYNC,
                    id: tank.id,
                    data: syncMessage
                });
        }

        // Send tanks that have fired this tick
        let tanksFiredThisTick = [];
        for (let tank of this.state.tanks)
            if (tank.firedThisTick) {
                tank.firedThisTick = false;
                tanksFiredThisTick.push(tank.id);
            }
        if (tanksFiredThisTick.length)
            this.broadcast({
                type: TankSync.TANK_FIRED,
                ids: tanksFiredThisTick
            });
    }

    sendBulletUpdates() {
        // Send created / deleted bullets after state update
        for (let bullet of this.state.addedBullets)
            this.broadcast({
                type: TankSync.ADD_BULLET,
                position: bullet.collider.position.l(),
                velocity: bullet.velocity.l(),
                extra: bullet.getExtra(),
                bulletType: bullet.type
            });


        // Send remove bullet state update
        if (this.state.removedBulletIds.size)
            this.broadcast({
                type: TankSync.REMOVE_BULLETS,
                indices: [...this.state.removedBulletIds]
            });
    }

    syncBullets() {
        if (this.syncCount % SYNC_BULLETS_EVERY_N_TIMES !== 0)
            return;
        if (this.state.bullets.length === 0 && this.dontSyncBullets)
            return;

        let extras: Record<number, any> = {};
        for (let i = 0; i < this.state.bullets.length; i++) {
            let extra = this.state.bullets[i].getExtra();
            if (extra !== undefined)
                extras[i] = extra;
        }

        this.broadcast({
            type: TankSync.SYNC_ALL_BULLETS,
            positions: this.state.bullets.map(b => b.collider.position.l()),
            velocities: this.state.bullets.map(b => b.velocity.l()),
            bulletTypes: this.state.bullets.map(b => b.type),
            extras
        });

        this.dontSyncBullets = this.state.bullets.length === 0;
    }

    sendNewExplosionUpdates() {
        let newExplosions = [...this.state.addedExplosions];
        if (newExplosions.length)
            this.broadcast({
                type: TankSync.ADD_EXPLOSIONS,
                positions: newExplosions.map(e => e.position.l()),
                damageRadii: newExplosions.map(e => e.damageRadius),
                graphicsRadii: newExplosions.map(e => e.graphicsRadius),
                durations: newExplosions.map(e => e.duration),
                graphics: newExplosions.map(e => e.graphics)
            });
    }

    gameLoop() {
        // TODO:
        // Send all added bullets
        // send all deleted bullets

        this.sendTankUpdates();
        this.state.update();
        this.sendNewExplosionUpdates();
        this.sendBulletUpdates();
        this.syncBullets();
        this.sendPowerupUpdates();

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

        if (this.state.tanks[clientID].isDead)
            return;

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
        else if (message.action === Action.UPDATE_ROTATION && typeof message.rotation === 'number')
            // TODO: bound check +
            //  && typeof message.rotation === 'number'
            this.state.tanks[clientID].rotation = message.rotation;
        this.state.changedTankIDs.add(clientID);
    }
}

export default TankGame;
