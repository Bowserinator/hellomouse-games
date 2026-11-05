import { Tank } from './sim/tank.js';
import { GalaxySync } from './types.js';
import { MAX_PLAYERS, ROUND_ARRAY, TANK_COLORS, TANK_TEXT_COLORS } from './vars.js';
declare function copyToClipboard(text: string): boolean | string | null | undefined;
export const el = (id: string): HTMLElement => document.getElementById(id)!;
export class Lobby {
    private colors: Array<HTMLButtonElement> = [];
    private lastState = '';
    private rounds = Array.from(el('round-buttons').querySelectorAll('button'));
    constructor(private send: (data: Record<string, unknown>) => void) {
        TANK_COLORS.forEach((rgb, color) => {
            const b = document.createElement('button');
            b.className = 'color-button selectable-button';
            b.style.backgroundColor = `rgb(${rgb.join(',')})`;
            b.ariaLabel = `Tank color ${color + 1}`;
            b.onclick = () => send({ type: GalaxySync.CHANGE_COLOR, color });
            this.colors.push(b);
            el('color-buttons').appendChild(b);
        });
        this.rounds.forEach((b, round) => {
            b.onclick = () => send({ type: GalaxySync.CHANGE_ROUNDS, round });
        });
        const input = el('username') as HTMLInputElement;
        input.oninput = () => {
            input.value = input.value.replace(/[^a-zA-Z0-9_]/g, '');
            el('username-char-count').textContent = `(${input.value.length} / 16)`;
            const banner = el('disconnect-banner');
            if (banner.dataset.kind === 'username' && input.value !== banner.dataset.username) banner.hidden = true;
        };
        el('username-button').onclick = () => {
            if (input.value) {
                send({ type: 'USERNAME', username: input.value });
                localStorage.setItem('username', input.value);
            }
        };
        input.onkeydown = e => {
            if (e.key === 'Enter') el('username-button').click();
        };
        input.value = localStorage.getItem('username') ?? '';
        input.oninput(new Event('input'));
        el('start-game').onclick = () => send({ type: 'READY' });
        el('game-link').onclick = async () => {
            const text = el('link').textContent ?? '';
            let copied = false;
            try {
                await navigator.clipboard.writeText(text);
                copied = true;
            } catch {
                try {
                    const result = copyToClipboard(text);
                    copied = result !== false && result !== undefined;
                } catch {
                    copied = false;
                }
            }
            if (!copied) window.prompt('Copy invite link: Ctrl+C, Enter', text);
            el('game-link').classList.add('flash');
            setTimeout(() => el('game-link').classList.remove('flash'), 500);
        };
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') document.querySelectorAll<HTMLElement>('.modal-darken')
                .forEach(m => {
                    m.style.display = 'none';
                });
        });
    }
    update(tanks: Array<Tank>, own: number, inLobby: boolean, round: number, total: number): void {
        const banner = el('disconnect-banner');
        if (banner.dataset.kind === 'username' && (!inLobby ||
            tanks.find(t => t.id === own)?.username === (el('username') as HTMLInputElement).value)) banner.hidden = true;
        const state = JSON.stringify([own, inLobby, round, total,
            tanks.map(t => [t.id, t.ready, t.isDead, t.missingPlayer, t.color, t.username, t.score])]);
        if (state === this.lastState) return;
        this.lastState = state;
        el('lobby').style.display = inLobby ? 'block' : 'none';
        const self = tanks.find(t => t.id === own), host = tanks.find(t => !t.missingPlayer), isHost = self === host;
        const button = el('start-game') as HTMLButtonElement;
        const canJoin = inLobby && !self && tanks.length < MAX_PLAYERS;
        button.textContent = !self ? canJoin ? 'Join as player' : 'Spectating'
            : isHost ? 'Start Game!' : self.ready ? 'Unready' : 'Ready';
        button.onclick = () => this.send({ type: canJoin ? GalaxySync.JOIN_PLAYER : 'READY' });
        button.disabled = !self ? !canJoin
            : isHost && (tanks.length < 2 || !tanks.every(t => t.ready || t.missingPlayer));
        this.colors.forEach((b, color) => {
            const taken = tanks.some(t => t !== self && t.color === color);
            b.disabled = !self || taken;
            b.textContent = taken ? '⛔' : '';
            b.ariaLabel = `Tank color ${color + 1}${taken ? ' (unavailable)' : ''}`;
            b.classList.toggle('selected', self?.color === color);
        });
        this.rounds.forEach((b, i) => {
            b.disabled = !isHost;
            b.classList.toggle('selected', ROUND_ARRAY[i] === total);
        });
        el('round').textContent = `ROUND ${round} / ${total}`;
        el('scores').replaceChildren(...tanks.map(t => {
            const p = document.createElement('p');
            p.className = 'score';
            p.classList.toggle('dead', t.isDead || inLobby && !t.ready);
            p.classList.toggle('you', t.id === own);
            const name = document.createElement('span');
            name.className = 'username';
            name.textContent = `${t.username}${t.missingPlayer ? ' (left)' : inLobby && t.ready ? ' ✓' : ''}`;
            p.style.backgroundColor = `rgb(${TANK_COLORS[t.color]?.join(',')})`;
            p.style.color = TANK_TEXT_COLORS[t.color];
            name.style.backgroundColor = p.style.backgroundColor;
            const score = document.createElement('span');
            score.className = 'score-number';
            score.textContent = `${t.score}`;
            p.append(name, score);
            return p;
        }));
    }
    winner(scores: Array<[string, number]>): void {
        scores.sort((a, b) => b[1] - a[1]);
        const header = document.createElement('tr');
        for (const title of ['Rank', 'Player', 'Score']) {
            const th = document.createElement('th');
            th.textContent = title;
            header.appendChild(th);
        }
        let rank = 1, medal = 'first';
        el('leaderboard').replaceChildren(header, ...scores.map(([name, score], i) => {
            if (i && score !== scores[i - 1][1]) {
                rank++;
                medal = i < 3 ? ['', 'first', 'second', 'third'][rank] ?? '' : '';
            }
            const tr = document.createElement('tr');
            tr.className = medal;
            for (const value of [String(rank), name, String(score)]) {
                const td = document.createElement('td');
                td.textContent = value;
                tr.appendChild(td);
            }
            return tr;
        }));
        el('winner-modal').style.display = 'block';
    }
}
