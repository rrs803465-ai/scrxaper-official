import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { createApp } from '../server.js';
import { encryptPush } from '../extras.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(28)]);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrx-v2-'));
const app = createApp({ dbPath: ':memory:', authLimit: 1000, uploadDir: dir, ownerUsername: 'boss', ownerPassword: 'owner-password-123', pushAnyHost: true });
await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const base = `http://127.0.0.1:${app.server.address().port}`;
const H = { 'X-Requested-With': 'scrxaper' };
const call = async (method, url, body, cookie) => {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...H, ...(cookie && { Cookie: cookie }) }, body: body && JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => ({})), cookie: res.headers.get('set-cookie')?.split(';')[0] };
};
const join = async (n) => (await call('POST', '/api/register', { username: n, password: 'correct horse' })).cookie;
const owner = async () => (await call('POST', '/api/login', { username: 'boss', password: 'owner-password-123' })).cookie;
const up = async (kind, bytes, cookie, extra = '') => { const r = await fetch(`${base}/api/upload?kind=${kind}${extra}`, { method: 'POST', headers: { ...H, Cookie: cookie }, body: bytes }); return { status: r.status, data: await r.json() }; };
const sse = (cookie) => { const events = []; const ctl = new AbortController();
  fetch(`${base}/api/events`, { headers: { Cookie: cookie }, signal: ctl.signal }).then(async (r) => { const dec = new TextDecoder(); let buf = '';
    for await (const chunk of r.body) { buf += dec.decode(chunk); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const raw = buf.slice(0, i); buf = buf.slice(i + 2); const ev = /event: (.+)/.exec(raw)?.[1]; const data = /data: (.+)/.exec(raw)?.[1]; if (ev) events.push({ ev, data: JSON.parse(data) }); } } }).catch(() => {});
  return { events, close: () => ctl.abort() }; };
const until = async (fn, ms = 2000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); } return null; };

test('owner manages roles; staff get minimal powers, admins get full site powers, and only the owner makes admins', async () => {
  const [o, a, s, u] = [await owner(), await join('adminy'), await join('staffy'), await join('usery')];
  assert.equal((await call('GET', '/api/me', null, o)).data.role, 'owner');
  assert.equal((await call('POST', '/api/owner/role', { username: 'adminy', role: 'admin' }, a)).status, 404);
  assert.equal((await call('POST', '/api/owner/role', { username: 'adminy', role: 'admin' }, o)).status, 200);
  assert.equal((await call('POST', '/api/owner/role', { username: 'staffy', role: 'staff' }, a)).status, 200);
  assert.equal((await call('POST', '/api/owner/role', { username: 'usery', role: 'admin' }, a)).status, 403);
  assert.deepEqual((await call('GET', '/api/me', null, s)).data.perms, ['stats', 'users', 'warn']);
  assert.equal((await call('GET', '/api/owner/stats', null, s)).status, 200);
  assert.equal((await call('POST', '/api/owner/warn', { username: 'usery', reason: 'be nice' }, s)).status, 200);
  assert.equal((await call('POST', '/api/owner/ban', { username: 'usery', reason: 'x' }, s)).status, 404);
  assert.equal((await call('POST', '/api/owner/sparks', { username: 'usery', amount: 5 }, s)).status, 404);
  assert.equal((await call('POST', '/api/owner/sparks', { username: 'usery', amount: 25, reason: 'welcome gift' }, a)).data.balance, 25);
  assert.equal((await call('POST', '/api/owner/announce', { text: 'hello all' }, s)).status, 404);
  assert.equal((await call('POST', '/api/owner/ban', { username: 'staffy', reason: 'x' }, a)).status, 403);
  const ids = (await call('GET', '/api/profile?user=adminy', null, u)).data.badges.map((b) => b.id).filter((b) => b !== 'early');
  assert.deepEqual(ids.sort(), ['admin', 'staff']);
  assert.ok((await call('GET', '/api/profile?user=boss', null, u)).data.badges.some((b) => b.id === 'owner'));
  assert.equal((await call('POST', '/api/owner/role', { username: 'staffy', role: 'user' }, a)).status, 200);
  assert.equal((await call('GET', '/api/owner/stats', null, s)).status, 404);
  assert.equal((await call('GET', '/api/owner/team', null, o)).data.some((m) => m.username === 'adminy' && m.role === 'admin'), true);
});

