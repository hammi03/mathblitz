/**
 * analytics.js — Vercel Web Analytics (cookieless) behind one track() call.
 * The script itself is loaded in index.html from /_vercel/insights/script.js;
 * it only answers once Web Analytics is enabled in the Vercel dashboard.
 * Until then, or when it is blocked, events just wait in a short queue.
 *
 * track() never throws. Never pass personal data (emails, usernames, user IDs).
 */
const Analytics = (() => {

    // Vercel's documented queue stub: calls made before the script loads are
    // replayed by it. Harmless if the script never arrives.
    window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };

    // Events that get the visit's UTM params attached
    const UTM_EVENTS = ['game_start', 'signup'];

    // UTM params of this page load, kept in memory for the session only:
    // no cookie, no localStorage, nothing stored on the device.
    const utm = (() => {
        try {
            const params = new URLSearchParams(location.search);
            const out = {};
            for (const key of ['utm_source', 'utm_campaign']) {
                const v = params.get(key);
                if (v) out[key] = v.slice(0, 100);
            }
            return out;
        } catch {
            return {};
        }
    })();

    // Vercel accepts flat string / number / boolean / null values only
    function clean(props) {
        const out = {};
        for (const [k, v] of Object.entries(props)) {
            if (['string', 'number', 'boolean'].includes(typeof v) || v === null) out[k] = v;
        }
        return out;
    }

    function track(eventName, props = {}) {
        try {
            const data = clean(UTM_EVENTS.includes(eventName) ? { ...props, ...utm } : props);
            if (typeof window.va === 'function')            window.va('event', { name: eventName, data });
            else if (typeof window.va?.track === 'function') window.va.track(eventName, data);
        } catch { /* never break the app for analytics */ }
    }

    return { track };
})();

function track(eventName, props) {
    Analytics.track(eventName, props);
}
