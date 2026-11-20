// ============================================================================
// tests/suite.js - Shared Zero-Dependency Test Suite
//
// Runs identically in:
//   - Any browser (Windows, macOS, iOS, Android) via tests.html
//   - Command line / CI (Windows, macOS, Linux) via node tests/run_tests.js
// ============================================================================

// Golden hashes locked against deterministic js/math.js + js/rng.js + js/sim.js + js/ai.js.
// Must match bit-for-bit across Windows, macOS, Linux, iOS, and Android.
var GOLDEN_MATH_HASH      = '0x1943dfce';
var GOLDEN_AI_SEED_1_HASH = '0x0fd27689'; // 0x51A7BEEF, 2400 ticks
var GOLDEN_AI_SEED_2_HASH = '0xc9dcb374'; // 0xD3000001, 2400 ticks

function vfAssert(cond, msg) {
    if (!cond) {
        throw new Error(msg || 'Assertion failed');
    }
}

function vfAssertNear(actual, expected, tol, label) {
    var diff = Math.abs(actual - expected);
    if (!(diff <= tol)) {
        throw new Error(label + ': expected ' + expected + ' (+/- ' + tol + '), got ' + actual + ' (diff=' + diff + ')');
    }
}

function runSharedTestSuite() {
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

    // 1. Deterministic Cross-Engine Math (js/math.js)
    runCase('Deterministic trig & hypot accuracy', function () {
        var maxSinErr = 0;
        var maxCosErr = 0;
        var maxAtanErr = 0;
        var h = 2166136261 >>> 0;

        for (var i = -720; i <= 720; i += 15) {
            var rad = i * DET_PI / 180.0;
            var s = detSin(rad);
            var c = detCos(rad);
            var sErr = Math.abs(s - Math.sin(rad));
            var cErr = Math.abs(c - Math.cos(rad));
            if (sErr > maxSinErr) maxSinErr = sErr;
            if (cErr > maxCosErr) maxCosErr = cErr;
            h = fnv1aMixFloat64(h, s);
            h = fnv1aMixFloat64(h, c);
        }

        var pairs = [
            [0, 1], [1, 1], [1, 0], [1, -1], [0, -1],
            [-1, -1], [-1, 0], [-1, 1], [3.5, 1.2], [-2.1, 7.4], [-5.0, -0.3]
        ];
        for (var j = 0; j < pairs.length; j++) {
            var y = pairs[j][0];
            var x = pairs[j][1];
            var a = detAtan2(y, x);
            var aErr = Math.abs(a - Math.atan2(y, x));
            if (aErr > maxAtanErr) maxAtanErr = aErr;
            h = fnv1aMixFloat64(h, a);
            h = fnv1aMixFloat64(h, detHypot(x, y));
        }

        vfAssert(maxSinErr < 1e-10, 'detSin error too large: ' + maxSinErr);
        vfAssert(maxCosErr < 1e-10, 'detCos error too large: ' + maxCosErr);
        vfAssert(maxAtanErr < 1e-10, 'detAtan2 error too large: ' + maxAtanErr);
        vfAssertNear(detHypot(3, 4), 5.0, 1e-12, 'detHypot(3,4)');

        var mathHash = formatHexHash(h);
        vfAssert(
            mathHash === GOLDEN_MATH_HASH,
            'Cross-engine math drift! Expected ' + GOLDEN_MATH_HASH + ', got ' + mathHash
        );
        fingerprintParts.push('math=' + mathHash);
        return 'sinErr=' + maxSinErr.toExponential(2) +
            ' atan2Err=' + maxAtanErr.toExponential(2) +
            ' hash=' + mathHash;
    });

    // 2. Seeded PRNG Determinism & Cloning (js/rng.js)
    runCase('PRNG determinism & clone fork', function () {
        var r1 = createRng(123456);
        var r2 = createRng(123456);
        for (var i = 0; i < 200; i++) {
            var a = rngNextUint32(r1);
            var b = rngNextUint32(r2);
            vfAssert(a === b, 'PRNG diverged at step ' + i);
        }
        var fork = cloneRng(r1);
        for (var j = 0; j < 50; j++) {
            vfAssert(rngNextUint32(r1) === rngNextUint32(fork), 'PRNG clone diverged at ' + j);
        }
        var sample = formatHexHash(r1.state);
        fingerprintParts.push('rng=' + sample);
        return '250 draws identical, state=' + sample;
    });

    // 3. Player Spawn Safety (500 seeds)
    runCase('Player never spawns inside central obstacle (500 seeds)', function () {
        for (var s = 1; s <= 500; s++) {
            var st = createSimState({ seed: (s * 9973) >>> 0, worldWidth: 800, worldHeight: 600, tickRate: 60 });
            var p = st.player;
            var obs = st.obstacle;
            var overlaps = (p.x > obs.x - p.r && p.x < obs.x + obs.width + p.r &&
                            p.y > obs.y - p.r && p.y < obs.y + obs.height + p.r);
            vfAssert(!overlaps, 'Player overlapped obstacle on seed ' + s);
        }
        return '500/500 safe spawns';
    });

    // 4. Separated Input Sampling, Edge-Triggered Shoot, & RLE Round-Trip
    runCase('Input bitmask, shoot latch, & RLE serialize/deserialize', function () {
        var live = createLiveInput();
        liveInputKeyDown(live, 'ArrowLeft', 'ArrowLeft', false);
        liveInputKeyDown(live, ' ', 'Space', false);
        var m1 = sampleLiveInput(live);
        vfAssert(m1 === (INPUT_LEFT | INPUT_SHOOT), 'Expected LEFT|SHOOT, got ' + m1);

        // Next tick while still holding Space (OS repeat ignored): shoot must NOT re-trigger
        liveInputKeyDown(live, ' ', 'Space', true);
        var m2 = sampleLiveInput(live);
        vfAssert(m2 === INPUT_LEFT, 'Expected LEFT only on repeat, got ' + m2);

        // Touch multi-button + clear on blur/cancel
        liveInputTouchButton(live, 'thrust', true);
        liveInputTouchButton(live, 'shoot', true);
        var m3 = sampleLiveInput(live);
        vfAssert(m3 === (INPUT_LEFT | INPUT_THRUST | INPUT_SHOOT), 'Expected multi-touch bitmask, got ' + m3);

        clearLiveInput(live);
        vfAssert(sampleLiveInput(live) === INPUT_NONE, 'clearLiveInput did not clear held keys');

        // RLE round-trip
        var rec = createInputRecording({ seed: 777, worldWidth: 800, worldHeight: 600, tickRate: 60 });
        rec.frames = [0, 0, 1, 1, 1, 9, 4, 4, 0, 12];
        var json = serializeInputRecording(rec, null);
        var parsed = deserializeInputRecording(json);
        vfAssert(parsed.frames.length === rec.frames.length, 'RLE length mismatch');
        for (var i = 0; i < rec.frames.length; i++) {
            vfAssert(parsed.frames[i] === rec.frames[i], 'RLE frame mismatch at ' + i);
        }
        return 'bitmasks + touch + RLE (' + json.length + ' bytes) OK';
    });

    // 5. Swept Wall & Central Obstacle Sub-Frame Bounce + Mid-Tick Expiration
    runCase('Swept wall & obstacle bounce sub-frames + slow-mo blending', function () {
        var setup = { seed: 1, worldWidth: 600, worldHeight: 400, tickRate: 60 };
        var sim = createSimState(setup);
        sim.enemies = [];
        sim.player.x = 60;
        sim.player.y = 60;

        // Test A: Bullet bouncing off top outer wall (wall at y=2, start y=5, vy=-7 -> t=3/7, end y=6)
        sim.bullets = [{ id: 901, x: 100, y: 5, vx: 0, vy: -7, r: 2, life: 100, bounces: 2 }];
        var rBuf = createReplayBuffer(30);
        pushReplayFrame(rBuf, sim, null);
        var resWall = stepSimulation(sim, 0);
        pushReplayFrame(rBuf, sim, resWall);

        var wallSub = resWall.entitySubFrames[901];
        vfAssert(wallSub && wallSub.length === 1, 'Expected 1 outer wall bounce sub-frame');
        vfAssertNear(wallSub[0].t, 3 / 7, 1e-6, 'Wall bounce t');
        vfAssertNear(wallSub[0].y, 2.0, 1e-5, 'Wall bounce y');

        var blendedWall = sampleBlendedReplayFrame(rBuf, 3 / 7);
        var bw = null;
        for (var i = 0; i < blendedWall.bullets.length; i++) {
            if (blendedWall.bullets[i].id === 901) bw = blendedWall.bullets[i];
        }
        vfAssert(bw !== null, 'Bullet 901 missing in blended wall frame');
        vfAssertNear(bw.y, 2.0, 1e-4, 'Blended slow-mo bullet at wall contact');

        // Test B: Bullet bouncing off central obstacle top face
        var obs = sim.obstacle;
        var hitY = obs.y - 2; // obstacle top expanded by bullet r=2
        sim.bullets = [{ id: 902, x: obs.x + obs.width / 2, y: hitY - 3, vx: 0, vy: 7, r: 2, life: 100, bounces: 2 }];
        var rBufObs = createReplayBuffer(30);
        pushReplayFrame(rBufObs, sim, null);
        var resObs = stepSimulation(sim, 0);
        pushReplayFrame(rBufObs, sim, resObs);

        var obsSub = resObs.entitySubFrames[902];
        vfAssert(obsSub && obsSub.length === 1, 'Expected 1 obstacle bounce sub-frame');
        vfAssertNear(obsSub[0].t, 3 / 7, 1e-6, 'Obstacle bounce t');
        vfAssertNear(obsSub[0].y, hitY, 1e-4, 'Obstacle bounce y');

        var blendedObs = sampleBlendedReplayFrame(rBufObs, 3 / 7);
        var bo = null;
        for (var j = 0; j < blendedObs.bullets.length; j++) {
            if (blendedObs.bullets[j].id === 902) bo = blendedObs.bullets[j];
        }
        vfAssert(bo !== null, 'Bullet 902 missing in blended obstacle frame');
        vfAssertNear(bo.y, hitY, 1e-4, 'Blended slow-mo bullet at obstacle contact');

        // Test C: Bullet expiring on final bounce (visible before endT, gone after endT)
        sim.bullets = [{ id: 903, x: 100, y: 5, vx: 0, vy: -7, r: 2, life: 100, bounces: 0 }];
        var rBufExp = createReplayBuffer(30);
        pushReplayFrame(rBufExp, sim, null);
        var resExp = stepSimulation(sim, 0);
        pushReplayFrame(rBufExp, sim, resExp);
        vfAssert(sim.bullets.length === 0, 'Expired bullet should be removed');
        vfAssert(!!resExp.entityEndPoints[903], 'Expected mid-tick endPoint for bullet 903');

        var beforeEnd = sampleBlendedReplayFrame(rBufExp, 0.2);
        var afterEnd  = sampleBlendedReplayFrame(rBufExp, 0.6);
        vfAssert(beforeEnd.bullets.length === 1, 'Expiring bullet should draw before endT');
        vfAssert(afterEnd.bullets.length === 0, 'Expiring bullet should vanish after endT');

        return 'wall + obstacle + expiry sub-frames exact (<1e-4 px)';
    });

    // 6. Replay Ring Buffer Wraparound & Play-From-Here Snapshot Restore
    runCase('Replay ring buffer wraparound & Play-From-Here restore', function () {
        var setup = { seed: 424242, worldWidth: 900, worldHeight: 650, tickRate: 60 };
        var ring = createReplayBuffer(50);
        var sim = createSimState(setup);
        var inputs = [];
        var hashes = [];

        pushReplayFrame(ring, sim, null);
        hashes.push(hashSimState(sim));

        for (var i = 0; i < 120; i++) {
            var m = (i % 7 === 0) ? INPUT_SHOOT : (INPUT_THRUST | INPUT_RIGHT);
            inputs.push(m);
            var res = stepSimulation(sim, m);
            pushReplayFrame(ring, sim, res);
            hashes.push(hashSimState(sim));
        }

        vfAssert(getReplayLength(ring) === 50, 'Ring buffer length should cap at 50');
        vfAssert(getReplayEntry(ring, 0).tick === 71, 'Oldest tick expected 71');
        vfAssert(getReplayEntry(ring, 49).tick === 120, 'Newest tick expected 120');

        var snap = getReplayEntry(ring, 20);
        var resumed = cloneSimState(snap.simSnapshot);
        vfAssert(resumed.tick === 91, 'Restored snapshot tick expected 91');
        truncateReplayAfter(ring, 20);
        vfAssert(getReplayLength(ring) === 21, 'Truncated ring length expected 21');

        for (var t = 91; t < 120; t++) {
            stepSimulation(resumed, inputs[t]);
        }
        vfAssert(hashSimState(resumed) === hashes[120], 'Resumed sim hash diverged from original timeline');
        return 'tick 91 -> 120 restored hash=' + formatHexHash(hashes[120]);
    });

    // 7. Dev Determinism Logger & Divergence Detection
    runCase('Dev determinism logger detects exact first divergent tick', function () {
        var setup = { seed: 0x11223344, worldWidth: 800, worldHeight: 600, tickRate: 60 };
        var sim = createSimState(setup);
        var rec = createInputRecording(setup);
        var ai = createAiState();
        var logger = {
            enabled: true,
            entries: [],
            hashes: [],
            expectedCheckpoints: null,
            firstMismatch: null,
            lastHash: 0
        };
        logDeterminismTick(logger, sim, INPUT_NONE);

        for (var t = 0; t < 120 && !sim.isGameOver; t++) {
            var mask = computeAiInput(ai, sim);
            rec.frames.push(mask);
            stepSimulation(sim, mask);
            logDeterminismTick(logger, sim, mask);
        }

        var checkpoints = exportDevCheckpoints(logger, rec.frames.length);
        var json = serializeInputRecording(rec, checkpoints);
        var clean = deserializeInputRecording(json);
        var cleanCheck = runFastDeterminismVerify(clean);
        vfAssert(cleanCheck.ok, 'Baseline 120-tick checkpoint verify should pass');

        var tampered = deserializeInputRecording(json);
        tampered.devCheckpoints.hashes[50] = (tampered.devCheckpoints.hashes[50] ^ 1) >>> 0;

        var check = runFastDeterminismVerify(tampered);
        vfAssert(!check.ok, 'Expected tampered checkpoint to fail');
        vfAssert(check.mismatch && check.mismatch.tick === 50, 'Expected divergence pinpointed at tick 50');
        return 'clean PASS + pinpointed tampered tick 50';
    });

    // 8. Full AI End-to-End Integration Test (Seed 1 & Seed 2 + Cross-Engine Golden Fingerprint)
    runCase('AI Integration Test (Seed 0x51A7BEEF, 2400 ticks)', function () {
        var res = runAiIntegrationTest({ seed: 0x51A7BEEF, ticks: 2400 });
        vfAssert(res.ok, 'AI Integration Test failed: ' + JSON.stringify(res.checks));
        if (GOLDEN_AI_SEED_1_HASH !== null) {
            vfAssert(
                res.finalHash === GOLDEN_AI_SEED_1_HASH,
                'Cross-engine drift! Expected ' + GOLDEN_AI_SEED_1_HASH + ', got ' + res.finalHash
            );
        }
        fingerprintParts.push('ai1=' + res.finalHash);
        return 'score=' + res.score + ' lvl=' + res.level + ' hash=' + res.finalHash;
    });

    runCase('AI Integration Test (Seed 0xD3000001, 2400 ticks)', function () {
        var res = runAiIntegrationTest({ seed: 0xD3000001, ticks: 2400 });
        vfAssert(res.ok, 'AI Integration Test failed: ' + JSON.stringify(res.checks));
        if (GOLDEN_AI_SEED_2_HASH !== null) {
            vfAssert(
                res.finalHash === GOLDEN_AI_SEED_2_HASH,
                'Cross-engine drift! Expected ' + GOLDEN_AI_SEED_2_HASH + ', got ' + res.finalHash
            );
        }
        fingerprintParts.push('ai2=' + res.finalHash);
        return 'score=' + res.score + ' lvl=' + res.level + ' hash=' + res.finalHash;
    });

    // 9. Cross-Device Viewport Letterboxing Math (Desktop / iPhone / Android / 3x Retina)
    runCase('Cross-device viewport letterboxing (Desktop/iOS/Android)', function () {
        if (typeof computeViewportTransform !== 'function') {
            return 'skipped (render.js not loaded)';
        }
        var screens = [
            { name: 'Desktop',       cw: 1000, ch: 800 },
            { name: 'iPhone 14',     cw: 390,  ch: 844 },
            { name: 'Android Land',  cw: 915,  ch: 412 },
            { name: 'iPhone 3x DPR', cw: 1170, ch: 2532 }
        ];
        var worldW = 900;
        var worldH = 640;

        for (var i = 0; i < screens.length; i++) {
            var s = screens[i];
            var vp = computeViewportTransform(s.cw, s.ch, worldW, worldH);
            vfAssert(vp.scale > 0 && Number.isFinite(vp.scale), s.name + ' invalid scale');
            vfAssert(vp.drawW <= s.cw + 1e-6 && vp.drawH <= s.ch + 1e-6, s.name + ' overflows canvas');
            vfAssert(vp.offsetX >= -1e-6 && vp.offsetY >= -1e-6, s.name + ' negative offset');
            vfAssertNear(vp.drawW / vp.drawH, worldW / worldH, 1e-6, s.name + ' aspect ratio');
        }
        return screens.length + ' device viewports verified';
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
