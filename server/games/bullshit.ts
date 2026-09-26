import Game from '../game.js';
import Client from '../client.js';

import Deck from '../../client/bullshit/js/game/deck.js';
import Card from '../../client/bullshit/js/game/card.js';

// Values taken from the original bullshit/config.js
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const TURN_TIME_SECONDS = 30;

// How long a disconnected player's seat is held open (mid-round) before
// they're actually removed from the game
const DISCONNECT_GRACE_SECONDS = 60;

// Card identities are withheld until the client's fan-out animation finishes
const REVEAL_SPREAD_MS = 400;
const REVEAL_SETTLE_MS = REVEAL_SPREAD_MS + 500 + 2000;

interface CardLike {
    value: number;
    suit: string;
}

interface BullshitMessage {
    action?: 'SUBMIT' | 'BS' | 'START_GAME';
    cards?: Array<CardLike>;
}

interface LastPlay {
    player: number;
    count: number;
}

interface LastEvent {
    seq: number;
    type: 'SUBMIT' | 'BS' | 'REVEAL';
    player?: number;
    count?: number;
    loser?: number;
    correct?: boolean;
    /** REVEAL only: pile contents, bottom of pile first */
    cards?: Array<CardLike>;
}

/**
 * Bullshit (card game), migrated from the standalone bullshit repo.
 * The card/deck mechanics (src/game/card.js, src/game/deck.js,
 * src/game/random.js) are reused as-is (see client/bullshit/js/game/).
 * The turn logic below is a port of the original src/game/game.js
 * "Game" class + gamemaster.js socket handlers, rewired to use
 * hellomouse-games' per-room Game/Client model (players are tracked
 * positionally via this.players, same as every other game here)
 * instead of bullshit's original global name-keyed singleton room.
 */
class BullshitGame extends Game {
    decks: Record<string, Deck>; // client.id -> hand
    centerDeck: Deck;
    started: boolean;
    turn: number;           // Index into this.players
    valueToPlace: number;   // 1 (ace) - 13 (king)
    turnWasBs: boolean;     // Was the last play not actually valueToPlace?
    bsCalled: boolean;      // Has BS already been called on the last play?
    winner: number;         // Index into this.players, or -1
    secondsRemaining: number;
    interval: ReturnType<typeof setInterval> | null;

    lastPlay: LastPlay | null;   // Currently staged (not yet buried) play
    lastEvent: LastEvent | null; // Most recent visual event, for client animation
    eventSeq: number;

    // client.id -> ms timestamp of when that player disconnected mid-round.
    // Presence of an id here means that seat is being held open during its
    // grace period (see onDisconnect / finalizeDisconnect below)
    disconnectedSince: Record<string, number>;
    // client.id -> pending removal timer for that disconnected player
    disconnectTimers: Record<string, ReturnType<typeof setTimeout>>;

    // BS reveal sequence state: moves + turn timer frozen while true
    revealInProgress: boolean;
    revealLoserId: string | null;
    revealTimers: Array<ReturnType<typeof setTimeout>>;

    constructor() {
        // We sync manually (moves, timer ticks, joins, etc all
        // trigger their own syncAll() call), same as tanks.ts / tpt_code.ts
        super({ syncAfterMove: false });

        this.decks = {};
        this.centerDeck = new Deck();
        this.started = false;
        this.turn = 0;
        this.valueToPlace = 1;
        this.turnWasBs = false;
        this.bsCalled = false;
        this.winner = -1;
        this.secondsRemaining = TURN_TIME_SECONDS;
        this.interval = null;
        this.lastPlay = null;
        this.lastEvent = null;
        this.eventSeq = 0;
        this.disconnectedSince = {};
        this.disconnectTimers = {};
        this.revealInProgress = false;
        this.revealLoserId = null;
        this.revealTimers = [];
    }

    onRoomCreate() {
        this.decks = {};
        this.centerDeck = new Deck();
        this.started = false;
        this.turn = 0;
        this.valueToPlace = 1;
        this.turnWasBs = false;
        this.bsCalled = false;
        this.winner = -1;
        this.secondsRemaining = TURN_TIME_SECONDS;
        this.lastPlay = null;
        this.lastEvent = null;
        this.eventSeq = 0;
        this.disconnectedSince = {};
        this.disconnectTimers = {};
        this.revealInProgress = false;
        this.revealLoserId = null;
        this.revealTimers = [];
    }

