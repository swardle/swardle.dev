// ============================================================================
// kung-fu/js/replay.js - In-Game Output Replay System (60s Fixed Ring Buffer)
//
// Completely separate from Saved Input (input.js):
//   - Saved Input records *inputs* for deterministic tick-0 re-simulation.
//   - Replay records *output* render keyframes + sim snapshots so players can
//     scrub backward/forward, watch slow-mo (-2x..+2x) with smooth blending,
//     step sub-frames, and click "Play From Here" to branch live gameplay!
// ============================================================================

var REPLAY_MAX_FRAMES = 3600; // 60 seconds at 60 Hz

function createReplayBuffer(maxFrames) {
    var cap = maxFrames || REPLAY_MAX_FRAMES;
    return {
        capacity: cap,
        slots: new Array(cap),
        start: 0,
        count: 0
    };
}

function clearReplayBuffer(buf) {
    buf.start = 0;
    buf.count = 0;
}

function classifyReplayMarker(stepResult) {
    if (!stepResult || !stepResult.soundEvents || stepResult.soundEvents.length === 0) {
        return null;
    }
    var evs = stepResult.soundEvents;
    // Priority: parry (gold) > boss_ko / ko (red) > player_hit / player_ko (magenta)
    var hasKo = false;
    var hasDmg = false;
    for (var i = 0; i < evs.length; i++) {
        var ev = evs[i];
        if (ev === 'parry') return 'parry';
        if (ev === 'boss_ko' || ev === 'ko') hasKo = true;
        if (ev === 'player_hit' || ev === 'player_ko') hasDmg = true;
    }
    if (hasKo) return 'ko';
    if (hasDmg) return 'damage';
    return null;
}

