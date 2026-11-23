import { icon, iconNode } from './icons.js';
export { icon, iconNode };

export const $ = (id) => document.getElementById(id);
export const state = { me: null, displayName: '', avatar: null, role: 'user', perms: [], peer: null, group: null, channel: null, community: null, events: null,
  prefs: null, ui: {}, sound: null, privacy: null, ignored: new Set(), mutes: new Set(), unread: 0, friendRequests: 0, followRequests: 0, registering: false, pending: null };

export async function api(path, options = {}) {
  const res = await fetch(path, { method: options.body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'scrxaper' }, body: options.body && JSON.stringify(options.body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
  return data;
}
export async function upload(kind, blob, query = '', name = '') {
  const r = await fetch(`/api/upload?kind=${kind}${query}${name ? `&name=${encodeURIComponent(name)}` : ''}`, { method: 'POST', headers: { 'X-Requested-With': 'scrxaper', 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Upload failed.');
  return data;
}

export const h = (tag, props = {}, ...kids) => {
  const { style, ...rest } = props;
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(rest)) { if (k.startsWith('aria-') || k.startsWith('data-')) node.setAttribute(k, v); else node[k] = v; }
  if (style) { if (typeof style === 'string') node.style.cssText = style; else for (const [k, v] of Object.entries(style)) node.style.setProperty(k, v); }
  node.append(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
  return node;
};
export const svgNode = (markup) => { const t = document.createElement('template'); t.innerHTML = markup.trim(); return t.content.firstChild; };

/* square icon button */
export const sq = (name, label, onclick, cls = '') => {
  const b = h('button', { type: 'button', className: `sq ${cls}`.trim(), title: label, ariaLabel: label, onclick });
  b.append(iconNode(name, 20));
  return b;
};

/* time helpers */
export const timeOf = (at) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: state.ui?.clock === '12' ? true : state.ui?.clock === '24' ? false : undefined });
export const ago = (at) => { const m = Math.round((Date.now() - at) / 60000); return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
export const dayLabel = (at) => { const d = new Date(at); const t = new Date(); const y = new Date(Date.now() - 864e5);
  return d.toDateString() === t.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }); };
export const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/* preset logos for profile pictures */
export const PRESETS = { aurora: ['#7aa2ff', '#b58cff', 'buddy'], ember: ['#ff9966', '#ff5e62', 'bolt'], tide: ['#5ee7df', '#4a7bd6', 'music'], moss: ['#a8e063', '#2f8f6b', 'heart'],
  dusk: ['#8e7cc3', '#2b2d6e', 'explore'], rose: ['#ffb3c7', '#d6598a', 'smile'], slate: ['#9aa8bd', '#3c4658', 'shield'], sun: ['#ffe28a', '#ff9d3d', 'buddy'],
  ink: ['#4b5563', '#0b0d10', 'hash'], mint: ['#c9fff0', '#38b6a3', 'bot'], plum: ['#d58cff', '#6b2a8f', 'users'], sky: ['#cfe8ff', '#5aa0e6', 'feed'] };
let gid = 0;
export function presetSvg(id, size) {
  const [a, b, ic] = PRESETS[id] ?? PRESETS.slate; const g = `pg${++gid}`;
  const inner = iconNode(ic, 24).innerHTML;
  return svgNode(`<svg viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true"><defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
    <rect width="48" height="48" fill="url(#${g})"/><g transform="translate(12 12)" fill="none" stroke="#fff" stroke-opacity=".92" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</g></svg>`);
}
export function avatarEl(id, name, size = 36, icon_ = false) {
  const wrap = h('span', { className: `pfp${icon_ ? ' icon' : ''}` });
  wrap.style.setProperty('--s', `${size}px`);
  if (id && String(id).startsWith('preset:')) wrap.append(presetSvg(String(id).slice(7), size));
  else if (id) wrap.append(h('img', { src: `/files/${id}`, alt: '', loading: 'lazy' }));
  else wrap.textContent = String(name ?? '?').replace(/^#\s*/, '').slice(0, 1).toUpperCase();
  return wrap;
}

/* toast: bottom of the screen */
export function toast(text, { kind = 'info', ms = 3600, ic } = {}) {
  const host = $('toasts');
  const t = h('div', { className: `toast ${kind}`, role: 'status' }, ic ? iconNode(ic, 18) : '', h('span', {}, text));
  host.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  const out = () => { t.classList.remove('in'); t.classList.add('out'); setTimeout(() => t.remove(), 260); };
  const timer = setTimeout(out, ms);
  t.addEventListener('click', () => { clearTimeout(timer); out(); });
  return t;
}
export const fail = (err) => toast(err?.message ?? String(err), { kind: 'error', ic: 'x' });

/* main panel (modal) with an X at the top */
const panel = $('panel');
export { panel };
let closing = false;
export function closePanel() {
  if (!panel.open || closing) return;
  closing = true; panel.classList.add('closing');
  setTimeout(() => { panel.close(); panel.classList.remove('closing'); closing = false; panel.dispatchEvent(new Event('closed')); }, 180);
}
export function show(...nodes) {
  $('panel-body').replaceChildren(...nodes.flat().filter(Boolean));
  panel.classList.toggle('wide', false);
  if (!panel.open) { panel.showModal(); panel.classList.remove('closing'); }
}
export function showWide(...nodes) { show(...nodes); panel.classList.add('wide'); }
panel.addEventListener('cancel', (e) => { e.preventDefault(); closePanel(); });
panel.addEventListener('click', (e) => { if (e.target === panel) closePanel(); });
$('panel-close').replaceChildren(iconNode('x', 18));
$('panel-close').addEventListener('click', closePanel);

/* confirm / prompt dialogs */
export function ask({ title, text = '', fields = [], ok = 'Continue', danger = false, cancel = 'Cancel' }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { className: 'ask', ariaLabel: title });
    const inputs = fields.map((f) => (f.type === 'textarea' ? h('textarea', { name: f.name, placeholder: f.label, ariaLabel: f.label, value: f.value ?? '', maxLength: f.max ?? 500 })
      : h('input', { name: f.name, placeholder: f.label, ariaLabel: f.label, value: f.value ?? '', type: f.type ?? 'text', maxLength: f.max ?? 200, autocomplete: 'off' })));
    const done = (v) => { dlg.classList.add('closing'); setTimeout(() => { dlg.close(); dlg.remove(); }, 160); resolve(v); };
    const f = h('form', {}, h('h2', {}, title), text ? h('p', { className: 'empty tight' }, text) : '', ...inputs,
      h('div', { className: 'ask-actions' }, h('button', { type: 'button', className: 'link', onclick: () => done(null) }, cancel), h('button', { type: 'submit', className: danger ? 'danger' : 'primary' }, ok)));
    f.addEventListener('submit', (e) => { e.preventDefault(); done(fields.length ? Object.fromEntries(inputs.map((i, n) => [fields[n].name, i.value])) : true); });
    dlg.append(sq('x', 'Close', () => done(null), 'dlg-x'), f);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    document.body.append(dlg); dlg.showModal(); inputs[0]?.focus();
  });
}
export const confirmBox = (title, text, ok = 'Confirm', danger = false) => ask({ title, text, ok, danger }).then(Boolean);
export const promptBox = (title, label, value = '', ok = 'Save') => ask({ title, fields: [{ name: 'v', label, value }], ok }).then((r) => (r ? r.v : null));
/* a message popup with an icon (used for bans and notices) */
export function notice({ title, text, ic = 'shield', ok = 'OK' }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { className: 'ask notice' });
    const go = () => { dlg.classList.add('closing'); setTimeout(() => { dlg.close(); dlg.remove(); resolve(); }, 160); };
    dlg.append(h('div', { className: 'notice-ico' }, iconNode(ic, 34)), h('h2', {}, title), h('p', { className: 'empty tight' }, text), h('button', { className: 'primary', type: 'button', onclick: go }, ok));
    dlg.addEventListener('cancel', (e) => e.preventDefault());
    document.body.append(dlg); dlg.showModal();
  });
}

