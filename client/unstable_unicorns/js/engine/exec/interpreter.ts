import type { Effect, NodeId, OwnerRef } from '../dsl/ast.js';
import { holds } from '../dsl/cond.js';
import type { Binding, Frame } from '../state.js';
import { condCtx } from '../query/active.js';
import type { ExecCtx } from './context.js';
import { controllerOf, eventOf, popFrame, pushEffect, readCount, sourceOf, topFrame, worldOf } from './context.js';
import { runPrimitive } from './primitives.js';
import { ask, applyAnswer, rejectAnswer } from './prompt.js';

export type RunState = 'wait' | 'done';

const MAX_STEPS = 20000;
const INHERITED = ['frameBy', 'frameSource', 'frameEvent'];

function inherit(frame: Frame): Record<string, Binding> {
    const out: Record<string, Binding> = {};
    for (const key of INHERITED) {
        const value = frame.bindings[key];
        if (value !== undefined) out[key] = value;
    }
    return out;
}

function childId(effect: Effect): NodeId {
    if (!effect.id) throw new Error('Effect was not compiled');
    return effect.id;
}

function playersFor(ex: ExecCtx, frame: Frame, who: OwnerRef | undefined): Array<number> {
    const controller = controllerOf(ex, frame);
    const all = ex.state.players.map(p => p.id);
    if (who === 'active') return [ex.state.turn.player];
    if (who === 'other') return all.filter(id => id !== controller);
    if (who === 'any') return all;
    return [controller];
}

function askYesNo(ex: ExecCtx, frame: Frame, key: string, reason: string): boolean | 'wait' {
    const answer = frame.bindings[key];
    if (typeof answer === 'boolean') return answer;
    return ask(ex, frame, key, {
        player: controllerOf(ex, frame),
        kind: 'yesno',
        reason,
        source: sourceOf(frame)
    });
}

export function step(ex: ExecCtx): 'ok' | 'wait' {
    const frame = topFrame(ex);
    if (!frame) return 'ok';
    const node = ex.nodes[frame.node];
    if (!node) throw new Error(`Unknown effect node ${frame.node}`);

    switch (node.e) {
        case 'seq': {
            if (frame.pc < node.steps.length) {
                const next = node.steps[frame.pc];
                frame.pc++;
                pushEffect(ex, childId(next), inherit(frame));
            } else popFrame(ex);
            return 'ok';
        }
        case 'prim': {
            if (runPrimitive(ex, frame, node.prim) === 'wait') return 'wait';
            popFrame(ex);
            return 'ok';
        }
        case 'optional':
        case 'ifYouDo': {
            const key = `${frame.node}:yes`;
            if (frame.pc === 0) {
                const answer = askYesNo(ex, frame, key, node.e);
                if (answer === 'wait') return 'wait';
                if (!answer) {
                    popFrame(ex);
                    return 'ok';
                }
                frame.pc = 1;
                pushEffect(ex, childId(node.effect), inherit(frame));
                return 'ok';
            }
            popFrame(ex);
            return 'ok';
        }
        case 'choice': {
            const key = `${frame.node}:pick`;
            if (frame.pc === 0) {
                const stored = frame.bindings[key];
                const index = typeof stored === 'number' ? stored : null;
                if (index === null)
                    return ask(ex, frame, key, {
                        player: controllerOf(ex, frame),
                        kind: 'option',
                        reason: 'choice',
                        source: sourceOf(frame),
                        min: 0,
                        max: node.options.length - 1
                    });
                frame.pc = 1;
                const chosen = node.options[index];
                if (chosen) pushEffect(ex, childId(chosen), inherit(frame));
                return 'ok';
            }
            popFrame(ex);
            return 'ok';
        }
        case 'forEachPlayer': {
            const listKey = `${frame.node}:list`;
            if (frame.pc === 0) {
                frame.bindings[listKey] = playersFor(ex, frame, node.who) as Array<number>;
                frame.pc = 1;
                return 'ok';
            }
            const list = frame.bindings[listKey] as Array<number>;
            const index = frame.pc - 1;
            if (index < list.length) {
                frame.pc++;
                pushEffect(ex, childId(node.effect), { ...inherit(frame), frameBy: list[index] });
                return 'ok';
            }
            popFrame(ex);
            return 'ok';
        }
        case 'repeat': {
            const key = `${frame.node}:n`;
            if (frame.pc === 0) {
                frame.bindings[key] = readCount(node.count as number | { var: string }, frame);
                frame.pc = 1;
                return 'ok';
            }
            const times = frame.bindings[key] as number;
            if (frame.pc <= times) {
                frame.pc++;
                pushEffect(ex, childId(node.effect), inherit(frame));
                return 'ok';
            }
            popFrame(ex);
            return 'ok';
        }
        case 'when': {
            if (frame.pc === 0) {
                const ctx = condCtx(worldOf(ex), controllerOf(ex, frame), sourceOf(frame), eventOf(frame));
                if (!holds(node.cond, ctx)) {
                    popFrame(ex);
                    return 'ok';
                }
                frame.pc = 1;
                pushEffect(ex, childId(node.effect), inherit(frame));
                return 'ok';
            }
            popFrame(ex);
            return 'ok';
        }
        default:
            popFrame(ex);
            return 'ok';
    }
}

export function run(ex: ExecCtx): RunState {
    for (let i = 0; i < MAX_STEPS; i++) {
        if (ex.state.prompt) return 'wait';
        if (ex.state.exec.length === 0) return 'done';
        if (step(ex) === 'wait') return 'wait';
    }
    throw new Error('Interpreter made no progress');
}

export function respond(ex: ExecCtx, answer: Binding): { error: string } | { state: RunState } {
    const problem = rejectAnswer(ex.state, answer);
    if (problem) return { error: problem };
    applyAnswer(ex.state, answer);
    return { state: run(ex) };
}

export function startEffect(ex: ExecCtx, node: NodeId, player: number, source: string, event?: string) {
    const bindings: Record<string, Binding> = { frameBy: player, frameSource: source };
    if (event) bindings.frameEvent = event;
    ex.state.exec.push({ node, pc: 0, bindings });
    return run(ex);
}
