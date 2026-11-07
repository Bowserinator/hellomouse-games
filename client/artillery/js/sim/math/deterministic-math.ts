export const piInRadians = 3.141592653589793;
export const fullCircleInRadians = 6.283185307179586;
export const halfPi = 1.5707963267948966;
export const radiansPerDegree = piInRadians / 180;
const logarithmOfTwo = 0.6931471805599453;

export function sineOfRadians(angleInRadians: number): number {
    let reduced = angleInRadians - Math.floor((angleInRadians + piInRadians) /
        fullCircleInRadians) * fullCircleInRadians;
    if (reduced > halfPi) reduced = piInRadians - reduced;
    if (reduced < -halfPi) reduced = -piInRadians - reduced;
    const square = reduced * reduced;
    return reduced * (1 + square * (-1 / 6 + square * (1 / 120 + square * (-1 / 5040 +
        square * (1 / 362880 + square * (-1 / 39916800 + square / 6227020800))))));
}

export function cosineOfRadians(angleInRadians: number): number {
    return sineOfRadians(angleInRadians + halfPi);
}

export function arcTangentOfRatio(ratio: number): number {
    if (ratio < 0) return -arcTangentOfRatio(-ratio);
    if (ratio > 1) return halfPi - arcTangentOfRatio(1 / ratio);
    if (ratio > 0.41421356237309503) return piInRadians / 4 + arcTangentOfRatio((ratio - 1) / (ratio + 1));
    const square = ratio * ratio;
    return ratio * (1 + square * (-1 / 3 + square * (1 / 5 + square * (-1 / 7 + square *
        (1 / 9 + square * (-1 / 11 + square * (1 / 13 + square * (-1 / 15 + square / 17))))))));
}

export function arcTangent2(y: number, x: number): number {
    if (x > 0) return arcTangentOfRatio(y / x);
    if (x < 0) return arcTangentOfRatio(y / x) + (y < 0 ? -piInRadians : piInRadians);
    return y > 0 ? halfPi : y < 0 ? -halfPi : 0;
}

export function arcCosine(value: number): number {
    const clamped = Math.max(-1, Math.min(1, value));
    return arcTangent2(Math.sqrt(Math.max(0, 1 - clamped * clamped)), clamped);
}

export function exponentialApproximation(value: number): number {
    if (value > 709) return Infinity;
    if (value < -745) return 0;
    const exponent = Math.round(value / logarithmOfTwo);
    const remainder = value - exponent * logarithmOfTwo;
    let term = 1, sum = 1;
    for (let order = 1; order <= 14; order++) {
        term *= remainder / order;
        sum += term;
    }
    let multiplier = 1;
    for (let step = 0; step < Math.abs(exponent); step++) multiplier *= exponent < 0 ? 0.5 : 2;
    return sum * multiplier;
}

export function naturalLogarithmApproximation(value: number): number {
    if (value === 0) return -Infinity;
    if (value < 0 || Number.isNaN(value)) return NaN;
    if (value === Infinity) return Infinity;
    let reduced = value, exponent = 0;
    while (reduced >= 2) {
        reduced *= 0.5;
        exponent++;
    }
    while (reduced < 1) {
        reduced *= 2;
        exponent--;
    }
    const ratio = (reduced - 1) / (reduced + 1), square = ratio * ratio;
    let term = ratio, sum = ratio;
    for (let order = 3; order <= 31; order += 2) {
        term *= square;
        sum += term / order;
    }
    return 2 * sum + exponent * logarithmOfTwo;
}
