import { LOBBY_LIMIT } from '../../shared/protocol.js';
import { SALE_EFFECT_SLOTS } from '../commands.js';
import { abilitiesWGSL } from './abilities.js';
import { ORDER_WORDS, RENDER_AIM_ACTIVE, RENDER_CHARGE_SHIFT, RENDER_BEAM_WORDS, RENDER_ENTITY_WORDS,
    RENDER_PROJECTILE_WORDS, RENDER_PROJECTILE_LAUNCH, RENDER_EXPLOSION_WORDS, RENDER_STORAGE_BONUS,
    RENDER_ZOMBIE_HP_MASK, RENDER_ZOMBIE_STATE_SHIFT } from '../layout.js';

export function tickKernels(workgroupSize: number): string {
    return `${abilitiesWGSL()}
fn fraction_q(value: u32, divisor: u32) -> i32 {
    if (divisor == 0u) { return 0; }
    var remainder = value % divisor;
    if (divisor < 16777216u) {
        let high = remainder << 8u;
        let first = high / divisor;
        let second = ((high % divisor) << 8u) / divisor;
        return i32((first << 8u) | second);
    }
    var result = 0u;
    for (var i = 0u; i < 16u; i++) {
        remainder *= 2u; result *= 2u;
        if (remainder >= divisor) { remainder -= divisor; result += 1u; }
    }
    return i32(result);
}
fn square(value: u32) -> vec2<u32> {
    let lo = value & 65535u; let hi = value >> 16u;
    let bottom = lo * lo; let cross = 2u * lo * hi;
    let lower = bottom + (cross << 16u);
    return vec2<u32>(lower, hi * hi + (cross >> 16u) + select(0u, 1u, lower < bottom));
}
fn in_circle(x: i32, z: i32, radius: i32) -> bool {
    if (abs(x) > radius || abs(z) > radius) { return false; }
    let a = square(u32(abs(x))); let b = square(u32(abs(z))); let r = square(u32(radius));
    let lo = a.x + b.x; let hi = a.y + b.y + select(0u, 1u, lo < a.x);
    return hi < r.y || (hi == r.y && lo <= r.x);
}
@compute @workgroup_size(${workgroupSize})
fn clear_tick(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let i = index(id, groups);
    if (i < p(P_gridColumns) * p(P_gridRows)) { atomicStore(&scratch[p(P_counts) + i], 0u); }
    if (i < u32(defs[D_coarseColumns] * defs[D_coarseRows]) * 4u) {
        atomicStore(&extra[u32(defs[D_density]) + i],0);
    }
    if (i < p(P_count)) {
        atomicStore(&extra[u32(defs[D_sonicAggro]) + i * 3u + 2u],2147483647);
        atomicStore(&extra[p(P_damage) + i], 0);
        atomicStore(&extra[p(P_credits) + i], 2147483647);
        atomicStore(&extra[u32(defs[D_sonicForce]) + i * 2u], 0);
        atomicStore(&extra[u32(defs[D_sonicForce]) + i * 2u + 1u], 0);
    }
    if (i == 0u) {
        atomicStore(&scratch[1], pcg(p(P_tick))); atomicStore(&scratch[2], 0u);
        atomicStore(&scratch[15], 0u);
        atomicStore(&scratch[p(P_artilleryQueue)],0u);
        atomicStore(&scratch[p(P_splashQueue)],0u);
    }
}
fn spawn_available(i: u32) -> bool {
    let stamp = atomicLoad(&extra[u32(defs[D_damageTime]) + i]);
    return old(F_hp,i) <= 0 && (stamp == 0 || i32(p(P_tick)) + 1 - stamp >= 8);
}
@compute @workgroup_size(${workgroupSize})
fn spawn_flags(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let i = index(id,groups); if (i >= p(P_count)) { return; }
    atomicStore(&scratch[p(P_emitScanA) + i],select(0u,1u,spawn_available(i)));
}
@compute @workgroup_size(${workgroupSize})
fn spawn_release(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let i = index(id, groups); if (i >= p(P_count)) { return; }
    for (var f = 0u; f < STATE_FIELDS; f++) { put(f, i, old(f, i)); }
    if (defs[D_winTick] > 0 && (atomicLoad(&extra[0]) <= 0 || p(P_tick) + 1u >= u32(defs[D_winTick]))) { return; }
    let wave_mode = defs[D_waveMode] != 0;
    var spawn = 0u;
    let slot = wave_slot(i);
    if (wave_mode) {
        if (p(P_tick) != nav[slot + 2u]) { return; }
        spawn = nav[slot];
    } else {
        let repeated = p(P_tick) != 0u;
        var ordinal = i;
        if (repeated) {
            if (defs[D_continuousSpawn] == 0 || p(P_tick) % 1200u != 0u || !spawn_available(i)) { return; }
            ordinal = atomicLoad(&scratch[p(P_input) + i]) - 1u;
        }
        if (ordinal >= p(P_spawnCount) * u32(defs[D_spawnPerSource])) { return; }
        spawn = ordinal / max(1u,u32(defs[D_spawnPerSource]));
        if (repeated || p(P_spawnCount) * u32(defs[D_spawnPerSource]) > p(P_count)) {
            spawn = ordinal % max(1u,p(P_spawnCount));
        }
    }
    let record = p(P_spawns) + spawn * 3u;
    for (var f = 0u; f < STATE_FIELDS; f++) { put(f,i,0); }
    put(F_tgt,i,-1);
    atomicStore(&extra[u32(defs[D_pursuitDistance]) + i],0);
    atomicStore(&extra[u32(defs[D_damageTime]) + i],0);
    atomicStore(&extra[u32(defs[D_gasSlow]) + i],100);
    atomicStore(&extra[u32(defs[D_explosionImpulse]) + i * 2u],0);
    atomicStore(&extra[u32(defs[D_explosionImpulse]) + i * 2u + 1u],0);
    for (var word = 0u; word < 4u; word++) {
        atomicStore(&extra[u32(defs[D_stuck]) + i * 4u + word],0);
        atomicStore(&extra[p(P_emits) + i * 4u + word],0);
        atomicStore(&extra[p(P_previousEmits) + i * 4u + word],0);
        if (word < 3u) { atomicStore(&extra[u32(defs[D_sonicAggro]) + i * 3u + word],0); }
    }
    atomicStore(&extra[u32(defs[D_sonicAggro]) + i * 3u + 2u],2147483647);
    let angle = random(p(P_seed),i,p(P_tick),1u) & 255u;
    let radial = mul_q(i32(nav[record + 2u]),i32(root(random(p(P_seed),i,p(P_tick),2u) >> 16u)) * 257);
    let x = i32(nav[record]) + mul_q(radial, LUT[angle].x * 4);
    let z = i32(nav[record + 1u]) + mul_q(radial, LUT[angle].y * 4);
    put(F_x, i, x); put(F_z, i, z); put(F_meta, i, 15 << 16u);
    let cell = cell_at(x, z);
    if (cell == 4294967295u) { atomicAdd(&scratch[3], 1u); return; }
    if (cost(cell) == 0u || active_distance(cell, 0u) == INF) {
        atomicAdd(&scratch[3], 1u); return;
    }
    var total = 0u;
    for (var kind = 0u; kind < u32(defs[D_zombieCount]); kind++) { total += u32(max(0,defs[zombie_def(i32(kind)) + 16u])); }
    var ticket = random(p(P_seed),i,p(P_tick),41u) % max(1u,total); var variant = 0;
    for (var kind = 0u; kind < u32(defs[D_zombieCount]); kind++) {
        let weight = u32(max(0,defs[zombie_def(i32(kind)) + 16u]));
        if (ticket < weight) { variant = i32(kind); break; } ticket -= weight;
    }
    if (wave_mode) { variant = i32(nav[slot + 1u]); }
    put(F_meta,i,(15 << 16u) | variant);
    put(F_hp, i, scaled_zombie_stat(i,defs[zombie_def(variant)],WAVE_HP)); set_state(i, 1);
}
@compute @workgroup_size(${workgroupSize})
fn grid_build(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let i = index(id, groups); if (i >= p(P_sortSize)) { return; }
    var key = 4294967295u;
    if (i < p(P_count) && current(F_hp, i) > 0 && meta_state(current(F_meta, i)) > 0 && meta_state(current(F_meta, i)) < 3) {
        let cell = spatial_cell(current(F_x, i), current(F_z, i));
        atomicAdd(&scratch[p(P_counts) + cell], 1u);
        let density_cell = max(1,i32(p(P_gridCellQ)) * defs[D_coarseScale] / 2);
        let dx = min(u32(max(0,current(F_x,i) / density_cell)),u32(defs[D_coarseColumns]) * 2u - 1u);
        let dz = min(u32(max(0,current(F_z,i) / density_cell)),u32(defs[D_coarseRows]) * 2u - 1u);
        atomicAdd(&extra[u32(defs[D_density]) + dz * u32(defs[D_coarseColumns]) * 2u + dx],1);
        atomicStore(&scratch[p(P_gridKeys) + i],cell);
        key = i;
    } else if (i < p(P_count)) { put(F_vx, i, 0); put(F_vz, i, 0); }
    atomicStore(&scratch[p(P_sortA) + i], key);
    var cell_key = p(P_gridColumns) * p(P_gridRows);
    if (key != 4294967295u) { cell_key = atomicLoad(&scratch[p(P_gridKeys) + i]); }
    atomicStore(&scratch[p(P_radixKeysA) + i], cell_key);
}
@compute @workgroup_size(${workgroupSize})
fn grid_gather(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let t = index(id, groups); if (t >= p(P_count)) { return; }
    let i = atomicLoad(&scratch[p(P_sorted) + t]); if (i >= p(P_count)) { return; }
    let at = p(P_slotRecords) + t * 3u;
    var x = old(F_x,i); var z = old(F_z,i); var metadata = old(F_meta,i);
    if (p(P_field) != 0u) { x = current(F_x,i); z = current(F_z,i); metadata = current(F_meta,i); }
    atomicStore(&scratch[at],bitcast<u32>(x)); atomicStore(&scratch[at + 1u],bitcast<u32>(z));
    atomicStore(&scratch[at + 2u],bitcast<u32>(metadata));
}
fn objective_distance(x: i32, z: i32) -> i32 {
    var delta = vec2<i32>(cm(x) - cm(i32(p(P_objectiveX))),cm(z) - cm(i32(p(P_objectiveZ))));
    var scale = 1;
    while (max(abs(delta.x),abs(delta.y)) > 32767) { delta /= 2; scale *= 2; }
    return i32(root(u32(delta.x * delta.x + delta.y * delta.y))) * scale;
}
fn objective_focused(x: i32, z: i32) -> bool {
    return atomicLoad(&extra[0]) > 0 &&
        in_circle(cm(x) - cm(i32(p(P_objectiveX))),cm(z) - cm(i32(p(P_objectiveZ))),3000);
}
@compute @workgroup_size(${workgroupSize})
fn zombie_think(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let i = index(id, groups); if (i >= p(P_count)) { return; }
    for (var word = 0u; word < 4u; word++) { atomicStore(&extra[p(P_emits) + i * 4u + word], 0); }
    if (current(F_hp, i) <= 0 || meta_state(current(F_meta, i)) == 0) { return; }
    let def = zombie_def(meta_variant(current(F_meta, i)));
    let cooldown = max(0, meta_cooldown(current(F_meta, i)) - 1); set_cooldown(i, cooldown);
    if (defs[def + 5u] == 1) { ranged_think(i,def); return; }
    let x = current(F_x, i); let z = current(F_z, i);
    let range = cm(defs[def + 6u]); let mask = u32(defs[def + 11u]);
    let progress = u32(defs[D_pursuitDistance]) + i;
    let distance_to_goal = objective_distance(x,z);
    let recorded = atomicLoad(&extra[progress]);
    let closest = select(min(recorded - 1,distance_to_goal),distance_to_goal,recorded == 0);
    atomicStore(&extra[progress],closest + 1);
    let leash = closest + max(0,defs[D_pursuitLeash]);
    let focused = objective_focused(x,z);
    let search_range = select(range,max(range,defs[D_pursuitRange]),!focused && distance_to_goal <= leash);
    let objective_in_range = (mask & 1u) != 0u && atomicLoad(&extra[0]) > 0 &&
        in_circle(cm(x) - cm(i32(p(P_objectiveX))),cm(z) - cm(i32(p(P_objectiveZ))),
            range + cm(i32(p(P_objectiveRadius))));
    set_state(i, 1); set_target(i, 0); put(F_tgt, i, -1);
    if (focused && objective_in_range) {
        set_target(i,1); set_state(i,2);
        if (cooldown == 0) { attack(i,def); }
        return;
    }
    if (focused && cooldown != 0) { return; }
    let cell = cell_at(x, z);
    if (cell == 4294967295u) { return; }
    let step = direction(cell, u32(defs[def + 4u]));
    let ahead = cell_at(x + step.x * 4, z + step.y * 4);
    var selected = -1;
    if ((mask & 2u) != 0u && ahead != 4294967295u) { selected = blocking(ahead); }
    if (selected >= 0 && !entity_in_range(u32(selected), x, z, range)) { selected = -1; }
    if (selected < 0 && (mask & 6u) != 0u) {
        var best = 2147483647;
        let radius = min(search_range * Q / 100, i32(max(p(P_widthQ), p(P_depthQ))));
        let maximum = vec2<i32>(i32(p(P_columns)) - 1, i32(p(P_rows)) - 1);
        let low = clamp((vec2<i32>(x, z) - vec2<i32>(radius)) / i32(p(P_cellQ)), vec2<i32>(0), maximum);
        let high = clamp((vec2<i32>(x, z) + vec2<i32>(radius)) / i32(p(P_cellQ)), vec2<i32>(0), maximum);
        for (var row = low.y; row <= high.y; row++) {
            for (var column = low.x; column <= high.x; column++) {
                let found = occupancy(u32(row) * p(P_columns) + u32(column));
                if (found < 0) { continue; }
                let other = u32(found); let at = entity(other); let unit = entity_def(other);
                let category = defs[unit + U_kind];
                let target_mask = select(2u,4u,category == 2 || category == 3);
                if (atomicLoad(&extra[at + E_state]) == 0 || category < 1 || category > 5 ||
                    (category == 5 && is_active(other) && i32(p(P_tick)) >= atomicLoad(&extra[at + E_timer])) ||
                    (mask & target_mask) == 0u) { continue; }
                let in_range = entity_in_range(other,x,z,range);
                if (!in_range && (!entity_in_range(other,x,z,search_range) ||
                    objective_distance(atomicLoad(&extra[at + E_x]),atomicLoad(&extra[at + E_z])) > leash)) { continue; }
                let dx = cm(x) - cm(atomicLoad(&extra[at + E_x]));
                let dz = cm(z) - cm(atomicLoad(&extra[at + E_z]));
                let distance = dx * dx + dz * dz;
                if (distance < best || (distance == best && (selected < 0 || found < selected))) {
                    best = distance; selected = found;
                }
            }
        }
    }
    var shield_contact = false;
    let memory = u32(defs[D_sonicAggro]) + i * 3u;
    let remembered = atomicLoad(&extra[memory]) - 1;
    if (!focused && (mask & 2u) != 0u && remembered >= 0 && remembered < i32(MAX_ENTITIES)) {
        let shield = u32(remembered); let at = entity(shield); let unit = entity_def(shield);
        let dx = cm(x) - cm(atomicLoad(&extra[at + E_x]));
        let dz = cm(z) - cm(atomicLoad(&extra[at + E_z]));
        let radius = cm(defs[unit + U_sonicRadius]);
        if (atomicLoad(&extra[at + E_state]) != 0 && defs[unit + U_kind] == 4 &&
            (atomicLoad(&extra[at + E_flags]) >> 8) == atomicLoad(&extra[memory + 1u]) &&
            in_circle(dx,dz,radius + max(range,defs[D_pursuitRange]))) {
            selected = remembered;
            shield_contact = atomicLoad(&extra[at + E_state]) == 1 &&
                (atomicLoad(&extra[at + E_flags]) & 1) == 0 && in_circle(dx,dz,radius + range + cm(defs[def + 2u]));
        } else { atomicStore(&extra[memory],0); }
    }
    if (selected >= 0) { set_target(i, 2); put(F_tgt, i, selected); }
    if (selected < 0 && (mask & 8u) != 0u) {
        var best = 2147483647;
        for (var player = 0u; player < 8u; player++) {
            let at = p(P_players) + player * 6u;
            if (atomicLoad(&extra[at + 4u]) == 0 || atomicLoad(&extra[at + 3u]) <= 0) { continue; }
            let dx = cm(x) - cm(atomicLoad(&extra[at])); let dz = cm(z) - cm(atomicLoad(&extra[at + 1u]));
            if (!in_circle(dx, dz, range)) { continue; }
            let distance = dx * dx + dz * dz;
            if (distance < best) { best = distance; selected = i32(player); }
        }
        if (selected >= 0) { set_target(i, 3); put(F_tgt, i, selected); }
    }
    if (selected < 0 && objective_in_range) { set_target(i, 1); }
    let kind = meta_target(current(F_meta,i));
    if (kind != 0 && (kind != 2 || shield_contact || entity_in_range(u32(selected),x,z,range))) {
        if (!focused) { set_state(i,2); }
        if (cooldown == 0) { attack(i, def); }
    }
}
fn body_walkable(x: i32, z: i32, radius: i32) -> bool {
    return walkable(x - radius, z - radius) && walkable(x + radius, z - radius) &&
        walkable(x - radius, z + radius) && walkable(x + radius, z + radius);
}
fn zombie_walkable(x: i32, z: i32, radius: i32, old_x: i32, old_z: i32, agent: u32) -> bool {
    if (!body_walkable(x, z, radius)) { return false; }
    let shields = u32(defs[D_shields]);
    for (var slot = 1u; slot <= u32(atomicLoad(&extra[shields])); slot++) {
        let shield = u32(atomicLoad(&extra[shields + slot])); let at = entity(shield);
        let boundary = cm(defs[entity_def(shield) + U_sonicRadius]) + cm(radius);
        let origin = vec2<i32>(cm(atomicLoad(&extra[at + E_x])),cm(atomicLoad(&extra[at + E_z])));
        let before = vec2<i32>(cm(old_x),cm(old_z)) - origin;
        let after = vec2<i32>(cm(x),cm(z)) - origin;
        if (max(abs(before.x),abs(before.y)) > boundary + 200 &&
            max(abs(after.x),abs(after.y)) > boundary + 200) { continue; }
        let old_distance = before.x * before.x + before.y * before.y;
        let new_distance = after.x * after.x + after.y * after.y;
        if (old_distance < boundary * boundary) {
            if (new_distance < old_distance) {
                atomicMin(&extra[u32(defs[D_sonicAggro]) + agent * 3u + 2u],i32(shield)); return false;
            }
        } else {
            let movement = after - before;
            let length = movement.x * movement.x + movement.y * movement.y;
            let projected = clamp(-before.x * movement.x - before.y * movement.y,0,length);
            let closest = before + movement * (projected * 256 / max(1,length)) / 256;
            if (closest.x * closest.x + closest.y * closest.y < boundary * boundary) {
                atomicMin(&extra[u32(defs[D_sonicAggro]) + agent * 3u + 2u],i32(shield)); return false;
            }
        }
    }
    return blocking(cell_at(x - radius, z - radius)) < 0 && blocking(cell_at(x + radius, z - radius)) < 0 &&
        blocking(cell_at(x - radius, z + radius)) < 0 && blocking(cell_at(x + radius, z + radius)) < 0;
}
fn limited_velocity(value: vec2<i32>, limit: i32) -> vec2<i32> {
    var scaled = value; var divisor = 1;
    while (max(abs(scaled.x), abs(scaled.y)) > 16384) { scaled /= 2; divisor *= 2; }
    let total = i32(root(u32(scaled.x * scaled.x + scaled.y * scaled.y)));
    if (total <= limit / divisor) { return value; }
    let normal = scaled * Q / max(total, 1);
    return vec2<i32>(mul_q(normal.x, limit), mul_q(normal.y, limit));
}
@compute @workgroup_size(${workgroupSize})
fn zombie_move(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let t = index(id, groups); if (t >= p(P_count)) { return; }
    let i = atomicLoad(&scratch[p(P_sorted) + t]); if (i >= p(P_count)) { return; }
    put(F_vx, i, 0); put(F_vz, i, 0);
    let state = meta_state(current(F_meta, i));
    if (state != 1 && state != 2) { return; }
    let def = zombie_def(meta_variant(current(F_meta, i)));
    var x = current(F_x, i); var z = current(F_z, i);
    let scale = u32(defs[D_flowScale]); let spacing = p(P_cellQ) * scale;
    let sx = u32(max(0, x - i32(spacing / 2u)));
    let sz = u32(max(0, z - i32(spacing / 2u)));
    let gx = min(sx / spacing, u32(defs[D_flowColumns]) - 1u);
    let gz = min(sz / spacing, u32(defs[D_flowRows]) - 1u);
    let fx = fraction_q(sx % spacing, spacing);
    let fz = fraction_q(sz % spacing, spacing);
    var blended = vec2<i32>(0);
    for (var oz = 0u; oz < 2u; oz++) { for (var ox = 0u; ox < 2u; ox++) {
        let cell = min((gz + oz) * scale, p(P_rows) - 1u) * p(P_columns) +
            min((gx + ox) * scale, p(P_columns) - 1u);
        let weight = mul_q(select(Q - fx, fx, ox == 1u), select(Q - fz, fz, oz == 1u));
        let vector = direction(cell, u32(defs[def + 4u]));
        blended += vec2<i32>(mul_q(vector.x, weight), mul_q(vector.y, weight));
    } }
    let own_nav = cell_at(x, z);
    if (own_nav != 4294967295u && active_distance(own_nav,u32(defs[def + 4u])) == 0u) {
        blended = vec2<i32>(cm(i32(p(P_objectiveX))) - cm(x), cm(i32(p(P_objectiveZ))) - cm(z));
        for (var shift = 0u; shift < 8u; shift++) {
            if (max(abs(blended.x), abs(blended.y)) > 16384) { blended /= 2; }
        }
    }
    let victim = current(F_tgt,i);
    let focused = objective_focused(x,z);
    if (!focused && state == 1 && meta_target(current(F_meta,i)) == 2 && victim >= 0 && victim < i32(MAX_ENTITIES)) {
        let at = entity(u32(victim));
        blended = vec2<i32>(cm(atomicLoad(&extra[at + E_x])) - cm(x),cm(atomicLoad(&extra[at + E_z])) - cm(z));
    }
    var ranged_drive = false;
    if (!focused && defs[def + 5u] == 1 && meta_target(current(F_meta,i)) == 2 && victim >= 0 && victim < i32(MAX_ENTITIES)) {
        let at = entity(u32(victim));
        let delta = vec2<i32>(cm(atomicLoad(&extra[at + E_x])) - cm(x),cm(atomicLoad(&extra[at + E_z])) - cm(z));
        let distance = i32(root(u32(delta.x * delta.x + delta.y * delta.y)));
        let desired = cm(defs[def + 17u]);
        blended = vec2<i32>(0);
        if (distance > desired + 50) { blended = delta; ranged_drive = true; }
    }
    let recovery = atomicLoad(&extra[u32(defs[D_stuck]) + i * 4u + 3u]);
    if (state == 1 && recovery > 0) {
        blended = vec2<i32>(cm(i32(p(P_objectiveX))) - cm(x),cm(i32(p(P_objectiveZ))) - cm(z));
        if (recovery > 50) { blended = LUT[random(p(P_seed),i,p(P_tick) + u32(recovery),913u) & 255u]; }
        while (max(abs(blended.x),abs(blended.y)) > 16384) { blended /= 2; }
    }
    let slow = clamp(atomicLoad(&extra[u32(defs[D_gasSlow]) + i]), 0, 100);
    var speed = max(0, defs[def + 1u] / 20 * slow / 100);
    if (state == 1 && recovery > 50) { speed = min(speed,Q / 10); }
    var velocity = vec2<i32>(0);
    let length = i32(root(u32(blended.x * blended.x + blended.y * blended.y)));
    if ((state == 1 || ranged_drive) && length > 0) {
        let normal = blended * Q / length;
        velocity = vec2<i32>(mul_q(normal.x, speed), mul_q(normal.y, speed));
    }
    var sum = vec2<i32>(0);
    let largest_radius = defs[D_maxRadius];
    let support_cm = max(1, (cm(defs[def + 2u]) + cm(largest_radius)) * 16 / 5) + 1;
    let reach = support_cm / 100 * Q + support_cm % 100 * Q / 100;
    let low = spatial_cell(x - reach, z - reach); let high = spatial_cell(x + reach, z + reach);
    for (var gz = low / p(P_gridColumns); gz <= high / p(P_gridColumns); gz++) {
        for (var gx = low % p(P_gridColumns); gx <= high % p(P_gridColumns); gx++) {
        let cell = gz * p(P_gridColumns) + gx;
        let end = atomicLoad(&scratch[p(P_offsets) + cell]);
        let start = end - atomicLoad(&scratch[p(P_counts) + cell]);
        for (var slot = start; slot < end; slot++) {
            let other = atomicLoad(&scratch[p(P_sorted) + slot]);
            let record = p(P_slotRecords) + slot * 3u;
            let metadata = bitcast<i32>(atomicLoad(&scratch[record + 2u]));
            if (slot == t || other >= p(P_count) || meta_state(metadata) == 0 || meta_state(metadata) == 3) { continue; }
            var delta = vec2<i32>(cm(x) - cm(bitcast<i32>(atomicLoad(&scratch[record]))),
                cm(z) - cm(bitcast<i32>(atomicLoad(&scratch[record + 1u]))));
            let other_def = zombie_def(meta_variant(metadata));
            let separation = cm(defs[def + 2u]) + cm(defs[other_def + 2u]);
            let support = max(1, separation * 16 / 5);
            if (abs(delta.x) >= support || abs(delta.y) >= support) { continue; }
            let distance = i32(root(u32(delta.x * delta.x + delta.y * delta.y)));
            if (distance >= support) { continue; }
            var normal = vec2<i32>(0);
            if (distance == 0) {
                normal = LUT[random(p(P_seed), min(i, other), p(P_tick), max(i, other)) & 255u] / 64;
                if (i > other) { normal = -normal; }
            } else { normal = delta * 256 / distance; }
            // A compact quadratic pressure kernel acts before bodies overlap.
            let weight = (support - distance) * 256 / support;
            sum += normal * (weight * weight) / 256;
        }
    } }
    sum = clamp(sum, vec2<i32>(-Q / 2), vec2<i32>(Q / 2));
    velocity += vec2<i32>(mul_q(sum.x, speed * 32 / 5), mul_q(sum.y, speed * 32 / 5));
    velocity = limited_velocity(velocity, speed);
    let push = u32(defs[D_explosionImpulse]) + i * 2u;
    let compressed_blast = limited_velocity(vec2<i32>(atomicLoad(&extra[push]),atomicLoad(&extra[push + 1u])),32 * Q / 80);
    let blast = compressed_blast * 4;
    atomicAdd(&extra[u32(defs[D_sonicForce]) + i * 2u],blast.x);
    atomicAdd(&extra[u32(defs[D_sonicForce]) + i * 2u + 1u],blast.y);
    atomicStore(&extra[push],compressed_blast.x * 3 / 4); atomicStore(&extra[push + 1u],compressed_blast.y * 3 / 4);
    velocity += vec2<i32>(atomicLoad(&extra[u32(defs[D_sonicForce]) + i * 2u]),
        atomicLoad(&extra[u32(defs[D_sonicForce]) + i * 2u + 1u]));
    velocity = clamp(velocity,vec2<i32>(-32 * Q / 20),vec2<i32>(32 * Q / 20));
    let radius = defs[def + 2u];
    if (zombie_walkable(x + velocity.x, z, radius, x, z, i)) { x += velocity.x; } else { velocity.x = 0; }
    if (zombie_walkable(x, z + velocity.y, radius, x, z, i)) { z += velocity.y; } else { velocity.y = 0; }
    put(F_x, i, x); put(F_z, i, z); put(F_vx, i, velocity.x); put(F_vz, i, velocity.y);
    atomicMax(&scratch[15], u32(max(abs(velocity.x), abs(velocity.y))));
}
@compute @workgroup_size(${workgroupSize})
fn zombie_separate(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let t = index(id, groups); if (t >= p(P_count) || p(P_tick) == 0u) { return; }
    let i = atomicLoad(&scratch[p(P_sorted) + t]); if (i >= p(P_count) || old(F_hp,i) <= 0) { return; }
    let position = vec2<i32>(current(F_x, i), current(F_z, i));
    var correction = vec2<i32>(0);
    let state = meta_state(current(F_meta, i));
    let def = zombie_def(meta_variant(current(F_meta, i)));
    if (state == 1 || state == 2) {
        let largest_radius = defs[D_maxRadius];
        let reach = u32(2 * (cm(defs[def + 2u]) + cm(largest_radius)) + 2) * u32(Q) / 100u;
        let margin = i32(reach + atomicLoad(&scratch[15]));
        let low = spatial_cell(position.x - margin, position.y - margin);
        let high = spatial_cell(position.x + margin, position.y + margin);
        for (var gz = low / p(P_gridColumns); gz <= high / p(P_gridColumns); gz++) {
        for (var gx = low % p(P_gridColumns); gx <= high % p(P_gridColumns); gx++) {
            let cell = gz * p(P_gridColumns) + gx;
            let end = atomicLoad(&scratch[p(P_offsets) + cell]);
            let start = end - atomicLoad(&scratch[p(P_counts) + cell]);
            for (var slot = start; slot < end; slot++) {
                let other = atomicLoad(&scratch[p(P_sorted) + slot]);
                if (slot == t || other >= p(P_count)) { continue; }
                let record = p(P_slotRecords) + slot * 3u;
                let metadata = bitcast<i32>(atomicLoad(&scratch[record + 2u]));
                let other_state = meta_state(metadata);
                if (other_state != 1 && other_state != 2) { continue; }
                let other_def = zombie_def(meta_variant(metadata));
                let minimum = 2 * (cm(defs[def + 2u]) + cm(defs[other_def + 2u])) + 2;
                let delta = vec2<i32>(cm(position.x) - cm(bitcast<i32>(atomicLoad(&scratch[record]))),
                    cm(position.y) - cm(bitcast<i32>(atomicLoad(&scratch[record + 1u]))));
                if (abs(delta.x) >= minimum || abs(delta.y) >= minimum) { continue; }
                let distance = i32(root(u32(delta.x * delta.x + delta.y * delta.y)));
                if (distance >= minimum) { continue; }
                var normal = delta * 256 / max(distance, 1);
                if (distance == 0) {
                    normal = LUT[random(p(P_seed), min(i, other), 0u, max(i, other)) & 255u] / 64;
                    if (i > other) { normal = -normal; }
                }
                correction += normal * ((minimum - distance) * Q / 200) / 256;
            }
        } }
    }
    correction = limited_velocity(correction, Q / 8);
    let slow = clamp(atomicLoad(&extra[u32(defs[D_gasSlow]) + i]), 0, 100);
    var limit = max(0, defs[def + 1u] / 20 * slow / 100);
    if (atomicLoad(&extra[u32(defs[D_sonicForce]) + i * 2u]) != 0 ||
        atomicLoad(&extra[u32(defs[D_sonicForce]) + i * 2u + 1u]) != 0) { limit = 32 * Q / 20; }
    let origin = vec2<i32>(old(F_x, i), old(F_z, i));
    let candidate = origin + limited_velocity(position + correction - origin, limit);
    atomicStore(&scratch[p(P_separation) + i * 2u], bitcast<u32>(candidate.x));
    atomicStore(&scratch[p(P_separation) + i * 2u + 1u], bitcast<u32>(candidate.y));
}
@compute @workgroup_size(${workgroupSize})
fn zombie_separate_commit(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let t = index(id, groups); if (t >= p(P_count) || p(P_tick) == 0u) { return; }
    let i = atomicLoad(&scratch[p(P_sorted) + t]); if (i >= p(P_count) || old(F_hp,i) <= 0) { return; }
    let state = meta_state(current(F_meta, i)); if (state != 1 && state != 2) { return; }
    var x = current(F_x, i); var z = current(F_z, i);
    let radius = defs[zombie_def(meta_variant(current(F_meta, i))) + 2u];
    let candidate = vec2<i32>(bitcast<i32>(atomicLoad(&scratch[p(P_separation) + i * 2u])),
        bitcast<i32>(atomicLoad(&scratch[p(P_separation) + i * 2u + 1u])));
    if (zombie_walkable(candidate.x, z, radius, x, z, i)) { x = candidate.x; }
    if (zombie_walkable(x, candidate.y, radius, x, z, i)) { z = candidate.y; }
    put(F_x, i, x); put(F_z, i, z); put(F_vx, i, x - old(F_x, i)); put(F_vz, i, z - old(F_z, i));
    atomicStore(&scratch[p(P_slotRecords) + t * 3u],bitcast<u32>(x));
    atomicStore(&scratch[p(P_slotRecords) + t * 3u + 1u],bitcast<u32>(z));
    atomicMax(&scratch[15], u32(max(abs(x - old(F_x, i)), abs(z - old(F_z, i)))));
}
@compute @workgroup_size(${workgroupSize})
fn zombie_recover(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let i = index(id,groups); if (i >= p(P_count)) { return; }
    let memory = u32(defs[D_sonicAggro]) + i * 3u;
    let repelled = atomicLoad(&extra[memory + 2u]);
    if (repelled >= 0 && repelled < i32(MAX_ENTITIES)) {
        atomicStore(&extra[memory],repelled + 1);
        atomicStore(&extra[memory + 1u],atomicLoad(&extra[entity(u32(repelled)) + E_flags]) >> 8);
    }
    let at = u32(defs[D_stuck]) + i * 4u;
    let x = current(F_x,i); let z = current(F_z,i);
    let remaining = atomicLoad(&extra[at + 3u]);
    if (meta_state(current(F_meta,i)) != 1 || remaining > 0 || p(P_tick) == 0u) {
        atomicStore(&extra[at],x); atomicStore(&extra[at + 1u],z); atomicStore(&extra[at + 2u],0);
        atomicStore(&extra[at + 3u],max(0,remaining - 1)); return;
    }
    if (max(abs(cm(x - atomicLoad(&extra[at]))),abs(cm(z - atomicLoad(&extra[at + 1u])))) >= 10) {
        atomicStore(&extra[at],x); atomicStore(&extra[at + 1u],z); atomicStore(&extra[at + 2u],0); return;
    }
    let stationary = atomicLoad(&extra[at + 2u]) + 1;
    atomicStore(&extra[at + 2u],stationary);
    if (stationary >= 40) { atomicStore(&extra[at + 3u],60); atomicStore(&extra[at + 2u],0); }
}
@compute @workgroup_size(${workgroupSize})
fn emit_flags(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let i = index(id, groups); if (i >= p(P_count)) { return; }
    let kind = atomicLoad(&extra[p(P_previousEmits) + i * 4u]);
    atomicStore(&scratch[p(P_emitScanA) + i], select(0u, 1u, kind != 0));
}
@compute @workgroup_size(${workgroupSize})
fn emit_scatter(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let i = index(id, groups); if (i >= p(P_count)) { return; }
    let rank = atomicLoad(&scratch[p(P_input) + i]);
    if (i == p(P_count) - 1u) { atomicStore(&extra[p(P_compactCount)], i32(rank)); }
    if (atomicLoad(&extra[p(P_previousEmits) + i * 4u]) == 0) { return; }
    let destination = p(P_compact) + (rank - 1u) * 5u;
    atomicStore(&extra[destination], i32(i));
    for (var word = 0u; word < 4u; word++) {
        atomicStore(&extra[destination + 1u + word], atomicLoad(&extra[p(P_previousEmits) + i * 4u + word]));
    }
}
@compute @workgroup_size(${workgroupSize})
fn consume_emits(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let i = index(id, groups); if (i >= u32(atomicLoad(&extra[p(P_compactCount)]))) { return; }
    let record = p(P_compact) + i * 5u;
    if (atomicLoad(&extra[record + 1u]) == 1) {
        let victim = atomicLoad(&extra[record + 2u]); let tag = u32(atomicLoad(&extra[record + 3u]));
        let kind = tag & 3u;
        let damage = atomicLoad(&extra[record + 4u]);
        if (kind == 1u) { atomicAdd(&scratch[2], u32(damage)); }
        if (kind == 2u && victim >= 0 && victim < i32(MAX_ENTITIES) &&
            atomicLoad(&extra[entity(u32(victim)) + E_state]) != 0 &&
            (u32(atomicLoad(&extra[entity(u32(victim)) + E_flags])) >> 8u) == (tag >> 2u)) {
            let zombie = u32(atomicLoad(&extra[record]));
            let def = zombie_def(meta_variant(current(F_meta, zombie)));
            let target_def = entity_def(u32(victim));
            if (defs[target_def + U_kind] == 4 && atomicLoad(&extra[entity(u32(victim)) + E_state]) == 1 &&
                (atomicLoad(&extra[entity(u32(victim)) + E_flags]) & 1) == 0 &&
                atomicLoad(&extra[entity(u32(victim)) + E_power]) > 0) {
                atomicAdd(&extra[u32(defs[D_powerDrain]) + u32(victim)],max(0,damage));
            } else if ((defs[target_def + U_kind] != 5 ||
                i32(p(P_tick)) < atomicLoad(&extra[entity(u32(victim)) + E_timer])) &&
                (defs[target_def + U_kind] != 4 ||
                entity_in_range(u32(victim),current(F_x,zombie),current(F_z,zombie),cm(defs[def + 6u])))) {
                atomicAdd(&extra[u32(defs[D_entityDamage]) + u32(victim)],damage * defs[def + 10u] / 100);
            }
        }
        if (kind == 3u && victim >= 0 && victim < 8) {
            atomicAdd(&extra[p(P_players) + u32(victim) * 6u + 3u], -damage);
        }
    }
}
@compute @workgroup_size(${workgroupSize})
fn apply_damage(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let i = index(id, groups); if (i >= p(P_count) || current(F_hp, i) <= 0) { return; }
    let damage = max(0, atomicLoad(&extra[p(P_damage) + i]));
    let hp = max(0, current(F_hp, i) - damage); put(F_hp, i, hp);
    if (damage > 0) { atomicStore(&extra[u32(defs[D_damageTime]) + i],i32(p(P_tick)) + 1); }
    if (hp == 0) {
        let credit = atomicLoad(&extra[p(P_credits) + i]);
        set_state(i, 3); set_credit(i, credit);
        if (credit >= 0 && credit < ${LOBBY_LIMIT}) {
            atomicAdd(&extra[u32(defs[D_economy]) + C_kills + u32(credit)],1);
        }
        atomicStore(&extra[u32(defs[D_explosionImpulse]) + i * 2u],0);
        atomicStore(&extra[u32(defs[D_explosionImpulse]) + i * 2u + 1u],0);
    }
}
@compute @workgroup_size(1)
fn objective_update() {
    atomicStore(&extra[0], max(0, atomicLoad(&extra[0]) - i32(atomicLoad(&scratch[2]))));
    if (atomicLoad(&extra[0]) == 0) {
        for (var slot = 0u; slot < ${LOBBY_LIMIT}u; slot++) {
            if (player_has_economy(slot)) { economy_caps(slot); }
        }
    }
}
@compute @workgroup_size(${workgroupSize})
fn end_match(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    if (atomicLoad(&extra[0]) <= 0 || p(P_tick) + 1u < u32(defs[D_winTick])) { return; }
    let i = index(id, groups);
    if (i < p(P_count) && current(F_hp,i) > 0) {
        put(F_hp,i,0); set_state(i,3);
        atomicStore(&extra[u32(defs[D_damageTime]) + i],i32(p(P_tick)) + 1);
    }
    if (i < u32(defs[D_coarseColumns] * defs[D_coarseRows]) * 4u) {
        atomicStore(&extra[u32(defs[D_density]) + i],0);
    }
}
@compute @workgroup_size(${workgroupSize})
fn snapshot(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let i = index(id, groups); if (i >= p(P_count)) { return; }
    let hp = u32(clamp(current(F_hp, i),0,${RENDER_ZOMBIE_HP_MASK}));
    atomicStore(&scratch[p(P_snapshot) + i * 3u], bitcast<u32>(current(F_x, i)));
    atomicStore(&scratch[p(P_snapshot) + i * 3u + 1u], bitcast<u32>(current(F_z, i)));
    let damaged = u32(atomicLoad(&extra[u32(defs[D_damageTime]) + i]));
    var age = 255u;
    if (damaged != 0u) { age = min(254u,p(P_tick) + 1u - damaged); }
    atomicStore(&scratch[p(P_snapshot) + i * 3u + 2u], u32(meta_variant(current(F_meta, i))) |
        (hp << 8u) | (u32(meta_state(current(F_meta, i))) << ${RENDER_ZOMBIE_STATE_SHIFT}u) | (age << 24u));
}
@compute @workgroup_size(${workgroupSize})
fn runtime_snapshot(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let i = index(id,groups); let start = u32(defs[D_entitySnapshot]);
    if (i < MAX_ENTITIES) {
        let output = start + i * ${RENDER_ENTITY_WORDS}u;
        for (var word = 0u; word < ENTITY_WORDS; word++) {
            atomicStore(&scratch[output + word],u32(atomicLoad(&extra[entity(i) + word])));
        }
        for (var mount = 0u; mount < 4u; mount++) {
            let weapon = i * 4u + mount; let state = weapon_state(weapon);
            let victim = atomicLoad(&extra[state + 2u]);
            let targeting = weapon_live(weapon) && (victim >= 0 || victim == -3);
            let aim = u32(atomicLoad(&extra[state + 1u])) & 65535u;
            var charge = 0u;
            if (weapon_live(weapon)) {
                let maximum = max(1,defs[weapon_def(weapon) + W_cooldown]);
                let remaining = clamp(atomicLoad(&extra[state]),0,maximum);
                charge = u32((maximum - remaining) * 255 / maximum);
            }
            atomicStore(&scratch[output + ENTITY_WORDS + mount], aim |
                select(0u, ${RENDER_AIM_ACTIVE}u, targeting) | (charge << ${RENDER_CHARGE_SHIFT}u));
        }
        for (var word = 0u; word < ${ORDER_WORDS}u; word++) {
            atomicStore(&scratch[output + ENTITY_WORDS + 4u + word],u32(atomicLoad(&extra[order_at(i) + word])));
        }
        var bonus = 0;
        if (is_active(i)) {
            let def = entity_def(i);
            if (defs[def + U_moneyIncome] > 0) { bonus |= adjacent_storage(i,U_moneyStorage); }
            if (defs[def + U_powerIncome] > 0) { bonus |= adjacent_storage(i,U_powerStorage) << 4u; }
        }
        atomicStore(&scratch[output + ${RENDER_STORAGE_BONUS}u],u32(bonus));
    }
    let shots = start + MAX_ENTITIES * ${RENDER_ENTITY_WORDS}u;
    if (i < u32(defs[D_projectileCountMax])) {
        let source = shot_at(i); let output = shots + i * ${RENDER_PROJECTILE_WORDS}u;
        atomicStore(&scratch[output],u32(atomicLoad(&extra[source])));
        for (var component = 0u; component < 3u; component++) {
            atomicStore(&scratch[output + component + 1u],u32(atomicLoad(&extra[source + component + 4u])));
        }
        atomicStore(&scratch[output + 4u],u32(atomicLoad(&extra[source + 3u])));
        atomicStore(&scratch[output + 5u],u32(atomicLoad(&extra[source + 1u])));
        atomicStore(&scratch[output + 6u],u32(atomicLoad(&extra[shot_aux(i)])));
        atomicStore(&scratch[output + 7u],u32(atomicLoad(&extra[shot_aux(i) + 1u])));
        atomicStore(&scratch[output + ${RENDER_PROJECTILE_LAUNCH}u],u32(atomicLoad(&extra[shot_aux(i) + 7u])));
    }
    let beams = shots + u32(defs[D_projectileCountMax]) * ${RENDER_PROJECTILE_WORDS}u;
    if (i < MAX_ENTITIES * 4u) {
        for (var word = 0u; word < ${RENDER_BEAM_WORDS}u; word++) {
            atomicStore(&scratch[beams + i * ${RENDER_BEAM_WORDS}u + word],
                u32(atomicLoad(&extra[u32(defs[D_beams]) + i * 8u + word])));
        }
    }
    if (i < u32(defs[D_projectileCountMax]) + ${SALE_EFFECT_SLOTS}u) {
        let output = beams + MAX_ENTITIES * 4u * ${RENDER_BEAM_WORDS}u +
            u32(defs[D_coarseColumns] * defs[D_coarseRows]) * 4u + i * ${RENDER_EXPLOSION_WORDS}u;
        for (var word = 0u; word < ${RENDER_EXPLOSION_WORDS}u; word++) {
            atomicStore(&scratch[output + word],
                u32(atomicLoad(&extra[u32(defs[D_explosions]) + i * ${RENDER_EXPLOSION_WORDS}u + word])));
        }
    }
    if (i < u32(defs[D_coarseColumns] * defs[D_coarseRows]) * 4u) {
        atomicStore(&scratch[beams + MAX_ENTITIES * 4u * ${RENDER_BEAM_WORDS}u + i],
            u32(atomicLoad(&extra[u32(defs[D_density]) + i])));
    }
}
var<workgroup> hash_sums: array<u32, ${workgroupSize}>;
@compute @workgroup_size(${workgroupSize})
fn state_hash(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>,
    @builtin(local_invocation_index) lane: u32) {
    let start = index(id, groups) * 4u; var sum = 0u;
    for (var n = 0u; n < 4u; n++) {
        let i = start + n;
        if (i < p(P_count) * STATE_FIELDS) { sum += pcg(bitcast<u32>(next[i]) ^ pcg(i)); }
        var offset = i;
        for (var range = 0u; range < u32(defs[D_hashRangeCount]); range++) {
            let at = u32(defs[D_hashRanges]) + range * 2u;
            let length = u32(defs[at + 1u]);
            if (offset < length) {
                let source = u32(defs[at]) + offset;
                sum += pcg(bitcast<u32>(atomicLoad(&extra[source])) ^ pcg(source ^ 2147483648u));
                break;
            }
            offset -= length;
        }
    }
    hash_sums[lane] = sum; workgroupBarrier();
    for (var stride = ${workgroupSize / 2}u; stride > 0u; stride >>= 1u) {
        if (lane < stride) { hash_sums[lane] += hash_sums[lane + stride]; }
        workgroupBarrier();
    }
    if (lane == 0u) { atomicAdd(&scratch[1], hash_sums[0]); }
}
`;
}
