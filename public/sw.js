/* GreenGoals PWA — minimal service worker (pass-through). Enables install prompts on Chrome/Android; iOS uses "Add to Home Screen" without offline caching here. */
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
