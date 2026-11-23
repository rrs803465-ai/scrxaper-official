import { $, h, state, api, nav, sq, icon, iconNode, avatarEl, toast, fail, timeOf, dayLabel, fmtSize, linkify, confirmBox, menu, show, closePanel, panel } from './ui.js';
import { messagePing, playSound, BUILTIN_TONES } from './audio.js';

const REACTS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👀'];
const scopeOf = () => (state.channel ? 'channel' : state.group ? 'group' : 'dm');
const muteKey = () => (state.channel ? `channel:${state.channel}` : state.group ? `group:${state.group}` : state.peer ? `dm:${state.peer}` : null);
let last = null; let pending = null; let typingTimer = 0; let lastTypingSent = 0;
export const getPending = () => pending;

/* ---------- lists ---------- */
export function renderConversations(list) {
  $('conversations').replaceChildren(...list.map((c) => {
    const btn = h('button', { type: 'button', 'aria-current': String(state.peer === c.username), onclick: () => openThread(c.username) },
      avatarEl(c.avatar, c.displayName, 40), h('span', { className: 'name', textContent: c.displayName }),
      h('span', { className: 'snippet', textContent: (c.mine ? 'You: ' : '') + (c.kind === 'post' ? 'Shared a post' : c.kind === 'call' ? c.body : c.body || 'Attachment') }),
      c.unread ? h('span', { className: 'badge', textContent: c.unread }) : '');
    return h('li', {}, btn);
  }));
  $('list-empty').hidden = list.length > 0;
}
export async function refreshGroups() {
  const groups = await api('/api/groups');
  $('groups').replaceChildren(...groups.map((g) => h('li', {}, h('button', { type: 'button', 'aria-current': String(state.group === g.id), onclick: () => openGroup(g.id) },
    avatarEl(g.icon, g.name, 40, true), h('span', { className: 'name', textContent: g.name }), h('span', { className: 'snippet', textContent: `${g.members} members${g.body ? ` · ${g.body}` : ''}` })))));
}
export const refreshConversations = () => api('/api/conversations').then(renderConversations);
export const refreshHome = () => Promise.all([refreshConversations(), refreshGroups()]);

/* ---------- header ---------- */
function setHead({ pfp, title, sub, actions = [] }) {
  $('peer-pfp').replaceChildren(pfp);
  $('peer-name').textContent = title;
  const s = $('peer-sub'); s.textContent = sub ?? ''; s.className = '';
  $('head-actions').replaceChildren(...actions);
}
function resetThread() {
  $('messages').replaceChildren(); last = null; pending = null; clearAttach(); $('typing').textContent = '';
  $('thread-error').textContent = ''; $('app').classList.add('reading');
  document.querySelector('.thread').classList.add('open');
}
export function closeThread() {
  state.peer = state.group = state.channel = null;
  $('app').classList.remove('reading'); $('composer').hidden = true; document.querySelector('.thread').classList.remove('open');
  $('peer-name').textContent = 'Select a conversation'; $('peer-sub').textContent = ''; $('peer-pfp').replaceChildren(); $('head-actions').replaceChildren(); $('messages').replaceChildren();
  $('app').classList.remove('members-open');
}
$('back').replaceChildren(iconNode('back', 20));
$('back').addEventListener('click', closeThread);
$('attach').replaceChildren(iconNode('attach', 20));
$('send-btn').replaceChildren(iconNode('send', 20));

