import { $, h, iconNode, avatarEl } from './ui.js';
import { SPECTRUM_STYLES, mountSpectrum, demoFeed } from './spectrum.js';
import { canInstall, installApp, isInstalled } from './push.js';

const FEATURES = [['comment', 'Chat that feels good', 'Grouped bubbles, reactions, files of any kind, and a typing indicator that is actually helpful.'], ['users', 'Friends, Discord-style', 'Send and accept friend requests, see who is online, and find people through mutual friends.'],
  ['hash', 'Communities with channels', 'Text and voice channels, roles, timeouts, a moderation log, and a server bar you can drag into your own order.'], ['bot', 'Ready-made bots', 'Security, Music, Welcome and Fun & Games. Switch them on when you create a space.'],
  ['speaker', 'Voice and group calls', 'Hop into a voice channel or start a group call. Share your screen with one click.'], ['reels', 'Reels and stories', 'Trim and filter videos right in the app, add your own music, and share to the feed.'],
  ['explore', 'Hashtags and Explore', 'Follow trends, find people who share your interests, and discover what is popular.'], ['lock', 'Private when you want', 'Private accounts, friends-only messages, per-chat mutes, and blocking.'],
  ['studio', 'Studio for everything', 'Themes, accents, bubble styles, sounds, call screens, privacy. All of it is yours to change.'], ['bolt', 'Sparks and badges', 'Earn Sparks, collect badges and cosmetics. Never required, never pay-to-win.'],
  ['buddy', 'Your own AI buddy', 'Bring your own Groq key and chat with a buddy that stays out of everyone else’s way.'], ['install', 'Install it', 'Add it to your home screen or desktop for its own window and alerts.']];
let spec = null; let observer = null;
export function initLanding() {
  const grid = $('fgrid');
  grid.replaceChildren(...FEATURES.map(([ic, t, p]) => { const c = h('article', { className: 'fcard reveal' }, h('i', {}, iconNode(ic, 24)), h('h3', {}, t), h('p', {}, p)); c.addEventListener('pointermove', (e) => { const r = c.getBoundingClientRect(); c.style.setProperty('--mx', `${e.clientX - r.left}px`); }); return c; }));
  document.querySelectorAll('[data-ico]').forEach((n) => n.replaceChildren(iconNode(n.dataset.ico, 24)));
  observer?.disconnect(); observer = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); observer.unobserve(e.target); } }), { threshold: 0.12 });
  document.querySelectorAll('#auth .reveal').forEach((n) => observer.observe(n));
  const host = $('demo-spec'); const cur = { style: 'cd', color: '#b7c9e6' };
  const mount = () => { spec?.stop(); spec = mountSpectrum(host, { style: cur.style, color: cur.color, avatar: avatarEl('preset:aurora', 'A', 140), size: Math.min(280, innerWidth - 90), feed: demoFeed }); };
  const chips = $('demo-styles'); const colors = $('demo-colors');
  const paint = () => { chips.replaceChildren(...SPECTRUM_STYLES.map(([id, l]) => h('button', { type: 'button', className: 'pill', 'aria-pressed': String(cur.style === id), onclick: () => { cur.style = id; spec.set({ style: id }); paint(); } }, l)));
    colors.replaceChildren(...['#b7c9e6', '#ff9ec4', '#8fe3b4', '#ffb27a', '#b79cff', '#7fe0e8'].map((c) => { const b = h('button', { type: 'button', className: 'swatch-dot', ariaLabel: `Colour ${c}`, 'aria-pressed': String(cur.color === c), onclick: () => { cur.color = c; spec.set({ color: c }); paint(); } }); b.style.setProperty('background', c); return b; })); };
  mount(); paint();
  const ib = $('install-app'); const upd = () => { ib.hidden = isInstalled() || !canInstall(); ib.textContent = 'Install the app'; }; upd(); window.addEventListener('scrx:installable', upd); ib.onclick = () => installApp();
}
export const stopLanding = () => { spec?.stop(); spec = null; observer?.disconnect(); };
