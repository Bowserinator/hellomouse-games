import type { CatalogEntry } from '../engine/dsl/ast.js';
import { BASE_CATALOG } from './base.js';

export const PACKS: Record<string, Array<CatalogEntry>> = { base: BASE_CATALOG };

export const DEFAULT_PACK = 'base';

export function packNames(): Array<string> {
    return Object.keys(PACKS);
}

export function catalogFor(names: Array<string>): Array<CatalogEntry> {
    const out: Array<CatalogEntry> = [];
    for (const name of names) {
        const pack = PACKS[name];
        if (!pack) throw new Error(`Unknown card pack ${name}`);
        out.push(...pack);
    }
    return out;
}
