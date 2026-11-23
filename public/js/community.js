import { $, h, state, api, upload, nav, sq, iconNode, avatarEl, toast, fail, confirmBox, ask, promptBox, show, closePanel, form, field, pickFile, tabs, makeSortable, showCode, copyText, fmtSize, menu } from './ui.js';
import { openChannel, refreshHome, refreshGroups, closeThread, openGroup, toggleMembers } from './chat.js';

const RANKS = { member: 0, moderator: 1, admin: 2, owner: 3 };
const PERMS = ['channels', 'invites', 'kick', 'timeout', 'delete_messages', 'log'];
const BOT_ICONS = { security: 'shield', music: 'music', welcome: 'sparkle', fun: 'sparkle' };
state.communities = []; state.voiceState = {};

/* ---------- server rail ---------- */
const orderKey = 'scrx.serverOrder';
const sortedCommunities = () => { const o = JSON.parse(localStorage.getItem(orderKey) ?? '[]'); return [...state.communities].sort((a, b) => (o.indexOf(a.id) + 1 || 999) - (o.indexOf(b.id) + 1 || 999)); };
export async function refreshCommunities() { state.communities = await api('/api/communities'); renderServers(); }
export function renderServers() {
  const rail = $('servers');
  const home = sq('home', 'Home', () => openHome(), `srv${!state.community ? ' on' : ''}`); home.setAttribute('aria-current', String(!state.community));
  const list = h('div', { className: 'srv-list', style: { display: 'contents' } });
  for (const c of sortedCommunities()) {
    const b = h('button', { type: 'button', className: 'sq srv', title: c.name, ariaLabel: c.name, 'aria-current': String(state.community?.community.id === c.id) }, avatarEl(c.icon, c.name, 48, true));
    b.dataset.id = c.id; b.addEventListener('click', () => openCommunity(c.id)); list.append(b);
  }
  const add = sq('plus', 'Create or join', () => wizard(), 'srv add'); const disc = sq('explore', 'Discover communities', () => discover(), 'srv');
  rail.replaceChildren(home, h('i', { className: 'sep' }), list, add, disc);
  makeSortable(list, { item: '.srv', axis: () => (matchMedia('(max-width: 760px)').matches ? 'x' : 'y'), onDone: (els) => { localStorage.setItem(orderKey, JSON.stringify(els.map((e) => Number(e.dataset.id)))); } });
}
export function openHome() {
  state.community = null; $('home-list').hidden = false; $('community-list').hidden = true; renderServers();
  if (state.channel) closeThread(); refreshHome();
}

/* ---------- community column ---------- */
const canManage = () => state.community && Math.max(RANKS[state.community.role], 0) >= 2;
export async function openCommunity(id, channelId) {
  try {
    const d = await api(`/api/community?id=${id}`);
    state.community = d; $('home-list').hidden = true; $('community-list').hidden = false; renderServers();
    api(`/api/voice/state?community=${id}`).then((v) => { state.voiceState = v; renderChannels(); }).catch(() => {});
    renderChannels();
    const first = channelId ?? (state.channel && d.channels.some((c) => c.id === state.channel) ? state.channel : d.channels.find((c) => !c.voice)?.id);
    if (first) await openChannel(first, d.community); else closeThread();
  } catch (e) { fail(e); openHome(); }
}
nav.openCommunity = openCommunity;
nav.openChannelById = async (cid) => { for (const c of state.communities) { const d = await api(`/api/community?id=${c.id}`).catch(() => null); if (d?.channels.some((x) => x.id === cid)) return openCommunity(c.id, cid); } };
nav.channelOpened = () => renderChannels();

