/**
 * daily.js — Daily challenge date helpers.
 * Signed-in players get their questions from the server (start_daily) so nobody
 * sees them in advance. Guests get a set generated here from the UTC date: the
 * same for every guest on a day, kept only in this browser.
 * The daily resets at 00:00 UTC for everyone.
 */
const Daily = (() => {

    const QUESTION_COUNT = 20;
    const GUEST_KEY      = 'quantquiz_guest_daily';

    function getTodayISO() {
        return new Date().toISOString().split('T')[0];   // UTC, e.g. "2026-02-25"
    }

    function getDateLabel() {
        return new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    }

    function isoDaysBefore(iso, days) {
        const d = new Date(iso + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() - days);
        return d.toISOString().split('T')[0];
    }

    // ── Guest questions: seeded from the date, same mix as the server ─────────

    function mulberry32(seed) {
        return function () {
            seed |= 0;
            seed = seed + 0x6D2B79F5 | 0;
            let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    function guestQuestions(iso = getTodayISO()) {
        const seed = [...`qq-guest-${iso}`].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) | 0, 0) >>> 0;
        const rng  = mulberry32(seed);
        const factor = (lo, hi, nm) => {
            let n, tries = 0;
            do { n = lo + Math.floor(rng() * (hi - lo + 1)); tries++; } while (n % nm === 0 && tries < 100);
            return n;
        };
        const out = [];
        for (let i = 0; i < QUESTION_COUNT; i++) {
            const roll = rng();
            const [lo, hi, nm] = roll < 0.4 ? [11, 49, 10] : roll < 0.8 ? [51, 99, 10] : [101, 999, 100];
            const a = factor(lo, hi, nm), b = factor(lo, hi, nm);
            out.push({ display: `${a} × ${b}`, answer: a * b });
        }
        return out;
    }

    // ── Guest progress: { attempt, last, streak } (UTC dates) ─────────────────
    // attempt: day today's daily was started (one try per day, used up on start)
    // last:    last day that counted for the streak (at least one answer given)

    function readGuest() {
        try { return JSON.parse(localStorage.getItem(GUEST_KEY) || '{}'); } catch { return {}; }
    }

    function guestDone() {
        const g = readGuest();
        return g.attempt === getTodayISO() || g.last === getTodayISO();
    }

    function guestStreak() {
        const g = readGuest();
        const today = getTodayISO();
        return g.last === today || g.last === isoDaysBefore(today, 1) ? (g.streak ?? 0) : 0;
    }

    function writeGuest(g) {
        try { localStorage.setItem(GUEST_KEY, JSON.stringify(g)); } catch { /* private mode */ }
    }

    // Starting uses up today's attempt, like the server-side daily
    function markGuestStarted() {
        writeGuest({ ...readGuest(), attempt: getTodayISO() });
    }

    // A finished daily with at least one answer extends the streak; returns it
    function recordGuestDaily() {
        const today = getTodayISO();
        const g = readGuest();
        if (g.last !== today) {
            g.streak = g.last === isoDaysBefore(today, 1) ? (g.streak ?? 0) + 1 : 1;
            g.last   = today;
            writeGuest(g);
        }
        return g.streak;
    }

    return { QUESTION_COUNT, getTodayISO, getDateLabel, guestQuestions, guestDone, guestStreak, markGuestStarted, recordGuestDaily };
})();
