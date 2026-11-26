import { ECONOMY as C } from '../../sim/layout.js';
import { fontIcon } from './icons.js';

export class ResourceBars {
    readonly element = document.createElement('div');
    private rows = ['money', 'power'].map(name => {
        const row = document.createElement('div'), meter = document.createElement('div');
        const fill = document.createElement('div'), amount = document.createElement('small');
        const net = document.createElement('span'), rates = document.createElement('small');
        row.className = `resource-bars__row resource-bars__row--${name}`;
        meter.className = 'resource-bars__meter'; fill.className = 'resource-bars__fill';
        amount.className = 'resource-bars__amount'; net.className = 'resource-bars__net';
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
            const usage = economy[usageKey] / 100, net = Math.round(income - usage);
            row.fill.classList.toggle('resource-bars__fill--overflow', cap > 0 && stock >= cap && income > usage);
            row.fill.style.width = `${cap ? Math.min(100, stock / cap * 100) : 0}%`;
            const current = Math.round(stock), maximum = Math.round(cap);
            row.meter.setAttribute('aria-valuenow', String(current));
            row.meter.setAttribute('aria-valuemax', String(maximum));
            row.amount.textContent = `${current} / ${maximum}`;
            row.net.textContent = `${net < 0 ? '' : '+'}${net}/s`;
            row.net.classList.toggle('resource-bars__net--negative', net < 0);
            const produced = Math.round(income), spent = Math.round(usage);
            row.rates.textContent = `+${produced}\n-${spent}`;
            row.rates.setAttribute('aria-label', `Income ${produced} per second, usage ${spent} per second`);
        });
    }
    destroy() {
        this.element.remove();
    }
}
