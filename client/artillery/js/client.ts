import { connectToGame, GameConnection } from '../../shared/ts/game-connection.js';
import { ArtilleryAudio } from './audio/sound.js';
import { audioDefaultVolume, defaultMatchSettings, isMatchSettingValid, keyboardBindings, pingIntervalInMilliseconds,
    planningPreviewUpdatesPerSecond, practiceSettings, oceanFogDensity, oceanMaximumFogDensity,
    protocolVersion, resolveFastForwardTicksPerFrame, resolveMovementSpeedMultiplier,
    simulationTicksPerSecond } from './config.js';
import { weaponDataHash } from './data/weapon-data-hash.js';
import { loadBattlefield } from './loading.js';
import { LobbyState, MatchDescription, validateLobbyState, validateMatchDescription, validateMatchSnapshot,
    validateTurnEntry } from './match-messages.js';
import { ArtilleryScene } from './render/artillery-scene.js';
import { LobbyBackground } from './render/lobby-background.js';
import { EffectProfile } from './render/particle-emitter.js';
import { RenderingQuality } from './render/scene-lighting.js';
import { Match } from './sim/match.js';
import { solveAutoAim } from './sim/auto-aim.js';
import { quantizeYaw } from './sim/math/fixed-quantize.js';
import { isPlanningPreview } from './plan-validation.js';
import { Tank } from './sim/tank.js';
import { describeWeapon } from './sim/weapon-summary.js';
import { WeaponDataFiles } from './sim/weapon-types.js';
import { warmUpTerrainEdits } from './sim/world/terrain-edit.js';
import { WorldTheme, resolveTheme } from './sim/world/themes.js';
import { MatchPhase, MatchSnapshot, MovementInput, PlayerPlan, PlayerStatistics, SeatPlan, TurnKind } from './types.js';
import { ArtilleryUI, UiAction } from './ui.js';

declare function beep(): void;

