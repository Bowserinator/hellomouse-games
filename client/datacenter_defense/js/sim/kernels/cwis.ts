import { RENDER_EXPLOSION_WORDS, SCRATCH } from '../layout.js';
import { WEAPON_STRIDE } from '../weapon/registry.js';

export const CWIS_WGSL = `
fn cwis_shot_end(first: u32) -> u32 {
    var end = first + min(2048u,atomicLoad(&scratch[${SCRATCH.hostileEnd}]));
    while (end > first) {
        let at = shot_at(end - 1u);
        if (atomicLoad(&extra[at]) == 1 && atomicLoad(&extra[at + 1u]) < 0) { break; }
        end--;
    }
    atomicStore(&scratch[${SCRATCH.hostileEnd}],end - first);
    return end;
}
@compute @workgroup_size(1)
fn cwis_intercept() {
    let first = u32(defs[D_projectileCountMax]) - 2048u;
    var shot_end = cwis_shot_end(first);
    for (var id = 0u; id < min(MAX_ENTITIES,u32(atomicLoad(&extra[2]))); id++) {
        let body = entity(id);
        if (!is_active(id)) { continue; }
        let body_def = entity_def(id);
        for (var slot = 0u; slot < u32(defs[body_def + U_weaponCount]); slot++) {
            let definition = u32(defs[D_weapon]) + u32(defs[body_def + U_weapons + slot]) * ${WEAPON_STRIDE}u;
            if (defs[definition + W_fire] != 3) { continue; }
            let mount = id * 4u + slot; let weapon = weapon_state(mount);
            let remaining = max(0,atomicLoad(&extra[weapon]) - 1);
            atomicStore(&extra[weapon],remaining);
            if (remaining > 0 || (atomicLoad(&extra[body + E_flags]) & 1) != 0 || shot_end == first) { continue; }
            let origin = mount_position(mount);
            var source_height = 0; var source_ready = false;
            let radius = cm(defs[definition + W_maxRange]);
            // Keep the raw rejection conservative around centimetre truncation.
            let raw_limit = defs[definition + W_maxRange] + Q / 100 + 1;
            var removed = 0;
            for (var pick = 0; pick < defs[definition + W_fireParams]; pick++) {
                var selected = shot_end; var soonest = 2147483647;
                for (var shot = first; shot < shot_end; shot++) {
                    let at = shot_at(shot);
                    if (atomicLoad(&extra[at]) != 1 || atomicLoad(&extra[at + 1u]) >= 0 || atomicLoad(&extra[at + 2u]) == -2) { continue; }
                    let ticks = atomicLoad(&extra[at + 10u]);
                    if (ticks >= soonest) { continue; }
                    let x = atomicLoad(&extra[at + 4u]); let z = atomicLoad(&extra[at + 5u]);
                    let delta = vec2<i32>(x - origin.x,z - origin.y);
                    let inside = max(abs(delta.x),abs(delta.y)) <= raw_limit;
                    // Incoming shots may still be aimed inside the protected circle.
                    let aux = shot_aux(shot);
                    let aim_delta = vec2<i32>(atomicLoad(&extra[aux]) - origin.x,atomicLoad(&extra[aux + 1u]) - origin.y);
                    let aim_inside = max(abs(aim_delta.x),abs(aim_delta.y)) <= raw_limit;
                    if (!inside && !aim_inside) { continue; }
                    var covered = false;
                    if (aim_inside) {
                        let aim = vec2<i32>(cm(aim_delta.x),cm(aim_delta.y));
                        covered = aim.x * aim.x + aim.y * aim.y <= radius * radius;
                    }
                    if (!covered) {
                        if (!inside) { continue; }
                        let flat = vec2<i32>(cm(delta.x),cm(delta.y));
                        let squared = flat.x * flat.x + flat.y * flat.y;
                        if (squared > radius * radius) { continue; }
                        if (!source_ready) {
                            source_height = building_height(origin.x,origin.y) + Q;
                            source_ready = true;
                        }
                        let rise = cm(building_height(x,z) + atomicLoad(&extra[at + 6u]) - source_height);
                        if (abs(rise) > radius) { continue; }
                        covered = squared + rise * rise <= radius * radius;
                    }
                    if (!covered) { continue; }
                    soonest = ticks; selected = shot;
                }
                if (selected == shot_end) { break; }
                let at = shot_at(selected);
                let dx = atomicLoad(&extra[at + 4u]) - origin.x;
                let dz = atomicLoad(&extra[at + 5u]) - origin.y;
                atomicStore(&extra[weapon + 1u],atan2_q(dz,dx));
                let flash = u32(defs[D_explosions]) + selected * ${RENDER_EXPLOSION_WORDS}u;
                atomicStore(&extra[flash],i32(p(P_tick)) + 1); atomicStore(&extra[flash + 1u],atomicLoad(&extra[at + 4u]));
                atomicStore(&extra[flash + 2u],atomicLoad(&extra[at + 5u])); atomicStore(&extra[flash + 3u],atomicLoad(&extra[at + 6u]));
                atomicStore(&extra[flash + 4u],-i32(mount) - 1); atomicStore(&extra[flash + 5u],atomicLoad(&extra[at + 3u]));
                atomicStore(&extra[at],0); removed++;
                shot_end = cwis_shot_end(first);
            }
            atomicStore(&extra[weapon],select(2,defs[definition + W_cooldown],removed > 0));
        }
    }
}
`;
