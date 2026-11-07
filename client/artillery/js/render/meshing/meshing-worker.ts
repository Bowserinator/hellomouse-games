import { MeshingJob, MeshingJobProcessor, MeshingFailure, meshingResultTransfers } from './meshing-jobs.js';

const processor = new MeshingJobProcessor();
self.onmessage = (event: MessageEvent<MeshingJob>): void => {
    try {
        const result = processor.run(event.data);
        self.postMessage(result, { transfer: meshingResultTransfers(result) });
    } catch (error) {
        const failure: MeshingFailure = { kind: 'error', jobIdentifier: event.data.jobIdentifier,
            message: error instanceof Error ? error.message : String(error) };
        self.postMessage(failure);
    }
};
