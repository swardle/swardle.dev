// ============================================================================
// kung-fu/js/render.js - Sumi-e Ink-Brush Silhouette Renderer
//
// Dramatic moonlit/sunset backdrops, layered ink-wash mountains, bamboo,
// pagoda silhouettes, articulated shadow martial artists with streaming
// crimson headbands, bold red/gold brush slash arcs, and responsive
// full-bleed viewport framing for both Portrait & Landscape (iOS/Android/Desktop).
// ============================================================================

var FLOOR_PALETTES = [
    // Floor 1: Crimson Dusk Courtyard
    {
        skyTop: '#240b0e',
        skyMid: '#7d201a',
        skyLow: '#e07a3b',
        celestial: '#ffe7b3',
        celestialGlow: 'rgba(255, 196, 110, 0.35)',
        isEclipse: false,
        mountainFar: 'rgba(42, 12, 14, 0.58)',
        mountainNear: 'rgba(24, 9, 10, 0.80)',
        floorTop: '#160d0b',
        floorDeep: '#090606',
        petalColor: 'rgba(255, 190, 150, 0.65)'
    },
    // Floor 2: Blood Moon Hall
    {
        skyTop: '#0b0c1c',
        skyMid: '#2a1228',
        skyLow: '#8f242c',
        celestial: '#f7ead6',
        celestialGlow: 'rgba(247, 234, 214, 0.28)',
        isEclipse: false,
        mountainFar: 'rgba(18, 12, 28, 0.62)',
        mountainNear: 'rgba(12, 8, 18, 0.85)',
        floorTop: '#120d14',
        floorDeep: '#07050a',
        petalColor: 'rgba(230, 80, 90, 0.65)'
    },
    // Floor 3: Golden Eclipse Sanctum
    {
        skyTop: '#140f08',
        skyMid: '#5c3410',
        skyLow: '#d99832',
        celestial: '#110b08',
        celestialGlow: 'rgba(255, 200, 72, 0.55)',
        isEclipse: true,
        mountainFar: 'rgba(38, 22, 8, 0.60)',
        mountainNear: 'rgba(20, 12, 6, 0.86)',
        floorTop: '#140e08',
        floorDeep: '#080604',
        petalColor: 'rgba(255, 210, 90, 0.72)'
    }
];

// Computes responsive viewport transform so the 800x450 logical playfield
// fits cleanly on Desktop, iPhone Portrait, Android Landscape, and Retina screens.
function computeViewportTransform(canvasW, canvasH, viewW, viewH, reserveBottomPx) {
    var usableH = Math.max(120, canvasH - (reserveBottomPx || 0));
    var scale = Math.min(canvasW / viewW, usableH / viewH);
    var drawW = viewW * scale;
    var drawH = viewH * scale;
    var offsetX = (canvasW - drawW) * 0.5;
    // In portrait mobile with touch controls below, sit slightly higher in usable area
    var offsetY = (usableH - drawH) * 0.5;
    return {
        scale: scale,
        drawW: drawW,
        drawH: drawH,
        offsetX: offsetX,
        offsetY: offsetY
    };
}

function renderGameFrame(ctx, canvasW, canvasH, frame, opts) {
    if (!frame) return;
    var options = opts || {};
    var dpr = options.dpr || 1;
    var reserveBottom = (options.reserveBottomCss || 0) * dpr;

    var pal = FLOOR_PALETTES[(frame.floor - 1) % FLOOR_PALETTES.length];
    var vp = computeViewportTransform(canvasW, canvasH, frame.viewWidth, frame.viewHeight, reserveBottom);

    // 1. Full-bleed atmospheric Sumi-e sky & floor fill (no ugly black bars in portrait!)
    var groundCanvasY = vp.offsetY + GROUND_Y * vp.scale;
    var skyGrad = ctx.createLinearGradient(0, 0, 0, Math.max(groundCanvasY, canvasH * 0.5));
    skyGrad.addColorStop(0, pal.skyTop);
    skyGrad.addColorStop(0.55, pal.skyMid);
    skyGrad.addColorStop(1, pal.skyLow);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Extend dark stone dojo floor to very bottom of screen (behind portrait controls)
    var floorGrad = ctx.createLinearGradient(0, groundCanvasY, 0, canvasH);
    floorGrad.addColorStop(0, pal.floorTop);
    floorGrad.addColorStop(1, pal.floorDeep);
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, groundCanvasY, canvasW, canvasH - groundCanvasY);

    // Deterministic subtle screen shake offset
    var shakeX = 0;
    var shakeY = 0;
    if (frame.screenShake > 0.1) {
        shakeX = Math.sin(frame.tick * 2.7) * frame.screenShake;
        shakeY = Math.cos(frame.tick * 3.4) * frame.screenShake * 0.65;
    }

    ctx.save();
    ctx.translate(vp.offsetX + shakeX * vp.scale, vp.offsetY + shakeY * vp.scale);
    ctx.scale(vp.scale, vp.scale);

    var camX = frame.cameraX;
    var viewW = frame.viewWidth;

    // 2. Giant Moon / Sunset / Eclipse
    var celestialX = viewW * 0.66 - camX * 0.04;
    var celestialY = 122;
    var celestialR = 72;

    var glowGrad = ctx.createRadialGradient(celestialX, celestialY, celestialR * 0.5, celestialX, celestialY, celestialR * 2.1);
    glowGrad.addColorStop(0, pal.celestialGlow);
    glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(celestialX, celestialY, celestialR * 2.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = pal.celestial;
    ctx.beginPath();
    ctx.arc(celestialX, celestialY, celestialR, 0, Math.PI * 2);
    ctx.fill();

    if (pal.isEclipse) {
        ctx.strokeStyle = '#ffbe3d';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(celestialX, celestialY, celestialR + 2, 0, Math.PI * 2);
        ctx.stroke();
    }

    // 3. Parallax Ink-Wash Mountains & Distant Pagoda Silhouettes
    drawMountainLayer(ctx, camX * 0.12, viewW, GROUND_Y, 130, 0.006, 1.1, pal.mountainFar);
    drawPagodaSilhouettes(ctx, camX * 0.22, viewW, GROUND_Y, pal.mountainNear);
    drawMountainLayer(ctx, camX * 0.30, viewW, GROUND_Y, 72, 0.011, 2.7, pal.mountainNear);

    // 4. Midground Bamboo & Temple Pillars + Hanging Red Lanterns
    drawTempleForegroundProps(ctx, camX, viewW, frame.tick, frame.floor);

    // 5. Drifting Ink/Sakura Petals (deterministic from tick)
    drawAtmosphericPetals(ctx, camX, viewW, frame.tick, pal.petalColor);

    // 6. Pagoda Timber / Stone Ground Line with Ink Brush Edge
    ctx.fillStyle = pal.floorTop;
    ctx.fillRect(-100, GROUND_Y, viewW + 200, 120);
    ctx.strokeStyle = '#070404';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-100, GROUND_Y);
    ctx.lineTo(viewW + 100, GROUND_Y);
    ctx.stroke();

    // Floor plank perspective hash marks scrolling with camera
    ctx.strokeStyle = 'rgba(255, 220, 180, 0.09)';
    ctx.lineWidth = 1.5;
    var plankSpacing = 90;
    var firstPlank = Math.floor(camX / plankSpacing) * plankSpacing;
    for (var px = firstPlank; px < camX + viewW + plankSpacing; px += plankSpacing) {
        var sx = px - camX;
        ctx.beginPath();
        ctx.moveTo(sx, GROUND_Y + 2);
        ctx.lineTo(sx - 28, GROUND_Y + 62);
        ctx.stroke();
    }

    // 7. World-Space Entities (Camera Translated)
    ctx.save();
    ctx.translate(-camX, 0);

    // Traps (Barrels & Falling Tiles with ground ink telegraph)
    for (var ti = 0; ti < frame.traps.length; ti++) {
        drawTrap(ctx, frame.traps[ti], frame.tick);
    }

    // Enemies
    for (var ei = 0; ei < frame.enemies.length; ei++) {
        drawEnemyFighter(ctx, frame.enemies[ei], frame.tick);
    }

    // Motion / Flash-Step Afterimages
    if (frame.afterimages && frame.afterimages.length > 0) {
        for (var ai = 0; ai < frame.afterimages.length; ai++) {
            drawAfterimageClone(ctx, frame.afterimages[ai], frame.tick);
        }
    }

    // Autonomous Naruto-Style Shadow Clones (Shadow Ronin Tier 1: 1 clone, Tier 2: 2 clones)
    if (frame.clones && frame.clones.length > 0) {
        for (var cli = 0; cli < frame.clones.length; cli++) {
            drawShadowCloneFighter(ctx, frame.clones[cli], frame.tick);
        }
    }

    // Player Fighter
    if (frame.player) {
        drawPlayerFighter(ctx, frame.player, frame.tick, frame.streakTier || 0);
    }

    // Thrown Knives / Projectiles
    for (var pi = 0; pi < frame.projectiles.length; pi++) {
        drawProjectile(ctx, frame.projectiles[pi]);
    }

    // Chain-Lightning Bolts (Thunder Monk Tier 1+)
    if (frame.bolts && frame.bolts.length > 0) {
        for (var bi = 0; bi < frame.bolts.length; bi++) {
            drawLightningBolt(ctx, frame.bolts[bi], frame.tick);
        }
    }

    // Brush Slash Arcs
    for (var si = 0; si < frame.slashes.length; si++) {
        drawSlashArc(ctx, frame.slashes[si]);
    }

    // Ink Splatter & Gold Shockwave Particles
    for (var ki = 0; ki < frame.particles.length; ki++) {
        drawParticle(ctx, frame.particles[ki]);
    }

    // Floating Calligraphy Callouts (PARRY!, COUNTER!, 3 HIT!, KO!)
    for (var ci = 0; ci < frame.callouts.length; ci++) {
        drawCallout(ctx, frame.callouts[ci]);
    }

    ctx.restore(); // end world space

    // 8. In-Playfield HUD (Health, Score, Combo, Boss HP, GO ▶, Floor Banner)
    drawHud(ctx, frame, viewW);

    ctx.restore(); // end logical viewport

    // 9. Optional Replay / Demo / Dev Badge in top-left of canvas
    if (options.modeBadge) {
        ctx.save();
        var fontSize = Math.max(10, Math.round(11 * dpr));
        ctx.font = 'bold ' + fontSize + 'px monospace';
        ctx.fillStyle = options.badgeColor || '#ffd24c';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(options.modeBadge, 12 * dpr, 10 * dpr);
        ctx.restore();
    }

    // 10. Optional Live Button-Press Visualizer (Self-Play AI, Saved Input, & Replay)
    if (typeof options.inputMask === 'number') {
        var vizY = options.inputBottom
            ? (canvasH - Math.round(30 * dpr))
            : (options.modeBadge ? 26 * dpr : 10 * dpr);
        drawInputVisualizer(ctx, options.inputMask, dpr, vizY);
    }

    if (options.borderColor) {
        ctx.save();
        ctx.strokeStyle = options.borderColor;
        ctx.lineWidth = 4 * dpr;
        ctx.strokeRect(2 * dpr, 2 * dpr, canvasW - 4 * dpr, canvasH - 4 * dpr);
        ctx.restore();
    }
}

