import { MAX_WAVE_SCALE, type Wave, type World } from '../mapx.js';
import { VARIANTS } from '../sim/variants.js';

export function formatTime(seconds: number) {
    const s = Math.max(0, Math.ceil(seconds));
    return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
        : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function parseTime(text: string) {
    if (!/^\d+(?::[0-5]\d){1,2}$/.test(text)) throw Error('Use m:ss or h:mm:ss');
    const seconds = text.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
    if (seconds > 86400) throw Error('Time must not exceed 24 hours');
    return seconds;
}
export function moveWave(list: Array<Wave>, from: number, to: number): Array<Wave> {
    if (![from, to].every(i => Number.isInteger(i) && i >= 0 && i < list.length)) throw Error('Invalid wave position');
    const compositions = list.map(wave => ({ ...wave, counts: { ...wave.counts } }));
    compositions.splice(to, 0, compositions.splice(from, 1)[0]);
    return list.map((wave, i) => ({ ...compositions[i], time: wave.time }));
}
export function waveSummary(world: World) {
    const waves = Object.values(world.rules?.waves ?? {}).flat();
    return { first: waves.length ? Math.min(...waves.map(w => w.time)) : undefined,
        total: waves.reduce((sum, wave) => sum + Object.values(wave.counts).reduce((a, b) => a + b, 0), 0) };
}
export function waveEditor(host: HTMLFormElement, world: World, spawn: string, refresh: () => void) {
    const list = document.createElement('div');
    list.className = 'wave-list';
    const table = document.createElement('table');
    const header = table.createTHead().insertRow();
    const scales = [['hpScale', 'HP scale', '0.01'], ['damageScale', 'Damage scale', '0']] as const;
    for (const label of ['', 'Time', ...scales.map(([, title]) => title), ...VARIANTS.map(variant => variant.name), 'Total', 'Actions']) {
        const column = document.createElement('th');
        column.scope = 'col';
        column.textContent = label;
        header.append(column);
    }
    const body = table.createTBody();
    list.append(table);
    const waves = world.rules?.waves[spawn] ?? [];
    const change = (action: () => void) => {
        if (!host.reportValidity()) return;
        world.rules ??= { winTime: 720, waves: {} };
        world.rules.waves[spawn] ??= [];
        action();
        refresh();
    };
    const actionButton = (text: string, action: () => void) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.onclick = action;
        return button;
    };
    waves.forEach((wave, index) => {
        const row = body.insertRow();
        row.className = 'wave-row';
        const handle = actionButton('', () => {});
        handle.className = 'wave-handle';
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const path = document.createElementNS(icon.namespaceURI, 'path');
        icon.setAttribute('viewBox', '0 0 32 32');
        icon.setAttribute('width', '20');
        icon.setAttribute('height', '20');
        icon.setAttribute('aria-hidden', 'true');
        path.setAttribute('fill', 'currentColor');
        path.setAttribute('d', 'M10 6h4v4h-4zM18 6h4v4h-4zM10 14h4v4h-4zM18 14h4v4h-4zM10 22h4v4h-4zM18 22h4v4h-4z');
        icon.append(path);
        handle.append(icon);
        handle.setAttribute('aria-label', `Reorder wave ${index + 1}`);
        handle.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown');
        const reorder = (target: number) => {
            if (target === index || target < 0 || target >= waves.length) return;
            change(() => {
                world.rules!.waves[spawn] = moveWave(waves, index, target);
            });
            host.querySelectorAll<HTMLButtonElement>('.wave-handle')[target]?.focus({ preventScroll: true });
        };
        handle.onkeydown = event => {
            const { key } = event;
            if (key !== 'ArrowUp' && key !== 'ArrowDown') return;
            event.preventDefault();
            reorder(index + (key === 'ArrowUp' ? -1 : 1));
        };
        handle.onpointerdown = event => {
            if (!event.isPrimary || event.button !== 0 || !host.reportValidity()) return;
            event.preventDefault();
            handle.setPointerCapture(event.pointerId);
            const controller = new AbortController(), options = { signal: controller.signal };
            row.classList.add('wave-placeholder');
            let y = event.clientY, frame = 0;
            const rows = Array.from(body.rows);
            const targetAt = (clientY: number) =>
                Math.max(0, rows.filter(r => clientY >= r.getBoundingClientRect().top).length - 1);
            const update = () => {
                const box = list.getBoundingClientRect();
                list.scrollTop += y < box.top + 35 ? -8 : y > box.bottom - 35 ? 8 : 0;
                const target = targetAt(y);
                rows.forEach((r, i) => r.classList.toggle('wave-drop', i === target && i !== index));
                frame = requestAnimationFrame(update);
            };
            const finish = () => {
                cancelAnimationFrame(frame);
                controller.abort();
                if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
                rows.forEach(r => r.classList.remove('wave-placeholder', 'wave-drop'));
            };
            handle.addEventListener('pointermove', e => {
                y = e.clientY;
            }, options);
            handle.addEventListener('pointerup', e => {
                finish();
                reorder(targetAt(e.clientY));
            }, options);
            handle.addEventListener('lostpointercapture', finish, options);
            window.addEventListener('keydown', e => {
                if (e.key === 'Escape') {
                    e.preventDefault(); e.stopImmediatePropagation(); finish();
                }
            }, { ...options, capture: true });
            window.addEventListener('blur', finish, options);
            update();
        };
        const time = document.createElement('input');
        time.className = 'wave-time';
        time.value = formatTime(wave.time);
        time.setAttribute('aria-label', `Wave ${index + 1} time`);
        time.oninput = () => {
            try {
                wave.time = parseTime(time.value);
                time.setCustomValidity('');
            } catch (error) {
                time.setCustomValidity(error instanceof Error ? error.message : String(error));
            }
        };
        row.insertCell().append(handle);
        row.insertCell().append(time);
        for (const [key, label, min] of scales) {
            const input = document.createElement('input');
            input.setAttribute('aria-label', `Wave ${index + 1} ${label}`);
            input.type = 'number'; input.min = min; input.max = String(MAX_WAVE_SCALE); input.step = '0.01';
            input.required = true;
            input.value = String(wave[key] ?? 1);
            input.oninput = () => {
                if (input.validity.valid) wave[key] = input.valueAsNumber;
            };
            row.insertCell().append(input);
        }
        const total = document.createElement('td');
        const updateTotal = () => {
            total.textContent = String(Object.values(wave.counts).reduce((a, b) => a + b, 0));
        };
        for (const variant of VARIANTS) {
            const count = document.createElement('input');
            count.setAttribute('aria-label', `Wave ${index + 1} ${variant.name} count`);
            count.type = 'number'; count.min = '0'; count.max = '100000'; count.step = '1';
            count.value = String(wave.counts[variant.name] ?? 0);
            count.oninput = () => {
                if (!count.validity.valid) return;
                wave.counts[variant.name] = Number(count.value);
                updateTotal();
            };
            row.insertCell().append(count);
        }
        updateTotal();
        row.append(total);
        row.insertCell().append(actionButton('Duplicate', () => change(() => {
            const next = world.rules!.waves[spawn];
            next.splice(index + 1, 0, structuredClone(wave));
        })), actionButton('Remove', () => change(() => {
            world.rules!.waves[spawn].splice(index, 1);
        })));
    });
    host.append(list, actionButton('Add wave', () => change(() => {
        const next = world.rules!.waves[spawn], last = next[next.length - 1];
        const time = Math.max(last?.time ?? 0, Math.min(world.rules!.winTime - 1, (last?.time ?? 30) + 60));
        next.push({ time, counts: { ...(last?.counts ?? { walker: 20 }) } });
    })));
}
