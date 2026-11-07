import { renderingMainThreadMeshingBudgetInMilliseconds, renderingMaximumWorkerCount } from '../../config.js';
import { MeshingFailure, MeshingJob, MeshingJobProcessor, MeshingRequest, MeshingResult } from './meshing-jobs.js';

interface PendingJob {
    job: MeshingJob;
    resolve: (result: MeshingResult) => void;
    reject: (error: Error) => void;
}
interface WorkerSlot {
    worker: Worker;
    pending: PendingJob | null;
    failed: boolean;
}

export class MeshingWorkerPool {
    private readonly workers: Array<WorkerSlot> = [];
    private readonly queue: Array<PendingJob> = [];
    private readonly fallback = new MeshingJobProcessor();
    private nextJobIdentifier = 0;
    private isDisposed = false;

    constructor(requestedWorkerCount = typeof navigator === 'undefined' ? 0
        : Math.min(Math.max(0, (navigator.hardwareConcurrency || 2) - 1), renderingMaximumWorkerCount)) {
        if (!Number.isInteger(requestedWorkerCount) || requestedWorkerCount < 0)
            throw new RangeError('Worker count must be a nonnegative integer');
        if (typeof Worker === 'undefined') return;
        for (let index = 0; index < Math.min(requestedWorkerCount, renderingMaximumWorkerCount); index++)
            try {
                const worker = new Worker(new URL('./meshing-worker.js', import.meta.url), { type: 'module' });
                const slot: WorkerSlot = { worker, pending: null, failed: false };
                worker.onmessage = (event: MessageEvent<MeshingResult | MeshingFailure>): void => {
                    if (this.isDisposed || slot.failed) return;
                    const pending = slot.pending;
                    if (pending === null || pending.job.jobIdentifier !== event.data.jobIdentifier) {
                        this.failWorker(slot, new Error('Worker returned an unexpected job'));
                        return;
                    }
                    slot.pending = null;
                    if (event.data.kind === 'error') pending.reject(new Error(event.data.message));
                    else pending.resolve(event.data);
                    this.dispatch();
                };
                worker.onerror = (event: ErrorEvent): void => {
                    event.preventDefault();
                    this.failWorker(slot, new Error(event.message || 'Meshing worker failed'));
                };
                this.workers.push(slot);
            } catch {
                break;
            }
    }

    get activeWorkerCount(): number {
        return this.workers.filter(slot => !slot.failed).length;
    }
    get pendingJobCount(): number {
        return this.queue.length + this.workers.filter(slot => slot.pending !== null).length;
    }

    submit(request: MeshingRequest): Promise<MeshingResult> {
        if (this.isDisposed) return Promise.reject(new Error('Meshing pool is disposed'));
        return new Promise((resolve, reject) => {
            this.queue.push({ job: { ...request, jobIdentifier: this.nextJobIdentifier++ }, resolve, reject });
            this.dispatch();
        });
    }

    /** Call once per frame when module workers cannot run. */
    runFallbackBudget(budgetInMilliseconds = renderingMainThreadMeshingBudgetInMilliseconds): void {
        if (!Number.isFinite(budgetInMilliseconds) || budgetInMilliseconds <= 0)
            throw new RangeError('Meshing budget must be finite and positive');
        if (this.isDisposed || this.activeWorkerCount > 0) return;
        const started = performance.now();
        while (this.queue.length > 0 && performance.now() - started < budgetInMilliseconds) {
            const pending = this.queue.shift()!;
            try {
                pending.resolve(this.fallback.run(pending.job));
            } catch (error) {
                pending.reject(error instanceof Error ? error : new Error(String(error)));
            }
        }
    }

    dispose(): void {
        if (this.isDisposed) return;
        this.isDisposed = true;
        for (const slot of this.workers) {
            slot.worker.terminate();
            slot.pending?.reject(new Error('Meshing pool is disposed'));
            slot.pending = null;
        }
        for (const pending of this.queue) pending.reject(new Error('Meshing pool is disposed'));
        this.queue.length = 0;
    }

    private dispatch(): void {
        if (this.isDisposed) return;
        for (const slot of this.workers) {
            if (slot.failed || slot.pending !== null || this.queue.length === 0) continue;
            slot.pending = this.queue.shift()!;
            try {
                const job = slot.pending.job;
                slot.worker.postMessage(job, job.kind === 'meshChunk' ? [job.input.voxels.buffer] : []);
            } catch (error) {
                this.failWorker(slot, error instanceof Error ? error : new Error(String(error)));
            }
        }
    }

    private failWorker(slot: WorkerSlot, error: Error): void {
        if (slot.failed || this.isDisposed) return;
        slot.failed = true;
        slot.worker.terminate();
        slot.pending?.reject(error);
        slot.pending = null;
        this.dispatch();
    }
}
