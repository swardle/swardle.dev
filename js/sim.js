// ============================================================================
// sim.js - Pure Deterministic Fixed-Timestep Simulation
//
// Rules for determinism:
//   - No DOM, Canvas, Tone.js, Date.now(), performance.now(), or Math.random().
//   - All randomness comes exclusively from state.rng (see rng.js).
//   - All physics runs in logical setup.worldWidth x setup.worldHeight space.
//   - Swept collisions compute exact sub-frame impact points (t in [0, 1]) so
//     the Replay system can blend slow-motion bounces accurately.
// ============================================================================

var SIM_TICK_RATE = 60;

var PLAYER_SIZE           = 20;
var PLAYER_RADIUS         = PLAYER_SIZE / 2;
var PLAYER_THRUST         = 0.1;
var PLAYER_TURN_SPEED     = 0.1;
var PLAYER_FRICTION       = 0.99;
var PLAYER_BOUNCE_DAMP    = 0.8;
var PLAYER_INVINCIBLE_SPAWN = 180;
var PLAYER_INVINCIBLE_LEVEL = 120;

var BULLET_SPEED          = 7;
var BULLET_RADIUS         = 2;
var BULLET_LIFE           = 240;
var BULLET_MAX_BOUNCES    = 2;
var BULLET_BOUNCE_DAMP    = 1.0;
var MAX_BULLETS           = 4;

var ENEMY_RADIUS          = 18;
var ENEMY_BOUNCE_DAMP     = 1.0;

var PARTICLE_LIFE         = 60;
var PARTICLE_FRICTION     = 0.98;

var MAX_BOUNCE_SUBSTEPS   = 4;
var COLLISION_EPS         = 1e-6;

function degToRad(d) {
    return d * DET_PI / 180.0;
}

// ----------------------------------------------------------------------------
// State Creation & Cloning (plain C-style structs)
// ----------------------------------------------------------------------------
function createObstacle(worldWidth, worldHeight) {
    var w = Math.min(worldWidth * 0.5, 400);
    var h = 120;
    return {
        x: worldWidth / 2 - w / 2,
        y: worldHeight / 2 - h / 2,
        width: w,
        height: h
    };
}

function allocEntityId(state) {
    var id = state.nextEntityId;
    state.nextEntityId = id + 1;
    return id;
}

function spawnPlayerEntity(state) {
    var obs = state.obstacle;
    var r = PLAYER_RADIUS;
    var w = state.setup.worldWidth;
    var h = state.setup.worldHeight;
    var x = 0;
    var y = 0;

    // Guarded loop (fixes original bug where this.r was undefined on first spawn)
    var tries = 0;
    do {
        x = rngRange(state.rng, PLAYER_SIZE, w - PLAYER_SIZE);
        y = rngRange(state.rng, PLAYER_SIZE, h - PLAYER_SIZE);
        tries++;
    } while (
        tries < 100 &&
        x > obs.x - r && x < obs.x + obs.width + r &&
        y > obs.y - r && y < obs.y + obs.height + r
    );

    return {
        id: allocEntityId(state), // New ID on respawn prevents replay lerping across death
        x: x,
        y: y,
        vx: 0,
        vy: 0,
        r: r,
        angle: degToRad(270),
        isThrusting: false,
        isInvincible: true,
        invincibilityTimer: PLAYER_INVINCIBLE_SPAWN,
        alive: true
    };
}

function spawnEnemyEntity(state) {
    var w = state.setup.worldWidth;
    var h = state.setup.worldHeight;
    var r = ENEMY_RADIUS;
    var side = rngInt(state.rng, 0, 4);
    var x, y;

    if (side === 0) {
        x = rngRange(state.rng, 0, w);
        y = -r;
    } else if (side === 1) {
        x = w + r;
        y = rngRange(state.rng, 0, h);
    } else if (side === 2) {
        x = rngRange(state.rng, 0, w);
        y = h + r;
    } else {
        x = -r;
        y = rngRange(state.rng, 0, h);
    }

    var angleToCenter = detAtan2(h / 2 - y, w / 2 - x);
    var speed = 1.0 + state.level * 0.1;

    return {
        id: allocEntityId(state),
        x: x,
        y: y,
        vx: detCos(angleToCenter) * speed,
        vy: detSin(angleToCenter) * speed,
        r: r,
        angle: 0,
        turnSpeed: rngRange(state.rng, -0.05, 0.05)
    };
}

