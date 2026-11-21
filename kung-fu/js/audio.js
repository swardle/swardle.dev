// ============================================================================
// kung-fu/js/audio.js - Tone.js Martial Arts & Temple Percussion Audio Layer
// Completely decoupled from simulation; reuses synths with zero per-tick leaks.
// ============================================================================

function createAudioSystem() {
    var available = (typeof Tone !== 'undefined');
    if (!available) {
        return { available: false, started: false, muted: false };
    }

    var swingSynth = new Tone.NoiseSynth({
        noise: { type: 'pink' },
        envelope: { attack: 0.004, decay: 0.09, sustain: 0 }
    }).toDestination();
    swingSynth.volume.value = -18;

    var hitSynth = new Tone.MembraneSynth({
        pitchDecay: 0.04,
        octaves: 4,
        envelope: { attack: 0.002, decay: 0.14, sustain: 0, release: 0.05 }
    }).toDestination();
    hitSynth.volume.value = -8;

    var parrySynth = new Tone.MetalSynth({
        frequency: 420,
        envelope: { attack: 0.001, decay: 0.28, release: 0.15 },
        harmonicity: 5.1,
        modulationIndex: 18,
        resonance: 2400,
        octaves: 1.4
    }).toDestination();
    parrySynth.volume.value = -11;

    var blockSynth = new Tone.Synth({
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.002, decay: 0.07, sustain: 0, release: 0.04 }
    }).toDestination();
    blockSynth.volume.value = -14;

    var gongSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.01, decay: 0.45, sustain: 0.05, release: 0.4 }
    }).toDestination();
    gongSynth.volume.value = -12;

    return {
        available: true,
        started: false,
        muted: false,
        swingSynth: swingSynth,
        hitSynth: hitSynth,
        parrySynth: parrySynth,
        blockSynth: blockSynth,
        gongSynth: gongSynth
    };
}

function ensureAudioStarted(audio) {
    if (!audio || !audio.available || audio.started) return;
    audio.started = true;
    try {
        Tone.start();
        Tone.Transport.start();
    } catch (e) {}
}

function stopAllAudio(audio) {
    if (!audio || !audio.available) return;
    try {
        if (audio.gongSynth) audio.gongSynth.releaseAll();
    } catch (e) {}
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
    var events = stepResult.soundEvents;
    if (!events || events.length === 0) return;

    var now = Tone.now();
    for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        var t = now + i * 0.004;
        try {
            if (ev === 'swing' || ev === 'enemy_swing' || ev === 'throw') {
                audio.swingSynth.triggerAttackRelease('32n', t);
            } else if (ev === 'heavy_swing') {
                audio.swingSynth.triggerAttackRelease('16n', t);
            } else if (ev === 'jump') {
                audio.blockSynth.triggerAttackRelease('D4', '32n', t);
            } else if (ev === 'hit') {
                audio.hitSynth.triggerAttackRelease('C2', '16n', t);
            } else if (ev === 'heavy_hit' || ev === 'player_hit') {
                audio.hitSynth.triggerAttackRelease('G1', '8n', t);
            } else if (ev === 'parry') {
                audio.parrySynth.triggerAttackRelease('16n', t);
                audio.gongSynth.triggerAttackRelease(['A4', 'E5'], 0.18, t);
            } else if (ev === 'block') {
                audio.blockSynth.triggerAttackRelease('G3', '32n', t);
            } else if (ev === 'ko') {
                audio.hitSynth.triggerAttackRelease('F1', '8n', t);
                audio.gongSynth.triggerAttackRelease(['D3', 'A3'], 0.25, t);
            } else if (ev === 'boss_warn') {
                audio.hitSynth.triggerAttackRelease('C1', '4n', t);
                audio.gongSynth.triggerAttackRelease(['D2', 'A2', 'D3'], 0.55, t);
            } else if (ev === 'boss_ko' || ev === 'floor_up') {
                // Japanese Yo pentatonic flourish
                audio.gongSynth.triggerAttackRelease(['D4', 'E4', 'G4', 'A4', 'D5'], 0.45, t);
            } else if (ev === 'wave_clear') {
                audio.gongSynth.triggerAttackRelease(['G4', 'A4', 'D5'], 0.22, t);
            } else if (ev === 'charge_start') {
                audio.blockSynth.triggerAttackRelease('C4', '32n', t);
            } else if (ev === 'charge_ready') {
                audio.gongSynth.triggerAttackRelease(['E5', 'B5'], 0.14, t);
            } else if (ev === 'charge_max') {
                audio.gongSynth.triggerAttackRelease(['A5', 'D6', 'E6'], 0.22, t);
            } else if (ev === 'fireball') {
                audio.swingSynth.triggerAttackRelease('8n', t);
                audio.hitSynth.triggerAttackRelease('E2', '16n', t);
                audio.blockSynth.triggerAttackRelease('A4', '16n', t);
            } else if (ev === 'super_fireball') {
                audio.swingSynth.triggerAttackRelease('4n', t);
                audio.hitSynth.triggerAttackRelease('C2', '8n', t);
                audio.gongSynth.triggerAttackRelease(['D4', 'A4', 'D5', 'A5'], 0.35, t);
            } else if (ev === 'spin') {
                audio.swingSynth.triggerAttackRelease('16n', t);
                audio.blockSynth.triggerAttackRelease('E4', '32n', t);
                audio.blockSynth.triggerAttackRelease('A4', '32n', t + 0.05);
            } else if (ev === 'powerup_tier1') {
                audio.gongSynth.triggerAttackRelease(['D4', 'A4', 'D5'], 0.25, t);
            } else if (ev === 'powerup_tier2') {
                audio.gongSynth.triggerAttackRelease(['D4', 'G4', 'A4', 'D5', 'E5'], 0.38, t);
            } else if (ev === 'zap') {
                audio.parrySynth.triggerAttackRelease('32n', t);
                audio.blockSynth.triggerAttackRelease('C6', '64n', t);
            } else if (ev === 'dash') {
                audio.swingSynth.triggerAttackRelease('16n', t);
                audio.blockSynth.triggerAttackRelease('G5', '32n', t);
            } else if (ev === 'meteor') {
                audio.hitSynth.triggerAttackRelease('E1', '8n', t);
                audio.gongSynth.triggerAttackRelease(['D3', 'A3', 'D4'], 0.28, t);
            } else if (ev === 'flame') {
                audio.swingSynth.triggerAttackRelease('8n', t);
                audio.hitSynth.triggerAttackRelease('A1', '16n', t);
            } else if (ev === 'splash') {
                audio.swingSynth.triggerAttackRelease('16n', t);
                audio.blockSynth.triggerAttackRelease('E5', '32n', t);
            } else if (ev === 'player_ko') {
                audio.hitSynth.triggerAttackRelease('C1', '2n', t);
                audio.gongSynth.triggerAttackRelease(['D2', 'F2', 'A2'], 0.65, t);
            }
        } catch (e) {}
    }
}
