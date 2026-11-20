// ============================================================================
// debug.js - Development-Only Determinism Logging & Verification System
//
// Enable during development by either:
//   1. Opening the page with ?dev=1 in the URL, OR
//   2. Setting DEV_MODE_DEFAULT = true below.
//
// When DEV_MODE is false, all logger functions are fast no-ops with zero
// per-tick allocations so production gameplay has zero overhead.
// ============================================================================

var DEV_MODE_DEFAULT = false;
var DEV_MODE = DEV_MODE_DEFAULT || (
    typeof window !== 'undefined' &&
    typeof URLSearchParams !== 'undefined' &&
    new URLSearchParams(window.location.search).get('dev') === '1'
);

// Reusable scratch buffers for exact IEEE-754 float64 hashing (zero GC)
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
    // Normalize -0 to +0 so sign of zero never causes false mismatches
    _hashFloatBuf[0] = (num === 0) ? 0 : num;
    hash = fnv1aMixUint32(hash, _hashUintView[0]);
    hash = fnv1aMixUint32(hash, _hashUintView[1]);
    return hash;
}

// Computes an exact 32-bit FNV-1a hash over all deterministic simulation state
function hashSimState(state) {
    var h = 2166136261 >>> 0;

    h = fnv1aMixUint32(h, state.tick);
    h = fnv1aMixUint32(h, state.rng.state);
    h = fnv1aMixUint32(h, state.nextEntityId);
    h = fnv1aMixUint32(h, state.score);
    h = fnv1aMixUint32(h, state.lives);
    h = fnv1aMixUint32(h, state.level);
    h = fnv1aMixUint32(h, state.isGameOver ? 1 : 0);

    var p = state.player;
    if (p) {
        h = fnv1aMixUint32(h, p.id);
        h = fnv1aMixFloat64(h, p.x);
        h = fnv1aMixFloat64(h, p.y);
        h = fnv1aMixFloat64(h, p.vx);
        h = fnv1aMixFloat64(h, p.vy);
        h = fnv1aMixFloat64(h, p.angle);
        h = fnv1aMixUint32(h, p.isThrusting ? 1 : 0);
        h = fnv1aMixUint32(h, p.isInvincible ? 1 : 0);
        h = fnv1aMixUint32(h, p.invincibilityTimer);
        h = fnv1aMixUint32(h, p.alive ? 1 : 0);
    }

    h = fnv1aMixUint32(h, state.bullets.length);
    for (var i = 0; i < state.bullets.length; i++) {
        var b = state.bullets[i];
        h = fnv1aMixUint32(h, b.id);
        h = fnv1aMixFloat64(h, b.x);
        h = fnv1aMixFloat64(h, b.y);
        h = fnv1aMixFloat64(h, b.vx);
        h = fnv1aMixFloat64(h, b.vy);
        h = fnv1aMixUint32(h, b.life);
        h = fnv1aMixUint32(h, b.bounces + 100);
    }

    h = fnv1aMixUint32(h, state.enemies.length);
    for (var j = 0; j < state.enemies.length; j++) {
        var e = state.enemies[j];
        h = fnv1aMixUint32(h, e.id);
        h = fnv1aMixFloat64(h, e.x);
        h = fnv1aMixFloat64(h, e.y);
        h = fnv1aMixFloat64(h, e.vx);
        h = fnv1aMixFloat64(h, e.vy);
        h = fnv1aMixFloat64(h, e.angle);
        h = fnv1aMixFloat64(h, e.turnSpeed);
    }

    h = fnv1aMixUint32(h, state.particles.length);
    for (var k = 0; k < state.particles.length; k++) {
        var pt = state.particles[k];
        h = fnv1aMixUint32(h, pt.id);
        h = fnv1aMixFloat64(h, pt.x);
        h = fnv1aMixFloat64(h, pt.y);
        h = fnv1aMixFloat64(h, pt.vx);
        h = fnv1aMixFloat64(h, pt.vy);
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
        lives: state.lives,
        level: state.level,
        gameOver: state.isGameOver,
        bullets: state.bullets.length,
        enemies: state.enemies.length,
        particles: state.particles.length,
        player: p ? {
            id: p.id,
            x: p.x, y: p.y,
            vx: p.vx, vy: p.vy,
            angle: p.angle,
            inv: p.invincibilityTimer
        } : null
    };
}