function spawnEnemyWave(state) {
    var count = 3 + state.level * 2;
    for (var i = 0; i < count; i++) {
        state.enemies.push(spawnEnemyEntity(state));
    }
}

function spawnExplosionParticles(state, x, y, color, count) {
    for (var i = 0; i < count; i++) {
        state.particles.push({
            id: allocEntityId(state),
            x: x,
            y: y,
            vx: rngRange(state.rng, -2, 2),
            vy: rngRange(state.rng, -2, 2),
            life: PARTICLE_LIFE,
            color: color,
            size: rngRange(state.rng, 1, 3)
        });
    }
}

function createSimState(setup) {
    var worldWidth = Math.max(320, Math.round(setup.worldWidth));
    var worldHeight = Math.max(240, Math.round(setup.worldHeight));
    var cleanSetup = {
        seed: (setup.seed >>> 0),
        worldWidth: worldWidth,
        worldHeight: worldHeight,
        tickRate: setup.tickRate || SIM_TICK_RATE
    };

    var state = {
        tick: 0,
        setup: cleanSetup,
        rng: createRng(cleanSetup.seed),
        nextEntityId: 1,
        score: 0,
        lives: 3,
        level: 1,
        isGameOver: false,
        obstacle: createObstacle(worldWidth, worldHeight),
        player: null,
        bullets: [],
        enemies: [],
        particles: []
    };

    state.player = spawnPlayerEntity(state);
    spawnEnemyWave(state);
    return state;
}

function cloneSimState(state) {
    var p = state.player;
    var bulletsCopy = new Array(state.bullets.length);
    for (var i = 0; i < state.bullets.length; i++) {
        var b = state.bullets[i];
        bulletsCopy[i] = {
            id: b.id, x: b.x, y: b.y, vx: b.vx, vy: b.vy,
            r: b.r, life: b.life, bounces: b.bounces
        };
    }

    var enemiesCopy = new Array(state.enemies.length);
    for (var j = 0; j < state.enemies.length; j++) {
        var e = state.enemies[j];
        enemiesCopy[j] = {
            id: e.id, x: e.x, y: e.y, vx: e.vx, vy: e.vy,
            r: e.r, angle: e.angle, turnSpeed: e.turnSpeed
        };
    }

    var particlesCopy = new Array(state.particles.length);
    for (var k = 0; k < state.particles.length; k++) {
        var pt = state.particles[k];
        particlesCopy[k] = {
            id: pt.id, x: pt.x, y: pt.y, vx: pt.vx, vy: pt.vy,
            life: pt.life, color: pt.color, size: pt.size
        };
    }

    return {
        tick: state.tick,
        setup: {
            seed: state.setup.seed,
            worldWidth: state.setup.worldWidth,
            worldHeight: state.setup.worldHeight,
            tickRate: state.setup.tickRate
        },
        rng: cloneRng(state.rng),
        nextEntityId: state.nextEntityId,
        score: state.score,
        lives: state.lives,
        level: state.level,
        isGameOver: state.isGameOver,
        obstacle: {
            x: state.obstacle.x,
            y: state.obstacle.y,
            width: state.obstacle.width,
            height: state.obstacle.height
        },
        player: p ? {
            id: p.id, x: p.x, y: p.y, vx: p.vx, vy: p.vy,
            r: p.r, angle: p.angle,
            isThrusting: p.isThrusting,
            isInvincible: p.isInvincible,
            invincibilityTimer: p.invincibilityTimer,
            alive: p.alive
        } : null,
        bullets: bulletsCopy,
        enemies: enemiesCopy,
        particles: particlesCopy
    };
}

// ----------------------------------------------------------------------------
// Swept Collision Math (Ray vs Expanded AABB & Arena Walls)
// Computes exact time-of-impact t in [0, rem] and records sub-frame bounce
// points so Replay can interpolate cleanly onto walls and obstacle edges.
// ----------------------------------------------------------------------------

