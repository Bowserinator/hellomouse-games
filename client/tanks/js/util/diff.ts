/**
 * Helper for state diffing
 * @param data Data array to send
 * @param diff Perform diff?
 * @param syncDataDiff Old data array to compare
 * @returns [str output, new syncDataDiff]
 */
export default function performStateDiff(data: Array<any>, diff: boolean,
    syncDataDiff: Array<any>): [string, Array<any>] {
    let trimmedData = [...data];
    let trimmedDataStr;

    // Trim data with previous diff
    if (diff && syncDataDiff) {
        for (let i = 0; i < syncDataDiff.length; i++)
            if (trimmedData[i] === syncDataDiff[i])
                trimmedData[i] = '';
        // Resulting str is like A,B,C,...
        // but can be '' if nothing changed (should be ignored and not sent by server)
        trimmedDataStr = trimmedData.some(x => x !== '') ? trimmedData.join(',') : '';
    } else
        trimmedDataStr = trimmedData.join(',');

    syncDataDiff = [...data]; // Update old diff
    return [trimmedDataStr, syncDataDiff];
}
