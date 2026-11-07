import { isMatchSettingValid, lobbyMaximumPlayerCount, powerCentipercentMaximum, matchSettingIntegerRanges,
    matchSettingKeys, MatchSettings, teamNames, teamGlyphs, teamPrimaryColours, turretPitchQuantizationSteps,
    turretYawQuantizationSteps, timeOfDayNames,
    usernameMaximumLength, worldMapEdgeLengthOptionsInVoxels } from './config.js';
import { copyInviteLink } from '../../shared/ts/copy-invite-link.js';
import { radiansPerDegree } from './sim/math/deterministic-math.js';
import { decodePitch, decodeYaw, quantizePitch, quantizeYaw } from './sim/math/fixed-quantize.js';
import { Tank } from './sim/tank.js';
import { WeaponDefinition } from './sim/weapon-types.js';
import { LobbySeat, MatchPhase, PlayerPlan, PlayerStatistics } from './types.js';

export { teamNames } from './config.js';
export type UiAction = { type: 'send'; message: Record<string, unknown> } |
{ type: 'aim'; yaw: number; pitch: number; power: number } |
{ type: 'weapon'; identifier: string } | { type: 'cycleWeapon'; direction: number } |
{ type: 'drive'; mask: number; down: boolean } | { type: 'focusPlayer'; seatIndex: number } |
{ type: 'quality' | 'volume' | 'fog' | 'shake' | 'ao' | 'hitboxes' | 'practiceTime';
    value: string | number | boolean } |
{ type: 'lock' | 'projection' | 'xray' | 'unlockAudio' | 'practice' | 'practiceReset' | 'practiceExit' | 'recenter' | 'autoAim' };

interface ModalDialog extends HTMLDialogElement {
    showModal(): void;
}

function element<ElementType extends HTMLElement>(identifier: string): ElementType {
    const result = document.querySelector<ElementType>(`#${identifier}`);
    if (!result) throw new Error(`Missing Artillery control: ${identifier}`);
    return result;
}

const decimalPlaces = 3;
const powerDecimalPlaces = 2;
const unsignedDecimalPattern = new RegExp(`^\\d*\\.?\\d{0,${decimalPlaces}}$`);
const signedDecimalPattern = new RegExp(`^-?\\d*\\.?\\d{0,${decimalPlaces}}$`);
const powerPattern = new RegExp(`^\\d*\\.?\\d{0,${powerDecimalPlaces}}$`);
const centipercentPerPercent = powerCentipercentMaximum / 100;

function formatDecimal(value: number): string {
    return String(Number(value.toFixed(decimalPlaces)));
}

function bearingInDegrees(yawInRadians: number): number {
    return (360 - yawInRadians / radiansPerDegree) % 360;
}

function parseDecimal(text: string): number | null {
    return /\d/.test(text) ? Number(text) : null;
}

interface AimField {
    text: HTMLInputElement;
    range: HTMLInputElement;
    pattern: RegExp;
    lastValid: string;
    toStep(value: number): number;
    toText(step: number): string;
}

const settingLabels: Record<keyof MatchSettings, string> = {
    teamCount: 'Teams', hitPointsPerTank: 'Tank HP', weaponsPerPlayer: 'Weapons per player',
    movementTimePerTurnInSeconds: 'Drive time', planningTimeLimitInSeconds: 'Planning time',
    mapEdgeLengthInVoxels: 'Map size', timeOfDay: 'Time of day', isSandbox: 'Unlimited ammunition',
    isFriendlyFireEnabled: 'Enable friendly fire'
};

export class ArtilleryUI {
    readonly canvas = element<HTMLCanvasElement>('board');
    readonly tags = element('name-tags');
    readonly ping = element('ping');
    readonly disconnected = element('disconnect-banner');
    private readonly yaw = element<HTMLInputElement>('yaw');
    private readonly pitch = element<HTMLInputElement>('pitch');
    private readonly power = element<HTMLInputElement>('power');
    private readonly aimFields: ReadonlyArray<AimField>;
    private readonly username = element<HTMLInputElement>('username');
    private readonly settings = new Map<keyof MatchSettings, HTMLInputElement | HTMLSelectElement>();
    private seats: ReadonlyArray<LobbySeat> = [];
    private rosterState: string | null = null;
    private previousSolution = '';
    private readonly weaponButtons = new Map<string, HTMLButtonElement>();

