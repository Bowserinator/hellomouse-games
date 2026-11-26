import { CRANE_T2, CRANE_T3 } from '../content/index.js';
import { BALANCE } from '../balance.js';
import { TICK_HZ } from '../fixed.js';
import { LOBBY_LIMIT } from '../../shared/protocol.js';
import { ECONOMY, PLAYER_ECONOMY_WORDS, playerEconomyOffset } from '../layout.js';

export const ECONOMY_WGSL = `
${Object.entries(ECONOMY).map(([name, value]) => `const C_${name}: u32 = ${value}u;`).join('\n')}
fn eco(key: u32) -> i32 { return atomicLoad(&extra[u32(defs[D_economy]) + key]); }
fn eco_set(key: u32, value: i32) { atomicStore(&extra[u32(defs[D_economy]) + key],value); }
fn economy_offset(slot: u32) -> u32 {
    if (slot == 0u) { return 0u; }
    return ${playerEconomyOffset(1)}u + (slot - 1u) * ${PLAYER_ECONOMY_WORDS}u;
}
fn player_has_economy(slot: u32) -> bool {
    return (u32(eco(C_players)) & (1u << slot)) != 0u;
}
fn pay_energy(id: u32, cost: i32) -> bool {
    if (cost == 0 || defs[D_unlimitedEconomy] != 0) { return true; }
    let offset = economy_offset(entity_source(id));
    let balance = eco(offset + C_power);
    if (balance < cost) { return false; }
    eco_set(offset + C_power,balance - cost);
    eco_set(offset + C_powerRate,eco(offset + C_powerRate) + cost);
    return true;
}
fn wide(a: u32, b: u32) -> vec2<u32> {
    let low = (a & 65535u) * (b & 65535u);
    let middle = (a >> 16u) * (b & 65535u) + (low >> 16u);
    let upper = (middle & 65535u) + (a & 65535u) * (b >> 16u);
    return vec2<u32>((upper << 16u) | (low & 65535u),
        (a >> 16u) * (b >> 16u) + (middle >> 16u) + (upper >> 16u));
}
fn wide_add(sum: vec2<u32>, value: u32) -> vec2<u32> {
    let low = sum.x + value;
    return vec2<u32>(low,sum.y + select(0u,1u,low < sum.x));
}
fn fraction_greater(a: u32, b: u32, c: u32, d: u32) -> bool {
    let left = wide(a,d); let right = wide(c,b);
    return left.y > right.y || (left.y == right.y && left.x > right.x);
}
fn ratio_parts(a: u32, b: u32, divisor: u32) -> vec2<u32> {
    var quotient = 0u; var remainder = 0u;
    for (var bit = 32u; bit > 0u; bit--) {
        let value = remainder * 2u + select(0u,a,((b >> (bit - 1u)) & 1u) != 0u);
        quotient = quotient * 2u + value / divisor; remainder = value % divisor;
    }
    return vec2<u32>(quotient,remainder);
}
fn ratio(a: u32, b: u32, divisor: u32) -> u32 { return ratio_parts(a,b,max(1u,divisor)).x; }
fn cumulative(cost: i32, progress: i32, total: i32) -> i32 {
    let parts = ratio_parts(u32(cost),u32(progress),u32(total));
    return i32(parts.x + select(0u,1u,parts.y != 0u));
}
fn shortage(funds: u32, demand: vec2<u32>) -> u32 {
    if (demand.y == 0u && demand.x <= funds) { return 65536u; }
    var need = demand; var available = funds;
    while (need.y != 0u || need.x > 32767u) {
        let odd = need.x & 1u;
        need = vec2<u32>((need.x >> 1u) | (need.y << 31u),need.y >> 1u);
        need = wide_add(need,odd); available >>= 1u;
    }
    return min(65536u,available * 65536u / max(1u,need.x));
}
fn storage_on_edge(cell: vec2<i32>, centre: vec2<i32>, size: vec2<i32>, axis: u32, storage_key: u32, owner: u32) -> i32 {
    if (any(cell < vec2<i32>(0)) || cell.x >= i32(p(P_columns)) || cell.y >= i32(p(P_rows))) { return 0; }
    let found = occupancy(u32(cell.y) * p(P_columns) + u32(cell.x));
    if (found < 0 || !is_active(u32(found)) || entity_source(u32(found)) != owner) { return 0; }
    let id = u32(found); let other_size = unit_size(id);
    let at = entity(id);
    let other = vec2<i32>(atomicLoad(&extra[at + E_x]),atomicLoad(&extra[at + E_z]));
    let across = 1u - axis;
    return i32(defs[entity_def(id) + storage_key] > 0 && other[across] == centre[across] &&
        other_size[across] == size[across] && abs(other[axis] - centre[axis]) == (size[axis] + other_size[axis]) / 2);
}
fn adjacent_storage(id: u32, storage_key: u32) -> i32 {
    let at = entity(id); let size = unit_size(id);
    let centre = vec2<i32>(atomicLoad(&extra[at + E_x]),atomicLoad(&extra[at + E_z]));
    let first = (centre - size / 2) / Q; let end = (centre + size / 2) / Q;
    let owner = entity_source(id);
    return storage_on_edge(vec2<i32>(first.x - 1,first.y),centre,size,0u,storage_key,owner) +
        storage_on_edge(vec2<i32>(end.x,first.y),centre,size,0u,storage_key,owner) +
        storage_on_edge(vec2<i32>(first.x,first.y - 1),centre,size,1u,storage_key,owner) +
        storage_on_edge(vec2<i32>(first.x,end.y),centre,size,1u,storage_key,owner);
}
fn economy_caps(owner: u32) -> vec2<i32> {
    let offset = economy_offset(owner);
    let players = u32(eco(C_players));
    let count = max(1u,countOneBits(players));
    let rank = countOneBits(players & ((1u << owner) - 1u));
    let lane = (rank + p(P_tick)) % count;
    let alive = atomicLoad(&extra[0]) > 0;
    let starter_share = select(0,eco(offset + C_starterShare),alive);
    var money_cap = ${BALANCE.objective.moneyStorage} * starter_share;
    var power_cap = ${BALANCE.objective.powerStorage} * starter_share;
    let shared_income = vec2<u32>(${BALANCE.objective.money * 40}u,${BALANCE.objective.power * 40}u);
    let share = shared_income / count + select(vec2<u32>(0u),vec2<u32>(1u),vec2<u32>(lane) < shared_income % count);
    var income = select(vec2<i32>(0),vec2<i32>(share),alive);
    for (var id = 0u; id < min(MAX_ENTITIES,u32(atomicLoad(&extra[2]))); id++) {
        if (!is_active(id) || entity_source(id) != owner) { continue; }
        let def = entity_def(id);
        money_cap += defs[def + U_moneyStorage]; power_cap += defs[def + U_powerStorage];
        let money = defs[def + U_moneyIncome]; let power = defs[def + U_powerIncome];
        if (money > 0) { income.x += money * (8 + adjacent_storage(id,U_moneyStorage)); }
        if (power > 0) { income.y += power * (8 + adjacent_storage(id,U_powerStorage)); }
    }
    eco_set(offset + C_moneyCap,money_cap); eco_set(offset + C_powerCap,power_cap);
    eco_set(offset + C_money,min(eco(offset + C_money),money_cap));
    eco_set(offset + C_power,min(eco(offset + C_power),power_cap));
    eco_set(offset + C_moneyIncome,income.x * 5 / 2); eco_set(offset + C_powerIncome,income.y * 5 / 2);
    return income;
}
fn change_storage(owner: u32, def: u32, direction: i32) {
    let offset = economy_offset(owner);
    let capacity = vec2<i32>(eco(offset + C_moneyCap),eco(offset + C_powerCap)) +
        direction * vec2<i32>(defs[def + U_moneyStorage],defs[def + U_powerStorage]);
    eco_set(offset + C_moneyCap,capacity.x); eco_set(offset + C_powerCap,capacity.y);
    if (direction < 0) {
        eco_set(offset + C_money,min(eco(offset + C_money),capacity.x));
        eco_set(offset + C_power,min(eco(offset + C_power),capacity.y));
    }
}
fn deposit(owner: u32, key: u32, cap: u32, amount: i32) -> i32 {
    let offset = economy_offset(owner);
    let added = min(amount,eco(offset + cap) - eco(offset + key));
    eco_set(offset + key,eco(offset + key) + added);
    return amount - added;
}
fn share_overflow(owner: u32, key: u32, cap: u32, cursor_key: u32, amount: i32) {
    var left = amount;
    while (left > 0) {
        var room = 0;
        for (var slot = 0u; slot < ${LOBBY_LIMIT}u; slot++) {
            let offset = economy_offset(slot);
            if (slot != owner && player_has_economy(slot) && eco(offset + key) < eco(offset + cap)) { room++; }
        }
        if (room == 0) { return; }
        let share = left / room;
        let cursor = u32(eco(cursor_key));
        for (var i = 0u; i < ${LOBBY_LIMIT}u; i++) {
            let slot = (cursor + i) % ${LOBBY_LIMIT}u;
            if (slot == owner || !player_has_economy(slot)) { continue; }
            let offer = select(min(left,1),share,share > 0);
            let granted = offer - deposit(slot,key,cap,offer);
            left -= granted;
            if (share == 0 && granted > 0) { eco_set(cursor_key,i32((slot + 1u) % ${LOBBY_LIMIT}u)); }
        }
    }
}
fn crane_upgrading(id: u32) -> bool {
    return atomicLoad(&extra[entity(id) + E_upgradeTarget]) > defs[entity_def(id) + U_tier];
}
fn crane_upgrade_def(id: u32) -> i32 {
    return select(${CRANE_T3},${CRANE_T2},defs[entity_def(id) + U_tier] == 1);
}
fn crane_upgrade_box(id: u32, def: u32) -> vec4<i32> {
    let at = entity(id);
    let point = vec2<i32>(atomicLoad(&extra[at + E_x]),atomicLoad(&extra[at + E_z]));
    let origin = unit_bounds(id,point).xy * Q;
    return placement_box(def,origin.x,origin.y,0);
}
fn builder_reaches_point(builder: i32, centre: vec2<i32>, required: i32) -> bool {
    let id = u32(builder); if (!is_active(id)) { return false; }
    let def = entity_def(id); if (defs[def + U_buildPower] <= 0) { return false; }
    let at = entity(id);
    let origin = vec2<i32>(atomicLoad(&extra[at + E_x]),atomicLoad(&extra[at + E_z])) / Q;
    let delta = centre / Q - origin;
    return defs[def + U_tier] >= required && in_circle(delta.x,delta.y,defs[def + U_buildRadius]);
}
fn entity_source(id: u32) -> u32 { return u32(atomicLoad(&extra[entity(id) + E_rotation])) >> 2u; }
fn builder_reaches(builder: i32, victim: u32, manual: bool) -> bool {
    if (!is_live(victim) || builder == i32(victim)) { return false; }
    let at = entity(victim); let def = entity_def(victim);
    let building = atomicLoad(&extra[at + E_state]) == 2;
    let upgrading = crane_upgrading(victim);
    if (entity_source(u32(builder)) != entity_source(victim) && !(manual && (building || upgrading))) { return false; }
    if (!building && !upgrading && atomicLoad(&extra[at + E_hp]) >= defs[def + U_hp]) { return false; }
    let centre = vec2<i32>(atomicLoad(&extra[at + E_x]),atomicLoad(&extra[at + E_z]));
    return builder_reaches_point(builder,centre,select(0,defs[def + U_tier],building));
}
fn next_ghost(builder: i32, owner: u32) -> i32 {
    var index = 0u;
    while (index < ghost_count()) {
        let at = ghost_at(index);
        if (u32(atomicLoad(&extra[at + 5u])) != owner) { index++; continue; }
        let def = placement_def(atomicLoad(&extra[at])); let box = ghost_box(at);
        if (builder_reaches_point(builder,(box.xy + box.zw) * Q / 2,defs[def + U_tier])) {
            let spawned = spawn_ghost(index,def,box);
            if (spawned >= 0) { return spawned; }
            if (spawned == -2) { break; }
        }
        index++;
    }
    return -1;
}
fn set_build_task(builder: i32, victim: i32, manual: bool) {
    if (victim < 0 || victim >= i32(MAX_ENTITIES) || !builder_reaches(builder,u32(victim),manual)) { return; }
    let generation = atomicLoad(&extra[entity(u32(victim)) + E_flags]) >> 8;
    let at = entity(u32(builder)); atomicStore(&extra[at + E_buildTask],victim);
    atomicStore(&extra[at + E_taskGeneration],generation);
    atomicStore(&extra[at + E_explicitTask],i32(manual));
    if (manual && atomicLoad(&extra[at + E_skippedTask]) == victim + 1) {
        atomicStore(&extra[at + E_skippedTask],0);
    }
}
fn collect_builder(builder: i32) {
    let id = u32(builder); if (!is_active(id)) { return; }
    let power = defs[entity_def(id) + U_buildPower]; if (power == 0) { return; }
    let at = entity(id); let owner = entity_source(id);
    if (crane_upgrading(id)) {
        atomicStore(&extra[at + E_buildTask],-1);
        atomicStore(&extra[at + E_explicitTask],0);
        if ((atomicLoad(&extra[at + E_flags]) & 1) == 0) { atomicAdd(&extra[at + E_assist],power * 256); }
        return;
    }
    var task = atomicLoad(&extra[at + E_buildTask]);
    let generation = atomicLoad(&extra[at + E_taskGeneration]);
    var manual = atomicLoad(&extra[at + E_explicitTask]) != 0;
    let held = (atomicLoad(&extra[at + E_flags]) & 1) != 0;
    if (task >= 0 && (!builder_reaches(builder,u32(task),manual) ||
        (atomicLoad(&extra[entity(u32(task)) + E_flags]) >> 8) != generation ||
        (!manual && atomicLoad(&extra[entity(u32(task)) + E_state]) != 2 && !crane_upgrading(u32(task))))) {
        task = -1; manual = false;
    }
    if (!manual && (p(P_tick) % 10u == 0u || task == -1)) {
        var build = -1;
        var upgrade = -1;
        if (!held) { for (var other = 0u; other < min(MAX_ENTITIES,u32(atomicLoad(&extra[2]))); other++) {
            if (!builder_reaches(builder,other,false) || (atomicLoad(&extra[at + E_skippedTask]) == i32(other) + 1 &&
                atomicLoad(&extra[at + E_skippedGeneration]) == (atomicLoad(&extra[entity(other) + E_flags]) >> 8))) {
                continue;
            }
            if (atomicLoad(&extra[entity(other) + E_state]) != 2) {
                if (upgrade < 0 && crane_upgrading(other)) { upgrade = i32(other); }
                continue;
            }
            let previous = build;
            if (previous < 0 || fraction_greater(u32(atomicLoad(&extra[entity(other) + E_progress])),
                u32(defs[entity_def(other) + U_buildTicks]) * 256u,
                u32(atomicLoad(&extra[entity(u32(previous)) + E_progress])),
                u32(defs[entity_def(u32(previous)) + U_buildTicks]) * 256u)) { build = i32(other); }
        } }
        task = build;
        if (task < 0 && !held) { task = next_ghost(builder,owner); }
        if (task < 0) { task = upgrade; }
    }
    atomicStore(&extra[at + E_buildTask],task);
    atomicStore(&extra[at + E_explicitTask],i32(manual));
    if (task >= 0 && (!held || manual)) {
        set_build_task(builder,task,manual);
        atomicAdd(&extra[entity(u32(task)) + E_assist],power * 256);
    } else if (task < 0 && !held) {
        let queued = atomicLoad(&extra[at + E_queuedUpgrade]);
        if (queued > defs[entity_def(id) + U_tier]) {
            let def = placement_def(crane_upgrade_def(id));
            if (placement_clear(def,crane_upgrade_box(id,def),builder,false)) {
                atomicStore(&extra[at + E_upgradeTarget],queued);
                atomicStore(&extra[at + E_queuedUpgrade],0);
                atomicAdd(&extra[at + E_assist],power * 256);
            }
        }
    }
}
fn build_spec(def: u32) -> vec3<i32> {
    return vec3<i32>(defs[def + U_moneyCost],defs[def + U_powerCost],defs[def + U_buildTicks] * 256);
}
fn build_cost(build: vec3<i32>, progress: i32, gain: i32) -> vec2<i32> {
    return vec2<i32>(cumulative(build.x,progress + gain,build.z) - cumulative(build.x,progress,build.z),
        cumulative(build.y,progress + gain,build.z) - cumulative(build.y,progress,build.z));
}
@compute @workgroup_size(1)
fn economy_tick() {
    var overflow: array<vec2<i32>,${LOBBY_LIMIT}>;
    for (var slot = 0u; slot < ${LOBBY_LIMIT}u; slot++) {
        if (!player_has_economy(slot)) { continue; }
        let offset = economy_offset(slot);
        let income = economy_caps(slot) + vec2<i32>(eco(offset + C_moneyCarry),eco(offset + C_powerCarry));
        eco_set(offset + C_moneyCarry,income.x % 8); eco_set(offset + C_powerCarry,income.y % 8);
        let sample = p(P_tick) % 20u;
        eco_set(offset + C_moneyHistory + sample,income.x / 8);
        eco_set(offset + C_powerHistory + sample,income.y / 8);
        overflow[slot] = vec2<i32>(deposit(slot,C_money,C_moneyCap,income.x / 8),
            deposit(slot,C_power,C_powerCap,income.y / 8));
    }
    for (var slot = 0u; slot < ${LOBBY_LIMIT}u; slot++) {
        share_overflow(slot,C_money,C_moneyCap,C_moneyCursor,overflow[slot].x);
        share_overflow(slot,C_power,C_powerCap,C_powerCursor,overflow[slot].y);
    }
}
@compute @workgroup_size(1)
fn collect_construction() {
    let previous_count = min(MAX_ENTITIES,u32(atomicLoad(&extra[2])));
    for (var id = 0u; id < previous_count; id++) {
        atomicStore(&extra[entity(id) + E_assist],0);
        atomicStore(&extra[entity(id) + E_upgradeGain],0);
    }
    for (var id = 0u; id < previous_count; id++) { collect_builder(i32(id)); }
}
@compute @workgroup_size(1)
fn spend_construction() {
    let count = min(MAX_ENTITIES,u32(atomicLoad(&extra[2])));
    for (var slot = 0u; slot < ${LOBBY_LIMIT}u; slot++) {
        if (player_has_economy(slot)) { spend_economy(slot,count); }
    }
    for (var slot = 0u; slot < ${LOBBY_LIMIT}u; slot++) {
        if (player_has_economy(slot)) { economy_caps(slot); }
    }
}
fn spend_economy(slot: u32, count: u32) {
    let offset = economy_offset(slot);
    var money_demand = vec2<u32>(0u); var power_demand = vec2<u32>(0u);
    for (var id = 0u; id < count; id++) {
        if (entity_source(id) != slot) { continue; }
        let at = entity(id); let request = u32(defs[D_construction]) + id * 4u;
        atomicStore(&extra[request],0);
        let assist = atomicLoad(&extra[at + E_assist]);
        if (assist == 0) { continue; }
        let crane = crane_upgrading(id);
        var def = entity_def(id);
        if (crane) {
            def = placement_def(crane_upgrade_def(id));
            if ((atomicLoad(&extra[at + E_flags]) & 1) != 0 ||
                !placement_clear(def,crane_upgrade_box(id,def),i32(id),false)) { continue; }
        }
        let build = build_spec(def); let total = build.z;
        var progress = atomicLoad(&extra[at + select(E_progress,E_upgradeProgress,crane)]); var limit = total;
        let repairing = !crane && atomicLoad(&extra[at + E_state]) != 2;
        if (repairing) {
            let hp = atomicLoad(&extra[at + E_hp]); let max_hp = defs[def + U_hp];
            progress = atomicLoad(&extra[at + E_repairProgress]);
            var base = atomicLoad(&extra[at + E_repairBase]);
            let healed = i32(ratio(u32(max_hp),u32(progress),u32(total)));
            if (base <= 0 || base + min(healed,max_hp - base) != hp) {
                progress = 0; base = hp;
                atomicStore(&extra[at + E_repairBase],base);
                atomicStore(&extra[at + E_repairProgress],0);
            }
            limit = cumulative(total,max_hp - base,max_hp);
        }
        var speed = select(assist,assist / ${BALANCE.construction.repairSpeedDivisor},repairing);
        if (crane) { speed = assist / max(1,defs[entity_def(id) + U_buildPower]); }
        let gain = min(speed,limit - progress);
        let cost = build_cost(build,progress,gain); atomicStore(&extra[request],gain);
        atomicStore(&extra[request + 3u],progress);
        atomicStore(&extra[request + 1u],cost.x); atomicStore(&extra[request + 2u],cost.y);
        money_demand = wide_add(money_demand,u32(cost.x)); power_demand = wide_add(power_demand,u32(cost.y));
    }
    let unlimited = defs[D_unlimitedEconomy] != 0;
    var scale = 65536u;
    if (!unlimited) {
        scale = min(shortage(u32(eco(offset + C_money)),money_demand),shortage(u32(eco(offset + C_power)),power_demand));
    }
    var money_used = 0; var power_used = 0;
    for (var id = 0u; id < count; id++) {
        if (!is_live(id) || entity_source(id) != slot) { continue; }
        let at = entity(id); var def = entity_def(id);
        let building = atomicLoad(&extra[at + E_state]) == 2;
        let request = u32(defs[D_construction]) + id * 4u;
        let crane = crane_upgrading(id);
        if (crane) {
            def = placement_def(crane_upgrade_def(id));
            if (!placement_clear(def,crane_upgrade_box(id,def),i32(id),false)) { continue; }
        }
        let build = build_spec(def);
        let before = atomicLoad(&extra[request + 3u]);
        let budget = vec2<i32>(i32(ratio(u32(atomicLoad(&extra[request + 1u])),scale,65536u)),
            i32(ratio(u32(atomicLoad(&extra[request + 2u])),scale,65536u)));
        var low = 0; var high = i32(ratio(u32(atomicLoad(&extra[request])),scale,65536u));
        while (low < high) {
            let middle = low + (high - low + 1) / 2;
            if (all(build_cost(build,before,middle) <= budget)) { low = middle; } else { high = middle - 1; }
        }
        if (low > 0) {
            if (!unlimited) {
                let cost = build_cost(build,before,low); money_used += cost.x; power_used += cost.y;
            }
            let total = build.z; let progress = before + low;
            if (crane) {
                atomicStore(&extra[at + E_upgradeGain],low);
                atomicStore(&extra[at + E_upgradeProgress],select(progress,0,progress == total));
                if (progress == total) {
                    let box = crane_upgrade_box(id,def);
                    let old = entity_def(id);
                    let point = vec2<i32>(atomicLoad(&extra[at + E_x]),atomicLoad(&extra[at + E_z]));
                    let centre = (box.xy + box.zw) * Q / 2;
                    unit_occupancy(id,point,false);
                    atomicStore(&extra[at + E_def],crane_upgrade_def(id));
                    atomicStore(&extra[at + E_x],centre.x);
                    atomicStore(&extra[at + E_z],centre.y);
                    atomicAdd(&extra[at + E_hp],defs[def + U_hp] - defs[old + U_hp]);
                    atomicStore(&extra[at + E_progress],total);
                    atomicStore(&extra[at + E_repairBase],0);
                    unit_occupancy(id,centre,true);
                    atomicStore(&extra[u32(defs[D_flowControl])],1);
                    atomicAdd(&extra[u32(defs[D_flowControl]) + 2u],1);
                }
                continue;
            }
            if (!building) {
                let base = atomicLoad(&extra[at + E_repairBase]); let max_hp = defs[def + U_hp];
                let healed = i32(ratio(u32(max_hp),u32(progress),u32(total)));
                atomicStore(&extra[at + E_hp],base + min(healed,max_hp - base));
                atomicStore(&extra[at + E_repairProgress],progress);
                continue;
            }
            let old_hp = max(1,i32(ratio(u32(defs[def + U_hp]),u32(before),u32(total))));
            let new_hp = max(1,i32(ratio(u32(defs[def + U_hp]),u32(progress),u32(total))));
            atomicStore(&extra[at + E_hp],min(defs[def + U_hp],atomicLoad(&extra[at + E_hp]) + (new_hp - old_hp)));
            atomicStore(&extra[at + E_progress],progress); atomicStore(&extra[at + E_decay],i32(p(P_tick)));
            if (progress == total) {
                atomicStore(&extra[at + E_state],1);
                atomicStore(&extra[at + E_power],defs[def + U_power]);
                atomicStore(&extra[at + E_timer],i32(p(P_tick)) + defs[def + U_armTicks]);
            }
        } else if (building && i32(p(P_tick)) - atomicLoad(&extra[at + E_decay]) >= ${60 * TICK_HZ}) {
            atomicStore(&extra[at + E_decay],i32(p(P_tick)));
            atomicStore(&extra[at + E_hp],atomicLoad(&extra[at + E_hp]) - 1);
            if (atomicLoad(&extra[at + E_hp]) <= 0) { free_entity(id); }
        }
    }
    eco_set(offset + C_money,eco(offset + C_money) - money_used);
    eco_set(offset + C_power,eco(offset + C_power) - power_used);
    eco_set(offset + C_moneyRate,money_used + eco(offset + C_moneyRate));
    eco_set(offset + C_powerRate,power_used + eco(offset + C_powerRate));
}
fn sample_spending(slot: u32) {
    let offset = economy_offset(slot);
    let sample = p(P_tick) % 20u;
    eco_set(offset + 16u + sample,eco(offset + C_moneyRate));
    eco_set(offset + 36u + sample,eco(offset + C_powerRate));
    var money_rate = 0; var power_rate = 0;
    for (var i = 0u; i < 20u; i++) {
        money_rate += min(2147483647 - money_rate,eco(offset + 16u + i));
        power_rate += min(2147483647 - power_rate,eco(offset + 36u + i));
    }
    eco_set(offset + C_moneyUsed,money_rate); eco_set(offset + C_powerUsed,power_rate);
    eco_set(offset + C_sampleTick,i32(p(P_tick)));
}
`;
