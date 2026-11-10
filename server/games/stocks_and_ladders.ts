import Game from '../game.js';
import Client from '../client.js';
import { GAME_CONFIG, PLAYER_COLORS } from '../../client/stocks_and_ladders/js/config.js';
import {
    createMatch, finishSettling, resolveRound, retractSubmission, selectView, setAllocation, submitAllocation
} from '../../client/stocks_and_ladders/js/engine.js';
import type { MatchState } from '../../client/stocks_and_ladders/js/engine.js';
import type { LobbySettings, Move, Sync } from '../../client/stocks_and_ladders/js/types.js';

const SEED_RANGE = 4294967296;
const MILLISECONDS_PER_SECOND = 1000;
const HOST_ONLY = 'Only the host can do that';
const ALREADY_STARTED = 'The match has already started';

class StocksAndLaddersGame extends Game {
    settings: LobbySettings = { rounds: GAME_CONFIG.defaultRounds, timerSeconds: GAME_CONFIG.defaultTimerSeconds };
    state: MatchState | null = null;
    private colors = new Map<Client, string>();
    private names: Array<string> = [];
    private phaseTimer: ReturnType<typeof setTimeout> | null = null;
    private phaseStartedAt = 0;
    private phaseEndsAt = 0;

    constructor() {
        super({ syncAfterMove: false, allowChat: false });
    }

    onRoomCreate() {
        // Setup happens when the host starts the match
    }

    onJoin(client: Client): boolean {
        if (this.players.includes(client)) return false;
        if (this.state) return this.rejoin(client);
        if (this.playerCount >= GAME_CONFIG.maximumPlayers || !super.onJoin(client)) return false;
        const taken = new Set(this.colors.values());
        this.colors.set(client, PLAYER_COLORS.find(color => !taken.has(color)) ?? PLAYER_COLORS[0]);
        return true;
    }

    private rejoin(client: Client): boolean {
        const seat = this.players.indexOf(null);
        if (seat === -1 || !this.state) return false;
        client.gameID = this.uuid;
        client.username = this.names[seat] ?? client.username;
        this.colors.set(client, this.state.players[seat].color);
        this.players[seat] = client;
        this.playerCount++;
        this.broadcastWhoYouAre();
        return true;
    }

    onDisconnect(client: Client) {
        const seat = this.players.indexOf(client);
        if (this.state && seat !== -1) this.names[seat] = client.username;
        super.onDisconnect(client);
        this.colors.delete(client);
        if (this.state) {
            this.resolveIfReady();
            return;
        }
        this.removeEmptySeats();
        this.broadcastWhoYouAre();
    }

    onUsernameChange() {
        this.syncAll();
    }

    onReady() {
        this.syncAll();
    }

    onRemove() {
        this.clearTimer();
        this.state = null;
        this.colors.clear();
    }

    private isHost(client: Client): boolean {
        return this.players.find(player => player !== null) === client;
    }

    private removeEmptySeats() {
        this.players = this.players.filter(player => player !== null);
        this.playerCount = this.players.length;
    }

    private fail(client: Client, error: string) {
        client.connection.sendUTF(JSON.stringify({ type: 'ERROR', code: 'MOVE', error }));
    }

    private setOptions(client: Client, move: Move): string {
        const { rounds, timerSeconds } = move;
        if (!this.isHost(client)) return HOST_ONLY;
        if (rounds !== undefined) {
            if (!GAME_CONFIG.roundPresets.includes(rounds)) return 'Invalid round count';
            this.settings.rounds = rounds;
        }
        if (timerSeconds !== undefined) {
            if (!GAME_CONFIG.timerPresets.includes(timerSeconds)) return 'Invalid timer';
            this.settings.timerSeconds = timerSeconds;
        }
        return '';
    }

    private setColor(client: Client, color: string | undefined): string {
        if (!color || !PLAYER_COLORS.includes(color)) return 'Unknown color';
        for (const [other, taken] of this.colors)
            if (other !== client && taken === color) return 'That color is taken';
        this.colors.set(client, color);
        return '';
    }

    private startGame(client: Client): string {
        if (!this.isHost(client)) return HOST_ONLY;
        if (this.playerCount < GAME_CONFIG.minimumPlayers) return 'Not enough players';
        if (!this.players.every(player => player === client || player?.ready)) return 'Everyone must be ready';
        this.names = this.players.map(player => (player as Client).username);
        this.state = createMatch(
            this.settings,
            Math.floor(Math.random() * SEED_RANGE),
            this.players.map(player => this.colors.get(player as Client) ?? PLAYER_COLORS[0])
        );
        this.beginPlanning();
        return '';
    }

