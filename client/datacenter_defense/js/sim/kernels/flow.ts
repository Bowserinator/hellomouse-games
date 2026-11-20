export function flowKernels(workgroupSize: number): string {
    return `
var<workgroup> tile_a: array<u32, 324>;
var<workgroup> tile_b: array<u32, 324>;
var<workgroup> flow_enabled: u32;
var<workgroup> tile_cost: array<u32, 324>;
var<workgroup> tile_moves: array<u32, 256>;
var<workgroup> iteration_changed: atomic<u32>;
var<workgroup> tile_changed: atomic<u32>;
fn tile_count() -> u32 { return ((p(P_columns) + 15u) / 16u) * ((p(P_rows) + 15u) / 16u); }
fn tile_flags(field: u32) -> u32 {
    return u32(defs[D_flowTiles]) + (p(P_locomotion) * 2u + field) * tile_count();
}
fn flow_step_allowed(x: i32, z: i32, delta: vec2<i32>) -> bool {
    let at = vec2<i32>(x, z) + delta;
    if (at.x < 0 || at.y < 0 || at.x >= i32(p(P_columns)) || at.y >= i32(p(P_rows))) { return false; }
    if (flow_cost(u32(at.y) * p(P_columns) + u32(at.x)) == 0u) { return false; }
    if (delta.x != 0 && delta.y != 0) {
        if (flow_cost(u32(z) * p(P_columns) + u32(at.x)) == 0u ||
            flow_cost(u32(at.y) * p(P_columns) + u32(x)) == 0u) { return false; }
    }
    return true;
}
fn flow_arguments(slot: u32, count: u32, enabled: bool) {
    let groups = select(0u, (count + ${workgroupSize - 1}u) / ${workgroupSize}u, enabled);
    let at = p(P_flowArgs) + slot * 3u;
    atomicStore(&scratch[at], min(65535u, groups));
    atomicStore(&scratch[at + 1u], max(1u, (groups + 65534u) / 65535u));
    atomicStore(&scratch[at + 2u], 1u);
}
@compute @workgroup_size(1)
fn flow_rebuild_begin() {
    let control = u32(defs[D_flowControl]);
    if (atomicLoad(&extra[control]) != 0 && atomicLoad(&extra[control + 1u]) == 0) {
        atomicStore(&extra[control], 0);
        atomicStore(&extra[control + 1u], max(1, defs[D_flowTicks]));
        for (var i = 0u; i < tile_count() * u32(defs[D_flowClasses]) * 2u; i++) {
            atomicStore(&extra[u32(defs[D_flowTiles]) + i],0);
        }
    }
    let remaining = atomicLoad(&extra[control + 1u]);
    flow_arguments(0u, (cells() + 3u) / 4u, remaining == defs[D_flowTicks]);
    flow_arguments(1u, cells(), remaining == defs[D_flowTicks]);
    flow_arguments(3u, (cells() + 3u) / 4u, remaining == 1);
    flow_arguments(4u, u32(defs[D_flowStride] * defs[D_flowClasses]), remaining == 1);
    let at = p(P_flowArgs) + 6u;
    atomicStore(&scratch[at], select(0u, (p(P_columns) + 15u) / 16u, remaining > 0));
    atomicStore(&scratch[at + 1u], (p(P_rows) + 15u) / 16u);
    atomicStore(&scratch[at + 2u], 1u);
}
@compute @workgroup_size(${workgroupSize})
fn flow_capture(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    if (p(P_flowRuntime) != 0u && flow_remaining() != flow_initial()) { return; }
    let word = index(id, groups);
    if (word >= (cells() + 3u) / 4u) { return; }
    let previous = u32(atomicLoad(&extra[u32(defs[D_flowCosts]) + word]));
    var packed = 0u;
    for (var lane = 0u; lane < 4u; lane++) {
        let cell = word * 4u + lane;
        if (cell >= cells()) { continue; }
        let value = flow_base_cost(cell); packed |= value << (lane * 8u);
        if (value != ((previous >> (lane * 8u)) & 255u)) {
            let tile = (cell / p(P_columns) / 16u) * ((p(P_columns) + 15u) / 16u) + cell % p(P_columns) / 16u;
            for (var bank = 0u; bank < u32(defs[D_flowClasses]) * 2u; bank++) {
                atomicOr(&extra[u32(defs[D_flowTiles]) + bank * tile_count() + tile],1);
            }
        }
    }
    atomicStore(&extra[u32(defs[D_flowCosts]) + word], i32(packed));
}
@compute @workgroup_size(${workgroupSize})
fn flow_reset(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    if (p(P_flowRuntime) != 0u && flow_remaining() != flow_initial()) { return; }
    let cell = index(id, groups);
    if (cell >= cells()) { return; }
    if (p(P_flowRuntime) == 0u && cell < tile_count()) {
        atomicStore(&extra[tile_flags(0u) + cell], 1);
        atomicStore(&extra[tile_flags(1u) + cell], 1);
    }
    var value = select(INF, 0u, goal(cell) && flow_cost(cell) != 0u);
    if (p(P_flowRuntime) != 0u) {
        value = u32(atomicLoad(&extra[u32(defs[D_flowActive]) + flow_offset() + cell]));
    }
    write_dist(flow_offset() + cell, 0u, value); write_dist(flow_offset() + cell, 1u, value);
}
@compute @workgroup_size(${workgroupSize})
fn flow_commit(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    if (p(P_flowRuntime) != 0u && atomicLoad(&extra[u32(defs[D_flowControl]) + 1u]) != 1) { return; }
    let at = index(id, groups);
    if (at < u32(defs[D_flowStride]) * u32(defs[D_flowClasses])) {
        atomicStore(&extra[u32(defs[D_flowActive]) + at], i32(dist(at, p(P_field))));
    }
}
@compute @workgroup_size(1)
fn flow_rebuild_finish() {
    let control = u32(defs[D_flowControl]) + 1u;
    let remaining = atomicLoad(&extra[control]);
    if (remaining > 0) { atomicStore(&extra[control], remaining - 1); }
}
@compute @workgroup_size(${workgroupSize})
fn flow_relax(@builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) tile: vec3<u32>) {
    if (lane == 0u) {
        flow_enabled = 1u;
        if (p(P_flowRuntime) != 0u) {
            flow_enabled = 0u;
            let columns = (p(P_columns) + 15u) / 16u; let rows = (p(P_rows) + 15u) / 16u;
            if (flow_remaining() > 0) {
                for (var z = max(0, i32(tile.y) - 1); z <= min(i32(rows) - 1, i32(tile.y) + 1); z++) {
                    for (var x = max(0, i32(tile.x) - 1); x <= min(i32(columns) - 1, i32(tile.x) + 1); x++) {
                        flow_enabled |= u32(atomicLoad(&extra[tile_flags(p(P_field)) + u32(z) * columns + u32(x)]));
                    }
                }
            }
            atomicStore(&extra[tile_flags(1u - p(P_field)) + tile.y * columns + tile.x], 0);
        }
        atomicStore(&tile_changed, 0u);
    }
    let enabled = workgroupUniformLoad(&flow_enabled);
    if (enabled == 0u) { return; }
    let origin = vec2<i32>(tile.xy * 16u);
    for (var i = lane; i < 324u; i += ${workgroupSize}u) {
        let at = origin + vec2<i32>(i32(i % 18u) - 1, i32(i / 18u) - 1);
        var value = INF; var cost_value = 0u;
        if (at.x >= 0 && at.y >= 0 && at.x < i32(p(P_columns)) && at.y < i32(p(P_rows))) {
            let cell = u32(at.y) * p(P_columns) + u32(at.x);
            value = dist(flow_offset() + cell, p(P_field));
            cost_value = flow_cost(cell) | select(0u, 128u, goal(cell));
        }
        tile_a[i] = value; tile_b[i] = value; tile_cost[i] = cost_value;
    }
    workgroupBarrier();
    for (var i = lane; i < 256u; i += ${workgroupSize}u) {
        let at = (i / 16u + 1u) * 18u + i % 16u + 1u;
        var mask = 0u;
        for (var n = 0u; n < 8u; n++) {
            let delta = NEIGHBOURS[n]; let neighbour = u32(i32(at) + delta.y * 18 + delta.x);
            if ((tile_cost[neighbour] & 127u) == 0u) { continue; }
            if (delta.x != 0 && delta.y != 0 &&
                ((tile_cost[u32(i32(at) + delta.x)] & 127u) == 0u ||
                 (tile_cost[u32(i32(at) + delta.y * 18)] & 127u) == 0u)) { continue; }
            mask |= 1u << n;
        }
        tile_moves[i] = mask;
    }
    workgroupBarrier();
    for (var iteration = 0u; iteration < 16u; iteration++) {
        if (lane == 0u) { atomicStore(&iteration_changed, 0u); }
        workgroupBarrier();
        for (var i = lane; i < 256u; i += ${workgroupSize}u) {
            let xy = vec2<i32>(i32(i % 16u), i32(i / 16u));
            let at = origin + xy;
            let local_cell = u32(xy.y + 1) * 18u + u32(xy.x + 1);
            var best = INF;
            if (at.x < i32(p(P_columns)) && at.y < i32(p(P_rows))) {
                if ((tile_cost[local_cell] & 127u) != 0u) {
                    if ((tile_cost[local_cell] & 128u) != 0u) { best = 0u; }
                    else {
                        for (var n = 0u; n < 8u; n++) {
                            let delta = NEIGHBOURS[n];
                            if ((tile_moves[i] & (1u << n)) == 0u) { continue; }
                            let neighbour = u32(i32(local_cell) + delta.y * 18 + delta.x);
                            var value = tile_a[neighbour];
                            if ((iteration & 1u) != 0u) { value = tile_b[neighbour]; }
                            let movement = select(10u, 14u, n >= 4u) * (tile_cost[local_cell] & 127u);
                            if (value < INF - movement) { best = min(best, value + movement); }
                        }
                    }
                }
            }
            var previous = tile_a[local_cell];
            if ((iteration & 1u) != 0u) { previous = tile_b[local_cell]; }
            if (best != previous) { atomicOr(&iteration_changed, 1u); }
            if ((iteration & 1u) == 0u) { tile_b[local_cell] = best; }
            else { tile_a[local_cell] = best; }
        }
        workgroupBarrier();
        if (lane == 0u) { flow_enabled = atomicLoad(&iteration_changed); }
        if (workgroupUniformLoad(&flow_enabled) == 0u) { break; }
    }
    for (var i = lane; i < 256u; i += ${workgroupSize}u) {
        let at = origin + vec2<i32>(i32(i % 16u), i32(i / 16u));
        if (at.x >= i32(p(P_columns)) || at.y >= i32(p(P_rows))) { continue; }
        let cell = u32(at.y) * p(P_columns) + u32(at.x);
        let value = tile_a[(i / 16u + 1u) * 18u + i % 16u + 1u];
        if (value != dist(flow_offset() + cell, p(P_field))) {
            atomicOr(&scratch[0], 1u); atomicOr(&tile_changed, 1u);
        }
        write_dist(flow_offset() + cell, 1u - p(P_field), value);
    }
    workgroupBarrier();
    if (lane == 0u && p(P_flowRuntime) != 0u) {
        let columns = (p(P_columns) + 15u) / 16u;
        atomicStore(&extra[tile_flags(1u - p(P_field)) + tile.y * columns + tile.x], i32(atomicLoad(&tile_changed)));
    }
}
@compute @workgroup_size(${workgroupSize})
fn flow_dirs(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    if (p(P_flowRuntime) != 0u && flow_remaining() != 1) { return; }
    let word = index(id, groups);
    if (word >= (cells() + 3u) / 4u) { return; }
    var packed = 0u;
    for (var lane = 0u; lane < 4u; lane++) {
        let cell = word * 4u + lane;
        var direction_index = 255u;
        if (cell < cells() && flow_cost(cell) != 0u && !goal(cell) && dist(flow_offset() + cell, p(P_field)) < INF) {
            let x = i32(cell % p(P_columns)); let z = i32(cell / p(P_columns));
            var best = INF;
            for (var n = 0u; n < 8u; n++) {
                let delta = NEIGHBOURS[n];
                if (!flow_step_allowed(x, z, delta)) { continue; }
                let neighbour = u32(z + delta.y) * p(P_columns) + u32(x + delta.x);
                let value = dist(flow_offset() + neighbour, p(P_field));
                let step_cost = select(10u, 14u, n >= 4u) * flow_cost(cell);
                if (value < dist(flow_offset() + cell, p(P_field)) && value < INF - step_cost && value + step_cost < best) {
                    best = value + step_cost; direction_index = n;
                }
            }
        }
        packed |= direction_index << (lane * 8u);
    }
    write_dist(flow_offset() + cells() + word, p(P_field), packed);
}
`;
}