// ----------------------------------------------------------------------------
// Scenery Helpers (Sumi-e Ink Wash)
// ----------------------------------------------------------------------------
function drawMountainLayer(ctx, scrollX, viewW, baseY, amp, freq, phase, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-40, baseY);
    for (var x = -40; x <= viewW + 40; x += 24) {
        var wx = x + scrollX;
        var h = Math.sin(wx * freq + phase) * amp * 0.55 +
                Math.sin(wx * freq * 2.3 + phase * 1.7) * amp * 0.30 +
                amp * 0.72;
        ctx.lineTo(x, baseY - h);
    }
    ctx.lineTo(viewW + 40, baseY);
    ctx.closePath();
    ctx.fill();
}

function drawPagodaSilhouettes(ctx, scrollX, viewW, baseY, color) {
    ctx.fillStyle = color;
    var spacing = 520;
    var start = Math.floor(scrollX / spacing) * spacing - spacing;
    for (var wx = start; wx < scrollX + viewW + spacing; wx += spacing) {
        var x = wx - scrollX + 180;
        // 3-tier pagoda roof silhouette
        for (var tier = 0; tier < 3; tier++) {
            var ty = baseY - 62 - tier * 34;
            var tw = 88 - tier * 16;
            ctx.beginPath();
            ctx.moveTo(x - tw * 0.65, ty + 14);
            ctx.quadraticCurveTo(x - tw * 0.3, ty + 2, x - tw * 0.22, ty - 6);
            ctx.lineTo(x + tw * 0.22, ty - 6);
            ctx.quadraticCurveTo(x + tw * 0.3, ty + 2, x + tw * 0.65, ty + 14);
            ctx.closePath();
            ctx.fill();
            ctx.fillRect(x - tw * 0.26, ty + 10, tw * 0.52, 26);
        }
        // Spire
        ctx.fillRect(x - 2, baseY - 178, 4, 24);
    }
}

