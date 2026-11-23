import { $, h, state, api, nav, sq, iconNode, avatarEl, toast, fail, notice, menu, show, closePanel } from './ui.js';
import './audio.js';
import { bindChatEvents, renderConversations, refreshHome, closeThread } from './chat.js';
import { refreshCommunities, renderServers, openHome, openCommunity } from './community.js';
import { onCallEvent, checkPending } from './calls.js';
import { onVoiceEvent, onVoiceInvite } from './voice.js';
import { bindFriendEvents, refreshCounts, updateBadges, showFriends, showNotifications } from './friends.js';
import { openSocial } from './social.js';
import { applyPrefs, applyUi, showStudio } from './studio.js';
import { showOwner } from './owner.js';
import './buddy.js';
import { runOnboarding } from './onboarding.js';
import { initLanding, stopLanding } from './landing.js';
import { refreshPush } from './push.js';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'open-call') checkPending(); });
}
document.addEventListener('visibilitychange', () => { document.documentElement.dataset.paused = String(document.hidden); });

/* ---------- auth dialog ---------- */
const dlg = $('auth-dialog');
$('auth-x').replaceChildren(iconNode('x', 18));
function setMode(registering) {
  state.registering = registering;
  $('display-field').hidden = !registering; $('auth-title').textContent = registering ? 'Create your account' : 'Welcome back';
  $('auth-form').querySelector('button[type=submit]').textContent = registering ? 'Create account' : 'Log in';
  $('auth-toggle').textContent = registering ? 'Have an account? Log in' : 'New here? Create an account';
  $('auth-form').elements.password.autocomplete = registering ? 'new-password' : 'current-password'; $('auth-error').textContent = '';
}
function openAuth(registering) { setMode(registering); if (!dlg.open) dlg.showModal(); dlg.querySelector('input').focus(); }
const closeAuth = () => { dlg.classList.add('closing'); setTimeout(() => { dlg.close(); dlg.classList.remove('closing'); }, 170); };
$('auth-x').addEventListener('click', closeAuth); dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeAuth(); }); dlg.addEventListener('click', (e) => { if (e.target === dlg) closeAuth(); });
for (const [id, reg] of [['nav-login', false], ['hero-login', false], ['nav-join', true], ['hero-join', true], ['final-join', true]]) $(id).addEventListener('click', () => openAuth(reg));
$('auth-toggle').addEventListener('click', () => setMode(!state.registering));
$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); $('auth-error').textContent = '';
  try { const me = await api(state.registering ? '/api/register' : '/api/login', { body: f }); closeAuth(); await enterApp(me); }
  catch (err) { if (err.status === 403 && /suspend|banned/i.test(err.message)) { closeAuth(); showBan(err.message); } else $('auth-error').textContent = err.message; }
});
async function showBan(reason) {
  await notice({ title: 'Your account is suspended', text: reason?.replace(/^.*?:\s*/, '') || 'This account has been suspended by Scrxaper staff.', ic: 'shield', ok: 'OK' });
  location.reload();
}

/* ---------- navigation chrome ---------- */
function buildDock() {
  const dock = $('dock');
  const b = (id, ic, label, fn, cls = '') => { const x = sq(ic, label, fn, cls); x.id = id; return x; };
  const more = b('dock-more', 'more', 'More', () => menu($('dock-more'), [['Explore', 'explore', () => openSocial('explore')], ['Reels', 'reels', () => openSocial('reels')], ['Buddy', 'buddy', () => nav.showBuddy()], ['My profile', 'me', () => nav.openProfile(state.me)],
    ...(state.perms.length ? [['Owner tools', 'owner', () => showOwner().catch(fail)]] : []), ['Log out', 'logout', () => nav.logout(), { warn: true }]]), 'mob-only');
  dock.replaceChildren(b('dock-feed', 'feed', 'Feed and reels', () => openSocial('feed')), b('dock-explore', 'explore', 'Explore', () => openSocial('explore'), 'desk-only'), b('dock-friends', 'friends', 'Friends', () => showFriends()), b('dock-notes', 'bell', 'Notifications', () => showNotifications()),
    b('dock-buddy', 'buddy', 'Buddy', () => nav.showBuddy(), 'desk-only'), b('dock-studio', 'studio', 'Studio', () => showStudio()), b('dock-me', 'me', 'My profile', () => nav.openProfile(state.me), 'desk-only'),
    ...(state.perms.length ? [b('dock-owner', 'owner', state.role === 'owner' ? 'Owner dashboard' : 'Admin tools', () => showOwner().catch(fail), 'desk-only')] : []), b('dock-out', 'logout', 'Log out', () => nav.logout(), 'desk-only'), more);
  updateBadges();
}
nav.logout = async () => { await api('/api/logout', { body: {} }).catch(() => {}); location.reload(); };
$('me-pfp').addEventListener('click', () => nav.openProfile(state.me));

