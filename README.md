# swardle.dev

Zero-build-step cross-platform HTML5 arcade running on **iOS, Android, Windows, and macOS**, featuring deterministic 60 Hz simulations, RLE Saved Input playback, and 60-second In-Game Replay with slow-motion scrubbing and "Play From Here".

## Games

- **Arcade Hub Menu**: `index.html`
- **Vector Fury** (`vector-fury/`): Retro neon space arena shooter with ricocheting shots and hunter waves.
- **Shadow Pagoda** (`kung-fu/`): Sumi-e ink-brush side-scrolling Kung Fu beat-'em-up with 3-hit combos, jump kicks, Perfect Parries, knife deflections, temple traps, and floor bosses.

## Shared Code

Only the small deterministic math & PRNG utilities live in `shared/` (`shared/math.js`, `shared/rng.js`). Each game keeps its own independent simulation, input, replay, renderer, audio, and UI code.

## Running Tests

All test suites are zero-dependency (no `npm install` or build step required) and share identical deterministic test logic across Node.js and browsers.

### 1. CLI Test Suite (All Games)

Runs syntax checks across all 20 JS files plus the full **Vector Fury** and **Shadow Pagoda** test suites (deterministic math/PRNG, combat & physics, RLE input round-trips, replay ring buffer & Play-From-Here restore, determinism logger divergence detection, 2400-tick AI integration tests against locked golden hashes, 5-seed self-play bug hunt, and responsive viewport math):

```bash
node tests/run_tests.js
```

### 2. Browser Test Runners (Shared Suite + Live DOM/UI Tests)

Each game has an in-browser test page that runs its full shared suite, prints the **Cross-Engine Determinism Fingerprint** (for comparing Chrome/Firefox/Safari across Windows, macOS, iOS, and Android), and executes browser-only DOM tests (HiDPI canvas sizing, `?dev=1` boot check, and mobile touch/replay UI layout).

Start any local static server from the repo root (recommended over `file://` so the iframe DOM tests can inspect the game frame):

```bash
python3 -m http.server 8000
```

Then open:

- **Vector Fury**: `http://localhost:8000/vector-fury/tests.html` (or live at `https://swardle.dev/vector-fury/tests.html`)
- **Shadow Pagoda (Kung Fu)**: `http://localhost:8000/kung-fu/tests.html` (or live at `https://swardle.dev/kung-fu/tests.html`)

### 3. In-Game Dev Determinism & AI Tools (`?dev=1`)

Append `?dev=1` to either game URL (e.g. `http://localhost:8000/kung-fu/?dev=1` or `http://localhost:8000/vector-fury/?dev=1`) and press **`Esc`** (or click **`MENU [DEV]`**) to access:

- Live per-tick FNV-1a simulation state hashing
- **Fast Verify Determinism** (re-simulates recorded inputs and pinpoints any divergent tick)
- **Run AI Integration Test** & **Save AI Test Input**
- **Download Debug Log**

### 4. Continuous Integration (GitHub Actions)

`.github/workflows/test.yml` automatically runs `node tests/run_tests.js` across `ubuntu-latest`, `macos-latest`, and `windows-latest` on every push and pull request to `main`.
