// ============================================================================
// render.js - Pure Canvas Presentation Layer
//
// Renders any RenderFrame (live simulation OR blended Replay keyframe) using
// aspect-ratio-preserving scaling from logical worldWidth x worldHeight to the
// current hardware canvas dimensions so Saved Input playback looks identical
// on any screen size.
// ============================================================================

function computeViewportTransform(canvasWidth, canvasHeight, worldWidth, worldHeight) {
    var scaleX = canvasWidth / worldWidth;
    var scaleY = canvasHeight / worldHeight;
    var scale = Math.min(scaleX, scaleY);
    var drawW = worldWidth * scale;
    var drawH = worldHeight * scale;
    var offsetX = (canvasWidth - drawW) * 0.5;
    var offsetY = (canvasHeight - drawH) * 0.5;
    return {
        scale: scale,
        offsetX: offsetX,
        offsetY: offsetY,
        drawW: drawW,
        drawH: drawH
    };
}

function drawObstacle(ctx, obs, worldWidth, score, lives, level) {
    ctx.strokeStyle = '#0ff';
    ctx.lineWidth = 3;
    ctx.strokeRect(obs.x, obs.y, obs.width, obs.height);

    ctx.fillStyle = '#0ff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    var fontSize = Math.min(obs.height / 6, 18);
    ctx.font = fontSize + "px 'Press Start 2P', monospace";

    var lineSpacing = fontSize * 1.8;
    var startY = obs.y + obs.height / 2 - lineSpacing;

    ctx.fillText('SCORE: ' + score, worldWidth / 2, startY);
    ctx.fillText('LIVES: ' + lives, worldWidth / 2, startY + lineSpacing);
    ctx.fillText('LEVEL: ' + level, worldWidth / 2, startY + lineSpacing * 2);
}

function drawPlayer(ctx, p, tickFloat) {
    if (!p || !p.alive) return;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);

    var blinkWhite = p.isInvincible && (Math.floor(p.invincibilityTimer / 10) % 2 === 0);
    ctx.strokeStyle = blinkWhite ? '#fff' : '#0ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.r, 0);
    ctx.lineTo(-p.r, -p.r * 0.7);
    ctx.lineTo(-p.r * 0.5, 0);
    ctx.lineTo(-p.r, p.r * 0.7);
    ctx.closePath();
    ctx.stroke();

    if (p.isThrusting) {
        // Deterministic visual flicker (never uses Math.random!)
        var flicker = Math.sin(tickFloat * 1.7) * 2.0;
        ctx.strokeStyle = '#f0f';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-p.r * 0.6, 0);
        ctx.lineTo(-p.r * 1.5, flicker);
        ctx.stroke();
    }

    ctx.restore();
}

