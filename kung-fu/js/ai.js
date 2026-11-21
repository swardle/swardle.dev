// ============================================================================
// kung-fu/js/ai.js - Deterministic AI Kung Fu Fighter
//
// Controls the player exclusively via the 5-bit input mask (LEFT, RIGHT, JUMP,
// ATTACK, BLOCK). Used for the Title Screen Attract Demo, Watch AI Demo mode,
// and the automated AI Integration Test.
// ============================================================================

function createAiState() {
    return {
        attackCooldown: 0,
        blockHoldLeft: 0,
        jumpCooldown: 0,
        retreatTicks: 0,
        retreatDir: 0,
        lastMode: 'advance'
    };
}

function resetAiState(ai) {
    ai.attackCooldown = 0;
    ai.blockHoldLeft = 0;
    ai.jumpCooldown = 0;
    ai.retreatTicks = 0;
    ai.retreatDir = 0;
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

    var mask = INPUT_NONE;

    // 1. Instant Crimson Counter right after landing a Perfect Parry!
    if (p.parryCounterTimer > 0 && p.action !== 'parry' && ai.attackCooldown === 0) {
        ai.attackCooldown = 8;
        ai.lastMode = 'counter';
        return INPUT_ATTACK;
    }

    // Continue brief block hold if actively guarding/parrying
    if (ai.blockHoldLeft > 0) {
        ai.blockHoldLeft -= 1;
        ai.lastMode = 'parry';
        return INPUT_BLOCK;
    }

    // 2. Threat Scan: Incoming Projectiles (Parry or Jump!)
    for (var pi = 0; pi < simState.projectiles.length; pi++) {
        var pr = simState.projectiles[pi];
        if (pr.owner !== 'enemy') continue;
        var pdx = pr.x - p.x;
        var approaching = (pdx > 0 && pr.vx < 0) || (pdx < 0 && pr.vx > 0);
        if (approaching && Math.abs(pdx) < 62) {
            if (p.onGround) {
                ai.blockHoldLeft = 6;
                ai.lastMode = 'parry';
                return INPUT_BLOCK;
            }
        }
    }

    // 3. Threat Scan: Rolling Barrels & Falling Roof Tiles
    for (var ti = 0; ti < simState.traps.length; ti++) {
        var tr = simState.traps[ti];
        if (tr.kind === 'barrel') {
            var bdx = tr.x - p.x;
            var bApproaching = (bdx > 0 && tr.vx < 0) || (bdx < 0 && tr.vx > 0);
            if (bApproaching && Math.abs(bdx) < 88 && p.onGround && ai.jumpCooldown === 0) {
                ai.jumpCooldown = 28;
                ai.lastMode = 'evade';
                mask |= INPUT_JUMP;
                mask |= (tr.vx < 0 ? INPUT_RIGHT : INPUT_LEFT);
                return mask;
            }
        } else if (tr.kind === 'tile' && tr.telegraph <= 16) {
            var tdx = tr.x - p.x;
            if (Math.abs(tdx) < 44) {
                ai.lastMode = 'evade';
                return (tdx >= 0) ? INPUT_LEFT : INPUT_RIGHT;
            }
        }
    }

    // 4. Threat Scan: Imminent Enemy Melee Strike -> Time a Perfect Parry!
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

        if (en.state === 'windup' && en.attackStyle === 'melee' && absDx <= en.range + 30 && p.onGround) {
            if (en.stateDur - en.stateTick <= 10) {
                ai.blockHoldLeft = 8;
                ai.lastMode = 'parry';
                return INPUT_BLOCK;
            }
            // Wait a beat instead of mashing into an enemy windup so we can land a Perfect Parry!
            ai.lastMode = 'parry';
            return (p.facing !== (dx >= 0 ? 1 : -1)) ? (dx >= 0 ? INPUT_RIGHT : INPUT_LEFT) : INPUT_NONE;
        }
        if (en.state === 'attack' && en.attackStyle === 'melee' && en.stateTick <= 4 &&
            absDx <= en.range + 24 && p.onGround) {
            ai.blockHoldLeft = 5;
            ai.lastMode = 'parry';
            return INPUT_BLOCK;
        }
        if (en.state === 'leap' && en.vy > 1.5 && absDx < 112 && p.onGround && ai.jumpCooldown === 0) {
            ai.jumpCooldown = 30;
            ai.lastMode = 'evade';
            return INPUT_JUMP | (dx >= 0 ? INPUT_LEFT : INPUT_RIGHT);
        }
    }

    // 5. If no enemies on screen, march right through the pagoda!
    if (!nearest || nearestDist > 520) {
        ai.lastMode = 'advance';
        return INPUT_RIGHT;
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
    var targetDx = nearest.x - p.x;
    var desiredDir = targetDx >= 0 ? 1 : -1;

    if (p.facing !== desiredDir) {
        mask |= (desiredDir > 0 ? INPUT_RIGHT : INPUT_LEFT);
    }

    if (!p.onGround && nearestDist < 110 && ai.attackCooldown === 0) {
        ai.attackCooldown = 14;
        ai.lastMode = 'jump_kick';
        mask |= INPUT_ATTACK;
        return mask;
    }

    if (p.onGround && nearestDist > 125 && nearestDist < 185 &&
        (nearest.kind === 'knife' || (simState.tick % 97 === 0)) && ai.jumpCooldown === 0) {
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
