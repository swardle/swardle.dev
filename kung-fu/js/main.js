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
    var replayScrubber    = document.getElementById('replay-scrubber');
    var replayInfoText    = document.getElementById('replay-info-text');
    var replaySpeedBtns   = document.querySelectorAll('.replay-speed-btn');
    var replayStepBackBtn = document.getElementById('replay-step-back');
    var replayStepSubBack = document.getElementById('replay-step-sub-back');
    var replayStepSubFwd  = document.getElementById('replay-step-sub-fwd');
    var replayStepFwdBtn  = document.getElementById('replay-step-fwd');
    var replayPlayHereBtn = document.getElementById('replay-play-here-btn');
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
    var menuOpen        = false;
    var modeBeforeReplay = 'playing';

    var DEMO_MAX_TICKS   = 3600;
    var demoMatchCounter = 0;

    var rafId           = 0;
    var lastFrameMs     = 0;
    var accumulatorMs   = 0;
    var FIXED_STEP_MS   = 1000.0 / SIM_TICK_RATE;

    var replayCursor    = 0.0;
    var replaySpeed     = 0.0;
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
            renderReplayCurrent();
        } else if (simState && (appMode === 'paused' || appMode === 'gameover')) {
            renderGameFrame(ctx, canvasWidth, canvasHeight, captureRenderFrame(simState), {
                dpr: canvasDpr,
                reserveBottomCss: getReserveBottomCss()
            });
        }
    }

    function buildSetup(seed) {
        return {
            seed: seed >>> 0,
            viewWidth: WORLD_VIEW_W,
            viewHeight: WORLD_VIEW_H,
            tickRate: SIM_TICK_RATE
        };
    }

    function startDemoLoop(showTitleOverlay) {
        stopAllAudio(audio);
        clearLiveInput(liveInput);
        resetAiState(aiState);

        var demoSeed = (0xD3000001 + demoMatchCounter) >>> 0;
        demoMatchCounter++;

        var setup = buildSetup(demoSeed);
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
                'A / D or Arrows: Move &bull; W / Up: Jump<br>' +
                'Space / J: Strike (3-Hit Combo &amp; Jump Kick) &bull; Shift / K: Block &amp; Parry<br>' +
                'P: Pause &bull; R: Replay &bull; Esc: Menu';
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
            ' &bull; PARRIES: ' + simState.parriesLanded + suffix;
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

        replayScrubber.min = '0';
        replayScrubber.max = String(maxIdx);
        replayScrubber.step = '0.05';
        replayScrubber.value = String(replayCursor);

        replayBar.style.display = 'flex';
        document.body.classList.add('replay-mode-active');
        updateReplaySpeedButtons();
        updateHudButtons();
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
        document.body.classList.remove('replay-mode-active');
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
        updateReplaySpeedButtons();
    }

    function updateReplaySpeedButtons() {
        for (var i = 0; i < replaySpeedBtns.length; i++) {
            var btn = replaySpeedBtns[i];
            var val = parseFloat(btn.getAttribute('data-speed'));
            if (Math.abs(val - replaySpeed) < 1e-6) btn.classList.add('active');
            else btn.classList.remove('active');
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
        var tickStr = blended.tick.toFixed(2);
        var secs = (blended.tick / SIM_TICK_RATE).toFixed(2);

        replayInfoText.textContent = 'TICK ' + tickStr + ' (' + secs + 's) | ' + speedLabel;

        renderGameFrame(ctx, canvasWidth, canvasHeight, blended, {
            dpr: canvasDpr,
            reserveBottomCss: 0,
            modeBadge: 'REPLAY ' + speedLabel + '  TICK ' + tickStr,
            badgeColor: '#ffd24c',
            borderColor: 'rgba(255, 210, 76, 0.8)'
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

            pushReplayFrame(replayBuf, simState);

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
                if (e.code === 'Space' && !e.repeat) {
                    e.preventDefault();
                    setReplaySpeed(replaySpeed === 0 ? 1.0 : 0.0);
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
            liveInputKeyUp(liveInput, e.key);
        });

        if (isMobileDevice) {
            document.body.classList.add('mobile-controls-visible');
            bindTouchButton('btn-left', 'left');
            bindTouchButton('btn-right', 'right');
            bindTouchButton('btn-jump', 'jump');
            bindTouchButton('btn-block', 'block');
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

        for (var i = 0; i < replaySpeedBtns.length; i++) {
            replaySpeedBtns[i].addEventListener('click', function (e) {
                setReplaySpeed(parseFloat(e.currentTarget.getAttribute('data-speed')));
                renderReplayCurrent();
            });
        }

        replayStepBackBtn.addEventListener('click', function () { stepReplayCursor(-1); });
        replayStepSubBack.addEventListener('click', function () { stepReplayCursor(-0.25); });
        replayStepSubFwd.addEventListener('click', function () { stepReplayCursor(0.25); });
        replayStepFwdBtn.addEventListener('click', function () { stepReplayCursor(1); });
        replayPlayHereBtn.addEventListener('click', playFromReplayCursor);
        replayExitBtn.addEventListener('click', exitReplayMode);

        if (devLogger.enabled) {
            hudMenuBtn.textContent = 'MENU [DEV]';
        }
        startDemoLoop(true);
    }

    init();
})();
