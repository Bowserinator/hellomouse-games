/** Number formatting for money and percentages. */

export function formatMoney(value: number): string {
    return `$${Math.round(value).toLocaleString('en-US')}`;
}

export function formatWhole(value: number): string {
    return Math.round(value).toLocaleString('en-US');
}

export function formatPrice(value: number): string {
    return value.toFixed(2);
}

export function formatChange(fraction: number): string {
    const percent = fraction * 100;
    return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
}

export function formatClock(milliseconds: number): string {
    return String(Math.max(0, Math.ceil(milliseconds / 1000)));
}

export function formatCompactMoney(value: number): string {
    return value >= 1000 ? `$${(value / 1000).toFixed(1)}k` : `$${Math.round(value)}`;
}
