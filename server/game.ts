import Client from './client.js';

export default class Game {
    uuid: string;
    players: Array<Client | null>;
    playerCount: number;
    type: string;
    config: GameConfig;

    constructor(config: GameConfig = {}) {
        this.uuid = '';
        this.players = [];
        this.playerCount = 0;
        this.type = ''; // Set in games.js
        this.config = config;

        // Config defaults
        if (this.config.syncAfterMove === undefined)
            this.config.syncAfterMove = true;
        if (this.config.maxLobbies === undefined)
            this.config.maxLobbies = 100;
    }

    /** Called when game is created */
    onRoomCreate() {
        throw new Error('Not implemented');
    }

    /**
     * Global state sync, called whenever anything changes
     * Customizable per player
     * @param {Client} player
     * @return {MessageData} To send to all players
     */
    globalStateSync(player: Client): MessageData {
        throw new Error('Not implemented');
    }

    /**
     * Called when a client joins
     * @param {Client} client
     * @return {boolean} Accept client?
     */
    onJoin(client: Client): boolean {
        // Fill null spots first (in case disconnect)
        client.gameID = this.uuid;
        let found = false;

        for (let i = 0; i < this.players.length; i++) {
            if (this.players[i] === null) {
                this.players[i] = client;
                this.playerCount++;
                found = true;
                break;
            }
            if (this.players[i] === client) // Duplicate player
                return false;
        }
        if (!found) {
            this.players.push(client);
            this.playerCount++;
        }
        return true;
    }

    /**
     * Called when a player makes a move
     * @param {Client} client
     * @param {Object} message
     */
    onMove(client: Client, message: object) {
        throw new Error('Not implemented');
    }

    /**
     * Called when a message is recieved that isn't a standard defined message type
     * @param {Client} client
     * @param {Object} message
     */
    onMessage(client: Client, message: object) {
        // Do nothing, override
    }

    /**
     * Called when a client disconnects
     * @param {Client} client
     */
    onDisconnect(client: Client) {
        for (let i = 0; i < this.players.length; i++)
            if (this.players[i] === client) {
                this.players[i] = null;
                this.playerCount--;
                return;
            }
    }

    /**
     * Called when a client's username is changed
     * @param {Client} client
     */
    onUsernameChange(client: Client) {
        // Override
    }

    /**
     * Called when a client changes ready state
     * @param {Client} client
     */
    onReady(client: Client) {
        // Override
    }

    /**
     * Are all players ready?
     * @return {boolean}
     */
    everyoneReady(): boolean {
        return this.players.every(x => x !== null && x.ready);
    }

    /**
     * Broadcast a message to all players
     * (that are in the game)
     * @param {object} message
     */
    broadcast(message: object) {
        if (!message) return;
        let msg = JSON.stringify(message);
        for (let client of this.players)
            if (client !== null)
                client.connection.sendUTF(msg);
    }

    /**
     * Called when the game is removed from the
     * list of activate games (no more players)
     * Any cleanup should be done here
     */
    onRemove() {
        // Override
    }
}
