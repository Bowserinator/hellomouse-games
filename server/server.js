const config = require('./config.js');
const Client = require('./client.js');

const webSocketServer = require('websocket').server;
const http = require('http');


// Functions
// --------------------------
function broadcast(message) {

}

/**
 * Return an error status to a client
 * @param {Client} client Client obj
 * @param {string} error Error message
 */
function error(client, error) {
    client.connection.sendUTF(JSON.stringify({
        type: 'error',
        error: error
    }));
}


// Code
// --------------------------

let games = {}; // UUID: game
let clients = new Set();

// HTTP Server for websocket
const server = http.createServer((request, response) => {});
const wsServer = new webSocketServer({ httpServer: server });

server.listen(config.port, () => {
    console.log((new Date()) + ' Server is listening on port ' + config.port);
});

wsServer.on('request', request => {
    // TODO remove this / better logging
    console.log((new Date()) + ' Connection from origin ' + request.origin + '.');

    const connection = request.accept(null, request.origin);
    const client = new Client(connection);
    clients.add(client);


    console.log((new Date()) + ' Connection accepted.');

    connection.on('message', message => {
        if (message.type !== 'utf8') return  error(client, "Not UTF-8");

        message = JSON.parse(message);
        if (!message) return error(client, "Invalid JSON");

        // Join a game
        if (message.type === 'JOIN') {
            if (client.isInGame()) // Failed: already in a game
                return error(client, "You're already in a game!");
            if (!message.gameID) // Failed: missing gameID
                return error(client, "Missing gameID");
            if (!games[message.gameID]) // Failed: no game exists
                return error(client, `GameID of ${message.gameID} doesn't exist`);
            if (!games[message.gameID].onJoin(client))
                return error(client, 'Not allowed to join this game');
            client.gameID = message.gameID;
        }

        // Create a game
        else if (message.type === 'CREATE') {
            if (client.isInGame()) // Failed: already in a game
                return error(client, "You're already in a game!");
            if (!message.gameType) // Failed: missing game type
                return error(client, "Missing game type");
            
            // TODO: unknown type
            // TODO: create game
        }

        // All of the remaining parses require the user to be in a game:
        if (!client.isInGame()) // User is not in a game
            return error(client, "You're not in a game!");

        let game = games[client.gameID];

        // Chat message
        if (message.type === 'CHAT') {
            // Strip html content, broadcast
            // TODO
        }
        
        // Username change
        else if (message.type === 'USERNAME') {
            // Missing or invalid username
            if (!message.username || !config.validateUsername(message.username))
                return error(client, "Invalid username");
            client.username = message.username;
        }

        // Ready up
        else if (message.type === 'READY')
            client.ready = !client.ready;

        // Move
        else if (message.type === 'MOVE')
            game.onMove(client, message);
    });

    // On disconnect
    connection.on('close', connection => {
        if (games[client.gameID])
            games[client.gameID].onDisconnect(client);
        clients.remove(client);
    });
});
