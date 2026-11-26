import { SimDriver } from '../sim/driver.js';
import type { RenderSnapshot } from '../sim/core.js';
import { CommandType, OrderType, ORDER_WAYPOINT, ORDER_RECOVER, ORDER_TARGET_SHIFT,
    type Command } from '../sim/commands.js';
import { ENTITY as E, isLive, isActive, MAX_ORDERS, RENDER_ORDERS, RENDER_ENTITY_WORDS, zombieHp } from '../sim/layout.js';
import { entities, UNIT } from '../sim/entity/registry.js';
import { weapons } from '../sim/weapon/registry.js';
import { Q } from '../sim/fixed.js';
import { PathingClient } from './pathing-client.js';
import type { PathPoint, PathBody, PathStructure } from './pathing.js';

type Input = Omit<Command, 'player' | 'seq' | 'targetTick'>;
export type LogicalOrder = { kind: OrderType; goal: PathPoint; waypoint?: PathPoint; victim?: number };
type Flight = { command?: Command; replace: boolean; waypoint: boolean };
type Plan = { id: number; generation: number; version: number; orders: Array<LogicalOrder>; body: PathBody;
    points: Array<PathPoint>; cursor: number; flights: Array<Flight>; busy: boolean; started: boolean;
    append: boolean; lastPlan: number; stuck?: number; moveEnds: Array<number>; lookingAhead: boolean; };
