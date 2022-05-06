

class Game {
    constructor() {
        this.uuid = '';
        this.players = [];
    }

    /** Called when game is created */
    onRoomCreate() {
        throw new Error('Not implemented');
    }

    /**
     * Called when a client joins
     * @param {Client} client
     * @return {boolean} Accept client?
     */
    onJoin(client) {
        // You should update stuff like this.players here
        throw new Error('Not implemented');
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
        throw new Error('Not implemented');
    }

    /**
     * Are all players ready?
     * @return {boolean}
     */
    everyoneReady() {
        return this.players.every(x => x.ready);
    }
}
