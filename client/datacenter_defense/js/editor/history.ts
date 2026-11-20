import type { Entity, World } from '../mapx.js';

type Command = {
    objects: Array<{ id: string; before?: Entity; after?: Entity; beforeIndex: number; afterIndex: number }>;
    terrain: Array<{ index: number; before: number; after: number }>;
    beforeName: string;
    afterName: string;
    beforeRules: World['rules'];
    afterRules: World['rules'];
};
export const cloneWorld = (world: World): World => structuredClone(world);
export class History {
    private undoStack: Array<Command> = [];
    private redoStack: Array<Command> = [];
    commit(before: World, after: World) {
        const previous = new Map(before.objects.map(e => [e.id, e]));
        const current = new Map(after.objects.map(e => [e.id, e]));
        const command: Command = { objects: [], terrain: [], beforeName: before.name, afterName: after.name,
            beforeRules: structuredClone(before.rules), afterRules: structuredClone(after.rules) };
        for (const id of new Set([...previous.keys(), ...current.keys()])) {
            const a = previous.get(id), b = current.get(id);
            if (JSON.stringify(a) !== JSON.stringify(b)) command.objects.push({
                id, before: a, after: b && structuredClone(b),
                beforeIndex: before.objects.findIndex(e => e.id === id),
                afterIndex: after.objects.findIndex(e => e.id === id)
            });
        }
        after.terrain.heights.forEach((value, index) => {
            if (value !== before.terrain.heights[index]) command.terrain.push({
                index, before: before.terrain.heights[index], after: value
            });
        });
        if (!command.objects.length && !command.terrain.length && before.name === after.name &&
            JSON.stringify(before.rules) === JSON.stringify(after.rules)) return false;
        this.undoStack.push(command);
        if (this.undoStack.length > 100) this.undoStack.shift();
        this.redoStack = [];
        return true;
    }
    apply(world: World, redo = false) {
        const command = (redo ? this.redoStack : this.undoStack).pop();
        if (!command) return false;
        const direction = redo ? 'after' : 'before';
        for (const change of command.objects) {
            const index = world.objects.findIndex(e => e.id === change.id);
            if (index !== -1) world.objects.splice(index, 1);
        }
        const ordered = command.objects.slice().sort((a, b) =>
            (redo ? a.afterIndex - b.afterIndex : a.beforeIndex - b.beforeIndex));
        for (const change of ordered) {
            const value = change[direction];
            if (value) world.objects.splice(redo ? change.afterIndex : change.beforeIndex, 0, structuredClone(value));
        }
        for (const change of command.terrain) world.terrain.heights[change.index] = change[direction];
        world.name = redo ? command.afterName : command.beforeName;
        world.rules = structuredClone(redo ? command.afterRules : command.beforeRules);
        (redo ? this.undoStack : this.redoStack).push(command);
        return true;
    }
}
