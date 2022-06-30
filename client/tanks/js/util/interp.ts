/**
 * Perform linear interpolation
 * @param a Start (smaller)
 * @param b End (Upper)
 * @param amount Percentage, 0 = a, 1 = b
 * @returns interpolated value
 */
export function interpol(a: number, b: number, amount: number) {
    return a + (b - a) * amount;
}

/**
 * Compute 'amount' value of x between a, b
 * Ie if x is halfway between a, b return 0.5
 * @param x Value
 * @param a Start (smaller)
 * @param b End (upper)
 * @returns 1 if a = b, else invinterlop
 */
export function invInterlop(x: number, a: number, b: number) {
    if (a === b) return 1;
    return (x - a) / (b - a);
}
