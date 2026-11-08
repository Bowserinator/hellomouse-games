/** Lobby page: player list, ready state, invite link, company choice and match settings. */
import { copyInviteLink } from '../../shared/ts/copy-invite-link.js';
import { companyIcon } from './company-icon.js';
import { COMPANY_THEMES, GAME_CONFIG, MONEY_MULTIPLIERS, estimatedMinutes } from './config.js';
import { formatNumber } from './format.js';
import type { Move, Sync } from './types.js';

const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const HINTS_KEY = 'phone_wars:hints';

export class Lobby {
    hintsEnabled = localStorage.getItem(HINTS_KEY) !== 'off';
    private targetButtons: Array<HTMLButtonElement> = [];
    private companyButtons: Array<HTMLButtonElement> = [];
    private moneyButtons: Array<HTMLButtonElement> = [];

    constructor(private send: (message: Record<string, unknown>) => void) {
        const move = (message: Move): void => send({ type: 'MOVE', ...message });
        GAME_CONFIG.targetPresets.forEach(target => {
            const button = document.createElement('button');
            button.type = 'button';
            button.setAttribute('role', 'radio');
            button.dataset.value = String(target);
            button.textContent = formatNumber(target);
            button.onclick = () => move({ action: 'SET_OPTIONS', target });
            this.targetButtons.push(button);
            el('target-option').appendChild(button);
        });
        MONEY_MULTIPLIERS.forEach(moneyMultiplier => {
            const button = document.createElement('button');
            button.type = 'button';
            button.setAttribute('role', 'radio');
            button.dataset.value = String(moneyMultiplier);
            button.textContent = `${moneyMultiplier}x`;
            button.onclick = () => move({ action: 'SET_OPTIONS', moneyMultiplier });
            this.moneyButtons.push(button);
            el('money-option').appendChild(button);
        });
        COMPANY_THEMES.forEach(theme => {
            const button = document.createElement('button');
            button.type = 'button';
            button.setAttribute('role', 'radio');
            button.className = 'company-chip';
            button.style.setProperty('--chip-color', theme.primary);
            button.dataset.value = theme.id;
            button.append(companyIcon(theme), theme.name);
            button.onclick = () => move({ action: 'SET_COMPANY', company: theme.id });
            this.companyButtons.push(button);
            el('company-picker').appendChild(button);
        });
        el('mode-option').querySelectorAll('button').forEach(button => {
            button.onclick = () => move({ action: 'SET_OPTIONS', mode: button.dataset.value as Move['mode'] });
        });
        el('hints-option').querySelectorAll('button').forEach(button => {
            button.onclick = () => {
                this.hintsEnabled = button.dataset.value === 'on';
                localStorage.setItem(HINTS_KEY, this.hintsEnabled ? 'on' : 'off');
                this.renderHints();
            };
        });
        el('ready').onclick = () => send({ type: 'READY' });
        el('start-game').onclick = () => move({ action: 'START_GAME' });
        el('new-room').onclick = () => location.assign(location.pathname);
        el('copy-invite').onclick = async () => {
            await copyInviteLink(el('invite-row'), el<HTMLInputElement>('invite').value);
            el('copy-invite').textContent = 'Copied ✓';
            setTimeout(() => {
                el('copy-invite').textContent = 'Copy invite';
            }, 2000);
        };
        const input = el<HTMLInputElement>('username');
        input.value = localStorage.getItem('username') ?? '';
        el('username-form').onsubmit = event => {
            event.preventDefault();
            localStorage.setItem('username', input.value);
            send({ type: 'USERNAME', username: input.value });
        };
        this.renderHints();
    }

    private renderHints(): void {
        el('hints-option').querySelectorAll('button').forEach(button => {
            button.setAttribute('aria-checked', String((button.dataset.value === 'on') === this.hintsEnabled));
        });
    }

    render(sync: Sync): void {
        const { settings, seats, youAre, isHost } = sync;
        el('players').replaceChildren(...seats.map((seat, index) => {
            const item = document.createElement('li');
            const theme = COMPANY_THEMES.find(candidate => candidate.id === seat.company);
            item.style.setProperty('--chip-color', theme?.primary ?? '#999');
            item.textContent = `${seat.username}${index === youAre ? ' (you)' : ''} · ${theme?.name ?? ''} · ` +
                (index === 0 ? 'Host' : seat.ready ? 'Ready ✓' : 'Not ready');
            return item;
        }));
        el('username-form').hidden = youAre < 0;
        el('ready').hidden = youAre < 0 || isHost;
        el('ready').textContent = seats[youAre]?.ready ? 'Unready' : 'Ready';
        el('start-game').hidden = !isHost;

        const minimum = settings.mode === 'peaceful' ? GAME_CONFIG.minimumPlayersPeaceful : GAME_CONFIG.minimumPlayers;
        const waiting = seats.filter((seat, index) => index !== 0 && !seat.ready).length;
        const ready = seats.length >= minimum && waiting === 0;
        (el('start-game') as HTMLButtonElement).disabled = !ready;
        el('start-help').textContent = seats.length < minimum ? `Waiting for ${minimum - seats.length} more player${minimum - seats.length === 1 ? '' : 's'}.`
            : waiting ? `Waiting for ${waiting} player${waiting === 1 ? '' : 's'} to be ready.` : 'Everyone is ready.';

        this.targetButtons.forEach(button => {
            button.setAttribute('aria-checked', String(Number(button.dataset.value) === settings.target));
            button.disabled = !isHost;
        });
        this.moneyButtons.forEach(button => {
            button.setAttribute('aria-checked', String(Number(button.dataset.value) === settings.moneyMultiplier));
            button.disabled = !isHost;
        });
        el('mode-option').querySelectorAll('button').forEach(button => {
            button.setAttribute('aria-checked', String(button.dataset.value === settings.mode));
            button.disabled = !isHost;
        });
        el('estimate').textContent = `Estimated match: ~${Math.round(estimatedMinutes(settings.target))} min • competitive play varies.`;
        this.companyButtons.forEach(button => {
            const takenBy = seats.findIndex(seat => seat.company === button.dataset.value);
            button.setAttribute('aria-checked', String(takenBy === youAre && takenBy !== -1));
            button.disabled = youAre < 0 || takenBy !== -1 && takenBy !== youAre;
        });
    }
}