// Ray (ox, oy) + t*(vx, vy) against axis-aligned box [minX, maxX] x [minY, maxY]
// Returns { t, nx, ny } or null if no hit in [0, maxT].
function sweepPointAgainstBox(ox, oy, vx, vy, minX, maxX, minY, maxY, maxT) {
    var tMin = 0.0;
    var tMax = maxT;
    var hitNx = 0;
    var hitNy = 0;

    // X slab
    if (Math.abs(vx) < 1e-12) {
        if (ox < minX || ox > maxX) return null;
    } else {
        var invVx = 1.0 / vx;
        var t1 = (minX - ox) * invVx;
        var t2 = (maxX - ox) * invVx;
        var nx = -1;
        if (t1 > t2) {
            var tmp = t1; t1 = t2; t2 = tmp;
            nx = 1;
        }
        if (t1 > tMin) {
            tMin = t1;
            hitNx = nx;
            hitNy = 0;
        }
        if (t2 < tMax) {
            tMax = t2;
        }
        if (tMin > tMax) return null;
    }

    // Y slab
    if (Math.abs(vy) < 1e-12) {
        if (oy < minY || oy > maxY) return null;
    } else {
        var invVy = 1.0 / vy;
        var ty1 = (minY - oy) * invVy;
        var ty2 = (maxY - oy) * invVy;
        var ny = -1;
        if (ty1 > ty2) {
            var tmpY = ty1; ty1 = ty2; ty2 = tmpY;
            ny = 1;
        }
        if (ty1 > tMin) {
            tMin = ty1;
            hitNx = 0;
            hitNy = ny;
        }
        if (ty2 < tMax) {
            tMax = ty2;
        }
        if (tMin > tMax) return null;
    }

    // If ray starts strictly outside and hits entering face, hitNx/hitNy is non-zero
    if (hitNx === 0 && hitNy === 0) {
        return null;
    }
    if (tMin < 0 || tMin > maxT) {
        return null;
    }
    return { t: tMin, nx: hitNx, ny: hitNy };
}

// Resolves any slight initial penetration into the expanded obstacle AABB
function resolveInitialObstacleOverlap(ent, obs, dampening, subFrames, tAccum, angleAtT) {
    var minX = obs.x - ent.r;
    var maxX = obs.x + obs.width + ent.r;
    var minY = obs.y - ent.r;
    var maxY = obs.y + obs.height + ent.r;

    if (ent.x > minX && ent.x < maxX && ent.y > minY && ent.y < maxY) {
        var dl = ent.x - minX;
        var dr = maxX - ent.x;
        var dt = ent.y - minY;
        var db = maxY - ent.y;
        var m = Math.min(dl, dr, dt, db);

        if (m === dl) {
            ent.x = minX - COLLISION_EPS;
            if (ent.vx > 0) ent.vx = -ent.vx * dampening;
        } else if (m === dr) {
            ent.x = maxX + COLLISION_EPS;
            if (ent.vx < 0) ent.vx = -ent.vx * dampening;
        } else if (m === dt) {
            ent.y = minY - COLLISION_EPS;
            if (ent.vy > 0) ent.vy = -ent.vy * dampening;
        } else {
            ent.y = maxY + COLLISION_EPS;
            if (ent.vy < 0) ent.vy = -ent.vy * dampening;
        }

        subFrames.push({ t: tAccum, x: ent.x, y: ent.y, angle: angleAtT });
        return true;
    }
    return false;
}