function drawBullets(ctx, bullets) {
    ctx.fillStyle = '#ff0';
    for (var i = 0; i < bullets.length; i++) {
        var b = bullets[i];
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawEnemies(ctx, enemies) {
    ctx.strokeStyle = '#f00';
    ctx.lineWidth = 2;
    for (var i = 0; i < enemies.length; i++) {
        var e = enemies[i];
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(e.angle);

        ctx.beginPath();
        ctx.ellipse(0, 0, e.r, e.r * 0.4, 0, 0, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, -e.r * 0.1, e.r * 0.5, Math.PI, 0);
        ctx.stroke();

        ctx.restore();
    }
}

function drawParticles(ctx, particles) {
    for (var i = 0; i < particles.length; i++) {
        var pt = particles[i];
        ctx.fillStyle = pt.color;
        ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
}

// Main render entry point.
// options: { clearHard: bool, modeBadge: string | null, borderColor: string | null }
function renderGameFrame(ctx, canvasWidth, canvasHeight, frame, options) {
    if (!frame) return;

    var opts = options || {};
    var vp = computeViewportTransform(canvasWidth, canvasHeight, frame.worldWidth, frame.worldHeight);

    // Clear full physical canvas (letterbox bars stay pure black)
    if (opts.clearHard) {
        ctx.fillStyle = '#020202';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    } else {
        // Clear letterbox margins cleanly, apply subtle phosphor trail inside arena
        ctx.fillStyle = '#000';
        if (vp.offsetX > 0.5) {
            ctx.fillRect(0, 0, vp.offsetX, canvasHeight);
            ctx.fillRect(vp.offsetX + vp.drawW, 0, canvasWidth - (vp.offsetX + vp.drawW), canvasHeight);
        }
        if (vp.offsetY > 0.5) {
            ctx.fillRect(0, 0, canvasWidth, vp.offsetY);
            ctx.fillRect(0, vp.offsetY + vp.drawH, canvasWidth, canvasHeight - (vp.offsetY + vp.drawH));
        }
        ctx.fillStyle = 'rgba(2, 2, 2, 0.35)';
        ctx.fillRect(vp.offsetX, vp.offsetY, vp.drawW, vp.drawH);
    }

    // Draw logical arena clipped & scaled
    ctx.save();
    ctx.beginPath();
    ctx.rect(vp.offsetX, vp.offsetY, vp.drawW, vp.drawH);
    ctx.clip();

    ctx.translate(vp.offsetX, vp.offsetY);
    ctx.scale(vp.scale, vp.scale);

    drawObstacle(ctx, frame.obstacle, frame.worldWidth, frame.score, frame.lives, frame.level);
    drawPlayer(ctx, frame.player, frame.tick);
    drawBullets(ctx, frame.bullets);
    drawEnemies(ctx, frame.enemies);
    drawParticles(ctx, frame.particles);

    // Draw logical arena boundary (visible when letterboxed or in special mode)
    var isLetterboxed = (vp.offsetX > 1 || vp.offsetY > 1);
    if (isLetterboxed || opts.borderColor) {
        ctx.strokeStyle = opts.borderColor || 'rgba(0, 255, 255, 0.45)';
        ctx.lineWidth = 2 / vp.scale;
        ctx.strokeRect(1 / vp.scale, 1 / vp.scale, frame.worldWidth - 2 / vp.scale, frame.worldHeight - 2 / vp.scale);
    }

    ctx.restore();

    // Optional top-left status badge (REPLAY / INPUT PLAYBACK), scaled for HiDPI
    var dpr = opts.dpr || 1;
    if (opts.modeBadge) {
        ctx.save();
        ctx.font = Math.round(11 * dpr) + "px 'Press Start 2P', monospace";
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = opts.badgeColor || '#ff0';
        ctx.fillText(opts.modeBadge, Math.round(14 * dpr), Math.round(14 * dpr));
        ctx.restore();
    }

    // Optional live button-press visualizer (Replay, AI Demo, & Saved Input Playback)
    if (typeof opts.inputMask === 'number') {
        var vizY = opts.inputBottom
            ? (canvasHeight - Math.round(30 * dpr))
            : (opts.modeBadge ? Math.round(32 * dpr) : Math.round(12 * dpr));
        drawVfInputVisualizer(ctx, opts.inputMask, dpr, vizY);
    }
}

function drawVfInputVisualizer(ctx, mask, dpr, topY) {
    var btns = [
        { label: '◀',    bit: INPUT_LEFT,   onColor: '#0ff' },
        { label: '▲',    bit: INPUT_THRUST, onColor: '#f0f' },
        { label: '▶',    bit: INPUT_RIGHT,  onColor: '#0ff' },
        { label: 'FIRE', bit: INPUT_SHOOT,  onColor: '#ff0' }
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
        var w = Math.round((b.label.length === 1 ? 22 : 40) * dpr);
        var active = (mask & b.bit) !== 0;
        ctx.fillStyle = active ? b.onColor : 'rgba(0, 12, 16, 0.72)';
        ctx.fillRect(x, topY, w, h);
        ctx.strokeStyle = active ? '#fff' : 'rgba(0, 255, 255, 0.45)';
        ctx.lineWidth = Math.max(1, dpr);
        ctx.strokeRect(x, topY, w, h);
        ctx.fillStyle = active ? '#000' : 'rgba(0, 255, 255, 0.55)';
        ctx.fillText(b.label, x + w * 0.5, topY + h * 0.52);
        x += w + gap;
    }
    ctx.restore();
}