test('a suspended person receives a ban event before the stream closes, and cannot log in', async () => {
  const [o, v] = [await owner(), await join('banme')];
  const stream = sse(v);
  await until(() => true, 100); await new Promise((r) => setTimeout(r, 150));
  await call('POST', '/api/owner/ban', { username: 'banme', reason: 'spamming links' }, o);
  const ev = await until(() => stream.events.find((e) => e.ev === 'banned'));
  assert.equal(ev.data.reason, 'spamming links');
  assert.equal((await call('GET', '/api/me', null, v)).status, 401);
  const login = await call('POST', '/api/login', { username: 'banme', password: 'correct horse' });
  assert.equal(login.status, 403); assert.match(login.data.error, /spamming links/);
  stream.close();
});

test('friend requests work like Discord: send, accept, mutual suggestions, friends-only direct messages', async () => {
  const [a, b, c, d] = [await join('fra'), await join('frb'), await join('frc'), await join('frd')];
  assert.equal((await call('POST', '/api/friends/request', { username: 'fra' }, a)).status, 404);
  assert.equal((await call('POST', '/api/friends/request', { username: 'frb' }, a)).status, 201);
  assert.equal((await call('POST', '/api/friends/request', { username: 'frb' }, a)).status, 409);
  assert.equal((await call('GET', '/api/friends', null, b)).data.incoming[0].username, 'fra');
  assert.equal((await call('GET', '/api/me', null, b)).data.friendRequests, 1);
  assert.equal((await call('POST', '/api/friends/respond', { username: 'fra', accept: true }, b)).data.state, 'friends');
  await call('POST', '/api/friends/request', { username: 'frc' }, b); await call('POST', '/api/friends/respond', { username: 'frb', accept: true }, c);
  const sug = (await call('GET', '/api/friends', null, a)).data.suggestions;
  assert.deepEqual(sug.map((s) => [s.username, s.mutual]), [['frc', 1]]);
  assert.equal((await call('POST', '/api/friends/request', { username: 'frc' }, a)).status, 201);
  assert.equal((await call('POST', '/api/friends/request', { username: 'fra' }, c)).data.state, 'friends');
  await call('POST', '/api/privacy', { whoCanMessage: 'friends', previews: true, dnd: false }, d);
  assert.equal((await call('POST', '/api/messages', { to: 'frd', body: 'hi' }, a)).status, 403);
  await call('POST', '/api/friends/request', { username: 'frd' }, a); await call('POST', '/api/friends/respond', { username: 'fra', accept: true }, d);
  assert.equal((await call('POST', '/api/messages', { to: 'frd', body: 'hi' }, a)).status, 201);
  const notes = (await call('GET', '/api/notifications', null, a)).data;
  assert.ok(notes.items.some((n) => n.kind === 'friend_accept' && n.actor.username === 'frb'));
  await call('POST', '/api/friends/remove', { username: 'frb' }, a);
  assert.equal((await call('GET', '/api/friends', null, b)).data.friends.some((f) => f.username === 'fra'), false);
});

test('private accounts: followers need approval and posts, reels and stories stay hidden until accepted', async () => {
  const [p, f, x] = [await join('priv'), await join('fan'), await join('rando')];
  const post = (await up('post', PNG, p)).data.id; await call('POST', '/api/posts', { media: post, caption: 'secret #hush' }, p);
  await call('POST', '/api/privacy', { whoCanMessage: 'everyone', previews: true, dnd: false, privateAccount: true }, p);
  const r = await call('POST', '/api/follow', { username: 'priv', follow: true }, f);
  assert.equal(r.data.requested, true); assert.equal(r.data.following, false);
  const prof = (await call('GET', '/api/profile?user=priv', null, f)).data;
  assert.equal(prof.locked, true); assert.equal(prof.requested, true);
  assert.deepEqual((await call('GET', '/api/user-posts?user=priv', null, f)).data, []);
  assert.equal((await fetch(`${base}/files/${post}`, { headers: { Cookie: f } })).status, 404);
  assert.equal((await call('GET', '/api/hashtag?tag=hush', null, f)).data.posts.length, 0);
  assert.equal((await call('GET', '/api/follow-requests', null, p)).data[0].username, 'fan');
  await call('POST', '/api/follow-requests/respond', { username: 'fan', accept: true }, p);
  assert.equal((await call('GET', '/api/user-posts?user=priv', null, f)).data.length, 1);
  assert.equal((await fetch(`${base}/files/${post}`, { headers: { Cookie: f } })).status, 200);
  assert.equal((await call('GET', '/api/hashtag?tag=hush', null, f)).data.posts.length, 1);
  assert.equal((await call('GET', '/api/hashtag?tag=hush', null, x)).data.posts.length, 0);
  await call('POST', '/api/follow', { username: 'priv', follow: true }, x);
  await call('POST', '/api/privacy', { whoCanMessage: 'everyone', previews: true, dnd: false, privateAccount: false }, p);
  assert.equal((await call('GET', '/api/user-posts?user=priv', null, x)).data.length, 1);
});

