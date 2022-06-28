import Game from '../game.js';
import Client from '../client.js';

import GameState from '../../client/tanks/js/tanks/gamestate.js';
import { Direction, Action, TankSync } from '../../client/tanks/js/types.js';
import Tank from '../../client/tanks/js/tanks/tank.js';
import Vector from '../../client/tanks/js/tanks/vector2d.js';
import { generateMaze } from '../../client/tanks/js/tanks/map-gen.js';
import { PRE_ROUND_DELAY, ROUND_ARRAY, TANK_COLORS } from '../../client/tanks/js/vars.js';

interface IntentMessage {
    action: Action;
    dir: Direction;
    direction: [number, number];
    rotation: number;
}

interface LobbyMessage {
    type: TankSync;
    color: number;
    round: number;
}

const MAX_PLAYERS = 8;

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
    alreadyFilteredMissingTanks: boolean;

    constructor() {
        super();
        this.state = new GameState();
        this.interval = null;
        this.syncAfterMove = false; // Syncing handled in game loop

        this.playerTankIDMap = {}; // Map client.id -> index in tank array
        this.syncCount = 0;
        this.dontSyncBullets = false;
        this.alreadyFilteredMissingTanks = false;

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
        if (!canJoin) return false;

        if (!this.state.inLobby) {
            // Try to reconnect to a missing player tank
            let allowJoin = false;
            for (let i = 0; i < this.state.tanks.length; i++) {
                const tank = this.state.tanks[i];
                if (tank.missingPlayer) {
                    this.playerTankIDMap[client.id] = i;
                    tank.missingPlayer = false;
                    allowJoin = true;
                    break;
                }
            }
            if (!allowJoin) return false; // Reject joins outside of lobby

            // Send game state + tanks
            client.connection.sendUTF(JSON.stringify({
                type: TankSync.CREATE_ALL_TANKS,
                data: this.state.tanks.map(tank => tank.sync(false)),
                id: this.playerTankIDMap[client.id]
            }));
            this.broadcast({ type: TankSync.STATE_SYNC, data: this.state.sync(false) });
        }

        if (this.state.inLobby && !this.playerTankIDMap[client.id]) {
            this.state.addTank(new Tank(new Vector(20, 20), 0));
            const i = this.state.tanks.length - 1;
            this.state.tanks[i].setTint(TANK_COLORS[i]); // TODO: find unused TANK_COLOR
            this.playerTankIDMap[client.id] = i;

            if (i === 0) // Host always ready
                this.state.tanks[i].ready = true;
        }

        // Send powerups & round information
        for (let powerup of this.state.powerupItems)
            client.connection.send(JSON.stringify(powerup.toAddedSyncMessage()));

        client.connection.send(JSON.stringify({
            type: TankSync.CHANGE_ROUNDS,
            round: ROUND_ARRAY.indexOf(this.state.totalRounds)
        }));

        return true;
    }

    onDisconnect(client: Client) {
        let clientID = this.playerTankIDMap[client.id];
        delete this.playerTankIDMap[client.id];
        super.onDisconnect(client);
        if (!this.state.tanks[clientID])
            return;

        // If not in lobby just mark tank as missing a player so user can reconnect
        if (!this.state.inLobby) {
            this.state.tanks[clientID].missingPlayer = true;
            return;
        }

        // All players with higher ids are shifted down 1
        for (let key of Object.keys(this.playerTankIDMap))
            if (this.playerTankIDMap[key] > clientID) {
                this.state.tanks[this.playerTankIDMap[key]].id--;
                this.playerTankIDMap[key]--;
            }

        // Delete tank + update ready state of host
        this.state.tanks[0].ready = true;
        this.state.tanks.splice(clientID, 1);
        this.recreateAllTanks();
    }

    /**
     * Called once when game ends
     * - Filter out tanks with missing players in lobby state
     * - Unready all players if they want to play again
     */
    onGameEnd() {
        if (this.alreadyFilteredMissingTanks) return;

        // Filter missing player tanks
        let tankToClientMap: Record<number, string> = {};
        for (let key of Object.keys(this.playerTankIDMap))
            tankToClientMap[this.playerTankIDMap[key]] = key;

        this.state.tanks = this.state.tanks.filter(tank => !tank.missingPlayer);
        for (let i = 0; i < this.state.tanks.length; i++) {
            const tank = this.state.tanks[i];
            if (i !== tank.id) {
                this.playerTankIDMap[tankToClientMap[tank.id]] = i;
                tank.id = i;
            }
        }
        this.alreadyFilteredMissingTanks = true;

        // Unready all players
        this.state.tanks.forEach(tank => tank.ready = false);
        this.players.forEach(player => {
            if (player !== null)
                player.ready = false;
        });
        this.setReadyStates();
        this.recreateAllTanks();
    }

    /**
     * Call this when a tank is added or removed
     * Will force all clients to recreate their tank array
     * and reset their tankIndex
     */
    recreateAllTanks() {
        const msg = {
            type: TankSync.CREATE_ALL_TANKS,
            data: this.state.tanks.map(tank => tank.sync(false)),
            id: 0
        };
        for (let client of this.players) {
            if (client === null) continue;
            msg.id = this.playerTankIDMap[client.id];
            client.connection.sendUTF(JSON.stringify(msg));
        }

        this.broadcastChangeColor();
        this.setReadyStates();
    }

    /** Main game loop */
    gameLoop() {
        this.sendGameStateUpdates();
        this.sendTankUpdates();
        this.state.update();

        if (!this.state.inLobby) {
            this.alreadyFilteredMissingTanks = false;
            this.sendNewExplosionUpdates();
            this.sendBulletUpdates();
            this.syncBullets();
            this.sendPowerupUpdates();
        } else
            this.onGameEnd();

        this.state.clearDeltas();
    }

    /** Start main game loop */
    startGameLoop() {
        if (this.interval !== null)
            this.endGameLoop();
        this.interval = setInterval(this.gameLoop.bind(this), UPDATE_EVERY_N_MS);
    }

    /** End main game loop */
    endGameLoop() {
        if (this.interval !== null)
            clearInterval(this.interval);
    }

    /**  Exit the lobby state and initiate the main game board */
    startGame() {
        // Conditions to start: 2 or more players all ready
        if (this.everyoneReady() && this.state.tanks.length >= 2)
            this.state.startGame();
    }

    /**
     * Broadcast a change to colors
     * @param {boolean} includeColors Include color changes
     * @param {Array<number> | null} tankColorIndexMap Alternative tank color index map to use
     * */
    broadcastChangeColor(tankColorIndexMap: Array<number> | null = null) {
        this.broadcast({
            type: TankSync.CHANGE_COLOR,
            colors: tankColorIndexMap || this.state.tanks.map(tank => TANK_COLORS.indexOf(tank.tint))
        });
    }

    /** Set tank ready states, call after ready state changes */
    setReadyStates() {
        for (let player of this.players) {
            if (player === null) continue;
            const id = this.playerTankIDMap[player.id];
            if (this.state.tanks[id]) {
                if (id === 0) player.ready = true; // Host always ready
                this.state.tanks[id].ready = player.ready;
            }
        }
    }

    onUsernameChange(client: Client) {
        let clientID = this.playerTankIDMap[client.id];
        if (!this.state.tanks[clientID])
            return;

        // Not in lobby, prohibit interaction
        if (!this.state.inLobby) {
            client.username = this.state.tanks[clientID].username;
            return;
        }

        this.state.tanks[clientID].setUsername(client.username);
    }

    onReady(client: Client) {
        if (this.playerTankIDMap[client.id] === 0) {
            client.ready = true; // Host always ready
            this.startGame();
        }
        this.setReadyStates();
    }

    onMessage(client: Client, message: LobbyMessage) {
        let clientID = this.playerTankIDMap[client.id];
        if (!this.state.tanks[clientID])
            return;

        // Not in lobby, prohibit interaction
        if (!this.state.inLobby) return;

        switch (message.type) {
            // User changes color
            case TankSync.CHANGE_COLOR: {
                const tankColorIndexMap = this.state.tanks.map(tank => TANK_COLORS.indexOf(tank.tint));
                if (TANK_COLORS[message.color] && !tankColorIndexMap.some(x => x === message.color)) {
                    this.state.tanks[clientID].setTint(TANK_COLORS[message.color]);
                    tankColorIndexMap[clientID] = message.color;
                }
                this.broadcastChangeColor(tankColorIndexMap);
                break;
            }

            // Host changes number of rounds in the game, default 20 (3rd item in array)
            case TankSync.CHANGE_ROUNDS: {
                if (clientID !== 0) return; // Only host can change round count
                this.state.totalRounds = ROUND_ARRAY[message.round] || this.state.totalRounds;
                this.broadcast({
                    type: TankSync.CHANGE_ROUNDS,
                    round: ROUND_ARRAY[message.round] ? message.round : 3 // 3rd in array = 20
                });
                break;
            }
        }
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

        if (!this.state.tanks[clientID] || this.state.tanks[clientID].isDead)
            return;

        // Prevent inputs a certain time right after a round starts
        // to avoid misclicks / advantages
        const NO_CONTROLS = Date.now() - this.state.timeRoundStarted < PRE_ROUND_DELAY;

        switch (message.action) {
            case Action.MOVE_BEGIN: {
                if (NO_CONTROLS) return;

                // Request to move in a certain direction
                this.state.tanks[clientID].movement[isVertical] = message.dir;
                break;
            }
            case Action.MOVE_END: {
                if (NO_CONTROLS) return;

                // Request to stop moving in a certain direction
                if (message.dir === this.state.tanks[clientID].movement[isVertical])
                    this.state.tanks[clientID].movement[isVertical] = Direction.NONE;
                break;
            }
            case Action.FIRE: {
                if (NO_CONTROLS) return;

                // Request to begin firing, setting the tank's rotation to that direction
                if (message.direction === undefined)
                    return;
                let angle = Math.atan2(message.direction[1], message.direction[0]);
                if (Number.isNaN(angle))
                    return;

                this.state.tanks[clientID].isFiring = true;
                this.state.tanks[clientID].rotation = angle;
                break;
            }
            case Action.STOP_FIRE: {
                if (NO_CONTROLS) return;

                // Request to cease firing
                this.state.tanks[clientID].isFiring = false;
                break;
            }
            case Action.UPDATE_ROTATION: {
                if (message.rotation < -5 || message.rotation > 5)
                    return;
                this.state.tanks[clientID].rotation = message.rotation;
                break;
            }
        }
        this.state.changedTankIDs.add(clientID);
    }

    // --------------------------------------------
    // Send sync message methods
    // --------------------------------------------

    sendTankUpdates() {
        // Added tanks
        if (this.state.addedTanks.length)
            this.recreateAllTanks();

        // Send generic updates
        for (let tank of this.state.tanks)
            this.broadcast(tank.toSyncMessage());

        // Send tanks that have fired this tick
        let tanksFiredThisTick = [];
        for (let tank of this.state.tanks)
            if (tank.firedThisTick) {
                tank.firedThisTick = false;
                tanksFiredThisTick.push(tank.id);
            }
        if (tanksFiredThisTick.length)
            this.broadcast({ type: TankSync.TANK_FIRED, ids: tanksFiredThisTick });
    }

    sendBulletUpdates() {
        // Send created / deleted bullets after state update
        for (let bullet of this.state.addedBullets)
            this.broadcast(bullet.toAddedSyncMessage());

        // Send remove bullet state update
        if (this.state.removedBulletIds.size)
            this.broadcast({ type: TankSync.REMOVE_BULLETS, indices: [...this.state.removedBulletIds] });
    }

    syncBullets() {
        // Special force sync all bullets to avoid sim desync
        // Only do every n update loops, if there are no bullets
        // only sync once to indicate to client there are no bullets, then
        // don't sync until there are bullets again

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

    sendGameStateUpdates() {
        const stateSync = this.state.sync();
        if (stateSync)
            this.broadcast({ type: TankSync.STATE_SYNC, data: stateSync });
    }

    sendPowerupUpdates() {
        // Powerup items
        for (let add of this.state.addedPowerupItems)
            this.broadcast(add.toAddedSyncMessage());
        for (let remove of this.state.removedPowerupItems)
            this.broadcast({ type: TankSync.DELETE_POWERUP_ITEM, id: remove.randomID });

        // Powerups
        for (let add of this.state.addedPowerups)
            this.broadcast({ type: TankSync.GIVE_POWERUP, id: add[1], powerup: add[0] });
    }
}

export default TankGame;
