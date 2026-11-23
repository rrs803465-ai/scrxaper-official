import { api, toast } from './ui.js';

let deferred = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; window.dispatchEvent(new Event('scrx:installable')); });
window.addEventListener('appinstalled', () => { deferred = null; window.dispatchEvent(new Event('scrx:installable')); });
export const canInstall = () => !!deferred;
export const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export async function installApp() { if (!deferred) return false; deferred.prompt(); const r = await deferred.userChoice; deferred = null; window.dispatchEvent(new Event('scrx:installable')); return r.outcome === 'accepted'; }

const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export async function pushState() {
  if (!pushSupported()) return { supported: false, permission: 'unsupported', subscribed: false };
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  const sub = await reg?.pushManager.getSubscription();
  return { supported: true, permission: Notification.permission, subscribed: !!sub };
}
export async function enablePush() {
  if (!pushSupported()) throw new Error('This browser does not support background notifications. On iPhone, add Scrxaper to your Home Screen first.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them in your browser’s site settings, then try again.');
  const reg = await navigator.serviceWorker.ready;
  const { key } = await api('/api/push/key');
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) }));
  await api('/api/push/subscribe', { body: { subscription: sub.toJSON() } });
  return true;
}
export async function disablePush() {
  const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription();
  if (sub) { await api('/api/push/unsubscribe', { body: { endpoint: sub.endpoint } }).catch(() => {}); await sub.unsubscribe(); }
}
/* re-register the current subscription after login so a new device or a rotated endpoint keeps working */
export async function refreshPush() { try { const s = await pushState(); if (s.subscribed && s.permission === 'granted') await enablePush(); } catch { /* optional */ } }
