class Client {
    /**
     * A client connection
     * @param connection Connection
     */
    constructor(connection) {
        this.connection = connection;
        this.gameID = ''; // ID of game its in
        this.ready = false;
        this.username = ''; // TODO: RADN USERNAME
    }

    /**
     * Is the user already in a game?
     * @return {boolean} Is user in game
     */
    isInGame() {
        return this.gameID;
    }
}

module.exports = Client;
