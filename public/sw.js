const CACHE = 'scrxaper-shell-v3';
const SHELL = ['/', '/app.css', '/v2.css', '/js/app.js', '/js/ui.js', '/js/icons.js', '/logo.png', '/favicon.png', '/manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/')) return;
  e.respondWith(fetch(e.request).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return res; }).catch(() => caches.match(e.request).then((m) => m || caches.match('/'))));
});

/* ---- push: incoming calls, messages and alerts, even when the app is closed ---- */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Scrxaper', body: event.data?.text() ?? '' }; }
  event.waitUntil((async () => {
    if (data.kind === 'call-end') {
      for (const n of await self.registration.getNotifications({ tag: data.tag || 'call' })) n.close();
      if (data.title === 'Missed call') await self.registration.showNotification('Missed call', { body: data.body || '', tag: 'missed', icon: '/icon-192.png', badge: '/icon-192.png' });
      return;
    }
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === 'visible' && w.focused)) { wins.forEach((w) => w.postMessage({ type: data.kind === 'call' ? 'open-call' : 'push', data })); return; }
    const call = data.kind === 'call';
    await self.registration.showNotification(data.title || 'Scrxaper', {
      body: data.body || '', tag: data.tag || data.kind || 'scrxaper', renotify: true, icon: '/icon-192.png', badge: '/icon-192.png', data,
      requireInteraction: !!data.requireInteraction, vibrate: data.vibrate || (call ? [500, 250, 500, 250, 500, 250, 500] : [120]), silent: false,
      actions: call && data.callId ? [{ action: 'answer', title: 'Answer' }, { action: 'decline', title: 'Decline' }] : [],
    });
  })());
});
self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {};
  event.notification.close();
  event.waitUntil((async () => {
    if (event.action === 'decline' && data.callId) {
      await fetch('/api/call/decline', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'scrxaper' }, body: JSON.stringify({ call: data.callId }) }).catch(() => {});
      return;
    }
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => 'focus' in w);
    if (win) { await win.focus(); win.postMessage({ type: data.kind === 'call' ? 'open-call' : 'push', data }); }
    else await self.clients.openWindow(data.url || '/');
  })());
});
