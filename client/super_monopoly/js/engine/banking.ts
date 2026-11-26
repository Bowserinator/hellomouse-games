import type { Debt, LedgerEntry, Player } from './state.js';

export const available = (player: Player): number => player.cash - player.reserved;

export const bailAmount = (bail: number, funds: number, percent: boolean): number =>
    percent ? Math.floor(Math.max(0, funds) * bail / 100) : bail;

export function transact(players: ReadonlyArray<Player>, payer: number | null, creditor: number | null,
    amount: number, reason: string, seq: number, property?: string): LedgerEntry {
    const from = payer === null ? null : players[payer];
    const to = creditor === null ? null : players[creditor];
    if (!Number.isSafeInteger(amount) || amount < 0 || (from && available(from) < amount))
        throw new Error('Invalid transfer');

    const payerBefore = from?.cash ?? null;
    const creditorBefore = to?.cash ?? null;
    if (from) from.cash -= amount;
    if (to) to.cash += amount;
    if (reason === 'Rent') {
        if (from) from.rentPaid += amount;
        if (to) to.rentEarned += amount;
    }
    return { payer, creditor, amount, reason, seq, property, payerBefore, creditorBefore,
        payerAfter: from?.cash ?? null, creditorAfter: to?.cash ?? null };
}

export function shortfall(players: ReadonlyArray<Player>, debt: Debt): number {
    return Math.max(0, debt.amount - available(players[debt.payer]));
}
