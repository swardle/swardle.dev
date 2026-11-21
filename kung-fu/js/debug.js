// ============================================================================
// kung-fu/js/debug.js - Development-Only Determinism Logger & Verifier (?dev=1)
//
// Zero per-tick allocations when DEV_MODE is false. When ?dev=1 is enabled,
// computes bit-exact FNV-1a hashes over every deterministic simulation field
// (including Float64 IEEE-754 bits with -0 normalized to +0).
// ============================================================================

var DEV_MODE_DEFAULT = false;
var DEV_MODE = DEV_MODE_DEFAULT || (
    typeof window !== 'undefined' &&
    typeof URLSearchParams !== 'undefined' &&
    new URLSearchParams(window.location.search).get('dev') === '1'
);

var _hashFloatBuf = new Float64Array(1);
var _hashUintView = new Uint32Array(_hashFloatBuf.buffer);

function fnv1aMixUint32(hash, val) {
    var v = val >>> 0;
    hash = Math.imul(hash ^ (v & 0xFF), 16777619) >>> 0;
    hash = Math.imul(hash ^ ((v >>> 8) & 0xFF), 16777619) >>> 0;
    hash = Math.imul(hash ^ ((v >>> 16) & 0xFF), 16777619) >>> 0;
    hash = Math.imul(hash ^ ((v >>> 24) & 0xFF), 16777619) >>> 0;
    return hash;
}

function fnv1aMixFloat64(hash, num) {
    _hashFloatBuf[0] = (num === 0) ? 0 : num;
    hash = fnv1aMixUint32(hash, _hashUintView[0]);
    hash = fnv1aMixUint32(hash, _hashUintView[1]);
    return hash;
}

function fnv1aMixString(hash, str) {
    if (!str) return fnv1aMixUint32(hash, 0);
    hash = fnv1aMixUint32(hash, str.length);
    for (var i = 0; i < str.length; i++) {
        hash = fnv1aMixUint32(hash, str.charCodeAt(i));
    }
    return hash;
}