test('hashtags, explore, notifications for likes, follows and comments, and sharing a post into a chat', async () => {
  const [a, b] = [await join('tagger'), await join('liker')];
  const m1 = (await up('post', PNG, a)).data.id; const id = (await call('POST', '/api/posts', { media: m1, caption: 'Sunset #Sky #sky #golden_hour' }, a)).data.id;
  assert.equal((await call('GET', '/api/hashtag?tag=%23SKY', null, b)).data.posts[0].id, id);
  assert.equal((await call('GET', '/api/hashtag?tag=a', null, b)).status, 400);
  await call('POST', '/api/posts/edit', { post: id, caption: 'now #dusk' }, a);
  assert.equal((await call('GET', '/api/hashtag?tag=sky', null, b)).data.posts.length, 0);
  const ex = (await call('GET', '/api/explore', null, b)).data;
  assert.ok(ex.tags.some((t) => t.tag === 'dusk')); assert.equal(ex.posts[0].id, id);
  await call('POST', '/api/follow', { username: 'tagger', follow: true }, b);
  await call('POST', '/api/posts/like', { post: id, liked: true }, b);
  await call('POST', '/api/posts/like', { post: id, liked: false }, b);
  await call('POST', '/api/posts/like', { post: id, liked: true }, b);
  await call('POST', '/api/posts/comment', { post: id, body: 'lovely' }, b);
  const n = (await call('GET', '/api/notifications', null, a)).data;
  assert.deepEqual(n.items.map((i) => i.kind).sort(), ['comment', 'follow', 'like']);
  assert.equal(n.unread, 3);
  await call('POST', '/api/notifications/read', {}, a);
  assert.equal((await call('GET', '/api/notifications', null, a)).data.unread, 0);
  assert.equal((await call('POST', '/api/posts/share', { post: id, to: 'tagger' }, b)).status, 201);
  const msgs = (await call('GET', '/api/messages?with=liker', null, a)).data.messages;
  assert.equal(msgs.at(-1).kind, 'post'); assert.equal(msgs.at(-1).body, String(id));
});

test('reactions toggle, are limited per message and are only open to people who can see the message', async () => {
  const [a, b, c] = [await join('rxa'), await join('rxb'), await join('rxc')];
  const id = (await call('POST', '/api/messages', { to: 'rxb', body: 'hey' }, a)).data.id;
  assert.equal((await call('POST', '/api/reactions', { scope: 'dm', id, emoji: '🔥' }, b)).data.reactions[0].n, 1);
  assert.equal((await call('POST', '/api/reactions', { scope: 'dm', id, emoji: '🔥' }, c)).status, 404);
  assert.equal((await call('POST', '/api/reactions', { scope: 'dm', id, emoji: '💩' }, b)).status, 400);
  for (const e of ['👍', '❤️']) await call('POST', '/api/reactions', { scope: 'dm', id, emoji: e }, b);
  assert.equal((await call('POST', '/api/reactions', { scope: 'dm', id, emoji: '😂' }, b)).status, 409);
  assert.equal((await call('GET', `/api/reactions?scope=dm&ids=${id}`, null, a)).data[id].length, 3);
  await call('POST', '/api/reactions', { scope: 'dm', id, emoji: '🔥' }, b);
  assert.equal((await call('GET', `/api/reactions?scope=dm&ids=${id}`, null, a)).data[id].length, 2);
});

