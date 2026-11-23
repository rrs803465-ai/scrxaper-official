# Scrxaper

Connect freely. Belong anywhere.

Messaging, friends, communities with ready-made bots, voice channels and group calls, reels and stories, a Studio for customising everything, and an installable app with background call alerts. Node 22 built-ins only: no dependencies to install.

## What is in this build

| Area | State |
|---|---|
| Accounts, sessions, DMs, groups, blocking, Teams official account, birthdays, owner dashboard, Sparks, shop, AI buddy (Groq, your own key), search, mutes, do-not-disturb | Implemented, API-tested (unchanged core) |
| **Friends** (Discord style): send/accept/decline/cancel, remove, online presence, “people you may know” from mutual friends, friends-only DMs | Implemented, API- and browser-tested |
| **Notifications** for likes, comments, follows, follow requests, friend requests, shares and role changes, with unread badges and live toasts | Implemented, API- and browser-tested |
| **Private accounts**: follow requests, approve/deny, posts/reels/stories/files hidden until approved, turning it off approves everyone waiting | Implemented, API- and browser-tested |
| **Hashtags and Explore**: trending tags, popular posts, people to follow ranked by shared interests | Implemented, API- and browser-tested |
| **Share a post into a chat** (DM, group or channel) as a live post card | Implemented, API- and browser-tested |
| **Video editing** in the browser: trim, speed, filters, mirror, 9:16 fill, mute; re-encoded to WebM | Implemented, browser-tested in Chromium. Needs Chrome/Edge/Firefox; Safari falls back to uploading the original (up to 60 s) |
| **Music on posts, reels and stories** from your own library (up to 10 MB per track, any length), with a start offset; story text captions | Implemented, API- and browser-tested |
| **Ringtones**: full songs up to 10 MB, any duration. **Calling tune** for the caller (a separate setting; the caller never hears your ringtone) | Implemented, API- and browser-tested |
| **Incoming-call screen** with the caller's picture and a beat-reactive spectrum: Equalizer, Halo, Spinning CD, Wave ring, Pulse, Orbit, any colour (Studio → Call screen). The caller sees no spectrum | Implemented, browser-tested |
| **Call-ended** message appears as a toast at the bottom, plus a call log line in the chat | Implemented, browser-tested |
| **Attachments of any file type** up to 25 MB (`MAX_ATTACH_MB`). Only images, video and audio render inline; everything else downloads, served with a sandboxing CSP | Implemented, API- and browser-tested |
| **Voice channels** and **group calls** (WebRTC full mesh, up to 8 people, camera, screen share, speaking indicators, group-call invites that ring) | Implemented, API- and browser-tested with two real browser peers |
| **Roles**: owner, admin (full site powers except making admins), staff (view people, warn). Owner/admin/staff badges | Implemented, API- and browser-tested |
| Owner/admin can **give Sparks** (dashboard and profile button) | Implemented, API- and browser-tested |
| **Premade bots** per community or group: Security (spam flood, invites, links, shouting, banned words, auto-timeout), Music (upload tracks, `!play`), Welcome, Fun & Games. The old token/webhook bots were removed | Implemented, API- and browser-tested |
| **Community sidebar** like Discord (server bar + channel column + members), **drag to reorder** servers (saved on your device) and channels (saved on the server), drag-and-drop file attach | Implemented, browser-tested |
| **Studio**: look (theme, two accents, bubble style, corners, text size, chat background, layout), profile (pronouns, links, interests, logo picker, profile song), sounds & music library, call screen, privacy (who can DM: everyone / shared spaces / friends / nobody; private account; online status), alerts, Sparks, account | Implemented, browser-tested |
| Minimal **square symbol icons** instead of text, animated popups, **X** at the top of every popup, **ban popup** shown live and on login | Implemented, browser-tested |
| **Onboarding** wizard for new accounts (name, logo, interests, look, privacy, bio) | Implemented, browser-tested |
| **Landing page**, mobile layout (top server strip, bottom tab bar, full-screen panels, safe areas) | Implemented, browser-tested at 1360 px and 390 px |
| **Installed app alerts**: Web Push (RFC 8291 + VAPID, no libraries) shows a call popup with Answer/Decline and vibration even when the app is closed or the screen is off | Implemented. Encryption verified against the RFC 8291 test vector and delivery against a local push endpoint. **Not tested against Google/Apple/Mozilla push services or on a real phone** |

