export function clip(operation: 'difference' | 'intersection', subject: ClipPolygon | ClipMultiPolygon,
    ...clips: Array<ClipPolygon | ClipMultiPolygon>): ClipMultiPolygon {
    const run = polygonClipping[operation];
    const precisionError = (error: unknown) => error instanceof Error &&
        (error.message.startsWith('Unable to complete output ring') ||
            error.message.startsWith('Unable to find segment #') && error.message.endsWith(' in SweepLine tree.'));
    try {
        return run(subject, ...clips);
    } catch (error) {
        if (!precisionError(error)) throw error;
        // Nearly coincident edges can break clipping; retry no coarser than MAPX precision.
        const polygons = (value: ClipPolygon | ClipMultiPolygon): ClipMultiPolygon =>
            typeof value[0]?.[0]?.[0] === 'number' ? [value as ClipPolygon] : value as ClipMultiPolygon;
        for (const scale of [10000, 1000, 100]) {
            const snap = (value: ClipPolygon | ClipMultiPolygon): ClipMultiPolygon => polygons(value)
                .map(p => p.map(r => r.map(([x, z]) => [Math.round(x * scale), Math.round(z * scale)])));
            try {
                const result = run(snap(subject), ...clips.map(snap));
                return result.map(p => p.map(r => r.map(([x, z]) => [x / scale, z / scale])));
            } catch (retryError) {
                if (!precisionError(retryError)) throw retryError;
            }
        }
        throw error;
    }
}
