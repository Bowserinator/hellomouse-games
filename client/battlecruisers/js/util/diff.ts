/**
 * Perform object diff
 * @param previous Previous object
 * @param current Current object
 * @param dif Diff?
 * @returns [new previous, obj to send]
 */
export default function diff(previous: any, current: any, dif = true) {
    // Delete keys from current that are the same as in previous
    if (!dif) return [current, current];
    let toSend = { ...current };
    for (let key of Object.keys(current))
        if (JSON.stringify(previous[key]) === JSON.stringify(current[key]))
            delete toSend[key];
    return [current, toSend];
}
