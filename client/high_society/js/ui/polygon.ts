export interface Vec {
    x: number;
    y: number;
}

export interface Size {
    w: number;
    h: number;
}

export interface SeatPlacement {
    anchor: Vec;
    rotationDeg: number;
}

export interface TableLayout {
    center: Vec;
    radius: number;
    seats: Array<SeatPlacement>;
}

export function layout(playerCount: number, cardSize: Size, localSeat = 0): TableLayout {
    const count = Math.max(playerCount, 1);
    const packed = (cardSize.w / (2 * Math.sin(Math.PI / count))) * 1.15;
    const radius = Math.max(packed, cardSize.h * 1.6);
    const seats: Array<SeatPlacement> = [];
    for (let index = 0; index < count; index++) {
        const offset = index - localSeat;
        const angle = (2 * Math.PI * offset) / count;
        seats.push({
            anchor: { x: -Math.sin(angle) * radius, y: Math.cos(angle) * radius },
            rotationDeg: (360 * offset) / count
        });
    }
    return { center: { x: 0, y: 0 }, radius, seats };
}

/** Fraction of the layout radius at which seats are anchored. */
export const SEAT_RING = 0.92;

const LABEL_ROOM = 90;
const CENTER_HALF = 200;
const TABLE_MARGIN = 40;
const OUTLINE_WOBBLE = 1.025;

/** Corner radius of a polygonal table that covers the centre only, leaving every seat outside its rim. */
export function tableRadius(table: TableLayout): number {
    const sides = Math.max(table.seats.length, 3);
    const apothem = Math.max(CENTER_HALF, table.radius * SEAT_RING - LABEL_ROOM);
    return apothem / (Math.cos(Math.PI / sides) * OUTLINE_WOBBLE);
}

export function contentSize(table: TableLayout, seatSize: Size, artExtent: number): Size {
    const seatReach = table.radius * SEAT_RING + seatSize.h + seatSize.w / 2;
    const half = Math.max(artExtent, seatReach) + TABLE_MARGIN;
    return { w: half * 2, h: half * 2 };
}
