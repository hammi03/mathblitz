/**
 * daily.js — Daily challenge helpers.
 * Generates the same 20 questions for everyone on the same day
 * using a date-seeded PRNG (no server needed).
 */
const Daily = (() => {

    const QUESTION_COUNT = 20;

    // ── Seeded PRNG (mulberry32) ───────────────────────────────────────────────

    function seededRandom(seed) {
        return function () {
            seed |= 0;
            seed = seed + 0x6D2B79F5 | 0;
            let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    function randRange(rng, min, max) {
        return Math.floor(rng() * (max - min + 1)) + min;
    }

    // ── Date helpers ──────────────────────────────────────────────────────────

    function getTodayISO() {
        return new Date().toISOString().split('T')[0];   // "2026-02-25"
    }

    function getDailySeed() {
        // YYYYMMDD as integer — unique per day, same for everyone
        return parseInt(getTodayISO().replace(/-/g, ''), 10);
    }

    function getDateLabel() {
        return new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    // ── Question generation — multiplication only ─────────────────────────────

    function randNoMult(rng, min, max, divisor) {
        let n, attempts = 0;
        do { n = randRange(rng, min, max); attempts++; }
        while (n % divisor === 0 && attempts < 100);
        return n;
    }

    function generateQuestions() {
        const rng = seededRandom(getDailySeed());
        const questions = [];

        for (let i = 0; i < QUESTION_COUNT; i++) {
            // Mix of tiers: 40% 💀 (11-49), 40% 💀💀 (51-99), 20% 💀💀💀 (101-999)
            const roll = rng();
            let min, max, noMult;
            if      (roll < 0.4) { min = 11;  max = 49;  noMult = 10;  }
            else if (roll < 0.8) { min = 51;  max = 99;  noMult = 10;  }
            else                 { min = 101; max = 999; noMult = 100; }

            const a = randNoMult(rng, min, max, noMult);
            const b = randNoMult(rng, min, max, noMult);
            questions.push({ display: `${a} × ${b}`, answer: a * b });
        }

        return questions;
    }

    // ── Completion tracking (localStorage) ───────────────────────────────────

    function storageKey() { return `mathblitz_daily_${getTodayISO()}`; }

    function hasCompletedToday() {
        return localStorage.getItem(storageKey()) === 'done';
    }

    function markCompletedToday() {
        localStorage.setItem(storageKey(), 'done');
    }

    return {
        QUESTION_COUNT,
        generateQuestions,
        hasCompletedToday,
        markCompletedToday,
        getDateLabel,
        getTodayISO,
    };
})();
