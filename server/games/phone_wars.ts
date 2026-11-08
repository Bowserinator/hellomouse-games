import Game from '../game.js';
import Client from '../client.js';
import { COMPANY_THEMES, GAME_CONFIG, MATCH_MODES, MONEY_MULTIPLIERS } from '../../client/phone_wars/js/config.js';
import { advanceGame, applyAction, createMatchState, rankPlayers, selectPlayerView } from '../../client/phone_wars/js/engine.js';
import type { Action, LobbySettings, MatchState, Move, Sync } from '../../client/phone_wars/js/types.js';

const POLL_MILLISECONDS = 25;
const SYNC_MILLISECONDS = 200;

class PhoneWarsGame extends Game {
    settings: LobbySettings = { target: GAME_CONFIG.referenceTargetPhones, mode: 'standard', moneyMultiplier: 1 };
    state: MatchState | null = null;
    private companies = new Map<Client, string>();
    private observers = new Set<Client>();
    private names: Array<string> = [];
    private timer: ReturnType<typeof setInterval> | null = null;
    private lastTick = 0;
    private pending = 0;
    private lastSync = 0;

    constructor() {
        super({ syncAfterMove: false, allowChat: false });
    }

    onRoomCreate() {
        // Nothing to prepare until players join
    }

    onJoin(client: Client): boolean {
        if (this.players.includes(client) || this.observers.has(client)) return false;
        if (this.state) {
            const seat = this.players.indexOf(null);
            if (seat === -1) return this.watch(client);
            client.gameID = this.uuid;
            client.username = this.names[seat] ?? client.username;
            this.companies.set(client, this.state.players[seat].companyId);
            this.players[seat] = client;
            this.playerCount++;
            this.broadcastWhoYouAre();
            return true;
        }
        if (this.playerCount >= GAME_CONFIG.maximumPlayers) return this.watch(client);
        if (!super.onJoin(client)) return false;
        this.assignCompany(client);
        return true;
    }

    private watch(client: Client): boolean {
        client.gameID = this.uuid;
        this.observers.add(client);
        this.syncAll();
        return true;
    }

    private assignCompany(client: Client) {
        const taken = new Set(this.companies.values());
        this.companies.set(client, COMPANY_THEMES.find(theme => !taken.has(theme.id))?.id ?? COMPANY_THEMES[0].id);
    }

    private promoteObservers() {
        for (const client of [...this.observers]) {
            if (this.playerCount >= GAME_CONFIG.maximumPlayers) break;
            this.observers.delete(client);
            super.onJoin(client);
            this.assignCompany(client);
        }
    }

    onDisconnect(client: Client) {
        if (this.observers.delete(client)) {
            this.syncAll();
            return;
        }
        const seat = this.players.indexOf(client);
        if (this.state && seat !== -1) this.names[seat] = client.username;
        super.onDisconnect(client);
        this.companies.delete(client);
        if (!this.state) {
            this.players = this.players.filter(player => player !== null);
            this.promoteObservers();
            this.broadcastWhoYouAre();
        }
        this.syncAll();
    }

    onUsernameChange() {
        this.syncAll();
    }

    onReady() {
        this.syncAll();
    }

    onRemove() {
        this.stopTimer();
        this.state = null;
        this.companies.clear();
        this.observers.clear();
    }

    private isHost(client: Client): boolean {
        return this.players.find(player => player !== null) === client;
    }

    private fail(client: Client, error: string) {
        client.connection.sendUTF(JSON.stringify({ type: 'ERROR', code: 'MOVE', error }));
    }

    private minimumPlayers(): number {
        return this.settings.mode === 'peaceful' ? GAME_CONFIG.minimumPlayersPeaceful : GAME_CONFIG.minimumPlayers;
    }

    private setOptions(client: Client, move: Move): string {
        const { target, mode, moneyMultiplier } = move;
        if (!this.isHost(client)) return 'Only the host can do that';
        if (target !== undefined) {
            if (!GAME_CONFIG.targetPresets.includes(target)) return 'Invalid target';
            this.settings.target = target;
        }
        if (mode !== undefined) {
            if (!MATCH_MODES.includes(mode)) return 'Invalid mode';
            this.settings.mode = mode;
        }
        if (moneyMultiplier !== undefined) {
            if (!MONEY_MULTIPLIERS.includes(moneyMultiplier)) return 'Invalid money multiplier';
            this.settings.moneyMultiplier = moneyMultiplier;
        }
        for (const player of this.players) if (player) player.ready = false;
        return '';
    }

    private setCompany(client: Client, company: string | undefined): string {
        if (!COMPANY_THEMES.some(theme => theme.id === company)) return 'Unknown company';
        for (const [other, id] of this.companies)
            if (other !== client && id === company) return 'That company is taken';
        this.companies.set(client, company as string);
        return '';
    }

