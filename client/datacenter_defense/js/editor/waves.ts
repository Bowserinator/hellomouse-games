import type { Wave, World } from '../mapx.js';
import { VARIANTS } from '../sim/variants.js';
import { cloneWorld } from './history.js';

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
    const compositions = list.map(wave => ({ ...wave.counts }));
    compositions.splice(to, 0, compositions.splice(from, 1)[0]);
    return list.map((wave, i) => ({ time: wave.time, counts: compositions[i] }));
}
export function waveSummary(world: World) {
    const waves = Object.values(world.rules?.waves ?? {}).flat();
    return { first: waves.length ? Math.min(...waves.map(w => w.time)) : undefined,
        total: waves.reduce((sum, wave) => sum + Object.values(wave.counts).reduce((a, b) => a + b, 0), 0) };
}
export function waveEditor(host: HTMLElement, world: World, spawn: string, commit: (before: World) => void) {
    const list = document.createElement('div');
    list.className = 'wave-list';
    const waves = world.rules?.waves[spawn] ?? [];
    const change = (action: () => void) => {
        const before = cloneWorld(world);
        world.rules ??= { winTime: 720, waves: {} };
        world.rules.waves[spawn] ??= [];
        action();
        commit(before);
    };
    const actionButton = (text: string, action: () => void) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.onclick = action;
        return button;
    };
    waves.forEach((wave, index) => {
        const row = document.createElement('div');
        row.className = 'wave-row';
        const handle = actionButton('Drag', () => {});
        handle.setAttribute('aria-label', `Reorder wave ${index + 1}`);
        handle.style.touchAction = 'none';
        handle.onpointerdown = event => {
            event.preventDefault();
            handle.setPointerCapture(event.pointerId);
            const controller = new AbortController(), options = { signal: controller.signal };
            const floating = row.cloneNode(true) as HTMLElement;
            const rect = row.getBoundingClientRect();
            floating.classList.add('wave-drag');
            floating.style.width = `${rect.width}px`;
            document.body.append(floating);
            row.classList.add('wave-placeholder');
            let target = index, y = event.clientY, frame = 0;
            const rows = Array.from(list.children) as Array<HTMLElement>;
            const update = () => {
                const box = list.getBoundingClientRect();
                list.scrollTop += y < box.top + 35 ? -8 : y > box.bottom - 35 ? 8 : 0;
                floating.style.left = `${rect.left}px`;
                floating.style.top = `${y - 15}px`;
                target = rows.filter(r => y > r.getBoundingClientRect().top + r.clientHeight / 2).length;
                target = Math.max(0, Math.min(rows.length - 1, target > index ? target - 1 : target));
                rows.forEach((r, i) => {
                    r.classList.toggle('wave-drop', i === target);
                    r.style.transform = i > index && i <= target ? `translateY(-${rect.height}px)`
                        : i < index && i >= target ? `translateY(${rect.height}px)` : '';
                });
                const reordered = moveWave(waves, index, target);
                const position = rows.slice();
                position.splice(target, 0, position.splice(index, 1)[0]);
                position.forEach((r, i) => {
                    r.querySelector<HTMLInputElement>('.wave-time')!.value = formatTime(reordered[i].time);
                });
                frame = requestAnimationFrame(update);
            };
            const finish = (save: boolean) => {
                cancelAnimationFrame(frame);
                controller.abort();
                floating.remove();
                rows.forEach((r, i) => {
                    r.classList.remove('wave-placeholder', 'wave-drop');
                    r.style.transform = '';
                    r.querySelector<HTMLInputElement>('.wave-time')!.value = formatTime(waves[i].time);
                });
                if (save && target !== index) change(() => {
                    world.rules!.waves[spawn] = moveWave(waves, index, target);
                });
            };
            handle.addEventListener('pointermove', e => {
                y = e.clientY;
            }, options);
            handle.addEventListener('pointerup', () => finish(true), options);
            handle.addEventListener('pointercancel', () => finish(false), options);
            window.addEventListener('keydown', e => {
                if (e.key === 'Escape') {
                    e.preventDefault(); e.stopImmediatePropagation(); finish(false);
                }
            }, { ...options, capture: true });
            window.addEventListener('blur', () => finish(false), options);
            update();
        };
        const time = document.createElement('input');
        time.className = 'wave-time';
        time.value = formatTime(wave.time);
        time.setAttribute('aria-label', `Wave ${index + 1} time`);
        time.onchange = () => {
            try {
                const seconds = parseTime(time.value);
                time.setCustomValidity('');
                change(() => {
                    wave.time = seconds;
                });
            } catch (error) {
                time.setCustomValidity(error instanceof Error ? error.message : String(error));
                time.reportValidity();
            }
        };
        row.append(handle, time);
        for (const variant of VARIANTS) {
            const label = document.createElement('label'), count = document.createElement('input');
            label.textContent = variant.name;
            count.type = 'number'; count.min = '0'; count.max = '100000'; count.step = '1';
            count.value = String(wave.counts[variant.name] ?? 0);
            count.onchange = () => {
                if (count.checkValidity()) change(() => {
                    wave.counts[variant.name] = Number(count.value);
                });
            };
            label.append(count);
            row.append(label);
        }
        const total = document.createElement('span');
        total.textContent = `Total ${Object.values(wave.counts).reduce((a, b) => a + b, 0)}`;
        row.append(total, actionButton('Duplicate', () => change(() => {
            const next = world.rules!.waves[spawn];
            next.splice(index + 1, 0, structuredClone(wave));
        })), actionButton('Remove', () => change(() => {
            world.rules!.waves[spawn].splice(index, 1);
        })));
        list.append(row);
    });
    host.append(list, actionButton('Add wave', () => change(() => {
        const next = world.rules!.waves[spawn], last = next[next.length - 1];
        const time = Math.max(last?.time ?? 0, Math.min(world.rules!.winTime - 1, (last?.time ?? 30) + 60));
        next.push({ time, counts: { ...(last?.counts ?? { walker: 20 }) } });
    })));
}
