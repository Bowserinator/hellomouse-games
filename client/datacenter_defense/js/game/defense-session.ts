import type * as T from 'three';
import type { World } from '../mapx.js';
import { SimDriver } from '../sim/driver.js';
import { CommandType, OrderType, MAX_ROW, type Command } from '../sim/commands.js';
import { ENTITY as E, ECONOMY as C, playerEconomyOffset, GHOST as G, GHOST_STRIDE, isLive, isActive, MAX_ENTITIES,
    RENDER_PROJECTILE_WORDS } from '../sim/layout.js';
import { entities } from '../sim/entity/registry.js';
import { Q, WAVE_DAMAGE, WAVE_HP, WAVE_WORDS } from '../sim/fixed.js';
import { RtsCamera } from './input/rts-camera.js';
import { DefenseView } from './defense-view.js';
import { SHOCKWAVE } from './defense-audio.js';
import { UnitOrders } from './unit-orders.js';
import { CommandBar, type ControlAction } from './ui/command-bar.js';
import { TimelineHud } from './ui/timeline-hud.js';
import { ResourceBars } from './ui/resource-bars.js';
import { Leaderboard } from './ui/leaderboard.js';
import { MapAnnotations } from './ui/map-annotations.js';
import { timeline } from '../sim/timeline.js';
import { BALANCE } from '../sim/balance.js';
import { inConstructionRange, type ConstructionCircle } from '../render/construction-overlay.js';

