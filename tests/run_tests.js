// ============================================================================
// tests/run_tests.js - Zero-Dependency Node.js CLI Test Runner
//
// Uses only Node built-ins (fs, path, vm). Runs on Linux, macOS, and Windows:
//   node tests/run_tests.js
// ============================================================================

'use strict';

var fs   = require('fs');
var path = require('path');
var vm   = require('vm');

var repoRoot = path.resolve(__dirname, '..');
var jsDir    = path.join(repoRoot, 'js');

// 1. Syntax-check every JS file in js/ and tests/
var allJsFiles = [
    'js/math.js',
    'js/rng.js',
    'js/input.js',
    'js/sim.js',
    'js/ai.js',
    'js/replay.js',
    'js/debug.js',
    'js/audio.js',
    'js/render.js',
    'js/main.js',
    'tests/suite.js'
];

var syntaxErrors = 0;
for (var i = 0; i < allJsFiles.length; i++) {
    var rel = allJsFiles[i];
    var full = path.join(repoRoot, rel);
    try {
        var src = fs.readFileSync(full, 'utf8');
        new vm.Script(src, { filename: rel });
    } catch (err) {
        syntaxErrors++;
        console.error('[SYNTAX FAIL] ' + rel + ': ' + err.message);
    }
}

if (syntaxErrors > 0) {
    console.error('Failed with ' + syntaxErrors + ' syntax error(s).');
    process.exit(1);
}
console.log('[PASS] Syntax check (' + allJsFiles.length + ' JS files)');

// 2. Load headless game modules + shared test suite into a clean VM context
var sandbox = vm.createContext({
    console: console,
    Math: Math,
    Float64Array: Float64Array,
    Uint32Array: Uint32Array,
    Date: Date,
    Array: Array,
    Object: Object,
    JSON: JSON,
    Error: Error,
    Number: Number,
    String: String,
    performance: (typeof performance !== 'undefined') ? performance : { now: function () { return Date.now(); } },
    URLSearchParams: function () { this.get = function (k) { return k === 'dev' ? '1' : null; }; },
    window: { location: { search: '?dev=1' } }
});

var loadOrder = [
    'js/math.js',
    'js/rng.js',
    'js/input.js',
    'js/sim.js',
    'js/ai.js',
    'js/replay.js',
    'js/debug.js',
    'js/render.js',
    'tests/suite.js'
];

for (var j = 0; j < loadOrder.length; j++) {
    var file = loadOrder[j];
    var code = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
}

// 3. Execute shared test suite
var report = sandbox.runSharedTestSuite();

for (var k = 0; k < report.results.length; k++) {
    var r = report.results[k];
    var tag = r.passed ? '[PASS]' : '[FAIL]';
    console.log(tag + ' ' + r.name + ' (' + r.ms + ' ms) - ' + r.detail);
}

console.log('------------------------------------------------------------');
console.log('Platform:    ' + process.platform + ' ' + process.arch + ' | Node ' + process.version);
console.log('Fingerprint: ' + report.fingerprint);
console.log('Summary:     ' + report.passed + ' / ' + report.total + ' passed');

if (!report.ok) {
    process.exit(1);
}