const moreMenu = (anchor) => {
  const k = muteKey(); if (!k) return;
  const muted = state.mutes.has(k);
  const items = [[muted ? 'Unmute' : 'Mute notifications', muted ? 'sound' : 'mute', toggleMute], ['Notification sound', 'music', tonePicker]];
  if (state.peer && state.peer !== 'scrxaper') {
    items.push(['View profile', 'me', () => nav.openProfile(state.peer)], [state.blocked ? 'Unblock' : 'Block', 'lock', toggleBlock, { warn: true }]);
  }
  if (state.group) items.push(['Leave group', 'logout', async () => { if (await confirmBox('Leave this group?', 'You can rejoin with an invite.', 'Leave', true)) { await api('/api/group-leave', { body: { group: state.group } }); closeThread(); refreshGroups(); } }, { warn: true }]);
  menu(anchor, items);
};
async function toggleMute() {
  const k = muteKey(); const [kind, target] = k.split(':'); const muted = !state.mutes.has(k);
  await api('/api/mute', { body: { kind, target, muted } });
  if (muted) state.mutes.add(k); else state.mutes.delete(k);
  toast(muted ? 'Notifications muted' : 'Notifications on', { ic: muted ? 'mute' : 'sound' });
}
async function toggleBlock() {
  state.blocked = !state.blocked;
  await api('/api/block', { body: { username: state.peer, blocked: state.blocked } });
  toast(state.blocked ? `Blocked @${state.peer}` : `Unblocked @${state.peer}`); refreshConversations();
}
async function tonePicker() {
  const k = muteKey(); const [kind, target] = k.split(':');
  const customs = await api('/api/sounds');
  const options = [['default', 'Default'], ...BUILTIN_TONES.filter(([id]) => ['chime', 'drop', 'pluck', 'soft', 'none'].includes(id)), ...customs.map((s) => [`custom:${s.id}`, s.label ?? 'Custom'])];
  const current = () => state.sound.overrides.find((o) => o.kind === kind && String(o.target) === target)?.tone ?? 'default';
  const grid = h('div', { className: 'tiles' });
  const paint = () => grid.replaceChildren(...options.map(([id, label]) => h('button', { type: 'button', className: 'tile', 'aria-pressed': String(current() === id), onclick: async () => {
    try { state.sound = await api('/api/sound/override', { body: { kind, target, tone: id } }); playSound(id === 'default' ? state.sound.tone : id, state.sound.volume); paint(); } catch (e) { fail(e); } } }, iconNode('music', 20), h('span', {}, label))));
  paint(); show(h('h2', {}, 'Sound for this chat'), h('p', { className: 'help' }, 'Plays when a message arrives here. Pick “Default” to use your general message sound.'), grid);
}

/* ---------- attachments ---------- */
function clearAttach() { pending = null; $('attach-chip').hidden = true; $('attach-chip').replaceChildren(); }
export function attachFile(file) {
  if (!file) return;
  const bar = h('i'); const chip = $('attach-chip');
  chip.hidden = false;
  chip.replaceChildren(iconNode('file', 18), h('span', {}, `${file.name.slice(0, 28)} · ${fmtSize(file.size)}`), h('span', { className: 'bar' }, bar), sq('x', 'Remove attachment', () => { xhr.abort(); clearAttach(); }, 'small'));
  const xhr = new XMLHttpRequest();
  xhr.open('POST', `/api/upload?kind=attachment&name=${encodeURIComponent(file.name)}`);
  xhr.setRequestHeader('X-Requested-With', 'scrxaper'); xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) bar.style.setProperty('width', `${(e.loaded / e.total) * 100}%`); };
  xhr.onload = () => { let d = {}; try { d = JSON.parse(xhr.responseText); } catch { /* not json */ } if (xhr.status === 201) { pending = d.id; bar.style.setProperty('width', '100%'); } else { clearAttach(); $('thread-error').textContent = d.error || 'Upload failed.'; } };
  xhr.onerror = () => { clearAttach(); $('thread-error').textContent = 'Upload failed.'; };
  xhr.send(file);
}
$('attach').addEventListener('click', () => $('attach-file').click());
$('attach-file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; attachFile(f); });
const thread = document.querySelector('.thread');
let dragDepth = 0;
thread.addEventListener('dragenter', (e) => { if (!e.dataTransfer?.types.includes('Files') || $('composer').hidden) return; dragDepth++; $('drop').hidden = false; });
thread.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop').hidden = true; });
thread.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
thread.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; $('drop').hidden = true; if (!$('composer').hidden && e.dataTransfer.files[0]) attachFile(e.dataTransfer.files[0]); });
$('composer').addEventListener('paste', (e) => { const f = [...(e.clipboardData?.files ?? [])][0]; if (f) { e.preventDefault(); attachFile(f); } });