    private returnToLobby(client: Client): string {
        if (!this.isHost(client)) return HOST_ONLY;
        if (this.state?.phase !== 'finished') return 'The match is not over';
        this.clearTimer();
        this.state = null;
        this.removeEmptySeats();
        for (const player of this.players) if (player) player.ready = false;
        this.broadcastWhoYouAre();
        return '';
    }

    private playMove(seat: number, move: Move): string {
        const state = this.state;
        if (!state) return 'The match has not started';
        if (move.action === 'SET_ALLOCATION') return setAllocation(state, seat, move.allocation);
        let error: string;
        if (move.action === 'SUBMIT') error = submitAllocation(state, seat, move.allocation);
        else if (move.action === 'UNSUBMIT') error = retractSubmission(state, seat);
        else return 'Unknown action';
        if (!error) this.resolveIfReady();
        return error;
    }

    onMove(client: Client, move: Move) {
        const seat = this.players.indexOf(client);
        if (!move || typeof move.action !== 'string' || seat === -1) return;
        let error: string;
        switch (move.action) {
            case 'SET_OPTIONS': error = this.state ? ALREADY_STARTED : this.setOptions(client, move); break;
            case 'SET_COLOR': error = this.state ? ALREADY_STARTED : this.setColor(client, move.color); break;
            case 'START_GAME': error = this.state ? ALREADY_STARTED : this.startGame(client); break;
            case 'RETURN_TO_LOBBY': error = this.returnToLobby(client); break;
            default: error = this.playMove(seat, move);
        }
        if (error) {
            this.fail(client, error);
            this.syncClient(client);
        } else if (move.action !== 'SET_ALLOCATION')
            this.syncAll();
    }

    private beginPlanning() {
        this.schedule(this.settings.timerSeconds * MILLISECONDS_PER_SECOND, () => {
            this.endPlanning();
            this.syncAll();
        });
    }

    private endPlanning() {
        if (!this.state) return;
        resolveRound(this.state);
        this.schedule(GAME_CONFIG.animationMilliseconds + GAME_CONFIG.settleMilliseconds, () => {
            if (!this.state) return;
            finishSettling(this.state);
            if (this.state.phase === 'planning') this.beginPlanning();
            else this.clearTimer();
            this.syncAll();
        });
    }

    private resolveIfReady() {
        const state = this.state;
        if (!state || state.phase !== 'planning' || this.playerCount === 0) return;
        if (state.players.every((player, seat) => player.submitted || this.players[seat] === null))
            this.endPlanning();
    }

    private schedule(milliseconds: number, callback: () => void) {
        this.clearTimer();
        this.phaseStartedAt = Date.now();
        this.phaseEndsAt = this.phaseStartedAt + milliseconds;
        this.phaseTimer = setTimeout(callback, milliseconds);
    }

    private clearTimer() {
        if (this.phaseTimer !== null) clearTimeout(this.phaseTimer);
        this.phaseTimer = null;
        this.phaseEndsAt = this.phaseStartedAt;
    }

    private syncClient(client: Client) {
        try {
            client.connection.sendUTF(JSON.stringify(this.globalStateSync(client)));
        } catch {
            // Broken connections are cleaned up on disconnect
        }
    }

    private syncAll() {
        for (const player of this.players)
            if (player) this.syncClient(player);
    }

    globalStateSync(client: Client): Sync {
        const seat = this.players.indexOf(client);
        const host = this.players.find(player => player !== null);
        const now = Date.now();
        return {
            type: 'SYNC',
            started: this.state !== null,
            youAre: seat,
            isHost: host === client,
            settings: { ...this.settings },
            seats: this.players.map((player, index) => ({
                username: player?.username ?? this.names[index] ?? '',
                ready: player === host || (player?.ready ?? true),
                color: player ? this.colors.get(player) ?? '' : this.state?.players[index]?.color ?? '',
                connected: player !== null
            })),
            remainingMilliseconds: Math.max(0, this.phaseEndsAt - now),
            elapsedMilliseconds: Math.max(0, now - this.phaseStartedAt),
            ...this.state && seat !== -1 ? { view: selectView(this.state, seat) } : {}
        };
    }
}

export default StocksAndLaddersGame;
