import type { EventGroup, MoveEvent } from '../types.js';
export function groupDuration(group: EventGroup, count: number): number {
    if (group === 'shuffle') return 500;
    if (group === 'reveal') return count * 650;
    return 460 + Math.max(0, count - 1) * (group === 'deal' ? 22 : group === 'gather' ? 12 : 40);
}
export function eventDuration(events: Array<MoveEvent>): number {
    let total = 0, start = 0;
    while (start < events.length) {
        let end = start + 1;
        while (end < events.length && events[end].group === events[start].group) end++;
        total += groupDuration(events[start].group, end - start); start = end;
    }
    return total;
}
