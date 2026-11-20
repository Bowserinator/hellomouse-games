import { ECONOMY as C } from '../../sim/layout.js';
import { fontIcon } from './icons.js';

export function formatResource(value: number): string {
    const scale = Math.abs(value) >= 1000000 ? 1000000 : Math.abs(value) >= 1000 ? 1000 : 1;
    return `${Number((value / scale).toFixed(scale === 1 ? 2 : 1))}${scale === 1000000 ? 'm' : scale === 1000 ? 'k' : ''}`;
}
export class ResourceBars {
    readonly element = document.createElement('div');
    private rows = ['money', 'power'].map(name => {
        const row = document.createElement('div'), meter = document.createElement('div');
        const fill = document.createElement('div'), amount = document.createElement('small');
        const net = document.createElement('span'), rates = document.createElement('small');
        row.className = `resource-bars__row resource-bars__row--${name}`;
        meter.className = 'resource-bars__meter'; fill.className = 'resource-bars__fill';
        amount.className = 'resource-bars__amount'; net.className = 'resource-bars__net';
        row.style.color = name === 'money' ? '#2e7d32' : '#a24b00';
        fill.style.backgroundColor = name === 'money' ? '#81c784' : '#ffb74d';
        meter.setAttribute('role', 'meter'); meter.setAttribute('aria-label', name === 'money' ? 'Money' : 'Power');
        meter.setAttribute('aria-valuemin', '0'); meter.append(fill);
        const bar = document.createElement('div'); bar.append(meter, amount);
        row.append(fontIcon(name === 'money' ? 'payments' : 'bolt'), bar, net, rates);
        this.element.append(row); return { meter, fill, amount, net, rates };
    });
    constructor(host: HTMLElement) {
        this.element.className = 'resource-bars'; host.append(this.element);
    }
    update(economy: Int32Array) {
        const keys = [[C.money, C.moneyCap, C.moneyHistory, C.moneyUsed],
            [C.power, C.powerCap, C.powerHistory, C.powerUsed]];
        this.rows.forEach((row, index) => {
            const [stockKey, capKey, incomeKey, usageKey] = keys[index];
            const stock = economy[stockKey] / 100, cap = economy[capKey] / 100;
            const income = economy.subarray(incomeKey, incomeKey + 20).reduce((sum, tick) => sum + tick, 0) / 100;
            const usage = economy[usageKey] / 100, net = income - usage;
            row.fill.style.width = `${cap ? Math.min(100, stock / cap * 100) : 0}%`;
            row.meter.setAttribute('aria-valuenow', String(stock)); row.meter.setAttribute('aria-valuemax', String(cap));
            row.amount.textContent = `${formatResource(stock)} / ${formatResource(cap)}`;
            row.net.textContent = `${net >= 0 ? '+' : ''}${formatResource(net)}/s`;
            row.net.classList.toggle('resource-bars__net--negative', net < 0);
            row.rates.textContent = `+${formatResource(income)}\n-${formatResource(usage)}`;
            row.rates.setAttribute('aria-label', `Income ${income} per second, usage ${usage} per second`);
        });
    }
    destroy() {
        this.element.remove();
    }
}