/* ---------- sending ---------- */
$('composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = e.target.elements.body; const body = input.value.trim();
  if (!body && !pending) return;
  if (!$('attach-chip').hidden && !pending) { $('thread-error').textContent = 'Wait for the upload to finish.'; return; }
  $('thread-error').textContent = '';
  try {
    await (state.channel ? api('/api/channel-messages', { body: { channel: state.channel, body, attachment: pending } })
      : state.group ? api('/api/group-messages', { body: { group: state.group, body, attachment: pending } }) : api('/api/messages', { body: { to: state.peer, body, attachment: pending } }));
    input.value = ''; clearAttach();
  } catch (err) { $('thread-error').textContent = err.message; }
});
$('composer').elements.body.addEventListener('input', () => {
  if (Date.now() - lastTypingSent < 3000) return;
  lastTypingSent = Date.now();
  const b = state.channel ? { channel: state.channel } : state.group ? { group: state.group } : state.peer && state.peer !== 'scrxaper' ? { to: state.peer } : null;
  if (b) api('/api/typing', { body: b }).catch(() => {});
});
$('new-chat').addEventListener('submit', (e) => { e.preventDefault(); const to = e.target.elements.to.value.trim().toLowerCase(); if (to) openThread(to).then(() => e.target.reset()); });