// Moves an entity by one full tick (t: 0 -> 1) with swept bounces against
// outer arena walls and the central obstacle.
// Returns { bounceCount, hitPositions, terminated, endT }
function moveEntitySwept(ent, obs, worldWidth, worldHeight, dampening, allowOutsideEntry, angleStart, angleDelta, maxBouncesBeforeDie, outSubFrames) {
    var tAccum = 0.0;
    var rem = 1.0;
    var bounceCount = 0;
    var hitPositions = [];
    var terminated = false;
    var endT = 1.0;

    var minWallX = ent.r;
    var maxWallX = worldWidth - ent.r;
    var minWallY = ent.r;
    var maxWallY = worldHeight - ent.r;

    var obsMinX = obs.x - ent.r;
    var obsMaxX = obs.x + obs.width + ent.r;
    var obsMinY = obs.y - ent.r;
    var obsMaxY = obs.y + obs.height + ent.r;

    // Handle edge case where entity starts slightly inside obstacle
    if (resolveInitialObstacleOverlap(ent, obs, dampening, outSubFrames, 0.0, angleStart)) {
        bounceCount++;
        hitPositions.push({ x: ent.x, y: ent.y });
        if (maxBouncesBeforeDie !== null) {
            ent.bounces--;
            if (ent.bounces < 0) {
                return { bounceCount: bounceCount, hitPositions: hitPositions, terminated: true, endT: 0.0 };
            }
        }
    }

    for (var step = 0; step < MAX_BOUNCE_SUBSTEPS && rem > 1e-9; step++) {
        var bestT = rem + 1.0;
        var bestNx = 0;
        var bestNy = 0;
        var foundHit = false;

        // 1. Check outer walls
        // Left wall (x = minWallX)
        if (ent.vx < -1e-12) {
            if (!allowOutsideEntry || ent.x >= minWallX - COLLISION_EPS) {
                var tLeft = (minWallX - ent.x) / ent.vx;
                if (tLeft < 0 && !allowOutsideEntry && ent.x < minWallX) tLeft = 0;
                if (tLeft >= 0 && tLeft <= rem && tLeft < bestT) {
                    bestT = tLeft; bestNx = 1; bestNy = 0; foundHit = true;
                }
            }
        }
        // Right wall (x = maxWallX)
        if (ent.vx > 1e-12) {
            if (!allowOutsideEntry || ent.x <= maxWallX + COLLISION_EPS) {
                var tRight = (maxWallX - ent.x) / ent.vx;
                if (tRight < 0 && !allowOutsideEntry && ent.x > maxWallX) tRight = 0;
                if (tRight >= 0 && tRight <= rem && tRight < bestT) {
                    bestT = tRight; bestNx = -1; bestNy = 0; foundHit = true;
                }
            }
        }
        // Top wall (y = minWallY)
        if (ent.vy < -1e-12) {
            if (!allowOutsideEntry || ent.y >= minWallY - COLLISION_EPS) {
                var tTop = (minWallY - ent.y) / ent.vy;
                if (tTop < 0 && !allowOutsideEntry && ent.y < minWallY) tTop = 0;
                if (tTop >= 0 && tTop <= rem && tTop < bestT) {
                    bestT = tTop; bestNx = 0; bestNy = 1; foundHit = true;
                }
            }
        }
        // Bottom wall (y = maxWallY)
        if (ent.vy > 1e-12) {
            if (!allowOutsideEntry || ent.y <= maxWallY + COLLISION_EPS) {
                var tBottom = (maxWallY - ent.y) / ent.vy;
                if (tBottom < 0 && !allowOutsideEntry && ent.y > maxWallY) tBottom = 0;
                if (tBottom >= 0 && tBottom <= rem && tBottom < bestT) {
                    bestT = tBottom; bestNx = 0; bestNy = -1; foundHit = true;
                }
            }
        }

        // 2. Check central obstacle expanded AABB
        var obsHit = sweepPointAgainstBox(
            ent.x, ent.y, ent.vx, ent.vy,
            obsMinX, obsMaxX, obsMinY, obsMaxY, rem
        );
        if (obsHit && obsHit.t < bestT) {
            bestT = obsHit.t;
            bestNx = obsHit.nx;
            bestNy = obsHit.ny;
            foundHit = true;
        }

        if (!foundHit) {
            // Clear path for the rest of the tick
            ent.x += ent.vx * rem;
            ent.y += ent.vy * rem;
            tAccum = 1.0;
            rem = 0.0;
            break;
        }

        // Advance to exact impact point
        ent.x += ent.vx * bestT;
        ent.y += ent.vy * bestT;
        tAccum += bestT;
        rem -= bestT;

        var hitAngle = angleStart + angleDelta * tAccum;
        outSubFrames.push({
            t: tAccum,
            x: ent.x,
            y: ent.y,
            angle: hitAngle
        });
        hitPositions.push({ x: ent.x, y: ent.y });
        bounceCount++;

        // Reflect along hit normal
        if (bestNx !== 0) {
            ent.vx = -ent.vx * dampening;
            ent.x += bestNx * COLLISION_EPS;
        }
        if (bestNy !== 0) {
            ent.vy = -ent.vy * dampening;
            ent.y += bestNy * COLLISION_EPS;
        }

        // Handle limited-bounce entities (bullets)
        if (maxBouncesBeforeDie !== null) {
            ent.bounces--;
            if (ent.bounces < 0) {
                terminated = true;
                endT = tAccum;
                break;
            }
        }
    }

    // Safety clamp for non-outside-entering entities (player)
    if (!allowOutsideEntry && !terminated) {
        if (ent.x < minWallX) ent.x = minWallX;
        else if (ent.x > maxWallX) ent.x = maxWallX;
        if (ent.y < minWallY) ent.y = minWallY;
        else if (ent.y > maxWallY) ent.y = maxWallY;
    }

    return {
        bounceCount: bounceCount,
        hitPositions: hitPositions,
        terminated: terminated,
        endT: endT
    };
}

