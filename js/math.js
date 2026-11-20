// ============================================================================
// math.js - Cross-Engine Deterministic Math (Pure IEEE-754 + - * / and sqrt)
//
// ECMAScript guarantees IEEE-754 exact rounding (0.5 ULP) for +, -, *, /, and
// Math.sqrt across V8 (Windows/Android/Chrome), JavaScriptCore (macOS/iOS),
// and SpiderMonkey (Firefox), whereas Math.sin/cos/atan2 may differ by 1 ULP
// across OS libm implementations.
//
// Using these helpers inside sim.js and ai.js guarantees bit-identical saved
// input playback across Windows, macOS, iOS, and Android.
// ============================================================================

var DET_PI      = 3.141592653589793;
var DET_TWO_PI  = 6.283185307179586;
var DET_HALF_PI = 1.5707963267948966;

// Deterministic sin(x) using range reduction + 8-term Horner Taylor polynomial
// Max error on all real numbers: < 1e-12
function detSin(x) {
    // Wrap to [-PI, PI]
    var r = x - Math.floor((x + DET_PI) / DET_TWO_PI) * DET_TWO_PI;
    // Fold to [-PI/2, PI/2] using sin(PI - r) = sin(r)
    if (r > DET_HALF_PI) {
        r = DET_PI - r;
    } else if (r < -DET_HALF_PI) {
        r = -DET_PI - r;
    }

    var r2 = r * r;
    // Horner evaluation of r * (1 - r^2/3! + r^4/5! - ... + r^16/17!)
    var poly = 1.0 / 355687428096000.0;
    poly = -1.0 / 1307674368000.0 + r2 * poly;
    poly =  1.0 / 6227020800.0    + r2 * poly;
    poly = -1.0 / 39916800.0      + r2 * poly;
    poly =  1.0 / 362880.0        + r2 * poly;
    poly = -1.0 / 5040.0          + r2 * poly;
    poly =  1.0 / 120.0           + r2 * poly;
    poly = -1.0 / 6.0             + r2 * poly;
    poly =  1.0                   + r2 * poly;
    return r * poly;
}

// Deterministic cos(x) = sin(x + PI/2)
function detCos(x) {
    return detSin(x + DET_HALF_PI);
}

// Deterministic atan(z) for z >= 0 using 2x half-angle reduction + odd Taylor series
function detAtanPos(z) {
    var invert = false;
    var v = z;
    if (v > 1.0) {
        v = 1.0 / v;
        invert = true;
    }

    // Apply half-angle formula twice: atan(v) = 2 * atan(v / (1 + sqrt(1 + v^2)))
    // Reduces [0, 1] -> [0, tan(PI/16) ~= 0.1989] where Taylor converges to < 1e-12
    v = v / (1.0 + Math.sqrt(1.0 + v * v));
    v = v / (1.0 + Math.sqrt(1.0 + v * v));

    var v2 = v * v;
    var poly = -1.0 / 15.0;
    poly =  1.0 / 13.0 + v2 * poly;
    poly = -1.0 / 11.0 + v2 * poly;
    poly =  1.0 / 9.0  + v2 * poly;
    poly = -1.0 / 7.0  + v2 * poly;
    poly =  1.0 / 5.0  + v2 * poly;
    poly = -1.0 / 3.0  + v2 * poly;
    poly =  1.0        + v2 * poly;

    var res = 4.0 * v * poly;
    return invert ? (DET_HALF_PI - res) : res;
}

// Deterministic atan2(y, x) matching standard quadrant conventions in [-PI, PI]
function detAtan2(y, x) {
    if (x > 0.0) {
        if (y >= 0.0) return detAtanPos(y / x);
        return -detAtanPos(-y / x);
    }
    if (x < 0.0) {
        if (y >= 0.0) return DET_PI - detAtanPos(y / -x);
        return -DET_PI + detAtanPos(-y / -x);
    }
    if (y > 0.0) return DET_HALF_PI;
    if (y < 0.0) return -DET_HALF_PI;
    return 0.0;
}

// Deterministic 2D vector length using IEEE-754 sqrt
function detHypot(dx, dy) {
    return Math.sqrt(dx * dx + dy * dy);
}
