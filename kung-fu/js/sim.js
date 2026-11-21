// ============================================================================
// kung-fu/js/sim.js - Shadow Pagoda Deterministic 60Hz Beat-'Em-Up Simulation
//
// Pure fixed-timestep simulation with zero DOM/audio/canvas dependencies.
// Uses only shared/math.js (IEEE-754 deterministic trig/hypot) and
// shared/rng.js (Mulberry32 PRNG) so saved input playback is bit-identical
// across iOS, Android, Windows, and macOS.
// ============================================================================

var SIM_TICK_RATE      = 60;
var WORLD_VIEW_W       = 800;
var WORLD_VIEW_H       = 450;
var GROUND_Y           = 382;
var FLOOR_LENGTH       = 2400;

var GRAVITY            = 0.72;
var JUMP_VEL           = -14.2;
var PLAYER_SPEED       = 4.6;
var PLAYER_AIR_SPEED   = 4.2;
var PLAYER_MAX_HP      = 200;
var COUNTER_WINDOW      = 34;
var CHARGE_VISUAL_TICKS = 12;
var CHARGE_READY_TICKS  = 34;
var CHARGE_MAX_TICKS    = 62;
var STREAK_TIER1_HITS   = 5;
var STREAK_TIER2_HITS   = 10;
var COMBO_DECAY_TICKS   = 160;
var TURN_SPIN_WINDOW    = 12;
var SPIN_COOLDOWN_TICKS = 28;

var FIGHTERS = [
    {
        id: 'shadow',
        name: 'SHADOW RONIN',
        shortName: 'RONIN',
        tag: '3 Clones + Rasengan',
        headband: '#e62e25',
        accent: '#ff5247',
        tier1Name: 'TWIN CLONES',
        tier2Name: 'SHADOW ARMY',
        desc: '3+: 1 Clone • 5+: 2 Clones • 10+: 3 Kunai Clones + Shadow Rasengan'
    },
    {
        id: 'dragon',
        name: 'DRAGON FIST',
        shortName: 'DRAGON',
        tag: 'Inferno + Pillars',
        headband: '#ff9e1b',
        accent: '#ffd24c',
        tier1Name: 'INFERNO FISTS',
        tier2Name: 'FIRE DRAGON + PILLARS',
        desc: '5+ Hits: Flame Bursts & Ignite Burn • 10+: Fire-Dragon Upper, Pillars & Lava Dive'
    },
    {
        id: 'thunder',
        name: 'THUNDER MONK',
        shortName: 'THUNDER',
        tag: 'Sky Bolts + Storm',
        headband: '#38d9ff',
        accent: '#8ef4ff',
        tier1Name: 'CHAIN LIGHTNING',
        tier2Name: 'SKY THUNDERBOLTS',
        desc: '5+ Hits: Chain Lightning • 10+ Hits: Sky Thunderbolts & Triple Storm Ball'
    },
    {
        id: 'lotus',
        name: 'TIDE LOTUS',
        shortName: 'TIDE',
        tag: 'Water + Waves',
        headband: '#1ee6c8',
        accent: '#7df9ff',
        tier1Name: 'TIDAL ORBS',
        tier2Name: 'TIDAL WAVE',
        desc: '5+ Hits: Swirling Water Halo & Blades • 10+ Hits: 3 Blades & Surging Tidal Wave'
    },
    {
        id: 'gale',
        name: 'PHANTOM GALE',
        shortName: 'GALE',
        tag: 'Cyclones + Flash',
        headband: '#c66bff',
        accent: '#e2a8ff',
        tier1Name: 'SONIC FLASH',
        tier2Name: 'PINBALL BLITZ',
        desc: 'Fast Move • 3+/5+: Sonic Flash-Step & Wind Cyclones • 10+: Pinball Blitz'
    }
];

function getFighterSpec(id) {
    for (var i = 0; i < FIGHTERS.length; i++) {
        if (FIGHTERS[i].id === id) return FIGHTERS[i];
    }
    return FIGHTERS[0];
}

function getStreakTier(state) {
    if (!state) return 0;
    if (state.comboCount >= STREAK_TIER2_HITS) return 2;
    if (state.comboCount >= STREAK_TIER1_HITS) return 1;
    return 0;
}

var FLOOR_NAMES = [
    'CRIMSON COURTYARD',
    'BLOOD MOON HALL',
    'GOLDEN ECLIPSE SANCTUM'
];

var BOSS_NAMES = [
    'IRON ABBOT',
    'TWIN-BLADE RONIN',
    'CRIMSON GRANDMASTER'
];

// Encounter trigger X coordinates along each 2400px pagoda floor
var ZONE_TRIGGERS = [380, 1020, 1620, 2060];

// Attack specs: duration, activeStart, activeEnd, reach, dmg, knockX, knockY, hitstop
var PLAYER_MOVES = {
    attack1:      { dur: 16, start: 4, end: 9,  reach: 70,  dmg: 12, kx: 4.5,  ky: -1.5, stop: 2, lunge: 2.2 },
    attack2:      { dur: 19, start: 5, end: 11, reach: 84,  dmg: 16, kx: 6.2,  ky: -2.2, stop: 3, lunge: 3.4 },
    attack3:      { dur: 25, start: 7, end: 14, reach: 96,  dmg: 24, kx: 10.5, ky: -6.5, stop: 5, lunge: 4.8 },
    airkick:      { dur: 20, start: 3, end: 14, reach: 82,  dmg: 18, kx: 7.5,  ky: -3.0, stop: 3, lunge: 2.8 },
    counter:      { dur: 22, start: 3, end: 11, reach: 112, dmg: 32, kx: 12.0, ky: -6.0, stop: 6, lunge: 6.5 },
    spin:         { dur: 20, start: 2, end: 14, reach: 90,  dmg: 18, kx: 9.5,  ky: -4.2, stop: 3, lunge: 0.0, omni: true },
    dragon_upper: { dur: 24, start: 2, end: 14, reach: 102, dmg: 36, kx: 11.5, ky: -9.8, stop: 6, lunge: 5.0 },
    divekick:     { dur: 28, start: 2, end: 26, reach: 86,  dmg: 26, kx: 9.0,  ky: -4.0, stop: 4, lunge: 9.8 }
};

function allocEntityId(state) {
    var id = state.nextEntityId;
    state.nextEntityId = (state.nextEntityId + 1) >>> 0;
    return id;
}

function createPlayer(state, fighterId) {
    var spec = getFighterSpec(fighterId);
    var maxHp = (spec.id === 'gale') ? 175 : PLAYER_MAX_HP;
    return {
        id: allocEntityId(state),
        fighterId: spec.id,
        x: 160,
        y: GROUND_Y,
        vx: 0,
        vy: 0,
        facing: 1,
        onGround: true,
        hp: maxHp,
        maxHp: maxHp,
        alive: true,
        action: 'idle',
        actionTick: 0,
        actionDuration: 0,
        swingId: 0,
        comboStep: 0,
        comboWindow: 0,
        attackBuffer: 0,
        jumpBuffer: 0,
        turnWindow: 0,
        spinCooldown: 0,
        deflectHealCooldown: 0,
        subCooldown: 0,
        moveHitConnected: false,
        orbitAngle: 0,
        parryCounterTimer: 0,
        attackHeld: false,
        attackChargeTicks: 0,
        invulnTimer: 0,
        walkCycle: 0,
        flashTimer: 0
    };
}

function createSimState(setup) {
    var seed = (setup && typeof setup.seed === 'number') ? (setup.seed >>> 0) : 0x12345678;
    var viewW = (setup && setup.viewWidth) ? Math.round(setup.viewWidth) : WORLD_VIEW_W;
    var viewH = (setup && setup.viewHeight) ? Math.round(setup.viewHeight) : WORLD_VIEW_H;
    var tickRate = (setup && setup.tickRate) ? setup.tickRate : SIM_TICK_RATE;
    var fighterId = getFighterSpec(setup && setup.fighterId).id;

    var state = {
        setup: {
            seed: seed,
            viewWidth: viewW,
            viewHeight: viewH,
            tickRate: tickRate,
            fighterId: fighterId
        },
        tick: 0,
        rng: createRng(seed),
        nextEntityId: 1,
        score: 0,
        comboCount: 0,
        comboDecayTimer: 0,
        streakTier: 0,
        maxCombo: 0,
        parriesLanded: 0,
        enemiesDefeated: 0,
        floor: 1,
        zoneIndex: 0,           // 0..3 (3 = boss)
        zoneActive: false,
        zoneLockMinX: 0,
        zoneLockMaxX: FLOOR_LENGTH,
        pendingSpawns: [],      // delayed spawns within active wave
        bossSpawned: false,
        bossDefeated: false,
        floorClearTimer: 0,
        goPromptTimer: 0,
        trapCooldown: 95,
        cameraX: 0,
        hitstopTimer: 0,
        screenShake: 0,
        bannerText: 'FLOOR 1 • ' + FLOOR_NAMES[0],
        bannerTimer: 110,
        isGameOver: false,
        player: null,
        enemies: [],
        projectiles: [],
        traps: [],
        particles: [],
        slashes: [],
        callouts: [],
        afterimages: [],
        clones: [],
        bolts: [],
        flames: []
    };

    state.player = createPlayer(state, fighterId);
    // Spawn an opening duo immediately ahead so combat starts within 1.5 seconds!
    spawnEnemy(state, 'brawler', 560, -1);
    spawnEnemy(state, 'brawler', 700, -1);
    return state;
}

function cloneArrayOfFlatObjects(list) {
    var out = new Array(list.length);
    for (var i = 0; i < list.length; i++) {
        var src = list[i];
        var copy = {};
        var keys = Object.keys(src);
        for (var k = 0; k < keys.length; k++) {
            copy[keys[k]] = src[keys[k]];
        }
        out[i] = copy;
    }
    return out;
}

function cloneSimState(state) {
    var p = state.player;
    return {
        setup: {
            seed: state.setup.seed,
            viewWidth: state.setup.viewWidth,
            viewHeight: state.setup.viewHeight,
            tickRate: state.setup.tickRate,
            fighterId: state.setup.fighterId || 'shadow'
        },
        tick: state.tick,
        rng: cloneRng(state.rng),
        nextEntityId: state.nextEntityId,
        score: state.score,
        comboCount: state.comboCount,
        comboDecayTimer: state.comboDecayTimer,
        streakTier: state.streakTier || 0,
        maxCombo: state.maxCombo,
        parriesLanded: state.parriesLanded,
        enemiesDefeated: state.enemiesDefeated,
        floor: state.floor,
        zoneIndex: state.zoneIndex,
        zoneActive: state.zoneActive,
        zoneLockMinX: state.zoneLockMinX,
        zoneLockMaxX: state.zoneLockMaxX,
        pendingSpawns: cloneArrayOfFlatObjects(state.pendingSpawns),
        bossSpawned: state.bossSpawned,
        bossDefeated: state.bossDefeated,
        floorClearTimer: state.floorClearTimer,
        goPromptTimer: state.goPromptTimer,
        trapCooldown: state.trapCooldown,
        cameraX: state.cameraX,
        hitstopTimer: state.hitstopTimer,
        screenShake: state.screenShake,
        bannerText: state.bannerText,
        bannerTimer: state.bannerTimer,
        isGameOver: state.isGameOver,
        player: p ? {
            id: p.id, fighterId: p.fighterId || 'shadow',
            x: p.x, y: p.y, vx: p.vx, vy: p.vy,
            facing: p.facing, onGround: p.onGround,
            hp: p.hp, maxHp: p.maxHp, alive: p.alive,
            action: p.action, actionTick: p.actionTick, actionDuration: p.actionDuration,
            swingId: p.swingId, comboStep: p.comboStep, comboWindow: p.comboWindow,
            attackBuffer: p.attackBuffer, jumpBuffer: p.jumpBuffer,
            turnWindow: p.turnWindow || 0, spinCooldown: p.spinCooldown || 0,
            deflectHealCooldown: p.deflectHealCooldown || 0, subCooldown: p.subCooldown || 0,
            moveHitConnected: !!p.moveHitConnected, orbitAngle: p.orbitAngle || 0,
            parryCounterTimer: p.parryCounterTimer,
            attackHeld: p.attackHeld, attackChargeTicks: p.attackChargeTicks,
            invulnTimer: p.invulnTimer, walkCycle: p.walkCycle, flashTimer: p.flashTimer
        } : null,
        enemies: cloneArrayOfFlatObjects(state.enemies),
        projectiles: cloneArrayOfFlatObjects(state.projectiles),
        traps: cloneArrayOfFlatObjects(state.traps),
        particles: cloneArrayOfFlatObjects(state.particles),
        slashes: cloneArrayOfFlatObjects(state.slashes),
        callouts: cloneArrayOfFlatObjects(state.callouts),
        afterimages: cloneArrayOfFlatObjects(state.afterimages || []),
        clones: cloneArrayOfFlatObjects(state.clones || []),
        bolts: cloneArrayOfFlatObjects(state.bolts || []),
        flames: cloneArrayOfFlatObjects(state.flames || [])
    };
}

// ----------------------------------------------------------------------------
// Entity Spawners
// ----------------------------------------------------------------------------
function spawnEnemy(state, kind, x, facing) {
    var fScale = 1 + (state.floor - 1) * 0.18;
    var dmgScale = 1 + (state.floor - 1) * 0.14;
    var hp = 28;
    var speed = 2.35;
    var range = 56;
    var dmg = Math.round(10 * dmgScale);
    var scoreVal = 100;
    var scale = 1.0;

    if (kind === 'staff') {
        hp = Math.round(42 * fScale);
        speed = 2.05;
        range = 88;
        dmg = Math.round(15 * dmgScale);
        scoreVal = 180;
        scale = 1.05;
    } else if (kind === 'knife') {
        hp = Math.round(30 * fScale);
        speed = 2.45;
        range = 250;
        dmg = Math.round(11 * dmgScale);
        scoreVal = 200;
        scale = 0.96;
    } else if (kind === 'boss') {
        hp = Math.round(120 + (state.floor - 1) * 40);
        speed = 2.75;
        range = 86;
        dmg = Math.round(18 * dmgScale);
        scoreVal = 800 + state.floor * 200;
        scale = 1.24;
    } else {
        hp = Math.round(28 * fScale);
    }

    var e = {
        id: allocEntityId(state),
        kind: kind,
        x: x,
        y: GROUND_Y,
        vx: 0,
        vy: 0,
        facing: facing || -1,
        onGround: true,
        hp: hp,
        maxHp: hp,
        speed: speed,
        range: range,
        dmg: dmg,
        scoreVal: scoreVal,
        scale: scale,
        state: 'approach',  // 'approach', 'windup', 'attack', 'recover', 'stunned', 'hurt', 'leap'
        stateTick: 0,
        stateDur: 0,
        attackStyle: 'melee', // 'melee', 'throw', 'slam'
        cooldown: 22 + rngInt(state.rng, 0, 24),
        lastHitSwingId: -1,
        lastHitProjId: -1,
        lastHitTrapId: -1,
        lastHitBodyId: -1,
        lastOrbitHitTick: -999,
        lastFlameId: -1,
        burnTimer: 0,
        burnTick: 0,
        thrownTimer: 0,
        thrownId: -1,
        wallBounces: 0,
        enteredZone: false,
        didHitPlayer: false,
        walkCycle: rngRange(state.rng, 0, 6.28),
        flashTimer: 0
    };
    state.enemies.push(e);
    return e;
}

function spawnParticles(state, x, y, count, color, speedMin, speedMax, upwardBias) {
    for (var i = 0; i < count; i++) {
        if (state.particles.length >= 160) {
            state.particles.shift();
        }
        var ang = rngRange(state.rng, 0, DET_TWO_PI);
        var spd = rngRange(state.rng, speedMin, speedMax);
        state.particles.push({
            id: allocEntityId(state),
            x: x,
            y: y,
            vx: detCos(ang) * spd,
            vy: detSin(ang) * spd - (upwardBias || 0),
            size: rngRange(state.rng, 2.2, 5.8),
            color: color,
            life: rngInt(state.rng, 14, 30),
            maxLife: 30,
            kind: 'ink'
        });
    }
}

function spawnRingEffect(state, x, y, color, maxRadius) {
    if (state.particles.length >= 160) state.particles.shift();
    state.particles.push({
        id: allocEntityId(state),
        x: x,
        y: y,
        vx: 0,
        vy: 0,
        size: maxRadius || 58,
        color: color,
        life: 14,
        maxLife: 14,
        kind: 'ring'
    });
}

function spawnSlashArc(state, x, y, facing, style, color, element) {
    state.slashes.push({
        id: allocEntityId(state),
        x: x,
        y: y,
        facing: facing,
        style: style, // 'jab', 'kick', 'upper', 'air', 'counter', 'spin', 'enemy'
        color: color,
        element: element || null, // 'fire', 'lightning', 'water'
        age: 0,
        maxAge: (style === 'counter' || style === 'upper' || style === 'spin') ? 13 : 9
    });
}

function spawnFireZone(state, kind, x, radius, dmg, life) {
    if (!state.flames) state.flames = [];
    if (state.flames.length >= 12) state.flames.shift();
    state.flames.push({
        id: allocEntityId(state),
        kind: kind, // 'pillar', 'ground', or 'cyclone'
        x: x,
        y: GROUND_Y,
        radius: radius || 30,
        height: kind === 'pillar' ? 155 : (kind === 'cyclone' ? 118 : 34),
        dmg: dmg || 16,
        tickCount: 0,
        life: life || (kind === 'pillar' ? 28 : (kind === 'cyclone' ? 26 : 130)),
        maxLife: life || (kind === 'pillar' ? 28 : (kind === 'cyclone' ? 26 : 130))
    });
}

