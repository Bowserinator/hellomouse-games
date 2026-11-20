import { PLAYER_COLORS, type Battlefield, type LobbyState } from './shared/protocol.js';

type MapDialog = HTMLDialogElement & { showModal(): void; close(): void };
const COLOR_NAMES = ['Blue', 'Green', 'Cyan', 'Light blue', 'Light green', 'Indigo', 'Teal', 'Turquoise'];

export class Lobby {
    slot = -1;
    private dialog?: MapDialog;
    constructor(private host: HTMLElement, readonly maps: Array<Battlefield>,
        private send: (message: Record<string, unknown>) => unknown) {}
    show(state: LobbyState) {
        this.dialog?.close();
        this.host.replaceChildren();
        const me = state.players.find(player => player.slot === this.slot);
        const players = document.createElement('table');
        players.className = 'lobby-players';
        const header = players.createTHead().insertRow();
        for (const title of ['Name', 'Color', 'Ready']) {
            const cell = document.createElement('th');
            cell.scope = 'col'; cell.textContent = title; header.append(cell);
        }
        const body = players.createTBody();
        for (const player of state.players) {
            const own = player.slot === this.slot;
            const row = body.insertRow();
            const name = document.createElement('input');
            name.setAttribute('aria-label', `${player.name}: name`);
            name.value = player.name; name.maxLength = 16; name.readOnly = !own;
            name.disabled = state.phase !== 'LOBBY';
            name.onchange = () => this.send({ type: 'USERNAME', username: name.value });
            row.insertCell().append(name);
            const colors = document.createElement('select');
            colors.setAttribute('aria-label', `${player.name}: color`);
            colors.disabled = !own || state.phase !== 'LOBBY';
            colors.style.color = PLAYER_COLORS[player.color];
            const others = state.players.filter(other => other.slot !== player.slot);
            const used = new Set(others.map(other => other.color));
            PLAYER_COLORS.forEach((color, index) => {
                const option = document.createElement('option');
                option.value = String(index); option.textContent = '██';
                option.setAttribute('aria-label', COLOR_NAMES[index]);
                option.style.color = color;
                option.style.setProperty('-webkit-text-fill-color', color);
                option.disabled = used.has(index) && used.size < PLAYER_COLORS.length && index !== player.color;
                colors.append(option);
            });
            colors.value = String(player.color);
            colors.onchange = () => this.send({ type: 'CHANGE_COLOR', color: Number(colors.value) });
            row.insertCell().append(colors);
            const ready = document.createElement('input');
            ready.type = 'checkbox'; ready.checked = player.ready;
            ready.setAttribute('aria-label', `${player.name}: ready`);
            ready.disabled = !own || player.slot === state.host || state.phase !== 'LOBBY';
            ready.onchange = () => this.send({ type: 'READY' });
            row.insertCell().append(ready);
        }
        this.host.append(players);
        const selected = this.maps.find(map => map.id === state.map);
        const mapColumn = document.createElement('div');
        mapColumn.className = 'lobby-battlefield';
        if (selected) mapColumn.append(this.mapCard(selected));
        if (this.slot === state.host) {
            const choose = document.createElement('button');
            choose.type = 'button'; choose.textContent = 'Select map';
            choose.disabled = state.phase !== 'LOBBY';
            choose.onclick = () => this.chooseMap(state.map);
            mapColumn.append(choose);
        }
        this.host.append(mapColumn);
        const start = document.getElementById('start') as HTMLButtonElement;
        start.disabled = this.slot !== state.host || state.phase !== 'LOBBY' || !me || !selected?.playable ||
            state.players.some(player => player.slot !== state.host && !player.ready);
        start.onclick = () => this.send({ type: 'START_GAME' });
    }
    private mapCard(map: Battlefield) {
        const card = document.createElement('figure');
        card.className = 'lobby-map';
        const caption = document.createElement('figcaption');
        const name = document.createElement('span'); name.textContent = map.name;
        const time = document.createElement('span');
        const minutes = Math.ceil(map.winTime / 60);
        time.textContent = `${String(Math.floor(minutes / 60)).padStart(2, '0')}h` +
            `${String(minutes % 60).padStart(2, '0')}m`;
        caption.append(name, time); card.append(caption);
        if (map.preview) {
            const image = document.createElement('img');
            image.src = `maps/${map.preview}`; image.alt = map.name;
            card.append(image);
        }
        return card;
    }
    private chooseMap(selected: string) {
        const dialog = document.createElement('dialog') as MapDialog;
        this.dialog = dialog; dialog.className = 'lobby-map-dialog';
        const title = document.createElement('h2'); title.textContent = 'Select map';
        title.id = 'map-picker-title'; dialog.setAttribute('aria-labelledby', title.id);
        const grid = document.createElement('div'); grid.className = 'lobby-map-grid';
        for (const map of this.maps) {
            const button = document.createElement('button');
            button.type = 'button'; button.disabled = !map.playable;
            button.setAttribute('aria-pressed', String(map.id === selected));
            button.append(this.mapCard(map));
            button.onclick = () => {
                this.send({ type: 'SELECT_MAP', map: map.id }); dialog.close();
            };
            grid.append(button);
        }
        const close = document.createElement('button');
        close.type = 'button'; close.textContent = 'Close'; close.onclick = () => dialog.close();
        dialog.append(title, grid, close);
        dialog.onclose = () => {
            dialog.remove();
            if (this.dialog === dialog) this.dialog = undefined;
        };
        this.host.append(dialog); dialog.showModal();
    }
}
