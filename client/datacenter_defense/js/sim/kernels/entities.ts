import { MAX_ROW } from '../commands.js';
import { BALANCE } from '../balance.js';
import { MINE_BLAST } from '../content/weapons.js';
import { POWER_STORAGE } from '../content/index.js';
import { ENTITY_DESTROYED, GHOST_STRIDE, MAX_GHOSTS, RENDER_EXPLOSION_WORDS } from '../layout.js';

export function entityKernels(workgroupSize: number): string {
    return `
fn occupancy_set(cell: u32, id: i32) {
    let at = u32(defs[D_occupancy]) + cell / 2u;
    let shift = (cell % 2u) * 16u;
    let packed = u32(atomicLoad(&extra[at]));
    atomicStore(&extra[at], i32((packed & ~(65535u << shift)) | (u32(id + 1) << shift)));
}
fn free_entity(id: u32) {
    let at = entity(id); let def = entity_def(id);
    unit_occupancy(id,vec2<i32>(atomicLoad(&extra[at + E_x]),atomicLoad(&extra[at + E_z])),false);
    atomicStore(&extra[at + E_state], 0); atomicStore(&extra[at + E_hp], 0);
    economy_caps();
    for (var mount = 0u; mount < 4u; mount++) {
        atomicStore(&extra[u32(defs[D_beams]) + (id * 4u + mount) * 8u], 0);
    }
    if (defs[def + U_blocks] != 0 && defs[def + U_kind] != 2) {
        atomicStore(&extra[u32(defs[D_flowControl])], 1);
        atomicAdd(&extra[u32(defs[D_flowControl]) + 2u], 1);
    }
}
fn has_builder(command: u32, use_objective: bool, tier: i32, centre: vec2<i32>, ranged: bool) -> bool {
    let metres = centre / Q;
    let objective = vec2<i32>(i32(p(P_objectiveX)),i32(p(P_objectiveZ))) / Q;
    let delta = metres - objective;
    let radius = defs[D_objectiveBuildRadius];
    if (use_objective && atomicLoad(&extra[0]) > 0 && eco(C_objectiveTier) >= tier &&
        (!ranged || in_circle(delta.x,delta.y,radius))) { return true; }
    for (var id = 0u; id < min(MAX_ENTITIES,u32(atomicLoad(&extra[2]))); id++) {
        let at = entity(id);
        if (!selected_entity(command,id) || !is_active(id)) { continue; }
        let def = entity_def(id); let reach = defs[def + U_buildRadius];
        if (reach <= 0 || defs[def + U_tier] < tier) { continue; }
        let origin = vec2<i32>(atomicLoad(&extra[at + E_x]),atomicLoad(&extra[at + E_z])) / Q;
        let distance = metres - origin;
        if (!ranged || in_circle(distance.x,distance.y,reach)) { return true; }
    }
    return false;
}
fn placement_def(def_id: i32) -> u32 {
    return u32(defs[D_unit]) + u32(def_id) * u32(defs[D_unitStride]);
}
fn placement_box(def: u32, x: i32, z: i32, rotation: i32) -> vec4<i32> {
    let rotated = (rotation & 1) != 0;
    let size = vec2<i32>(select(defs[def + U_width],defs[def + U_depth],rotated),
        select(defs[def + U_depth],defs[def + U_width],rotated));
    let origin = vec2<i32>(x,z) / Q;
    return vec4<i32>(origin,origin + size);
}
fn placement_clear(def: u32, box: vec4<i32>) -> bool {
    if (p(P_cellQ) != u32(Q) || any(box.xy < vec2<i32>(0)) ||
        any(box.zw > vec2<i32>(i32(p(P_columns)),i32(p(P_rows))))) { return false; }
    let height = defs[def + U_flightHeight];
    if (height > 0) {
        let centre = (box.xy + box.zw) * Q / 2;
        let size = (box.zw - box.xy) * Q;
        if (!flight_clear(centre,size,height,centre)) { return false; }
        for (var other = 0u; other < u32(atomicLoad(&extra[2])); other++) {
            let at = entity(other);
            if (is_live(other) && defs[entity_def(other) + U_flightHeight] > 0 &&
                all(abs(centre - vec2<i32>(atomicLoad(&extra[at + E_x]),atomicLoad(&extra[at + E_z]))) <
                (size + unit_size(other)) / 2)) { return false; }
        }
    } else {
        for (var z = box.y; z < box.w; z++) { for (var x = box.x; x < box.z; x++) {
            let cell = u32(z) * p(P_columns) + u32(x);
            if (base_cost(cell) == 0u || occupancy(cell) >= 0) { return false; }
        } }
    }
    return true;
}
fn ghost_count() -> u32 { return u32(atomicLoad(&extra[u32(defs[D_ghosts])])); }
fn ghost_at(index: u32) -> u32 { return u32(defs[D_ghosts]) + 1u + index * ${GHOST_STRIDE}u; }
fn ghost_box(at: u32) -> vec4<i32> {
    return placement_box(placement_def(atomicLoad(&extra[at])),atomicLoad(&extra[at + 1u]),
        atomicLoad(&extra[at + 2u]),atomicLoad(&extra[at + 3u]));
}
fn copy_ghost(src: u32, dst: u32) {
    for (var word = 0u; word < ${GHOST_STRIDE}u; word++) {
        atomicStore(&extra[ghost_at(dst) + word],atomicLoad(&extra[ghost_at(src) + word]));
    }
}
fn trim_ghosts(count: u32) {
    for (var word = ghost_at(count); word < ghost_at(ghost_count()); word++) { atomicStore(&extra[word],0); }
    atomicStore(&extra[u32(defs[D_ghosts])],i32(count));
}
fn erase_ghost(index: u32) {
    let count = ghost_count();
    for (var j = index + 1u; j < count; j++) { copy_ghost(j,j - 1u); }
    trim_ghosts(count - 1u);
}
fn clear_player_ghosts(source: u32) {
    let count = ghost_count(); var kept = 0u;
    for (var i = 0u; i < count; i++) {
        if (atomicLoad(&extra[ghost_at(i) + 5u]) == i32(source)) { continue; }
        if (kept != i) { copy_ghost(i,kept); }
        kept++;
    }
    trim_ghosts(kept);
}
fn cancel_ghost(x: i32, z: i32, source: u32) {
    for (var i = 0u; i < ghost_count(); i++) {
        let at = ghost_at(i);
        if (atomicLoad(&extra[at + 5u]) == i32(source) && atomicLoad(&extra[at + 1u]) == x &&
            atomicLoad(&extra[at + 2u]) == z) { erase_ghost(i); return; }
    }
}
fn queue_ghost(def_id: i32, x: i32, z: i32, rotation: i32, owner: u32, source: u32, command: u32,
    objective: bool, append: bool) -> bool {
    if (def_id < 0 || def_id >= defs[D_unitCount] ||
        x < 0 || z < 0 || rotation < 0 || rotation > 3) { return false; }
    let def = placement_def(def_id); let box = placement_box(def,x,z,rotation);
    if (defs[def + U_kind] == 6 || !placement_clear(def,box) ||
        !has_builder(command,objective,defs[def + U_tier],(box.xy + box.zw) * Q / 2,true)) { return false; }
    var kept = 0u;
    for (var i = 0u; i < ghost_count(); i++) {
        let at = ghost_at(i);
        if (!append && atomicLoad(&extra[at + 5u]) == i32(source)) { continue; }
        let other = ghost_box(at);
        if (all(box.xy < other.zw) && all(other.xy < box.zw)) { return false; }
        kept++;
    }
    if (kept >= ${MAX_GHOSTS}u) { return false; }
    if (!append) { clear_player_ghosts(source); }
    let at = ghost_at(kept);
    atomicStore(&extra[at],def_id);
    atomicStore(&extra[at + 1u],box.x * Q); atomicStore(&extra[at + 2u],box.y * Q);
    atomicStore(&extra[at + 3u],rotation);
    atomicStore(&extra[at + 4u],i32(owner)); atomicStore(&extra[at + 5u],i32(source));
    atomicStore(&extra[u32(defs[D_ghosts])],i32(kept + 1u));
    return true;
}
fn spawn_ghost(index: u32, def: u32, box: vec4<i32>) -> i32 {
    if (!placement_clear(def,box)) { erase_ghost(index); return -1; }
    let ghost = ghost_at(index);
    let def_id = atomicLoad(&extra[ghost]); let rotation = atomicLoad(&extra[ghost + 3u]);
    let owner = atomicLoad(&extra[ghost + 4u]); let source = atomicLoad(&extra[ghost + 5u]);
    let flying = defs[def + U_flightHeight] > 0;
    let x0 = box.x; let z0 = box.y; let width = box.z - x0; let depth = box.w - z0;
    var id = 0u;
    while (id < MAX_ENTITIES && atomicLoad(&extra[entity(id) + E_state]) != 0) { id++; }
    if (id == MAX_ENTITIES) { return -2; }
    erase_ghost(index);
    let at = entity(id);
    let generation = ((u32(atomicLoad(&extra[at + E_flags])) >> 8u) + 1u) & 16777215u;
    for (var word = 0u; word < ENTITY_WORDS; word++) { atomicStore(&extra[at + word], 0); }
    atomicStore(&extra[at + E_flags], i32(generation << 8u));
    for (var word = 0u; word < 4u; word++) {
        atomicStore(&extra[u32(defs[D_unitRecovery]) + id * 4u + word],0);
    }
    atomicStore(&extra[at + E_state], 2); atomicStore(&extra[at + E_owner], owner);
    atomicStore(&extra[at + E_buildTask], -1); atomicStore(&extra[at + E_decay], i32(p(P_tick)));
    atomicStore(&extra[at + E_def], def_id);
    atomicStore(&extra[at + E_x], x0 * Q + width * Q / 2);
    atomicStore(&extra[at + E_z], z0 * Q + depth * Q / 2);
    atomicStore(&extra[at + E_facing], rotation * 16384);
    atomicStore(&extra[at + E_hp], 1);
    atomicStore(&extra[at + E_power], 0);
    atomicStore(&extra[at + E_rotation], rotation | (source << 2u));
    atomicStore(&extra[at + E_timer], i32(p(P_tick)) + defs[def + U_armTicks]);
    atomicStore(&extra[2], max(atomicLoad(&extra[2]), i32(id + 1u)));
    for (var dz = 0; dz < depth; dz++) { for (var dx = 0; dx < width; dx++) {
        if (!flying) { occupancy_set(u32(z0 + dz) * p(P_columns) + u32(x0 + dx), i32(id)); }
    } }
    for (var mount = 0u; mount < 4u; mount++) {
        let weapon = u32(defs[D_weaponState]) + (id * 4u + mount) * 8u;
        for (var word = 0u; word < 8u; word++) { atomicStore(&extra[weapon + word], 0); }
        atomicStore(&extra[weapon + 1u], rotation * 16384); atomicStore(&extra[weapon + 2u], -1);
    }
    if (defs[def + U_blocks] != 0 && defs[def + U_kind] != 2) {
        atomicStore(&extra[u32(defs[D_flowControl])], 1);
        atomicAdd(&extra[u32(defs[D_flowControl]) + 2u], 1);
    }
    return i32(id);
}
fn place_row(def_id: i32, x0: i32, z0: i32, x1: i32, z1: i32, owner: u32, source: u32, command: u32,
    objective: bool, append: bool) {
    if (def_id < 0 || def_id >= defs[D_unitCount] || min(min(x0,z0),min(x1,z1)) < 0 ||
        max(x0,x1) / Q > i32(p(P_columns)) || max(z0,z1) / Q > i32(p(P_rows))) { return; }
    let def = u32(defs[D_unit]) + u32(def_id) * u32(defs[D_unitStride]);
    let dx = x1 / Q - x0 / Q; let dz = z1 / Q - z0 / Q;
    let width = max(1,defs[def + U_width]); let depth = max(1,defs[def + U_depth]);
    let along_x = abs(dx) * depth >= abs(dz) * width;
    let intervals = select(abs(dz) / depth,abs(dx) / width,along_x);
    let count = min(${MAX_ROW}, intervals + 1);
    for (var i = 0; i < count; i++) {
        let travel = i * select(depth,width,along_x);
        var offset = vec2<i32>(travel,abs(dz) * travel / max(1,abs(dx)));
        if (!along_x) { offset = vec2<i32>(abs(dx) * travel / max(1,abs(dz)),travel); }
        let x = (x0 / Q + sign(dx) * offset.x) * Q;
        let z = (z0 / Q + sign(dz) * offset.y) * Q;
        if (!queue_ghost(def_id,x,z,0,owner,source,command,objective,append || i > 0)) { break; }
    }
}
@compute @workgroup_size(${workgroupSize})
fn clear_entities(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let i = index(id, groups); if (i >= MAX_ENTITIES) { return; }
    atomicStore(&extra[u32(defs[D_entityDamage]) + i], 0);
    atomicStore(&extra[u32(defs[D_powerDrain]) + i], 0);
}
@compute @workgroup_size(1)
fn shield_prepare() {
    let base = u32(defs[D_shields]); var count = 0u;
    for (var id = 0u; id < min(MAX_ENTITIES,u32(atomicLoad(&extra[2]))); id++) {
        let at = entity(id);
        if (atomicLoad(&extra[at + E_state]) == 1 && defs[entity_def(id) + U_kind] == 4 &&
            atomicLoad(&extra[at + E_power]) > 0) {
            count++; atomicStore(&extra[base + count],i32(id));
        }
    }
    atomicStore(&extra[base],i32(count));
}
@compute @workgroup_size(${workgroupSize})
fn sonic_force(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let emitter = index(id,groups); if (emitter >= MAX_ENTITIES) { return; }
    let at = entity(emitter); let def = entity_def(emitter);
    if (atomicLoad(&extra[at + E_state]) != 1 || defs[def + U_kind] != 4 ||
        atomicLoad(&extra[at + E_power]) <= 0) { return; }
    let radius = cm(defs[def + U_sonicRadius]); if (radius <= 0) { return; }
    let origin = vec2<i32>(atomicLoad(&extra[at + E_x]),atomicLoad(&extra[at + E_z]));
    var query = target_query(origin - vec2<i32>(defs[def + U_sonicRadius]),
        origin + vec2<i32>(defs[def + U_sonicRadius]), false);
    loop {
        let victim = target_next(&query); if (victim < 0) { break; }
        let zombie = u32(victim); if (current(F_hp,zombie) <= 0) { continue; }
        let delta = vec2<i32>(cm(current(F_x,zombie)) - cm(origin.x),cm(current(F_z,zombie)) - cm(origin.y));
        let boundary = radius + cm(defs[zombie_def(meta_variant(current(F_meta,zombie))) + 2u]);
        if (max(abs(delta.x),abs(delta.y)) >= boundary) { continue; }
        let distance = i32(root(u32(delta.x * delta.x + delta.y * delta.y)));
        if (distance >= boundary) { continue; }
        atomicMin(&extra[u32(defs[D_sonicAggro]) + zombie * 3u + 2u],i32(emitter));
        var normal = LUT[random(p(P_seed),zombie,p(P_tick),emitter) & 255u] * 4;
        if (distance > 0) { normal = delta * Q / distance; }
        let limit = defs[def + U_pushSpeed] / 20;
        let strength = max(mul_q(limit,max(0,radius - distance) * Q / radius),
            min(limit,(boundary - distance + 2) * Q / 100));
        atomicAdd(&extra[u32(defs[D_sonicForce]) + zombie * 2u],mul_q(normal.x,strength));
        atomicAdd(&extra[u32(defs[D_sonicForce]) + zombie * 2u + 1u],mul_q(normal.y,strength));
    }
}
@compute @workgroup_size(${workgroupSize})
fn runover_damage(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let vehicle = index(id,groups); if (vehicle >= MAX_ENTITIES) { return; }
    let at = entity(vehicle); let def = entity_def(vehicle);
    if (!is_active(vehicle) || atomicLoad(&extra[at + E_speed]) == 0 ||
        defs[def + U_runoverDamage] <= 0) { return; }
    let position = vec2<i32>(atomicLoad(&extra[at + E_x]),atomicLoad(&extra[at + E_z]));
    let extent = unit_size(vehicle) / 2;
    var query = target_query(position - extent - vec2<i32>(Q),position + extent + vec2<i32>(Q), false);
    loop {
        let victim = target_next(&query); if (victim < 0) { break; }
        let zombie = u32(victim); if (current(F_hp,zombie) <= 0) { continue; }
        let radius = defs[zombie_def(meta_variant(current(F_meta,zombie))) + 2u];
        if (all(abs(vec2<i32>(current(F_x,zombie),current(F_z,zombie)) - position) <= extent + vec2<i32>(radius))) {
            damage_zombie(zombie,defs[def + U_runoverDamage],atomicLoad(&extra[at + E_owner]));
        }
    }
}
fn storage_blast(id: u32) {
    let at = entity(id);
    let origin = vec2<i32>(atomicLoad(&extra[at + E_x]),atomicLoad(&extra[at + E_z]));
    let radius = ${BALANCE.powerStorageBlast.radius} * Q;
    let damage = ${BALANCE.powerStorageBlast.damage};
    let end = u32(defs[D_projectileCountMax]);
    for (var slot = end - 2048u; slot < end; slot++) {
        let flash = u32(defs[D_explosions]) + slot * ${RENDER_EXPLOSION_WORDS}u;
        if (atomicLoad(&extra[shot_at(slot)]) != 0 || atomicLoad(&extra[flash]) == i32(p(P_tick)) + 1) { continue; }
        atomicStore(&extra[flash],i32(p(P_tick)) + 1);
        atomicStore(&extra[flash + 1u],origin.x); atomicStore(&extra[flash + 2u],origin.y);
        atomicStore(&extra[flash + 3u],0); atomicStore(&extra[flash + 4u],radius);
        atomicStore(&extra[flash + 5u],${MINE_BLAST});
        break;
    }
    var query = target_query(origin - vec2<i32>(radius),origin + vec2<i32>(radius),true);
    loop {
        let next = target_next(&query); if (next < 0) { break; }
        let victim = u32(next);
        if (current(F_hp,victim) <= 0 || !in_circle(current(F_x,victim) - origin.x,current(F_z,victim) - origin.y,radius)) { continue; }
        atomicAdd(&extra[p(P_damage) + victim],damage);
        atomicMin(&extra[p(P_credits) + victim],atomicLoad(&extra[at + E_owner]));
    }
    for (var other = 0u; other < min(MAX_ENTITIES,u32(atomicLoad(&extra[2]))); other++) {
        if (!is_live(other) || defs[entity_def(other) + U_flightHeight] > radius) { continue; }
        if (entity_in_range(other,origin.x,origin.y,cm(radius))) {
            atomicAdd(&extra[u32(defs[D_entityDamage]) + other],damage);
        }
    }
    if (in_circle(origin.x - i32(p(P_objectiveX)),origin.y - i32(p(P_objectiveZ)),radius + i32(p(P_objectiveRadius)))) {
        atomicAdd(&scratch[2],u32(damage));
    }
}
@compute @workgroup_size(1)
fn apply_entity_damage() {
    let count = min(MAX_ENTITIES,u32(atomicLoad(&extra[2])));
    loop {
        var exploded = false;
        for (var id = 0u; id < count; id++) {
            let at = entity(id);
            if (!is_live(id)) { continue; }
            let damage_at = u32(defs[D_entityDamage]) + id;
            let damage = max(0,atomicLoad(&extra[damage_at]));
            atomicStore(&extra[damage_at],0);
            let hp = max(0,atomicLoad(&extra[at + E_hp]) - damage);
            atomicStore(&extra[at + E_hp],hp);
            if (hp != 0) { continue; }
            let complete = atomicLoad(&extra[at + E_state]) != 2;
            free_entity(id);
            atomicStore(&extra[at + E_flags],atomicLoad(&extra[at + E_flags]) | ${ENTITY_DESTROYED});
            if (complete && atomicLoad(&extra[at + E_def]) == ${POWER_STORAGE}) {
                storage_blast(id); exploded = true;
            }
        }
        if (!exploded) { break; }
    }
    for (var id = 0u; id < count; id++) {
        let at = entity(id);
        if (!is_live(id)) { continue; }
        let def = entity_def(id);
        if (defs[def + U_kind] == 4 && atomicLoad(&extra[at + E_state]) != 2) {
            if (atomicLoad(&extra[at + E_state]) == 3) {
                if (i32(p(P_tick)) >= atomicLoad(&extra[at + E_timer])) {
                    atomicStore(&extra[at + E_power],defs[def + U_power]);
                    atomicStore(&extra[at + E_state],1);
                }
            } else {
                let power = max(0,atomicLoad(&extra[at + E_power]) -
                    max(0,atomicLoad(&extra[u32(defs[D_powerDrain]) + id])));
                atomicStore(&extra[at + E_power],power);
                if (power == 0) {
                    atomicStore(&extra[at + E_state],3);
                    atomicStore(&extra[at + E_timer],i32(p(P_tick)) + defs[def + U_recharge]);
                }
            }
        }
    }
}
`;
}
