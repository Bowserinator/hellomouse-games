import { decodeMap, type World } from './mapx.js';
import { Preview } from './editor/preview.js';
import { blankWorld } from './editor/world.js';
import { CommandBar } from './game/ui/command-bar.js';
import { ResourceBars } from './game/ui/resource-bars.js';
import { SimulationControls } from './game/ui/simulation-controls.js';
import { TimelineHud } from './game/ui/timeline-hud.js';
import { BALANCE } from './sim/balance.js';
import { ECONOMY as C, ECONOMY_WORDS } from './sim/layout.js';
import { TICK_HZ } from './sim/fixed.js';
import { checkWebGPU } from './webgpu.js';
import { Lobby } from './lobby.js';
import { connectToGame, type GameConnection } from '../../shared/ts/game-connection.js';
import { copyInviteLink } from '../../shared/ts/copy-invite-link.js';
import { Lockstep, type TickBundle } from './sim/lockstep.js';
import { CommandType } from './sim/commands.js';
import type { Battlefield, LobbyState, MatchStart } from './shared/protocol.js';

const element = (id: string) => document.getElementById(id) as HTMLElement;
if (!document.getElementById('loading')) {
    const loading = document.createElement('section');
    loading.id = 'loading';
    loading.hidden = true;
    loading.setAttribute('role', 'status');
    loading.setAttribute('aria-live', 'polite');
    const spinner = document.createElement('span');
    spinner.className = 'loading-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const text = document.createElement('p');
    text.id = 'loading-text';
    loading.append(spinner, text);
    element('game-app').appendChild(loading);
}
const notify = (message: string) => {
    if (!element('loading').hidden) element('loading-text').textContent = message;
    else if (message) console.info(message);
};
let preview: Preview | undefined;
let connection: GameConnection | undefined;
let lobby: Lobby | undefined;
let generation = 0;

