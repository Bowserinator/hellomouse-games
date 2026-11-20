import { effectsWGSL, PROJECTILE_STRIDE } from '../projectile/registry.js';
import { RENDER_EXPLOSION_WORDS } from '../layout.js';

export function projectileKernels(workgroupSize: number): string {
    return `
fn damage_zombie(victim: u32, damage: i32, owner: i32) {
    if (victim >= p(P_count) || current(F_hp, victim) <= 0) { return; }
    let armor = defs[zombie_def(meta_variant(current(F_meta, victim))) + 12u];
    atomicAdd(&extra[p(P_damage) + victim], max(0, damage - armor));
    atomicMin(&extra[p(P_credits) + victim], owner);
}
fn ring_slot(id: u32, definition: u32) -> i32 {
    let at = weapon_state(id); let slots = max(1, defs[definition + W_slots]);
    let cursor = atomicLoad(&extra[at + 7u]) % slots;
    let shot = id * u32(defs[D_projectileRing]) + u32(cursor);
    if (atomicLoad(&extra[shot_at(shot)]) != 0) { return -1; }
    atomicStore(&extra[at + 7u], (cursor + 1) % slots); return i32(shot);
}
fn initialize_shot(shot: u32, id: u32, definition: u32, point: vec2<i32>) {
    let at = shot_at(shot); let aux = shot_aux(shot); let origin = mount_position(id);
    for (var word = 0u; word < 12u; word++) { atomicStore(&extra[at + word], 0); }
    for (var word = 0u; word < 8u; word++) { atomicStore(&extra[aux + word], 0); }
    atomicStore(&extra[at], 1); atomicStore(&extra[at + 1u], atomicLoad(&extra[entity(id / 4u) + E_owner]));
    atomicStore(&extra[at + 2u], i32(id)); atomicStore(&extra[at + 3u], defs[definition + W_projectile]);
    atomicStore(&extra[at + 4u], origin.x); atomicStore(&extra[at + 5u], origin.y);
    atomicStore(&extra[at + 6u], Q + defs[entity_def(id / 4u) + U_flightHeight]);
    atomicStore(&extra[at + 11u], -1);
    atomicStore(&extra[aux], point.x); atomicStore(&extra[aux + 1u], point.y);
    atomicStore(&extra[aux + 3u], defs[definition + W_damageScale]);
}
fn launch_projectile(id: u32, definition: u32) -> bool {
    let slot = ring_slot(id, definition); if (slot < 0) { return false; }
    let shot = u32(slot); let at = shot_at(shot); let aux = shot_aux(shot);
    let point = aim_point(id, definition); initialize_shot(shot, id, definition, point);
    let projectile = shot_def(shot); let delta = point - mount_position(id);
    let ticks = flight_ticks(delta, projectile);
    atomicStore(&extra[at + 10u], ticks); atomicStore(&extra[aux + 2u], ticks);
    if (defs[projectile + J_motion] == 1) {
        atomicStore(&extra[at + 7u], delta.x / ticks); atomicStore(&extra[at + 8u], delta.y / ticks);
        var vertical = defs[projectile + J_gravity] / 400 * (ticks - 1) / 2;
        if (defs[projectile + J_launchAngle] > 0) { vertical -= Q / ticks; }
        atomicStore(&extra[at + 9u], vertical);
        let horizontal = i32(root(u32(cm(delta.x / ticks) * cm(delta.x / ticks) +
            cm(delta.y / ticks) * cm(delta.y / ticks))));
        atomicStore(&extra[aux + 5u], atan2_q(cm(vertical),horizontal));
        let power = i32(root(u32(horizontal * horizontal + cm(vertical) * cm(vertical)))) * 20;
        atomicStore(&extra[aux + 6u], power / 100 * Q + power % 100 * Q / 100);
    } else {
        var angle = atomicLoad(&extra[weapon_state(id) + 1u]); let spread = defs[definition + W_spread];
        if (spread > 0) { angle += i32(random(p(P_seed), id, p(P_tick), shot) % u32(spread * 2 + 1)) - spread; }
        let speed = defs[projectile + J_speed] / 20;
        atomicStore(&extra[at + 7u], mul_q(cos_q(angle), speed));
        atomicStore(&extra[at + 8u], mul_q(sin_q(angle), speed));
        let height = defs[entity_def(id / 4u) + U_flightHeight];
        if (height > 0) {
            atomicStore(&extra[at + 7u],delta.x / ticks); atomicStore(&extra[at + 8u],delta.y / ticks);
            atomicStore(&extra[at + 9u],-height / ticks);
        }
    }
    return true;
}
fn launch_beam(id: u32, definition: u32) -> bool {
    let at = u32(defs[D_beams]) + id * 8u;
    if (atomicLoad(&extra[at]) != 0) { return false; }
    let origin = mount_position(id); let angle = atomicLoad(&extra[weapon_state(id) + 1u]);
    atomicStore(&extra[at], select(1, -defs[definition + W_fireParams], defs[definition + W_fireParams] > 0));
    atomicStore(&extra[at + 1u], origin.x); atomicStore(&extra[at + 2u], origin.y);
    atomicStore(&extra[at + 3u], angle); atomicStore(&extra[at + 4u], angle); atomicStore(&extra[at + 5u], angle);
    atomicStore(&extra[at + 6u], i32(definition));
    atomicStore(&extra[at + 7u], atomicLoad(&extra[entity(id / 4u) + E_owner]));
    return true;
}
fn launch_mine(id: u32, definition: u32) -> bool {
    let body = entity(id / 4u); let unit = entity_def(id / 4u);
    if (i32(p(P_tick)) < atomicLoad(&extra[body + E_timer])) { return false; }
    let origin = mount_position(id); let radius = defs[unit + U_triggerRadius];
    var query = target_query(origin - vec2<i32>(radius + 2 * Q), origin + vec2<i32>(radius + 2 * Q), true);
    var triggered = false;
    loop {
        let victim = target_next(&query); if (victim < 0) { break; }
        if (current(F_hp, u32(victim)) > 0 &&
            in_circle(cm(current(F_x, u32(victim)) - origin.x), cm(current(F_z, u32(victim)) - origin.y), cm(radius))) {
            triggered = true; break;
        }
    }
    if (!triggered) { return false; }
    let slot = ring_slot(id, definition); if (slot < 0) { return false; }
    initialize_shot(u32(slot), id, definition, origin);
    atomicStore(&extra[shot_at(u32(slot))], 2);
    atomicAdd(&extra[u32(defs[D_entityDamage]) + id / 4u], atomicLoad(&extra[body + E_hp]));
    return true;
}
@compute @workgroup_size(${workgroupSize})
fn shot_update(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let shot = index(id, groups); if (shot >= u32(defs[D_projectileCountMax])) { return; }
    let at = shot_at(shot);
    if (atomicLoad(&extra[at]) != 1 || atomicLoad(&extra[at + 1u]) < 0) { return; }
    let definition = shot_def(shot); let aux = shot_aux(shot);
    let begin = vec3<i32>(atomicLoad(&extra[at + 4u]),
        building_height(atomicLoad(&extra[at + 4u]),atomicLoad(&extra[at + 5u])) + atomicLoad(&extra[at + 6u]),
        atomicLoad(&extra[at + 5u]));
    let x = atomicLoad(&extra[at + 4u]) + atomicLoad(&extra[at + 7u]);
    let z = atomicLoad(&extra[at + 5u]) + atomicLoad(&extra[at + 8u]);
    atomicStore(&extra[at + 4u], x); atomicStore(&extra[at + 5u], z);
    if (defs[definition + J_motion] == 0 || defs[definition + J_motion] == 4) {
        atomicAdd(&extra[at + 6u],atomicLoad(&extra[at + 9u]));
    }
    if (defs[definition + J_motion] == 1) {
        atomicAdd(&extra[at + 6u], atomicLoad(&extra[at + 9u]));
        atomicAdd(&extra[at + 9u], -defs[definition + J_gravity] / 400);
    }
    let remaining = atomicLoad(&extra[at + 10u]) - 1; atomicStore(&extra[at + 10u], remaining);
    if (remaining <= 0) {
        if (defs[definition + J_motion] != 0) {
            atomicStore(&extra[at + 4u], atomicLoad(&extra[aux]));
            atomicStore(&extra[at + 5u], atomicLoad(&extra[aux + 1u]));
            atomicStore(&extra[at + 6u], 0);
        }
        atomicStore(&extra[at], 2);
    }
    if (defs[definition + J_motion] != 0 && defs[definition + J_motion] != 4) {
        let end_x = atomicLoad(&extra[at + 4u]); let end_z = atomicLoad(&extra[at + 5u]);
        let finish = vec3<i32>(end_x,building_height(end_x,end_z) + atomicLoad(&extra[at + 6u]),end_z);
        let delta = finish - begin; let wall = building_hit(begin,delta);
        if (wall <= Q) {
            let approach = max(0,wall - max(1,Q / max(1,max(abs(cm(delta.x)),max(abs(cm(delta.y)),abs(cm(delta.z)))))));
            let point = begin + vec3<i32>(mul_q(delta.x,approach),mul_q(delta.y,approach),mul_q(delta.z,approach));
            atomicStore(&extra[at + 4u],point.x); atomicStore(&extra[at + 5u],point.z);
            atomicStore(&extra[at + 6u],point.y - building_height(point.x,point.z));
            atomicStore(&extra[at],2);
        }
    }
}
@compute @workgroup_size(${workgroupSize})
fn shot_hit(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let shot = index(id, groups); if (shot >= u32(defs[D_projectileCountMax])) { return; }
    let at = shot_at(shot); let state = atomicLoad(&extra[at]); let definition = shot_def(shot);
    if ((state != 1 && state != 2) || defs[definition + J_motion] != 0 ||
        defs[definition + J_speed] == 0 || atomicLoad(&extra[at + 1u]) < 0) { return; }
    let finish = vec2<i32>(cm(atomicLoad(&extra[at + 4u])), cm(atomicLoad(&extra[at + 5u])));
    let start = vec2<i32>(cm(atomicLoad(&extra[at + 4u]) - atomicLoad(&extra[at + 7u])),
        cm(atomicLoad(&extra[at + 5u]) - atomicLoad(&extra[at + 8u])));
    let delta = finish - start; let squared = delta.x * delta.x + delta.y * delta.y;
    let end_q = vec2<i32>(atomicLoad(&extra[at + 4u]), atomicLoad(&extra[at + 5u]));
    let start_q = end_q - vec2<i32>(atomicLoad(&extra[at + 7u]), atomicLoad(&extra[at + 8u]));
    var query = target_query(min(start_q, end_q) - vec2<i32>(2 * Q), max(start_q, end_q) + vec2<i32>(2 * Q), true);
    let begin = vec3<i32>(start_q.x,building_height(start_q.x,start_q.y) +
        atomicLoad(&extra[at + 6u]) - atomicLoad(&extra[at + 9u]),start_q.y);
    let segment = vec3<i32>(end_q.x - start_q.x,
        building_height(end_q.x,end_q.y) - building_height(start_q.x,start_q.y) +
        atomicLoad(&extra[at + 9u]),end_q.y - start_q.y);
    let wall = building_hit(begin,segment);
    var first = wall; var selected = -1;
    loop {
        let victim = target_next(&query); if (victim < 0) { break; }
        if (current(F_hp, u32(victim)) <= 0) { continue; }
        let point = vec2<i32>(cm(current(F_x, u32(victim))), cm(current(F_z, u32(victim))));
        let relative = point - start; let dot = relative.x * delta.x + relative.y * delta.y;
        let projection = clamp(dot, 0, squared); var ratio = 0;
        if (squared > 0) { ratio = select(fraction_q(u32(projection), u32(squared)), Q, projection == squared); }
        let nearest = start + vec2<i32>(mul_q(delta.x, ratio), mul_q(delta.y, ratio));
        let radius = cm(defs[zombie_def(meta_variant(current(F_meta, u32(victim)))) + 2u]);
        let height = begin.y + mul_q(segment.y,ratio);
        let ground = building_height(current(F_x,u32(victim)),current(F_z,u32(victim)));
        if (height < ground || height > ground + defs[zombie_def(meta_variant(current(F_meta,u32(victim)))) + 3u]) { continue; }
        if (ratio >= wall || !in_circle(point.x - nearest.x, point.y - nearest.y, max(1, radius))) { continue; }
        if (ratio < first || (ratio == first && (selected < 0 || victim < selected))) { first = ratio; selected = victim; }
    }
    if (selected >= 0) {
        atomicStore(&extra[at], 2); atomicStore(&extra[at + 11u], selected);
        atomicStore(&extra[at + 4u], start_q.x + mul_q(end_q.x - start_q.x, first));
        atomicStore(&extra[at + 5u], start_q.y + mul_q(end_q.y - start_q.y, first));
    } else if (wall <= Q) {
        let approach = max(0,wall - max(1,Q / max(1,max(abs(delta.x),abs(delta.y)))));
        let point = begin + vec3<i32>(mul_q(segment.x,approach),mul_q(segment.y,approach),mul_q(segment.z,approach));
        atomicStore(&extra[at + 4u],point.x); atomicStore(&extra[at + 5u],point.z);
        atomicStore(&extra[at + 6u],point.y - building_height(point.x,point.z));
        atomicStore(&extra[at],2); atomicStore(&extra[at + 11u],-1);
    } else if (state == 2) { atomicStore(&extra[at], 0); }
}
var<private> splash_lane: u32;
var<private> splash_lanes: u32 = 1u;
fn splash_damage(shot: u32, definition: u32, base_damage: i32, slow: i32, impulse: bool) {
    let at = shot_at(shot); let origin = vec2<i32>(atomicLoad(&extra[at + 4u]), atomicLoad(&extra[at + 5u]));
    let radius = cm(defs[definition + J_radius]);
    let reach_q = select(defs[definition + J_radius],defs[definition + J_radius] * 3 / 2,impulse);
    let reach = cm(reach_q); let padding = reach_q + 2 * Q;
    let owner = atomicLoad(&extra[at + 1u]);
    var query = target_query(origin - vec2<i32>(padding), origin + vec2<i32>(padding), true);
    let columns = u32(query.high.x - query.low.x + 1);
    query.cell += vec2<i32>(i32(splash_lane % columns),i32(splash_lane / columns));
    query.step = i32(splash_lanes);
    loop {
        let victim = target_next(&query); if (victim < 0) { break; }
        if (current(F_hp,u32(victim)) <= 0) { continue; }
        let delta = vec2<i32>(cm(current(F_x, u32(victim)) - origin.x), cm(current(F_z, u32(victim)) - origin.y));
        if (!in_circle(delta.x, delta.y, reach)) { continue; }
        let source = vec3<i32>(origin.x,building_height(origin.x,origin.y) + atomicLoad(&extra[at + 6u]),origin.y);
        let zx = current(F_x,u32(victim)); let zz = current(F_z,u32(victim));
        let destination = vec3<i32>(zx,building_height(zx,zz) + Q,zz);
        if (building_hit(source,destination - source) <= Q) { continue; }
        let distance = i32(root(u32(delta.x * delta.x + delta.y * delta.y)));
        if (distance <= radius) {
            let factor = 100 - defs[definition + J_falloff] * distance / max(1, radius);
            damage_zombie(u32(victim), base_damage * factor / 100, owner);
            if (slow < 100) { atomicMin(&extra[u32(defs[D_gasSlow]) + u32(victim)], slow); }
        }
        if (impulse) {
            var normal = (delta * 256 / max(1,distance)) * 256;
            if (distance == 0) { normal = LUT[random(p(P_seed),u32(victim),p(P_tick),shot) & 255u] * 4; }
            let remaining = max(0,reach - distance);
            var weight = Q;
            if (remaining < reach) { weight = i32(fraction_q(u32(remaining),u32(max(1,reach)))); }
            let strength = mul_q(defs[D_explosionPush],weight);
            let push = u32(defs[D_explosionImpulse]) + u32(victim) * 2u;
            atomicAdd(&extra[push],mul_q(normal.x,strength) / 4);
            atomicAdd(&extra[push + 1u],mul_q(normal.y,strength) / 4);
        }
    }
}
fn gas_damage(shot: u32, definition: u32) {
    let scale = atomicLoad(&extra[shot_aux(shot) + 3u]);
    splash_damage(shot, definition, defs[definition + J_effectParams + 1u] * scale / 100,
        defs[definition + J_effectParams + 2u],false);
}
${effectsWGSL()}
fn detonate(shot: u32, state: i32, lane: u32) {
    let at = shot_at(shot); let definition = shot_def(shot); let aux = shot_aux(shot);
    if (state == 2) {
        if (lane == 0u && defs[definition + J_motion] != 3) {
            let flash = u32(defs[D_explosions]) + shot * ${RENDER_EXPLOSION_WORDS}u;
            atomicStore(&extra[flash],i32(p(P_tick)) + 1);
            for (var component = 0u; component < 3u; component++) {
                atomicStore(&extra[flash + component + 1u],atomicLoad(&extra[at + component + 4u]));
            }
            atomicStore(&extra[flash + 4u],defs[definition + J_radius]);
            atomicStore(&extra[flash + 5u],atomicLoad(&extra[at + 3u]));
        }
        let damage = defs[definition + J_damage] * atomicLoad(&extra[aux + 3u]) / 100;
        if (lane == 0u && defs[definition + J_motion] == 4) {
            let x = atomicLoad(&extra[at + 4u]); let z = atomicLoad(&extra[at + 5u]);
            damage_friendlies(vec3<i32>(x,building_height(x,z) + atomicLoad(&extra[at + 6u]),z),definition,damage);
        }
        if (defs[definition + J_radius] > 0) {
            splash_damage(shot,definition,damage,100,
                defs[definition + J_motion] < 2 || defs[definition + J_motion] == 4);
        }
        else if (lane == 0u) {
            let victim = atomicLoad(&extra[at + 11u]);
            if (victim >= 0) {
                if (defs[definition + J_execute] != 0) {
                    atomicAdd(&extra[p(P_damage) + u32(victim)],max(0,current(F_hp,u32(victim))));
                    atomicMin(&extra[p(P_credits) + u32(victim)],atomicLoad(&extra[at + 1u]));
                } else { damage_zombie(u32(victim), damage, atomicLoad(&extra[at + 1u])); }
            }
        }
        if (defs[definition + J_effect] == 0) {
            if (lane == 0u) { atomicStore(&extra[at], 0); } return;
        }
        if (lane == 0u) {
            atomicStore(&extra[at], 3); atomicStore(&extra[aux + 4u], defs[definition + J_effectParams]);
        }
    }
    projectile_effect(shot, definition);
    if (lane == 0u) {
        let remaining = atomicLoad(&extra[aux + 4u]) - 1; atomicStore(&extra[aux + 4u], remaining);
        if (remaining <= 0) { atomicStore(&extra[at], 0); }
    }
}
@compute @workgroup_size(${workgroupSize})
fn shot_detonate(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let shot = index(id,groups); if (shot >= u32(defs[D_projectileCountMax])) { return; }
    let at = shot_at(shot); let state = atomicLoad(&extra[at]);
    if ((state != 2 && state != 3) || atomicLoad(&extra[at + 1u]) < 0) { return; }
    let definition = shot_def(shot);
    if (defs[definition + J_radius] > 0 || defs[definition + J_effect] != 0) {
        let queued = atomicAdd(&scratch[p(P_splashQueue)],1u);
        atomicStore(&scratch[p(P_splashQueue) + 1u + queued],shot); return;
    }
    detonate(shot,state,0u);
}
var<workgroup> splash_shot: u32;
var<workgroup> splash_state: i32;
@compute @workgroup_size(${workgroupSize})
fn splash_scan(@builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) group: vec3<u32>) {
    if (lane == 0u) {
        splash_shot = 4294967295u; splash_state = 0;
        if (group.x < atomicLoad(&scratch[p(P_splashQueue)])) {
            splash_shot = atomicLoad(&scratch[p(P_splashQueue) + 1u + group.x]);
            splash_state = atomicLoad(&extra[shot_at(splash_shot)]);
        }
    }
    workgroupBarrier();
    let shot = workgroupUniformLoad(&splash_shot); let state = workgroupUniformLoad(&splash_state);
    if (shot == 4294967295u) { return; }
    splash_lane = lane; splash_lanes = ${workgroupSize}u;
    detonate(shot,state,lane);
}
@compute @workgroup_size(${workgroupSize})
fn gas_reset(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let i = index(id, groups); if (i < p(P_count)) { atomicStore(&extra[u32(defs[D_gasSlow]) + i], 100); }
}
@compute @workgroup_size(${workgroupSize})
fn beam_update(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let i = index(id, groups); if (i >= MAX_ENTITIES * 4u) { return; }
    let at = u32(defs[D_beams]) + i * 8u; let phase = atomicLoad(&extra[at]); if (phase == 0) { return; }
    if (!weapon_live(i)) { atomicStore(&extra[at], 0); return; }
    let definition = u32(atomicLoad(&extra[at + 6u]));
    let state = weapon_state(i); let victim = atomicLoad(&extra[state + 2u]);
    if ((victim >= 0 && !weapon_targetable(i,definition,victim)) ||
        (victim < 0 && (victim != -3 || atomicLoad(&extra[state + 3u]) == 0))) {
        atomicStore(&extra[at],0); return;
    }
    let aim = aim_point(i, definition) - mount_position(i);
    let angle = atomicLoad(&extra[state + 1u]);
    if (abs(turn_delta(angle, atan2_q(aim.y, aim.x))) > 32) {
        atomicStore(&extra[at], min(-1, phase)); return;
    }
    if (phase < 0) {
        atomicStore(&extra[at + 3u], 0);
        atomicStore(&extra[at], select(phase + 1, 1, phase == -1)); return;
    }
    let duration = max(1, defs[definition + W_fireParams + 1u]);
    let origin = mount_position(i); atomicStore(&extra[at + 1u], origin.x); atomicStore(&extra[at + 2u], origin.y);
    atomicStore(&extra[at + 4u], angle); atomicStore(&extra[at + 5u], angle);
    let maximum = defs[definition + W_maxRange];
    let source = vec3<i32>(origin.x,building_height(origin.x,origin.y) + Q * 6 / 5,origin.y);
    let segment = vec3<i32>(mul_q(cos_q(angle),maximum),0,mul_q(sin_q(angle),maximum));
    let wall = building_hit(source,segment); let range = mul_q(maximum,min(Q,wall));
    atomicStore(&extra[at + 3u],range);
    var query = target_query(origin - vec2<i32>(range + 2 * Q), origin + vec2<i32>(range + 2 * Q), true);
    let projectile = u32(defs[D_projectile]) + u32(defs[definition + W_projectile]) * ${PROJECTILE_STRIDE}u;
    loop {
        let victim = target_next(&query); if (victim < 0) { break; }
        let point = vec2<i32>(current(F_x, u32(victim)), current(F_z, u32(victim)));
        if (!weapon_range(i, definition, point)) { continue; }
        let delta = point - origin;
        let body_radius = cm(defs[zombie_def(meta_variant(current(F_meta, u32(victim)))) + 2u]);
        let radius = body_radius + cm(defs[projectile + J_radius]);
        let dx = cm(delta.x); let dz = cm(delta.y);
        let forward = mul_q(dx, cos_q(angle)) + mul_q(dz, sin_q(angle));
        let side = abs(mul_q(dz, cos_q(angle)) - mul_q(dx, sin_q(angle)));
        if (forward >= 0 && forward <= cm(range) && side <= radius &&
            building_hit(source,vec3<i32>(delta.x,0,delta.y)) > Q) {
            damage_zombie(u32(victim), defs[projectile + J_damage] * defs[definition + W_damageScale] / 100,
                atomicLoad(&extra[at + 7u]));
        }
    }
    if (phase >= duration) {
        atomicStore(&extra[at],0); atomicStore(&extra[state],defs[definition + W_fireParams + 3u]);
        if (atomicLoad(&extra[state + 3u]) == 1) {
            atomicStore(&extra[state + 3u],0); atomicStore(&extra[state + 2u],-1);
        }
    } else { atomicStore(&extra[at], phase + 1); }
}
`;
}
