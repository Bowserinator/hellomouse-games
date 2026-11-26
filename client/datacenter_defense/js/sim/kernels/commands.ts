import { LOBBY_LIMIT } from '../../shared/protocol.js';
import { BALANCE } from '../balance.js';
import { COMMAND_SLOT_WORDS, COMMAND_STRIDE, COMMAND_WORDS, CommandType, MAX_PLAYERS,
    MAX_COMMANDS, ORDER_TARGET_SHIFT, SALE_EFFECT_SLOTS } from '../commands.js';
import { MAX_ORDERS, MAX_WEAPONS, PLAYER_WORDS, PROJECTILE_WORDS, RENDER_EXPLOSION_WORDS,
    RENDER_SALE_EFFECT, WEAPON_WORDS } from '../layout.js';

export function commandKernels(workgroupSize: number): string {
    return `
fn selected_entity(command: u32, id: u32) -> bool {
    return entity_source(id) == (u32(atomicLoad(&extra[command])) >> 3u) &&
        (u32(atomicLoad(&extra[command + ${COMMAND_WORDS}u + id / 32u])) & (1u << (id % 32u))) != 0u;
}
fn clear_override(id: u32) {
    for (var mount = 0u; mount < 4u; mount++) {
        atomicStore(&extra[weapon_state(id * 4u + mount) + 3u], 0);
    }
}
fn transfer_entity(id: u32, recipient: i32) {
    let at = entity(id); let rotation = atomicLoad(&extra[at + E_rotation]) & 3;
    if (is_active(id)) {
        let def = entity_def(id);
        change_storage(entity_source(id),def,-1);
        change_storage(u32(recipient),def,1);
    }
    atomicStore(&extra[at + E_rotation],rotation | (recipient << 2u));
    atomicStore(&extra[at + E_owner],recipient % ${MAX_PLAYERS});
}
fn inherit_units(departed: u32, eligible: u32) {
    var recipient = -1; var best = -1;
    for (var slot = 0u; slot < ${LOBBY_LIMIT}u; slot++) {
        if ((eligible & (1u << slot)) == 0u) { continue; }
        let kills = eco(C_kills + slot);
        if (kills > best) { recipient = i32(slot); best = kills; }
    }
    if (recipient < 0) { return; }
    eco_set(C_players,i32(u32(eco(C_players)) & ~departed));
    for (var id = 0u; id < min(MAX_ENTITIES,u32(atomicLoad(&extra[2]))); id++) {
        if (is_live(id) && (departed & (1u << entity_source(id))) != 0u) { transfer_entity(id,recipient); }
    }
    for (var i = 0u; i < ghost_count(); i++) {
        let at = ghost_at(i);
        if ((departed & (1u << u32(atomicLoad(&extra[at + 5u])))) != 0u) {
            atomicStore(&extra[at + 4u],recipient % ${MAX_PLAYERS});
            atomicStore(&extra[at + 5u],recipient);
        }
    }
}
@compute @workgroup_size(1)
fn apply_commands() {
    for (var slot = 0u; slot < ${LOBBY_LIMIT}u; slot++) {
        let offset = economy_offset(slot);
        eco_set(offset + C_moneyRate,0); eco_set(offset + C_powerRate,0);
    }
    let start = p(P_commands); let count = min(u32(atomicLoad(&extra[start])), 64u);
    var command_hash = bitcast<u32>(atomicLoad(&extra[p(P_commandHash)]));
    for (var i = 0u; i < count; i++) {
        let at = start + 1u + i * ${COMMAND_STRIDE}u;
        let attribution = u32(atomicLoad(&extra[at]));
        let player = attribution & 7u; let source = attribution >> 3u;
        let kind = atomicLoad(&extra[at + 3u]);
        let a = atomicLoad(&extra[at + 4u]); let b = atomicLoad(&extra[at + 5u]);
        let c = atomicLoad(&extra[at + 6u]); let d = atomicLoad(&extra[at + 7u]);
        for (var word = 0u; word < ${COMMAND_STRIDE}u; word++) {
            command_hash = pcg(command_hash ^ bitcast<u32>(atomicLoad(&extra[at + word])));
        }
        if (source >= ${LOBBY_LIMIT}u || !player_has_economy(source)) { continue; }
        let avatar = p(P_players) + player * ${PLAYER_WORDS}u;
        atomicStore(&extra[avatar + 5u], atomicLoad(&extra[at + 1u]));
        if (kind == ${CommandType.Order} && a == 5) {
            if (b < 0 || b >= i32(MAX_ENTITIES) || c < 0 || c > 1 || d != 0) { continue; }
            for (var body = 0u; body < MAX_ENTITIES; body++) {
                if (!selected_entity(at,body)) { continue; }
                if (c == 0) { set_build_task(i32(body),b,true); continue; }
                let builder = entity(body);
                let manual = atomicLoad(&extra[builder + E_explicitTask]) != 0;
                if (atomicLoad(&extra[builder + E_buildTask]) != b || !builder_reaches(i32(body),u32(b),manual)) { continue; }
                let generation = atomicLoad(&extra[builder + E_taskGeneration]);
                if (generation != (atomicLoad(&extra[entity(u32(b)) + E_flags]) >> 8)) { continue; }
                // shortcut: remember one canceled target per crane; use a list if players need to block several.
                atomicStore(&extra[builder + E_skippedTask],b + 1);
                atomicStore(&extra[builder + E_skippedGeneration],generation);
                atomicStore(&extra[builder + E_buildTask],-1);
                atomicStore(&extra[builder + E_explicitTask],0);
            }
            continue;
        }
        if (kind == ${CommandType.Order}) {
            let preferred = u32(d) >> ${ORDER_TARGET_SHIFT}u;
            if (a < 0 || a > 4 || b < 0 || c < 0 || d < 0 || preferred > p(P_count) ||
                (preferred != 0u && a != 2)) { continue; }
            for (var body = 0u; body < MAX_ENTITIES; body++) {
                if (selected_entity(at,body) && is_live(body)) {
                    push_order(body,a,b,c,d);
                }
            }
            continue;
        }
        if (kind == ${CommandType.RemoveOrder}) {
            if (a >= 0 && a < i32(MAX_ENTITIES) && b >= 0 && b < ${MAX_ORDERS} && is_live(u32(a)) && entity_source(u32(a)) == source) {
                remove_order(u32(a),u32(b));
            }
            continue;
        }
        if (kind == ${CommandType.FireAt} || kind == ${CommandType.ClearOverride} ||
            kind == ${CommandType.SetPriority} || kind == ${CommandType.SetStance}) {
            for (var body = 0u; body < MAX_ENTITIES; body++) {
                if (!selected_entity(at, body) || !is_active(body)) { continue; }
                let entity_at = entity(body);
                if (kind == ${CommandType.ClearOverride}) { clear_override(body); }
                if (kind == ${CommandType.FireAt} && a >= 0 && b >= 0 && c >= 0 && c <= 1) {
                    for (var mount = 0u; mount < 4u; mount++) {
                        let state = weapon_state(body * 4u + mount);
                        atomicStore(&extra[state + 3u], c + 1);
                        atomicStore(&extra[state + 4u], a); atomicStore(&extra[state + 5u], b);
                    }
                }
                if (kind == ${CommandType.SetPriority} && a >= 0 && a <= 3) {
                    atomicStore(&extra[entity_at + E_priorityLow], b); atomicStore(&extra[entity_at + E_priorityHigh], c);
                    let flags = atomicLoad(&extra[entity_at + E_flags]);
                    atomicStore(&extra[entity_at + E_flags], (flags & ~6) | (a << 1u));
                }
                if (kind == ${CommandType.SetStance} && a >= 0 && a <= 1) {
                    let flags = atomicLoad(&extra[entity_at + E_flags]);
                    atomicStore(&extra[entity_at + E_flags], (flags & ~1) | a);
                }
            }
            continue;
        }
        switch kind {
            case ${CommandType.MoveInput}: {
                atomicStore(&extra[avatar + 2u], a); atomicStore(&extra[avatar + 4u], 1);
            }
            case ${CommandType.Ready}: { atomicStore(&extra[avatar + 4u], 1); }
            case ${CommandType.ActivateField}: { if (a >= 0 && a <= 1) { atomicStore(&extra[1], a); } }
            case ${CommandType.Place}: {
                if (a >= 0 && a < defs[D_unitCount] &&
                    defs[u32(defs[D_unit]) + u32(a) * u32(defs[D_unitStride]) + U_kind] == 6) {
                    let def = u32(defs[D_unit]) + u32(a) * u32(defs[D_unitStride]);
                    if (has_builder(at,defs[def + U_tier],vec2<i32>(b,c),false)) {
                        strike(a,b,c,player,source);
                    }
                } else {
                    let queued = queue_ghost(a,b,c,d,player,source,at,
                        atomicLoad(&extra[at + 9u]) == 1);
                }
            }
            case ${CommandType.CraneUpgrade}: {
                if (a < 0 || a >= i32(MAX_ENTITIES) || c < 2 || c > 3) { break; }
                let id = u32(a); let body = entity(id); let def = entity_def(id);
                let flags = u32(atomicLoad(&extra[body + E_flags]));
                if (is_active(id) && entity_source(id) == source && flags >> 8u == u32(b) &&
                    defs[def + U_buildPower] > 0 && c > defs[def + U_tier]) {
                    if (d == 0) {
                        atomicStore(&extra[body + E_upgradeTarget],c);
                        atomicStore(&extra[body + E_queuedUpgrade],0);
                    } else if (c > atomicLoad(&extra[body + E_upgradeTarget])) {
                        atomicMax(&extra[body + E_queuedUpgrade],c);
                    }
                }
            }
            case ${CommandType.Inherit}: { inherit_units(u32(a),u32(b)); }
            case ${CommandType.Gift}: {
                if (a < 0 || a >= i32(MAX_ENTITIES) || c < 0 || c >= ${LOBBY_LIMIT} || u32(c) == source) { break; }
                let id = u32(a); let body = entity(id);
                let flags = u32(atomicLoad(&extra[body + E_flags]));
                if (atomicLoad(&extra[body + E_state]) != 0 && atomicLoad(&extra[body + E_hp]) > 0 &&
                    entity_source(id) == source && (flags >> 8u) == u32(b)) {
                    transfer_entity(id,c);
                }
            }
            case ${CommandType.Sell}: {
                if (a >= 0 && a < i32(MAX_ENTITIES) && is_live(u32(a)) && entity_source(u32(a)) == source &&
                    (u32(atomicLoad(&extra[entity(u32(a)) + E_flags])) >> 8u) == u32(b)) {
                    let body = entity(u32(a)); let def = entity_def(u32(a));
                    let complete = atomicLoad(&extra[body + E_state]) != 2;
                    let slot = u32(defs[D_projectileCountMax]) + (p(P_tick) * ${MAX_COMMANDS}u + i) % ${SALE_EFFECT_SLOTS}u;
                    let effect = u32(defs[D_explosions]) + slot * ${RENDER_EXPLOSION_WORDS}u;
                    atomicStore(&extra[effect],i32(p(P_tick)) + 1);
                    atomicStore(&extra[effect + 1u],atomicLoad(&extra[body + E_x]));
                    atomicStore(&extra[effect + 2u],atomicLoad(&extra[body + E_z]));
                    atomicStore(&extra[effect + 3u],select(0,defs[def + U_flightHeight],complete));
                    atomicStore(&extra[effect + 5u],${RENDER_SALE_EFFECT});
                    free_entity(u32(a));
                    if (complete) {
                        let money = defs[def + U_moneyCost] * ${BALANCE.saleRefundPct} / 100;
                        let power = defs[def + U_powerCost] * ${BALANCE.saleRefundPct} / 100;
                        share_overflow(source,C_money,C_moneyCap,C_moneyCursor,deposit(source,C_money,C_moneyCap,money));
                        share_overflow(source,C_power,C_powerCap,C_powerCursor,deposit(source,C_power,C_powerCap,power));
                    }
                }
            }
            case ${CommandType.PlaceRow}: {
                place_row(a,b,c,d,atomicLoad(&extra[at + 8u]),player,source,at,
                    atomicLoad(&extra[at + 10u]) == 1);
            }
            case ${CommandType.RemoveGhost}: { cancel_ghost(a,b,source); }
            default: {
                if (a < 0 || a >= ${MAX_WEAPONS}) { continue; }
                let weapon = p(P_weapons) + u32(a) * ${WEAPON_WORDS}u;
                let owned = atomicLoad(&extra[weapon]) == 0 || atomicLoad(&extra[weapon + 1u]) == i32(player);
                if (!owned) { continue; }
                switch kind {
                    case ${CommandType.PlaceWeapon}: {
                        if (walkable(b, c)) {
                            atomicStore(&extra[weapon], 1); atomicStore(&extra[weapon + 1u], i32(player));
                            atomicStore(&extra[weapon + 2u], b); atomicStore(&extra[weapon + 3u], c);
                            atomicStore(&extra[weapon + 4u], max(1, d));
                        }
                    }
                    case ${CommandType.UpgradeWeapon}: { atomicStore(&extra[weapon + 4u], max(1, b)); }
                    case ${CommandType.SellWeapon}: { atomicStore(&extra[weapon], 0); }
                    case ${CommandType.DebugProjectile}: {
                        if (atomicLoad(&extra[weapon]) == 0 || b < 0 || b >= i32(p(P_count))) { continue; }
                        let shot = p(P_projectiles) + u32(a) * ${PROJECTILE_WORDS}u;
                        atomicStore(&extra[shot], 1); atomicStore(&extra[shot + 1u], i32(player));
                        atomicStore(&extra[shot + 2u], atomicLoad(&extra[weapon + 2u]));
                        atomicStore(&extra[shot + 3u], atomicLoad(&extra[weapon + 3u]));
                        atomicStore(&extra[shot + 4u], b); atomicStore(&extra[shot + 5u], c);
                        atomicStore(&extra[shot + 6u], d);
                        atomicStore(&extra[shot + 7u], i32(player) * ${MAX_WEAPONS} + a);
                    }
                    default: {}
                }
            }
        }
    }
    atomicStore(&extra[p(P_commandHash)], bitcast<i32>(command_hash));
    for (var player = 0u; player < ${MAX_PLAYERS}u; player++) {
        let at = p(P_players) + player * ${PLAYER_WORDS}u;
        let angle = atomicLoad(&extra[at + 2u]);
        if (atomicLoad(&extra[at + 4u]) == 0 || angle < 0 || angle > 255) { continue; }
        let delta = LUT[u32(angle)] * 3 / 20;
        var x = atomicLoad(&extra[at]); var z = atomicLoad(&extra[at + 1u]);
        if (body_walkable(x + delta.x * 4, z, 22937)) { x += delta.x * 4; }
        if (body_walkable(x, z + delta.y * 4, 22937)) { z += delta.y * 4; }
        atomicStore(&extra[at], x); atomicStore(&extra[at + 1u], z);
    }
}
@compute @workgroup_size(${workgroupSize})
fn weapons_update(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let i = index(id, groups); if (i >= ${MAX_WEAPONS}u) { return; }
    let at = p(P_weapons) + i * ${WEAPON_WORDS}u;
    atomicStore(&extra[at + 5u], max(0, atomicLoad(&extra[at + 5u]) - 1));
}
@compute @workgroup_size(${workgroupSize})
fn projectile_update(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let i = index(id, groups); if (i >= ${MAX_WEAPONS}u) { return; }
    let at = p(P_projectiles) + i * ${PROJECTILE_WORDS}u;
    if (atomicLoad(&extra[at]) != 1) { return; }
    let remaining = max(0, atomicLoad(&extra[at + 6u]) - 1);
    atomicStore(&extra[at + 6u], remaining);
    if (remaining == 0) { atomicStore(&extra[at], 2); }
}
@compute @workgroup_size(${workgroupSize})
fn projectile_hit(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let i = index(id, groups); if (i >= ${MAX_WEAPONS}u) { return; }
    let at = p(P_projectiles) + i * ${PROJECTILE_WORDS}u;
    if (atomicLoad(&extra[at]) != 2) { return; }
    let victim = atomicLoad(&extra[at + 4u]);
    if (victim >= 0 && victim < i32(p(P_count))) {
        atomicAdd(&extra[p(P_damage) + u32(victim)], atomicLoad(&extra[at + 5u]));
        atomicMin(&extra[p(P_credits) + u32(victim)], atomicLoad(&extra[at + 1u]));
    }
    atomicStore(&extra[at], 0);
}
const COMMAND_SLOT_WORDS: u32 = ${COMMAND_SLOT_WORDS}u;
`;
}
