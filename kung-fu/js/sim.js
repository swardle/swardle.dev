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
var PARRY_WINDOW_TICKS = 11;
var COUNTER_WINDOW     = 34;
var CHARGE_VISUAL_TICKS = 12;
var CHARGE_READY_TICKS  = 34;
var CHARGE_MAX_TICKS    = 62;

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
    attack1: { dur: 16, start: 4, end: 9,  reach: 70,  dmg: 12, kx: 4.5, ky: -1.5, stop: 2, lunge: 2.2 },
    attack2: { dur: 19, start: 5, end: 11, reach: 84,  dmg: 16, kx: 6.2, ky: -2.2, stop: 3, lunge: 3.4 },
    attack3: { dur: 25, start: 7, end: 14, reach: 96,  dmg: 24, kx: 10.5, ky: -6.5, stop: 5, lunge: 4.8 },
    airkick: { dur: 20, start: 3, end: 14, reach: 82,  dmg: 18, kx: 7.5, ky: -3.0, stop: 3, lunge: 2.8 },
    counter: { dur: 22, start: 3, end: 11, reach: 112, dmg: 32, kx: 12.0, ky: -6.0, stop: 6, lunge: 6.5 }
};

function allocEntityId(state) {
    var id = state.nextEntityId;
    state.nextEntityId = (state.nextEntityId + 1) >>> 0;
    return id;
}

function createPlayer(state) {
    return {
        id: allocEntityId(state),
        x: 160,
        y: GROUND_Y,
        vx: 0,
        vy: 0,
        facing: 1,
        onGround: true,
        hp: PLAYER_MAX_HP,
        maxHp: PLAYER_MAX_HP,
        alive: true,
        action: 'idle',
        actionTick: 0,
        actionDuration: 0,
        swingId: 0,
        comboStep: 0,
        comboWindow: 0,
        attackBuffer: 0,
        jumpBuffer: 0,
        parryCounterTimer: 0,
        blockHeldTicks: 0,
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

    var state = {
        setup: {
            seed: seed,
            viewWidth: viewW,
            viewHeight: viewH,
            tickRate: tickRate
        },
        tick: 0,
        rng: createRng(seed),
        nextEntityId: 1,
        score: 0,
        comboCount: 0,
        comboDecayTimer: 0,
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
        trapCooldown: 150,
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
        callouts: []
    };

    state.player = createPlayer(state);
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
            tickRate: state.setup.tickRate
        },
        tick: state.tick,
        rng: cloneRng(state.rng),
        nextEntityId: state.nextEntityId,
        score: state.score,
        comboCount: state.comboCount,
        comboDecayTimer: state.comboDecayTimer,
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
            id: p.id, x: p.x, y: p.y, vx: p.vx, vy: p.vy,
            facing: p.facing, onGround: p.onGround,
            hp: p.hp, maxHp: p.maxHp, alive: p.alive,
            action: p.action, actionTick: p.actionTick, actionDuration: p.actionDuration,
            swingId: p.swingId, comboStep: p.comboStep, comboWindow: p.comboWindow,
            attackBuffer: p.attackBuffer, jumpBuffer: p.jumpBuffer,
            parryCounterTimer: p.parryCounterTimer, blockHeldTicks: p.blockHeldTicks,
            attackHeld: p.attackHeld, attackChargeTicks: p.attackChargeTicks,
            invulnTimer: p.invulnTimer, walkCycle: p.walkCycle, flashTimer: p.flashTimer
        } : null,
        enemies: cloneArrayOfFlatObjects(state.enemies),
        projectiles: cloneArrayOfFlatObjects(state.projectiles),
        traps: cloneArrayOfFlatObjects(state.traps),
        particles: cloneArrayOfFlatObjects(state.particles),
        slashes: cloneArrayOfFlatObjects(state.slashes),
        callouts: cloneArrayOfFlatObjects(state.callouts)
    };
}

