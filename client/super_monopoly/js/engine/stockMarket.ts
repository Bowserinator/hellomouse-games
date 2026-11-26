export const sectors = [-50, 5, -3, 12, -8, 3, -15, 20, -5, 40, -10, 7, -20, 4, -12, 10];

export function stockReturn(wager: number, sector: number): number {
    const percent = sectors[sector];
    return Math.sign(percent) * Math.round(wager * Math.abs(percent) / 100);
}
