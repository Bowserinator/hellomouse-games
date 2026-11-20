import { FIELD, FIXED_WGSL, META, STATE_FIELDS } from '../fixed.js';
import { ENTITY, ENTITY_WORDS, MAX_ENTITIES, PARAM } from '../layout.js';
import { UNIT, UNIT_STRIDE } from '../entity/registry.js';
import { VARIANT_WGSL } from '../variants.js';
import { DEFS_WGSL, STATIC_PARAMS } from '../defs.js';

export function common(workgroupSize: number): string {
    if (![64, 128, 256].includes(workgroupSize)) throw Error('Unsupported compute workgroup size');
    return `${FIXED_WGSL}
${VARIANT_WGSL}
${DEFS_WGSL}
${Object.entries(PARAM).map(([name, value]) => `const P_${name}: u32 = ${value}u;`).join('\n')}
${Object.entries(FIELD).map(([name, value]) => `const F_${name}: u32 = ${value}u;`).join('\n')}
const STATE_FIELDS: u32 = ${STATE_FIELDS}u;
const MAX_ENTITIES: u32 = ${MAX_ENTITIES}u;
const ENTITY_WORDS: u32 = ${ENTITY_WORDS}u;
${Object.entries(ENTITY).map(([name, value]) => `const E_${name}: u32 = ${value}u;`).join('\n')}
${Object.entries(UNIT).map(([name, value]) => `const U_${name}: u32 = ${value}u;`).join('\n')}
fn entity(id: u32) -> u32 { return u32(defs[D_entities]) + id * ENTITY_WORDS; }
fn entity_def(id: u32) -> u32 { return u32(defs[D_unit]) + u32(atomicLoad(&extra[entity(id) + E_def])) * ${UNIT_STRIDE}u; }
fn is_live(id: u32) -> bool {
    return id < MAX_ENTITIES && atomicLoad(&extra[entity(id) + E_state]) != 0 &&
        atomicLoad(&extra[entity(id) + E_hp]) > 0;
}
fn is_active(id: u32) -> bool { return is_live(id) && atomicLoad(&extra[entity(id) + E_state]) == 1; }
fn occupancy(cell: u32) -> i32 {
    if (cell >= nav_columns() * u32(defs[D_staticParams + P_rows])) { return -1; }
    let packed = u32(atomicLoad(&extra[u32(defs[D_occupancy]) + cell / 2u]));
    return i32((packed >> ((cell % 2u) * 16u)) & 65535u) - 1;
}
fn target_tag(id: u32) -> i32 {
    let kind = meta_target(current(F_meta, id)); let victim = current(F_tgt, id);
    if (kind != 2 || victim < 0 || victim >= i32(MAX_ENTITIES)) { return kind; }
    return kind | i32((u32(atomicLoad(&extra[entity(u32(victim)) + E_flags])) >> 8u) << 2u);
}
fn entity_in_range(id: u32, x: i32, z: i32, range: i32) -> bool {
    let at = entity(id); let def = entity_def(id);
    let rotated = (atomicLoad(&extra[at + E_rotation]) & 1) != 0;
    let width = select(defs[def + U_width], defs[def + U_depth], rotated) * 50;
    let depth = select(defs[def + U_depth], defs[def + U_width], rotated) * 50;
    let dx = max(0, abs(cm(x) - cm(atomicLoad(&extra[at + E_x]))) - width);
    let dz = max(0, abs(cm(z) - cm(atomicLoad(&extra[at + E_z]))) - depth);
    return in_circle(dx, dz, range);
}
fn blocking(cell: u32) -> i32 {
    let id = occupancy(cell);
    if (id < 0 || id >= i32(MAX_ENTITIES)) { return -1; }
    if (atomicLoad(&extra[entity(u32(id)) + E_state]) == 0 || defs[entity_def(u32(id)) + U_blocks] == 0) { return -1; }
    return id;
}
${Object.entries(META).map(([name, { shift, mask }]) => `
fn meta_${name}(word: i32) -> i32 { return (word >> ${shift}u) & ${mask}; }
fn set_${name}(id: u32, value: i32) {
    let word = current(F_meta, id);
    put(F_meta, id, (word & ~${mask << shift}) | ((value & ${mask}) << ${shift}u));
}`).join('\n')}
struct Params { values: array<vec4<u32>, 16> }
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> previous: array<i32>;
@group(0) @binding(2) var<storage, read_write> next: array<i32>;
@group(0) @binding(3) var<storage, read> nav: array<u32>;
@group(0) @binding(4) var<storage, read_write> field_a: array<u32>;
@group(0) @binding(5) var<storage, read_write> field_b: array<u32>;
@group(0) @binding(6) var<storage, read_write> scratch: array<atomic<u32>>;
@group(0) @binding(7) var<storage, read> defs: array<i32>;
@group(0) @binding(8) var<storage, read_write> extra: array<atomic<i32>>;
fn p(i: u32) -> u32 {
    switch i {
        case ${STATIC_PARAMS.map(name => `P_${name}`).join(', ')}: { return u32(defs[D_staticParams + i]); }
        default: { return params.values[i / 4u][i % 4u]; }
    }
}
fn zombie_def(kind: i32) -> u32 { return u32(defs[D_zombie]) + u32(kind) * VARIANT_STRIDE; }
fn cells() -> u32 { return p(P_columns) * p(P_rows); }
fn nav_columns() -> u32 { return u32(defs[D_staticParams + P_columns]); }
fn flow_cell(cell: u32) -> u32 {
    let scale = u32(defs[D_flowScale]);
    return (cell / nav_columns() / scale) * u32(defs[D_flowColumns]) + cell % nav_columns() / scale;
}
fn flow_base_cost(cell: u32) -> u32 {
    let scale = u32(defs[D_flowScale]);
    let origin = vec2<u32>(cell % u32(defs[D_flowColumns]), cell / u32(defs[D_flowColumns])) * scale;
    var value = 1u;
    for (var z = origin.y; z < min(origin.y + scale, u32(defs[D_staticParams + P_rows])); z++) {
        for (var x = origin.x; x < min(origin.x + scale, nav_columns()); x++) {
            let sample = cost(z * nav_columns() + x);
            if (sample == 0u) { return 0u; }
            value = max(value, sample);
        }
    }
    return value;
}
fn index(id: vec3<u32>, groups: vec3<u32>) -> u32 { return id.x + id.y * groups.x * ${workgroupSize}u; }
fn old(f: u32, id: u32) -> i32 { return previous[f * p(P_count) + id]; }
fn current(f: u32, id: u32) -> i32 { return next[f * p(P_count) + id]; }
fn put(f: u32, id: u32, value: i32) { next[f * p(P_count) + id] = value; }
fn base_cost(i: u32) -> u32 { return (nav[i / 4u] >> ((i % 4u) * 8u)) & 127u; }
fn cost(i: u32) -> u32 {
    let value = base_cost(i);
    let body = blocking(i);
    if (value != 0u && body >= 0 && defs[entity_def(u32(body)) + U_kind] != 2) { return 120u; }
    return value;
}
fn flow_cost(i: u32) -> u32 {
    var value = flow_base_cost(i);
    let locomotion = p(P_locomotion);
    if (p(P_flowRuntime) != 0u) {
        value = (u32(atomicLoad(&extra[u32(defs[D_flowCosts]) + i / 4u])) >> ((i % 4u) * 8u)) & 127u;
    }
    if (locomotion == 0u || value == 0u) { return value; }
    let x = i32(i % p(P_columns)); let z = i32(i / p(P_columns));
    for (var n = 0u; n < 8u; n++) {
        let at = vec2<i32>(x, z) + NEIGHBOURS[n];
        if (at.x < 0 || at.y < 0 || at.x >= i32(p(P_columns)) || at.y >= i32(p(P_rows))) { return 0u; }
        let neighbour = u32(at.y) * p(P_columns) + u32(at.x);
        var neighbour_cost = flow_base_cost(neighbour);
        if (p(P_flowRuntime) != 0u) {
            neighbour_cost = (u32(atomicLoad(&extra[u32(defs[D_flowCosts]) + neighbour / 4u])) >>
                ((neighbour % 4u) * 8u)) & 127u;
        }
        if (neighbour_cost == 0u) { return 0u; }
    }
    return value;
}
fn flow_offset() -> u32 { return p(P_locomotion) * u32(defs[D_flowStride]); }
fn flow_remaining() -> i32 { return atomicLoad(&extra[u32(defs[D_flowControl]) + 1u]); }
fn flow_initial() -> i32 { return defs[D_flowTicks]; }
fn active_distance(cell: u32, locomotion: u32) -> u32 {
    return u32(atomicLoad(&extra[u32(defs[D_flowActive]) + locomotion * u32(defs[D_flowStride]) + flow_cell(cell)]));
}
fn goal(i: u32) -> bool {
    if (p(P_flowGrid) == 0u) { return (nav[i / 4u] & (128u << ((i % 4u) * 8u))) != 0u; }
    let scale = u32(defs[D_flowScale]);
    let origin = vec2<u32>(i % p(P_columns), i / p(P_columns)) * scale;
    for (var z = origin.y; z < min(origin.y + scale, u32(defs[D_staticParams + P_rows])); z++) {
        for (var x = origin.x; x < min(origin.x + scale, nav_columns()); x++) {
            let cell = z * nav_columns() + x;
            if ((nav[cell / 4u] & (128u << ((cell % 4u) * 8u))) != 0u) { return true; }
        }
    }
    return false;
}
fn dist(i: u32, source: u32) -> u32 {
    if (source == 0u) { return field_a[i]; } return field_b[i];
}
fn write_dist(i: u32, destination: u32, value: u32) {
    if (destination == 0u) { field_a[i] = value; } else { field_b[i] = value; }
}
const NEIGHBOURS = array<vec2<i32>, 8>(vec2<i32>(-1,0),vec2<i32>(0,-1),vec2<i32>(1,0),vec2<i32>(0,1),
    vec2<i32>(-1,-1),vec2<i32>(1,-1),vec2<i32>(1,1),vec2<i32>(-1,1));
const DIRECTIONS = array<vec2<i32>, 8>(vec2<i32>(-16384,0),vec2<i32>(0,-16384),vec2<i32>(16384,0),
    vec2<i32>(0,16384),vec2<i32>(-11585,-11585),vec2<i32>(11585,-11585),
    vec2<i32>(11585,11585),vec2<i32>(-11585,11585));
fn cell_at(x: i32, z: i32) -> u32 {
    if (x < 0 || z < 0 || x >= i32(p(P_widthQ)) || z >= i32(p(P_depthQ))) { return 4294967295u; }
    return u32(z) / p(P_cellQ) * p(P_columns) + u32(x) / p(P_cellQ);
}
fn walkable(x: i32, z: i32) -> bool {
    let cell = cell_at(x, z);
    if (cell == 4294967295u) { return false; } return cost(cell) != 0u;
}
fn step_allowed(x: i32, z: i32, delta: vec2<i32>) -> bool {
    let nx = x + delta.x; let nz = z + delta.y;
    if (nx < 0 || nz < 0 || nx >= i32(p(P_columns)) || nz >= i32(p(P_rows))) { return false; }
    if (cost(u32(nz) * p(P_columns) + u32(nx)) == 0u) { return false; }
    if (delta.x != 0 && delta.y != 0) {
        if (cost(u32(z) * p(P_columns) + u32(nx)) == 0u ||
            cost(u32(nz) * p(P_columns) + u32(x)) == 0u) { return false; }
    }
    return true;
}
fn direction(cell: u32, locomotion: u32) -> vec2<i32> {
    let coarse = flow_cell(cell);
    let offset = locomotion * u32(defs[D_flowStride]) + u32(defs[D_flowColumns] * defs[D_flowRows]) + coarse / 4u;
    let packed = u32(atomicLoad(&extra[u32(defs[D_flowActive]) + offset]));
    let dir = (packed >> ((coarse % 4u) * 8u)) & 255u;
    if (dir >= 8u) { return vec2<i32>(0); } return DIRECTIONS[dir];
}
fn spatial_cell(x: i32, z: i32) -> u32 {
    let gx = min(u32(max(x, 0)) / p(P_gridCellQ), p(P_gridColumns) - 1u);
    let gz = min(u32(max(z, 0)) / p(P_gridCellQ), p(P_gridRows) - 1u);
    return gz * p(P_gridColumns) + gx;
}
`;
}