function triggerSkyThunderbolts(state, p, soundEvents) {
    // 2a Thunder Monk Tier 2: Call down vertical sky lightning bolts onto up to 2 nearby enemies!
    var candidates = [];
    for (var i = 0; i < state.enemies.length; i++) {
        var en = state.enemies[i];
        if (en.hp <= 0) continue;
        var dist = Math.abs(en.x - p.x);
        if (dist <= 360) {
            candidates.push({ enemy: en, dist: dist });
        }
    }
    candidates.sort(function (a, b) { return a.dist - b.dist; });
    var count = Math.min(2, candidates.length);
    if (count === 0) {
        // Dramatic sky flash ahead even if solo!
        var fx = p.x + p.facing * 95;
        state.bolts.push({
            id: allocEntityId(state),
            x1: fx, y1: -10, x2: fx, y2: GROUND_Y,
            color: '#8ef4ff', isSky: true, life: 16, maxLife: 16
        });
        spawnRingEffect(state, fx, GROUND_Y - 6, '#38d9ff', 64);
        soundEvents.push('zap');
        return;
    }
    for (var k = 0; k < count; k++) {
        var target = candidates[k].enemy;
        if (target.hp <= 0) continue;
        state.bolts.push({
            id: allocEntityId(state),
            x1: target.x, y1: -10, x2: target.x, y2: target.y,
            color: '#8ef4ff', isSky: true, life: 16, maxLife: 16
        });
        spawnRingEffect(state, target.x, GROUND_Y - 6, '#38d9ff', 72);
        spawnParticles(state, target.x, target.y - 44 * target.scale, 10, '#8ef4ff', 1.8, 6.0, 1.5);
        var dir = target.x >= p.x ? 1 : -1;
        damageEnemy(state, target, 18, dir * 5.0, -5.8, 0, true, soundEvents, false);
    }
    state.screenShake = Math.max(state.screenShake, 5.5);
    soundEvents.push('zap');
    for (var r = state.enemies.length - 1; r >= 0; r--) {
        if (state.enemies[r].hp <= 0) state.enemies.splice(r, 1);
    }
}

function spawnTidalWave(state, p, isOmni) {
    var dirs = isOmni ? [-1, 1] : [p.facing];
    for (var i = 0; i < dirs.length; i++) {
        state.projectiles.push({
            id: allocEntityId(state),
            kind: 'tidal_wave',
            x: p.x + dirs[i] * 30,
            y: GROUND_Y - 34,
            vx: dirs[i] * 9.0,
            vy: 0,
            owner: 'player',
            damage: 20,
            radius: 34,
            hitsLeft: 4,
            spin: 0,
            life: 52
        });
    }
}

function spawnCallout(state, x, y, text, color) {
    state.callouts.push({
        id: allocEntityId(state),
        x: x,
        y: y,
        vy: -1.15,
        text: text,
        color: color,
        life: 38,
        maxLife: 38
    });
}

function spawnTrap(state, kind) {
    var leftEdge = Math.max(20, state.cameraX - 30);
    var rightEdge = Math.min(FLOOR_LENGTH - 20, state.cameraX + state.setup.viewWidth + 30);
    if (kind === 'barrel') {
        var fromRight = rngInt(state.rng, 0, 2) === 0 || state.player.x < state.cameraX + 260;
        state.traps.push({
            id: allocEntityId(state),
            kind: 'barrel',
            owner: 'env',
            x: fromRight ? rightEdge : leftEdge,
            y: GROUND_Y,
            vx: fromRight ? -4.2 : 4.2,
            vy: 0,
            gravity: 0,
            angle: 0,
            telegraph: 0,
            active: true,
            hitsLeft: 4,
            bounced: 0,
            life: 260
        });
    } else {
        // Falling roof tile with 42-tick ground ink-ring telegraph!
        var targetX = state.player.x + rngRange(state.rng, -55, 55);
        var minX = state.cameraX + 60;
        var maxX = state.cameraX + state.setup.viewWidth - 60;
        if (targetX < minX) targetX = minX;
        if (targetX > maxX) targetX = maxX;
        state.traps.push({
            id: allocEntityId(state),
            kind: 'tile',
            owner: 'env',
            x: targetX,
            y: 10,
            vx: 0,
            vy: 0,
            gravity: 0.28,
            angle: rngRange(state.rng, -0.3, 0.3),
            telegraph: 24,
            active: true,
            bounced: 0,
            damage: 28,
            life: 160
        });
    }
}

// ----------------------------------------------------------------------------
// Encounter Waves & Floor Advancement
// ----------------------------------------------------------------------------
function triggerZoneEncounter(state, zIdx, soundEvents) {
    state.zoneActive = true;
    state.zoneLockMinX = Math.max(0, state.cameraX);
    state.zoneLockMaxX = Math.min(FLOOR_LENGTH, state.zoneLockMinX + state.setup.viewWidth);

    var leftSpawn = Math.max(24, state.zoneLockMinX - 36);
    var rightSpawn = Math.min(FLOOR_LENGTH - 24, state.zoneLockMaxX + 36);
    var f = state.floor;

    if (zIdx < 3) {
        // Standard temple waves: escalating mix of brawlers, staff monks, knife-throwers
        var waveCount = 3 + zIdx + Math.min(3, f - 1);
        for (var i = 0; i < waveCount; i++) {
            var sideRight = (i % 2 === 0);
            var roll = rngNextFloat(state.rng);
            var kind = 'brawler';
            if (zIdx >= 1 && roll > 0.68) kind = 'knife';
            else if (roll > 0.40) kind = 'staff';

            var delay = i * 32;
            if (delay === 0) {
                spawnEnemy(state, kind, sideRight ? rightSpawn : leftSpawn, sideRight ? -1 : 1);
            } else {
                state.pendingSpawns.push({
                    delay: delay,
                    kind: kind,
                    x: sideRight ? rightSpawn : leftSpawn,
                    facing: sideRight ? -1 : 1
                });
            }
        }
    } else {
        // Floor Boss!
        state.bossSpawned = true;
        var bossName = BOSS_NAMES[(state.floor - 1) % BOSS_NAMES.length];
        state.bannerText = 'BOSS • ' + bossName;
        state.bannerTimer = 110;
        soundEvents.push('boss_warn');
        spawnEnemy(state, 'boss', rightSpawn - 40, -1);
        // One escort grunt on floor 2+
        if (state.floor >= 2) {
            state.pendingSpawns.push({
                delay: 90,
                kind: 'knife',
                x: leftSpawn,
                facing: 1
            });
        }
    }
}

function advanceToNextFloor(state, soundEvents) {
    state.floor += 1;
    state.zoneIndex = 0;
    state.zoneActive = false;
    state.zoneLockMinX = 0;
    state.zoneLockMaxX = FLOOR_LENGTH;
    state.pendingSpawns = [];
    state.bossSpawned = false;
    state.bossDefeated = false;
    state.floorClearTimer = 0;
    state.goPromptTimer = 0;
    state.trapCooldown = 140;
    state.cameraX = 0;
    state.enemies = [];
    state.projectiles = [];
    state.traps = [];
    state.slashes = [];
    state.afterimages = [];
    state.clones = [];
    state.bolts = [];
    state.flames = [];

    var p = state.player;
    p.x = 150;
    p.y = GROUND_Y;
    p.vx = 0;
    p.vy = 0;
    p.facing = 1;
    p.onGround = true;
    p.hp = Math.min(p.maxHp, p.hp + 50);
    p.action = 'idle';
    p.actionTick = 0;
    p.actionDuration = 0;
    p.turnWindow = 0;
    p.spinCooldown = 0;
    p.moveHitConnected = false;
    p.attackHeld = false;
    p.attackChargeTicks = 0;
    p.invulnTimer = 30;

    var fName = FLOOR_NAMES[(state.floor - 1) % FLOOR_NAMES.length];
    state.bannerText = 'FLOOR ' + state.floor + ' • ' + fName;
    state.bannerTimer = 115;
    soundEvents.push('floor_up');

    spawnEnemy(state, 'brawler', 560, -1);
    spawnEnemy(state, 'staff', 710, -1);
}

// ----------------------------------------------------------------------------
// Combat Helpers (Jump-Cancel, Attacks, 360° Spin, Fighter Streak Skills)
// ----------------------------------------------------------------------------
function performPlayerJump(state, p, left, right, soundEvents) {
    p.jumpBuffer = 0;
    p.attackBuffer = 0;
    p.vy = JUMP_VEL;
    p.onGround = false;
    p.action = 'jump';
    p.actionTick = 0;
    p.actionDuration = 0;
    p.moveHitConnected = false;
    if (left && !right) {
        p.facing = -1;
        p.vx = -PLAYER_AIR_SPEED;
    } else if (right && !left) {
        p.facing = 1;
        p.vx = PLAYER_AIR_SPEED;
    }
    spawnParticles(state, p.x, GROUND_Y, 5, '#332b24', 0.8, 2.6, 0.8);
    soundEvents.push('jump');
}

function spawnCrescentWave(state, p, color) {
    state.projectiles.push({
        id: allocEntityId(state),
        kind: 'crescent',
        x: p.x + p.facing * 32,
        y: p.y - 46,
        vx: p.facing * 12.2,
        vy: 0,
        owner: 'player',
        damage: 24,
        radius: 24,
        hitsLeft: 4,
        color: color || '#ff5247',
        spin: 0,
        life: 44
    });
}

function spawnJadeBladeFan(state, p, isOmni) {
    var vys = [-2.4, 0, 2.4];
    if (isOmni) {
        var dirs = [-1, 1];
        for (var d = 0; d < dirs.length; d++) {
            for (var v = 0; v < 2; v++) {
                state.projectiles.push({
                    id: allocEntityId(state),
                    kind: 'jade_blade',
                    x: p.x + dirs[d] * 24,
                    y: p.y - 46,
                    vx: dirs[d] * 10.6,
                    vy: v === 0 ? -1.8 : 1.8,
                    owner: 'player',
                    damage: 18,
                    radius: 14,
                    hitsLeft: 2,
                    spin: 0,
                    life: 48
                });
            }
        }
        return;
    }
    for (var i = 0; i < vys.length; i++) {
        state.projectiles.push({
            id: allocEntityId(state),
            kind: 'jade_blade',
            x: p.x + p.facing * 26,
            y: p.y - 46,
            vx: p.facing * 11.2,
            vy: vys[i],
            owner: 'player',
            damage: 20,
            radius: 14,
            hitsLeft: 2,
            spin: 0,
            life: 52
        });
    }
}

function triggerChainLightning(state, struckEnemies, tier, soundEvents) {
    if (!struckEnemies || struckEnemies.length === 0) return;
    var dmg = tier >= 2 ? 16 : 12;
    var zappedAny = false;
    for (var s = 0; s < struckEnemies.length; s++) {
        var src = struckEnemies[s];
        var candidates = [];
        for (var i = 0; i < state.enemies.length; i++) {
            var cand = state.enemies[i];
            if (cand.id === src.id || cand.hp <= 0) continue;
            var dist = Math.abs(cand.x - src.x);
            if (dist <= 220) {
                candidates.push({ enemy: cand, dist: dist });
            }
        }
        candidates.sort(function (a, b) { return a.dist - b.dist; });
        var limit = Math.min(2, candidates.length);
        for (var k = 0; k < limit; k++) {
            var target = candidates[k].enemy;
            if (target.hp <= 0) continue;
            var dir = target.x >= src.x ? 1 : -1;
            state.bolts.push({
                id: allocEntityId(state),
                x1: src.x,
                y1: src.y - 46 * (src.scale || 1),
                x2: target.x,
                y2: target.y - 46 * (target.scale || 1),
                color: '#8ef4ff',
                life: 12,
                maxLife: 12
            });
            damageEnemy(state, target, dmg, dir * 4.5, -2.2, 0, false, soundEvents, false);
            zappedAny = true;
        }
    }
    if (zappedAny) {
        soundEvents.push('zap');
        for (var r = state.enemies.length - 1; r >= 0; r--) {
            if (state.enemies[r].hp <= 0) {
                state.enemies.splice(r, 1);
            }
        }
    }
}

function startPlayerAttack(state, p, soundEvents, forceMove) {
    var tier = getStreakTier(state);
    var fId = p.fighterId || 'shadow';
    var fighter = getFighterSpec(fId);
    var moveName;

    if (forceMove === 'spin') {
        moveName = 'spin';
        p.spinCooldown = SPIN_COOLDOWN_TICKS;
        p.turnWindow = 0;
        p.comboStep = 0;
        p.comboWindow = 0;
    } else if (!p.onGround) {
        moveName = (fId === 'dragon' && tier >= 2) ? 'divekick' : 'airkick';
        p.comboStep = 0;
        p.comboWindow = 0;
    } else if (p.parryCounterTimer > 0) {
        moveName = 'counter';
        p.parryCounterTimer = 0;
        p.comboStep = 0;
        p.comboWindow = 0;
    } else if (p.comboWindow > 0 && p.comboStep === 1) {
        moveName = 'attack2';
        p.comboStep = 2;
        p.comboWindow = 28;
    } else if (p.comboWindow > 0 && p.comboStep === 2) {
        moveName = (fId === 'dragon' && tier >= 2) ? 'dragon_upper' : 'attack3';
        p.comboStep = 0;
        p.comboWindow = 0;
    } else {
        moveName = 'attack1';
        p.comboStep = 1;
        p.comboWindow = 28;
    }

    var spec = PLAYER_MOVES[moveName];
    var dur = spec.dur;
    if (fId === 'dragon' && tier >= 1 && moveName !== 'divekick') {
        dur = Math.max(10, Math.round(dur * 0.80));
    } else if (fId === 'gale' && moveName !== 'spin') {
        // Phantom Gale: naturally quicker, snappier strikes right from 0 hits!
        dur = Math.max(10, Math.round(dur * (tier >= 1 ? 0.84 : 0.90)));
    }

    p.action = moveName;
    p.actionTick = 0;
    p.actionDuration = dur;
    p.moveHitConnected = false;
    p.swingId = (p.swingId + 1) >>> 0;

    var isGaleFlash = (fId === 'gale') && (
        (tier >= 1 && (moveName === 'attack2' || moveName === 'attack3' || moveName === 'counter')) ||
        (state.comboCount >= 3 && (moveName === 'attack3' || moveName === 'counter'))
    );

    if (moveName === 'dragon_upper') {
        p.vx = p.facing * spec.lunge;
        p.vy = -12.2;
        p.onGround = false;
        spawnRingEffect(state, p.x, p.y - 30, '#ff9e1b', 72);
        spawnParticles(state, p.x, p.y - 30, 14, '#ff9e1b', 2.0, 6.8, 2.4);
        spawnCallout(state, p.x, p.y - 92, 'DRAGON UPPER!', '#ffd24c');
    } else if (moveName === 'divekick') {
        p.vx = p.facing * spec.lunge;
        p.vy = 11.2;
        spawnParticles(state, p.x, p.y - 36, 10, '#ff9e1b', 1.5, 5.2, 0.5);
    } else if (moveName === 'spin') {
        p.vx = 0;
        spawnRingEffect(state, p.x, p.y - 44, tier >= 1 ? fighter.accent : '#ffb830', 84);
        spawnParticles(state, p.x, p.y - 44, 12, tier >= 1 ? fighter.accent : '#ffd24c', 2.2, 6.2, 0.6);
    } else if (isGaleFlash) {
        // 4a Phantom Gale Sonic Flash-Step + Razor Wind Cyclone along the dash path!
        var isComboMid = (moveName === 'attack2');
        var dashSpd = isComboMid ? 11.8 : (tier >= 2 ? 16.0 : 14.5);
        var dashInvuln = isComboMid ? 4 : (tier >= 2 ? 6 : 5);
        p.invulnTimer = Math.max(p.invulnTimer, dashInvuln);
        p.vx = p.facing * dashSpd;
        // Double sonic-boom ring behind Gale + swirling wind cyclone!
        spawnRingEffect(state, p.x - p.facing * 12, p.y - 46, '#ffffff', isComboMid ? 44 : 62);
        spawnRingEffect(state, p.x, p.y - 46, '#c66bff', isComboMid ? 56 : 82);
        spawnParticles(state, p.x, p.y - 46, isComboMid ? 10 : 15, '#e2a8ff', 2.2, 7.0, 0.8);
        spawnFireZone(state, 'cyclone', p.x + p.facing * 20, isComboMid ? 24 : 30, isComboMid ? 10 : 14, 26);
        if (!isComboMid) {
            spawnCallout(state, p.x, p.y - 88, 'SONIC FLASH!', '#e2a8ff');
        }
        soundEvents.push('dash');
        if (state.afterimages.length >= 8) state.afterimages.shift();
        state.afterimages.push({
            id: allocEntityId(state),
            x: p.x, y: p.y, facing: p.facing, pose: moveName,
            color: '#c66bff', life: 12, maxLife: 12
        });
    } else {
        p.vx = p.facing * spec.lunge;
        if (moveName === 'airkick') {
            p.vy = Math.min(p.vy, 1.5);
        }
    }

    // Dragon Fist: always-on flame embers -> Tier 1 flame bursts -> Tier 2 erupting Fire Pillars!
    if (fId === 'dragon') {
        spawnParticles(state, p.x + p.facing * 26, p.y - 46, tier >= 1 ? 10 : 4, '#ff6a1a', 1.6, 5.4, 1.0);
        if (tier >= 1) {
            spawnParticles(state, p.x + p.facing * 42, p.y - 46, 6, '#ffd24c', 1.8, 5.6, 0.8);
        }
        if (tier >= 2 && (moveName === 'dragon_upper' || moveName === 'attack3' || moveName === 'counter')) {
            spawnFireZone(state, 'pillar', p.x + p.facing * 58, 30, 18, 28);
            soundEvents.push('flame');
        } else if (tier >= 2 && moveName === 'spin') {
            spawnFireZone(state, 'pillar', p.x - 58, 26, 15, 24);
            spawnFireZone(state, 'pillar', p.x + 58, 26, 15, 24);
            soundEvents.push('flame');
        }
    }

    // Tide Lotus: always-on water spray -> Tier 2 Jade Blade Fan + Surging Tidal Wave!
    if (fId === 'lotus') {
        spawnParticles(state, p.x + p.facing * 24, p.y - 46, tier >= 1 ? 8 : 4, '#7df9ff', 1.4, 4.8, 1.0);
        if (tier >= 2 && (moveName === 'attack3' || moveName === 'counter' || moveName === 'spin')) {
            spawnJadeBladeFan(state, p, moveName === 'spin');
            spawnTidalWave(state, p, moveName === 'spin');
            soundEvents.push('splash');
        }
    }

    // Thunder Monk: crackling lightning sparks on every swing + 2a Sky Thunderbolts at Tier 2!
    if (fId === 'thunder') {
        spawnParticles(state, p.x + p.facing * 26, p.y - 46, tier >= 1 ? 8 : 4, '#8ef4ff', 1.6, 5.2, 0.5);
        if (tier >= 2 && (moveName === 'attack3' || moveName === 'counter' || moveName === 'spin')) {
            triggerSkyThunderbolts(state, p, soundEvents);
        }
    }

    var slashStyle = moveName === 'spin' ? 'spin'
        : moveName === 'attack1' ? 'jab'
        : moveName === 'attack2' ? 'kick'
        : (moveName === 'attack3' || moveName === 'dragon_upper') ? 'upper'
        : (moveName === 'airkick' || moveName === 'divekick') ? 'air'
        : 'counter';
    var slashElement = fId === 'dragon' ? 'fire'
        : (fId === 'thunder' ? 'lightning' : (fId === 'lotus' ? 'water' : null));
    var slashColor = (fId === 'dragon') ? '#ff6a1a'
        : (fId === 'thunder') ? '#38d9ff'
        : (fId === 'lotus') ? '#1ee6c8'
        : ((moveName === 'counter' || moveName === 'attack3' || moveName === 'dragon_upper' || moveName === 'divekick')
            ? '#ffb830'
            : (tier >= 1 ? fighter.accent : '#d92828'));
    var slashX = (moveName === 'spin') ? p.x : (p.x + p.facing * 24);
    spawnSlashArc(state, slashX, p.y - 46, p.facing, slashStyle, slashColor, slashElement);

    if (moveName === 'spin') {
        soundEvents.push('spin');
    } else {
        soundEvents.push((moveName === 'counter' || moveName === 'attack3' || moveName === 'dragon_upper' || moveName === 'divekick') ? 'heavy_swing' : 'swing');
    }
}