function drawTempleForegroundProps(ctx, camX, viewW, tick, floor) {
    // Bamboo stalks swaying softly
    var bambooSpacing = 145;
    var bStart = Math.floor((camX * 0.55) / bambooSpacing) * bambooSpacing - bambooSpacing;
    ctx.strokeStyle = 'rgba(10, 6, 6, 0.52)';
    for (var bx = bStart; bx < camX * 0.55 + viewW + bambooSpacing; bx += bambooSpacing) {
        var sx = bx - camX * 0.55;
        var sway = Math.sin(tick * 0.025 + bx * 0.02) * 6;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(sx, GROUND_Y);
        ctx.quadraticCurveTo(sx + sway * 0.5, GROUND_Y - 140, sx + sway, GROUND_Y - 290);
        ctx.stroke();

        // Bamboo leaf clusters
        ctx.fillStyle = 'rgba(10, 6, 6, 0.55)';
        for (var seg = 1; seg <= 3; seg++) {
            var ly = GROUND_Y - seg * 78;
            var lx = sx + sway * (seg / 3);
            ctx.beginPath();
            ctx.ellipse(lx + 12, ly, 14, 3, -0.3, 0, Math.PI * 2);
            ctx.ellipse(lx - 11, ly + 8, 12, 2.5, 0.35, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Wooden pagoda pillars & glowing red lanterns in world space
    var pillarSpacing = 380;
    var pStart = Math.floor(camX / pillarSpacing) * pillarSpacing;
    for (var px = pStart; px < camX + viewW + pillarSpacing; px += pillarSpacing) {
        var sx2 = px - camX;
        // Subtle dark pillar behind fighters
        ctx.fillStyle = 'rgba(12, 6, 6, 0.42)';
        ctx.fillRect(sx2 - 11, 32, 22, GROUND_Y - 32);
        // Top timber beam
        ctx.fillRect(sx2 - 60, 26, 120, 12);

        // Hanging crimson lantern
        var swing = Math.sin(tick * 0.04 + px) * 3;
        var lx2 = sx2 + 34 + swing;
        var ly2 = 72;
        ctx.strokeStyle = 'rgba(12,6,6,0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx2 + 34, 38);
        ctx.lineTo(lx2, ly2 - 12);
        ctx.stroke();

        var lg = ctx.createRadialGradient(lx2, ly2, 2, lx2, ly2, 34);
        lg.addColorStop(0, floor % 3 === 0 ? 'rgba(255, 200, 75, 0.65)' : 'rgba(255, 70, 45, 0.60)');
        lg.addColorStop(1, 'rgba(255, 70, 45, 0)');
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.arc(lx2, ly2, 34, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = floor % 3 === 0 ? '#e59a28' : '#c92a22';
        ctx.beginPath();
        ctx.ellipse(lx2, ly2, 9, 13, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0c0606';
        ctx.fillRect(lx2 - 6, ly2 - 14, 12, 3);
        ctx.fillRect(lx2 - 6, ly2 + 11, 12, 3);
    }
}

function drawAtmosphericPetals(ctx, camX, viewW, tick, color) {
    ctx.fillStyle = color;
    for (var i = 0; i < 16; i++) {
        var px = ((i * 97 + tick * (0.7 + (i % 3) * 0.25) - camX * 0.4) % (viewW + 80));
        if (px < 0) px += viewW + 80;
        var py = ((i * 53 + tick * (0.45 + (i % 2) * 0.2)) % (GROUND_Y - 20));
        var rot = tick * 0.04 + i;
        ctx.save();
        ctx.translate(px - 40, py);
        ctx.rotate(rot);
        ctx.beginPath();
        ctx.ellipse(0, 0, 4.5, 2.0, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

// ----------------------------------------------------------------------------
// Articulated Sumi-e Martial Artist Drawing
// ----------------------------------------------------------------------------
function drawLimb(ctx, x1, y1, x2, y2, width) {
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
}

function drawFighterSilhouette(ctx, opts) {
    var x = opts.x;
    var y = opts.y;
    var facing = opts.facing;
    var scale = opts.scale || 1.0;
    var pose = opts.pose;
    var phase = opts.phase || 0;
    var ink = opts.flash ? '#fff3d6' : '#0b0909';
    var rim = opts.rimColor || null;

    // Ground ink shadow
    var airHeight = Math.max(0, GROUND_Y - y);
    var shadowScale = Math.max(0.35, 1 - airHeight / 260);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.ellipse(x, GROUND_Y + 3, 24 * scale * shadowScale, 6 * scale * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(facing * scale, scale);

    // Default martial arts combat stance joints (feet at y=0, head at y=-68)
    var hipX = 0, hipY = -34;
    var torsoLean = 3;
    var shoulderX = hipX + torsoLean, shoulderY = -58;
    var headX = shoulderX + 2, headY = -71;

    var lFootX = -12, lFootY = 0, lKneeX = -7, lKneeY = -17;
    var rFootX = 14,  rFootY = 0, rKneeX = 9,  rKneeY = -17;
    var bHandX = -10, bHandY = -44, bElbowX = -11, bElbowY = -50;
    var fHandX = 18,  fHandY = -50, fElbowX = 10,  fElbowY = -48;

    if (pose === 'idle') {
        var breathe = Math.sin(phase) * 1.8;
        hipY += breathe;
        shoulderY += breathe;
        headY += breathe;
        fHandY += breathe;
    } else if (pose === 'run') {
        var s = Math.sin(phase);
        var c = Math.cos(phase);
        torsoLean = 11;
        hipY = -33 + Math.abs(c) * 3;
        shoulderX = hipX + torsoLean;
        shoulderY = -56 + Math.abs(c) * 2;
        headX = shoulderX + 4;
        headY = shoulderY - 13;
        lFootX = -s * 20; lFootY = Math.min(0, c * 8);
        lKneeX = lFootX * 0.45 + 4; lKneeY = -17;
        rFootX = s * 20; rFootY = Math.min(0, -c * 8);
        rKneeX = rFootX * 0.45 + 4; rKneeY = -17;
        fHandX = shoulderX + c * 15; fHandY = shoulderY + 12;
        bHandX = shoulderX - c * 15; bHandY = shoulderY + 12;
        fElbowX = (shoulderX + fHandX) * 0.5 - 3; fElbowY = shoulderY + 7;
        bElbowX = (shoulderX + bHandX) * 0.5 - 3; bElbowY = shoulderY + 7;
    } else if (pose === 'jump') {
        hipY = -38; shoulderX = 5; shoulderY = -61; headX = 7; headY = -74;
        lKneeX = -12; lKneeY = -22; lFootX = -18; lFootY = -8;
        rKneeX = 14;  rKneeY = -26; rFootX = 10;  rFootY = -12;
        fHandX = 20; fHandY = -66; fElbowX = 12; fElbowY = -58;
        bHandX = -14; bHandY = -54; bElbowX = -8; bElbowY = -56;
    } else if (pose === 'attack1') {
        // Snappy Palm Strike / Straight Punch
        torsoLean = 14;
        shoulderX = 14; shoulderY = -56; headX = 17; headY = -69;
        rFootX = 20; lFootX = -16;
        fElbowX = 26; fElbowY = -55; fHandX = 44; fHandY = -55;
        bElbowX = -4; bElbowY = -48; bHandX = 2; bHandY = -44;
    } else if (pose === 'attack2') {
        // High Roundhouse Kick!
        torsoLean = -12;
        hipY = -36; shoulderX = -11; shoulderY = -57; headX = -12; headY = -70;
        lFootX = -6; lFootY = 0; lKneeX = -4; lKneeY = -18;
        rKneeX = 18; rKneeY = -44; rFootX = 46; rFootY = -54;
        fHandX = 6; fHandY = -46; bHandX = -24; bHandY = -48;
    } else if (pose === 'attack3' || pose === 'counter') {
        // Dragon Rising Uppercut / Crimson Cleave
        torsoLean = 12;
        hipY = -38; shoulderX = 12; shoulderY = -62; headX = 14; headY = -75;
        rFootX = 22; lFootX = -18;
        fElbowX = 24; fElbowY = -68; fHandX = 38; fHandY = -86;
        bElbowX = -8; bElbowY = -46; bHandX = -16; bHandY = -38;
    } else if (pose === 'dragon_upper') {
        // Soaring Blazing Shoryuken Uppercut!
        torsoLean = 8;
        hipY = -42; shoulderX = 8; shoulderY = -68; headX = 10; headY = -81;
        lKneeX = -10; lKneeY = -22; lFootX = -14; lFootY = -6;
        rKneeX = 16;  rKneeY = -34; rFootX = 12;  rFootY = -18;
        fElbowX = 18; fElbowY = -84; fHandX = 22; fHandY = -106;
        bElbowX = -10; bElbowY = -56; bHandX = -18; bHandY = -44;
    } else if (pose === 'divekick') {
        // Blazing Diagonal Meteor Dive Kick!
        torsoLean = -18;
        hipY = -36; shoulderX = -18; shoulderY = -54; headX = -22; headY = -66;
        lKneeX = -12; lKneeY = -24; lFootX = -22; lFootY = -18;
        rKneeX = 18;  rKneeY = -22; rFootX = 42;  rFootY = -4;
        fElbowX = -2; fElbowY = -48; fHandX = 14; fHandY = -44;
        bElbowX = -28; bElbowY = -50; bHandX = -38; bHandY = -42;
    } else if (pose === 'spin') {
        // 360° Hurricane Spin Kick! Alternates spin direction cleanly with actionTick
        var spinCos = Math.cos((opts.actionTick || 0) * 0.95);
        var ext = spinCos >= 0 ? 1 : -1;
        torsoLean = -ext * 6;
        hipY = -37; shoulderX = torsoLean; shoulderY = -59; headX = torsoLean * 0.8; headY = -72;
        lKneeX = -ext * 8; lKneeY = -20; lFootX = -ext * 6; lFootY = -2;
        rKneeX = ext * 22; rKneeY = -42; rFootX = ext * 46; rFootY = -44;
        fElbowX = ext * 16; fElbowY = -54; fHandX = ext * 28; fHandY = -50;
        bElbowX = -ext * 16; bElbowY = -54; bHandX = -ext * 28; bHandY = -50;
    } else if (pose === 'airkick') {
        // Classic Flying Kung-Fu Jump Kick!
        hipY = -36; shoulderX = -10; shoulderY = -56; headX = -12; headY = -68;
        lKneeX = -12; lKneeY = -24; lFootX = -20; lFootY = -14;
        rKneeX = 16;  rKneeY = -34; rFootX = 44;  rFootY = -32;
        fHandX = 12; fHandY = -48; bHandX = -24; bHandY = -52;
    } else if (pose === 'charge') {
        // Street Fighter Hadouken Chi-Gathering Stance (cupped hands pulled to hip)
        var vibe = Math.sin(phase * 4.5) * 1.2;
        torsoLean = -5;
        hipY = -29;
        shoulderX = -5 + vibe; shoulderY = -52; headX = -3 + vibe; headY = -65;
        lFootX = -17; rFootX = 17; lKneeX = -13; lKneeY = -15; rKneeX = 13; rKneeY = -15;
        fElbowX = -10; fElbowY = -44; fHandX = -3 + vibe; fHandY = -40;
        bElbowX = -14; bElbowY = -47; bHandX = -6 + vibe; bHandY = -45;
    } else if (pose === 'hadouken') {
        // Street Fighter Double-Palm Energy Thrust Release!
        torsoLean = 14;
        hipY = -31;
        shoulderX = 14; shoulderY = -54; headX = 17; headY = -66;
        lFootX = -20; rFootX = 24; lKneeX = -12; lKneeY = -16; rKneeX = 16; rKneeY = -16;
        fElbowX = 25; fElbowY = -50; fHandX = 40; fHandY = -48;
        bElbowX = 21; bElbowY = -45; bHandX = 36; bHandY = -43;
    } else if (pose === 'block' || pose === 'parry') {
        // Defensive Cross-Arm Guard / Golden Parry Stance
        torsoLean = -4;
        hipY = -31; shoulderX = -3; shoulderY = -54; headX = -1; headY = -66;
        lFootX = -16; rFootX = 16; lKneeX = -12; lKneeY = -15; rKneeX = 14; rKneeY = -15;
        fElbowX = 14; fElbowY = -46; fHandX = 18; fHandY = -64;
        bElbowX = 8;  bElbowY = -48; bHandX = 14; bHandY = -60;
    } else if (pose === 'windup') {
        // Telegraph coiled back pose
        torsoLean = -12;
        shoulderX = -10; shoulderY = -56; headX = -8; headY = -69;
        fElbowX = -22; fElbowY = -58; fHandX = -30; fHandY = -66;
        bElbowX = 6; bElbowY = -48; bHandX = 14; bHandY = -44;
    } else if (pose === 'hurt' || pose === 'stunned') {
        torsoLean = -14;
        shoulderX = -13; shoulderY = -54; headX = -18; headY = -66;
        fHandX = 4; fHandY = -64; bHandX = -22; bHandY = -44;
    } else if (pose === 'ko') {
        // Fallen silhouette on ground
        hipX = -6; hipY = -8; shoulderX = -32; shoulderY = -10; headX = -46; headY = -12;
        lKneeX = 10; lKneeY = -10; lFootX = 26; lFootY = -4;
        rKneeX = 8;  rKneeY = -6;  rFootX = 22; rFootY = -2;
        fHandX = -18; fHandY = -4; bHandX = -42; bHandY = -4;
        fElbowX = -24; fElbowY = -6; bElbowX = -38; bElbowY = -6;
    }

    // Optional subtle rim-glow for player readability in crowds
    if (rim) {
        ctx.shadowColor = rim;
        ctx.shadowBlur = 7;
    }

    // Legs (ink silhouette)
    ctx.strokeStyle = ink;
    drawLimb(ctx, hipX, hipY, lKneeX, lKneeY, 8);
    drawLimb(ctx, lKneeX, lKneeY, lFootX, lFootY, 6.5);
    drawLimb(ctx, hipX, hipY, rKneeX, rKneeY, 8);
    drawLimb(ctx, rKneeX, rKneeY, rFootX, rFootY, 6.5);

    // Martial Arts Gi / Robe Torso & Flared Skirt
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.moveTo(shoulderX - 10, shoulderY);
    ctx.lineTo(shoulderX + 10, shoulderY);
    ctx.lineTo(hipX + 12, hipY + 9);
    ctx.lineTo(hipX - 13, hipY + 9);
    ctx.closePath();
    ctx.fill();

    // Back Arm
    drawLimb(ctx, shoulderX - 3, shoulderY + 2, bElbowX, bElbowY, 6.5);
    drawLimb(ctx, bElbowX, bElbowY, bHandX, bHandY, 5.5);

    // Front Arm
    drawLimb(ctx, shoulderX + 3, shoulderY + 2, fElbowX, fElbowY, 6.8);
    drawLimb(ctx, fElbowX, fElbowY, fHandX, fHandY, 5.8);

    // Head
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(headX, headY, 9.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;

    // Accessories & Weapons
    if (opts.headbandColor) {
        // Headband wrap + streaming ink-cloth tails
        ctx.strokeStyle = opts.headbandColor;
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.moveTo(headX - 8, headY - 2);
        ctx.lineTo(headX + 8, headY - 2);
        ctx.stroke();

        var flutter = Math.sin(phase * 1.6) * 4;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(headX - 8, headY - 2);
        ctx.quadraticCurveTo(headX - 22, headY - 4 + flutter, headX - 34, headY + 2 - flutter * 0.6);
        ctx.stroke();
        ctx.lineWidth = 1.9;
        ctx.beginPath();
        ctx.moveTo(headX - 8, headY - 1);
        ctx.quadraticCurveTo(headX - 19, headY + 4 - flutter * 0.7, headX - 29, headY + 9 + flutter * 0.5);
        ctx.stroke();
    }

    if (opts.hat === 'kasa') {
        // Conical Bamboo Straw Hat (Staff Monk)
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.moveTo(headX - 24, headY - 4);
        ctx.lineTo(headX, headY - 18);
        ctx.lineTo(headX + 24, headY - 4);
        ctx.closePath();
        ctx.fill();
    } else if (opts.hat === 'boss') {
        // Horned Kabuto Crest & Flowing Crimson Cape
        ctx.fillStyle = '#c92a22';
        ctx.beginPath();
        ctx.moveTo(shoulderX - 8, shoulderY);
        ctx.quadraticCurveTo(shoulderX - 30, hipY + Math.sin(phase) * 5, shoulderX - 36, -6);
        ctx.lineTo(shoulderX - 14, -14);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = '#ffb830';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(headX - 4, headY - 8);
        ctx.lineTo(headX - 13, headY - 21);
        ctx.moveTo(headX + 4, headY - 8);
        ctx.lineTo(headX + 13, headY - 21);
        ctx.stroke();
    }

    if (opts.weapon === 'staff') {
        ctx.strokeStyle = '#3b2416';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(fHandX - 38, fHandY + 12);
        ctx.lineTo(fHandX + 46, fHandY - 10);
        ctx.stroke();
    } else if (opts.weapon === 'blade') {
        ctx.strokeStyle = '#e8e0d0';
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.moveTo(fHandX, fHandY);
        ctx.lineTo(fHandX + 38, fHandY - 16);
        ctx.stroke();
    }

    // Golden Parry Shield Aura when Player blocks/parries
    if (opts.parryAura) {
        ctx.strokeStyle = opts.parryAura;
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.arc(14, -48, 30, -0.95, 0.95);
        ctx.stroke();
    }

    // Street Fighter Chi Charge-Up Orb between cupped palms
    if (opts.chargeTicks && opts.chargeTicks >= CHARGE_VISUAL_TICKS) {
        var cProg = Math.min(1, (opts.chargeTicks - CHARGE_VISUAL_TICKS) / Math.max(1, CHARGE_MAX_TICKS - CHARGE_VISUAL_TICKS));
        var isMaxCharge = opts.chargeTicks >= CHARGE_MAX_TICKS;
        var isReadyCharge = opts.chargeTicks >= CHARGE_READY_TICKS;
        var orbX = (pose === 'charge') ? -3 : (fHandX + 2);
        var orbY = (pose === 'charge') ? -42 : fHandY;
        var pulseR = Math.sin(phase * 4.2) * (isMaxCharge ? 3.0 : (isReadyCharge ? 2.0 : 1.0));
        var orbR = 5.5 + cProg * 12.5 + pulseR;

        var orbGrad = ctx.createRadialGradient(orbX, orbY, 1.5, orbX, orbY, orbR * 2.0);
        if (isMaxCharge) {
            orbGrad.addColorStop(0, '#ffffff');
            orbGrad.addColorStop(0.38, '#7ef0ff');
            orbGrad.addColorStop(0.72, 'rgba(255, 210, 76, 0.85)');
            orbGrad.addColorStop(1, 'rgba(255, 160, 40, 0)');
        } else {
            orbGrad.addColorStop(0, '#ffffff');
            orbGrad.addColorStop(0.45, '#5ce8ff');
            orbGrad.addColorStop(0.78, 'rgba(38, 184, 255, 0.65)');
            orbGrad.addColorStop(1, 'rgba(38, 184, 255, 0)');
        }
        ctx.fillStyle = orbGrad;
        ctx.beginPath();
        ctx.arc(orbX, orbY, orbR * 2.0, 0, Math.PI * 2);
        ctx.fill();

        // Swirling chi arcs pulling energy inward
        ctx.strokeStyle = isMaxCharge ? '#ffd24c' : '#7ef0ff';
        ctx.lineWidth = isReadyCharge ? 2.2 : 1.5;
        for (var ci = 0; ci < 3; ci++) {
            var ca = phase * 3.4 + ci * 2.094;
            ctx.beginPath();
            ctx.arc(orbX, orbY, orbR + 4 + (ci % 2) * 3, ca, ca + 1.05);
            ctx.stroke();
        }

        // Ground chi wind ripples once Power Ball is ready to fire
        if (isReadyCharge) {
            ctx.strokeStyle = isMaxCharge ? 'rgba(255, 210, 76, 0.72)' : 'rgba(92, 232, 255, 0.62)';
            ctx.lineWidth = 2;
            var ringSpread = 22 + ((phase * 14) % 18);
            ctx.beginPath();
            ctx.ellipse(0, 1, ringSpread, 5, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    // Double-Palm Energy Muzzle Burst on Hadouken release
    if (pose === 'hadouken' && (opts.actionTick || 0) < 8) {
        var mAlpha = 1 - (opts.actionTick || 0) / 8;
        ctx.save();
        ctx.globalAlpha = mAlpha;
        ctx.strokeStyle = '#7ef0ff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(38, -46, 12 + (opts.actionTick || 0) * 3.5, -1.0, 1.0);
        ctx.stroke();
        ctx.restore();
    }

    // Wind-up Gold Glint Telegraph (tells player: PARRY NOW!)
    if (opts.windupGlint) {
        var r = 8 + opts.windupGlint * 10;
        ctx.strokeStyle = '#ffd24c';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(fHandX - r, fHandY);
        ctx.lineTo(fHandX + r, fHandY);
        ctx.moveTo(fHandX, fHandY - r);
        ctx.lineTo(fHandX, fHandY + r);
        ctx.stroke();
    }

    // Stunned Stars above head after getting Parried
    if (pose === 'stunned') {
        ctx.fillStyle = '#ffd24c';
        for (var st = 0; st < 3; st++) {
            var a = phase * 2.2 + st * 2.094;
            ctx.beginPath();
            ctx.arc(headX + Math.cos(a) * 16, headY - 18 + Math.sin(a) * 4, 2.8, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Streak Tier 1 / Tier 2 Blazing Chi Aura around Fighter!
    if (opts.streakTier && opts.streakTier >= 1 && opts.streakAuraColor) {
        ctx.save();
        var sPulse = 0.55 + Math.sin(phase * 3.0) * 0.25;
        ctx.globalAlpha = opts.streakTier >= 2 ? 0.85 : 0.55;
        ctx.strokeStyle = opts.streakAuraColor;
        ctx.lineWidth = opts.streakTier >= 2 ? 2.6 : 1.8;
        var gR = (opts.streakTier >= 2 ? 28 : 22) + sPulse * 6;
        ctx.beginPath();
        ctx.ellipse(0, 1, gR, 5.5, 0, 0, Math.PI * 2);
        ctx.stroke();
        if (opts.streakTier >= 2) {
            ctx.beginPath();
            ctx.arc(0, -44, 34 + sPulse * 4, phase * 1.4, phase * 1.4 + 2.2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(0, -44, 34 + sPulse * 4, phase * 1.4 + Math.PI, phase * 1.4 + Math.PI + 2.2);
            ctx.stroke();
        }
        ctx.restore();
    }

    ctx.restore();
}

function drawAfterimageClone(ctx, af, tick) {
    var alpha = Math.max(0.10, (af.life / (af.maxLife || 12)) * 0.48);
    var col = af.color || '#ff5247';
    ctx.save();
    ctx.globalAlpha = alpha;
    drawFighterSilhouette(ctx, {
        x: af.x,
        y: af.y,
        facing: af.facing,
        scale: 1.04,
        pose: af.pose || 'attack1',
        phase: tick * 0.16,
        flash: false,
        rimColor: col,
        headbandColor: col,
        actionTick: 6
    });
    ctx.restore();
}

function drawShadowCloneFighter(ctx, cl, tick) {
    ctx.save();
    ctx.globalAlpha = 0.78;
    drawFighterSilhouette(ctx, {
        x: cl.x,
        y: cl.y,
        facing: cl.facing,
        scale: 1.00,
        pose: cl.action || 'idle',
        phase: (cl.action === 'run') ? (cl.walkCycle || 0) : (tick * 0.13 + (cl.slotIndex || 0)),
        flash: false,
        rimColor: '#ff5247',
        headbandColor: '#ff5247',
        actionTick: cl.actionTick || 0,
        streakTier: 1,
        streakAuraColor: 'rgba(255, 82, 71, 0.7)'
    });
    ctx.restore();
}

function drawLightningBolt(ctx, bl, tick) {
    var alpha = Math.max(0, bl.life / (bl.maxLife || 12));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = bl.color || '#8ef4ff';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(bl.x1, bl.y1);
    var segs = 5;
    for (var i = 1; i < segs; i++) {
        var t = i / segs;
        var mx = bl.x1 + (bl.x2 - bl.x1) * t;
        var my = bl.y1 + (bl.y2 - bl.y1) * t + Math.sin(tick * 2.3 + bl.id + i * 2.7) * 14;
        ctx.lineTo(mx, my);
    }
    ctx.lineTo(bl.x2, bl.y2);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
}

function drawPlayerFighter(ctx, p, tick, streakTier) {
    var pose = p.action;
    if (p.invulnTimer > 0 && Math.floor(tick / 3) % 2 === 0 && p.action === 'hurt') {
        return; // brief hurt flicker
    }
    var fighter = (typeof getFighterSpec === 'function')
        ? getFighterSpec(p.fighterId)
        : { id: 'shadow', headband: '#e62e25', accent: '#ff5247' };
    var tier = streakTier || 0;
    var parryAura = p.parryCounterTimer > 0 ? 'rgba(255, 184, 48, 0.55)' : null;
    var chargeTicks = p.attackChargeTicks || 0;
    var rimColor = 'rgba(255, 235, 200, 0.42)';
    if (chargeTicks >= CHARGE_MAX_TICKS) rimColor = '#ffd24c';
    else if (chargeTicks >= CHARGE_VISUAL_TICKS) rimColor = '#38d9ff';
    else if (p.parryCounterTimer > 0) rimColor = '#ffd24c';
    else if (tier >= 2) rimColor = fighter.accent;
    else if (tier >= 1) rimColor = fighter.headband;

    drawFighterSilhouette(ctx, {
        x: p.x,
        y: p.y,
        facing: p.facing,
        scale: 1.04,
        pose: pose,
        phase: (pose === 'run') ? p.walkCycle : (tick * 0.12),
        flash: p.flashTimer > 0,
        rimColor: rimColor,
        headbandColor: fighter.headband,
        parryAura: parryAura,
        chargeTicks: chargeTicks,
        actionTick: p.actionTick || 0,
        streakTier: tier,
        streakAuraColor: fighter.accent
    });

    // Lotus Blade Orbiting Jade Ink Blades (Tier 1: 2 blades, Tier 2: 3 blades)
    if (fighter.id === 'lotus' && tier >= 1 && p.alive) {
        var bCount = tier >= 2 ? 3 : 2;
        var baseAng = p.orbitAngle || 0;
        for (var bi = 0; bi < bCount; bi++) {
            var a = baseAng + (bi * Math.PI * 2 / bCount);
            var bx = p.x + Math.cos(a) * 56;
            var by = (p.y - 44) + Math.sin(a) * 34;
            ctx.save();
            ctx.translate(bx, by);
            ctx.rotate(tick * 0.35 + bi);
            ctx.shadowColor = '#36e68a';
            ctx.shadowBlur = 10;
            ctx.fillStyle = '#7dffba';
            ctx.strokeStyle = '#0d261a';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            for (var sp = 0; sp < 3; sp++) {
                var sa = sp * (Math.PI * 2 / 3);
                ctx.lineTo(Math.cos(sa) * 12, Math.sin(sa) * 12);
                ctx.lineTo(Math.cos(sa + 0.6) * 4, Math.sin(sa + 0.6) * 4);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }
    }
}

function drawEnemyFighter(ctx, e, tick) {
    var pose = 'idle';
    if (e.state === 'approach') pose = 'run';
    else if (e.state === 'windup') pose = 'windup';
    else if (e.state === 'attack') pose = (e.kind === 'staff' || e.kind === 'boss') ? 'attack1' : 'attack2';
    else if (e.state === 'leap') pose = 'jump';
    else if (e.state === 'hurt' || e.state === 'thrown') pose = 'hurt';
    else if (e.state === 'stunned') pose = 'stunned';

    var windupGlint = 0;
    if (e.state === 'windup' && e.stateDur > 0) {
        var progress = e.stateTick / e.stateDur;
        if (progress > 0.45) windupGlint = progress;
    }

    var headband = e.kind === 'knife' ? '#8c3b9c' : (e.kind === 'brawler' ? '#7a7068' : null);
    var hat = e.kind === 'staff' ? 'kasa' : (e.kind === 'boss' ? 'boss' : null);
    var weapon = e.kind === 'staff' ? 'staff' : (e.kind === 'boss' ? 'blade' : null);

    drawFighterSilhouette(ctx, {
        x: e.x,
        y: e.y,
        facing: e.facing,
        scale: e.scale,
        pose: pose,
        phase: (pose === 'run') ? e.walkCycle : (tick * 0.14),
        flash: e.flashTimer > 0,
        rimColor: e.state === 'thrown' ? '#ffb830' : (e.kind === 'boss' ? 'rgba(230, 56, 40, 0.55)' : null),
        headbandColor: headband,
        hat: hat,
        weapon: weapon,
        windupGlint: windupGlint
    });

    // Small overhead HP sliver for damaged regular enemies (boss has big top bar)
    if (e.kind !== 'boss' && e.hp < e.maxHp) {
        var bw = 34;
        var bx = e.x - bw * 0.5;
        var by = e.y - 92 * e.scale;
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(bx, by, bw, 4);
        ctx.fillStyle = '#e03025';
        ctx.fillRect(bx, by, bw * Math.max(0, e.hp / e.maxHp), 4);
    }
}

function drawProjectile(ctx, pr) {
    if (pr.kind === 'ko_body') {
        // Tumbling KO'd enemy flying at chest height as a human bowling projectile!
        var sc = pr.scale || 1.0;
        var streakDir = pr.vx >= 0 ? -1 : 1;
        ctx.save();
        ctx.translate(pr.x, pr.y);
        // Dramatic golden-crimson bowling speed lines
        ctx.strokeStyle = 'rgba(255, 184, 48, 0.72)';
        ctx.lineWidth = 7 * sc;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(streakDir * 52 * sc, -pr.vy * 1.6);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(230, 56, 40, 0.55)';
        ctx.lineWidth = 3.5 * sc;
        ctx.beginPath();
        ctx.moveTo(0, -10 * sc);
        ctx.lineTo(streakDir * 44 * sc, -10 * sc - pr.vy * 1.2);
        ctx.moveTo(0, 10 * sc);
        ctx.lineTo(streakDir * 44 * sc, 10 * sc - pr.vy * 1.2);
        ctx.stroke();

        ctx.rotate(pr.spin);
        ctx.scale(sc, sc);
        ctx.shadowColor = '#ffb830';
        ctx.shadowBlur = 10;
        ctx.fillStyle = '#0b0909';
        ctx.strokeStyle = '#0b0909';
        // Full tumbling martial artist silhouette (torso, limbs, head + hat/headband)
        ctx.beginPath();
        ctx.moveTo(-10, -14); ctx.lineTo(10, -14);
        ctx.lineTo(12, 16);   ctx.lineTo(-12, 16);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, -24, 9, 0, Math.PI * 2);
        ctx.fill();
        drawLimb(ctx, -6, 12, -19, 28, 6.5);
        drawLimb(ctx, 6, 12, 20, 26, 6.5);
        drawLimb(ctx, -9, -10, -25, -18, 6);
        drawLimb(ctx, 9, -10, 25, -15, 6);
        ctx.shadowBlur = 0;
        if (pr.enemyKind === 'staff') {
            // Straw kasa hat spinning with them!
            ctx.fillStyle = '#0b0909';
            ctx.beginPath();
            ctx.moveTo(-22, -26); ctx.lineTo(0, -40); ctx.lineTo(22, -26);
            ctx.closePath();
            ctx.fill();
        } else {
            ctx.strokeStyle = pr.enemyKind === 'knife' ? '#8c3b9c' : '#9a8c80';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(-8, -26); ctx.lineTo(8, -26);
            ctx.stroke();
        }
        ctx.restore();
        return;
    }

    if (pr.kind === 'crescent') {
        var cDir = pr.vx >= 0 ? 1 : -1;
        var cr = pr.radius || 24;
        ctx.save();
        ctx.translate(pr.x, pr.y);
        ctx.scale(cDir, 1);
        ctx.shadowColor = pr.color || '#ff5247';
        ctx.shadowBlur = 12;
        ctx.strokeStyle = pr.color || '#ff5247';
        ctx.lineWidth = 9;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(-8, 0, cr, -1.15, 1.15);
        ctx.stroke();
        ctx.strokeStyle = '#fff3d6';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();
        return;
    }

    if (pr.kind === 'jade_blade') {
        ctx.save();
        ctx.translate(pr.x, pr.y);
        ctx.rotate(pr.spin);
        ctx.shadowColor = '#36e68a';
        ctx.shadowBlur = 10;
        ctx.fillStyle = '#7dffba';
        ctx.strokeStyle = '#0c2618';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (var jb = 0; jb < 3; jb++) {
            var ja = jb * (Math.PI * 2 / 3);
            ctx.lineTo(Math.cos(ja) * 13, Math.sin(ja) * 13);
            ctx.lineTo(Math.cos(ja + 0.6) * 4, Math.sin(ja + 0.6) * 4);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        return;
    }

    if (pr.kind === 'fireball') {
        var dir = pr.vx >= 0 ? 1 : -1;
        var r = pr.radius || 18;
        var isSuper = pr.power === 2;
        var wobble = Math.sin(pr.spin * 1.9) * 2.2;

        ctx.save();
        ctx.translate(pr.x, pr.y);
        ctx.scale(dir, 1);

        // Trailing comet chi wake
        var tailLen = r * (isSuper ? 3.5 : 2.8);
        var tailGrad = ctx.createLinearGradient(-tailLen, 0, r * 0.6, 0);
        tailGrad.addColorStop(0, 'rgba(38, 184, 255, 0)');
        tailGrad.addColorStop(0.55, isSuper ? 'rgba(255, 210, 76, 0.55)' : 'rgba(56, 217, 255, 0.50)');
        tailGrad.addColorStop(1, isSuper ? 'rgba(126, 240, 255, 0.92)' : 'rgba(126, 240, 255, 0.85)');
        ctx.fillStyle = tailGrad;
        ctx.beginPath();
        ctx.moveTo(-tailLen, wobble * 0.6);
        ctx.quadraticCurveTo(-tailLen * 0.4, -r * 1.05 - wobble * 0.4, r * 0.25, -r * 0.85);
        ctx.arc(0, 0, r * 0.92, -Math.PI * 0.45, Math.PI * 0.45);
        ctx.quadraticCurveTo(-tailLen * 0.4, r * 1.05 + wobble * 0.4, -tailLen, wobble * 0.6);
        ctx.closePath();
        ctx.fill();

        // Outer glowing chi aura
        var auraGrad = ctx.createRadialGradient(2, 0, r * 0.2, 0, 0, r * 2.0);
        if (isSuper) {
            auraGrad.addColorStop(0, '#ffffff');
            auraGrad.addColorStop(0.32, '#8ef4ff');
            auraGrad.addColorStop(0.62, 'rgba(255, 210, 76, 0.78)');
            auraGrad.addColorStop(1, 'rgba(255, 160, 40, 0)');
        } else {
            auraGrad.addColorStop(0, '#ffffff');
            auraGrad.addColorStop(0.40, '#6ceaff');
            auraGrad.addColorStop(0.72, 'rgba(38, 184, 255, 0.65)');
            auraGrad.addColorStop(1, 'rgba(38, 184, 255, 0)');
        }
        ctx.fillStyle = auraGrad;
        ctx.beginPath();
        ctx.arc(0, 0, r * 2.0, 0, Math.PI * 2);
        ctx.fill();

        // Classic Hadouken leading energy wave crescents
        ctx.strokeStyle = isSuper ? '#ffd24c' : '#a8f6ff';
        ctx.lineWidth = isSuper ? 3.2 : 2.4;
        ctx.beginPath();
        ctx.arc(2, 0, r * 0.95 + wobble * 0.25, -1.15, 1.15);
        ctx.stroke();

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.arc(-4, 0, r * 0.68 - wobble * 0.2, -1.05, 1.05);
        ctx.stroke();

        // White-hot inner energy core
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(3, 0, r * 0.56, r * 0.46, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
        return;
    }

    ctx.save();
    ctx.translate(pr.x, pr.y);
    ctx.rotate(pr.spin);
    // Spinning steel shuriken / throwing knife (gold glow if parried back!)
    ctx.fillStyle = pr.owner === 'player' ? '#ffd24c' : '#f2ede2';
    ctx.strokeStyle = pr.owner === 'player' ? '#d92828' : '#111';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (var i = 0; i < 4; i++) {
        var a = i * Math.PI * 0.5;
        ctx.lineTo(Math.cos(a) * 11, Math.sin(a) * 11);
        ctx.lineTo(Math.cos(a + 0.42) * 3.5, Math.sin(a + 0.42) * 3.5);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
}

function drawTrap(ctx, tr, tick) {
    var isPlayerOwned = tr.owner === 'player';
    if (tr.kind === 'barrel') {
        ctx.save();
        ctx.translate(tr.x, tr.y - 18);
        if (isPlayerOwned) {
            // Blazing golden bowling-ball comet trail + aura!
            var bTrailDir = (tr.vx || 1) >= 0 ? -1 : 1;
            var trailG = ctx.createLinearGradient(0, 0, bTrailDir * 72, 0);
            trailG.addColorStop(0, 'rgba(255, 210, 76, 0.78)');
            trailG.addColorStop(0.5, 'rgba(255, 120, 35, 0.45)');
            trailG.addColorStop(1, 'rgba(255, 100, 20, 0)');
            ctx.fillStyle = trailG;
            ctx.beginPath();
            ctx.moveTo(0, -17);
            ctx.lineTo(bTrailDir * 72, 0);
            ctx.lineTo(0, 17);
            ctx.closePath();
            ctx.fill();

            var bg = ctx.createRadialGradient(0, 0, 12, 0, 0, 34);
            bg.addColorStop(0, 'rgba(255, 210, 76, 0.75)');
            bg.addColorStop(1, 'rgba(255, 140, 40, 0)');
            ctx.fillStyle = bg;
            ctx.beginPath();
            ctx.arc(0, 0, 34, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.rotate(tr.angle);
        ctx.fillStyle = isPlayerOwned ? '#24140a' : '#18100d';
        ctx.strokeStyle = isPlayerOwned ? '#ffd24c' : '#d96b27';
        ctx.lineWidth = isPlayerOwned ? 3.5 : 3;
        ctx.beginPath();
        ctx.arc(0, 0, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // Spokes
        ctx.strokeStyle = isPlayerOwned ? '#fff3c4' : '#ffb830';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(-12, 0); ctx.lineTo(12, 0);
        ctx.moveTo(0, -12); ctx.lineTo(0, 12);
        ctx.stroke();
        ctx.restore();
    } else if (tr.kind === 'tile') {
        if (!isPlayerOwned) {
            // Ground danger ink-ring telegraph!
            var pulse = 0.55 + Math.sin(tick * 0.4) * 0.35;
            ctx.strokeStyle = 'rgba(235, 50, 35, ' + pulse + ')';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.ellipse(tr.x, GROUND_Y + 2, 24, 6, 0, 0, Math.PI * 2);
            ctx.stroke();
        }

        if (isPlayerOwned || tr.telegraph <= 0) {
            ctx.save();
            ctx.translate(tr.x, tr.y);
            if (isPlayerOwned) {
                var tg = ctx.createRadialGradient(0, 0, 6, 0, 0, 26);
                tg.addColorStop(0, 'rgba(255, 210, 76, 0.65)');
                tg.addColorStop(1, 'rgba(255, 180, 40, 0)');
                ctx.fillStyle = tg;
                ctx.beginPath();
                ctx.arc(0, 0, 26, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.rotate(tr.angle);
            ctx.fillStyle = isPlayerOwned ? '#241c18' : '#141010';
            ctx.strokeStyle = isPlayerOwned ? '#ffd24c' : '#d92828';
            ctx.lineWidth = isPlayerOwned ? 2.6 : 2;
            ctx.fillRect(-16, -7, 32, 14);
            ctx.strokeRect(-16, -7, 32, 14);
            ctx.restore();
        }
    }
}

function drawSlashArc(ctx, sl) {
    var prog = sl.age / sl.maxAge;
    var alpha = Math.max(0, 1 - prog);
    ctx.save();
    ctx.translate(sl.x, sl.y);
    ctx.scale(sl.facing, 1);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = sl.color;
    ctx.lineCap = 'round';

    if (sl.style === 'spin') {
        // Full 360° circular hurricane defense brush rings!
        var sr = 58 + prog * 28;
        var spinRot = prog * Math.PI * 2.2;
        ctx.lineWidth = 10 * (1 - prog * 0.45);
        ctx.beginPath();
        ctx.arc(0, 0, sr, spinRot, spinRot + Math.PI * 1.65);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, sr * 0.72, spinRot + Math.PI, spinRot + Math.PI * 2.45);
        ctx.stroke();
        ctx.strokeStyle = '#fff3d6';
        ctx.lineWidth = Math.max(1.8, ctx.lineWidth * 0.32);
        ctx.beginPath();
        ctx.arc(0, 0, sr, spinRot + 0.1, spinRot + Math.PI * 1.45);
        ctx.stroke();
        ctx.restore();
        return;
    }

    var r = sl.style === 'counter' ? 68 : (sl.style === 'upper' ? 54 : 42);
    ctx.lineWidth = (sl.style === 'counter' ? 12 : 8) * (1 - prog * 0.5);
    ctx.beginPath();
    if (sl.style === 'upper' || sl.style === 'counter') {
        ctx.arc(-8, 6, r, -Math.PI * 0.72, Math.PI * 0.18);
    } else if (sl.style === 'kick' || sl.style === 'air') {
        ctx.arc(-4, -2, r, -Math.PI * 0.35, Math.PI * 0.35);
    } else {
        ctx.arc(-6, 0, r * 0.85, -Math.PI * 0.28, Math.PI * 0.25);
    }
    ctx.stroke();

    // Crisp bright core line inside the brush stroke
    ctx.strokeStyle = '#fff3d6';
    ctx.lineWidth = Math.max(1.5, ctx.lineWidth * 0.3);
    ctx.stroke();
    ctx.restore();
}

function drawParticle(ctx, pt) {
    var alpha = Math.max(0, pt.life / pt.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (pt.kind === 'ring') {
        var r = pt.size * (1 - alpha * 0.75);
        ctx.strokeStyle = pt.color;
        ctx.lineWidth = 4 * alpha + 1;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, Math.max(4, r), 0, Math.PI * 2);
        ctx.stroke();
    } else {
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size * (0.4 + 0.6 * alpha), 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function drawCallout(ctx, co) {
    var alpha = Math.max(0, Math.min(1, (co.life / co.maxLife) * 1.5));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 17px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#0a0707';
    ctx.lineWidth = 4;
    ctx.strokeText(co.text, co.x, co.y);
    ctx.fillStyle = co.color;
    ctx.fillText(co.text, co.x, co.y);
    ctx.restore();
}

function drawHud(ctx, frame, viewW) {
    var p = frame.player;
    if (!p) return;

    // Player HP Brush Bar (Top Left)
    var barX = 18;
    var barY = 26;
    var barW = 190;
    var barH = 14;
    ctx.fillStyle = 'rgba(10, 6, 6, 0.72)';
    ctx.fillRect(barX - 3, barY - 3, barW + 6, barH + 6);
    var hpRatio = Math.max(0, Math.min(1, p.hp / p.maxHp));
    ctx.fillStyle = hpRatio > 0.3 ? '#d92828' : '#ff6b35';
    ctx.fillRect(barX, barY, barW * hpRatio, barH);
    ctx.strokeStyle = '#f2e4c8';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(barX - 3, barY - 3, barW + 6, barH + 6);

    var fSpec = (typeof getFighterSpec === 'function')
        ? getFighterSpec(p.fighterId || frame.fighterId)
        : { shortName: 'RONIN', headband: '#e62e25', accent: '#ff5247', tier1Name: 'SHADOW CLONE', tier2Name: 'TWIN CLONES' };
    var sTier = frame.streakTier || 0;

    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#f5ead6';
    ctx.textAlign = 'left';
    ctx.fillText('HP ' + p.hp + '/' + p.maxHp + '  •  FL ' + frame.floor + '  •  ' + fSpec.shortName, barX, barY - 8);

    // Street Fighter Chi Charge Bar directly beneath HP bar when charging
    var cTicks = p.attackChargeTicks || 0;
    if (cTicks >= CHARGE_VISUAL_TICKS) {
        var cBarY = barY + barH + 8;
        var cBarH = 6;
        var cRatio = Math.max(0, Math.min(1, cTicks / CHARGE_MAX_TICKS));
        var cReadyRatio = CHARGE_READY_TICKS / CHARGE_MAX_TICKS;
        var cIsMax = cTicks >= CHARGE_MAX_TICKS;
        var cIsReady = cTicks >= CHARGE_READY_TICKS;

        ctx.fillStyle = 'rgba(10, 6, 6, 0.78)';
        ctx.fillRect(barX - 2, cBarY - 2, barW + 4, cBarH + 4);
        ctx.fillStyle = cIsMax ? '#ffd24c' : (cIsReady ? '#5ce8ff' : '#2688c9');
        ctx.fillRect(barX, cBarY, barW * cRatio, cBarH);

        // Ready threshold tick mark
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(barX + barW * cReadyRatio - 1, cBarY - 1, 2, cBarH + 2);

        ctx.strokeStyle = cIsMax ? '#ffd24c' : '#7ef0ff';
        ctx.lineWidth = 1;
        ctx.strokeRect(barX - 2, cBarY - 2, barW + 4, cBarH + 4);

        ctx.font = 'bold 10px monospace';
        ctx.fillStyle = cIsMax ? '#ffd24c' : (cIsReady ? '#7ef0ff' : '#b8d8e8');
        ctx.fillText(cIsMax ? 'SUPER HADOU READY!' : (cIsReady ? 'HADOU READY! (RELEASE)' : 'CHARGING CHI...'), barX, cBarY + cBarH + 12);
    }

    // Score & Combo + Live Streak Power-Up Badge (Top Center)
    ctx.textAlign = 'center';
    ctx.font = 'bold 15px monospace';
    ctx.fillStyle = '#ffe7b3';
    ctx.fillText('SCORE ' + frame.score, viewW * 0.5, 24);
    if (frame.comboCount >= 2) {
        ctx.font = 'bold 13px Georgia, serif';
        ctx.fillStyle = sTier >= 1 ? fSpec.accent : '#ffd24c';
        var comboLabel = frame.comboCount + ' HIT COMBO';
        if (sTier >= 2) comboLabel += '  ★ ' + fSpec.tier2Name;
        else if (sTier >= 1) comboLabel += '  • ' + fSpec.tier1Name;
        ctx.fillText(comboLabel, viewW * 0.5, 42);
    }

    // Active Floor Boss HP Bar (Bottom-ish Top Center)
    var boss = null;
    for (var i = 0; i < frame.enemies.length; i++) {
        if (frame.enemies[i].kind === 'boss') {
            boss = frame.enemies[i];
            break;
        }
    }
    if (boss) {
        var bW = 280;
        var bX = (viewW - bW) * 0.5;
        var bY = 58;
        ctx.fillStyle = 'rgba(10, 6, 6, 0.8)';
        ctx.fillRect(bX - 3, bY - 3, bW + 6, 14);
        ctx.fillStyle = '#e02820';
        ctx.fillRect(bX, bY, bW * Math.max(0, boss.hp / boss.maxHp), 8);
        ctx.strokeStyle = '#ffd24c';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(bX - 3, bY - 3, bW + 6, 14);
        ctx.font = 'bold 11px Georgia, serif';
        ctx.fillStyle = '#ffd24c';
        ctx.textAlign = 'center';
        var bName = BOSS_NAMES[(frame.floor - 1) % BOSS_NAMES.length];
        ctx.fillText(bName, viewW * 0.5, bY - 6);
    }

    // "ADVANCE ▶" prompt after clearing a wave
    if (frame.goPromptTimer > 0 && Math.floor(frame.tick / 14) % 2 === 0) {
        ctx.save();
        ctx.font = 'bold 22px Georgia, serif';
        ctx.textAlign = 'right';
        ctx.strokeStyle = '#0a0707';
        ctx.lineWidth = 5;
        ctx.strokeText('GO ▶', viewW - 24, 96);
        ctx.fillStyle = '#ffd24c';
        ctx.fillText('GO ▶', viewW - 24, 96);
        ctx.restore();
    }

    // Floor / Boss Calligraphy Banner
    if (frame.bannerTimer > 0 && frame.bannerText) {
        var ba = Math.min(1, frame.bannerTimer / 22);
        ctx.save();
        ctx.globalAlpha = ba;
        ctx.fillStyle = 'rgba(12, 6, 6, 0.65)';
        ctx.fillRect(0, 108, viewW, 44);
        ctx.strokeStyle = '#d92828';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 108); ctx.lineTo(viewW, 108);
        ctx.moveTo(0, 152); ctx.lineTo(viewW, 152);
        ctx.stroke();

        ctx.font = 'bold 20px Georgia, serif';
        ctx.fillStyle = '#ffe7b3';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(frame.bannerText, viewW * 0.5, 130);
        ctx.restore();
    }
}

// Draws compact virtual button indicators showing exact INPUT_* bits pressed
// during Self-Play AI mode and Saved Input Playback (makes bug-hunting visual!)
function drawInputVisualizer(ctx, mask, dpr, topY) {
    var btns = [
        { label: '◀',   bit: INPUT_LEFT,   onColor: '#ffe7b3' },
        { label: '▶',   bit: INPUT_RIGHT,  onColor: '#ffe7b3' },
        { label: 'JMP', bit: INPUT_JUMP,   onColor: '#7ff08f' },
        { label: 'ATK', bit: INPUT_ATTACK, onColor: '#e6392e' }
    ];
    ctx.save();
    var h = Math.round(18 * dpr);
    var gap = Math.round(4 * dpr);
    var x = Math.round(12 * dpr);
    var fontSz = Math.max(9, Math.round(10 * dpr));
    ctx.font = 'bold ' + fontSz + 'px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        var w = Math.round((b.label.length === 1 ? 22 : 34) * dpr);
        var active = (mask & b.bit) !== 0;
        ctx.fillStyle = active ? b.onColor : 'rgba(12, 6, 6, 0.62)';
        ctx.fillRect(x, topY, w, h);
        ctx.strokeStyle = active ? '#ffffff' : 'rgba(244, 230, 204, 0.35)';
        ctx.lineWidth = Math.max(1, dpr);
        ctx.strokeRect(x, topY, w, h);
        ctx.fillStyle = active ? '#120808' : 'rgba(244, 230, 204, 0.55)';
        ctx.fillText(b.label, x + w * 0.5, topY + h * 0.52);
        x += w + gap;
    }
    ctx.restore();
}
