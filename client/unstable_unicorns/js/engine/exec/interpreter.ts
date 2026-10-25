import type { CardEvent, Effect, NodeId, OwnerRef } from '../dsl/ast.js';
import { holds } from '../dsl/cond.js';
import type { Binding, Frame } from '../state.js';
import { condCtx } from '../query/active.js';
import type { ExecCtx } from './context.js';
import { controllerOf, eventOf, popFrame, pushEffect, readCount, sourceOf, topFrame, worldOf } from './context.js';
import { runPrimitive } from './primitives.js';
import { ask, applyAnswer, rejectAnswer } from './prompt.js';

export type RunState = 'wait' | 'done';

const MAX_STEPS = 20000;
const SUCCESS = '__success';
const CHILD_SUCCESS = '__childSuccess';
const ALL_SUCCESS = '__allSuccess';
const STOP_ON_FAILURE = '__stopOnFailure';
const INHERITED = ['frameBy', 'frameSource', 'frameEvent', 'frameEventCard', 'frameEventPlayer', STOP_ON_FAILURE];

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

function finish(ex: ExecCtx, success: boolean) {
    const frame = topFrame(ex);
    if (!frame) return;
    frame.bindings[SUCCESS] = success;
    popFrame(ex);
    const parent = topFrame(ex);
    if (parent) {
        parent.bindings[CHILD_SUCCESS] = success;
        if (success === false) parent.bindings[ALL_SUCCESS] = false;
    }
}

export function step(ex: ExecCtx): 'ok' | 'wait' {
    const frame = topFrame(ex);
    if (!frame) return 'ok';
    const node = ex.nodes[frame.node];
    if (!node) throw new Error(`Unknown effect node ${frame.node}`);

    switch (node.e) {
        case 'seq': {
            if (frame.pc < node.steps.length) {
                if (frame.bindings[STOP_ON_FAILURE] === true && frame.bindings[CHILD_SUCCESS] === false) {
                    finish(ex, false);
                    return 'ok';
                }
                const next = node.steps[frame.pc];
                frame.pc++;
                pushEffect(ex, childId(next), inherit(frame));
            } else finish(ex, frame.bindings[ALL_SUCCESS] !== false);
            return 'ok';
        }
        case 'prim': {
            if (runPrimitive(ex, frame, node.prim) === 'wait') return 'wait';
            finish(ex, frame.bindings[SUCCESS] !== false);
            return 'ok';
        }
        case 'optional':
        case 'ifYouDo': {
            const key = `${frame.node}:yes`;
            if (frame.pc === 0) {
                const reason = node.e === 'optional' ? 'Use this effect?' : 'Pay the cost to use this effect?';
                const answer = askYesNo(ex, frame, key, reason);
                if (answer === 'wait') return 'wait';
                if (!answer) {
                    finish(ex, true);
                    return 'ok';
                }
                frame.pc = 1;
                if (node.e === 'ifYouDo') frame.bindings[STOP_ON_FAILURE] = true;
                pushEffect(ex, childId(node.effect), inherit(frame));
                return 'ok';
            }
            finish(ex, frame.bindings[CHILD_SUCCESS] !== false);
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
                        reason: 'Choose an effect',
                        source: sourceOf(frame),
                        min: 0,
                        max: node.options.length - 1
                    });
                frame.pc = 1;
                const chosen = node.options[index];
                if (chosen) pushEffect(ex, childId(chosen), inherit(frame));
                return 'ok';
            }
            finish(ex, frame.bindings[CHILD_SUCCESS] !== false);
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
                if (frame.bindings[STOP_ON_FAILURE] === true && frame.bindings[CHILD_SUCCESS] === false) {
                    finish(ex, false);
                    return 'ok';
                }
                frame.pc++;
                pushEffect(ex, childId(node.effect), { ...inherit(frame), frameBy: list[index] });
                return 'ok';
            }
            finish(ex, frame.bindings[ALL_SUCCESS] !== false);
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
                if (frame.bindings[STOP_ON_FAILURE] === true && frame.bindings[CHILD_SUCCESS] === false) {
                    finish(ex, false);
                    return 'ok';
                }
                frame.pc++;
                pushEffect(ex, childId(node.effect), inherit(frame));
                return 'ok';
            }
            finish(ex, frame.bindings[ALL_SUCCESS] !== false);
            return 'ok';
        }
        case 'when': {
            if (frame.pc === 0) {
                const ctx = condCtx(worldOf(ex), controllerOf(ex, frame), sourceOf(frame), eventOf(frame));
                if (!holds(node.cond, ctx)) {
                    finish(ex, true);
                    return 'ok';
                }
                frame.pc = 1;
                pushEffect(ex, childId(node.effect), inherit(frame));
                return 'ok';
            }
            finish(ex, frame.bindings[CHILD_SUCCESS] !== false);
            return 'ok';
        }
        default:
            finish(ex, true);
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

export function startEffect(ex: ExecCtx, node: NodeId, player: number, source: string, event?: string | CardEvent) {
    const bindings: Record<string, Binding> = { frameBy: player, frameSource: source };
    if (typeof event === 'string') bindings.frameEvent = event;
    else if (event) {
        bindings.frameEvent = event.type;
        if (event.card !== undefined) bindings.frameEventCard = event.card;
        if (event.player !== undefined) bindings.frameEventPlayer = event.player;
    }
    ex.state.exec.push({ node, pc: 0, bindings });
    return run(ex);
}