function startPlayerHadouken(state, p, chargeTicks, soundEvents) {
    var isMax = chargeTicks >= CHARGE_MAX_TICKS;
    var power = isMax ? 2 : 1;
    var radius = isMax ? 25 : 18;
    var speed = isMax ? 10.6 : 8.8;
    var damage = isMax ? 54 : 34;
    var hitsLeft = isMax ? 4 : 2;
    var isStorm = (p.fighterId === 'thunder' && getStreakTier(state) >= 2);
    var isFire = (p.fighterId === 'dragon');
    var isWater = (p.fighterId === 'lotus');
    var isRasengan = (p.fighterId === 'shadow');

    p.action = 'hadouken';
    p.actionTick = 0;
    p.actionDuration = 18;
    p.comboStep = 0;
    p.comboWindow = 0;
    p.attackBuffer = 0;
    p.moveHitConnected = false;
    p.vx = -p.facing * (isMax ? 3.2 : 2.0);
    if (!p.onGround) {
        p.vy = Math.min(p.vy, 1.0);
    }

    var spawnX = p.x + p.facing * 36;
    var spawnY = p.y - 46;
    state.projectiles.push({
        id: allocEntityId(state),
        kind: 'fireball',
        isFire: isFire,
        isWater: isWater,
        isRasengan: isRasengan,
        x: spawnX,
        y: spawnY,
        vx: p.facing * speed,
        vy: 0,
        owner: 'player',
        damage: damage,
        radius: isRasengan ? (radius + 3) : radius,
        power: power,
        hitsLeft: hitsLeft,
        spin: 0,
        life: 110
    });

    // Thunder Monk Tier 2: Twin Storm Spread spheres flanking the main Power Ball!
    if (isStorm) {
        var spreadVys = [-2.5, 2.5];
        for (var sv = 0; sv < spreadVys.length; sv++) {
            state.projectiles.push({
                id: allocEntityId(state),
                kind: 'fireball',
                x: spawnX,
                y: spawnY,
                vx: p.facing * (speed * 0.94),
                vy: spreadVys[sv],
                gravity: 0.04,
                bounceFloor: true,
                owner: 'player',
                damage: isMax ? 32 : 22,
                radius: isMax ? 17 : 13,
                power: power,
                hitsLeft: 2,
                spin: 0,
                life: 95
            });
        }
    }

    var color = isFire ? (isMax ? '#ffd24c' : '#ff6a1a')
        : (isWater ? '#1ee6c8'
        : (isRasengan ? (isMax ? '#ff5247' : '#ff7b72')
        : (isMax ? '#ffd24c' : '#38d9ff')));
    spawnRingEffect(state, spawnX, spawnY, color, isMax ? 78 : 54);
    spawnParticles(state, spawnX, spawnY, isMax ? 18 : 11, color, 2.2, 7.2, 0.8);
    spawnParticles(state, spawnX, spawnY, 6, isRasengan ? '#111111' : '#ffffff', 1.5, 4.5, 0.4);
    var label = isStorm ? 'STORM HADOU!'
        : (isFire ? (isMax ? 'INFERNO BALL!' : 'DRAGON FIRE!')
        : (isWater ? (isMax ? 'TSUNAMI ORB!' : 'TIDAL ORB!')
        : (isRasengan ? (isMax ? 'GIANT RASENGAN!' : 'RASENGAN!')
        : (isMax ? 'SUPER HADOU!' : 'HADOU!'))));
    spawnCallout(state, p.x + p.facing * 12, p.y - 86, label, color);
    state.screenShake = Math.max(state.screenShake, isMax ? 7.5 : 4.2);
    soundEvents.push(isFire ? 'flame' : (isMax || isStorm ? 'super_fireball' : 'fireball'));
}

function damageEnemy(state, e, dmg, kx, ky, stopTicks, fromCounter, soundEvents, canLaunch) {
    e.hp -= dmg;
    e.flashTimer = 8;
    e.vx = kx;
    e.vy = ky;
    if (ky < 0) e.onGround = false;

    // Increment combo & score + check live streak tier thresholds (5+ / 10+ hits)
    var prevTier = state.streakTier || 0;
    state.comboCount += 1;
    state.comboDecayTimer = COMBO_DECAY_TICKS;
    if (state.comboCount > state.maxCombo) state.maxCombo = state.comboCount;
    var newTier = getStreakTier(state);
    state.streakTier = newTier;
    if (newTier > prevTier && state.player) {
        var fSpec = getFighterSpec(state.player.fighterId);
        var tierLabel = (newTier >= 2) ? (fSpec.tier2Name + '!') : (fSpec.tier1Name + '!');
        spawnRingEffect(state, state.player.x, state.player.y - 44, fSpec.accent, newTier >= 2 ? 92 : 68);
        spawnParticles(state, state.player.x, state.player.y - 44, newTier >= 2 ? 18 : 12, fSpec.accent, 2.0, 6.4, 1.2);
        spawnCallout(state, state.player.x, state.player.y - 96, tierLabel, fSpec.accent);
        soundEvents.push(newTier >= 2 ? 'powerup_tier2' : 'powerup_tier1');
    }

    var mult = 1 + Math.min(4, Math.floor(state.comboCount / 3));
    state.score += Math.round(dmg * 2 * mult);

    var hitX = e.x;
    var hitY = e.y - 46 * e.scale;
    spawnParticles(state, hitX, hitY, fromCounter ? 16 : 9, fromCounter ? '#ffb830' : '#d92828', 2.0, 6.5, 1.2);
    spawnParticles(state, hitX, hitY, 5, '#111111', 1.2, 4.5, 0.8);

    if (fromCounter) {
        spawnRingEffect(state, hitX, hitY, '#ffb830', 68);
        spawnCallout(state, hitX, hitY - 22, 'COUNTER!', '#ffb830');
    } else if (state.comboCount >= 3 && state.comboCount % 3 === 0) {
        spawnCallout(state, hitX, hitY - 22, state.comboCount + ' HIT!', '#ffcf5c');
    }

    if (stopTicks > state.hitstopTimer) state.hitstopTimer = stopTicks;
    state.screenShake = Math.max(state.screenShake, fromCounter ? 8.5 : (stopTicks >= 4 ? 6.0 : 3.0));

    if (e.hp <= 0) {
        state.enemiesDefeated += 1;
        state.score += e.scoreVal * mult;
        spawnParticles(state, hitX, hitY, 18, '#111111', 2.0, 7.5, 2.5);
        spawnParticles(state, hitX, hitY, 10, '#d92828', 1.5, 5.5, 1.5);
        spawnCallout(state, hitX, hitY - 30, e.kind === 'boss' ? 'MASTER DEFEATED!' : 'KO!', '#e83828');
        soundEvents.push(e.kind === 'boss' ? 'boss_ko' : 'ko');
        // Launch KO'd regular enemies tumbling at chest height across the screen so they bowl into other enemies & barrels!
        if (e.kind !== 'boss' && canLaunch !== false && Math.abs(kx) >= 4.0) {
            var koDir = kx >= 0 ? 1 : -1;
            state.projectiles.push({
                id: allocEntityId(state),
                kind: 'ko_body',
                enemyKind: e.kind,
                scale: e.scale,
                x: e.x,
                y: e.y - 42 * e.scale,
                vx: koDir * Math.max(12.2, Math.abs(kx) * 1.15),
                vy: -3.2,
                gravity: 0.24,
                owner: 'player',
                damage: 26,
                hitsLeft: 3,
                wallBounces: 0,
                spin: 0,
                life: 55
            });
        }
        if (e.kind === 'boss') {
            state.hitstopTimer = 10;
            state.screenShake = 11;
            state.bossDefeated = true;
            state.floorClearTimer = 95;
            state.score += 500 * state.floor;
            state.bannerText = 'FLOOR ' + state.floor + ' CLEAR!';
            state.bannerTimer = 95;
        }
        return true; // defeated
    } else {
        // Heavy kick/finisher/counter launches living regular enemies at chest height into other enemies behind them!
        if (canLaunch === true && e.kind !== 'boss') {
            var launchDir = kx >= 0 ? 1 : -1;
            e.state = 'thrown';
            e.stateTick = 0;
            e.stateDur = 28;
            e.thrownTimer = 28;
            e.thrownId = allocEntityId(state);
            e.wallBounces = 0;
            e.vx = launchDir * Math.max(12.6, Math.abs(kx) * 1.15);
            e.vy = -3.4;
            e.onGround = false;
            spawnCallout(state, hitX, hitY - 36, 'LAUNCH!', '#ffb830');
        } else if (!(e.kind === 'boss' && e.state === 'leap')) {
            // Bosses resist brief hitstun during their leaping slam
            e.state = 'hurt';
            e.stateTick = 0;
            e.stateDur = e.kind === 'boss' ? 14 : 20;
        }
        soundEvents.push(fromCounter || stopTicks >= 4 ? 'heavy_hit' : 'hit');
        return false;
    }
}

// Applies an incoming attack/projectile/trap hit to the player
function hitPlayer(state, dmg, knockDir, attackerEnemy, isProjectile, soundEvents) {
    var p = state.player;
    if (!p || !p.alive || p.invulnTimer > 0) return 'ignored';

    // Shadow Ronin Substitution Jutsu: sacrifice 1 clone to dodge a hit when 2+ clones are active!
    if ((p.fighterId || 'shadow') === 'shadow' && state.clones && state.clones.length >= 2 && (p.subCooldown || 0) <= 0) {
        var sac = state.clones.pop();
        spawnRingEffect(state, sac.x, sac.y - 42, '#f2ede2', 66);
        spawnParticles(state, sac.x, sac.y - 42, 14, '#f2ede2', 1.6, 5.2, 1.4);
        spawnParticles(state, p.x, p.y - 44, 12, '#f2ede2', 1.6, 5.2, 1.4);
        spawnCallout(state, p.x, p.y - 86, 'SUBSTITUTION!', '#f2ede2');
        p.invulnTimer = 24;
        p.subCooldown = 360;
        p.vx = knockDir * 6.5;
        state.comboCount = Math.max(3, state.comboCount - 5);
        state.streakTier = getStreakTier(state);
        state.comboDecayTimer = COMBO_DECAY_TICKS;
        soundEvents.push('dash');
        return 'ignored';
    }

    // Direct Hit
    p.hp -= dmg;
    p.flashTimer = 10;
    p.vx = knockDir * 5.8;
    p.vy = -3.8;
    p.onGround = false;
    p.comboStep = 0;
    p.comboWindow = 0;
    p.parryCounterTimer = 0;
    p.attackChargeTicks = 0;
    p.moveHitConnected = false;
    state.comboCount = 0;
    state.comboDecayTimer = 0;
    state.streakTier = 0;
    state.screenShake = 7.0;
    state.hitstopTimer = 3;

    spawnParticles(state, p.x, p.y - 44, 10, '#d92828', 2.0, 5.5, 1.2);

    if (p.hp <= 0) {
        p.hp = 0;
        p.alive = false;
        p.action = 'ko';
        p.actionTick = 0;
        p.actionDuration = 999;
        state.isGameOver = true;
        soundEvents.push('player_ko');
    } else {
        p.action = 'hurt';
        p.actionTick = 0;
        p.actionDuration = 18;
        p.invulnTimer = 34;
        soundEvents.push('player_hit');
    }
    return 'hit';
}

function isPlayerAttackSwinging(p) {
    if (!p || !p.alive) return false;
    var spec = PLAYER_MOVES[p.action];
    if (!spec) return false;
    return p.actionTick <= spec.end + 1;
}

function tryDeflectProjectileWithSwing(state, p, pr, prevX, soundEvents) {
    var spec = PLAYER_MOVES[p.action];
    if (!spec) return false;

    var isOmni = !!spec.omni;
    var reach = spec.reach + 20;
    var swingMinX = isOmni ? (p.x - reach) : (p.facing > 0 ? (p.x - 16) : (p.x - reach));
    var swingMaxX = isOmni ? (p.x + reach) : (p.facing > 0 ? (p.x + reach) : (p.x + 16));
    var segMinX = Math.min(prevX, pr.x) - 10;
    var segMaxX = Math.max(prevX, pr.x) + 10;

    if (segMaxX < swingMinX || segMinX > swingMaxX || pr.y < p.y - 98 || pr.y > p.y + 12) {
        return false;
    }

    // Determine deflection direction & outcome from timing & where along the swing arc the star hit
    var defDir = isOmni ? (pr.x >= p.x ? 1 : -1) : p.facing;
    var relX = (pr.x - p.x) * defDir;
    var isHeavyMove = (p.action === 'attack3' || p.action === 'counter' || p.action === 'dragon_upper' || isOmni);
    var isEarlyTip = !isHeavyMove && relX > 62;
    var isSweetSpot = isHeavyMove ||
        (p.actionTick >= Math.max(1, spec.start - 2) && p.actionTick <= spec.start + 3 && relX >= 20 && relX <= 62) ||
        (relX >= 26 && relX <= 54);

    pr.owner = 'player';
    pr.bounced = false;
    state.parriesLanded += 1;

    if (isSweetSpot) {
        // Crisp sweet-spot timing: send the star rocketing right back at the ninja who threw it!
        var targetEnemy = null;
        if (pr.sourceEnemyId) {
            for (var si = 0; si < state.enemies.length; si++) {
                if (state.enemies[si].id === pr.sourceEnemyId) {
                    targetEnemy = state.enemies[si];
                    break;
                }
            }
        }
        if (!targetEnemy) {
            var bestDist = 999999;
            for (var fi = 0; fi < state.enemies.length; fi++) {
                var cand = state.enemies[fi];
                var cdx = (cand.x - pr.x) * defDir;
                if (cdx > 0 && cdx < bestDist) {
                    bestDist = cdx;
                    targetEnemy = cand;
                }
            }
        }

        var retSpeed = Math.max(10.5, Math.abs(pr.vx) * 1.65);
        if (targetEnemy) {
            var rdx = targetEnemy.x - pr.x;
            var rdy = (targetEnemy.y - 46 * targetEnemy.scale) - pr.y;
            var rDist = detHypot(rdx, rdy);
            if (rDist > 1e-4) {
                pr.vx = (rdx / rDist) * retSpeed;
                pr.vy = (rdy / rDist) * retSpeed;
            } else {
                pr.vx = defDir * retSpeed;
                pr.vy = 0;
            }
        } else {
            pr.vx = defDir * retSpeed;
            pr.vy = 0;
        }
        pr.gravity = 0;
        pr.damage = 30;
        pr.life = 115;

        if (!p.isClone) {
            p.parryCounterTimer = COUNTER_WINDOW;
            if ((p.deflectHealCooldown || 0) <= 0) {
                p.hp = Math.min(p.maxHp, p.hp + 3);
                p.deflectHealCooldown = 120;
            }
        } else if (state.player && state.player.alive && (state.player.deflectHealCooldown || 0) <= 0) {
            state.player.hp = Math.min(state.player.maxHp, state.player.hp + 2);
            state.player.deflectHealCooldown = 120;
        }
        state.score += 120;
        if (state.hitstopTimer < 3) state.hitstopTimer = 3;
        state.screenShake = Math.max(state.screenShake, 4.8);
        spawnRingEffect(state, pr.x, pr.y, '#ffd24c', 56);
        spawnParticles(state, pr.x, pr.y, 12, '#ffd24c', 2.0, 6.5, 0.8);
        spawnCallout(state, pr.x, pr.y - 26, 'RETURN!', '#ffd24c');
        soundEvents.push('parry');
    } else if (isEarlyTip) {
        // Early tip-of-swing swipe: bats the star high upward in a sweeping arc (can hit overhead tiles or drop onto enemies!)
        pr.vx = p.facing * (6.2 + rngRange(state.rng, 0, 2.2));
        pr.vy = -(7.8 + rngRange(state.rng, 0, 2.4));
        pr.gravity = 0.24;
        pr.damage = 26;
        pr.life = 135;

        state.score += 80;
        if (state.hitstopTimer < 2) state.hitstopTimer = 2;
        state.screenShake = Math.max(state.screenShake, 3.2);
        spawnRingEffect(state, pr.x, pr.y, '#ffe7b3', 44);
        spawnParticles(state, pr.x, pr.y, 9, '#ffe7b3', 1.8, 5.5, 1.2);
        spawnCallout(state, pr.x, pr.y - 24, 'RICOCHET!', '#ffe7b3');
        soundEvents.push('parry');
    } else {
        // Late / close-range swipe: wild angled deflection (sky pop-up, floor-skip bounce, or rising cross-cut!)
        var mode = rngInt(state.rng, 0, 3);
        if (mode === 0) {
            // Steep upward pop-up
            pr.vx = p.facing * (3.5 + rngRange(state.rng, 0, 2.2));
            pr.vy = -(9.4 + rngRange(state.rng, 0, 1.8));
            pr.gravity = 0.26;
        } else if (mode === 1) {
            // Downward floor-skip bounce toward enemies / barrels!
            pr.vx = p.facing * (8.6 + rngRange(state.rng, 0, 1.6));
            pr.vy = 5.4;
            pr.gravity = 0.14;
        } else {
            // Rising diagonal slash over front threats into backline enemies
            pr.vx = p.facing * (8.2 + rngRange(state.rng, 0, 1.8));
            pr.vy = -(4.4 + rngRange(state.rng, 0, 1.6));
            pr.gravity = 0.16;
        }
        pr.damage = 24;
        pr.life = 130;

        state.score += 75;
        if (state.hitstopTimer < 2) state.hitstopTimer = 2;
        state.screenShake = Math.max(state.screenShake, 3.0);
        spawnRingEffect(state, pr.x, pr.y, '#f5ead6', 42);
        spawnParticles(state, pr.x, pr.y, 9, '#f5ead6', 1.8, 5.5, 0.8);
        spawnParticles(state, pr.x, pr.y, 5, '#ffd24c', 1.5, 4.5, 0.6);
        spawnCallout(state, pr.x, pr.y - 24, 'DEFLECT!', '#f5ead6');
        soundEvents.push('block');
    }
    return true;
}

