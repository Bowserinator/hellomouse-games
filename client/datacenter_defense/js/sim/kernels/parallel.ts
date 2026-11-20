export function parallelKernels(workgroupSize: number): string {
    return `
var<workgroup> radix_hist: array<u32, 4096>;
var<workgroup> scan_tile: array<u32, 1024>;
var<workgroup> scan_next: array<u32, 1024>;
fn radix_keys() -> u32 { return select(p(P_radixKeysA), p(P_radixKeysB), p(P_field) != 0u); }
fn radix_histogram(lane: u32, block: u32) {
    for (var bin = 0u; bin < 32u; bin++) { radix_hist[bin * 128u + lane] = 0u; }
    for (var item = 0u; item < 8u; item++) {
        let at = block * 1024u + lane * 8u + item;
        if (at < p(P_sortSize)) {
            let digit = (atomicLoad(&scratch[radix_keys() + at]) >> p(P_j)) & 31u;
            radix_hist[digit * 128u + lane]++;
        }
    }
}
@compute @workgroup_size(128)
fn radix_count(@builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) group: vec3<u32>) {
    radix_histogram(lane, group.x);
    workgroupBarrier();
    if (lane < 32u) {
        var total = 0u;
        for (var thread = 0u; thread < 128u; thread++) { total += radix_hist[lane * 128u + thread]; }
        let blocks = (p(P_sortSize) + 1023u) / 1024u;
        atomicStore(&scratch[p(P_radixHist) + lane * blocks + group.x], total);
    }
}
@compute @workgroup_size(128)
fn radix_scatter(@builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) group: vec3<u32>) {
    radix_histogram(lane, group.x);
    workgroupBarrier();
    if (lane < 32u) {
        var prefix = 0u;
        for (var thread = 0u; thread < 128u; thread++) {
            let at = lane * 128u + thread;
            let value = radix_hist[at]; radix_hist[at] = prefix; prefix += value;
        }
    }
    workgroupBarrier();
    let keys = radix_keys();
    let output_keys = select(p(P_radixKeysB), p(P_radixKeysA), p(P_field) != 0u);
    let blocks = (p(P_sortSize) + 1023u) / 1024u;
    for (var item = 0u; item < 8u; item++) {
        let at = group.x * 1024u + lane * 8u + item;
        if (at < p(P_sortSize)) {
            let key = atomicLoad(&scratch[keys + at]); let bin = (key >> p(P_j)) & 31u;
            let histogram = bin * blocks + group.x;
            let inclusive = atomicLoad(&scratch[p(P_radixHist) + blocks * 32u + histogram]);
            let exclusive = inclusive - atomicLoad(&scratch[p(P_radixHist) + histogram]);
            let rank = exclusive + radix_hist[bin * 128u + lane];
            radix_hist[bin * 128u + lane]++;
            atomicStore(&scratch[output_keys + rank], key);
            atomicStore(&scratch[p(P_output) + rank], atomicLoad(&scratch[p(P_input) + at]));
        }
    }
}
@compute @workgroup_size(${workgroupSize})
fn scan_block(@builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) group: vec3<u32>) {
    let base = group.x * 1024u;
    for (var i = lane; i < 1024u; i += ${workgroupSize}u) {
        var value = 0u;
        if (base + i < p(P_length)) { value = atomicLoad(&scratch[p(P_input) + base + i]); }
        scan_tile[i] = value;
    }
    workgroupBarrier();
    for (var stride = 1u; stride < 1024u; stride *= 2u) {
        for (var i = lane; i < 1024u; i += ${workgroupSize}u) {
            var value = scan_tile[i];
            if (i >= stride) { value += scan_tile[i - stride]; }
            scan_next[i] = value;
        }
        workgroupBarrier();
        for (var i = lane; i < 1024u; i += ${workgroupSize}u) { scan_tile[i] = scan_next[i]; }
        workgroupBarrier();
    }
    for (var i = lane; i < 1024u; i += ${workgroupSize}u) {
        if (base + i < p(P_length)) { atomicStore(&scratch[p(P_output) + base + i], scan_tile[i]); }
    }
    if (lane == 0u && p(P_stride) == 0u) {
        atomicStore(&scratch[p(P_scanTotals) + group.x], scan_tile[1023]);
    }
}
@compute @workgroup_size(${workgroupSize})
fn scan_add(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let i = index(id, groups);
    if (i >= p(P_length) || i < 1024u) { return; }
    atomicAdd(&scratch[p(P_output) + i], atomicLoad(&scratch[p(P_scanTotals) + i / 1024u - 1u]));
}
`;
}
