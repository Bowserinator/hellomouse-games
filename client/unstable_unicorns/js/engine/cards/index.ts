import type { CardDef } from '../dsl/ast.js';
import { UNICORN_DEFS } from './base/unicorns.js';
import { MAGIC_DEFS } from './base/magic.js';
import { STABLE_DEFS } from './base/stable.js';

export const BASE_DEFS: Array<CardDef> = [...UNICORN_DEFS, ...MAGIC_DEFS, ...STABLE_DEFS];

export const BASE_CUSTOMS: Set<string> = new Set();
