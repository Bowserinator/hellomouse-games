/** Lobby page: player list, ready state, invite link, color choice and match settings. */
import { copyInviteLink } from '../../shared/ts/copy-invite-link.js';
import { el } from '../../shared/ts/dom.js';
import { GAME_CONFIG, PLAYER_COLORS } from './config.js';
import type { Move, Sync } from './types.js';

const COPIED_LABEL_MILLISECONDS = 2000;
const UNKNOWN_COLOR = '#999';

function radioButton(text: string, value: string, onPick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.dataset.value = value;
    button.textContent = text;
    button.onclick = onPick;
    return button;
}

function buildGroup<T extends string | number>(
    container: HTMLElement, values: Array<T>, text: (value: T) => string, onPick: (value: T) => void
): Array<HTMLButtonElement> {
    const buttons = values.map(value => radioButton(text(value), String(value), () => onPick(value)));
    container.append(...buttons);
    return buttons;
}

function setChecked(buttons: Array<HTMLButtonElement>, checked: (value: string) => boolean, enabled: boolean): void {
    for (const button of buttons) {
        button.setAttribute('aria-checked', String(checked(button.dataset.value as string)));
        button.disabled = !enabled;
    }
}

export class Lobby {
    private roundButtons: Array<HTMLButtonElement>;
    private timerButtons: Array<HTMLButtonElement>;
    private colorButtons: Array<HTMLButtonElement>;

    constructor(send: (message: Record<string, unknown>) => void) {
        const move = (message: Move): void => send({ type: 'MOVE', ...message });
        this.roundButtons = buildGroup(el('rounds-option'), GAME_CONFIG.roundPresets,
            rounds => String(rounds), rounds => move({ action: 'SET_OPTIONS', rounds }));
        this.timerButtons = buildGroup(el('timer-option'), GAME_CONFIG.timerPresets,
            seconds => `${seconds}s`, timerSeconds => move({ action: 'SET_OPTIONS', timerSeconds }));
        this.colorButtons = buildGroup(el('color-picker'), PLAYER_COLORS,
            () => '', color => move({ action: 'SET_COLOR', color }));
        for (const button of this.colorButtons) {
            button.className = 'color-chip';
            button.style.setProperty('--chip-color', button.dataset.value as string);
            button.setAttribute('aria-label', `Color ${button.dataset.value}`);
        }
        el('ready').onclick = () => send({ type: 'READY' });
        el('start-game').onclick = () => move({ action: 'START_GAME' });
        el('new-room').onclick = () => location.assign(location.pathname);
        el('copy-invite').onclick = async () => {
            await copyInviteLink(el('invite-row'), el<HTMLInputElement>('invite').value);
            el('copy-invite').textContent = 'Copied ✓';
            setTimeout(() => {
                el('copy-invite').textContent = 'Copy invite';
            }, COPIED_LABEL_MILLISECONDS);
        };
        const input = el<HTMLInputElement>('username');
        input.value = localStorage.getItem('username') ?? '';
        el('username-form').onsubmit = event => {
            event.preventDefault();
            localStorage.setItem('username', input.value);
            send({ type: 'USERNAME', username: input.value });
        };
    }

    render(sync: Sync): void {
        const { settings, seats, youAre, isHost } = sync;
        el('players').replaceChildren(...seats.map((seat, index) => {
            const item = document.createElement('li');
            item.style.setProperty('--chip-color', seat.color || UNKNOWN_COLOR);
            item.textContent = `${seat.username}${index === youAre ? ' (you)' : ''} · ` +
                (index === 0 ? 'Host' : seat.ready ? 'Ready ✓' : 'Not ready');
            return item;
        }));
        el('username-form').hidden = youAre < 0;
        el('ready').hidden = youAre < 0 || isHost;
        el('ready').textContent = seats[youAre]?.ready ? 'Unready' : 'Ready';
        el('start-game').hidden = !isHost;

        const waiting = seats.filter((seat, index) => index !== 0 && !seat.ready).length;
        const missing = GAME_CONFIG.minimumPlayers - seats.length;
        el<HTMLButtonElement>('start-game').disabled = missing > 0 || waiting > 0;
        el('start-help').textContent = missing > 0 ? `Waiting for ${missing} more player${missing === 1 ? '' : 's'}.`
            : waiting ? `Waiting for ${waiting} player${waiting === 1 ? '' : 's'} to be ready.` : 'Everyone is ready.';

        setChecked(this.roundButtons, value => Number(value) === settings.rounds, isHost);
        setChecked(this.timerButtons, value => Number(value) === settings.timerSeconds, isHost);
        setChecked(this.colorButtons, value => seats[youAre]?.color === value, youAre >= 0);
        for (const button of this.colorButtons) {
            const takenBy = seats.findIndex(seat => seat.color === button.dataset.value);
            button.disabled = youAre < 0 || takenBy !== -1 && takenBy !== youAre;
        }
    }
}
