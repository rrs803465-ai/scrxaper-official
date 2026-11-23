import { $, h, state, api, upload, iconNode, avatarEl, toast, fail, confetti, pickFile, sq } from './ui.js';
import { PRESETS } from './ui.js';
import { applyPrefs, applyUi } from './studio.js';
import { editPhoto } from './editor.js';
import { enablePush, canInstall, installApp, pushSupported } from './push.js';

const INTERESTS = ['music', 'gaming', 'art', 'photography', 'sports', 'tech', 'movies', 'books', 'travel', 'food', 'fitness', 'anime', 'fashion', 'science', 'memes', 'writing'];
const ACCENTS = ['#b7c9e6', '#8fb8ff', '#b79cff', '#ff9ec4', '#ffb27a', '#8fe3b4', '#7fe0e8', '#f2d27a'];

export function runOnboarding(done) {
  const root = $('onboard'); root.hidden = false;
  const d = { displayName: state.displayName, pronouns: '', avatarPreset: null, interests: new Set(), theme: state.prefs?.theme ?? 'dark', accent: state.prefs?.accent ?? ACCENTS[0], bubble: state.ui?.bubble ?? 'round', whoCanMessage: 'everyone', privateAccount: false, bio: '', month: '', day: '' };
  let step = 0; const last = 5;
  const finish = async () => {
    try {
      await api('/api/onboarding', { body: { displayName: d.displayName, pronouns: d.pronouns, bio: d.bio, interests: [...d.interests], theme: d.theme, accent: d.accent, privateAccount: d.privateAccount, whoCanMessage: d.whoCanMessage, avatarPreset: d.avatarPreset, birthday: d.month && d.day ? { month: Number(d.month), day: Number(d.day) } : undefined } });
      await api('/api/ui', { body: { ui: { ...state.ui, bubble: d.bubble } } });
      root.hidden = true; root.replaceChildren(); confetti(); done();
    } catch (e) { fail(e); }
  };
  const skip = () => { d.interests.clear(); finish(); };
  const chips = (items, selected, toggle) => { const wrap = h('div', { className: 'chipset' }); const paint = () => wrap.replaceChildren(...items.map((i) => h('button', { type: 'button', 'aria-pressed': String(selected(i)), onclick: () => { toggle(i); paint(); } }, i))); paint(); return wrap; };
  const seg = (items, get, set) => { const wrap = h('div', { className: 'seg' }); const paint = () => wrap.replaceChildren(...items.map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(get() === v), onclick: () => { set(v); paint(); } }, l))); paint(); return wrap; };
  const pages = [
    () => ({ title: 'Welcome to Scrxaper', body: [h('p', { className: 'help' }, 'Let’s set up your space. Everything here can be changed later in Studio.'),
      h('label', {}, 'What should we call you?', h('input', { value: d.displayName, maxLength: 40, ariaLabel: 'Display name', oninput: (e) => { d.displayName = e.target.value; } })),
      h('label', {}, 'Pronouns (optional)', h('input', { value: d.pronouns, maxLength: 24, ariaLabel: 'Pronouns', oninput: (e) => { d.pronouns = e.target.value; } }))] }),
    () => { const big = h('div', { className: 'ob-pfp' }); const paint = () => big.replaceChildren(avatarEl(d.avatarPreset ? `preset:${d.avatarPreset}` : state.avatar, d.displayName, 110));
      const grid = h('div', { className: 'logo-grid' }); const paintGrid = () => grid.replaceChildren(...Object.keys(PRESETS).map((id) => h('button', { type: 'button', className: 'logo-pick', title: id, 'aria-pressed': String(d.avatarPreset === id), onclick: () => { d.avatarPreset = id; paint(); paintGrid(); } }, avatarEl(`preset:${id}`, id, 64))));
      paint(); paintGrid();
      return { title: 'Pick your picture', body: [big, grid, h('button', { className: 'ghost', type: 'button', onclick: () => pickFile('image/png,image/jpeg,image/gif,image/webp', async (picked) => { const f = picked.type === 'image/gif' ? picked : await editPhoto(picked, { aspect: '1:1' }); if (!f) return; try { await upload('avatar', f); const me = await api('/api/me'); state.avatar = me.avatar; d.avatarPreset = null; paint(); paintGrid(); } catch (e) { fail(e); } }) }, 'Upload your own photo')] }; },
    () => { const extra = h('input', { placeholder: 'Add your own and press Enter', maxLength: 24, ariaLabel: 'Add interest', onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); const v = extra.value.trim().toLowerCase(); if (v) { d.interests.add(v); extra.value = ''; render(); } } } });
      return { title: 'What are you into?', body: [h('p', { className: 'help' }, 'We use this to suggest people and hashtags. Pick a few.'), chips([...new Set([...INTERESTS, ...d.interests])], (i) => d.interests.has(i), (i) => { if (d.interests.has(i)) d.interests.delete(i); else d.interests.add(i); }), extra] }; },
    () => ({ title: 'Make it yours', body: [h('b', {}, 'Theme'), seg([['dark', 'Dark'], ['light', 'Light'], ['system', 'System']], () => d.theme, (v) => { d.theme = v; applyPrefs({ ...state.prefs, theme: v }); }),
      h('b', {}, 'Accent colour'), (() => { const row = h('div', { className: 'swatches' }); const p = () => row.replaceChildren(...ACCENTS.map((c) => { const b = h('button', { type: 'button', className: 'swatch-dot', ariaLabel: c, 'aria-pressed': String(d.accent === c), onclick: () => { d.accent = c; document.documentElement.style.setProperty('--accent', c); p(); } }); b.style.setProperty('background', c); return b; })); p(); return row; })(),
      h('b', {}, 'Chat bubbles'), seg([['round', 'Round'], ['soft', 'Soft'], ['square', 'Square'], ['minimal', 'Minimal']], () => d.bubble, (v) => { d.bubble = v; applyUi({ ...state.ui, bubble: v }); })] }),
    () => ({ title: 'Who can reach you?', body: [h('b', {}, 'Direct messages'), seg([['everyone', 'Everyone'], ['groups', 'Shared spaces'], ['friends', 'Friends only'], ['nobody', 'Nobody new']], () => d.whoCanMessage, (v) => { d.whoCanMessage = v; }),
      h('label', { className: 'toggle' }, 'Private account (people must request to follow you)', h('input', { type: 'checkbox', checked: d.privateAccount, onchange: (e) => { d.privateAccount = e.target.checked; } }))] }),
    () => ({ title: 'Almost done', body: [h('label', {}, 'Short bio (optional)', h('textarea', { maxLength: 200, ariaLabel: 'Bio', value: d.bio, oninput: (e) => { d.bio = e.target.value; } })),
      h('div', { className: 'field-row' }, h('input', { type: 'number', min: 1, max: 12, placeholder: 'Birthday month', ariaLabel: 'Birthday month', value: d.month, oninput: (e) => { d.month = e.target.value; } }), h('input', { type: 'number', min: 1, max: 31, placeholder: 'Day', ariaLabel: 'Birthday day', value: d.day, oninput: (e) => { d.day = e.target.value; } })),
      pushSupported() ? h('button', { className: 'ghost', type: 'button', onclick: async () => { try { await enablePush(); toast('Background notifications are on', { ic: 'bell' }); } catch (e) { fail(e); } } }, 'Turn on call and message alerts') : '',
      canInstall() ? h('button', { className: 'ghost', type: 'button', onclick: () => installApp() }, 'Install the app') : ''] }),
  ];
  function render() {
    const p = pages[step]();
    root.replaceChildren(h('div', { className: 'ob-card' }, h('div', { className: 'steps' }, ...pages.map((_, i) => h('i', { className: i <= step ? 'on' : '' }))),
      h('div', { className: 'ob-step' }, h('h2', {}, p.title), ...p.body, h('div', { className: 'ob-actions' }, step ? h('button', { className: 'link', type: 'button', onclick: () => { step--; render(); } }, 'Back') : h('button', { className: 'link', type: 'button', onclick: skip }, 'Skip for now'),
        h('button', { className: 'primary', type: 'button', onclick: () => { if (step === 0 && !d.displayName.trim()) return toast('Please enter a name.', { kind: 'error' }); if (step === last) finish(); else { step++; render(); } } }, step === last ? 'Finish' : 'Continue')))));
  }
  render();
}
