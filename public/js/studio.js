import { $, h, state, api, upload, nav, sq, iconNode, avatarEl, toast, fail, confirmBox, ask, show, closePanel, form, field, pickFile, tabs, fmtSize, confetti } from './ui.js';
import { BUILTIN_TONES, playSound } from './audio.js';
import { SPECTRUM_STYLES, mountSpectrum, demoFeed } from './spectrum.js';
import { editPhoto } from './editor.js';
import { pushState, enablePush, disablePush, canInstall, installApp, isInstalled } from './push.js';

const resolveTheme = (t) => (t === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t);
export function applyPrefs(p) {
  if (!p) return; const r = document.documentElement;
  r.dataset.theme = resolveTheme(p.theme); r.dataset.density = p.density; r.dataset.motion = p.reduceMotion ? 'reduced' : 'full'; r.dataset.glass = p.plain ? 'off' : 'on';
  if (p.accent) r.style.setProperty('--accent', p.accent); else r.style.removeProperty('--accent');
}
export function applyUi(u = {}) {
  const r = document.documentElement; state.ui = u;
  for (const k of ['bubble', 'font', 'wallpaper', 'radius', 'sidebar']) { if (u[k]) r.dataset[k] = u[k]; else delete r.dataset[k]; }
  if (u.accent2) r.style.setProperty('--accent2', u.accent2); else r.style.removeProperty('--accent2');
}
const ACCENTS = ['#b7c9e6', '#8fb8ff', '#b79cff', '#ff9ec4', '#ffb27a', '#8fe3b4', '#7fe0e8', '#f2d27a'];
const seg = (items, value, onPick) => { const wrap = h('div', { className: 'seg', role: 'group' }); const paint = () => wrap.replaceChildren(...items.map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(v === value), onclick: () => { value = v; paint(); onPick(v); } }, l))); paint(); return wrap; };
const toggle = (label, checked, onChange) => h('label', { className: 'toggle' }, label, h('input', { type: 'checkbox', checked: !!checked, onchange: (e) => onChange(e.target.checked) }));
const swatches = (value, onPick) => { const row = h('div', { className: 'swatches' }); const paint = () => row.replaceChildren(...ACCENTS.map((c) => { const b = h('button', { type: 'button', className: 'swatch-dot', title: c, ariaLabel: `Colour ${c}`, 'aria-pressed': String(c === value), onclick: () => { value = c; paint(); onPick(c); } }); b.style.setProperty('background', c); return b; }),
  h('input', { type: 'color', value: value || '#b7c9e6', ariaLabel: 'Custom colour', style: { width: '34px', height: '30px', padding: '0' }, oninput: (e) => { value = e.target.value; paint(); onPick(value); } })); paint(); return row; };
const savePrefs = async (patch) => { state.prefs = await api('/api/prefs', { body: { ...state.prefs, ...patch } }); applyPrefs(state.prefs); };
const saveUi = async (patch) => { const next = { ...state.ui, ...patch }; applyUi(next); try { applyUi((await api('/api/ui', { body: { ui: next } })).ui); } catch (e) { fail(e); } };
const refreshMe = () => api('/api/me').then((m) => { state.avatar = m.avatar; state.displayName = m.displayName; $('me').textContent = m.displayName; $('me-pfp').replaceChildren(avatarEl(m.avatar, m.displayName, 36)); });