    constructor(private readonly action: (action: UiAction) => void) {
        this.yaw.max = String(turretYawQuantizationSteps - 1);
        this.pitch.max = String(turretPitchQuantizationSteps - 1);
        this.username.maxLength = usernameMaximumLength;
        const maximumBearingInDegrees = 360 - 360 / turretYawQuantizationSteps;
        this.aimFields = [
            { text: element<HTMLInputElement>('yaw-value'), range: this.yaw, pattern: unsignedDecimalPattern,
                lastValid: '', toStep: value => quantizeYaw((360 - Math.min(value, maximumBearingInDegrees)) * radiansPerDegree),
                toText: step => formatDecimal(bearingInDegrees(decodeYaw(step))) },
            { text: element<HTMLInputElement>('pitch-value'), range: this.pitch, pattern: signedDecimalPattern,
                lastValid: '', toStep: value => quantizePitch(value * radiansPerDegree),
                toText: step => formatDecimal(decodePitch(step) / radiansPerDegree) },
            { text: element<HTMLInputElement>('power-value'), range: this.power, pattern: powerPattern,
                lastValid: '', toStep: value => Math.round(Math.max(0, Math.min(100, value)) * centipercentPerPercent),
                toText: step => formatDecimal(step / centipercentPerPercent) }
        ];
        for (const key of matchSettingKeys) {
            const label = document.createElement('label');
            label.textContent = settingLabels[key];
            const control = key === 'mapEdgeLengthInVoxels' || key === 'timeOfDay'
                ? document.createElement('select') : document.createElement('input');
            control.setAttribute('id', `rule-${key}`);
            if (control instanceof HTMLSelectElement && key === 'timeOfDay')
                timeOfDayNames.forEach((name, index) => control.add(new Option(name, String(index))));
            else if (control instanceof HTMLSelectElement)
                worldMapEdgeLengthOptionsInVoxels.forEach((size, index) =>
                    control.add(new Option(['Small', 'Medium', 'Large'][index], String(size))));
            else if (key === 'isSandbox' || key === 'isFriendlyFireEnabled') control.type = 'checkbox';
            else {
                control.type = 'number';
                const [minimum, maximum, increment] =
                    matchSettingIntegerRanges[key as keyof typeof matchSettingIntegerRanges];
                control.min = String(minimum); control.max = String(maximum); control.step = String(increment);
            }
            control.addEventListener('change', () => {
                const value = control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked
                    : Number(control.value);
                if (isMatchSettingValid(key, value)) action({ type: 'send', message: {
                    type: 'CHANGE_SETTING', setting: key, value } });
            });
            this.settings.set(key, control); label.append(control); element('match-settings').append(label);
        }
        const practiceTime = element<HTMLSelectElement>('practice-time');
        timeOfDayNames.forEach((name, index) => practiceTime.add(new Option(name, String(index))));
        practiceTime.addEventListener('change', () =>
            action({ type: 'practiceTime', value: Number(practiceTime.value) }));
        document.addEventListener('click', event => {
            const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-action]') : null;
            if (!target || target.disabled) return;
            const name = target.dataset.action;
            if (name === 'lock') this.commitAimFields();
            if (name === 'preferences' || name === 'help') element<ModalDialog>(`${name}-dialog`).showModal();
            else if (name === 'ready') action({ type: 'send', message: { type: 'READY' } });
            else if (name === 'lock' || name === 'projection' || name === 'xray' || name === 'practice' ||
                name === 'practiceReset' || name === 'practiceExit' || name === 'recenter' || name === 'autoAim')
                action({ type: name });
        });
        element('menu-toggle').addEventListener('click', () => {
            const button = element('menu-toggle'), expanded = button.getAttribute('aria-expanded') !== 'true';
            button.setAttribute('aria-expanded', String(expanded));
            element('nav-actions').classList.toggle('expanded', expanded);
        });
        this.username.addEventListener('input', () => {
            this.username.value = this.username.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, usernameMaximumLength);
            element('username-count').textContent = `${this.username.value.length} / ${usernameMaximumLength}`;
            this.notice('');
        });
        element('username-form').addEventListener('submit', event => {
            event.preventDefault();
            if (this.username.reportValidity()) action({ type: 'send', message: {
                type: 'USERNAME', username: this.username.value } });
        });
        for (const control of [this.yaw, this.pitch, this.power]) control.addEventListener('input', () => {
            this.updateDials(); action({ type: 'aim', yaw: Number(this.yaw.value),
                pitch: Number(this.pitch.value), power: Number(this.power.value) });
        });
        for (const field of this.aimFields) {
            field.text.addEventListener('input', () => {
                if (!field.pattern.test(field.text.value)) field.text.value = field.lastValid;
                field.lastValid = field.text.value;
                const value = parseDecimal(field.text.value);
                if (value === null) return;
                field.range.value = String(field.toStep(value));
                field.range.dispatchEvent(new Event('input'));
            });
            field.text.addEventListener('blur', () => this.commitAimField(field));
            field.text.addEventListener('keydown', event => {
                if (event.key === 'Enter') {
                    event.preventDefault(); field.text.blur();
                }
            });
        }
        for (const control of [this.yaw, this.pitch]) control.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || control.disabled) return;
            const change = (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1) *
                (control === this.yaw ? -1 : 1) * (event.shiftKey ? 10 : 1);
            const maximum = Number(control.max), value = Number(control.value) + change;
            control.value = String(control === this.yaw ? (value + maximum + 1) % (maximum + 1)
                : Math.max(0, Math.min(maximum, value)));
            control.dispatchEvent(new Event('input')); event.preventDefault();
        });
        for (const identifier of ['yaw', 'pitch']) {
            const dial = element(`${identifier}-dial`), input = identifier === 'yaw' ? this.yaw : this.pitch;
            const point = (event: PointerEvent): void => {
                if (input.disabled) return;
                const bounds = dial.querySelector('svg')?.getBoundingClientRect();
                if (!bounds) return;
                const x = event.clientX - bounds.left - bounds.width * (identifier === 'yaw' ? .5 : .2);
                const y = bounds.top + bounds.height * (identifier === 'yaw' ? .5 : .8) - event.clientY;
                input.value = String(identifier === 'yaw' ? quantizeYaw(-Math.atan2(x, y))
                    : quantizePitch(Math.atan2(y, x)));
                input.dispatchEvent(new Event('input')); event.preventDefault();
            };
            dial.addEventListener('pointerdown', event => {
                if (input.disabled || event.target instanceof Element && event.target.closest('.value-field')) return;
                dial.setPointerCapture(event.pointerId); input.focus(); point(event);
            });
            dial.addEventListener('pointermove', event => {
                if (dial.hasPointerCapture(event.pointerId)) point(event);
            });
            dial.addEventListener('pointerup', event => {
                if (dial.hasPointerCapture(event.pointerId)) dial.releasePointerCapture(event.pointerId);
            });
        }
        for (const name of ['quality', 'volume', 'fog', 'camera-shake', 'ambient-occlusion', 'show-hitboxes']) {
            const control = element<HTMLInputElement | HTMLSelectElement>(name);
            control.addEventListener('input', () => action({ type: name === 'camera-shake' ? 'shake'
                : name === 'ambient-occlusion' ? 'ao' : name === 'show-hitboxes' ? 'hitboxes'
                    : name === 'quality' ? 'quality' : name === 'fog' ? 'fog' : 'volume',
            value: control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked
                : name === 'volume' || name === 'fog' ? Number(control.value) / 100 : control.value }));
        }
        const link = element<HTMLInputElement>('room-link'), copyButton = element('invite-link');
        const copy = (): void => {
            link.focus(); link.select();
            void copyInviteLink(copyButton, link.value);
        };
        link.addEventListener('click', copy); copyButton.addEventListener('click', copy);
        this.updateDials();
    }

    setUsername(name: string): void {
        this.username.value = name.replace(/[^A-Za-z0-9_]/g, '').slice(0, usernameMaximumLength);
        element('username-count').textContent = `${this.username.value.length} / ${usernameMaximumLength}`;
    }
    setInviteLink(url: string): void {
        element<HTMLInputElement>('room-link').value = url;
    }
    notice(message: string): void {
        element('notice').textContent = message;
    }
    setMode(mode: 'lobby' | 'loading' | 'match'): void {
        element('lobby').hidden = mode !== 'lobby'; element('loading').hidden = mode !== 'loading';
        element('match-roster').hidden = mode !== 'match';
        element('view-controls').hidden = mode !== 'match';
        if (mode !== 'match') element('planning').hidden = true;
        document.body.dataset.mode = mode;
    }
    loading(stage: number, fraction: number, detail: string): void {
        element<HTMLProgressElement>('loading-progress').value = (stage + Math.max(0, Math.min(1, fraction))) / 4;
        element('loading-detail').textContent = detail;
        element('loading-heading').textContent = ['Building an island', 'Shaping the terrain',
            'Arming the crews', 'Warming up the view'][stage];
        element('loading-stages').querySelectorAll('li').forEach((item, index) => {
            item.classList.toggle('active', index === stage); item.classList.toggle('complete', index < stage);
        });
    }
    lobby(seats: ReadonlyArray<LobbySeat>, settings: MatchSettings, seatIndex: number,
        hostSeatIndex: number, canStart: boolean): void {
        this.seats = seats;
        const own = seats.find(seat => seat.seatIndex === seatIndex), host = seatIndex === hostSeatIndex;
        for (const [key, control] of this.settings) {
            if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = !!settings[key];
            else control.value = String(settings[key]);
            control.disabled = !host || key === 'weaponsPerPlayer' && settings.isSandbox;
        }
        const roster = element('roster'), teams = element('team-buttons');
        roster.style.setProperty('--team-count', String(settings.teamCount));
        teams.style.setProperty('--team-count', String(settings.teamCount));
        const headings = teamNames.slice(0, settings.teamCount).map((name, teamIndex) => {
            const heading = document.createElement('li');
            heading.className = 'roster__heading'; heading.textContent = `${teamGlyphs[teamIndex]} ${name}`;
            heading.style.setProperty('grid-column', String(teamIndex + 1));
            heading.style.setProperty('grid-row', '1');
            return heading;
        });
        roster.replaceChildren(...headings, ...seats.map(seat => {
            const row = document.createElement('li');
            row.style.setProperty('--team', `#${teamPrimaryColours[seat.teamIndex].toString(16).padStart(6, '0')}`);
            row.style.setProperty('grid-column', String(seat.teamIndex + 1));
            row.classList.toggle('roster__slot--own', seat.seatIndex === seatIndex);
            row.textContent = `${seat.username}${seat.seatIndex === seatIndex ? ' (you)' : ''}`;
            const status = document.createElement('small');
            status.textContent = seat.isMissing ? 'Missing' : seat.seatIndex === hostSeatIndex ? 'Host'
                : seat.isReady ? '✓ Ready' : 'Not ready';
            row.append(status); return row;
        }));
        element('team-buttons').replaceChildren(...teamNames.slice(0, settings.teamCount).map((name, teamIndex) => {
            const button = document.createElement('button');
            button.textContent = `Join ${name}`; button.setAttribute('aria-pressed', String(own?.teamIndex === teamIndex));
            button.disabled = !own || own.isReady && !host;
            button.onclick = () => this.action({ type: 'send', message: { type: 'CHANGE_TEAM', teamIndex } });
            return button;
        }));
        const ready = element<HTMLButtonElement>('ready-button');
        ready.textContent = host ? 'Start battle' : own?.isReady ? 'Unready' : 'Ready';
        ready.disabled = !own || host && !canStart;
        element('ready-help').textContent = `${seats.length} / ${lobbyMaximumPlayerCount} players · ` +
            (canStart ? 'All crews ready' : 'Every team needs a player and all crews must be ready');
        element('turn-banner').textContent = 'Assembling teams';
    }
    matchRoster(seats: ReadonlyArray<LobbySeat>, tanks: ReadonlyArray<Tank>,
        lockedSeats: ReadonlyArray<number>): void {
        this.seats = seats;
        const state = seats.map(seat => {
            const tank = tanks.find(candidate => candidate.seatIndex === seat.seatIndex);
            return [seat.seatIndex, seat.username, seat.teamIndex, seat.isMissing, tank?.isWreck,
                Math.ceil(tank?.hitPoints ?? 0), lockedSeats.includes(seat.seatIndex)].join(':');
        }).join('|');
        if (state === this.rosterState) return;
        this.rosterState = state;
        element('match-roster').replaceChildren(...seats.map(seat => {
            const tank = tanks.find(candidate => candidate.seatIndex === seat.seatIndex);
            const chip = document.createElement('button');
            chip.className = 'battle-roster__crew';
            chip.classList.toggle('battle-roster__crew--wreck', !!tank?.isWreck);
            chip.classList.toggle('battle-roster__crew--missing', seat.isMissing);
            chip.style.setProperty('--team', `#${teamPrimaryColours[seat.teamIndex].toString(16).padStart(6, '0')}`);
            chip.setAttribute('aria-label', `View ${seat.username}, ${teamNames[seat.teamIndex]}`);
            const name = document.createElement('span');
            name.className = 'battle-roster__name';
            name.textContent = seat.username + (lockedSeats.includes(seat.seatIndex) ? ' ✓' : '') +
                (seat.isMissing ? ' — missing' : '');
            const health = document.createElement('span'), bar = document.createElement('span');
            const hitPoints = Math.max(0, tank?.hitPoints ?? 0);
            const maximum = Math.max(1, hitPoints + (tank?.statistics.damageTaken ?? 0));
            const fraction = hitPoints / maximum;
            health.className = 'battle-roster__health';
            health.textContent = `${Math.ceil(hitPoints)} HP`;
            bar.className = 'battle-roster__bar';
            bar.classList.toggle('battle-roster__bar--low', fraction <= .25);
            bar.classList.toggle('battle-roster__bar--medium', fraction > .25 && fraction <= .5);
            bar.style.setProperty('--health', `${fraction * 100}%`);
            bar.setAttribute('role', 'progressbar');
            bar.setAttribute('aria-label', `${seat.username} health`);
            bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', String(maximum));
            bar.setAttribute('aria-valuenow', String(hitPoints));
            chip.append(name, health, bar);
            chip.onclick = () => this.action({ type: 'focusPlayer', seatIndex: seat.seatIndex });
            return chip;
        }));
    }
    /** Shows the player's most recently fired aim next to their hit points, or nothing when there is none. */
    setPreviousSolution(plan: PlayerPlan | null): void {
        if (plan === null) {
            this.previousSolution = '';
            return;
        }
        const bearing = formatDecimal(bearingInDegrees(decodeYaw(plan.turretYawQuantized)));
        const elevation = formatDecimal(decodePitch(plan.turretPitchQuantized) / radiansPerDegree);
        const power = formatDecimal(plan.powerCentipercent / centipercentPerPercent);
        this.previousSolution = `Prev: ${bearing}°, ${elevation}°, ${power}% · `;
    }
    planning(teamIndex: number, active: boolean, locked: boolean, tank: Tank | undefined,
        weapons: ReadonlyArray<WeaponDefinition>, selected: string | null, lockedSeats: ReadonlyArray<number>,
        phase: MatchPhase = 'PLANNING',
        describe: (weapon: WeaponDefinition) => string = weapon => weapon.description): void {
        element('planning').hidden = !active || !tank || tank.isWreck;
        let status = active ? '— plan your shot' : '— planning';
        if (phase === 'RESOLVING') status = '— shots away';
        else if (phase !== 'PLANNING') status = '— waiting for crews';
        element('turn-banner').textContent = `${teamNames[teamIndex]} ${status}`;
        element('lock-status').textContent = this.seats.filter(seat => seat.teamIndex === teamIndex).map(seat =>
            `${lockedSeats.includes(seat.seatIndex) ? '✓' : '○'} ${seat.username}`).join('  ');
        element('lock-button').textContent = locked ? 'Cancel' : 'FIRE';
        element<HTMLButtonElement>('auto-aim-button').disabled = locked || !active;
        if (!tank) return;
        this.yaw.value = String(tank.turretYawQuantized); this.pitch.value = String(tank.turretPitchQuantized);
        this.power.value = String(tank.powerCentipercent); this.updateDials();
        element('own-hit-points').textContent = `${this.previousSolution}${Math.ceil(tank.hitPoints)} HP`;
        for (const control of [this.yaw, this.pitch, this.power, ...this.aimFields.map(field => field.text)])
            control.disabled = locked || !active;
        const tray = element('weapon-tray');
        const buttons = weapons.filter(weapon => tank.ammunition.has(weapon.identifier)).map(weapon => {
            let button = this.weaponButtons.get(weapon.identifier);
            if (!button) {
                button = document.createElement('button');
                const image = document.createElement('img'), label = document.createElement('span');
                image.src = `img/weapons/${weapon.identifier}.png`; image.alt = ''; image.loading = 'lazy';
                label.textContent = weapon.displayName;
                const description = describe(weapon);
                button.title = description;
                button.append(image, label, document.createElement('small'));
                button.onclick = () => {
                    element('weapon-description').textContent = description;
                    this.action({ type: 'weapon', identifier: weapon.identifier });
                };
                this.weaponButtons.set(weapon.identifier, button);
            }
            const count = tank.ammunition.get(weapon.identifier) ?? 0;
            const ammo = button.querySelector('small')!;
            ammo.textContent = count === Infinity ? '∞' : `×${count}`;
            button.setAttribute('aria-pressed', String(selected === weapon.identifier));
            button.setAttribute('aria-label', `${weapon.displayName}, ${ammo.textContent}`);
            button.disabled = locked || !active || count === 0;
            return button;
        });
        if (tray.children.length !== buttons.length ||
            buttons.some((button, index) => tray.children[index] !== button)) {
            const scroll = tray.scrollTop;
            tray.replaceChildren(...buttons); tray.scrollTop = scroll;
        }
    }
    setPractice(enabled: boolean, timeOfDay?: number): void {
        element('practice-controls').hidden = !enabled;
        element('auto-aim-button').hidden = !enabled;
        if (timeOfDay !== undefined) element<HTMLSelectElement>('practice-time').value = String(timeOfDay);
    }
    showReconnect(): void {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = 'Rejoin room';
        button.onclick = () => location.reload();
        this.disconnected.replaceChildren(button); this.disconnected.hidden = false;
    }
    budget(remaining: number): void {
        element<HTMLProgressElement>('movement-budget').value = Math.max(0, remaining);
    }
    timer(fraction: number): void {
        const value = Math.max(0, Math.min(1, fraction));
        element('turn-timer').style.setProperty('--remaining', String(value));
        element('turn-timer').setAttribute('aria-valuenow', String(Math.round(value * 100)));
    }
    pressed(action: string, value: boolean): void {
        const button = document.querySelector(`[data-action="${action}"]`);
        button?.setAttribute('aria-pressed', String(value));
        if (action === 'projection') button?.querySelector('path')?.setAttribute('d', value
            ? 'M3 6H21V18H3Z' : 'M4 6 12 2 20 6V18L12 22 4 18ZM4 6 12 10 20 6M12 10V22');
    }
    results(winners: ReadonlyArray<number>, reason: string, statistics: ReadonlyArray<PlayerStatistics>): void {
        element('results-heading').textContent = winners.length ? `${winners.map(index => teamNames[index]).join(' + ')} wins`
            : 'Battle ended';
        reason = reason.toLowerCase();
        element('result-reason').textContent = reason === 'stalemate' ? 'No ammunition remains. Remaining team HP decides the result.'
            : reason === 'elimination' ? 'All opposing tanks were destroyed.' : 'The battle could not continue safely.';
        const table = document.createElement('table');
        const heading = document.createElement('tr');
        for (const title of ['Crew', 'Damage', 'Taken', 'Friendly fire', 'Shots']) {
            const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = title; heading.append(cell);
        }
        table.append(heading);
        for (const entry of statistics) {
            const row = document.createElement('tr');
            for (const value of [this.seats.find(seat => seat.seatIndex === entry.seatIndex)?.username ?? 'Missing crew',
                Math.round(entry.damageDealt), Math.round(entry.damageTaken), Math.round(entry.friendlyFireDamage),
                entry.shotsFired]) {
                const cell = document.createElement('td'); cell.textContent = String(value); row.append(cell);
            }
            table.append(row);
        }
        element('results').replaceChildren(table); element<ModalDialog>('results-dialog').showModal();
    }
    private commitAimFields(): void {
        for (const field of this.aimFields) this.commitAimField(field);
    }
    private commitAimField(field: AimField): void {
        const value = parseDecimal(field.text.value);
        if (value !== null && !field.text.disabled) {
            field.range.value = String(field.toStep(value));
            field.range.dispatchEvent(new Event('input'));
        }
        field.text.value = field.lastValid = field.toText(Number(field.range.value));
    }
    private updateDials(): void {
        const yaw = decodeYaw(Number(this.yaw.value)), pitch = decodePitch(Number(this.pitch.value));
        element('yaw-dial').style.setProperty('--angle', `${-yaw}rad`);
        element('pitch-dial').style.setProperty('--angle', `${-pitch}rad`);
        for (const field of this.aimFields) if (document.activeElement !== field.text)
            field.text.value = field.lastValid = field.toText(Number(field.range.value));
        this.yaw.setAttribute('aria-valuetext', `${formatDecimal(bearingInDegrees(yaw))} degrees`);
        this.pitch.setAttribute('aria-valuetext', `${formatDecimal(pitch / radiansPerDegree)} degrees`);
    }
}
