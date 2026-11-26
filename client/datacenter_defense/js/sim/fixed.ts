export const Q = 65536;
export const TICK_HZ = 20;
export const MAX_ZOMBIES = 100000;
export const PER_SPAWN = 1000;
// Keep the protocol at 1 during local development.
export const PROTOCOL_VERSION = 25;
export const WAVE_WORDS = 5;
export const WAVE_HP = 3;
export const WAVE_DAMAGE = 4;
export const INF = 0xffffffff;
export const STATE_FIELDS = 7;
export const FIELD = { x: 0, z: 1, vx: 2, vz: 3, hp: 4, meta: 5, tgt: 6 } as const;
export const META = {
    variant: { shift: 0, mask: 255 },
    cooldown: { shift: 8, mask: 255 },
    credit: { shift: 16, mask: 15 },
    state: { shift: 20, mask: 3 },
    target: { shift: 22, mask: 3 }
} as const;
export type AgentMetadata = { [K in keyof typeof META]: number };
// Credit 15 means no player; target kinds are none, objective, entity, and avatar.
export function packMetadata(values: AgentMetadata): number {
    let word = 0;
    for (const key of Object.keys(META) as Array<keyof typeof META>) {
        const { shift, mask } = META[key], value = values[key];
        if (!Number.isInteger(value) || value < 0 || value > mask) throw Error(`Invalid zombie ${key}`);
        word |= value << shift;
    }
    return word;
}
export function unpackMetadata(word: number): AgentMetadata {
    return {
        variant: word & 255,
        cooldown: (word >>> 8) & 255,
        credit: (word >>> 16) & 15,
        state: (word >>> 20) & 3,
        target: (word >>> 22) & 3
    };
}

export function mulQ(a: number, b: number): number {
    return Number(BigInt.asIntN(32, BigInt(a | 0) * BigInt(b | 0) / BigInt(Q)));
}
export function isqrt(n: number): number {
    n >>>= 0;
    let result = 0, bit = 0x40000000;
    while (bit > n) bit >>>= 2;
    while (bit) {
        if (n >= result + bit) {
            n -= result + bit; result = (result >>> 1) + bit;
        } else result >>>= 1;
        bit >>>= 2;
    }
    return result;
}
export function pcg(value: number): number {
    const state = (Math.imul(value, 747796405) + 2891336453) >>> 0;
    const word = Math.imul((state >>> ((state >>> 28) + 4)) ^ state, 277803737) >>> 0;
    return ((word >>> 22) ^ word) >>> 0;
}
export function random(seed: number, id: number, tick: number, salt: number): number {
    return pcg(pcg(pcg(seed ^ id) ^ tick) ^ salt);
}
export function hashWords(words: ArrayLike<number>, seed = 0): number {
    let hash = seed >>> 0;
    for (let i = 0; i < words.length; i++) hash = (hash + pcg((words[i] ^ pcg(i)) >>> 0)) >>> 0;
    return hash;
}
const angles = [2097152, 1238021, 654136, 332050, 166669, 83416, 41718, 20860,
    10430, 5215, 2608, 1304, 652, 326, 163, 81];