function captureRenderFrame(simState, inputMask, stepResult) {
    var p = simState.player;
    var enemies = new Array(simState.enemies.length);
    for (var i = 0; i < simState.enemies.length; i++) {
        var e = simState.enemies[i];
        enemies[i] = {
            id: e.id, kind: e.kind, x: e.x, y: e.y, facing: e.facing,
            hp: e.hp, maxHp: e.maxHp, scale: e.scale,
            state: e.state, stateTick: e.stateTick, stateDur: e.stateDur,
            attackStyle: e.attackStyle, walkCycle: e.walkCycle,
            flashTimer: e.flashTimer, burnTimer: e.burnTimer || 0
        };
    }

    var projectiles = new Array(simState.projectiles.length);
    for (var j = 0; j < simState.projectiles.length; j++) {
        var pr = simState.projectiles[j];
        projectiles[j] = {
            id: pr.id, kind: pr.kind || 'knife', x: pr.x, y: pr.y, vx: pr.vx,
            owner: pr.owner, spin: pr.spin,
            radius: pr.radius || 11, power: pr.power || 0,
            color: pr.color || null, isFire: !!pr.isFire, isWater: !!pr.isWater,
            isRasengan: !!pr.isRasengan,
            enemyKind: pr.enemyKind || null, scale: pr.scale || 1.0
        };
    }

    var traps = new Array(simState.traps.length);
    for (var t = 0; t < simState.traps.length; t++) {
        var tr = simState.traps[t];
        traps[t] = {
            id: tr.id, kind: tr.kind, owner: tr.owner || 'env', x: tr.x, y: tr.y,
            vx: tr.vx || 0, angle: tr.angle, telegraph: tr.telegraph
        };
    }

    var particles = new Array(simState.particles.length);
    for (var k = 0; k < simState.particles.length; k++) {
        var pt = simState.particles[k];
        particles[k] = {
            id: pt.id, x: pt.x, y: pt.y, size: pt.size,
            color: pt.color, life: pt.life, maxLife: pt.maxLife, kind: pt.kind
        };
    }

    var slashes = new Array(simState.slashes.length);
    for (var s = 0; s < simState.slashes.length; s++) {
        var sl = simState.slashes[s];
        slashes[s] = {
            id: sl.id, x: sl.x, y: sl.y, facing: sl.facing,
            style: sl.style, color: sl.color, element: sl.element || null,
            age: sl.age, maxAge: sl.maxAge
        };
    }

    var callouts = new Array(simState.callouts.length);
    for (var c = 0; c < simState.callouts.length; c++) {
        var co = simState.callouts[c];
        callouts[c] = {
            id: co.id, x: co.x, y: co.y, text: co.text,
            color: co.color, life: co.life, maxLife: co.maxLife
        };
    }

    var srcAfter = simState.afterimages || [];
    var afterimages = new Array(srcAfter.length);
    for (var a = 0; a < srcAfter.length; a++) {
        var af = srcAfter[a];
        afterimages[a] = {
            id: af.id, x: af.x, y: af.y, facing: af.facing,
            pose: af.pose, color: af.color || '#ff5247',
            life: af.life, maxLife: af.maxLife
        };
    }

    var srcClones = simState.clones || [];
    var clones = new Array(srcClones.length);
    for (var cl = 0; cl < srcClones.length; cl++) {
        var cObj = srcClones[cl];
        clones[cl] = {
            id: cObj.id, x: cObj.x, y: cObj.y, facing: cObj.facing,
            action: cObj.action, actionTick: cObj.actionTick,
            walkCycle: cObj.walkCycle, slotIndex: cObj.slotIndex || 0
        };
    }

    var srcBolts = simState.bolts || [];
    var bolts = new Array(srcBolts.length);
    for (var b = 0; b < srcBolts.length; b++) {
        var bl = srcBolts[b];
        bolts[b] = {
            id: bl.id, x1: bl.x1, y1: bl.y1, x2: bl.x2, y2: bl.y2,
            color: bl.color, isSky: !!bl.isSky, life: bl.life, maxLife: bl.maxLife
        };
    }

    var srcFlames = simState.flames || [];
    var flames = new Array(srcFlames.length);
    for (var fl = 0; fl < srcFlames.length; fl++) {
        var flObj = srcFlames[fl];
        flames[fl] = {
            id: flObj.id, kind: flObj.kind, x: flObj.x, y: flObj.y,
            radius: flObj.radius, height: flObj.height,
            life: flObj.life, maxLife: flObj.maxLife
        };
    }

    return {
        tick: simState.tick,
        inputMask: (typeof inputMask === 'number') ? (inputMask | 0) : 0,
        marker: classifyReplayMarker(stepResult),
        viewWidth: simState.setup.viewWidth,
        viewHeight: simState.setup.viewHeight,
        fighterId: (simState.setup && simState.setup.fighterId) || 'shadow',
        floor: simState.floor,
        score: simState.score,
        comboCount: simState.comboCount,
        streakTier: simState.streakTier || 0,
        parriesLanded: simState.parriesLanded,
        cameraX: simState.cameraX,
        screenShake: simState.screenShake,
        bannerText: simState.bannerText,
        bannerTimer: simState.bannerTimer,
        goPromptTimer: simState.goPromptTimer,
        isGameOver: simState.isGameOver,
        player: p ? {
            id: p.id, fighterId: p.fighterId || 'shadow',
            x: p.x, y: p.y, vx: p.vx, vy: p.vy,
            facing: p.facing, onGround: p.onGround,
            hp: p.hp, maxHp: p.maxHp, alive: p.alive,
            action: p.action, actionTick: p.actionTick, actionDuration: p.actionDuration,
            parryCounterTimer: p.parryCounterTimer, invulnTimer: p.invulnTimer,
            attackChargeTicks: p.attackChargeTicks || 0,
            orbitAngle: p.orbitAngle || 0,
            walkCycle: p.walkCycle, flashTimer: p.flashTimer
        } : null,
        enemies: enemies,
        projectiles: projectiles,
        traps: traps,
        particles: particles,
        slashes: slashes,
        callouts: callouts,
        afterimages: afterimages,
        clones: clones,
        bolts: bolts,
        flames: flames
    };
}

