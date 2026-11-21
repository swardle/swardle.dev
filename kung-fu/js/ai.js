// ============================================================================
// kung-fu/js/ai.js - Deterministic AI Kung Fu Fighter
//
// Controls the player exclusively via the 4-bit input mask (LEFT, RIGHT, JUMP,
// ATTACK). Used for the Title Screen Attract Demo, Watch AI Demo mode,
// and the automated AI Integration Test.
// ============================================================================

function createAiState() {
    return {
        attackCooldown: 0,
        jumpCooldown: 0,
        retreatTicks: 0,
        retreatDir: 0,
        chargeHoldTicks: 0,
        chargeTarget: 0,
        fireballCooldown: 0,
        lastMode: 'advance'
    };
}

function resetAiState(ai) {
    ai.attackCooldown = 0;
    ai.jumpCooldown = 0;
    ai.retreatTicks = 0;
    ai.retreatDir = 0;
    ai.chargeHoldTicks = 0;
    ai.chargeTarget = 0;
    ai.fireballCooldown = 0;
    ai.lastMode = 'advance';
}

function computeAiInput(ai, simState) {
    var p = simState.player;
    if (!p || !p.alive || simState.isGameOver || simState.floorClearTimer > 0) {
        ai.lastMode = 'idle';
        return INPUT_NONE;
    }

    if (ai.attackCooldown > 0) ai.attackCooldown -= 1;
    if (ai.jumpCooldown > 0) ai.jumpCooldown -= 1;
    if (ai.fireballCooldown > 0) ai.fireballCooldown -= 1;

    var mask = INPUT_NONE;

    // 1. Instant Crimson Counter right after a sweet-spot star RETURN!
    if (p.parryCounterTimer > 0 && ai.attackCooldown === 0 && !p.attackHeld) {
        ai.chargeHoldTicks = 0;
        ai.attackCooldown = 8;
        ai.lastMode = 'counter';
        return INPUT_ATTACK;
    }

    // 2. Threat Scan: Incoming Ninja Stars -> Mix Swinging to Deflect & Jumping Over!
    for (var pi = 0; pi < simState.projectiles.length; pi++) {
        var pr = simState.projectiles[pi];
        if (pr.owner !== 'enemy') continue;
        var pdx = pr.x - p.x;
        var absPdx = Math.abs(pdx);
        var approaching = (pdx > 0 && pr.vx < 0) || (pdx < 0 && pr.vx > 0);
        if (approaching && absPdx < 80) {
            ai.chargeHoldTicks = 0;
            var starDir = pdx >= 0 ? 1 : -1;
            // ~1/3 of stars: leap cleanly over toward the thrower; ~2/3: swing to deflect!
            if ((pr.id % 3 === 0) && p.onGround && ai.jumpCooldown === 0 && absPdx > 22 && absPdx < 74) {
                ai.jumpCooldown = 28;
                ai.lastMode = 'evade';
                return INPUT_JUMP | (starDir > 0 ? INPUT_RIGHT : INPUT_LEFT);
            }
            if (p.attackHeld) {
                // Release held attack so next tick fires a fresh swing (or unleashes charged Hadouken!)
                ai.lastMode = 'deflect';
                return INPUT_NONE;
            }
            ai.attackCooldown = 6;
            ai.lastMode = 'deflect';
            return (p.facing !== starDir)
                ? ((starDir > 0 ? INPUT_RIGHT : INPUT_LEFT) | INPUT_ATTACK)
                : INPUT_ATTACK;
        }
    }

    // 3. Threat Scan: Rolling Barrels & Falling Roof Bricks -> Deflect into Enemies or Jump!
    for (var ti = 0; ti < simState.traps.length; ti++) {
        var tr = simState.traps[ti];
        if (tr.owner === 'player') continue;
        if (tr.kind === 'barrel') {
            var bdx = tr.x - p.x;
            var absBdx = Math.abs(bdx);
            var bApproaching = (bdx > 0 && tr.vx < 0) || (bdx < 0 && tr.vx > 0);
            if (bApproaching && absBdx < 86) {
                ai.chargeHoldTicks = 0;
                var bDir = bdx >= 0 ? 1 : -1;
                if ((tr.id % 3 === 0) && p.onGround && ai.jumpCooldown === 0 && absBdx > 24) {
                    ai.jumpCooldown = 28;
                    ai.lastMode = 'evade';
                    return INPUT_JUMP | (tr.vx < 0 ? INPUT_RIGHT : INPUT_LEFT);
                }
                if (p.attackHeld) {
                    ai.lastMode = 'deflect';
                    return INPUT_NONE;
                }
                ai.attackCooldown = 6;
                ai.lastMode = 'deflect';
                return (p.facing !== bDir)
                    ? ((bDir > 0 ? INPUT_RIGHT : INPUT_LEFT) | INPUT_ATTACK)
                    : INPUT_ATTACK;
            }
        } else if (tr.kind === 'tile') {
            var tdx = tr.x - p.x;
            var absTdx = Math.abs(tdx);
            if (tr.telegraph <= 0 && absTdx < 76 && tr.y >= p.y - 115 && tr.y <= p.y) {
                // Bat the falling roof brick straight into enemies!
                ai.chargeHoldTicks = 0;
                if (p.attackHeld) {
                    ai.lastMode = 'deflect';
                    return INPUT_NONE;
                }
                ai.attackCooldown = 6;
                ai.lastMode = 'deflect';
                var tDir = tdx >= 0 ? 1 : -1;
                return (p.facing !== tDir)
                    ? ((tDir > 0 ? INPUT_RIGHT : INPUT_LEFT) | INPUT_ATTACK)
                    : INPUT_ATTACK;
            } else if (tr.telegraph > 0 && tr.telegraph <= 14 && absTdx < 26) {
                // Step slightly aside so we're cleanly positioned to bat or dodge the brick
                ai.chargeHoldTicks = 0;
                ai.lastMode = 'evade';
                return (tdx >= 0) ? INPUT_LEFT : INPUT_RIGHT;
            }
        }
    }

    // 4. Threat Scan: Imminent Enemy Melee Strikes & Boss Leaps -> Interrupt or Leap Clear!
    var nearest = null;
    var nearestDist = 999999;
    var leftCount = 0;
    var rightCount = 0;

    for (var ei = 0; ei < simState.enemies.length; ei++) {
        var en = simState.enemies[ei];
        var dx = en.x - p.x;
        var absDx = Math.abs(dx);
        if (absDx < 220) {
            if (dx < 0) leftCount++;
            else rightCount++;
        }
        if (absDx < nearestDist) {
            nearestDist = absDx;
            nearest = en;
        }

        if (en.state === 'leap' && en.vy > 1.5 && absDx < 112 && p.onGround && ai.jumpCooldown === 0) {
            ai.chargeHoldTicks = 0;
            ai.jumpCooldown = 30;
            ai.lastMode = 'evade';
            return INPUT_JUMP | (dx >= 0 ? INPUT_LEFT : INPUT_RIGHT);
        }
        if ((en.state === 'windup' || en.state === 'attack') && en.attackStyle === 'melee' &&
            absDx <= en.range + 22 && p.onGround) {
            ai.chargeHoldTicks = 0;
            var eDir = dx >= 0 ? 1 : -1;
            if (absDx <= 86 && ai.attackCooldown === 0 && !p.attackHeld) {
                ai.attackCooldown = 8;
                ai.lastMode = 'combo';
                return (p.facing !== eDir)
                    ? ((eDir > 0 ? INPUT_RIGHT : INPUT_LEFT) | INPUT_ATTACK)
                    : INPUT_ATTACK;
            }
            if (ai.jumpCooldown === 0) {
                ai.jumpCooldown = 28;
                ai.lastMode = 'evade';
                return INPUT_JUMP | (eDir > 0 ? INPUT_LEFT : INPUT_RIGHT);
            }
        }
    }

    // 5. If no enemies on screen, march right through the pagoda!
    if (!nearest || nearestDist > 520) {
        ai.chargeHoldTicks = 0;
        ai.lastMode = 'advance';
        return INPUT_RIGHT;
    }

    // 5b. Continue or launch a Street Fighter Charged Power Ball!
    var targetDx = nearest.x - p.x;
    var desiredDir = targetDx >= 0 ? 1 : -1;

    if (ai.chargeHoldTicks > 0) {
        if (!p.onGround || p.action === 'hurt' || nearestDist < 82) {
            // Release early if already charged, else abort charge for melee
            ai.chargeHoldTicks = 0;
            if (p.attackChargeTicks >= CHARGE_READY_TICKS) {
                ai.fireballCooldown = 140;
                ai.lastMode = 'hadouken';
                return (p.facing !== desiredDir) ? (desiredDir > 0 ? INPUT_RIGHT : INPUT_LEFT) : INPUT_NONE;
            }
        } else if (p.attackChargeTicks >= ai.chargeTarget) {
            ai.chargeHoldTicks = 0;
            ai.fireballCooldown = 180;
            ai.lastMode = 'hadouken';
            return (p.facing !== desiredDir) ? (desiredDir > 0 ? INPUT_RIGHT : INPUT_LEFT) : INPUT_NONE;
        } else {
            ai.chargeHoldTicks += 1;
            ai.lastMode = 'charge';
            mask = INPUT_ATTACK;
            if (p.facing !== desiredDir) {
                mask |= (desiredDir > 0 ? INPUT_RIGHT : INPUT_LEFT);
            }
            return mask;
        }
    }

    if (ai.fireballCooldown === 0 && p.onGround && nearestDist >= 210 && nearestDist <= 420 &&
        !(leftCount > 0 && rightCount > 0)) {
        ai.chargeHoldTicks = 1;
        ai.chargeTarget = (simState.tick % 2 === 0) ? (CHARGE_READY_TICKS + 4) : CHARGE_MAX_TICKS;
        ai.lastMode = 'charge';
        mask = INPUT_ATTACK;
        if (p.facing !== desiredDir) {
            mask |= (desiredDir > 0 ? INPUT_RIGHT : INPUT_LEFT);
        }
        return mask;
    }

    // 6. Escape if surrounded tightly on both sides
    if (ai.retreatTicks > 0) {
        ai.retreatTicks -= 1;
        ai.lastMode = 'evade';
        return ai.retreatDir < 0 ? INPUT_LEFT : INPUT_RIGHT;
    }
    if (leftCount > 0 && rightCount > 0 && nearestDist < 75 && p.onGround && ai.jumpCooldown === 0) {
        ai.jumpCooldown = 34;
        ai.retreatTicks = 12;
        ai.retreatDir = (p.x > simState.cameraX + 420) ? -1 : 1;
        ai.lastMode = 'evade';
        return INPUT_JUMP | (ai.retreatDir < 0 ? INPUT_LEFT : INPUT_RIGHT);
    }

    // 7. Engage Nearest Enemy
    if (p.facing !== desiredDir) {
        mask |= (desiredDir > 0 ? INPUT_RIGHT : INPUT_LEFT);
    }

    if (!p.onGround && nearestDist < 110 && ai.attackCooldown === 0) {
        ai.attackCooldown = 14;
        ai.lastMode = 'jump_kick';
        mask |= INPUT_ATTACK;
        return mask;
    }

    if (p.onGround && nearestDist > 125 && nearestDist < 195 &&
        (nearest.kind === 'knife' || (simState.tick % 71 === 0)) && ai.jumpCooldown === 0) {
        ai.jumpCooldown = 40;
        ai.lastMode = 'jump_kick';
        mask |= INPUT_JUMP | (desiredDir > 0 ? INPUT_RIGHT : INPUT_LEFT);
        return mask;
    }

    if (nearestDist <= 78) {
        ai.lastMode = 'combo';
        if (ai.attackCooldown === 0) {
            mask |= INPUT_ATTACK;
            ai.attackCooldown = (p.comboStep === 2) ? 18 : 9;
        }
    } else {
        ai.lastMode = 'engage';
        mask |= (desiredDir > 0 ? INPUT_RIGHT : INPUT_LEFT);
    }

    return mask;
}
