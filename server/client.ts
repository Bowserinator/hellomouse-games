export default class Client {
    connection: any; // WebSocketConnection; // No idea where this is exported
    gameID: string;
    ready: boolean;
    username: string;

    /**
     * A client connection
     * @param connection Connection
     */
    constructor(connection: any) {
        this.connection = connection;
        this.gameID = ''; // ID of game its in
        this.ready = false;
        this.username = 'User' + Math.round(10000 * Math.random());
    }

    /**
     * Is the user already in a game?
     * @return {boolean} Is user in game
     */
    isInGame(): boolean {
        return this.gameID !== '';
    }
}
