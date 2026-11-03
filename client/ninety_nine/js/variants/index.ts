import { STANDARD } from './standard.js';
import { ALTERNATE } from './alternate.js';
import { CHICAGO } from './chicago.js';
import { HAWAIIAN } from './hawaiian.js';
import { NEPAL } from './nepal.js';
import { TAIWANESE } from './taiwanese.js';
import { BALTIMORE } from './baltimore.js';
import { validateVariant } from './schema.js';
import { EFFECTS } from '../effects/index.js';
export const SHIPPED_TIERS = ['A', 'B'];
export const VARIANTS = [STANDARD, ALTERNATE, CHICAGO, HAWAIIAN, NEPAL, TAIWANESE, BALTIMORE]
    .filter(entry => SHIPPED_TIERS.includes(entry.tier));
const ids = new Set<string>();
for (const entry of VARIANTS) {
    if (ids.has(entry.id)) throw new Error(`Duplicate variant id: ${entry.id}`);
    ids.add(entry.id);
    validateVariant(entry, Object.keys(EFFECTS));
}
export const getVariant = (id: string) => VARIANTS.find(entry => entry.id === id);