function diffStateSummaries(expected, actual) {
    var diffs = [];
    if (!expected || !actual) return ['Missing summary for comparison'];

    var fields = ['hash', 'rng', 'input', 'score', 'lives', 'level', 'gameOver', 'bullets', 'enemies', 'particles'];
    for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (expected[f] !== actual[f]) {
            diffs.push(f + ': expected=' + expected[f] + ' actual=' + actual[f]);
        }
    }
    if (expected.player && actual.player) {
        var pFields = ['id', 'x', 'y', 'vx', 'vy', 'angle', 'inv'];
        for (var j = 0; j < pFields.length; j++) {
            var pf = pFields[j];
            if (expected.player[pf] !== actual.player[pf]) {
                diffs.push('player.' + pf + ': expected=' + expected.player[pf] + ' actual=' + actual.player[pf]);
            }
        }
    }
    return diffs;
}

// ----------------------------------------------------------------------------
// Determinism Logger (active ONLY when DEV_MODE is true)
// ----------------------------------------------------------------------------
function createDeterminismLogger() {
    return {
        enabled: DEV_MODE,
        entries: [],           // per-tick summaries indexed by tick
        hashes: [],            // per-tick uint32 hashes indexed by tick
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

// Records and optionally verifies state at state.tick
// Returns mismatch object if this tick is the FIRST divergence, else null.
function logDeterminismTick(logger, state, inputMask) {
    if (!logger || !logger.enabled) return null;

    var h = hashSimState(state);
    var summary = buildStateSummary(state, inputMask, h);
    logger.lastHash = h;
    logger.hashes[state.tick] = h;
    logger.entries[state.tick] = summary;

    // Verify against expected checkpoints if playing back a dev-tagged file
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

// Runs a full headless simulation of an InputRecording at max speed to verify
// determinism. If the recording has devCheckpoints, checks against them.
// Otherwise runs the simulation TWICE from scratch and compares every tick.
function runFastDeterminismVerify(recording) {
    var totalTicks = recording.frames.length;
    var hasExpected = !!(recording.devCheckpoints && Array.isArray(recording.devCheckpoints.hashes));

    var t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();

    // Run 1
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
        finalLevel: simA.level,
        elapsedMs: Math.round((t1 - t0) * 100) / 100,
        mismatch: mismatch
    };
}

// ----------------------------------------------------------------------------
// Dev-Only AI End-to-End Integration Test
// Drives the game using the AI button-press controller and verifies:
//   1. AI exercises all controls (left, right, thrust, shoot) & scores points
//   2. Zero NaN / invalid coordinates in simulation state
//   3. Saved Input RLE serialize -> deserialize -> headless playback matches
//      every single tick's FNV-1a state hash bit-for-bit
//   4. Replay ring buffer sub-frame blending produces valid frames
//   5. Replay "Play From Here" snapshot restore matches original timeline hash
// ----------------------------------------------------------------------------
function isFinitePose(obj) {
    return obj && Number.isFinite(obj.x) && Number.isFinite(obj.y);
}

function runAiIntegrationTest(options) {
    var opts = options || {};
    var maxTicks = opts.ticks || 2400; // 40 seconds of simulated play
    var seed = (typeof opts.seed === 'number') ? (opts.seed >>> 0) : 0x51A7BEEF;
    var setup = {
        seed: seed,
        worldWidth: opts.worldWidth || 900,
        worldHeight: opts.worldHeight || 640,
        tickRate: SIM_TICK_RATE
    };

    var t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var checks = [];

    function addCheck(name, passed, detail) {
        checks.push({ name: name, passed: !!passed, detail: detail });
    }

    // 1. Run AI game through InputController ('ai' mode) + ReplayBuffer + DevLogger
    var liveDummy = createLiveInput();
    var ctrl = createInputController(liveDummy);
    var ai = createAiState();
    var sim = createSimState(setup);
    var replay = createReplayBuffer(600); // 10s ring buffer to also test wraparound!
    var logger = {
        enabled: true,
        entries: [],
        hashes: [],
        expectedCheckpoints: null,
        firstMismatch: null,
        lastHash: 0
    };

    startInputAi(ctrl, setup, ai, computeAiInput);
    pushReplayFrame(replay, sim, null);
    logDeterminismTick(logger, sim, INPUT_NONE);

    var counts = { left: 0, right: 0, thrust: 0, shoot: 0 };
    var subFrameBounces = 0;
    var nanFound = false;
    var bounceReplayTick = -1;

    for (var t = 0; t < maxTicks && !sim.isGameOver; t++) {
        var mask = getTickInput(ctrl, sim.tick, sim);
        if (mask & INPUT_LEFT)   counts.left++;
        if (mask & INPUT_RIGHT)  counts.right++;
        if (mask & INPUT_THRUST) counts.thrust++;
        if (mask & INPUT_SHOOT)  counts.shoot++;

        var stepRes = stepSimulation(sim, mask);
        pushReplayFrame(replay, sim, stepRes);
        logDeterminismTick(logger, sim, mask);

        var bKeys = Object.keys(stepRes.entitySubFrames);
        if (bKeys.length > 0) {
            subFrameBounces += bKeys.length;
            bounceReplayTick = sim.tick;
        }

        if (!isFinitePose(sim.player)) nanFound = true;
        for (var bi = 0; bi < sim.bullets.length; bi++) {
            if (!isFinitePose(sim.bullets[bi])) nanFound = true;
        }
        for (var ei = 0; ei < sim.enemies.length; ei++) {
            if (!isFinitePose(sim.enemies[ei])) nanFound = true;
        }
    }

    var ticksRun = sim.tick;
    var originalFinalHash = formatHexHash(logger.hashes[ticksRun]);

    addCheck(
        'AI controls & gameplay',
        counts.left > 0 && counts.right > 0 && counts.thrust > 0 && counts.shoot > 0 && sim.score > 0,
        'score=' + sim.score + ' lvl=' + sim.level +
        ' L:' + counts.left + ' R:' + counts.right + ' T:' + counts.thrust + ' S:' + counts.shoot
    );
    addCheck(
        'Physics numeric stability',
        !nanFound,
        'ticks=' + ticksRun + ' subFrameBounces=' + subFrameBounces
    );

    // 2. Saved Input serialize -> deserialize -> deterministic playback verification
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

    // 3. Replay ring buffer blending (including fractional slow-mo alphas)
    var replayLen = getReplayLength(replay);
    var blendOk = replayLen > 1;
    if (blendOk) {
        var sampleIdx = Math.max(0, replayLen - 2);
        // Prefer the recorded bounce frame if it's still inside the ring buffer
        var oldestTick = getReplayEntry(replay, 0).tick;
        if (bounceReplayTick > oldestTick) {
            sampleIdx = Math.min(replayLen - 2, bounceReplayTick - oldestTick - 1);
        }
        var alphas = [0.0, 0.25, 0.5, 0.75, 1.0];
        for (var aiIdx = 0; aiIdx < alphas.length; aiIdx++) {
            var bf = sampleBlendedReplayFrame(replay, sampleIdx + alphas[aiIdx]);
            if (!bf || (bf.player && !isFinitePose(bf.player))) {
                blendOk = false;
                break;
            }
        }
    }
    addCheck(
        'Replay ring buffer & sub-frame blending',
        blendOk,
        'buffered=' + replayLen + '/' + replay.capacity + ' ticks'
    );

    // 4. Replay "Play From Here" snapshot restore & branch equivalence
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
        level: sim.level,
        finalHash: originalFinalHash,
        elapsedMs: Math.round((t1 - t0) * 100) / 100,
        checks: checks,
        recording: loadedRec
    };
}
