class Game {
    constructor() {
        this.uuid = '';
        this.players = [];
        this.playerCount = 0;
    }

    /** Called when game is created */
    onRoomCreate() {
        throw new Error('Not implemented');
    }

    /**
     * Global state sync, called whenever anything changes
     * Customizable per player
     * @param {Client} player
     * @return {object} To send to all players
     */
    globalStateSync(player) {
        throw new Error('Not implemented');
    }

    /**
     * Called when a client joins
     * @param {Client} client
     * @return {boolean} Accept client?
     */
    onJoin(client) {
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
    onMove(client, message) {
       throw new Error('Not implemented'); 
    }

    /**
     * Called when a client disconnects
     * @param {Client} client
     */
    onDisconnect(client) {
        for (let i = 0; i < this.players.length; i++) {
            if (this.players[i] === client) {
                this.players[i] = null;
                this.playerCount--;
                return;
            }
        }
    }

    /**
     * Are all players ready?
     * @return {boolean}
     */
    everyoneReady() {
        return this.players.every(x => x.ready);
    }

    /**
     * Broadcast a message to all players
     * @param {object} message
     */
    broadcast(message) {
        message = JSON.stringify(message);
        for (let client of this.players.filter(x => x))
            client.connection.sendUTF(message);
    }
}

module.exports = Game;
