import { ORDER_RECOVER } from '../commands.js';
import { MAX_ORDERS, ORDER_WORDS } from '../layout.js';

export function unitKernels(workgroupSize: number): string {
    return `
fn order_at(id: u32) -> u32 { return u32(defs[D_orders]) + id * ${ORDER_WORDS}u; }
fn remove_order(id: u32, segment: u32) {
    let at = entity(id); let count = u32(atomicLoad(&extra[at + E_orderCount]));
    if (segment >= count) { return; }
    let orders = order_at(id);
    for (var i = segment; i + 1u < count; i++) {
        for (var word = 0u; word < 4u; word++) {
            atomicStore(&extra[orders + i * 4u + word], atomicLoad(&extra[orders + (i + 1u) * 4u + word]));
        }
    }
    for (var word = 0u; word < 4u; word++) { atomicStore(&extra[orders + (count - 1u) * 4u + word], 0); }
    atomicStore(&extra[at + E_orderCount], i32(count - 1u));
    if (segment == 0u) { clear_override(id); }
}
fn push_order(id: u32, kind: i32, x: i32, z: i32, flags: i32) {
    if (!is_active(id) && !(is_live(id) && defs[entity_def(id) + U_kind] == 2 && (kind == 0 || kind == 4))) { return; }
    let at = entity(id);
    clear_override(id);
    if ((flags & 1) == 0 || kind == 4) { atomicStore(&extra[at + E_orderCount], 0); }
    if (kind == 4) { return; }
    if ((flags & ${ORDER_RECOVER}) != 0 && (kind == 0 || kind == 2) && is_active(id)) { unit_recover(id,vec2<i32>(x,z)); }
    let count = u32(atomicLoad(&extra[at + E_orderCount]));
    if (count >= ${MAX_ORDERS}u) { return; }
    let order = order_at(id) + count * 4u;
    atomicStore(&extra[order], kind); atomicStore(&extra[order + 1u], x);
    atomicStore(&extra[order + 2u], z); atomicStore(&extra[order + 3u], flags & ~9);
    atomicStore(&extra[at + E_orderCount], i32(count + 1u));
}
fn unit_size(id: u32) -> vec2<i32> {
    let def = entity_def(id);
    let rotated = (atomicLoad(&extra[entity(id) + E_rotation]) & 1) != 0;
    var size = vec2<i32>(select(defs[def + U_width], defs[def + U_depth], rotated),
        select(defs[def + U_depth], defs[def + U_width], rotated)) * Q;
    if (defs[def + U_kind] == 2) { size = size * 7 / 10; }
    return size;
}
fn unit_bounds(id: u32, point: vec2<i32>) -> vec4<i32> {
    let size = unit_size(id);
    return vec4<i32>((point - size / 2) / Q, (point + size / 2 + vec2<i32>(Q - 1)) / Q);
}
fn flight_clear(point: vec2<i32>, size: vec2<i32>, height: i32, before: vec2<i32>) -> bool {
    for (var z = -1; z <= 1; z++) { for (var x = -1; x <= 1; x++) {
        let offset = vec2<i32>(x,z) * size / 2;
        let a = before + offset; let b = point + offset;
        let start = vec3<i32>(a.x,building_height(a.x,a.y) + height,a.y);
        let end = vec3<i32>(b.x,building_height(b.x,b.y) + height,b.y);
        if (building_hit(start,end - start) <= Q) { return false; }
    } }
    return true;
}
fn unit_fits(id: u32, point: vec2<i32>) -> bool {
    let size = unit_size(id);
    if (any(point < size / 2)) { return false; }
    let bounds = unit_bounds(id, point);
    if (bounds.z > i32(p(P_columns)) || bounds.w > i32(p(P_rows))) { return false; }
    let height = defs[entity_def(id) + U_flightHeight];
    if (height > 0) {
        let at = entity(id);
        if (!flight_clear(point,size,height,vec2<i32>(atomicLoad(&extra[at + E_x]),
            atomicLoad(&extra[at + E_z])))) { return false; }
    }
    for (var z = bounds.y; z < bounds.w; z++) { for (var x = bounds.x; x < bounds.z; x++) {
        let cell = u32(z) * p(P_columns) + u32(x); let occupied = occupancy(cell);
        if (height == 0 && (base_cost(cell) == 0u || (occupied >= 0 && occupied != i32(id) &&
            defs[entity_def(u32(occupied)) + U_kind] != 2))) { return false; }
    } }
    for (var other = 0u; other < min(MAX_ENTITIES,u32(atomicLoad(&extra[2]))); other++) {
        if (other == id || atomicLoad(&extra[entity(other) + E_state]) == 0 ||
            defs[entity_def(other) + U_kind] != 2 ||
            defs[entity_def(other) + U_flightHeight] != height) { continue; }
        let centre = vec2<i32>(atomicLoad(&extra[entity(other) + E_x]),atomicLoad(&extra[entity(other) + E_z]));
        if (all(abs(point - centre) < (size + unit_size(other)) / 2)) { return false; }
    }
    return true;
}
fn unit_occupancy(id: u32, point: vec2<i32>, occupy: bool) {
    if (defs[entity_def(id) + U_flightHeight] > 0) { return; }
    let bounds = unit_bounds(id, point);
    for (var z = max(0,bounds.y); z < min(i32(p(P_rows)),bounds.w); z++) {
        for (var x = max(0,bounds.x); x < min(i32(p(P_columns)),bounds.z); x++) {
            let cell = u32(z) * p(P_columns) + u32(x);
            if (occupy || occupancy(cell) == i32(id)) { occupancy_set(cell, select(-1, i32(id), occupy)); }
        }
    }
}
fn unit_recover(id: u32, point: vec2<i32>) {
    let at = entity(id); let size = unit_size(id);
    let before = vec2<i32>(atomicLoad(&extra[at + E_x]),atomicLoad(&extra[at + E_z]));
    if (any(abs(point - before) > vec2<i32>(64 * Q))) { return; }
    let height = defs[entity_def(id) + U_flightHeight];
    var embedded = false;
    for (var z = -1; z <= 1; z++) { for (var x = -1; x <= 1; x++) {
        let position = before + vec2<i32>(x,z) * size / 2;
        let sample = vec3<i32>(position.x,building_height(position.x,position.y) + height + Q / 2,position.y);
        embedded = embedded || building_hit(sample,vec3<i32>(0)) <= Q;
        if (height == 0) {
            let cell = cell_at(position.x,position.y); let occupied = occupancy(cell);
            if (occupied >= 0 && occupied != i32(id) && defs[entity_def(u32(occupied)) + U_kind] != 2) {
                embedded = true;
            }
        }
    } }
    if (!embedded) { return; }
    atomicStore(&extra[at + E_x],point.x); atomicStore(&extra[at + E_z],point.y);
    if (!unit_fits(id,point)) {
        atomicStore(&extra[at + E_x],before.x); atomicStore(&extra[at + E_z],before.y); return;
    }
    unit_occupancy(id,before,false); unit_occupancy(id,point,true);
    let recovery = u32(defs[D_unitRecovery]) + id * 4u;
    for (var word = 0u; word < 4u; word++) { atomicStore(&extra[recovery + word],0); }
    atomicStore(&extra[at + E_speed],0);
}
@compute @workgroup_size(1)
fn order_prepare() {
    for (var id = 0u; id < min(MAX_ENTITIES,u32(atomicLoad(&extra[2]))); id++) {
        let at = entity(id); let def = entity_def(id);
        if (!is_active(id) || atomicLoad(&extra[at + E_orderCount]) == 0) { continue; }
        let order = order_at(id);
        let position = vec2<i32>(atomicLoad(&extra[at + E_x]),atomicLoad(&extra[at + E_z]));
        let arrival = min(defs[def + U_width],defs[def + U_depth]) * Q / 2 + defs[def + U_speed] / 10;
        while (atomicLoad(&extra[at + E_orderCount]) > 1 && atomicLoad(&extra[order]) == 0 &&
            atomicLoad(&extra[order + 4u]) == 0) {
            let point = vec2<i32>(atomicLoad(&extra[order + 1u]),atomicLoad(&extra[order + 2u]));
            if (any(abs(point - position) > vec2<i32>(arrival))) { break; }
            remove_order(id,0u);
        }
        let kind = atomicLoad(&extra[order]);
        if (kind == 1) {
            let victim = atomicLoad(&extra[order + 1u]);
            if (victim < 0 || victim >= i32(p(P_count)) || current(F_hp,u32(victim)) <= 0) { remove_order(id,0u); }
        } else if (kind == 3) {
            let flags = atomicLoad(&extra[order + 3u]); let issued = (flags & 256) != 0;
            var firing = false;
            for (var mount = 0u; mount < u32(defs[def + U_weaponCount]); mount++) {
                let state = weapon_state(id * 4u + mount);
                if (!issued) {
                    atomicStore(&extra[state + 3u],1);
                    atomicStore(&extra[state + 4u],atomicLoad(&extra[order + 1u]));
                    atomicStore(&extra[state + 5u],atomicLoad(&extra[order + 2u]));
                }
                firing = firing || atomicLoad(&extra[state + 3u]) != 0;
            }
            atomicStore(&extra[order + 3u],flags | 256);
            if (!firing) { remove_order(id,0u); }
        }
    }
}
@compute @workgroup_size(${workgroupSize})
fn unit_move(@builtin(global_invocation_id) invocation: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let id = index(invocation,groups); if (id >= MAX_ENTITIES) { return; }
    let at = entity(id); let motion = u32(defs[D_unitMotion]) + id * 4u;
    let position = vec2<i32>(atomicLoad(&extra[at + E_x]),atomicLoad(&extra[at + E_z]));
    let facing = atomicLoad(&extra[at + E_facing]);
    atomicStore(&extra[motion],position.x); atomicStore(&extra[motion + 1u],position.y);
    atomicStore(&extra[motion + 2u],facing); atomicStore(&extra[motion + 3u],0);
    if (!is_active(id) || atomicLoad(&extra[at + E_orderCount]) == 0) { return; }
    let def = entity_def(id); if (defs[def + U_kind] != 2) { return; }
    let order = order_at(id); let kind = atomicLoad(&extra[order]);
    if (kind == 3) { atomicStore(&extra[motion + 3u],2); return; }
    if ((kind == 1 || kind == 2) && defs[def + U_fireOnMove] == 0 &&
        (atomicLoad(&extra[at + E_flags]) & 1) == 0) {
        for (var mount = 0u; mount < u32(defs[def + U_weaponCount]); mount++) {
            let weapon = id * 4u + mount; let victim = atomicLoad(&extra[weapon_state(weapon) + 2u]);
            if (victim >= 0 && current(F_hp,u32(victim)) > 0 &&
                weapon_range(weapon,weapon_def(weapon),vec2<i32>(current(F_x,u32(victim)),current(F_z,u32(victim))))) {
                atomicStore(&extra[motion + 3u],2); return;
            }
        }
    }
    var point = vec2<i32>(atomicLoad(&extra[order + 1u]),atomicLoad(&extra[order + 2u]));
    var arrival_point = point;
    if (kind == 1) {
        let victim = point.x;
        if (victim < 0 || victim >= i32(p(P_count)) || current(F_hp,u32(victim)) <= 0) {
            atomicStore(&extra[motion + 3u],1); return;
        }
        point = vec2<i32>(current(F_x,u32(victim)),current(F_z,u32(victim)));
        arrival_point = point;
    }
    let goal_delta = arrival_point - position;
    let intermediate = atomicLoad(&extra[at + E_orderCount]) > 1;
    let arrival = min(defs[def + U_width],defs[def + U_depth]) * Q / 2 +
        select(0,defs[def + U_speed] / 10,intermediate);
    if (max(abs(goal_delta.x),abs(goal_delta.y)) <= arrival) {
        atomicStore(&extra[motion + 3u],select(1,2,kind == 1)); return;
    }
    var delta = point - position; let speed = max(1,defs[def + U_speed] / 20);
    let recovery = u32(defs[D_unitRecovery]) + id * 4u;
    let nudge_end = atomicLoad(&extra[recovery + 3u]);
    if (nudge_end > i32(p(P_tick))) {
        let jitter = LUT[random(p(P_seed),id,u32(nudge_end),1129u) & 255u];
        let travel = min(speed,Q / 10);
        atomicStore(&extra[motion],position.x + jitter.x * travel / 16384);
        atomicStore(&extra[motion + 1u],position.y + jitter.y * travel / 16384); return;
    }
    let heading = atan2_q(delta.y,delta.x);
    let drive = vec2<i32>(mul_q(cos_q(heading),speed),mul_q(sin_q(heading),speed)) / 256;
    var pressure = vec2<i32>(0);
    for (var other = 0u; other < min(MAX_ENTITIES,u32(atomicLoad(&extra[2]))); other++) {
        if (other == id || atomicLoad(&extra[entity(other) + E_state]) == 0 ||
            defs[entity_def(other) + U_kind] != 2 ||
            defs[entity_def(other) + U_flightHeight] != defs[def + U_flightHeight]) { continue; }
        let difference = (position - vec2<i32>(atomicLoad(&extra[entity(other) + E_x]),atomicLoad(&extra[entity(other) + E_z]))) / 256;
        if (max(abs(difference.x),abs(difference.y)) >= 2048) { continue; }
        let distance = max(1,i32(root(u32(difference.x * difference.x + difference.y * difference.y))));
        let other_at = entity(other); let angle = atomicLoad(&extra[other_at + E_facing]);
        let travel = atomicLoad(&extra[other_at + E_speed]) / 20;
        let relative = drive - vec2<i32>(mul_q(cos_q(angle),travel),mul_q(sin_q(angle),travel)) / 256;
        let closing = -(difference.x * relative.x + difference.y * relative.y);
        let horizon = clamp(closing / max(1,relative.x * relative.x + relative.y * relative.y),0,20);
        let future = difference + relative * horizon;
        let clearance = max(unit_size(id).x + unit_size(other).x,unit_size(id).y + unit_size(other).y) / 512 + 128;
        if (closing > 0 && future.x * future.x + future.y * future.y < clearance * clearance) {
            pressure += vec2<i32>(-difference.y,difference.x) * 256 / distance;
        }
        if (distance < 768) { pressure += difference * ((768 - distance) * 256 / 768) / distance; }
    }
    delta = vec2<i32>(cos_q(heading),sin_q(heading)) * 2 +
        clamp(pressure,vec2<i32>(-256),vec2<i32>(256)) * 256 / max(1,defs[def + U_mass]);
    let desired = atan2_q(delta.y,delta.x); let turn = clamp(turn_delta(facing,desired),-defs[def + U_turnRate],defs[def + U_turnRate]);
    let angle = (facing + turn) & 65535;
    let travel = select(speed,0,abs(turn_delta(facing,desired)) > 8192);
    let next = position + vec2<i32>(mul_q(cos_q(angle),travel),mul_q(sin_q(angle),travel));
    atomicStore(&extra[motion],next.x); atomicStore(&extra[motion + 1u],next.y); atomicStore(&extra[motion + 2u],angle);
}
@compute @workgroup_size(1)
fn unit_commit() {
    for (var id = 0u; id < min(MAX_ENTITIES,u32(atomicLoad(&extra[2]))); id++) {
        let at = entity(id); if (!is_active(id) || defs[entity_def(id) + U_kind] != 2) { continue; }
        let motion = u32(defs[D_unitMotion]) + id * 4u;
        let old = vec2<i32>(atomicLoad(&extra[at + E_x]),atomicLoad(&extra[at + E_z]));
        let proposed = vec2<i32>(atomicLoad(&extra[motion]),atomicLoad(&extra[motion + 1u]));
        var next = old;
        if (unit_fits(id,vec2<i32>(proposed.x,old.y))) { next.x = proposed.x; }
        if (unit_fits(id,vec2<i32>(next.x,proposed.y))) { next.y = proposed.y; }
        unit_occupancy(id,old,false); unit_occupancy(id,next,true);
        atomicStore(&extra[at + E_x],next.x); atomicStore(&extra[at + E_z],next.y);
        atomicStore(&extra[at + E_facing],atomicLoad(&extra[motion + 2u]));
        atomicStore(&extra[at + E_speed],max(abs(next.x - old.x),abs(next.y - old.y)) * 20);
        let flags = atomicLoad(&extra[motion + 3u]);
        if ((flags & 1) != 0) { remove_order(id,0u); }
        let recovery = u32(defs[D_unitRecovery]) + id * 4u;
        let anchor = vec2<i32>(atomicLoad(&extra[recovery]),atomicLoad(&extra[recovery + 1u]));
        if (atomicLoad(&extra[at + E_orderCount]) == 0 || (flags & 2) != 0 ||
            max(abs(next.x - anchor.x),abs(next.y - anchor.y)) >= Q / 10) {
            atomicStore(&extra[recovery],next.x); atomicStore(&extra[recovery + 1u],next.y);
            atomicStore(&extra[recovery + 2u],0);
            if ((flags & 2) != 0 || atomicLoad(&extra[at + E_orderCount]) == 0) {
                atomicStore(&extra[recovery + 3u],0);
            }
        } else {
            let stationary = atomicLoad(&extra[recovery + 2u]) + 1;
            atomicStore(&extra[recovery + 2u],stationary);
            if (stationary >= 40) {
                atomicStore(&extra[recovery + 3u],i32(p(P_tick)) + 10);
                atomicStore(&extra[recovery + 2u],0);
            }
        }
    }
}
`;
}
