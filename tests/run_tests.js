// ============================================================================
// tests/run_tests.js - Zero-Dependency Node.js CLI Test Runner (All Games)
//
// Uses only Node built-ins (fs, path, vm). Runs on Linux, macOS, and Windows:
//   node tests/run_tests.js
// ============================================================================

'use strict';

var fs   = require('fs');
var path = require('path');
var vm   = require('vm');

var repoRoot = path.resolve(__dirname, '..');

// 1. Syntax-check every JS file across shared/, vector-fury/, kung-fu/, tests/
var allJsFiles = [
    'shared/math.js',
    'shared/rng.js',
    'vector-fury/js/input.js',
    'vector-fury/js/sim.js',
    'vector-fury/js/ai.js',
    'vector-fury/js/replay.js',
    'vector-fury/js/debug.js',
    'vector-fury/js/audio.js',
    'vector-fury/js/render.js',
    'vector-fury/js/main.js',
    'kung-fu/js/input.js',
    'kung-fu/js/sim.js',
    'kung-fu/js/ai.js',
    'kung-fu/js/replay.js',
    'kung-fu/js/debug.js',
    'kung-fu/js/audio.js',
    'kung-fu/js/render.js',
    'kung-fu/js/main.js',
    'tests/vector_fury_suite.js',
    'tests/kung_fu_suite.js'
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

function createCleanSandbox() {
    return vm.createContext({
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
}

function runSuite(title, loadOrder, entryFnName) {
    console.log('\n=== ' + title + ' ===');
    var sandbox = createCleanSandbox();
    for (var j = 0; j < loadOrder.length; j++) {
        var file = loadOrder[j];
        var code = fs.readFileSync(path.join(repoRoot, file), 'utf8');
        vm.runInContext(code, sandbox, { filename: file });
    }

    var report = sandbox[entryFnName]();
    for (var k = 0; k < report.results.length; k++) {
        var r = report.results[k];
        var tag = r.passed ? '[PASS]' : '[FAIL]';
        console.log(tag + ' ' + r.name + ' (' + r.ms + ' ms) - ' + r.detail);
    }
    console.log('Fingerprint: ' + report.fingerprint);
    console.log('Subtotal:    ' + report.passed + ' / ' + report.total + ' passed');
    return report;
}

var vfReport = runSuite('VECTOR FURY', [
    'shared/math.js',
    'shared/rng.js',
    'vector-fury/js/input.js',
    'vector-fury/js/sim.js',
    'vector-fury/js/ai.js',
    'vector-fury/js/replay.js',
    'vector-fury/js/debug.js',
    'vector-fury/js/render.js',
    'tests/vector_fury_suite.js'
], 'runSharedTestSuite');

var kfReport = runSuite('SHADOW PAGODA (KUNG FU)', [
    'shared/math.js',
    'shared/rng.js',
    'kung-fu/js/input.js',
    'kung-fu/js/sim.js',
    'kung-fu/js/ai.js',
    'kung-fu/js/replay.js',
    'kung-fu/js/debug.js',
    'kung-fu/js/render.js',
    'tests/kung_fu_suite.js'
], 'runKungFuTestSuite');

var totalPassed = vfReport.passed + kfReport.passed;
var totalCount = vfReport.total + kfReport.total;

console.log('\n------------------------------------------------------------');
console.log('Platform: ' + process.platform + ' ' + process.arch + ' | Node ' + process.version);
console.log('Summary:  ' + totalPassed + ' / ' + totalCount + ' passed across 2 games');

if (!vfReport.ok || !kfReport.ok) {
    process.exit(1);
}
