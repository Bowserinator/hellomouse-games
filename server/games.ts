// Load all games
import glob from 'glob';
import path from 'path';
import crypto from 'crypto';
import signale from 'signale';

import Client from './client.js';
import Game from './game.js';

const GAMES: any = {};
const GAME_TYPES: Array<string> = [];

export const games: { [id: string]: Game } = {}; // UUID: game
const gameCount: Record<string, number> = {}; // Type: count
const gameConfigs: { [id: string]: GameConfig } = {};

// Load all games
glob.sync('./server/games/**/*.js').forEach(async (file:string) => {
    let typeSplit = file.split('/');
    let type = typeSplit[typeSplit.length - 1].split('.')[0];

    if (type.startsWith('_')) // Ignore files starting with _
        return;

    signale.info(`Loading game '${file}' (${type})`);

    GAMES[type] = (await import(path.resolve(file))).default;
    GAME_TYPES.push(type);
    gameConfigs[type] = new GAMES[type]().config;
});


/**
 * Check if a game of a type can be created
 * @param {string} type
 * @returns {string} Error message, or '' if legal
 */
export function canCreateGame(type: string) {
    if (!GAME_TYPES.includes(type))
        return `Error: Game of type '${type}' does not exist`;
    // Can't be undefined since a default is generated in the game
    // @ts-expect-error
    if (!gameConfigs[type] || gameCount[type] >= gameConfigs[type].maxLobbies)
        return `Error: Too many '${type}' lobbies currently active, try again later`;
    return '';
}

/**
 * Create a game
 * @param {string} type
 * @param {Client} host
 * @return {boolean} Allowed to create
 */
export function createGame(type: string, host: Client): boolean {
    if (!GAME_TYPES.includes(type))
        return false;

    let game: Game = new GAMES[type]();

    game.uuid = crypto.randomBytes(16).toString('hex');
    game.onRoomCreate();
    game.type = type;
    games[game.uuid] = game;
    host.gameID = game.uuid;

    if (!gameCount[game.type])
        gameCount[game.type] = 0;
    gameCount[game.type]++;

    return true;
}

/**
 * Remove a game from active games list
 * @param {string} uuid of game to remove
 */
export function removeGame(uuid: string) {
    if (!games[uuid]) return;
    for (let player of games[uuid].players)
        if (player !== null)
            player.gameID = '';
    gameCount[games[uuid].type]--;
    games[uuid].onRemove();

    delete games[uuid];
}
