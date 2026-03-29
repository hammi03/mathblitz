/**
 * sw.js — QuantQuiz Service Worker
 * Handles push notifications. Requires HTTPS to activate.
 */

const CACHE = 'quantquiz-v3';

// Cache core files on install
self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE).then(cache => cache.addAll([
            '/', '/index.html', '/css/style.css',
            '/js/config.js', '/js/bg.js', '/js/db.js', '/js/sound.js',
            '/js/game.js', '/js/daily.js', '/js/duel-client.js',
            '/js/ui.js', '/js/main.js',
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

// Serve from cache when offline
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(cached => cached || fetch(event.request))
    );
});

// Receive server push → show notification
self.addEventListener('push', event => {
    const data = event.data?.json() ?? {};
    event.waitUntil(
        self.registration.showNotification(data.title || 'QuantQuiz', {
            body:    data.body  || "Your daily challenge is ready! Can you top the leaderboard today? 🧠",
            icon:    '/icon.png',
            badge:   '/icon.png',
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