test('premade bots: security blocks and times out, fun and music answer commands, welcome greets, only admins manage', async () => {
  const [o, m, s] = [await join('bown'), await join('bmem'), await join('bsec')];
  const cid = (await call('POST', '/api/communities', { name: 'Botland', bots: ['security', 'fun', 'welcome', 'music', 'nonsense'] }, o)).data.id;
  const code = (await call('POST', '/api/community-invite', { community: cid }, o)).data.code;
  const d = (await call('GET', `/api/community?id=${cid}`, null, o)).data;
  assert.deepEqual(d.bots.sort(), ['fun', 'music', 'security', 'welcome']);
  const general = d.channels.find((c) => c.name === 'general').id;
  assert.ok(d.channels.some((c) => c.voice));
  await call('POST', '/api/community-join', { code }, m);
  const greeting = (await call('GET', `/api/channel-messages?channel=${general}`, null, o)).data.messages.find((x) => x.bot);
  assert.match(greeting.body, /Welcome, bmem/); assert.equal(greeting.name, 'Welcome');
  await call('POST', '/api/channel-messages', { channel: general, body: '!roll 20' }, m);
  await call('POST', '/api/channel-messages', { channel: general, body: '!choose tea | coffee' }, m);
  let log = (await call('GET', `/api/channel-messages?channel=${general}`, null, m)).data.messages;
  assert.ok(log.some((x) => x.bot && /rolled a \d+ \(d20\)/.test(x.body)) && log.some((x) => x.bot && /I choose: (tea|coffee)/.test(x.body)));
  const blocked = await call('POST', '/api/channel-messages', { channel: general, body: 'join https://discord.gg/abc' }, m);
  assert.equal(blocked.status, 400); assert.match(blocked.data.error, /^Security: invite links/);
  assert.equal((await call('POST', '/api/channel-messages', { channel: general, body: 'THIS IS ALL SHOUTING HERE' }, m)).status, 400);
  const third = await call('POST', '/api/channel-messages', { channel: general, body: 'https://t.me/x' }, m);
  assert.equal(third.status, 403); assert.match(third.data.error, /timed out/);
  assert.equal((await call('POST', '/api/channel-messages', { channel: general, body: 'hello' }, m)).status, 403);
  assert.equal((await call('POST', '/api/channel-messages', { channel: general, body: 'https://discord.gg/abc' }, o)).status, 201);
  assert.equal((await call('POST', '/api/bots/install', { scope: 'community', id: cid, bot: 'security', config: { words: ['Spoon'] } }, m)).status, 403);
  await call('POST', '/api/bots/install', { scope: 'community', id: cid, bot: 'security', config: { words: ['Spoon'], invites: true, flood: false, strikes: 9 } }, o);
  await call('POST', '/api/community-role', { community: cid, username: 'bmem', role: 'member' }, o);
  assert.equal((await call('GET', '/api/bots/catalog', null, m)).data.length, 4);
  // music: upload tracks (max 10 MB), play in chat, only members may fetch
  const big = await up('bot-music', Buffer.concat([WAV, Buffer.alloc(11 * 1024 * 1024)]), o, `&scope=community&id=${cid}`);
  assert.equal(big.status, 413);
  assert.equal((await up('bot-music', WAV, m, `&scope=community&id=${cid}&name=x.wav`)).status, 403);
  const track = (await up('bot-music', Buffer.concat([WAV, Buffer.alloc(3 * 1024 * 1024)]), o, `&scope=community&id=${cid}&name=Night%20Drive.wav`)).data;
  await call('POST', '/api/channel-messages', { channel: general, body: '!play night' }, o);
  log = (await call('GET', `/api/channel-messages?channel=${general}`, null, o)).data.messages;
  const music = log.find((x) => x.kind === 'music');
  assert.equal(JSON.parse(music.body).track, track.id);
  assert.equal((await fetch(`${base}/files/${track.id}`, { headers: { Cookie: s } })).status, 404);
  assert.equal((await fetch(`${base}/files/${track.id}`, { headers: { Cookie: m } })).status, 200);
  // groups can install bots too
  const gid = (await call('POST', '/api/groups', { name: 'Crew', bots: ['fun'] }, o)).data.id;
  await call('POST', '/api/group-messages', { group: gid, body: '!flip' }, o);
  assert.ok((await call('GET', `/api/group-messages?group=${gid}`, null, o)).data.messages.some((x) => x.bot && /flipped/.test(x.body)));
  assert.equal((await call('POST', '/api/bots', { name: 'old_bot' }, o)).status, 404);
});

