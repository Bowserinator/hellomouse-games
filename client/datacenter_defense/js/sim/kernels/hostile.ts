import { RENDER_EXPLOSION_WORDS, SCRATCH } from '../layout.js';

export function hostileKernels(workgroupSize: number): string {
    return `
fn reserve_shot() -> i32 {
    let first = u32(defs[D_projectileCountMax]) - 2048u;
    for (var shot = first; shot < u32(defs[D_projectileCountMax]); shot++) {
        if (atomicLoad(&extra[shot_at(shot)]) == 0) { return i32(shot); }
    }
    return -1;
}
fn strike(def_id: i32, x: i32, z: i32, owner: u32, source: u32) {
    if (def_id < 0 || def_id >= defs[D_unitCount] || x < 0 || z < 0 ||
        x > i32(p(P_widthQ)) || z > i32(p(P_depthQ))) { return; }
    let def = u32(defs[D_unit]) + u32(def_id) * u32(defs[D_unitStride]);
    if (defs[def + U_kind] != 6) { return; }
    let offset = economy_offset(source);
    let unlimited = defs[D_unlimitedEconomy] != 0;
    if (!unlimited && (eco(offset + C_money) < defs[def + U_moneyCost] || eco(offset + C_power) < defs[def + U_powerCost])) {
        eco_set(offset + C_rejected,eco(offset + C_rejected) + 1); return;
    }
    let slot = reserve_shot(); if (slot < 0) { return; }
    if (!unlimited) {
        eco_set(offset + C_money,eco(offset + C_money) - defs[def + U_moneyCost]);
        eco_set(offset + C_power,eco(offset + C_power) - defs[def + U_powerCost]);
        eco_set(offset + C_moneyRate,eco(offset + C_moneyRate) + defs[def + U_moneyCost]);
        eco_set(offset + C_powerRate,eco(offset + C_powerRate) + defs[def + U_powerCost]);
    }
    let at = shot_at(u32(slot)); let aux = shot_aux(u32(slot));
    for (var word = 0u; word < 12u; word++) { atomicStore(&extra[at + word],0); }
    for (var word = 0u; word < 8u; word++) { atomicStore(&extra[aux + word],0); }
    atomicStore(&extra[at],2); atomicStore(&extra[at + 1u],i32(owner));
    atomicStore(&extra[at + 2u],-1); atomicStore(&extra[at + 3u],defs[def + U_projectile]);
    atomicStore(&extra[at + 4u],x); atomicStore(&extra[at + 5u],z);
    atomicStore(&extra[at + 11u],-1); atomicStore(&extra[aux + 3u],100);
    atomicStore(&extra[aux + 7u],i32(p(P_tick)) + 1);
    atomicStore(&extra[aux],x); atomicStore(&extra[aux + 1u],z);
    let projectile = shot_def(u32(slot));
    if (defs[projectile + J_motion] == 4) {
        let start_x = clamp(x + defs[projectile + J_startX],0,i32(p(P_widthQ)));
        let start_z = clamp(z + defs[projectile + J_startZ],0,i32(p(P_depthQ)));
        let ticks = max(1,defs[projectile + J_ttl]);
        atomicStore(&extra[at],1);
        atomicStore(&extra[at + 4u],start_x); atomicStore(&extra[at + 5u],start_z);
        atomicStore(&extra[at + 6u],defs[projectile + J_altitude]);
        atomicStore(&extra[at + 7u],(x - start_x) / ticks);
        atomicStore(&extra[at + 8u],(z - start_z) / ticks);
        atomicStore(&extra[at + 9u],-defs[projectile + J_altitude] / ticks);
        atomicStore(&extra[at + 10u],ticks);
    }
}
fn shot_ticks(origin: vec3<i32>, finish: vec3<i32>, projectile: u32) -> i32 {
    let delta = finish - origin; let centimetres = vec3<i32>(cm(delta.x),cm(delta.y),cm(delta.z));
    let length = i32(root(u32(centimetres.x * centimetres.x + centimetres.y * centimetres.y + centimetres.z * centimetres.z)));
    let step = max(1,cm(defs[projectile + J_speed]) / 20);
    return clamp((length + step - 1) / step,1,defs[projectile + J_ttl]);
}
fn entity_velocity(victim: u32) -> vec2<i32> {
    let at = entity(victim);
    let travel = atomicLoad(&extra[at + E_speed]) / 20;
    if (travel <= 0) { return vec2<i32>(0); }
    let angle = atomicLoad(&extra[at + E_facing]);
    let heading = vec2<i32>(cos_q(angle),sin_q(angle));
    let major = max(1,max(abs(heading.x),abs(heading.y)) / 256);
    let length = travel * 256 / major;
    return vec2<i32>(mul_q(heading.x,length),mul_q(heading.y,length));
}
fn lead_point(start: vec3<i32>, point: vec3<i32>, velocity: vec2<i32>, height: i32, projectile: u32) -> vec3<i32> {
    var predicted = point; var ticks = shot_ticks(start,point,projectile);
    for (var iteration = 0u; iteration < 4u; iteration++) {
        let x = clamp(point.x + velocity.x * ticks,0,i32(p(P_widthQ)));
        let z = clamp(point.z + velocity.y * ticks,0,i32(p(P_depthQ)));
        predicted = vec3<i32>(x,building_height(x,z) + height,z);
        let revised = shot_ticks(start,predicted,projectile);
        if (revised == ticks) { break; }
        ticks = revised;
    }
    return predicted;
}
fn detonate_bomber(emitter: u32, projectile_id: i32) {
    let slot = reserve_shot(); if (slot < 0) { return; }
    let at = shot_at(u32(slot)); let aux = shot_aux(u32(slot));
    for (var word = 0u; word < 12u; word++) { atomicStore(&extra[at + word],0); }
    for (var word = 0u; word < 8u; word++) { atomicStore(&extra[aux + word],0); }
    let x = current(F_x,emitter); let z = current(F_z,emitter);
    atomicStore(&extra[at],1); atomicStore(&extra[at + 1u],-1); atomicStore(&extra[at + 2u],-2);
    atomicStore(&extra[at + 3u],projectile_id); atomicStore(&extra[at + 4u],x);
    atomicStore(&extra[at + 5u],z); atomicStore(&extra[at + 6u],Q / 2);
    atomicStore(&extra[at + 10u],1); atomicStore(&extra[at + 11u],-1);
    atomicStore(&extra[aux],x); atomicStore(&extra[aux + 1u],z);
    atomicStore(&extra[aux + 3u],scaled_zombie_stat(emitter,defs[shot_def(u32(slot)) + J_damage],WAVE_DAMAGE));
    atomicMax(&scratch[${SCRATCH.hostileEnd}],u32(slot) + 1u - (u32(defs[D_projectileCountMax]) - 2048u));
}
fn bomber_friendly_fire(end: vec3<i32>, definition: u32, radius: i32, damage: i32) {
    let padding = defs[definition + J_radius] + 2 * Q;
    var query = target_query(vec2<i32>(end.x - padding,end.z - padding),
        vec2<i32>(end.x + padding,end.z + padding),true);
    loop {
        let victim = target_next(&query); if (victim < 0) { break; }
        if (current(F_hp,u32(victim)) <= 0) { continue; }
        let zx = current(F_x,u32(victim)); let zz = current(F_z,u32(victim));
        let delta = vec2<i32>(cm(zx - end.x),cm(zz - end.z));
        if (!in_circle(delta.x,delta.y,radius)) { continue; }
        let distance = i32(root(u32(delta.x * delta.x + delta.y * delta.y)));
        if (distance > radius || building_hit(end,vec3<i32>(zx,building_height(zx,zz) + Q,zz) - end) <= Q) { continue; }
        let factor = 100 - defs[definition + J_falloff] * distance / max(1,radius);
        damage_zombie(u32(victim),damage * factor / 100,2147483647);
    }
}
fn ranged_think(id: u32, definition: u32) {
    let position = vec3<i32>(current(F_x,id),building_height(current(F_x,id),current(F_z,id)) + Q,current(F_z,id));
    let range = cm(defs[definition + 6u]); var best = range * range + 1; var selected = -1;
    let focused = objective_focused(position.x,position.z);
    let cooldown = meta_cooldown(current(F_meta,id));
    let goal = vec3<i32>(i32(p(P_objectiveX)),building_height(i32(p(P_objectiveX)),i32(p(P_objectiveZ))) + Q,
        i32(p(P_objectiveZ)));
    let delta_to_goal = vec2<i32>(cm(goal.x) - cm(position.x),cm(goal.z) - cm(position.z));
    let objective_in_range = in_circle(delta_to_goal.x,delta_to_goal.y,range) &&
        building_hit(position,goal - position) > Q;
    set_target(id,0); put(F_tgt,id,-1); set_state(id,1);
    if (focused && objective_in_range) {
        set_target(id,1); set_state(id,2);
        if (cooldown == 0) { attack(id,definition); }
        return;
    }
    if (focused && cooldown != 0) { return; }
    for (var other = 0u; other < min(MAX_ENTITIES,u32(atomicLoad(&extra[2]))); other++) {
        let at = entity(other); let def = entity_def(other);
        if (atomicLoad(&extra[at + E_state]) == 0 || (defs[def + U_kind] == 5 && is_active(other) &&
            i32(p(P_tick)) >= atomicLoad(&extra[at + E_timer]))) { continue; }
        let x = atomicLoad(&extra[at + E_x]); let z = atomicLoad(&extra[at + E_z]);
        let point = vec3<i32>(x,building_height(x,z) + defs[def + U_flightHeight] + Q,z);
        let delta = vec3<i32>(cm(point.x - position.x),cm(point.y - position.y),cm(point.z - position.z));
        if (max(abs(delta.x),max(abs(delta.y),abs(delta.z))) > range) { continue; }
        let squared = delta.x * delta.x + delta.y * delta.y + delta.z * delta.z;
        if (squared >= best || building_hit(position,point - position) <= Q) { continue; }
        selected = i32(other); best = squared;
    }
    if (selected >= 0) {
        set_target(id,2); put(F_tgt,id,selected);
        if (!focused) { set_state(id,2); }
    } else if (objective_in_range) { set_target(id,1); set_state(id,2); }
    if (meta_target(current(F_meta,id)) != 0 && cooldown == 0) { attack(id,definition); }
}
@compute @workgroup_size(1)
fn hostile_emit() {
    for (var i = 0u; i < u32(atomicLoad(&extra[p(P_compactCount)])); i++) {
        let record = p(P_compact) + i * 5u;
        let emission = atomicLoad(&extra[record + 1u]);
        if (emission == 3) { detonate_bomber(u32(atomicLoad(&extra[record])),atomicLoad(&extra[record + 4u])); continue; }
        if (emission != 2) { continue; }
        let emitter = u32(atomicLoad(&extra[record]));
        let victim = atomicLoad(&extra[record + 2u]); let tag = u32(atomicLoad(&extra[record + 3u]));
        var point = vec3<i32>(i32(p(P_objectiveX)),building_height(i32(p(P_objectiveX)),i32(p(P_objectiveZ))) + Q,
            i32(p(P_objectiveZ)));
        var velocity = vec2<i32>(0); var height = 0;
        if ((tag & 3u) == 2u) {
            if (victim < 0 || victim >= i32(MAX_ENTITIES)) { continue; }
            let at = entity(u32(victim));
            if (atomicLoad(&extra[at + E_state]) == 0 ||
                (u32(atomicLoad(&extra[at + E_flags])) >> 8u) != (tag >> 2u)) { continue; }
            point.x = atomicLoad(&extra[at + E_x]); point.z = atomicLoad(&extra[at + E_z]);
            height = defs[entity_def(u32(victim)) + U_flightHeight] + Q;
            point.y = building_height(point.x,point.z) + height;
            velocity = entity_velocity(u32(victim));
        } else if ((tag & 3u) != 1u) { continue; }
        let start = vec3<i32>(current(F_x,emitter),building_height(current(F_x,emitter),current(F_z,emitter)) + Q,
            current(F_z,emitter));
        if (building_hit(start,point - start) <= Q) { continue; }
        let projectile_id = atomicLoad(&extra[record + 4u]);
        let projectile = u32(defs[D_projectile]) + u32(projectile_id) * u32(defs[D_projectileStride]);
        if (any(velocity != vec2<i32>(0))) {
            let led = lead_point(start,point,velocity,height,projectile);
            if (building_hit(start,led - start) > Q) { point = led; }
        }
        let slot = reserve_shot(); if (slot < 0) { continue; }
        let at = shot_at(u32(slot)); let aux = shot_aux(u32(slot));
        for (var word = 0u; word < 12u; word++) { atomicStore(&extra[at + word],0); }
        for (var word = 0u; word < 8u; word++) { atomicStore(&extra[aux + word],0); }
        let delta = point - start; let ticks = shot_ticks(start,point,projectile);
        atomicStore(&extra[at],1); atomicStore(&extra[at + 1u],-1); atomicStore(&extra[at + 2u],-1);
        atomicStore(&extra[at + 3u],projectile_id); atomicStore(&extra[at + 4u],start.x);
        atomicStore(&extra[at + 5u],start.z); atomicStore(&extra[at + 6u],Q);
        atomicStore(&extra[at + 7u],delta.x / ticks); atomicStore(&extra[at + 8u],delta.z / ticks);
        atomicStore(&extra[at + 9u],delta.y / ticks); atomicStore(&extra[at + 10u],ticks);
        atomicStore(&extra[at + 11u],victim); atomicStore(&extra[aux],point.x);
        atomicStore(&extra[aux + 1u],point.z);
        atomicStore(&extra[aux + 3u],scaled_zombie_stat(emitter,defs[projectile + J_damage],WAVE_DAMAGE));
        atomicMax(&scratch[${SCRATCH.hostileEnd}],u32(slot) + 1u - (u32(defs[D_projectileCountMax]) - 2048u));
    }
}
@compute @workgroup_size(${workgroupSize})
fn hostile_update(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let shot = u32(defs[D_projectileCountMax]) - 2048u + index(id,groups);
    if (shot >= u32(defs[D_projectileCountMax])) { return; }
    let at = shot_at(shot); if (atomicLoad(&extra[at]) != 1 || atomicLoad(&extra[at + 1u]) >= 0) { return; }
    let x = atomicLoad(&extra[at + 4u]); let z = atomicLoad(&extra[at + 5u]);
    let start = vec3<i32>(x,building_height(x,z) + atomicLoad(&extra[at + 6u]),z);
    let delta = vec3<i32>(atomicLoad(&extra[at + 7u]),atomicLoad(&extra[at + 9u]),atomicLoad(&extra[at + 8u]));
    let wall = building_hit(start,delta); var fraction = wall; var hit = fraction <= Q;
    let squared = max(1,cm(delta.x) * cm(delta.x) + cm(delta.y) * cm(delta.y) + cm(delta.z) * cm(delta.z));
    for (var other = 0u; other < min(MAX_ENTITIES,u32(atomicLoad(&extra[2]))); other++) {
        let body = entity(other); if (atomicLoad(&extra[body + E_state]) == 0) { continue; }
        let def = entity_def(other); let centre_x = atomicLoad(&extra[body + E_x]); let centre_z = atomicLoad(&extra[body + E_z]);
        let centre = vec3<i32>(centre_x,building_height(centre_x,centre_z) + defs[def + U_flightHeight] + Q,centre_z);
        let relative = centre - start;
        let dot = cm(relative.x) * cm(delta.x) + cm(relative.y) * cm(delta.y) + cm(relative.z) * cm(delta.z);
        let projection = clamp(dot,0,squared);
        let ratio = select(fraction_q(u32(projection),u32(squared)),Q,projection == squared);
        let nearest = start + vec3<i32>(mul_q(delta.x,ratio),mul_q(delta.y,ratio),mul_q(delta.z,ratio));
        if (ratio >= fraction || abs(nearest.y - centre.y) > Q ||
            any(abs(nearest.xz - centre.xz) > unit_size(other) / 2)) { continue; }
        fraction = ratio; hit = true;
    }
    let remaining = atomicLoad(&extra[at + 10u]) - 1;
    if (remaining <= 0) { hit = true; }
    var ratio = min(Q,fraction);
    if (wall <= Q && fraction == wall) {
        ratio = max(0,ratio - max(1,Q / max(1,max(abs(cm(delta.x)),max(abs(cm(delta.y)),abs(cm(delta.z)))))));
    }
    let end = start + vec3<i32>(mul_q(delta.x,ratio),mul_q(delta.y,ratio),mul_q(delta.z,ratio));
    atomicStore(&extra[at + 4u],end.x); atomicStore(&extra[at + 5u],end.z);
    atomicStore(&extra[at + 6u],end.y - building_height(end.x,end.z)); atomicStore(&extra[at + 10u],remaining);
    if (!hit) { return; }
    let definition = shot_def(shot); let radius = max(1,cm(defs[definition + J_radius]));
    let flash = u32(defs[D_explosions]) + shot * ${RENDER_EXPLOSION_WORDS}u;
    atomicStore(&extra[flash],i32(p(P_tick)) + 1); atomicStore(&extra[flash + 1u],end.x);
    atomicStore(&extra[flash + 2u],end.z); atomicStore(&extra[flash + 3u],atomicLoad(&extra[at + 6u]));
    atomicStore(&extra[flash + 4u],defs[definition + J_radius]);
    atomicStore(&extra[flash + 5u],atomicLoad(&extra[at + 3u]));
    let damage = atomicLoad(&extra[shot_aux(shot) + 3u]);
    if (damage > 0) {
        damage_friendlies(end,definition,damage);
        if (atomicLoad(&extra[at + 2u]) == -2) { bomber_friendly_fire(end,definition,radius,damage); }
    }
    atomicStore(&extra[at],0);
}
fn damage_friendlies(end: vec3<i32>, definition: u32, damage: i32) {
    let radius = max(1,cm(defs[definition + J_radius]));
    for (var other = 0u; other < min(MAX_ENTITIES,u32(atomicLoad(&extra[2]))); other++) {
        let body = entity(other); if (atomicLoad(&extra[body + E_state]) == 0) { continue; }
        let def = entity_def(other); let px = atomicLoad(&extra[body + E_x]); let pz = atomicLoad(&extra[body + E_z]);
        let centre = vec3<i32>(px,building_height(px,pz) + defs[def + U_flightHeight] + Q,pz);
        let d = vec3<i32>(cm(centre.x - end.x),cm(centre.y - end.y),cm(centre.z - end.z));
        if (max(abs(d.x),max(abs(d.y),abs(d.z))) > radius) { continue; }
        let distance = i32(root(u32(d.x * d.x + d.y * d.y + d.z * d.z)));
        if (distance > radius || building_hit(end,centre - end) <= Q) { continue; }
        atomicAdd(&extra[u32(defs[D_entityDamage]) + other],
            max(1,damage * (radius - distance) / radius));
    }
    if (in_circle(cm(end.x) - cm(i32(p(P_objectiveX))),cm(end.z) - cm(i32(p(P_objectiveZ))),radius) &&
        abs(cm(end.y - building_height(end.x,end.z))) <= radius) {
        let goal = vec3<i32>(i32(p(P_objectiveX)),
            building_height(i32(p(P_objectiveX)),i32(p(P_objectiveZ))) + Q,i32(p(P_objectiveZ)));
        if (building_hit(end,goal - end) > Q) { atomicAdd(&scratch[2],u32(damage)); }
    }
}
`;
}
