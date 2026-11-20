import { WEAPON, WEAPON_STRIDE, fireWGSL } from '../weapon/registry.js';
import { PROJECTILE, PROJECTILE_STRIDE } from '../projectile/registry.js';
import { ORDER_TARGET_SHIFT } from '../commands.js';

export function combatKernels(workgroupSize: number): string {
    return `
${Object.entries(WEAPON).map(([name, value]) => `const W_${name}: u32 = ${value}u;`).join('\n')}
${Object.entries(PROJECTILE).map(([name, value]) => `const J_${name}: u32 = ${value}u;`).join('\n')}
fn weapon_state(id: u32) -> u32 { return u32(defs[D_weaponState]) + id * 8u; }
fn weapon_def(id: u32) -> u32 {
    let body = entity_def(id / 4u);
    return u32(defs[D_weapon]) + u32(defs[body + U_weapons + id % 4u]) * ${WEAPON_STRIDE}u;
}
fn weapon_live(id: u32) -> bool {
    return is_active(id / 4u) && i32(id % 4u) < defs[entity_def(id / 4u) + U_weaponCount];
}
fn shot_at(id: u32) -> u32 { return u32(defs[D_projectiles]) + id * 12u; }
fn shot_aux(id: u32) -> u32 { return u32(defs[D_projectileAux]) + id * 8u; }
fn shot_def(id: u32) -> u32 {
    return u32(defs[D_projectile]) + u32(atomicLoad(&extra[shot_at(id) + 3u])) * ${PROJECTILE_STRIDE}u;
}
fn turn_delta(a: i32, b: i32) -> i32 { return ((b - a + 32768) & 65535) - 32768; }
fn mount_position(id: u32) -> vec2<i32> {
    let at = entity(id / 4u); let body = entity_def(id / 4u);
    let angle = atomicLoad(&extra[at + E_facing]);
    let x = defs[body + U_mountX + id % 4u]; let z = defs[body + U_mountZ + id % 4u];
    return vec2<i32>(atomicLoad(&extra[at + E_x]) + mul_q(x, cos_q(angle)) - mul_q(z, sin_q(angle)),
        atomicLoad(&extra[at + E_z]) + mul_q(x, sin_q(angle)) + mul_q(z, cos_q(angle)));
}
fn weapon_range(id: u32, definition: u32, point: vec2<i32>) -> bool {
    let origin = mount_position(id); let delta = point - origin;
    let dx = cm(delta.x); let dz = cm(delta.y);
    if (!in_circle(dx, dz, cm(defs[definition + W_maxRange]))) { return false; }
    let minimum = cm(defs[definition + W_minRange]);
    if (minimum > 0 && in_circle(dx, dz, minimum - 1)) { return false; }
    return defs[definition + W_traverseArc] >= 65536 ||
        abs(turn_delta(atomicLoad(&extra[entity(id / 4u) + E_facing]), atan2_q(delta.y, delta.x))) <=
            defs[definition + W_traverseArc] / 2;
}
fn weapon_targetable(id: u32, definition: u32, victim: i32) -> bool {
    if (victim < 0 || victim >= i32(p(P_count))) { return false; }
    let zombie = u32(victim);
    if (current(F_hp,zombie) <= 0 || (meta_state(current(F_meta,zombie)) != 1 &&
        meta_state(current(F_meta,zombie)) != 2)) { return false; }
    let point = vec2<i32>(current(F_x,zombie),current(F_z,zombie));
    if (!weapon_range(id,definition,point)) { return false; }
    let origin = mount_position(id);
    let height = select(Q,Q * 6 / 5,defs[definition + W_fire] == 1) +
        defs[entity_def(id / 4u) + U_flightHeight];
    let start = vec3<i32>(origin.x,building_height(origin.x,origin.y) + height,origin.y);
    let finish = vec3<i32>(point.x,building_height(point.x,point.y) +
        defs[zombie_def(meta_variant(current(F_meta,zombie))) + 3u] / 2,point.y);
    return building_hit(start,finish - start) > Q;
}
fn flight_ticks(delta: vec2<i32>, definition: u32) -> i32 {
    var horizontal = vec2<i32>(cm(delta.x),cm(delta.y)); var scale = 1;
    while (max(abs(horizontal.x),abs(horizontal.y)) > 32767) { horizontal /= 2; scale *= 2; }
    let distance = i32(root(u32(horizontal.x * horizontal.x + horizontal.y * horizontal.y))) * scale;
    let launch_angle = defs[definition + J_launchAngle];
    if (launch_angle > 0 && defs[definition + J_motion] == 1) {
        let tangent = sin_q(launch_angle) * 256 / max(1,cos_q(launch_angle));
        let squared_time = u32(800 * (100 + distance * tangent / 256) / max(1,cm(defs[definition + J_gravity])));
        var ticks = root(squared_time);
        if (ticks * ticks < squared_time) { ticks++; }
        return clamp(i32(ticks),2,max(2,defs[definition + J_ttl]));
    }
    let speed = max(1, cm(defs[definition + J_speed]) / 20);
    return clamp((distance + speed - 1) / speed, 1, max(1, defs[definition + J_ttl]));
}
fn aim_point(id: u32, definition: u32) -> vec2<i32> {
    let at = weapon_state(id);
    if (atomicLoad(&extra[at + 3u]) != 0) {
        return vec2<i32>(atomicLoad(&extra[at + 4u]), atomicLoad(&extra[at + 5u]));
    }
    let victim = atomicLoad(&extra[at + 2u]);
    if (victim < 0 || victim >= i32(p(P_count))) { return mount_position(id); }
    let point = vec2<i32>(current(F_x, u32(victim)), current(F_z, u32(victim)));
    let projectile = u32(defs[D_projectile]) + u32(defs[definition + W_projectile]) * ${PROJECTILE_STRIDE}u;
    if (defs[projectile + J_motion] == 3) { return point; }
    let origin = mount_position(id);
    let velocity = vec2<i32>(current(F_vx,u32(victim)),current(F_vz,u32(victim)));
    let boundary = vec2<i32>(i32(p(P_widthQ)),i32(p(P_depthQ)));
    var ticks = flight_ticks(point - origin,projectile); var predicted = point;
    for (var iteration = 0u; iteration < 8u; iteration++) {
        predicted = point + clamp(velocity * ticks,-point,boundary - point);
        if (defs[projectile + J_launchAngle] > 0) {
            var delta = vec2<i32>(cm(predicted.x - origin.x),cm(predicted.y - origin.y)); var scale = 1;
            while (max(abs(delta.x),abs(delta.y)) > 32767) { delta /= 2; scale *= 2; }
            let distance = i32(root(u32(delta.x * delta.x + delta.y * delta.y))) * scale;
            let reach = min(cm(defs[definition + W_maxRange]) - 1,distance + cm(defs[projectile + J_radius]));
            let range_q = reach / 100 * Q + reach % 100 * Q / 100;
            let angle = atan2_q(predicted.y - origin.y,predicted.x - origin.x);
            predicted = clamp(origin + vec2<i32>(mul_q(range_q,cos_q(angle)),mul_q(range_q,sin_q(angle))),
                vec2<i32>(0),boundary);
        }
        let revised = flight_ticks(predicted - origin,projectile);
        if (revised == ticks) { break; }
        ticks = revised;
    }
    return predicted;
}
struct TargetQuery {
    low: vec2<i32>, high: vec2<i32>, cell: vec2<i32>, slot: i32, end: i32, fine: bool, columns: i32, step: i32
}
fn target_query(low: vec2<i32>, high: vec2<i32>, allow_fine: bool) -> TargetQuery {
    let fine_max = vec2<i32>(i32(p(P_gridColumns)) - 1,i32(p(P_gridRows)) - 1);
    let fine_low = clamp(low / max(1,i32(p(P_gridCellQ))),vec2<i32>(0),fine_max);
    let fine_high = clamp(high / max(1,i32(p(P_gridCellQ))),vec2<i32>(0),fine_max);
    let fine = defs[D_coarseScale] == 1 || (allow_fine && all(fine_high - fine_low < vec2<i32>(6)));
    if (fine) { return TargetQuery(fine_low,fine_high,fine_low,-1,0,true,i32(p(P_gridColumns)),1); }
    let pitch = i32(p(P_gridCellQ)) * defs[D_coarseScale];
    let maximum = vec2<i32>(defs[D_coarseColumns] - 1, defs[D_coarseRows] - 1);
    let first = clamp(low / max(1, pitch), vec2<i32>(0), maximum);
    let last = clamp(high / max(1, pitch), vec2<i32>(0), maximum);
    return TargetQuery(first, last, first, -1, 0, false, defs[D_coarseColumns],1);
}
fn target_next(query: ptr<function, TargetQuery>) -> i32 {
    while ((*query).cell.y <= (*query).high.y) {
        if ((*query).slot < 0) {
            let cell = u32((*query).cell.y * (*query).columns + (*query).cell.x);
            var count = 0;
            if ((*query).fine) {
                count = i32(atomicLoad(&scratch[p(P_counts) + cell]));
                (*query).slot = i32(atomicLoad(&scratch[p(P_offsets) + cell])) - count;
            } else {
                count = atomicLoad(&extra[u32(defs[D_coarseCounts]) + cell]);
                (*query).slot = atomicLoad(&extra[u32(defs[D_coarseScan]) + cell]);
            }
            (*query).end = (*query).slot + count;
        }
        if ((*query).slot < (*query).end) {
            var id = -1;
            if ((*query).fine) { id = i32(atomicLoad(&scratch[p(P_sorted) + u32((*query).slot)])); }
            else { id = atomicLoad(&extra[u32(defs[D_coarseIds]) + u32((*query).slot)]); }
            (*query).slot++; return id;
        }
        let width = (*query).high.x - (*query).low.x + 1;
        let offset = (*query).cell.x - (*query).low.x + (*query).step;
        (*query).cell.x = (*query).low.x + offset % width;
        (*query).cell.y += offset / width; (*query).slot = -1;
    }
    return -1;
}
fn target_sample(query: ptr<function, TargetQuery>, weapon: u32) -> i32 {
    while ((*query).cell.y <= (*query).high.y) {
        let cell = u32((*query).cell.y * defs[D_coarseColumns] + (*query).cell.x);
        var count = u32(atomicLoad(&extra[u32(defs[D_coarseCounts]) + cell]));
        var start = u32(atomicLoad(&extra[u32(defs[D_coarseScan]) + cell]));
        if (defs[D_coarseScale] == 1) {
            count = atomicLoad(&scratch[p(P_counts) + cell]);
            start = atomicLoad(&scratch[p(P_offsets) + cell]) - count;
        }
        if ((*query).slot < 0) { (*query).slot = 0; }
        if (u32((*query).slot) < min(count, 4u)) {
            let sample = (random(p(P_seed), weapon, p(P_tick), cell) % count + u32((*query).slot)) % count;
            (*query).slot++;
            if (defs[D_coarseScale] == 1) {
                return i32(atomicLoad(&scratch[p(P_sorted) + start + sample]));
            }
            return atomicLoad(&extra[u32(defs[D_coarseIds]) + start + sample]);
        }
        (*query).cell.x++; (*query).slot = -1;
        if ((*query).cell.x > (*query).high.x) { (*query).cell.x = (*query).low.x; (*query).cell.y++; }
    }
    return -1;
}
@compute @workgroup_size(${workgroupSize})
fn coarse_count(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let i = index(id, groups); let columns = u32(defs[D_coarseColumns]);
    if (i >= columns * u32(defs[D_coarseRows])) { return; }
    let scale = u32(defs[D_coarseScale]); let origin = vec2<u32>(i % columns, i / columns) * scale;
    var count = 0u;
    for (var z = origin.y; z < min(origin.y + scale, p(P_gridRows)); z++) {
        for (var x = origin.x; x < min(origin.x + scale, p(P_gridColumns)); x++) {
            count += atomicLoad(&scratch[p(P_counts) + z * p(P_gridColumns) + x]);
        }
    }
    atomicStore(&extra[u32(defs[D_coarseCounts]) + i], i32(count));
    atomicStore(&scratch[p(P_scanB) + i], count);
}
@compute @workgroup_size(${workgroupSize})
fn coarse_scatter(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let i = index(id, groups); let columns = u32(defs[D_coarseColumns]);
    if (i >= columns * u32(defs[D_coarseRows])) { return; }
    let scale = u32(defs[D_coarseScale]); let origin = vec2<u32>(i % columns, i / columns) * scale;
    var destination = atomicLoad(&scratch[p(P_scanB) + i]) -
        u32(atomicLoad(&extra[u32(defs[D_coarseCounts]) + i]));
    atomicStore(&extra[u32(defs[D_coarseScan]) + i], i32(destination));
    for (var z = origin.y; z < min(origin.y + scale, p(P_gridRows)); z++) {
        for (var x = origin.x; x < min(origin.x + scale, p(P_gridColumns)); x++) {
            let cell = z * p(P_gridColumns) + x; let count = atomicLoad(&scratch[p(P_counts) + cell]);
            let start = atomicLoad(&scratch[p(P_output) + cell]) - count;
            for (var n = 0u; n < count; n++) {
                let victim = atomicLoad(&scratch[p(P_input) + start + n]);
                atomicStore(&extra[u32(defs[D_coarseIds]) + destination], i32(victim)); destination++;
            }
        }
    }
}
fn target_tie(mount: u32, zombie: u32) -> u32 {
    return select(random(p(P_seed),mount,zombie,1237u),zombie,defs[D_targetSpread] == 0);
}
fn target_better(mount: u32, score: u32, victim: i32, best: u32, selected: i32) -> bool {
    if (selected < 0) { return true; }
    if (score != best) { return score < best; }
    let candidate = target_tie(mount,u32(victim)); let previous = target_tie(mount,u32(selected));
    return candidate < previous || (candidate == previous && victim < selected);
}
fn target_score(mount: u32, zombie: u32, artillery: bool) -> u32 {
    let body = entity(mount / 4u);
    let point = vec2<i32>(current(F_x,zombie),current(F_z,zombie));
    let delta = point - mount_position(mount); let dx = cm(delta.x); let dz = cm(delta.y);
    let distance = u32(dx * dx + dz * dz) / 100u;
    let radius = cm(defs[weapon_def(mount) + W_maxRange]);
    let spread = max(1u,(u32(radius * radius) / 100u) * u32(defs[D_targetSpread]) / 100u);
    let jitter = select(target_tie(mount,zombie) % spread,0u,defs[D_targetSpread] == 0);
    if (artillery) { return min(16777215u,distance + jitter); }
    let variant = meta_variant(current(F_meta,zombie)); var rank = 15u;
    if (variant < 16) {
        let ranks = select(E_priorityLow,E_priorityHigh,variant >= 8);
        rank = (u32(atomicLoad(&extra[body + ranks])) >> (u32(variant & 7) * 4u)) & 15u;
    }
    var metric = distance + jitter;
    switch (atomicLoad(&extra[body + E_flags]) >> 1u) & 3 {
        case 1: { metric = u32(current(F_hp,zombie)); }
        case 2: { metric = 16777215u - min(16777215u,u32(current(F_hp,zombie))); }
        case 3: {
            let cell = cell_at(point.x,point.y); metric = INF;
            if (cell != 4294967295u) { metric = active_distance(cell,0u); }
        }
        default: {}
    }
    return (rank << 24u) | min(16777215u,metric);
}
var<workgroup> artillery_mount: u32;
var<workgroup> artillery_scores: array<u32, ${workgroupSize}>;
var<workgroup> artillery_victims: array<i32, ${workgroupSize}>;
@compute @workgroup_size(${workgroupSize})
fn artillery_scan(@builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) group: vec3<u32>) {
    if (lane == 0u) {
        artillery_mount = 4294967295u;
        if (group.x < atomicLoad(&scratch[p(P_artilleryQueue)])) {
            artillery_mount = atomicLoad(&scratch[p(P_artilleryQueue) + 1u + group.x]);
        }
    }
    workgroupBarrier();
    let mount = workgroupUniformLoad(&artillery_mount); if (mount == 4294967295u) { return; }
    let definition = weapon_def(mount); let radius = defs[definition + W_maxRange] + 2 * Q;
    let origin = mount_position(mount);
    let base = target_query(origin - vec2<i32>(radius),origin + vec2<i32>(radius),false);
    let columns = u32(base.high.x - base.low.x + 1); let rows = u32(base.high.y - base.low.y + 1);
    var best = 4294967295u; var selected = -1;
    for (var cell = lane; cell < columns * rows; cell += ${workgroupSize}u) {
        let point = base.low + vec2<i32>(i32(cell % columns),i32(cell / columns));
        var query = TargetQuery(point,point,point,-1,0,base.fine,base.columns,1);
        loop {
            let victim = target_next(&query); if (victim < 0) { break; }
            if (victim >= i32(p(P_count)) || current(F_hp,u32(victim)) <= 0) { continue; }
            let score = target_score(mount,u32(victim),true);
            if (!target_better(mount,score,victim,best,selected)) { continue; }
            if (!weapon_targetable(mount,definition,victim)) { continue; }
            best = score; selected = victim;
        }
    }
    artillery_scores[lane] = best; artillery_victims[lane] = selected;
    workgroupBarrier();
    for (var stride = ${workgroupSize / 2}u; stride > 0u; stride /= 2u) {
        if (lane < stride) {
            let other = artillery_victims[lane + stride]; let score = artillery_scores[lane + stride];
            if (other >= 0 && target_better(mount,score,other,artillery_scores[lane],artillery_victims[lane])) {
                artillery_scores[lane] = score; artillery_victims[lane] = other;
            }
        }
        workgroupBarrier();
    }
    if (lane == 0u) {
        let at = weapon_state(mount);
        atomicStore(&extra[at + 2u],artillery_victims[0]);
        atomicStore(&extra[at + 6u],i32(p(P_tick)) + 4);
    }
}
@compute @workgroup_size(${workgroupSize})
fn weapon_target(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let i = index(id, groups); if (i >= MAX_ENTITIES * 4u || !weapon_live(i)) { return; }
    let at = weapon_state(i); let body = entity(i / 4u); let definition = weapon_def(i);
    if (defs[definition + W_fire] == 3) { return; }
    let previous = atomicLoad(&extra[at + 2u]);
    let cooldown = max(0, atomicLoad(&extra[at]) - 1);
    atomicStore(&extra[at], cooldown);
    atomicStore(&extra[at + 2u], -1);
    if (defs[definition + W_fire] == 2 || (atomicLoad(&extra[body + E_flags]) & 1) != 0) { return; }
    if (atomicLoad(&extra[at + 3u]) != 0) {
        let point = vec2<i32>(atomicLoad(&extra[at + 4u]), atomicLoad(&extra[at + 5u]));
        atomicStore(&extra[at + 2u], select(-2, -3, weapon_range(i, definition, point))); return;
    }
    if ((defs[definition + W_targetMask] & 1) == 0) { return; }
    if (atomicLoad(&extra[body + E_orderCount]) > 0) {
        let order = order_at(i / 4u); let kind = atomicLoad(&extra[order]);
        let preferred = select(-1,(atomicLoad(&extra[order + 3u]) >> ${ORDER_TARGET_SHIFT}u) - 1,kind == 2);
        let victim = select(preferred,atomicLoad(&extra[order + 1u]),kind == 1);
        if (victim >= 0) {
            if (weapon_targetable(i,definition,victim)) { atomicStore(&extra[at + 2u],victim); }
            return;
        }
    }
    let projectile = u32(defs[D_projectile]) + u32(defs[definition + W_projectile]) * ${PROJECTILE_STRIDE}u;
    let artillery = defs[projectile + J_launchAngle] > 0;
    let tracking = defs[definition + W_fire] == 1;
    if ((tracking || (artillery && cooldown != 1) || (cooldown > 1 && (p(P_tick) + i) % 4u != 0u)) &&
        weapon_targetable(i,definition,previous)) {
        atomicStore(&extra[at + 2u], previous); return;
    }
    if (artillery && previous < 0 && i32(p(P_tick)) < atomicLoad(&extra[at + 6u])) { return; }
    let origin = mount_position(i); let radius = defs[definition + W_maxRange] + 2 * Q;
    if (artillery && cooldown <= 1) {
        let queued = atomicAdd(&scratch[p(P_artilleryQueue)],1u);
        atomicStore(&scratch[p(P_artilleryQueue) + 1u + queued],i); return;
    }
    var query = target_query(origin - vec2<i32>(radius), origin + vec2<i32>(radius), false);
    var best = 4294967295u; var selected = -1;
    loop {
        var victim = -1;
        if (artillery && cooldown <= 1) { victim = target_next(&query); }
        else { victim = target_sample(&query,i); }
        if (victim < 0) { break; }
        if (victim >= i32(p(P_count)) || current(F_hp,u32(victim)) <= 0) { continue; }
        let score = target_score(i,u32(victim),artillery);
        if (!target_better(i,score,victim,best,selected)) { continue; }
        if (!weapon_targetable(i,definition,victim)) { continue; }
        best = score; selected = victim;
    }
    if (artillery) { atomicStore(&extra[at + 6u],i32(p(P_tick)) + 4); }
    atomicStore(&extra[at + 2u], selected);
}
@compute @workgroup_size(${workgroupSize})
fn weapon_aim(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let i = index(id, groups); if (i >= MAX_ENTITIES * 4u || !weapon_live(i)) { return; }
    let at = weapon_state(i); let victim = atomicLoad(&extra[at + 2u]);
    let definition = weapon_def(i);
    if (defs[definition + W_fire] == 3) { return; }
    if ((victim >= 0 && !weapon_targetable(i,definition,victim)) ||
        (victim < 0 && (victim != -3 || atomicLoad(&extra[at + 3u]) == 0))) {
        atomicStore(&extra[at + 2u],-1); return;
    }
    let delta = aim_point(i, definition) - mount_position(i);
    let desired = atan2_q(delta.y, delta.x); let angle = atomicLoad(&extra[at + 1u]);
    let rate = defs[definition + W_turnRate];
    atomicStore(&extra[at + 1u], (angle + clamp(turn_delta(angle, desired), -rate, rate)) & 65535);
}
${fireWGSL()}
@compute @workgroup_size(${workgroupSize})
fn weapon_fire(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let i = index(id, groups); if (i >= MAX_ENTITIES * 4u || !weapon_live(i)) { return; }
    let at = weapon_state(i); let definition = weapon_def(i);
    if (defs[definition + W_fire] == 3) { return; }
    if (atomicLoad(&extra[at]) > 0 || (atomicLoad(&extra[entity(i / 4u) + E_flags]) & 1) != 0) { return; }
    if (defs[definition + W_fire] != 2) {
        let victim = atomicLoad(&extra[at + 2u]);
        if ((victim >= 0 && !weapon_targetable(i,definition,victim)) ||
            (victim < 0 && (victim != -3 || atomicLoad(&extra[at + 3u]) == 0))) {
            atomicStore(&extra[at + 2u],-1); return;
        }
        let point = aim_point(i, definition); if (!weapon_range(i, definition, point)) { return; }
        let delta = point - mount_position(i);
        if (abs(turn_delta(atomicLoad(&extra[at + 1u]), atan2_q(delta.y, delta.x))) > 32) { return; }
    }
    if (fire_weapon(i, definition)) {
        atomicStore(&extra[at], defs[definition + W_cooldown]);
        if (defs[definition + W_fire] != 1 && atomicLoad(&extra[at + 3u]) == 1) {
            atomicStore(&extra[at + 3u],0); atomicStore(&extra[at + 2u],-1);
        }
    }
}
`;
}
