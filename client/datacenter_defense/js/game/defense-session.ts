import type * as T from 'three';
import type { World } from '../mapx.js';
import { SimDriver } from '../sim/driver.js';
import { CommandType, OrderType, MAX_ROW, OBJECTIVE_ASSIST_TARGET, type Command } from '../sim/commands.js';
import { ENTITY as E, ECONOMY as C, GHOST as G, GHOST_STRIDE, isLive, isActive, MAX_ENTITIES,
    RENDER_PROJECTILE_WORDS } from '../sim/layout.js';
import { entities } from '../sim/entity/registry.js';
import { Q } from '../sim/fixed.js';
import { RtsCamera } from './input/rts-camera.js';
import { DefenseView } from './defense-view.js';
import { UnitOrders } from './unit-orders.js';
import { CommandBar, type ControlAction } from './ui/command-bar.js';
import { TimelineHud } from './ui/timeline-hud.js';
import { ResourceBars } from './ui/resource-bars.js';
import { timeline } from '../sim/timeline.js';
import { BALANCE } from '../sim/balance.js';
import { inConstructionRange, type ConstructionCircle } from '../render/construction-overlay.js';

type Cell = { x: number; z: number; rotation: number; valid: boolean };
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
    private orders: UnitOrders;
    private timeline: TimelineHud;
    private resources?: ResourceBars;
    private objectiveSelected = false;
    private rejected = 0;
    private sales = new Map<number, { generation: number; deadline: number }>();
    private resultShown = false;
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
        if (!driver.core.unlimitedEconomy) this.resources = new ResourceBars(host);
        this.bar = new CommandBar(host);
        this.orders = new UnitOrders(driver, notify);
        this.orders.onCommand = command => {
            if (command.type === CommandType.FireAt) this.intents.push(command);
        };
        this.bar.onBuild = definition => {
            this.building = definition; this.action = undefined; this.bar.armed(definition);
            this.camera.panEnabled = false;
        };
        this.bar.onUpgrade = (tier, append) => {
            if (!this.objectiveSelected || this.driver.core.objectiveHealth <= 0) return;
            this.control('cancel');
            this.submit(CommandType.ObjectiveUpgrade, [tier, Number(append)]);
        };
        this.bar.onAction = action => this.control(action);
        this.bar.onPriority = (mode, low, high) => this.submit(CommandType.SetPriority, [mode, low, high], true);
        driver.onSnapshot = snapshot => {
            this.view.accept(snapshot); this.orders.accept(snapshot);
            const economy = snapshot.defense?.economy;
            if (economy) {
                this.resources?.update(economy);
                if (economy[C.rejected] > this.rejected) notify('Not enough resources');
                this.rejected = economy[C.rejected];
            }
            if (this.pointer) this.hover(this.pointer.x, this.pointer.y);
        };
        const canvas = this.camera.canvas, options = { signal: this.controller.signal };
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
            if (!isLive(clicked)) return;
            event.preventDefault(); this.drag = undefined;
            if (!(event.shiftKey || event.ctrlKey)) {
                this.view.selected.clear(); this.objectiveSelected = false;
            }
            const bounds = canvas.getBoundingClientRect();
            for (let id = 0; id < MAX_ENTITIES; id++) {
                const row = this.view.entity(id);
                if (!isLive(row) || row[E.def] !== clicked[E.def]) continue;
                const point = this.camera.project(row[E.x] / Q, row[E.z] / Q,
                    1 + this.view.altitude(row, this.driver.renderTick));
                if (point.visible && point.x >= bounds.left && point.x <= bounds.left + bounds.width &&
                    point.y >= bounds.top && point.y <= bounds.top + bounds.height) this.view.selected.add(id);
            }
            this.updateSelection();
        }, options);
        canvas.addEventListener('pointercancel', () => {
            this.drag = undefined;
        }, options);
        window.addEventListener('keydown', event => {
            this.shift = event.shiftKey || event.ctrlKey; this.appendPlacement = event.shiftKey;
            if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'g' &&
                !(event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable]'))) {
                event.preventDefault();
                if (!event.repeat) this.orders.distribute(this.view.selected);
            }
            if (event.ctrlKey && event.key.toLowerCase() === 'k' && this.view.selected.size &&
                !(event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable]'))) {
                event.preventDefault();
                if (!event.repeat && !this.driver.result) this.queueSale(event.shiftKey);
            }
            if (event.key === ' ') this.drag = undefined;
        }, options);
        window.addEventListener('keyup', event => {
            this.shift = event.shiftKey || event.ctrlKey; this.appendPlacement = event.shiftKey;
        }, options);
        window.addEventListener('blur', () => {
            this.shift = false; this.appendPlacement = false; this.drag = undefined;
        }, options);
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
    private get objectiveTier() {
        return this.driver.core.objectiveHealth > 0
            ? this.view.snapshot?.defense?.economy[C.objectiveTier] ?? 1 : 0;
    }
    private objectiveAssistBuilders(): Array<number> {
        const economy = this.view.snapshot?.defense?.economy;
        if (!this.objectiveTier || !economy || economy[C.upgradeTarget] <= this.objectiveTier) return [];
        const { x, z } = this.driver.core.nav.objective;
        return [...this.view.selected].filter(id => {
            const row = this.view.entity(id);
            if (!isActive(row)) return false;
            const radius = entities[row[E.def]].options.buildRadius;
            return !!radius && inConstructionRange(x / Q, z / Q, [{ x: row[E.x] / Q, z: row[E.z] / Q, radius }]);
        });
    }
    private assistBuilders(victim: Int32Array, target = -1): Array<number> {
        if (!isLive(victim)) return [];
        const building = victim[E.state] === 2;
        if (!building && victim[E.hp] >= entities[victim[E.def]].maxHp) return [];
        const result: Array<number> = [], x = victim[E.x] / Q, z = victim[E.z] / Q;
        const objective = this.driver.core.nav.objective;
        const radius = BALANCE.construction.objective;
        const tier = entities[victim[E.def]].tier;
        if (this.objectiveSelected && this.objectiveTier && (!building || this.objectiveTier >= tier) &&
            inConstructionRange(x, z, [{ x: objective.x / Q, z: objective.z / Q, radius }])) result.push(-1);
        for (const id of this.view.selected) {
            if (id === target) continue;
            const row = this.view.entity(id);
            if (!isActive(row)) continue;
            const def = entities[row[E.def]];
            if (!def.options.buildPower || building && def.tier < tier) continue;
            if (inConstructionRange(x, z, [{ x: row[E.x] / Q, z: row[E.z] / Q,
                radius: entities[row[E.def]].options.buildRadius ?? 0 }])) result.push(id);
        }
        return result;
    }
    private hover(x: number, y: number) {
        const target = this.view.hit(x, y), row = this.view.entity(target);
        const overObjective = !isLive(row) && this.overObjective(x, y);
        const assist = isLive(row) ? this.assistBuilders(row, target).length
            : overObjective && this.objectiveAssistBuilders().length;
        this.camera.canvas.style.cursor = assist ? 'copy' : '';
        if (isLive(row)) {
            this.bar.hover(entities[row[E.def]].name, row); return;
        }
        if (overObjective) {
            const name = this.world.objects.find(object => object.kind === 'objective')?.name ?? '';
            const nav = this.driver.core.nav;
            const clock = nav.winTick === undefined ? undefined
                : timeline(this.driver.core.tick, nav.firstWaveTick, nav.winTick);
            this.bar.hoverObjective(name, this.driver.core.objectiveHealth, this.driver.core.objectiveMaxHealth, clock);
        } else {
            const victim = this.view.zombie(x, y);
            if (victim >= 0 && this.view.snapshot) this.bar.hoverZombie(this.view.snapshot.words[victim * 3 + 2]);
            else this.bar.hover();
        }
    }
    private blob() {
        const words = new Array<number>(32).fill(0);
        for (const id of this.view.selected) words[id >>> 5] = (words[id >>> 5] | (1 << (id & 31))) >>> 0;
        return words;
    }
    private submit(type: CommandType, payload: Array<number>, selected = false) {
        if (selected && !this.view.selected.size && type !== CommandType.Place && type !== CommandType.PlaceRow) return;
        const input: Omit<Command, 'player' | 'seq' | 'targetTick'> = { type, payload };
        if (selected) input.blob = this.blob();
        this.orders.submit(input);
    }
    private queueSale(immediate: boolean) {
        const targets = new Map<number, number>();
        const deadline = performance.now() + 5000;
        for (const id of this.view.selected) {
            const row = this.view.entity(id);
            if (!isLive(row)) continue;
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
        if (action === 'sell') {
            const targets = new Map<number, number>();
            const groups = new Map<number, number>();
            for (const id of this.view.selected) {
                const row = this.view.entity(id); if (!isLive(row)) continue;
                targets.set(id, row[E.flags] >>> 8);
                groups.set(row[E.def], (groups.get(row[E.def]) ?? 0) + 1);
            }
            this.bar.confirmSale([...groups].map(([definition, count]) => ({ definition, count })), () => {
                for (const [id, generation] of targets) {
                    const row = this.view.entity(id);
                    if (!isLive(row) || row[E.flags] >>> 8 !== generation) targets.delete(id);
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
            if (this.objectiveSelected) {
                const hold = this.view.snapshot?.defense?.economy[C.objectiveHold] ?? 0;
                this.submit(CommandType.ObjectiveStance, [Number(!hold)]);
            }
        }

        this.action = ['move', 'attackMove', 'fire'].includes(action) ? action : undefined;
        this.camera.panEnabled = !this.action;
    }
    private* ghosts() {
        const words = this.view.snapshot?.defense?.ghosts;
        if (!words) return;
        for (let i = 0; i < words[0]; i++) {
            const at = 1 + i * GHOST_STRIDE;
            const definition = words[at + G.definition], rotation = words[at + G.rotation];
            const { width, depth } = entities[definition].footprint;
            yield { definition, rotation, source: words[at + G.source], x: words[at + G.x] / Q,
                z: words[at + G.z] / Q, width: rotation & 1 ? depth : width, depth: rotation & 1 ? width : depth };
        }
    }
    private right(event: PointerEvent) {
        const ground = this.camera.ground(event.clientX, event.clientY);
        if (ground && (event.shiftKey || event.ctrlKey))
            for (const ghost of this.ghosts()) {
                if (ghost.source !== this.driver.slot || ground.x < ghost.x || ground.z < ghost.z ||
                    ground.x >= ghost.x + ghost.width || ground.z >= ghost.z + ghost.depth) continue;
                this.submit(CommandType.RemoveGhost, [ghost.x * Q, ghost.z * Q]);
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
            }) ?? this.view.pathHit(event.clientX, event.clientY);
            if (segment) {
                this.orders.remove(segment.id, segment.segment); return;
            }
        }
        const target = this.view.hit(event.clientX, event.clientY);
        if (target >= 0) {
            const row = this.view.entity(target), builders = row ? this.assistBuilders(row, target) : [];
            if (builders.length) {
                this.orders.submit({ type: CommandType.Order, payload: [OrderType.Assist, target,
                    Number(builders.includes(-1)), 0], blob: this.blob() });
                this.view.targetFeedback(row![E.x] / Q, row![E.z] / Q, false);
            }
            return;
        }
        if (this.overObjective(event.clientX, event.clientY) && this.objectiveAssistBuilders().length) {
            this.submit(CommandType.Order, [OrderType.Assist, OBJECTIVE_ASSIST_TARGET, 0, 0], true);
            const { x, z } = this.driver.core.nav.objective;
            this.view.targetFeedback(x / Q, z / Q, false);
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
            const append = Number(event.shiftKey), objective = Number(this.objectiveSelected);
            const [cell] = this.cells(drag.ground, point, drag.row, !!append), definition = this.building;
            if (!cell?.valid) return;
            if (entities[definition].kind === 6 || !drag.row) {
                this.submit(CommandType.Place, [definition, cell.x * Q, cell.z * Q, 0, objective, append], true);
                if (entities[definition].kind === 6) this.view.targetFeedback(point.x, point.z, true);
            } else
                this.submit(CommandType.PlaceRow, [definition, cell.x * Q, cell.z * Q,
                    Math.max(0, Math.floor(point.x)) * Q, Math.max(0, Math.floor(point.z)) * Q,
                    objective, append], true);
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
        if (!(event.shiftKey || event.ctrlKey)) {
            this.view.selected.clear(); this.objectiveSelected = false;
        }
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) {
            const id = this.view.hit(event.clientX, event.clientY);
            if (id < 0 && this.overObjective(event.clientX, event.clientY))
                this.objectiveSelected = !this.objectiveSelected;
            if (id >= 0)
                if ((event.shiftKey || event.ctrlKey) && this.view.selected.has(id)) this.view.selected.delete(id);
                else this.view.selected.add(id);
        } else {
            const left = Math.min(drag.x, event.clientX), right = Math.max(drag.x, event.clientX);
            const top = Math.min(drag.y, event.clientY), bottom = Math.max(drag.y, event.clientY);
            const contains = ({ x, y, visible }: ReturnType<RtsCamera['project']>) =>
                visible && x >= left && x <= right && y >= top && y <= bottom;
            const { x, z } = this.driver.core.nav.objective;
            if (this.objectiveTier && contains(this.camera.project(x / Q, z / Q, 1))) this.objectiveSelected = true;
            for (let id = 0; id < MAX_ENTITIES; id++) {
                const row = this.view.entity(id); if (!isLive(row)) continue;
                const projected = this.camera.project(row[E.x] / Q, row[E.z] / Q,
                    1 + this.view.altitude(row, this.driver.renderTick));
                if (contains(projected)) this.view.selected.add(id);
            }
        }

        this.updateSelection();
    }
    constructionCircles(): Array<ConstructionCircle> {
        const tier = this.building === undefined ? 0 : entities[this.building].tier;
        const objective = this.driver.core.nav.objective;
        const objectiveCanBuild = this.objectiveTier && (!tier || this.objectiveSelected && this.objectiveTier >= tier);
        const circles: Array<ConstructionCircle> = objectiveCanBuild
            ? [{ x: objective.x / Q, z: objective.z / Q, radius: BALANCE.construction.objective }] : [];
        for (let id = 0; id < MAX_ENTITIES; id++) {
            if (tier && !this.view.selected.has(id)) continue;
            const row = this.view.entity(id);
            if (!isActive(row)) continue;
            const def = entities[row[E.def]], radius = def.options.buildRadius;
            if (radius && def.tier >= tier) circles.push({ x: row[E.x] / Q, z: row[E.z] / Q, radius });
        }
        return circles;
    }
    private updateSelection() {
        const rows = [...this.view.selected].map(id => this.view.entity(id)).filter(isLive);
        const first = this.view.selected.values().next().value;
        const economy = this.view.snapshot?.defense?.economy;
        const tier = this.objectiveTier;
        if (!tier) this.objectiveSelected = false;
        const objective = this.objectiveSelected ? {
            name: this.world.objects.find(object => object.kind === 'objective')?.name ?? '',
            hp: this.driver.core.objectiveHealth, tier, target: economy?.[C.upgradeTarget] ?? tier,
            progress: economy?.[C.upgradeProgress] ?? 0, held: !!economy?.[C.objectiveHold]
        } : undefined;
        if (this.building !== undefined) {
            const required = entities[this.building].tier;
            if (!(objective && objective.tier >= required) && !rows.some(row => isActive(row) &&
                entities[row[E.def]].options.buildPower && entities[row[E.def]].tier >= required)) this.control('cancel');
        }
        this.bar.selection(rows, first !== undefined && this.view.attacking.has(first), objective);
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
        const ghosts = [...this.ghosts()].filter(ghost => append || ghost.source !== this.driver.slot);
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
                if ((def.options.flightHeight ?? 0) !== flightHeight) continue;
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
        this.view.effects.shake(this.camera.camera, now / 1000); this.camera.camera.updateMatrixWorld();
        if (this.driver.onSelection && now - this.selectionTime >= 200) {
            this.selectionTime = now;
            const ids = [...this.view.selected].sort((a, b) => a - b), key = ids.join(',');
            if (key !== this.selectionSent) {
                this.selectionSent = key; this.driver.onSelection(ids);
            }
        }
        if (this.driver.result && !this.resultShown) {
            this.resultShown = true;
            const objective = this.driver.core.nav.objective;
            const x = objective.x / Q, z = objective.z / Q;
            const radius = Math.hypot(Math.max(x, this.world.width - x), Math.max(z, this.world.depth - z));
            this.view.effects.rings.push({ x, z, radius, born: now / 1000, life: 1.4, color: '#ffc36d' });
            if (this.driver.result.outcome === 'defeat') {
                this.objectiveSelected = false;
                this.view.explodeObjective(x, z, objective.radius / Q, now / 1000);
            }
        }
        this.view.draw(now, this.driver.renderTick, this.shift);
        this.timeline.update();
        this.logicalPaths = [];
        const snapshot = this.view.snapshot?.defense;
        if (snapshot) {
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
        if (snapshot && this.objectiveTier)
            this.view.drawObjective(this.driver.core.nav.objective, this.driver.core.objectiveHealth,
                this.objectiveSelected, this.driver.renderTick, this.driver.isPaused);
        const due = new Map<number, number>();
        if (this.driver.result) this.sales.clear();
        ctx.save();
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.strokeStyle = '#341e11';
        ctx.lineWidth = 3;
        for (const [id, { generation, deadline }] of this.sales) {
            const row = this.view.entity(id);
            if (!isLive(row) || row[E.flags] >>> 8 !== generation) {
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
        this.intents = this.intents.filter(command => command.targetTick >= confirmed);
        for (const ghost of this.ghosts()) {
            outline({ ...ghost, valid: true }, ghost.definition, 0.8, true);
            this.view.ghostIcon(ghost.definition, ghost.x + ghost.width / 2, ghost.z + ghost.depth / 2);
        }
        if (this.shift) for (let id = 0; id < MAX_ENTITIES; id++) {
            const entity = this.view.entity(id); if (!isLive(entity)) continue;
            let origin = { x: entity[E.x] / Q, z: entity[E.z] / Q };
            let start = this.camera.project(origin.x, origin.z, 0.4);
            const plan = this.orders.plans.get(id);
            const logical = plan?.orders ?? [];
            const remaining = plan?.points.slice(Math.max(0,
                plan.cursor - entity[E.orderCount] - plan.flights.length)) ?? [];
            const route = remaining.length && logical.length
                ? [...remaining.map((goal, index) => ({ ...logical[0], goal, segment: 0,
                    label: index === remaining.length - 1 ? logical[0].waypoint ?? logical[0].goal : undefined })),
                ...logical.slice(1).map((order, index) => ({ ...order, segment: index + 1,
                    label: order.waypoint ?? order.goal }))]
                : logical.map((order, segment) => ({ ...order, segment, label: order.waypoint ?? order.goal }));
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
        this.timeline.destroy(); this.resources?.destroy(); this.camera.destroy();
        this.view.destroy(); this.bar.destroy();
    }
}
