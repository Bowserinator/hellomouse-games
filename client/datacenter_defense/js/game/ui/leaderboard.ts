import { ECONOMY as C } from '../../sim/layout.js';
import { PLAYER_COLORS, type ConnectionStats, type LobbyPlayer } from '../../shared/protocol.js';
import { fontIcon } from './icons.js';
import { tutorialButton } from './tutorial.js';

export class Leaderboard {
    readonly element = document.createElement('div');
    private body = document.createElement('tbody');
    private connection = document.createElement('pre');
    private stats: ReadonlyArray<ConnectionStats> = [];
    private rows: Array<{
        slot: number; row: HTMLTableRowElement; cell: HTMLTableCellElement; kills: number; gift: HTMLButtonElement;
        countdown: Text;
    }>;
    private onKey = (event: KeyboardEvent) => {
        if (event.key !== 'F11') return;
        event.preventDefault();
        if (!event.repeat) {
            this.connection.hidden = !this.connection.hidden;
            this.renderConnection();
        }
    };

    constructor(host: HTMLElement, private players: ReadonlyArray<LobbyPlayer>, private localSlot: number,
        onGift?: (slot: number) => void) {
        this.element.className = 'defense-leaderboard';
        const table = document.createElement('table');
        table.setAttribute('aria-label', 'Leaderboard');
        const header = table.createTHead().insertRow();
        for (const title of ['Username', 'Kills', '']) {
            const column = document.createElement('th');
            column.scope = 'col'; column.textContent = title;
            header.append(column);
        }
        this.rows = players.map(player => {
            const row = this.body.insertRow();
            const icon = fontIcon('construction');
            icon.style.color = PLAYER_COLORS[player.color];
            const name = document.createElement('span');
            name.className = 'defense-player-name'; name.textContent = player.name;
            const countdown = document.createTextNode('');
            row.insertCell().append(icon, name, countdown);
            const cell = row.insertCell(); cell.textContent = '0';
            const gift = document.createElement('button');
            gift.type = 'button'; gift.className = 'defense-gift'; gift.disabled = true;
            gift.title = `Gift selected units to ${player.name}`;
            gift.setAttribute('aria-label', gift.title);
            gift.append(fontIcon('card_giftcard'));
            gift.onclick = () => onGift?.(player.slot);
            row.insertCell().append(gift);
            return { slot: player.slot, row, cell, kills: 0, gift, countdown };
        });
        table.append(this.body);
        this.element.append(table);
        tutorialButton(this.element);
        this.connection.className = 'defense-connection'; this.connection.hidden = true;
        this.element.append(this.connection);
        host.append(this.element);
        window.addEventListener('keydown', this.onKey);
    }

    setGiftEnabled(enabled: boolean) {
        for (const entry of this.rows) entry.gift.disabled = !enabled || entry.slot === this.localSlot ||
            entry.row.hidden || entry.row.classList.contains('defense-player-disconnected');
    }

    updateConnection(stats: ReadonlyArray<ConnectionStats>) {
        if (stats === this.stats) return;
        this.stats = stats;
        for (const entry of this.rows) {
            const status = stats.find(player => player.slot === entry.slot);
            const remaining = status?.reconnectMs;
            entry.row.hidden = !!status?.departed;
            entry.row.classList.toggle('defense-player-disconnected', remaining !== undefined);
            entry.countdown.data = remaining === undefined ? '' : ` (${Math.ceil(remaining / 1000)}s)`;
        }
        this.renderConnection();
    }

    private renderConnection() {
        if (this.connection.hidden) return;
        const line = (name: string, ping: string, tick: string, tps: string) =>
            `${name.padEnd(16)}  ${ping.padStart(7)}  ${tick.padStart(10)}  ${tps.padStart(6)}`;
        this.connection.textContent = [line('Player', 'Ping', 'Tick', 'TPS'), ...this.players.flatMap(player => {
            const stats = this.stats.find(entry => entry.slot === player.slot);
            if (stats?.departed) return [];
            return [line(player.name, stats?.ping === undefined ? '-' : `${stats.ping} ms`,
                String(stats?.tick ?? '-'), stats?.tps?.toFixed(1) ?? '-')];
        })].join('\n');
    }

    update(economy: Int32Array) {
        let changed = false;
        for (const entry of this.rows) {
            const kills = economy[C.kills + entry.slot] ?? 0;
            if (entry.kills === kills) continue;
            entry.kills = kills; entry.cell.textContent = kills.toLocaleString();
            changed = true;
        }
        if (changed) this.body.append(...this.rows.sort((a, b) => b.kills - a.kills || a.slot - b.slot)
            .map(entry => entry.row));
    }

    destroy() {
        window.removeEventListener('keydown', this.onKey);
        this.element.remove();
    }
}
