import type { CardDef, CatalogEntry } from './dsl/ast.js';
import { compileCard } from './dsl/compile.js';
import type { NodeMap } from './dsl/compile.js';
import { validateRegistry } from './dsl/validate.js';

export interface Registry {
    defs: Array<CardDef>;
    byId: Record<string, CardDef>;
    names: Record<string, string>;
    nodes: NodeMap;
    deckList: Array<string>;
}

export function buildRegistry(
    catalog: Array<CatalogEntry>,
    defs: Array<CardDef>,
    customs: Set<string>
): Registry {
    const issues = validateRegistry(defs, catalog, customs);
    if (issues.length) throw new Error(`Card registry is invalid:\n${issues.join('\n')}`);

    const nodes: NodeMap = {};
    const byId: Record<string, CardDef> = {};
    const names: Record<string, string> = {};
    for (const def of defs) {
        compileCard(def, nodes);
        byId[def.id] = def;
    }
    for (const entry of catalog) names[entry.id] = entry.name;

    const deckList: Array<string> = [];
    for (const entry of catalog)
        for (let i = 0; i < entry.copies; i++) deckList.push(entry.id);

    return { defs, byId, names, nodes, deckList };
}
