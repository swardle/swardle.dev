// ============================================================================
// kung-fu/js/input.js - Separated Input System for Shadow Pagoda
//
// Simulation never reads DOM events directly. Each 60Hz tick consumes a single
// 5-bit integer bitmask from the InputController, which either samples live
// hardware inputs (keyboard/touch), drives the AI fighter, or replays a saved
// input recording deterministically across iOS, Android, Windows, and macOS.
// ============================================================================

var INPUT_NONE   = 0;
var INPUT_LEFT   = 1 << 0; // 1
var INPUT_RIGHT  = 1 << 1; // 2
var INPUT_JUMP   = 1 << 2; // 4
var INPUT_ATTACK = 1 << 3; // 8
var INPUT_BLOCK  = 1 << 4; // 16

var INPUT_FILE_FORMAT  = 'shadow-pagoda-input';
var INPUT_FILE_VERSION = 1;

// ----------------------------------------------------------------------------
// Live Hardware Input Collector (Keyboard + Multi-Touch)
// ----------------------------------------------------------------------------
function createLiveInput() {
    return {
        left: false,
        right: false,
        block: false,
        jumpLatch: false,
        attackLatch: false,
        keysDown: {}
    };
}

function clearLiveInput(live) {
    live.left = false;
    live.right = false;
    live.block = false;
    live.jumpLatch = false;
    live.attackLatch = false;
    live.keysDown = {};
}

function updateLiveHeldFlags(live) {
    var k = live.keysDown;
    live.left  = !!(k['arrowleft']  || k['a'] || k['touch_left']);
    live.right = !!(k['arrowright'] || k['d'] || k['touch_right']);
    live.block = !!(k['shift'] || k['k'] || k['x'] || k['s'] || k['arrowdown'] || k['touch_block']);
}

function liveInputKeyDown(live, key, code, isRepeat) {
    var lower = key.toLowerCase();
    live.keysDown[lower] = true;
    updateLiveHeldFlags(live);

    // Edge-triggered jump & attack so OS key-repeat never alters simulation
    if (!isRepeat) {
        if (lower === 'arrowup' || lower === 'w') {
            live.jumpLatch = true;
        }
        if (code === 'Space' || lower === 'j' || lower === 'z') {
            live.attackLatch = true;
        }
    }
}

function liveInputKeyUp(live, key) {
    var lower = key.toLowerCase();
    live.keysDown[lower] = false;
    updateLiveHeldFlags(live);
}

function liveInputTouchButton(live, name, isPressed) {
    if (name === 'jump') {
        if (isPressed) live.jumpLatch = true;
        return;
    }
    if (name === 'attack') {
        if (isPressed) live.attackLatch = true;
        return;
    }
    live.keysDown['touch_' + name] = !!isPressed;
    updateLiveHeldFlags(live);
}

// Samples one tick's bitmask from live hardware and clears edge latches
function sampleLiveInput(live) {
    var mask = INPUT_NONE;
    if (live.left)        mask |= INPUT_LEFT;
    if (live.right)       mask |= INPUT_RIGHT;
    if (live.jumpLatch)   mask |= INPUT_JUMP;
    if (live.attackLatch) mask |= INPUT_ATTACK;
    if (live.block)       mask |= INPUT_BLOCK;
    live.jumpLatch = false;
    live.attackLatch = false;
    return mask;
}

// ----------------------------------------------------------------------------
// Input Recording Data Structure
// ----------------------------------------------------------------------------
function createInputRecording(setup) {
    return {
        format: INPUT_FILE_FORMAT,
        version: INPUT_FILE_VERSION,
        setup: {
            seed: (setup.seed >>> 0),
            viewWidth: Math.round(setup.viewWidth || 800),
            viewHeight: Math.round(setup.viewHeight || 450),
            tickRate: setup.tickRate || 60
        },
        frames: [],
        devCheckpoints: null
    };
}

// ----------------------------------------------------------------------------
// Input Controller (Live Recording, AI Demo, & Deterministic Playback)
// ----------------------------------------------------------------------------
function createInputController(liveInput) {
    return {
        mode: 'live', // 'live', 'ai', or 'playback'
        live: liveInput,
        aiState: null,
        aiDecideFn: null,
        recording: null,
        playback: null,
        playbackFinished: false
    };
}

