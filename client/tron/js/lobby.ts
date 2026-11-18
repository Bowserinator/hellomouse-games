/** Lobby page: players, color, host settings, ready and start controls. */
import { copyInviteLink } from '../../shared/ts/copy-invite-link.js';
import { COLORS, MAP_SIZES, ROUND_OPTIONS, SPEED_MULTIPLIERS } from './config.js';
import type { Move, Settings, SyncMessage } from './types.js';

const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

export class Lobby {
    private colorButtons: Array<HTMLButtonElement> = [];
    private settingButtons: Array<[keyof Settings, HTMLButtonElement]> = [];

    constructor(private send: (message: Record<string, unknown>) => void) {
        const move = (message: Move): void => send({ type: 'MOVE', ...message });

        COLORS.forEach((color, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'swatch';
            button.style.backgroundColor = color;
            button.ariaLabel = `Color ${color}`;
            button.onclick = () => move({ action: 'COLOR', color: index });
            this.colorButtons.push(button);
            el('colors').appendChild(button);
        });

        this.addSetting('size', 'size-option', MAP_SIZES.map(String), move);
        this.addSetting('speed', 'speed-option', SPEED_MULTIPLIERS.map(value => `${value}x`), move);
        this.addSetting('rounds', 'rounds-option', ROUND_OPTIONS.map(String), move);

        el('ready').onclick = () => send({ type: 'READY' });
        el('start-game').onclick = () => move({ action: 'START' });

        const invite = el<HTMLInputElement>('invite');
        invite.value = location.href;
        invite.onclick = () => invite.select();
        el('copy-invite').onclick = () => copyInviteLink(el('invite-row'), invite.value);

        el('username-form').onsubmit = event => {
            event.preventDefault();
            send({ type: 'USERNAME', username: el<HTMLInputElement>('username').value });
        };
    }

    private addSetting(
        key: keyof Settings, containerId: string, labels: Array<string>, move: (message: Move) => void
    ) {
        labels.forEach((label, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.onclick = () => move({ action: 'SETTINGS', [key]: index });
            this.settingButtons.push([key, button]);
            el(containerId).appendChild(button);
        });
    }

    render(sync: SyncMessage) {
        const { seats, youAre, settings } = sync;
        const isHost = youAre === 0;

        el('players').replaceChildren(...seats.map((seat, index) => {
            const item = document.createElement('li');
            item.style.setProperty('--player-color', COLORS[seat.color]);
            item.textContent = `${seat.username}${index === youAre ? ' (you)' : ''}` +
                (index === 0 ? ' · Host' : seat.ready ? ' · Ready' : '');
            return item;
        }));

        const input = el<HTMLInputElement>('username');
        if (!input.value && seats[youAre]) input.value = seats[youAre].username;

        this.colorButtons.forEach((button, index) => {
            const takenByOther = seats.some((seat, seatIndex) => seat.color === index && seatIndex !== youAre);
            button.disabled = takenByOther;
            button.classList.toggle('selected', seats[youAre]?.color === index);
        });

        const counts = { size: 0, speed: 0, rounds: 0 };
        this.settingButtons.forEach(([key, button]) => {
            const index = counts[key as 'size' | 'speed' | 'rounds']++;
            button.classList.toggle('selected', settings[key] === index);
            button.disabled = !isHost;
        });

        el('ready').hidden = isHost;
        el('ready').textContent = seats[youAre]?.ready ? 'Unready' : 'Ready';
        el('start-game').hidden = !isHost;
        (el('start-game') as HTMLButtonElement).disabled =
            seats.length < 2 || !seats.every(seat => seat.ready);
    }
}