function hashSimState(state) {
    var h = 2166136261 >>> 0;

    h = fnv1aMixUint32(h, state.tick);
    h = fnv1aMixUint32(h, state.rng.state);
    h = fnv1aMixUint32(h, state.nextEntityId);
    h = fnv1aMixString(h, (state.setup && state.setup.fighterId) || 'shadow');
    h = fnv1aMixUint32(h, state.score);
    h = fnv1aMixUint32(h, state.comboCount);
    h = fnv1aMixUint32(h, state.streakTier || 0);
    h = fnv1aMixUint32(h, state.parriesLanded);
    h = fnv1aMixUint32(h, state.enemiesDefeated);
    h = fnv1aMixUint32(h, state.floor);
    h = fnv1aMixUint32(h, state.zoneIndex);
    h = fnv1aMixUint32(h, state.zoneActive ? 1 : 0);
    h = fnv1aMixUint32(h, state.hitstopTimer);
    h = fnv1aMixUint32(h, state.floorClearTimer);
    h = fnv1aMixUint32(h, state.isGameOver ? 1 : 0);
    h = fnv1aMixFloat64(h, state.cameraX);
    h = fnv1aMixFloat64(h, state.screenShake);

    var p = state.player;
    if (p) {
        h = fnv1aMixUint32(h, p.id);
        h = fnv1aMixFloat64(h, p.x);
        h = fnv1aMixFloat64(h, p.y);
        h = fnv1aMixFloat64(h, p.vx);
        h = fnv1aMixFloat64(h, p.vy);
        h = fnv1aMixUint32(h, p.facing > 0 ? 1 : 2);
        h = fnv1aMixUint32(h, p.hp);
        h = fnv1aMixString(h, p.action);
        h = fnv1aMixUint32(h, p.actionTick);
        h = fnv1aMixUint32(h, p.comboStep);
        h = fnv1aMixUint32(h, p.turnWindow || 0);
        h = fnv1aMixUint32(h, p.spinCooldown || 0);
        h = fnv1aMixUint32(h, p.deflectHealCooldown || 0);
        h = fnv1aMixUint32(h, p.subCooldown || 0);
        h = fnv1aMixUint32(h, p.parryCounterTimer);
        h = fnv1aMixUint32(h, p.attackHeld ? 1 : 0);
        h = fnv1aMixUint32(h, p.attackChargeTicks);
        h = fnv1aMixUint32(h, p.invulnTimer);
    }

    h = fnv1aMixUint32(h, (state.afterimages && state.afterimages.length) || 0);
    var clonesList = state.clones || [];
    h = fnv1aMixUint32(h, clonesList.length);
    for (var cl = 0; cl < clonesList.length; cl++) {
        var cObj = clonesList[cl];
        h = fnv1aMixUint32(h, cObj.id);
        h = fnv1aMixFloat64(h, cObj.x);
        h = fnv1aMixFloat64(h, cObj.y);
        h = fnv1aMixString(h, cObj.action);
    }

    h = fnv1aMixUint32(h, state.enemies.length);
    for (var i = 0; i < state.enemies.length; i++) {
        var e = state.enemies[i];
        h = fnv1aMixUint32(h, e.id);
        h = fnv1aMixString(h, e.kind);
        h = fnv1aMixFloat64(h, e.x);
        h = fnv1aMixFloat64(h, e.y);
        h = fnv1aMixFloat64(h, e.vx);
        h = fnv1aMixFloat64(h, e.vy);
        h = fnv1aMixUint32(h, e.hp);
        h = fnv1aMixString(h, e.state);
        h = fnv1aMixUint32(h, e.stateTick);
        h = fnv1aMixUint32(h, e.thrownTimer || 0);
        h = fnv1aMixUint32(h, e.cooldown);
    }

    h = fnv1aMixUint32(h, state.projectiles.length);
    for (var j = 0; j < state.projectiles.length; j++) {
        var pr = state.projectiles[j];
        h = fnv1aMixUint32(h, pr.id);
        h = fnv1aMixString(h, pr.kind || 'knife');
        h = fnv1aMixFloat64(h, pr.x);
        h = fnv1aMixFloat64(h, pr.y);
        h = fnv1aMixFloat64(h, pr.vx);
        h = fnv1aMixFloat64(h, pr.vy || 0);
        h = fnv1aMixString(h, pr.owner);
        h = fnv1aMixUint32(h, pr.hitsLeft || 0);
        h = fnv1aMixUint32(h, pr.life);
    }

    h = fnv1aMixUint32(h, state.traps.length);
    for (var t = 0; t < state.traps.length; t++) {
        var tr = state.traps[t];
        h = fnv1aMixUint32(h, tr.id);
        h = fnv1aMixString(h, tr.kind);
        h = fnv1aMixString(h, tr.owner || 'env');
        h = fnv1aMixFloat64(h, tr.x);
        h = fnv1aMixFloat64(h, tr.y);
        h = fnv1aMixUint32(h, tr.telegraph);
        h = fnv1aMixUint32(h, tr.life);
    }

    h = fnv1aMixUint32(h, state.particles.length);
    for (var k = 0; k < state.particles.length; k++) {
        var pt = state.particles[k];
        h = fnv1aMixUint32(h, pt.id);
        h = fnv1aMixFloat64(h, pt.x);
        h = fnv1aMixFloat64(h, pt.y);
        h = fnv1aMixUint32(h, pt.life);
    }

    return h >>> 0;
}

function formatHexHash(h) {
    return '0x' + ((h >>> 0).toString(16).padStart(8, '0'));
}

function buildStateSummary(state, inputMask, hash) {
    var p = state.player;
    return {
        tick: state.tick,
        input: inputMask,
        hash: formatHexHash(hash),
        rng: formatHexHash(state.rng.state),
        score: state.score,
        floor: state.floor,
        zoneIndex: state.zoneIndex,
        enemies: state.enemies.length,
        projectiles: state.projectiles.length,
        traps: state.traps.length,
        gameOver: state.isGameOver,
        player: p ? {
            x: p.x, y: p.y, vx: p.vx, vy: p.vy,
            hp: p.hp, action: p.action, facing: p.facing
        } : null
    };
}

