import crypto from 'node:crypto';

/* ---------- schema ---------- */
export function migrateExtras(db) {
  const addCol = (table, col, def) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  };
  addCol('users', 'role', "TEXT NOT NULL DEFAULT 'user'");
  for (const [col, def] of [['private', 'INTEGER NOT NULL DEFAULT 0'], ['pronouns', "TEXT NOT NULL DEFAULT ''"], ['links', "TEXT NOT NULL DEFAULT '[]'"],
    ['interests', "TEXT NOT NULL DEFAULT '[]'"], ['onboarded', 'INTEGER NOT NULL DEFAULT 0'], ['show_online', 'INTEGER NOT NULL DEFAULT 1'],
    ['call_tune', "TEXT NOT NULL DEFAULT 'ringback'"], ['spectrum_style', "TEXT NOT NULL DEFAULT 'bars'"], ['spectrum_color', "TEXT NOT NULL DEFAULT '#b7c9e6'"],
    ['ui', "TEXT NOT NULL DEFAULT '{}'"], ['song_id', 'TEXT']]) addCol('profiles', col, def);
  for (const t of ['posts', 'stories']) { addCol(t, 'sound_id', 'TEXT'); addCol(t, 'sound_start', 'REAL NOT NULL DEFAULT 0'); addCol(t, 'sound_label', 'TEXT'); }
  addCol('stories', 'caption', "TEXT NOT NULL DEFAULT ''");
  addCol('channels', 'voice', 'INTEGER NOT NULL DEFAULT 0');
  addCol('group_messages', 'kind', "TEXT NOT NULL DEFAULT 'text'");
  addCol('channel_messages', 'kind', "TEXT NOT NULL DEFAULT 'text'");
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS friend_requests (
      from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL, PRIMARY KEY (from_id, to_id)
    );
    CREATE TABLE IF NOT EXISTS friends (
      a_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, b_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      since INTEGER NOT NULL, PRIMARY KEY (a_id, b_id)
    );
    CREATE TABLE IF NOT EXISTS follow_requests (
      requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, target_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL, PRIMARY KEY (requester_id, target_id)
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL,
      actor_id INTEGER NOT NULL DEFAULT 0, ref TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, read_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS notifications_user ON notifications (user_id, id);
    CREATE UNIQUE INDEX IF NOT EXISTS notifications_once ON notifications (user_id, kind, actor_id, ref) WHERE kind IN ('like', 'follow', 'follow_request', 'friend_request');
    CREATE TABLE IF NOT EXISTS post_tags (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY (post_id, tag)
    );
    CREATE INDEX IF NOT EXISTS post_tags_tag ON post_tags (tag, post_id);
    CREATE TABLE IF NOT EXISTS reactions (
      scope TEXT NOT NULL, msg_id INTEGER NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, emoji TEXT NOT NULL,
      PRIMARY KEY (scope, msg_id, user_id, emoji)
    );
    CREATE TABLE IF NOT EXISTS bot_installs (
      scope TEXT NOT NULL CHECK (scope IN ('community', 'group')), scope_id INTEGER NOT NULL, bot TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, PRIMARY KEY (scope, scope_id, bot)
    );
    CREATE TABLE IF NOT EXISTS bot_tracks (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, scope_id INTEGER NOT NULL, title TEXT NOT NULL, size INTEGER NOT NULL,
      uploader INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS push_subs (
      endpoint TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs (user_id);
  `);
}

/* ---------- constants ---------- */
export const BOT_CATALOG = [
  { id: 'security', name: 'Security', username: 'security_bot', summary: 'Blocks spam floods, invite links, shouting and words you ban. Auto-timeouts repeat offenders.',
    commands: [], defaults: { invites: true, links: false, caps: true, flood: true, words: [], strikes: 3, timeoutMinutes: 5 } },
  { id: 'music', name: 'Music', username: 'music_bot', summary: 'Upload tracks into the bot (up to 10 MB each). Anyone can play them in chat with !play.',
    commands: ['!tracks', '!play <number or title>'], defaults: {} },
  { id: 'welcome', name: 'Welcome', username: 'welcome_bot', summary: 'Greets new members the moment they join.', commands: [], defaults: { message: 'Welcome, {user}! Glad you are here.' } },
  { id: 'fun', name: 'Fun & Games', username: 'fun_bot', summary: 'Dice, coin flips, 8-ball, rock-paper-scissors and quick decisions.',
    commands: ['!roll [sides]', '!flip', '!8ball <question>', '!choose a | b | c', '!rps rock|paper|scissors'], defaults: {} },
];
export const PRESET_AVATARS = ['aurora', 'ember', 'tide', 'moss', 'dusk', 'rose', 'slate', 'sun', 'ink', 'mint', 'plum', 'sky'];
export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👀'];
const ROLE_PERMS = {
  staff: ['stats', 'users', 'warn'],
  admin: ['stats', 'users', 'warn', 'ban', 'announce', 'sparks', 'content', 'audit', 'staff'],
  owner: ['stats', 'users', 'warn', 'ban', 'announce', 'sparks', 'content', 'audit', 'staff', 'admins'],
};
const PUSH_HOSTS = /(^|\.)(googleapis\.com|mozilla\.com|mozaws\.net|windows\.com|apple\.com)$/i;
const TAG = /#([\p{L}\p{N}_]{2,30})/gu;
export const tagsOf = (text) => [...new Set([...String(text ?? '').matchAll(TAG)].map((m) => m[1].toLowerCase()))].slice(0, 10);

/* ---------- web push (RFC 8291 aes128gcm + RFC 8292 VAPID), Node built-ins only ---------- */
const hkdf = (ikm, salt, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));
export function encryptPush(payload, p256dh, auth, { asPrivate, salt = crypto.randomBytes(16) } = {}) {
  const ua = Buffer.from(p256dh, 'base64url');
  const authSecret = Buffer.from(auth, 'base64url');
  const as = crypto.createECDH('prime256v1');
  if (asPrivate) as.setPrivateKey(Buffer.from(asPrivate, 'base64url')); else as.generateKeys();
  const asPublic = as.getPublicKey();
  const ikm = hkdf(as.computeSecret(ua), authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPublic]), 32);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([salt, Buffer.from([0, 0, 0x10, 0, asPublic.length]), asPublic, body]);
}

/* ---------- installer ---------- */
export function installExtras(c) {
  const { db, push, streams, sendJson, readJson, readBytes, HttpError, countOf, userNamed, findPeer, isBlocked, limited, audit, avatarOf, prefsOf, sha,
    hiddenFrom, postSelect, shapePost, visiblePost, needHuman, needMember, channelAccess, canPost, needCMember, needRole, loadMember, RANK, logMod,
    storeFile, removeFile, sniff, maxAttachBytes, pushAnyHost, teamsId } = c;
  const now = () => Date.now();
  const online = (uid) => (streams.get(uid)?.size ?? 0) > 0;
  const userCard = (u) => ({ username: u.username, name: u.display_name ?? u.name, avatar: avatarOf(u.id) });
  const cardOf = (id) => { const u = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(id); return u && userCard(u); };

  /* roles and site permissions */
  const roleOf = (u) => (u.is_owner ? 'owner' : u.role || 'user');
  const permsFor = (u) => ROLE_PERMS[roleOf(u)] ?? [];
  const needSite = (me, perm) => { if (!permsFor(me).includes(perm)) throw new HttpError(404, 'Not found'); };
  const ROLE_BADGES = { owner: ['owner', 'staff'], admin: ['admin', 'staff'], staff: ['staff'] };
  const seedBadge = db.prepare('INSERT OR REPLACE INTO badges (id, name, description) VALUES (?, ?, ?)');
  seedBadge.run('owner', 'Owner', 'Owns and runs this Scrxaper instance.');
  seedBadge.run('admin', 'Admin', 'Trusted with full moderation power on Scrxaper.');
  seedBadge.run('staff', 'Scrxaper staff', 'Part of the team that looks after Scrxaper.');
  const syncRoleBadges = (uid) => {
    const u = db.prepare('SELECT id, is_owner, role FROM users WHERE id = ?').get(uid);
    if (!u) return;
    db.prepare("DELETE FROM user_badges WHERE user_id = ? AND badge_id IN ('owner', 'admin', 'staff')").run(uid);
    for (const b of ROLE_BADGES[roleOf(u)] ?? []) db.prepare('INSERT OR IGNORE INTO user_badges (user_id, badge_id, at, source) VALUES (?, ?, ?, ?)').run(uid, b, now(), 'role');
  };
  for (const { id } of db.prepare("SELECT id FROM users WHERE is_owner = 1 OR role IN ('admin', 'staff')").all()) syncRoleBadges(id);

  /* premade bot accounts */
  const botUsers = {};
  for (const b of BOT_CATALOG) {
    db.prepare("INSERT OR IGNORE INTO users (username, display_name, password_hash, created_at, is_system, is_bot) VALUES (?, ?, '!', ?, 1, 1)").run(b.username, b.name, now());
    botUsers[b.id] = db.prepare('SELECT id, username, display_name AS name FROM users WHERE username = ?').get(b.username);
  }

  /* web push */
  const vapid = (() => {
    let row = db.prepare("SELECT v FROM kv WHERE k = 'vapid'").get();
    if (!row) {
      const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      const pub = publicKey.export({ format: 'jwk' });
      const value = JSON.stringify({ priv: privateKey.export({ format: 'jwk' }), pub: Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]).toString('base64url') });
      db.prepare("INSERT INTO kv (k, v) VALUES ('vapid', ?)").run(value);
      row = { v: value };
    }
    const { priv, pub } = JSON.parse(row.v);
    return { key: crypto.createPrivateKey({ key: priv, format: 'jwk' }), pub };
  })();
  const vapidHeader = (endpoint) => {
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const input = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud: new URL(endpoint).origin, exp: Math.floor(now() / 1000) + 12 * 3600, sub: process.env.VAPID_SUBJECT || 'mailto:admin@example.com' })}`;
    const sig = crypto.sign('sha256', Buffer.from(input), { key: vapid.key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return `vapid t=${input}.${sig}, k=${vapid.pub}`;
  };
  const pushLog = [];
  const sendWebPush = async (sub, payload, { ttl = 60, urgency = 'normal' } = {}) => {
    try {
      const res = await fetch(sub.endpoint, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(8000),
        headers: { Authorization: vapidHeader(sub.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: urgency },
        body: encryptPush(JSON.stringify(payload), sub.p256dh, sub.auth) });
      if (res.status === 404 || res.status === 410) db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(sub.endpoint);
      pushLog.push(res.status); if (pushLog.length > 50) pushLog.shift();
      return res.status;
    } catch { return 0; }
  };
  const pushTo = (uid, payload, opts) => {
    const subs = db.prepare('SELECT endpoint, p256dh, auth FROM push_subs WHERE user_id = ?').all(uid);
    return Promise.all(subs.map((s) => sendWebPush(s, payload, opts)));
  };
  const quiet = (uid) => !!db.prepare('SELECT dnd FROM profiles WHERE user_id = ?').get(uid)?.dnd;
  const pushOffline = (uid, payload, opts) => { if (!online(uid) && !quiet(uid)) return pushTo(uid, payload, opts); };

  /* notifications */
  const NOTE = { like: 'liked your post', comment: 'commented on your post', follow: 'started following you', follow_request: 'wants to follow you',
    follow_accept: 'accepted your follow request', friend_request: 'sent you a friend request', friend_accept: 'accepted your friend request', share: 'shared a post with you', role: '' };
  const addNote = (userId, kind, actor, ref = '', text = '') => {
    if (actor && actor.id === userId) return;
    const dedupe = ['like', 'follow', 'follow_request', 'friend_request'].includes(kind);
    const r = db.prepare(`INSERT ${dedupe ? 'OR IGNORE ' : ''}INTO notifications (user_id, kind, actor_id, ref, text, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(userId, kind, actor?.id ?? 0, String(ref), text, now());
    if (!r.changes) return;
    const body = { id: Number(r.lastInsertRowid), kind, ref: String(ref), text: text || NOTE[kind], at: now(), actor: actor ? cardOf(actor.id) : null };
    push(userId, 'notify', body);
    pushOffline(userId, { title: body.actor ? body.actor.name : 'Scrxaper', body: `${body.actor ? '' : ''}${body.text}`, tag: `note:${kind}`, kind: 'note', url: '/' });
  };

  /* hashtags */
  const saveTags = (postId, caption) => {
    db.prepare('DELETE FROM post_tags WHERE post_id = ?').run(postId);
    for (const t of tagsOf(caption)) db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag) VALUES (?, ?)').run(postId, t);
  };

  /* friends */
  const areFriends = (a, b) => !!db.prepare('SELECT 1 FROM friends WHERE a_id = ? AND b_id = ?').get(a, b);
  const makeFriends = (a, b) => { const t = now(); db.prepare('INSERT OR IGNORE INTO friends (a_id, b_id, since) VALUES (?, ?, ?)').run(a, b, t); db.prepare('INSERT OR IGNORE INTO friends (a_id, b_id, since) VALUES (?, ?, ?)').run(b, a, t); };
  const friendRow = (u) => ({ username: u.username, name: u.name, avatar: u.avatar, status: u.status ?? '', online: !!u.show_online && online(u.id) });
  const listFriends = (me) => ({
    friends: db.prepare(`SELECT u.id, u.username, u.display_name AS name, p.avatar_id AS avatar, p.status, COALESCE(p.show_online, 1) AS show_online FROM friends f JOIN users u ON u.id = f.b_id
      LEFT JOIN profiles p ON p.user_id = u.id WHERE f.a_id = ? ORDER BY u.display_name COLLATE NOCASE`).all(me.id).map(friendRow),
    incoming: db.prepare(`SELECT u.id, u.username, u.display_name AS name, p.avatar_id AS avatar FROM friend_requests r JOIN users u ON u.id = r.from_id LEFT JOIN profiles p ON p.user_id = u.id
      WHERE r.to_id = ? ORDER BY r.created_at DESC`).all(me.id).map(friendRow),
    outgoing: db.prepare(`SELECT u.id, u.username, u.display_name AS name, p.avatar_id AS avatar FROM friend_requests r JOIN users u ON u.id = r.to_id LEFT JOIN profiles p ON p.user_id = u.id
      WHERE r.from_id = ? ORDER BY r.created_at DESC`).all(me.id).map(friendRow),
    suggestions: db.prepare(`SELECT u.username, u.display_name AS name, (SELECT avatar_id FROM profiles WHERE user_id = u.id) AS avatar, COUNT(*) AS mutual
      FROM friends f1 JOIN friends f2 ON f2.a_id = f1.b_id JOIN users u ON u.id = f2.b_id
      WHERE f1.a_id = :me AND f2.b_id != :me AND u.is_system = 0 AND u.is_bot = 0 AND u.banned_at IS NULL
        AND f2.b_id NOT IN (SELECT b_id FROM friends WHERE a_id = :me)
        AND f2.b_id NOT IN (SELECT to_id FROM friend_requests WHERE from_id = :me UNION SELECT from_id FROM friend_requests WHERE to_id = :me)
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = :me AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = :me))
      GROUP BY u.id ORDER BY mutual DESC, u.username LIMIT 12`).all({ me: me.id }),
  });
  const friendState = (a, b) => (areFriends(a, b) ? 'friends' : db.prepare('SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?').get(a, b) ? 'outgoing'
    : db.prepare('SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?').get(b, a) ? 'incoming' : 'none');

  /* presence */
  const friendIds = (uid) => db.prepare('SELECT b_id AS id FROM friends WHERE a_id = ?').all(uid).map((r) => r.id);
  const presence = (uid, isOnline) => {
    if (!db.prepare('SELECT COALESCE(show_online, 1) AS s FROM profiles WHERE user_id = ?').get(uid)?.s && db.prepare('SELECT 1 FROM profiles WHERE user_id = ?').get(uid)) return;
    const u = db.prepare('SELECT username FROM users WHERE id = ?').get(uid);
    if (u) friendIds(uid).forEach((f) => push(f, 'presence', { username: u.username, online: isOnline }));
  };

  /* voice rooms (full mesh WebRTC, small groups) */
  const rooms = new Map();
  const MAX_VOICE = 8;
  const roomUsers = (key) => [...(rooms.get(key) ?? new Map()).entries()].map(([, v]) => v);
  const roomAudience = (key) => {
    const [kind, id] = key.split(':');
    return (kind === 'ch'
      ? db.prepare('SELECT user_id FROM community_members WHERE community_id = (SELECT community_id FROM channels WHERE id = ?)').all(Number(id))
      : db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(Number(id))).map((r) => r.user_id);
  };
  const broadcastRoom = (key) => {
    const state = { room: key, users: roomUsers(key).map((u) => ({ username: u.username, name: u.name, avatar: u.avatar, video: u.video })) };
    new Set([...roomAudience(key), ...(rooms.get(key)?.keys() ?? [])]).forEach((uid) => push(uid, 'voice', { type: 'state', ...state }));
  };
  const leaveRooms = (uid) => {
    for (const [key, members] of rooms) {
      if (!members.delete(uid)) continue;
      if (!members.size) rooms.delete(key);
      broadcastRoom(key);
    }
  };
  const roomFor = (me, b) => {
    if (b.channel) {
      const { ch } = channelAccess(me, b.channel);
      if (!ch.voice) throw new HttpError(400, 'That is not a voice channel.');
      return { key: `ch:${ch.id}`, title: ch.name };
    }
    needMember(me, b.group);
    return { key: `grp:${Number(b.group)}`, title: db.prepare('SELECT name FROM groups WHERE id = ?').get(Number(b.group)).name, group: Number(b.group) };
  };

  /* bots */
  const installed = (scope, id) => db.prepare('SELECT bot, config FROM bot_installs WHERE scope = ? AND scope_id = ?').all(scope, Number(id)).map((r) => ({ bot: r.bot, config: { ...BOT_CATALOG.find((b) => b.id === r.bot).defaults, ...JSON.parse(r.config) } }));
  const botConfig = (scope, id, bot) => installed(scope, id).find((b) => b.bot === bot)?.config;
  const cleanConfig = (bot, cfg = {}) => {
    const d = BOT_CATALOG.find((b) => b.id === bot).defaults;
    const out = { ...d };
    for (const k of Object.keys(d)) if (k in cfg) out[k] = cfg[k];
    if (bot === 'security') {
      for (const k of ['invites', 'links', 'caps', 'flood']) out[k] = !!out[k];
      out.words = [...new Set((Array.isArray(out.words) ? out.words : String(out.words).split(',')).map((w) => String(w).trim().toLowerCase()).filter(Boolean))].slice(0, 50).map((w) => w.slice(0, 40));
      out.strikes = Math.min(Math.max(Number(out.strikes) || 3, 1), 10);
      out.timeoutMinutes = Math.min(Math.max(Number(out.timeoutMinutes) || 5, 1), 1440);
    }
    if (bot === 'welcome') out.message = String(out.message ?? d.message).slice(0, 300) || d.message;
    return out;
  };
  const installBots = (scope, id, list = []) => {
    for (const b of [...new Set(list)].filter((x) => BOT_CATALOG.some((k) => k.id === x)))
      db.prepare('INSERT OR IGNORE INTO bot_installs (scope, scope_id, bot, config, created_at) VALUES (?, ?, ?, ?, ?)').run(scope, Number(id), b, JSON.stringify(cleanConfig(b, {})), now());
  };
  const channelRow = (id) => db.prepare('SELECT * FROM channels WHERE id = ?').get(Number(id));
  const say = (target, bot, text, kind = 'text') => {
    const u = botUsers[bot];
    const at = now();
    const base = { from: u.username, name: u.name, avatar: null, bot: true, body: text, kind, at };
    if (target.scope === 'channel') {
      const id = Number(db.prepare('INSERT INTO channel_messages (channel_id, sender_id, body, created_at, kind) VALUES (?, ?, ?, ?, ?)').run(target.id, u.id, text, at, kind).lastInsertRowid);
      c.pushChannel(channelRow(target.id), 'channel-message', { id, channel: target.id, ...base });
    } else {
      const id = Number(db.prepare('INSERT INTO group_messages (group_id, sender_id, body, created_at, kind) VALUES (?, ?, ?, ?, ?)').run(target.id, u.id, text, at, kind).lastInsertRowid);
      c.pushGroup(target.id, 'message', { id, group: target.id, ...base });
    }
  };
  const flood = new Map();
  const strikes = new Map();
  const screen = (scope, scopeId, me, text, exempt) => {
    const cfg = botConfig(scope, scopeId, 'security');
    if (!cfg || exempt) return;
    const key = `${scope}:${scopeId}:${me.id}`;
    const t = now();
    const recent = (flood.get(key) ?? []).filter((x) => t - x < 8000);
    recent.push(t); flood.set(key, recent);
    let why = null;
    if (cfg.flood && recent.length > 5) why = 'you are sending messages too fast';
    else if (cfg.invites && /(discord\.gg\/|discord(app)?\.com\/invite|t\.me\/|chat\.whatsapp\.com\/|wa\.me\/)/i.test(text)) why = 'invite links are not allowed here';
    else if (cfg.links && /(https?:\/\/|www\.)\S+/i.test(text)) why = 'links are not allowed here';
    else if (cfg.caps && (text.match(/\p{L}/gu) ?? []).length >= 12 && (text.match(/\p{Lu}/gu) ?? []).length / (text.match(/\p{L}/gu) ?? []).length > 0.7) why = 'please do not shout';
    else if (cfg.words.some((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}\\p{N}]|$)`, 'iu').test(text))) why = 'that message contains a banned word';
    if (!why) return;
    const hits = (strikes.get(key) ?? []).filter((x) => t - x < 600000);
    hits.push(t); strikes.set(key, hits);
    if (scope === 'community') {
      logMod(scopeId, { id: botUsers.security.id }, 'security-block', `@${me.username}`, why);
      if (hits.length >= cfg.strikes) {
        db.prepare('UPDATE community_members SET timeout_until = ? WHERE community_id = ? AND user_id = ?').run(t + cfg.timeoutMinutes * 60000, scopeId, me.id);
        logMod(scopeId, { id: botUsers.security.id }, 'security-timeout', `@${me.username}`, `${cfg.timeoutMinutes} min after ${hits.length} strikes`);
        strikes.delete(key);
        throw new HttpError(403, `Security: ${why}. You have been timed out for ${cfg.timeoutMinutes} minutes.`);
      }
    }
    throw new HttpError(400, `Security: ${why}.`);
  };
  const EIGHT = ['It is certain.', 'Without a doubt.', 'Yes, definitely.', 'Most likely.', 'Ask again later.', 'Cannot predict now.', 'Do not count on it.', 'My sources say no.', 'Very doubtful.', 'Signs point to yes.'];
  const onMessage = (scope, scopeId, target, me, text) => {
    if (!text.startsWith('!')) return;
    const [cmd, ...rest] = text.slice(1).trim().split(/\s+/);
    const arg = rest.join(' ');
    const on = Object.fromEntries(installed(scope, scopeId).map((b) => [b.bot, b]));
    const reply = (bot, msg, kind) => say(target, bot, msg, kind);
    const lc = cmd.toLowerCase();
    if (lc === 'help') {
      const lines = BOT_CATALOG.filter((b) => on[b.id] && b.commands.length).flatMap((b) => [`${b.name}: ${b.commands.join('  ·  ')}`]);
      if (Object.keys(on).length) return reply(on.fun ? 'fun' : Object.keys(on)[0], lines.length ? `Commands\n${lines.join('\n')}` : 'The bots here work in the background.');
    }
    if (on.fun) {
      if (lc === 'roll') { const n = Math.min(Math.max(parseInt(arg, 10) || 6, 2), 1000); return reply('fun', `${me.display_name} rolled a ${crypto.randomInt(1, n + 1)} (d${n}).`); }
      if (lc === 'flip') return reply('fun', `${me.display_name} flipped ${crypto.randomInt(2) ? 'heads' : 'tails'}.`);
      if (lc === '8ball') return arg ? reply('fun', `“${arg.slice(0, 120)}” — ${EIGHT[crypto.randomInt(EIGHT.length)]}`) : reply('fun', 'Ask a question after !8ball.');
      if (lc === 'choose') { const opts = arg.split('|').map((s) => s.trim()).filter(Boolean).slice(0, 12); return opts.length > 1 ? reply('fun', `I choose: ${opts[crypto.randomInt(opts.length)]}`) : reply('fun', 'Give me options: !choose pizza | tacos'); }
      if (lc === 'rps') {
        const mine = ['rock', 'paper', 'scissors'][crypto.randomInt(3)];
        const yours = arg.toLowerCase();
        if (!['rock', 'paper', 'scissors'].includes(yours)) return reply('fun', 'Pick rock, paper or scissors.');
        const beats = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
        return reply('fun', `You: ${yours} · Me: ${mine} — ${yours === mine ? 'draw' : beats[yours] === mine ? 'you win' : 'I win'}.`);
      }
    }
    if (on.music && (lc === 'tracks' || lc === 'play')) {
      const tracks = db.prepare('SELECT id, title FROM bot_tracks WHERE scope = ? AND scope_id = ? ORDER BY created_at').all(scope, scopeId);
      if (lc === 'tracks') return reply('music', tracks.length ? `Tracks\n${tracks.map((t, i) => `${i + 1}. ${t.title}`).join('\n')}\nPlay one with !play <number>` : 'No tracks yet. An admin can upload some in the Music bot settings.');
      const pick = /^\d+$/.test(arg) ? tracks[Number(arg) - 1] : tracks.find((t) => t.title.toLowerCase().includes(arg.toLowerCase()));
      return pick && arg ? reply('music', JSON.stringify({ track: pick.id, title: pick.title }), 'music') : reply('music', 'I could not find that track. Try !tracks.');
    }
  };
  const firstChannel = (cid) => db.prepare("SELECT id FROM channels WHERE community_id = ? AND private = 0 AND read_only = 0 AND voice = 0 AND kind = 'text' ORDER BY position, id LIMIT 1").get(cid);
  const onJoin = (scope, scopeId, uid) => {
    const cfg = botConfig(scope, scopeId, 'welcome');
    if (!cfg) return;
    const u = db.prepare('SELECT display_name FROM users WHERE id = ?').get(uid);
    const text = cfg.message.replaceAll('{user}', u.display_name);
    if (scope === 'community') { const ch = firstChannel(scopeId); if (ch) say({ scope: 'channel', id: ch.id }, 'welcome', text); } else say({ scope: 'group', id: scopeId }, 'welcome', text);
  };
  const needBotAdmin = (me, scope, id) => {
    if (scope === 'community') { needRole(needCMember(me, id), 'admin'); return; }
    if (scope === 'group') { if (c.roleIn(Number(id), me.id) !== 'admin') throw new HttpError(403, 'Only group admins can do that.'); return; }
    throw new HttpError(400, 'Unknown scope.');
  };
  const needBotMember = (me, scope, id) => { if (scope === 'community') needCMember(me, id); else if (scope === 'group') needMember(me, id); else throw new HttpError(400, 'Unknown scope.'); };

  /* file rules */
  const INLINE_OK = /^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm)|audio\/.+)$/;
  const cleanName = (n) => String(n ?? '').replace(/[\u0000-\u001f\u007f/\\]/g, '').trim().slice(0, 120);
  const audioMime = (b) => sniff.audio(b) ?? (b.length > 12 && b.subarray(4, 8).toString('latin1') === 'ftyp' ? 'audio/mp4' : b.subarray(0, 4).toString('latin1') === 'fLaC' ? 'audio/flac' : null);
  const fileInfo = (id) => (id ? db.prepare('SELECT id, label AS name, mime, size FROM uploads WHERE id = ?').get(id) ?? null : null);
  const withFiles = (rows) => rows.map((r) => (r.attachment ? { ...r, file: fileInfo(r.attachment) } : r));
  const soundVisible = (me, id) => !!(db.prepare(`SELECT 1 FROM posts p WHERE p.sound_id = ? ${hiddenFrom(me.id)}`).get(id)
    || db.prepare(`SELECT 1 FROM stories p WHERE p.sound_id = ? AND p.expires_at > ? ${hiddenFrom(me.id)}`).get(id, now())
    || db.prepare(`SELECT 1 FROM profiles p WHERE p.song_id = ? ${hiddenFrom(me.id)}`).get(id));
  const canViewExtra = (me, id, file) => {
    if (file.kind === 'sound') return soundVisible(me, id);
    if (file.kind === 'bot-music') return !!db.prepare(`SELECT 1 FROM bot_tracks t WHERE t.id = ? AND ((t.scope = 'community' AND EXISTS (SELECT 1 FROM community_members WHERE community_id = t.scope_id AND user_id = ?))
      OR (t.scope = 'group' AND EXISTS (SELECT 1 FROM group_members WHERE group_id = t.scope_id AND user_id = ?)))`).get(id, me.id, me.id);
    return undefined;
  };
  const rawUpload = async (req, res, me, url, kind) => {
    const name = cleanName(url.searchParams.get('name'));
    const max = kind === 'attachment' ? maxAttachBytes : 10 * 1024 * 1024;
    const body = await readBytes(req, max);
    if (!body.length) throw new HttpError(400, 'That file is empty.');
    let mime;
    let scope; let scopeId;
    if (kind === 'attachment') {
      const img = sniff.image(body);
      mime = img?.mime ?? sniff.video(body) ?? audioMime(body) ?? 'application/octet-stream';
      if (img && !(img.w >= 1 && img.h >= 1 && img.w <= 8192 && img.h <= 8192)) throw new HttpError(400, 'Images can be at most 8192 pixels on each side.');
    } else {
      mime = audioMime(body);
      if (!mime) throw new HttpError(400, 'Upload an audio file (MP3, WAV, OGG, FLAC or M4A).');
      if (kind === 'sound' && countOf("SELECT COUNT(*) AS n FROM uploads WHERE user_id = ? AND kind = 'sound'", me.id) >= 30) throw new HttpError(409, 'Your music library is full (30 tracks).');
      if (kind === 'bot-music') {
        scope = url.searchParams.get('scope'); scopeId = Number(url.searchParams.get('id'));
        needBotAdmin(me, scope, scopeId);
        if (!botConfig(scope, scopeId, 'music')) throw new HttpError(400, 'Add the Music bot first.');
        if (countOf('SELECT COUNT(*) AS n FROM bot_tracks WHERE scope = ? AND scope_id = ?', scope, scopeId) >= 50) throw new HttpError(409, 'The Music bot holds up to 50 tracks.');
      }
    }
    const id = crypto.randomBytes(16).toString('hex');
    storeFile(id, body);
    db.prepare('INSERT INTO uploads (id, user_id, kind, mime, size, created_at, label) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, me.id, kind, mime, body.length, now(), name || null);
    if (kind === 'bot-music') db.prepare('INSERT INTO bot_tracks (id, scope, scope_id, title, size, uploader, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, scope, scopeId, (name || 'Untitled').replace(/\.[^.]+$/, '').slice(0, 60), body.length, me.id, now());
    return sendJson(res, 201, { id, name, mime, size: body.length, inline: INLINE_OK.test(mime) });
  };

  /* generic "send into a chat" used by post sharing */
  const sendInto = (me, b, text, kind) => {
    const at = now();
    if (b.to) {
      const peer = findPeer(me, b.to);
      if (peer.is_system || peer.is_bot) throw new HttpError(403, 'You cannot send to this account.');
      if (isBlocked(me.id, peer.id) || !c.canMessage(me.id, peer.id)) throw new HttpError(403, "This person isn't accepting messages from you.");
      const id = Number(db.prepare('INSERT INTO messages (sender_id, recipient_id, body, created_at, kind) VALUES (?, ?, ?, ?, ?)').run(me.id, peer.id, text, at, kind).lastInsertRowid);
      push(peer.id, 'message', { id, from: me.username, body: text, at, kind });
      push(me.id, 'message', { id, from: me.username, to: peer.username, body: text, at, kind });
      return id;
    }
    if (b.group) {
      needMember(me, b.group);
      const id = Number(db.prepare('INSERT INTO group_messages (group_id, sender_id, body, created_at, kind) VALUES (?, ?, ?, ?, ?)').run(Number(b.group), me.id, text, at, kind).lastInsertRowid);
      c.pushGroup(Number(b.group), 'message', { id, group: Number(b.group), from: me.username, name: me.display_name, avatar: avatarOf(me.id), body: text, at, kind });
      return id;
    }
    if (b.channel) {
      const { ch, m } = channelAccess(me, b.channel);
      if (!canPost(ch, m) || ch.voice) throw new HttpError(403, 'You cannot post in this channel.');
      if (m.timeoutUntil > at) throw new HttpError(403, 'You are timed out.');
      const id = Number(db.prepare('INSERT INTO channel_messages (channel_id, sender_id, body, created_at, kind) VALUES (?, ?, ?, ?, ?)').run(ch.id, me.id, text, at, kind).lastInsertRowid);
      c.pushChannel(ch, 'channel-message', { id, channel: ch.id, from: me.username, name: me.display_name, avatar: avatarOf(me.id), body: text, at, kind });
      return id;
    }
    throw new HttpError(400, 'Choose where to send it.');
  };
  const msgAccess = (me, scope, id) => {
    if (scope === 'dm') {
      const m = db.prepare('SELECT sender_id, recipient_id FROM messages WHERE id = ?').get(Number(id));
      if (!m || (m.sender_id !== me.id && m.recipient_id !== me.id)) throw new HttpError(404, 'No such message');
      return [m.sender_id, m.recipient_id];
    }
    if (scope === 'group') {
      const m = db.prepare('SELECT group_id FROM group_messages WHERE id = ?').get(Number(id));
      if (!m) throw new HttpError(404, 'No such message');
      needMember(me, m.group_id);
      return db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(m.group_id).map((r) => r.user_id);
    }
    if (scope === 'channel') {
      const m = db.prepare('SELECT channel_id FROM channel_messages WHERE id = ?').get(Number(id));
      if (!m) throw new HttpError(404, 'No such message');
      const { ch } = channelAccess(me, m.channel_id);
      return db.prepare('SELECT user_id FROM community_members WHERE community_id = ?').all(ch.community_id).map((r) => r.user_id);
    }
    throw new HttpError(400, 'Unknown scope.');
  };
  const reactionSummary = (scope, ids) => {
    const out = {};
    if (!ids.length) return out;
    for (const r of db.prepare(`SELECT msg_id, emoji, COUNT(*) AS n, GROUP_CONCAT(user_id) AS users FROM reactions WHERE scope = ? AND msg_id IN (${ids.map(() => '?').join(',')}) GROUP BY msg_id, emoji`).all(scope, ...ids))
      (out[r.msg_id] ??= []).push({ emoji: r.emoji, n: r.n, users: r.users.split(',').map(Number) });
    return out;
  };

  /* ---------- routes ---------- */
  const routes = {
    /* roles */
    'POST /api/owner/role': async (req, res, me) => {
      needSite(me, 'staff');
      const { username, role } = await readJson(req);
      if (!['user', 'staff', 'admin'].includes(role)) throw new HttpError(400, 'Role must be user, staff or admin.');
      const user = userNamed(username);
      const row = db.prepare('SELECT id, is_owner, is_system, is_bot, role FROM users WHERE id = ?').get(user.id);
      if (row.is_owner || row.is_system || row.is_bot || row.id === me.id) throw new HttpError(403, 'That account’s role cannot be changed.');
      if (!permsFor(me).includes('admins') && (role === 'admin' || row.role === 'admin')) throw new HttpError(403, 'Only the owner can add or remove admins.');
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
      syncRoleBadges(user.id);
      audit(me, 'role', user.username, role);
      addNote(user.id, 'role', null, role, role === 'user' ? 'Your staff role was removed.' : `You are now ${role === 'admin' ? 'an admin' : 'a staff member'} of Scrxaper.`);
      sendJson(res, 200, { username: user.username, role });
    },
    'GET /api/owner/team': (req, res, me) => {
      needSite(me, 'staff');
      sendJson(res, 200, db.prepare("SELECT username, display_name AS name, CASE WHEN is_owner = 1 THEN 'owner' ELSE role END AS role FROM users WHERE is_owner = 1 OR role IN ('admin', 'staff') ORDER BY is_owner DESC, role, username").all());
    },
    'POST /api/admin/post-delete': async (req, res, me) => {
      needSite(me, 'content');
      const { post, reason } = await readJson(req);
      const row = db.prepare('SELECT id, user_id, media_id FROM posts WHERE id = ?').get(Number(post));
      if (!row) throw new HttpError(404, 'No such post');
      db.prepare('DELETE FROM posts WHERE id = ?').run(row.id);
      removeFile(row.media_id);
      audit(me, 'delete-post', `post ${row.id}`, String(reason ?? '').slice(0, 200));
      addNote(row.user_id, 'role', null, 'post', 'One of your posts was removed by Scrxaper staff.');
      sendJson(res, 200, { ok: true });
    },

    /* friends */
    'GET /api/friends': (req, res, me) => sendJson(res, 200, listFriends(me)),
    'POST /api/friends/request': async (req, res, me) => {
      needHuman(me);
      const peer = findPeer(me, (await readJson(req)).username);
      if (peer.is_system || peer.is_bot) throw new HttpError(403, 'You cannot add this account.');
      if (isBlocked(me.id, peer.id)) throw new HttpError(403, 'You cannot send this person a request.');
      if (limited(`freq:${me.id}`, 30, 3600e3)) throw new HttpError(429, 'Too many requests. Try again later.');
      const state = friendState(me.id, peer.id);
      if (state === 'friends') throw new HttpError(409, 'You are already friends.');
      if (state === 'outgoing') throw new HttpError(409, 'Request already sent.');
      if (state === 'incoming') {
        db.prepare('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?').run(peer.id, me.id);
        makeFriends(me.id, peer.id);
        addNote(peer.id, 'friend_accept', me, me.username);
        push(me.id, 'friends', {}); push(peer.id, 'friends', {});
        return sendJson(res, 200, { state: 'friends' });
      }
      if (countOf('SELECT COUNT(*) AS n FROM friends WHERE a_id = ?', me.id) >= 1000) throw new HttpError(409, 'Your friend list is full.');
      db.prepare('INSERT INTO friend_requests (from_id, to_id, created_at) VALUES (?, ?, ?)').run(me.id, peer.id, now());
      addNote(peer.id, 'friend_request', me, me.username);
      push(peer.id, 'friends', {});
      sendJson(res, 201, { state: 'outgoing' });
    },
    'POST /api/friends/respond': async (req, res, me) => {
      const { username, accept } = await readJson(req);
      const peer = findPeer(me, username);
      if (!db.prepare('SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?').get(peer.id, me.id)) throw new HttpError(404, 'No such request');
      db.prepare('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?').run(peer.id, me.id);
      if (accept) { makeFriends(me.id, peer.id); addNote(peer.id, 'friend_accept', me, me.username); }
      push(me.id, 'friends', {}); push(peer.id, 'friends', {});
      sendJson(res, 200, { state: accept ? 'friends' : 'none' });
    },
    'POST /api/friends/cancel': async (req, res, me) => {
      const peer = findPeer(me, (await readJson(req)).username);
      db.prepare('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?').run(me.id, peer.id);
      push(peer.id, 'friends', {});
      sendJson(res, 200, { state: 'none' });
    },
    'POST /api/friends/remove': async (req, res, me) => {
      const peer = findPeer(me, (await readJson(req)).username);
      db.prepare('DELETE FROM friends WHERE (a_id = ? AND b_id = ?) OR (a_id = ? AND b_id = ?)').run(me.id, peer.id, peer.id, me.id);
      push(peer.id, 'friends', {}); push(me.id, 'friends', {});
      sendJson(res, 200, { state: 'none' });
    },

    /* notifications */
    'GET /api/notifications': (req, res, me, url) => {
      const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
      const rows = db.prepare('SELECT id, kind, actor_id, ref, text, created_at AS at, read_at AS readAt FROM notifications WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT 40').all(me.id, before);
      sendJson(res, 200, { unread: countOf('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', me.id),
        items: rows.map((r) => ({ id: r.id, kind: r.kind, ref: r.ref, text: r.text || NOTE[r.kind], at: r.at, read: !!r.readAt, actor: r.actor_id ? cardOf(r.actor_id) : null })) });
    },
    'POST /api/notifications/read': async (req, res, me) => {
      const { id } = await readJson(req);
      if (id) db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?').run(now(), Number(id), me.id);
      else db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now(), me.id);
      sendJson(res, 200, { unread: countOf('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', me.id) });
    },

    /* private accounts: follow requests */
    'GET /api/follow-requests': (req, res, me) => sendJson(res, 200, db.prepare(`SELECT u.username, u.display_name AS name, (SELECT avatar_id FROM profiles WHERE user_id = u.id) AS avatar, r.created_at AS at
      FROM follow_requests r JOIN users u ON u.id = r.requester_id WHERE r.target_id = ? ORDER BY r.created_at DESC`).all(me.id)),
    'POST /api/follow-requests/respond': async (req, res, me) => {
      const { username, accept } = await readJson(req);
      const user = userNamed(username);
      if (!db.prepare('SELECT 1 FROM follow_requests WHERE requester_id = ? AND target_id = ?').get(user.id, me.id)) throw new HttpError(404, 'No such request');
      db.prepare('DELETE FROM follow_requests WHERE requester_id = ? AND target_id = ?').run(user.id, me.id);
      if (accept) { db.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)').run(user.id, me.id, now()); addNote(user.id, 'follow_accept', me, me.username); }
      sendJson(res, 200, { accepted: !!accept });
    },

    /* hashtags and explore */
    'GET /api/hashtag': (req, res, me, url) => {
      const tag = String(url.searchParams.get('tag') ?? '').replace(/^#/, '').toLowerCase();
      if (!/^[\p{L}\p{N}_]{2,30}$/u.test(tag)) throw new HttpError(400, 'That is not a valid hashtag.');
      const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
      sendJson(res, 200, { tag, posts: db.prepare(`${postSelect(me.id)} WHERE p.id IN (SELECT post_id FROM post_tags WHERE tag = ?) AND p.id < ? ${hiddenFrom(me.id)} ORDER BY p.id DESC LIMIT 30`).all(tag, before).map(shapePost) });
    },
    'GET /api/explore': (req, res, me) => {
      const since = now() - 14 * 864e5;
      const mine = new Set(JSON.parse(db.prepare('SELECT interests FROM profiles WHERE user_id = ?').get(me.id)?.interests ?? '[]'));
      const tags = db.prepare(`SELECT t.tag, COUNT(*) AS n FROM post_tags t JOIN posts p ON p.id = t.post_id WHERE p.created_at > ? ${hiddenFrom(me.id)} GROUP BY t.tag ORDER BY n DESC, t.tag LIMIT 20`).all(since)
        .sort((a, b) => (mine.has(b.tag) - mine.has(a.tag)) || b.n - a.n);
      const posts = db.prepare(`${postSelect(me.id)} WHERE p.created_at > ? ${hiddenFrom(me.id)} ORDER BY ((SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) + 2 * (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id)) DESC, p.id DESC LIMIT 24`).all(since).map(shapePost);
      const people = db.prepare(`SELECT u.id, u.username, u.display_name AS name, (SELECT avatar_id FROM profiles WHERE user_id = u.id) AS avatar, (SELECT interests FROM profiles WHERE user_id = u.id) AS interests,
        (SELECT COUNT(*) FROM follows WHERE followee_id = u.id) AS followers FROM users u
        WHERE u.is_system = 0 AND u.is_bot = 0 AND u.banned_at IS NULL AND u.id != ? AND u.id NOT IN (SELECT followee_id FROM follows WHERE follower_id = ?)
          AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?)) ORDER BY followers DESC, u.id DESC LIMIT 40`).all(me.id, me.id, me.id, me.id)
        .map((u) => ({ ...u, shared: JSON.parse(u.interests ?? '[]').filter((i) => mine.has(i)).length })).sort((a, b) => b.shared - a.shared || b.followers - a.followers).slice(0, 12)
        .map(({ id, interests, ...rest }) => rest);
      sendJson(res, 200, { tags, posts, people });
    },

    /* share a post into a chat */
    'POST /api/posts/share': async (req, res, me) => {
      needHuman(me);
      const b = await readJson(req);
      const post = visiblePost(me, b.post);
      if (limited(`share:${me.id}`, 30, 60000)) throw new HttpError(429, 'Slow down a little.');
      const id = sendInto(me, b, String(post.id), 'post');
      if (b.to) addNote(findPeer(me, b.to).id, 'share', me, String(post.id));
      sendJson(res, 201, { id });
    },

    /* reactions, typing */
    'POST /api/reactions': async (req, res, me) => {
      const { scope, id, emoji } = await readJson(req);
      if (!REACTIONS.includes(emoji)) throw new HttpError(400, 'Unknown reaction.');
      const audience = msgAccess(me, scope, id);
      const had = db.prepare('SELECT 1 FROM reactions WHERE scope = ? AND msg_id = ? AND user_id = ? AND emoji = ?').get(scope, Number(id), me.id, emoji);
      if (had) db.prepare('DELETE FROM reactions WHERE scope = ? AND msg_id = ? AND user_id = ? AND emoji = ?').run(scope, Number(id), me.id, emoji);
      else {
        if (countOf('SELECT COUNT(*) AS n FROM reactions WHERE scope = ? AND msg_id = ? AND user_id = ?', scope, Number(id), me.id) >= 3) throw new HttpError(409, 'You can add up to 3 reactions per message.');
        db.prepare('INSERT INTO reactions (scope, msg_id, user_id, emoji) VALUES (?, ?, ?, ?)').run(scope, Number(id), me.id, emoji);
      }
      const summary = reactionSummary(scope, [Number(id)])[Number(id)] ?? [];
      for (const uid of new Set(audience)) push(uid, 'reaction', { scope, id: Number(id), reactions: summary });
      sendJson(res, 200, { reactions: summary });
    },
    'GET /api/reactions': (req, res, me, url) => {
      const scope = url.searchParams.get('scope');
      const ids = String(url.searchParams.get('ids') ?? '').split(',').map(Number).filter(Number.isInteger).slice(0, 100);
      if (ids.length) msgAccess(me, scope, ids[0]);
      sendJson(res, 200, reactionSummary(scope, ids));
    },
    'POST /api/typing': async (req, res, me) => {
      const { to, group, channel } = await readJson(req);
      if (limited(`typing:${me.id}`, 40, 10000)) return sendJson(res, 200, { ok: true });
      const ev = { from: me.username, name: me.display_name };
      if (to) { const peer = findPeer(me, to); if (!isBlocked(me.id, peer.id)) push(peer.id, 'typing', { ...ev, scope: 'dm' }); }
      else if (group) { needMember(me, group); for (const { user_id } of db.prepare('SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ?').all(Number(group), me.id)) push(user_id, 'typing', { ...ev, scope: 'group', id: Number(group) }); }
      else if (channel) { const { ch } = channelAccess(me, channel); for (const { user_id } of db.prepare('SELECT user_id FROM community_members WHERE community_id = ? AND user_id != ?').all(ch.community_id, me.id)) push(user_id, 'typing', { ...ev, scope: 'channel', id: ch.id }); }
      sendJson(res, 200, { ok: true });
    },

    /* voice rooms and group calls */
    'POST /api/voice/join': async (req, res, me) => {
      needHuman(me);
      const b = await readJson(req);
      const { key, title, group } = roomFor(me, b);
      leaveRooms(me.id);
      const room = rooms.get(key) ?? new Map();
      if (room.size >= MAX_VOICE && !room.has(me.id)) throw new HttpError(409, `This room is full (${MAX_VOICE} people).`);
      const wasEmpty = room.size === 0;
      room.set(me.id, { id: me.id, username: me.username, name: me.display_name, avatar: avatarOf(me.id), video: !!b.video });
      rooms.set(key, room);
      broadcastRoom(key);
      if (group && wasEmpty) {
        for (const { user_id } of db.prepare('SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ?').all(group, me.id)) {
          push(user_id, 'voice-invite', { room: key, group, title, from: me.username, name: me.display_name, avatar: avatarOf(me.id), video: !!b.video });
          pushOffline(user_id, { title: `${me.display_name} started a group call`, body: title, tag: `gcall:${key}`, kind: 'call', requireInteraction: true, url: '/' }, { ttl: 45, urgency: 'high' });
        }
      }
      sendJson(res, 200, { room: key, title, peers: roomUsers(key).filter((u) => u.id !== me.id).map(({ id, ...u }) => u) });
    },
    'POST /api/voice/leave': async (req, res, me) => { leaveRooms(me.id); sendJson(res, 200, { ok: true }); },
    'POST /api/voice/signal': async (req, res, me) => {
      const { room, to, data } = await readJson(req);
      const members = rooms.get(String(room));
      const target = [...(members?.values() ?? [])].find((u) => u.username === to);
      if (!members?.has(me.id) || !target) throw new HttpError(404, 'Not in that room.');
      if (JSON.stringify(data ?? null).length > 20000) throw new HttpError(413, 'Signal too large.');
      if (limited(`vsig:${me.id}`, 1200, 60000)) throw new HttpError(429, 'Slow down.');
      push(target.id, 'voice', { type: 'signal', room, from: me.username, data });
      sendJson(res, 200, { ok: true });
    },
    'GET /api/voice/state': (req, res, me, url) => {
      const cid = Number(url.searchParams.get('community'));
      needCMember(me, cid);
      const out = {};
      for (const { id } of db.prepare('SELECT id FROM channels WHERE community_id = ? AND voice = 1').all(cid)) out[id] = roomUsers(`ch:${id}`).map((u) => ({ username: u.username, name: u.name, avatar: u.avatar }));
      sendJson(res, 200, out);
    },
    'POST /api/channels/reorder': async (req, res, me) => {
      const { community, order } = await readJson(req);
      const m = needCMember(me, community);
      c.needPerm(m, 'channels');
      const ids = (Array.isArray(order) ? order : []).map(Number);
      ids.forEach((id, i) => db.prepare('UPDATE channels SET position = ? WHERE id = ? AND community_id = ?').run(i, id, Number(community)));
      c.pushCommunity(Number(community));
      sendJson(res, 200, { ok: true });
    },

    /* premade bots */
    'GET /api/bots/catalog': (req, res) => sendJson(res, 200, BOT_CATALOG.map(({ id, name, summary, commands, defaults }) => ({ id, name, summary, commands, defaults }))),
    'GET /api/bots/installed': (req, res, me, url) => {
      const scope = url.searchParams.get('scope'); const id = Number(url.searchParams.get('id'));
      needBotMember(me, scope, id);
      sendJson(res, 200, { bots: installed(scope, id), tracks: db.prepare('SELECT id, title, size FROM bot_tracks WHERE scope = ? AND scope_id = ? ORDER BY created_at').all(scope, id) });
    },
    'POST /api/bots/install': async (req, res, me) => {
      const { scope, id, bot, config } = await readJson(req);
      needBotAdmin(me, scope, id);
      if (!BOT_CATALOG.some((b) => b.id === bot)) throw new HttpError(404, 'No such bot');
      db.prepare('INSERT INTO bot_installs (scope, scope_id, bot, config, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (scope, scope_id, bot) DO UPDATE SET config = excluded.config')
        .run(scope, Number(id), bot, JSON.stringify(cleanConfig(bot, config)), now());
      if (scope === 'community') { logMod(Number(id), me, 'bot-config', bot); c.pushCommunity(Number(id)); }
      sendJson(res, 200, { bots: installed(scope, id) });
    },
    'POST /api/bots/remove': async (req, res, me) => {
      const { scope, id, bot } = await readJson(req);
      needBotAdmin(me, scope, id);
      db.prepare('DELETE FROM bot_installs WHERE scope = ? AND scope_id = ? AND bot = ?').run(scope, Number(id), bot);
      if (bot === 'music') for (const t of db.prepare('SELECT id FROM bot_tracks WHERE scope = ? AND scope_id = ?').all(scope, Number(id))) { db.prepare('DELETE FROM bot_tracks WHERE id = ?').run(t.id); removeFile(t.id); }
      if (scope === 'community') logMod(Number(id), me, 'bot-remove', bot);
      sendJson(res, 200, { bots: installed(scope, id) });
    },
    'POST /api/bots/track-delete': async (req, res, me) => {
      const { id } = await readJson(req);
      const t = db.prepare('SELECT id, scope, scope_id FROM bot_tracks WHERE id = ?').get(String(id ?? ''));
      if (!t) throw new HttpError(404, 'No such track');
      needBotAdmin(me, t.scope, t.scope_id);
      db.prepare('DELETE FROM bot_tracks WHERE id = ?').run(t.id);
      removeFile(t.id);
      sendJson(res, 200, { ok: true });
    },

    /* web push */
    'GET /api/push/key': (req, res) => sendJson(res, 200, { key: vapid.pub }),
    'POST /api/push/subscribe': async (req, res, me) => {
      needHuman(me);
      const { subscription: s } = await readJson(req);
      let host;
      try { host = new URL(s?.endpoint); } catch { throw new HttpError(400, 'Invalid subscription.'); }
      if (!s.keys?.p256dh || !s.keys?.auth || (!pushAnyHost && (host.protocol !== 'https:' || !PUSH_HOSTS.test(host.hostname)))) throw new HttpError(400, 'That push service is not supported.');
      if (countOf('SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?', me.id) >= 10) db.prepare('DELETE FROM push_subs WHERE endpoint = (SELECT endpoint FROM push_subs WHERE user_id = ? ORDER BY created_at LIMIT 1)').run(me.id);
      db.prepare('INSERT OR REPLACE INTO push_subs (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)').run(s.endpoint, me.id, String(s.keys.p256dh), String(s.keys.auth), now());
      sendJson(res, 201, { ok: true });
    },
    'POST /api/push/unsubscribe': async (req, res, me) => {
      db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').run(String((await readJson(req)).endpoint ?? ''), me.id);
      sendJson(res, 200, { ok: true });
    },

    /* profile extras */
    'POST /api/avatar/preset': async (req, res, me) => {
      needHuman(me);
      const { id } = await readJson(req);
      if (!PRESET_AVATARS.includes(id)) throw new HttpError(400, 'Unknown avatar.');
      prefsOf(me.id);
      const prev = db.prepare('SELECT avatar_id AS id FROM profiles WHERE user_id = ?').get(me.id).id;
      db.prepare('UPDATE profiles SET avatar_id = ? WHERE user_id = ?').run(`preset:${id}`, me.id);
      if (prev && !prev.startsWith('preset:')) removeFile(prev);
      sendJson(res, 200, { avatar: `preset:${id}` });
    },
    'POST /api/profile/song': async (req, res, me) => {
      const { id } = await readJson(req);
      if (id && !db.prepare("SELECT 1 FROM uploads WHERE id = ? AND user_id = ? AND kind = 'sound'").get(String(id), me.id)) throw new HttpError(404, 'No such track');
      prefsOf(me.id);
      db.prepare('UPDATE profiles SET song_id = ? WHERE user_id = ?').run(id || null, me.id);
      sendJson(res, 200, { song: id || null });
    },
    'POST /api/profile/extra': async (req, res, me) => {
      const { pronouns, links, interests } = await readJson(req);
      prefsOf(me.id);
      const cleanLinks = (Array.isArray(links) ? links : []).slice(0, 4).map((l) => ({ label: String(l?.label ?? '').trim().slice(0, 24), url: String(l?.url ?? '').trim().slice(0, 200) }))
        .filter((l) => /^https?:\/\//i.test(l.url));
      const cleanInterests = [...new Set((Array.isArray(interests) ? interests : []).map((i) => String(i).toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, '').trim().slice(0, 24)).filter(Boolean))].slice(0, 12);
      db.prepare('UPDATE profiles SET pronouns = ?, links = ?, interests = ? WHERE user_id = ?').run(String(pronouns ?? '').trim().slice(0, 24), JSON.stringify(cleanLinks), JSON.stringify(cleanInterests), me.id);
      sendJson(res, 200, { ok: true });
    },
    'POST /api/ui': async (req, res, me) => {
      const { ui } = await readJson(req);
      const pick = (v, list, d) => (list.includes(v) ? v : d);
      const hex = (v) => (/^#[0-9a-f]{6}$/i.test(String(v ?? '')) ? String(v) : null);
      const clean = { bubble: pick(ui?.bubble, ['round', 'soft', 'square', 'minimal'], 'round'), font: pick(ui?.font, ['sm', 'md', 'lg'], 'md'),
        wallpaper: pick(ui?.wallpaper, ['none', 'aurora', 'dusk', 'grid', 'mist'], 'none'), accent2: hex(ui?.accent2), grouping: ui?.grouping !== false,
        clock: pick(ui?.clock, ['auto', '12', '24'], 'auto'), effects: ui?.effects !== false, sidebar: pick(ui?.sidebar, ['wide', 'narrow'], 'wide'), radius: pick(ui?.radius, ['sharp', 'normal', 'pill'], 'normal') };
      prefsOf(me.id);
      db.prepare('UPDATE profiles SET ui = ? WHERE user_id = ?').run(JSON.stringify(clean), me.id);
      sendJson(res, 200, { ui: clean });
    },
    'POST /api/spectrum': async (req, res, me) => {
      const { style, color } = await readJson(req);
      if (!['bars', 'radial', 'cd', 'wave', 'pulse', 'orbit'].includes(style) || !/^#[0-9a-f]{6}$/i.test(String(color))) throw new HttpError(400, 'Unknown style or colour.');
      prefsOf(me.id);
      db.prepare('UPDATE profiles SET spectrum_style = ?, spectrum_color = ? WHERE user_id = ?').run(style, color, me.id);
      sendJson(res, 200, { style, color });
    },
    'POST /api/onboarding': async (req, res, me) => {
      needHuman(me);
      const b = await readJson(req);
      prefsOf(me.id);
      const name = String(b.displayName ?? '').trim().slice(0, 40);
      if (name) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, me.id);
      const interests = [...new Set((Array.isArray(b.interests) ? b.interests : []).map((i) => String(i).toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, '').trim().slice(0, 24)).filter(Boolean))].slice(0, 12);
      const who = ['everyone', 'groups', 'friends', 'nobody'].includes(b.whoCanMessage) ? b.whoCanMessage : 'everyone';
      const theme = ['dark', 'light', 'system'].includes(b.theme) ? b.theme : 'dark';
      const accent = /^#[0-9a-f]{6}$/i.test(String(b.accent)) ? b.accent : null;
      db.prepare('UPDATE profiles SET bio = ?, pronouns = ?, interests = ?, who_can_message = ?, private = ?, theme = ?, accent = ?, onboarded = 1 WHERE user_id = ?')
        .run(String(b.bio ?? '').trim().slice(0, 200), String(b.pronouns ?? '').trim().slice(0, 24), JSON.stringify(interests), who, b.privateAccount ? 1 : 0, theme, accent, me.id);
      if (PRESET_AVATARS.includes(b.avatarPreset) && !db.prepare('SELECT avatar_id FROM profiles WHERE user_id = ?').get(me.id).avatar_id) db.prepare('UPDATE profiles SET avatar_id = ? WHERE user_id = ?').run(`preset:${b.avatarPreset}`, me.id);
      if (b.birthday?.month) {
        const d = new Date(Date.UTC(2000, Number(b.birthday.month) - 1, Number(b.birthday.day)));
        if (d.getUTCMonth() === Number(b.birthday.month) - 1 && d.getUTCDate() === Number(b.birthday.day))
          db.prepare('UPDATE users SET birthday = ? WHERE id = ?').run(`${String(b.birthday.month).padStart(2, '0')}-${String(b.birthday.day).padStart(2, '0')}`, me.id);
      }
      sendJson(res, 200, { ok: true });
    },
    'GET /api/call/pending': (req, res, me) => {
      const r = db.prepare(`SELECT c.id, c.video, u.username, u.display_name AS name FROM calls c JOIN users u ON u.id = c.caller_id
        WHERE c.callee_id = ? AND c.state = 'ringing' AND c.created_at > ? ORDER BY c.id DESC LIMIT 1`).get(me.id, now() - 45000);
      sendJson(res, 200, r ? { id: r.id, from: r.username, name: r.name, avatar: avatarOf(db.prepare('SELECT id FROM users WHERE username = ?').get(r.username).id), video: !!r.video } : {});
    },
  };

  return { routes, roleOf, permsFor, needSite, syncRoleBadges, addNote, saveTags, areFriends, friendState, presence, leaveRooms, online, canViewExtra, rawUpload, withFiles, fileInfo,
    installBots, listBots: (scope, id) => installed(scope, id).map((b) => b.bot), screen, onMessage, onJoin, pushOffline, pushTo, vapid, INLINE_OK, listFriends, reactionSummary };
}