function renderChannels() {
  const d = state.community; if (!d) return;
  const box = $('community-list');
  const admin = canManage();
  const chBtn = (c) => {
    const voice = !!c.voice;
    const b = h('button', { type: 'button', className: 'ch', 'aria-current': String(!voice && state.channel === c.id), title: c.topic || c.name },
      iconNode(voice ? 'speaker' : c.private ? 'lock' : 'hash', 18), h('span', { style: { flex: '1', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' } }, c.name),
      c.kind === 'announcement' ? h('span', { className: 'tag' }, 'news') : '', admin ? h('span', { className: 'grip', title: 'Drag to reorder' }, iconNode('grip', 16)) : '');
    b.dataset.id = c.id;
    b.addEventListener('click', () => (voice ? nav.joinVoice({ channel: c.id }) : openChannel(c.id, d.community)));
    const people = state.voiceState[c.id] ?? [];
    return voice && people.length ? h('div', { 'data-wrap': c.id }, b, h('div', { className: 'vpeople' }, ...people.map((u) => h('span', {}, avatarEl(u.avatar, u.name, 20), u.name)))) : b;
  };
  const text = d.channels.filter((c) => !c.voice); const voice = d.channels.filter((c) => c.voice);
  const mk = (title, list, kind) => {
    const wrap = h('div', { className: 'cgroup', 'data-kind': kind }, h('h3', { className: 'lh', style: { padding: '0 8px' } }, title, admin ? sq('plus', `Add ${kind} channel`, () => addChannel(kind === 'voice' ? 'voice' : 'text'), 'small') : ''), ...list.map(chBtn));
    if (admin) makeSortable(wrap, { item: '.ch, [data-wrap]', handle: '.grip', onDone: () => saveOrder() });
    return wrap;
  };
  box.replaceChildren(h('div', { className: 'chead' }, avatarEl(d.community.icon, d.community.name, 34, true), h('strong', {}, d.community.name),
    sq('gear', 'Community settings', () => settings(d.community.id)), RANKS[d.role] >= 2 ? sq('useradd', 'Invite people', () => invite(d.community.id)) : ''),
    h('div', { className: 'scroller' }, mk('Text channels', text, 'text'), mk('Voice channels', voice, 'voice'),
      !d.channels.length ? h('p', { className: 'empty' }, 'No channels yet.') : '', h('p', { className: 'help', style: { padding: '8px 16px' } }, d.bots.length ? `Bots: ${d.bots.join(', ')}` : '')));
}
async function saveOrder() {
  const ids = [...$('community-list').querySelectorAll('.ch')].map((b) => Number(b.dataset.id));
  await api('/api/channels/reorder', { body: { community: state.community.community.id, order: ids } }).catch(fail);
}
async function addChannel(kind) {
  const r = await ask({ title: kind === 'voice' ? 'New voice channel' : 'New text channel', fields: [{ name: 'name', label: 'Channel name', max: 30 }], ok: 'Create' }); if (!r?.name) return;
  try { await api('/api/channels', { body: { community: state.community.community.id, name: r.name, kind } }); openCommunity(state.community.community.id, state.channel); } catch (e) { fail(e); }
}
async function invite(id) { try { const r = await api('/api/community-invite', { body: { community: id } }); showCode('Invite code', r.code, 'Valid for 7 days. Anyone can paste it into “Create or join”.'); } catch (e) { fail(e); } }

/* voice presence updates */
export function onVoiceState(v) {
  if (!v.room.startsWith('ch:')) return;
  state.voiceState[v.room.slice(3)] = v.users; if (state.community) renderChannels();
}

/* ---------- create / join wizard ---------- */
const botCatalog = async () => (state.botCatalog ??= await api('/api/bots/catalog'));
export async function wizard(start) {
  const data = { kind: start ?? null, name: '', description: '', members: '', bots: new Set(['security']) };
  const catalog = await botCatalog();
  const render = async (step) => {
    if (step === 0) return show(h('h2', {}, 'Create or join'), h('div', { className: 'tiles' },
      tile('Community', 'users', 'Channels, roles and bots', () => { data.kind = 'community'; render(1); }), tile('Group chat', 'comment', 'A small space for friends', () => { data.kind = 'group'; render(1); }),
      tile('Join with code', 'link', 'Paste an invite code', () => render(9))));
    if (step === 9) return show(h('h2', {}, 'Join with a code'), form(async (v) => {
      const code = v.code.trim(); let r;
      try { r = await api('/api/community-join', { body: { code } }); closePanel(); await refreshCommunities(); openCommunity(r.id); } catch { r = await api('/api/group-join', { body: { code } }); closePanel(); await refreshGroups(); openHome(); openGroup(r.id); } },
      field('code', 'Invite code', { required: true }), h('button', { className: 'primary', type: 'submit' }, 'Join')), h('button', { className: 'link', type: 'button', onclick: () => render(0) }, 'Back'));
    if (step === 1) return show(steps(1), h('h2', {}, data.kind === 'community' ? 'Name your community' : 'Name your group'), form((v) => { data.name = v.name.trim(); data.description = v.description ?? ''; data.members = v.members ?? ''; if (!data.name) return; render(2); },
      field('name', 'Name', { required: true, maxLength: 60, value: data.name }), data.kind === 'group' ? field('members', 'Add people by username (comma separated, optional)', { value: data.members }) : '',
      h('div', { className: 'ask-actions' }, h('button', { className: 'link', type: 'button', onclick: () => render(0) }, 'Back'), h('button', { className: 'primary', type: 'submit' }, 'Next'))));
    const cards = h('div', { className: 'botcards' });
    const paint = () => cards.replaceChildren(...catalog.map((b) => h('button', { type: 'button', className: 'botcard', 'aria-pressed': String(data.bots.has(b.id)), onclick: () => { if (data.bots.has(b.id)) data.bots.delete(b.id); else data.bots.add(b.id); paint(); } },
      h('span', { className: 'bico' }, iconNode(BOT_ICONS[b.id] ?? 'bot', 20)), h('b', {}, b.name), h('small', {}, b.summary), h('span', { className: 'tick' }, iconNode('check', 18)))));
    paint();
    show(steps(2), h('h2', {}, 'Add ready-made bots'), h('p', { className: 'help' }, 'Switch on what you want now. You can change bots any time in settings.'), cards,
      h('div', { className: 'ask-actions' }, h('button', { className: 'link', type: 'button', onclick: () => render(1) }, 'Back'), h('button', { className: 'primary', type: 'button', onclick: create }, 'Create')));
  };
  const create = async () => {
    try {
      const bots = [...data.bots];
      if (data.kind === 'community') { const { id } = await api('/api/communities', { body: { name: data.name, bots } }); closePanel(); await refreshCommunities(); await openCommunity(id); nav.confetti?.(); }
      else { const members = data.members.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean); const g = await api('/api/groups', { body: { name: data.name, members, bots } }); closePanel(); openHome(); await openGroup(g.id); nav.confetti?.(); }
    } catch (e) { fail(e); }
  };
  render(start === 'community' || start === 'group' ? 1 : 0);
}
const tile = (title, ic, sub, onclick) => h('button', { type: 'button', className: 'tile', onclick }, iconNode(ic, 24), h('b', {}, title), h('small', {}, sub));
const steps = (n) => h('div', { className: 'steps' }, h('i', { className: 'on' }), h('i', { className: n >= 2 ? 'on' : '' }));
$('add-group').replaceChildren(sq('plus', 'New group', () => wizard('group'), 'small'));

/* ---------- bots editor (communities and groups) ---------- */
export async function botsEditor(scope, id, admin) {
  const [catalog, data] = await Promise.all([botCatalog(), api(`/api/bots/installed?scope=${scope}&id=${id}`)]);
  const wrap = h('div', { className: 'tab-body' });
  const paint = async (fresh) => {
    const cur = fresh ?? await api(`/api/bots/installed?scope=${scope}&id=${id}`);
    const on = Object.fromEntries(cur.bots.map((b) => [b.bot, b.config]));
    const refreshAll = () => paint();
    wrap.replaceChildren(h('p', { className: 'help' }, 'Ready-made bots live inside this space. No tokens, no setup. Type !help in a chat to see what they do.'),
      h('div', { className: 'botcards' }, ...catalog.map((b) => h('button', { type: 'button', className: 'botcard', disabled: !admin, 'aria-pressed': String(!!on[b.id]), onclick: async () => {
        try {
          if (on[b.id]) { if (!(await confirmBox(`Remove ${b.name}?`, b.id === 'music' ? 'Its uploaded tracks will be deleted too.' : 'Its settings will be lost.', 'Remove', true))) return; await api('/api/bots/remove', { body: { scope, id, bot: b.id } }); }
          else await api('/api/bots/install', { body: { scope, id, bot: b.id, config: b.defaults } });
          refreshAll(); if (scope === 'community') openCommunity(id, state.channel);
        } catch (e) { fail(e); } } },
        h('span', { className: 'bico' }, iconNode(BOT_ICONS[b.id] ?? 'bot', 20)), h('b', {}, b.name), h('small', {}, b.summary), b.commands.length ? h('small', {}, b.commands.join('   ')) : '', h('span', { className: 'tick' }, iconNode('check', 18))))),
      ...(admin ? Object.entries(on).map(([bot, cfg]) => botConfig(scope, id, bot, cfg, cur.tracks, refreshAll)) : []));
  };
  await paint(data); return wrap;
}
function botConfig(scope, id, bot, cfg, tracks, again) {
  const save = (config) => api('/api/bots/install', { body: { scope, id, bot, config } }).then(() => toast('Saved', { ic: 'check' })).catch(fail);
  if (bot === 'security') {
    const t = (name, label) => h('label', { className: 'toggle' }, label, h('input', { type: 'checkbox', name, checked: !!cfg[name] }));
    return h('div', { className: 'card' }, h('h3', {}, 'Security settings'), form((v) => save({ invites: !!v.invites, links: !!v.links, caps: !!v.caps, flood: !!v.flood, words: v.words, strikes: Number(v.strikes), timeoutMinutes: Number(v.timeoutMinutes) }),
      t('invites', 'Block invite links to other services'), t('links', 'Block all links'), t('caps', 'Block shouting (mostly capital letters)'), t('flood', 'Slow down floods of messages'),
      field('words', 'Banned words, comma separated', { value: cfg.words.join(', ') }), h('div', { className: 'field-row' }, h('label', {}, 'Strikes before timeout', field('strikes', '3', { type: 'number', min: 1, max: 10, value: cfg.strikes })), h('label', {}, 'Timeout minutes', field('timeoutMinutes', '5', { type: 'number', min: 1, max: 1440, value: cfg.timeoutMinutes }))),
      h('button', { className: 'primary', type: 'submit' }, 'Save')));
  }
  if (bot === 'welcome') return h('div', { className: 'card' }, h('h3', {}, 'Welcome message'), form((v) => save({ message: v.message }), field('message', 'Use {user} for the new member’s name', { value: cfg.message, maxLength: 300 }), h('button', { className: 'primary', type: 'submit' }, 'Save')));
  if (bot === 'music') {
    return h('div', { className: 'card' }, h('h3', {}, 'Music library'), h('p', { className: 'help' }, 'Upload tracks up to 10 MB each. Members play them with !play <number or title>.'),
      ...tracks.map((t) => h('div', { className: 'lib-row' }, iconNode('music', 18), h('span', { className: 'meta' }, h('b', {}, t.title), h('small', {}, fmtSize(t.size))), sq('play', 'Preview', () => new Audio(`/files/${t.id}`).play(), 'small'),
        sq('trash', 'Delete track', async () => { await api('/api/bots/track-delete', { body: { id: t.id } }).catch(fail); again(); }, 'small danger-sq'))),
      h('button', { className: 'primary', type: 'button', onclick: () => pickFile('audio/*', async (f) => { try { await upload('bot-music', f, `&scope=${scope}&id=${id}`, f.name); toast('Track added', { ic: 'check' }); again(); } catch (e) { fail(e); } }) }, 'Upload a track'));
  }
  return '';
}

/* ---------- community settings ---------- */
const iconInput = (query, done) => h('button', { type: 'button', className: 'ghost', onclick: () => pickFile('image/*', async (f) => { try { await upload(query.split('&')[0], f, `&${query.split('&').slice(1).join('&')}`); done(); } catch (e) { fail(e); } }) }, 'Choose image');
export async function settings(id) {
  const d = await api(`/api/community?id=${id}`).catch(() => null); if (!d) return;
  const mine = Math.max(RANKS[d.role], d.myPerms.length ? 1 : 0); const admin = RANKS[d.role] >= 2;
  const act = (path, extra) => api(path, { body: { community: id, ...extra } }).then(async () => { await openCommunity(id, state.channel); settings(id); }).catch(fail);
  const members = () => d.members.map((m) => h('div', { className: 'prow' }, avatarEl(m.avatar, m.name, 36), h('span', { className: 'meta' }, h('b', {}, m.name), h('small', {}, `@${m.username} · ${m.role}${m.customRole ? ` · ${m.customRole}` : ''}${m.timedOut ? ' · timed out' : ''}`)),
    h('span', { className: 'acts' }, m.username !== state.me && RANKS[m.role] < mine && mine >= 1 ? sq('more', 'Moderate', (e) => menu(e.currentTarget, [
      ['Timeout', 'lock', async () => { const v = await promptBox('Timeout minutes', 'Minutes (0 clears)', '10', 'Apply'); if (v !== null) act('/api/community-timeout', { username: m.username, minutes: v }); }],
      ['Kick', 'logout', async () => { if (await confirmBox(`Remove @${m.username}?`, 'They can rejoin with an invite.', 'Kick', true)) act('/api/community-kick', { username: m.username, reason: (await promptBox('Reason (logged)', 'Reason', '', 'Log')) ?? '' }); }, { warn: true }],
      ...(mine >= 2 ? [['Set role', 'shield', async () => { const r = await promptBox('Role', 'member, moderator or admin', m.role, 'Set'); if (r) act('/api/community-role', { username: m.username, role: r.trim().toLowerCase() }); }],
        ['Ban', 'x', async () => { if (await confirmBox(`Ban @${m.username}?`, 'They cannot rejoin until unbanned.', 'Ban', true)) act('/api/community-ban', { username: m.username, reason: (await promptBox('Reason (logged)', 'Reason', '', 'Log')) ?? '' }); }, { warn: true }]] : []),
    ]), 'small') : '')));
  const defs = [
    ['Overview', 'home', () => [h('div', { className: 'field-row' }, avatarEl(d.community.icon, d.community.name, 56, true), h('div', {}, h('h2', { style: { margin: 0 } }, d.community.name), h('p', { className: 'help' }, d.community.description || 'No description yet.'))),
      ...(admin ? [form((v) => act('/api/community-settings', { description: v.description, public: !!v.public }), field('description', 'Short description', { value: d.community.description ?? '' }),
        h('label', { className: 'toggle' }, 'Show in Discover', h('input', { type: 'checkbox', name: 'public', checked: !!d.community.public })), h('button', { className: 'primary', type: 'submit' }, 'Save')), h('div', { className: 'field-row' }, 'Icon', iconInput(`community-icon&id=${id}`, () => { refreshCommunities(); settings(id); }))] : [])]],
    ['Members', 'users', () => members()],
  ];
  if (admin) defs.push(['Roles', 'shield', () => [...d.roles.map((r) => h('div', { className: 'prow' }, h('span', { className: 'meta' }, h('b', {}, r.name), h('small', {}, r.perms.join(', ') || 'no permissions')), sq('trash', 'Delete role', () => act('/api/community-role-delete', { role: r.id }), 'small danger-sq'))),
    form((v) => act('/api/community-roles', { name: v.name, perms: PERMS.filter((p) => v[p]) }), field('name', 'New role name', { required: true }), h('div', { className: 'chipset' }, ...PERMS.map((p) => h('label', { className: 'pill' }, h('input', { type: 'checkbox', name: p, hidden: true }), p.replace('_', ' ')))), h('button', { className: 'primary', type: 'submit' }, 'Create role'))]]);
  defs.push(['Bots', 'bot', () => botsEditor('community', id, admin)]);
  if (mine >= 1) defs.push(['Log', 'file', async () => { const log = await api(`/api/community-log?id=${id}`); return log.length ? log.map((l) => h('div', { className: 'prow' }, h('span', { className: 'meta' }, h('b', {}, `${l.actor}: ${l.action} ${l.target ?? ''}`), h('small', {}, l.detail ?? '')), h('small', {}, new Date(l.at).toLocaleString()))) : [h('p', { className: 'empty' }, 'Nothing has been logged yet.')]; }]);
  defs.push(['Manage', 'gear', () => [admin ? h('button', { className: 'ghost', type: 'button', onclick: () => invite(id) }, 'Create invite code') : '',
    mine === 3 ? h('button', { className: 'danger', type: 'button', onclick: async () => { if (await confirmBox('Delete this community?', 'All channels and messages are removed for everyone.', 'Delete', true)) { await api('/api/community-delete', { body: { community: id } }).catch(fail); closePanel(); await refreshCommunities(); openHome(); } } }, 'Delete community')
      : h('button', { className: 'danger', type: 'button', onclick: async () => { if (await confirmBox('Leave this community?', '', 'Leave', true)) { await api('/api/community-leave', { body: { community: id } }).catch(fail); closePanel(); await refreshCommunities(); openHome(); } } }, 'Leave community')]]);
  show(tabs(defs));
}

/* ---------- group info ---------- */
export async function groupInfo() {
  const d = state.groupData; if (!d) return; const gid = state.group; const admin = d.role === 'admin';
  const act = (path, extra) => api(path, { body: { group: gid, ...extra } }).then(() => openGroup(gid).then(groupInfo)).catch(fail);
  const defs = [['Overview', 'home', () => [h('div', { className: 'field-row' }, avatarEl(d.group.icon, d.group.name, 56, true), h('div', {}, h('h2', { style: { margin: 0 } }, d.group.name), h('p', { className: 'help' }, d.group.description || 'No description yet.'))),
    ...(admin ? [form((v) => act('/api/group-settings', { description: v.description, public: !!v.public }), field('description', 'Short description', { value: d.group.description ?? '' }), h('label', { className: 'toggle' }, 'Show in Discover', h('input', { type: 'checkbox', name: 'public', checked: !!d.group.public })), h('button', { className: 'primary', type: 'submit' }, 'Save')),
      h('div', { className: 'field-row' }, 'Icon', iconInput(`group-icon&id=${gid}`, () => openGroup(gid).then(groupInfo))),
      h('div', { className: 'field-row' }, h('button', { className: 'ghost', type: 'button', onclick: async () => { const u = await promptBox('Add a person', 'Username', '', 'Add'); if (u) act('/api/group-members', { username: u.trim() }); } }, 'Add person'),
        h('button', { className: 'ghost', type: 'button', onclick: async () => { const r = await api('/api/group-invite', { body: { group: gid } }).catch(fail); if (r) showCode('Group invite', r.code, 'Paste it into “Create or join”.'); } }, 'Invite code'))] : [])]],
    ['Members', 'users', () => d.members.map((m) => h('div', { className: 'prow' }, avatarEl(m.avatar, m.name, 36), h('span', { className: 'meta' }, h('b', {}, m.name), h('small', {}, `@${m.username} · ${m.role}`)),
      h('span', { className: 'acts' }, sq('me', 'Profile', () => nav.openProfile(m.username), 'small'), admin && m.username !== state.me ? sq('x', 'Remove', async () => { if (await confirmBox(`Remove @${m.username}?`, '', 'Remove', true)) act('/api/group-remove', { username: m.username }); }, 'small danger-sq') : '')))],
    ['Bots', 'bot', () => botsEditor('group', gid, admin)]];
  show(tabs(defs));
}
nav.showGroupInfo = groupInfo;

/* ---------- discover ---------- */
export async function discover(q = '') {
  const r = await api(`/api/discover?q=${encodeURIComponent(q)}`);
  const card = (kind, it) => h('div', { className: 'prow' }, avatarEl(it.icon, it.name, 44, true), h('span', { className: 'meta' }, h('b', {}, it.name), h('small', {}, `${it.members} members${it.description ? ` · ${it.description}` : ''}`)),
    h('button', { className: it.joined ? 'ghost' : 'primary small', type: 'button', onclick: async () => {
      try { if (!it.joined) await api('/api/discover/join', { body: { kind, id: it.id } }); closePanel(); await refreshCommunities(); if (kind === 'community') openCommunity(it.id); else { openHome(); openGroup(it.id); } } catch (e) { fail(e); } } }, it.joined ? 'Open' : 'Join'));
  show(h('h2', {}, 'Discover'), h('p', { className: 'help' }, 'Public communities and groups. Admins choose whether theirs appears here.'),
    form((v) => discover(v.q), field('q', 'Search by name or description', { value: q }), h('button', { className: 'primary', type: 'submit' }, 'Search')),
    h('h3', {}, 'Communities'), ...(r.communities.length ? r.communities.map((c) => card('community', c)) : [h('p', { className: 'empty' }, 'No public communities match.')]),
    h('h3', {}, 'Groups'), ...(r.groups.length ? r.groups.map((g) => card('group', g)) : [h('p', { className: 'empty' }, 'No public groups match.')]));
}
nav.discover = discover; nav.openHome = openHome;
