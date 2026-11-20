// ============================================================================
// ai.js - Deterministic AI Player (Presses Standard Input Buttons)
//
// Outputs the exact same INPUT_* bitmask a human player produces:
//   INPUT_LEFT | INPUT_RIGHT | INPUT_THRUST | INPUT_SHOOT
//
// Rules:
//   - 100% deterministic: zero Math.random(), zero wall-clock timers.
//   - Reads simulation state (like a player looking at the screen) and emits
//     button presses via computeAiInput(aiState, simState).
// ============================================================================

var AI_TURN_DEADZONE      = 0.09;   // radians (~5 deg)
var AI_FIRE_ANGLE_TOL     = 0.18;   // radians (~10 deg)
var AI_SHOOT_COOLDOWN     = 10;     // ticks between shot taps (human-like)
var AI_DANGER_RADIUS      = 135;    // evade enemies closer than this
var AI_MAX_SPEED          = 3.6;    // avoid flying out of control
var AI_WALL_MARGIN        = 55;     // steer away from arena edges
var AI_OBSTACLE_MARGIN    = 42;     // steer away from central box

function createAiState() {
    return {
        shootCooldown: 0,
        lastMode: 'hunt' // 'evade' or 'hunt' (useful for debug inspection)
    };
}

function resetAiState(aiState) {
    aiState.shootCooldown = 0;
    aiState.lastMode = 'hunt';
}

function aiWrapAngle(a) {
    while (a > DET_PI)  a -= DET_TWO_PI;
    while (a < -DET_PI) a += DET_TWO_PI;
    return a;
}

// Checks if the straight line segment from (x0,y0) to (x1,y1) hits the central obstacle
function aiSegmentHitsObstacle(x0, y0, x1, y1, obs, pad) {
    var dx = x1 - x0;
    var dy = y1 - y0;
    var hit = sweepPointAgainstBox(
        x0, y0, dx, dy,
        obs.x - pad, obs.x + obs.width + pad,
        obs.y - pad, obs.y + obs.height + pad,
        1.0
    );
    return hit !== null;
}

// Computes desired evasion vector from nearby enemies, walls, and central obstacle.
// Returns { active, vx, vy }
function aiComputeAvoidance(p, simState) {
    var w = simState.setup.worldWidth;
    var h = simState.setup.worldHeight;
    var obs = simState.obstacle;

    var avoidX = 0.0;
    var avoidY = 0.0;
    var danger = false;

    // 1. Repel from close / approaching enemies
    for (var i = 0; i < simState.enemies.length; i++) {
        var e = simState.enemies[i];
        var dx = p.x - e.x;
        var dy = p.y - e.y;
        var dist = detHypot(dx, dy);
        if (dist < 1e-4) dist = 1e-4;

        // Predict enemy position slightly ahead (~18 ticks)
        var fx = p.x - (e.x + e.vx * 18);
        var fy = p.y - (e.y + e.vy * 18);
        var futureDist = detHypot(fx, fy);

        if (dist < AI_DANGER_RADIUS || futureDist < AI_DANGER_RADIUS * 0.85) {
            var weight = (AI_DANGER_RADIUS - Math.min(dist, futureDist)) / AI_DANGER_RADIUS;
            weight = weight * weight * 3.0;
            avoidX += (dx / dist) * weight;
            avoidY += (dy / dist) * weight;
            danger = true;
        }
    }

    // 2. Repel from arena walls when close
    if (p.x < AI_WALL_MARGIN) {
        avoidX += (AI_WALL_MARGIN - p.x) / AI_WALL_MARGIN * 1.6;
    } else if (p.x > w - AI_WALL_MARGIN) {
        avoidX -= (p.x - (w - AI_WALL_MARGIN)) / AI_WALL_MARGIN * 1.6;
    }
    if (p.y < AI_WALL_MARGIN) {
        avoidY += (AI_WALL_MARGIN - p.y) / AI_WALL_MARGIN * 1.6;
    } else if (p.y > h - AI_WALL_MARGIN) {
        avoidY -= (p.y - (h - AI_WALL_MARGIN)) / AI_WALL_MARGIN * 1.6;
    }

    // 3. Repel from central obstacle
    var obsCx = obs.x + obs.width * 0.5;
    var obsCy = obs.y + obs.height * 0.5;
    var clampedX = Math.max(obs.x, Math.min(p.x, obs.x + obs.width));
    var clampedY = Math.max(obs.y, Math.min(p.y, obs.y + obs.height));
    var odx = p.x - clampedX;
    var ody = p.y - clampedY;
    var odist = detHypot(odx, ody);

    if (odist < AI_OBSTACLE_MARGIN) {
        var oWeight = (AI_OBSTACLE_MARGIN - odist) / AI_OBSTACLE_MARGIN * 2.2;
        if (odist > 1e-4) {
            avoidX += (odx / odist) * oWeight;
            avoidY += (ody / odist) * oWeight;
        } else {
            var awayX = p.x - obsCx;
            var awayY = p.y - obsCy;
            var awayLen = detHypot(awayX, awayY) || 1.0;
            avoidX += (awayX / awayLen) * oWeight;
            avoidY += (awayY / awayLen) * oWeight;
        }
        if (odist < AI_OBSTACLE_MARGIN * 0.5) {
            danger = true;
        }
    }

    return {
        active: danger && (detHypot(avoidX, avoidY) > 0.15),
        vx: avoidX,
        vy: avoidY
    };
}