/* ---------- desktop notifications while the tab is hidden ---------- */
nav.systemNotify = (kind, target, title, body) => {
  const p = state.privacy;
  if (typeof Notification === 'undefined' || !p || p.dnd || !document.hidden || Notification.permission !== 'granted' || state.mutes?.has(`${kind}:${target}`)) return;
  new Notification(title, { body: p.previews ? String(body).slice(0, 120) : 'New message', tag: `${kind}:${target}` });
};

/* ---------- live events ---------- */
function connectEvents() {
  state.events?.close();
  const es = state.events = new EventSource('/api/events');
  bindChatEvents(es); bindFriendEvents(es);
  es.addEventListener('call', (e) => onCallEvent(JSON.parse(e.data)));
  es.addEventListener('voice', (e) => onVoiceEvent(JSON.parse(e.data)));
  es.addEventListener('voice-invite', (e) => onVoiceInvite(JSON.parse(e.data)));
  es.addEventListener('community', () => { refreshCommunities(); if (state.community) openCommunity(state.community.community.id, state.channel).catch(() => {}); });
  es.addEventListener('banned', (e) => { es.close(); showBan(JSON.parse(e.data).reason); });
  es.addEventListener('open', () => { refreshHome().catch(() => {}); refreshCounts(); });
}

async function enterApp(me) {
  Object.assign(state, { me: me.username, meId: me.id, displayName: me.displayName, avatar: me.avatar, role: me.role, perms: me.perms ?? [], isOwner: !!me.isOwner, birthday: me.birthday, prefs: me.prefs, privacy: me.privacy, sound: me.sound,
    spectrum: me.spectrum, unread: me.unread ?? 0, friendRequests: me.friendRequests ?? 0, followRequests: me.followRequests ?? 0, ignored: new Set(me.ignored ?? []), mutes: new Set((me.mutes ?? []).map((x) => `${x.kind}:${x.target}`)) });
  applyPrefs(me.prefs); applyUi(me.ui);
  $('me').textContent = me.displayName; $('me-status').textContent = `@${me.username}`; $('me-pfp').replaceChildren(avatarEl(me.avatar, me.displayName, 38));
  $('auth').hidden = true; stopLanding(); $('app').hidden = false;
  buildDock(); await refreshCommunities().catch(() => {}); renderServers();
  await refreshHome().catch(() => {}); connectEvents(); refreshPush();
  if (!me.onboarded) runOnboarding(() => { api('/api/me').then((m) => { state.avatar = m.avatar; state.displayName = m.displayName; $('me').textContent = m.displayName; $('me-pfp').replaceChildren(avatarEl(m.avatar, m.displayName, 38)); state.privacy = m.privacy; }); });
  checkPending();
  const q = new URLSearchParams(location.search);
  if (q.get('open') === 'friends') showFriends(); else if (q.get('open') === 'reels') openSocial('reels');
  if (q.has('call') || q.has('open')) history.replaceState({}, '', '/');
}

/* ---------- boot ---------- */
(async () => {
  try { await enterApp(await api('/api/me')); }
  catch { $('auth').hidden = false; initLanding(); }
})();

/* a request that fails because the session ended (for example after a suspension) is handled by the popup or the login screen */
window.addEventListener('unhandledrejection', (e) => { if (e.reason?.status === 401) e.preventDefault(); });
