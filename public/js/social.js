import { $, h, state, api, upload, nav, sq, iconNode, avatarEl, toast, fail, ago, confirmBox, ask, promptBox, show, closePanel, form, field, pickFile, menu, confetti, linkify } from './ui.js';
import { BUILTIN_TONES, playSound } from './audio.js';
import { editPhoto, editVideo, musicField } from './editor.js';

const social = { tab: 'feed', stack: [] };
let audio = null; let audioFor = null;
const stopAudio = () => { audio?.pause(); audio = null; audioFor = null; document.querySelectorAll('.music-badge.playing').forEach((b) => b.classList.remove('playing')); };
const playMusic = (id, start, badge) => {
  if (audioFor === id && audio && !audio.paused) { stopAudio(); return; }
  stopAudio(); audio = new Audio(`/files/${id}`); audio.loop = true; audio.currentTime = start || 0; audioFor = id; audio.play().then(() => badge?.classList.add('playing')).catch(() => {});
};
const musicBadge = (p) => { if (!p.sound) return ''; const b = h('button', { type: 'button', className: 'music-badge', onclick: (e) => { e.stopPropagation(); playMusic(p.sound, p.soundStart, b); } }, iconNode('music', 16), h('span', {}, p.soundLabel || 'Music')); return b; };

/* captions with clickable hashtags */
const caption = (text) => { const frag = document.createDocumentFragment(); String(text).split(/(#[\p{L}\p{N}_]{2,30})/gu).forEach((part) => { if (/^#[\p{L}\p{N}_]{2,30}$/u.test(part)) frag.append(h('button', { type: 'button', className: 'hashtag', onclick: () => openHashtag(part.slice(1)) }, part)); else frag.append(linkify(part)); }); return frag; };

/* ---------- compose ---------- */
async function upMedia(kind, blob, name) { return (await upload(kind, blob, '', name)).id; }
function composeSheet(title, blob, kind, after) {
  const url = URL.createObjectURL(blob);
  const cap = h('textarea', { name: 'caption', placeholder: kind === 'story' ? 'Add text to your story (optional)' : 'Write a caption. Use #hashtags to be found.', ariaLabel: 'Caption', maxLength: kind === 'story' ? 140 : 1000 });
  const music = musicField(); const note = h('p', { className: 'error', role: 'alert' });
  const media = blob.type.startsWith('video') ? h('video', { src: url, controls: true, muted: true, playsInline: true, className: 'post-media' }) : h('img', { src: url, alt: 'Preview', className: 'post-media' });
  media.style.setProperty('max-height', '40vh'); media.style.setProperty('border-radius', '14px'); media.style.setProperty('width', '100%'); media.style.setProperty('object-fit', 'contain');
  const go = h('button', { className: 'primary', type: 'button', onclick: async () => {
    go.disabled = true; note.textContent = 'Uploading…';
    try {
      const id = await upMedia(kind === 'story' ? 'story' : kind === 'reel' ? 'reel' : 'post', blob);
      await api(kind === 'story' ? '/api/stories' : '/api/posts', { body: { media: id, caption: cap.value, sound: music.value() } });
      music.stop(); closePanel(); toast('Shared', { ic: 'check' }); confetti(); after();
    } catch (err) { note.textContent = err.message; go.disabled = false; }
  } }, 'Share');
  show(h('h2', {}, title), media, cap, music.node, note, go);
}
const newPost = () => pickFile('image/png,image/jpeg,image/webp', async (f) => { const b = await editPhoto(f); if (b) composeSheet('New post', b, 'post', () => openSocial('feed')); });
const newStory = () => pickFile('image/png,image/jpeg,image/webp', async (f) => { const b = await editPhoto(f, { aspect: '9:16', title: 'Edit story' }); if (b) composeSheet('New story', b, 'story', () => openSocial('feed')); });
const newReel = () => pickFile('video/mp4,video/webm', async (f) => { const b = await editVideo(f); if (b) composeSheet('New reel', b, 'reel', () => openSocial('reels')); });

/* ---------- posts ---------- */
const mediaEl = (p, big) => (p.kind === 'reel' ? h('video', { src: `/files/${p.media}`, controls: true, playsInline: true, preload: 'metadata', className: 'post-media', loop: !!big })
  : h('img', { src: `/files/${p.media}`, alt: (p.caption || '').slice(0, 80) || 'Post photo', loading: 'lazy', className: 'post-media' }));
function likeBtn(p, after) {
  const count = h('span', { className: 'count' }, String(p.likes));
  const b = sq('heart', 'Like', async () => { try { const r = await api('/api/posts/like', { body: { post: p.id, liked: !p.liked } }); p.liked = r.liked; p.likes = r.likes; paint(); after?.(); } catch (e) { fail(e); } });
  const paint = () => { b.classList.toggle('liked', p.liked); b.setAttribute('aria-pressed', String(p.liked)); count.textContent = String(p.likes); b.firstChild.setAttribute('fill', p.liked ? 'currentColor' : 'none'); }; paint();
  return { node: [b, count], like: () => { if (!p.liked) b.click(); } };
}
function postCard(p) {
  const media = mediaEl(p); const like = likeBtn(p); const burst = h('div', { className: 'heart-burst' }, iconNode('heart', 90)); burst.firstChild.setAttribute('fill', 'currentColor');
  const wrap = h('div', { className: 'media' }, media, burst, musicBadge(p));
  wrap.addEventListener('dblclick', () => { like.like(); burst.classList.remove('go'); void burst.offsetWidth; burst.classList.add('go'); });
  const mine = p.username === state.me;
  const more = mine ? sq('more', 'Post options', (e) => menu(e.currentTarget, [['Edit caption', 'edit', async () => { const c = await promptBox('Edit caption', 'Caption', p.caption, 'Save'); if (c !== null) { await api('/api/posts/edit', { body: { post: p.id, caption: c } }).catch(fail); openSocial(social.tab); } }],
    ['Delete post', 'trash', async () => { if (await confirmBox('Delete this post?', 'This cannot be undone.', 'Delete', true)) { await api('/api/posts/delete', { body: { post: p.id } }).catch(fail); openSocial(social.tab); } }, { warn: true }]]), 'small')
    : state.perms?.includes('content') ? sq('trash', 'Remove post (admin)', async () => { const r = await promptBox('Remove this post', 'Reason (logged)', '', 'Remove'); if (r !== null) { await api('/api/admin/post-delete', { body: { post: p.id, reason: r } }).catch(fail); openSocial(social.tab); } }, 'small danger-sq') : '';
  return h('article', { className: 'post' }, h('header', {}, h('button', { type: 'button', className: 'who-btn', onclick: () => openProfile(p.username) }, avatarEl(p.avatar, p.name, 38), h('span', {}, h('b', {}, p.name), h('small', { style: { display: 'block', color: 'var(--muted)' } }, `@${p.username} · ${ago(p.at)}${p.editedAt ? ' · edited' : ''}`))), more),
    wrap, h('div', { className: 'actions' }, ...like.node, sq('comment', 'Comments', () => openPost(p.id)), h('span', { className: 'count' }, String(p.comments)), sq('share', 'Share to a chat', () => sharePost(p.id)), h('span', { className: 'grow' })),
    p.caption ? h('p', { className: 'cap' }, h('b', {}, `${p.name} `), caption(p.caption)) : '');
}
export async function openPost(id) {
  const p = await api(`/api/post?id=${id}`).catch((e) => { fail(e); return null; }); if (!p) return;
  const media = mediaEl(p, true); const like = likeBtn(p, () => {});
  const comments = h('div', {}, ...p.comments.map((c) => h('div', { className: 'prow' }, avatarEl(c.avatar, c.name, 30), h('span', { className: 'meta' }, h('b', {}, c.name), h('span', {}, c.body)),
    p.username === state.me || c.username === state.me ? sq('trash', 'Delete comment', async () => { await api('/api/posts/comment-delete', { body: { comment: c.id } }).catch(fail); openPost(id); }, 'small') : '')));
  show(h('div', { className: 'prow' }, avatarEl(p.avatar, p.name, 38), h('span', { className: 'meta' }, h('b', {}, p.name), h('small', {}, `@${p.username} · ${ago(p.at)}`))),
    h('div', { className: 'media', style: { 'border-radius': '14px', overflow: 'hidden' } }, media, musicBadge(p)), h('div', { className: 'actions', style: { display: 'flex', 'align-items': 'center', gap: '6px' } }, ...like.node, sq('share', 'Share to a chat', () => sharePost(id))),
    p.caption ? h('p', {}, caption(p.caption)) : '', comments, form(async (v, f) => { await api('/api/posts/comment', { body: { post: id, body: v.body } }); openPost(id); }, h('div', { className: 'field-row' }, field('body', 'Add a comment', { required: true, maxLength: 500 }), h('button', { className: 'primary small', type: 'submit' }, 'Post'))));
}
export async function sharePost(id) {
  const [fr, groups] = await Promise.all([api('/api/friends'), api('/api/groups')]);
  const send = async (target, name) => { try { await api('/api/posts/share', { body: { post: id, ...target } }); toast(`Sent to ${name}`, { ic: 'share' }); closePanel(); } catch (e) { fail(e); } };
  const row = (pfp, name, sub, target) => h('button', { type: 'button', className: 'nrow', onclick: () => send(target, name) }, pfp, h('span', { className: 'ntext' }, h('b', {}, name), h('small', {}, sub)), iconNode('send', 18));
  show(h('h2', {}, 'Share to a chat'), h('div', { className: 'sheet-list' }, ...groups.map((g) => row(avatarEl(g.icon, g.name, 38, true), g.name, 'Group', { group: g.id })), ...fr.friends.map((u) => row(avatarEl(u.avatar, u.name, 38), u.name, `@${u.username}`, { to: u.username })),
    !groups.length && !fr.friends.length ? h('p', { className: 'empty' }, 'Add friends or join a group to share posts into chats.') : ''));
}

/* ---------- feed, reels, explore ---------- */
async function renderFeed() {
  const [tray, posts] = await Promise.all([api('/api/stories'), api('/api/feed')]);
  const ring = (label, node, onclick, cls = '') => h('button', { type: 'button', className: `story-ring ${cls}`, onclick }, node, h('span', {}, label));
  const addNode = h('span', { className: 'pfp', style: { '--s': '56px' } }, iconNode('plus', 22));
  return [h('div', { className: 'stories' }, ring('Add story', addNode, newStory, 'add'), ...tray.map((g, i) => ring(g.mine ? 'Your story' : g.name, avatarEl(g.avatar, g.name, 56), () => openStory(tray, i), g.allSeen ? 'seen' : ''))),
    ...(posts.length ? posts.map(postCard) : [h('p', { className: 'empty' }, 'Nothing here yet. Follow people, or press + to share your first photo.')])];
}
async function renderReels() {
  const reels = await api('/api/reels');
  if (!reels.length) return [h('p', { className: 'empty' }, 'No reels yet. Press + to share the first one.')];
  const list = h('div', { className: 'reels' }, ...reels.map((p) => {
    const video = h('video', { src: `/files/${p.media}`, loop: true, muted: true, playsInline: true, preload: 'metadata' });
    const like = likeBtn(p); const mute = sq('mute', 'Sound', () => { video.muted = !video.muted; mute.replaceChildren(iconNode(video.muted ? 'mute' : 'sound', 20)); if (p.sound) { if (video.muted) stopAudio(); else playMusic(p.sound, p.soundStart); } });
    const r = h('section', { className: 'reel' }, video, h('div', { className: 'side' }, ...[like.node[0], sq('comment', 'Comments', () => openPost(p.id)), sq('share', 'Share', () => sharePost(p.id)), mute]),
      h('div', { className: 'over' }, h('button', { type: 'button', className: 'who-btn', style: { display: 'flex', gap: '8px', 'align-items': 'center', background: 'none', border: 0, color: '#fff', padding: 0 }, onclick: () => openProfile(p.username) }, avatarEl(p.avatar, p.name, 32), h('b', {}, p.name)), p.caption ? h('p', { style: { margin: 0 } }, caption(p.caption)) : '', musicBadge(p) && Object.assign(musicBadge(p), { style: '' })));
    r.querySelector('.music-badge')?.style.setProperty('position', 'static'); r.dataset.sound = p.sound ?? ''; r.dataset.start = p.soundStart ?? 0; return r;
  }));
  const watcher = new IntersectionObserver((entries) => entries.forEach((e) => { const v = e.target.querySelector('video'); if (e.isIntersecting) { v.play().catch(() => {}); if (e.target.dataset.sound && !v.muted) playMusic(e.target.dataset.sound, Number(e.target.dataset.start)); } else { v.pause(); if (audioFor === e.target.dataset.sound) stopAudio(); } }), { threshold: 0.7 });
  list.querySelectorAll('.reel').forEach((n) => watcher.observe(n));
  return [list];
}
const thumbs = (posts) => h('div', { className: 'gridposts' }, ...posts.map((g) => h('button', { type: 'button', ariaLabel: g.caption || 'Open post', onclick: () => openPost(g.id) }, g.kind === 'reel' ? h('video', { src: `/files/${g.media}`, muted: true, preload: 'metadata' }) : h('img', { src: `/files/${g.media}`, alt: '', loading: 'lazy' }))));
async function renderExplore() {
  const d = await api('/api/explore');
  const search = form((v) => { const t = v.q.trim().replace(/^#/, ''); if (t) openHashtag(t); }, h('div', { className: 'field-row' }, field('q', 'Search a #hashtag', { maxLength: 31 }), h('button', { className: 'primary small', type: 'submit' }, 'Go')));
  return [search, h('h3', {}, 'Trending'), d.tags.length ? h('div', { className: 'tagrow' }, ...d.tags.map((t) => h('button', { type: 'button', className: 'tagchip', onclick: () => openHashtag(t.tag) }, `#${t.tag}`, h('small', {}, String(t.n))))) : h('p', { className: 'empty' }, 'No hashtags yet. Add #tags to a caption.'),
    h('h3', {}, 'Popular right now'), d.posts.length ? thumbs(d.posts) : h('p', { className: 'empty' }, 'Nothing popular yet.'),
    h('h3', {}, 'People to follow'), ...d.people.map((u) => h('div', { className: 'prow' }, avatarEl(u.avatar, u.name, 40), h('button', { type: 'button', className: 'meta', style: { background: 'none', border: 0, color: 'inherit', textAlign: 'left', padding: 0 }, onclick: () => openProfile(u.username) }, h('b', {}, u.name), h('small', {}, `@${u.username} · ${u.followers} followers`)),
      h('button', { className: 'ghost', type: 'button', onclick: async (e) => { try { const r = await api('/api/follow', { body: { username: u.username, follow: true } }); e.currentTarget.textContent = r.requested ? 'Requested' : 'Following'; e.currentTarget.disabled = true; } catch (er) { fail(er); } } }, 'Follow')))];
}
export async function openHashtag(tag) {
  const clean = String(tag).replace(/^#/, '').toLowerCase();
  $('social').hidden = false; social.tab = 'tag'; tabsPaint();
  const body = $('social-body'); body.replaceChildren(h('p', { className: 'empty' }, 'Loading…'));
  try { const r = await api(`/api/hashtag?tag=${encodeURIComponent(clean)}`); body.replaceChildren(h('div', { className: 'field-row' }, sq('back', 'Back to Explore', () => openSocial('explore')), h('h2', { style: { margin: 0 } }, `#${r.tag}`)), r.posts.length ? thumbs(r.posts) : h('p', { className: 'empty' }, 'No posts with this hashtag yet.')); } catch (e) { body.replaceChildren(h('p', { className: 'error' }, e.message)); }
}
const TABS = [['feed', 'feed', 'Feed'], ['reels', 'reels', 'Reels'], ['explore', 'explore', 'Explore']];
function tabsPaint() { $('social-tabs').replaceChildren(...TABS.map(([id, ic, label]) => sq(ic, label, () => openSocial(id), id === social.tab || (social.tab === 'tag' && id === 'explore') ? 'on' : ''))); }
export async function openSocial(tab = 'feed') {
  stopAudio(); social.tab = tab; $('social').hidden = false; tabsPaint(); $('social-new').hidden = tab === 'explore';
  const body = $('social-body'); body.replaceChildren(h('p', { className: 'empty' }, 'Loading…'));
  try { body.replaceChildren(...(tab === 'feed' ? await renderFeed() : tab === 'reels' ? await renderReels() : await renderExplore())); } catch (err) { body.replaceChildren(h('p', { className: 'error' }, err.message)); }
}
$('social-close').replaceChildren(iconNode('x', 20)); $('social-new').replaceChildren(iconNode('plus', 20));
$('social-close').addEventListener('click', () => { stopAudio(); $('social').hidden = true; });
$('social-new').addEventListener('click', () => (social.tab === 'reels' ? newReel() : newPost()));

/* ---------- stories ---------- */
function openStory(groups, start) {
  const root = $('story'); let gi = start; let si = 0; let timer = 0; let raf = 0;
  const close = () => { clearTimeout(timer); cancelAnimationFrame(raf); stopAudio(); root.hidden = true; root.replaceChildren(); if (!$('social').hidden) openSocial(social.tab); };
  const next = () => { if (si + 1 < groups[gi].stories.length) { si++; draw(); } else if (gi + 1 < groups.length) { gi++; si = 0; draw(); } else close(); };
  const prev = () => { if (si > 0) { si--; draw(); } else if (gi > 0) { gi--; si = groups[gi].stories.length - 1; draw(); } else draw(); };
  function draw() {
    const g = groups[gi]; const s = g.stories[si]; api('/api/stories/view', { body: { story: s.id } }).catch(() => {});
    const bars = g.stories.map((_, i) => h('i', {}, h('b', { style: { width: i < si ? '100%' : '0' } })));
    const live = bars[si].firstChild; const t0 = performance.now();
    const step = (t) => { live.style.setProperty('width', `${Math.min(100, ((t - t0) / 5000) * 100)}%`); raf = requestAnimationFrame(step); };
    cancelAnimationFrame(raf); raf = requestAnimationFrame(step);
    const frame = h('div', { className: 'frame' }, h('img', { src: `/files/${s.media}`, alt: `${g.name}’s story` }), s.caption ? h('div', { className: 'cap' }, s.caption) : '',
      h('div', { className: 'bars' }, ...bars), h('div', { className: 'top' }, avatarEl(g.avatar, g.name, 34), h('b', {}, g.name), h('small', {}, ago(s.at)), s.sound ? h('span', { className: 'music-badge playing', style: { position: 'static' } }, iconNode('music', 14), h('span', {}, s.soundLabel || 'Music')) : '', h('span', { className: 'grow' }), sq('x', 'Close', close)),
      h('button', { className: 'nav l', type: 'button', ariaLabel: 'Previous', onclick: prev }), h('button', { className: 'nav r', type: 'button', ariaLabel: 'Next', onclick: next }),
      ...(g.mine ? [h('div', { style: { position: 'absolute', bottom: 'calc(20px + env(safe-area-inset-bottom))', left: '14px', right: '14px', display: 'flex', gap: '8px', 'z-index': 4 } },
        h('button', { className: 'ghost', type: 'button', onclick: async () => { clearTimeout(timer); cancelAnimationFrame(raf); const v = await api(`/api/stories/viewers?story=${s.id}`); show(h('h2', {}, `Seen by ${v.length}`), ...v.map((x) => h('div', { className: 'prow' }, h('span', { className: 'meta' }, x.name), h('small', {}, ago(x.at))))); } }, 'Views'),
        h('button', { className: 'ghost', type: 'button', onclick: async () => { await api('/api/stories/delete', { body: { story: s.id } }); close(); } }, 'Delete'))] : []));
    root.replaceChildren(frame); stopAudio(); if (s.sound) playMusic(s.sound, s.soundStart, null);
    clearTimeout(timer); timer = setTimeout(next, 5000);
  }
  root.hidden = false; draw();
}

/* ---------- profile ---------- */
const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', staff: 'Staff' };
export async function openProfile(username) {
  const [p, grid] = await Promise.all([api(`/api/profile?user=${encodeURIComponent(username)}`).catch(() => null), api(`/api/user-posts?user=${encodeURIComponent(username)}`).catch(() => [])]);
  if (!p) return toast('Profile not found', { kind: 'error' });
  const self = p.username === state.me; const ignored = state.ignored.has(p.username);
  const frame = p.cosmetics.find((c) => c.kind === 'frame'); const tint = p.cosmetics.find((c) => c.kind === 'name_color');
  const name = h('strong', {}, p.displayName); if (tint) name.style.setProperty('color', tint.value);
  const avatar = avatarEl(p.avatar, p.displayName, 76); if (frame) avatar.classList.add(frame.value);
  avatar.style.setProperty('margin-top', '-38px'); avatar.style.setProperty('border', '3px solid var(--bg)'); avatar.style.setProperty('position', 'relative');
  const stat = (n, l) => h('div', {}, h('b', {}, String(n)), h('span', {}, l));
  const sounds = self ? [] : await api('/api/sounds').catch(() => []);
  const ring = h('select', { ariaLabel: 'Ringtone for this person', onchange: async () => { state.sound = await api('/api/sound/override', { body: { kind: 'ring', target: p.username, tone: ring.value } }); } },
    h('option', { value: 'default' }, 'Default ringtone'), ...[...BUILTIN_TONES.filter(([id]) => !['ringback', 'dial'].includes(id)), ...sounds.map((x) => [`custom:${x.id}`, x.label || 'Custom sound'])].map(([v, l]) => h('option', { value: v }, l)));
  ring.value = state.sound?.overrides.find((o) => o.kind === 'ring' && o.target === p.username)?.tone ?? 'default';
  const banner = h('div', { className: 'banner' }); if (p.banner) banner.style.setProperty('background-image', `url(/files/${p.banner})`);
  const followBtn = h('button', { className: p.isFollowing || p.requested ? 'ghost' : 'primary', type: 'button', onclick: async () => { try { await api('/api/follow', { body: { username: p.username, follow: !(p.isFollowing || p.requested) } }); openProfile(username); } catch (e) { fail(e); } } }, p.isFollowing ? 'Following' : p.requested ? 'Requested' : 'Follow');
  const friendBtn = { none: () => h('button', { className: 'ghost', type: 'button', onclick: async () => { try { await api('/api/friends/request', { body: { username: p.username } }); toast('Friend request sent', { ic: 'check' }); openProfile(username); } catch (e) { fail(e); } } }, 'Add friend'),
    outgoing: () => h('button', { className: 'ghost', type: 'button', onclick: async () => { await api('/api/friends/cancel', { body: { username: p.username } }); openProfile(username); } }, 'Request sent'),
    incoming: () => h('button', { className: 'primary', type: 'button', onclick: async () => { await api('/api/friends/respond', { body: { username: p.username, accept: true } }); openProfile(username); } }, 'Accept friend'),
    friends: () => h('button', { className: 'ghost', type: 'button', onclick: async () => { if (await confirmBox(`Remove ${p.displayName} as a friend?`, '', 'Remove', true)) { await api('/api/friends/remove', { body: { username: p.username } }); openProfile(username); } } }, 'Friends') }[p.friendState]?.();
  const give = !self && state.perms?.includes('sparks') ? h('button', { className: 'ghost', type: 'button', onclick: async () => { const r = await ask({ title: `Give Sparks to ${p.displayName}`, fields: [{ name: 'amount', label: 'Amount', type: 'number', value: '25' }, { name: 'reason', label: 'Reason (shown in the audit log)' }], ok: 'Give' }); if (!r) return;
    try { const res = await api('/api/owner/sparks', { body: { username: p.username, amount: Number(r.amount), reason: r.reason } }); toast(`Gave ${r.amount} Sparks (balance ${res.balance})`, { ic: 'bolt' }); confetti(); } catch (e) { fail(e); } } }, 'Give Sparks') : '';
  const song = p.song ? h('button', { type: 'button', className: 'music-badge', style: { position: 'static', background: 'var(--raised)', color: 'var(--text)' }, onclick: (e) => playMusic(p.song, 0, e.currentTarget) }, iconNode('music', 16), h('span', {}, 'Profile song')) : '';
  show(h('div', { className: 'profile-card' }, banner, h('div', { style: { padding: '0 14px' } }, avatar,
    h('div', { style: { display: 'flex', gap: '8px', 'align-items': 'center', 'flex-wrap': 'wrap' } }, name, ROLE_LABEL[p.role] ? h('span', { className: `role-chip ${p.role}` }, ROLE_LABEL[p.role]) : '', p.private ? iconNode('lock', 16) : '', h('small', { className: 'empty' }, `@${p.username}${p.pronouns ? ` · ${p.pronouns}` : ''}${p.followsYou && !self ? ' · follows you' : ''}${p.online ? ' · online' : ''}`)),
    p.status ? h('p', {}, p.status) : '', p.bio ? h('p', { className: 'empty' }, p.bio) : '', song,
    h('div', { className: 'tagrow' }, ...p.badges.map((b) => h('span', { className: 'role-chip', title: b.description }, b.name)), ...p.cosmetics.filter((c) => c.kind === 'badge').map((c) => h('span', { className: 'role-chip' }, c.value))),
    p.interests.length ? h('div', { className: 'tagrow', style: { 'margin-top': '8px' } }, ...p.interests.map((i) => h('span', { className: 'tagchip' }, i))) : '',
    p.links.length ? h('div', { className: 'tagrow', style: { 'margin-top': '8px' } }, ...p.links.map((l) => h('a', { className: 'tagchip', href: l.url, target: '_blank', rel: 'noopener noreferrer nofollow' }, l.label || l.url))) : '')),
    h('div', { className: 'stats', style: { 'margin-top': '12px' } }, stat(p.posts, 'posts'), stat(p.followers, 'followers'), stat(p.following, 'following')),
    ...(self ? [] : [h('div', { className: 'field-row', style: { 'margin-top': '12px' } }, followBtn, friendBtn, h('button', { className: 'ghost', type: 'button', onclick: () => { closePanel(); nav.openHome?.(); nav.openThread(p.username); } }, 'Message'), give,
      h('button', { className: 'ghost', type: 'button', onclick: async () => { await api('/api/ignore', { body: { username: p.username, ignored: !ignored } }); if (ignored) state.ignored.delete(p.username); else state.ignored.add(p.username); openProfile(username); } }, ignored ? 'Stop ignoring' : 'Ignore')),
      h('label', { style: { 'margin-top': '8px' } }, 'Ringtone for this person ', ring)]),
    p.locked ? h('div', { className: 'card', style: { 'margin-top': '12px', 'text-align': 'center' } }, iconNode('lock', 26), h('b', {}, 'This account is private'), h('small', { className: 'help' }, 'Follow this account to see their posts, reels and stories.'))
      : [h('h3', {}, 'Posts'), grid.length ? thumbs(grid) : h('p', { className: 'empty' }, 'No posts yet.')]);
}

Object.assign(nav, { openProfile, openPost, openHashtag, openSocial, lightbox: (url) => { const lb = $('lightbox'); lb.replaceChildren(h('img', { src: url, alt: 'Image' })); lb.hidden = false; lb.onclick = () => { lb.hidden = true; lb.replaceChildren(); }; }, confetti });
