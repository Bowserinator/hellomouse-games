// Load all games
import glob from 'glob';
import path from 'path';
import crypto from 'crypto';
import signale from 'signale';

import Client from './client.js';
import Game from './game.js';

const GAMES: any = {};
const GAME_TYPES: Array<string> = [];

glob.sync('./server/games/**/*.js').forEach(async (file:string) => {
    let typeSplit = file.split('/');
    let type = typeSplit[typeSplit.length - 1].split('.')[0];

    if (type.startsWith('_')) // Ignore files starting with _
        return;

    signale.info(`Loading game '${file}'`);

    GAMES[type] = (await import(path.resolve(file))).default;
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

signale.info('All loaded game types:');
GAME_TYPES.forEach(signale.info);

export { createGame, removeGame, games };