async function battlefield(file: string): Promise<World> {
    const response = await fetch(`maps/${file}`);
    if (!response.ok) throw Error('Could not load the battlefield');
    return decodeMap(new Uint8Array(await response.arrayBuffer()));
}
function showGame(world: World) {
    element('lobby').hidden = true; element('game').hidden = false;
    preview ??= new Preview(element('game'));
    preview.sync(world);
    const objective = world.objects.find(object => object.kind === 'objective');
    preview.focus(world, objective ?? { x: world.width / 2, z: world.depth / 2 }, 100);
    return preview;
}
function showLobby(message: string) {
    element('result').hidden = true;
    element('loading').hidden = true;
    element('game').classList.remove('game--loading');
    generation++;
    preview?.stopSimulation();
    element('lobby').hidden = false; element('game').hidden = true;
    notify(message);
}
function finish(outcome: 'victory' | 'defeat') {
    element('result').hidden = false;
    element('result-title').textContent = outcome === 'victory' ? 'VICTORY' : 'DEFEAT';
}
async function startMatch(start: MatchStart) {
    const current = ++generation;
    element('lobby').hidden = true;
    element('loading').hidden = false;
    element('game').classList.add('game--loading');
    notify('Loading battlefield…');
    try {
        if (!await checkWebGPU()) throw Error('WebGPU is unavailable');
        const map = lobby?.maps.find(candidate => candidate.id === start.map && candidate.playable);
        if (!map || !lobby) throw Error('Unknown battlefield');
        const world = await battlefield(map.file);
        if (current !== generation) return;
        const scene = showGame(world);
        await scene.startSimulation(world, notify, true, false, false,
            { local: false, player: lobby.slot % 8, slot: lobby.slot, roster: start.players,
                players: start.slots, seed: start.seed });
        if (current !== generation) return;
        const driver = scene.driver;
        if (!driver) throw Error('Simulation did not load');
        const handshake = Lockstep.handshake(driver.core.nav.hash);
        Lockstep.compare(start.handshake, handshake);
        driver.onCommand = command => connection?.send({ type: 'COMMAND', command });
        driver.onHash = (tick, hash) => connection?.send({ type: 'HASH', tick, hash });
        driver.onTick = tick => connection?.send({ type: 'INPUT', tick });
        driver.onPauseRequest = paused => connection?.send({ type: paused ? 'PAUSE' : 'RESUME' });
        driver.onGameEnd = result => {
            finish(result.outcome); connection?.send({ type: 'GAME_END', ...result });
        };
        driver.onSelection = ids => connection?.send({ type: 'SELECTION', ids });
        driver.onStall = stalled => {
            if (stalled) notify('Waiting for players');
        };
        connection?.send({ type: 'LOADED', handshake, layoutHash: driver.core.handshake.defs });
    } catch (error) {
        if (current !== generation) return;
        connection?.send({ type: 'LOAD_FAILED' });
        showLobby(error instanceof Error ? error.message : String(error));
    }
}
function receive(message: Record<string, unknown>) {
    const driver = preview?.driver;
    switch (message.type) {
        case 'UUID': case 'YOUARE': {
            if (message.type === 'YOUARE' && lobby && typeof message.index === 'number') lobby.slot = message.index;
            const invite = element('invite') as HTMLInputElement;
            invite.value = location.href;
            element('invite-box').hidden = false;
            break;
        }
        case 'LOBBY': lobby?.show(message as LobbyState); break;
        case 'START': void startMatch(message as MatchStart); break;
        case 'BEGIN':
            element('loading').hidden = true;
            element('game').classList.remove('game--loading');
            driver?.submit({ type: CommandType.Ready, payload: [] });
            connection?.send({ type: 'INPUT', tick: 0 });
            break;
        case 'BUNDLE':
            try {
                driver?.receive(message.bundle as TickBundle);
            } catch (error) {
                driver?.pause(); notify(error instanceof Error ? error.message : String(error));
            }
            break;
        case 'SELECTION':
            if (driver && typeof message.slot === 'number' && Array.isArray(message.ids))
                driver.selections.set(message.slot, message.ids);
            break;
        case 'RESUMED':
            if (typeof message.tick === 'number') driver?.resumeAt(message.tick);
            if (driver) connection?.send({ type: 'INPUT', tick: driver.core.tick });
            break;
        case 'PAUSE_STATE':
            if (typeof message.cooldownRemainingMs === 'number') driver?.setPauseCooldown(message.cooldownRemainingMs);
            notify(`${String(message.by)} ${message.paused ? 'paused' : 'resumed'}`);
            break;
        case 'PAUSE_DENIED':
            if (typeof message.remainingMs === 'number') driver?.setPauseCooldown(message.remainingMs);
            notify('Pausing is limited to once every 30 s');
            break;
        case 'ABORT': showLobby(String(message.message)); break;
        case 'DESYNC':
            if (driver && typeof message.tick === 'number' && typeof message.expected === 'number' &&
                typeof message.actual === 'number') {
                driver.core.lockstep.frozen = { tick: message.tick, expected: message.expected,
                    actual: message.actual };
                driver.pause();
            }
            notify(`Simulation desync at tick ${String(message.tick)}. Reload to join a new game.`);
            break;
        case 'ERROR': notify(String(message.message ?? 'Connection error')); break;
    }
}
async function joinLobby() {
    if (connection || !await checkWebGPU()) return;
    try {
        const response = await fetch('maps/index.json');
        if (!response.ok) throw Error('Could not load the battlefield list');
        const maps = await response.json() as Array<Battlefield>;
        lobby = new Lobby(element('lobby-content'), maps, message => connection?.send(message));
        connection = connectToGame({ gameType: 'datacenter_defense', onMessage: receive,
            pingIntervalInMilliseconds: 5000, disconnectBanner: element('disconnect-banner'),
            onClose: () => {
                showLobby('Disconnected. Reload to join a new game.');
            } });
    } catch (error) {
        notify(error instanceof Error ? error.message : String(error));
    }
}
const invite = element('invite') as HTMLInputElement;
invite.onclick = () => invite.select();
element('copy-invite').onclick = () => {
    void copyInviteLink(element('invite-box'), invite.value);
};
if (new URLSearchParams(location.search).has('mock')) {
    showGame(blankWorld());
    const host = element('game');
    new SimulationControls(undefined, host);
    const clock = new TimelineHud(undefined, host);
    clock.update();
    const states = document.createElement('div');
    states.className = 'mock-states';
    for (const state of ['Default', 'Playing', 'Victory', 'Defeat']) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = state;
        button.onclick = () => {
            const outcome = state === 'Victory' ? 'victory' : state === 'Defeat' ? 'defeat' : undefined;
            if (outcome) finish(outcome);
            else element('result').hidden = true;
            clock.update(state === 'Playing' ? 60 * TICK_HZ : 0, !!outcome);
        };
        states.append(button);
    }
    host.append(states);
    const economy = new Int32Array(ECONOMY_WORDS);
    economy.set([50000, 500000, 50000, 500000]);
    economy.fill(BALANCE.objective.money * 100 / TICK_HZ, C.moneyHistory, C.moneyHistory + TICK_HZ);
    economy.fill(BALANCE.objective.power * 100 / TICK_HZ, C.powerHistory, C.powerHistory + TICK_HZ);
    new ResourceBars(host).update(economy);
    new CommandBar(host).selection([], false, { name: 'Defense objective', hp: BALANCE.objective.hp,
        tier: 1, target: 1, progress: 0, held: false });
} else void joinLobby();
