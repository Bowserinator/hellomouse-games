export const BALANCE = {
    barrierHp: 500,
    construction: {
        objective: 80, crane: [50, 80, 120], power: [2, 6, 18], hp: [300, 1500, 5000]
    },
    objective: { hp: 20000, money: 1, power: 20 },
    powerStorageBlast: { radius: 4, damage: 300 },
    stationaryDamagePct: 100,
    cooldownBarMinTicks: 11,
    targetSpread: 12,
    cwis: { hp: 1000, range: 40, cooldown: 4, maxIntercepts: 1 },
    giant: { percent: 3 },
    bomber: { hp: 60, speed: 8, range: 2, damage: 140, blastPct: 70, permille: 1 },
    explosionPushSpeed: 48,
    police: { hp: 60, speed: 6, range: 22, damage: 15, cooldown: 12 },
    sniper: { hp: 700, speed: 4, range: 150, cooldown: 200 },
    helicopter: { hp: 700, speed: 12, height: 10, range: 35, damage: 16, cooldown: 5 },
    steamroller: { hp: 5000, speed: 4, damage: 15, mass: 12 },
    tomahawk: { damage: 15000, radius: 15, flightTicks: 30, altitude: 250, tilt: 12, bearing: 215 },
    fireworks: { hp: 180, speed: 5, range: 35, damage: 65, cooldown: 60, percent: 5 },
    // Metres; the leash limits retreat from the closest approach to the objective.
    zombie: { pursuitRange: 6, pursuitLeash: 5 },
    water: { range: 20, mobileRange: 17, damage: 13, cooldown: 2, speed: 60, ttl: 6, splash: 2, hp: 1200,
        mobileHp: 300, moveSpeed: 5 },
    machineGun: { range: 25, mobileRange: 20, damage: 17, cooldown: 2, speed: 160, ttl: 6, hp: 1300,
        mobileHp: 400, moveSpeed: 4 },
    howitzer: { minRange: 15, range: 120, damage: 2200, cooldown: 400, speed: 30, ttl: 160,
        splash: 8, gravity: 10, launchDegrees: 60, hp: 3600 },
    gas: { minRange: 10, range: 90, damage: 80, cooldown: 40, speed: 45, ttl: 40,
        splash: 7, gravity: 6, duration: 100, dot: 2, slowPct: 50, hp: 2250 },
    tank: { range: 40, damage: 128, cooldown: 40, speed: 50, ttl: 20, splash: 4, gravity: 12,
        hp: 1500, moveSpeed: 2, turnRate: 512 },
    heavyTank: { hp: 7200, damage: 1750, cooldown: 100 },
    // Recharge counts down on the next tick; charge + recharge - 1 equals the firing duration.
    beam: { range: 50, damage: 30, radius: 0.5, cooldown: 1, charge: 10,
        duration: 90, arc: 8192, recharge: 81, turnRate: 256, hp: 6500 },
    mine: { trigger: 0.6, splash: 4, damage: 5000, armTicks: 100, hp: 300 },
    sonic: { radius: 12, hp: 250, power: 9000, largePower: 17000, drain: 1, rechargeTicks: 520, pushSpeed: 12 }
} as const;
