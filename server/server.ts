import config from './config.js';
import Client from './client.js';
import { createGame, removeGame, games, canCreateGame } from './games.js';

import { server as webSocketServer } from 'websocket';
import http from 'http';
import https from 'https';
import fs from 'fs';
import signale from 'signale';


// Functions
// --------------------------

/**
 * Sync game state for everyone
 * @param id
 */
function gameStateSync(id: string) {
    for (let player of games[id].players) {
        if (!player) continue;
        let msg = games[id].globalStateSync(player);
        msg.type = 'SYNC';
        send(player, msg);
    }
}

/**
 * Return an error status to a client
 * @param {Client} client Client obj
 * @param {object} message
 */
function send(client: Client, message: object) {
    client.connection.sendUTF(JSON.stringify(message));
}


/**
 * Return an error status to a client
 * @param {Client} client Client obj
 * @param {string} error Error message
 * @param {string} code Error code
 */
function error(client: Client, err: string, code = '') {
    client.connection.sendUTF(JSON.stringify({
        type: 'ERROR',
        error: err,
        code: code
    }));
}


// Code
// --------------------------
let clients: Set<Client> = new Set();

// HTTP Server for websocket
const server = config.https
    ? https.createServer({
        cert: fs.readFileSync('./certs/fullchain.pem'),
        key: fs.readFileSync('./certs/privkey.pem')
    })
    : http.createServer((request: any, response: any) => {});

// eslint-disable-next-line new-cap
const wsServer = new webSocketServer({ httpServer: server });

server.listen(config.port, () => {
    signale.start(`${new Date()} Server is listening on ${config.port}`);
});

wsServer.on('request', (request: any) => {
    signale.debug(`${new Date()} Connection from ${request.origin}`);

    const connection = request.accept(null, request.origin);
    const client = new Client(connection);
    clients.add(client);

    connection.on('message', (msg: Message) => {
        if (msg.type !== 'utf8') return error(client, 'Not UTF-8', 'ENCODE');
        let messageData: string = msg.utf8Data;

        // signale.debug(`> ${messageData}`);

        let message: MessageData;

        try {
            message = JSON.parse(messageData);
        } catch (e) {
            return error(client, 'Invalid JSON', 'JSON');
        }

        // Join a game
        if (message.type === 'JOIN') {
            if (client.isInGame()) // Failed: already in a game
                return error(client, 'You\'re already in a game!', 'IN_GAME');
            if (!message.gameID) // Failed: missing gameID
                return error(client, 'Missing gameID', 'NO_ID');
            if (!games[message.gameID]) // Failed: no game exists
                return error(client, `GameID of ${message.gameID} doesn't exist`, 'NO_GAME');
            if (!games[message.gameID].onJoin(client))
                return error(client, 'Not allowed to join this game', 'NOT_ALLOWED');

            gameStateSync(client.gameID);
            return send(client, {
                type: 'UUID',
                uuid: client.gameID
            });
        } else if (message.type === 'CREATE') { // Create a game
            if (client.isInGame()) // Failed: already in a game
                return error(client, 'You\'re already in a game!', 'ALREADY_IN_GAME');
            if (!message.gameType) // Failed: missing game type
                return error(client, 'Missing game type', 'NO_TYPE');

            const canCreate = canCreateGame(message.gameType);
            if (canCreate !== '')
                return error(client, canCreate, 'FAILED_CREATE');
            if (!createGame(message.gameType, client))
                return error(client, `Could not create game of type '${message.gameType}'`,
                    'FAILED_CREATE');

            // Send user UUID
            games[client.gameID].onJoin(client);
            send(client, {
                type: 'UUID',
                uuid: client.gameID
            });
            gameStateSync(client.gameID);
            return;
        } else if (message.type === 'PING') {
            if (!message.ping || Number.isNaN(message.ping)) return;
            return send(client, {
                type: 'PING',
                ping: message.ping
            });
        }

        // All of the remaining parses require the user to be in a game:
        if (!client.isInGame()) // User is not in a game
            return error(client, 'You\'re not in a game!', 'NOT_IN_GAME');

        let game = games[client.gameID];

        // Chat message
        if (message.type === 'CHAT') {
            // Invalid chat message
            if (!message.message)
                return error(client, 'Invalid chat message', 'BAD_CHAT');
            // Strip html content, broadcast
            let stripedMessage = message.message
                .replace(/&/g, '&amp;').replace(/</g, '&lt;')
                .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            if (stripedMessage.length > 1000)
                stripedMessage = stripedMessage.slice(0, 998) + '..';
            game.broadcast({
                type: 'CHAT',
                message: stripedMessage,
                username: client.username,
                i: game.players.indexOf(client)
            });
        } else if (message.type === 'USERNAME') { // Username change
            // Missing or invalid username
            if (!message.username || !config.validateUsername(message.username))
                return error(client, 'Invalid username', 'BAD_USERNAME');
            // Already taken
            if ([...clients].filter(c => c !== client).map(c => c.username).includes(message.username))
                return error(client, 'Username already taken', 'ALREADY_TAKEN_USERNAME');

            client.username = message.username;
            game.onUsernameChange(client);
        } else if (message.type === 'READY') { // Ready up
            client.ready = !client.ready;
            game.onReady(client);
        } else if (message.type === 'MOVE') { // Move
            try {
                game.onMove(client, message);
            } catch (e) {
                signale.error(e);
            }
            if (game.config.syncAfterMove)
                gameStateSync(game.uuid);
        }
        game.onMessage(client, message);
    });

    // On disconnect
    connection.on('close', (conn: any) => {
        let game = games[client.gameID];
        if (game) game.onDisconnect(client);
        clients.delete(client);

        // No one in game, remove it
        if (game && !game.players.some((x: Client | null) => x))
            removeGame(game.uuid);
        else if (game)
            gameStateSync(game.uuid);
    });
});

export {};
