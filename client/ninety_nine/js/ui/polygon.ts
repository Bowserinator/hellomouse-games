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

export function contentSize(table: TableLayout, cardSize: Size): Size {
    const half = table.radius + cardSize.h * 1.5;
    return { w: half * 2, h: half * 2 };
}
