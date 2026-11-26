import { BALANCE } from './balance.js';
import type { World } from '../mapx.js';
import { bakeNav, type NavBake } from './nav-bake.js';
import { ANGLE_LUT, INF, MAX_ZOMBIES, PER_SPAWN, Q, STATE_FIELDS, TICK_HZ } from './fixed.js';
import { VARIANTS } from './variants.js';
import { CRANE_T1 } from './content/index.js';
import { entities as entityDefs } from './entity/registry.js';
import { compileDefs, DEF_HEADER } from './defs.js';
import { COMMAND_DELAY_TICKS, COMMAND_RING, COMMAND_SLOT_WORDS, SALE_EFFECT_SLOTS,
    encodeCommands, orderedCommands, type Command } from './commands.js';
import { Lockstep, type Handshake, type TickBundle } from './lockstep.js';
import { ENTITY as E, ENTITY_WORDS, MAX_ENTITIES, MAX_WEAPONS, ORDER_WORDS, PARAM, PLAYER_WORDS,
    PROJECTILE_WORDS, RENDER_BEAM_WORDS, RENDER_ENTITY_WORDS, RENDER_PROJECTILE_WORDS,
    RENDER_EXPLOSION_WORDS, GHOST_WORDS, SCRATCH, WEAPON_WORDS } from './layout.js';
import { parallelKernels } from './kernels/parallel.js';
import { entityKernels } from './kernels/entities.js';
import { unitKernels } from './kernels/units.js';
import { common } from './kernels/common.js';
import { flowKernels } from './kernels/flow.js';
import { tickKernels } from './kernels/tick.js';
import { commandKernels } from './kernels/commands.js';
import { combatKernels } from './kernels/combat.js';
import { projectileKernels } from './kernels/projectiles.js';
import { BUILDINGS_WGSL } from './kernels/buildings.js';
import { hostileKernels } from './kernels/hostile.js';
import { CWIS_WGSL } from './kernels/cwis.js';
import { ECONOMY, ECONOMY_WORDS, playerEconomyOffset } from './layout.js';
import { ECONOMY_WGSL } from './kernels/economy.js';
import { SimProfiler } from './profile.js';
import { LOBBY_LIMIT } from '../shared/protocol.js';

export interface DefenseSnapshot {
    entities: Int32Array;
    economy: Int32Array;
    ghosts: Int32Array;
    projectiles: Int32Array;
    beams: Int32Array;
    density: Int32Array;
    explosions?: Int32Array;
    columns: number;
    rows: number;
    cell: number;
}
export interface RenderSnapshot {
    // Arrays can be reused after two newer snapshots have been delivered.
    tick: number; words: Int32Array; defense?: DefenseSnapshot;
}
export interface StateSnapshot {
    handshake: Handshake; seed: number; tick: number; current: number; sequences: Array<[number, number]>;
    buffers: Record<string, Uint32Array>;
}
export interface SimOptions {
    starterSlots?: ReadonlyArray<number>;
    buildTime?: number | null;
    seed?: number; workgroupSize?: number; hashInterval?: number; players?: ReadonlyArray<number>; signal?: AbortSignal;
    defense?: boolean; testMode?: boolean; continuousSpawn?: boolean; profile?: boolean; unlimitedEconomy?: boolean;
    onProgress?: (message: string) => void; onSnapshot?: (snapshot: RenderSnapshot) => void;
    onHash?: (tick: number, hash: number, hp: number, blocked: number) => void; onError?: (error: Error) => void;
}
const SNAPSHOT_SLOTS = 3;
const SNAPSHOT_RING = 3;
const SEPARATION_ITERATIONS = 4;
const ENTRIES = ['flow_relax', 'flow_dirs', 'clear_tick', 'apply_commands', 'spawn_flags', 'spawn_release', 'grid_build',
    'radix_count', 'radix_scatter', 'grid_gather', 'scan_block', 'scan_add', 'zombie_think', 'zombie_move', 'zombie_separate', 'zombie_separate_commit', 'zombie_recover', 'emit_flags', 'emit_scatter', 'consume_emits',
    'weapons_update', 'projectile_update', 'projectile_hit', 'apply_damage', 'objective_update', 'state_hash', 'snapshot',
    'economy_tick', 'collect_construction', 'clear_construction', 'spend_construction',
    'clear_entities', 'apply_entity_damage',
    'flow_rebuild_begin', 'flow_capture', 'flow_reset', 'flow_commit',
    'flow_rebuild_finish', 'coarse_count', 'coarse_scatter', 'weapon_target', 'artillery_scan', 'weapon_aim',
    'weapon_fire', 'shot_update', 'shot_hit', 'shot_detonate', 'splash_scan', 'gas_reset', 'fund_beams', 'beam_update',
    'order_prepare', 'unit_move', 'unit_commit', 'shield_prepare', 'sonic_force', 'runover_damage',
    'hostile_emit', 'cwis_intercept', 'hostile_update', 'runtime_snapshot', 'end_match'];