test('voice channels and group calls: join, signal, leave, capacity and access control', async () => {
  const [o, m, x] = [await join('vown'), await join('vmem'), await join('vout')];
  const cid = (await call('POST', '/api/communities', { name: 'Voice' }, o)).data.id;
  const code = (await call('POST', '/api/community-invite', { community: cid }, o)).data.code;
  await call('POST', '/api/community-join', { code }, m);
  const vc = (await call('POST', '/api/channels', { community: cid, name: 'hangout', kind: 'voice' }, o)).data.id;
  assert.equal((await call('POST', '/api/channel-messages', { channel: vc, body: 'text?' }, o)).status, 400);
  assert.equal((await call('POST', '/api/voice/join', { channel: vc }, x)).status, 404);
  const ev = sse(m); await new Promise((r) => setTimeout(r, 150));
  const j1 = await call('POST', '/api/voice/join', { channel: vc }, o);
  assert.deepEqual(j1.data.peers, []);
  assert.ok(await until(() => ev.events.find((e) => e.ev === 'voice' && e.data.type === 'state' && e.data.users.length === 1)));
  const j2 = await call('POST', '/api/voice/join', { channel: vc }, m);
  assert.deepEqual(j2.data.peers.map((p) => p.username), ['vown']);
  const so = sse(o); await new Promise((r) => setTimeout(r, 150));
  assert.equal((await call('POST', '/api/voice/signal', { room: j1.data.room, to: 'vown', data: { description: { type: 'offer', sdp: 'x' } } }, m)).status, 200);
  assert.ok(await until(() => so.events.find((e) => e.ev === 'voice' && e.data.type === 'signal' && e.data.from === 'vmem')));
  assert.equal((await call('POST', '/api/voice/signal', { room: j1.data.room, to: 'vown', data: {} }, x)).status, 404);
  assert.equal((await call('GET', `/api/voice/state?community=${cid}`, null, o)).data[vc].length, 2);
  await call('POST', '/api/voice/leave', {}, m);
  assert.equal((await call('GET', `/api/voice/state?community=${cid}`, null, o)).data[vc].length, 1);
  // group call rings other members
  const gid = (await call('POST', '/api/groups', { name: 'Call me', members: ['vmem'] }, o)).data.id;
  await call('POST', '/api/voice/join', { group: gid, video: true }, o);
  const inv = await until(() => ev.events.find((e) => e.ev === 'voice-invite'));
  assert.equal(inv.data.from, 'vown'); assert.equal(inv.data.video, true);
  ev.close(); so.close();
});

test('web push: payloads are RFC 8291 encrypted and delivered with a VAPID header; dead subscriptions are dropped', async () => {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const keys = { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') };
  // independent decryptor written from the RFC, to check the encryption round trip
  const decrypt = (blob) => {
    const salt = blob.subarray(0, 16); const idlen = blob[20]; const asPub = blob.subarray(21, 21 + idlen); const data = blob.subarray(21 + idlen);
    const hk = (ikm, s, info, n) => Buffer.from(crypto.hkdfSync('sha256', ikm, s, info, n));
    const ikm = hk(ua.computeSecret(asPub), auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]), 32);
    const d = crypto.createDecipheriv('aes-128-gcm', hk(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16), hk(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
    d.setAuthTag(data.subarray(-16));
    const plain = Buffer.concat([d.update(data.subarray(0, -16)), d.final()]);
    assert.equal(plain.at(-1), 2); return plain.subarray(0, -1).toString();
  };
  assert.equal(decrypt(encryptPush('hello push', keys.p256dh, keys.auth)), 'hello push');
  // RFC 8291 appendix A known-answer test
  const kat = encryptPush('When I grow up, I want to be a watermelon', 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'BTBZMqHH6r4Tts7J_aSIgg',
    { asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', salt: Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url') });
  assert.equal(kat.toString('base64url'), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
  const got = []; let status = 201;
  const sink = http.createServer((req, res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => { got.push({ h: req.headers, body: Buffer.concat(c) }); res.statusCode = status; res.end(); }); }).listen(0, '127.0.0.1');
  await new Promise((r) => sink.on('listening', r));
  const endpoint = `http://127.0.0.1:${sink.address().port}/push/abc`;
  const [callee, caller] = [await join('pushee'), await join('pusher')];
  assert.match((await call('GET', '/api/push/key', null, callee)).data.key, /^B[\w-]{86}$/);
  assert.equal((await call('POST', '/api/push/subscribe', { subscription: { endpoint: 'not a url', keys } }, callee)).status, 400);
  assert.equal((await call('POST', '/api/push/subscribe', { subscription: { endpoint, keys } }, callee)).status, 201);
  await call('POST', '/api/call/start', { to: 'pushee' }, caller);
  const first = await until(() => got[0]);
  assert.match(first.h.authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=B[\w-]{86}$/);
  assert.equal(first.h['content-encoding'], 'aes128gcm'); assert.equal(first.h.urgency, 'high');
  const payload = JSON.parse(decrypt(first.body));
  assert.equal(payload.kind, 'call'); assert.match(payload.title, /pusher is calling/); assert.equal(payload.requireInteraction, true);
  const pending = (await call('GET', '/api/call/pending', null, callee)).data;
  assert.equal(pending.from, 'pusher');
  await call('POST', '/api/call/end', { call: pending.id }, caller);
  const end = await until(() => got[1]);
  assert.equal(JSON.parse(decrypt(end.body)).kind, 'call-end');
  // offline direct messages push; an online recipient is not pushed
  got.length = 0; status = 410;
  await call('POST', '/api/messages', { to: 'pushee', body: 'wake up' }, caller);
  assert.equal(JSON.parse(decrypt((await until(() => got[0])).body)).body, 'wake up');
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM push_subs').get().n, 0);
  sink.close();
});

