/**
 * analytics.js — Provider-agnostic, cookieless event tracking (Umami or Plausible).
 * Configured via ANALYTICS in config.js; does nothing until a provider is set.
 *
 * track() never throws — not when the script is blocked, not when it's unconfigured.
 * Never pass personal data (emails, usernames, user IDs) as props.
 */
const Analytics = (() => {

    const cfg = typeof ANALYTICS !== 'undefined' ? ANALYTICS : {};

    // Events that get the visit's UTM params attached
    const UTM_EVENTS = ['game_start', 'signup'];

    // UTM params of this page load. Kept in memory only: writing them to
    // localStorage would be non-essential device storage (consent required).
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

    const queue = [];   // events fired before the provider script has loaded
    let ready = false;

    function enabled() {
        return !!(cfg.provider && cfg.scriptUrl && cfg.siteId);
    }

    function send(name, props) {
        if (cfg.provider === 'umami')     window.umami?.track(name, props);
        if (cfg.provider === 'plausible') window.plausible?.(name, { props });
    }

    function flush() {
        ready = true;
        while (queue.length) {
            const [name, props] = queue.shift();
            try { send(name, props); } catch { /* ignore */ }
        }
    }

    function load() {
        try {
            if (!enabled()) return;
            const s = document.createElement('script');
            s.defer = true;
            s.src   = cfg.scriptUrl;
            if (cfg.provider === 'umami') s.dataset.websiteId = cfg.siteId;
            else                          s.dataset.domain    = cfg.siteId;
            s.onload  = flush;
            s.onerror = () => { queue.length = 0; };   // blocked → drop silently
            document.head.appendChild(s);
        } catch { /* ignore */ }
    }

    function track(eventName, props = {}) {
        try {
            if (!enabled()) return;
            const data = UTM_EVENTS.includes(eventName) ? { ...props, ...utm } : { ...props };
            if (ready)                   send(eventName, data);
            else if (queue.length < 50)  queue.push([eventName, data]);
        } catch { /* never break the app for analytics */ }
    }

    load();
    return { track };
})();

function track(eventName, props) {
    Analytics.track(eventName, props);
}