function diffStateSummaries(expected, actual) {
    var diffs = [];
    if (!expected || !actual) return ['Missing summary for comparison'];
    var fields = ['hash', 'rng', 'input', 'score', 'floor', 'zoneIndex', 'enemies', 'projectiles', 'traps', 'gameOver'];
    for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (expected[f] !== actual[f]) {
            diffs.push(f + ': expected=' + expected[f] + ' actual=' + actual[f]);
        }
    }
    if (expected.player && actual.player) {
        var pFields = ['x', 'y', 'vx', 'vy', 'hp', 'action', 'facing'];
        for (var j = 0; j < pFields.length; j++) {
            var pf = pFields[j];
            if (expected.player[pf] !== actual.player[pf]) {
                diffs.push('player.' + pf + ': expected=' + expected.player[pf] + ' actual=' + actual.player[pf]);
            }
        }
    }
    return diffs;
}

function createDeterminismLogger() {
    return {
        enabled: DEV_MODE,
        entries: [],
        hashes: [],
        expectedCheckpoints: null,
        firstMismatch: null,
        lastHash: 0
    };
}

function resetDeterminismLogger(logger, expectedCheckpoints) {
    if (!logger || !logger.enabled) return;
    logger.entries = [];
    logger.hashes = [];
    logger.expectedCheckpoints = expectedCheckpoints || null;
    logger.firstMismatch = null;
    logger.lastHash = 0;
}

function logDeterminismTick(logger, state, inputMask) {
    if (!logger || !logger.enabled) return null;

    var h = hashSimState(state);
    var summary = buildStateSummary(state, inputMask, h);
    logger.lastHash = h;
    logger.hashes[state.tick] = h;
    logger.entries[state.tick] = summary;

    if (logger.expectedCheckpoints && !logger.firstMismatch) {
        var expectedHashes = logger.expectedCheckpoints.hashes;
        if (expectedHashes && state.tick < expectedHashes.length) {
            var expHash = expectedHashes[state.tick] >>> 0;
            if (expHash !== h) {
                var expSummary = logger.expectedCheckpoints.summaries
                    ? logger.expectedCheckpoints.summaries[state.tick]
                    : null;
                var diffLines = expSummary
                    ? diffStateSummaries(expSummary, summary)
                    : ['hash: expected=' + formatHexHash(expHash) + ' actual=' + formatHexHash(h)];

                logger.firstMismatch = {
                    tick: state.tick,
                    expectedHash: formatHexHash(expHash),
                    actualHash: formatHexHash(h),
                    diffs: diffLines
                };

                if (typeof console !== 'undefined' && console.error) {
                    console.error('[DETERMINISM DIVERGENCE] Tick ' + state.tick, logger.firstMismatch);
                }
                return logger.firstMismatch;
            }
        }
    }
    return null;
}

function exportDevCheckpoints(logger, maxTicks) {
    if (!logger || !logger.enabled) return null;
    var limit = (typeof maxTicks === 'number') ? Math.min(maxTicks + 1, logger.hashes.length) : logger.hashes.length;
    return {
        hashes: logger.hashes.slice(0, limit),
        summaries: logger.entries.slice(0, limit)
    };
}