export const field = (name, placeholder, extra = {}) => h('input', { name, placeholder, ariaLabel: placeholder, autocomplete: 'off', ...extra });
export const form = (onSubmit, ...kids) => {
  const f = h('form', {}, ...kids);
  f.addEventListener('submit', (e) => { e.preventDefault(); Promise.resolve(onSubmit(Object.fromEntries(new FormData(f)), f)).catch(fail); });
  return f;
};
export const pickFile = (accept, onPick) => {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept });
  input.addEventListener('change', () => { if (input.files[0]) onPick(input.files[0]); });
  input.click();
};

/* tabs inside a panel */
export function tabs(defs, start = 0) {
  const body = h('div', { className: 'tab-body' });
  const bar = h('div', { className: 'tabs', role: 'tablist' });
  const buttons = defs.map(([label, ic, render], i) => {
    const b = h('button', { type: 'button', role: 'tab', className: 'tab', onclick: () => select(i) }, iconNode(ic, 16), h('span', {}, label));
    return b;
  });
  bar.append(...buttons);
  let token = 0;
  const select = async (i) => {
    const mine = ++token;
    buttons.forEach((b, n) => b.setAttribute('aria-selected', String(n === i)));
    body.classList.remove('swap'); void body.offsetWidth; body.classList.add('swap');
    const nodes = await defs[i][2]();
    if (mine === token) body.replaceChildren(...[nodes].flat().filter(Boolean));
  };
  select(start);
  return h('div', { className: 'tabbed' }, bar, body);
}

