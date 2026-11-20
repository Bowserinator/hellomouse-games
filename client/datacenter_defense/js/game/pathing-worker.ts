import { Pathfinder, type PathBody, type PathPoint, type PathStructure } from './pathing.js';

type Request = { type: 'init'; columns: number; rows: number; costs: Uint8Array; airCosts?: Uint8Array } |
{ type: 'structures'; structures: Array<PathStructure> } |
{ type: 'find'; id: number; starts: Array<PathPoint & { id: number }>; goal: PathPoint; body: PathBody;
    units?: Array<PathStructure & { id: number }>; };
// SAFETY: This entry point runs only in a dedicated worker; the project types globals as Window.
const scope = self as unknown as {
    onmessage: (event: MessageEvent<Request>) => void;
    postMessage: (data: unknown) => void;
};
let ground: Pathfinder, aerial: Pathfinder | undefined;
let flightGrid: { columns: number; rows: number; costs: Uint8Array } | undefined;
scope.onmessage = ({ data }) => {
    try {
        if (data.type === 'init') {
            ground = new Pathfinder(data.columns, data.rows, data.costs); aerial = undefined;
            flightGrid = { columns: data.columns, rows: data.rows, costs: data.airCosts ?? data.costs.slice() };
        } else if (data.type === 'structures') ground.structures(data.structures);
        else {
            if (data.body.flightHeight && !aerial) {
                if (!flightGrid) throw Error('Flight navigation is not initialized');
                aerial = new Pathfinder(flightGrid.columns, flightGrid.rows, flightGrid.costs);
            }
            const finder = data.body.flightHeight ? aerial! : ground;
            const first = data.starts[0];
            if (!first) throw Error('A path request needs a starting unit');
            const units = (data.units ?? []).filter(unit =>
                (unit.flightHeight ?? 0) === (data.body.flightHeight ?? 0));
            finder.setUnits(units.filter(unit => unit.id !== first.id));
            const shared = finder.find(first, data.goal, data.body).waypoints;
            const paths = data.starts.map(start => {
                finder.setUnits(units.filter(unit => unit.id !== start.id));
                let index = shared.findIndex(point => finder.leg(start, point, data.body));
                if (index >= 0) {
                    while (index + 1 < shared.length && finder.leg(start, shared[index + 1], data.body)) index++;
                    const points = shared.slice(index); let from = start;
                    if (points[0]?.recover) points[0] = { ...points[0], recover: false };
                    if (points.every(point => {
                        const valid = finder.leg(from, point, data.body); from = { ...from, ...point }; return valid;
                    })) return { id: start.id, points };
                }
                return { id: start.id, points: finder.find(start, data.goal, data.body).waypoints };
            });
            scope.postMessage({ id: data.id, paths });
        }
    } catch (error) {
        scope.postMessage({ id: data.type === 'find' ? data.id : -1,
            error: error instanceof Error ? error.message : String(error) });
    }
};