function runFastDeterminismVerify(recording) {
    var totalTicks = recording.frames.length;
    var hasExpected = !!(recording.devCheckpoints && Array.isArray(recording.devCheckpoints.hashes));
    var t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();

    var simA = createSimState(recording.setup);
    var hashesA = new Array(totalTicks + 1);
    var summariesA = new Array(totalTicks + 1);
    hashesA[0] = hashSimState(simA);
    summariesA[0] = buildStateSummary(simA, 0, hashesA[0]);

    for (var i = 0; i < totalTicks; i++) {
        if (simA.isGameOver) break;
        var mask = recording.frames[i];
        stepSimulation(simA, mask);
        hashesA[simA.tick] = hashSimState(simA);
        summariesA[simA.tick] = buildStateSummary(simA, mask, hashesA[simA.tick]);
    }
    var ticksSimulated = simA.tick;

    var mismatch = null;
    var compareMode = '';

    if (hasExpected) {
        compareMode = 'vs saved checkpoints';
        var expHashes = recording.devCheckpoints.hashes;
        var expSummaries = recording.devCheckpoints.summaries || null;
        var checkLimit = Math.min(ticksSimulated + 1, expHashes.length);
        for (var t = 0; t < checkLimit; t++) {
            if ((hashesA[t] >>> 0) !== (expHashes[t] >>> 0)) {
                mismatch = {
                    tick: t,
                    expectedHash: formatHexHash(expHashes[t]),
                    actualHash: formatHexHash(hashesA[t]),
                    diffs: expSummaries && expSummaries[t]
                        ? diffStateSummaries(expSummaries[t], summariesA[t])
                        : ['hash: expected=' + formatHexHash(expHashes[t]) + ' actual=' + formatHexHash(hashesA[t])]
                };
                break;
            }
        }
    } else {
        compareMode = 'two independent headless runs';
        var simB = createSimState(recording.setup);
        var hB0 = hashSimState(simB);
        if (hB0 !== hashesA[0]) {
            mismatch = {
                tick: 0,
                expectedHash: formatHexHash(hashesA[0]),
                actualHash: formatHexHash(hB0),
                diffs: diffStateSummaries(summariesA[0], buildStateSummary(simB, 0, hB0))
            };
        } else {
            for (var j = 0; j < totalTicks; j++) {
                if (simB.isGameOver) break;
                var m2 = recording.frames[j];
                stepSimulation(simB, m2);
                var hB = hashSimState(simB);
                if (hB !== hashesA[simB.tick]) {
                    mismatch = {
                        tick: simB.tick,
                        expectedHash: formatHexHash(hashesA[simB.tick]),
                        actualHash: formatHexHash(hB),
                        diffs: diffStateSummaries(summariesA[simB.tick], buildStateSummary(simB, m2, hB))
                    };
                    break;
                }
            }
        }
    }

    var t1 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    return {
        ok: mismatch === null,
        compareMode: compareMode,
        ticksVerified: ticksSimulated,
        finalHash: formatHexHash(hashesA[ticksSimulated]),
        finalScore: simA.score,
        finalFloor: simA.floor,
        elapsedMs: Math.round((t1 - t0) * 100) / 100,
        mismatch: mismatch
    };
}

function isFinitePose(obj) {
    return obj && Number.isFinite(obj.x) && Number.isFinite(obj.y);
}

// Runtime bug-detector checked every tick during Self-Play integration tests
function checkSimInvariants(sim) {
    if (!Number.isFinite(sim.cameraX) || sim.cameraX < -1e-6 || sim.cameraX > FLOOR_LENGTH - sim.setup.viewWidth + 1e-6) {
        return 'cameraX out of bounds: ' + sim.cameraX;
    }
    var p = sim.player;
    if (!isFinitePose(p) || !Number.isFinite(p.vx) || !Number.isFinite(p.vy)) {
        return 'player non-finite pose/vel';
    }
    if (p.x < -1e-6 || p.x > FLOOR_LENGTH + 1e-6 || p.y > GROUND_Y + 0.01) {
        return 'player out of arena bounds: (' + p.x + ',' + p.y + ')';
    }
    if (p.hp < 0 || p.hp > p.maxHp || !Number.isFinite(p.hp)) {
        return 'player invalid HP: ' + p.hp;
    }
    if (p.attackChargeTicks < 0 || p.attackChargeTicks > CHARGE_MAX_TICKS) {
        return 'player invalid charge: ' + p.attackChargeTicks;
    }
    for (var i = 0; i < sim.enemies.length; i++) {
        var e = sim.enemies[i];
        if (!isFinitePose(e) || e.x < 0 || e.x > FLOOR_LENGTH || e.hp <= 0 || e.hp > e.maxHp) {
            return 'enemy #' + e.id + ' invalid state (x=' + e.x + ', hp=' + e.hp + ')';
        }
    }
    for (var j = 0; j < sim.projectiles.length; j++) {
        if (!isFinitePose(sim.projectiles[j])) return 'projectile non-finite';
    }
    for (var k = 0; k < sim.traps.length; k++) {
        if (!isFinitePose(sim.traps[k])) return 'trap non-finite';
    }
    if (sim.clones) {
        for (var cl = 0; cl < sim.clones.length; cl++) {
            if (!isFinitePose(sim.clones[cl]) || sim.clones[cl].x < 0 || sim.clones[cl].x > FLOOR_LENGTH) {
                return 'clone #' + sim.clones[cl].id + ' out of bounds';
            }
        }
    }
    return null;
}