type Cell = { x: number; z: number; rotation: number; valid: boolean };
type GhostEdit = { command?: Command; x: number; z: number } |
{ command?: Command; definition: number; cells: Array<Cell>; append: boolean };
export class DefenseSession {
    readonly camera: RtsCamera;
    readonly view: DefenseView;
    readonly bar: CommandBar;
    readonly runtimeStats = { entities: 0, projectiles: 0 };
    private controller = new AbortController();
    private building?: number;
    private action?: ControlAction;
    private pointer?: { x: number; y: number };
    private drag?: { x: number; y: number; ground: T.Vector3; row: boolean };
    private shift = false;
    private appendPlacement = false;
    private selectionSent = '';
    private selectionTime = 0;
    private intents: Array<Command> = [];
    private ghostEdits: Array<GhostEdit> = [];
    private orders: UnitOrders;
    private timeline: TimelineHud;
    private resources?: ResourceBars;
    private leaderboard: Leaderboard;
    private annotations?: MapAnnotations;
    private objectiveSelected = false;
    private rejected = 0;
    private sales = new Map<number, { generation: number; deadline: number }>();
    private resultShown = false;
    private audioTime?: number;
    private objectiveHealth: number = BALANCE.objective.hp;
    private objectiveWarning = -Infinity;
    private logicalPaths: Array<{ id: number; segment: number; x: number; y: number; sx: number; sy: number }> = [];
    constructor(readonly driver: SimDriver, camera: T.PerspectiveCamera, scene: T.Scene,
        host: HTMLElement, private world: World, notify: (message: string) => void) {
        if (driver.core.nav.cellCm !== 100) throw Error('Defense requires a map with 1 m navigation cells');
        this.camera = new RtsCamera(camera, host.querySelector('canvas') as HTMLCanvasElement, world);
        this.view = new DefenseView(this.camera, scene, host, world);
        this.view.roster = driver.roster;
        this.view.localSlot = driver.slot;
        this.view.teammateSelections = driver.selections;
        this.timeline = new TimelineHud(driver, host);
        const players = driver.roster.length ? driver.roster : [{ slot: driver.slot, color: 0, name: 'Player', ready: true }];
        this.leaderboard = new Leaderboard(host, players, driver.slot, slot => this.giftSelection(slot));
        if (!driver.core.unlimitedEconomy) this.resources = new ResourceBars(host);
        this.bar = new CommandBar(host);
        this.orders = new UnitOrders(driver, notify);
        if (this.resources) {
            const player = players.find(entry => entry.slot === driver.slot);
            const annotations = this.annotations = new MapAnnotations(this.camera, host, this.resources.element,
                action => {
                    if (driver.local) annotations.acceptLocal(action, player?.name ?? 'Player', player?.color ?? 0);
                    else driver.onAnnotationAction?.(action);
                }, () => {
                    this.drag = undefined;
                    this.control('cancel');
                    this.bar.hover();
                }, () => this.view.audio.play('ping.mp3', undefined, 0.75));
            driver.onAnnotation = annotation => annotations.accept(annotation);
        }
        this.orders.onCommand = command => {
            if (command.type === CommandType.FireAt) this.intents.push(command);
        };
        this.bar.onBuild = definition => {
            this.annotations?.cancel();
            this.building = definition; this.action = undefined; this.bar.armed(definition);
            this.camera.panEnabled = false;
        };
        this.bar.onUpgrade = (tier, append) => {
            this.control('cancel');
            for (const id of this.view.selected) {
                const row = this.view.entity(id);
                if (isActive(row) && row[E.rotation] >>> 2 === driver.slot && entities[row[E.def]].options.buildPower)
                    this.submit(CommandType.CraneUpgrade, [id, row[E.flags] >>> 8, tier, Number(append)]);
            }
        };
        this.bar.onFilter = definition => {
            if (definition === undefined) this.view.selected.clear();
            else {
                for (const id of this.view.selected)
                    if (this.view.entity(id)?.[E.def] !== definition) this.view.selected.delete(id);
                this.objectiveSelected = false;
            }
            this.updateSelection();
        };
        this.bar.onAction = action => this.control(action);
        this.bar.onPriority = (mode, low, high) => this.submit(CommandType.SetPriority, [mode, low, high], true);
        driver.onSnapshot = snapshot => {
            this.view.accept(snapshot); this.orders.accept(snapshot);
            const economy = snapshot.defense?.economy;
            if (economy) {
                const offset = playerEconomyOffset(driver.slot);
                this.resources?.update(economy.subarray(offset));
                if (economy[offset + C.rejected] > this.rejected) notify('Not enough resources');
                this.rejected = economy[offset + C.rejected];
            }
            if (this.pointer) this.hover(this.pointer.x, this.pointer.y);
        };
        const canvas = this.camera.canvas, options = { signal: this.controller.signal };
        const unlockAudio = () => this.view.audio.unlockLoops();
        window.addEventListener('pointerdown', unlockAudio, options);
        window.addEventListener('keydown', unlockAudio, options);
        canvas.addEventListener('pointermove', event => {
            this.pointer = { x: event.clientX, y: event.clientY }; this.shift = event.shiftKey || event.ctrlKey;
            this.appendPlacement = event.shiftKey;
            this.hover(event.clientX, event.clientY);
        }, options);
        canvas.addEventListener('pointerleave', () => {
            this.pointer = undefined; this.bar.hover(); canvas.style.cursor = '';
        }, options);
        canvas.addEventListener('pointerdown', event => {
            if (this.camera.orbit) return;
            if (event.button === 2) {
                event.preventDefault(); this.right(event); return;
            }
            if (event.button !== 0) return;
            const ground = this.camera.ground(event.clientX, event.clientY); if (!ground) return;
            canvas.setPointerCapture(event.pointerId);
            this.drag = { x: event.clientX, y: event.clientY, ground, row: true };
        }, options);
        canvas.addEventListener('pointerup', event => this.release(event), options);
        canvas.addEventListener('dblclick', event => {
            if (event.button !== 0 || this.camera.orbit || this.building !== undefined || this.action) return;
            const clicked = this.view.entity(this.view.hit(event.clientX, event.clientY));
            if (!this.owns(clicked)) return;
            event.preventDefault(); this.drag = undefined;
            if (!(event.shiftKey || event.ctrlKey)) {
                this.view.selected.clear(); this.objectiveSelected = false;
            }
            const bounds = canvas.getBoundingClientRect();
            for (let id = 0; id < MAX_ENTITIES; id++) {
                const row = this.view.entity(id);
                if (this.owns(row) && row[E.def] === clicked[E.def] && this.inBounds(row, bounds))
                    this.view.selected.add(id);
            }
            this.updateSelection();
        }, options);
        canvas.addEventListener('pointercancel', () => {
            this.drag = undefined;
        }, options);
        const modifiers = (event: KeyboardEvent) => {
            this.shift = event.shiftKey || event.ctrlKey;
            this.appendPlacement = event.shiftKey;
        };
        window.addEventListener('keydown', modifiers, { ...options, capture: true });
        window.addEventListener('keyup', modifiers, { ...options, capture: true });
        window.addEventListener('keydown', event => this.shortcut(event), options);
        window.addEventListener('blur', () => {
            this.shift = false; this.appendPlacement = false; this.drag = undefined;
        }, options);
    }
    private shortcut(event: KeyboardEvent) {
        if (event.metaKey || event.target instanceof Element &&
            event.target.closest('input, textarea, select, [contenteditable], dialog')) return;
        const key = event.key.toLowerCase();
        if (key === ' ' && !event.ctrlKey && !event.altKey) this.drag = undefined;
        if (event.defaultPrevented) return;
        let action: (() => void) | undefined;
        if (event.ctrlKey && !event.altKey) {
            if (key === 'g' && event.shiftKey) action = () => this.orders.distribute(this.view.selected);
            else if (key === 'k' && this.view.selected.size && !this.driver.result)
                action = () => this.queueSale(event.shiftKey);
            else if (!event.shiftKey && ['b', 'l', 'x', 'c', '.'].includes(key))
                action = () => this.selectShortcut(key);
        } else if (event.altKey && !event.ctrlKey && !event.shiftKey && event.code === 'Period')
            action = () => this.selectShortcut('idle');
        else if (!event.altKey && !event.ctrlKey && key === 'm' && !this.camera.orbit && this.pointer) {
            const { x, y } = this.pointer;
            action = () => this.right({ clientX: x, clientY: y, shiftKey: event.shiftKey, ctrlKey: false });
        }
        if (!action) return;
        event.preventDefault();
        if (!event.repeat) action();
    }
    private inBounds(row: Int32Array, bounds: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>) {
        const point = this.camera.project(row[E.x] / Q, row[E.z] / Q,
            1 + this.view.altitude(row, this.driver.renderTick));
        return point.visible && point.x >= bounds.left && point.x <= bounds.right &&
            point.y >= bounds.top && point.y <= bounds.bottom;
    }
    private selectShortcut(key: string) {
        const bounds = key === 'c' || key === '.' ? this.camera.canvas.getBoundingClientRect() : undefined;
        const selected: Array<number> = [];
        for (let id = 0; id < MAX_ENTITIES; id++) {
            const row = this.view.entity(id);
            if (!this.owns(row)) continue;
            const definition = entities[row[E.def]];
            if ((key === 'b' || key === '.' || key === 'idle') && !definition.options.buildPower) continue;
            if (key === 'l' && !definition.weapons.length && !definition.options.runoverDamage) continue;
            if (bounds && !this.inBounds(row, bounds)) continue;
            if (key === 'idle' && (!isActive(row) || row[E.buildTask] >= 0 ||
                row[E.upgradeTarget] > definition.tier || row[E.flags] & 1)) continue;
            selected.push(id);
            if (key === 'idle') break;
        }
        if (key === 'idle' && !selected.length) return;
        this.view.selected.clear(); this.objectiveSelected = false;
        for (const id of selected) this.view.selected.add(id);
        this.updateSelection();
    }
    private overObjective(x: number, y: number): boolean {
        if (this.driver.core.objectiveHealth <= 0) return false;
        const objective = this.driver.core.nav.objective;
        const centre = this.camera.project(objective.x / Q, objective.z / Q, 0);
        const edge = this.camera.project((objective.x + objective.radius) / Q, objective.z / Q, 0);
        const radius = Math.max(10, Math.hypot(edge.x - centre.x, edge.y - centre.y));
        const ground = this.camera.ground(x, y);
        const inside = ground && Math.hypot(ground.x * Q - objective.x, ground.z * Q - objective.z) <= objective.radius;
        return !!centre.visible && (!!inside || Math.hypot(x - centre.x, y - centre.y) <= radius);
    }
    private owns(row?: Int32Array): row is Int32Array {
        return isLive(row) && row[E.rotation] >>> 2 === this.driver.slot;
    }
    private assistBuilders(victim: Int32Array, target = -1): Array<number> {
        if (!isLive(victim)) return [];
        const building = victim[E.state] === 2;
        const definition = entities[victim[E.def]];
        const upgrading = victim[E.upgradeTarget] > definition.tier;
        if (!building && !upgrading && (!this.owns(victim) || victim[E.hp] >= definition.maxHp)) return [];
        const result: Array<number> = [], x = victim[E.x] / Q, z = victim[E.z] / Q;
        const tier = definition.tier;
        for (const id of this.view.selected) {
            if (id === target) continue;
            const row = this.view.entity(id);
            if (!isActive(row)) continue;
            const def = entities[row[E.def]];
            if (!def.options.buildPower || row[E.upgradeTarget] > def.tier || building && def.tier < tier) continue;
            if (inConstructionRange(x, z, [{ x: row[E.x] / Q, z: row[E.z] / Q,
                radius: entities[row[E.def]].options.buildRadius ?? 0 }])) result.push(id);
        }
        return result;
    }
    private hover(x: number, y: number) {
        const target = this.view.hit(x, y), row = this.view.entity(target);
        const overObjective = !isLive(row) && this.overObjective(x, y);
        const assist = isLive(row) && this.assistBuilders(row, target).length;
        this.camera.canvas.style.cursor = assist ? 'copy' : '';
        if (isLive(row)) {
            this.bar.hover(entities[row[E.def]].name, row); return;
        }
        if (overObjective) {
            const nav = this.driver.core.nav;
            const clock = nav.winTick === undefined ? undefined
                : timeline(this.driver.core.tick, nav.firstWaveTick, nav.winTick);
            this.bar.hoverObjective(this.objectiveInfo(), this.driver.core.objectiveMaxHealth, clock);
        } else {
            const victim = this.view.zombie(x, y);
            if (victim >= 0 && this.view.snapshot) {
                const nav = this.driver.core.nav, slot = nav.waveOffset + victim * WAVE_WORDS;
                this.bar.hoverZombie(this.view.snapshot.words[victim * 3 + 2],
                    nav.words[slot + WAVE_HP] ?? 100, nav.words[slot + WAVE_DAMAGE] ?? 100);
            } else this.bar.hover();
        }
    }
    private blob() {
        const words = new Array<number>(32).fill(0);
        for (const id of this.view.selected) words[id >>> 5] = (words[id >>> 5] | (1 << (id & 31))) >>> 0;
        return words;
    }
    private submit(type: CommandType, payload: Array<number>, selected = false, ghostEdit?: GhostEdit) {
        if (selected && !this.view.selected.size && type !== CommandType.Place && type !== CommandType.PlaceRow) return;
        const input: Omit<Command, 'player' | 'seq' | 'targetTick'> = { type, payload };
        if (selected) input.blob = this.blob();
        if (ghostEdit) this.ghostEdits.push(ghostEdit);
        this.orders.submit(input, ghostEdit && (command => {
            ghostEdit.command = command;
        }));
    }
    private giftSelection(slot: number) {
        if (this.driver.result || slot === this.driver.slot) return;
        for (const id of this.view.selected) {
            const row = this.view.entity(id);
            if (isLive(row) && row[E.rotation] >>> 2 === this.driver.slot) {
                this.sales.delete(id);
                this.submit(CommandType.Gift, [id, row[E.flags] >>> 8, slot]);
            }
        }
    }
    private queueSale(immediate: boolean) {
        if (this.objectiveSelected) return;
        const targets = new Map<number, number>();
        const deadline = performance.now() + 5000;
        for (const id of this.view.selected) {
            const row = this.view.entity(id);
            if (!this.owns(row)) continue;
            const generation = row[E.flags] >>> 8;
            if (immediate) targets.set(id, generation);
            else if (this.sales.get(id)?.generation === generation) this.sales.delete(id);
            else this.sales.set(id, { generation, deadline });
        }
        this.sell(targets);
    }
    private sell(targets: Map<number, number>) {
        if (!targets.size || this.driver.result) return;
        this.control('cancel');
        this.orders.cancel(new Set(targets.keys()));
        for (const [id, generation] of targets) {
            this.sales.delete(id);
            this.submit(CommandType.Sell, [id, generation]);
        }
    }
    private control(action: ControlAction) {
        this.annotations?.cancel();
        if (action === 'sell') {
            if (this.objectiveSelected) return;
            const targets = new Map<number, number>();
            const groups = new Map<number, number>();
            let refund = 0;
            for (const id of this.view.selected) {
                const row = this.view.entity(id); if (!this.owns(row)) continue;
                targets.set(id, row[E.flags] >>> 8);
                groups.set(row[E.def], (groups.get(row[E.def]) ?? 0) + 1);
                if (isActive(row)) refund += entities[row[E.def]].options.cost.money * BALANCE.saleRefundPct;
            }
            const items = [...groups].map(([definition, count]) => ({ definition, count }));
            this.bar.confirmSale(items, refund / 100, () => {
                for (const [id, generation] of targets) {
                    const row = this.view.entity(id);
                    if (!this.owns(row) || row[E.flags] >>> 8 !== generation) targets.delete(id);
                }
                this.sell(targets);
            });
            return;
        }
        this.building = undefined; this.bar.armed();
        if (action === 'stop') {
            this.orders.cancel(this.view.selected);
            this.submit(CommandType.Order, [OrderType.Stop, 0, 0, 0], true);
        } else if (action === 'clear') this.submit(CommandType.ClearOverride, [], true);
        else if (action === 'hold') {
            const first = this.view.selected.values().next().value as number | undefined;
            const held = first === undefined ? false : !!((this.view.entity(first)?.[E.flags] ?? 0) & 1);
            this.submit(CommandType.SetStance, [Number(!held)], true);
        }

        this.action = ['move', 'attackMove', 'fire'].includes(action) ? action : undefined;
        this.camera.panEnabled = !this.action;
    }
    private ghosts() {
        const snapshot = this.view.snapshot, words = snapshot?.defense?.ghosts;
        const footprint = (definition: number, rotation: number, source: number, x: number, z: number) => {
            const { width, depth } = entities[definition].footprint;
            return { definition, rotation, source, x, z,
                width: rotation & 1 ? depth : width, depth: rotation & 1 ? width : depth };
        };
        let ghosts: Array<ReturnType<typeof footprint>> = [];
        if (words) for (let i = 0; i < words[0]; i++) {
            const at = 1 + i * GHOST_STRIDE;
            ghosts.push(footprint(words[at + G.definition], words[at + G.rotation], words[at + G.source],
                words[at + G.x] / Q, words[at + G.z] / Q));
        }
        this.ghostEdits = this.ghostEdits.filter(edit => !edit.command ||
            !this.driver.hasApplied(edit.command, snapshot?.tick ?? 0));
        const slot = this.driver.slot;
        for (const edit of this.ghostEdits)
            if ('cells' in edit) {
                if (!edit.append) ghosts = ghosts.filter(ghost => ghost.source !== slot);
                for (const cell of edit.cells)
                    ghosts.push(footprint(edit.definition, cell.rotation, slot, cell.x, cell.z));
            } else ghosts = ghosts.filter(ghost => ghost.source !== slot || ghost.x !== edit.x || ghost.z !== edit.z);
        return ghosts;
    }
    private right(event: Pick<MouseEvent, 'clientX' | 'clientY' | 'shiftKey' | 'ctrlKey'>) {
        const ground = this.camera.ground(event.clientX, event.clientY);
        const target = this.view.hit(event.clientX, event.clientY);
        const row = this.view.entity(target);
        if (event.ctrlKey && this.building === undefined && !this.action && isLive(row) &&
            this.assistBuilders(row, target).some(id => this.view.entity(id)?.[E.buildTask] === target)) {
            this.submit(CommandType.Order, [OrderType.Assist, target, 1, 0], true);
            return;
        }
        if (ground && (event.shiftKey || event.ctrlKey))
            for (const ghost of this.ghosts()) {
                if (ghost.source !== this.driver.slot || ground.x < ghost.x || ground.z < ghost.z ||
                    ground.x >= ghost.x + ghost.width || ground.z >= ghost.z + ghost.depth) continue;
                this.submit(CommandType.RemoveGhost, [ghost.x * Q, ghost.z * Q], false, { x: ghost.x, z: ghost.z });
                return;
            }

        if (this.building !== undefined || this.action) {
            this.control('cancel'); return;
        }
        if (event.shiftKey || event.ctrlKey) {
            const segment = this.logicalPaths.find(path => {
                const dx = path.x - path.sx, dy = path.y - path.sy;
                const t = Math.max(0, Math.min(1, ((event.clientX - path.sx) * dx +
                    (event.clientY - path.sy) * dy) / Math.max(1, dx * dx + dy * dy)));
                return Math.hypot(event.clientX - path.sx - dx * t, event.clientY - path.sy - dy * t) < 12;
            });
            if (segment) {
                this.orders.remove(segment.id, segment.segment); return;
            }
            const queued = this.view.pathHit(event.clientX, event.clientY);
            if (queued) {
                this.orders.remove(queued.id, queued.segment, true); return;
            }
        }
        if (target >= 0) {
            const builders = row ? this.assistBuilders(row, target) : [];
            if (builders.length) {
                this.submit(CommandType.Order, [OrderType.Assist, target, 0, 0], true);
                this.view.targetFeedback(row![E.x] / Q, row![E.z] / Q, false);
            }
            return;
        }
        if (!ground) return;
        const victim = this.view.zombie(event.clientX, event.clientY);
        this.order(victim >= 0 ? OrderType.Attack : OrderType.Move,
            ground, event.shiftKey || event.ctrlKey, victim >= 0 ? victim : undefined);
    }
    private order(kind: OrderType, point: T.Vector3, append: boolean, victim?: number) {
        if (!this.view.selected.size) return;
        this.view.targetFeedback(point.x, point.z, kind === OrderType.Attack || kind === OrderType.AttackMove);
        this.orders.order(this.view.selected, kind,
            { x: Math.round(Math.max(0, Math.min(this.world.width, point.x)) * Q),
                z: Math.round(Math.max(0, Math.min(this.world.depth, point.z)) * Q) }, append, victim);
    }
    private release(event: PointerEvent) {
        const drag = this.drag; this.drag = undefined;
        if (!drag || event.button !== 0 || this.camera.orbit) return;
        const point = this.camera.ground(event.clientX, event.clientY); if (!point) return;
        if (this.building !== undefined) {
            const append = Number(event.shiftKey);
            const cells = this.cells(drag.ground, point, drag.row, !!append).filter(cell => cell.valid);
            const [cell] = cells, definition = this.building;
            if (!cell) return;
            const strike = entities[definition].kind === 6;
            const edit = strike ? undefined : { definition, cells, append: !!append };
            if (strike || !drag.row) {
                this.submit(CommandType.Place, [definition, cell.x * Q, cell.z * Q, 0, 0, append], true, edit);
                if (strike) this.view.targetFeedback(point.x, point.z, true);
            } else
                this.submit(CommandType.PlaceRow, [definition, cell.x * Q, cell.z * Q,
                    Math.max(0, Math.floor(point.x)) * Q, Math.max(0, Math.floor(point.z)) * Q,
                    0, append], true, edit);
            return;
        }
        if (this.action) {
            if (this.action === 'fire') {
                if (this.view.selected.size) this.view.targetFeedback(point.x, point.z, true);
                this.submit(CommandType.FireAt, [Math.round(Math.max(0, Math.min(this.world.width, point.x)) * Q),
                    Math.round(Math.max(0, Math.min(this.world.depth, point.z)) * Q),
                    1], true);
            } else {
                const victim = this.action === 'move' ? -1 : this.view.zombie(event.clientX, event.clientY);
                this.order(this.action === 'move' ? OrderType.Move : victim >= 0 ? OrderType.Attack : OrderType.AttackMove,
                    point, event.shiftKey || event.ctrlKey, victim >= 0 ? victim : undefined);
            }
            this.action = undefined; return;
        }
        if (!drag.row && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= 5) return;
        const additive = event.shiftKey || event.ctrlKey;
        if (!additive) {
            this.view.selected.clear(); this.objectiveSelected = false;
        }
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) {
            const id = this.view.hit(event.clientX, event.clientY);
            if (id < 0 && this.overObjective(event.clientX, event.clientY))
                this.objectiveSelected = !this.objectiveSelected;
            if (this.owns(this.view.entity(id)))
                if (additive && this.view.selected.has(id)) this.view.selected.delete(id);
                else this.view.selected.add(id);
        } else {
            const left = Math.min(drag.x, event.clientX), right = Math.max(drag.x, event.clientX);
            const top = Math.min(drag.y, event.clientY), bottom = Math.max(drag.y, event.clientY);
            const bounds = { left, right, top, bottom };
            const contains = ({ x, y, visible }: ReturnType<RtsCamera['project']>) =>
                visible && x >= left && x <= right && y >= top && y <= bottom;
            const { x, z } = this.driver.core.nav.objective;
            if (this.driver.core.objectiveHealth && contains(this.camera.project(x / Q, z / Q, 1)))
                this.objectiveSelected = true;
            const attackers: Array<number> = [];
            for (let id = 0; id < MAX_ENTITIES; id++) {
                const row = this.view.entity(id);
                if (!this.owns(row) || !this.inBounds(row, bounds)) continue;
                const definition = entities[row[E.def]];
                if (!additive && (definition.weapons.length || definition.options.runoverDamage)) attackers.push(id);
                else this.view.selected.add(id);
            }
            if (attackers.length) {
                this.view.selected.clear(); this.objectiveSelected = false;
                for (const id of attackers) this.view.selected.add(id);
            }
        }