export class SimCore {
    private static retirement: Promise<void> = Promise.resolve();
    private static starting: Promise<void> = Promise.resolve();
    private static devices = new WeakMap<GPU, {
        device: GPUDevice; cores: Set<SimCore>; lost: boolean; timestamps: boolean;
    }>();
    private static programs = new WeakMap<GPUDevice, Map<string, {
        layout: GPUBindGroupLayout; pipelines: Map<string, GPUComputePipeline>;
    }>>();
    private errorListener = (event: Event) => {
        this.fail(Error(`WebGPU error: ${(event as GPUUncapturedErrorEvent).error.message}`));
    };
    private sharedOwners?: Set<SimCore>;
    readonly nav: NavBake;
    readonly count: number;
    readonly lockstep: Lockstep;
    readonly notices: Array<string>;
    readonly commandLog: Array<TickBundle> = [];
    readonly objectiveMaxHealth = BALANCE.objective.hp;
    objectiveHealth: number = this.objectiveMaxHealth;
    destroyed = false;
    error?: Error;
    private current = 0;
    private pipelines = new Map<string, GPUComputePipeline>();
    private buffers: Record<string, GPUBuffer> = {};
    private sizes: Record<string, number> = {};
    private parameters = new Uint32Array(64);
    private uniform: GPUBuffer;
    private groups: Array<GPUBindGroup> = [];
    private slots: Array<{ buffer: GPUBuffer; busy: boolean }> = [];
    private hashSlots: Array<{ buffer: GPUBuffer; busy: boolean }> = [];
    private snapshotWords: Array<Int32Array> = [];
    private snapshotCursor = 0;
    private hashWords = 0;
    private reads = new Set<Promise<void>>();
    private workgroupSize: number;
    private hashInterval: number;
    private sequence = 0;
    private queued = new Map<number, Array<Command>>();
    private gridCount: number;
    private regionBytes: Record<string, number> = {};
    private defenseWords: number;
    private sortSize = 1;
    private emitBase: number;
    private commandsBase: number;
    private dispatchWords = new Uint32Array(512 * 64);
    private dispatchCount = 0;
    private pass?: GPUComputePassEncoder;
    private profiler?: SimProfiler;
    private transferring = false;
    private definitionHash: number;
    private regions: Partial<Record<keyof typeof DEF_HEADER, number>> = { flowPasses: 8, flowTicks: 1 };
    private constructor(readonly device: GPUDevice, world: World, private options: SimOptions) {
        this.nav = bakeNav(world, options.buildTime); this.regions.buildings = this.nav.buildingOffset;
        this.notices = this.nav.notices.slice();
        this.regions.spawnPerSource = PER_SPAWN * (options.testMode ? 10 : 1);
        this.regions.spawnHpScale = options.testMode ? 3 : 1;
        this.regions.waveMode = Number(this.nav.waveCount !== undefined);
        this.regions.waves = this.nav.waveOffset;
        this.regions.winTick = this.nav.winTick ?? 0;
        this.regions.unlimitedEconomy = Number(this.unlimitedEconomy);
        this.regions.continuousSpawn = Number(this.nav.waveCount === undefined && !!options.continuousSpawn);
        this.count = this.nav.waveCount ?? (options.continuousSpawn ? MAX_ZOMBIES
            : Math.min(MAX_ZOMBIES, this.nav.spawns.length * this.regions.spawnPerSource));
        this.lockstep = new Lockstep(options.players ?? [0]);
        this.workgroupSize = options.workgroupSize ?? 128;
        this.hashInterval = options.hashInterval ?? 20;
        if (![64, 128, 256].includes(this.workgroupSize) ||
            !Number.isInteger(this.hashInterval) || this.hashInterval < 1)
            throw Error('Invalid simulation configuration');
        while (this.sortSize < this.count) this.sortSize *= 2;
        const n = this.nav;
        const gridMetres = Math.max(2, Math.ceil(Math.max(n.widthCm, n.depthCm) / 36000),
            Math.ceil(Math.max(...VARIANTS.map(v => v.radius)) * 32 / (5 * Q)));
        const gridColumns = Math.ceil(n.widthCm / (gridMetres * 100));
        const gridRows = Math.ceil(n.depthCm / (gridMetres * 100));
        this.gridCount = gridColumns * gridRows;
        const set = (name: keyof typeof PARAM, value: number) => {
            this.parameters[PARAM[name]] = value;
        };
        set('count', this.count); set('columns', n.columns); set('rows', n.rows);
        set('cellQ', n.cellCm / 100 * Q); set('seed', options.seed ?? 0xdecafbad);
        set('terrain', n.terrainOffset); set('spawns', n.spawnOffset); set('spawnCount', n.spawns.length);
        set('terrainColumns', n.terrainColumns); set('terrainRows', n.terrainRows);
        set('widthQ', Math.trunc(n.widthCm * Q / 100)); set('depthQ', Math.trunc(n.depthCm * Q / 100));
        set('objectiveX', n.objective.x); set('objectiveZ', n.objective.z); set('objectiveRadius', n.objective.radius);
        set('gridColumns', gridColumns); set('gridRows', gridRows); set('gridCellQ', gridMetres * Q);
        set('sortSize', this.sortSize);
        let scratch = 16;
        const reserveScratch = (name: keyof typeof PARAM, size: number) => {
            set(name, scratch); scratch += size;
        };
        reserveScratch('flowArgs', 15);
        reserveScratch('scanTotals', 1024);
        reserveScratch('separation', this.count * 2);
        reserveScratch('gridKeys', this.count);
        reserveScratch('slotRecords', this.count * 3);
        reserveScratch('radixKeysA', this.sortSize); reserveScratch('radixKeysB', this.sortSize);
        reserveScratch('radixHist', 64 * Math.ceil(this.sortSize / 1024));
        reserveScratch('artilleryQueue', 1 + MAX_ENTITIES * 4);
        reserveScratch('splashQueue', 1 + (compileDefs().words[DEF_HEADER.projectileRing] * MAX_ENTITIES * 4 + 2048));
        reserveScratch('sortA', this.sortSize); reserveScratch('sortB', this.sortSize);
        reserveScratch('counts', this.gridCount); reserveScratch('scanA', this.gridCount);
        reserveScratch('scanB', this.gridCount); reserveScratch('emitScanA', this.count);
        reserveScratch('emitScanB', this.count); reserveScratch('snapshot', this.count * 3);
        let extra = 16;
        const reserveExtra = (name: keyof typeof PARAM, size: number) => {
            set(name, extra); extra += size;
        };
        reserveExtra('commandHash', 1);
        this.commandsBase = extra; reserveExtra('commands', COMMAND_RING * COMMAND_SLOT_WORDS);
        reserveExtra('weapons', MAX_WEAPONS * WEAPON_WORDS);
        reserveExtra('players', 8 * PLAYER_WORDS);
        reserveExtra('projectiles', MAX_WEAPONS * PROJECTILE_WORDS);
        this.emitBase = extra; reserveExtra('emits', this.count * 8);
        reserveExtra('compact', this.count * 5); reserveExtra('compactCount', 1);
        reserveExtra('damage', this.count); reserveExtra('credits', this.count);
        const reserveDefinition = (name: keyof typeof DEF_HEADER, size: number) => {
            this.regions[name] = extra; extra += size;
            this.regionBytes[name] = size * 4;
        };
        this.regions.flowScale = Math.max(1, Math.round(200 / n.cellCm));
        this.regions.flowColumns = Math.ceil(n.columns / this.regions.flowScale);
        this.regions.flowRows = Math.ceil(n.rows / this.regions.flowScale);
        const flowCells = this.regions.flowColumns * this.regions.flowRows;
        const flowStride = flowCells + Math.ceil(flowCells / 4);
        this.regions.flowStride = flowStride;
        this.regions.flowClasses = 1 + Math.max(...VARIANTS.map(variant => variant.locomotionClass));
        reserveDefinition('entities', MAX_ENTITIES * ENTITY_WORDS);
        reserveDefinition('ghosts', GHOST_WORDS);
        reserveDefinition('economy', ECONOMY_WORDS); reserveDefinition('construction', MAX_ENTITIES * 4);
        reserveDefinition('weaponState', MAX_ENTITIES * 4 * 8);
        reserveDefinition('orders', MAX_ENTITIES * ORDER_WORDS);
        reserveDefinition('occupancy', Math.ceil(n.costs.length / 2));
        reserveDefinition('entityDamage', MAX_ENTITIES); reserveDefinition('powerDrain', MAX_ENTITIES);
        reserveDefinition('flowControl', 8); reserveDefinition('flowCosts', Math.ceil(flowCells / 4));
        reserveDefinition('flowActive', flowStride * this.regions.flowClasses);
        reserveDefinition('flowTiles', Math.ceil(this.regions.flowColumns / 16) * Math.ceil(this.regions.flowRows / 16) *
            this.regions.flowClasses * 2);
        const ring = compileDefs().words[DEF_HEADER.projectileRing];
        this.regions.projectileCountMax = MAX_ENTITIES * 4 * ring + 2048;
        reserveDefinition('projectiles', this.regions.projectileCountMax * 12);
        reserveDefinition('projectileAux', this.regions.projectileCountMax * 8);
        const impactWords = (this.regions.projectileCountMax + SALE_EFFECT_SLOTS) * RENDER_EXPLOSION_WORDS;
        reserveDefinition('explosions', impactWords);
        reserveDefinition('beams', MAX_ENTITIES * 4 * 8);
        this.regions.coarseScale = Math.max(1, Math.ceil(16 / gridMetres));
        this.regions.coarseColumns = Math.ceil(gridColumns / this.regions.coarseScale);
        this.regions.coarseRows = Math.ceil(gridRows / this.regions.coarseScale);
        const coarseCells = this.regions.coarseColumns * this.regions.coarseRows;
        reserveDefinition('coarseCounts', coarseCells); reserveDefinition('coarseScan', coarseCells);
        reserveDefinition('density', coarseCells * 4);
        reserveDefinition('coarseIds', this.count); reserveDefinition('gasSlow', this.count);
        reserveDefinition('damageTime', this.count);
        reserveDefinition('unitMotion', MAX_ENTITIES * 4);
        reserveDefinition('unitRecovery', MAX_ENTITIES * 4);
        reserveDefinition('sonicForce', this.count * 2);
        reserveDefinition('explosionImpulse', this.count * 2);
        reserveDefinition('sonicAggro', this.count * 3);
        reserveDefinition('shields', MAX_ENTITIES + 1);
        reserveDefinition('pursuitDistance', this.count);
        reserveDefinition('stuck', this.count * 4);
        this.defenseWords = MAX_ENTITIES * RENDER_ENTITY_WORDS +
            this.regions.projectileCountMax * RENDER_PROJECTILE_WORDS +
            MAX_ENTITIES * 4 * RENDER_BEAM_WORDS + coarseCells * 4 +
            impactWords + GHOST_WORDS + ECONOMY_WORDS;
        this.regions.entitySnapshot = scratch; scratch += this.defenseWords - GHOST_WORDS - ECONOMY_WORDS;
        set('extraWords', extra);
        this.uniform = device.createBuffer({ label: 'Simulation dispatch parameters', size: 512 * 256,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        const storage = (name: string, words: number, data?: ArrayBufferView) => {
            const size = Math.max(4, words * 4);
            if (size > device.limits.maxStorageBufferBindingSize || size > device.limits.maxBufferSize)
                throw Error(`Simulation ${name} needs ${(size / 1048576).toFixed(1)} MiB; GPU buffer limit is ` +
                    `${(Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize) / 1048576).toFixed(1)} MiB`);
            const buffer = device.createBuffer({ label: `Simulation ${name}`, size,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST |
                    (name === 'scratch' || name === 'flowArgs' ? GPUBufferUsage.INDIRECT : 0) });
            this.buffers[name] = buffer; this.sizes[name] = size;
            if (data) device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
        };
        storage('state0', this.count * STATE_FIELDS); storage('state1', this.count * STATE_FIELDS);
        const definitions = compileDefs(this.parameters, this.regions);
        this.definitionHash = definitions.hash;
        this.hashWords = definitions.words[DEF_HEADER.hashWords];
        storage('nav', n.words.length, n.words); storage('defs', definitions.words.length, definitions.words);
        storage('scratch', scratch); storage('flowArgs', 15);
        const initialExtra = new Int32Array(extra);
        initialExtra[0] = this.objectiveMaxHealth;
        const economy = this.regions.economy ?? 0;
        const owners = [...(options.starterSlots ?? this.lockstep.players)].sort((a, b) => a - b);
        const share = Math.floor(LOBBY_LIMIT / owners.length), remainder = LOBBY_LIMIT % owners.length;
        const allocation = owners.map((slot, rank) => ({ slot, count: share + Number(rank < remainder) }));
        for (const { slot, count } of allocation) {
            if (!Number.isInteger(slot) || slot < 0 || slot >= LOBBY_LIMIT) throw Error('Invalid starter slot');
            initialExtra[economy + ECONOMY.players] |= 1 << slot;
            const offset = economy + playerEconomyOffset(slot);
            const money = BALANCE.objective.moneyStorage * count, power = BALANCE.objective.powerStorage * count;
            initialExtra.set([money, power, money, power], offset);
            initialExtra[offset + ECONOMY.starterShare] = count;
        }
        initialExtra.fill(100, this.regions.gasSlow, (this.regions.gasSlow ?? 0) + this.count);
        for (let i = 0; i < 8; i++) initialExtra.set([n.objective.x, n.objective.z, -1, 100, 0, -1],
            this.parameters[PARAM.players] + i * PLAYER_WORDS);
        if (options.defense) this.placeStartingCranes(initialExtra, allocation);
        storage('extra', extra, initialExtra);
        const flow = new Uint32Array(flowStride * this.regions.flowClasses);
        flow.fill(0xffffffff);
        storage('field0', flow.length, flow); storage('field1', flow.length, flow);
        for (let i = 0; i < SNAPSHOT_SLOTS; i++) this.slots.push({ busy: false,
            buffer: device.createBuffer({ label: 'Render snapshot ring', size: (this.count * 3 + (options.defense ? this.defenseWords : 0)) * 4,
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }) });
        device.addEventListener('uncapturederror', this.errorListener);
    }
    static create(gpu: GPU, world: World, options: SimOptions = {}): Promise<SimCore> {
        const result = SimCore.starting.then(() => SimCore.createResources(gpu, world, options));
        SimCore.starting = result.then(() => {}, () => {});
        return result;
    }
    private static async createResources(gpu: GPU, world: World, options: SimOptions): Promise<SimCore> {
        await SimCore.retirement;
        if (options.signal?.aborted) throw Error('Simulation stopped');
        options.onProgress?.('Preparing WebGPU simulation');
        let shared = SimCore.devices.get(gpu);
        if (!shared || shared.lost) {
            const adapter = await gpu.requestAdapter();
            if (!adapter) throw Error('No WebGPU adapter is available');
            if (options.signal?.aborted) throw Error('Simulation stopped');
            const timestamps = adapter.features?.has('timestamp-query') ?? false;
            const requiredFeatures: Array<GPUFeatureName> = options.profile && timestamps ? ['timestamp-query'] : [];
            const device = await adapter.requestDevice({ ...(options.profile ? { requiredFeatures } : {}),
                requiredLimits: {
                    maxStorageBuffersPerShaderStage: 8,
                    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
                    maxBufferSize: adapter.limits.maxBufferSize
                } });
            const record = { device, cores: new Set<SimCore>(), lost: false, timestamps };
            SimCore.devices.set(gpu, record); shared = record;
            void device.lost.then(info => {
                record.lost = true;
                for (const owner of record.cores)
                    owner.fail(Error(`WebGPU device lost (${info.reason}) at tick ${owner.tick}: ${info.message}`));
                record.cores.clear(); SimCore.programs.delete(device);
            });
        }
        const device = shared.device;
        if (options.profile && shared.timestamps && !device.features.has('timestamp-query'))
            throw Error('Create the profiled session with a fresh GPU instance to enable timestamp queries');
        let core: SimCore | undefined;
        const abort = () => core?.destroy();
        options.signal?.addEventListener('abort', abort, { once: true });
        try {
            if (options.signal?.aborted) throw Error('Simulation stopped');
            device.pushErrorScope('out-of-memory');
            device.pushErrorScope('validation');
            let allocationError: GPUError | null = null;
            try {
                core = new SimCore(device, world, options);
                core.sharedOwners = shared.cores; shared.cores.add(core);
            } finally {
                const validation = await device.popErrorScope();
                const memory = await device.popErrorScope();
                allocationError = memory ?? validation;
            }
            if (allocationError) throw Error(`GPU simulation allocation failed: ${allocationError.message}`);
            await core.initialize();
            if (options.signal?.aborted) throw Error('Simulation stopped');
            console.info('Simulation GPU memory', core.memoryUsage);
            return core;
        } catch (error) {
            const cause = core?.error ?? error;
            if (core) console.info('Simulation GPU memory', core.memoryUsage);
            core?.destroy();
            await SimCore.retirement;
            if (!core || !options.signal?.aborted) {
                shared.lost = true; SimCore.programs.delete(device); device.destroy();
            }
            throw cause;
        } finally {
            options.signal?.removeEventListener('abort', abort);
        }
    }
    get memoryUsage() {
        const buffers = { ...this.sizes, uniform: this.uniform.size,
            readback: this.slots.reduce((bytes, slot) => bytes + slot.buffer.size, 0),
            hashReadback: this.hashSlots.reduce((bytes, slot) => bytes + slot.buffer.size, 0),
            ...(this.profiler ? { profiling: this.profiler.memoryBytes } : {}) };
        const totalBytes = Object.values(buffers).reduce((bytes, size) => bytes + size, 0);
        return { regions: { ...this.regionBytes }, buffers, totalBytes,
            bytesPerCell: totalBytes / this.nav.costs.length,
            maxBufferSize: this.device.limits.maxBufferSize,
            maxStorageBufferBindingSize: this.device.limits.maxStorageBufferBindingSize };
    }
    get tick() {
        return this.lockstep.tick;
    }
    get unlimitedEconomy() {
        return this.options.defense === true && this.options.unlimitedEconomy === true;
    }
    get handshake() {
        return Lockstep.handshake(this.nav.hash, this.definitionHash);
    }
    private fail(error: Error) {
        if (this.destroyed || this.error) return;
        this.error = error;
        this.options.onError?.(error);
    }
    private check() {
        if (this.destroyed || this.options.signal?.aborted) throw Error('Simulation stopped');
        if (this.error) throw this.error;
    }
    private placeStartingCranes(extra: Int32Array, allocation: ReadonlyArray<{ slot: number; count: number }>) {
        const { objective, cellCm, costs, columns, rows } = this.nav;
        if (cellCm !== 100) {
            this.notices.push('Starter cranes require a one-metre construction grid');
            return;
        }
        const crane = entityDefs[CRANE_T1];
        const { width, depth } = crane.footprint;
        const occupied = this.regions.occupancy ?? 0;
        let slot = 0, id = 0;
        for (const { slot: owner, count } of allocation)
            for (let i = 0; i < count; i++) {
                const [cos, sin] = ANGLE_LUT[Math.floor(slot++ * ANGLE_LUT.length / LOBBY_LIMIT)];
                const dx = cos * 35 / 16384, dz = sin * 35 / 16384;
                const x0 = Math.round(objective.x / Q + dx - width / 2);
                const z0 = Math.round(objective.z / Q + dz - depth / 2);
                let best = Infinity, bx = -1, bz = -1;
                for (const radius of [12, Math.max(columns, rows)]) {
                    for (let z = Math.max(0, z0 - radius); z <= Math.min(rows - depth, z0 + radius); z++)
                        for (let x = Math.max(0, x0 - radius); x <= Math.min(columns - width, x0 + radius); x++) {
                            const distance = (x - x0) ** 2 + (z - z0) ** 2;
                            if (distance >= best) continue;
                            let clear = true;
                            for (let oz = 0; oz < depth; oz++) for (let ox = 0; ox < width; ox++) {
                                const cell = (z + oz) * columns + x + ox;
                                const occupancy = extra[occupied + (cell >>> 1)] >>> ((cell & 1) * 16);
                                clear &&= (costs[cell] & 127) !== 0 && (occupancy & 65535) === 0;
                            }
                            if (clear) {
                                best = distance; bx = x; bz = z;
                            }
                        }
                    if (bx >= 0) break;
                }
                if (bx < 0) continue;
                const at = (this.regions.entities ?? 0) + id * ENTITY_WORDS;
                extra[at + E.state] = 1;
                extra[at + E.def] = CRANE_T1;
                extra[at + E.owner] = owner % 8;
                extra[at + E.x] = (bx + width / 2) * Q;
                extra[at + E.z] = (bz + depth / 2) * Q;
                extra[at + E.hp] = crane.maxHp;
                extra[at + E.rotation] = owner << 2;
                extra[at + E.flags] = 1 << 8;
                extra[at + E.buildTask] = -1;
                for (let oz = 0; oz < depth; oz++) for (let ox = 0; ox < width; ox++) {
                    const cell = (bz + oz) * columns + bx + ox;
                    extra[occupied + (cell >>> 1)] |= (id + 1) << ((cell & 1) * 16);
                }
                id++;
            }
        extra[2] = id;
        if (id < LOBBY_LIMIT) this.notices.push('Not enough space for all starter cranes');
    }
    private async initialize() {
        this.check();
        const code = common(this.workgroupSize) + flowKernels(this.workgroupSize) +
            tickKernels(this.workgroupSize) + parallelKernels(this.workgroupSize) +
            entityKernels(this.workgroupSize) + ECONOMY_WGSL + commandKernels(this.workgroupSize) +
            combatKernels(this.workgroupSize) + projectileKernels(this.workgroupSize) +
            unitKernels(this.workgroupSize) + hostileKernels(this.workgroupSize) + CWIS_WGSL + BUILDINGS_WGSL;
        if (/\bf32\b|atomicCompareExchange|subgroup/.test(code)) throw Error('Non-deterministic simulation shader');
        let programs = SimCore.programs.get(this.device);
        if (!programs) {
            programs = new Map(); SimCore.programs.set(this.device, programs);
        }
        let program = programs.get(code);
        if (!program) {
            const module = this.device.createShaderModule({ label: 'Integer simulation', code });
            const info = await module.getCompilationInfo(); this.check();
            const errors = info.messages.filter(message => message.type === 'error');
            if (errors.length) throw Error(errors.map(e => `WGSL ${e.lineNum}:${e.linePos} ${e.message}`).join('\n'));
            const entries: Array<GPUBindGroupLayoutEntry> = [{ binding: 0, visibility: GPUShaderStage.COMPUTE,
                buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 256 } }];
            for (let binding = 1; binding <= 8; binding++) entries.push({ binding, visibility: GPUShaderStage.COMPUTE,
                buffer: { type: [1, 3, 7].includes(binding) ? 'read-only-storage' : 'storage' } });
            const layout = this.device.createBindGroupLayout({ entries });
            const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [layout] });
            const pipelines = new Map<string, GPUComputePipeline>();
            for (const entryPoint of ENTRIES) {
                this.check();
                const pipeline = await this.device.createComputePipelineAsync({ label: entryPoint,
                    layout: pipelineLayout, compute: { module, entryPoint } });
                this.check(); pipelines.set(entryPoint, pipeline);
            }
            program = { layout, pipelines }; programs.set(code, program);
        }
        const { layout } = program; this.pipelines = new Map(program.pipelines);
        for (let current = 0; current < 2; current++) {
            const names = [`state${current}`, `state${1 - current}`, 'nav', 'field0', 'field1',
                'scratch', 'defs', 'extra'];
            this.groups.push(this.device.createBindGroup({ layout, entries: [
                { binding: 0, resource: { buffer: this.uniform, size: 256 } },
                ...names.map((name, i) => ({ binding: i + 1, resource: { buffer: this.buffers[name] } }))
            ] }));
        }
        let passes = 0;
        for (let locomotion = 0; locomotion < (this.regions.flowClasses ?? 1); locomotion++)
            passes = Math.max(passes, await this.solveField(locomotion));
        this.regions.flowTicks = Math.ceil((Math.ceil(passes * 1.5) + 8) / 8);
        const definitions = compileDefs(this.parameters, this.regions);
        this.definitionHash = definitions.hash;
        this.device.queue.writeBuffer(this.buffers.defs, 0, definitions.words);
        const encoder = this.begin();
        this.dispatch(encoder, 'flow_commit', (this.regions.flowStride ?? 0) * (this.regions.flowClasses ?? 1));
        this.submit(encoder);
        if (this.options.profile) this.profiler = new SimProfiler(this.device);
    }
    profileReport() {
        return this.profiler?.report;
    }
    resetProfile() {
        this.profiler?.reset();
    }
    private begin() {
        this.check(); this.dispatchCount = 0;
        return this.device.createCommandEncoder();
    }
    private dispatch(encoder: GPUCommandEncoder, entry: string, count: number,
        values: Partial<Record<keyof typeof PARAM, number>> = {}, tiles = false, indirect?: number) {
        const offset = this.dispatchCount++ * 256;
        if (offset >= this.uniform.size) throw Error('Too many dispatches in one simulation tick');
        this.dispatchWords.set(this.parameters, offset / 4);
        for (const [name, value] of Object.entries(values))
            this.dispatchWords[offset / 4 + PARAM[name as keyof typeof PARAM]] = value;
        if (entry.startsWith('flow_')) {
            this.dispatchWords[offset / 4 + PARAM.columns] = this.regions.flowColumns ?? 1;
            this.dispatchWords[offset / 4 + PARAM.rows] = this.regions.flowRows ?? 1;
            this.dispatchWords[offset / 4 + PARAM.flowGrid] = 1;
        }
        const pipeline = this.pipelines.get(entry);
        if (!pipeline) throw Error(`Missing simulation kernel ${entry}`);
        if (this.profiler?.gpu) this.endPass();
        const pass = this.pass ??= this.profiler?.gpu ? this.profiler.beginPass(encoder, entry)
            : encoder.beginComputePass({ label: 'Integer simulation batch' });
        pass.setPipeline(pipeline); pass.setBindGroup(0, this.groups[this.current], [offset]);
        if (indirect !== undefined) pass.dispatchWorkgroupsIndirect(this.buffers.flowArgs, indirect * 12);
        else if (tiles) pass.dispatchWorkgroups(Math.ceil((this.regions.flowColumns ?? 1) / 16),
            Math.ceil((this.regions.flowRows ?? 1) / 16));
        else {
            const groups = Math.max(1, Math.ceil(count / this.workgroupSize));
            pass.dispatchWorkgroups(Math.min(65535, groups), Math.ceil(groups / 65535));
        }
        if (this.profiler?.gpu) this.endPass();
    }
    private endPass() {
        this.pass?.end(); this.pass = undefined;
    }
    private copy(encoder: GPUCommandEncoder, source: GPUBuffer, sourceOffset: number,
        destination: GPUBuffer, destinationOffset: number, size: number) {
        this.endPass();
        encoder.copyBufferToBuffer(source, sourceOffset, destination, destinationOffset, size);
    }
    private submit(encoder: GPUCommandEncoder) {
        this.endPass();
        const readProfile = this.profiler?.resolve(encoder);
        this.device.queue.writeBuffer(this.uniform, 0, this.dispatchWords.buffer, 0, this.dispatchCount * 256);
        this.device.queue.submit([encoder.finish()]);
        this.profiler?.submitted();
        if (readProfile) this.track(readProfile());
    }
    private async solveField(locomotion: number): Promise<number> {
        let field = 0, passes = 0;
        const flowCells = (this.regions.flowColumns ?? 1) * (this.regions.flowRows ?? 1);
        const reset = this.begin();
        this.dispatch(reset, 'flow_capture', Math.ceil(flowCells / 4), { locomotion });
        this.dispatch(reset, 'flow_reset', flowCells, { locomotion }); this.submit(reset);
        const flag = this.device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        try {
            while (true) {
                this.check();
                const encoder = this.begin(); encoder.clearBuffer(this.buffers.scratch, 0, 4);
                for (let i = 0; i < 8; i++) {
                    this.dispatch(encoder, 'flow_relax', 1, { field, locomotion }, true); field = 1 - field;
                }
                this.copy(encoder, this.buffers.scratch, 0, flag, 0, 4); this.submit(encoder);
                await flag.mapAsync(GPUMapMode.READ);
                const changed = new Uint32Array(flag.getMappedRange())[0]; flag.unmap();
                passes += 8;
                this.options.onProgress?.(`Integrating flowfield: ${passes} tile passes`);
                if (!changed) break;
                if (passes > flowCells + 16) throw Error('Flowfield failed to converge');
            }
            const encoder = this.begin();
            this.dispatch(encoder, 'flow_dirs', Math.ceil(flowCells / 4), { field, locomotion });
            this.copy(encoder, this.buffers[`field${field}`], 0, this.buffers[`field${1 - field}`], 0,
                this.sizes[`field${field}`]);
            this.submit(encoder);
            const distances = await this.readBuffer(this.buffers.field0, this.sizes.field0);
            for (let s = 0; locomotion === 0 && s < this.nav.spawns.length; s++) {
                let unreachable = 0;
                const set = this.nav.spawns[s].cells;
                for (let i = 0; i < this.nav.costs.length; i++) {
                    const scale = this.regions.flowScale ?? 1;
                    const cell = Math.floor(i / this.nav.columns / scale) * (this.regions.flowColumns ?? 1) +
                        Math.floor(i % this.nav.columns / scale);
                    if (set[i >>> 5] & (1 << (i & 31)) && this.nav.costs[i] & 127 && distances[cell] === INF)
                        unreachable++;
                }
                if (unreachable) this.notices.push(`Spawn ${s + 1}: ${unreachable} unreachable cells`);
            }
            this.check();
            return passes;
        } finally {
            flag.destroy();
        }
    }
    private scan(encoder: GPUCommandEncoder, input: number, a: number, _b: number, length: number): number {
        const blocks = Math.ceil(length / 1024), totals = this.parameters[PARAM.scanTotals];
        this.dispatch(encoder, 'scan_block', blocks * this.workgroupSize, { input, output: a, length, stride: 0 });
        this.dispatch(encoder, 'scan_block', this.workgroupSize,
            { input: totals, output: totals, length: blocks, stride: 1 });
        this.dispatch(encoder, 'scan_add', length, { output: a, length });
        return a;
    }
    queue(command: Omit<Command, 'player' | 'seq' | 'targetTick'>, delay = COMMAND_DELAY_TICKS, player = 0) {
        if (!Number.isInteger(delay) || delay < 0 || delay >= COMMAND_RING) throw Error('Invalid command delay');
        const targetTick = this.tick + delay;
        const queued = this.queued.get(targetTick) ?? [];
        const value = { ...command, payload: command.payload.slice(), player, seq: this.sequence++, targetTick };
        const ordered = orderedCommands([...queued, value], targetTick);
        this.queued.set(targetTick, ordered);
    }
    step(local = true): boolean {
        this.check();
        if (this.lockstep.frozen || this.transferring) return false;
        if (local) {
            if (this.lockstep.players.length !== 1) throw Error('Multiplayer ticks require a server-ordered bundle');
            this.lockstep.submit({ tick: this.tick, commands: this.queued.get(this.tick) ?? [],
                acknowledgements: [...this.lockstep.players] });
            this.queued.delete(this.tick);
        }
        const bundle = this.lockstep.take();
        if (!bundle) return false;
        this.profiler?.beginTick();
        const commands = encodeCommands(bundle.commands, bundle.tick);
        const commandOffset = this.commandsBase + bundle.tick % COMMAND_RING * COMMAND_SLOT_WORDS;
        this.device.queue.writeBuffer(this.buffers.extra, commandOffset * 4, commands);
        const p = this.parameters;
        p[PARAM.tick] = bundle.tick; p[PARAM.commands] = commandOffset;
        p[PARAM.emits] = this.emitBase + (bundle.tick & 1) * this.count * 4;
        p[PARAM.previousEmits] = this.emitBase + ((bundle.tick + 1) & 1) * this.count * 4;
        const encoder = this.begin();
        this.dispatch(encoder, 'clear_tick', Math.max(this.count, this.gridCount,
            (this.regions.coarseColumns ?? 0) * (this.regions.coarseRows ?? 0) * 4));
        this.dispatch(encoder, 'clear_entities', MAX_ENTITIES);
        this.dispatch(encoder, 'apply_commands', 1);
        this.dispatch(encoder, 'economy_tick', 1);
        this.dispatch(encoder, 'collect_construction', 1);
        this.dispatch(encoder, 'clear_construction', 1);
        this.dispatch(encoder, 'spend_construction', 1);
        this.dispatch(encoder, 'flow_rebuild_begin', 1);
        // Indirect arguments cannot also be bound as writable storage in the consuming pass.
        this.copy(encoder, this.buffers.scratch, p[PARAM.flowArgs] * 4, this.buffers.flowArgs, 0, 60);
        this.dispatch(encoder, 'flow_capture', 0, { flowRuntime: 1 }, false, 0);
        for (let locomotion = 0; locomotion < (this.regions.flowClasses ?? 1); locomotion++) {
            const values = { locomotion, flowRuntime: 1 };
            this.dispatch(encoder, 'flow_reset', 0, values, false, 1);
            for (let field = 0; field < 8; field++)
                this.dispatch(encoder, 'flow_relax', 0, { ...values, field: field & 1 }, true, 2);
            this.dispatch(encoder, 'flow_dirs', 0, values, false, 3);
        }
        this.dispatch(encoder, 'flow_commit', (this.regions.flowStride ?? 0) * (this.regions.flowClasses ?? 1),
            { flowRuntime: 1 }, false, 4);
        this.dispatch(encoder, 'flow_rebuild_finish', 1);
        let freeSlots = p[PARAM.emitScanA];
        if (this.regions.continuousSpawn && bundle.tick > 0 && bundle.tick % (60 * TICK_HZ) === 0) {
            this.dispatch(encoder, 'spawn_flags', this.count);
            freeSlots = this.scan(encoder, p[PARAM.emitScanA], p[PARAM.emitScanA], p[PARAM.emitScanB], this.count);
        }
        this.dispatch(encoder, 'spawn_release', this.count, { input: freeSlots });
        this.dispatch(encoder, 'order_prepare', 1);
        this.dispatch(encoder, 'unit_move', MAX_ENTITIES);
        this.dispatch(encoder, 'unit_commit', 1);
        this.dispatch(encoder, 'shield_prepare', 1);
        this.dispatch(encoder, 'grid_build', this.sortSize);
        const counts = this.scan(encoder, p[PARAM.counts], p[PARAM.scanA], p[PARAM.scanB], this.gridCount);
        p[PARAM.offsets] = counts;
        let sorted = p[PARAM.sortA], destination = p[PARAM.sortB];
        const blocks = Math.ceil(this.sortSize / 1024), histogram = p[PARAM.radixHist];
        const bits = Math.max(1, Math.ceil(Math.log2(this.gridCount + 1)));
        for (let shift = 0, field = 0; shift < bits; shift += 5, field = 1 - field) {
            const values = { input: sorted, output: destination, j: shift, field };
            this.dispatch(encoder, 'radix_count', blocks * this.workgroupSize, values);
            this.scan(encoder, histogram, histogram + 32 * blocks, histogram + 32 * blocks, 32 * blocks);
            this.dispatch(encoder, 'radix_scatter', blocks * this.workgroupSize, values);
            [sorted, destination] = [destination, sorted];
        }
        p[PARAM.sorted] = sorted;
        this.dispatch(encoder, 'zombie_think', this.count);
        this.dispatch(encoder, 'emit_flags', this.count);
        const emitScan = this.scan(encoder, p[PARAM.emitScanA], p[PARAM.emitScanA], p[PARAM.emitScanB], this.count);
        this.dispatch(encoder, 'emit_scatter', this.count, { input: emitScan });
        if (this.regions.coarseScale !== 1) {
            const coarseCells = (this.regions.coarseColumns ?? 0) * (this.regions.coarseRows ?? 0);
            this.dispatch(encoder, 'coarse_count', coarseCells);
            this.scan(encoder, p[PARAM.scanB], p[PARAM.scanB], p[PARAM.scanB], coarseCells);
            this.dispatch(encoder, 'coarse_scatter', coarseCells, { input: sorted, output: counts });
        }
        this.dispatch(encoder, 'sonic_force', MAX_ENTITIES);
        this.dispatch(encoder, 'grid_gather', this.count, { field: 0 });
        this.dispatch(encoder, 'zombie_move', this.count);
        this.dispatch(encoder, 'grid_gather', this.count, { field: 1 });
        for (let iteration = 0; iteration < SEPARATION_ITERATIONS; iteration++) {
            this.dispatch(encoder, 'zombie_separate', this.count);
            this.dispatch(encoder, 'zombie_separate_commit', this.count);
        }
        this.dispatch(encoder, 'zombie_recover', this.count);
        this.dispatch(encoder, 'gas_reset', this.count);
        this.dispatch(encoder, 'runover_damage', MAX_ENTITIES);
        this.dispatch(encoder, 'hostile_emit', 1);
        this.dispatch(encoder, 'cwis_intercept', 1);
        this.dispatch(encoder, 'hostile_update', 2048);
        this.dispatch(encoder, 'weapon_target', MAX_ENTITIES * 4);
        this.dispatch(encoder, 'artillery_scan', MAX_ENTITIES * 4 * this.workgroupSize);
        for (const entry of ['weapon_aim', 'weapon_fire']) this.dispatch(encoder, entry, MAX_ENTITIES * 4);
        for (const entry of ['shot_update', 'shot_hit', 'shot_detonate'])
            this.dispatch(encoder, entry, this.regions.projectileCountMax ?? 0);
        this.dispatch(encoder, 'splash_scan', (this.regions.projectileCountMax ?? 0) * this.workgroupSize);
        this.dispatch(encoder, 'fund_beams', 1);
        this.dispatch(encoder, 'beam_update', MAX_ENTITIES * 4);
        this.dispatch(encoder, 'weapons_update', this.count);
        this.dispatch(encoder, 'projectile_update', MAX_WEAPONS);
        this.dispatch(encoder, 'projectile_hit', MAX_WEAPONS);
        this.dispatch(encoder, 'consume_emits', this.count);
        this.dispatch(encoder, 'apply_entity_damage', 1);
        this.dispatch(encoder, 'apply_damage', this.count);
        this.dispatch(encoder, 'objective_update', 1);
        if (this.nav.winTick !== undefined) this.dispatch(encoder, 'end_match', Math.max(this.count,
            (this.regions.coarseColumns ?? 0) * (this.regions.coarseRows ?? 0) * 4));
        let hashSlot: { buffer: GPUBuffer; busy: boolean } | undefined;
        if (this.tick % this.hashInterval === 0) {
            const length = Math.ceil(Math.max(this.count * STATE_FIELDS, this.hashWords) / 4);
            this.dispatch(encoder, 'state_hash', length);
            hashSlot = this.hashSlots.find(candidate => !candidate.busy);
            if (!hashSlot) {
                hashSlot = { busy: false, buffer: this.device.createBuffer({ label: 'Hash readback pool', size: 12,
                    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }) };
                this.hashSlots.push(hashSlot);
            }
            hashSlot.busy = true;
        }
        const slot = this.slots.find(candidate => !candidate.busy);
        if (slot) {
            slot.busy = true; this.dispatch(encoder, 'snapshot', this.count);
            if (this.options.defense)
                this.dispatch(encoder, 'runtime_snapshot', Math.max(
                    (this.regions.projectileCountMax ?? 0) + SALE_EFFECT_SLOTS, MAX_ENTITIES * 4,
                    (this.regions.coarseColumns ?? 0) * (this.regions.coarseRows ?? 0) * 4));
        }
        if (hashSlot) {
            this.copy(encoder, this.buffers.scratch, 4, hashSlot.buffer, 0, 4);
            this.copy(encoder, this.buffers.extra, 0, hashSlot.buffer, 4, 4);
            this.copy(encoder, this.buffers.scratch, 12, hashSlot.buffer, 8, 4);
        }
        if (slot) {
            this.copy(encoder, this.buffers.scratch, p[PARAM.snapshot] * 4, slot.buffer, 0, this.count * 12);
            if (this.options.defense) this.copy(encoder, this.buffers.scratch,
                (this.regions.entitySnapshot ?? 0) * 4, slot.buffer, this.count * 12,
                (this.defenseWords - GHOST_WORDS - ECONOMY_WORDS) * 4);
            if (this.options.defense) this.copy(encoder, this.buffers.extra, (this.regions.ghosts ?? 0) * 4,
                slot.buffer, (this.count * 3 + this.defenseWords - ECONOMY_WORDS - GHOST_WORDS) * 4, GHOST_WORDS * 4);
            if (this.options.defense) this.copy(encoder, this.buffers.extra, (this.regions.economy ?? 0) * 4,
                slot.buffer, (this.count * 3 + this.defenseWords - ECONOMY_WORDS) * 4, ECONOMY_WORDS * 4);
        }
        this.submit(encoder); this.current = 1 - this.current;
        this.commandLog.push(bundle);
        if (this.commandLog.length > 1024) this.commandLog.shift();
        const tick = this.tick;
        if (slot) this.track((async () => {
            try {
                await slot.buffer.mapAsync(GPUMapMode.READ);
                const index = this.snapshotCursor++ % SNAPSHOT_RING;
                const words = this.snapshotWords[index] ??= new Int32Array(slot.buffer.size / 4);
                words.set(new Int32Array(slot.buffer.getMappedRange())); slot.buffer.unmap();
                if (!this.destroyed) {
                    const snapshot: RenderSnapshot = { tick, words: words.subarray(0, this.count * 3) };
                    if (this.options.defense) {
                        let offset = this.count * 3;
                        const entities = words.subarray(offset, offset += MAX_ENTITIES * RENDER_ENTITY_WORDS);
                        const projectiles = words.subarray(offset,
                            offset += (this.regions.projectileCountMax ?? 0) * RENDER_PROJECTILE_WORDS);
                        const beams = words.subarray(offset, offset += MAX_ENTITIES * 4 * RENDER_BEAM_WORDS);
                        const density = words.subarray(offset,
                            offset += (this.regions.coarseColumns ?? 1) * (this.regions.coarseRows ?? 1) * 4);
                        const economyOffset = words.length - ECONOMY_WORDS, ghostOffset = economyOffset - GHOST_WORDS;
                        snapshot.defense = { entities, projectiles, beams, density,
                            explosions: words.subarray(offset, ghostOffset),
                            ghosts: words.subarray(ghostOffset, economyOffset),
                            economy: words.subarray(economyOffset),
                            columns: (this.regions.coarseColumns ?? 1) * 2, rows: (this.regions.coarseRows ?? 1) * 2,
                            cell: this.parameters[PARAM.gridCellQ] / Q * (this.regions.coarseScale ?? 1) / 2 };
                    }
                    this.options.onSnapshot?.(snapshot);
                }
            } finally {
                slot.busy = false;
            }
        })());
        if (hashSlot) {
            const pooled = hashSlot, buffer = pooled.buffer;
            this.track((async () => {
                try {
                    await buffer.mapAsync(GPUMapMode.READ);
                    const result = new Uint32Array(buffer.getMappedRange());
                    const hash = result[0], hp = result[1], blocked = result[2]; buffer.unmap();
                    if (!this.destroyed) {
                        this.objectiveHealth = hp;
                        this.lockstep.recordHash(tick, hash);
                        this.options.onHash?.(tick, hash, hp, blocked);
                    }
                } finally {
                    pooled.busy = false;
                }
            })());
        }
        return true;
    }
    private track(read: Promise<void>) {
        const guarded = read.catch(error => {
            if (!this.destroyed) this.fail(error instanceof Error ? error : Error(String(error)));
        });
        this.reads.add(guarded); void guarded.finally(() => this.reads.delete(guarded));
    }
    async idle() {
        await this.device.queue.onSubmittedWorkDone(); await Promise.all([...this.reads]); this.check();
    }
    private async readBuffer(source: GPUBuffer, size: number, offset = 0): Promise<Uint32Array> {
        const buffer = this.device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        try {
            const encoder = this.device.createCommandEncoder();
            encoder.copyBufferToBuffer(source, offset, buffer, 0, size);
            this.device.queue.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ);
            const words = new Uint32Array(buffer.getMappedRange().slice(0)); buffer.unmap(); return words;
        } finally {
            buffer.destroy();
        }
    }
    get flowGrid() {
        return { columns: this.regions.flowColumns ?? 1, rows: this.regions.flowRows ?? 1,
            cellCm: this.nav.cellCm * (this.regions.flowScale ?? 1) };
    }
    async flowData(): Promise<Uint32Array> {
        this.check();
        return this.readBuffer(this.buffers.extra, (this.regions.flowStride ?? 0) * (this.regions.flowClasses ?? 1) * 4,
            (this.regions.flowActive ?? 0) * 4);
    }
    async saveState(): Promise<StateSnapshot> {
        if (this.transferring) throw Error('Snapshot transfer is already running');
        this.transferring = true;
        try {
            await this.idle();
            const buffers: Record<string, Uint32Array> = {};
            for (const [name, buffer] of Object.entries(this.buffers))
                buffers[name] = await this.readBuffer(buffer, this.sizes[name]);
            return { handshake: this.handshake, seed: this.parameters[PARAM.seed], tick: this.tick,
                current: this.current, sequences: this.lockstep.snapshotSequences(), buffers };
        } finally {
            this.transferring = false;
        }
    }
    async restoreState(snapshot: StateSnapshot) {
        if (this.transferring) throw Error('Snapshot transfer is already running');
        this.transferring = true;
        try {
            await this.idle(); Lockstep.compare(this.handshake, snapshot.handshake);
            if (![0, 1].includes(snapshot.current) || !Number.isInteger(snapshot.tick) || snapshot.tick < 0 ||
                snapshot.seed !== this.parameters[PARAM.seed]) throw Error('Invalid simulation snapshot');
            for (const [name, size] of Object.entries(this.sizes))
                if (!(snapshot.buffers[name] instanceof Uint32Array) || snapshot.buffers[name].byteLength !== size)
                    throw Error(`Invalid snapshot buffer ${name}`);
            if (Object.keys(snapshot.buffers).some(name => !this.buffers[name])) throw Error('Unknown snapshot buffer');
            for (const [name, data] of Object.entries(snapshot.buffers))
                this.device.queue.writeBuffer(this.buffers[name], 0, data);
            // Rebuild the derived hostile-shot bound on the next interception pass.
            this.device.queue.writeBuffer(this.buffers.scratch, SCRATCH.hostileEnd * 4, new Uint32Array([2048]));
            this.objectiveHealth = snapshot.buffers.extra[0];
            this.current = snapshot.current; this.lockstep.restore(snapshot.tick, snapshot.sequences);
            this.queued.clear(); this.commandLog.length = 0;
            this.sequence = Math.max(0, ...snapshot.sequences.map(([, seq]) => seq + 1));
        } finally {
            this.transferring = false;
        }
    }
    async replay(bundles: ReadonlyArray<TickBundle>) {
        for (const bundle of bundles) {
            this.lockstep.submit(bundle); if (!this.step(false)) throw Error('Replay stalled');
        }
        await this.idle();
    }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true; this.sharedOwners?.delete(this);
        const finished = this.device.queue.onSubmittedWorkDone().catch(() => {});
        const release = async () => {
            await finished;
            await Promise.all([...this.reads]);
            for (const buffer of Object.values(this.buffers)) buffer.destroy();
            for (const slot of [...this.slots, ...this.hashSlots]) slot.buffer.destroy();
            this.profiler?.destroy(); this.profiler = undefined;
            this.snapshotWords.length = 0; this.hashSlots.length = 0;
            this.uniform.destroy(); this.device.removeEventListener('uncapturederror', this.errorListener);
            this.groups.length = 0; this.pipelines.clear(); this.slots.length = 0;
            this.buffers = {}; this.queued.clear(); this.commandLog.length = 0;
            this.options = {};
        };
        SimCore.retirement = Promise.all([SimCore.retirement, release()]).then(() => {});
    }
}
