// ============================================================================
// main.js - Game Loop, UI Wiring, Saved Input Menu, & In-Game Replay Controls
// ============================================================================

(function () {
    // --- DOM Elements ---
    var container       = document.getElementById('game-container');
    var canvas          = document.getElementById('gameCanvas');
    var ctx             = canvas.getContext('2d');

    var messageOverlay  = document.getElementById('message-overlay');
    var messageTitle    = document.getElementById('message-title');
    var messageText     = document.getElementById('message-text');
    var startButton     = document.getElementById('start-button');
    var demoButton      = document.getElementById('demo-button');
    var gameoverReplayBtn = document.getElementById('gameover-replay-btn');
    var gameoverSaveBtn   = document.getElementById('gameover-save-btn');

    // Top-right utility HUD buttons
    var hudReplayBtn    = document.getElementById('hud-replay-btn');
    var hudMenuBtn      = document.getElementById('hud-menu-btn');

    // Menu modal (Saved Input + Dev Determinism)
    var menuModal         = document.getElementById('menu-modal');
    var menuCloseBtn      = document.getElementById('menu-close-btn');
    var inputStatusText   = document.getElementById('input-status-text');
    var saveInputBtn      = document.getElementById('save-input-btn');
    var loadInputBtn      = document.getElementById('load-input-btn');
    var loadInputFile     = document.getElementById('load-input-file');
    var menuDemoBtn       = document.getElementById('menu-demo-btn');
    var stopPlaybackBtn   = document.getElementById('stop-playback-btn');
    var menuFeedback      = document.getElementById('menu-feedback');

    // Dev-only determinism UI (shown ONLY when DEV_MODE is true)
    var devSection        = document.getElementById('dev-section');
    var devLiveHash       = document.getElementById('dev-live-hash');
    var devIncludeHashes  = document.getElementById('dev-include-hashes');
    var devFastVerifyBtn  = document.getElementById('dev-fast-verify-btn');
    var devAiTestBtn      = document.getElementById('dev-ai-test-btn');
    var devDownloadLogBtn = document.getElementById('dev-download-log-btn');
    var devReportBox      = document.getElementById('dev-report-box');

    // In-Game Replay Bar
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

    // --- Core Subsystems ---
    var audio       = createAudioSystem();
    var liveInput   = createLiveInput();
    var inputCtrl   = createInputController(liveInput);
    var aiState     = createAiState();
    var replayBuf   = createReplayBuffer(REPLAY_MAX_FRAMES);
    var devLogger   = createDeterminismLogger();

    // --- Application State ---
    var simState        = null;
    var lastInputMask   = INPUT_NONE;
    var cssWidth        = 800;
    var cssHeight       = 600;
    var canvasWidth     = 800;
    var canvasHeight    = 600;
    var canvasDpr       = 1;
    var appMode         = 'title'; // 'title' (attract demo), 'demo', 'playing', 'paused', 'gameover', 'replay'
    var menuOpen        = false;
    var modeBeforeMenu  = 'title';
    var modeBeforeReplay = 'playing';

    // Demo loop state
    var DEMO_MAX_TICKS   = 3600; // 60 seconds per demo match before looping
    var demoMatchCounter = 0;

    // Fixed-timestep loop state
    var rafId           = 0;
    var lastFrameMs     = 0;
    var accumulatorMs   = 0;
    var FIXED_STEP_MS   = 1000.0 / SIM_TICK_RATE;

    // Replay viewer state (completely separate from input playback!)
    var REPLAY_SPEEDS   = [-2, -1, -0.25, 0, 0.25, 0.5, 1, 2];
    var replayCursor    = 0.0; // float index into replayBuf [0 .. count-1]
    var replaySpeed     = 0.0; // 0 = paused, 0.25, 0.5, 1, 2, -0.25, -1, -2
    var replayLastSpeed = 1.0;
    var replayBarHidden = false;
    var replayDragging  = false;

    // ------------------------------------------------------------------------
    // Canvas Sizing (HiDPI-aware for Retina macOS/iOS/Android displays)
    // ------------------------------------------------------------------------
    function resizeCanvas() {
        cssWidth = Math.max(1, container.clientWidth);
        cssHeight = Math.max(1, container.clientHeight);
        canvasDpr = Math.min(window.devicePixelRatio || 1, 3);
        canvas.width = Math.round(cssWidth * canvasDpr);
        canvas.height = Math.round(cssHeight * canvasDpr);
        canvasWidth = canvas.width;
        canvasHeight = canvas.height;

        // Redraw static view if paused/replay/gameover
        if (appMode === 'replay') {
            drawReplayTimelineMarkers();
            renderReplayCurrent();
        } else if (simState && (appMode === 'paused' || appMode === 'gameover')) {
            renderGameFrame(ctx, canvasWidth, canvasHeight, captureRenderFrame(simState, null), { clearHard: true, dpr: canvasDpr });
        }
    }

    // ------------------------------------------------------------------------
    // Starting Live Games, AI Demo Loop, & Input Playback
    // ------------------------------------------------------------------------
    function startDemoLoop(showTitleOverlay) {
        stopAllAudio(audio);
        clearLiveInput(liveInput);
        resetAiState(aiState);

        var demoSeed = (0xD3000001 + demoMatchCounter) >>> 0;
        demoMatchCounter++;

        var setup = {
            seed: demoSeed,
            worldWidth: Math.max(320, Math.round(cssWidth)),
            worldHeight: Math.max(240, Math.round(cssHeight)),
            tickRate: SIM_TICK_RATE
        };

        simState = createSimState(setup);
        startInputAi(inputCtrl, setup, aiState, computeAiInput);
        clearReplayBuffer(replayBuf);
        pushReplayFrame(replayBuf, simState, null);

        resetDeterminismLogger(devLogger, null);
        logDeterminismTick(devLogger, simState, INPUT_NONE);

        closeMenu(false);
        hideReplayBar();

        if (showTitleOverlay) {
            appMode = 'title';
            messageTitle.textContent = 'VECTOR FURY';
            messageText.innerHTML = 'Arrow Keys / WASD to Move &bull; Space to Shoot<br>P to Pause &bull; R for Replay &bull; Esc for Menu';
            startButton.style.display = 'inline-block';
            startButton.textContent = 'Start Game';
            demoButton.style.display = 'inline-block';
            gameoverReplayBtn.style.display = 'none';
            gameoverSaveBtn.style.display = 'none';
            messageOverlay.style.display = 'flex';
        } else {
            ensureAudioStarted(audio);
            appMode = 'demo';
            messageOverlay.style.display = 'none';
        }

        updateHudButtons();
        updateDevUi();
        renderGameFrame(ctx, canvasWidth, canvasHeight, captureRenderFrame(simState, null), { clearHard: true });
        startMainLoop();
    }

    function startNewLiveGame() {
        ensureAudioStarted(audio);
        stopAllAudio(audio);
        clearLiveInput(liveInput);

        var setup = {
            seed: generateRandomSeed(),
            worldWidth: Math.max(320, Math.round(cssWidth)),
            worldHeight: Math.max(240, Math.round(cssHeight)),
            tickRate: SIM_TICK_RATE
        };

        simState = createSimState(setup);
        startInputRecording(inputCtrl, setup);
        clearReplayBuffer(replayBuf);
        pushReplayFrame(replayBuf, simState, null);

        resetDeterminismLogger(devLogger, null);
        logDeterminismTick(devLogger, simState, INPUT_NONE);

        closeMenu(false);
        hideReplayBar();
        messageOverlay.style.display = 'none';
        appMode = 'playing';
        updateHudButtons();
        updateDevUi();

        renderGameFrame(ctx, canvasWidth, canvasHeight, captureRenderFrame(simState, null), { clearHard: true });
        startMainLoop();
    }

    function startSavedInputPlayback(recording) {
        ensureAudioStarted(audio);
        stopAllAudio(audio);
        clearLiveInput(liveInput);

        simState = createSimState(recording.setup);
        startInputPlayback(inputCtrl, recording);

        // Replay ring buffer still records output during playback if user wants to inspect bounces
        clearReplayBuffer(replayBuf);
        pushReplayFrame(replayBuf, simState, null);

        resetDeterminismLogger(devLogger, recording.devCheckpoints || null);
        logDeterminismTick(devLogger, simState, INPUT_NONE);

        closeMenu(false);
        hideReplayBar();
        messageOverlay.style.display = 'none';
        appMode = 'playing';
        updateHudButtons();
        updateDevUi();

        renderGameFrame(ctx, canvasWidth, canvasHeight, captureRenderFrame(simState, null), { clearHard: true });
        startMainLoop();
    }

    function enterGameOver() {
        appMode = 'gameover';
        stopAllAudio(audio);
        clearLiveInput(liveInput);

        var suffix = isInputPlaybackMode(inputCtrl) ? ' (INPUT PLAYBACK)' : '';
        messageTitle.textContent = 'GAME OVER';
        messageText.innerHTML =
            'FINAL SCORE: ' + simState.score +
            '<br>YOU REACHED LEVEL ' + simState.level + suffix;
        startButton.style.display = 'inline-block';
        startButton.textContent = 'Play Again';
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

        mctx.fillStyle = 'rgba(255, 0, 255, 0.16)';
        mctx.fillRect(0, Math.round(3 * dpr), replayMarkers.width, Math.max(1, Math.round(dpr)));

        var maxIdx = count - 1;
        var tickW = Math.max(2, Math.round(2.5 * dpr));
        for (var i = 0; i < count; i++) {
            var mk = getReplayEntry(replayBuf, i).renderFrame.marker;
            if (!mk) continue;
            var mx = Math.round((i / maxIdx) * (replayMarkers.width - tickW));
            if (mk === 'level') mctx.fillStyle = '#ff0';
            else if (mk === 'damage') mctx.fillStyle = '#f33';
            else mctx.fillStyle = '#f0f';
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
        replaySpeed = 0.0; // Start paused on current frame so player can scrub or pick speed
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

    // Restore exact simulation state from the scrubbed replay frame and play live from there!
    function playFromReplayCursor() {
        if (appMode !== 'replay') return;
        var count = getReplayLength(replayBuf);
        if (count === 0) return;

        var targetIdx = Math.round(replayCursor);
        if (targetIdx < 0) targetIdx = 0;
        if (targetIdx >= count) targetIdx = count - 1;

        var entry = getReplayEntry(replayBuf, targetIdx);
        if (!entry || !entry.simSnapshot) return;

        // Restore full simulation snapshot
        simState = cloneSimState(entry.simSnapshot);

        // Truncate replay ring buffer after this branch point
        truncateReplayAfter(replayBuf, targetIdx);

        // Replay & Saved Input are separate systems: if user branches during live
        // play, switch to live mode cleanly (and if we're within the current live
        // recording's timeline, keep it consistent by truncating its future ticks).
        if (inputCtrl.mode === 'live' && inputCtrl.recording &&
            simState.tick <= inputCtrl.recording.frames.length) {
            inputCtrl.recording.frames.length = simState.tick;
        } else {
            // Branched out of a playback, AI demo, or older timeline: live controls take over
            inputCtrl.mode = 'live';
            inputCtrl.aiState = null;
            inputCtrl.aiDecideFn = null;
            inputCtrl.playback = null;
            inputCtrl.playbackFinished = false;
            inputCtrl.recording = null; // Not a full tick-0 recording anymore
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
        renderGameFrame(ctx, canvasWidth, canvasHeight, captureRenderFrame(simState, null), { clearHard: true });
    }

    function setReplaySpeed(spd) {
        replaySpeed = spd;
        if (spd !== 0) replayLastSpeed = spd;
        updateReplaySpeedButtons();
    }

    function stepReplaySpeed(dir) {
        var idx = REPLAY_SPEEDS.indexOf(replaySpeed);
        if (idx === -1) idx = 3;
        idx = Math.max(0, Math.min(REPLAY_SPEEDS.length - 1, idx + dir));
        setReplaySpeed(REPLAY_SPEEDS[idx]);
        renderReplayCurrent();
    }

    function toggleReplayPlayPause() {
        if (replaySpeed === 0) {
            var target = replayLastSpeed || 1.0;
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
            clearHard: true,
            dpr: canvasDpr,
            modeBadge: replayBarHidden ? ('REPLAY ' + speedLabel + '  T:' + tickStr) : null,
            badgeColor: '#f0f',
            borderColor: 'rgba(255, 0, 255, 0.7)',
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
        modeBeforeMenu = appMode;
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
            var st = inputCtrl.playback.setup;
            inputStatusText.textContent =
                'Mode: INPUT PLAYBACK | Tick ' + cur + ' / ' + total +
                ' | Arena: ' + st.worldWidth + 'x' + st.worldHeight +
                ' | Seed: ' + st.seed;
            stopPlaybackBtn.style.display = 'inline-block';
        } else if (inputCtrl.mode === 'ai' && inputCtrl.recording) {
            var aiRec = inputCtrl.recording;
            inputStatusText.textContent =
                'Mode: AI DEMO LOOP | ' + aiRec.frames.length + ' ticks' +
                ' | Arena: ' + aiRec.setup.worldWidth + 'x' + aiRec.setup.worldHeight +
                ' | Seed: ' + aiRec.setup.seed;
            stopPlaybackBtn.style.display = 'none';
        } else if (inputCtrl.recording) {
            var rec = inputCtrl.recording;
            inputStatusText.textContent =
                'Mode: LIVE RECORDING | ' + rec.frames.length + ' ticks' +
                ' | Arena: ' + rec.setup.worldWidth + 'x' + rec.setup.worldHeight +
                ' | Seed: ' + rec.setup.seed;
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
        var filename = 'vector-fury-input-' + stamp + '.json';
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
                        ? 'Loaded file with ' + recording.devCheckpoints.hashes.length + ' dev checkpoints. Playing back & verifying live...'
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
                'Final Hash: ' + res.finalHash + ' | Score: ' + res.finalScore + ' | Level: ' + res.finalLevel;
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
        var lines = [];
        lines.push((res.ok ? 'INTEGRATION TEST: PASS' : 'INTEGRATION TEST: FAIL') +
            ' (' + res.ticksRun + ' ticks, score=' + res.score + ', lvl=' + res.level + ', ' + res.elapsedMs + ' ms)');
        for (var i = 0; i < res.checks.length; i++) {
            var c = res.checks[i];
            lines.push('[' + (c.passed ? 'PASS' : 'FAIL') + '] ' + c.name + ' - ' + c.detail);
        }
        devReportBox.className = res.ok ? 'dev-report ok' : 'dev-report error';
        devReportBox.textContent = lines.join('\n');
        if (typeof console !== 'undefined' && console.log) {
            console.log(lines.join('\n'));
        }
    }

    function handleDownloadDevLog() {
        if (!devLogger.enabled) return;
        var payload = {
            setup: simState ? simState.setup : null,
            firstMismatch: devLogger.firstMismatch,
            entries: devLogger.entries
        };
        var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        downloadTextFile('vector-fury-devlog-' + stamp + '.json', JSON.stringify(payload, null, 2));
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
        // Clamp huge dt (e.g. tab switch) so simulation doesn't spiral
        if (dtMs < 0) dtMs = 0;
        if (dtMs > 100) dtMs = 100;

        if (menuOpen) {
            return;
        }

        if (appMode === 'replay') {
            if (replaySpeed !== 0 && !replayDragging) {
                var maxIdx = Math.max(0, getReplayLength(replayBuf) - 1);
                var deltaFrames = (dtMs / FIXED_STEP_MS) * replaySpeed;
                replayCursor += deltaFrames;
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
        if (!isSimActive || !simState) {
            return;
        }

        accumulatorMs += dtMs;
        var stepped = false;
        var lastStepResult = null;

        while (accumulatorMs >= FIXED_STEP_MS && (appMode === 'playing' || appMode === 'demo' || appMode === 'title')) {
            accumulatorMs -= FIXED_STEP_MS;

            var inputMask = getTickInput(inputCtrl, simState.tick, simState);
            lastInputMask = inputMask;

            // Stop cleanly if saved input playback reached end of file
            if (isInputPlaybackMode(inputCtrl) && inputCtrl.playbackFinished) {
                stopAllAudio(audio);
                appMode = 'paused';
                messageTitle.textContent = 'PLAYBACK DONE';
                var extra = '';
                if (devLogger.enabled) {
                    extra = devLogger.firstMismatch
                        ? '<br><span style="color:#f44">DIVERGED AT TICK ' + devLogger.firstMismatch.tick + '</span>'
                        : '<br><span style="color:#0f0">DETERMINISM OK (' + formatHexHash(devLogger.lastHash) + ')</span>';
                }
                messageText.innerHTML =
                    'SCORE: ' + simState.score + ' &bull; LEVEL: ' + simState.level + extra;
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

            // Record output keyframe into Replay ring buffer (separate from input!)
            pushReplayFrame(replayBuf, simState, lastStepResult, inputMask);

            // Dev-only determinism logging & live divergence check
            var mismatch = logDeterminismTick(devLogger, simState, inputMask);
            if (mismatch) {
                stopAllAudio(audio);
                openMenu();
                break;
            }

            // Play decoupled sound effects (silent during title attract background)
            if (appMode !== 'title') {
                playSimSoundEvents(audio, lastStepResult);
            }

            // Demo loop auto-restarts on Game Over or after DEMO_MAX_TICKS
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
            var badgeColor = '#ff0';
            if (appMode === 'demo') {
                badge = 'AI DEMO LOOP  (ENTER = PLAY, R = REPLAY)';
                if (devLogger.enabled) {
                    badge += '  ' + formatHexHash(devLogger.lastHash);
                }
                badgeColor = '#ff0';
            } else if (appMode === 'title') {
                badge = 'ATTRACT DEMO (AI)';
                badgeColor = 'rgba(0, 255, 255, 0.7)';
            } else if (isInputPlaybackMode(inputCtrl) && inputCtrl.playback) {
                badge = 'PLAYBACK ' + simState.tick + ' / ' + inputCtrl.playback.frames.length;
                if (devLogger.enabled) {
                    badge += '  ' + formatHexHash(devLogger.lastHash);
                }
                badgeColor = '#0f0';
            } else if (devLogger.enabled) {
                badge = 'DEV  T:' + simState.tick + '  ' + formatHexHash(devLogger.lastHash);
                badgeColor = '#0ff';
            }

            var showButtons = (appMode === 'demo' || appMode === 'title' || isInputPlaybackMode(inputCtrl));
            renderGameFrame(
                ctx, canvasWidth, canvasHeight,
                captureRenderFrame(simState, lastStepResult, lastInputMask),
                {
                    clearHard: false,
                    dpr: canvasDpr,
                    modeBadge: badge,
                    badgeColor: badgeColor,
                    inputMask: showButtons ? lastInputMask : undefined
                }
            );
            updateHudButtons();
        }
    }

    // ------------------------------------------------------------------------
    // Event Listeners & Setup
    // ------------------------------------------------------------------------
    function init() {
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        window.addEventListener('blur', function () {
            clearLiveInput(liveInput);
            stopAllAudio(audio);
        });
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) {
                clearLiveInput(liveInput);
                stopAllAudio(audio);
                if (appMode === 'playing' && !menuOpen) {
                    togglePause();
                }
            } else {
                lastFrameMs = performance.now();
                accumulatorMs = 0;
            }
        });

        // Keyboard listeners (raw hardware state only — simulation never mutated here!)
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                if (menuOpen) closeMenu(true);
                else openMenu();
                return;
            }

            if (menuOpen) return;

            var lower = e.key.toLowerCase();
            if (lower === 'r' && !e.repeat) {
                if (appMode === 'replay') {
                    exitReplayMode();
                } else if (appMode === 'playing' || appMode === 'demo' || appMode === 'paused' || appMode === 'gameover') {
                    enterReplayMode();
                }
                return;
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

            if (e.code === 'Space' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
            }
            liveInputKeyDown(liveInput, e.key, e.code, e.repeat);
        });

        document.addEventListener('keyup', function (e) {
            liveInputKeyUp(liveInput, e.key);
        });

        // Mobile controls setup (including touchcancel to prevent stuck buttons)
        var isMobile = ('ontouchstart' in window) ||
            (navigator.maxTouchPoints > 0) ||
            window.matchMedia('(pointer: coarse)').matches;

        if (isMobile) {
            document.body.classList.add('mobile-controls-visible');
            bindTouchButton('btn-left', 'left');
            bindTouchButton('btn-right', 'right');
            bindTouchButton('btn-thrust', 'thrust');
            bindTouchButton('btn-shoot', 'shoot');
        }

        // Overlay buttons
        startButton.addEventListener('click', startNewLiveGame);
        demoButton.addEventListener('click', function () { startDemoLoop(false); });
        gameoverReplayBtn.addEventListener('click', enterReplayMode);
        gameoverSaveBtn.addEventListener('click', handleSaveInputFile);

        // Top HUD buttons
        hudReplayBtn.addEventListener('click', enterReplayMode);
        hudMenuBtn.addEventListener('click', function () {
            if (menuOpen) closeMenu(true);
            else openMenu();
        });

        // Menu buttons
        menuCloseBtn.addEventListener('click', function () { closeMenu(true); });
        saveInputBtn.addEventListener('click', handleSaveInputFile);
        loadInputBtn.addEventListener('click', function () {
            loadInputFile.value = '';
            loadInputFile.click();
        });
        loadInputFile.addEventListener('change', function (e) {
            if (e.target.files && e.target.files[0]) {
                handleLoadInputFile(e.target.files[0]);
            }
        });
        menuDemoBtn.addEventListener('click', function () { startDemoLoop(false); });
        stopPlaybackBtn.addEventListener('click', startNewLiveGame);

        // Dev-only buttons
        devFastVerifyBtn.addEventListener('click', handleFastVerify);
        devAiTestBtn.addEventListener('click', handleRunAiIntegrationTest);
        devDownloadLogBtn.addEventListener('click', handleDownloadDevLog);

        // Replay bar controls
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

        // Initial UI state — launch arcade attract AI demo loop behind the title screen!
        if (devLogger.enabled) {
            hudMenuBtn.textContent = 'MENU [DEV]';
        }
        startDemoLoop(true);
    }

    function bindTouchButton(elementId, inputName) {
        var btn = document.getElementById(elementId);
        if (!btn) return;

        btn.addEventListener('touchstart', function (e) {
            e.preventDefault();
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

    init();
})();
