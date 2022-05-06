// Load all games
const glob = require('glob');
const path = require('path');
const crypto = require('crypto');

const GAMES = {};
const GAME_TYPES = [];
glob.sync('./server/games/**/*.js').forEach(file => {
    console.log(file)
    let type = file.split('/');
    type = type[type.length - 1].split('.')[0];
    GAMES[type] = require(path.resolve(file));
    GAME_TYPES.push(type);
});

let games = {}; // UUID: game

/**
 * Create a game
 * @param {string} type
 * @param {Client} host
 * @return {boolean} Allowed to create
 */
function createGame(type, host) {
    if (!GAME_TYPES.includes(type))
        return false;
    let game = new GAMES[type]();

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
function removeGame(uuid) {
    for (let player of games[game.uuid].players.filter(x => x))
        player.gameID = null;
    games[game.uuid] = undefined;
}

console.log(GAME_TYPES)

module.exports = {
    createGame,
    removeGame,
    games
};