function tryDeflectTrapWithSwing(state, p, tr, prevX, prevY, soundEvents) {
    var spec = PLAYER_MOVES[p.action];
    if (!spec) return false;

    var isOmni = !!spec.omni;
    var reach = spec.reach + 20;
    var swingMinX = isOmni ? (p.x - reach) : (p.facing > 0 ? (p.x - 16) : (p.x - reach));
    var swingMaxX = isOmni ? (p.x + reach) : (p.facing > 0 ? (p.x + reach) : (p.x + 16));
    var padX = tr.kind === 'barrel' ? 18 : 16;
    var segMinX = Math.min(prevX, tr.x) - padX;
    var segMaxX = Math.max(prevX, tr.x) + padX;

    var trCenterY = tr.kind === 'barrel' ? (tr.y - 18) : tr.y;
    var prevCenterY = tr.kind === 'barrel' ? (prevY - 18) : prevY;
    var segMinY = Math.min(prevCenterY, trCenterY) - 20;
    var segMaxY = Math.max(prevCenterY, trCenterY) + 20;
    var swingTopY = tr.kind === 'tile' ? (p.y - 126) : (p.y - 104);

    if (segMaxX < swingMinX || segMinX > swingMaxX || segMaxY < swingTopY || segMinY > p.y + 14) {
        return false;
    }

    var defDir = isOmni ? (tr.x >= p.x ? 1 : -1) : p.facing;
    var relX = (tr.x - p.x) * defDir;
    var isHeavyMove = (p.action === 'attack3' || p.action === 'counter' || p.action === 'dragon_upper' || isOmni);
    var isPopMove = (p.action === 'attack3' || p.action === 'airkick' || p.action === 'dragon_upper');
    var isSweetSpot = isHeavyMove || (relX >= 10 && relX <= 86);

    tr.owner = 'player';
    tr.bounced = 0;
    state.parriesLanded += 1;

    if (tr.kind === 'barrel') {
        tr.hitsLeft = 4;
        tr.life = 180;
        if (!isPopMove && isSweetSpot) {
            // Bowling-ball kickback straight across the dojo floor!
            tr.vx = defDir * 11.2;
            tr.vy = 0;
            tr.gravity = 0;
            spawnRingEffect(state, tr.x, tr.y - 18, '#ffb830', 58);
            spawnParticles(state, tr.x, tr.y - 18, 14, '#ffb830', 2.2, 6.8, 1.0);
            spawnCallout(state, tr.x, tr.y - 46, 'BOWL!', '#ffb830');
        } else {
            // Uppercut / jump-kick / edge swipe pops the barrel in a chest-height bouncing arc!
            tr.vx = defDir * 9.5;
            tr.vy = -5.8;
            tr.gravity = 0.34;
            spawnRingEffect(state, tr.x, tr.y - 18, '#ffe7b3', 50);
            spawnParticles(state, tr.x, tr.y - 18, 12, '#ffe7b3', 1.8, 5.8, 1.2);
            spawnCallout(state, tr.x, tr.y - 46, 'LAUNCH!', '#ffe7b3');
        }
        state.score += 80;
        if (state.hitstopTimer < 3) state.hitstopTimer = 3;
        state.screenShake = Math.max(state.screenShake, 4.5);
        soundEvents.push('heavy_hit');
        return true;
    }

    if (tr.kind === 'tile') {
        tr.life = 135;
        tr.damage = 28;
        if (isSweetSpot || p.action === 'airkick' || p.action === 'divekick') {
            // Aim brick directly at the nearest enemy ahead (or nearest on screen)
            var targetEnemy = null;
            var bestDist = 999999;
            for (var ei = 0; ei < state.enemies.length; ei++) {
                var cand = state.enemies[ei];
                var cdx = (cand.x - tr.x) * defDir;
                if (cdx > 0 && cdx < bestDist) {
                    bestDist = cdx;
                    targetEnemy = cand;
                }
            }
            var shotSpd = 10.2;
            if (targetEnemy) {
                var rdx = targetEnemy.x - tr.x;
                var rdy = (targetEnemy.y - 46 * targetEnemy.scale) - tr.y;
                var rDist = detHypot(rdx, rdy);
                if (rDist > 1e-4) {
                    tr.vx = (rdx / rDist) * shotSpd;
                    tr.vy = (rdy / rDist) * shotSpd;
                } else {
                    tr.vx = defDir * shotSpd;
                    tr.vy = 0;
                }
            } else {
                tr.vx = defDir * shotSpd;
                tr.vy = -1.2;
            }
            tr.gravity = 0.08;
            state.score += 100;
            spawnRingEffect(state, tr.x, tr.y, '#ffd24c', 52);
            spawnParticles(state, tr.x, tr.y, 10, '#ffd24c', 1.8, 6.0, 0.8);
            spawnCallout(state, tr.x, tr.y - 24, 'BRICK SHOT!', '#ffd24c');
            soundEvents.push('parry');
        } else {
            var mode = rngInt(state.rng, 0, 3);
            if (mode === 0) {
                tr.vx = defDir * (5.5 + rngRange(state.rng, 0, 2.0));
                tr.vy = -(7.6 + rngRange(state.rng, 0, 1.8));
                tr.gravity = 0.26;
            } else if (mode === 1) {
                tr.vx = defDir * 8.6;
                tr.vy = 5.0;
                tr.gravity = 0.20;
            } else {
                tr.vx = defDir * 8.4;
                tr.vy = -3.8;
                tr.gravity = 0.22;
            }
            state.score += 75;
            spawnRingEffect(state, tr.x, tr.y, '#ffe7b3', 42);
            spawnParticles(state, tr.x, tr.y, 8, '#ffe7b3', 1.6, 5.2, 0.8);
            spawnCallout(state, tr.x, tr.y - 24, 'DEFLECT!', '#ffe7b3');
            soundEvents.push('block');
        }
        if (state.hitstopTimer < 2) state.hitstopTimer = 2;
        state.screenShake = Math.max(state.screenShake, 3.8);
        return true;
    }

    return false;
}

function spawnShadowClone(state, slotIdx, minX, maxX, soundEvents) {
    var p = state.player;
    var offset = (slotIdx === 0) ? (-p.facing * 42) : (slotIdx === 1 ? (p.facing * 42) : (-p.facing * 76));
    var cx = p.x + offset;
    if (cx < minX) cx = minX;
    if (cx > maxX) cx = maxX;
    var cl = {
        id: allocEntityId(state),
        isClone: true,
        alive: true,
        slotIndex: slotIdx,
        x: cx,
        y: GROUND_Y,
        vx: 0,
        vy: 0,
        facing: p.facing,
        onGround: true,
        action: 'idle',
        actionTick: 0,
        actionDuration: 0,
        swingId: 0,
        comboStep: 0,
        comboWindow: 0,
        attackCooldown: 4,
        jumpCooldown: 10,
        kunaiCooldown: 28 + slotIdx * 16,
        walkCycle: slotIdx * 1.8
    };
    state.clones.push(cl);
    // Naruto-style white/ink smoke puff!
    spawnRingEffect(state, cx, GROUND_Y - 42, '#f2ede2', 56);
    spawnParticles(state, cx, GROUND_Y - 42, 12, '#f2ede2', 1.4, 4.8, 1.2);
    spawnParticles(state, cx, GROUND_Y - 42, 8, '#111111', 1.2, 4.0, 0.8);
    var cText = slotIdx === 0 ? 'CLONE!' : (slotIdx === 1 ? 'TWIN CLONE!' : '3RD CLONE!');
    spawnCallout(state, cx, GROUND_Y - 84, cText, '#ff5247');
    soundEvents.push('swing');
    return cl;
}

function startCloneAttack(state, cl, soundEvents) {
    var moveName;
    if (!cl.onGround) {
        moveName = 'airkick';
        cl.comboStep = 0;
        cl.comboWindow = 0;
    } else if (cl.comboWindow > 0 && cl.comboStep === 1) {
        moveName = 'attack2';
        cl.comboStep = 2;
        cl.comboWindow = 28;
    } else if (cl.comboWindow > 0 && cl.comboStep === 2) {
        moveName = 'attack3';
        cl.comboStep = 0;
        cl.comboWindow = 0;
    } else {
        moveName = 'attack1';
        cl.comboStep = 1;
        cl.comboWindow = 28;
    }

    var spec = PLAYER_MOVES[moveName];
    cl.action = moveName;
    cl.actionTick = 0;
    cl.actionDuration = spec.dur;
    cl.swingId = (cl.swingId + 1) >>> 0;
    cl.vx = cl.facing * spec.lunge;
    if (moveName === 'airkick') {
        cl.vy = Math.min(cl.vy, 1.5);
    }
    var slashStyle = moveName === 'attack1' ? 'jab'
        : moveName === 'attack2' ? 'kick'
        : moveName === 'attack3' ? 'upper'
        : 'air';
    spawnSlashArc(state, cl.x + cl.facing * 22, cl.y - 46, cl.facing, slashStyle, '#ff5247');
    soundEvents.push('swing');
}

function updateShadowClones(state, minX, maxX, soundEvents) {
    var p = state.player;
    var tier = getStreakTier(state);
    var desired = 0;
    if (p && p.alive && (p.fighterId || 'shadow') === 'shadow') {
        if (tier >= 2) desired = 3;
        else if (tier >= 1) desired = 2;
        else if (state.comboCount >= 3) desired = 1;
    }

    if (!state.clones) state.clones = [];

    // Pop excess clones in a smoke puff when streak drops
    while (state.clones.length > desired) {
        var popped = state.clones.pop();
        spawnParticles(state, popped.x, popped.y - 42, 10, '#f2ede2', 1.2, 4.4, 1.0);
        spawnParticles(state, popped.x, popped.y - 42, 6, '#111111', 1.0, 3.6, 0.8);
    }

    // Summon missing clones (1 @ 3+, 2 @ 5+, 3 @ 10+)
    while (state.clones.length < desired) {
        spawnShadowClone(state, state.clones.length, minX, maxX, soundEvents);
    }

    for (var ci = 0; ci < state.clones.length; ci++) {
        var cl = state.clones[ci];
        if (cl.comboWindow > 0) cl.comboWindow -= 1;
        if (cl.attackCooldown > 0) cl.attackCooldown -= 1;
        if (cl.jumpCooldown > 0) cl.jumpCooldown -= 1;
        if (cl.kunaiCooldown > 0) cl.kunaiCooldown -= 1;

        var isAtk = (cl.action === 'attack1' || cl.action === 'attack2' ||
                     cl.action === 'attack3' || cl.action === 'airkick');

        if (isAtk) {
            cl.actionTick += 1;
            var spec = PLAYER_MOVES[cl.action];
            if (cl.onGround) cl.vx *= 0.82;

            if (cl.actionTick >= spec.start && cl.actionTick <= spec.end) {
                var cCenterX = cl.x + cl.facing * (spec.reach * 0.55);
                var cHalfW = spec.reach * 0.55;
                var launchLiving = (cl.action === 'attack3' || cl.action === 'airkick');
                for (var ei = state.enemies.length - 1; ei >= 0; ei--) {
                    var en = state.enemies[ei];
                    if (en.lastHitSwingId === cl.swingId) continue;
                    var enTop = en.y - 78 * en.scale;
                    if (Math.abs(en.x - cCenterX) <= cHalfW + 20 * en.scale &&
                        en.y >= cl.y - 95 && enTop <= cl.y + 12) {
                        en.lastHitSwingId = cl.swingId;
                        var cDmg = Math.max(8, Math.round(spec.dmg * 0.68));
                        // stopTicks=0 so autonomous clone hits never stutter the player's own controls!
                        var dead = damageEnemy(
                            state, en, cDmg,
                            cl.facing * spec.kx * 0.85, spec.ky * 0.85, 0,
                            false, soundEvents, launchLiving
                        );
                        if (dead) state.enemies.splice(ei, 1);
                    }
                }
            }

            if (cl.actionTick >= cl.actionDuration) {
                cl.action = cl.onGround ? 'idle' : 'jump';
                cl.actionTick = 0;
            }
        } else {
            // Autonomous Clone AI: deflect nearby stars/barrels, flank enemies, or run alongside player!
            var acted = false;

            // 1. Deflect approaching ninja stars & rolling barrels!
            if (cl.attackCooldown === 0) {
                for (var pi = 0; pi < state.projectiles.length; pi++) {
                    var pr = state.projectiles[pi];
                    if (pr.owner !== 'enemy') continue;
                    var pdx = pr.x - cl.x;
                    if (Math.abs(pdx) < 76 && ((pdx > 0 && pr.vx < 0) || (pdx < 0 && pr.vx > 0))) {
                        cl.facing = pdx >= 0 ? 1 : -1;
                        cl.attackCooldown = 8;
                        startCloneAttack(state, cl, soundEvents);
                        acted = true;
                        break;
                    }
                }
            }
            if (!acted && cl.attackCooldown === 0) {
                for (var ti = 0; ti < state.traps.length; ti++) {
                    var tr = state.traps[ti];
                    if (tr.owner === 'player' || tr.kind !== 'barrel') continue;
                    var bdx = tr.x - cl.x;
                    if (Math.abs(bdx) < 78 && ((bdx > 0 && tr.vx < 0) || (bdx < 0 && tr.vx > 0))) {
                        cl.facing = bdx >= 0 ? 1 : -1;
                        cl.attackCooldown = 10;
                        startCloneAttack(state, cl, soundEvents);
                        acted = true;
                        break;
                    }
                }
            }

            // 2. Pick target enemy (spread across enemies: slot 0 -> nearest, slot 1 -> 2nd / flank, slot 2 -> furthest / flank!)
            if (!acted) {
                var sorted = [];
                for (var eIdx = 0; eIdx < state.enemies.length; eIdx++) {
                    var cand = state.enemies[eIdx];
                    sorted.push({ enemy: cand, dist: Math.abs(cand.x - cl.x) });
                }
                sorted.sort(function (a, b) { return a.dist - b.dist; });

                var target = null;
                var goalX = p.x - p.facing * (44 + cl.slotIndex * 32);
                if (sorted.length > 0) {
                    if (cl.slotIndex === 2 && sorted.length > 2) {
                        target = sorted[sorted.length - 1].enemy; // hunt backline knife ninja!
                        goalX = target.x;
                    } else if (cl.slotIndex >= 1 && sorted.length > 1) {
                        target = sorted[1].enemy;
                        goalX = target.x;
                    } else if (cl.slotIndex >= 1 && sorted.length === 1) {
                        target = sorted[0].enemy;
                        var flankSide = (p.x <= target.x) ? 1 : -1;
                        goalX = target.x + flankSide * (cl.slotIndex === 1 ? 46 : -54);
                    } else {
                        target = sorted[0].enemy;
                        goalX = target.x;
                    }
                }

                if (target) {
                    var tdx = target.x - cl.x;
                    var absTdx = Math.abs(tdx);
                    cl.facing = tdx >= 0 ? 1 : -1;

                    if (!cl.onGround && absTdx < 105 && cl.attackCooldown === 0) {
                        cl.attackCooldown = 14;
                        startCloneAttack(state, cl, soundEvents);
                    } else if (absTdx <= 76 && cl.onGround) {
                        cl.vx *= 0.7;
                        if (cl.attackCooldown === 0) {
                            cl.attackCooldown = (cl.comboStep === 2) ? 18 : 9;
                            startCloneAttack(state, cl, soundEvents);
                        } else {
                            cl.action = 'idle';
                        }
                    } else if (cl.onGround && absTdx >= 150 && absTdx <= 340 && (cl.kunaiCooldown || 0) <= 0 && cl.attackCooldown === 0) {
                        // 3a Shadow Clones throw mini-kunai at distant enemies!
                        cl.kunaiCooldown = 78;
                        cl.attackCooldown = 14;
                        cl.action = 'attack1';
                        cl.actionTick = 0;
                        cl.actionDuration = 12;
                        state.projectiles.push({
                            id: allocEntityId(state),
                            kind: 'clone_kunai',
                            x: cl.x + cl.facing * 20,
                            y: cl.y - 46,
                            vx: cl.facing * 10.2,
                            vy: 0,
                            owner: 'player',
                            damage: 11,
                            radius: 10,
                            hitsLeft: 1,
                            spin: 0,
                            life: 44
                        });
                        soundEvents.push('throw');
                    } else if (cl.onGround && absTdx > 130 && absTdx < 210 && cl.jumpCooldown === 0 && ((state.tick + cl.slotIndex * 19) % 47 === 0)) {
                        cl.vy = JUMP_VEL;
                        cl.vx = cl.facing * PLAYER_AIR_SPEED * 1.05;
                        cl.onGround = false;
                        cl.action = 'jump';
                        cl.actionTick = 0;
                        cl.jumpCooldown = 48;
                        spawnParticles(state, cl.x, GROUND_Y, 4, '#332b24', 0.8, 2.2, 0.8);
                    } else {
                        var gdx = goalX - cl.x;
                        var cSpd = cl.onGround ? PLAYER_SPEED * 1.06 : PLAYER_AIR_SPEED;
                        if (Math.abs(gdx) > 10) {
                            cl.facing = gdx >= 0 ? 1 : -1;
                            cl.vx = cl.facing * cSpd;
                            if (cl.onGround) {
                                cl.action = 'run';
                                cl.walkCycle += 0.26;
                            }
                        } else {
                            cl.vx *= 0.68;
                            if (cl.onGround) cl.action = 'idle';
                        }
                    }
                } else {
                    // No enemies: sprint in formation behind Shadow Ronin!
                    var fdx = goalX - cl.x;
                    if (Math.abs(fdx) > 14) {
                        cl.facing = fdx >= 0 ? 1 : -1;
                        cl.vx = cl.facing * PLAYER_SPEED * 1.04;
                        if (cl.onGround) {
                            cl.action = 'run';
                            cl.walkCycle += 0.25;
                        }
                    } else {
                        cl.facing = p.facing;
                        cl.vx *= 0.65;
                        if (Math.abs(cl.vx) < 0.15) cl.vx = 0;
                        if (cl.onGround) cl.action = 'idle';
                    }
                }
            }
        }

        // Soft horizontal separation between Shadow Clones so all 3 stay visibly fanned out!
        for (var cj = 0; cj < state.clones.length; cj++) {
            if (ci === cj) continue;
            var otherCl = state.clones[cj];
            var cSep = cl.x - otherCl.x;
            if (Math.abs(cSep) < 28 && Math.abs(cl.y - otherCl.y) < 32) {
                cl.vx += (cSep >= 0 ? 0.5 : -0.5);
            }
        }

        // Integrate Clone Physics & Clamp to Arena
        cl.x += cl.vx;
        cl.vy += GRAVITY;
        cl.y += cl.vy;
        if (cl.y >= GROUND_Y) {
            if (!cl.onGround && cl.action === 'airkick') {
                cl.action = 'idle';
                cl.actionTick = 0;
            }
            cl.y = GROUND_Y;
            cl.vy = 0;
            cl.onGround = true;
        }
        if (cl.x < minX) cl.x = minX;
        if (cl.x > maxX) cl.x = maxX;
    }
}

