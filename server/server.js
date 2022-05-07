const config = require('./config.js');
const Client = require('./client.js');
const games = require('./games.js');

const webSocketServer = require('websocket').server;
const http = require('http');


// Functions
// --------------------------

/**
 * Broadcast a message to everyone (literally everyone)
 * Not just in-game players!! For GLOBAL BROADCASTS ONLY
 * @param {object} message
 */
function broadcast(message) {
    message = JSON.stringify(message);
    for (let client of clients)
        client.connection.sendUTF(message);
}

/**
 * Sync game state for everyone
 */
function gameStateSync(id) {
    for (let player of games.games[id].players) {
        if (!player) continue;
        let msg = games.games[id].globalStateSync(player);
        msg.type = 'SYNC';
        send(player, msg);
    }
}

/**
 * Return an error status to a client
 * @param {Client} client Client obj
 * @param {Object} object
 */
function send(client, message) {
    client.connection.sendUTF(JSON.stringify(message));
}


/**
 * Return an error status to a client
 * @param {Client} client Client obj
 * @param {string} error Error message
 */
function error(client, error) {
    client.connection.sendUTF(JSON.stringify({
        type: 'ERROR',
        error: error
    }));
}


// Code
// --------------------------
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
        message = message.utf8Data;

        console.log(message)

        try { message = JSON.parse(message); }
        catch(e) { return error(client, "Invalid JSON"); }

        // Join a game
        if (message.type === 'JOIN') {
            if (client.isInGame()) // Failed: already in a game
                return error(client, "You're already in a game!");
            if (!message.gameID) // Failed: missing gameID
                return error(client, "Missing gameID");
            if (!games.games[message.gameID]) // Failed: no game exists
                return error(client, `GameID of ${message.gameID} doesn't exist`);
            if (!games.games[message.gameID].onJoin(client))
                return error(client, 'Not allowed to join this game');

            gameStateSync(client.gameID);
            return send(client, {
                type: 'UUID',
                uuid: client.gameID
            });
        }

        // Create a game
        else if (message.type === 'CREATE') {
            if (client.isInGame()) // Failed: already in a game
                return error(client, "You're already in a game!");
            if (!message.gameType) // Failed: missing game type
                return error(client, "Missing game type");
            if (!games.createGame(message.gameType, client))
                return error(client, `Could not create game of type '${message.gameType}'`);

            // Send user UUID
            games.games[client.gameID].onJoin(client);
            send(client, {
                type: 'UUID',
                uuid: client.gameID
            });
            gameStateSync(client.gameID);
            return;
        }

        // All of the remaining parses require the user to be in a game:
        if (!client.isInGame()) // User is not in a game
            return error(client, "You're not in a game!");

        let game = games.games[client.gameID];

        // Chat message
        if (message.type === 'CHAT') {
            // Invalid chat message
            if (!message.message)
                return error(client, "Invalid chat message");
            // Strip html content, broadcast
            game.broadcast({
                type: 'CHAT',
                message: message.message
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
                    .slice(0, 1000) // TODO: add ...
            });
        }
        
        // Username change
        else if (message.type === 'USERNAME') {
            // Missing or invalid username
            if (!message.username || !config.validateUsername(message.username))
                return error(client, "Invalid username");
            client.username = message.username;

            // TODO: broadcast
        }

        // Ready up
        else if (message.type === 'READY')
            client.ready = !client.ready;
            // TODO: broadcast ready state

        // Move
        else if (message.type === 'MOVE') {
            try{ game.onMove(client, message); }
            catch(e) { console.log(e) }
            gameStateSync(game.uuid);
        }
    });

    // On disconnect
    connection.on('close', connection => {
        let game = games.games[client.gameID];
        if (game) game.onDisconnect(client);
        clients.delete(client);

        // No one in game, remove it
        if (game && !game.players.filter(x => x).length)
            games.removeGame(game.uuid);
        else if (game)
            gameStateSync(game.uuid);
    });
});
