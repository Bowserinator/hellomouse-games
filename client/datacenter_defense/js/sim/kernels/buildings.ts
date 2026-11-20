export const BUILDINGS_WGSL = `
fn building_fraction(value: u32, divisor: u32) -> i32 {
    if (divisor == 0u) { return 0; }
    if (value >= divisor) { return Q; }
    return fraction_q(value,divisor);
}
fn building_word(i: u32) -> i32 { return i32(nav[u32(defs[D_buildings]) + i]); }
fn building_vec(i: u32) -> vec3<i32> {
    return vec3<i32>(building_word(i),building_word(i + 1u),building_word(i + 2u));
}
fn building_dot(a: vec3<i32>, b: vec3<i32>) -> i32 {
    return mul_q(a.x,b.x) + mul_q(a.y,b.y) + mul_q(a.z,b.z);
}
fn building_ring(edge: u32, count: u32, point: vec3<i32>) -> bool {
    var contained = false;
    for (var i = 0u; i < count; i++) {
        let at = edge + i * 6u;
        let ax = building_word(at); let az = building_word(at + 1u);
        let bx = building_word(at + 2u); let bz = building_word(at + 3u);
        let side = mul_q(building_word(at + 4u),point.x - ax) +
            mul_q(building_word(at + 5u),point.z - az);
        if (side == 0 && point.x >= min(ax,bx) && point.x <= max(ax,bx) &&
            point.z >= min(az,bz) && point.z <= max(az,bz)) { return true; }
        if ((az > point.z) != (bz > point.z) && select((side < 0),(side > 0),(bz > az))) {
            contained = !contained;
        }
    }
    return contained;
}
fn building_material(data: u32, point: vec3<i32>) -> bool {
    let roof = building_word(data + 2u) - mul_q(abs(point.x - building_word(data + 3u)),building_word(data + 4u));
    if (point.y < building_word(data) || point.y > roof ||
        !building_ring(u32(building_word(data + 5u)),u32(building_word(data + 6u)),point)) { return false; }
    let passages = u32(building_word(data + 7u));
    for (var i = 0u; i < u32(building_word(data + 8u)); i++) {
        let at = passages + i * 4u;
        if (point.y >= building_word(at + 2u) && point.y <= building_word(at + 3u) &&
            building_ring(u32(building_word(at)),u32(building_word(at + 1u)),point)) { return false; }
    }
    return true;
}
fn building_box(start: vec3<i32>, delta: vec3<i32>, low: vec3<i32>, high: vec3<i32>) -> bool {
    var enter = 0; var leave = Q;
    for (var axis = 0u; axis < 3u; axis++) {
        if (delta[axis] == 0) {
            if (start[axis] < low[axis] || start[axis] > high[axis]) { return false; }
            continue;
        }
        let length = abs(delta[axis]);
        let near_distance = select(low[axis] - start[axis],start[axis] - high[axis],delta[axis] < 0);
        let far_distance = select(high[axis] - start[axis],start[axis] - low[axis],delta[axis] < 0);
        if (near_distance > length || far_distance < 0) { return false; }
        if (near_distance > 0) {
            enter = max(enter,building_fraction(u32(near_distance),u32(length)));
        }
        if (far_distance < length) {
            leave = min(leave,building_fraction(u32(far_distance),u32(length)));
        }
        if (enter > leave) { return false; }
    }
    return true;
}
fn building_hit(start: vec3<i32>, delta: vec3<i32>) -> i32 {
    var closest = Q + 1; var node = 0u;
    let count = u32(building_word(0u));
    let nudge = delta / max(1,max(abs(delta.x),max(abs(delta.y),abs(delta.z))) / 655 + 1);
    loop {
        if (node >= count) { break; }
        let at = 2u + node * 8u;
        if (!building_box(start,delta,building_vec(at),building_vec(at + 3u))) {
            node = u32(building_word(at + 6u)); continue;
        }
        let leaf = building_word(at + 7u); node++;
        if (leaf < 0) { continue; }
        let data = u32(leaf);
        if (building_material(data,start)) { return 0; }
        let planes = u32(building_word(data + 9u));
        for (var i = 0u; i < u32(building_word(data + 10u)); i++) {
            let plane = planes + i * 6u; let normal = building_vec(plane + 3u);
            let numerator = building_dot(normal,building_vec(plane) - start);
            let denominator = building_dot(normal,delta);
            if (denominator == 0 || (numerator < 0 && denominator > 0) ||
                (numerator > 0 && denominator < 0) || abs(numerator) > abs(denominator)) { continue; }
            let ratio = building_fraction(u32(abs(numerator)),u32(abs(denominator)));
            if (ratio >= closest) { continue; }
            let point = start + vec3<i32>(mul_q(delta.x,ratio),mul_q(delta.y,ratio),mul_q(delta.z,ratio));
            if (building_material(data,point + nudge)) { closest = ratio; }
        }
    }
    return closest;
}
fn building_height(x: i32, z: i32) -> i32 {
    let columns = p(P_terrainColumns); let rows = p(P_terrainRows);
    let px = u32(clamp(x,0,i32(p(P_widthQ)))); let pz = u32(clamp(z,0,i32(p(P_depthQ))));
    var gx = building_fraction(px,p(P_widthQ)) * i32(columns - 1u);
    var gz = building_fraction(pz,p(P_depthQ)) * i32(rows - 1u);
    if (px == p(P_widthQ)) { gx = Q * i32(columns - 1u); }
    if (pz == p(P_depthQ)) { gz = Q * i32(rows - 1u); }
    let ix = min(columns - 2u,u32(gx / Q)); let iz = min(rows - 2u,u32(gz / Q));
    let fx = gx - i32(ix) * Q; let fz = gz - i32(iz) * Q; let at = p(P_terrain) + iz * columns + ix;
    let base = building_word(1u);
    let da = i32(nav[at]) + base; let db = i32(nav[at + 1u]) + base;
    let dc = i32(nav[at + columns]) + base; let dd = i32(nav[at + columns + 1u]) + base;
    let a = da / 10 * Q + da % 10 * Q / 10; let b = db / 10 * Q + db % 10 * Q / 10;
    let c = dc / 10 * Q + dc % 10 * Q / 10; let d = dd / 10 * Q + dd % 10 * Q / 10;
    if (fx + fz <= Q) { return a + mul_q(b - a,fx) + mul_q(c - a,fz); }
    return d + mul_q(b - d,Q - fz) + mul_q(c - d,Q - fx);
}
`;