// ----------------------------------------------------------------------------
// Entity Spawners
// ----------------------------------------------------------------------------
function spawnEnemy(state, kind, x, facing) {
    var fScale = 1 + (state.floor - 1) * 0.18;
    var hp = 28;
    var speed = 2.35;
    var range = 56;
    var dmg = 10;
    var scoreVal = 100;
    var scale = 1.0;

    if (kind === 'staff') {
        hp = Math.round(42 * fScale);
        speed = 2.05;
        range = 88;
        dmg = 15;
        scoreVal = 180;
        scale = 1.05;
    } else if (kind === 'knife') {
        hp = Math.round(30 * fScale);
        speed = 2.45;
        range = 250;
        dmg = 11;
        scoreVal = 200;
        scale = 0.96;
    } else if (kind === 'boss') {
        hp = Math.round(120 + (state.floor - 1) * 40);
        speed = 2.75;
        range = 86;
        dmg = 18;
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

function spawnSlashArc(state, x, y, facing, style, color) {
    state.slashes.push({
        id: allocEntityId(state),
        x: x,
        y: y,
        facing: facing,
        style: style, // 'jab', 'kick', 'upper', 'air', 'counter', 'enemy'
        color: color,
        age: 0,
        maxAge: style === 'counter' || style === 'upper' ? 13 : 9
    });
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
            x: fromRight ? rightEdge : leftEdge,
            y: GROUND_Y,
            vx: fromRight ? -4.2 : 4.2,
            vy: 0,
            angle: 0,
            telegraph: 0,
            active: true,
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
            x: targetX,
            y: -40,
            vx: 0,
            vy: 0,
            angle: rngRange(state.rng, -0.3, 0.3),
            telegraph: 42,
            active: true,
            life: 120
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

    var p = state.player;
    p.x = 150;
    p.y = GROUND_Y;
    p.vx = 0;
    p.vy = 0;
    p.facing = 1;
    p.onGround = true;
    p.hp = Math.min(p.maxHp, p.hp + 70);
    p.action = 'idle';
    p.actionTick = 0;
    p.actionDuration = 0;
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
// Combat Helpers (Hit, Block, Perfect Parry)
// ----------------------------------------------------------------------------
function startPlayerAttack(state, p, soundEvents) {
    var moveName;
    if (!p.onGround) {
        moveName = 'airkick';
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
        moveName = 'attack3';
        p.comboStep = 0;
        p.comboWindow = 0;
    } else {
        moveName = 'attack1';
        p.comboStep = 1;
        p.comboWindow = 28;
    }

    var spec = PLAYER_MOVES[moveName];
    p.action = moveName;
    p.actionTick = 0;
    p.actionDuration = spec.dur;
    p.swingId = (p.swingId + 1) >>> 0;
    p.vx = p.facing * spec.lunge;
    if (moveName === 'airkick') {
        p.vy = Math.min(p.vy, 1.5);
    }

    var slashStyle = moveName === 'attack1' ? 'jab'
        : moveName === 'attack2' ? 'kick'
        : moveName === 'attack3' ? 'upper'
        : moveName === 'airkick' ? 'air'
        : 'counter';
    var slashColor = (moveName === 'counter' || moveName === 'attack3') ? '#ffb830' : '#d92828';
    spawnSlashArc(state, p.x + p.facing * 24, p.y - 46, p.facing, slashStyle, slashColor);
    soundEvents.push(moveName === 'counter' || moveName === 'attack3' ? 'heavy_swing' : 'swing');
}

function startPlayerHadouken(state, p, chargeTicks, soundEvents) {
    var isMax = chargeTicks >= CHARGE_MAX_TICKS;
    var power = isMax ? 2 : 1;
    var radius = isMax ? 25 : 18;
    var speed = isMax ? 10.6 : 8.8;
    var damage = isMax ? 54 : 34;
    var hitsLeft = isMax ? 4 : 2;

    p.action = 'hadouken';
    p.actionTick = 0;
    p.actionDuration = 18;
    p.comboStep = 0;
    p.comboWindow = 0;
    p.attackBuffer = 0;
    p.vx = -p.facing * (isMax ? 3.2 : 2.0);
    if (!p.onGround) {
        p.vy = Math.min(p.vy, 1.0);
    }

    var spawnX = p.x + p.facing * 36;
    var spawnY = p.y - 46;
    state.projectiles.push({
        id: allocEntityId(state),
        kind: 'fireball',
        x: spawnX,
        y: spawnY,
        vx: p.facing * speed,
        vy: 0,
        owner: 'player',
        damage: damage,
        radius: radius,
        power: power,
        hitsLeft: hitsLeft,
        spin: 0,
        life: 110
    });

    var color = isMax ? '#ffd24c' : '#38d9ff';
    spawnRingEffect(state, spawnX, spawnY, color, isMax ? 78 : 54);
    spawnParticles(state, spawnX, spawnY, isMax ? 18 : 11, color, 2.2, 7.2, 0.8);
    spawnParticles(state, spawnX, spawnY, 6, '#ffffff', 1.5, 4.5, 0.4);
    spawnCallout(state, p.x + p.facing * 12, p.y - 86, isMax ? 'SUPER HADOU!' : 'HADOU!', color);
    state.screenShake = Math.max(state.screenShake, isMax ? 7.5 : 4.2);
    soundEvents.push(isMax ? 'super_fireball' : 'fireball');
}

function damageEnemy(state, e, dmg, kx, ky, stopTicks, fromCounter, soundEvents) {
    e.hp -= dmg;
    e.flashTimer = 8;
    e.vx = kx;
    e.vy = ky;
    if (ky < 0) e.onGround = false;

    // Increment combo & score
    state.comboCount += 1;
    state.comboDecayTimer = 110;
    if (state.comboCount > state.maxCombo) state.maxCombo = state.comboCount;

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
        // Bosses resist brief hitstun during their leaping slam
        if (!(e.kind === 'boss' && e.state === 'leap')) {
            e.state = 'hurt';
            e.stateTick = 0;
            e.stateDur = e.kind === 'boss' ? 14 : 20;
        }
        soundEvents.push(fromCounter || stopTicks >= 4 ? 'heavy_hit' : 'hit');
        return false;
    }
}

// Applies an incoming attack/projectile/trap to the player, resolving Perfect Parry vs Guard vs Hit
function hitPlayer(state, dmg, knockDir, attackerEnemy, isProjectile, soundEvents) {
    var p = state.player;
    if (!p || !p.alive || p.invulnTimer > 0) return 'ignored';

    var isBlocking = (p.action === 'block' || p.action === 'parry');
    if (isBlocking && p.blockHeldTicks <= PARRY_WINDOW_TICKS) {
        // PERFECT PARRY!
        p.action = 'parry';
        p.actionTick = 0;
        p.actionDuration = 14;
        p.parryCounterTimer = COUNTER_WINDOW;
        p.invulnTimer = 14;
        p.attackChargeTicks = 0;
        p.hp = Math.min(p.maxHp, p.hp + 8); // small martial-arts focus heal
        state.parriesLanded += 1;
        state.score += 150;
        state.hitstopTimer = 5;
        state.screenShake = 6.5;

        spawnRingEffect(state, p.x + p.facing * 20, p.y - 46, '#ffd24c', 74);
        spawnParticles(state, p.x + p.facing * 20, p.y - 46, 14, '#ffd24c', 2.5, 7.0, 1.0);
        spawnCallout(state, p.x, p.y - 86, 'PARRY!', '#ffd24c');
        soundEvents.push('parry');

        if (attackerEnemy && attackerEnemy.hp > 0) {
            attackerEnemy.state = 'stunned';
            attackerEnemy.stateTick = 0;
            attackerEnemy.stateDur = attackerEnemy.kind === 'boss' ? 38 : 52;
            attackerEnemy.vx = -knockDir * 5.2;
        }
        return 'parry';
    }

    if (isBlocking) {
        // Standard Guard: 80% damage reduction, small chip pushback
        var chip = Math.max(1, Math.round(dmg * 0.2));
        p.hp = Math.max(1, p.hp - chip);
        p.vx = knockDir * 3.0;
        p.invulnTimer = 10;
        p.attackChargeTicks = 0;
        spawnParticles(state, p.x + p.facing * 18, p.y - 44, 6, '#e8dcc0', 1.5, 4.0, 0.5);
        soundEvents.push('block');
        return 'block';
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
    state.comboCount = 0;
    state.comboDecayTimer = 0;
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

    // Update cosmetic slashes, particles, callouts even during brief hitstop?
    // Keep hitstop crisp: freeze fighter & projectile physics while hitstop > 0!
    if (state.hitstopTimer > 0) {
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
    var block  = (inputMask & INPUT_BLOCK) !== 0;

    // Timers
    if (p.invulnTimer > 0) p.invulnTimer -= 1;
    if (p.flashTimer > 0) p.flashTimer -= 1;
    if (p.comboWindow > 0) p.comboWindow -= 1;
    if (p.parryCounterTimer > 0) p.parryCounterTimer -= 1;
    if (p.attackBuffer > 0) p.attackBuffer -= 1;
    if (p.jumpBuffer > 0) p.jumpBuffer -= 1;
    if (state.comboDecayTimer > 0) {
        state.comboDecayTimer -= 1;
        if (state.comboDecayTimer === 0) state.comboCount = 0;
    }

    var attackJustPressed = attack && !p.attackHeld;
    var attackJustReleased = !attack && p.attackHeld;
    var releasedChargeTicks = p.attackChargeTicks;

    if (attackJustPressed) p.attackBuffer = 8;
    if (jump)              p.jumpBuffer = 8;

    // Track block hold duration for Perfect Parry timing
    if (block) {
        p.blockHeldTicks += 1;
    } else {
        p.blockHeldTicks = 0;
    }

    // Track attack hold duration for Street Fighter Power Ball charge-up
    if (attack && p.action !== 'hurt' && p.action !== 'parry' && p.action !== 'block' && p.action !== 'ko') {
        if (p.attackChargeTicks < CHARGE_MAX_TICKS) {
            p.attackChargeTicks += 1;
            if (p.attackChargeTicks === CHARGE_VISUAL_TICKS) {
                soundEvents.push('charge_start');
            } else if (p.attackChargeTicks === CHARGE_READY_TICKS) {
                spawnRingEffect(state, p.x - p.facing * 6, p.y - 44, '#38d9ff', 44);
                spawnParticles(state, p.x - p.facing * 6, p.y - 44, 8, '#38d9ff', 1.5, 4.2, 0.5);
                soundEvents.push('charge_ready');
            } else if (p.attackChargeTicks === CHARGE_MAX_TICKS) {
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
                       p.action === 'attack3' || p.action === 'airkick' || p.action === 'counter');
    var canReleaseHadouken = attackJustReleased && releasedChargeTicks >= CHARGE_READY_TICKS &&
        p.action !== 'hurt' && p.action !== 'parry' && p.action !== 'block' && p.action !== 'ko';

    if (canReleaseHadouken) {
        if (left && !right) p.facing = -1;
        else if (right && !left) p.facing = 1;
        startPlayerHadouken(state, p, releasedChargeTicks, soundEvents);
    } else if (p.action === 'hurt' || p.action === 'parry' || p.action === 'hadouken') {
        p.actionTick += 1;
        p.vx *= 0.84;
        if (p.actionTick >= p.actionDuration) {
            p.action = p.onGround ? 'idle' : 'jump';
            p.actionTick = 0;
        }
    } else if (isAttacking) {
        p.actionTick += 1;
        var spec = PLAYER_MOVES[p.action];
        if (p.onGround) {
            p.vx *= 0.82;
        }

        // Swat / Deflect incoming enemy ninja stars with melee strikes!
        if (p.actionTick >= 1 && p.actionTick <= spec.end) {
            var swatCenterX = p.x + p.facing * (spec.reach * 0.55);
            var swatHalfW = spec.reach * 0.55 + 16;
            var swatYMin = p.y - 95;
            var swatYMax = p.y + 12;

            for (var pri = state.projectiles.length - 1; pri >= 0; pri--) {
                var inc = state.projectiles[pri];
                if (inc.owner !== 'enemy' || inc.kind === 'fireball' || inc.life <= 0) continue;
                var inFrontX = (inc.x - p.x) * p.facing;
                if (inFrontX >= -14 && Math.abs(inc.x - swatCenterX) <= swatHalfW &&
                    inc.y >= swatYMin && inc.y <= swatYMax) {
                    var isSweetSpot = (p.actionTick >= spec.start && p.actionTick <= spec.start + 2);
                    var isHeavyMove = (p.action === 'attack3' || p.action === 'counter');
                    var sendBack = isSweetSpot || isHeavyMove || (rngNextFloat(state.rng) < 0.45);

                    if (sendBack) {
                        inc.owner = 'player';
                        inc.damage = 28;
                        inc.life = 110;

                        // Aim back at the ninja who threw it if still alive
                        var thrower = null;
                        if (inc.sourceEnemyId) {
                            for (var si = 0; si < state.enemies.length; si++) {
                                if (state.enemies[si].id === inc.sourceEnemyId) {
                                    thrower = state.enemies[si];
                                    break;
                                }
                            }
                        }
                        var retSpeed = Math.max(9.5, Math.abs(inc.vx) * 1.55);
                        if (thrower) {
                            var rdx = thrower.x - inc.x;
                            var rdy = (thrower.y - 46 * thrower.scale) - inc.y;
                            var rDist = detHypot(rdx, rdy);
                            if (rDist > 1e-4) {
                                inc.vx = (rdx / rDist) * retSpeed;
                                inc.vy = (rdy / rDist) * retSpeed;
                            } else {
                                inc.vx = p.facing * retSpeed;
                                inc.vy = 0;
                            }
                        } else {
                            inc.vx = p.facing * retSpeed;
                            inc.vy = 0;
                        }

                        state.score += 100;
                        if (state.hitstopTimer < 3) state.hitstopTimer = 3;
                        state.screenShake = Math.max(state.screenShake, 4.5);
                        spawnRingEffect(state, inc.x, inc.y, '#ffd24c', 52);
                        spawnParticles(state, inc.x, inc.y, 10, '#ffd24c', 2.0, 6.2, 0.8);
                        spawnCallout(state, inc.x, inc.y - 26, 'DEFLECT!', '#ffd24c');
                        soundEvents.push('parry');
                    } else {
                        // Knock / block the ninja star cleanly out of the air
                        state.score += 40;
                        if (state.hitstopTimer < 2) state.hitstopTimer = 2;
                        spawnRingEffect(state, inc.x, inc.y, '#f2ede2', 36);
                        spawnParticles(state, inc.x, inc.y, 8, '#f2ede2', 1.8, 5.2, 0.8);
                        spawnParticles(state, inc.x, inc.y, 4, '#ffd24c', 1.5, 4.2, 0.5);
                        spawnCallout(state, inc.x, inc.y - 22, 'BLOCK!', '#f5ead6');
                        soundEvents.push('block');
                        state.projectiles.splice(pri, 1);
                    }
                }
            }
        }

        // Active hitbox window
        if (p.actionTick >= spec.start && p.actionTick <= spec.end) {
            var hitCenterX = p.x + p.facing * (spec.reach * 0.55);
            var hitHalfW = spec.reach * 0.55;
            var hitYMin = p.y - 95;
            var hitYMax = p.y + 12;

            for (var ei = state.enemies.length - 1; ei >= 0; ei--) {
                var en = state.enemies[ei];
                if (en.lastHitSwingId === p.swingId) continue;
                var dx = Math.abs(en.x - hitCenterX);
                var enTop = en.y - 78 * en.scale;
                if (dx <= hitHalfW + 20 * en.scale && en.y >= hitYMin && enTop <= hitYMax) {
                    en.lastHitSwingId = p.swingId;
                    var dead = damageEnemy(
                        state, en, spec.dmg,
                        p.facing * spec.kx, spec.ky, spec.stop,
                        p.action === 'counter', soundEvents
                    );
                    if (dead) {
                        state.enemies.splice(ei, 1);
                    }
                }
            }

            // Player attacks can also smash rolling barrels!
            for (var ti = state.traps.length - 1; ti >= 0; ti--) {
                var tr = state.traps[ti];
                if (tr.kind === 'barrel' && Math.abs(tr.x - hitCenterX) <= hitHalfW + 18 && Math.abs(tr.y - p.y) < 42) {
                    spawnParticles(state, tr.x, tr.y - 18, 12, '#d97828', 2.0, 6.0, 2.0);
                    spawnParticles(state, tr.x, tr.y - 18, 6, '#111111', 1.5, 4.5, 1.5);
                    state.score += 75;
                    soundEvents.push('hit');
                    state.traps.splice(ti, 1);
                }
            }
        }

        // Allow snappy chain cancel on last 3 frames if attack buffered
        var canChainCancel = p.onGround && p.actionTick >= spec.dur - 3 && p.attackBuffer > 0 &&
            (p.action === 'attack1' || p.action === 'attack2');

        if (canChainCancel) {
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
        // Free movement / Block / Charge / Jump / Attack transitions
        if (left && !right) {
            p.facing = -1;
        } else if (right && !left) {
            p.facing = 1;
        }

        if (block && p.onGround && p.attackBuffer === 0) {
            p.attackChargeTicks = 0;
            p.action = 'block';
            p.vx *= 0.72;
        } else if (p.attackBuffer > 0) {
            p.attackBuffer = 0;
            startPlayerAttack(state, p, soundEvents);
        } else if (p.jumpBuffer > 0 && p.onGround) {
            p.jumpBuffer = 0;
            p.vy = JUMP_VEL;
            p.onGround = false;
            p.action = 'jump';
            p.actionTick = 0;
            spawnParticles(state, p.x, GROUND_Y, 5, '#332b24', 0.8, 2.6, 0.8);
            soundEvents.push('jump');
        } else if (p.onGround && p.attackHeld && p.attackChargeTicks >= CHARGE_VISUAL_TICKS) {
            p.action = 'charge';
            p.actionTick += 1;
            p.vx *= 0.72;
            if (Math.abs(p.vx) < 0.12) p.vx = 0;
        } else {
            var moveSpd = p.onGround ? PLAYER_SPEED : PLAYER_AIR_SPEED;
            if (left && !right) {
                p.vx = -moveSpd;
                if (p.onGround) {
                    p.action = 'run';
                    p.walkCycle += 0.24;
                }
            } else if (right && !left) {
                p.vx = moveSpd;
                if (p.onGround) {
                    p.action = 'run';
                    p.walkCycle += 0.24;
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
        if (!p.onGround && p.action === 'airkick') {
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
            state.trapCooldown = Math.max(135, 250 - state.floor * 18) + rngInt(state.rng, 0, 70);
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

        if (e.state === 'hurt' || e.state === 'stunned') {
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
            e.facing = dirToPlayer;
            if (e.kind === 'knife') {
                // Keep medium distance to throw knives
                if (absDist < 155) {
                    e.vx = -dirToPlayer * e.speed * 0.9;
                    e.walkCycle += 0.2;
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
        e.vy += GRAVITY;
        e.y += e.vy;
        if (e.y >= GROUND_Y) {
            e.y = GROUND_Y;
            e.vy = 0;
            e.onGround = true;
        }

        // Keep enemies inside floor bounds
        if (e.x < 18) e.x = 18;
        if (e.x > FLOOR_LENGTH - 18) e.x = FLOOR_LENGTH - 18;
    }

    // --- 5. Projectiles (Thrown Knives & Charged Power Balls!) ---
    for (var pi = state.projectiles.length - 1; pi >= 0; pi--) {
        var pr = state.projectiles[pi];
        pr.x += pr.vx;
        pr.y += pr.vy;
        pr.spin += (pr.kind === 'fireball') ? 0.28 : 0.42;
        pr.life -= 1;

        var removeProj = (pr.life <= 0 || pr.x < state.cameraX - 120 || pr.x > state.cameraX + state.setup.viewWidth + 120);

        if (!removeProj && pr.owner === 'enemy') {
            if (Math.abs(pr.x - p.x) < 24 && pr.y >= p.y - 76 && pr.y <= p.y - 6) {
                var res = hitPlayer(state, pr.damage, pr.vx >= 0 ? 1 : -1, null, true, soundEvents);
                if (res === 'parry') {
                    // Deflect the knife straight back at high speed!
                    pr.owner = 'player';
                    pr.vx = -pr.vx * 1.45;
                    pr.damage = 28;
                    pr.life = 100;
                } else if (res !== 'ignored') {
                    removeProj = true;
                }
            }
        } else if (!removeProj && pr.owner === 'player' && pr.kind === 'fireball') {
            var fbRad = pr.radius || 18;
            var fbColor = pr.power === 2 ? '#ffd24c' : '#38d9ff';

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

            // Smash rolling barrels in its path
            for (var bt = state.traps.length - 1; bt >= 0; bt--) {
                var bTr = state.traps[bt];
                if (bTr.kind === 'barrel' && Math.abs(pr.x - bTr.x) < fbRad + 18 &&
                    Math.abs(pr.y - (bTr.y - 18)) < fbRad + 24) {
                    spawnParticles(state, bTr.x, bTr.y - 18, 12, '#d97828', 2.0, 6.0, 2.0);
                    spawnParticles(state, bTr.x, bTr.y - 18, 8, fbColor, 1.5, 5.0, 1.0);
                    state.score += 75;
                    soundEvents.push('hit');
                    state.traps.splice(bt, 1);
                }
            }

            // Blast through enemies (multi-hit piercing based on charge power!)
            for (var ej = state.enemies.length - 1; ej >= 0; ej--) {
                var target = state.enemies[ej];
                if (target.lastHitProjId === pr.id) continue;
                if (Math.abs(pr.x - target.x) < fbRad + 20 * target.scale &&
                    pr.y + fbRad >= target.y - 78 * target.scale && pr.y - fbRad <= target.y) {
                    target.lastHitProjId = pr.id;
                    var kx = (pr.vx >= 0 ? 1 : -1) * (pr.power === 2 ? 12.0 : 9.0);
                    var ky = pr.power === 2 ? -5.5 : -4.0;
                    var killed = damageEnemy(state, target, pr.damage, kx, ky, pr.power === 2 ? 5 : 4, pr.power === 2, soundEvents);
                    spawnRingEffect(state, pr.x, pr.y, fbColor, pr.power === 2 ? 68 : 48);
                    spawnParticles(state, pr.x, pr.y, pr.power === 2 ? 14 : 9, fbColor, 2.0, 6.8, 0.8);
                    if (killed) state.enemies.splice(ej, 1);
                    pr.hitsLeft = (pr.hitsLeft || 1) - 1;
                    if (pr.hitsLeft <= 0) {
                        removeProj = true;
                        break;
                    }
                }
            }
        } else if (!removeProj && pr.owner === 'player') {
            for (var ej2 = state.enemies.length - 1; ej2 >= 0; ej2--) {
                var target2 = state.enemies[ej2];
                if (Math.abs(pr.x - target2.x) < 26 * target2.scale &&
                    pr.y >= target2.y - 78 * target2.scale && pr.y <= target2.y) {
                    var killed2 = damageEnemy(state, target2, pr.damage, pr.vx >= 0 ? 7.5 : -7.5, -3.5, 4, true, soundEvents);
                    if (killed2) state.enemies.splice(ej2, 1);
                    removeProj = true;
                    break;
                }
            }
        }

        if (removeProj) {
            state.projectiles.splice(pi, 1);
        }
    }

    // --- 6. Temple Traps ---
    for (var tk = state.traps.length - 1; tk >= 0; tk--) {
        var trp = state.traps[tk];
        trp.life -= 1;
        var dropTrap = (trp.life <= 0);

        if (trp.kind === 'barrel') {
            trp.x += trp.vx;
            trp.angle += trp.vx * 0.06;
            if (Math.abs(trp.x - p.x) < 28 && p.y > GROUND_Y - 34) {
                hitPlayer(state, 13, trp.vx >= 0 ? 1 : -1, null, false, soundEvents);
                spawnParticles(state, trp.x, trp.y - 16, 10, '#d97828', 2.0, 5.5, 2.0);
                dropTrap = true;
            }
            if (trp.x < state.cameraX - 80 || trp.x > state.cameraX + state.setup.viewWidth + 80) {
                dropTrap = true;
            }
        } else if (trp.kind === 'tile') {
            if (trp.telegraph > 0) {
                trp.telegraph -= 1;
            } else {
                trp.vy += 0.85;
                trp.y += trp.vy;
                if (Math.abs(trp.x - p.x) < 26 && trp.y >= p.y - 72 && trp.y <= p.y) {
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
}