// Selects the best target enemy (prefers enemies with clear line of sight and close distance)
function aiPickTarget(p, simState) {
    var obs = simState.obstacle;
    var bestEnemy = null;
    var bestScore = 1e12;
    var bestHasLos = false;

    for (var i = 0; i < simState.enemies.length; i++) {
        var e = simState.enemies[i];
        var dist = detHypot(e.x - p.x, e.y - p.y);
        var blocked = aiSegmentHitsObstacle(p.x, p.y, e.x, e.y, obs, BULLET_RADIUS + 2);
        // Strongly prefer unobstructed targets
        var score = dist + (blocked ? 320.0 : 0.0);
        if (score < bestScore) {
            bestScore = score;
            bestEnemy = e;
            bestHasLos = !blocked;
        }
    }

    return { enemy: bestEnemy, hasLos: bestHasLos };
}

// Main per-tick AI decision function: returns standard INPUT_* bitmask
function computeAiInput(aiState, simState) {
    if (!simState || simState.isGameOver || !simState.player || !simState.player.alive) {
        return INPUT_NONE;
    }

    if (aiState.shootCooldown > 0) {
        aiState.shootCooldown--;
    }

    var p = simState.player;
    var w = simState.setup.worldWidth;
    var h = simState.setup.worldHeight;
    var obs = simState.obstacle;
    var speed = detHypot(p.vx, p.vy);
    var mask = INPUT_NONE;

    var avoid = aiComputeAvoidance(p, simState);
    var targetInfo = aiPickTarget(p, simState);
    var target = targetInfo.enemy;

    // --- Mode 1: Evade immediate threat ---
    if (avoid.active && !p.isInvincible) {
        aiState.lastMode = 'evade';
        var fleeAngle = detAtan2(avoid.vy, avoid.vx);
        var fleeErr = aiWrapAngle(fleeAngle - p.angle);

        if (fleeErr < -AI_TURN_DEADZONE)      mask |= INPUT_LEFT;
        else if (fleeErr > AI_TURN_DEADZONE)  mask |= INPUT_RIGHT;

        // Thrust away once roughly facing escape direction
        if (Math.abs(fleeErr) < 0.9 && speed < AI_MAX_SPEED) {
            mask |= INPUT_THRUST;
        }

        // Opportunistic shot if an enemy happens to be right in front of the nose!
        if (target && targetInfo.hasLos && aiState.shootCooldown === 0 && simState.bullets.length < MAX_BULLETS) {
            var snapAngle = detAtan2(target.y - p.y, target.x - p.x);
            if (Math.abs(aiWrapAngle(snapAngle - p.angle)) < AI_FIRE_ANGLE_TOL) {
                mask |= INPUT_SHOOT;
                aiState.shootCooldown = AI_SHOOT_COOLDOWN;
            }
        }
        return mask;
    }

    // --- Mode 2: Hunt & Shoot ---
    aiState.lastMode = 'hunt';
    if (!target) {
        return INPUT_NONE;
    }

    var distToTarget = detHypot(target.x - p.x, target.y - p.y);

    // If line of sight is blocked by the central obstacle, fly around the nearest corner
    if (!targetInfo.hasLos) {
        var obsCx = obs.x + obs.width * 0.5;
        var obsCy = obs.y + obs.height * 0.5;
        // Orbit clockwise around the obstacle center to gain line of sight
        var toObsX = obsCx - p.x;
        var toObsY = obsCy - p.y;
        var tangentX = -toObsY;
        var tangentY = toObsX;
        // Mix tangent with slight repulsion if close to walls/obstacle
        var steerX = tangentX + avoid.vx * 120.0;
        var steerY = tangentY + avoid.vy * 120.0;
        var navAngle = detAtan2(steerY, steerX);
        var navErr = aiWrapAngle(navAngle - p.angle);

        if (navErr < -AI_TURN_DEADZONE)     mask |= INPUT_LEFT;
        else if (navErr > AI_TURN_DEADZONE) mask |= INPUT_RIGHT;

        if (Math.abs(navErr) < 0.7 && speed < AI_MAX_SPEED * 0.85) {
            mask |= INPUT_THRUST;
        }
        return mask;
    }

    // Predict target position (linear lead compensation)
    var leadTicks = Math.min(distToTarget / BULLET_SPEED, 45.0);
    var aimX = target.x + target.vx * leadTicks;
    var aimY = target.y + target.vy * leadTicks;
    aimX = Math.max(ENEMY_RADIUS, Math.min(w - ENEMY_RADIUS, aimX));
    aimY = Math.max(ENEMY_RADIUS, Math.min(h - ENEMY_RADIUS, aimY));

    var aimAngle = detAtan2(aimY - p.y, aimX - p.x);
    var aimErr = aiWrapAngle(aimAngle - p.angle);

    if (aimErr < -AI_TURN_DEADZONE)     mask |= INPUT_LEFT;
    else if (aimErr > AI_TURN_DEADZONE) mask |= INPUT_RIGHT;

    // Fire when lined up and shot path isn't blocked by central obstacle
    if (Math.abs(aimErr) < AI_FIRE_ANGLE_TOL &&
        aiState.shootCooldown === 0 &&
        simState.bullets.length < MAX_BULLETS &&
        !aiSegmentHitsObstacle(p.x, p.y, aimX, aimY, obs, BULLET_RADIUS)) {
        mask |= INPUT_SHOOT;
        aiState.shootCooldown = AI_SHOOT_COOLDOWN;
    }

    // Gentle thrusting: close distance if far, or keep moving cleanly
    if (distToTarget > 240 && Math.abs(aimErr) < 0.45 && speed < AI_MAX_SPEED * 0.7) {
        // Don't thrust straight into obstacle
        var aheadX = p.x + detCos(p.angle) * 70;
        var aheadY = p.y + detSin(p.angle) * 70;
        if (!aiSegmentHitsObstacle(p.x, p.y, aheadX, aheadY, obs, p.r + 6)) {
            mask |= INPUT_THRUST;
        }
    }

    return mask;
}
