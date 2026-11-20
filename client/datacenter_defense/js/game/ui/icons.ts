import type { IconShape } from '../../sim/entity/registry.js';

export const ICON_PATHS: Record<IconShape, string> = {
    square: 'M5 5H19V19H5Z',
    direct: 'M18 12A6 6 0 1 1 6 12A6 6 0 1 1 18 12M18 12H23',
    artillery: 'M12 3L21 12L12 21L3 12Z',
    armor: 'M3 17L12 5L21 17L12 13ZM5 21H19',
    beam: 'M7 4H17L22 12L17 20H7L2 12Z',
    sonic: 'M22 12A10 10 0 1 1 2 12A10 10 0 1 1 22 12M14 12A2 2 0 1 1 10 12A2 2 0 1 1 14 12',
    mine: 'M15 12A3 3 0 1 1 9 12A3 3 0 1 1 15 12'
};
export const MOBILE_PATH = 'M6 8L12 2L18 8';

export function fontIcon(name: string): HTMLSpanElement {
    const icon = document.createElement('span'); icon.className = 'material-icons';
    icon.textContent = name; icon.setAttribute('aria-hidden', 'true'); return icon;
}

export function iconUrl(name: string, folder: 'build_icons' | 'map_icons' = 'build_icons'): string {
    return new URL(`../../../img/${folder}/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`, import.meta.url).href;
}