export class ArtilleryClient {
    private readonly connection: GameConnection;
    private readonly physicsHash: number;
    private readonly listeners = new AbortController();
    private readonly keys = new Set<string>();
    private description: MatchDescription | null = null;
    private lobby: LobbyState | null = null;
    private match: Match | null = null;
    private scene: ArtilleryScene | null = null;
    private background: LobbyBackground | null = null;
    private audio: ArtilleryAudio | null = null;
    private loading: AbortController | null = null;
    private phase: MatchPhase = 'LOBBY';
    private isPractice = false;
    private isOffline = false;
    private practiceImpactReached = false;
    private practiceTimeOfDay: number | undefined;
    private practiceIslandTheme: number | undefined;
    private practiceSeed: number | null = null;
    private fogDensity = oceanFogDensity;
    private seatIndex = -1;
    private room = location.search.slice(1).split('=')[0];
    private username = `User${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
    private segments: Array<[number, number]> = [];
    private selected: string | null = null;
    private lockedSeats: Array<number> = [];
    private previousPlan: PlayerPlan | null = null;
    private deadline = 0;
    private lastCountdownBeep = -1;
    private clockOffset = 0;
    private touchMask = 0;
    private accumulator = 0;
    private previousTime = 0;
    private lastPreviewTime = -Infinity;
    private lastRecoveryTurn = -1;
    private frame = 0;
    private disposed = false;
    private quality: RenderingQuality = 'high';
    private volume = audioDefaultVolume;
    private ambientOcclusion = true;
    private shake = true;
    private showHitboxes = false;
    private usernameSubmitted = false;
    private usernameRejected = false;

    constructor(private readonly ui: ArtilleryUI, private readonly data: WeaponDataFiles,
        private readonly effects: Readonly<Record<string, EffectProfile>>,
        private readonly themes: ReadonlyArray<Readonly<WorldTheme>>) {
        this.physicsHash = weaponDataHash(data);
        try {
            this.username = localStorage.getItem('artillery.username') || this.username;
        } catch {/* Storage is optional. */}
        this.ui.setUsername(this.username);
        this.connection = connectToGame({ gameType: 'artillery', pingIntervalInMilliseconds,
            pingLabel: ui.ping, disconnectBanner: ui.disconnected,
            onMessage: message => {
                try {
                    this.message(message);
                } catch (error) {
                    this.fail(error);
                }
            }, onClose: () => {
                if (this.isPractice) {
                    this.ui.disconnected.hidden = true;
                    return;
                }
                if (!this.lobby && !this.match) this.isOffline = true;
                this.keys.clear(); this.touchMask = 0; this.loading?.abort(); this.audio?.stop();
                this.background?.dispose(); this.background = null;
                this.phase = 'ENDED'; this.refreshPlanning();
                if (!this.disposed) this.ui.showReconnect();
            } });
        const signal = this.listeners.signal;
        document.addEventListener('keydown', event => this.key(event, true), { signal });
        document.addEventListener('keyup', event => this.key(event, false), { signal });
        window.addEventListener('blur', () => {
            this.keys.clear(); this.touchMask = 0;
        }, { signal });
        window.addEventListener('resize', () => {
            this.scene?.resize(innerWidth, innerHeight); this.background?.resize(innerWidth, innerHeight);
        }, { signal });
        window.addEventListener('pagehide', () => this.dispose(), { signal });
        window.addEventListener('pageshow', event => {
            if (event.persisted) location.reload();
        }, { signal });
        document.addEventListener('visibilitychange', () => {
            this.keys.clear(); this.touchMask = 0;
            if (document.hidden) {
                this.audio?.stop(); this.finishHiddenResolve();
            }
            this.previousTime = performance.now();
        }, { signal });
        this.frame = requestAnimationFrame(this.animate);
    }

    action(action: UiAction): void {
        if (this.disposed) return;
        this.audio?.unlock();
        if (action.type === 'practice' && !this.canPractice()) return;
        if (action.type === 'practice' && (this.phase === 'LOBBY' || this.phase === 'ENDED') ||
            action.type === 'practiceReset' && this.isPractice) {
            if (action.type === 'practice') this.practiceSeed = null;
            void this.startPractice().catch(error => this.fail(error));
            return;
        }
        if (action.type === 'practiceTime' && this.isPractice) {
            if (!isMatchSettingValid('timeOfDay', action.value)) return;
            this.practiceTimeOfDay = action.value as number;
            void this.startPractice().catch(error => this.fail(error));
            return;
        }
        if (action.type === 'practiceTheme' && this.isPractice) {
            if (!isMatchSettingValid('islandTheme', action.value)) return;
            this.practiceIslandTheme = action.value as number;
            void this.startPractice().catch(error => this.fail(error));
            return;
        }
        if (action.type === 'practiceExit' && this.isPractice) {
            location.reload();
            return;
        }
        if (action.type === 'send') {
            if (this.isPractice) return;
            if (action.message.type === 'USERNAME' && typeof action.message.username === 'string') {
                this.username = action.message.username; this.usernameSubmitted = true;
            }
            this.connection.send(action.message);
        } else if (action.type === 'unlockAudio') this.audio?.unlock();
        else if (action.type === 'quality') {
            if (action.value === 'low' || action.value === 'medium' || action.value === 'high') {
                this.quality = action.value; this.scene?.setQuality(this.quality);
            }
        } else if (action.type === 'volume' && typeof action.value === 'number') {
            this.volume = Math.max(0, Math.min(1, action.value)); this.audio?.setVolume(this.volume);
        } else if (action.type === 'fog' && typeof action.value === 'number' && Number.isFinite(action.value)) {
            this.fogDensity = Math.max(0, Math.min(1, action.value)) * oceanMaximumFogDensity;
            this.scene?.setFogDensity(this.fogDensity); this.background?.setFogDensity(this.fogDensity);
        } else if (action.type === 'hitboxes') {
            this.scene?.setHitboxesVisible(this.showHitboxes = action.value === true);
        } else if (action.type === 'ao') {
            this.ambientOcclusion = action.value === true; this.scene?.setAmbientOcclusion(this.ambientOcclusion);
        } else if (action.type === 'shake') {
            this.shake = action.value === true;
            if (this.scene) this.scene.camera.shakeEnabled = this.shake;
        } else if (action.type === 'projection' && this.scene) {
            this.scene.camera.toggleProjection();
            this.ui.pressed('projection', this.scene.camera.camera instanceof THREE.OrthographicCamera);
        } else if (action.type === 'xray' && this.scene) {
            this.scene.setXray(!this.scene.isXrayEnabled); this.ui.pressed('xray', this.scene.isXrayEnabled);
        } else if (action.type === 'recenter') this.scene?.focusPlayer(this.seatIndex);
        else if (action.type === 'focusPlayer') this.scene?.focusPlayer(action.seatIndex);
        else if (action.type === 'lock' && this.canPlan) {
            if (this.isPractice) {
                this.previousPlan = this.plan();
                this.practiceImpactReached = false;
                this.match!.beginResolve(this.match!.turnIndex, this.match!.turnKind,
                    [{ seatIndex: this.seatIndex, plan: this.plan() }]);
                this.phase = 'RESOLVING'; this.keys.clear(); this.touchMask = 0; this.accumulator = 0;
                this.scene?.setPlanning(false); this.scene?.followOwnShots(); this.refreshPlanning();
                this.finishHiddenResolve();
                return;
            }
            const locked = this.lockedSeats.includes(this.seatIndex);
            if (this.connection.send({ type: locked ? 'PLAN_UNLOCK' : 'PLAN_LOCK', turnIndex: this.match!.turnIndex,
                ...(locked ? {} : { plan: this.plan() }) })) {
                this.lockedSeats = this.lockedSeats.filter(index => index !== this.seatIndex);
                if (!locked) this.lockedSeats.push(this.seatIndex);
                this.touchMask = 0; this.refreshPlanning();
            }
        } else if (action.type === 'drive')
            this.touchMask = action.down ? this.touchMask | action.mask : this.touchMask & ~action.mask;
        else if (this.canAim) {
            const tank = this.ownTank!;
            if (action.type === 'aim') {
                tank.turretYawQuantized = action.yaw;
                tank.turretPitchQuantized = action.pitch;
                tank.powerCentipercent = action.power;
            } else if (action.type === 'autoAim' && this.isPractice) this.autoAim(tank);
            else if (action.type === 'weapon' || action.type === 'cycleWeapon') {
                let identifier = action.type === 'weapon' ? action.identifier : '';
                if (action.type === 'cycleWeapon') {
                    const available = this.data.weapons.filter(weapon =>
                        (tank.ammunition.get(weapon.identifier) ?? 0) > 0);
                    if (available.length === 0) return;
                    const index = available.findIndex(weapon => weapon.identifier === this.selected);
                    identifier = available[(index + Math.sign(action.direction) + available.length) %
                        available.length].identifier;
                }
                if ((tank.ammunition.get(identifier) ?? 0) > 0) {
                    this.selected = identifier; this.match!.runtime.selectWeapon(this.seatIndex, identifier);
                }
            }
            this.refreshPlanning();
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        cancelAnimationFrame(this.frame); this.listeners.abort(); this.loading?.abort();
        this.background?.dispose(); this.scene?.dispose(); this.audio?.dispose(); this.connection.dispose();
    }

    private get ownTank(): Tank | undefined {
        return this.match?.runtime.tanks.find(tank => tank.seatIndex === this.seatIndex);
    }
    private get canPlan(): boolean {
        return this.phase === 'PLANNING' && !!this.ownTank && !this.ownTank.isWreck;
    }
    private get canEdit(): boolean {
        return this.canPlan && !this.lockedSeats.includes(this.seatIndex);
    }
    /** Driving is planned in the moving turn, aiming and weapon choice in the firing turn. */
    private get canMove(): boolean {
        return this.canEdit && this.match?.turnKind !== 'FIRING';
    }
    private get canAim(): boolean {
        return this.canEdit && this.match?.turnKind !== 'MOVING';
    }
    private get planLimitInSeconds(): number {
        const settings = this.match!.settings;
        return this.match!.turnKind === 'MOVING' ? settings.movePlanningTimeLimitInSeconds
            : settings.firePlanningTimeLimitInSeconds;
    }

    private async startPractice(): Promise<void> {
        this.isPractice = true; this.seatIndex = 0; this.connection.dispose();
        this.keys.clear(); this.touchMask = 0; this.segments = []; this.lockedSeats = []; this.accumulator = 0;
        const timeOfDay = this.practiceTimeOfDay ?? this.lobby?.settings.timeOfDay ?? defaultMatchSettings.timeOfDay;
        const islandTheme = this.practiceIslandTheme ?? this.lobby?.settings.islandTheme ??
            defaultMatchSettings.islandTheme;
        this.ui.notice(''); this.ui.disconnected.hidden = true; this.ui.setPractice(true, timeOfDay, islandTheme);
        const description: MatchDescription = { protocolVersion, weaponDataHash: this.physicsHash,
            matchSeed: this.practiceSeed ??= crypto.getRandomValues(new Uint32Array(1))[0],
            settings: { ...defaultMatchSettings, isSandbox: true,
                mapEdgeLengthInVoxels: this.lobby?.settings.mapEdgeLengthInVoxels ??
                    defaultMatchSettings.mapEdgeLengthInVoxels,
                timeOfDay, islandTheme,
                hitPointsPerTank: practiceSettings.hitPointsPerTank },
            seats: Array.from({ length: practiceSettings.playerCount }, (_unused, seatIndex) => ({ seatIndex,
                teamIndex: seatIndex === 0 ? 0 : 1, username: seatIndex === 0 ? this.username : `Target${seatIndex}`,
                isReady: true, isMissing: false })) };
        this.ui.lobby(description.seats, description.settings, 0, 0, false);
        await this.load(description);
    }

    private beginPracticeTurn(): void {
        this.phase = 'PLANNING'; this.segments = []; this.lockedSeats = []; this.accumulator = 0;
        this.lastCountdownBeep = -1;
        this.deadline = Date.now() + this.clockOffset + this.planLimitInSeconds * 1000;
        this.chooseWeapon(); this.scene?.setPlanning(true); this.refreshPlanning();
    }

    private message(message: Record<string, unknown>): void {
        if (this.isPractice) return;
        if (message.type === 'UUID' && typeof message.uuid === 'string') {
            this.room = message.uuid;
            this.ui.setInviteLink(new URL(`?${encodeURIComponent(this.room)}`, location.href).href);
            try {
                const reconnectToken = localStorage.getItem(`artillery.token.${this.room}`);
                if (reconnectToken) this.connection.send({ type: 'RECONNECT_TOKEN', reconnectToken });
            } catch {
                this.ui.notice('Storage is unavailable. Reloading cannot restore this seat.');
            }
            this.connection.send({ type: 'USERNAME', username: this.username });
        } else if (message.type === 'RECONNECT_TOKEN' && typeof message.reconnectToken === 'string')
            try {
                localStorage.setItem(`artillery.token.${this.room}`, message.reconnectToken);
            } catch {
                this.ui.notice('Storage is unavailable. Reloading cannot restore this seat.');
            }
        else if (message.type === 'YOUARE' && Number.isSafeInteger(message.index)) {
            this.seatIndex = message.index as number; this.refreshLobby();
        } else if (message.type === 'PING' && typeof message.serverTime === 'number' &&
            Number.isFinite(message.serverTime) && typeof message.ping === 'number')
            this.clockOffset = message.serverTime - (Date.now() + message.ping) / 2;
        else if (message.type === 'LOBBY_STATE') {
            validateLobbyState(message); this.lobby = message; this.refreshLobby();
        } else if (message.type === 'SEAT_STATUS' && this.description) {
            if (typeof message.isMissing !== 'boolean' || !this.description.seats.some(seat =>
                seat.seatIndex === message.seatIndex)) throw new Error('Invalid seat status');
            const isMissing = message.isMissing;
            if (isMissing && message.seatIndex !== this.seatIndex) this.alert();
            this.description = { ...this.description, seats: this.description.seats.map(seat =>
                seat.seatIndex === message.seatIndex ? { ...seat, isMissing } : seat) };
            if (this.lobby) this.lobby = { ...this.lobby, seats: this.lobby.seats.map(seat =>
                seat.seatIndex === message.seatIndex ? { ...seat, isMissing } : seat) };
        } else if (message.type === 'MATCH_START') {
            validateMatchDescription(message);
            void this.load(message).catch(error => this.fail(error));
        } else if (message.type === 'MATCH_SNAPSHOT') {
            validateMatchSnapshot(message.snapshot);
            void this.load(message.snapshot, message.snapshot).catch(error => this.fail(error));
        } else if (message.type === 'TURN_BEGIN' && !this.loading && this.match) {
            if (message.turnIndex !== this.match.turnIndex || message.kind !== this.match.turnKind ||
                typeof message.deadlineInMilliseconds !== 'number' || !Number.isFinite(message.deadlineInMilliseconds))
                throw new Error('Planning turn does not match the local replay');
            this.phase = 'PLANNING'; this.segments = []; this.touchMask = 0; this.accumulator = 0;
            this.lastCountdownBeep = -1;
            this.deadline = message.deadlineInMilliseconds;
            this.readLocks(message.lockedSeatIndices);
            this.chooseWeapon(); this.scene?.setPlanning(true); this.refreshPlanning(); this.alert();
        } else if (message.type === 'PLAN_PREVIEW' && this.phase === 'PLANNING' && !this.loading && this.match &&
            message.turnIndex === this.match.turnIndex) {
            const tank = this.match.runtime.tanks.find(candidate => candidate.seatIndex === message.seatIndex);
            if (!tank || tank.isWreck || tank.seatIndex === this.seatIndex ||
                tank.teamIndex !== this.ownTank?.teamIndex ||
                !isPlanningPreview(message, this.match.settings.mapEdgeLengthInVoxels) ||
                message.weaponIdentifier !== null && !this.data.weapons.some(weapon =>
                    weapon.identifier === message.weaponIdentifier)) return;
            this.scene?.setPlanningPreview(tank.seatIndex, message.pose, message.powerCentipercent,
                message.weaponIdentifier);
        } else if (message.type === 'PLAN_LOCK_STATE' && this.match && message.turnIndex === this.match.turnIndex) {
            this.readLocks(message.lockedSeatIndices); this.refreshPlanning();
        } else if (message.type === 'TURN_RESOLVE' && !this.loading && this.match && this.description) {
            validateTurnEntry(message, this.description, this.match.turnIndex);
            this.recordPreviousPlan(message.kind, message.plans);
            this.announceTurn(message.kind, message.plans);
            this.phase = 'RESOLVING'; this.touchMask = 0; this.keys.clear(); this.accumulator = 0;
            this.scene?.captureTick(); this.match.beginResolve(message.turnIndex, message.kind, message.plans);
            this.scene?.setPlanning(false); this.scene?.followOwnShots();
            this.refreshPlanning(); this.finishHiddenResolve();
        } else if (message.type === 'MATCH_END') {
            this.phase = 'LOBBY'; this.loading?.abort(); this.loading = null;
            if (!Array.isArray(message.winningTeamIndices) || !message.winningTeamIndices.every(index =>
                Number.isSafeInteger(index) && index >= 0 && index < 4) || !Array.isArray(message.statistics) ||
                !message.statistics.every(entry => this.validStatistics(entry))) throw new Error('Invalid match result');
            this.ui.results(message.winningTeamIndices as Array<number>, String(message.reason),
                message.statistics as Array<PlayerStatistics>);
            this.scene?.dispose(); this.scene = null; this.match = null; this.description = null;
            this.audio?.dispose(); this.audio = null; this.ui.setMode('lobby'); this.refreshLobby();
        } else if (message.type === 'ERROR') {
            const error = String(message.message ?? message.code ?? 'Server error');
            if (message.code === 'ALREADY_TAKEN_USERNAME') {
                this.rejectUsername();
                return;
            }
            if (message.code === 'LOAD_TIMEOUT' || message.code === 'REPORT_TIMEOUT') this.fail(new Error(error));
            else this.ui.notice(error);
        } else if (message.type === 'DESYNC_DETECTED') {
            if (message.reason === 'NO_MAJORITY') {
                this.ui.notice('The crews could not agree on the result. Returning to the lobby.');
                return;
            }
            let token: string | null = null;
            try {
                token = localStorage.getItem(`artillery.token.${this.room}`);
            } catch {/* Recovery requires the reserved seat token. */}
            if (!token || !this.match || !Number.isSafeInteger(message.turnIndex) ||
                message.turnIndex !== this.match.turnIndex - 1 || this.lastRecoveryTurn === message.turnIndex ||
                !Number.isSafeInteger(message.stateHash) || (message.stateHash as number) < 0 ||
                (message.stateHash as number) > 0xffffffff) {
                this.fail(new Error('The match cannot recover safely. Reload to reconnect with current game data.'));
                return;
            }
            this.lastRecoveryTurn = message.turnIndex as number;
            this.phase = 'LOADING'; this.loading?.abort(); this.audio?.stop(); this.keys.clear(); this.touchMask = 0;
            this.scene?.setPlanning(false); this.refreshPlanning();
            this.ui.notice('Restoring the match from its recorded turns.');
            this.connection.send({ type: 'JOIN', gameID: this.room });
        } else if (message.type === 'VERSION_MISMATCH')
            this.fail(new Error('The match cannot continue safely. Reload to reconnect with current game data.'));
    }

    private rejectUsername(): void {
        if (!this.usernameSubmitted) {
            this.username = `User${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
            this.ui.setUsername(this.username);
            this.connection.send({ type: 'USERNAME', username: this.username });
        } else if (this.phase === 'LOBBY') {
            this.usernameRejected = true; this.ui.notice('Username already taken');
        }
    }

    private alert(): void {
        if (this.volume > 0 && !document.hidden) beep();
    }

    private announceTurn(kind: TurnKind, plans: ReadonlyArray<SeatPlan>): void {
        if (kind === 'MOVING') {
            this.ui.announce('TANKS MOVING'); return;
        }
        const hasStalled = plans.some(({ seatIndex, plan }) => {
            const tank = this.match?.runtime.tanks.find(candidate => candidate.seatIndex === seatIndex);
            const seat = this.description?.seats.find(candidate => candidate.seatIndex === seatIndex);
            return plan.weaponIdentifier === null && !seat?.isMissing && !!tank &&
                Array.from(tank.ammunition.values()).some(uses => uses > 0);
        });
        if (hasStalled) this.alert();
        else this.ui.announce('FIRE!');
    }

    private validStatistics(value: unknown): value is PlayerStatistics {
        if (!value || typeof value !== 'object') return false;
        const entry = value as PlayerStatistics;
        return Number.isSafeInteger(entry.seatIndex) && !!this.description?.seats.some(seat =>
            seat.seatIndex === entry.seatIndex) && [entry.damageDealt, entry.damageTaken, entry.friendlyFireDamage,
            entry.shotsFired].every(amount => typeof amount === 'number' && Number.isFinite(amount) && amount >= 0);
    }

    private readLocks(value: unknown): void {
        if (!Array.isArray(value) || !value.every(index => Number.isSafeInteger(index) &&
            this.description?.seats.some(seat => seat.seatIndex === index))) throw new Error('Invalid locked seats');
        this.lockedSeats = [...new Set<number>(value)];
    }

    /** Crews still deciding their plan this turn. */
    private planningSeats(): Array<number> {
        if (this.phase !== 'PLANNING' || !this.description) return [];
        return this.description.seats.filter(seat => !seat.isMissing && !this.lockedSeats.includes(seat.seatIndex) &&
            (!this.isPractice || seat.seatIndex === this.seatIndex) &&
            !this.match?.runtime.tanks.find(tank => tank.seatIndex === seat.seatIndex)?.isWreck)
            .map(seat => seat.seatIndex);
    }

    /** Solo practice is for the host while alone in the room, or whenever the server cannot be reached. */
    private canPractice(): boolean {
        if (this.isOffline) return true;
        if (!this.lobby || this.lobby.hostSeatIndex !== this.seatIndex) return false;
        return this.lobby.seats.every(seat => seat.seatIndex === this.seatIndex || seat.isMissing);
    }

    private refreshLobby(): void {
        if (!this.lobby) return;
        this.ui.lobby(this.lobby.seats, this.lobby.settings, this.seatIndex,
            this.lobby.hostSeatIndex, this.lobby.canStart);
        const roster = this.lobby.seats;
        if (this.description) this.description = { ...this.description, seats: this.description.seats.map(seat => {
            const current = roster.find(candidate => candidate.seatIndex === seat.seatIndex);
            return current ? { ...seat, username: current.username, isMissing: current.isMissing } : seat;
        }) };
        for (const seat of roster) this.scene?.setUsername(seat.seatIndex, seat.username);
        const own = this.lobby.seats.find(seat => seat.seatIndex === this.seatIndex);
        if (own) {
            if (this.usernameRejected && own.username === this.username) {
                this.usernameRejected = false; this.ui.notice('');
            }
            this.ui.setUsername(own.username);
            try {
                localStorage.setItem('artillery.username', own.username);
            } catch {/* Storage is optional. */}
        }
        if (this.phase === 'LOBBY') {
            this.ui.setMode('lobby');
            if (!this.background && this.room && !this.disposed) try {
                const background = new LobbyBackground(this.ui.canvas, this.room, this.themes[0]);
                this.background = background; background.setFogDensity(this.fogDensity);
                void background.ready.catch(error => {
                    background.dispose();
                    if (this.background === background) this.background = null;
                    console.warn('Lobby background could not load', error);
                });
            } catch (error) {
                console.warn('Lobby background could not start', error);
            }
        } else this.refreshPlanning();
    }

    private refreshPlanning(): void {
        if (!this.match) return;
        this.ui.setPreviousSolution(this.previousPlan);
        this.ui.planning(this.match.turnKind, this.canPlan, this.lockedSeats.includes(this.seatIndex), this.ownTank,
            this.data.weapons, this.selected, this.phase,
            weapon => describeWeapon(weapon, this.data));
        const budget = this.match.settings.movementTimePerTurnInSeconds * simulationTicksPerSecond;
        this.ui.budget(1 - (this.ownTank?.movementTicksUsed ?? 0) / budget);
        this.scene?.setMoveArrowEnabled(this.canMove);
    }

    private autoAim(tank: Tank): void {
        const weapon = this.data.weapons.find(candidate => candidate.identifier === this.selected);
        if (!this.match || !weapon) return;
        const distance = (other: Tank): number => Math.hypot(other.position.x - tank.position.x,
            other.position.y - tank.position.y, other.position.z - tank.position.z);
        const target = this.match.runtime.tanks.filter(other => other !== tank && !other.isWreck)
            .sort((first, second) => distance(first) - distance(second))[0];
        if (!target) {
            this.ui.notice('No living tanks to aim at.');
            return;
        }
        const result = solveAutoAim(this.match.battlefield.world, this.data, tank, target, weapon);
        if (result.kind === 'solved') {
            tank.turretYawQuantized = result.solution.yawQuantized;
            tank.turretPitchQuantized = result.solution.pitchQuantized;
            tank.powerCentipercent = result.solution.powerCentipercent;
            this.ui.notice('');
        } else this.ui.notice(result.kind === 'unsupported' ? 'Auto aim does not support this weapon.'
            : 'No shot found that reaches the nearest tank.');
    }

    private chooseWeapon(): void {
        if (!this.ownTank) return;
        if (!this.selected || (this.ownTank.ammunition.get(this.selected) ?? 0) <= 0)
            this.selected = this.data.weapons.find(weapon =>
                (this.ownTank!.ammunition.get(weapon.identifier) ?? 0) > 0)?.identifier ?? null;
        if (this.selected) this.match!.runtime.selectWeapon(this.seatIndex, this.selected);
    }

    private recordPreviousPlan(kind: TurnKind, plans: ReadonlyArray<SeatPlan>): void {
        if (kind === 'MOVING') return;
        const own = plans.find(entry => entry.seatIndex === this.seatIndex);
        if (own && own.plan.weaponIdentifier !== null) this.previousPlan = own.plan;
    }

    private plan(): PlayerPlan {
        const tank = this.ownTank!;
        return { movementSegments: this.segments.map(([duration, mask]) => [duration, mask]),
            turretYawQuantized: tank.turretYawQuantized, turretPitchQuantized: tank.turretPitchQuantized,
            powerCentipercent: tank.powerCentipercent, weaponIdentifier: this.selected };
    }

    private async load(description: MatchDescription, snapshot?: MatchSnapshot): Promise<void> {
        if (description.protocolVersion !== protocolVersion || description.weaponDataHash !== this.physicsHash)
            throw new Error('Match version or weapon data differs. Reload the page.');
        this.loading?.abort();
        if (!snapshot) this.lastRecoveryTurn = -1;
        this.previousPlan = null;
        const startedAt = Date.now();
        const loading = new AbortController(); this.loading = loading;
        const signal = loading.signal;
        if (this.usernameRejected) {
            this.usernameRejected = false; this.ui.notice('');
        }
        this.phase = 'LOADING'; this.ui.setMode('loading'); this.description = description;
        this.background?.dispose(); this.background = null;
        this.scene?.dispose(); this.scene = null; this.audio?.dispose(); this.audio = null; this.match = null;
        try {
            const theme = resolveTheme(description.matchSeed, this.themes, description.settings.islandTheme);
            const battlefield = await loadBattlefield(description.matchSeed, description.settings.mapEdgeLengthInVoxels,
                theme, description.seats, progress => this.ui.loading(0, progress.completed / progress.total,
                    `Generating island · attempt ${progress.attempt}`), signal);
            const match = new Match(description.matchSeed, description.settings, description.seats, this.data,
                this.physicsHash, this.themes, battlefield);
            if (this.isPractice) match.useCombinedTurns();
            if (this.isPractice)
                for (const tank of match.runtime.tanks) if (tank.seatIndex !== this.seatIndex) {
                    tank.ammunition.clear();
                    tank.hitPoints = tank.maximumHitPoints = practiceSettings.targetHitPoints;
                }
            for (const entry of snapshot?.planLog ?? []) {
                if (signal.aborted) return;
                match.resolve(entry); match.runtime.events.length = 0;
                this.recordPreviousPlan(entry.kind, entry.plans);
                this.ui.loading(0, 1, `Replaying turn ${entry.turnIndex + 1}`);
                await this.nextFrame();
            }
            if (signal.aborted) return;
            this.match = match; this.audio = new ArtilleryAudio(description.matchSeed, this.effects);
            this.audio.setVolume(this.volume);
            this.scene = new ArtilleryScene({ canvas: this.ui.canvas, tagContainer: this.ui.tags, match,
                seed: description.matchSeed, seats: description.seats, data: this.data, effects: this.effects,
                viewerSeatIndex: this.seatIndex, quality: this.quality,
                onEvent: event => {
                    if (!document.hidden) this.audio?.event(event);
                },
                onFire: (seatIndex, identifier) => {
                    if (seatIndex === this.seatIndex) this.alert();
                    const tank = match.runtime.tanks.find(candidate => candidate.seatIndex === seatIndex);
                    const weapon = this.data.weapons.find(candidate => candidate.identifier === identifier);
                    if (tank && weapon && !document.hidden) this.audio?.fire(weapon, tank.position);
                }, onTurretClick: seatIndex => {
                    const tank = match.runtime.tanks.find(candidate => candidate.seatIndex === seatIndex);
                    if (tank && !document.hidden) this.audio?.play('clink', tank.position);
                } });
            this.scene.camera.shakeEnabled = this.shake;
            this.scene.setFogDensity(this.fogDensity);
            this.scene.setAmbientOcclusion(this.ambientOcclusion);
            this.scene.setHitboxesVisible(this.showHitboxes);
            this.scene.resize(innerWidth, innerHeight);
            const total = Math.max(1, this.scene.pendingChunkCount);
            while (this.scene.pendingChunkCount > 0) {
                if (signal.aborted) return;
                this.ui.loading(1, 1 - this.scene.pendingChunkCount / total, 'Meshing the island');
                await this.nextFrame();
            }
            if (signal.aborted) return;
            this.ui.loading(2, 0, 'Preparing private loadouts'); this.chooseWeapon(); this.refreshPlanning();
            await this.nextFrame();
            if (signal.aborted) return;
            this.ui.loading(3, 0, 'Warming up the battlefield'); warmUpTerrainEdits(); await this.nextFrame();
            while (!battlefield.world.refreshChecksums(8)) {
                if (signal.aborted) return;
                await this.nextFrame();
            }
            if (signal.aborted) return;
            this.ui.loading(3, 0, 'Compiling shaders'); this.scene.compile(); await this.nextFrame();
            if (signal.aborted) return;
            this.ui.loading(3, 1, 'Ready'); this.loading = null;
            this.phase = snapshot?.phase ?? 'LOADING'; this.accumulator = 0; this.ui.setMode('match');
            if (snapshot?.phase === 'PLANNING') {
                this.phase = 'PLANNING';
                this.lastCountdownBeep = -1;
                this.deadline = startedAt + this.clockOffset + snapshot.planMillisecondsRemaining;
                this.segments = []; this.lockedSeats = []; this.scene.setPlanning(true); this.refreshPlanning();
            }
            if (this.isPractice) {
                this.beginPracticeTurn();
                return;
            }
            this.connection.send({ type: 'LOAD_COMPLETE', protocolVersion, weaponDataHash: this.physicsHash });
            if (snapshot && this.lastRecoveryTurn >= 0) this.ui.notice('');
            if (snapshot?.phase === 'RESOLVING' && match.lastReport) this.sendReport();
        } catch (error) {
            if (!signal.aborted) throw error;
        } finally {
            if (this.loading === loading) this.loading = null;
        }
    }

    private nextFrame(): Promise<void> {
        return new Promise(resolve => requestAnimationFrame(() => resolve()));
    }

    private key(event: KeyboardEvent, down: boolean): void {
        if (!down) this.keys.delete(event.code);
        const target = event.target as HTMLElement | null;
        if (target?.isContentEditable || target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) ||
            target?.tagName === 'BUTTON' && ['Enter', 'Space'].includes(event.code) ||
            document.querySelector('dialog[open]')) return;
        const controls: ReadonlyArray<string> = Object.values(keyboardBindings);
        if (!controls.includes(event.code)) return;
        event.preventDefault();
        if (down) this.keys.add(event.code); else this.keys.delete(event.code);
        if (!down || event.repeat) return;
        this.audio?.unlock();
        if (event.code === keyboardBindings.lock) this.action({ type: 'lock' });
        else if (event.code === keyboardBindings.projection) this.action({ type: 'projection' });
        else if (event.code === keyboardBindings.xray) this.action({ type: 'xray' });
    }

    private tick(): void {
        const match = this.match;
        if (!match || this.loading) return;
        if (this.phase === 'RESOLVING') {
            this.scene?.captureTick(); const report = match.stepResolve();
            if (this.isPractice && match.runtime.events.some(event =>
                event.type === 'explosion' || event.type === 'projectileRemoved')) this.practiceImpactReached = true;
            this.scene?.consumeTick();
            if (report) {
                this.sendReport(); this.refreshPlanning();
            }
        } else if (this.canMove) {
            let mask = this.touchMask;
            for (const [binding, bit] of [[keyboardBindings.forward, MovementInput.FORWARD],
                [keyboardBindings.backward, MovementInput.BACKWARD], [keyboardBindings.left, MovementInput.LEFT],
                [keyboardBindings.right, MovementInput.RIGHT]] as const) if (this.keys.has(binding)) mask |= bit;
            if (this.ownTank!.movementTicksUsed >=
                match.settings.movementTimePerTurnInSeconds * simulationTicksPerSecond)
                mask &= MovementInput.LEFT | MovementInput.RIGHT;
            this.scene?.captureTick();
            if (mask && this.segments.reduce((total, [duration]) => total + duration, 0) <
                match.settings.movePlanningTimeLimitInSeconds * simulationTicksPerSecond &&
                match.previewMovement(this.seatIndex, mask)) {
                const previous = this.segments[this.segments.length - 1];
                if (previous && previous[1] === mask) previous[0]++;
                else this.segments.push([1, mask]);
                this.ui.budget(1 - this.ownTank!.movementTicksUsed /
                    (match.settings.movementTimePerTurnInSeconds * simulationTicksPerSecond));
            }
            this.scene?.consumeTick();
        }
    }

    private sendReport(): void {
        if (this.isPractice) {
            if (this.ownTank?.isWreck ||
                !this.match?.runtime.tanks.some(tank => tank.teamIndex === 1 && !tank.isWreck)) {
                this.phase = 'ENDED'; this.scene?.setPlanning(false); this.refreshPlanning();
                this.ui.notice('Practice complete. Reset targets to continue or return to the lobby.');
            } else this.beginPracticeTurn();
            return;
        }
        const report = this.match?.lastReport;
        if (!report) return;
        this.connection.send({ type: 'RESOLVE_REPORT', turnIndex: report.turnIndex, report });
        this.phase = 'LOADING'; this.scene?.setPlanning(false);
    }

    private finishHiddenResolve(): void {
        if (!document.hidden || this.phase !== 'RESOLVING' || !this.match) return;
        while (this.match.isResolving) this.match.stepResolve();
        this.match.runtime.events.length = 0; this.scene?.captureTick(); this.sendReport();
    }

    private readonly animate = (time: number): void => {
        if (this.disposed) return;
        try {
            const delta = this.previousTime ? Math.max(0, (time - this.previousTime) / 1000) : 0;
            this.previousTime = time;
            const speed = this.phase === 'RESOLVING' && this.match?.isMovementPhase ? resolveMovementSpeedMultiplier : 1;
            this.accumulator = this.phase === 'PLANNING' || this.phase === 'RESOLVING'
                ? this.accumulator + delta * speed : 0;
            const practiceSettling = this.isPractice && this.practiceImpactReached && this.phase === 'RESOLVING' &&
                this.match!.runtime.projectiles.length === 0 && !this.match!.runtime.hasActiveDeployables &&
                !this.match!.runtime.liquids.isActive;
            const ticks = this.phase === 'RESOLVING' &&
                (this.keys.has(keyboardBindings.fastForward) || practiceSettling)
                ? resolveFastForwardTicksPerFrame : Math.min(Math.floor(this.accumulator * simulationTicksPerSecond),
                    simulationTicksPerSecond * speed);
            let performed = 0;
            for (; performed < ticks;) {
                this.tick(); performed++;
                if (practiceSettling && (this.phase !== 'RESOLVING' || this.match!.runtime.projectiles.length ||
                    this.match!.runtime.hasActiveDeployables)) break;
                if (speed > 1 && !this.match?.isMovementPhase) break;
            }
            this.accumulator = Math.max(0, this.accumulator - performed / simulationTicksPerSecond);
            this.background?.render(delta, document.hidden);
            if (this.scene && !document.hidden) {
                if (this.description) this.ui.matchRoster(this.description.seats, this.match!.runtime.tanks,
                    this.lockedSeats, this.planningSeats(), this.description.settings);
                this.scene.render(Math.min(1, this.accumulator * simulationTicksPerSecond), delta);
                const camera = this.scene.camera.camera;
                this.audio?.setListener(camera.position, { x: camera.matrixWorld.elements[0],
                    y: camera.matrixWorld.elements[1], z: camera.matrixWorld.elements[2] });
                this.audio?.update(this.match!.runtime, delta);
            }
            if (this.phase === 'PLANNING' && this.match) {
                const millisecondsRemaining = this.deadline - Date.now() - this.clockOffset;
                this.ui.timer(millisecondsRemaining / (this.planLimitInSeconds * 1000));
                const secondsRemaining = Math.ceil(millisecondsRemaining / 1000);
                if (this.canEdit && secondsRemaining > 0 && secondsRemaining <= 10 &&
                    secondsRemaining !== this.lastCountdownBeep) {
                    this.lastCountdownBeep = secondsRemaining;
                    this.alert();
                }
                const tank = this.ownTank;
                if (!this.isPractice && this.canEdit && tank &&
                    time - this.lastPreviewTime >= 1000 / planningPreviewUpdatesPerSecond) {
                    this.lastPreviewTime = time;
                    this.connection.send({ type: 'PLAN_PREVIEW', turnIndex: this.match.turnIndex,
                        pose: [tank.position.x, tank.position.y, tank.position.z, quantizeYaw(tank.hullYawInRadians),
                            tank.turretYawQuantized, tank.turretPitchQuantized],
                        powerCentipercent: tank.powerCentipercent, weaponIdentifier: this.selected });
                }
            } else this.ui.timer(0);
        } catch (error) {
            this.fail(error);
        }
        this.frame = requestAnimationFrame(this.animate);
    };

    private fail(error: unknown): void {
        this.phase = 'ENDED'; this.loading?.abort(); this.audio?.stop(); this.keys.clear(); this.touchMask = 0;
        this.background?.dispose(); this.background = null;
        this.refreshPlanning(); this.ui.notice(error instanceof Error ? error.message : 'The game could not continue');
        console.error('Artillery client error', error);
    }
}