test('profile extras: preset avatars, onboarding, spectrum, call tune, interface prefs, profile song and music on posts and stories', async () => {
  const [a, b] = [await join('ona'), await join('onb')];
  assert.equal((await call('GET', '/api/me', null, a)).data.onboarded, false);
  assert.equal((await call('POST', '/api/avatar/preset', { id: 'nope' }, a)).status, 400);
  await call('POST', '/api/onboarding', { displayName: 'Ona Q', bio: 'hi', interests: ['Music ', 'art', 'music'], avatarPreset: 'tide', theme: 'light', privateAccount: false, whoCanMessage: 'friends', birthday: { month: 3, day: 9 } }, a);
  const me = (await call('GET', '/api/me', null, a)).data;
  assert.equal(me.onboarded, true); assert.equal(me.avatar, 'preset:tide'); assert.equal(me.displayName, 'Ona Q'); assert.equal(me.birthday, '03-09'); assert.equal(me.privacy.whoCanMessage, 'friends');
  assert.deepEqual((await call('GET', '/api/profile?user=ona', null, b)).data.interests, ['music', 'art']);
  assert.equal((await call('POST', '/api/spectrum', { style: 'cd', color: 'red' }, a)).status, 400);
  assert.equal((await call('POST', '/api/spectrum', { style: 'cd', color: '#ff8800' }, a)).data.style, 'cd');
  assert.deepEqual((await call('GET', '/api/me', null, a)).data.spectrum, { style: 'cd', color: '#ff8800' });
  const track = (await up('sound', Buffer.concat([WAV, Buffer.alloc(8 * 1024 * 1024)]), a, '&name=Full%20song.wav')).data.id;
  assert.equal((await call('POST', '/api/sound', { tone: 'chime', ringtone: `custom:${track}`, callTune: 'dial', volume: 80 }, a)).data.callTune, 'dial');
  assert.equal((await call('POST', '/api/sound', { tone: 'chime', ringtone: 'ring', callTune: 'bogus', volume: 80 }, a)).status, 400);
  assert.equal((await fetch(`${base}/files/${track}`, { headers: { Cookie: b } })).status, 404);
  const m = (await up('post', PNG, a)).data.id;
  assert.equal((await call('POST', '/api/posts', { media: m, caption: 'with music', sound: { id: 'f'.repeat(32) } }, a)).status, 400);
  const pid = (await call('POST', '/api/posts', { media: m, caption: 'with music', sound: { id: track, start: 12 } }, a)).data.id;
  const post = (await call('GET', `/api/post?id=${pid}`, null, b)).data;
  assert.equal(post.sound, track); assert.equal(post.soundStart, 12);
  assert.equal((await fetch(`${base}/files/${track}`, { headers: { Cookie: b } })).status, 200);
  const sm = (await up('story', PNG, a)).data.id;
  await call('POST', '/api/stories', { media: sm, caption: 'story text', sound: { id: track } }, a);
  await call('POST', '/api/follow', { username: 'ona', follow: true }, b);
  const tray = (await call('GET', '/api/stories', null, b)).data;
  assert.equal(tray[0].stories[0].caption, 'story text'); assert.equal(tray[0].stories[0].sound, track);
  const ui = (await call('POST', '/api/ui', { ui: { bubble: 'square', font: 'huge', accent2: '#112233', wallpaper: 'aurora' } }, a)).data.ui;
  assert.equal(ui.bubble, 'square'); assert.equal(ui.font, 'md'); assert.equal(ui.accent2, '#112233');
  await call('POST', '/api/profile/song', { id: track }, a);
  assert.equal((await call('GET', '/api/profile?user=ona', null, b)).data.song, track);
  await call('POST', '/api/sounds/delete', { id: track }, a);
  assert.equal((await call('GET', `/api/post?id=${pid}`, null, b)).data.sound, null);
});
