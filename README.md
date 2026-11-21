# swardle.dev

Zero-build-step cross-platform HTML5 arcade running on **iOS, Android, Windows, and macOS**, featuring deterministic 60 Hz simulations, RLE Saved Input playback, and 60-second In-Game Replay with slow-motion scrubbing and "Play From Here".

## Games

- **Arcade Hub Menu**: `index.html`
- **Vector Fury** (`vector-fury/`): Retro neon space arena shooter with ricocheting shots and hunter waves.
- **Shadow Pagoda** (`kung-fu/`): Sumi-e ink-brush side-scrolling Kung Fu beat-'em-up with 3-hit combos, jump kicks, Perfect Parries, knife deflections, temple traps, and floor bosses.

## Shared Code

Only the small deterministic math & PRNG utilities live in `shared/` (`shared/math.js`, `shared/rng.js`). Each game keeps its own independent simulation, input, replay, renderer, audio, and UI code.

## Running Tests

- **CLI (Node.js)**: `node tests/run_tests.js`
- **Browser**: Open `vector-fury/tests.html` or `kung-fu/tests.html`
- **Dev Determinism Mode**: Append `?dev=1` to any game URL to enable live FNV-1a tick hashing and fast verification.