    onJoin(client: Client): boolean {
        if (this.started) {
            // Mid-round joins are only allowed to take over a seat that's
            // being held open for a disconnected player (see onDisconnect)
            const seatIndex = this.players.findIndex(p =>
                p !== null && this.disconnectedSince[p.id] !== undefined);
            if (seatIndex === -1) return false;
            return this.reconnectToSeat(client, seatIndex);
        }
        // Failed: too many players
        if (this.playerCount >= MAX_PLAYERS) return false;

        const joined = super.onJoin(client);
        if (!joined) return false;

        if (!this.decks[client.id])
            this.decks[client.id] = new Deck();

        this.syncAll();
        return true;
    }

    /**
     * Slot a newly-joined client into a seat that was being held open for
     * a disconnected player, taking over their hand/username/ready state
     * @param {Client} client The newly connected client
     * @param {number} seatIndex Index into this.players being taken over
     * @return {boolean} Always true (join succeeds)
     */
    reconnectToSeat(client: Client, seatIndex: number): boolean {
        const oldClient = this.players[seatIndex] as Client;
        this.clearDisconnectGrace(oldClient.id);

        // Move the seat's hand over to the new client id
        this.decks[client.id] = this.decks[oldClient.id] || new Deck();
        delete this.decks[oldClient.id];

        client.username = oldClient.username;
        client.ready = oldClient.ready;
        client.gameID = this.uuid;

        this.players[seatIndex] = client;
        this.broadcastWhoYouAre();
        this.syncAll();
        return true;
    }

    /** Cancel a pending grace-period removal timer for a client id, if any */
    clearDisconnectGrace(clientId: string) {
        const timer = this.disconnectTimers[clientId];
        if (timer !== undefined) clearTimeout(timer);
        delete this.disconnectTimers[clientId];
        delete this.disconnectedSince[clientId];
    }

    onDisconnect(client: Client) {
        if (!this.started) {
            super.onDisconnect(client);
            delete this.decks[client.id];
            // Don't reserve empty spots while still in the lobby
            // (this also means whoever is left at index 0 becomes
            // the new host if the old host leaves)
            this.players = this.players.filter(p => p !== null);
            this.playerCount = this.players.length;
            this.syncAll();
            return;
        }

        // Mid-round: hold the seat open (keep the hand, turn order, etc
        // intact) for a grace period instead of kicking immediately, so a
        // reconnecting player can pick back up where they left off
        const seatIndex = this.players.indexOf(client);
        if (seatIndex === -1) return;

        this.disconnectedSince[client.id] = Date.now();
        this.disconnectTimers[client.id] = setTimeout(
            () => this.finalizeDisconnect(client),
            DISCONNECT_GRACE_SECONDS * 1000
        );

        this.syncAll();
    }

    /**
     * Actually remove a player once their disconnect grace period has
     * elapsed without them reconnecting
     * @param {Client} client The (long-gone) disconnected client
     */
    finalizeDisconnect(client: Client) {
        const seatIndex = this.players.indexOf(client);
        // Already reconnected / already removed - nothing to do
        if (seatIndex === -1 || this.disconnectedSince[client.id] === undefined) return;

        this.clearDisconnectGrace(client.id);
        this.players[seatIndex] = null;
        this.playerCount--;
        delete this.decks[client.id];

        if (this.started && this.playerCount < MIN_PLAYERS)
            this.endGame(-1);

        this.syncAll();
        this.cleanupIfEmpty();
    }

    /** If every seat is now empty, remove this game from the active list */
    async cleanupIfEmpty() {
        if (this.players.some(p => p !== null)) return;
        try {
            const { removeGame } = await import('../games.js');
            removeGame(this.uuid);
        } catch (e) {
            // Best-effort cleanup only - if this fails the game just
            // lingers with no players, same as it would have before
        }
    }

    onUsernameChange() {
        this.syncAll();
    }

    onReady() {
        if (this.started) return;
        // Ready no longer auto-starts the game: the host explicitly
        // starts it (see handleStartGame) once everyone is ready
        this.syncAll();
    }

    /** @return {boolean} Is this client the host (first player)? */
    isHost(client: Client): boolean {
        return this.players.length > 0 && this.players[0] === client;
    }

    /**
     * Host explicitly starts the game once everyone has readied up
     * @param {Client} client
     */
    handleStartGame(client: Client) {
        if (this.started) return;
        if (!this.isHost(client)) return; // Only the host can start
        if (this.playerCount < MIN_PLAYERS) return;
        if (!this.everyoneReady()) return; // Only when everyone is accepted
        this.startGame();
    }