### Honest limits

- **Not built: native apps and end-to-end encryption.** Native packages need platform toolchains and signing that could not run here, and a hurried home-made E2EE protocol would be worse than none. Use the installable web app (Chrome/Edge: Install; iPhone: Share → Add to Home Screen). Messages are protected by TLS in transit but **the server can read them**. Calls are peer to peer and encrypted by WebRTC.
- **Ringing with the screen off.** Browsers do not let a web app play sound from the background. An installed app with notifications on gets a high-priority call notification (popup showing who is calling, Answer/Decline, long vibration, the phone’s notification sound). Your custom ringtone and the spectrum play once the call screen opens. iPhone needs the app added to the Home Screen first. Some phones’ battery savers delay notifications.
- Voice channels and group calls are a full mesh: fine for small groups (limit 8), not for large rooms. Some networks need a TURN server (`TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL`).
- Offline push is sent for calls, direct messages and notifications. Group and channel messages do not push.
- Server order of communities in the sidebar is saved per browser (localStorage).
- The AI buddy was tested by you against real Groq; the automated tests use a fake provider.

## Run

    npm start        # http://localhost:3000, data in ./data
    npm test         # 73 tests

Requires Node >= 22.5. Set `OWNER_USERNAME` and `OWNER_PASSWORD` (12+ characters) to create the owner; owner/admin tools appear in the dock.

## Environment

| Variable | Purpose |
|---|---|
| `DB_PATH`, `UPLOAD_DIR` | SQLite file and uploads (put both on a persistent disk) |
| `OWNER_USERNAME`, `OWNER_PASSWORD` | Owner account, rotated on every boot |
| `AI_KEY_SECRET` | 32+ random characters; enables the AI buddy |
| `MAX_ATTACH_MB` | Attachment size limit (default 25) |
| `VAPID_SUBJECT` | `mailto:you@example.com` or your site URL, sent with web push. **Set this in production** |
| `PUSH_ANY_HOST=1` | Test only: allow non-standard push endpoints |
| `TRUST_PROXY_HOPS`, `NODE_ENV=production`, `PORT` | Hosting |
| `STUN_URL`, `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | WebRTC |

Web Push keys are generated on first boot and stored in the database (table `kv`); keep the database on the persistent disk so existing subscriptions keep working.

## Roles

- **Owner**: everything, including making admins.
- **Admin**: stats, people, warn, suspend/restore, announcements, Sparks, audit log, removing posts, making staff.
- **Staff**: stats, people list, warnings.

## Bots

Pick bots when you create a community or group, or later in settings (Bots tab). Type `!help` in a chat.

- **Security**: blocks floods, other services’ invite links, optionally all links, shouting and your banned words; repeat offenders are timed out (communities). Admins are exempt.
- **Music**: admins upload tracks (≤ 10 MB); members use `!tracks` and `!play <number or title>`; tracks play in an inline player and can only be fetched by members.
- **Welcome**: greets new members. **Fun & Games**: `!roll`, `!flip`, `!8ball`, `!choose`, `!rps`.

## Deploy

Render and Railway files are included (`render.yaml`, `railway.json`, `Dockerfile`). Use a persistent disk, a single instance and HTTPS (required for installing the app, push and camera/microphone). Not yet verified on a live host.

## Notes

- SQLite and Node built-ins only (the sandbox had no network). Moving to Postgres is the first step to scale beyond one instance.
- Search is SQL `LIKE`, membership-scoped.
- Login rate limiting is in memory.
