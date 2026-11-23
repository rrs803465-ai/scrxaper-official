import { $, h, state, api, nav, sq, iconNode, avatarEl, toast, fail, ago, show, closePanel, tabs, form, field, confirmBox } from './ui.js';

const NOTE_ICON = { like: 'heart', comment: 'comment', follow: 'useradd', follow_request: 'lock', follow_accept: 'check', friend_request: 'friends', friend_accept: 'check', share: 'share', role: 'shield' };

export function updateBadges() {
  const set = (id, n) => { const b = $(id); if (!b) return; b.querySelector('.dot')?.remove(); if (n > 0) b.append(h('span', { className: 'dot' }, n > 9 ? '9+' : String(n))); };
  set('dock-notes', state.unread); set('dock-friends', state.friendRequests + state.followRequests);
  document.title = state.unread ? `(${state.unread}) Scrxaper` : 'Scrxaper';
}
export async function refreshCounts() {
  const me = await api('/api/me').catch(() => null); if (!me) return;
  Object.assign(state, { unread: me.unread, friendRequests: me.friendRequests, followRequests: me.followRequests }); updateBadges();
}

const userRow = (u, ...actions) => h('div', { className: 'prow' }, h('span', { className: `presence${u.online ? ' on' : ''}` }, avatarEl(u.avatar, u.name, 42)),
  h('button', { type: 'button', className: 'meta', style: { background: 'none', border: 0, color: 'inherit', textAlign: 'left', padding: 0 }, onclick: () => { closePanel(); nav.openProfile(u.username); } },
    h('b', {}, u.name), h('small', {}, u.mutual ? `${u.mutual} mutual friend${u.mutual > 1 ? 's' : ''}` : u.status || `@${u.username}`)), h('span', { className: 'acts' }, ...actions));

export async function showFriends(start = 0) {
  const load = () => api('/api/friends');
  const reload = (i) => showFriends(i);
  const msg = (u) => sq('comment', 'Message', () => { closePanel(); nav.openHome?.(); nav.openThread(u.username); }, 'small');
  const req = (u) => api('/api/friends/request', { body: { username: u.username } }).then(() => { toast(`Request sent to ${u.name}`, { ic: 'check' }); reload(3); }).catch(fail);
  const defs = [
    ['All', 'friends', async () => { const d = await load(); return d.friends.length ? d.friends.map((u) => userRow(u, msg(u), sq('phone', 'Call', () => { closePanel(); nav.openThread(u.username).then(() => nav.startCall(false)); }, 'small'),
      sq('x', 'Remove friend', async () => { if (await confirmBox(`Remove ${u.name}?`, 'You can add them again later.', 'Remove', true)) { await api('/api/friends/remove', { body: { username: u.username } }); reload(0); } }, 'small danger-sq'))) : [h('p', { className: 'empty' }, 'No friends yet. Add someone from the Add tab.')]; }],
    ['Online', 'sparkle', async () => { const d = (await load()).friends.filter((u) => u.online); return d.length ? d.map((u) => userRow(u, msg(u))) : [h('p', { className: 'empty' }, 'Nobody is online right now.')]; }],
    ['Pending', 'bell', async () => {
      const [d, fr] = await Promise.all([load(), api('/api/follow-requests')]);
      const out = [];
      if (d.incoming.length) out.push(h('h3', {}, 'Friend requests'), ...d.incoming.map((u) => userRow(u, sq('check', 'Accept', () => api('/api/friends/respond', { body: { username: u.username, accept: true } }).then(() => { refreshCounts(); reload(2); }).catch(fail), 'small on'), sq('x', 'Decline', () => api('/api/friends/respond', { body: { username: u.username, accept: false } }).then(() => { refreshCounts(); reload(2); }).catch(fail), 'small'))));
      if (fr.length) out.push(h('h3', {}, 'Follow requests'), ...fr.map((u) => userRow(u, sq('check', 'Approve', () => api('/api/follow-requests/respond', { body: { username: u.username, accept: true } }).then(() => { refreshCounts(); reload(2); }).catch(fail), 'small on'), sq('x', 'Deny', () => api('/api/follow-requests/respond', { body: { username: u.username, accept: false } }).then(() => { refreshCounts(); reload(2); }).catch(fail), 'small'))));
      if (d.outgoing.length) out.push(h('h3', {}, 'Sent'), ...d.outgoing.map((u) => userRow(u, sq('x', 'Cancel request', () => api('/api/friends/cancel', { body: { username: u.username } }).then(() => reload(2)).catch(fail), 'small'))));
      return out.length ? out : [h('p', { className: 'empty' }, 'No pending requests.')];
    }],
    ['Add', 'useradd', async () => {
      const d = await load();
      return [form(async (v) => { try { await api('/api/friends/request', { body: { username: v.username.trim().toLowerCase().replace(/^@/, '') } }); toast('Friend request sent', { ic: 'check' }); reload(3); } catch (e) { fail(e); } },
        h('div', { className: 'field-row' }, field('username', 'Add a friend by username', { required: true }), h('button', { className: 'primary', type: 'submit' }, 'Send request'))),
        h('h3', {}, 'People you may know'), ...(d.suggestions.length ? d.suggestions.map((u) => userRow(u, h('button', { className: 'primary small', type: 'button', onclick: () => req(u) }, 'Add'))) : [h('p', { className: 'empty' }, 'Suggestions appear when your friends have friends in common with other people.')])];
    }],
  ];
  show(h('h2', {}, 'Friends'), tabs(defs, start));
}

export async function showNotifications() {
  const wrap = h('div', { className: 'tab-body' });
  const open = (n) => {
    closePanel();
    if (['like', 'comment', 'share'].includes(n.kind) && n.ref) nav.openPost(Number(n.ref));
    else if (n.kind === 'friend_request' || n.kind === 'follow_request') showFriends(2);
    else if (n.actor) nav.openProfile(n.actor.username);
  };
  const paint = async () => {
    const d = await api('/api/notifications');
    wrap.replaceChildren(...(d.items.length ? d.items.map((n) => h('button', { type: 'button', className: `nrow${n.read ? '' : ' unread'}`, onclick: () => { api('/api/notifications/read', { body: { id: n.id } }).then(refreshCounts); open(n); } },
      h('span', { className: 'nico' }, iconNode(NOTE_ICON[n.kind] ?? 'bell', 20)), n.actor ? avatarEl(n.actor.avatar, n.actor.name, 36) : '',
      h('span', { className: 'ntext' }, n.actor ? h('b', {}, `${n.actor.name} `) : '', n.text, h('small', {}, ago(n.at))))) : [h('p', { className: 'empty' }, 'Nothing yet. Likes, follows, comments and friend requests show up here.')]));
    if (d.unread) { await api('/api/notifications/read', { body: {} }); state.unread = 0; updateBadges(); }
  };
  show(h('div', { className: 'field-row' }, h('h2', { style: { flex: '1', margin: 0 } }, 'Notifications')), wrap); await paint();
}

export function bindFriendEvents(es) {
  es.addEventListener('notify', (e) => {
    const n = JSON.parse(e.data); state.unread++; updateBadges();
    toast(n.actor ? `${n.actor.name} ${n.text}` : n.text, { ic: NOTE_ICON[n.kind] ?? 'bell' });
    if (['friend_request', 'follow_request'].includes(n.kind)) refreshCounts();
  });
  es.addEventListener('friends', () => refreshCounts());
}
Object.assign(nav, { showFriends, showNotifications });