    private startGame(client: Client): string {
        if (!this.isHost(client)) return 'Only the host can do that';
        if (this.playerCount < this.minimumPlayers()) return 'Not enough players';
        if (!this.players.every(player => player === client || player?.ready)) return 'Everyone must be ready';
        this.names = this.players.map(player => (player as Client).username);
        this.state = createMatchState(
            { ...this.settings, seed: Math.floor(Math.random() * 4294967296) },
            this.players.map(player => this.companies.get(player as Client) ?? COMPANY_THEMES[0].id)
        );
        this.timer = setInterval(() => this.tick(), POLL_MILLISECONDS);
        this.lastTick = Date.now();
        this.pending = 0;
        return '';
    }

    private returnToLobby(): string {
        if (!this.state || this.state.winner < 0) return 'The match is not over';
        this.stopTimer();
        this.state = null;
        const present: Array<Client> = [];
        for (const player of this.players) if (player) present.push(player);
        this.players = present;
        this.playerCount = present.length;
        for (const player of present) player.ready = false;
        this.promoteObservers();
        this.broadcastWhoYouAre();
        return '';
    }

    onMove(client: Client, move: Move) {
        const seat = this.players.indexOf(client);
        if (!move || typeof move.action !== 'string' || seat === -1) return;
        let error = '';

        if (move.action === 'SET_OPTIONS' || move.action === 'SET_COMPANY' || move.action === 'START_GAME') {
            if (this.state) error = 'The match has already started';
            else if (move.action === 'SET_OPTIONS') error = this.setOptions(client, move);
            else if (move.action === 'SET_COMPANY') error = this.setCompany(client, move.company);
            else error = this.startGame(client);
        } else if (move.action === 'RETURN_TO_LOBBY') error = this.returnToLobby();
        else if (!this.state) error = 'The match has not started';
        else {
            const action = this.toAction(seat, move);
            if (!action) error = 'Invalid action';
            else {
                const result = applyAction(this.state, action);
                if (!result.ok && action.type !== 'make_phone') error = result.error ?? 'Rejected';
                if (action.type === 'make_phone' && (this.state.winner < 0 || !result.ok)) return;
            }
        }
        if (error) this.fail(client, error);
        this.syncAll();
    }

    private toAction(playerId: number, move: Move): Action | null {
        if (move.action === 'make_phone') return { type: 'make_phone', playerId };
        if (move.action === 'buy_project' && typeof move.upgradeId === 'string')
            return { type: 'buy_project', playerId, upgradeId: move.upgradeId };
        if (move.action === 'buy_machine' && typeof move.machineId === 'string' &&
            (move.quantity === 'max' || typeof move.quantity === 'number'))
            return { type: 'buy_machine', playerId, machineId: move.machineId, quantity: move.quantity };
        if (move.action === 'activate_ability' && typeof move.abilityId === 'string')
            return { type: 'activate_ability', playerId, abilityId: move.abilityId, targetPlayerId: move.targetSeat };
        return null;
    }

    private tick() {
        const state = this.state;
        if (!state) {
            this.stopTimer();
            return;
        }
        const now = Date.now();
        this.pending = Math.min(1, this.pending + (now - this.lastTick) / 1000);
        this.lastTick = now;
        while (this.pending >= GAME_CONFIG.stepSeconds) {
            advanceGame(state, GAME_CONFIG.stepSeconds);
            this.pending -= GAME_CONFIG.stepSeconds;
        }
        if (state.winner >= 0) this.stopTimer();
        if (state.winner >= 0 || now - this.lastSync >= SYNC_MILLISECONDS) this.syncAll();
    }

    private stopTimer() {
        if (this.timer !== null) clearInterval(this.timer);
        this.timer = null;
    }

    private syncAll() {
        this.lastSync = Date.now();
        for (const player of [...this.players, ...this.observers])
            if (player)
                try {
                    player.connection.sendUTF(JSON.stringify(this.globalStateSync(player)));
                } catch {
                    // The disconnect handler cleans up broken connections
                }
    }

    globalStateSync(client: Client): Sync {
        const seat = this.players.indexOf(client);
        const viewSeat = seat !== -1 || !this.state ? seat : rankPlayers(this.state)[0];
        return {
            type: 'SYNC',
            started: this.state !== null,
            youAre: seat,
            isHost: this.isHost(client),
            settings: { ...this.settings },
            seats: this.players.map((player, index) => ({
                username: player?.username ?? this.names[index] ?? '',
                ready: player === this.players.find(Boolean) || (player?.ready ?? true),
                company: player ? this.companies.get(player) ?? '' : this.state?.players[index]?.companyId ?? '',
                connected: player !== null
            })),
            ...this.state && viewSeat !== -1 ? { view: selectPlayerView(this.state, viewSeat) } : {}
        };
    }
}

export default PhoneWarsGame;