export const ANGLE_LUT = Array.from({ length: 256 }, (_, angle) => {
    const quadrant = angle >>> 6;
    let x = 9949, z = 0, remainder = (angle & 63) * 65536;
    if (!(angle & 63)) {
        x = 16384; z = 0;
    } else for (let i = 0; i < angles.length; i++) {
        const sign = remainder >= 0 ? 1 : -1;
        const next = x - sign * (z >> i);
        z += sign * (x >> i);
        x = next;
        remainder -= sign * angles[i];
    }
    return quadrant === 0 ? [x, z] : quadrant === 1 ? [-z, x] : quadrant === 2 ? [-x, -z] : [z, -x];
});
export const AIM_LUT = Array.from({ length: 1024 }, (_, angle) => {
    const quadrant = angle >>> 8;
    let x = 10188014, z = 0, remainder = (angle & 255) * 16384;
    if (!(angle & 255)) x = 1 << 24;
    else for (let i = 0; i < angles.length; i++) {
        const sign = remainder >= 0 ? 1 : -1;
        const next = x - sign * (z >> i);
        z += sign * (x >> i);
        x = next;
        remainder -= sign * angles[i];
    }
    const pair = quadrant === 0 ? [x, z] : quadrant === 1 ? [-z, x] : quadrant === 2 ? [-x, -z] : [z, -x];
    return pair.map(n => Math.max(-Q, Math.min(Q, Math.round(n / 256))));
});
export function cosQ(angle: number): number {
    const a = angle & 65535, i = a >>> 6, fraction = a & 63;
    return AIM_LUT[i][0] + Math.trunc((AIM_LUT[(i + 1) & 1023][0] - AIM_LUT[i][0]) * fraction / 64);
}
export function sinQ(angle: number): number {
    return cosQ(angle - 16384);
}
export function atan2Q(z: number, x: number): number {
    if (!x && !z) return 0;
    while (Math.max(Math.abs(x), Math.abs(z)) > 0x10000000) {
        x = Math.trunc(x / 2); z = Math.trunc(z / 2);
    }
    while (Math.max(Math.abs(x), Math.abs(z)) < 0x1000000) {
        x *= 2; z *= 2;
    }
    let angle = 0;
    if (x < 0) {
        x = -x; z = -z; angle = 8388608;
    }
    for (let i = 0; i < angles.length; i++) {
        if (!z) break;
        const sign = z > 0 ? 1 : -1, next = x + sign * (z >> i);
        z -= sign * (x >> i); x = next;
        angle += sign * angles[i];
    }
    return ((angle + 128) >> 8) & 65535;
}
export const FIXED_WGSL = `
const AIM_LUT = array<vec2<i32>, 1024>(${AIM_LUT.map(v => `vec2<i32>(${v[0]},${v[1]})`).join(',')});
const CORDIC_ANGLES = array<i32, 16>(${angles.join(',')});
fn cos_q(angle: i32) -> i32 {
    let a = u32(angle) & 65535u; let i = a >> 6u;
    let left = AIM_LUT[i].x; let right = AIM_LUT[(i + 1u) & 1023u].x;
    return left + (right - left) * i32(a & 63u) / 64;
}
fn sin_q(angle: i32) -> i32 { return cos_q(angle - 16384); }
fn atan2_q(z_in: i32, x_in: i32) -> i32 {
    if (x_in == 0 && z_in == 0) { return 0; }
    var x = x_in; var z = z_in; var angle = 0;
    while (x == (-2147483647 - 1) || z == (-2147483647 - 1) || max(abs(x), abs(z)) > 268435456) {
        x /= 2; z /= 2;
    }
    while (max(abs(x), abs(z)) < 16777216) { x *= 2; z *= 2; }
    if (x < 0) { x = -x; z = -z; angle = 8388608; }
    for (var i = 0u; i < 16u; i++) {
        if (z == 0) { break; }
        let sign = select(-1, 1, z > 0); let nx = x + sign * (z >> i);
        z -= sign * (x >> i); x = nx; angle += sign * CORDIC_ANGLES[i];
    }
    return ((angle + 128) >> 8u) & 65535;
}
const Q: i32 = ${Q};
const INF: u32 = ${INF}u;
const LUT = array<vec2<i32>, 256>(${ANGLE_LUT.map(v => `vec2<i32>(${v[0]},${v[1]})`).join(',')});
fn pcg(value: u32) -> u32 {
    let state = value * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}
fn random(seed: u32, id: u32, tick: u32, salt: u32) -> u32 { return pcg(pcg(pcg(seed ^ id) ^ tick) ^ salt); }
fn mul_q(a: i32, b: i32) -> i32 {
    let ua = select(bitcast<u32>(a), 0u - bitcast<u32>(a), a < 0);
    let ub = select(bitcast<u32>(b), 0u - bitcast<u32>(b), b < 0);
    let value = (((ua & 65535u) * (ub & 65535u)) >> 16u) + (ua >> 16u) * (ub & 65535u) +
        (ua & 65535u) * (ub >> 16u) + (((ua >> 16u) * (ub >> 16u)) << 16u);
    return bitcast<i32>(select(value, 0u - value, (a < 0) != (b < 0)));
}
fn root(value: u32) -> u32 {
    var n = value; var result = 0u; var bit = 1073741824u;
    for (var i = 0u; i < 16u; i++) {
        if (n >= result + bit) { n -= result + bit; result = (result >> 1u) + bit; }
        else { result >>= 1u; }
        bit >>= 2u;
    }
    return result;
}
fn cm(value: i32) -> i32 { return (value / Q) * 100 + (value % Q) * 100 / Q; }
`;
