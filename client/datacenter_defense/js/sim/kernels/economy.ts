import { BALANCE } from '../balance.js';
import { defaults } from '../entity/registry.js';
import { TICK_HZ } from '../fixed.js';
import { ECONOMY } from '../layout.js';

const upgrades = [defaults(2), defaults(3)];

export const ECONOMY_WGSL = `
${Object.entries(ECONOMY).map(([name, value]) => `const C_${name}: u32 = ${value}u;`).join('\n')}
fn eco(key: u32) -> i32 { return atomicLoad(&extra[u32(defs[D_economy]) + key]); }
fn eco_set(key: u32, value: i32) { atomicStore(&extra[u32(defs[D_economy]) + key],value); }
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
fn objective_upgrading() -> bool {
    return atomicLoad(&extra[0]) > 0 && eco(C_upgradeTarget) > eco(C_objectiveTier);
}
fn objective_power() -> i32 {
    return array<i32,3>(${BALANCE.construction.power.join(',')})[u32(eco(C_objectiveTier) - 1)];
}
fn queue_upgrade(tier: i32, append: bool) {
    if (atomicLoad(&extra[0]) <= 0 || tier <= eco(C_objectiveTier) || tier > 3) { return; }
    eco_set(C_upgradeTarget,select(tier,max(tier,eco(C_upgradeTarget)),append));
}
fn objective_reach(id: u32) -> bool {
    if (!is_active(id)) { return false; }
    let radius = defs[entity_def(id) + U_buildRadius];
    let at = entity(id);
    let dx = atomicLoad(&extra[at + E_x]) / Q - i32(p(P_objectiveX)) / Q;
    let dz = atomicLoad(&extra[at + E_z]) / Q - i32(p(P_objectiveZ)) / Q;
    return radius > 0 && in_circle(dx,dz,radius);
}
fn storage_on_edge(cell: vec2<i32>, centre: vec2<i32>, size: vec2<i32>, axis: u32, storage_key: u32) -> i32 {
    if (any(cell < vec2<i32>(0)) || cell.x >= i32(p(P_columns)) || cell.y >= i32(p(P_rows))) { return 0; }
    let found = occupancy(u32(cell.y) * p(P_columns) + u32(cell.x));
    if (found < 0 || !is_active(u32(found))) { return 0; }
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
    return storage_on_edge(vec2<i32>(first.x - 1,first.y),centre,size,0u,storage_key) +
        storage_on_edge(vec2<i32>(end.x,first.y),centre,size,0u,storage_key) +
        storage_on_edge(vec2<i32>(first.x,first.y - 1),centre,size,1u,storage_key) +
        storage_on_edge(vec2<i32>(first.x,end.y),centre,size,1u,storage_key);
}
fn economy_caps() -> vec2<i32> {
    var money_cap = select(0,50000,atomicLoad(&extra[0]) > 0);
    var power_cap = select(0,500000,atomicLoad(&extra[0]) > 0);
    let alive = atomicLoad(&extra[0]) > 0;
    var money_income = select(0,${BALANCE.objective.money * 40},alive);
    var power_income = select(0,${BALANCE.objective.power * 40},alive);
    for (var id = 0u; id < min(MAX_ENTITIES,u32(atomicLoad(&extra[2]))); id++) {
        if (!is_active(id)) { continue; }
        let def = entity_def(id);
        money_cap += defs[def + U_moneyStorage]; power_cap += defs[def + U_powerStorage];
        let money = defs[def + U_moneyIncome]; let power = defs[def + U_powerIncome];
        if (money > 0) { money_income += money * (8 + adjacent_storage(id,U_moneyStorage)); }
        if (power > 0) { power_income += power * (8 + adjacent_storage(id,U_powerStorage)); }
    }
    eco_set(C_moneyCap,money_cap); eco_set(C_powerCap,power_cap);
    eco_set(C_money,min(eco(C_money),money_cap)); eco_set(C_power,min(eco(C_power),power_cap));
    eco_set(C_moneyIncome,money_income * 5 / 2); eco_set(C_powerIncome,power_income * 5 / 2);
    return vec2<i32>(money_income,power_income);
}
fn builder_reaches_point(builder: i32, centre: vec2<i32>, required: i32) -> bool {
    var origin = vec2<i32>(i32(p(P_objectiveX)),i32(p(P_objectiveZ))) / Q;
    var radius = defs[D_objectiveBuildRadius];
    var tier = eco(C_objectiveTier);
    if (builder < 0) { if (atomicLoad(&extra[0]) <= 0) { return false; } }
    else {
        let id = u32(builder); if (!is_active(id)) { return false; }
        let def = entity_def(id); if (defs[def + U_buildPower] <= 0) { return false; }
        let at = entity(id); radius = defs[def + U_buildRadius]; tier = defs[def + U_tier];
        origin = vec2<i32>(atomicLoad(&extra[at + E_x]),atomicLoad(&extra[at + E_z])) / Q;
    }
    let delta = centre / Q - origin;
    return tier >= required && in_circle(delta.x,delta.y,radius);
}
fn builder_reaches(builder: i32, victim: u32) -> bool {
    if (!is_live(victim) || builder == i32(victim)) { return false; }
    let at = entity(victim); let def = entity_def(victim);
    let building = atomicLoad(&extra[at + E_state]) == 2;
    if (!building && atomicLoad(&extra[at + E_hp]) >= defs[def + U_hp]) { return false; }
    let centre = vec2<i32>(atomicLoad(&extra[at + E_x]),atomicLoad(&extra[at + E_z]));
    return builder_reaches_point(builder,centre,select(0,defs[def + U_tier],building));
}
fn next_ghost(builder: i32) -> i32 {
    var index = 0u;
    while (index < ghost_count()) {
        let at = ghost_at(index);
        let def = placement_def(atomicLoad(&extra[at])); let box = ghost_box(at);
        if (builder_reaches_point(builder,(box.xy + box.zw) * Q / 2,defs[def + U_tier])) {
            let spawned = spawn_ghost(index,def,box);
            if (spawned >= 0) { return spawned; }
            if (spawned == -2) { break; }
        } else { index++; }
    }
    return -1;
}
fn set_build_task(builder: i32, victim: i32, manual: bool) {
    if (victim < 0 || victim >= i32(MAX_ENTITIES) || !builder_reaches(builder,u32(victim))) { return; }
    let generation = atomicLoad(&extra[entity(u32(victim)) + E_flags]) >> 8;
    if (builder < 0) {
        eco_set(C_objectiveTask,victim); eco_set(C_objectiveGeneration,generation);
        eco_set(C_objectiveExplicit,i32(manual));
    } else {
        let at = entity(u32(builder)); atomicStore(&extra[at + E_buildTask],victim);
        atomicStore(&extra[at + E_taskGeneration],generation);
        atomicStore(&extra[at + E_explicitTask],i32(manual));
    }
}
fn collect_builder(builder: i32) {
    var task = eco(C_objectiveTask); var generation = eco(C_objectiveGeneration);
    var manual = eco(C_objectiveExplicit) != 0; var held = eco(C_objectiveHold) != 0; var power = objective_power();
    if (builder < 0 && objective_upgrading()) { return; }
    if (builder >= 0) {
        let at = entity(u32(builder)); if (!is_active(u32(builder))) { return; }
        power = defs[entity_def(u32(builder)) + U_buildPower]; if (power == 0) { return; }
        task = atomicLoad(&extra[at + E_buildTask]); generation = atomicLoad(&extra[at + E_taskGeneration]);
        manual = atomicLoad(&extra[at + E_explicitTask]) != 0;
        held = (atomicLoad(&extra[at + E_flags]) & 1) != 0;
        if (task == -2) {
            if (objective_upgrading() && objective_reach(u32(builder))) {
                if (!held) { eco_set(C_upgradeRequest,eco(C_upgradeRequest) + power * 256); }
                return;
            }
            task = -1; manual = false;
        }
    }
    if (task >= 0 && (!builder_reaches(builder,u32(task)) ||
        (atomicLoad(&extra[entity(u32(task)) + E_flags]) >> 8) != generation)) { task = -1; manual = false; }
    if (!manual && (p(P_tick) % 10u == 0u || task < 0)) {
        task = -1;
        var repair = -1;
        if (!held) { for (var other = 0u; other < min(MAX_ENTITIES,u32(atomicLoad(&extra[2]))); other++) {
            if (!builder_reaches(builder,other)) { continue; }
            if (atomicLoad(&extra[entity(other) + E_state]) != 2) {
                if (repair < 0) { repair = i32(other); }
                continue;
            }
            if (task < 0 || fraction_greater(u32(atomicLoad(&extra[entity(other) + E_progress])),
                u32(defs[entity_def(other) + U_buildTicks]) * 256u,
                u32(atomicLoad(&extra[entity(u32(task)) + E_progress])),
                u32(defs[entity_def(u32(task)) + U_buildTicks]) * 256u)) { task = i32(other); }
        } }
        if (task < 0 && !held) { task = next_ghost(builder); }
        if (task < 0) { task = repair; }
    }
    if (builder < 0) { eco_set(C_objectiveTask,task); eco_set(C_objectiveExplicit,i32(manual)); }
    else {
        let at = entity(u32(builder)); atomicStore(&extra[at + E_buildTask],task);
        atomicStore(&extra[at + E_explicitTask],i32(manual));
    }
    if (task >= 0 && (!held || manual)) {
        set_build_task(builder,task,manual);
        atomicAdd(&extra[entity(u32(task)) + E_assist],power * 256);
    }
}
fn upgrade_build() -> vec3<i32> {
    return array<vec3<i32>,2>(${upgrades.map(upgrade =>
        `vec3<i32>(${upgrade.cost.money * 100},${upgrade.cost.power * 100},${upgrade.buildSeconds * TICK_HZ * 256})`).join(',')})[u32(eco(C_objectiveTier) - 1)];
}
fn build_cost(build: vec3<i32>, progress: i32, gain: i32) -> vec2<i32> {
    return vec2<i32>(cumulative(build.x,progress + gain,build.z) - cumulative(build.x,progress,build.z),
        cumulative(build.y,progress + gain,build.z) - cumulative(build.y,progress,build.z));
}
@compute @workgroup_size(1)
fn economy_tick() {
    let income = economy_caps() + vec2<i32>(eco(C_moneyCarry),eco(C_powerCarry));
    eco_set(C_moneyCarry,income.x % 8); eco_set(C_powerCarry,income.y % 8);
    eco_set(C_money,min(eco(C_moneyCap),eco(C_money) + income.x / 8));
    eco_set(C_power,min(eco(C_powerCap),eco(C_power) + income.y / 8));
    eco_set(C_upgradeGain,0);
    let upgrading = objective_upgrading();
    let held = eco(C_objectiveHold) != 0;
    eco_set(C_upgradeRequest,select(0,objective_power() * 256,upgrading && !held));
    let previous_count = min(MAX_ENTITIES,u32(atomicLoad(&extra[2])));
    for (var id = 0u; id < previous_count; id++) { atomicStore(&extra[entity(id) + E_assist],0); }
    collect_builder(-1);
    for (var id = 0u; id < previous_count; id++) { collect_builder(i32(id)); }
    let count = min(MAX_ENTITIES,u32(atomicLoad(&extra[2])));
    var money_demand = vec2<u32>(0u); var power_demand = vec2<u32>(0u);
    let upgrade_request = u32(defs[D_economy]) + C_upgradeRequest;
    if (upgrading && !held) {
        let build = upgrade_build(); let progress = eco(C_upgradeProgress);
        let gain = min(eco(C_upgradeRequest),build.z - progress);
        let cost = build_cost(build,progress,gain);
        eco_set(C_upgradeRequest,gain); eco_set(C_upgradeRequest + 3u,progress);
        eco_set(C_upgradeRequest + 1u,cost.x); eco_set(C_upgradeRequest + 2u,cost.y);
        money_demand = wide_add(money_demand,u32(cost.x)); power_demand = wide_add(power_demand,u32(cost.y));
    } else { eco_set(C_upgradeRequest,0); }
    for (var id = 0u; id < count; id++) {
        let at = entity(id); let request = u32(defs[D_construction]) + id * 4u;
        atomicStore(&extra[request],0);
        let assist = atomicLoad(&extra[at + E_assist]);
        if (assist == 0) { continue; }
        let def = entity_def(id); let total = defs[def + U_buildTicks] * 256;
        var progress = atomicLoad(&extra[at + E_progress]); var limit = total;
        if (atomicLoad(&extra[at + E_state]) != 2) {
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
        let gain = min(assist,limit - progress);
        let cost = build_cost(vec3<i32>(defs[def + U_moneyCost],defs[def + U_powerCost],total),progress,gain); atomicStore(&extra[request],gain);
        atomicStore(&extra[request + 3u],progress);
        atomicStore(&extra[request + 1u],cost.x); atomicStore(&extra[request + 2u],cost.y);
        money_demand = wide_add(money_demand,u32(cost.x)); power_demand = wide_add(power_demand,u32(cost.y));
    }
    let unlimited = defs[D_unlimitedEconomy] != 0;
    var scale = 65536u;
    if (!unlimited) {
        scale = min(shortage(u32(eco(C_money)),money_demand),shortage(u32(eco(C_power)),power_demand));
    }
    var money_used = 0; var power_used = 0;
    for (var id = 0u; id <= count; id++) {
        let upgrade = id == count;
        var request = upgrade_request;
        var build = vec3<i32>(0); var at = 0u; var def = 0u; var building = false;
        if (upgrade) {
            if (eco(C_upgradeRequest) == 0) { continue; }
            build = upgrade_build();
        } else {
            if (!is_live(id)) { continue; }
            at = entity(id); def = entity_def(id);
            building = atomicLoad(&extra[at + E_state]) == 2;
            request = u32(defs[D_construction]) + id * 4u;
            build = vec3<i32>(defs[def + U_moneyCost],defs[def + U_powerCost],defs[def + U_buildTicks] * 256);
        }
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
            if (upgrade) {
                eco_set(C_upgradeGain,low);
                eco_set(C_upgradeProgress,select(progress,0,progress == total));
                if (progress == total) { eco_set(C_objectiveTier,eco(C_objectiveTier) + 1); }
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
    eco_set(C_money,eco(C_money) - money_used); eco_set(C_power,eco(C_power) - power_used);
    let sample = p(P_tick) % 20u;
    eco_set(C_moneyHistory + sample,income.x / 8);
    eco_set(C_powerHistory + sample,income.y / 8);
    eco_set(16u + sample,money_used + eco(C_moneyRate));
    eco_set(36u + sample,power_used + eco(C_powerRate));
    eco_set(C_moneyRate,eco(16u + sample)); eco_set(C_powerRate,eco(36u + sample));
    var money_rate = 0; var power_rate = 0;
    for (var i = 0u; i < 20u; i++) {
        money_rate += min(2147483647 - money_rate,eco(16u + i));
        power_rate += min(2147483647 - power_rate,eco(36u + i));
    }
    eco_set(C_moneyUsed,money_rate); eco_set(C_powerUsed,power_rate); eco_set(C_sampleTick,i32(p(P_tick)));
    economy_caps();
}
`;
