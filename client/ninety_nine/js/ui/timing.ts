import type { GameEvent } from '../types.js';
export function groupDuration(events: Array<GameEvent>): number {
    const group = events[0]?.group;
    if (group === 'shuffle') return 500;
    if (group === 'reveal') return 550;
    if (group === 'deal') return 450 + Math.max(0, events.length - 1) * 30;
    if (group === 'gather' || group === 'recycle') return 450 + Math.max(0, events.length - 1) * 15;
    return 450 + Math.max(0, events.length - 1) * 30 + (group === 'draw' ? 150 : 0);
}
export function eventGroups(events: Array<GameEvent>): Array<Array<GameEvent>> {
    const groups: Array<Array<GameEvent>> = [];
    for (const event of events) {
        if (groups.at(-1)?.[0].group !== event.group) groups.push([]);
        groups[groups.length - 1].push(event);
    }
    return groups;
}
export const eventDuration = (events: Array<GameEvent>): number =>
    eventGroups(events).reduce((sum, group) => sum + groupDuration(group), 0);
