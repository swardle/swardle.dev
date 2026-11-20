// ============================================================================
// replay.js - In-Game Output Replay System (Fixed Ring Buffer)
//
// Completely separate from Saved Input (input.js):
//   - Saved Input records the *inputs* (deterministic re-simulation).
//   - Replay records the *output* render keyframes (plus sub-frame bounce points
//     for accurate slow-mo / fast-forward blending, and a sim snapshot per slot
//     so the player can jump backward or forward in time and play from there).
// ============================================================================

var REPLAY_MAX_FRAMES = 3600; // 60 seconds at 60 Hz

function createReplayBuffer(maxFrames) {
    var cap = maxFrames || REPLAY_MAX_FRAMES;
    return {
        capacity: cap,
        slots: new Array(cap),
        start: 0, // ring index of oldest frame
        count: 0  // number of valid frames (0..capacity)
    };
}

function clearReplayBuffer(buf) {
    buf.start = 0;
    buf.count = 0;
}

// Extracts a compact render keyframe from the current simulation state
function captureRenderFrame(simState, stepResult) {
    var p = simState.player;
    var bullets = new Array(simState.bullets.length);
    for (var i = 0; i < simState.bullets.length; i++) {
        var b = simState.bullets[i];
        bullets[i] = { id: b.id, x: b.x, y: b.y, r: b.r };
    }

    var enemies = new Array(simState.enemies.length);
    for (var j = 0; j < simState.enemies.length; j++) {
        var e = simState.enemies[j];
        enemies[j] = { id: e.id, x: e.x, y: e.y, r: e.r, angle: e.angle };
    }

    var particles = new Array(simState.particles.length);
    for (var k = 0; k < simState.particles.length; k++) {
        var pt = simState.particles[k];
        particles[k] = { id: pt.id, x: pt.x, y: pt.y, color: pt.color, size: pt.size };
    }

    return {
        tick: simState.tick,
        worldWidth: simState.setup.worldWidth,
        worldHeight: simState.setup.worldHeight,
        score: simState.score,
        lives: simState.lives,
        level: simState.level,
        isGameOver: simState.isGameOver,
        obstacle: {
            x: simState.obstacle.x,
            y: simState.obstacle.y,
            width: simState.obstacle.width,
            height: simState.obstacle.height
        },
        player: p ? {
            id: p.id,
            x: p.x,
            y: p.y,
            r: p.r,
            angle: p.angle,
            isThrusting: p.isThrusting,
            isInvincible: p.isInvincible,
            invincibilityTimer: p.invincibilityTimer,
            alive: p.alive
        } : null,
        bullets: bullets,
        enemies: enemies,
        particles: particles,
        // Sub-frame bounce points & mid-tick death points from tick-1 -> tick
        subFrames: stepResult ? stepResult.entitySubFrames : {},
        endPoints: stepResult ? stepResult.entityEndPoints : {}
    };
}

function pushReplayFrame(buf, simState, stepResult) {
    var entry = {
        tick: simState.tick,
        renderFrame: captureRenderFrame(simState, stepResult),
        simSnapshot: cloneSimState(simState)
    };

    if (buf.count < buf.capacity) {
        var writeIdx = (buf.start + buf.count) % buf.capacity;
        buf.slots[writeIdx] = entry;
        buf.count++;
    } else {
        // Ring buffer full: overwrite oldest slot and advance start
        buf.slots[buf.start] = entry;
        buf.start = (buf.start + 1) % buf.capacity;
    }
}

function getReplayLength(buf) {
    return buf.count;
}

// Logical index: 0 = oldest available frame, count - 1 = newest frame
function getReplayEntry(buf, logicalIndex) {
    if (buf.count === 0) return null;
    var idx = logicalIndex;
    if (idx < 0) idx = 0;
    if (idx >= buf.count) idx = buf.count - 1;
    return buf.slots[(buf.start + idx) % buf.capacity];
}

// Truncates all replay frames strictly after logicalIndex (used on "Play From Here")
function truncateReplayAfter(buf, logicalIndex) {
    if (buf.count === 0) return;
    if (logicalIndex < 0) {
        buf.count = 0;
        buf.start = 0;
        return;
    }
    if (logicalIndex + 1 < buf.count) {
        buf.count = logicalIndex + 1;
    }
}