/* ---------- message rendering ---------- */
const fileNode = (m, el) => {
  const f = m.file; if (!f) return h('img', { src: `/files/${m.attachment}`, alt: 'Attachment', loading: 'lazy', className: 'shot' });
  const url = `/files/${f.id}`;
  if (/^image\/(png|jpeg|gif|webp)$/.test(f.mime)) { const img = h('img', { src: url, alt: f.name ?? 'Image', loading: 'lazy', className: 'shot', onclick: () => nav.lightbox(url) }); img.addEventListener('load', () => keepBottom(el)); return img; }
  if (/^video\//.test(f.mime)) return h('video', { src: url, controls: true, preload: 'metadata', className: 'shot', playsInline: true });
  if (/^audio\//.test(f.mime)) return h('audio', { src: url, controls: true, preload: 'none' });
  return h('a', { className: 'filecard', href: url, download: f.name || 'file' }, h('span', { className: 'fic' }, iconNode('file', 20)), h('span', { className: 'meta' }, h('b', {}, f.name || 'File'), h('small', {}, fmtSize(f.size))), iconNode('download', 18));
};
const keepBottom = (el) => { const box = $('messages'); if (box.scrollHeight - box.scrollTop - box.clientHeight < 400) el.scrollIntoView({ block: 'end' }); };

function postCard(m) {
  const card = h('button', { type: 'button', className: 'postcard' }, h('small', {}, 'Shared post'));
  api(`/api/post?id=${encodeURIComponent(m.body)}`).then((p) => {
    card.replaceChildren(p.kind === 'reel' ? h('video', { src: `/files/${p.media}`, muted: true, preload: 'metadata' }) : h('img', { src: `/files/${p.media}`, alt: '', loading: 'lazy' }),
      h('b', {}, p.author?.name ?? p.name ?? p.username ?? ''), h('small', {}, (p.caption || '').slice(0, 80)));
    card.onclick = () => nav.openPost(p.id);
  }).catch(() => card.replaceChildren(h('small', {}, 'This post is no longer available.')));
  return card;
}
function musicCard(m) {
  let info = {}; try { info = JSON.parse(m.body); } catch { /* ignore */ }
  const card = h('div', { className: 'musiccard' }); let audio = null;
  const btn = sq('play', 'Play track', () => {
    if (!audio) { audio = new Audio(`/files/${info.track}`); audio.onended = () => { card.classList.remove('playing'); btn.replaceChildren(iconNode('play', 20)); }; }
    if (audio.paused) { document.querySelectorAll('.musiccard.playing .sq').forEach((b) => b.click()); audio.play(); card.classList.add('playing'); btn.replaceChildren(iconNode('pause', 20)); } else { audio.pause(); card.classList.remove('playing'); btn.replaceChildren(iconNode('play', 20)); }
  });
  card.append(btn, h('div', { style: { flex: '1', 'min-width': '0' } }, h('b', {}, info.title ?? 'Track'), h('small', { style: { display: 'block', color: 'var(--muted)' } }, 'Music bot')), h('span', { className: 'eq' }, h('i'), h('i'), h('i')));
  return card;
}

export function appendMessage(m, { batch = false } = {}) {
  const scope = scopeOf(); const kind = m.kind && m.kind !== 'text' ? m.kind : '';
  const box = $('messages');
  const day = new Date(m.at).toDateString();
  if (last?.day !== day) box.append(h('div', { className: 'day' }, dayLabel(m.at)));
  const special = ['call', 'card', 'announcement'].includes(kind);
  const cont = !special && state.ui.grouping !== false && last && last.day === day && last.from === m.from && !last.special && m.at - last.at < 300000 && !!last.bot === !!m.bot;
  const el = h('div', { className: `msg${m.mine ? ' mine' : ''}${kind ? ` ${kind}` : ''}${cont ? ' cont' : ''}` });
  el.dataset.id = m.id;
  const showPfp = !m.mine && m.name && !special;
  if (showPfp) { el.classList.add('with-pfp'); if (!cont) el.append(Object.assign(avatarEl(m.avatar, m.name, 32), { onclick: () => nav.openProfile(m.from) })); }
  const body = h('div', { className: 'body' });
  if (!m.mine && m.name && !cont && !special) body.append(h('div', { className: 'who', onclick: () => nav.openProfile(m.from) }, m.name, m.bot ? h('span', { className: 'bot-tag' }, 'BOT') : ''));
  if (kind === 'call') {
    const missed = /missed|declined|no answer/i.test(m.body);
    el.append(h('span', { className: `callpill${missed ? ' missed' : ''}` }, iconNode(/video/i.test(m.body) ? 'video' : 'phone', 16), h('span', {}, m.body), h('time', {}, timeOf(m.at))));
  } else {
    if (m.attachment) body.append(fileNode(m, el));
    if (kind === 'post') body.append(postCard(m));
    else if (kind === 'music') body.append(musicCard(m));
    else if (m.body) { const t = h('span', { className: 'text' }); t.append(linkify(m.body)); body.append(t); }
    body.append(h('time', {}, timeOf(m.at)));
    el.append(body);
    const tools = h('div', { className: 'tools' }, sq('smile', 'React', (e) => menu(e.currentTarget, [], { picker: { list: REACTS, pick: (emoji) => react(m.id, emoji) } }), 'small'));
    if (m.body) tools.append(sq('link', 'Copy text', () => navigator.clipboard?.writeText(m.body).then(() => toast('Copied', { ic: 'check' })), 'small'));
    if (scope === 'channel' && (m.mine || state.canModerate)) tools.append(sq('trash', 'Delete message', () => api('/api/channel-message-delete', { body: { channel: state.channel, id: m.id } }).catch(fail), 'small danger-sq'));
    el.append(tools);
    el.addEventListener('click', (e) => { if (matchMedia('(max-width: 760px)').matches && !e.target.closest('a,button,img,video,audio,.postcard')) { document.querySelectorAll('.tools-open').forEach((x) => x !== el && x.classList.remove('tools-open')); el.classList.toggle('tools-open'); } });
  }
  box.append(el);
  last = { from: m.from, at: m.at, day, special, bot: m.bot };
  if (!batch) el.scrollIntoView({ block: 'end' });
  return el;
}
const react = (id, emoji) => api('/api/reactions', { body: { scope: scopeOf(), id, emoji } }).catch(fail);
export function renderReactions(id, list) {
  const el = document.querySelector(`.msg[data-id="${id}"]`); if (!el) return;
  el.querySelector('.rx')?.remove();
  if (!list?.length) return;
  el.append(h('div', { className: 'rx' }, ...list.map((r) => h('button', { type: 'button', className: r.users.includes(state.meId) ? 'mine' : '', title: `${r.n}`, onclick: () => react(id, r.emoji) }, `${r.emoji} ${r.n}`))));
}
async function loadReactions(scope, messages) {
  const ids = messages.filter((m) => m.kind !== 'call').map((m) => m.id).slice(-60);
  if (!ids.length) return;
  try { const map = await api(`/api/reactions?scope=${scope}&ids=${ids.join(',')}`); for (const [id, list] of Object.entries(map)) renderReactions(id, list); } catch { /* reactions are optional */ }
}
function renderAll(messages) { messages.forEach((m) => appendMessage(m, { batch: true })); const box = $('messages'); box.style.setProperty('scroll-behavior', 'auto'); box.scrollTop = box.scrollHeight; requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; box.style.removeProperty('scroll-behavior'); }); }

/* ---------- opening conversations ---------- */
const headBtns = (...list) => list.filter(Boolean);
const callBtns = () => [sq('phone', 'Voice call', () => nav.startCall(false)), sq('video', 'Video call', () => nav.startCall(true))];
const membersBtn = () => sq('users', 'Members', () => toggleMembers(), state.membersOpen ? 'on' : '');
const moreBtn = () => { const b = sq('more', 'More', () => moreMenu(b)); return b; };