/* a little confetti burst (only when effects are on and motion is allowed) */
export function confetti(x = innerWidth / 2, y = innerHeight / 3) {
  if (state.ui?.effects === false || document.documentElement.dataset.motion === 'reduced') return;
  const c = h('canvas', { className: 'confetti' }); c.width = innerWidth; c.height = innerHeight; document.body.append(c);
  const ctx = c.getContext('2d'); const cols = ['#b7c9e6', '#e8f1ff', '#d6a8ff', '#8fd3ff', '#ffd6a8'];
  const bits = Array.from({ length: 70 }, () => ({ x, y, vx: (Math.random() - 0.5) * 10, vy: -Math.random() * 10 - 3, r: Math.random() * 5 + 2, c: cols[Math.floor(Math.random() * cols.length)], a: Math.random() * 6 }));
  let t = 0;
  (function tick() {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const b of bits) { b.x += b.vx; b.y += b.vy; b.vy += 0.35; b.a += 0.2; ctx.fillStyle = b.c; ctx.globalAlpha = Math.max(0, 1 - t / 90); ctx.fillRect(b.x, b.y, b.r, b.r * 0.6); }
    if (++t < 90) requestAnimationFrame(tick); else c.remove();
  })();
}

export const linkify = (text) => {
  const frag = document.createDocumentFragment();
  String(text).split(/(https?:\/\/[^\s<]+)/g).forEach((part) => {
    if (/^https?:\/\//.test(part)) frag.append(h('a', { href: part, target: '_blank', rel: 'noopener noreferrer nofollow', textContent: part }));
    else frag.append(document.createTextNode(part));
  });
  return frag;
};

export const nav = {};

/* small popover menu anchored to an element; items: [label, icon, fn, {warn}] */
export function menu(anchor, items, { picker } = {}) {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const m = h('div', { className: 'menu', role: 'menu' });
  if (picker) m.append(h('div', { className: 'picker' }, ...picker.list.map((e) => h('button', { type: 'button', textContent: e, onclick: () => { close(); picker.pick(e); } }))));
  for (const [label, ic, fn, opts = {}] of items) m.append(h('button', { type: 'button', role: 'menuitem', className: opts.warn ? 'warn' : '', onclick: () => { close(); fn(); } }, iconNode(ic, 18), h('span', {}, label)));
  document.body.append(m);
  const r = anchor.getBoundingClientRect(); const w = m.offsetWidth; const hgt = m.offsetHeight;
  m.style.setProperty('left', `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8))}px`);
  m.style.setProperty('top', `${r.bottom + 6 + hgt > innerHeight ? Math.max(8, r.top - hgt - 6) : r.bottom + 6}px`);
  const close = () => { m.remove(); document.removeEventListener('pointerdown', away, true); };
  const away = (e) => { if (!m.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener('pointerdown', away, true));
  return close;
}

/* drag-to-reorder with FLIP animation. Mouse: drag after 6px. Touch: long press. */
export function makeSortable(container, { item, handle, onDone, axis = 'y', enabled = () => true }) {
  container.addEventListener('pointerdown', (e) => {
    const el = e.target.closest(item);
    if (!el || !container.contains(el) || !enabled() || (e.button && e.button !== 0)) return;
    if (handle && !e.target.closest(handle)) return;
    let sx = e.clientX; let sy = e.clientY; let dragging = false; let timer = 0;
    const horizontal = (typeof axis === 'function' ? axis() : axis) === 'x';
    const begin = () => { dragging = true; el.classList.add('dragging'); try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ } navigator.vibrate?.(8); };
    if (e.pointerType !== 'mouse') timer = setTimeout(begin, 380);
    const move = (ev) => {
      const dx = ev.clientX - sx; const dy = ev.clientY - sy;
      if (!dragging) { if (Math.hypot(dx, dy) > 6) { if (e.pointerType === 'mouse') begin(); else { cleanup(); } } return; }
      ev.preventDefault();
      el.style.setProperty('transform', `translate(${horizontal ? dx : 0}px, ${horizontal ? 0 : dy}px) scale(1.08)`);
      const r = el.getBoundingClientRect(); const c = horizontal ? r.left + r.width / 2 : r.top + r.height / 2;
      for (const s of [...container.querySelectorAll(item)].filter((x) => x !== el)) {
        const sr = s.getBoundingClientRect(); const sc = horizontal ? sr.left + sr.width / 2 : sr.top + sr.height / 2;
        const sBeforeEl = !!(s.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
        if ((sBeforeEl && c < sc) || (!sBeforeEl && c > sc)) {
          const others = [...container.querySelectorAll(item)].filter((x) => x !== el); const firsts = new Map(others.map((o) => [o, o.getBoundingClientRect()]));
          const was = el.getBoundingClientRect();
          if (sBeforeEl) s.before(el); else s.after(el);
          const now_ = el.getBoundingClientRect();
          sx += now_.left - was.left; sy += now_.top - was.top;
          el.style.setProperty('transform', `translate(${horizontal ? ev.clientX - sx : 0}px, ${horizontal ? 0 : ev.clientY - sy}px) scale(1.08)`);
          for (const o of others) { const f = firsts.get(o); const l = o.getBoundingClientRect(); const ddx = f.left - l.left; const ddy = f.top - l.top; if (!ddx && !ddy) continue;
            o.style.setProperty('transition', 'none'); o.style.setProperty('transform', `translate(${ddx}px, ${ddy}px)`); void o.offsetWidth; o.style.setProperty('transition', 'transform .22s cubic-bezier(.2,.8,.2,1)'); o.style.setProperty('transform', 'none'); }
          break;
        }
      }
    };
    const cleanup = () => { clearTimeout(timer); el.removeEventListener('pointermove', move); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    const up = () => {
      cleanup();
      if (!dragging) return;
      el.style.setProperty('transition', 'transform .2s cubic-bezier(.2,.8,.2,1)'); el.style.setProperty('transform', 'none');
      setTimeout(() => { el.classList.remove('dragging'); el.style.removeProperty('transition'); el.style.removeProperty('transform'); }, 220);
      window.addEventListener('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); }, { capture: true, once: true });
      setTimeout(() => onDone?.([...container.querySelectorAll(item)]), 0);
    };
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  });
}

export function copyText(text) { return navigator.clipboard?.writeText(text).then(() => toast('Copied', { ic: 'check' })).catch(() => toast(text)); }
export function showCode(title, code, note) {
  show(h('h2', {}, title), h('p', { className: 'help' }, note ?? ''), h('div', { className: 'card' }, h('code', { style: { 'font-size': '20px', 'letter-spacing': '.08em', 'word-break': 'break-all' } }, code), h('button', { className: 'primary', type: 'button', onclick: () => copyText(code) }, 'Copy code')));
}
