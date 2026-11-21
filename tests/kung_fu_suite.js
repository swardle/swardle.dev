// ============================================================================
// tests/kung_fu_suite.js - Shadow Pagoda Zero-Dependency Test Suite
//
// Runs identically in:
//   - Any browser (Windows, macOS, iOS, Android) via kung-fu/tests.html
//   - Command line / CI (Windows, macOS, Linux) via node tests/run_tests.js
// ============================================================================

// Golden hashes locked against deterministic shared/math.js + shared/rng.js +
// kung-fu/js/sim.js + kung-fu/js/ai.js. Verified across all engines.
var KF_GOLDEN_AI_SEED_1_HASH = '0x5652a1aa'; // 0x51A7BEEF, 2400 ticks
var KF_GOLDEN_AI_SEED_2_HASH = '0x62d15b00'; // 0xD3000001, 2400 ticks

function kfAssert(cond, msg) {
    if (!cond) {
        throw new Error(msg || 'Assertion failed');
    }
}

function kfAssertNear(actual, expected, tol, label) {
    var diff = Math.abs(actual - expected);
    if (!(diff <= tol)) {
        throw new Error(label + ': expected ' + expected + ' (+/- ' + tol + '), got ' + actual);
    }
}

function runKungFuTestSuite() {
    var results = [];
    var fingerprintParts = [];

    function runCase(name, fn) {
        var t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        try {
            var detail = fn() || 'OK';
            var t1 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
            results.push({
                name: name,
                passed: true,
                detail: detail,
                ms: Math.round((t1 - t0) * 100) / 100
            });
        } catch (err) {
            var tErr = (typeof performance !== 'undefined') ? performance.now() : Date.now();
            results.push({
                name: name,
                passed: false,
                detail: err && err.message ? err.message : String(err),
                ms: Math.round((tErr - t0) * 100) / 100
            });
        }
    }

    // 1. Input Sampling, Edge-Triggered Jump, Charge-Hold Attack, Touch, & RLE Serialization
    runCase('Input 4-bit mask, edge latches, touch, & RLE round-trip', function () {
        var live = createLiveInput();
        liveInputKeyDown(live, 'ArrowRight', 'ArrowRight', false);
        liveInputKeyDown(live, ' ', 'Space', false);
        liveInputKeyDown(live, 'w', 'KeyW', false);
        var m1 = sampleLiveInput(live);
        kfAssert(m1 === (INPUT_RIGHT | INPUT_ATTACK | INPUT_JUMP), 'Expected RIGHT|ATTACK|JUMP, got ' + m1);

        // Repeat events must not re-fire edge-triggered jump, while holding attack stays held for charge-up
        liveInputKeyDown(live, ' ', 'Space', true);
        liveInputKeyDown(live, 'w', 'KeyW', true);
        var m2 = sampleLiveInput(live);
        kfAssert(m2 === (INPUT_RIGHT | INPUT_ATTACK), 'Expected RIGHT|ATTACK while holding attack, got ' + m2);

        // Releasing attack clears held attack bit
        liveInputKeyUp(live, ' ', 'Space');
        var m2b = sampleLiveInput(live);
        kfAssert(m2b === INPUT_RIGHT, 'Expected RIGHT only after releasing attack, got ' + m2b);

        // Touch multi-button + clear
        liveInputTouchButton(live, 'jump', true);
        liveInputTouchButton(live, 'attack', true);
        var m3 = sampleLiveInput(live);
        kfAssert(m3 === (INPUT_RIGHT | INPUT_JUMP | INPUT_ATTACK), 'Expected touch combo mask, got ' + m3);

        clearLiveInput(live);
        kfAssert(sampleLiveInput(live) === INPUT_NONE, 'clearLiveInput failed to reset state');

        var rec = createInputRecording({ seed: 999, viewWidth: 800, viewHeight: 450, tickRate: 60 });
        rec.frames = [0, 2, 2, 2, 10, 8, 8, 4, 8, 0];
        var json = serializeInputRecording(rec, null);
        var parsed = deserializeInputRecording(json);
        kfAssert(parsed.frames.length === rec.frames.length, 'RLE length mismatch');
        for (var i = 0; i < rec.frames.length; i++) {
            kfAssert(parsed.frames[i] === rec.frames[i], 'RLE mismatch at tick ' + i);
        }
        return '4-bit masks + touch + RLE (' + json.length + ' bytes) OK';
    });

    // 2. 3-Hit Combo Chain, Jump Kick, & Enemy Defeat
    runCase('Player 3-hit combo, jump kick, & enemy KO', function () {
        var sim = createSimState({ seed: 101, viewWidth: 800, viewHeight: 450, tickRate: 60 });
        sim.enemies = [];
        sim.player.x = 200;
        var dummy = spawnEnemy(sim, 'staff', 250, -1); // 42 HP takes 3-hit combo!
        dummy.cooldown = 999;

        // Attack 1 -> chain Attack 2 -> chain Attack 3
        stepSimulation(sim, INPUT_ATTACK);
        kfAssert(sim.player.action === 'attack1', 'Expected attack1, got ' + sim.player.action);
        for (var i = 0; i < 16; i++) stepSimulation(sim, INPUT_NONE);

        stepSimulation(sim, INPUT_ATTACK);
        kfAssert(sim.player.action === 'attack2', 'Expected attack2 chain, got ' + sim.player.action);
        for (var j = 0; j < 20; j++) stepSimulation(sim, INPUT_NONE);

        stepSimulation(sim, INPUT_ATTACK);
        kfAssert(sim.player.action === 'attack3', 'Expected attack3 finisher, got ' + sim.player.action);
        for (var k = 0; k < 35; k++) stepSimulation(sim, INPUT_NONE);

        kfAssert(sim.enemies.length === 0 && sim.enemiesDefeated === 1, 'Expected staff monk defeated by 3-hit combo');
        kfAssert(sim.score > 0, 'Expected positive score after KO');
        kfAssert(sim.player.action === 'idle' && sim.player.onGround, 'Expected player returned to idle on ground');

        // Jump + Air Kick
        stepSimulation(sim, INPUT_JUMP);
        kfAssert(!sim.player.onGround, 'Expected player airborne after jump');
        stepSimulation(sim, INPUT_ATTACK);
        kfAssert(sim.player.action === 'airkick', 'Expected airkick while airborne, got ' + sim.player.action);
        return '3-hit combo KO + airkick verified, score=' + sim.score;
    });

    // 3. Swing Line Deflects Ninja Stars by Timing (Tick-0 Save, Sweet-Spot Return, Upward Arc, & Floor-Skip Ricochet)
    runCase('Swing line deflects ninja stars by timing (return, upward arc, & tile/enemy hits)', function () {
        // Case A: Tick-0 immediate reaction press when star is right in front -> sweet-spot RETURN into thrower!
        var sim = createSimState({ seed: 250, viewWidth: 800, viewHeight: 450, tickRate: 60 });
        sim.enemies = [];
        sim.player.x = 220;
        sim.player.facing = 1;
        var ninja = spawnEnemy(sim, 'knife', 380, -1);
        ninja.cooldown = 999;

        sim.projectiles.push({
            id: allocEntityId(sim), kind: 'knife',
            x: 266, y: GROUND_Y - 46, vx: -6.5, vy: 0,
            owner: 'enemy', sourceEnemyId: ninja.id, damage: 11, spin: 0, life: 80
        });
        // Press ATTACK on the exact tick the star enters center of swing!
        stepSimulation(sim, INPUT_ATTACK);

        kfAssert(sim.player.hp === sim.player.maxHp, 'Player should take no damage on tick-0 attack deflection');
        kfAssert(sim.projectiles.length === 1 && sim.projectiles[0].owner === 'player' && sim.projectiles[0].vx > 0,
            'Expected tick-0 sweet-spot swing to return ninja star toward thrower');

        for (var t = 0; t < 25; t++) stepSimulation(sim, INPUT_NONE);
        kfAssert(ninja.hp < ninja.maxHp || sim.enemies.length === 0,
            'Returned ninja star did not hit the ninja who threw it');

        // Case B: Early tip-of-swing swipe sends star UPWARD in a gravity arc and can shatter a falling roof tile!
        var simUp = createSimState({ seed: 251, viewWidth: 800, viewHeight: 450, tickRate: 60 });
        simUp.enemies = [];
        simUp.player.x = 220;
        simUp.player.facing = 1;
        simUp.projectiles.push({
            id: allocEntityId(simUp), kind: 'knife',
            x: 298, y: GROUND_Y - 46, vx: -6.5, vy: 0,
            owner: 'enemy', damage: 11, spin: 0, life: 80
        });
        stepSimulation(simUp, INPUT_ATTACK);
        kfAssert(simUp.projectiles.length === 1 && simUp.projectiles[0].owner === 'player' &&
            simUp.projectiles[0].vy < -5 && simUp.projectiles[0].gravity > 0,
            'Expected early tip-of-swing to ricochet star upward with arc gravity');

        // Put a falling roof tile directly along its upward path
        var upPr = simUp.projectiles[0];
        simUp.traps.push({
            id: allocEntityId(simUp), kind: 'tile',
            x: upPr.x + upPr.vx * 3, y: upPr.y + upPr.vy * 3 + 2,
            vx: 0, vy: 1, angle: 0, telegraph: 0, active: true, life: 90
        });
        var scoreBeforeTile = simUp.score;
        for (var u = 0; u < 6; u++) stepSimulation(simUp, INPUT_NONE);
        kfAssert(simUp.traps.length === 0 && simUp.score > scoreBeforeTile,
            'Upward ricocheted star should shatter falling roof tile in midair');

        // Case C: Close-range / late swipes produce varied directions including downward floor-skip bounces
        var upwardCount = 0;
        var bounceCount = 0;
        for (var s = 1; s <= 15; s++) {
            var simC = createSimState({ seed: 600 + s, viewWidth: 800, viewHeight: 450, tickRate: 60 });
            simC.enemies = [];
            simC.player.x = 220;
            simC.player.facing = 1;
            simC.projectiles.push({
                id: allocEntityId(simC), kind: 'knife',
                x: 236, y: GROUND_Y - 46, vx: -6.5, vy: 0,
                owner: 'enemy', damage: 11, spin: 0, life: 80
            });
            stepSimulation(simC, INPUT_ATTACK);
            kfAssert(simC.player.hp === simC.player.maxHp, 'Player took damage on close-range swipe (seed ' + s + ')');
            var cPr = simC.projectiles[0];
            kfAssert(cPr && cPr.owner === 'player', 'Close-range swipe failed to deflect star');
            if (cPr.vy < -3) upwardCount++;
            if (cPr.vy > 0) {
                for (var b = 0; b < 15; b++) stepSimulation(simC, INPUT_NONE);
                if (cPr.bounced) bounceCount++;
            }
        }
        kfAssert(upwardCount > 0 && bounceCount > 0,
            'Expected varied close-range deflection angles (up=' + upwardCount + ', floorBounces=' + bounceCount + ')');

        return 'tick-0 return + upward tile break + varied angles (' + upwardCount + ' up, ' + bounceCount + ' floor bounces)';
    });

    // 3b. Deflecting Barrels & Falling Bricks + Heavy-Finisher / KO Enemy Bowling
    runCase('Barrels, falling bricks, & launched enemies bowl into other enemies', function () {
        // A: Swinging at rolling barrel reverses it as a bowling ball that KOs multiple enemies!
        var simB = createSimState({ seed: 310, viewWidth: 800, viewHeight: 450, tickRate: 60 });
        simB.enemies = [];
        simB.player.x = 180;
        simB.player.facing = 1;
        var be1 = spawnEnemy(simB, 'brawler', 330, -1);
        var be2 = spawnEnemy(simB, 'brawler', 410, -1);
        be1.cooldown = 999; be2.cooldown = 999;
        simB.traps.push({
            id: allocEntityId(simB), kind: 'barrel', owner: 'env',
            x: 220, y: GROUND_Y, vx: -4.2, vy: 0, gravity: 0, angle: 0,
            telegraph: 0, active: true, hitsLeft: 4, bounced: 0, life: 200
        });
        stepSimulation(simB, INPUT_ATTACK);
        kfAssert(simB.player.hp === simB.player.maxHp, 'Player should take no damage when deflecting barrel');
        kfAssert(simB.traps.length === 1 && simB.traps[0].owner === 'player' && simB.traps[0].vx > 0,
            'Expected barrel kicked back as player bowling ball');
        for (var bt = 0; bt < 35; bt++) stepSimulation(simB, INPUT_NONE);
        kfAssert(simB.enemiesDefeated === 2, 'Expected bowling barrel to KO both brawlers, got ' + simB.enemiesDefeated);

        // B: Swinging at a falling brick bats it straight into an enemy!
        var simT = createSimState({ seed: 311, viewWidth: 800, viewHeight: 450, tickRate: 60 });
        simT.enemies = [];
        simT.player.x = 180;
        simT.player.facing = 1;
        var te1 = spawnEnemy(simT, 'brawler', 350, -1);
        te1.cooldown = 999;
        simT.traps.push({
            id: allocEntityId(simT), kind: 'tile', owner: 'env',
            x: 222, y: GROUND_Y - 56, vx: 0, vy: 6.0, gravity: 0.85, angle: 0,
            telegraph: 0, active: true, bounced: 0, damage: 28, life: 120
        });
        stepSimulation(simT, INPUT_ATTACK);
        kfAssert(simT.player.hp === simT.player.maxHp, 'Player should take no damage when batting falling brick');
        kfAssert(simT.traps.length === 1 && simT.traps[0].owner === 'player' && simT.traps[0].vx > 0,
            'Expected falling brick deflected toward enemy');
        for (var tt = 0; tt < 30; tt++) stepSimulation(simT, INPUT_NONE);
        kfAssert(simT.enemiesDefeated === 1 || te1.hp < te1.maxHp, 'Deflected brick did not hit enemy');

        // C: 3rd-hit finisher launches enemy into another enemy behind them!
        var simL = createSimState({ seed: 312, viewWidth: 800, viewHeight: 450, tickRate: 60 });
        simL.enemies = [];
        simL.player.x = 180;
        simL.player.facing = 1;
        var front = spawnEnemy(simL, 'staff', 235, -1);
        var back = spawnEnemy(simL, 'brawler', 340, -1);
        front.cooldown = 999; back.cooldown = 999;
        // 3-hit combo on front enemy -> attack3 KOs & launches front into back!
        stepSimulation(simL, INPUT_ATTACK);
        for (var c1 = 0; c1 < 16; c1++) stepSimulation(simL, INPUT_NONE);
        stepSimulation(simL, INPUT_ATTACK);
        for (var c2 = 0; c2 < 20; c2++) stepSimulation(simL, INPUT_NONE);
        stepSimulation(simL, INPUT_ATTACK);
        for (var c3 = 0; c3 < 45; c3++) stepSimulation(simL, INPUT_NONE);
        kfAssert(back.hp < back.maxHp || simL.enemiesDefeated === 2,
            'Expected launched front enemy to bowl into back enemy (back hp=' + back.hp + '/' + back.maxHp + ')');

        return 'barrel 2x KO + brick shot + enemy bowling crash OK';
    });

    // 3b. Charged Street Fighter Power Ball (Hadouken) Launch, Knife Clash, & Super Pierce
    runCase('Attack charge-up launches Power Ball, clashes knives, & pierces enemies', function () {
        var sim = createSimState({ seed: 303, viewWidth: 800, viewHeight: 450, tickRate: 60 });
        sim.enemies = [];
        sim.player.x = 180;
        sim.player.facing = 1;
        var e1 = spawnEnemy(sim, 'brawler', 360, -1);
        var e2 = spawnEnemy(sim, 'brawler', 430, -1);
        e1.cooldown = 999;
        e2.cooldown = 999;

        // Hold attack until CHARGE_READY_TICKS -> enters 'charge' stance
        for (var c = 0; c < CHARGE_READY_TICKS; c++) {
            stepSimulation(sim, INPUT_ATTACK);
        }
        kfAssert(sim.player.action === 'charge', 'Expected charge stance while holding attack, got ' + sim.player.action);
        kfAssert(sim.player.attackChargeTicks === CHARGE_READY_TICKS, 'Expected charge ticks ' + CHARGE_READY_TICKS + ', got ' + sim.player.attackChargeTicks);

        // Place an incoming enemy knife in front of the player
        sim.projectiles.push({
            id: allocEntityId(sim), kind: 'knife',
            x: 270, y: GROUND_Y - 46, vx: -6.0, vy: 0,
            owner: 'enemy', damage: 11, spin: 0, life: 80
        });

        // Release attack -> fires Power Ball!
        stepSimulation(sim, INPUT_NONE);
        kfAssert(sim.player.action === 'hadouken', 'Expected hadouken release pose, got ' + sim.player.action);
        var fb = null;
        for (var pIdx = 0; pIdx < sim.projectiles.length; pIdx++) {
            if (sim.projectiles[pIdx].kind === 'fireball') fb = sim.projectiles[pIdx];
        }
        kfAssert(fb !== null && fb.owner === 'player' && fb.power === 1, 'Expected player tier-1 fireball projectile');

        // Let Power Ball vaporize the knife and blast through both brawlers
        for (var f = 0; f < 45; f++) stepSimulation(sim, INPUT_NONE);
        kfAssert(sim.enemiesDefeated === 2 && sim.enemies.length === 0,
            'Expected Power Ball to defeat both brawlers, defeated=' + sim.enemiesDefeated);

        // Full charge (CHARGE_MAX_TICKS) fires a Super Power Ball (power === 2)
        for (var m = 0; m < CHARGE_MAX_TICKS; m++) {
            stepSimulation(sim, INPUT_ATTACK);
        }
        kfAssert(sim.player.attackChargeTicks === CHARGE_MAX_TICKS, 'Expected max charge cap');
        stepSimulation(sim, INPUT_NONE);
        var superFb = sim.projectiles.length > 0 ? sim.projectiles[sim.projectiles.length - 1] : null;
        kfAssert(superFb && superFb.kind === 'fireball' && superFb.power === 2 && superFb.hitsLeft === 4,
            'Expected tier-2 Super Power Ball with 4 pierce hits');

        return 'charge->hadouken + knife clash + 2x KO + super power ball OK';
    });

    // 3c. Fighting-Game Jump-Cancel (Mid-Attack, Mid-Hadouken, & Hitstop Jump Buffering)
    runCase('Jump-cancel breaks out of attacks, hadouken, & preserves jump during hitstop', function () {
        // A: Mid-attack1 jump-cancel
        var sim = createSimState({ seed: 401, viewWidth: 800, viewHeight: 450, tickRate: 60 });
        sim.enemies = [];
        stepSimulation(sim, INPUT_ATTACK);
        kfAssert(sim.player.action === 'attack1', 'Expected attack1');
        for (var i = 0; i < 3; i++) stepSimulation(sim, INPUT_NONE);
        stepSimulation(sim, INPUT_JUMP | INPUT_RIGHT);
        kfAssert(sim.player.action === 'jump' && !sim.player.onGround && sim.player.vx > 0,
            'Expected immediate jump-cancel out of attack1, got action=' + sim.player.action);

        // B: Mid-hadouken jump-cancel
        var simH = createSimState({ seed: 402, viewWidth: 800, viewHeight: 450, tickRate: 60 });
        simH.enemies = [];
        for (var c = 0; c < CHARGE_READY_TICKS; c++) stepSimulation(simH, INPUT_ATTACK);
        stepSimulation(simH, INPUT_NONE); // release hadouken
        kfAssert(simH.player.action === 'hadouken', 'Expected hadouken');
        for (var h = 0; h < 3; h++) stepSimulation(simH, INPUT_NONE);
        stepSimulation(simH, INPUT_JUMP);
        kfAssert(simH.player.action === 'jump' && !simH.player.onGround,
            'Expected jump-cancel out of hadouken follow-through, got ' + simH.player.action);

        // C: Hitstop jump-buffering (1-tick jump pressed during hitstop is NOT swallowed!)
        var simHS = createSimState({ seed: 403, viewWidth: 800, viewHeight: 450, tickRate: 60 });
        simHS.enemies = [];
        simHS.player.x = 200;
        var target = spawnEnemy(simHS, 'staff', 240, -1);
        target.cooldown = 999;
        stepSimulation(simHS, INPUT_ATTACK);
        var hitstopSeen = false;
        var jumpPressed = false;
        for (var t = 0; t < 12; t++) {
            if (simHS.hitstopTimer > 0 && !jumpPressed) {
                hitstopSeen = true;
                jumpPressed = true;
                stepSimulation(simHS, INPUT_JUMP);
            } else {
                stepSimulation(simHS, INPUT_NONE);
            }
            if (jumpPressed && simHS.player.action === 'jump') break;
        }
        kfAssert(hitstopSeen, 'Expected hitstop to occur on melee hit');
        kfAssert(simHS.player.action === 'jump' && !simHS.player.onGround,
            'Jump pressed during hitstop was dropped! action=' + simHS.player.action);

        return 'attack1 + hadouken + hitstop-buffered jump-cancels OK';
    });

    // 3d. Switch-Direction 360° Hurricane Spin Kick (Omni Strike + Dual-Side Deflect)
    runCase('Switch-direction 360° Hurricane Spin hits & deflects on both sides', function () {
        var sim = createSimState({ seed: 410, viewWidth: 800, viewHeight: 450, tickRate: 60 });
        sim.enemies = [];
        sim.player.x = 300;
        sim.player.facing = 1;
        var eLeft = spawnEnemy(sim, 'staff', 240, 1);
        var eRight = spawnEnemy(sim, 'staff', 360, -1);
        eLeft.cooldown = 999;
        eRight.cooldown = 999;

        // Incoming ninja star from behind (left) & barrel from ahead (right)
        sim.projectiles.push({
            id: allocEntityId(sim), kind: 'knife',
            x: 248, y: GROUND_Y - 46, vx: 6.5, vy: 0,
            owner: 'enemy', damage: 11, spin: 0, life: 80
        });
        sim.traps.push({
            id: allocEntityId(sim), kind: 'barrel', owner: 'env',
            x: 350, y: GROUND_Y, vx: -4.2, vy: 0, gravity: 0, angle: 0,
            telegraph: 0, active: true, hitsLeft: 4, bounced: 0, life: 200
        });

        // Flip direction (facing Right -> press Left + Attack) -> 360° Hurricane Spin Kick!
        stepSimulation(sim, INPUT_LEFT | INPUT_ATTACK);
        kfAssert(sim.player.action === 'spin', 'Expected spin on direction-flip + attack, got ' + sim.player.action);
        kfAssert(sim.projectiles.length === 1 && sim.projectiles[0].owner === 'player' && sim.projectiles[0].vx < 0,
            'Expected star from behind to be deflected back left on spin');
        kfAssert(sim.traps.length === 1 && sim.traps[0].owner === 'player' && sim.traps[0].vx > 0,
            'Expected barrel from ahead to be bowled back right on spin');
        for (var t = 0; t < 8; t++) stepSimulation(sim, INPUT_NONE);

        kfAssert(sim.player.hp === sim.player.maxHp, 'Player should take no damage during 360° spin deflect');
        kfAssert(eLeft.hp < eLeft.maxHp && eRight.hp < eRight.maxHp,
            'Expected 360° spin to strike enemies on BOTH sides (L=' + eLeft.hp + ', R=' + eRight.hp + ')');

        return 'omni spin hit L+R + dual-side star/barrel deflect OK';
    });

    // 3e. All 5 Playable Fighters Live Streak Skills (5-Hit Tier 1 & 10-Hit Tier 2)
    runCase('All 5 playable fighters trigger unique Tier 1 (5+) & Tier 2 (10+) streak skills', function () {
        // 1. SHADOW RONIN: 1 clone (3+) -> 2 clones (5+) -> 3 clones (10+) + Substitution Jutsu!
        var sShadow = createSimState({ seed: 501, fighterId: 'shadow' });
        sShadow.enemies = [];
        sShadow.comboCount = 3; sShadow.comboDecayTimer = 150; sShadow.streakTier = 0;
        sShadow.player.x = 200;
        var shEn = spawnEnemy(sShadow, 'boss', 320, -1);
        shEn.cooldown = 999;
        // Player stands completely still — autonomous clone #1 should summon & fight on its own!
        for (var sc1 = 0; sc1 < 55; sc1++) stepSimulation(sShadow, INPUT_NONE);
        kfAssert(sShadow.clones.length >= 1, 'Shadow Ronin should summon clone #1 at 3+ hits, got ' + sShadow.clones.length);
        kfAssert(shEn.hp < shEn.maxHp, 'Autonomous Shadow Clone failed to attack enemy on its own');
        // Upgrade to 10+ hits -> 3 autonomous Shadow Clones!
        sShadow.comboCount = 10; sShadow.comboDecayTimer = 150; sShadow.streakTier = 2;
        stepSimulation(sShadow, INPUT_NONE);
        kfAssert(sShadow.clones.length === 3, 'Shadow Ronin Tier 2 should have 3 autonomous clones, got ' + sShadow.clones.length);
        // Substitution Jutsu: taking a hit with 2+ clones sacrifices 1 clone instead of losing HP!
        var hpBeforeSub = sShadow.player.hp;
        hitPlayer(sShadow, 25, -1, null, false, []);
        kfAssert(sShadow.player.hp === hpBeforeSub && sShadow.clones.length === 2,
            'Shadow Ronin Substitution should sacrifice 1 clone and block damage');

        // 2. DRAGON FIST: Rising Dragon Uppercut + Meteor Dive Slam (10+)
        var sDragon = createSimState({ seed: 502, fighterId: 'dragon' });
        sDragon.enemies = [];
        sDragon.comboCount = 10; sDragon.comboDecayTimer = 150; sDragon.streakTier = 2;
        sDragon.player.x = 200;
        sDragon.player.comboStep = 2; sDragon.player.comboWindow = 20;
        var drEn = spawnEnemy(sDragon, 'boss', 300, -1);
        drEn.cooldown = 999;
        stepSimulation(sDragon, INPUT_ATTACK);
        kfAssert(sDragon.player.action === 'dragon_upper' && !sDragon.player.onGround,
            'Dragon Fist Tier 2 3rd hit should launch dragon_upper');
        kfAssert(sDragon.flames.length >= 1 && sDragon.flames[0].kind === 'pillar',
            'Dragon Fist Tier 2 dragon_upper should erupt a Fire Pillar');
        for (var dt = 0; dt < 20 && (sDragon.hitstopTimer > 0 || sDragon.player.actionTick < 9); dt++) {
            stepSimulation(sDragon, INPUT_NONE);
        }
        stepSimulation(sDragon, INPUT_ATTACK);
        kfAssert(sDragon.player.action === 'divekick', 'Dragon Fist Tier 2 air attack should be divekick, got ' + sDragon.player.action);
        var drHpBefore = drEn.hp;
        for (var dl = 0; dl < 25; dl++) stepSimulation(sDragon, INPUT_NONE);
        kfAssert(drEn.hp < drHpBefore && drEn.burnTimer > 0, 'Dragon Fist Meteor Dive should damage & ignite nearby enemy');

        // 3. THUNDER MONK: Chain-Lightning (5+) + Sky Thunderbolts & 2x Charge Triple Storm Hadouken (10+)
        var sThunder = createSimState({ seed: 503, fighterId: 'thunder' });
        sThunder.enemies = [];
        sThunder.comboCount = 10; sThunder.comboDecayTimer = 150; sThunder.streakTier = 2;
        sThunder.player.x = 200;
        var th1 = spawnEnemy(sThunder, 'boss', 245, -1);
        var th2 = spawnEnemy(sThunder, 'boss', 380, -1);
        th1.cooldown = 999; th2.cooldown = 999;
        stepSimulation(sThunder, INPUT_ATTACK);
        for (var tt = 0; tt < 10; tt++) stepSimulation(sThunder, INPUT_NONE);
        kfAssert(th2.hp < th2.maxHp, 'Thunder Monk chain-lightning should arc to distant enemy');
        // Sky Thunderbolts on Tier 2 finisher / spin!
        stepSimulation(sThunder, INPUT_LEFT | INPUT_ATTACK);
        var sawSkyBolt = false;
        for (var sb = 0; sb < sThunder.bolts.length; sb++) {
            if (sThunder.bolts[sb].isSky) sawSkyBolt = true;
        }
        kfAssert(sawSkyBolt, 'Thunder Monk Tier 2 spin should call down Sky Thunderbolts');
        // Fast 2x charge -> ready in half the ticks & launches 3 storm fireballs!
        sThunder.player.x = 80;
        sThunder.player.action = 'idle'; sThunder.player.actionTick = 0;
        sThunder.hitstopTimer = 0;
        for (var tc = 0; tc < Math.ceil(CHARGE_READY_TICKS / 2); tc++) stepSimulation(sThunder, INPUT_ATTACK);
        kfAssert(sThunder.player.attackChargeTicks >= CHARGE_READY_TICKS,
            'Thunder Monk Tier 2 should charge at 2x speed, got ' + sThunder.player.attackChargeTicks);
        stepSimulation(sThunder, INPUT_NONE);
        var fbCount = 0;
        for (var tp = 0; tp < sThunder.projectiles.length; tp++) {
            if (sThunder.projectiles[tp].kind === 'fireball') fbCount++;
        }
        kfAssert(fbCount === 3, 'Thunder Monk Tier 2 should fire 3 Storm Hadouken spheres, got ' + fbCount);

        // 4. LOTUS BLADE: Orbiting Blades (5+) + Shuriken Fan (10+)
        var sLotus = createSimState({ seed: 504, fighterId: 'lotus' });
        sLotus.enemies = [];
        sLotus.comboCount = 10; sLotus.comboDecayTimer = 150; sLotus.streakTier = 2;
        sLotus.player.x = 200;
        var ltEn = spawnEnemy(sLotus, 'boss', 252, -1);
        ltEn.cooldown = 999;
        for (var lo = 0; lo < 30; lo++) stepSimulation(sLotus, INPUT_NONE);
        kfAssert(ltEn.hp < ltEn.maxHp, 'Lotus Blade orbiting ink blades should slice nearby enemy automatically');
        stepSimulation(sLotus, INPUT_LEFT | INPUT_ATTACK); // spin -> omni water blade fan + tidal waves!
        var jadeCount = 0;
        var waveCount = 0;
        for (var lp = 0; lp < sLotus.projectiles.length; lp++) {
            if (sLotus.projectiles[lp].kind === 'jade_blade') jadeCount++;
            if (sLotus.projectiles[lp].kind === 'tidal_wave') waveCount++;
        }
        kfAssert(jadeCount >= 3 && waveCount >= 2, 'Tide Lotus Tier 2 spin should launch blade fan + tidal waves');

        // 5. PHANTOM GALE: Faster base movement + Early Flash-Step (3+/5+ hits) + Pinball Blitz (10+ hits)
        var sGale = createSimState({ seed: 505, fighterId: 'gale' });
        sGale.enemies = [];
        sGale.player.x = 200;
        stepSimulation(sGale, INPUT_RIGHT);
        kfAssert(sGale.player.vx > PLAYER_SPEED * 1.15,
            'Phantom Gale should run faster than baseline speed, got vx=' + sGale.player.vx);
        // Early Flash-Step at 3 hits on attack3, AND combo Flash-Step at 5 hits on attack2!
        sGale.comboCount = 5; sGale.comboDecayTimer = 150; sGale.streakTier = 1;
        sGale.player.comboStep = 1; sGale.player.comboWindow = 20;
        stepSimulation(sGale, INPUT_ATTACK); // attack2 -> early Tier-1 Sonic Flash-Step + Wind Cyclone!
        kfAssert(sGale.player.action === 'attack2' && sGale.player.invulnTimer >= 3 && sGale.player.vx > 10,
            'Phantom Gale Tier 1 (5+ hits) attack2 should trigger Flash-Step Dash');
        kfAssert(sGale.flames.length >= 1 && sGale.flames[0].kind === 'cyclone',
            'Phantom Gale Sonic Flash-Step should spawn a Razor Wind Cyclone');
        kfAssert(sGale.player.maxHp === 175, 'Phantom Gale glass-cannon maxHp should be 175');

        // 6. Active-Zone Enemy Softlock Guard: retreating knife ninja stays inside locked zone!
        var sZone = createSimState({ seed: 506, fighterId: 'shadow' });
        sZone.enemies = [];
        sZone.zoneActive = true;
        sZone.zoneLockMinX = 400;
        sZone.zoneLockMaxX = 1200;
        sZone.cameraX = 400;
        sZone.player.x = 500;
        var zNinja = spawnEnemy(sZone, 'knife', 440, 1);
        zNinja.enteredZone = true;
        for (var zn = 0; zn < 45; zn++) stepSimulation(sZone, INPUT_NONE);
        kfAssert(zNinja.x >= sZone.zoneLockMinX + 19 && zNinja.x <= sZone.zoneLockMaxX - 19,
            'Knife ninja escaped locked zone (x=' + zNinja.x + ')');
        // Tier 2 (10+ hits) -> Pinball Super-Bowling wall ricochet!
        sGale.comboCount = 10; sGale.comboDecayTimer = 150; sGale.streakTier = 2;
        sGale.player.x = 680; sGale.player.action = 'idle'; sGale.player.actionTick = 0;
        sGale.player.comboStep = 0; sGale.player.comboWindow = 0; sGale.player.attackHeld = false;
        sGale.cameraX = 0;
        var gaEn = spawnEnemy(sGale, 'staff', 725, -1);
        gaEn.cooldown = 999;
        stepSimulation(sGale, INPUT_ATTACK); // Tier 2 jab launches & pinball-bounces!
        var sawBounce = false;
        for (var gb = 0; gb < 25; gb++) {
            stepSimulation(sGale, INPUT_NONE);
            if (gaEn.wallBounces > 0) sawBounce = true;
        }
        kfAssert(sawBounce, 'Phantom Gale Tier 2 should pinball-bounce launched enemy off camera edge');

        return 'all 5 fighters (shadow/dragon/thunder/lotus/gale) Tier 1+2 skills verified';
    });

    // 4. Replay Ring Buffer Wraparound, Blending, & Play-From-Here Restore
    runCase('Replay ring buffer wraparound & Play-From-Here restore', function () {
        var setup = { seed: 424242, viewWidth: 800, viewHeight: 450, tickRate: 60 };
        var ring = createReplayBuffer(50);
        var sim = createSimState(setup);
        var inputs = [];
        var hashes = [];

        pushReplayFrame(ring, sim);
        hashes.push(hashSimState(sim));

        for (var i = 0; i < 120; i++) {
            var m = (i % 11 === 0) ? INPUT_ATTACK : ((i % 23 === 0) ? (INPUT_RIGHT | INPUT_JUMP) : INPUT_RIGHT);
            inputs.push(m);
            var stepRes = stepSimulation(sim, m);
            pushReplayFrame(ring, sim, m, stepRes);
            hashes.push(hashSimState(sim));
        }

        kfAssert(getReplayLength(ring) === 50, 'Ring buffer should cap at 50');
        kfAssert(getReplayEntry(ring, 0).tick === 71, 'Oldest tick expected 71');
        kfAssert(getReplayEntry(ring, 49).tick === 120, 'Newest tick expected 120');
        kfAssert(getReplayEntry(ring, 49).renderFrame.inputMask === inputs[119], 'Replay frame missing recorded inputMask');

        // Sub-frame blend sanity check (including preserved inputMask)
        var midBlend = sampleBlendedReplayFrame(ring, 24.5);
        kfAssert(midBlend && Number.isFinite(midBlend.player.x) && Number.isFinite(midBlend.cameraX), 'Invalid blended frame');
        kfAssert(typeof midBlend.inputMask === 'number', 'Blended frame missing inputMask');

        // Play From Here restore
        var snap = getReplayEntry(ring, 20);
        var resumed = cloneSimState(snap.simSnapshot);
        kfAssert(resumed.tick === 91, 'Restored snapshot tick expected 91');
        truncateReplayAfter(ring, 20);
        kfAssert(getReplayLength(ring) === 21, 'Truncated length expected 21');

        for (var t = 91; t < 120; t++) {
            stepSimulation(resumed, inputs[t]);
        }
        kfAssert(hashSimState(resumed) === hashes[120], 'Restored sim diverged from original timeline');
        return 'tick 91 -> 120 restored hash=' + formatHexHash(hashes[120]);
    });

    // 5. Dev Determinism Logger Divergence Pinpointing
    runCase('Dev determinism logger pinpoints first divergent tick', function () {
        var setup = { seed: 0x22334455, viewWidth: 800, viewHeight: 450, tickRate: 60 };
        var sim = createSimState(setup);
        var rec = createInputRecording(setup);
        var ai = createAiState();
        var logger = {
            enabled: true, entries: [], hashes: [],
            expectedCheckpoints: null, firstMismatch: null, lastHash: 0
        };
        logDeterminismTick(logger, sim, INPUT_NONE);

        for (var t = 0; t < 140 && !sim.isGameOver; t++) {
            var mask = computeAiInput(ai, sim);
            rec.frames.push(mask);
            stepSimulation(sim, mask);
            logDeterminismTick(logger, sim, mask);
        }

        var checkpoints = exportDevCheckpoints(logger, rec.frames.length);
        var json = serializeInputRecording(rec, checkpoints);
        var clean = deserializeInputRecording(json);
        kfAssert(runFastDeterminismVerify(clean).ok, 'Baseline 140-tick checkpoint verify failed');

        var tampered = deserializeInputRecording(json);
        tampered.devCheckpoints.hashes[60] = (tampered.devCheckpoints.hashes[60] ^ 1) >>> 0;
        var res = runFastDeterminismVerify(tampered);
        kfAssert(!res.ok && res.mismatch && res.mismatch.tick === 60, 'Expected divergence pinpointed at tick 60');
        return 'clean PASS + pinpointed tampered tick 60';
    });

    // 6. Full AI Integration Test (Seed 1 & Seed 2)
    runCase('AI Integration Test (Seed 0x51A7BEEF, 2400 ticks)', function () {
        var res = runAiIntegrationTest({ seed: 0x51A7BEEF, ticks: 2400 });
        kfAssert(res.ok, 'AI Integration Test failed: ' + JSON.stringify(res.checks));
        if (KF_GOLDEN_AI_SEED_1_HASH !== null) {
            kfAssert(res.finalHash === KF_GOLDEN_AI_SEED_1_HASH,
                'Cross-engine drift! Expected ' + KF_GOLDEN_AI_SEED_1_HASH + ', got ' + res.finalHash);
        }
        fingerprintParts.push('kf_ai1=' + res.finalHash);
        return 'score=' + res.score + ' floor=' + res.floor + ' hash=' + res.finalHash;
    });

    runCase('AI Integration Test (Seed 0xD3000001, 2400 ticks)', function () {
        var res = runAiIntegrationTest({ seed: 0xD3000001, ticks: 2400 });
        kfAssert(res.ok, 'AI Integration Test failed: ' + JSON.stringify(res.checks));
        if (KF_GOLDEN_AI_SEED_2_HASH !== null) {
            kfAssert(res.finalHash === KF_GOLDEN_AI_SEED_2_HASH,
                'Cross-engine drift! Expected ' + KF_GOLDEN_AI_SEED_2_HASH + ', got ' + res.finalHash);
        }
        fingerprintParts.push('kf_ai2=' + res.finalHash);
        return 'score=' + res.score + ' floor=' + res.floor + ' hash=' + res.finalHash;
    });

    // 7. Multi-Seed Self-Play Bug Hunt (5 seeds x 1200 ticks: invariants + saved input determinism)
    runCase('Multi-seed Self-Play bug-hunt integration test (5 seeds)', function () {
        var hunt = runSelfPlayBugHunt([0x1001, 0x2002, 0x3003, 0x4004, 0x5005], 1200);
        kfAssert(hunt.ok, 'Bug detected on seed ' + hunt.failedSeed + ': ' + JSON.stringify(hunt.checks));
        return hunt.seedsRun + ' seeds x ' + hunt.ticksPerSeed + ' ticks clean (KOs=' +
            hunt.totalKOs + ', parries=' + hunt.totalParries + ', maxFloor=' + hunt.maxFloor + ')';
    });

    // 8. Cross-Device Responsive Viewport Math (Desktop / iOS Portrait / Android Landscape / 3x Retina)
    runCase('Cross-device portrait & landscape viewport scaling', function () {
        if (typeof computeViewportTransform !== 'function') {
            return 'skipped (render.js not loaded)';
        }
        var screens = [
            { name: 'Desktop 16:9',      cw: 1120, ch: 630,  reserve: 0 },
            { name: 'iPhone Portrait',   cw: 390,  ch: 844,  reserve: 148 },
            { name: 'Android Landscape', cw: 915,  ch: 412,  reserve: 0 },
            { name: 'iPhone 3x Portrait',cw: 1170, ch: 2532, reserve: 444 }
        ];
        for (var i = 0; i < screens.length; i++) {
            var s = screens[i];
            var vp = computeViewportTransform(s.cw, s.ch, WORLD_VIEW_W, WORLD_VIEW_H, s.reserve);
            kfAssert(vp.scale > 0 && Number.isFinite(vp.scale), s.name + ' invalid scale');
            kfAssert(vp.drawW <= s.cw + 1e-6 && vp.drawH <= (s.ch - s.reserve) + 1e-6, s.name + ' overflows usable bounds');
            kfAssertNear(vp.drawW / vp.drawH, WORLD_VIEW_W / WORLD_VIEW_H, 1e-6, s.name + ' aspect ratio');
        }
        return screens.length + ' portrait/landscape viewports verified';
    });

    var passedCount = 0;
    for (var r = 0; r < results.length; r++) {
        if (results[r].passed) passedCount++;
    }

    return {
        ok: passedCount === results.length,
        passed: passedCount,
        total: results.length,
        results: results,
        fingerprint: fingerprintParts.join(' | ')
    };
}