// ----------------------------------------------------------------------------
// Keyframe Blending & Sub-Frame Bounce Interpolation
// ----------------------------------------------------------------------------
function lerp(a, b, t) {
    return a + (b - a) * t;
}

function lerpAngle(a, b, t) {
    var diff = b - a;
    while (diff > Math.PI)  diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
}

// Piecewise-linear interpolation along:
//   (t=0, startObj) -> subPoints[0] -> ... -> subPoints[n-1] -> (t=endT, endObj)
// Ensures bouncing objects visibly reach the wall/obstacle at exact impact t
// and sharply reflect instead of cutting corners during slow-motion playback.
function interpolateWithSubFrames(startObj, endObj, endT, subPoints, alpha, hasAngle) {
    var prevT = 0.0;
    var prevX = startObj.x;
    var prevY = startObj.y;
    var prevA = hasAngle ? startObj.angle : 0;

    if (subPoints && subPoints.length > 0) {
        for (var i = 0; i < subPoints.length; i++) {
            var sp = subPoints[i];
            if (alpha <= sp.t) {
                var span = sp.t - prevT;
                var localT = span > 1e-9 ? (alpha - prevT) / span : 1.0;
                return {
                    x: lerp(prevX, sp.x, localT),
                    y: lerp(prevY, sp.y, localT),
                    angle: hasAngle ? lerpAngle(prevA, sp.angle, localT) : 0
                };
            }
            prevT = sp.t;
            prevX = sp.x;
            prevY = sp.y;
            prevA = hasAngle ? sp.angle : 0;
        }
    }

    var finalSpan = endT - prevT;
    var finalLocalT = finalSpan > 1e-9 ? (alpha - prevT) / finalSpan : 1.0;
    if (finalLocalT < 0) finalLocalT = 0;
    if (finalLocalT > 1) finalLocalT = 1;

    return {
        x: lerp(prevX, endObj.x, finalLocalT),
        y: lerp(prevY, endObj.y, finalLocalT),
        angle: hasAngle ? lerpAngle(prevA, endObj.angle, finalLocalT) : 0
    };
}

function buildIdMap(list) {
    var map = {};
    for (var i = 0; i < list.length; i++) {
        map[list[i].id] = list[i];
    }
    return map;
}

