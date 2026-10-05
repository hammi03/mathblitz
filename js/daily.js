/**
 * daily.js — Daily challenge date helpers.
 * Questions come from the server (start_daily) so nobody sees them in advance.
 * The daily resets at 00:00 UTC for everyone.
 */
const Daily = (() => {

    const QUESTION_COUNT = 20;

    function getTodayISO() {
        return new Date().toISOString().split('T')[0];   // UTC, e.g. "2026-02-25"
    }

    function getDateLabel() {
        return new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    }

    return { QUESTION_COUNT, getTodayISO, getDateLabel };
})();
