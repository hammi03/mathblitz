/**
 * sw.js — QuantQuiz Service Worker
 * Handles push notifications. Requires HTTPS to activate.
 */

const CACHE = 'quantquiz-v13';

// Cache core files on install
self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE).then(cache => cache.addAll([
            '/', '/index.html', '/impressum.html', '/datenschutz.html', '/css/style.css', '/manifest.webmanifest',
            '/icons/qq.svg', '/icons/qq-mark.svg', '/icons/icon-192.png',
            '/fonts/big-shoulders-display.woff2', '/fonts/atkinson-hyperlegible-next.woff2',
            '/js/config.js', '/js/analytics.js', '/js/db.js', '/js/sound.js',
            '/js/game.js', '/js/daily.js', '/js/bot-duel.js', '/js/duel-client.js',
            '/js/ui.js', '/js/share-card.js', '/js/main.js',
        ]).catch(() => {}))
    );
});

self.addEventListener('activate', event => {
    // Delete old caches
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        ).then(() => clients.claim())
    );
});

// Network first for our own files so updates reach players immediately;
// fall back to the cache when offline. Other origins (Supabase, CDNs) pass through.
self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

    event.respondWith(
        fetch(req)
            .then(res => {
                if (res.ok) {
                    const copy = res.clone();
                    caches.open(CACHE).then(cache => cache.put(req, copy));
                }
                return res;
            })
            .catch(() => caches.match(req))
    );
});

// Receive server push → show notification
self.addEventListener('push', event => {
    const data = event.data?.json() ?? {};
    event.waitUntil(
        self.registration.showNotification(data.title || 'QuantQuiz', {
            body:    data.body  || "Your daily challenge is ready! Can you top the leaderboard today? 🧠",
            icon:    '/icons/icon-192.png',
            badge:   '/icons/icon-192.png',
            tag:     'daily-reminder',
            renotify: false,
            data:    { url: '/' },
        })
    );
});

// Click notification → open app
self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(list => {
            if (list.length) return list[0].focus();
            return clients.openWindow(event.notification.data?.url ?? '/');
        })
    );
});