// ----------------------------------------------------------------------------
// Main Simulation Step (advances state by exactly 1 deterministic tick)
// ----------------------------------------------------------------------------
function stepSimulation(state, inputMask) {
    var result = {
        soundEvents: [],
        isThrusting: false,
        entitySubFrames: {}, // entityId -> [ { t, x, y, angle }, ... ]
        entityEndPoints: {}  // entityId -> { t, x, y, r, angle, kind }
    };

    if (state.isGameOver) {
        return result;
    }

    state.tick++;

    var w = state.setup.worldWidth;
    var h = state.setup.worldHeight;
    var obs = state.obstacle;
    var p = state.player;

    // 1. Update Player
    if (p && p.alive) {
        if (p.isInvincible) {
            p.invincibilityTimer--;
            if (p.invincibilityTimer <= 0) {
                p.isInvincible = false;
                p.invincibilityTimer = 0;
            }
        }

        var angleStart = p.angle;
        if (inputMask & INPUT_LEFT)  p.angle -= PLAYER_TURN_SPEED;
        if (inputMask & INPUT_RIGHT) p.angle += PLAYER_TURN_SPEED;
        var angleDelta = p.angle - angleStart;

        p.isThrusting = !!(inputMask & INPUT_THRUST);
        result.isThrusting = p.isThrusting;

        if (p.isThrusting) {
            p.vx += detCos(p.angle) * PLAYER_THRUST;
            p.vy += detSin(p.angle) * PLAYER_THRUST;
        }

        p.vx *= PLAYER_FRICTION;
        p.vy *= PLAYER_FRICTION;

        var playerSub = [];
        moveEntitySwept(
            p, obs, w, h, PLAYER_BOUNCE_DAMP,
            false, angleStart, angleDelta, null, playerSub
        );
        if (playerSub.length > 0) {
            result.entitySubFrames[p.id] = playerSub;
        }

        // Shoot (now strictly inside fixed sim tick!)
        if ((inputMask & INPUT_SHOOT) && state.bullets.length < MAX_BULLETS) {
            var bx = p.x + detCos(p.angle) * (PLAYER_SIZE / 2);
            var by = p.y + detSin(p.angle) * (PLAYER_SIZE / 2);
            state.bullets.push({
                id: allocEntityId(state),
                x: bx,
                y: by,
                vx: detCos(p.angle) * BULLET_SPEED,
                vy: detSin(p.angle) * BULLET_SPEED,
                r: BULLET_RADIUS,
                life: BULLET_LIFE,
                bounces: BULLET_MAX_BOUNCES
            });
            result.soundEvents.push('shoot');
        }
    }

    // 2. Update Bullets (with swept bounces + exact mid-tick expiration)
    var survivingBullets = [];
    for (var bi = 0; bi < state.bullets.length; bi++) {
        var b = state.bullets[bi];
        var bulletSub = [];
        var moveRes = moveEntitySwept(
            b, obs, w, h, BULLET_BOUNCE_DAMP,
            false, 0, 0, true, bulletSub
        );
        b.life--;

        if (moveRes.bounceCount > 0) {
            for (var hi = 0; hi < moveRes.hitPositions.length; hi++) {
                var hp = moveRes.hitPositions[hi];
                spawnExplosionParticles(state, hp.x, hp.y, '#ff0', 2);
                result.soundEvents.push('explosion_small');
            }
        }

        if (bulletSub.length > 0) {
            result.entitySubFrames[b.id] = bulletSub;
        }

        if (moveRes.terminated) {
            // Record exact end point so slow-mo replay draws bullet right up to wall
            result.entityEndPoints[b.id] = {
                t: moveRes.endT,
                x: b.x,
                y: b.y,
                r: b.r,
                angle: 0,
                kind: 'bullet'
            };
        } else if (b.life > 0 && b.bounces >= 0) {
            survivingBullets.push(b);
        }
    }
    state.bullets = survivingBullets;

    // 3. Update Enemies (swept bounces off walls & central obstacle, undamped)
    for (var ei = 0; ei < state.enemies.length; ei++) {
        var e = state.enemies[ei];
        var eAngleStart = e.angle;
        e.angle += e.turnSpeed;
        var enemySub = [];
        moveEntitySwept(
            e, obs, w, h, ENEMY_BOUNCE_DAMP,
            true, eAngleStart, e.turnSpeed, null, enemySub
        );
        if (enemySub.length > 0) {
            result.entitySubFrames[e.id] = enemySub;
        }
    }

    // 4. Update Particles
    var survivingParticles = [];
    for (var pi = 0; pi < state.particles.length; pi++) {
        var pt = state.particles[pi];
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.vx *= PARTICLE_FRICTION;
        pt.vy *= PARTICLE_FRICTION;
        pt.life--;
        if (pt.life > 0) {
            survivingParticles.push(pt);
        }
    }
    state.particles = survivingParticles;

    // 5. Check Bullet vs Enemy Collisions
    for (var i = state.bullets.length - 1; i >= 0; i--) {
        var bul = state.bullets[i];
        for (var j = state.enemies.length - 1; j >= 0; j--) {
            var enm = state.enemies[j];
            var dx = bul.x - enm.x;
            var dy = bul.y - enm.y;
            var hitDist = enm.r + bul.r;
            if (dx * dx + dy * dy < hitDist * hitDist) {
                result.entityEndPoints[bul.id] = {
                    t: 1.0, x: bul.x, y: bul.y, r: bul.r, angle: 0, kind: 'bullet'
                };
                result.entityEndPoints[enm.id] = {
                    t: 1.0, x: enm.x, y: enm.y, r: enm.r, angle: enm.angle, kind: 'enemy'
                };
                spawnExplosionParticles(state, enm.x, enm.y, '#f00', 15);
                result.soundEvents.push('explosion');
                state.enemies.splice(j, 1);
                state.bullets.splice(i, 1);
                state.score += 100;
                break;
            }
        }
    }

    // 6. Check Player vs Enemy Collisions
    if (p && p.alive && !p.isInvincible) {
        for (var k = state.enemies.length - 1; k >= 0; k--) {
            var enemy = state.enemies[k];
            var pdx = p.x - enemy.x;
            var pdy = p.y - enemy.y;
            var pHitDist = p.r + enemy.r;
            if (pdx * pdx + pdy * pdy < pHitDist * pHitDist) {
                spawnExplosionParticles(state, enemy.x, enemy.y, '#f00', 15);
                result.soundEvents.push('explosion');
                state.enemies.splice(k, 1);

                state.lives--;
                spawnExplosionParticles(state, p.x, p.y, '#0ff', 30);
                result.soundEvents.push('player_death');

                if (state.lives > 0) {
                    state.player = spawnPlayerEntity(state);
                    p = state.player;
                } else {
                    p.alive = false;
                    p.isThrusting = false;
                    state.isGameOver = true;
                    result.isThrusting = false;
                }
                break;
            }
        }
    }

    // 7. Check Level Up
    if (state.enemies.length === 0 && !state.isGameOver) {
        state.level++;
        result.soundEvents.push('level_up');
        spawnExplosionParticles(state, w / 2, h / 2, '#fff', 50);
        if (state.player && state.player.alive) {
            state.player.isInvincible = true;
            state.player.invincibilityTimer = PLAYER_INVINCIBLE_LEVEL;
        }
        spawnEnemyWave(state);
    }

    return result;
}