        this.updateSelection();
    }
    constructionCircles(): Array<ConstructionCircle> {
        const tier = this.building === undefined ? 0 : entities[this.building].tier;
        const circles: Array<ConstructionCircle> = [];
        for (let id = 0; id < MAX_ENTITIES; id++) {
            if (tier && !this.view.selected.has(id)) continue;
            const row = this.view.entity(id);
            if (!this.owns(row) || !isActive(row)) continue;
            const def = entities[row[E.def]], radius = def.options.buildRadius;
            if (row[E.upgradeTarget] > def.tier) continue;
            if (radius && def.tier >= tier) circles.push({ x: row[E.x] / Q, z: row[E.z] / Q, radius });
        }
        return circles;
    }
    private objectiveInfo() {
        return {
            name: this.world.objects.find(object => object.kind === 'objective')?.name ?? '',
            hp: this.driver.core.objectiveHealth
        };
    }
    private updateSelection() {
        for (const id of this.view.selected) if (!this.owns(this.view.entity(id))) this.view.selected.delete(id);
        const rows = [...this.view.selected].map(id => this.view.entity(id)).filter(isLive);
        this.leaderboard.setGiftEnabled(!this.driver.result &&
            rows.some(row => row[E.rotation] >>> 2 === this.driver.slot));
        const first = this.view.selected.values().next().value;
        if (!this.driver.core.objectiveHealth) this.objectiveSelected = false;
        const objective = this.objectiveSelected ? this.objectiveInfo() : undefined;
        if (this.building !== undefined) {
            const required = entities[this.building].tier;
            if (!rows.every(row => !!entities[row[E.def]].options.buildPower) || !rows.some(row => {
                const def = entities[row[E.def]];
                return isActive(row) && row[E.upgradeTarget] <= def.tier && def.tier >= required;
            })) this.control('cancel');
        }
        const owned = rows.filter(row => isActive(row) && row[E.rotation] >>> 2 === this.driver.slot);
        const crane = rows.every(row => !!entities[row[E.def]].options.buildPower)
            ? owned.reduce<Int32Array | undefined>((lowest, row) =>
                !lowest || entities[row[E.def]].tier < entities[lowest[E.def]].tier ? row : lowest, undefined)
            : undefined;
        const upgrade = crane && {
            name: entities[crane[E.def]].name, hp: crane[E.hp], tier: entities[crane[E.def]].tier,
            target: crane[E.upgradeTarget], queued: crane[E.queuedUpgrade],
            progress: crane[E.upgradeProgress], held: !!(crane[E.flags] & 1)
        };
        this.bar.selection(rows, first !== undefined && this.view.attacking.has(first), objective,
            upgrade);
    }
    private cells(start: T.Vector3, end: T.Vector3, row: boolean, append: boolean): Array<Cell> {
        if (this.building === undefined) return [];
        const definition = entities[this.building];
        if (definition.kind === 6) return [{ x: Math.floor(end.x), z: Math.floor(end.z), rotation: 0,
            valid: end.x >= 0 && end.z >= 0 && end.x <= this.world.width && end.z <= this.world.depth }];
        const flightHeight = definition.options.flightHeight ?? 0;
        const x = Math.max(0, Math.floor(start.x)), z = Math.max(0, Math.floor(start.z));
        const dx = Math.floor(end.x) - x, dz = Math.floor(end.z) - z;
        const { width, depth } = definition.footprint, rotation = 0;
        const alongX = Math.abs(dx) * depth >= Math.abs(dz) * width;
        const intervals = Math.floor(alongX ? Math.abs(dx) / width : Math.abs(dz) / depth);
        const count = row ? Math.min(MAX_ROW, intervals + 1) : 1;
        const ghosts = this.ghosts().filter(ghost => append || ghost.source !== this.driver.slot);
        const cells = Array.from({ length: count }, (_, i) => {
            const travel = i * (alongX ? width : depth);
            const px = x + Math.sign(dx) * (alongX ? travel
                : Math.floor(Math.abs(dx) * travel / Math.max(1, Math.abs(dz))));
            const pz = z + Math.sign(dz) * (alongX
                ? Math.floor(Math.abs(dz) * travel / Math.max(1, Math.abs(dx))) : travel);
            let valid = px >= 0 && pz >= 0 && px + width <= this.world.width && pz + depth <= this.world.depth;
            valid &&= inConstructionRange(px + width / 2, pz + depth / 2, this.constructionCircles());
            valid &&= !ghosts.some(ghost => px < ghost.x + ghost.width && px + width > ghost.x &&
                pz < ghost.z + ghost.depth && pz + depth > ghost.z);
            const nav = this.driver.core.nav;
            for (let zz = pz; valid && zz < pz + depth; zz++) for (let xx = px; xx < px + width; xx++)
                if (!((flightHeight ? nav.airCosts : nav.costs)[zz * nav.columns + xx] & 127)) {
                    valid = false; break;
                }

            for (let id = 0; valid && id < MAX_ENTITIES; id++) {
                const entity = this.view.entity(id); if (!isLive(entity)) continue;
                const def = entities[entity[E.def]], rotated = entity[E.rotation] & 1;
                if (Boolean(def.options.flightHeight) !== Boolean(flightHeight) ||
                    def.kind === 2 && isActive(entity)) continue;
                const ew = rotated ? def.footprint.depth : def.footprint.width;
                const ed = rotated ? def.footprint.width : def.footprint.depth;
                const ex = entity[E.x] / Q, ez = entity[E.z] / Q;
                if (px < ex + ew / 2 && px + width > ex - ew / 2 && pz < ez + ed / 2 && pz + depth > ez - ed / 2)
                    valid = false;
            }
            return { x: px, z: pz, rotation, valid };
        });
        const blocked = cells.findIndex(cell => !cell.valid);
        return blocked < 0 ? cells : cells.slice(0, blocked + 1);
    }
    update(now: number) {
        this.orders.update();
        this.view.logicalOrders.clear();
        for (const id of this.orders.plans.keys()) this.view.logicalOrders.add(id);
        this.camera.update(now);
        this.view.updateAudio(Math.min(0.1, (now - (this.audioTime ?? now)) / 1000),
            this.driver.isPaused || Boolean(this.driver.result));
        this.audioTime = now;
        const health = this.driver.core.objectiveHealth;
        if (!this.driver.result && health > 0 && health < this.objectiveHealth && now - this.objectiveWarning >= 8000) {
            this.view.audio.play('objective_under_attack.mp3');
            this.objectiveWarning = now;
        }
        this.objectiveHealth = health;
        this.view.effects.shake(this.camera.camera, now / 1000); this.camera.camera.updateMatrixWorld();
        this.annotations?.update(now);
        this.leaderboard.updateConnection(this.driver.connectionStats);
        if (this.driver.onSelection && now - this.selectionTime >= 200) {
            this.selectionTime = now;
            const ids = [...this.view.selected].sort((a, b) => a - b), key = ids.join(',');
            if (key !== this.selectionSent) {
                this.selectionSent = key; this.driver.onSelection(ids);
            }
        }
        if (this.driver.result && !this.resultShown) {
            this.resultShown = true;
            this.view.audio.play(SHOCKWAVE);
            const objective = this.driver.core.nav.objective;
            const x = objective.x / Q, z = objective.z / Q;
            if (this.driver.result.outcome === 'defeat') {
                this.objectiveSelected = false;
                this.view.explodeObjective(x, z, objective.radius / Q, now / 1000);
            } else {
                const radius = Math.hypot(Math.max(x, this.world.width - x), Math.max(z, this.world.depth - z));
                this.view.effects.rings.push({ x, z, radius, born: now / 1000, life: 1.4, color: '#ffc36d' });
            }
        }
        this.view.draw(now, this.driver.renderTick, this.shift, this.driver.isPaused,
            (id, count) => this.orders.visiblePrefix(id, count));
        this.timeline.update();
        this.logicalPaths = [];
        const snapshot = this.view.snapshot?.defense;
        if (snapshot) {
            this.leaderboard.update(snapshot.economy);
            let count = 0, shots = 0;
            for (let id = 0; id < MAX_ENTITIES; id++) if (isLive(this.view.entity(id))) count++;
            for (let at = 0; at < snapshot.projectiles.length; at += RENDER_PROJECTILE_WORDS)
                if (snapshot.projectiles[at]) shots++;
            this.runtimeStats.entities = count; this.runtimeStats.projectiles = shots;
            this.updateSelection();
        }
        const ctx = this.view.overlay.getContext('2d'); if (!ctx) return;
        const bounds = this.camera.canvas.getBoundingClientRect();
        const outline = (cell: Cell, definition: number, alpha: number, ghost = false) => {
            const def = entities[definition], width = cell.rotation & 1 ? def.footprint.depth : def.footprint.width;
            const depth = cell.rotation & 1 ? def.footprint.width : def.footprint.depth;
            ctx.globalAlpha = alpha; ctx.strokeStyle = cell.valid ? '#398754' : '#bd4d43';
            ctx.fillStyle = cell.valid ? '#39875433' : '#bd4d4333'; ctx.beginPath();
            [[cell.x, cell.z], [cell.x + width, cell.z], [cell.x + width, cell.z + depth], [cell.x, cell.z + depth]]
                .forEach(([x, z], i) => {
                    const p = this.camera.project(x, z, 0.2 + (ghost ? 0 : (def.options.flightHeight ?? 0) / Q));
                    if (i === 0) ctx.moveTo(p.x - bounds.left, p.y - bounds.top);
                    else ctx.lineTo(p.x - bounds.left, p.y - bounds.top);
                });
            ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.globalAlpha = 1;
        };
        if (snapshot && this.driver.core.objectiveHealth)
            this.view.drawObjective(this.driver.core.nav.objective, this.driver.core.objectiveHealth,
                this.objectiveSelected);
        const due = new Map<number, number>();
        if (this.driver.result) this.sales.clear();
        ctx.save();
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.strokeStyle = '#341e11';
        ctx.lineWidth = 3;
        for (const [id, { generation, deadline }] of this.sales) {
            const row = this.view.entity(id);
            if (!this.owns(row) || row[E.flags] >>> 8 !== generation) {
                this.sales.delete(id); continue;
            }
            if (now >= deadline) {
                due.set(id, generation); continue;
            }
            const point = this.camera.project(row[E.x] / Q, row[E.z] / Q,
                1 + this.view.altitude(row, this.driver.renderTick));
            if (!point.visible) continue;
            ctx.fillStyle = Math.floor(now / 200) % 2 ? '#ff992e' : '#ffcd7d';
            const label = String(Math.ceil((deadline - now) / 1000));
            ctx.strokeText(label, point.x - bounds.left, point.y - bounds.top - 28);
            ctx.fillText(label, point.x - bounds.left, point.y - bounds.top - 28);
        }
        ctx.restore();
        this.sell(due);
        const confirmed = this.view.snapshot?.tick ?? 0;
        this.intents = this.intents.filter(command => !this.driver.hasApplied(command, confirmed));
        for (const ghost of this.ghosts()) {
            outline({ ...ghost, valid: true }, ghost.definition, 0.8, true);
            this.view.ghostIcon(ghost.definition, ghost.x + ghost.width / 2, ghost.z + ghost.depth / 2);
        }
        if (this.shift) for (let id = 0; id < MAX_ENTITIES; id++) {
            const entity = this.view.entity(id); if (!isLive(entity)) continue;
            const plan = this.orders.plans.get(id);
            const queuedOrigin = plan ? this.orders.queueOrigin(id, entity) : { x: entity[E.x], z: entity[E.z] };
            let origin = { x: queuedOrigin.x / Q, z: queuedOrigin.z / Q };
            let start = this.camera.project(origin.x, origin.z, 0.4);
            const logical = plan?.orders ?? [];
            const confirmedCount = plan && !plan.flights.some(flight => flight.replace)
                ? entity[E.orderCount] - this.orders.visiblePrefix(id, entity[E.orderCount]).length : 0;
            const first = plan ? Math.max(0, plan.cursor - plan.flights.length - confirmedCount) : 0;
            const route = logical.flatMap((order, segment) => {
                const label = order.waypoint ?? order.goal;
                const end = plan?.moveEnds[segment] ?? (segment === 0 ? plan?.points.length : undefined);
                if (end === undefined || end === 0) return [{ ...order, segment, label }];
                const offset = Math.max(first, plan?.moveEnds[segment - 1] ?? 0);
                return plan!.points.slice(offset, end).map((goal, index) => ({
                    ...order, goal, segment, label: offset + index + 1 === end ? label : undefined
                }));
            });
            let seconds = 0;
            route.forEach(order => {
                const segment = order.segment;
                const end = this.camera.project(order.goal.x / Q, order.goal.z / Q, 0.4);
                const goal = { x: order.goal.x / Q, z: order.goal.z / Q };
                this.view.orderLine(origin, goal,
                    order.kind === OrderType.Attack || order.kind === OrderType.AttackMove, now);
                seconds += Math.hypot(goal.x - origin.x, goal.z - origin.z) /
                    Math.max(0.01, (entities[entity[E.def]].options.speed ?? 0) / Q);
                if (order.kind === OrderType.Move && order.label)
                    this.view.orderETA(order.label.x / Q, order.label.z / Q, seconds);
                origin = goal;
                this.logicalPaths.push({ id, segment, x: end.x, y: end.y, sx: start.x, sy: start.y }); start = end;
            });
            let segments: Array<Command> = [];
            for (const command of this.intents) {
                if (!((command.blob?.[id >>> 5] ?? 0) & (1 << (id & 31)))) continue;
                if (command.type === CommandType.Order && !command.payload[3]) segments = [];
                if (command.type === CommandType.Order && command.payload[0] === OrderType.Stop) continue;
                segments.push(command);
            }
            for (const command of segments.slice(0, 8)) {
                const fire = command.type === CommandType.FireAt;
                const end = this.camera.project(command.payload[fire ? 0 : 1] / Q,
                    command.payload[fire ? 1 : 2] / Q, 0.4);
                const goal = { x: command.payload[fire ? 0 : 1] / Q, z: command.payload[fire ? 1 : 2] / Q };
                this.view.orderLine(origin, goal, fire || command.payload[0] === OrderType.AttackMove, now, 0.6);
                origin = goal; start = end;
            }
        }
        if (this.building !== undefined && this.pointer) {
            const point = this.camera.ground(this.pointer.x, this.pointer.y);
            if (point) {
                const cells = this.cells(this.drag?.ground ?? point, point, !!this.drag?.row, this.appendPlacement);
                for (const cell of cells) outline(cell, this.building, 1);
                const first = cells[0], definition = entities[this.building];
                if (first) this.view.rangePreview(this.building,
                    first.x + definition.footprint.width / 2, first.z + definition.footprint.depth / 2);
                const outside = first && definition.kind !== 6 && !inConstructionRange(
                    first.x + definition.footprint.width / 2, first.z + definition.footprint.depth / 2,
                    this.constructionCircles());
                ctx.fillStyle = '#30372f';
                ctx.fillText(outside ? 'Outside construction range' : `${cells.length}/${MAX_ROW}`,
                    this.pointer.x - bounds.left + 14, this.pointer.y - bounds.top - 12);
            }
        } else if (this.drag?.row && this.pointer) {
            ctx.fillStyle = '#377eaf30'; ctx.strokeStyle = '#286b9c'; ctx.lineWidth = 1;
            ctx.fillRect(this.drag.x - bounds.left, this.drag.y - bounds.top,
                this.pointer.x - this.drag.x, this.pointer.y - this.drag.y);
            ctx.strokeRect(this.drag.x - bounds.left, this.drag.y - bounds.top,
                this.pointer.x - this.drag.x, this.pointer.y - this.drag.y);
        }
    }
    destroy() {
        this.controller.abort(); this.driver.onSnapshot = undefined; this.orders.destroy();
        this.driver.onAnnotation = undefined; this.annotations?.destroy();
        this.timeline.destroy(); this.resources?.destroy(); this.camera.destroy();
        this.leaderboard.destroy(); this.view.destroy(); this.bar.destroy();
    }
}