function pushReplayFrame(buf, simState, inputMask, stepResult) {
    var entry = {
        tick: simState.tick,
        renderFrame: captureRenderFrame(simState, inputMask, stepResult),
        simSnapshot: cloneSimState(simState)
    };

    if (buf.count < buf.capacity) {
        var writeIdx = (buf.start + buf.count) % buf.capacity;
        buf.slots[writeIdx] = entry;
        buf.count++;
    } else {
        buf.slots[buf.start] = entry;
        buf.start = (buf.start + 1) % buf.capacity;
    }
}

function getReplayLength(buf) {
    return buf.count;
}

function getReplayEntry(buf, logicalIndex) {
    if (buf.count === 0) return null;
    var idx = logicalIndex;
    if (idx < 0) idx = 0;
    if (idx >= buf.count) idx = buf.count - 1;
    return buf.slots[(buf.start + idx) % buf.capacity];
}

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
// Smooth Sub-Frame Keyframe Blending (for Slow-Mo, Reverse, & Scrubbing)
// ----------------------------------------------------------------------------
function lerp(a, b, t) {
    return a + (b - a) * t;
}

function buildIdMap(list) {
    var map = {};
    for (var i = 0; i < list.length; i++) {
        map[list[i].id] = list[i];
    }
    return map;
}

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
    // Do not interpolate across a floor transition jump
    if (f0.floor !== f1.floor) {
        return alpha < 0.5 ? f0 : f1;
    }

    var hud = alpha < 0.5 ? f0 : f1;

    // 1. Player
    var bp = null;
    if (f0.player && f1.player && f0.player.id === f1.player.id) {
        var p0 = f0.player;
        var p1 = f1.player;
        bp = {
            id: p0.id,
            fighterId: p0.fighterId || 'shadow',
            x: lerp(p0.x, p1.x, alpha),
            y: lerp(p0.y, p1.y, alpha),
            vx: lerp(p0.vx, p1.vx, alpha),
            vy: lerp(p0.vy, p1.vy, alpha),
            facing: alpha < 0.5 ? p0.facing : p1.facing,
            onGround: alpha < 0.5 ? p0.onGround : p1.onGround,
            hp: hud.player.hp,
            maxHp: p0.maxHp,
            alive: hud.player.alive,
            action: alpha < 0.5 ? p0.action : p1.action,
            actionTick: lerp(p0.actionTick, p1.actionTick, alpha),
            actionDuration: alpha < 0.5 ? p0.actionDuration : p1.actionDuration,
            parryCounterTimer: hud.player.parryCounterTimer,
            invulnTimer: hud.player.invulnTimer,
            attackChargeTicks: lerp(p0.attackChargeTicks || 0, p1.attackChargeTicks || 0, alpha),
            orbitAngle: lerp(p0.orbitAngle || 0, p1.orbitAngle || 0, alpha),
            walkCycle: lerp(p0.walkCycle, p1.walkCycle, alpha),
            flashTimer: hud.player.flashTimer
        };
    } else {
        bp = hud.player;
    }

    // 2. Enemies
    var e1Map = buildIdMap(f1.enemies);
    var seenE = {};
    var bEnemies = [];
    for (var ei = 0; ei < f0.enemies.length; ei++) {
        var e0 = f0.enemies[ei];
        var e1 = e1Map[e0.id];
        seenE[e0.id] = true;
        if (e1) {
            bEnemies.push({
                id: e0.id, kind: e0.kind,
                x: lerp(e0.x, e1.x, alpha),
                y: lerp(e0.y, e1.y, alpha),
                facing: alpha < 0.5 ? e0.facing : e1.facing,
                hp: alpha < 0.5 ? e0.hp : e1.hp,
                maxHp: e0.maxHp, scale: e0.scale,
                state: alpha < 0.5 ? e0.state : e1.state,
                stateTick: lerp(e0.stateTick, e1.stateTick, alpha),
                stateDur: alpha < 0.5 ? e0.stateDur : e1.stateDur,
                attackStyle: alpha < 0.5 ? e0.attackStyle : e1.attackStyle,
                walkCycle: lerp(e0.walkCycle, e1.walkCycle, alpha),
                flashTimer: alpha < 0.5 ? e0.flashTimer : e1.flashTimer,
                burnTimer: alpha < 0.5 ? (e0.burnTimer || 0) : (e1.burnTimer || 0)
            });
        } else if (alpha < 0.5) {
            bEnemies.push(e0);
        }
    }
    if (alpha >= 0.5) {
        for (var ei2 = 0; ei2 < f1.enemies.length; ei2++) {
            if (!seenE[f1.enemies[ei2].id]) bEnemies.push(f1.enemies[ei2]);
        }
    }

    // 3. Projectiles
    var pr1Map = buildIdMap(f1.projectiles);
    var seenPr = {};
    var bProj = [];
    for (var pi = 0; pi < f0.projectiles.length; pi++) {
        var pr0 = f0.projectiles[pi];
        var pr1 = pr1Map[pr0.id];
        seenPr[pr0.id] = true;
        if (pr1) {
            bProj.push({
                id: pr0.id,
                kind: alpha < 0.5 ? (pr0.kind || 'knife') : (pr1.kind || 'knife'),
                x: lerp(pr0.x, pr1.x, alpha),
                y: lerp(pr0.y, pr1.y, alpha),
                vx: alpha < 0.5 ? pr0.vx : pr1.vx,
                owner: alpha < 0.5 ? pr0.owner : pr1.owner,
                spin: lerp(pr0.spin, pr1.spin, alpha),
                radius: alpha < 0.5 ? (pr0.radius || 11) : (pr1.radius || 11),
                power: alpha < 0.5 ? (pr0.power || 0) : (pr1.power || 0),
                color: pr0.color || null,
                isFire: !!pr0.isFire,
                isWater: !!pr0.isWater,
                isRasengan: !!pr0.isRasengan,
                enemyKind: pr0.enemyKind || null,
                scale: pr0.scale || 1.0
            });
        } else if (alpha < 0.5) {
            bProj.push(pr0);
        }
    }
    if (alpha >= 0.5) {
        for (var pi2 = 0; pi2 < f1.projectiles.length; pi2++) {
            if (!seenPr[f1.projectiles[pi2].id]) bProj.push(f1.projectiles[pi2]);
        }
    }

    // 4. Traps
    var tr1Map = buildIdMap(f1.traps);
    var seenTr = {};
    var bTraps = [];
    for (var ti = 0; ti < f0.traps.length; ti++) {
        var t0 = f0.traps[ti];
        var t1 = tr1Map[t0.id];
        seenTr[t0.id] = true;
        if (t1) {
            bTraps.push({
                id: t0.id, kind: t0.kind,
                owner: alpha < 0.5 ? (t0.owner || 'env') : (t1.owner || 'env'),
                x: lerp(t0.x, t1.x, alpha),
                y: lerp(t0.y, t1.y, alpha),
                vx: alpha < 0.5 ? (t0.vx || 0) : (t1.vx || 0),
                angle: lerp(t0.angle, t1.angle, alpha),
                telegraph: lerp(t0.telegraph, t1.telegraph, alpha)
            });
        } else if (alpha < 0.5) {
            bTraps.push(t0);
        }
    }
    if (alpha >= 0.5) {
        for (var ti2 = 0; ti2 < f1.traps.length; ti2++) {
            if (!seenTr[f1.traps[ti2].id]) bTraps.push(f1.traps[ti2]);
        }
    }

    // 5. Particles
    var pt1Map = buildIdMap(f1.particles);
    var seenPt = {};
    var bParticles = [];
    for (var ki = 0; ki < f0.particles.length; ki++) {
        var pt0 = f0.particles[ki];
        var pt1 = pt1Map[pt0.id];
        seenPt[pt0.id] = true;
        if (pt1) {
            bParticles.push({
                id: pt0.id,
                x: lerp(pt0.x, pt1.x, alpha),
                y: lerp(pt0.y, pt1.y, alpha),
                size: pt0.size, color: pt0.color,
                life: lerp(pt0.life, pt1.life, alpha),
                maxLife: pt0.maxLife, kind: pt0.kind
            });
        } else if (alpha < 0.5) {
            bParticles.push(pt0);
        }
    }
    if (alpha >= 0.5) {
        for (var ki2 = 0; ki2 < f1.particles.length; ki2++) {
            if (!seenPt[f1.particles[ki2].id]) bParticles.push(f1.particles[ki2]);
        }
    }

    // 6. Slashes & Callouts
    var sl1Map = buildIdMap(f1.slashes);
    var bSlashes = [];
    for (var si = 0; si < f0.slashes.length; si++) {
        var sl0 = f0.slashes[si];
        var sl1 = sl1Map[sl0.id];
        if (sl1) {
            bSlashes.push({
                id: sl0.id, x: sl0.x, y: sl0.y, facing: sl0.facing,
                style: sl0.style, color: sl0.color, element: sl0.element || null,
                age: lerp(sl0.age, sl1.age, alpha), maxAge: sl0.maxAge
            });
        } else if (alpha < 0.5) {
            bSlashes.push(sl0);
        }
    }

    var co1Map = buildIdMap(f1.callouts);
    var bCallouts = [];
    for (var ci = 0; ci < f0.callouts.length; ci++) {
        var co0 = f0.callouts[ci];
        var co1 = co1Map[co0.id];
        if (co1) {
            bCallouts.push({
                id: co0.id, x: co0.x, y: lerp(co0.y, co1.y, alpha),
                text: co0.text, color: co0.color,
                life: lerp(co0.life, co1.life, alpha), maxLife: co0.maxLife
            });
        } else if (alpha < 0.5) {
            bCallouts.push(co0);
        }
    }

    // 7. Autonomous Shadow Clones smooth sub-frame blending
    var f0Clones = f0.clones || [];
    var f1Clones = f1.clones || [];
    var cl1Map = buildIdMap(f1Clones);
    var seenCl = {};
    var bClones = [];
    for (var cli = 0; cli < f0Clones.length; cli++) {
        var cl0 = f0Clones[cli];
        var cl1 = cl1Map[cl0.id];
        seenCl[cl0.id] = true;
        if (cl1) {
            bClones.push({
                id: cl0.id,
                x: lerp(cl0.x, cl1.x, alpha),
                y: lerp(cl0.y, cl1.y, alpha),
                facing: alpha < 0.5 ? cl0.facing : cl1.facing,
                action: alpha < 0.5 ? cl0.action : cl1.action,
                actionTick: lerp(cl0.actionTick || 0, cl1.actionTick || 0, alpha),
                walkCycle: lerp(cl0.walkCycle || 0, cl1.walkCycle || 0, alpha),
                slotIndex: cl0.slotIndex || 0
            });
        } else if (alpha < 0.5) {
            bClones.push(cl0);
        }
    }
    if (alpha >= 0.5) {
        for (var cli2 = 0; cli2 < f1Clones.length; cli2++) {
            if (!seenCl[f1Clones[cli2].id]) bClones.push(f1Clones[cli2]);
        }
    }

    return {
        tick: f0.tick + alpha,
        inputMask: f1.inputMask || 0,
        marker: hud.marker || null,
        viewWidth: f0.viewWidth,
        viewHeight: f0.viewHeight,
        fighterId: f0.fighterId || 'shadow',
        floor: f0.floor,
        score: hud.score,
        comboCount: hud.comboCount,
        streakTier: hud.streakTier || 0,
        parriesLanded: hud.parriesLanded,
        cameraX: lerp(f0.cameraX, f1.cameraX, alpha),
        screenShake: lerp(f0.screenShake, f1.screenShake, alpha),
        bannerText: hud.bannerText,
        bannerTimer: hud.bannerTimer,
        goPromptTimer: hud.goPromptTimer,
        isGameOver: hud.isGameOver,
        player: bp,
        enemies: bEnemies,
        projectiles: bProj,
        traps: bTraps,
        particles: bParticles,
        slashes: bSlashes,
        callouts: bCallouts,
        afterimages: hud.afterimages || [],
        clones: bClones,
        bolts: hud.bolts || [],
        flames: hud.flames || []
    };
}