function startInputRecording(controller, setup) {
    controller.mode = 'live';
    controller.aiState = null;
    controller.aiDecideFn = null;
    controller.recording = createInputRecording(setup);
    controller.playback = null;
    controller.playbackFinished = false;
}

function startInputAi(controller, setup, aiState, aiDecideFn) {
    controller.mode = 'ai';
    controller.aiState = aiState;
    controller.aiDecideFn = aiDecideFn;
    controller.recording = createInputRecording(setup);
    controller.playback = null;
    controller.playbackFinished = false;
}

function startInputPlayback(controller, recording) {
    controller.mode = 'playback';
    controller.aiState = null;
    controller.aiDecideFn = null;
    controller.playback = recording;
    controller.playbackFinished = false;
}

function isInputPlaybackMode(controller) {
    return controller.mode === 'playback';
}

function isInputAiMode(controller) {
    return controller.mode === 'ai';
}

function getTickInput(controller, tick, simState) {
    if (controller.mode === 'playback') {
        if (!controller.playback || tick >= controller.playback.frames.length) {
            controller.playbackFinished = true;
            return INPUT_NONE;
        }
        return controller.playback.frames[tick];
    }

    var mask;
    if (controller.mode === 'ai' && controller.aiDecideFn) {
        mask = controller.aiDecideFn(controller.aiState, simState);
    } else {
        mask = sampleLiveInput(controller.live);
    }

    if (controller.recording) {
        controller.recording.frames.push(mask);
    }
    return mask;
}

// ----------------------------------------------------------------------------
// Run-Length Encoding Serialization for Compact JSON Input Files
// ----------------------------------------------------------------------------
function encodeFramesRLE(frames) {
    var rle = [];
    var n = frames.length;
    if (n === 0) return rle;

    var current = frames[0];
    var count = 1;
    for (var i = 1; i < n; i++) {
        if (frames[i] === current) {
            count++;
        } else {
            rle.push([current, count]);
            current = frames[i];
            count = 1;
        }
    }
    rle.push([current, count]);
    return rle;
}

function decodeFramesRLE(rle) {
    var frames = [];
    for (var i = 0; i < rle.length; i++) {
        var pair = rle[i];
        var mask = pair[0] | 0;
        var count = pair[1] | 0;
        for (var c = 0; c < count; c++) {
            frames.push(mask);
        }
    }
    return frames;
}

function serializeInputRecording(recording, devCheckpoints) {
    var payload = {
        format: INPUT_FILE_FORMAT,
        version: INPUT_FILE_VERSION,
        setup: {
            seed: (recording.setup.seed >>> 0),
            viewWidth: recording.setup.viewWidth,
            viewHeight: recording.setup.viewHeight,
            tickRate: recording.setup.tickRate
        },
        totalTicks: recording.frames.length,
        rleFrames: encodeFramesRLE(recording.frames)
    };

    if (devCheckpoints) {
        payload.devCheckpoints = devCheckpoints;
    }

    return JSON.stringify(payload, null, 2);
}

function deserializeInputRecording(jsonText) {
    var data = JSON.parse(jsonText);
    if (!data || data.format !== INPUT_FILE_FORMAT) {
        throw new Error('Invalid input file format (expected ' + INPUT_FILE_FORMAT + ').');
    }
    if (data.version !== INPUT_FILE_VERSION) {
        throw new Error('Unsupported input file version: ' + data.version);
    }
    if (!data.setup || typeof data.setup.seed !== 'number') {
        throw new Error('Input file is missing required setup fields (seed).');
    }

    var frames;
    if (Array.isArray(data.rleFrames)) {
        frames = decodeFramesRLE(data.rleFrames);
    } else if (Array.isArray(data.frames)) {
        frames = data.frames.slice();
    } else {
        throw new Error('Input file is missing frame data.');
    }

    var rec = createInputRecording(data.setup);
    rec.frames = frames;
    if (data.devCheckpoints) {
        rec.devCheckpoints = data.devCheckpoints;
    }
    return rec;
}

function downloadTextFile(filename, text) {
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
