import type { CardDef, CardEvent, NodeId } from '../dsl/ast.js';
import type { NodeMap } from '../dsl/compile.js';
import type { EventLog } from '../events.js';
import type { Iid } from '../ids.js';
import type { Pending, Frame, GameState, Binding } from '../state.js';
import type { Rng } from '../rng.js';
import type { MoveCtx } from '../move.js';
import type { World } from '../query/modifiers.js';

export type CustomHandler = (ex: ExecCtx, frame: Frame) => void;

export class ImpossibleError extends Error {
    constructor() {
        super('Effect step has too few candidates');
    }
}

export interface ExecCtx {
    state: GameState;
    log: EventLog;
    rng: Rng;
    nodes: NodeMap;
    defOf(iid: Iid): CardDef | undefined;
    prompts: { n: number };
    custom: Record<string, CustomHandler>;
    sim?: boolean;
    queue(pending: Pending): void;
    deckOut?: () => void;
}

export function worldOf(ex: ExecCtx): World {
    return { state: ex.state, defOf: ex.defOf };
}

export function moveCtxOf(ex: ExecCtx): MoveCtx {
    return {
        ...worldOf(ex),
        log: ex.log,
        runReplacement: (player, source, effect) => {
            ex.queue({ source, player, effect: effect.id as NodeId });
        }
    };
}

export function controllerOf(ex: ExecCtx, frame: Frame): number {
    const by = frame.bindings.frameBy;
    return typeof by === 'number' ? by : ex.state.turn.player;
}

export function sourceOf(frame: Frame): Iid | null {
    const source = frame.bindings.frameSource;
    return typeof source === 'string' ? source : null;
}

export function eventOf(frame: Frame): CardEvent | undefined {
    const type = frame.bindings.frameEvent;
    return typeof type === 'string' ? { type: type as CardEvent['type'] } : undefined;
}

export function getBinding(frame: Frame, key: string): Binding | undefined {
    return frame.bindings[key];
}

export function pushEffect(ex: ExecCtx, node: NodeId, extra: Record<string, Binding> = {}) {
    ex.state.exec.push({ node, pc: 0, bindings: { ...extra } });
}

export function popFrame(ex: ExecCtx) {
    ex.state.exec.pop();
}

export function topFrame(ex: ExecCtx): Frame | null {
    const exec = ex.state.exec;
    return exec.length ? exec[exec.length - 1] : null;
}

export function readCount(value: number | { var: string }, frame: Frame, fallback = 0): number {
    if (typeof value === 'number') return value;
    const bound = frame.bindings[value.var];
    if (typeof bound === 'number') return bound;
    if (Array.isArray(bound)) return bound.length;
    return fallback;
}
