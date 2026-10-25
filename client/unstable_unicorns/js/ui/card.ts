import { PACKS } from '../catalog/index.js';
import { WILDCARD } from '../vars.js';
import type { CatalogEntry } from '../engine/dsl/ast.js';

const ENTRIES: Record<string, CatalogEntry> = {};

const ART: Record<string, string> = {
    baby: 'Baby',
    basic: 'Unicorn',
    magic: 'Magic',
    instant: 'Instant',
    upgrade: 'Upgrade',
    downgrade: 'Downgrade',
    unknown: 'Card',
    down: 'Hidden'
};

const KINDS = ['baby', 'basic', 'magic', 'instant', 'upgrade', 'downgrade', 'unknown', 'down'];

function artFor(kind: string): string {
    return `/unstable_unicorns/img/placeholders/${KINDS.includes(kind) ? kind : 'unknown'}.svg`;
}

function cardArt(kind: string): HTMLElement {
    const art = document.createElement('span');
    art.className = 'card-art';
    const image = document.createElement('img');
    image.src = artFor(kind);
    image.alt = '';
    art.append(image);
    return art;
}

function kindBadge(kind: string): HTMLElement {
    const badge = document.createElement('span');
    badge.className = 'card-kind';
    badge.textContent = ART[kind] ?? ART.unknown;
    return badge;
}

for (const pack of Object.values(PACKS))
    for (const entry of pack) ENTRIES[entry.id] = entry;

export function cardEntry(defId: string): CatalogEntry | undefined {
    return ENTRIES[defId];
}

export function cardName(defId: string): string {
    if (defId === WILDCARD) return 'a face-down card';
    return ENTRIES[defId]?.name ?? 'an unknown card';
}

export function cardFace(defId: string): HTMLElement {
    const face = document.createElement('div');
    face.className = 'card-face';

    if (defId === WILDCARD) {
        face.classList.add('down');
        face.append(kindBadge('down'), cardArt('down'));
        return face;
    }

    const entry = ENTRIES[defId];
    const kind = entry ? entry.kind : 'unknown';
    face.classList.add(kind);

    const name = document.createElement('span');
    name.className = 'card-name';
    name.textContent = entry ? entry.name : '?';

    const text = document.createElement('span');
    text.className = 'card-text';
    text.textContent = entry ? entry.text : '';

    face.append(kindBadge(kind), name, cardArt(kind), text);
    return face;
}

export function cardSlot(iid: string, defId: string): HTMLElement {
    const slot = document.createElement('div');
    slot.className = 'card-slot';
    slot.dataset.iid = iid;
    slot.append(cardFace(defId));
    return slot;
}