export async function showStudio(start = 0) {
  const profile = await api('/api/profile'); const sounds = await api('/api/sounds');
  const toneOptions = [...BUILTIN_TONES, ...sounds.map((x) => [`custom:${x.id}`, x.label || 'Custom sound'])];
  const select = (value, options, onChange) => h('select', { value, onchange: (e) => onChange(e.target.value) }, ...options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
  const defs = [
    ['Look', 'studio', () => { const p = state.prefs ?? {}; const u = state.ui ?? {};
      return [h('h3', {}, 'Theme'), seg([['dark', 'Dark'], ['light', 'Light'], ['system', 'System']], p.theme, (v) => savePrefs({ theme: v })), h('h3', {}, 'Accent colour'), swatches(p.accent, (c) => savePrefs({ accent: c })), h('h3', {}, 'Second colour'), swatches(u.accent2, (c) => saveUi({ accent2: c })),
        h('h3', {}, 'Chat bubbles'), seg([['round', 'Round'], ['soft', 'Soft'], ['square', 'Square'], ['minimal', 'Minimal']], u.bubble ?? 'round', (v) => saveUi({ bubble: v })),
        h('h3', {}, 'Corners'), seg([['sharp', 'Sharp'], ['normal', 'Normal'], ['pill', 'Round']], u.radius ?? 'normal', (v) => saveUi({ radius: v })),
        h('h3', {}, 'Text size'), seg([['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']], u.font ?? 'md', (v) => saveUi({ font: v })),
        h('h3', {}, 'Chat background'), seg([['none', 'None'], ['aurora', 'Aurora'], ['dusk', 'Dusk'], ['grid', 'Grid'], ['mist', 'Mist']], u.wallpaper ?? 'none', (v) => saveUi({ wallpaper: v })),
        h('h3', {}, 'Layout'), seg([['comfortable', 'Comfortable'], ['compact', 'Compact']], p.density, (v) => savePrefs({ density: v })), seg([['wide', 'Wide sidebar'], ['narrow', 'Narrow sidebar']], u.sidebar ?? 'wide', (v) => saveUi({ sidebar: v })),
        h('h3', {}, 'More'), toggle('Group messages from the same person', u.grouping !== false, (v) => saveUi({ grouping: v })), toggle('Celebration effects (confetti)', u.effects !== false, (v) => saveUi({ effects: v })),
        toggle('Reduce motion', p.reduceMotion, (v) => savePrefs({ reduceMotion: v })), toggle('Solid panels (no glass blur)', p.plain, (v) => savePrefs({ plain: v })),
        h('h3', {}, 'Clock'), seg([['auto', 'Auto'], ['12', '12-hour'], ['24', '24-hour']], u.clock ?? 'auto', (v) => saveUi({ clock: v }))]; }],
    ['Profile', 'me', () => {
      const logos = h('div', { className: 'logo-grid' });
      const paintLogos = () => logos.replaceChildren(...Object.keys(PRESET_IDS()).map((id) => h('button', { type: 'button', className: 'logo-pick', title: id, 'aria-pressed': String(state.avatar === `preset:${id}`), onclick: async () => { try { await api('/api/avatar/preset', { body: { id } }); await refreshMe(); paintLogos(); toast('Logo selected', { ic: 'check' }); } catch (e) { fail(e); } } }, avatarEl(`preset:${id}`, id, 64))));
      paintLogos();
      const img = (kind) => h('button', { className: 'ghost', type: 'button', onclick: () => pickFile('image/png,image/jpeg,image/gif,image/webp', async (picked) => { const f = picked.type === 'image/gif' ? picked : await editPhoto(picked, { aspect: kind === 'avatar' ? '1:1' : '3:1' }); if (!f) return; try { await upload(kind, f); await refreshMe(); showStudio(1); } catch (e) { fail(e); } }) }, `Upload ${kind}`);
      const extra = (k) => JSON.stringify([profile.pronouns, profile.links, profile.interests, k]);
      return [form(async (v) => { await api('/api/profile', { body: v }); await api('/api/profile/extra', { body: { pronouns: v.pronouns, interests: v.interests.split(',').map((s) => s.trim()).filter(Boolean), links: [1, 2, 3].map((i) => ({ label: v[`l${i}n`], url: v[`l${i}u`] })).filter((l) => l.url) } }); await refreshMe(); toast('Profile saved', { ic: 'check' }); },
        field('displayName', 'Display name', { value: profile.displayName }), field('pronouns', 'Pronouns', { value: profile.pronouns ?? '', maxLength: 24 }), field('status', 'Status', { value: profile.status, maxLength: 60 }),
        h('textarea', { name: 'bio', placeholder: 'Bio', ariaLabel: 'Bio', maxLength: 200, value: profile.bio }), field('interests', 'Interests, comma separated (used to suggest people and hashtags)', { value: (profile.interests ?? []).join(', ') }),
        ...[1, 2, 3].map((i) => h('div', { className: 'field-row' }, field(`l${i}n`, 'Link label', { value: profile.links?.[i - 1]?.label ?? '', maxLength: 24 }), field(`l${i}u`, 'https://…', { value: profile.links?.[i - 1]?.url ?? '' }))), h('button', { className: 'primary', type: 'submit' }, 'Save profile')),
        h('h3', {}, 'Profile picture'), h('p', { className: 'help' }, 'Pick a logo, or upload your own picture and banner.'), logos, h('div', { className: 'field-row' }, img('avatar'), img('banner'),
          profile.avatar ? h('button', { className: 'ghost', type: 'button', onclick: async () => { await api('/api/upload/delete', { body: { kind: 'avatar' } }); await refreshMe(); showStudio(1); } }, 'Remove picture') : '',
          profile.banner ? h('button', { className: 'ghost', type: 'button', onclick: async () => { await api('/api/upload/delete', { body: { kind: 'banner' } }); showStudio(1); } }, 'Remove banner') : ''),
        h('h3', {}, 'Profile song'), h('div', { className: 'field-row' }, select(profile.song ?? '', [['', 'None'], ...sounds.map((x) => [x.id, x.label || 'Track'])], async (v) => { await api('/api/profile/song', { body: { id: v || null } }).catch(fail); })),
        h('h3', {}, 'Badges'), h('div', { className: 'tagrow' }, ...(profile.badges.length ? profile.badges.map((b) => h('span', { className: 'role-chip', title: b.description }, b.name)) : [h('p', { className: 'empty' }, 'No badges yet.')]))]; }],
    ['Sounds', 'music', () => {
      const s = state.sound ?? {}; const vals = { tone: s.tone ?? 'chime', ringtone: s.ringtone ?? 'ring', callTune: s.callTune ?? 'ringback', volume: s.volume ?? 60 };
      const save = async () => { try { state.sound = await api('/api/sound', { body: vals }); } catch (e) { fail(e); } };
      const row = (label, key, help) => h('div', { className: 'card' }, h('b', {}, label), h('p', { className: 'help' }, help), h('div', { className: 'field-row' }, select(vals[key], toneOptions, (v) => { vals[key] = v; save(); }), sq('play', 'Preview', () => playSound(vals[key], vals.volume), 'small')));
      const lib = h('div', { style: { display: 'grid', gap: '8px' } });
      const paintLib = async () => { const list = await api('/api/sounds'); lib.replaceChildren(...list.map((x) => h('div', { className: 'lib-row' }, iconNode('music', 18), h('span', { className: 'meta' }, h('b', {}, x.label || 'Track'), h('small', {}, fmtSize(x.size ?? 0))), sq('play', 'Preview', () => { const a = new Audio(`/files/${x.id}`); a.volume = vals.volume / 100; a.play(); setTimeout(() => a.pause(), 8000); }, 'small'),
        sq('trash', 'Delete', async () => { if (await confirmBox('Delete this track?', 'It is removed from any posts, stories or call settings that use it.', 'Delete', true)) { state.sound = await api('/api/sounds/delete', { body: { id: x.id } }); showStudio(2); } }, 'small danger-sq'))), list.length ? '' : h('p', { className: 'empty' }, 'No tracks yet.')); };
      paintLib();
      return [row('Message sound', 'tone', 'Plays when a message arrives.'), row('Ringtone', 'ringtone', 'What you hear when someone calls you. Use a full song if you like.'), row('Calling tune', 'callTune', 'What you hear while you call someone. They never hear it.'),
        h('label', {}, 'Volume ', h('input', { type: 'range', min: 0, max: 100, value: vals.volume, ariaLabel: 'Volume', onchange: (e) => { vals.volume = Number(e.target.value); save(); } })),
        h('h3', {}, 'Your music library'), h('p', { className: 'help' }, 'Upload songs up to 10 MB, any length (MP3, WAV, OGG, FLAC, M4A). Use them as ringtones, calling tunes, profile song, and music on reels and stories.'), lib,
        h('button', { className: 'primary', type: 'button', onclick: () => pickFile('audio/*', async (f) => { try { await upload('sound', f, '', f.name); toast('Added to your library', { ic: 'check' }); showStudio(2); } catch (e) { fail(e); } }) }, 'Upload music')]; }],
    ['Call screen', 'phone', () => {
      const sp = { ...(state.spectrum ?? { style: 'bars', color: '#b7c9e6' }) };
      const preview = h('div', { className: 'spec-preview' }); const host = h('div', {}); preview.append(host); let m = null;
      const mount = () => { m?.stop(); m = mountSpectrum(host, { style: sp.style, color: sp.color, avatar: avatarEl(state.avatar, state.displayName, 160), size: 280, feed: demoFeed }); };
      requestAnimationFrame(mount);
      const save = async () => { try { await api('/api/spectrum', { body: sp }); state.spectrum = { ...sp }; } catch (e) { fail(e); } };
      const tiles = h('div', { className: 'tiles' }); const paint = () => tiles.replaceChildren(...SPECTRUM_STYLES.map(([id, label]) => h('button', { type: 'button', className: 'tile', 'aria-pressed': String(sp.style === id), onclick: () => { sp.style = id; paint(); m.set({ style: id }); save(); } }, iconNode(id === 'cd' ? 'music' : 'sparkle', 22), h('b', {}, label)))); paint();
      return [h('p', { className: 'help' }, 'When someone calls you, their picture shows with a spectrum that moves to the beat of your ringtone. The caller never sees it.'), preview, tiles, h('h3', {}, 'Spectrum colour'), swatches(sp.color, (c) => { sp.color = c; m.set({ color: c }); save(); }),
        h('button', { className: 'primary', type: 'button', onclick: () => { closePanel(); setTimeout(() => nav.previewIncoming(sp.style, sp.color), 220); } }, 'Try it with my ringtone')]; }],
    ['Privacy', 'lock', () => {
      const p = { ...(state.privacy ?? {}) };
      const save = async () => { try { state.privacy = await api('/api/privacy', { body: { whoCanMessage: p.whoCanMessage, previews: p.previews, dnd: p.dnd, privateAccount: p.privateAccount, showOnline: p.showOnline } }); } catch (e) { fail(e); } };
      return [h('h3', {}, 'Who can message you directly'), h('p', { className: 'help' }, 'Choose who may start a new chat with you. People you already talk to are not affected.'),
        h('div', { className: 'tiles' }, ...[['everyone', 'users', 'Everyone', 'Anyone on Scrxaper'], ['groups', 'comment', 'Shared spaces', 'Friends and people in your groups or communities'], ['friends', 'friends', 'Friends only', 'Only your friends'], ['nobody', 'lock', 'Nobody new', 'Direct messages are off']].map(([v, ic, t, sub]) => {
          const b = h('button', { type: 'button', className: 'tile', 'aria-pressed': String(p.whoCanMessage === v), onclick: () => { p.whoCanMessage = v; b.parentNode.querySelectorAll('.tile').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); save(); } }, iconNode(ic, 22), h('b', {}, t), h('small', {}, sub)); return b; })),
        toggle('Private account — people must request to follow, and only followers see your posts', p.privateAccount, (v) => { p.privateAccount = v; save(); }), toggle('Show when I am online to friends', p.showOnline !== false, (v) => { p.showOnline = v; save(); }),
        toggle('Show message text in notifications', p.previews !== false, (v) => { p.previews = v; save(); }), toggle('Do not disturb', p.dnd, (v) => { p.dnd = v; save(); }),
        h('h3', {}, 'Ignored people'), ...(state.ignored.size ? [...state.ignored].map((u) => h('div', { className: 'prow' }, h('span', { className: 'meta' }, `@${u}`), h('button', { className: 'ghost', type: 'button', onclick: async () => { await api('/api/ignore', { body: { username: u, ignored: false } }); state.ignored.delete(u); showStudio(4); } }, 'Stop ignoring'))) : [h('p', { className: 'empty' }, 'Nobody.')])]; }],
    ['Alerts', 'bell', async () => {
      const st = await pushState(); const out = [];
      out.push(h('p', { className: 'help' }, 'Install Scrxaper and turn on background notifications so calls and messages reach you when the app is closed or the screen is off. Incoming calls show a popup with who is calling and buzz your phone. Your full ringtone plays once you open the call.'));
      out.push(h('div', { className: 'card' }, h('b', {}, 'Install the app'), isInstalled() ? h('small', { className: 'help' }, 'Scrxaper is installed on this device.') : canInstall() ? h('button', { className: 'primary', type: 'button', onclick: async () => { await installApp(); showStudio(5); } }, 'Install Scrxaper') : h('small', { className: 'help' }, 'Use your browser menu: “Install app” or “Add to Home Screen”.')));
      out.push(h('div', { className: 'card' }, h('b', {}, 'Background notifications'), !st.supported ? h('small', { className: 'help' }, 'This browser does not support them. On iPhone and iPad, add Scrxaper to your Home Screen first.')
        : st.subscribed ? h('button', { className: 'ghost', type: 'button', onclick: async () => { await disablePush(); showStudio(5); } }, 'Turn off on this device') : h('button', { className: 'primary', type: 'button', onclick: async () => { try { await enablePush(); toast('Background notifications are on', { ic: 'bell' }); showStudio(5); } catch (e) { fail(e); } } }, 'Turn on'),
        st.permission === 'denied' ? h('small', { className: 'help' }, 'Notifications are blocked for this site in your browser settings.') : ''));
      return out; }],
    ['Sparks', 'bolt', async () => {
      const shop = await api('/api/shop');
      const preview = (it) => { const s = h('div', { className: `swatch ${it.kind === 'frame' ? it.value : ''}` }, it.kind === 'frame' ? 'You' : it.kind === 'badge' ? it.value : profile.displayName.slice(0, 8)); if (it.kind === 'name_color') s.style.setProperty('color', it.value); return s; };
      return [h('div', { className: 'owner-grid' }, h('div', { className: 'stat' }, h('b', {}, String(shop.balance)), shop.currency)),
        h('p', { className: 'help' }, `Earn ${shop.currency} with a daily check-in. Cosmetics never unlock features, and they are always labelled as cosmetic.`),
        h('button', { className: 'primary', type: 'button', onclick: async () => { try { await api('/api/sparks/daily', { body: {} }); confetti(); } catch (e) { fail(e); } showStudio(6); } }, 'Claim daily reward'), h('h3', {}, 'Shop'),
        ...shop.items.map((it) => h('div', { className: 'prow' }, preview(it), h('span', { className: 'meta' }, h('b', {}, it.name), h('small', {}, `${it.description} · ${it.kind.replace('_', ' ')}`)),
          !it.owned ? h('button', { className: 'primary small', type: 'button', onclick: async () => { await api('/api/shop/buy', { body: { item: it.id } }).catch(fail); showStudio(6); } }, `${it.price}`) : h('button', { className: 'ghost', type: 'button', onclick: async () => { await api(it.equipped ? '/api/shop/unequip' : '/api/shop/equip', { body: { item: it.id, kind: it.kind } }); showStudio(6); } }, it.equipped ? 'Unequip' : 'Equip')))]; }],
    ['Account', 'gear', () => [h('h3', {}, 'Birthday'), form(async (v) => { await api('/api/birthday', { body: { month: Number(v.month), day: Number(v.day) } }); toast('Saved', { ic: 'check' }); }, h('div', { className: 'field-row' }, field('month', 'Month (1–12)', { type: 'number', min: 1, max: 12, required: true }), field('day', 'Day', { type: 'number', min: 1, max: 31, required: true }), h('button', { className: 'primary', type: 'submit' }, 'Save'))),
      h('h3', {}, 'Sign out'), h('button', { className: 'ghost', type: 'button', onclick: () => nav.logout() }, 'Log out'),
      state.role === 'owner' ? '' : h('div', {}, h('h3', {}, 'Delete account'), h('p', { className: 'help' }, 'Permanently deletes your account, messages and files.'), h('button', { className: 'danger', type: 'button', onclick: async () => { const r = await ask({ title: 'Delete your account?', text: 'This cannot be undone.', fields: [{ name: 'password', label: 'Confirm your password', type: 'password' }], ok: 'Delete forever', danger: true }); if (!r) return; try { await api('/api/account/delete', { body: { password: r.password } }); location.reload(); } catch (e) { fail(e); } } }, 'Delete my account'))]],
  ];
  show(h('h2', {}, iconNode('studio', 22), 'Studio'), tabs(defs, start));
}
const PRESET_IDS = () => ({ aurora: 1, ember: 1, tide: 1, moss: 1, dusk: 1, rose: 1, slate: 1, sun: 1, ink: 1, mint: 1, plum: 1, sky: 1 });
nav.showStudio = showStudio;
