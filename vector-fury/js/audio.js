// ============================================================================
// audio.js - Tone.js Sound Layer (Decoupled from Simulation)
// Fixes the original thrust NoiseSynth allocation leak by reusing one synth.
// ============================================================================

function createAudioSystem() {
    var available = (typeof Tone !== 'undefined');
    if (!available) {
        return { available: false, started: false, muted: false, thrustActive: false };
    }

    var shootSynth = new Tone.Synth({
        oscillator: { type: 'square' },
        envelope: { attack: 0.005, decay: 0.1, sustain: 0.05, release: 0.1 }
    }).toDestination();
    shootSynth.volume.value = -15;

    var explosionSynth = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.005, decay: 0.2, sustain: 0 }
    }).toDestination();
    explosionSynth.volume.value = -10;

    var deathSynth = new Tone.NoiseSynth({
        noise: { type: 'brown' },
        envelope: { attack: 0.01, decay: 0.5, sustain: 0.1, release: 0.5 }
    }).toDestination();
    deathSynth.volume.value = -5;

    // Single reusable synth for thrust (fixes original per-tick WebAudio leak!)
    var thrustSynth = new Tone.NoiseSynth({
        noise: { type: 'pink' },
        envelope: { attack: 0.01, decay: 0.08, sustain: 0 }
    }).toDestination();
    thrustSynth.volume.value = -25;

    var thrustLoop = new Tone.Loop(function (time) {
        thrustSynth.triggerAttackRelease('16n', time);
    }, '16n');

    var levelUpSynth = new Tone.PolySynth(Tone.Synth).toDestination();
    levelUpSynth.volume.value = -12;

    return {
        available: true,
        started: false,
        muted: false,
        thrustActive: false,
        shootSynth: shootSynth,
        explosionSynth: explosionSynth,
        deathSynth: deathSynth,
        thrustLoop: thrustLoop,
        levelUpSynth: levelUpSynth
    };
}

function ensureAudioStarted(audio) {
    if (!audio || !audio.available || audio.started) return;
    audio.started = true;
    try {
        Tone.start();
        Tone.Transport.start();
    } catch (e) {
        // Ignore autoplay errors until user gesture
    }
}

function stopAllAudio(audio) {
    if (!audio || !audio.available) return;
    if (audio.thrustActive) {
        try { audio.thrustLoop.stop(); } catch (e) {}
        audio.thrustActive = false;
    }
}

function pauseAudio(audio) {
    stopAllAudio(audio);
    if (!audio || !audio.available) return;
    try { Tone.Transport.pause(); } catch (e) {}
}

function resumeAudio(audio) {
    if (!audio || !audio.available || !audio.started) return;
    try { Tone.Transport.start(); } catch (e) {}
}

function playSimSoundEvents(audio, stepResult) {
    if (!audio || !audio.available || !audio.started || audio.muted || !stepResult) {
        return;
    }

    if (stepResult.isThrusting && !audio.thrustActive) {
        try { audio.thrustLoop.start(0); } catch (e) {}
        audio.thrustActive = true;
    } else if (!stepResult.isThrusting && audio.thrustActive) {
        try { audio.thrustLoop.stop(); } catch (e) {}
        audio.thrustActive = false;
    }

    var events = stepResult.soundEvents;
    if (!events || events.length === 0) return;

    var now = Tone.now();
    for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        try {
            if (ev === 'shoot') {
                audio.shootSynth.triggerAttackRelease('C5', '16n', now + i * 0.001);
            } else if (ev === 'explosion') {
                audio.explosionSynth.triggerAttackRelease('8n', now + i * 0.001);
            } else if (ev === 'explosion_small') {
                audio.explosionSynth.triggerAttackRelease('16n', now + i * 0.001, 0.5);
            } else if (ev === 'player_death') {
                audio.deathSynth.triggerAttackRelease('8n', now + i * 0.001);
            } else if (ev === 'level_up') {
                audio.levelUpSynth.triggerAttackRelease(['C4', 'E4', 'G4', 'C5'], 0.4, now + i * 0.001);
            }
        } catch (e) {
            // Tone.js timing guard
        }
    }
}