    /** Distribute a fresh, shuffled deck to all players and begin round 1 */
    startGame() {
        const players = this.players.filter(p => p !== null) as Array<Client>;

        let tempDeck = Deck.generateDefaultDeck();
        tempDeck.shuffle();

        let numCardsPerPlayer = Math.floor(tempDeck.cards.length / players.length);
        for (let i = 0; i < players.length; i++)
            this.decks[players[i].id].cards =
                tempDeck.cards.slice(i * numCardsPerPlayer, (i + 1) * numCardsPerPlayer);

        // Remaining cards go to the center deck
        this.centerDeck.cards = tempDeck.cards.slice(numCardsPerPlayer * players.length);

        this.turn = 0;
        this.valueToPlace = 1;
        this.turnWasBs = false;
        this.bsCalled = false;
        this.winner = -1;
        this.lastPlay = null;
        this.started = true;

        this.startTimer();
        this.syncAll();
    }

    /** End the current game, optionally with a winner */
    endGame(winner: number) {
        this.winner = winner;
        this.started = false;
        this.stopTimer();
        this.lastPlay = null;

        this.clearRevealTimers();
        this.revealInProgress = false;
        this.revealLoserId = null;

        // The "hold a seat open for reconnection" grace period only makes
        // sense mid-round - once we're back in the lobby, fall back to the
        // normal lobby behavior (empty seats are dropped immediately)
        for (let id of Object.keys(this.disconnectedSince)) {
            const seatIndex = this.players.findIndex(p => p !== null && p.id === id);
            this.clearDisconnectGrace(id);
            if (seatIndex !== -1) {
                this.players[seatIndex] = null;
                this.playerCount--;
                delete this.decks[id];
            }
        }
        this.players = this.players.filter(p => p !== null);

        // Unready everyone so a rematch requires a fresh ready-up + host start
        for (let p of this.players)
            if (p) p.ready = false;
    }

    /** @return {Client | null} The player whose turn came before the current one */
    getPreviousPlayer(): Client | null {
        if (this.players.length === 0) return null;
        let index = (this.turn - 1) % this.players.length;
        while (index < 0) index += this.players.length;
        return this.players[index];
    }

    advanceTurn() {
        this.turn = (this.turn + 1) % this.players.length;
        this.valueToPlace = 1 + this.valueToPlace % 13;
    }

    startTimer() {
        this.stopTimer();
        this.secondsRemaining = TURN_TIME_SECONDS;
        this.interval = setInterval(() => this.timerTick(), 1000);
    }

    stopTimer() {
        if (this.interval !== null)
            clearInterval(this.interval);
        this.interval = null;
    }

    timerTick() {
        if (!this.started) return;
        if (this.revealInProgress) return;

        if (this.secondsRemaining <= 0) {
            // Current player failed to move in time: counts as a bullshit play
            this.turnWasBs = true;
            this.bsCalled = false;
            this.advanceTurn();
            this.startTimer();
        } else
            this.secondsRemaining--;
        this.syncAll();
    }

    onMove(client: Client, message: BullshitMessage) {
        if (this.revealInProgress) return;

        if (!this.started) {
            if (message.action === 'START_GAME')
                this.handleStartGame(client);
            this.syncAll();
            return;
        }

        const playerIndex = this.players.indexOf(client);
        if (playerIndex === -1) return;

        if (message.action === 'BS')
            this.handleCallBs(playerIndex);
        else
            this.handleSubmit(playerIndex, message.cards || []);
        this.syncAll();
    }

    /**
     * A player attempts to place cards down
     * @param {number} playerIndex
     * @param {Array<CardLike>} cards Cards to place down
     */
    handleSubmit(playerIndex: number, cards: Array<CardLike>) {
        if (playerIndex !== this.turn) return; // Not your turn
        if (!cards.length) return; // Must submit at least 1 card

        const client = this.players[playerIndex] as Client;
        const deck = this.decks[client.id];

        // Filter cards the player does not actually have
        let owned = cards.filter(x =>
            deck.cards.some(card => card.suit === x.suit && card.value === x.value));
        if (!owned.length) return;

        let placed = owned.map(x => new Card(x.value, x.suit));
        this.turnWasBs = false;
        this.bsCalled = false;

        for (let card of placed)
            if (card.value !== this.valueToPlace) {
                this.turnWasBs = true;
                break;
            }

        this.centerDeck.addCards(placed);
        deck.removeCards(placed);

        this.lastPlay = { player: playerIndex, count: placed.length };
        this.lastEvent = {
            seq: ++this.eventSeq,
            type: 'SUBMIT',
            player: playerIndex,
            count: placed.length
        };

        if (deck.cards.length === 0) {
            this.endGame(playerIndex);
            return;
        }

        this.advanceTurn();
        this.startTimer();
    }

