/**
 * sound.js — Web Audio API sound engine.
 * Every sound is synthesised here — no audio files, no third-party samples.
 * One master gain keeps everything quiet by default; the mute switch is
 * remembered in localStorage. Vibration works independently of the mute switch.
 */
const Sound = (() => {
    const STORAGE_KEY = 'quantquiz_sound';
    const VOLUME      = 0.35;   // master level: on, but quiet

    let ctx    = null;
    let master = null;
    let enabled = (() => {
        try { return localStorage.getItem(STORAGE_KEY) !== 'off'; } catch { return true; }
    })();

    function getCtx() {
        if (!ctx) {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            master = ctx.createGain();
            master.gain.value = VOLUME;
            master.connect(ctx.destination);
        }
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    function vibrate(pattern) {
        if ('vibrate' in navigator) navigator.vibrate(pattern);
    }

    // freq may be [from, to] for a pitch glide
    function tone(freq, type, duration, gainVal = 0.22, delay = 0) {
        if (!enabled) return;
        try {
            const c   = getCtx();
            const osc = c.createOscillator();
            const g   = c.createGain();
            osc.connect(g);
            g.connect(master);
            osc.type = type;
            const t = c.currentTime + delay;
            if (Array.isArray(freq)) {
                osc.frequency.setValueAtTime(freq[0], t);
                osc.frequency.exponentialRampToValueAtTime(freq[1], t + duration);
            } else {
                osc.frequency.value = freq;
            }
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(gainVal, t + 0.012);   // soft attack, no clicks
            g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
            osc.start(t);
            osc.stop(t + duration + 0.02);
        } catch (_) { /* ignore audio errors silently */ }
    }

    // ── Game sounds ───────────────────────────────────────────────────────────

    // Climbs a major pentatonic scale with the streak, so a run audibly builds up
    const PENTA = [523, 587, 659, 784, 880, 1047, 1175, 1319, 1568, 1760];

    function correct(streak = 1) {
        const f = PENTA[Math.min(Math.max(streak - 1, 0), PENTA.length - 1)];
        tone(f,       'sine', 0.09, 0.2);
        tone(f * 1.5, 'sine', 0.12, 0.15, 0.07);
        vibrate(35);
    }

    // A soft low thud that drops in pitch
    function wrong() {
        tone([220, 130], 'triangle', 0.22, 0.28);
        vibrate([25, 40, 25]);
    }

    // Every 3 correct in a row; higher streaks climb further up the scale
    function streakMilestone(level) {
        const notes = [523, 659, 784, 988, 1175];
        notes.slice(0, Math.min(level + 1, notes.length)).forEach((freq, i) => {
            tone(freq, 'sine', 0.14, 0.18, i * 0.06);
        });
        vibrate(45);
    }

    // n = 3/2/1 → tick, n = 0 → go
    function countdown(n) {
        if (n === 0) {
            tone(880,  'sine', 0.16, 0.24);
            tone(1320, 'sine', 0.2,  0.18, 0.08);
            vibrate([90, 50, 110]);
        } else {
            tone(440, 'triangle', 0.12, 0.18);
        }
    }

    function gameStart() {
        vibrate([70, 40, 70, 40, 140]);
    }

    // Short cadence: the round is over
    function gameEnd() {
        tone(784, 'triangle', 0.18, 0.2);
        tone(659, 'triangle', 0.18, 0.2, 0.15);
        tone(1047, 'sine',    0.45, 0.22, 0.3);
        vibrate(60);
    }

    // Last seconds of the clock: a dry tick that gets brighter as time runs out
    function tick(secondsLeft) {
        tone(1000 + (5 - secondsLeft) * 120, 'square', 0.035, 0.07);
        if (secondsLeft <= 3) vibrate(15);
    }

    // New personal best: a short fanfare that ends on a held major chord
    function newBest() {
        [523, 659, 784].forEach((f, i) => tone(f, 'triangle', 0.14, 0.2, i * 0.08));
        [1047, 1319, 1568].forEach(f => tone(f, 'sine', 0.9, 0.11, 0.26));
        tone([1568, 2093], 'sine', 0.35, 0.08, 0.5);
        vibrate([50, 30, 50, 30, 120]);
    }

    // Daily goal reached: a light two-note chime
    function goal() {
        tone(1175, 'sine', 0.14, 0.16);
        tone(1568, 'sine', 0.4,  0.14, 0.1);
        vibrate(40);
    }

    // Rising arpeggio with a bright tail
    function rankUp() {
        [523, 659, 784, 1047].forEach((freq, i) => tone(freq, 'triangle', 0.22, 0.2, i * 0.09));
        tone(1568, 'sine', 0.8, 0.12, 0.36);
        vibrate([60, 40, 60, 40, 160]);
    }

    // ── Mute switch ───────────────────────────────────────────────────────────

    function isEnabled() { return enabled; }

    function setEnabled(on) {
        enabled = !!on;
        try { localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off'); } catch { /* ignore */ }
        if (enabled) tone(660, 'sine', 0.08, 0.15);   // audible confirmation
        return enabled;
    }

    function toggle() { return setEnabled(!enabled); }

    return { correct, wrong, streakMilestone, countdown, gameStart, gameEnd, tick, newBest, goal, rankUp, isEnabled, setEnabled, toggle };
})();
