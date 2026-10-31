import { PACKS } from '../catalog/index.js';
import { config } from '../config.js';
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

function cardArt(kind: string, source?: string): HTMLElement {
    const art = document.createElement('span');
    art.className = 'card-art';
    const image = document.createElement('img');
    image.src = (source ?? artFor(kind)).replace('{{theme}}', config.theme);
    image.alt = '';
    art.append(image);
    return art;
}

function unicornTypeForKind(kind: string): string | undefined {
    if (kind === 'baby') return 'baby';
    if (kind === 'basic') return 'basic';
    return undefined;
}

function kindBadge(kind: string, unicornType?: string): HTMLElement {
    const badge = document.createElement('span');
    badge.className = 'card-kind';
    let subtype = 'Basic';
    if (unicornType === 'baby') subtype = 'Baby';
    else if (unicornType === 'special') subtype = 'Magical';
    badge.textContent = kind === 'basic' || kind === 'baby'
        ? `Unicorn (${subtype})` : ART[kind] ?? ART.unknown;
    return badge;
}

for (const pack of Object.values(PACKS))
    for (const entry of pack.cards) ENTRIES[entry.id] = entry;

export function cardEntry(defId: string): CatalogEntry | undefined {
    return ENTRIES[defId];
}

export function cardName(defId: string): string {
    if (defId === WILDCARD) return 'a face-down card';
    return ENTRIES[defId]?.name ?? 'an unknown card';
}

export function cardLabel(defId: string): string {
    const kind = ENTRIES[defId]?.kind;
    return kind === 'upgrade' || kind === 'downgrade' ? `${cardName(defId)} (${kind})` : cardName(defId);
}

export function cardFace(defId: string): HTMLElement {
    const face = document.createElement('div');
    face.className = 'card-face';

    if (defId === WILDCARD) {
        face.classList.add('down');
        face.append(cardArt('down'), kindBadge('down'));
        return face;
    }

    const entry = ENTRIES[defId];
    const kind = entry ? entry.kind : 'unknown';
    face.classList.add(kind);

    const name = document.createElement('span');
    name.className = 'card-name';
    name.textContent = entry?.name ?? '?';

    const text = document.createElement('span');
    text.className = 'card-text';
    text.textContent = entry ? entry.text : '';

    const description = document.createElement('div');
    description.className = 'card-description';
    description.append(kindBadge(kind, entry?.unicornType ?? unicornTypeForKind(kind)), text);

    face.append(name, cardArt(kind, entry?.image), description);
    return face;
}

export function cardSlot(iid: string, defId: string): HTMLElement {
    const slot = document.createElement('div');
    slot.className = 'card-slot';
    slot.dataset.iid = iid;
    slot.append(cardFace(defId));
    return slot;
}