export async function openThread(username) {
  try {
    const { peer, messages } = await api(`/api/messages?with=${encodeURIComponent(username)}`);
    state.peer = peer.username; state.group = state.channel = null; state.canModerate = false; state.peerAvatar = peer.avatar;
    resetThread(); $('app').classList.remove('members-open');
    const sys = peer.username === 'scrxaper';
    setHead({ pfp: avatarEl(peer.avatar, peer.display_name, 38), title: peer.display_name, sub: `@${peer.username}`, actions: sys ? [] : [...callBtns(), moreBtn()] });
    renderAll(messages); loadReactions('dm', messages);
    $('composer').hidden = sys;
    api('/api/conversations').then((list) => { state.blocked = !!list.find((c) => c.username === peer.username)?.blocked; renderConversations(list); });
    if (!sys) api(`/api/profile?user=${peer.username}`).then((p) => {
      if (state.peer !== peer.username) return;
      const s = $('peer-sub'); s.textContent = p.online ? 'online' : `@${peer.username}`; s.classList.toggle('online', !!p.online);
      state.peerFriend = p.friendState;
      if (p.friendState === 'none') $('head-actions').prepend(sq('useradd', 'Add friend', async (e) => { try { await api('/api/friends/request', { body: { username: peer.username } }); toast('Friend request sent', { ic: 'check' }); e.currentTarget.remove(); } catch (er) { fail(er); } }));
    }).catch(() => {});
    if (!matchMedia('(max-width: 760px)').matches) $('composer').elements.body.focus();
  } catch (err) { $('thread-error').textContent = err.status === 404 ? `No user called “${username}”.` : err.message; }
}
export async function openGroup(id) {
  try {
    const data = await api(`/api/group-messages?group=${id}`);
    state.group = id; state.peer = state.channel = null; state.groupRole = data.role; state.groupData = data; state.canModerate = data.role === 'admin';
    resetThread();
    setHead({ pfp: avatarEl(data.group.icon, data.group.name, 38, true), title: data.group.name, sub: `${data.members.length} members`,
      actions: headBtns(sq('phone', 'Group call', () => nav.joinVoice({ group: id })), membersBtn(), sq('gear', 'Group settings', () => nav.showGroupInfo()), moreBtn()) });
    renderAll(data.messages); loadReactions('group', data.messages);
    $('composer').hidden = false; refreshGroups(); if (state.membersOpen) renderMembers();
  } catch (err) { $('thread-error').textContent = err.message; refreshGroups(); }
}
export async function openChannel(id, community) {
  const data = await api(`/api/channel-messages?channel=${id}`);
  state.channel = id; state.peer = state.group = null; state.canModerate = data.canModerate;
  resetThread();
  setHead({ pfp: h('span', { className: 'sq', style: { '--sq': '38px' } }, iconNode('hash', 20)), title: data.channel.name, sub: data.channel.topic || community?.name || '', actions: headBtns(membersBtn(), moreBtn()) });
  renderAll(data.messages); loadReactions('channel', data.messages);
  $('composer').hidden = !data.canPost; if (!data.canPost) $('thread-error').textContent = 'You cannot post in this channel.';
  nav.channelOpened?.(id); if (state.membersOpen) renderMembers();
  return data;
}

