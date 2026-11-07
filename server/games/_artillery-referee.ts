import type { LobbySeat, ResolveReport } from '../../client/artillery/js/types.js';

export function isResolveReport(value: unknown, turnIndex: number, seats: ReadonlyArray<LobbySeat>,
    hitPointsPerTank: number): value is ResolveReport {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const report = value as Record<string, unknown>;
    const keys = ['turnIndex', 'stateHash', 'aliveSeatIndices', 'armedSeatIndices', 'statistics',
        'shotsFired', 'hasAmmunitionRemaining'];
    if (Object.keys(report).length !== keys.length ||
        !keys.every(key => Object.prototype.hasOwnProperty.call(report, key)) ||
        report.turnIndex !== turnIndex || !Number.isInteger(report.stateHash) ||
        (report.stateHash as number) < 0 || (report.stateHash as number) > 0xffffffff ||
        typeof report.hasAmmunitionRemaining !== 'boolean' || !Number.isInteger(report.shotsFired) ||
        (report.shotsFired as number) < 0 || (report.shotsFired as number) > seats.length ||
        !Array.isArray(report.aliveSeatIndices) || !Array.isArray(report.armedSeatIndices) ||
        !Array.isArray(report.statistics)) return false;
    const knownSeats = new Set(seats.map(seat => seat.seatIndex));
    const alive = new Set<number>();
    for (const seat of report.aliveSeatIndices) {
        if (!Number.isInteger(seat) || !knownSeats.has(seat) || alive.has(seat)) return false;
        alive.add(seat);
    }
    const armed = new Set<number>();
    for (const seat of report.armedSeatIndices) {
        if (!Number.isInteger(seat) || !alive.has(seat) || armed.has(seat)) return false;
        armed.add(seat);
    }
    if (report.hasAmmunitionRemaining !== (armed.size > 0) || report.statistics.length !== seats.length) return false;
    const seen = new Set<number>();
    const statisticKeys = ['seatIndex', 'damageDealt', 'damageTaken', 'friendlyFireDamage', 'shotsFired'];
    for (const entry of report.statistics) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
            Object.keys(entry).length !== statisticKeys.length ||
            !statisticKeys.every(key => Object.prototype.hasOwnProperty.call(entry, key) &&
                Number.isFinite(entry[key]))) return false;
        if (!knownSeats.has(entry.seatIndex) || seen.has(entry.seatIndex) ||
            entry.damageTaken < 0 || entry.damageTaken > hitPointsPerTank ||
            entry.damageDealt < 0 || entry.damageDealt > hitPointsPerTank * seats.length ||
            entry.friendlyFireDamage < 0 || entry.friendlyFireDamage > entry.damageDealt ||
            !Number.isInteger(entry.shotsFired) || entry.shotsFired < 0 || entry.shotsFired > turnIndex + 1 ||
            alive.has(entry.seatIndex) !== (entry.damageTaken < hitPointsPerTank)) return false;
        seen.add(entry.seatIndex);
    }
    return true;
}

export function selectReportMajority(reports: ReadonlyMap<number, ResolveReport>):
{ report: ResolveReport; seatIndices: Array<number> } | null {
    const groups = new Map<string, { report: ResolveReport; seatIndices: Array<number> }>();
    for (const [seatIndex, report] of reports) {
        // Include referee fields so a matching hash cannot hide a forged winner or score.
        const identity = JSON.stringify([report.stateHash,
            [...report.aliveSeatIndices].sort((left, right) => left - right),
            [...report.armedSeatIndices].sort((left, right) => left - right),
            [...report.statistics].sort((left, right) => left.seatIndex - right.seatIndex).map(entry =>
                [entry.seatIndex, entry.damageDealt, entry.damageTaken, entry.friendlyFireDamage, entry.shotsFired]),
            report.shotsFired, report.hasAmmunitionRemaining]);
        const group = groups.get(identity) ?? { report, seatIndices: [] };
        group.seatIndices.push(seatIndex);
        groups.set(identity, group);
    }
    for (const group of groups.values()) if (group.seatIndices.length > reports.size / 2) return group;
    return null;
}
