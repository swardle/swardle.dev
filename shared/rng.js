// ============================================================================
// rng.js - Deterministic 32-bit PRNG (Mulberry32)
// Pure integer math using Math.imul and unsigned 32-bit shifts so results are
// identical across browsers, CPUs, and runs for a given seed.
// ============================================================================

function createRng(seed) {
    var s = (seed >>> 0);
    if (s === 0) {
        s = 0x12345678;
    }
    return { state: s };
}

function cloneRng(rng) {
    return { state: (rng.state >>> 0) };
}

function rngNextUint32(rng) {
    rng.state = (rng.state + 0x6D2B79F5) >>> 0;
    var t = rng.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0);
}

// Returns a deterministic float in [0, 1)
function rngNextFloat(rng) {
    return rngNextUint32(rng) / 4294967296.0;
}

// Returns a deterministic float in [min, max)
function rngRange(rng, min, max) {
    return min + rngNextFloat(rng) * (max - min);
}

// Returns a deterministic integer in [min, maxExclusive)
function rngInt(rng, min, maxExclusive) {
    var span = maxExclusive - min;
    if (span <= 0) return min;
    return min + (rngNextUint32(rng) % span);
}

// Only called once when starting a brand-new live game (never inside sim)
function generateRandomSeed() {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        var arr = new Uint32Array(1);
        crypto.getRandomValues(arr);
        return (arr[0] >>> 0) || 0x12345678;
    }
    return ((Date.now() ^ 0x9E3779B9) >>> 0) || 0x12345678;
}