/* ---------- members column ---------- */
export function toggleMembers(force) {
  state.membersOpen = force ?? !state.membersOpen;
  $('app').classList.toggle('members-open', state.membersOpen);
  document.querySelectorAll('#head-actions .sq').forEach((b) => { if (b.title === 'Members') b.classList.toggle('on', state.membersOpen); });
  if (state.membersOpen) renderMembers();
}
export function renderMembers() {
  const box = $('members'); let rows = [];
  if (state.channel && state.community) rows = state.community.members ?? [];
  else if (state.group && state.groupData) rows = state.groupData.members.map((m) => ({ ...m, role: m.role }));
  const groups = {}; rows.forEach((m) => (groups[m.customRole || m.role || 'member'] ??= []).push(m));
  box.replaceChildren(h('div', { style: { display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', padding: '4px 8px' } }, h('strong', {}, 'Members'), sq('x', 'Close members', () => toggleMembers(false), 'small')),
    ...Object.entries(groups).flatMap(([role, list]) => [h('h4', {}, `${role} · ${list.length}`), ...list.map((m) => h('button', { type: 'button', className: 'mrow', onclick: () => nav.openProfile(m.username) },
      avatarEl(m.avatar, m.name ?? m.displayName, 32), h('span', {}, m.name ?? m.displayName, h('small', {}, `@${m.username}${m.timedOut ? ' · timed out' : ''}`))))]));
}

/* ---------- live events ---------- */
export function bindChatEvents(es) {
  const mine = (m) => ({ ...m, mine: m.from === state.me });
  const note = (kind, target, title, body) => { messagePing(kind, target); nav.systemNotify?.(kind, target, title, body); };
  es.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.from !== state.me) note(m.group ? 'group' : 'dm', m.group ?? m.from, m.name ?? m.from, m.kind === 'post' ? 'Shared a post' : m.body || 'Attachment');
    if (m.group) { if (m.group === state.group && !document.querySelector(`[data-id="${m.id}"]`)) appendMessage(mine(m)); return refreshGroups(); }
    const peer = m.to ?? m.from;
    if (peer === state.peer && !document.querySelector(`[data-id="${m.id}"]`)) { appendMessage(mine(m)); if (m.from !== state.me) api(`/api/messages?with=${peer}`).then(refreshConversations); }
    refreshConversations();
  });
  es.addEventListener('channel-message', (e) => {
    const m = JSON.parse(e.data);
    if (m.from !== state.me) note('channel', m.channel, m.name, m.body);
    if (m.channel === state.channel && !document.querySelector(`[data-id="${m.id}"]`)) appendMessage(mine(m));
  });
  es.addEventListener('channel-delete', (e) => { const m = JSON.parse(e.data); if (m.channel === state.channel) document.querySelector(`[data-id="${m.id}"]`)?.remove(); });
  es.addEventListener('group', (e) => { const g = JSON.parse(e.data); refreshGroups(); if (g.id === state.group) openGroup(g.id).catch(() => {}); });
  es.addEventListener('reaction', (e) => { const r = JSON.parse(e.data); if (r.scope === scopeOf()) renderReactions(r.id, r.reactions); });
  es.addEventListener('typing', (e) => {
    const t = JSON.parse(e.data);
    const here = (t.scope === 'dm' && state.peer === t.from) || (t.scope === 'group' && state.group === t.id) || (t.scope === 'channel' && state.channel === t.id);
    if (!here) return;
    $('typing').textContent = `${t.name} is typing`; clearTimeout(typingTimer); typingTimer = setTimeout(() => { $('typing').textContent = ''; }, 4000);
  });
  es.addEventListener('presence', (e) => { const p = JSON.parse(e.data); if (state.peer === p.username) { const s = $('peer-sub'); s.textContent = p.online ? 'online' : `@${p.username}`; s.classList.toggle('online', p.online); } nav.presence?.(p); });
}

/* ---------- search ---------- */
$('search').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = e.target.elements.q.value.trim(); if (q.length < 2) return;
  if (q.startsWith('#')) return nav.openHashtag(q.slice(1));
  try {
    const r = await api(`/api/search?q=${encodeURIComponent(q)}`);
    const row = (title, sub, fn) => h('button', { type: 'button', className: 'nrow', onclick: () => { closePanel(); fn(); } }, h('div', { className: 'ntext' }, title, h('small', {}, sub)));
    const sec = (t, rows) => (rows.length ? [h('h3', {}, t), ...rows] : []);
    const openers = { dm: (m) => openThread(m.target), group: (m) => openGroup(Number(m.target)), channel: (m) => nav.openChannelById(Number(m.target)) };
    const all = [...sec('People', r.people.map((p) => row(p.name, `@${p.username}`, () => openThread(p.username)))), ...sec('Groups', r.groups.map((g) => row(g.name, 'Group', () => openGroup(g.id)))),
      ...sec('Communities', r.communities.map((c) => row(c.name, 'Community', () => nav.openCommunity(c.id)))), ...sec('Channels', r.channels.map((c) => row(`# ${c.name}`, c.community, () => nav.openChannelById(c.id)))),
      ...sec('Messages', r.messages.map((m) => row(m.body.slice(0, 90), `${m.where_} · ${new Date(m.at).toLocaleDateString()}`, () => openers[m.kind](m))))];
    show(h('h2', {}, `Results for “${q}”`), ...(all.length ? all : [h('p', { className: 'empty' }, 'Nothing found in the places you can see.')]));
  } catch (err) { fail(err); }
});

Object.assign(nav, { openThread, openGroup, openChannel });