export class UnitOrders {
    readonly plans = new Map<number, Plan>();
    onCommand?: (command: Command) => void;
    private pathing: PathingClient;
    private snapshot?: RenderSnapshot;
    private structures = new Map<number, PathStructure>();
    private outbox: Array<{ input: Input; plan?: Plan; version?: number; flight?: Flight;
        onSent?: (command: Command) => void; }> = [];
    private removals: Array<Command> = [];
    private frameCommands = 0;
    private destroyed = false;
    constructor(private driver: SimDriver, private notify: (message: string) => void) {
        const nav = driver.core.nav;
        this.pathing = new PathingClient(nav.columns, nav.rows, nav.costs, nav.airCosts);
    }
    private row(id: number) {
        return this.snapshot?.defense?.entities.subarray(id * RENDER_ENTITY_WORDS, (id + 1) * RENDER_ENTITY_WORDS);
    }
    submit(input: Input, onSent?: (command: Command) => void) {
        this.outbox.push({ input, onSent }); this.drain();
    }
    private mask(id: number) {
        const blob = new Array<number>(32).fill(0); blob[id >>> 5] = (1 << (id & 31)) >>> 0; return blob;
    }
    private drain() {
        while (this.outbox.length && this.frameCommands < 48 && this.driver.commandCapacity > 0) {
            const item = this.outbox.shift()!;
            if (item.plan && (this.plans.get(item.plan.id) !== item.plan || item.plan.version !== item.version))
                continue;
            try {
                const command = this.driver.submit(item.input); this.frameCommands++;
                if (command.type === CommandType.RemoveOrder) this.removals.push(command);
                this.onCommand?.(command);
                item.onSent?.(command);
                if (item.flight) item.flight.command = command;
            } catch (error) {
                if (item.plan) this.plans.delete(item.plan.id);
                this.notify(error instanceof Error ? error.message : String(error)); break;
            }
        }
    }
    cancel(ids: Iterable<number>) {
        for (const id of ids) this.plans.delete(id);
    }
    private spread(ids: Array<number>, kind: OrderType, goal: PathPoint) {
        const slots = new Map<number, PathPoint>();
        const units = ids.filter(id => {
            const row = this.row(id); return isLive(row) && entities[row[E.def]].kind === 2;
        });
        if (units.length < 2 || kind === OrderType.Attack) return slots;
        const rowOf = (id: number) => this.row(id)!;
        const gap = Math.max(...units.map(id => {
            const footprint = entities[rowOf(id)[E.def]].footprint; return Math.max(footprint.width, footprint.depth);
        })) + 1;
        const columns = Math.ceil(Math.sqrt(units.length)), rows = Math.ceil(units.length / columns);
        const centre = { x: units.reduce((sum, id) => sum + rowOf(id)[E.x], 0) / units.length,
            z: units.reduce((sum, id) => sum + rowOf(id)[E.z], 0) / units.length };
        const free = units.map((_, i) => ({ x: Math.round(goal.x + (i % columns - (columns - 1) / 2) * gap * Q),
            z: Math.round(goal.z + (Math.floor(i / columns) - (rows - 1) / 2) * gap * Q) }));
        free.sort((a, b) => Math.hypot(b.x - centre.x, b.z - centre.z) - Math.hypot(a.x - centre.x, a.z - centre.z));
        units.sort((a, b) => Math.hypot(rowOf(a)[E.x] - goal.x, rowOf(a)[E.z] - goal.z) -
            Math.hypot(rowOf(b)[E.x] - goal.x, rowOf(b)[E.z] - goal.z));
        units.forEach((id, i) => slots.set(id, free[i]));
        return slots;
    }
    order(ids: Iterable<number>, kind: OrderType, goal: PathPoint, append: boolean, victim?: number) {
        if (kind === OrderType.Assist) {
            if (victim === undefined) return;
            for (const id of ids) {
                const row = this.row(id);
                if (isActive(row) && entities[row[E.def]].options.buildPower)
                    this.submit({ type: CommandType.Order, payload: [kind, victim, 0, 0], blob: this.mask(id) });
            }
            return;
        }
        const requests: Array<Plan> = [], list = [...ids], slots = this.spread(list, kind, goal);
        for (const id of list) {
            const row = this.row(id); if (!isLive(row) || (!isActive(row) && kind !== OrderType.Move)) continue;
            const definition = entities[row[E.def]];
            if (definition.kind !== 2) {
                if (kind === OrderType.Attack && victim !== undefined && definition.weapons.length)
                    this.submit({ type: CommandType.Order, payload: [kind, victim, 0, Number(append)],
                        blob: this.mask(id) });
                continue;
            }
            const logical = { kind, goal: { ...(slots.get(id) ?? goal) }, waypoint: { ...goal }, victim };
            let plan = this.plans.get(id);
            if (append && plan) {
                if (plan.orders.length < MAX_ORDERS) {
                    plan.orders.push(logical);
                    this.lookAhead(plan);
                }
                continue;
            }
            const rotated = row[E.rotation] & 1;
            plan = { id, generation: row[E.flags] >>> 8, version: 0, orders: [logical],
                body: { width: (rotated ? definition.footprint.depth : definition.footprint.width) * 0.7,
                    depth: (rotated ? definition.footprint.width : definition.footprint.depth) * 0.7, locomotion: 1,
                    flightHeight: definition.options.flightHeight ?? 0 },
                points: [], cursor: 0, flights: [], busy: false, started: false, append, lastPlan: -20,
                moveEnds: [], lookingAhead: false };
            this.plans.set(id, plan); requests.push(plan);
        }
        this.request(requests, !append);
    }
    distribute(selected: Iterable<number>) {
        const ids = [...selected].filter(id => {
            const row = this.row(id); return isActive(row) && entities[row[E.def]].kind === 2;
        }).sort((a, b) => a - b);
        const goals: Array<PathPoint> = [], seen = new Set<string>();
        for (const id of ids) {
            const plan = this.plans.get(id), row = this.row(id)!;
            const orders: Array<LogicalOrder> = plan?.orders ??
                Array.from({ length: row[E.orderCount] }, (_, index) => ({
                    kind: row[RENDER_ORDERS + index * 4],
                    goal: { x: row[RENDER_ORDERS + 1 + index * 4], z: row[RENDER_ORDERS + 2 + index * 4] }
                }));
            for (const order of orders) {
                if (order.kind !== OrderType.Move) continue;
                const goal = order.waypoint ?? order.goal;
                const key = `${goal.x},${goal.z}`;
                if (!seen.has(key)) {
                    seen.add(key); goals.push({ ...goal });
                }
            }
        }
        if (!goals.length) return;
        let cursor = 0;
        ids.forEach((id, index) => {
            const count = goals.length < ids.length ? 1 : Math.floor(goals.length / ids.length) +
                Number(index < goals.length % ids.length);
            for (let segment = 0; segment < count; segment++) {
                const goal = goals.length < ids.length ? goals[index % goals.length] : goals[cursor++];
                this.order([id], OrderType.Move, goal, segment > 0);
            }
        });
    }
    visibleSegments(id: number, count: number) {
        const segments = Array.from({ length: count }, (_, index) => index);
        for (const input of this.removals)
            if (input.payload[0] === id) segments.splice(input.payload[1], 1);
        for (const { input } of this.outbox)
            if (input.type === CommandType.RemoveOrder && input.payload[0] === id)
                segments.splice(input.payload[1], 1);
        return segments;
    }
    visiblePrefix(id: number, count: number) {
        const segments = this.visibleSegments(id, count);
        const plan = this.plans.get(id);
        if (!plan) return segments;
        if (!plan.append) return [];
        return segments.slice(0, Math.max(0, segments.length - (plan.cursor - plan.flights.length)));
    }
    queueOrigin(id: number, row: Int32Array): PathPoint {
        const segment = this.visiblePrefix(id, row[E.orderCount]).at(-1);
        if (segment !== undefined) {
            const at = RENDER_ORDERS + segment * 4;
            if (row[at] !== OrderType.Attack) return { x: row[at + 1], z: row[at + 2] };
            const words = this.snapshot?.words, victim = row[at + 1] * 3;
            if (words && victim >= 0 && victim + 2 < words.length && zombieHp(words[victim + 2]))
                return { x: words[victim], z: words[victim + 1] };
        }
        return { x: row[E.x], z: row[E.z] };
    }
    remove(id: number, segment: number, fromSnapshot = false) {
        const row = this.row(id);
        if (!isLive(row) || row[E.rotation] >>> 2 !== this.driver.slot) return;
        const plan = this.plans.get(id);
        if (!plan || fromSnapshot) {
            this.submit({ type: CommandType.RemoveOrder, payload: [id, segment] });
            if (plan && !plan.started) this.request([plan], false);
            return;
        }
        const keepPrefix = plan.append && !plan.started;
        plan.orders.splice(segment, 1);
        if (!plan.orders.length) {
            this.plans.delete(id);
            if (!keepPrefix) this.submit({ type: CommandType.Order, payload: [4, 0, 0, 0], blob: this.mask(id) });
        } else if (segment === 0 || segment < plan.moveEnds.length || plan.lookingAhead)
            this.request([plan], !keepPrefix);
    }
    private request(plans: Array<Plan>, stop: boolean) {
        const groups = new Map<string, Array<Plan>>();
        const origins = new Map<number, PathPoint>();
        for (const plan of plans) {
            const row = this.row(plan.id); if (!isLive(row) || !plan.orders.length) continue;
            const logical = plan.orders[0];
            if (logical.kind === OrderType.Attack) {
                const words = this.snapshot?.words, victim = logical.victim ?? -1;
                if (!words || victim < 0 || victim * 3 + 2 >= words.length || !zombieHp(words[victim * 3 + 2])) {
                    plan.orders.shift(); plan.version++; plan.busy = false; plan.started = false; plan.points = [];
                    this.submit({ type: CommandType.Order, payload: [OrderType.Stop, 0, 0, 0],
                        blob: this.mask(plan.id) });
                    continue;
                }
                logical.goal = { x: words[victim * 3], z: words[victim * 3 + 1] };
            }
            plan.version++; plan.points = []; plan.cursor = 0; plan.flights = [];
            plan.moveEnds = []; plan.lookingAhead = false;
            plan.busy = true; plan.started = false; plan.lastPlan = this.snapshot?.tick ?? 0; plan.stuck = undefined;
            if (stop) {
                plan.append = false;
                this.submit({ type: CommandType.Order, payload: [4, 0, 0, 0], blob: this.mask(plan.id) });
            }
            const origin = this.queueOrigin(plan.id, row);
            origins.set(plan.id, origin);
            const key = `${origin.x / (4 * Q) | 0},${origin.z / (4 * Q) | 0},${plan.body.width},` +
                `${plan.body.depth},${plan.body.flightHeight ?? 0},${logical.goal.x},${logical.goal.z}`;
            const group = groups.get(key) ?? []; group.push(plan); groups.set(key, group);
        }
        const units: Array<PathStructure & { id: number }> = [];
        for (let id = 0; id < 1024; id++) {
            const row = this.row(id); if (!isLive(row)) continue;
            const definition = entities[row[E.def]]; if (definition.kind !== 2) continue;
            const rotated = row[E.rotation] & 1;
            units.push({ id, x: row[E.x], z: row[E.z],
                width: (rotated ? definition.footprint.depth : definition.footprint.width) * 0.7,
                depth: (rotated ? definition.footprint.width : definition.footprint.depth) * 0.7,
                flightHeight: definition.options.flightHeight ?? 0 });
        }
        for (const group of groups.values()) {
            const versions = group.map(plan => plan.version);
            const starts = group.map(plan => ({ id: plan.id, ...origins.get(plan.id)! }));
            void this.pathing.find(starts, group[0].orders[0].goal, group[0].body, units).then(paths => {
                if (this.destroyed) return;
                paths.forEach((result, index) => {
                    const plan = group[index];
                    if (this.plans.get(plan.id) !== plan || plan.version !== versions[index]) return;
                    plan.busy = false; plan.points = result.points;
                    if (!result.points.length) {
                        this.notify('No route to destination'); plan.orders.shift(); return;
                    }
                    if (plan.orders[0].kind === OrderType.Move) plan.moveEnds.push(plan.points.length);
                    this.fill(plan);
                    this.lookAhead(plan);
                });
                this.drain();
            }).catch(error => {
                if (this.destroyed) return;
                for (let index = 0; index < group.length; index++) {
                    const plan = group[index];
                    if (this.plans.get(plan.id) === plan && plan.version === versions[index])
                        this.plans.delete(plan.id);
                }
                this.notify(error instanceof Error ? error.message : String(error));
            });
        }
    }
    private lookAhead(plan: Plan) {
        const next = plan.orders[plan.moveEnds.length], start = plan.points[plan.points.length - 1];
        if (!plan.moveEnds.length || !start || next?.kind !== OrderType.Move || plan.lookingAhead) return;
        const version = plan.version;
        plan.lookingAhead = true;
        void this.pathing.find([{ id: plan.id, x: start.x, z: start.z }], next.goal, plan.body).then(([route]) => {
            if (this.plans.get(plan.id) !== plan || plan.version !== version) return;
            plan.lookingAhead = false;
            if (route?.points.length) {
                plan.points.push(...route.points);
                plan.moveEnds.push(plan.points.length);
                this.fill(plan); this.drain();
            } else {
                plan.orders.splice(plan.moveEnds.length, 1);
                this.notify('No route to destination');
            }
            this.lookAhead(plan);
        }).catch(error => {
            if (this.plans.get(plan.id) !== plan || plan.version !== version) return;
            plan.lookingAhead = false;
            this.notify(error instanceof Error ? error.message : String(error));
        });
    }
    private fill(plan: Plan) {
        const row = this.row(plan.id); if (!row || plan.busy || !plan.points.length) return;
        // Keep the new route editable while its starting waypoint can still change.
        if (this.driver.isPaused && plan.append && !plan.started &&
            this.visiblePrefix(plan.id, row[E.orderCount]).length) return;
        const logical = plan.orders[0];
        let occupied = !plan.started && !plan.append || plan.flights.some(flight => flight.replace)
            ? plan.flights.length : row[E.orderCount] + plan.flights.length;
        const total = plan.points.length + Number(logical.kind === OrderType.Attack);
        while (occupied < MAX_ORDERS && plan.cursor < total) {
            const first = !plan.started, replace = first && !plan.append;
            const attack = plan.cursor === plan.points.length;
            const point = plan.points[Math.min(plan.cursor, plan.points.length - 1)];
            const waypoint = plan.moveEnds.includes(plan.cursor + 1);
            const flags = 2 | Number(!replace) | (waypoint ? ORDER_WAYPOINT : 0) |
                (first && point.recover && !attack ? ORDER_RECOVER : 0) |
                (logical.kind === OrderType.Attack && !attack ? (logical.victim! + 1) << ORDER_TARGET_SHIFT : 0);
            const flight: Flight = { replace, waypoint }; plan.flights.push(flight);
            const kind = attack ? OrderType.Attack
                : (logical.kind === OrderType.AttackMove || logical.kind === OrderType.Attack
                    ? OrderType.AttackMove : OrderType.Move);
            this.outbox.push({ input: { type: CommandType.Order,
                payload: [kind, attack ? logical.victim! : point.x, attack ? 0 : point.z, flags],
                blob: this.mask(plan.id) }, plan, version: plan.version, flight });
            plan.cursor++; plan.started = true; occupied++;
        }
    }
    private inRange(row: Int32Array, victim?: number) {
        const words = this.snapshot?.words; if (!words) return false;
        const mounts = entities[row[E.def]].weapons;
        for (let at = 0; at < words.length; at += 3) {
            if (victim !== undefined && at !== victim * 3 || !zombieHp(words[at + 2])) continue;
            const distance = Math.hypot(words[at] - row[E.x], words[at + 1] - row[E.z]);
            if (mounts.some(mount => distance >= weapons[mount.definition].minRange &&
                distance <= weapons[mount.definition].maxRange)) return true;
        }
        return false;
    }
    accept(snapshot: RenderSnapshot) {
        this.snapshot = snapshot;
        this.removals = this.removals.filter(command => !this.driver.hasApplied(command, snapshot.tick));
        if (!snapshot.defense) return;
        const next = new Map<number, PathStructure>(), changed: Array<PathStructure> = [];
        for (let id = 0; id < 1024; id++) {
            const row = this.row(id); if (!isLive(row)) continue;
            const def = entities[row[E.def]]; if (def.kind === 2 || !def.pack()[UNIT.blocks]) continue;
            const rotated = row[E.rotation] & 1;
            const structure = { x: row[E.x], z: row[E.z],
                width: rotated ? def.footprint.depth : def.footprint.width,
                depth: rotated ? def.footprint.width : def.footprint.depth };
            next.set(id, structure);
            const old = this.structures.get(id);
            if (!old || old.x !== structure.x || old.z !== structure.z ||
                old.width !== structure.width || old.depth !== structure.depth) changed.push(structure);
        }
        for (const [id, old] of this.structures) if (!next.has(id)) changed.push(old);
        this.structures = next;
        if (changed.length) this.pathing.structures([...next.values()]);
        const replan: Array<Plan> = [];
        for (const plan of this.plans.values()) {
            const row = this.row(plan.id);
            if (!isLive(row) || row[E.flags] >>> 8 !== plan.generation || !plan.orders.length) {
                this.plans.delete(plan.id); continue;
            }
            plan.flights = plan.flights.filter(flight =>
                !flight.command || !this.driver.hasApplied(flight.command, snapshot.tick));
            if (row[E.state] === 2) {
                this.fill(plan); continue;
            }
            if (plan.moveEnds.length > 1 && !plan.flights.some(flight => flight.replace)) {
                let remaining = plan.moveEnds.filter(end => end > plan.cursor).length;
                remaining += plan.flights.filter(flight => flight.waypoint).length;
                const segments = this.visibleSegments(plan.id, row[E.orderCount]);
                const prefix = this.visiblePrefix(plan.id, row[E.orderCount]).length;
                for (const segment of segments.slice(prefix))
                    if (row[RENDER_ORDERS + segment * 4 + 3] & ORDER_WAYPOINT) remaining++;
                const reached = Math.min(plan.moveEnds.length - 1, plan.moveEnds.length - remaining);
                if (reached > 0) {
                    plan.moveEnds.splice(0, reached);
                    plan.orders.splice(0, reached);
                }
            }
            const logical = plan.orders[0];
            if (plan.started && !plan.busy && !plan.flights.length && plan.cursor >= plan.points.length +
                Number(logical.kind === OrderType.Attack) && !row[E.orderCount]) {
                plan.orders.shift();
                if (plan.orders.length) replan.push(plan);
                else this.plans.delete(plan.id);
                continue;
            }
            if (plan.busy) {
                if (changed.length) replan.push(plan);
                continue;
            }
            if (!plan.started && !plan.points.length) {
                replan.push(plan); continue;
            }
            const remaining = [{ x: row[E.x], z: row[E.z] }];
            for (let segment = 0; segment < row[E.orderCount]; segment++) {
                const at = RENDER_ORDERS + segment * 4;
                if (row[at] !== OrderType.Attack) remaining.push({ x: row[at + 1], z: row[at + 2] });
            }
            remaining.push(...plan.points.slice(plan.cursor));
            const intersects = changed.some(structure => remaining.some((point, index) => {
                if (!index) return false;
                const from = remaining[index - 1], marginX = (structure.width + plan.body.width) * Q / 2;
                const marginZ = (structure.depth + plan.body.depth) * Q / 2;
                return Math.max(from.x, point.x) >= structure.x - marginX &&
                    Math.min(from.x, point.x) <= structure.x + marginX &&
                    Math.max(from.z, point.z) >= structure.z - marginZ &&
                    Math.min(from.z, point.z) <= structure.z + marginZ;
            }));
            const fighting = row[E.speed] === 0 && row[E.orderCount] > 0 &&
                !entities[row[E.def]].options.fireOnMove &&
                (logical.kind === OrderType.Attack || logical.kind === OrderType.AttackMove) &&
                (row[E.flags] & 1) === 0 && this.inRange(row,
                logical.kind === OrderType.Attack ? logical.victim : undefined);
            if (row[E.speed] === 0 && row[E.orderCount] && !fighting) plan.stuck ??= snapshot.tick;
            else plan.stuck = undefined;
            const end = plan.points[plan.points.length - 1];
            if (logical.kind === OrderType.Move && plan.orders.length === 1 && end &&
                plan.cursor >= plan.points.length && plan.stuck !== undefined &&
                snapshot.tick - plan.stuck >= 40 && Math.hypot(row[E.x] - end.x, row[E.z] - end.z) <= 4 * Q) {
                this.plans.delete(plan.id);
                this.submit({ type: CommandType.Order, payload: [OrderType.Stop, 0, 0, 0], blob: this.mask(plan.id) });
                continue;
            }
            if (intersects || plan.stuck !== undefined && snapshot.tick - plan.stuck >= 40 ||
                logical.kind === OrderType.Attack && snapshot.tick - plan.lastPlan >= 20) replan.push(plan);
            else this.fill(plan);
        }
        this.request(replan, true); this.drain();
    }
    update() {
        this.frameCommands = 0; this.drain();
    }
    destroy() {
        this.destroyed = true; this.pathing.destroy(); this.plans.clear(); this.outbox.length = 0;
    }
}
