import { h, state, api, nav, sq, iconNode, avatarEl, toast, fail, ask, confirmBox, show, form, field, tabs, confetti } from './ui.js';

const ROLE = { owner: 'Owner', admin: 'Admin', staff: 'Staff', user: 'Member' };
export async function showOwner(query = '', start = 0) {
  const perms = state.perms ?? []; const can = (p) => perms.includes(p);
  const [s, users, team] = await Promise.all([api('/api/owner/stats'), api(`/api/owner/users?q=${encodeURIComponent(query)}`), api('/api/owner/team')]);
  const reload = (i) => showOwner(query, i);
  const act = (path, label, withReason) => async (u) => { const r = withReason ? await ask({ title: `${label} @${u}`, fields: [{ name: 'reason', label: 'Reason (the person will see it)' }], ok: label }) : true; if (!r || (withReason && !r.reason)) return; try { await api(path, { body: { username: u, reason: r.reason ?? '' } }); toast(`${label}: @${u}`, { ic: 'check' }); reload(1); } catch (e) { fail(e); } };
  const tiles = [['Users', s.users], ['New (7 days)', s.newUsers7d], ['Online now', s.online], ['Messages', s.messages], ['Messages (24h)', s.messages24h], ['Groups', s.groups], ['Communities', s.communities ?? 0], ['Posts', s.posts ?? 0], ['Suspended', s.banned]];
  const roleChip = (r) => (r && r !== 'user' ? h('span', { className: `role-chip ${r}` }, ROLE[r]) : '');
  const setRole = async (u, role) => { try { await api('/api/owner/role', { body: { username: u, role } }); toast(`@${u} is now ${ROLE[role].toLowerCase()}`, { ic: 'shield' }); reload(2); } catch (e) { fail(e); } };
  const defs = [
    ['Overview', 'owner', () => [h('div', { className: 'owner-grid' }, ...tiles.map(([k, v]) => h('div', { className: 'stat' }, h('b', {}, String(v)), k))),
      ...(can('announce') ? [h('h3', {}, 'Announce to everyone'), form(async (v) => { const r = await api('/api/owner/announce', { body: { text: v.text } }); toast(`Sent to ${r.sent} people`, { ic: 'check' }); }, h('div', { className: 'field-row' }, field('text', 'What’s new?', { required: true }), h('button', { className: 'primary small', type: 'submit' }, 'Send')))] : []),
      ...(can('audit') ? [h('h3', {}, 'Recent actions'), ...s.audit.map((a) => h('div', { className: 'prow' }, h('span', { className: 'meta' }, h('b', {}, `${a.actor}: ${a.action} ${a.target ?? ''}`), h('small', {}, a.detail ?? '')), h('small', {}, new Date(a.at).toLocaleString())))] : [])]],
    ['People', 'users', () => [form((v) => showOwner(v.q, 1), h('div', { className: 'field-row' }, field('q', 'Search username', { value: query }), h('button', { className: 'ghost', type: 'submit' }, 'Search'))),
      ...users.map((u) => h('div', { className: 'prow' }, h('span', { className: 'meta' }, h('b', {}, `@${u.username}`, ' ', roleChip(u.role)), h('small', {}, u.bannedAt ? 'Suspended' : `Joined ${new Date(u.createdAt).toLocaleDateString()}`)),
        h('span', { className: 'acts' }, can('warn') ? h('button', { className: 'ghost', type: 'button', onclick: () => act('/api/owner/warn', 'Warn', true)(u.username) }, 'Warn') : '',
          can('ban') ? (u.bannedAt ? h('button', { className: 'ghost', type: 'button', onclick: () => act('/api/owner/unban', 'Restore')(u.username) }, 'Restore') : h('button', { className: 'danger', type: 'button', onclick: () => act('/api/owner/ban', 'Suspend', true)(u.username) }, 'Suspend')) : '',
          can('sparks') ? sq('bolt', 'Give Sparks', async () => { const r = await ask({ title: `Give Sparks to @${u.username}`, fields: [{ name: 'amount', label: 'Amount', type: 'number', value: '25' }, { name: 'reason', label: 'Reason (audit log)' }], ok: 'Give' }); if (!r) return; try { const res = await api('/api/owner/sparks', { body: { username: u.username, amount: Number(r.amount), reason: r.reason } }); toast(`Balance: ${res.balance}`, { ic: 'bolt' }); confetti(); } catch (e) { fail(e); } }, 'small') : '')))]],
  ];
  if (can('staff')) defs.push(['Team', 'shield', () => [h('p', { className: 'help' }, 'Owner: everything. Admins: full moderation, Sparks, announcements and content removal. Staff: view people and issue warnings only.'),
    ...team.map((m) => h('div', { className: 'prow' }, h('span', { className: 'meta' }, h('b', {}, m.name, ' ', roleChip(m.role)), h('small', {}, `@${m.username}`)),
      m.role !== 'owner' && (can('admins') || m.role === 'staff') ? h('button', { className: 'ghost', type: 'button', onclick: () => setRole(m.username, 'user') }, 'Remove role') : '')),
    h('h3', {}, 'Give a role'), form(async (v) => setRole(v.username.trim().toLowerCase().replace(/^@/, ''), v.role), h('div', { className: 'field-row' }, field('username', 'Username', { required: true }),
      h('select', { name: 'role' }, h('option', { value: 'staff' }, 'Staff'), can('admins') ? h('option', { value: 'admin' }, 'Admin') : ''), h('button', { className: 'primary small', type: 'submit' }, 'Apply')))]]);
  show(h('h2', {}, iconNode('owner', 22), state.role === 'owner' ? 'Owner dashboard' : `${ROLE[state.role]} tools`), tabs(defs, start));
}
nav.showOwner = () => showOwner().catch(fail);