// Multi-seed Self-Play Bug Hunt: drives the game with the user-like AI across
// many seeds, verifies zero invariant bugs, and proves saved input replays identically.
function runSelfPlayBugHunt(seeds, ticksPerSeed) {
    var seedList = seeds || [0x1001, 0x2002, 0x3003, 0x4004, 0x5005];
    var ticks = ticksPerSeed || 1200;
    var totalKOs = 0;
    var totalParries = 0;
    var maxFloor = 1;

    for (var i = 0; i < seedList.length; i++) {
        var fId = (typeof FIGHTERS !== 'undefined' && FIGHTERS.length > 0)
            ? FIGHTERS[i % FIGHTERS.length].id : 'shadow';
        var res = runAiIntegrationTest({ seed: seedList[i], ticks: ticks, fighterId: fId });
        if (!res.ok) {
            return {
                ok: false,
                failedSeed: seedList[i],
                checks: res.checks,
                recording: res.recording
            };
        }
        totalKOs += res.enemiesDefeated || 0;
        totalParries += res.parriesLanded || 0;
        if (res.floor > maxFloor) maxFloor = res.floor;
    }
    return {
        ok: true,
        seedsRun: seedList.length,
        ticksPerSeed: ticks,
        totalKOs: totalKOs,
        totalParries: totalParries,
        maxFloor: maxFloor
    };
}

