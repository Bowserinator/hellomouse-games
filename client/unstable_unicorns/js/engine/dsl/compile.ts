import type { CardDef, Effect, NodeId } from './ast.js';

export type NodeMap = Record<NodeId, Effect>;

function children(effect: Effect): Array<Effect> {
    switch (effect.e) {
        case 'seq': return effect.steps;
        case 'choice': return effect.options;
        case 'prim': return effect.prim.p === 'addLingering' ? [effect.prim.effect] : [];
        default: return [effect.effect];
    }
}

function assign(path: string, effect: Effect, nodes: NodeMap): NodeId {
    effect.id = path;
    nodes[path] = effect;
    children(effect).forEach((child, i) => assign(`${path}.${i}`, child, nodes));
    return path;
}

export function compileCard(def: CardDef, nodes: NodeMap) {
    if (def.onPlay) assign(`${def.id}#onPlay`, def.onPlay, nodes);
    (def.triggers ?? []).forEach((trigger, i) =>
        assign(`${def.id}#trigger${i}`, trigger.effect, nodes));
    (def.replacements ?? []).forEach((replacement, i) =>
        assign(`${def.id}#replace${i}`, replacement.effect, nodes));
}

export function resolveEffect(nodes: NodeMap, id: NodeId): Effect {
    const effect = nodes[id];
    if (!effect) throw new Error(`Unknown effect node ${id}`);
    return effect;
}
