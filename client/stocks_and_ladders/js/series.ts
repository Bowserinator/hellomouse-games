/** Helpers for sampling price and score series at fractional tick positions. */

export type Point = [number, number];

export function valueAt(values: Array<number>, position: number): number {
    const whole = Math.min(Math.floor(position), values.length - 1);
    const next = Math.min(whole + 1, values.length - 1);
    return values[whole] + (values[next] - values[whole]) * (position - whole);
}

export function visiblePoints(values: Array<number>, position: number): Array<Point> {
    const whole = Math.min(Math.floor(position), values.length - 1);
    const points: Array<Point> = values.slice(0, whole + 1).map((value, tick) => [tick, value]);
    if (position > whole && whole + 1 < values.length) points.push([position, valueAt(values, position)]);
    return points;
}