function runAiIntegrationTest(options) {
    var opts = options || {};
    var maxTicks = opts.ticks || 2400;
    var seed = (typeof opts.seed === 'number') ? (opts.seed >>> 0) : 0x51A7BEEF;
    var setup = {
        seed: seed,
        viewWidth: WORLD_VIEW_W,
        viewHeight: WORLD_VIEW_H,
        tickRate: SIM_TICK_RATE,
        fighterId: opts.fighterId || 'shadow'
    };

    var t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var checks = [];
    function addCheck(name, passed, detail) {
        checks.push({ name: name, passed: !!passed, detail: detail });
    }

    var liveDummy = createLiveInput();
    var ctrl = createInputController(liveDummy);
    var ai = createAiState();
    var sim = createSimState(setup);
    var replay = createReplayBuffer(600);
    var logger = {
        enabled: true, entries: [], hashes: [],
        expectedCheckpoints: null, firstMismatch: null, lastHash: 0
    };

    startInputAi(ctrl, setup, ai, computeAiInput);
    pushReplayFrame(replay, sim);
    logDeterminismTick(logger, sim, INPUT_NONE);

    var counts = { left: 0, right: 0, jump: 0, attack: 0 };
    var invariantError = null;

    for (var t = 0; t < maxTicks && !sim.isGameOver; t++) {
        var mask = getTickInput(ctrl, sim.tick, sim);
        if (mask & INPUT_LEFT)   counts.left++;
        if (mask & INPUT_RIGHT)  counts.right++;
        if (mask & INPUT_JUMP)   counts.jump++;
        if (mask & INPUT_ATTACK) counts.attack++;

        stepSimulation(sim, mask);
        pushReplayFrame(replay, sim);
        logDeterminismTick(logger, sim, mask);

        if (!invariantError) {
            invariantError = checkSimInvariants(sim);
        }
    }

    var ticksRun = sim.tick;
    var originalFinalHash = formatHexHash(logger.hashes[ticksRun]);

    addCheck(
        'Self-play AI controls & combat',
        counts.left > 0 && counts.right > 0 && counts.jump > 0 && counts.attack > 0 &&
        sim.score > 0 && sim.enemiesDefeated > 0,
        'score=' + sim.score + ' floor=' + sim.floor + ' KOs=' + sim.enemiesDefeated + ' deflects=' + sim.parriesLanded +
        ' L:' + counts.left + ' R:' + counts.right + ' J:' + counts.jump + ' A:' + counts.attack
    );
    addCheck(
        'Per-tick bug invariants (NaN/bounds/HP)',
        invariantError === null,
        invariantError ? ('BUG at tick ' + sim.tick + ': ' + invariantError) : ('0 violations across ' + ticksRun + ' ticks')
    );

    var checkpoints = exportDevCheckpoints(logger, ctrl.recording.frames.length);
    var jsonText = serializeInputRecording(ctrl.recording, checkpoints);
    var loadedRec = deserializeInputRecording(jsonText);
    var verifyRes = runFastDeterminismVerify(loadedRec);

    addCheck(
        'Saved Input RLE & determinism',
        verifyRes.ok && verifyRes.finalHash === originalFinalHash,
        verifyRes.ok
            ? ('PASS ' + verifyRes.ticksVerified + ' ticks, hash=' + verifyRes.finalHash + ', bytes=' + jsonText.length)
            : ('FAIL at tick ' + verifyRes.mismatch.tick + ': ' + verifyRes.mismatch.diffs.join('; '))
    );

    var replayLen = getReplayLength(replay);
    var blendOk = replayLen > 1;
    if (blendOk) {
        var sampleIdx = Math.max(0, replayLen - 2);
        var alphas = [0.0, 0.25, 0.5, 0.75, 1.0];
        for (var a = 0; a < alphas.length; a++) {
            var bf = sampleBlendedReplayFrame(replay, sampleIdx + alphas[a]);
            if (!bf || (bf.player && !isFinitePose(bf.player))) {
                blendOk = false;
                break;
            }
        }
    }
    addCheck('Replay ring buffer & slow-mo blending', blendOk, 'buffered=' + replayLen + '/' + replay.capacity);

    var branchOk = false;
    var branchDetail = 'Not enough frames';
    if (replayLen >= 20) {
        var midIdx = Math.floor(replayLen / 2);
        var midEntry = getReplayEntry(replay, midIdx);
        var branchSim = cloneSimState(midEntry.simSnapshot);
        var startTick = branchSim.tick;
        for (var rt = startTick; rt < ticksRun; rt++) {
            stepSimulation(branchSim, loadedRec.frames[rt]);
        }
        var branchHash = formatHexHash(hashSimState(branchSim));
        branchOk = (branchHash === originalFinalHash);
        branchDetail = 'restored tick ' + startTick + ' -> ' + ticksRun + ', hash=' + branchHash;
    }
    addCheck('Replay Play-From-Here restore', branchOk, branchDetail);

    var allPassed = true;
    for (var ci = 0; ci < checks.length; ci++) {
        if (!checks[ci].passed) allPassed = false;
    }
    var t1 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    return {
        ok: allPassed,
        ticksRun: ticksRun,
        score: sim.score,
        floor: sim.floor,
        enemiesDefeated: sim.enemiesDefeated,
        parriesLanded: sim.parriesLanded,
        finalHash: originalFinalHash,
        elapsedMs: Math.round((t1 - t0) * 100) / 100,
        checks: checks,
        recording: loadedRec,
        jsonText: jsonText
    };
}