// ----------------------------------------------------------------------------
// Main Fixed-Timestep Simulation Step (60 Hz)
// ----------------------------------------------------------------------------
function stepSimulation(state, inputMask) {
    var soundEvents = [];
    state.tick += 1;

    if (state.bannerTimer > 0) state.bannerTimer -= 1;
    if (state.screenShake > 0) {
        state.screenShake *= 0.80;
        if (state.screenShake < 0.2) state.screenShake = 0;
    }

    // Keep hitstop crisp: freeze fighter & projectile physics while hitstop > 0,
    // BUT buffer edge-triggered Jump & Attack inputs so pressing Jump on a hitstop frame is never dropped!
    if (state.hitstopTimer > 0) {
        var pFreeze = state.player;
        if (pFreeze && pFreeze.alive && !state.isGameOver && state.floorClearTimer === 0) {
            if ((inputMask & INPUT_JUMP) !== 0) pFreeze.jumpBuffer = 10;
            if ((inputMask & INPUT_ATTACK) !== 0 && !pFreeze.attackHeld) pFreeze.attackBuffer = 8;
        }
        state.hitstopTimer -= 1;
        return { soundEvents: soundEvents };
    }

    if (state.isGameOver) {
        updateCosmetics(state);
        return { soundEvents: soundEvents };
    }

    // Floor clear transition countdown
    if (state.floorClearTimer > 0) {
        state.floorClearTimer -= 1;
        updateCosmetics(state);
        if (state.floorClearTimer === 0) {
            advanceToNextFloor(state, soundEvents);
        }
        return { soundEvents: soundEvents };
    }

    var p = state.player;
    var left   = (inputMask & INPUT_LEFT) !== 0;
    var right  = (inputMask & INPUT_RIGHT) !== 0;
    var jump   = (inputMask & INPUT_JUMP) !== 0;
    var attack = (inputMask & INPUT_ATTACK) !== 0;
    var tier   = getStreakTier(state);
    var fId    = p.fighterId || 'shadow';

    // Timers
    if (p.invulnTimer > 0) p.invulnTimer -= 1;
    if (p.flashTimer > 0) p.flashTimer -= 1;
    if (p.comboWindow > 0) p.comboWindow -= 1;
    if (p.parryCounterTimer > 0) p.parryCounterTimer -= 1;
    if (p.attackBuffer > 0) p.attackBuffer -= 1;
    if (p.jumpBuffer > 0) p.jumpBuffer -= 1;
    if (p.turnWindow > 0) p.turnWindow -= 1;
    if (p.spinCooldown > 0) p.spinCooldown -= 1;
    if (p.deflectHealCooldown > 0) p.deflectHealCooldown -= 1;
    if (p.subCooldown > 0) p.subCooldown -= 1;
    if (state.comboDecayTimer > 0) {
        state.comboDecayTimer -= 1;
        if (state.comboDecayTimer === 0) {
            state.comboCount = 0;
            state.streakTier = 0;
            tier = 0;
        }
    }

    var attackJustPressed = attack && !p.attackHeld;
    var attackJustReleased = !attack && p.attackHeld;
    var releasedChargeTicks = p.attackChargeTicks;

    if (attackJustPressed) p.attackBuffer = 8;
    if (jump)              p.jumpBuffer = 10;

    // Track attack hold duration for Street Fighter Power Ball charge-up
    // (Thunder Monk Tier 2 charges twice as fast!)
    if (attack && p.action !== 'hurt' && p.action !== 'ko') {
        if (p.attackChargeTicks < CHARGE_MAX_TICKS) {
            var prevCharge = p.attackChargeTicks;
            var chargeStep = (fId === 'thunder' && tier >= 2) ? 2 : 1;
            p.attackChargeTicks = Math.min(CHARGE_MAX_TICKS, p.attackChargeTicks + chargeStep);
            if (prevCharge < CHARGE_VISUAL_TICKS && p.attackChargeTicks >= CHARGE_VISUAL_TICKS) {
                soundEvents.push('charge_start');
            }
            if (prevCharge < CHARGE_READY_TICKS && p.attackChargeTicks >= CHARGE_READY_TICKS) {
                spawnRingEffect(state, p.x - p.facing * 6, p.y - 44, '#38d9ff', 44);
                spawnParticles(state, p.x - p.facing * 6, p.y - 44, 8, '#38d9ff', 1.5, 4.2, 0.5);
                soundEvents.push('charge_ready');
            }
            if (prevCharge < CHARGE_MAX_TICKS && p.attackChargeTicks >= CHARGE_MAX_TICKS) {
                spawnRingEffect(state, p.x - p.facing * 6, p.y - 44, '#ffd24c', 64);
                spawnParticles(state, p.x - p.facing * 6, p.y - 44, 14, '#ffd24c', 2.0, 5.8, 0.8);
                soundEvents.push('charge_max');
            }
        }
    } else if (!attack) {
        p.attackChargeTicks = 0;
    }
    p.attackHeld = attack;

    // --- 1. Player State Machine ---
    var isAttacking = (p.action === 'attack1' || p.action === 'attack2' ||
                       p.action === 'attack3' || p.action === 'airkick' ||
                       p.action === 'counter' || p.action === 'spin' ||
                       p.action === 'dragon_upper' || p.action === 'divekick');
    var canReleaseHadouken = attackJustReleased && releasedChargeTicks >= CHARGE_READY_TICKS &&
        p.action !== 'hurt' && p.action !== 'ko';

    if (canReleaseHadouken) {
        if (left && !right) p.facing = -1;
        else if (right && !left) p.facing = 1;
        startPlayerHadouken(state, p, releasedChargeTicks, soundEvents);
    } else if (p.action === 'hurt' || p.action === 'hadouken') {
        p.actionTick += 1;
        p.vx *= 0.84;
        // 3a Fighting-Game Jump-Cancel: let player break out of Hadouken follow-through to jump!
        if (p.action === 'hadouken' && p.onGround && p.jumpBuffer > 0 && p.actionTick >= 4) {
            performPlayerJump(state, p, left, right, soundEvents);
        } else if (p.actionTick >= p.actionDuration) {
            p.action = p.onGround ? 'idle' : 'jump';
            p.actionTick = 0;
        }
    } else if (isAttacking) {
        p.actionTick += 1;
        var spec = PLAYER_MOVES[p.action];
        var activeStart = (fId === 'dragon' && tier >= 1 && p.action !== 'divekick')
            ? Math.max(2, spec.start - 1) : spec.start;
        var activeEnd = spec.end;
        if (p.onGround) {
            var isGaleFlashDashing = (fId === 'gale') && (
                (tier >= 1 && (p.action === 'attack2' || p.action === 'attack3' || p.action === 'counter')) ||
                (state.comboCount >= 3 && (p.action === 'attack3' || p.action === 'counter'))
            );
            p.vx *= isGaleFlashDashing ? 0.90 : 0.82;
            if (isGaleFlashDashing && p.actionTick % 3 === 0) {
                if (state.afterimages.length >= 8) state.afterimages.shift();
                state.afterimages.push({
                    id: allocEntityId(state),
                    x: p.x, y: p.y, facing: p.facing, pose: p.action,
                    color: '#c66bff', life: 10, maxLife: 10
                });
            }
        }

        // Active hitbox window
        if (p.actionTick >= activeStart && p.actionTick <= activeEnd) {
            var isOmni = !!spec.omni;
            var effReach = spec.reach + ((fId === 'dragon' && tier >= 1) ? 16 : 0);
            var effDmg = (fId === 'dragon' && tier >= 1) ? Math.round(spec.dmg * 1.25) : spec.dmg;
            var effKx = spec.kx * ((fId === 'dragon' && tier >= 1) ? 1.20 : 1.0) * ((fId === 'gale' && tier >= 2) ? 1.25 : 1.0);
            var hitCenterX = isOmni ? p.x : (p.x + p.facing * (effReach * 0.55));
            var hitHalfW = isOmni ? effReach : (effReach * 0.55);
            var hitYMin = (p.action === 'dragon_upper') ? (p.y - 122) : (p.y - 95);
            var hitYMax = p.y + 12;

            var launchLiving = (p.action === 'attack3' || p.action === 'airkick' || p.action === 'counter' ||
                                p.action === 'dragon_upper' || p.action === 'divekick' || p.action === 'spin' ||
                                (fId === 'gale' && tier >= 2));
            var struckEnemies = [];
            for (var ei = state.enemies.length - 1; ei >= 0; ei--) {
                var en = state.enemies[ei];
                if (en.lastHitSwingId === p.swingId) continue;
                var dx = Math.abs(en.x - hitCenterX);
                var enTop = en.y - 78 * en.scale;
                if (dx <= hitHalfW + 20 * en.scale && en.y >= hitYMin && enTop <= hitYMax) {
                    en.lastHitSwingId = p.swingId;
                    p.moveHitConnected = true;
                    var knockDir = isOmni ? (en.x >= p.x ? 1 : -1) : p.facing;
                    var dead = damageEnemy(
                        state, en, effDmg,
                        knockDir * effKx, spec.ky, spec.stop,
                        p.action === 'counter' || p.action === 'dragon_upper', soundEvents, launchLiving
                    );
                    // Dragon Fist Tier 1+: set enemies visibly on fire!
                    if (!dead && fId === 'dragon' && getStreakTier(state) >= 1) {
                        en.burnTimer = Math.max(en.burnTimer || 0, 150);
                        spawnParticles(state, en.x, en.y - 46 * en.scale, 6, '#ff6a1a', 1.4, 4.6, 1.4);
                    }
                    struckEnemies.push({ id: en.id, x: en.x, y: en.y, scale: en.scale });
                    if (dead) {
                        state.enemies.splice(ei, 1);
                    }
                }
            }
            // Thunder Monk Tier 1+: Chain-Lightning Chi arcs to nearby enemies!
            if (fId === 'thunder' && getStreakTier(state) >= 1 && struckEnemies.length > 0) {
                triggerChainLightning(state, struckEnemies, getStreakTier(state), soundEvents);
            }
        }

        // 3a Fighting-Game Jump-Cancel: break out of ground attacks cleanly as soon as active frames start or hit connects!
        var jumpCancelTick = Math.min(activeStart, 4);
        var canJumpCancel = p.onGround && p.jumpBuffer > 0 && (p.actionTick >= jumpCancelTick || p.moveHitConnected);

        // 4a Mid-combo Switch-Direction 360° Hurricane Spin Kick cancel!
        var flippedDuringCombo = ((left && !right && p.facing === 1) || (right && !left && p.facing === -1));
        var canFlipSpinCancel = p.onGround && p.spinCooldown === 0 && p.attackBuffer > 0 &&
            p.actionTick >= activeStart && flippedDuringCombo &&
            (p.action === 'attack1' || p.action === 'attack2');

        // Dragon Uppercut can cancel near apex into airkick/divekick!
        var canUpperAirFollow = (p.action === 'dragon_upper' && !p.onGround && p.actionTick >= 8 && p.attackBuffer > 0);

        // Allow snappy chain cancel on last 3 frames if attack buffered
        var canChainCancel = p.onGround && p.actionTick >= p.actionDuration - 3 && p.attackBuffer > 0 &&
            (p.action === 'attack1' || p.action === 'attack2');

        if (canJumpCancel) {
            performPlayerJump(state, p, left, right, soundEvents);
        } else if (canFlipSpinCancel) {
            p.facing = (left && !right) ? -1 : 1;
            p.attackBuffer = 0;
            startPlayerAttack(state, p, soundEvents, 'spin');
        } else if (canUpperAirFollow) {
            p.attackBuffer = 0;
            startPlayerAttack(state, p, soundEvents);
        } else if (canChainCancel) {
            if (left && !right) p.facing = -1;
            else if (right && !left) p.facing = 1;
            p.attackBuffer = 0;
            startPlayerAttack(state, p, soundEvents);
        } else if (p.actionTick >= p.actionDuration) {
            if (p.onGround && p.attackHeld && p.attackChargeTicks >= CHARGE_VISUAL_TICKS) {
                p.action = 'charge';
            } else {
                p.action = p.onGround ? 'idle' : 'jump';
            }
            p.actionTick = 0;
        }
    } else {
        // Free movement / Charge / Jump / Attack / Switch-Direction 360° Spin transitions
        var wantDir = (left && !right) ? -1 : ((right && !left) ? 1 : 0);
        var justFlipped = (wantDir !== 0 && wantDir !== p.facing);
        if (justFlipped) {
            p.facing = wantDir;
            p.turnWindow = TURN_SPIN_WINDOW;
        }

        if (p.jumpBuffer > 0 && p.onGround && !attackJustPressed) {
            performPlayerJump(state, p, left, right, soundEvents);
        } else if (p.attackBuffer > 0) {
            p.attackBuffer = 0;
            // 4a Switch-Direction 360° Hurricane Spin Kick when flipping direction + Attack!
            if (p.onGround && p.spinCooldown === 0 && (justFlipped || p.turnWindow > 0)) {
                startPlayerAttack(state, p, soundEvents, 'spin');
            } else {
                startPlayerAttack(state, p, soundEvents);
            }
        } else if (p.jumpBuffer > 0 && p.onGround) {
            performPlayerJump(state, p, left, right, soundEvents);
        } else if (p.onGround && p.attackHeld && p.attackChargeTicks >= CHARGE_VISUAL_TICKS) {
            p.action = 'charge';
            p.actionTick += 1;
            p.vx *= 0.72;
            if (Math.abs(p.vx) < 0.12) p.vx = 0;
        } else {
            var isGale = (fId === 'gale');
            var moveSpd = p.onGround
                ? (isGale ? PLAYER_SPEED * 1.25 : PLAYER_SPEED)
                : (isGale ? PLAYER_AIR_SPEED * 1.22 : PLAYER_AIR_SPEED);
            var walkInc = isGale ? 0.30 : 0.24;
            if (left && !right) {
                p.vx = -moveSpd;
                if (p.onGround) {
                    p.action = 'run';
                    p.walkCycle += walkInc;
                }
                if (isGale && state.tick % 5 === 0) {
                    if (state.afterimages.length >= 8) state.afterimages.shift();
                    state.afterimages.push({
                        id: allocEntityId(state),
                        x: p.x, y: p.y, facing: p.facing, pose: p.onGround ? 'run' : 'jump',
                        color: '#c66bff', life: 8, maxLife: 8
                    });
                }
            } else if (right && !left) {
                p.vx = moveSpd;
                if (p.onGround) {
                    p.action = 'run';
                    p.walkCycle += walkInc;
                }
                if (isGale && state.tick % 5 === 0) {
                    if (state.afterimages.length >= 8) state.afterimages.shift();
                    state.afterimages.push({
                        id: allocEntityId(state),
                        x: p.x, y: p.y, facing: p.facing, pose: p.onGround ? 'run' : 'jump',
                        color: '#c66bff', life: 8, maxLife: 8
                    });
                }
            } else {
                p.vx *= p.onGround ? 0.65 : 0.94;
                if (Math.abs(p.vx) < 0.15) p.vx = 0;
                if (p.onGround) p.action = 'idle';
            }
        }
    }

    // Integrate Player Physics
    p.x += p.vx;
    p.vy += GRAVITY;
    p.y += p.vy;

    if (p.y >= GROUND_Y) {
        if (!p.onGround && p.action === 'divekick') {
            // Dragon Fist Tier 2: Meteor Dive Ground Shockwave!
            p.action = 'idle';
            p.actionTick = 0;
            spawnRingEffect(state, p.x, GROUND_Y - 6, '#ff9e1b', 128);
            spawnParticles(state, p.x, GROUND_Y - 4, 18, '#ff9e1b', 2.2, 7.2, 2.5);
            spawnParticles(state, p.x, GROUND_Y - 4, 10, '#111111', 1.8, 5.5, 2.0);
            spawnCallout(state, p.x, GROUND_Y - 82, 'METEOR SLAM!', '#ffd24c');
            spawnFireZone(state, 'ground', p.x, 76, 6, 140);
            state.screenShake = Math.max(state.screenShake, 8.5);
            soundEvents.push('meteor');
            for (var md = state.enemies.length - 1; md >= 0; md--) {
                var mEn = state.enemies[md];
                if (Math.abs(mEn.x - p.x) <= 125 && mEn.y >= GROUND_Y - 60) {
                    var mDir = mEn.x >= p.x ? 1 : -1;
                    var mDead = damageEnemy(state, mEn, 28, mDir * 9.5, -7.2, 4, true, soundEvents, true);
                    if (!mDead) mEn.burnTimer = Math.max(mEn.burnTimer || 0, 150);
                    if (mDead) state.enemies.splice(md, 1);
                }
            }
            for (var mt = 0; mt < state.traps.length; mt++) {
                var mTr = state.traps[mt];
                if (mTr.kind === 'barrel' && Math.abs(mTr.x - p.x) <= 125) {
                    mTr.owner = 'player';
                    mTr.vx = (mTr.x >= p.x ? 1 : -1) * 10.2;
                    mTr.vy = -5.4;
                    mTr.gravity = 0.34;
                    mTr.hitsLeft = 4;
                }
            }
        } else if (!p.onGround && (p.action === 'airkick' || p.action === 'dragon_upper')) {
            p.action = 'idle';
            p.actionTick = 0;
        }
        p.y = GROUND_Y;
        p.vy = 0;
        p.onGround = true;
    }

    // Clamp player within camera / encounter bounds
    var minPlayerX = state.zoneActive ? (state.zoneLockMinX + 26) : Math.max(26, state.cameraX + 24);
    var maxPlayerX = state.zoneActive ? (state.zoneLockMaxX - 26) : (FLOOR_LENGTH - 26);
    if (p.x < minPlayerX) p.x = minPlayerX;
    if (p.x > maxPlayerX) p.x = maxPlayerX;

    // --- 1b. Cosmetic Motion/Flash-Step Afterimage Trails ---
    for (var aiIdx = state.afterimages.length - 1; aiIdx >= 0; aiIdx--) {
        state.afterimages[aiIdx].life -= 1;
        if (state.afterimages[aiIdx].life <= 0) {
            state.afterimages.splice(aiIdx, 1);
        }
    }

    // --- 1b2. Shadow Ronin Autonomous AI Shadow Clones (Naruto-style: 1 @ 5+ hits, 2 @ 10+ hits) ---
    updateShadowClones(state, minPlayerX, maxPlayerX, soundEvents);

    // --- 1c. Lotus Blade Orbiting Ink Blades (Tier 1: 2 blades, Tier 2: 3 blades) ---
    var liveTier = getStreakTier(state);
    if (fId === 'lotus' && liveTier >= 1 && p.alive) {
        p.orbitAngle = (p.orbitAngle || 0) + 0.14;
        if (p.orbitAngle >= DET_TWO_PI) p.orbitAngle -= DET_TWO_PI;
        var bladeCount = liveTier >= 2 ? 3 : 2;
        for (var bi = 0; bi < bladeCount; bi++) {
            var bAng = p.orbitAngle + (bi * DET_TWO_PI / bladeCount);
            var bx = p.x + detCos(bAng) * 56;
            var by = (p.y - 44) + detSin(bAng) * 34;

            // Auto-deflect enemy ninja stars touching orbiting blades
            for (var op = state.projectiles.length - 1; op >= 0; op--) {
                var oPr = state.projectiles[op];
                if (oPr.owner === 'enemy' && oPr.life > 0 &&
                    Math.abs(bx - oPr.x) < 26 && Math.abs(by - oPr.y) < 26) {
                    oPr.owner = 'player';
                    oPr.vx = (oPr.x >= p.x ? 1 : -1) * 10.0;
                    oPr.vy = -2.2;
                    oPr.gravity = 0.08;
                    oPr.damage = 24;
                    oPr.life = 90;
                    state.parriesLanded += 1;
                    state.score += 60;
                    spawnParticles(state, oPr.x, oPr.y, 7, '#36e68a', 1.6, 4.8, 0.6);
                    soundEvents.push('parry');
                }
            }
            // Auto-shatter falling roof tiles touching orbiting blades
            for (var ot2 = state.traps.length - 1; ot2 >= 0; ot2--) {
                var oTr2 = state.traps[ot2];
                if (oTr2.kind === 'tile' && oTr2.owner !== 'player' && oTr2.telegraph <= 0 &&
                    Math.abs(bx - oTr2.x) < 28 && Math.abs(by - oTr2.y) < 28) {
                    spawnParticles(state, oTr2.x, oTr2.y, 10, '#36e68a', 1.8, 5.2, 1.0);
                    state.score += 80;
                    soundEvents.push('block');
                    state.traps.splice(ot2, 1);
                }
            }
            // Slice approaching enemies (throttled per enemy to every 16 ticks)
            for (var oe = state.enemies.length - 1; oe >= 0; oe--) {
                var oEn = state.enemies[oe];
                if (state.tick - (oEn.lastOrbitHitTick || -999) < 16) continue;
                if (Math.abs(bx - oEn.x) < 28 * oEn.scale &&
                    by >= oEn.y - 80 * oEn.scale && by <= oEn.y + 8) {
                    oEn.lastOrbitHitTick = state.tick;
                    var oDir = oEn.x >= p.x ? 1 : -1;
                    var oDead = damageEnemy(state, oEn, 12, oDir * 4.5, -2.0, 0, false, soundEvents, false);
                    spawnParticles(state, bx, by, 7, '#7df9ff', 1.6, 4.8, 0.8);
                    if (oDead) state.enemies.splice(oe, 1);
                }
            }
        }
    }

    // --- 1d. Dragon Fist Active Fire Pillars & Burning Ground Craters ---
    if (state.flames && state.flames.length > 0) {
        for (var fi = state.flames.length - 1; fi >= 0; fi--) {
            var fl = state.flames[fi];
            fl.life -= 1;
            fl.tickCount = (fl.tickCount || 0) + 1;

            if (fl.kind === 'pillar' || fl.kind === 'cyclone') {
                // Vaporize falling roof tiles in the vertical column!
                var isCyc = (fl.kind === 'cyclone');
                for (var ft = state.traps.length - 1; ft >= 0; ft--) {
                    var fTr = state.traps[ft];
                    if (fTr.kind === 'tile' && fTr.owner !== 'player' && fTr.telegraph <= 0 &&
                        Math.abs(fTr.x - fl.x) < fl.radius + 14 && fTr.y >= GROUND_Y - fl.height) {
                        spawnParticles(state, fTr.x, fTr.y, 10, isCyc ? '#e2a8ff' : '#ff9e1b', 1.6, 5.2, 1.4);
                        state.score += 90;
                        soundEvents.push(isCyc ? 'dash' : 'flame');
                        state.traps.splice(ft, 1);
                    }
                }
                // Blast/lift enemies caught in the Fire Pillar or Wind Cyclone (once per zone)
                if (fl.tickCount <= 16) {
                    for (var fe = state.enemies.length - 1; fe >= 0; fe--) {
                        var fEn = state.enemies[fe];
                        if (fEn.lastFlameId === fl.id) continue;
                        if (Math.abs(fEn.x - fl.x) <= fl.radius + 18 * fEn.scale && fEn.y >= GROUND_Y - fl.height) {
                            fEn.lastFlameId = fl.id;
                            var fDir = fEn.x >= fl.x ? 1 : -1;
                            var fDead = damageEnemy(state, fEn, fl.dmg, fDir * (isCyc ? 7.5 : 6.5), isCyc ? -7.4 : -8.2, 0, false, soundEvents, true);
                            if (!fDead && !isCyc) fEn.burnTimer = Math.max(fEn.burnTimer || 0, 150);
                            if (fDead) state.enemies.splice(fe, 1);
                        }
                    }
                }
            } else if (fl.kind === 'ground' && fl.tickCount % 26 === 1) {
                // Burning ground fire scorches enemies standing on it!
                for (var ge = state.enemies.length - 1; ge >= 0; ge--) {
                    var gEn = state.enemies[ge];
                    if (Math.abs(gEn.x - fl.x) <= fl.radius + 16 * gEn.scale && gEn.y >= GROUND_Y - 36) {
                        var gDead = damageEnemy(state, gEn, fl.dmg, 0, -1.5, 0, false, soundEvents, false);
                        if (!gDead) gEn.burnTimer = Math.max(gEn.burnTimer || 0, 120);
                        if (gDead) state.enemies.splice(ge, 1);
                    }
                }
            }

            if (fl.life <= 0) {
                state.flames.splice(fi, 1);
            }
        }
    }

    // --- 2. Camera Scroll & Zone Encounters ---
    if (!state.zoneActive) {
        var desiredCam = p.x - state.setup.viewWidth * 0.36;
        if (desiredCam < 0) desiredCam = 0;
        if (desiredCam > FLOOR_LENGTH - state.setup.viewWidth) {
            desiredCam = FLOOR_LENGTH - state.setup.viewWidth;
        }
        // Classic beat-'em-up smooth camera follow (tracks forward & slightly back)
        state.cameraX += (desiredCam - state.cameraX) * 0.14;
        if (state.cameraX < 0) state.cameraX = 0;
        if (state.cameraX > FLOOR_LENGTH - state.setup.viewWidth) {
            state.cameraX = FLOOR_LENGTH - state.setup.viewWidth;
        }

        // Check next encounter trigger
        if (state.zoneIndex < ZONE_TRIGGERS.length && p.x >= ZONE_TRIGGERS[state.zoneIndex]) {
            triggerZoneEncounter(state, state.zoneIndex, soundEvents);
        }
    } else {
        // Process delayed wave spawns
        for (var ps = state.pendingSpawns.length - 1; ps >= 0; ps--) {
            state.pendingSpawns[ps].delay -= 1;
            if (state.pendingSpawns[ps].delay <= 0) {
                var sp = state.pendingSpawns[ps];
                spawnEnemy(state, sp.kind, sp.x, sp.facing);
                state.pendingSpawns.splice(ps, 1);
            }
        }

        // Check if zone cleared (and boss not pending clear)
        if (state.pendingSpawns.length === 0 && state.enemies.length === 0 && !state.bossDefeated) {
            state.zoneActive = false;
            state.zoneIndex += 1;
            state.goPromptTimer = 110;
            soundEvents.push('wave_clear');
        }
    }

    if (state.goPromptTimer > 0) state.goPromptTimer -= 1;

    // --- 3. Temple Traps (Barrels & Falling Roof Tiles) ---
    if (!state.bossDefeated) {
        state.trapCooldown -= 1;
        if (state.trapCooldown <= 0) {
            var trapKind = (rngInt(state.rng, 0, 2) === 0) ? 'barrel' : 'tile';
            spawnTrap(state, trapKind);
            state.trapCooldown = Math.max(105, 185 - state.floor * 14) + rngInt(state.rng, 0, 55);
        }
    }

    // --- 4. Enemy AI & Physics ---
    for (var i = 0; i < state.enemies.length; i++) {
        var e = state.enemies[i];
        if (e.flashTimer > 0) e.flashTimer -= 1;
        if (e.cooldown > 0) e.cooldown -= 1;

        var distX = p.x - e.x;
        var absDist = Math.abs(distX);
        var dirToPlayer = distX >= 0 ? 1 : -1;

        if (e.state === 'thrown') {
            e.stateTick += 1;
            e.thrownTimer = Math.max(0, (e.thrownTimer || 0) - 1);
            e.vx *= 0.96;
            if (e.thrownTimer <= 0 || (e.onGround && e.stateTick > 6 && Math.abs(e.vx) < 2.5)) {
                e.thrownTimer = 0;
                e.state = 'hurt';
                e.stateTick = 0;
                e.stateDur = 10;
            }
        } else if (e.state === 'hurt' || e.state === 'stunned') {
            e.stateTick += 1;
            e.vx *= 0.85;
            if (e.stateTick >= e.stateDur) {
                e.state = 'approach';
                e.stateTick = 0;
            }
        } else if (e.state === 'windup') {
            e.stateTick += 1;
            e.vx *= 0.78;
            if (e.stateTick >= e.stateDur) {
                e.state = 'attack';
                e.stateTick = 0;
                e.didHitPlayer = false;
                if (e.attackStyle === 'throw') {
                    e.stateDur = 14;
                    state.projectiles.push({
                        id: allocEntityId(state),
                        kind: 'knife',
                        x: e.x + e.facing * 24,
                        y: e.y - 48 * e.scale,
                        vx: e.facing * (6.2 + Math.min(2.0, (state.floor - 1) * 0.45)),
                        vy: 0,
                        owner: 'enemy',
                        sourceEnemyId: e.id,
                        damage: e.dmg,
                        spin: 0,
                        life: 140
                    });
                    soundEvents.push('throw');
                } else {
                    e.stateDur = e.kind === 'boss' ? 12 : 9;
                    e.vx = e.facing * (e.kind === 'boss' ? 5.2 : 3.2);
                    spawnSlashArc(state, e.x + e.facing * 26, e.y - 46 * e.scale, e.facing, 'enemy', '#d92828');
                    soundEvents.push('enemy_swing');
                }
            }
        } else if (e.state === 'leap') {
            // Boss leaping slam
            e.stateTick += 1;
            if (e.onGround && e.stateTick > 10) {
                // Slam shockwave on landing!
                spawnRingEffect(state, e.x, GROUND_Y - 6, '#e83828', 110);
                spawnParticles(state, e.x, GROUND_Y, 16, '#111111', 2.0, 6.5, 2.2);
                state.screenShake = Math.max(state.screenShake, 7.5);
                soundEvents.push('heavy_hit');
                if (Math.abs(p.x - e.x) < 108 && p.y > GROUND_Y - 46) {
                    hitPlayer(state, e.dmg + 4, dirToPlayer, e, false, soundEvents);
                }
                e.state = 'recover';
                e.stateTick = 0;
                e.stateDur = 28;
                e.cooldown = 55;
            }
        } else if (e.state === 'attack') {
            e.stateTick += 1;
            e.vx *= 0.85;
            if (e.attackStyle === 'melee' && !e.didHitPlayer && e.stateTick >= 1 && e.stateTick <= 6) {
                var atkReach = e.range + 12;
                var inFront = (p.x - e.x) * e.facing;
                if (inFront > -14 && inFront <= atkReach && Math.abs(p.y - e.y) < 58) {
                    e.didHitPlayer = true;
                    hitPlayer(state, e.dmg, e.facing, e, false, soundEvents);
                }
            }
            if (e.stateTick >= e.stateDur) {
                e.state = 'recover';
                e.stateTick = 0;
                e.stateDur = e.kind === 'boss' ? 20 : 22;
                e.cooldown = (e.kind === 'knife' ? 62 : (e.kind === 'boss' ? 36 : 38)) + rngInt(state.rng, 0, 18);
            }
        } else if (e.state === 'recover') {
            e.stateTick += 1;
            e.vx *= 0.8;
            if (e.stateTick >= e.stateDur) {
                e.state = 'approach';
                e.stateTick = 0;
            }
        } else {
            // Approach / Positioning
            var zLeftIn = state.zoneLockMinX + 28;
            var zRightIn = state.zoneLockMaxX - 28;
            var outsideActiveZone = state.zoneActive && (e.x < zLeftIn || e.x > zRightIn);
            e.facing = dirToPlayer;
            if (outsideActiveZone) {
                // Always march into the locked arena before attacking or retreating (prevents off-screen softlocks!)
                var inwardDir = (e.x < zLeftIn) ? 1 : -1;
                e.facing = inwardDir;
                e.vx = inwardDir * Math.max(e.speed, 2.6);
                e.walkCycle += 0.22;
            } else if (e.kind === 'knife') {
                // Keep medium distance to throw knives (never retreat outside locked zone!)
                if (absDist < 155) {
                    var backDir = -dirToPlayer;
                    var atBackWall = state.zoneActive &&
                        ((backDir < 0 && e.x <= state.zoneLockMinX + 34) ||
                         (backDir > 0 && e.x >= state.zoneLockMaxX - 34));
                    if (atBackWall) {
                        e.vx *= 0.7;
                        if (e.cooldown <= 0) {
                            e.state = 'windup';
                            e.attackStyle = 'throw';
                            e.stateTick = 0;
                            e.stateDur = 24;
                        }
                    } else {
                        e.vx = backDir * e.speed * 0.9;
                        e.walkCycle += 0.2;
                    }
                } else if (absDist > 290) {
                    e.vx = dirToPlayer * e.speed;
                    e.walkCycle += 0.2;
                } else {
                    e.vx *= 0.75;
                    if (e.cooldown <= 0) {
                        e.state = 'windup';
                        e.attackStyle = 'throw';
                        e.stateTick = 0;
                        e.stateDur = 24;
                    }
                }
            } else if (e.kind === 'boss') {
                if (absDist > e.range - 10) {
                    if (absDist > 165 && absDist < 340 && e.cooldown <= 0 && rngInt(state.rng, 0, 3) === 0) {
                        // Leaping Slam!
                        e.state = 'leap';
                        e.attackStyle = 'slam';
                        e.stateTick = 0;
                        e.vx = dirToPlayer * 6.4;
                        e.vy = -12.6;
                        e.onGround = false;
                        soundEvents.push('jump');
                    } else {
                        e.vx = dirToPlayer * e.speed;
                        e.walkCycle += 0.22;
                    }
                } else {
                    e.vx *= 0.75;
                    if (e.cooldown <= 0) {
                        e.state = 'windup';
                        e.attackStyle = 'melee';
                        e.stateTick = 0;
                        e.stateDur = 22;
                    }
                }
            } else {
                // Brawler / Staff Monk
                if (absDist > e.range - 8) {
                    e.vx = dirToPlayer * e.speed;
                    e.walkCycle += 0.21;
                } else {
                    e.vx *= 0.75;
                    if (e.cooldown <= 0) {
                        e.state = 'windup';
                        e.attackStyle = 'melee';
                        e.stateTick = 0;
                        e.stateDur = e.kind === 'staff' ? 24 : 18;
                    }
                }
            }
        }

        // Soft separation so enemies don't stack identically on the same X pixel
        for (var j = 0; j < state.enemies.length; j++) {
            if (i === j) continue;
            var other = state.enemies[j];
            var sep = e.x - other.x;
            if (Math.abs(sep) < 30 && Math.abs(e.y - other.y) < 30) {
                e.vx += (sep >= 0 ? 0.22 : -0.22);
            }
        }

        e.x += e.vx;
        e.vy += (e.state === 'thrown' && (e.thrownTimer || 0) > 0) ? 0.26 : GRAVITY;
        e.y += e.vy;
        if (e.y >= GROUND_Y) {
            e.y = GROUND_Y;
            e.vy = 0;
            e.onGround = true;
        }

        // Track once an enemy has entered the locked zone so knockbacks/retreats can NEVER push them off-screen!
        if (state.zoneActive && e.x >= state.zoneLockMinX + 24 && e.x <= state.zoneLockMaxX - 24) {
            e.enteredZone = true;
        }
        // Keep enemies inside floor & active zone bounds (Phantom Gale Tier 2 pinball-bounces thrown enemies!)
        var pinballActive = (fId === 'gale' && getStreakTier(state) >= 2 && e.state === 'thrown' && (e.thrownTimer || 0) > 0 && (e.wallBounces || 0) < 2);
        var eMinX = (state.zoneActive && e.enteredZone)
            ? (state.zoneLockMinX + 20)
            : (pinballActive ? Math.max(22, state.cameraX + 20) : 18);
        var eMaxX = (state.zoneActive && e.enteredZone)
            ? (state.zoneLockMaxX - 20)
            : (pinballActive ? Math.min(FLOOR_LENGTH - 22, state.cameraX + state.setup.viewWidth - 20) : (FLOOR_LENGTH - 18));
        if (e.x < eMinX) {
            e.x = eMinX;
            if (pinballActive && e.vx < 0) {
                e.vx = Math.abs(e.vx) * 1.05;
                e.vy = -3.4;
                e.wallBounces = (e.wallBounces || 0) + 1;
                e.thrownTimer = Math.max(e.thrownTimer, 22);
                e.thrownId = allocEntityId(state);
                spawnRingEffect(state, e.x, e.y - 44, '#c66bff', 46);
                spawnCallout(state, e.x + 20, e.y - 76, 'PINBALL!', '#e2a8ff');
                soundEvents.push('block');
            }
        }
        if (e.x > eMaxX) {
            e.x = eMaxX;
            if (pinballActive && e.vx > 0) {
                e.vx = -Math.abs(e.vx) * 1.05;
                e.vy = -3.4;
                e.wallBounces = (e.wallBounces || 0) + 1;
                e.thrownTimer = Math.max(e.thrownTimer, 22);
                e.thrownId = allocEntityId(state);
                spawnRingEffect(state, e.x, e.y - 44, '#c66bff', 46);
                spawnCallout(state, e.x - 20, e.y - 76, 'PINBALL!', '#e2a8ff');
                soundEvents.push('block');
            }
        }
    }

    // --- 4b. Thrown Enemy Bowling Collisions (Heavy Finisher Launches Crash Into Other Enemies & Barrels!) ---
    for (var tiE = 0; tiE < state.enemies.length; tiE++) {
        var flyer = state.enemies[tiE];
        if (flyer.state !== 'thrown' || (flyer.thrownTimer || 0) <= 0) continue;

        // Smash rolling enemy barrels in the launched enemy's path
        for (var fbB = state.traps.length - 1; fbB >= 0; fbB--) {
            var bTrap = state.traps[fbB];
            if (bTrap.kind === 'barrel' && bTrap.owner !== 'player' &&
                Math.abs(flyer.x - bTrap.x) < 32 && Math.abs(flyer.y - bTrap.y) < 44) {
                spawnParticles(state, bTrap.x, bTrap.y - 18, 12, '#d97828', 2.0, 6.0, 2.0);
                state.score += 75;
                soundEvents.push('hit');
                state.traps.splice(fbB, 1);
            }
        }

        // Crash into other enemies! (Burning thrown enemies spread fire on impact!)
        for (var oiE = state.enemies.length - 1; oiE >= 0; oiE--) {
            var victim = state.enemies[oiE];
            if (victim.id === flyer.id || victim.lastHitBodyId === flyer.thrownId) continue;
            if (Math.abs(flyer.x - victim.x) < 34 * victim.scale && Math.abs(flyer.y - victim.y) < 56) {
                victim.lastHitBodyId = flyer.thrownId;
                var bDir = flyer.vx >= 0 ? 1 : -1;
                var vDead = damageEnemy(state, victim, 22, bDir * 8.5, -4.8, 3, false, soundEvents, false);
                if (!vDead && (flyer.burnTimer || 0) > 0) {
                    victim.burnTimer = Math.max(victim.burnTimer || 0, 120);
                }
                spawnRingEffect(state, victim.x, victim.y - 44, '#ffb830', 48);
                spawnCallout(state, victim.x, victim.y - 74, 'CRASH!', '#ffb830');
                state.score += 100;
                if (vDead) {
                    state.enemies.splice(oiE, 1);
                    if (oiE < tiE) tiE--;
                }
            }
        }
    }

    // --- 4c. Burning Enemy Flame Damage-Over-Time ---
    for (var biE = state.enemies.length - 1; biE >= 0; biE--) {
        var bEn = state.enemies[biE];
        if ((bEn.burnTimer || 0) > 0) {
            bEn.burnTimer -= 1;
            bEn.burnTick = (bEn.burnTick || 0) + 1;
            if (bEn.burnTick % 10 === 0) {
                spawnParticles(state, bEn.x, bEn.y - 42 * bEn.scale, 2, '#ff6a1a', 0.6, 2.2, 2.2);
            }
            if (bEn.burnTick % 30 === 0) {
                bEn.hp -= 5;
                bEn.flashTimer = 4;
                spawnParticles(state, bEn.x, bEn.y - 44 * bEn.scale, 5, '#ffd24c', 1.2, 3.8, 1.8);
                if (bEn.hp <= 0) {
                    state.enemiesDefeated += 1;
                    state.score += bEn.scoreVal;
                    spawnParticles(state, bEn.x, bEn.y - 44 * bEn.scale, 14, '#ff6a1a', 1.8, 6.2, 2.2);
                    spawnCallout(state, bEn.x, bEn.y - 76, bEn.kind === 'boss' ? 'MASTER DEFEATED!' : 'BURNED!', '#ff9e1b');
                    soundEvents.push(bEn.kind === 'boss' ? 'boss_ko' : 'ko');
                    if (bEn.kind === 'boss') {
                        state.bossDefeated = true;
                        state.floorClearTimer = 95;
                        state.score += 500 * state.floor;
                        state.bannerText = 'FLOOR ' + state.floor + ' CLEAR!';
                        state.bannerTimer = 95;
                    }
                    state.enemies.splice(biE, 1);
                }
            }
        }
    }

    // --- 5. Projectiles (Thrown Ninja Stars & Charged Power Balls!) ---
    var playerSwinging = isPlayerAttackSwinging(p);
    for (var pi = state.projectiles.length - 1; pi >= 0; pi--) {
        var pr = state.projectiles[pi];
        var prevX = pr.x;
        pr.x += pr.vx;
        if (pr.gravity) {
            pr.vy += pr.gravity;
        }
        pr.y += pr.vy;
        pr.spin += (pr.kind === 'fireball') ? 0.28 : (pr.kind === 'ko_body' ? (pr.vx >= 0 ? 0.34 : -0.34) : 0.42);
        pr.life -= 1;

        var removeProj = (pr.life <= 0 || pr.x < state.cameraX - 120 || pr.x > state.cameraX + state.setup.viewWidth + 120 || pr.y < -220);

        // Floor bounce once for storm spread fireballs or deflected stars angled downward!
        if (!removeProj && pr.owner === 'player' && pr.kind === 'fireball' && pr.bounceFloor && pr.y >= GROUND_Y - 12 && pr.vy > 0) {
            pr.y = GROUND_Y - 12;
            pr.vy = -Math.max(3.6, Math.abs(pr.vy) * 0.85);
            pr.bounceFloor = false;
            spawnParticles(state, pr.x, GROUND_Y - 2, 6, '#38d9ff', 1.2, 4.0, 1.5);
            soundEvents.push('block');
        }
        if (!removeProj && pr.owner === 'player' && pr.kind !== 'fireball' && pr.kind !== 'ko_body' && pr.kind !== 'crescent' && pr.kind !== 'jade_blade' && pr.kind !== 'tidal_wave' && pr.kind !== 'clone_kunai' && pr.y >= GROUND_Y - 4 && pr.vy > 0) {
            if (!pr.bounced) {
                pr.y = GROUND_Y - 4;
                pr.vy = -Math.max(4.6, Math.abs(pr.vy) * 0.72);
                pr.bounced = true;
                spawnParticles(state, pr.x, GROUND_Y - 2, 6, '#ffd24c', 1.2, 4.0, 1.5);
                soundEvents.push('block');
            } else {
                spawnParticles(state, pr.x, GROUND_Y - 2, 5, '#f2ede2', 1.0, 3.2, 1.0);
                removeProj = true;
            }
        }

        // KO'd flying enemy bowling body hits other enemies & barrels (and pinball-bounces for Phantom Gale Tier 2!)
        if (!removeProj && pr.kind === 'ko_body') {
            if (fId === 'gale' && getStreakTier(state) >= 2 && (pr.wallBounces || 0) < 2) {
                var kbMinX = state.cameraX + 20;
                var kbMaxX = state.cameraX + state.setup.viewWidth - 20;
                if (pr.x < kbMinX && pr.vx < 0) {
                    pr.x = kbMinX;
                    pr.vx = Math.abs(pr.vx) * 1.05;
                    pr.vy = -3.4;
                    pr.wallBounces = (pr.wallBounces || 0) + 1;
                    pr.life = Math.max(pr.life, 36);
                    spawnRingEffect(state, pr.x, pr.y, '#c66bff', 44);
                    spawnCallout(state, pr.x + 22, pr.y - 24, 'PINBALL!', '#e2a8ff');
                    soundEvents.push('block');
                } else if (pr.x > kbMaxX && pr.vx > 0) {
                    pr.x = kbMaxX;
                    pr.vx = -Math.abs(pr.vx) * 1.05;
                    pr.vy = -3.4;
                    pr.wallBounces = (pr.wallBounces || 0) + 1;
                    pr.life = Math.max(pr.life, 36);
                    spawnRingEffect(state, pr.x, pr.y, '#c66bff', 44);
                    spawnCallout(state, pr.x - 22, pr.y - 24, 'PINBALL!', '#e2a8ff');
                    soundEvents.push('block');
                }
            }
            for (var kbT = state.traps.length - 1; kbT >= 0; kbT--) {
                var kbTr = state.traps[kbT];
                if (kbTr.kind === 'barrel' && kbTr.owner !== 'player' &&
                    Math.abs(pr.x - kbTr.x) < 32 && Math.abs(pr.y - (kbTr.y - 18)) < 38) {
                    spawnParticles(state, kbTr.x, kbTr.y - 18, 12, '#d97828', 2.0, 6.0, 2.0);
                    state.score += 75;
                    soundEvents.push('hit');
                    state.traps.splice(kbT, 1);
                }
            }
            for (var kbE = state.enemies.length - 1; kbE >= 0; kbE--) {
                var kbTarget = state.enemies[kbE];
                if (kbTarget.lastHitProjId === pr.id) continue;
                if (Math.abs(pr.x - kbTarget.x) < 34 * kbTarget.scale &&
                    pr.y + 24 >= kbTarget.y - 78 * kbTarget.scale && pr.y - 24 <= kbTarget.y + 4) {
                    kbTarget.lastHitProjId = pr.id;
                    var kbDir = pr.vx >= 0 ? 1 : -1;
                    var kbDead = damageEnemy(state, kbTarget, pr.damage, kbDir * 8.5, -4.8, 3, false, soundEvents, false);
                    spawnRingEffect(state, kbTarget.x, kbTarget.y - 44, '#ffb830', 54);
                    spawnCallout(state, kbTarget.x, kbTarget.y - 78, 'ENEMY BOWL!', '#ffb830');
                    state.score += 120;
                    if (kbDead) state.enemies.splice(kbE, 1);
                    pr.hitsLeft = (pr.hitsLeft || 1) - 1;
                    if (pr.hitsLeft <= 0) {
                        removeProj = true;
                        break;
                    }
                }
            }
            if (!removeProj && pr.y >= GROUND_Y - 12 && pr.vy > 0) {
                spawnParticles(state, pr.x, GROUND_Y - 6, 10, '#111111', 1.4, 4.8, 1.8);
                removeProj = true;
            }
            if (removeProj) {
                state.projectiles.splice(pi, 1);
            }
            continue;
        }

        if (!removeProj && pr.owner === 'enemy') {
            // If the player's (or a Shadow Clone's!) swing line crosses the star, deflect it BEFORE it can hit!
            var deflectedByClone = false;
            if (pr.kind !== 'fireball' && state.clones && state.clones.length > 0) {
                for (var clp = 0; clp < state.clones.length; clp++) {
                    if (isPlayerAttackSwinging(state.clones[clp]) &&
                        tryDeflectProjectileWithSwing(state, state.clones[clp], pr, prevX, soundEvents)) {
                        deflectedByClone = true;
                        break;
                    }
                }
            }
            if (deflectedByClone) {
                // Deflected by Shadow Clone!
            } else if (playerSwinging && pr.kind !== 'fireball' &&
                tryDeflectProjectileWithSwing(state, p, pr, prevX, soundEvents)) {
                // Now owned by player; continue flying on its new deflected trajectory
            } else if (Math.abs(pr.x - p.x) < 24 && pr.y >= p.y - 76 && pr.y <= p.y - 6) {
                var res = hitPlayer(state, pr.damage, pr.vx >= 0 ? 1 : -1, null, true, soundEvents);
                if (res !== 'ignored') {
                    removeProj = true;
                }
            }
        } else if (!removeProj && pr.owner === 'player' && (pr.kind === 'fireball' || pr.kind === 'crescent' || pr.kind === 'jade_blade' || pr.kind === 'tidal_wave' || pr.kind === 'clone_kunai')) {
            var fbRad = pr.radius || 18;
            var fbColor = pr.kind === 'crescent' || pr.kind === 'clone_kunai' ? (pr.color || '#ff5247')
                : (pr.kind === 'jade_blade' || pr.kind === 'tidal_wave') ? '#1ee6c8'
                : pr.isFire ? (pr.power === 2 ? '#ffd24c' : '#ff6a1a')
                : pr.isWater ? '#1ee6c8'
                : pr.isRasengan ? '#ff5247'
                : (pr.power === 2 ? '#ffd24c' : '#38d9ff');

            // Vaporize incoming enemy projectiles on clash
            for (var oi = state.projectiles.length - 1; oi >= 0; oi--) {
                if (oi === pi) continue;
                var otherPr = state.projectiles[oi];
                if (otherPr.owner === 'enemy' && otherPr.life > 0 &&
                    Math.abs(pr.x - otherPr.x) < fbRad + 14 && Math.abs(pr.y - otherPr.y) < fbRad + 14) {
                    otherPr.life = 0;
                    spawnParticles(state, otherPr.x, otherPr.y, 8, fbColor, 1.8, 5.2, 0.5);
                    state.score += 25;
                    soundEvents.push('block');
                }
            }

            // Smash rolling barrels & falling roof tiles in its path
            for (var bt = state.traps.length - 1; bt >= 0; bt--) {
                var bTr = state.traps[bt];
                if (bTr.kind === 'barrel' && Math.abs(pr.x - bTr.x) < fbRad + 18 &&
                    Math.abs(pr.y - (bTr.y - 18)) < fbRad + 24) {
                    spawnParticles(state, bTr.x, bTr.y - 18, 12, '#d97828', 2.0, 6.0, 2.0);
                    spawnParticles(state, bTr.x, bTr.y - 18, 8, fbColor, 1.5, 5.0, 1.0);
                    state.score += 75;
                    soundEvents.push('hit');
                    state.traps.splice(bt, 1);
                } else if (bTr.kind === 'tile' && bTr.owner !== 'player' && bTr.telegraph <= 0 &&
                    Math.abs(pr.x - bTr.x) < fbRad + 16 && Math.abs(pr.y - bTr.y) < fbRad + 16) {
                    spawnParticles(state, bTr.x, bTr.y, 10, fbColor, 1.8, 5.2, 1.0);
                    state.score += 90;
                    soundEvents.push('block');
                    state.traps.splice(bt, 1);
                }
            }

            // Blast/slice through enemies (multi-hit piercing!)
            for (var ej = state.enemies.length - 1; ej >= 0; ej--) {
                var target = state.enemies[ej];
                if (target.lastHitProjId === pr.id) continue;
                if (Math.abs(pr.x - target.x) < fbRad + 20 * target.scale &&
                    pr.y + fbRad >= target.y - 78 * target.scale && pr.y - fbRad <= target.y) {
                    target.lastHitProjId = pr.id;
                    var kx = (pr.vx >= 0 ? 1 : -1) * (pr.power === 2 ? 12.0 : (pr.kind === 'fireball' ? 9.0 : 7.5));
                    var ky = pr.power === 2 ? -5.5 : -3.5;
                    var hitStopP = pr.kind === 'fireball' ? (pr.power === 2 ? 5 : 4) : 2;
                    var killed = damageEnemy(state, target, pr.damage, kx, ky, hitStopP, pr.power === 2, soundEvents);
                    if (pr.isFire) {
                        if (!killed) target.burnTimer = Math.max(target.burnTimer || 0, 150);
                        spawnFireZone(state, 'ground', target.x, 54, 6, 110);
                    }
                    spawnRingEffect(state, pr.x, pr.y, fbColor, pr.power === 2 ? 68 : 44);
                    spawnParticles(state, pr.x, pr.y, pr.power === 2 ? 14 : 8, fbColor, 2.0, 6.2, 0.8);
                    if (killed) state.enemies.splice(ej, 1);
                    pr.hitsLeft = (pr.hitsLeft || 1) - 1;
                    if (pr.hitsLeft <= 0) {
                        removeProj = true;
                        break;
                    }
                }
            }
        } else if (!removeProj && pr.owner === 'player') {
            // Deflected ninja stars can hit enemies, shatter falling roof tiles, smash barrels, or clash other stars!
            for (var oi2 = state.projectiles.length - 1; oi2 >= 0; oi2--) {
                if (oi2 === pi) continue;
                var oStar = state.projectiles[oi2];
                if (oStar.owner === 'enemy' && oStar.life > 0 &&
                    Math.abs(pr.x - oStar.x) < 20 && Math.abs(pr.y - oStar.y) < 20) {
                    oStar.life = 0;
                    spawnRingEffect(state, pr.x, pr.y, '#ffd24c', 38);
                    spawnParticles(state, pr.x, pr.y, 10, '#ffd24c', 2.0, 5.8, 0.6);
                    spawnCallout(state, pr.x, pr.y - 20, 'CLASH!', '#ffd24c');
                    state.score += 50;
                    soundEvents.push('parry');
                }
            }

            for (var dt = state.traps.length - 1; dt >= 0; dt--) {
                var dTr = state.traps[dt];
                if (dTr.kind === 'barrel' && Math.abs(pr.x - dTr.x) < 26 && Math.abs(pr.y - (dTr.y - 18)) < 26) {
                    spawnParticles(state, dTr.x, dTr.y - 18, 12, '#d97828', 2.0, 6.0, 2.0);
                    spawnParticles(state, dTr.x, dTr.y - 18, 6, '#ffd24c', 1.5, 4.5, 1.0);
                    state.score += 75;
                    soundEvents.push('hit');
                    state.traps.splice(dt, 1);
                    removeProj = true;
                    break;
                } else if (dTr.kind === 'tile' && dTr.telegraph <= 0 &&
                    Math.abs(pr.x - dTr.x) < 26 && Math.abs(pr.y - dTr.y) < 22) {
                    spawnRingEffect(state, dTr.x, dTr.y, '#ffd24c', 42);
                    spawnParticles(state, dTr.x, dTr.y, 12, '#3a3430', 1.8, 5.5, 1.5);
                    spawnParticles(state, dTr.x, dTr.y, 8, '#ffd24c', 1.5, 4.8, 1.0);
                    spawnCallout(state, dTr.x, dTr.y - 22, 'TILE BREAK!', '#ffd24c');
                    state.score += 100;
                    soundEvents.push('heavy_hit');
                    state.traps.splice(dt, 1);
                    removeProj = true;
                    break;
                }
            }

            if (!removeProj) {
                for (var ej2 = state.enemies.length - 1; ej2 >= 0; ej2--) {
                    var target2 = state.enemies[ej2];
                    if (Math.abs(pr.x - target2.x) < 28 * target2.scale &&
                        pr.y >= target2.y - 82 * target2.scale && pr.y <= target2.y + 4) {
                        var killed2 = damageEnemy(state, target2, pr.damage, pr.vx >= 0 ? 7.5 : -7.5, -3.5, 4, true, soundEvents);
                        if (killed2) state.enemies.splice(ej2, 1);
                        removeProj = true;
                        break;
                    }
                }
            }
        }

        if (removeProj) {
            state.projectiles.splice(pi, 1);
        }
    }

    // --- 6. Temple Traps (Deflectable Rolling Barrels & Falling Roof Bricks!) ---
    for (var tk = state.traps.length - 1; tk >= 0; tk--) {
        var trp = state.traps[tk];
        trp.life -= 1;
        var dropTrap = (trp.life <= 0);

        if (trp.kind === 'barrel') {
            var prevBX = trp.x;
            var prevBY = trp.y;
            trp.x += trp.vx;
            if (trp.gravity) {
                trp.vy = (trp.vy || 0) + trp.gravity;
                trp.y += trp.vy;
                if (trp.y >= GROUND_Y && trp.vy > 0) {
                    trp.y = GROUND_Y;
                    if (trp.owner === 'player' && (trp.bounced || 0) < 2) {
                        trp.vy = -Math.max(4.2, Math.abs(trp.vy) * 0.58);
                        trp.bounced = (trp.bounced || 0) + 1;
                        spawnParticles(state, trp.x, GROUND_Y - 2, 8, '#ffb830', 1.4, 4.5, 1.5);
                        soundEvents.push('hit');
                    } else {
                        trp.vy = 0;
                        trp.gravity = 0;
                    }
                }
            }
            trp.angle += trp.vx * 0.06;

            if (trp.owner === 'player') {
                // Player-kicked bowling barrel plows through enemies, other barrels, and enemy stars!
                for (var bp = state.projectiles.length - 1; bp >= 0; bp--) {
                    var bStar = state.projectiles[bp];
                    if (bStar.owner === 'enemy' && bStar.life > 0 &&
                        Math.abs(trp.x - bStar.x) < 26 && Math.abs((trp.y - 18) - bStar.y) < 26) {
                        bStar.life = 0;
                        spawnParticles(state, bStar.x, bStar.y, 7, '#ffb830', 1.6, 4.8, 0.6);
                        state.score += 30;
                        soundEvents.push('block');
                    }
                }
                for (var ob = state.traps.length - 1; ob >= 0; ob--) {
                    if (ob === tk) continue;
                    var oTrap = state.traps[ob];
                    if (oTrap.kind === 'barrel' && oTrap.owner !== 'player' &&
                        Math.abs(trp.x - oTrap.x) < 34 && Math.abs(trp.y - oTrap.y) < 34) {
                        spawnParticles(state, oTrap.x, oTrap.y - 18, 14, '#d97828', 2.0, 6.2, 2.0);
                        spawnParticles(state, oTrap.x, oTrap.y - 18, 8, '#ffd24c', 1.5, 5.0, 1.2);
                        state.score += 75;
                        soundEvents.push('heavy_hit');
                        state.traps.splice(ob, 1);
                        if (ob < tk) tk--;
                    }
                }
                for (var be = state.enemies.length - 1; be >= 0; be--) {
                    var bEn = state.enemies[be];
                    if (bEn.lastHitTrapId === trp.id) continue;
                    if (Math.abs(trp.x - bEn.x) < 30 * bEn.scale &&
                        trp.y >= bEn.y - 78 * bEn.scale && trp.y - 36 <= bEn.y + 4) {
                        bEn.lastHitTrapId = trp.id;
                        var bDir = trp.vx >= 0 ? 1 : -1;
                        var bDead = damageEnemy(state, bEn, 30, bDir * 10.5, -6.4, 4, false, soundEvents, true);
                        spawnRingEffect(state, trp.x, trp.y - 18, '#ffb830', 52);
                        spawnParticles(state, trp.x, trp.y - 18, 10, '#ffb830', 1.8, 5.8, 1.2);
                        if (bDead) state.enemies.splice(be, 1);
                        trp.hitsLeft = (trp.hitsLeft || 1) - 1;
                        if (trp.hitsLeft <= 0) {
                            spawnParticles(state, trp.x, trp.y - 18, 14, '#d97828', 2.0, 6.2, 2.0);
                            dropTrap = true;
                            break;
                        }
                    }
                }
            } else {
                // Enemy/env barrel: player or Shadow Clone swing line kicks it back into a bowling ball!
                var barrelDeflectedByClone = false;
                if (state.clones && state.clones.length > 0) {
                    for (var clb = 0; clb < state.clones.length; clb++) {
                        if (isPlayerAttackSwinging(state.clones[clb]) &&
                            tryDeflectTrapWithSwing(state, state.clones[clb], trp, prevBX, prevBY, soundEvents)) {
                            barrelDeflectedByClone = true;
                            break;
                        }
                    }
                }
                if (barrelDeflectedByClone) {
                    // Deflected by Shadow Clone!
                } else if (playerSwinging && tryDeflectTrapWithSwing(state, p, trp, prevBX, prevBY, soundEvents)) {
                    // Now owned by player; rolls/arcs into enemies!
                } else if (Math.abs(trp.x - p.x) < 28 && p.y > GROUND_Y - 34) {
                    hitPlayer(state, 13, trp.vx >= 0 ? 1 : -1, null, false, soundEvents);
                    spawnParticles(state, trp.x, trp.y - 16, 10, '#d97828', 2.0, 5.5, 2.0);
                    dropTrap = true;
                }
            }

            if (trp.x < state.cameraX - 100 || trp.x > state.cameraX + state.setup.viewWidth + 100) {
                dropTrap = true;
            }
        } else if (trp.kind === 'tile') {
            if (trp.owner === 'player') {
                // Player-deflected falling brick flies like a ninja star with 1 floor bounce!
                trp.x += trp.vx;
                trp.vy += (trp.gravity || 0.16);
                trp.y += trp.vy;
                trp.angle += (trp.vx >= 0 ? 0.34 : -0.34);

                if (trp.x < state.cameraX - 120 || trp.x > state.cameraX + state.setup.viewWidth + 120 || trp.y < -220) {
                    dropTrap = true;
                }

                // 1 floor bounce off the dojo stone!
                if (!dropTrap && trp.y >= GROUND_Y - 6 && trp.vy > 0) {
                    if (!trp.bounced) {
                        trp.y = GROUND_Y - 6;
                        trp.vy = -Math.max(4.8, Math.abs(trp.vy) * 0.68);
                        trp.bounced = 1;
                        spawnParticles(state, trp.x, GROUND_Y - 2, 7, '#ffd24c', 1.4, 4.4, 1.5);
                        soundEvents.push('block');
                    } else {
                        spawnParticles(state, trp.x, GROUND_Y - 4, 8, '#3a3430', 1.4, 4.6, 1.6);
                        soundEvents.push('block');
                        dropTrap = true;
                    }
                }

                // Smash enemy ninja stars in flight
                if (!dropTrap) {
                    for (var tp = state.projectiles.length - 1; tp >= 0; tp--) {
                        var tStar = state.projectiles[tp];
                        if (tStar.owner === 'enemy' && tStar.life > 0 &&
                            Math.abs(trp.x - tStar.x) < 22 && Math.abs(trp.y - tStar.y) < 22) {
                            tStar.life = 0;
                            spawnParticles(state, tStar.x, tStar.y, 8, '#ffd24c', 1.6, 5.0, 0.6);
                            state.score += 40;
                            soundEvents.push('block');
                        }
                    }
                }

                // Hit other traps (barrels or falling bricks)
                if (!dropTrap) {
                    for (var ot = state.traps.length - 1; ot >= 0; ot--) {
                        if (ot === tk) continue;
                        var otherT = state.traps[ot];
                        if (otherT.owner === 'player') continue;
                        if (otherT.kind === 'barrel' && Math.abs(trp.x - otherT.x) < 28 && Math.abs(trp.y - (otherT.y - 18)) < 28) {
                            spawnParticles(state, otherT.x, otherT.y - 18, 12, '#d97828', 2.0, 6.0, 2.0);
                            spawnParticles(state, trp.x, trp.y, 8, '#ffd24c', 1.6, 4.8, 1.0);
                            state.score += 75;
                            soundEvents.push('heavy_hit');
                            state.traps.splice(ot, 1);
                            if (ot < tk) tk--;
                            dropTrap = true;
                            break;
                        } else if (otherT.kind === 'tile' && otherT.telegraph <= 0 &&
                            Math.abs(trp.x - otherT.x) < 26 && Math.abs(trp.y - otherT.y) < 24) {
                            spawnRingEffect(state, otherT.x, otherT.y, '#ffd24c', 42);
                            spawnParticles(state, otherT.x, otherT.y, 12, '#3a3430', 1.8, 5.5, 1.5);
                            spawnCallout(state, otherT.x, otherT.y - 22, 'TILE BREAK!', '#ffd24c');
                            state.score += 100;
                            soundEvents.push('heavy_hit');
                            state.traps.splice(ot, 1);
                            if (ot < tk) tk--;
                            dropTrap = true;
                            break;
                        }
                    }
                }

                // Strike enemies!
                if (!dropTrap) {
                    for (var te = state.enemies.length - 1; te >= 0; te--) {
                        var tEn = state.enemies[te];
                        if (Math.abs(trp.x - tEn.x) < 28 * tEn.scale &&
                            trp.y + 12 >= tEn.y - 80 * tEn.scale && trp.y - 12 <= tEn.y + 4) {
                            var tDir = trp.vx >= 0 ? 1 : -1;
                            var tDead = damageEnemy(state, tEn, trp.damage || 28, tDir * 8.5, -4.2, 4, true, soundEvents, false);
                            spawnParticles(state, trp.x, trp.y, 10, '#3a3430', 1.8, 5.5, 1.5);
                            spawnParticles(state, trp.x, trp.y, 6, '#ffd24c', 1.5, 4.8, 1.0);
                            if (tDead) state.enemies.splice(te, 1);
                            dropTrap = true;
                            break;
                        }
                    }
                }
            } else if (trp.telegraph > 0) {
                trp.telegraph -= 1;
            } else {
                var prevTX = trp.x;
                var prevTY = trp.y;
                trp.vy = Math.min(10.5, trp.vy + (trp.gravity || 0.30));
                trp.y += trp.vy;
                if (playerSwinging && tryDeflectTrapWithSwing(state, p, trp, prevTX, prevTY, soundEvents)) {
                    // Deflected into a player brick projectile!
                } else if (Math.abs(trp.x - p.x) < 26 && trp.y >= p.y - 72 && trp.y <= p.y) {
                    hitPlayer(state, 13, p.x >= trp.x ? 1 : -1, null, false, soundEvents);
                    spawnParticles(state, trp.x, trp.y, 10, '#3a3430', 1.5, 5.0, 1.5);
                    dropTrap = true;
                } else if (trp.y >= GROUND_Y) {
                    spawnParticles(state, trp.x, GROUND_Y - 4, 8, '#3a3430', 1.2, 4.5, 1.8);
                    soundEvents.push('block');
                    dropTrap = true;
                }
            }
        }

        if (dropTrap) {
            state.traps.splice(tk, 1);
        }
    }

    // --- 7. Cosmetics ---
    updateCosmetics(state);

    return { soundEvents: soundEvents };
}

function updateCosmetics(state) {
    for (var i = state.particles.length - 1; i >= 0; i--) {
        var pt = state.particles[i];
        pt.x += pt.vx;
        pt.y += pt.vy;
        if (pt.kind === 'ink') {
            pt.vy += 0.16;
            pt.vx *= 0.96;
        }
        pt.life -= 1;
        if (pt.life <= 0) state.particles.splice(i, 1);
    }

    for (var s = state.slashes.length - 1; s >= 0; s--) {
        state.slashes[s].age += 1;
        if (state.slashes[s].age >= state.slashes[s].maxAge) {
            state.slashes.splice(s, 1);
        }
    }

    for (var c = state.callouts.length - 1; c >= 0; c--) {
        var co = state.callouts[c];
        co.y += co.vy;
        co.life -= 1;
        if (co.life <= 0) state.callouts.splice(c, 1);
    }

    if (state.bolts) {
        for (var b = state.bolts.length - 1; b >= 0; b--) {
            state.bolts[b].life -= 1;
            if (state.bolts[b].life <= 0) state.bolts.splice(b, 1);
        }
    }
}