    /**
     * A player attempts to call bs on the previous move
     * @param {number} playerIndex
     */
    handleCallBs(playerIndex: number) {
        if (this.bsCalled) return; // BS was already called
        if (this.centerDeck.cards.length === 0) return;

        const previous = this.getPreviousPlayer();
        const client = this.players[playerIndex];
        if (!previous || !client || previous === client) return; // Cannot call BS on self

        this.bsCalled = true;
        const loserIndex = this.turnWasBs ? this.players.indexOf(previous) : playerIndex;
        const pileSize = this.centerDeck.cards.length;
        const previousIndex = this.players.indexOf(previous);
        const lastCount = this.lastPlay && this.lastPlay.player === previousIndex
            ? this.lastPlay.count : 0;
        this.lastPlay = null;

        this.revealInProgress = true;
        this.revealLoserId = (this.players[loserIndex] as Client).id;
        this.stopTimer();
        this.lastEvent = {
            seq: ++this.eventSeq,
            type: 'BS',
            loser: loserIndex,
            count: pileSize,
            correct: this.turnWasBs
        };

        this.revealTimers.push(setTimeout(() => {
            this.lastEvent = {
                seq: ++this.eventSeq,
                type: 'REVEAL',
                loser: loserIndex,
                count: pileSize,
                correct: this.turnWasBs,
                cards: lastCount > 0
                    ? this.centerDeck.cards.slice(-lastCount).map(c => ({ value: c.value, suit: c.suit }))
                    : []
            };
            this.syncAll();
        }, REVEAL_SPREAD_MS));

        this.revealTimers.push(setTimeout(() => this.finishReveal(), REVEAL_SETTLE_MS));
    }

    finishReveal() {
        this.clearRevealTimers();

        if (this.started && this.revealLoserId !== null) {
            const deck = this.decks[this.revealLoserId];
            if (deck) {
                deck.mergeDeck(this.centerDeck);
                this.centerDeck.clear();
            }
        }

        this.revealLoserId = null;
        this.revealInProgress = false;
        if (this.started) this.startTimer();
        this.syncAll();
    }

    clearRevealTimers() {
        for (let timer of this.revealTimers) clearTimeout(timer);
        this.revealTimers = [];
    }

    globalStateSync(player: Client) {
        const deck = this.decks[player.id];
        return {
            type: 'SYNC',
            started: this.started,
            turn: this.turn,
            youAre: this.players.indexOf(player),
            isHost: this.isHost(player),
            valueToPlace: this.valueToPlace,
            secondsRemaining: this.secondsRemaining,
            centerDeckSize: this.centerDeck.cards.length,
            winner: this.winner,
            bsCalled: this.bsCalled,
            lastPlay: this.lastPlay,
            lastEvent: this.lastEvent,
            players: this.players.map(p => {
                if (!p) return null;
                const disconnectedAt = this.disconnectedSince[p.id];
                const disconnected = disconnectedAt !== undefined;
                const graceSecondsRemaining = disconnected ?
                    Math.max(0, DISCONNECT_GRACE_SECONDS - Math.floor((Date.now() - disconnectedAt) / 1000)) :
                    0;
                return {
                    username: p.username,
                    ready: p.ready,
                    numCards: this.decks[p.id] ? this.decks[p.id].cards.length : 0,
                    disconnected,
                    graceSecondsRemaining
                };
            }),
            selfDeck: deck ? deck.cards.map(c => ({ value: c.value, suit: c.suit })) : []
        };
    }

    /** Send a personalized SYNC to every connected player */
    syncAll() {
        for (let player of this.players) {
            if (!player) continue;
            // Players held open during their disconnect grace period have a
            // dead connection - sending to them would throw, so skip them
            if (this.disconnectedSince[player.id] !== undefined) continue;
            try {
                player.connection.sendUTF(JSON.stringify(this.globalStateSync(player)));
            } catch (e) {
                // Connection died without triggering onDisconnect yet - ignore,
                // the grace-period cleanup will catch up with it shortly
            }
        }
    }

    onRemove() {
        this.stopTimer();
        this.clearRevealTimers();
        for (let id of Object.keys(this.disconnectTimers))
            clearTimeout(this.disconnectTimers[id]);
        this.disconnectTimers = {};
    }
}

export default BullshitGame;
