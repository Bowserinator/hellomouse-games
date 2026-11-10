/** Rules dialog opened from the lobby and the match screen. */
import { el } from '../../shared/ts/dom.js';
import type { NativeDialog } from '../../shared/ts/dom.js';

export function bindRules(): void {
    const dialog = el<NativeDialog>('rules-modal');
    for (const id of ['rules-open-lobby', 'rules-open-game']) el(id).onclick = () => dialog.showModal();
    el('rules-close').onclick = () => dialog.close();
}
