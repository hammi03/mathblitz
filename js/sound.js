/**
 * sound.js — Web Audio API sound engine.
 * Generates all sounds programmatically — no audio files needed.
 */
const Sound = (() => {
    let ctx     = null;
    let enabled = true;

    function getCtx() {
        if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    function vibrate(pattern) {
        if ('vibrate' in navigator) navigator.vibrate(pattern);
    }

    function tone(freq, type, duration, gainVal = 0.22, delay = 0) {
        try {
            const c   = getCtx();
            const osc = c.createOscillator();
            const g   = c.createGain();
            osc.connect(g);
            g.connect(c.destination);
            osc.type = type;
            osc.frequency.value = freq;
            const t = c.currentTime + delay;
            g.gain.setValueAtTime(gainVal, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + duration);
            osc.start(t);
            osc.stop(t + duration);
        } catch (_) { /* ignore audio errors silently */ }
    }

    function correct() {
        if (!enabled) return;
        tone(523, 'sine', 0.1, 0.2);
        tone(784, 'sine', 0.12, 0.18, 0.09);
        vibrate(45);
    }

    function wrong() {
        if (!enabled) return;
        tone(180, 'sawtooth', 0.18, 0.18);
    }

    // Called at streak milestones (every 3 correct in a row)
    function streakMilestone(level) {
        if (!enabled) return;
        const notes = [523, 659, 784, 880, 1047];
        const count = Math.min(level, notes.length);
        notes.slice(0, count).forEach((freq, i) => {
            tone(freq, 'sine', 0.16, 0.22, i * 0.065);
        });
    }

    // n = 3/2/1 → tick, n = 0 → GO!
    function countdown(n) {
        if (!enabled) return;
        if (n === 0) {
            tone(880,  'sine', 0.18, 0.3);
            tone(1100, 'sine', 0.18, 0.25, 0.1);
            vibrate([100, 60, 120]);
        } else {
            tone(440, 'triangle', 0.14, 0.2);
        }
    }

    function toggle() {
        enabled = !enabled;
        return enabled;
    }

    return { correct, wrong, streakMilestone, countdown, toggle };
})();
