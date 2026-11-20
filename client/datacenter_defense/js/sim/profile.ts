interface KernelTime {
    calls: number; totalMilliseconds: number; maxMilliseconds: number;
}
export class SimProfiler {
    readonly gpu: boolean;
    private queries?: GPUQuerySet;
    private resolveBuffer?: GPUBuffer;
    private slots: Array<{ buffer: GPUBuffer; busy: boolean }> = [];
    private names: Array<string> = [];
    private times = new Map<string, KernelTime>();
    private started = 0;
    private ticks = 0;
    private cpuTotal = 0;
    private cpuMax = 0;
    constructor(private device: GPUDevice) {
        this.gpu = device.features.has('timestamp-query');
        if (this.gpu) {
            this.queries = device.createQuerySet({ type: 'timestamp', count: 1024 });
            this.resolveBuffer = device.createBuffer({ label: 'Profile timestamps', size: 8192,
                usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
        }
    }
    get memoryBytes() {
        return (this.resolveBuffer?.size ?? 0) + this.slots.reduce((sum, slot) => sum + slot.buffer.size, 0);
    }
    beginTick() {
        this.names.length = 0; this.started = performance.now();
    }
    beginPass(encoder: GPUCommandEncoder, name: string) {
        if (!this.queries) throw Error('GPU timestamps are unavailable');
        const index = this.names.length * 2;
        if (index >= 1024) throw Error('Too many profiled dispatches');
        this.names.push(name);
        return encoder.beginComputePass({ label: name, timestampWrites: { querySet: this.queries,
            beginningOfPassWriteIndex: index, endOfPassWriteIndex: index + 1 } });
    }
    resolve(encoder: GPUCommandEncoder): (() => Promise<void>) | undefined {
        if (!this.queries || !this.resolveBuffer || !this.names.length) return;
        const names = this.names.slice(), bytes = names.length * 16;
        let slot = this.slots.find(candidate => !candidate.busy);
        if (!slot) {
            slot = { busy: false, buffer: this.device.createBuffer({ label: 'Profile readback', size: 8192,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }) };
            this.slots.push(slot);
        }
        slot.busy = true;
        encoder.resolveQuerySet(this.queries, 0, names.length * 2, this.resolveBuffer, 0);
        encoder.copyBufferToBuffer(this.resolveBuffer, 0, slot.buffer, 0, bytes);
        const pooled = slot;
        return async () => {
            try {
                await pooled.buffer.mapAsync(GPUMapMode.READ);
                try {
                    const values = new BigUint64Array(pooled.buffer.getMappedRange());
                    names.forEach((name, index) => {
                        const milliseconds = Number(values[index * 2 + 1] - values[index * 2]) / 1000000;
                        const time = this.times.get(name) ?? { calls: 0, totalMilliseconds: 0, maxMilliseconds: 0 };
                        time.calls++; time.totalMilliseconds += milliseconds;
                        time.maxMilliseconds = Math.max(time.maxMilliseconds, milliseconds);
                        this.times.set(name, time);
                    });
                } finally {
                    pooled.buffer.unmap();
                }
            } finally {
                pooled.busy = false;
            }
        };
    }
    submitted() {
        const milliseconds = performance.now() - this.started;
        this.ticks++; this.cpuTotal += milliseconds; this.cpuMax = Math.max(this.cpuMax, milliseconds);
    }
    reset() {
        if (this.slots.some(slot => slot.busy)) throw Error('Wait for profiling readbacks before resetting');
        this.times.clear(); this.ticks = 0; this.cpuTotal = 0; this.cpuMax = 0;
    }
    get report() {
        const total = [...this.times.values()].reduce((sum, time) => sum + time.totalMilliseconds, 0);
        return { timestampSupported: this.gpu, ticks: this.ticks,
            cpuEncode: { totalMilliseconds: this.cpuTotal, meanMilliseconds: this.cpuTotal / (this.ticks || 1),
                maxMilliseconds: this.cpuMax },
            gpuMillisecondsPerTick: this.gpu ? total / (this.ticks || 1) : null,
            kernels: [...this.times].map(([entry, time]) => ({ entry, ...time,
                meanMilliseconds: time.totalMilliseconds / time.calls,
                millisecondsPerTick: time.totalMilliseconds / (this.ticks || 1),
                sharePercent: total ? time.totalMilliseconds / total * 100 : 0
            })).sort((a, b) => b.totalMilliseconds - a.totalMilliseconds) };
    }
    destroy() {
        this.queries?.destroy(); this.resolveBuffer?.destroy();
        for (const slot of this.slots) slot.buffer.destroy();
        this.slots.length = 0; this.times.clear(); this.names.length = 0;
    }
}
