// ============================================================================
// kung-fu/js/main.js - Shadow Pagoda Loop, Responsive Controls, Saved Input & Replay
// ============================================================================

(function () {
    var container         = document.getElementById('game-container');
    var canvas            = document.getElementById('gameCanvas');
    var ctx               = canvas.getContext('2d');

    var messageOverlay    = document.getElementById('message-overlay');
    var messageTitle      = document.getElementById('message-title');
    var messageText       = document.getElementById('message-text');
    var fighterPicker     = document.getElementById('fighter-picker');
    var fighterCardsWrap  = document.getElementById('fighter-cards');
    var fighterSkillDesc  = document.getElementById('fighter-skill-desc');
    var startButton       = document.getElementById('start-button');
    var demoButton        = document.getElementById('demo-button');
    var gameoverReplayBtn = document.getElementById('gameover-replay-btn');
    var gameoverSaveBtn   = document.getElementById('gameover-save-btn');

    var hudReplayBtn      = document.getElementById('hud-replay-btn');
    var hudMenuBtn        = document.getElementById('hud-menu-btn');

    var menuModal         = document.getElementById('menu-modal');
    var menuCloseBtn      = document.getElementById('menu-close-btn');
    var inputStatusText   = document.getElementById('input-status-text');
    var saveInputBtn      = document.getElementById('save-input-btn');
    var loadInputBtn      = document.getElementById('load-input-btn');
    var loadInputFile     = document.getElementById('load-input-file');
    var menuDemoBtn       = document.getElementById('menu-demo-btn');
    var stopPlaybackBtn   = document.getElementById('stop-playback-btn');
    var menuFeedback      = document.getElementById('menu-feedback');

    var devSection        = document.getElementById('dev-section');
    var devLiveHash       = document.getElementById('dev-live-hash');
    var devIncludeHashes  = document.getElementById('dev-include-hashes');
    var devFastVerifyBtn  = document.getElementById('dev-fast-verify-btn');
    var devAiTestBtn      = document.getElementById('dev-ai-test-btn');
    var devAiDownloadBtn  = document.getElementById('dev-ai-download-btn');
    var devDownloadLogBtn = document.getElementById('dev-download-log-btn');
    var devReportBox      = document.getElementById('dev-report-box');

    var replayBar         = document.getElementById('replay-bar');
    var replayShowPill    = document.getElementById('replay-show-pill');
    var replayMarkers     = document.getElementById('replay-markers');
    var replayScrubber    = document.getElementById('replay-scrubber');
    var replayInfoText    = document.getElementById('replay-info-text');
    var replayPlayToggle  = document.getElementById('replay-play-toggle');
    var replaySpeedDown   = document.getElementById('replay-speed-down');
    var replaySpeedLabel  = document.getElementById('replay-speed-label');
    var replaySpeedUp     = document.getElementById('replay-speed-up');
    var replayStepBackBtn = document.getElementById('replay-step-back');
    var replayStepSubBack = document.getElementById('replay-step-sub-back');
    var replayStepSubFwd  = document.getElementById('replay-step-sub-fwd');
    var replayStepFwdBtn  = document.getElementById('replay-step-fwd');
    var replayPlayHereBtn = document.getElementById('replay-play-here-btn');
    var replayHideBtn     = document.getElementById('replay-hide-btn');
    var replayExitBtn     = document.getElementById('replay-exit-btn');

    var audio       = createAudioSystem();
    var liveInput   = createLiveInput();
    var inputCtrl   = createInputController(liveInput);
    var aiState     = createAiState();
    var replayBuf   = createReplayBuffer(REPLAY_MAX_FRAMES);
    var devLogger   = createDeterminismLogger();

    var simState        = null;
    var lastInputMask   = INPUT_NONE;
    var lastAiTestJson  = null;
    var cssWidth        = 800;
    var cssHeight       = 450;
    var canvasWidth     = 800;
    var canvasHeight    = 450;
    var canvasDpr       = 1;
    var isMobileDevice  = false;
    var appMode         = 'title'; // 'title', 'demo', 'playing', 'paused', 'gameover', 'replay'
    var selectedFighterId = 'shadow';
    var menuOpen        = false;
    var modeBeforeReplay = 'playing';

    var DEMO_MAX_TICKS   = 3600;
    var demoMatchCounter = 0;

    var rafId           = 0;
    var lastFrameMs     = 0;
    var accumulatorMs   = 0;
    var FIXED_STEP_MS   = 1000.0 / SIM_TICK_RATE;

    var REPLAY_SPEEDS   = [-2, -1, -0.25, 0, 0.25, 0.5, 1, 2];
    var replayCursor    = 0.0;
    var replaySpeed     = 0.0;
    var replayLastSpeed = 1.0;
    var replayBarHidden = false;
    var replayDragging  = false;

    function getReserveBottomCss() {
        // In mobile portrait, keep the playfield cleanly above the ergonomic thumb deck
        if (isMobileDevice && cssHeight > cssWidth && appMode !== 'replay') {
            return 148;
        }
        return 0;
    }

    function resizeCanvas() {
        cssWidth = Math.max(1, container.clientWidth);
        cssHeight = Math.max(1, container.clientHeight);
        canvasDpr = Math.min(window.devicePixelRatio || 1, 3);
        canvas.width = Math.round(cssWidth * canvasDpr);
        canvas.height = Math.round(cssHeight * canvasDpr);
        canvasWidth = canvas.width;
        canvasHeight = canvas.height;

        if (appMode === 'replay') {
            drawReplayTimelineMarkers();
            renderReplayCurrent();
        } else if (simState && (appMode === 'paused' || appMode === 'gameover')) {
            renderGameFrame(ctx, canvasWidth, canvasHeight, captureRenderFrame(simState), {
                dpr: canvasDpr,
                reserveBottomCss: getReserveBottomCss()
            });
        }
    }

    function renderFighterPicker(visible) {
        if (!fighterPicker) return;
        fighterPicker.style.display = visible ? 'flex' : 'none';
        if (!visible) return;
        var spec = getFighterSpec(selectedFighterId);
        if (fighterCardsWrap) {
            var btns = fighterCardsWrap.querySelectorAll('.fighter-card');
            for (var i = 0; i < btns.length; i++) {
                var fid = btns[i].getAttribute('data-fighter');
                if (fid === spec.id) btns[i].classList.add('selected');
                else btns[i].classList.remove('selected');
            }
        }
        if (fighterSkillDesc) {
            fighterSkillDesc.style.color = spec.accent;
            fighterSkillDesc.style.borderColor = spec.headband;
            fighterSkillDesc.textContent = spec.name + ' — ' + spec.desc;
        }
    }

    function selectFighter(fighterId) {
        var spec = getFighterSpec(fighterId);
        selectedFighterId = spec.id;
        renderFighterPicker(appMode === 'title' || appMode === 'gameover');
        if (appMode === 'title' && simState && simState.player) {
            simState.setup.fighterId = spec.id;
            simState.player.fighterId = spec.id;
        }
    }

    var FIGHTER_ICONS = {
        shadow: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M5 19l11-11-2-2 4-3 1 1-3 4 2 2-11 11H5z"/><circle cx="8" cy="7" r="3" fill="currentColor" opacity="0.55"/></svg>',
        dragon: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 2c2 3 6 5 6 10a6 6 0 1 1-12 0c0-3 2-5 3-7 0 2 1 3 2 3 0-2 0-4 1-6z"/></svg>',
        thunder: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M2 13l10-7 10 7H2zm11 1l-4 7h3l-1 3 5-7h-3l1-3z"/></svg>',
        lotus: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z"/></svg>',
        gale: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M4 17c4-1 7-4 8-11 3 3 7 3 8 6-3 1-5 2-6 5-3 2-6 2-10 0zm9-9l4 1-3 2z"/></svg>'
    };

    function initFighterPickerDom() {
        if (!fighterCardsWrap || typeof FIGHTERS === 'undefined') return;
        fighterCardsWrap.innerHTML = '';
        for (var i = 0; i < FIGHTERS.length; i++) {
            (function (f, idx) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'fighter-card';
                btn.setAttribute('data-fighter', f.id);
                btn.style.setProperty('--fighter-color', f.headband);
                btn.title = (idx + 1) + ': ' + f.name + ' (' + f.desc + ')';
                btn.innerHTML =
                    '<span class="fc-icon">' + (FIGHTER_ICONS[f.id] || '') + '</span>' +
                    '<span class="fc-head">' + (idx + 1) + '. ' + f.shortName + '</span>' +
                    '<span class="fc-tag">' + f.tag + '</span>';
                btn.addEventListener('click', function () {
                    selectFighter(f.id);
                });
                fighterCardsWrap.appendChild(btn);
            })(FIGHTERS[i], i);
        }
    }

    function buildSetup(seed, fighterId) {
        return {
            seed: seed >>> 0,
            viewWidth: WORLD_VIEW_W,
            viewHeight: WORLD_VIEW_H,
            tickRate: SIM_TICK_RATE,
            fighterId: getFighterSpec(fighterId || selectedFighterId).id
        };
    }

    function startDemoLoop(showTitleOverlay) {
        stopAllAudio(audio);
        clearLiveInput(liveInput);
        resetAiState(aiState);

        var demoSeed = (0xD3000001 + demoMatchCounter) >>> 0;
        demoMatchCounter++;

        var setup = buildSetup(demoSeed, selectedFighterId);
        simState = createSimState(setup);
        startInputAi(inputCtrl, setup, aiState, computeAiInput);
        clearReplayBuffer(replayBuf);
        pushReplayFrame(replayBuf, simState);

        resetDeterminismLogger(devLogger, null);
        logDeterminismTick(devLogger, simState, INPUT_NONE);

        closeMenu(false);
        hideReplayBar();

        if (showTitleOverlay) {
            appMode = 'title';
            messageTitle.textContent = 'SHADOW PAGODA';
            messageText.innerHTML =
                'A / D or Arrows: Move &bull; W / Up: Jump (Cancels Attacks)<br>' +
                'Space / J: Strike (Hold: Power Ball &bull; Flip Dir + Strike: 360&deg; Spin)<br>' +
                'Pick your Fighter (1-5) &bull; P: Pause &bull; R: Replay &bull; Esc: Menu';
            renderFighterPicker(true);
            startButton.style.display = 'inline-block';
            startButton.textContent = 'Start Game';
            demoButton.style.display = 'inline-block';
            gameoverReplayBtn.style.display = 'none';
            gameoverSaveBtn.style.display = 'none';
            messageOverlay.style.display = 'flex';
        } else {
            ensureAudioStarted(audio);
            appMode = 'demo';
            renderFighterPicker(false);
            messageOverlay.style.display = 'none';
        }

        updateHudButtons();
        updateDevUi();
        renderGameFrame(ctx, canvasWidth, canvasHeight, captureRenderFrame(simState), {
            dpr: canvasDpr,
            reserveBottomCss: getReserveBottomCss()
        });
        startMainLoop();
    }

    function startNewLiveGame() {
        ensureAudioStarted(audio);
        stopAllAudio(audio);
        clearLiveInput(liveInput);

        var setup = buildSetup(generateRandomSeed());
        simState = createSimState(setup);
        startInputRecording(inputCtrl, setup);
        clearReplayBuffer(replayBuf);
        pushReplayFrame(replayBuf, simState);

        resetDeterminismLogger(devLogger, null);
        logDeterminismTick(devLogger, simState, INPUT_NONE);

        closeMenu(false);
        hideReplayBar();
        messageOverlay.style.display = 'none';
        appMode = 'playing';
        updateHudButtons();
        updateDevUi();

        renderGameFrame(ctx, canvasWidth, canvasHeight, captureRenderFrame(simState), {
            dpr: canvasDpr,
            reserveBottomCss: getReserveBottomCss()
        });
        startMainLoop();
    }

    function startSavedInputPlayback(recording) {
        ensureAudioStarted(audio);
        stopAllAudio(audio);
        clearLiveInput(liveInput);

        simState = createSimState(recording.setup);
        startInputPlayback(inputCtrl, recording);

        clearReplayBuffer(replayBuf);
        pushReplayFrame(replayBuf, simState);

        resetDeterminismLogger(devLogger, recording.devCheckpoints || null);
        logDeterminismTick(devLogger, simState, INPUT_NONE);

        closeMenu(false);
        hideReplayBar();
        messageOverlay.style.display = 'none';
        appMode = 'playing';
        updateHudButtons();
        updateDevUi();

        renderGameFrame(ctx, canvasWidth, canvasHeight, captureRenderFrame(simState), {
            dpr: canvasDpr,
            reserveBottomCss: getReserveBottomCss()
        });
        startMainLoop();
    }

    function enterGameOver() {
        appMode = 'gameover';
        stopAllAudio(audio);
        clearLiveInput(liveInput);

        var suffix = isInputPlaybackMode(inputCtrl) ? ' (INPUT PLAYBACK)' : '';
        messageTitle.textContent = 'DEFEATED';
        messageText.innerHTML =
            'FINAL SCORE: ' + simState.score +
            '<br>FLOOR ' + simState.floor + ' &bull; KOs: ' + simState.enemiesDefeated +
            ' &bull; MAX COMBO: ' + (simState.maxCombo || 0) +
            ' &bull; DEFLECTS: ' + simState.parriesLanded + suffix;
        renderFighterPicker(true);
        startButton.style.display = 'inline-block';
        startButton.textContent = 'Fight Again';
        demoButton.style.display = 'none';
        gameoverReplayBtn.style.display = getReplayLength(replayBuf) > 1 ? 'inline-block' : 'none';
        gameoverSaveBtn.style.display = getCurrentRecording() ? 'inline-block' : 'none';
        messageOverlay.style.display = 'flex';
        updateHudButtons();
        updateDevUi();
    }

    function togglePause() {
        if (menuOpen) return;
        if (appMode === 'playing') {
            appMode = 'paused';
            pauseAudio(audio);
            clearLiveInput(liveInput);
            messageTitle.textContent = 'PAUSED';
            messageText.innerHTML = "Press 'P' to Resume &bull; 'R' for Replay";
            renderFighterPicker(false);
            startButton.style.display = 'none';
            demoButton.style.display = 'none';
            gameoverReplayBtn.style.display = 'none';
            gameoverSaveBtn.style.display = 'none';
            messageOverlay.style.display = 'flex';
        } else if (appMode === 'paused') {
            appMode = 'playing';
            messageOverlay.style.display = 'none';
            resumeAudio(audio);
            lastFrameMs = performance.now();
            accumulatorMs = 0;
        }
        updateHudButtons();
    }

    // ------------------------------------------------------------------------
    // In-Game Replay System Controls
    // ------------------------------------------------------------------------
    function setReplayBarHidden(hidden) {
        replayBarHidden = !!hidden;
        if (replayBarHidden) document.body.classList.add('replay-bar-hidden');
        else document.body.classList.remove('replay-bar-hidden');
        if (appMode === 'replay') {
            if (!replayBarHidden) drawReplayTimelineMarkers();
            renderReplayCurrent();
        }
    }

    function drawReplayTimelineMarkers() {
        if (!replayMarkers) return;
        var count = getReplayLength(replayBuf);
        var w = Math.max(100, replayMarkers.clientWidth || (cssWidth - 32));
        var dpr = canvasDpr || 1;
        replayMarkers.width = Math.round(w * dpr);
        replayMarkers.height = Math.round(7 * dpr);
        var mctx = replayMarkers.getContext('2d');
        mctx.clearRect(0, 0, replayMarkers.width, replayMarkers.height);
        if (count < 2) return;

        // Subtle baseline
        mctx.fillStyle = 'rgba(255, 231, 179, 0.14)';
        mctx.fillRect(0, Math.round(3 * dpr), replayMarkers.width, Math.max(1, Math.round(dpr)));

        var maxIdx = count - 1;
        var tickW = Math.max(2, Math.round(2.5 * dpr));
        for (var i = 0; i < count; i++) {
            var mk = getReplayEntry(replayBuf, i).renderFrame.marker;
            if (!mk) continue;
            var mx = Math.round((i / maxIdx) * (replayMarkers.width - tickW));
            if (mk === 'parry') mctx.fillStyle = '#ffd24c';
            else if (mk === 'ko') mctx.fillStyle = '#e6392e';
            else mctx.fillStyle = '#d966ff';
            mctx.fillRect(mx, 0, tickW, replayMarkers.height);
        }
    }

    function enterReplayMode() {
        if (getReplayLength(replayBuf) < 1) return;
        if (appMode === 'replay') return;

        modeBeforeReplay = (appMode === 'gameover' || appMode === 'demo') ? appMode : 'playing';
        appMode = 'replay';
        pauseAudio(audio);
        clearLiveInput(liveInput);
        messageOverlay.style.display = 'none';

        var maxIdx = getReplayLength(replayBuf) - 1;
        replayCursor = maxIdx;
        replaySpeed = 0.0;
        replayBarHidden = false;

        replayScrubber.min = '0';
        replayScrubber.max = String(maxIdx);
        replayScrubber.step = '0.05';
        replayScrubber.value = String(replayCursor);

        replayBar.style.display = 'flex';
        document.body.classList.add('replay-mode-active');
        document.body.classList.remove('replay-bar-hidden');
        updateReplaySpeedButtons();
        updateHudButtons();
        drawReplayTimelineMarkers();
        renderReplayCurrent();
    }

    function exitReplayMode() {
        if (appMode !== 'replay') return;
        hideReplayBar();

        if (modeBeforeReplay === 'gameover') {
            enterGameOver();
        } else if (modeBeforeReplay === 'demo') {
            appMode = 'demo';
            resumeAudio(audio);
            lastFrameMs = performance.now();
            accumulatorMs = 0;
            updateHudButtons();
        } else {
            appMode = 'playing';
            resumeAudio(audio);
            lastFrameMs = performance.now();
            accumulatorMs = 0;
            updateHudButtons();
        }
    }

    function hideReplayBar() {
        replayBar.style.display = 'none';
        replayBarHidden = false;
        document.body.classList.remove('replay-mode-active');
        document.body.classList.remove('replay-bar-hidden');
    }

    function playFromReplayCursor() {
        if (appMode !== 'replay') return;
        var count = getReplayLength(replayBuf);
        if (count === 0) return;

        var targetIdx = Math.round(replayCursor);
        if (targetIdx < 0) targetIdx = 0;
        if (targetIdx >= count) targetIdx = count - 1;

        var entry = getReplayEntry(replayBuf, targetIdx);
        if (!entry || !entry.simSnapshot) return;

        simState = cloneSimState(entry.simSnapshot);
        truncateReplayAfter(replayBuf, targetIdx);

        if (inputCtrl.mode === 'live' && inputCtrl.recording &&
            simState.tick <= inputCtrl.recording.frames.length) {
            inputCtrl.recording.frames.length = simState.tick;
        } else {
            inputCtrl.mode = 'live';
            inputCtrl.aiState = null;
            inputCtrl.aiDecideFn = null;
            inputCtrl.playback = null;
            inputCtrl.playbackFinished = false;
            inputCtrl.recording = null;
        }

        if (devLogger.enabled) {
            if (simState.tick < devLogger.hashes.length) {
                devLogger.hashes.length = simState.tick + 1;
                devLogger.entries.length = simState.tick + 1;
            }
            devLogger.expectedCheckpoints = null;
            devLogger.firstMismatch = null;
        }

        hideReplayBar();
        clearLiveInput(liveInput);

        if (simState.isGameOver) {
            enterGameOver();
            return;
        }

        appMode = 'playing';
        resumeAudio(audio);
        lastFrameMs = performance.now();
        accumulatorMs = 0;
        updateHudButtons();
        renderGameFrame(ctx, canvasWidth, canvasHeight, captureRenderFrame(simState), {
            dpr: canvasDpr,
            reserveBottomCss: getReserveBottomCss()
        });
    }

    function setReplaySpeed(spd) {
        replaySpeed = spd;
        if (spd !== 0) replayLastSpeed = spd;
        updateReplaySpeedButtons();
    }

    function stepReplaySpeed(dir) {
        var idx = REPLAY_SPEEDS.indexOf(replaySpeed);
        if (idx === -1) idx = 3; // 0 (PAUSE)
        idx = Math.max(0, Math.min(REPLAY_SPEEDS.length - 1, idx + dir));
        setReplaySpeed(REPLAY_SPEEDS[idx]);
        renderReplayCurrent();
    }

    function toggleReplayPlayPause() {
        if (replaySpeed === 0) {
            var target = replayLastSpeed || 1.0;
            // If sitting at the very end and hitting play forward, jump to start!
            var maxIdx = Math.max(0, getReplayLength(replayBuf) - 1);
            if (target > 0 && replayCursor >= maxIdx - 0.1) {
                replayCursor = 0;
                replayScrubber.value = '0';
            }
            setReplaySpeed(target);
        } else {
            setReplaySpeed(0);
        }
        renderReplayCurrent();
    }

    function updateReplaySpeedButtons() {
        if (replayPlayToggle) {
            replayPlayToggle.textContent = (replaySpeed === 0) ? '▶' : '⏸';
        }
        if (replaySpeedLabel) {
            replaySpeedLabel.textContent = (replaySpeed === 0) ? 'PAUSE' : (replaySpeed + 'x');
            if (replaySpeed === 0) replaySpeedLabel.classList.remove('active');
            else replaySpeedLabel.classList.add('active');
        }
    }

    function stepReplayCursor(delta) {
        var maxIdx = Math.max(0, getReplayLength(replayBuf) - 1);
        replaySpeed = 0;
        updateReplaySpeedButtons();
        replayCursor = Math.max(0, Math.min(maxIdx, replayCursor + delta));
        replayScrubber.value = String(replayCursor);
        renderReplayCurrent();
    }

    function renderReplayCurrent() {
        var count = getReplayLength(replayBuf);
        if (count === 0) return;

        var blended = sampleBlendedReplayFrame(replayBuf, replayCursor);
        if (!blended) return;

        var speedLabel = replaySpeed === 0 ? 'PAUSED' : (replaySpeed + 'x');
        var tickStr = blended.tick.toFixed(1);
        var secs = (blended.tick / SIM_TICK_RATE).toFixed(1);

        replayInfoText.textContent = 'T ' + tickStr + ' (' + secs + 's)';

        renderGameFrame(ctx, canvasWidth, canvasHeight, blended, {
            dpr: canvasDpr,
            reserveBottomCss: 0,
            modeBadge: replayBarHidden ? ('REPLAY ' + speedLabel + '  T:' + tickStr) : null,
            badgeColor: '#ffd24c',
            borderColor: 'rgba(255, 210, 76, 0.7)',
            inputMask: blended.inputMask,
            inputBottom: true
        });
    }

    // ------------------------------------------------------------------------
    // Saved Input & Dev Menu
    // ------------------------------------------------------------------------
    function getCurrentRecording() {
        if (inputCtrl.mode === 'playback' && inputCtrl.playback) {
            return inputCtrl.playback;
        }
        return inputCtrl.recording;
    }

    function openMenu() {
        if (menuOpen) return;
        menuOpen = true;
        if (appMode === 'playing' || appMode === 'demo') {
            pauseAudio(audio);
        }
        clearLiveInput(liveInput);
        menuFeedback.textContent = '';
        updateMenuStatus();
        updateDevUi();
        menuModal.style.display = 'flex';
        document.body.classList.add('menu-modal-open');
    }

    function closeMenu(resumePrev) {
        if (!menuOpen) return;
        menuOpen = false;
        menuModal.style.display = 'none';
        document.body.classList.remove('menu-modal-open');
        if (resumePrev && (appMode === 'playing' || appMode === 'demo' || appMode === 'title')) {
            if (appMode === 'playing' || appMode === 'demo') {
                resumeAudio(audio);
            }
            lastFrameMs = performance.now();
            accumulatorMs = 0;
        }
    }

    function updateMenuStatus() {
        if (inputCtrl.mode === 'playback' && inputCtrl.playback) {
            var total = inputCtrl.playback.frames.length;
            var cur = simState ? simState.tick : 0;
            inputStatusText.textContent =
                'Mode: INPUT PLAYBACK | Tick ' + cur + ' / ' + total +
                ' | Seed: ' + inputCtrl.playback.setup.seed;
            stopPlaybackBtn.style.display = 'inline-block';
        } else if (inputCtrl.mode === 'ai' && inputCtrl.recording) {
            inputStatusText.textContent =
                'Mode: AI DEMO LOOP | ' + inputCtrl.recording.frames.length + ' ticks' +
                ' | Seed: ' + inputCtrl.recording.setup.seed;
            stopPlaybackBtn.style.display = 'none';
        } else if (inputCtrl.recording) {
            inputStatusText.textContent =
                'Mode: LIVE RECORDING | ' + inputCtrl.recording.frames.length + ' ticks' +
                ' | Seed: ' + inputCtrl.recording.setup.seed;
            stopPlaybackBtn.style.display = 'none';
        } else {
            inputStatusText.textContent =
                'Mode: LIVE (Branched via Replay — start a new game to record from tick 0)';
            stopPlaybackBtn.style.display = 'none';
        }
        saveInputBtn.disabled = !getCurrentRecording();
    }

    function updateDevUi() {
        if (!devLogger.enabled) {
            devSection.style.display = 'none';
            return;
        }
        devSection.style.display = 'block';
        if (simState) {
            devLiveHash.textContent =
                'Tick: ' + simState.tick +
                ' | Hash: ' + formatHexHash(devLogger.lastHash) +
                ' | RNG: ' + formatHexHash(simState.rng.state);
        } else {
            devLiveHash.textContent = 'No active simulation';
        }
        if (devLogger.firstMismatch) {
            var m = devLogger.firstMismatch;
            devReportBox.className = 'dev-report error';
            devReportBox.textContent =
                'DIVERGENCE AT TICK ' + m.tick + '\n' +
                'Expected: ' + m.expectedHash + '  Actual: ' + m.actualHash + '\n' +
                m.diffs.join('\n');
        }
    }

    function handleSaveInputFile() {
        var rec = getCurrentRecording();
        if (!rec) {
            menuFeedback.textContent = 'No tick-0 input recording available to save.';
            return;
        }
        var checkpoints = null;
        if (devLogger.enabled && devIncludeHashes.checked) {
            checkpoints = exportDevCheckpoints(devLogger, rec.frames.length);
        }
        var json = serializeInputRecording(rec, checkpoints);
        var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        var filename = 'shadow-pagoda-input-' + stamp + '.json';
        downloadTextFile(filename, json);
        menuFeedback.textContent =
            'Saved ' + rec.frames.length + ' ticks' +
            (checkpoints ? ' (with dev state hashes)' : '') + ' to ' + filename;
    }

    function handleLoadInputFile(file) {
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (ev) {
            try {
                var recording = deserializeInputRecording(ev.target.result);
                if (devLogger.enabled) {
                    devReportBox.className = 'dev-report';
                    devReportBox.textContent = recording.devCheckpoints
                        ? 'Loaded file with ' + recording.devCheckpoints.hashes.length + ' dev checkpoints. Playing back...'
                        : 'Loaded file (no embedded checkpoints). Playing back...';
                }
                startSavedInputPlayback(recording);
            } catch (err) {
                menuFeedback.textContent = 'Load failed: ' + err.message;
            }
        };
        reader.readAsText(file);
    }

    function handleFastVerify() {
        if (!devLogger.enabled) return;
        var rec = getCurrentRecording();
        if (!rec || rec.frames.length === 0) {
            devReportBox.className = 'dev-report';
            devReportBox.textContent = 'Play a game or load an input file first.';
            return;
        }
        var res = runFastDeterminismVerify(rec);
        if (res.ok) {
            devReportBox.className = 'dev-report ok';
            devReportBox.textContent =
                'PASS (' + res.compareMode + ')\n' +
                'Verified ' + res.ticksVerified + ' ticks in ' + res.elapsedMs + ' ms\n' +
                'Final Hash: ' + res.finalHash + ' | Score: ' + res.finalScore + ' | Floor: ' + res.finalFloor;
        } else {
            devReportBox.className = 'dev-report error';
            devReportBox.textContent =
                'FAIL (' + res.compareMode + ') AT TICK ' + res.mismatch.tick + '\n' +
                'Expected: ' + res.mismatch.expectedHash + '  Actual: ' + res.mismatch.actualHash + '\n' +
                res.mismatch.diffs.join('\n');
        }
    }

    function handleRunAiIntegrationTest() {
        if (!devLogger.enabled) return;
        var res = runAiIntegrationTest();
        lastAiTestJson = res.jsonText || null;
        var lines = [];
        lines.push((res.ok ? 'SELF-PLAY INTEGRATION TEST: PASS' : 'SELF-PLAY INTEGRATION TEST: FAIL') +
            ' (' + res.ticksRun + ' ticks, score=' + res.score + ', floor=' + res.floor + ', ' + res.elapsedMs + ' ms)');
        for (var i = 0; i < res.checks.length; i++) {
            var c = res.checks[i];
            lines.push('[' + (c.passed ? 'PASS' : 'FAIL') + '] ' + c.name + ' - ' + c.detail);
        }
        devReportBox.className = res.ok ? 'dev-report ok' : 'dev-report error';
        devReportBox.textContent = lines.join('\n');
    }

    function handleDownloadAiTestInput() {
        if (!devLogger.enabled) return;
        if (!lastAiTestJson) {
            var res = runAiIntegrationTest();
            lastAiTestJson = res.jsonText || null;
        }
        if (!lastAiTestJson) return;
        var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        var filename = 'shadow-pagoda-ai-test-input-' + stamp + '.json';
        downloadTextFile(filename, lastAiTestJson);
        menuFeedback.textContent = 'Exported Self-Play AI integration test input to ' + filename;
    }

    function handleDownloadDevLog() {
        if (!devLogger.enabled) return;
        var payload = {
            setup: simState ? simState.setup : null,
            firstMismatch: devLogger.firstMismatch,
            entries: devLogger.entries
        };
        var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        downloadTextFile('shadow-pagoda-devlog-' + stamp + '.json', JSON.stringify(payload, null, 2));
    }

    function updateHudButtons() {
        var canReplay = (getReplayLength(replayBuf) > 1) &&
            (appMode === 'playing' || appMode === 'demo' || appMode === 'paused' || appMode === 'gameover');
        hudReplayBtn.style.display = canReplay ? 'inline-block' : 'none';
    }

    // ------------------------------------------------------------------------
    // Fixed-Timestep Main Loop
    // ------------------------------------------------------------------------
    function startMainLoop() {
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = 0;
        }
        lastFrameMs = performance.now();
        accumulatorMs = 0;
        rafId = requestAnimationFrame(tickFrame);
    }

    function tickFrame(nowMs) {
        rafId = requestAnimationFrame(tickFrame);

        var dtMs = nowMs - lastFrameMs;
        lastFrameMs = nowMs;
        if (dtMs < 0) dtMs = 0;
        if (dtMs > 100) dtMs = 100;

        if (menuOpen) return;

        if (appMode === 'replay') {
            if (replaySpeed !== 0 && !replayDragging) {
                var maxIdx = Math.max(0, getReplayLength(replayBuf) - 1);
                replayCursor += (dtMs / FIXED_STEP_MS) * replaySpeed;
                if (replayCursor <= 0) {
                    replayCursor = 0;
                    if (replaySpeed < 0) setReplaySpeed(0);
                } else if (replayCursor >= maxIdx) {
                    replayCursor = maxIdx;
                    if (replaySpeed > 0) setReplaySpeed(0);
                }
                replayScrubber.value = String(replayCursor);
            }
            renderReplayCurrent();
            return;
        }

        var isSimActive = (appMode === 'playing' || appMode === 'demo' || appMode === 'title');
        if (!isSimActive || !simState) return;

        accumulatorMs += dtMs;
        var stepped = false;
        var lastStepResult = null;

        while (accumulatorMs >= FIXED_STEP_MS && (appMode === 'playing' || appMode === 'demo' || appMode === 'title')) {
            accumulatorMs -= FIXED_STEP_MS;
            var inputMask = getTickInput(inputCtrl, simState.tick, simState);
            lastInputMask = inputMask;

            if (isInputPlaybackMode(inputCtrl) && inputCtrl.playbackFinished) {
                stopAllAudio(audio);
                appMode = 'paused';
                messageTitle.textContent = 'PLAYBACK DONE';
                var extra = '';
                if (devLogger.enabled) {
                    extra = devLogger.firstMismatch
                        ? '<br><span style="color:#f55">DIVERGED AT TICK ' + devLogger.firstMismatch.tick + '</span>'
                        : '<br><span style="color:#7f7">DETERMINISM OK (' + formatHexHash(devLogger.lastHash) + ')</span>';
                }
                messageText.innerHTML = 'SCORE: ' + simState.score + ' &bull; FLOOR ' + simState.floor + extra;
                renderFighterPicker(false);
                startButton.style.display = 'inline-block';
                startButton.textContent = 'New Live Game';
                demoButton.style.display = 'none';
                gameoverReplayBtn.style.display = getReplayLength(replayBuf) > 1 ? 'inline-block' : 'none';
                gameoverSaveBtn.style.display = 'none';
                messageOverlay.style.display = 'flex';
                updateHudButtons();
                break;
            }

            lastStepResult = stepSimulation(simState, inputMask);
            stepped = true;

            pushReplayFrame(replayBuf, simState, inputMask, lastStepResult);

            var mismatch = logDeterminismTick(devLogger, simState, inputMask);
            if (mismatch) {
                stopAllAudio(audio);
                openMenu();
                break;
            }

            if (appMode !== 'title') {
                playSimSoundEvents(audio, lastStepResult);
            }

            if (appMode === 'title' || appMode === 'demo') {
                if (simState.isGameOver || simState.tick >= DEMO_MAX_TICKS) {
                    startDemoLoop(appMode === 'title');
                    return;
                }
            } else if (simState.isGameOver) {
                enterGameOver();
                break;
            }
        }

        if (stepped && simState) {
            var badge = null;
            var badgeColor = '#ffd24c';
            var showButtons = false;
            if (appMode === 'demo') {
                var aiTag = aiState && aiState.lastMode ? (' [' + aiState.lastMode.toUpperCase() + ']') : '';
                badge = 'SELF-PLAY AI' + aiTag + '  (ENTER = PLAY, R = REPLAY, ESC = SAVE INPUT)';
                if (devLogger.enabled) badge += '  ' + formatHexHash(devLogger.lastHash);
                showButtons = true;
            } else if (appMode === 'title') {
                badge = 'SELF-PLAY ATTRACT (AI)';
                badgeColor = 'rgba(255, 231, 179, 0.75)';
                showButtons = true;
            } else if (isInputPlaybackMode(inputCtrl) && inputCtrl.playback) {
                badge = 'SAVED INPUT PLAYBACK ' + simState.tick + ' / ' + inputCtrl.playback.frames.length;
                if (devLogger.enabled) badge += '  ' + formatHexHash(devLogger.lastHash);
                badgeColor = '#7fff7f';
                showButtons = true;
            } else if (devLogger.enabled) {
                badge = 'DEV  T:' + simState.tick + '  ' + formatHexHash(devLogger.lastHash);
                badgeColor = '#ffe7b3';
            }

            renderGameFrame(ctx, canvasWidth, canvasHeight, captureRenderFrame(simState), {
                dpr: canvasDpr,
                reserveBottomCss: getReserveBottomCss(),
                modeBadge: badge,
                badgeColor: badgeColor,
                inputMask: showButtons ? lastInputMask : undefined
            });
            updateHudButtons();
        }
    }

    function bindTouchButton(elementId, inputName) {
        var btn = document.getElementById(elementId);
        if (!btn) return;

        btn.addEventListener('touchstart', function (e) {
            e.preventDefault();
            ensureAudioStarted(audio);
            liveInputTouchButton(liveInput, inputName, true);
            btn.classList.add('active');
        }, { passive: false });

        var release = function (e) {
            e.preventDefault();
            liveInputTouchButton(liveInput, inputName, false);
            btn.classList.remove('active');
        };
        btn.addEventListener('touchend', release, { passive: false });
        btn.addEventListener('touchcancel', release, { passive: false });
    }

    function init() {
        isMobileDevice = ('ontouchstart' in window) ||
            (navigator.maxTouchPoints > 0) ||
            (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        window.addEventListener('orientationchange', function () {
            setTimeout(resizeCanvas, 120);
        });
        window.addEventListener('blur', function () {
            clearLiveInput(liveInput);
            stopAllAudio(audio);
        });
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) {
                clearLiveInput(liveInput);
                stopAllAudio(audio);
                if (appMode === 'playing' && !menuOpen) togglePause();
            } else {
                lastFrameMs = performance.now();
                accumulatorMs = 0;
            }
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                if (menuOpen) closeMenu(true);
                else openMenu();
                return;
            }
            if (menuOpen) return;

            var lower = e.key.toLowerCase();
            if (lower === 'r' && !e.repeat) {
                if (appMode === 'replay') exitReplayMode();
                else if (appMode === 'playing' || appMode === 'demo' || appMode === 'paused' || appMode === 'gameover') {
                    enterReplayMode();
                }
                return;
            }
            if ((appMode === 'title' || appMode === 'gameover') && !e.repeat &&
                e.key >= '1' && e.key <= '5' && typeof FIGHTERS !== 'undefined') {
                var fIdx = parseInt(e.key, 10) - 1;
                if (FIGHTERS[fIdx]) {
                    selectFighter(FIGHTERS[fIdx].id);
                    return;
                }
            }
            if ((appMode === 'demo' || appMode === 'title') && e.key === 'Enter' && !e.repeat) {
                e.preventDefault();
                startNewLiveGame();
                return;
            }
            if (lower === 'p' && !e.repeat && (appMode === 'playing' || appMode === 'paused')) {
                togglePause();
                return;
            }
            if (appMode === 'replay') {
                if (lower === 'h' && !e.repeat) {
                    e.preventDefault();
                    setReplayBarHidden(!replayBarHidden);
                } else if (e.code === 'Space' && !e.repeat) {
                    e.preventDefault();
                    toggleReplayPlayPause();
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    stepReplayCursor(e.shiftKey ? -0.25 : -1);
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    stepReplayCursor(e.shiftKey ? 0.25 : 1);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    playFromReplayCursor();
                }
                return;
            }

            if (e.code === 'Space' || e.key === 'ArrowUp' || e.key === 'ArrowDown' ||
                e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
            }
            liveInputKeyDown(liveInput, e.key, e.code, e.repeat);
        });

        document.addEventListener('keyup', function (e) {
            liveInputKeyUp(liveInput, e.key, e.code);
        });

        if (isMobileDevice) {
            document.body.classList.add('mobile-controls-visible');
            bindTouchButton('btn-left', 'left');
            bindTouchButton('btn-right', 'right');
            bindTouchButton('btn-jump', 'jump');
            bindTouchButton('btn-attack', 'attack');
        }

        startButton.addEventListener('click', startNewLiveGame);
        demoButton.addEventListener('click', function () { startDemoLoop(false); });
        gameoverReplayBtn.addEventListener('click', enterReplayMode);
        gameoverSaveBtn.addEventListener('click', handleSaveInputFile);

        hudReplayBtn.addEventListener('click', enterReplayMode);
        hudMenuBtn.addEventListener('click', function () {
            if (menuOpen) closeMenu(true);
            else openMenu();
        });

        menuCloseBtn.addEventListener('click', function () { closeMenu(true); });
        saveInputBtn.addEventListener('click', handleSaveInputFile);
        loadInputBtn.addEventListener('click', function () {
            loadInputFile.value = '';
            loadInputFile.click();
        });
        loadInputFile.addEventListener('change', function (e) {
            if (e.target.files && e.target.files[0]) handleLoadInputFile(e.target.files[0]);
        });
        menuDemoBtn.addEventListener('click', function () { startDemoLoop(false); });
        stopPlaybackBtn.addEventListener('click', startNewLiveGame);

        devFastVerifyBtn.addEventListener('click', handleFastVerify);
        devAiTestBtn.addEventListener('click', handleRunAiIntegrationTest);
        if (devAiDownloadBtn) devAiDownloadBtn.addEventListener('click', handleDownloadAiTestInput);
        devDownloadLogBtn.addEventListener('click', handleDownloadDevLog);

        replayScrubber.addEventListener('pointerdown', function () { replayDragging = true; });
        window.addEventListener('pointerup', function () { replayDragging = false; });
        window.addEventListener('pointercancel', function () { replayDragging = false; });
        replayScrubber.addEventListener('input', function () {
            replayCursor = parseFloat(replayScrubber.value);
            renderReplayCurrent();
        });

        replayPlayToggle.addEventListener('click', toggleReplayPlayPause);
        replaySpeedDown.addEventListener('click', function () { stepReplaySpeed(-1); });
        replaySpeedUp.addEventListener('click', function () { stepReplaySpeed(1); });
        replaySpeedLabel.addEventListener('click', function () {
            setReplaySpeed(replaySpeed === 1 ? 0 : 1);
            renderReplayCurrent();
        });
        replayHideBtn.addEventListener('click', function () { setReplayBarHidden(true); });
        replayShowPill.addEventListener('click', function () { setReplayBarHidden(false); });

        replayStepBackBtn.addEventListener('click', function () { stepReplayCursor(-1); });
        replayStepSubBack.addEventListener('click', function () { stepReplayCursor(-0.25); });
        replayStepSubFwd.addEventListener('click', function () { stepReplayCursor(0.25); });
        replayStepFwdBtn.addEventListener('click', function () { stepReplayCursor(1); });
        replayPlayHereBtn.addEventListener('click', playFromReplayCursor);
        replayExitBtn.addEventListener('click', exitReplayMode);

        if (devLogger.enabled) {
            hudMenuBtn.textContent = 'MENU [DEV]';
        }
        initFighterPickerDom();
        startDemoLoop(true);
    }

    init();
})();
