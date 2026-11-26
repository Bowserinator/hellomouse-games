import { BUILD_ORDER } from '../../sim/content/index.js';
import { entities } from '../../sim/entity/registry.js';
import { weapons } from '../../sim/weapon/registry.js';
import { projectiles } from '../../sim/projectile/registry.js';
import { Q } from '../../sim/fixed.js';
import { iconUrl } from './icons.js';

export function tutorialButton(host: HTMLElement) {
    const open = document.createElement('button');
    open.type = 'button'; open.className = 'defense-tutorial-link'; open.textContent = 'Tutorial';
    const dialog = document.createElement('dialog') as HTMLDialogElement & { showModal(): void; close(): void };
    dialog.className = 'defense-tutorial';
    const title = document.createElement('h2');
    title.id = 'defense-tutorial-title'; title.textContent = 'Tutorial';
    dialog.setAttribute('aria-labelledby', title.id);
    const close = document.createElement('button');
    close.type = 'button'; close.textContent = 'Close'; close.onclick = () => dialog.close();
    const header = document.createElement('header'); header.append(title, close);
    const contents = document.createElement('div'); contents.className = 'defense-tutorial__contents';
    const nav = document.createElement('nav'); nav.setAttribute('aria-label', 'Tutorial contents');
    const body = document.createElement('div'); body.className = 'defense-tutorial__body';
    contents.append(nav, body); dialog.append(header, contents);

    const intro = document.createElement('p');
    intro.textContent = 'Protect the defense objective from waves of zombies. Select a crane to build defenses, generators, and storage within its build range.';
    const keys = document.createElement('table');
    keys.className = 'defense-tutorial__keys';
    const shortcuts = keys.createTBody();
    for (const [key, action] of [
        ['Arrow keys', 'Pan the camera'], ['Space', 'Orbit the camera'],
        ['Q / W', 'Zoom in / out (hold Shift to zoom faster)'],
        ['Shift / Ctrl + drag', 'Add all units in the box to the selection'],
        ['A / S / Z', 'Attack move / stop / toggle hold fire or construction'],
        ['M', 'Right-click at the cursor'], ['F / C', 'Fire at / clear target'],
        ['Alt + .', 'Select an idle crane'], ['Ctrl + B', 'Select all cranes'],
        ['Ctrl + L', 'Select all attack units'], ['Ctrl + X', 'Select all units and buildings'],
        ['Ctrl + C', 'Select all units and buildings on screen'], ['Ctrl + .', 'Select all cranes on screen'],
        ['P', 'Target priority'], ['Delete', 'Sell selected units'],
        ['Ctrl + K / Ctrl + Shift + K', 'Toggle sale countdown / sell immediately'],
        ['F1–F3', 'Switch build tiers'], ['F5–F7', 'Map pings'],
        ['F8', 'Place a map marker at the cursor, even while paused'], ['Shift / Ctrl + drag marker', 'Move a map marker']
    ]) {
        const row = shortcuts.insertRow();
        const shortcut = document.createElement('code');
        shortcut.textContent = key; row.insertCell().append(shortcut);
        row.insertCell().textContent = action;
    }
    const units = document.createElement('div');
    const tiers = ['Tier I', 'Tier II', 'Tier III'].map(label => {
        const heading = document.createElement('h4'); heading.textContent = label;
        const list = document.createElement('ul'); list.className = 'defense-tutorial__units';
        units.append(heading, list);
        return list;
    });
    for (const id of BUILD_ORDER) {
        const unit = entities[id], { options } = unit;
        const details = [`${unit.maxHp.toLocaleString()} HP`];
        if (options.buildRadius) details.push(`${options.buildRadius} m build range`);
        if (options.speed) details.push(options.flightHeight ? 'Flying' : 'Mobile');
        for (const mount of unit.weapons) details.push(weapons[mount.definition].name);
        if (options.runoverDamage) details.push('Damages zombies on contact');
        if (options.pushSpeed) details.push(`Pushes zombies back within ${(options.radius ?? 0) / Q} m`);
        if (options.projectile !== undefined) {
            const projectile = projectiles[options.projectile];
            details.push(`${projectile.damage} damage · ${projectile.splashRadius / Q} m blast`);
        }
        if (options.income?.money) details.push(`${options.income.money} money/s`);
        if (options.income?.power) details.push(`${options.income.power} power/s`);
        if (options.storage?.money) details.push(`${options.storage.money} money storage`);
        if (options.storage?.power) details.push(`${options.storage.power} power storage`);
        const item = document.createElement('li'), icon = document.createElement('img');
        icon.src = iconUrl(unit.name); icon.alt = ''; icon.width = icon.height = 48; icon.loading = 'lazy';
        const name = document.createElement('strong'); name.textContent = unit.name;
        const description = document.createElement('div');
        description.append(name, document.createElement('br'), details.join(' · '));
        item.append(icon, description); tiers[unit.tier - 1].append(item);
    }

    for (const [label, content] of [['Intro', intro], ['Keyboard shortcuts', keys], ['Units', units]] as const) {
        const section = document.createElement('section'), heading = document.createElement('h3');
        heading.textContent = label; section.append(heading, content); body.append(section);
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        section.hidden = nav.childElementCount !== 0;
        button.setAttribute('aria-pressed', String(!section.hidden));
        button.onclick = () => {
            for (const sibling of body.children) (sibling as HTMLElement).hidden = sibling !== section;
            for (const sibling of nav.children) sibling.setAttribute('aria-pressed', String(sibling === button));
            body.scrollTop = 0;
        };
        nav.append(button);
    }
    dialog.addEventListener('keydown', event => event.stopPropagation());
    open.onclick = () => dialog.showModal();
    host.append(open, dialog);
}