// Builds an interpolated renderFrame at any fractional logical index in [0, count-1].
function sampleBlendedReplayFrame(buf, floatIndex) {
    if (buf.count === 0) return null;

    var clamped = floatIndex;
    if (clamped < 0) clamped = 0;
    if (clamped > buf.count - 1) clamped = buf.count - 1;

    var i0 = Math.floor(clamped);
    var i1 = Math.min(i0 + 1, buf.count - 1);
    var alpha = clamped - i0;

    var f0 = getReplayEntry(buf, i0).renderFrame;
    if (i0 === i1 || alpha <= 1e-6) {
        return f0;
    }

    var f1 = getReplayEntry(buf, i1).renderFrame;
    var subMap = f1.subFrames || {};
    var endMap = f1.endPoints || {};

    // 1. Blend Player (only if same entity ID — avoids lerping across a respawn)
    var blendedPlayer = null;
    if (f0.player && f1.player && f0.player.id === f1.player.id && f0.player.alive && f1.player.alive) {
        var pPose = interpolateWithSubFrames(
            f0.player, f1.player, 1.0, subMap[f0.player.id], alpha, true
        );
        blendedPlayer = {
            id: f0.player.id,
            x: pPose.x,
            y: pPose.y,
            r: f0.player.r,
            angle: pPose.angle,
            isThrusting: alpha < 0.5 ? f0.player.isThrusting : f1.player.isThrusting,
            isInvincible: alpha < 0.5 ? f0.player.isInvincible : f1.player.isInvincible,
            invincibilityTimer: Math.round(lerp(f0.player.invincibilityTimer, f1.player.invincibilityTimer, alpha)),
            alive: true
        };
    } else if (alpha < 0.5) {
        blendedPlayer = f0.player;
    } else {
        blendedPlayer = f1.player;
    }

    // 2. Blend Bullets (including mid-tick bounce expirations!)
    var b1Map = buildIdMap(f1.bullets);
    var seenBullets = {};
    var blendedBullets = [];

    for (var bi = 0; bi < f0.bullets.length; bi++) {
        var b0 = f0.bullets[bi];
        var b1 = b1Map[b0.id];
        seenBullets[b0.id] = true;

        if (b1) {
            var bPose = interpolateWithSubFrames(b0, b1, 1.0, subMap[b0.id], alpha, false);
            blendedBullets.push({ id: b0.id, x: bPose.x, y: bPose.y, r: b0.r });
        } else if (endMap[b0.id]) {
            // Bullet expired on a bounce at t = ep.t during this tick
            var ep = endMap[b0.id];
            if (alpha <= ep.t) {
                var epPose = interpolateWithSubFrames(b0, ep, ep.t, subMap[b0.id], alpha, false);
                blendedBullets.push({ id: b0.id, x: epPose.x, y: epPose.y, r: b0.r });
            }
        } else if (alpha < 0.5) {
            blendedBullets.push(b0);
        }
    }
    // Newly spawned bullets in f1
    if (alpha >= 0.5) {
        for (var bi2 = 0; bi2 < f1.bullets.length; bi2++) {
            var nb = f1.bullets[bi2];
            if (!seenBullets[nb.id]) {
                blendedBullets.push(nb);
            }
        }
    }

    // 3. Blend Enemies
    var e1Map = buildIdMap(f1.enemies);
    var seenEnemies = {};
    var blendedEnemies = [];

    for (var ei = 0; ei < f0.enemies.length; ei++) {
        var e0 = f0.enemies[ei];
        var e1 = e1Map[e0.id];
        seenEnemies[e0.id] = true;

        if (e1) {
            var ePose = interpolateWithSubFrames(e0, e1, 1.0, subMap[e0.id], alpha, true);
            blendedEnemies.push({ id: e0.id, x: ePose.x, y: ePose.y, r: e0.r, angle: ePose.angle });
        } else if (endMap[e0.id]) {
            var eEp = endMap[e0.id];
            if (alpha <= eEp.t) {
                var eEpPose = interpolateWithSubFrames(e0, eEp, eEp.t, subMap[e0.id], alpha, true);
                blendedEnemies.push({ id: e0.id, x: eEpPose.x, y: eEpPose.y, r: e0.r, angle: eEpPose.angle });
            }
        } else if (alpha < 0.5) {
            blendedEnemies.push(e0);
        }
    }
    if (alpha >= 0.5) {
        for (var ei2 = 0; ei2 < f1.enemies.length; ei2++) {
            var ne = f1.enemies[ei2];
            if (!seenEnemies[ne.id]) {
                blendedEnemies.push(ne);
            }
        }
    }

    // 4. Blend Particles
    var pt1Map = buildIdMap(f1.particles);
    var seenParticles = {};
    var blendedParticles = [];

    for (var pi = 0; pi < f0.particles.length; pi++) {
        var pt0 = f0.particles[pi];
        var pt1 = pt1Map[pt0.id];
        seenParticles[pt0.id] = true;

        if (pt1) {
            blendedParticles.push({
                id: pt0.id,
                x: lerp(pt0.x, pt1.x, alpha),
                y: lerp(pt0.y, pt1.y, alpha),
                color: pt0.color,
                size: pt0.size
            });
        } else if (alpha < 0.5) {
            blendedParticles.push(pt0);
        }
    }
    if (alpha >= 0.5) {
        for (var pi2 = 0; pi2 < f1.particles.length; pi2++) {
            var npt = f1.particles[pi2];
            if (!seenParticles[npt.id]) {
                blendedParticles.push(npt);
            }
        }
    }

    var hudFrame = alpha < 0.5 ? f0 : f1;
    return {
        tick: f0.tick + alpha,
        worldWidth: f0.worldWidth,
        worldHeight: f0.worldHeight,
        score: hudFrame.score,
        lives: hudFrame.lives,
        level: hudFrame.level,
        isGameOver: hudFrame.isGameOver,
        obstacle: f0.obstacle,
        player: blendedPlayer,
        bullets: blendedBullets,
        enemies: blendedEnemies,
        particles: blendedParticles
    };
}
