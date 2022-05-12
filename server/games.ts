// Load all games
const glob = require('glob');
const path = require('path');
const crypto = require('crypto');

import Client from './client.js';
import Game from './game.js';

const GAMES: any = {};
const GAME_TYPES: Array<string> = [];

glob.sync('./server/games/**/*.js').forEach((file:string) => {
    console.log(file);
    let typeSplit = file.split('/');
    let type = typeSplit[typeSplit.length - 1].split('.')[0];

    GAMES[type] = require(path.resolve(file));
    GAME_TYPES.push(type);
});

let games: { [id: string]: Game };
games = {}; // UUID: game

/**
 * Create a game
 * @param {string} type
 * @param {Client} host
 * @return {boolean} Allowed to create
 */
function createGame(type: string, host: Client): boolean {
    if (!GAME_TYPES.includes(type))
        return false;

    let game: Game = new GAMES[type]();

    game.uuid = crypto.randomBytes(16).toString('hex');
    game.onRoomCreate();
    games[game.uuid] = game;
    host.gameID = game.uuid;

    return true;
}

/**
 * Remove a game from active games list
 * @param {string} uuid of game to remove
 */
function removeGame(uuid: string) {
    if (!games[uuid]) return;
    for (let player of games[uuid].players)
        if (player !== null)
            player.gameID = '';

    delete games[uuid];
}

console.log(GAME_TYPES);

module.exports = {
    createGame,
    removeGame,
    games
};
