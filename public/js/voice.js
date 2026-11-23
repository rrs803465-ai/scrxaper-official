import { $, h, state, api, nav, sq, iconNode, avatarEl, toast, fail } from './ui.js';
import { playSound } from './audio.js';
import { onVoiceState } from './community.js';

const room = { key: null, title: '', peers: new Map(), local: null, ice: null, users: [], screen: null, meters: new Map(), timer: 0 };
const sig = (to, data) => api('/api/voice/signal', { body: { room: room.key, to, data } }).catch(() => {});
let actx;

function meter(name, stream) {
  try {
    actx ??= new AudioContext(); const src = actx.createMediaStreamSource(stream); const an = actx.createAnalyser(); an.fftSize = 256; src.connect(an);
    room.meters.set(name, { an, buf: new Uint8Array(an.frequencyBinCount), src });
  } catch { /* no audio meter available */ }
}
function tick() {
  for (const [name, m] of room.meters) {
    m.an.getByteFrequencyData(m.buf); const lvl = m.buf.reduce((a, b) => a + b, 0) / m.buf.length;
    document.querySelector(`.vtile[data-user="${CSS.escape(name)}"]`)?.classList.toggle('speaking', lvl > 18);
  }
}

function tile(u) {
  let t = document.querySelector(`.vtile[data-user="${CSS.escape(u.username)}"]`);
  if (!t) {
    const video = h('video', { autoplay: true, playsInline: true, muted: u.username === state.me });
    t = h('div', { className: 'vtile' }, avatarEl(u.avatar, u.name, 72), video, h('span', { className: 'nm' }, u.username === state.me ? `${u.name} (you)` : u.name));
    t.dataset.user = u.username; $('vgrid').append(t);
  }
  return t;
}
function syncTiles() {
  const names = new Set(room.users.map((u) => u.username));
  document.querySelectorAll('.vtile').forEach((t) => { if (!names.has(t.dataset.user)) { room.meters.delete(t.dataset.user); t.remove(); } });
  room.users.forEach(tile);
  const me = document.querySelector(`.vtile[data-user="${CSS.escape(state.me)}"] video`); if (me && me.srcObject !== room.local) { me.srcObject = room.local; if (room.local?.getVideoTracks().length) me.style.setProperty('display', 'block'); }
  $('vtitle-count').textContent = `${room.users.length} in room`;
}

async function peer(name, initiator) {
  if (room.peers.has(name)) return room.peers.get(name);
  const pc = new RTCPeerConnection({ iceServers: room.ice }); const p = { pc, queue: [], stream: new MediaStream(), senders: {} }; room.peers.set(name, p);
  room.local.getAudioTracks().forEach((t) => { p.senders.audio = pc.addTrack(t, room.local); });
  p.senders.video = pc.addTransceiver(room.local.getVideoTracks()[0] ?? 'video', { direction: 'sendrecv' }).sender;
  pc.ontrack = (e) => {
    p.stream.addTrack(e.track);
    const v = document.querySelector(`.vtile[data-user="${CSS.escape(name)}"] video`); if (v) { v.srcObject = p.stream; if (e.track.kind === 'video') { e.track.onunmute = () => v.style.setProperty('display', 'block'); e.track.onmute = () => v.style.setProperty('display', 'none'); } }
    if (e.track.kind === 'audio') meter(name, new MediaStream([e.track]));
  };
  pc.onicecandidate = (e) => { if (e.candidate) sig(name, { candidate: e.candidate }); };
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') toast(`Connection to ${name} failed`, { kind: 'error' }); };
  if (initiator) { await pc.setLocalDescription(await pc.createOffer()); sig(name, { description: pc.localDescription }); }
  return p;
}
async function onSignal(m) {
  if (m.room !== room.key) return;
  const p = await peer(m.from, false); const { pc } = p;
  if (m.data.description) {
    await pc.setRemoteDescription(m.data.description);
    for (const c of p.queue.splice(0)) await pc.addIceCandidate(c).catch(() => {});
    if (m.data.description.type === 'offer') {
      for (const t of pc.getTransceivers()) { const audio = t.receiver.track.kind === 'audio'; await t.sender.replaceTrack(audio ? room.local.getAudioTracks()[0] : room.local.getVideoTracks()[0] ?? null); t.direction = 'sendrecv'; if (!audio) p.senders.video = t.sender; }
      await pc.setLocalDescription(await pc.createAnswer()); sig(m.from, { description: pc.localDescription });
    }
  } else if (m.data.candidate) { if (pc.remoteDescription) pc.addIceCandidate(m.data.candidate).catch(() => {}); else p.queue.push(m.data.candidate); }
}
export function onVoiceEvent(m) {
  if (m.type === 'state') {
    onVoiceState(m);
    if (m.room === room.key) {
      room.users = m.users; const names = new Set(m.users.map((u) => u.username));
      for (const [n, p] of room.peers) if (!names.has(n)) { p.pc.close(); room.peers.delete(n); }
      syncTiles(); renderPill();
    }
  } else if (m.type === 'signal') onSignal(m).catch(() => {});
}

export async function joinVoice({ channel, group, video = false }) {
  if (room.key) await leaveVoice();
  try {
    room.ice = (await api('/api/ice')).iceServers;
    try { room.local = await navigator.mediaDevices.getUserMedia({ audio: true, video }); } catch (e) { if (!video) throw e; room.local = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    const r = await api('/api/voice/join', { body: { channel, group, video: !!room.local.getVideoTracks().length } });
    room.key = r.room; room.title = r.title; room.users = [{ username: state.me, name: state.displayName, avatar: state.avatar }, ...r.peers.map((u) => ({ username: u.username, name: u.name, avatar: u.avatar }))];
    $('vroom').hidden = false; drawRoom(); syncTiles(); meter(state.me, new MediaStream(room.local.getAudioTracks()));
    clearInterval(room.timer); room.timer = setInterval(tick, 160);
    for (const u of r.peers) await peer(u.username, true);
    renderPill();
  } catch (e) { room.local?.getTracks().forEach((t) => t.stop()); room.local = null; room.key = null; $('vroom').hidden = true; toast(e.name === 'NotAllowedError' ? 'Allow microphone access to join voice.' : e.message, { kind: 'error', ic: 'mic' }); }
}
export async function leaveVoice() {
  if (!room.key) return;
  await api('/api/voice/leave', { body: {} }).catch(() => {});
  for (const p of room.peers.values()) p.pc.close();
  room.peers.clear(); room.meters.clear(); clearInterval(room.timer);
  [room.local, room.screen].forEach((s) => s?.getTracks().forEach((t) => t.stop()));
  Object.assign(room, { key: null, local: null, screen: null, users: [] });
  $('vroom').hidden = true; $('vroom').replaceChildren(); $('vpill').hidden = true; $('vpill').replaceChildren();
}

function drawRoom() {
  const ctl = (ic, label, fn, cls = '') => { const b = h('button', { type: 'button', className: `cbtn ${cls}`, title: label, ariaLabel: label, onclick: fn }); b.append(iconNode(ic, 24)); return b; };
  const mic = ctl('mic', 'Mute microphone', () => { const t = room.local.getAudioTracks(); const on = !t[0]?.enabled; t.forEach((x) => { x.enabled = on; }); mic.classList.toggle('off', !on); mic.replaceChildren(iconNode(on ? 'mic' : 'micoff', 24)); });
  const cam = ctl('video', 'Camera', async () => {
    let t = room.local.getVideoTracks()[0];
    if (!t) { try { const s = await navigator.mediaDevices.getUserMedia({ video: true }); t = s.getVideoTracks()[0]; room.local.addTrack(t); } catch { return toast('Camera unavailable', { kind: 'error' }); } for (const p of room.peers.values()) await p.senders.video.replaceTrack(t); syncTiles(); cam.classList.remove('off'); return; }
    t.enabled = !t.enabled; cam.classList.toggle('off', !t.enabled); cam.replaceChildren(iconNode(t.enabled ? 'video' : 'videooff', 24));
  });
  const share = ctl('screen', 'Share screen', async () => {
    if (room.screen) { room.screen.getTracks().forEach((t) => t.stop()); room.screen = null; for (const p of room.peers.values()) await p.senders.video.replaceTrack(room.local.getVideoTracks()[0] ?? null); share.classList.remove('off'); return; }
    try { room.screen = await navigator.mediaDevices.getDisplayMedia({ video: true }); } catch { return; }
    const t = room.screen.getVideoTracks()[0]; for (const p of room.peers.values()) await p.senders.video.replaceTrack(t); share.classList.add('off'); t.onended = () => share.click();
  });
  if (!navigator.mediaDevices?.getDisplayMedia) share.hidden = true;
  $('vroom').replaceChildren(
    h('header', {}, h('strong', { id: 'vtitle' }, room.title), h('small', { id: 'vtitle-count', style: { color: 'var(--muted)' } }), h('span', { className: 'grow' }), sq('minimize', 'Minimize', minimize)),
    h('div', { className: 'vgrid', id: 'vgrid' }), h('div', { className: 'call-controls' }, mic, cam, share, ctl('phoneoff', 'Leave', leaveVoice, 'no')));
}
function minimize() { $('vroom').hidden = true; renderPill(); }
function renderPill() {
  const pill = $('vpill'); if (!room.key) return;
  pill.hidden = !$('vroom').hidden ? true : false;
  pill.replaceChildren(h('span', { style: { flex: '1', 'min-width': '0' } }, h('strong', {}, room.title), h('small', {}, `Voice connected · ${room.users.length}`)), sq('expand', 'Open room', () => { $('vroom').hidden = false; pill.hidden = true; }, 'small'), sq('phoneoff', 'Leave', leaveVoice, 'small danger-sq'));
}

/* incoming group call invite */
let inviteStop = null; let inviteTimer = 0;
export function onVoiceInvite(inv) {
  if (room.key === inv.room) return;
  const box = $('invite-toast'); clearTimeout(inviteTimer); inviteStop?.();
  const s = state.sound; if (s && !state.privacy?.dnd) inviteStop = playSound(s.ringtone ?? 'ring', s.volume, true);
  const close = () => { box.hidden = true; inviteStop?.(); inviteStop = null; clearTimeout(inviteTimer); };
  box.replaceChildren(avatarEl(inv.avatar, inv.name, 44), h('div', { className: 'meta' }, h('b', {}, `${inv.name} started a group call`), h('small', {}, inv.title)),
    h('button', { className: 'cbtn ok', type: 'button', ariaLabel: 'Join call', style: { width: '46px', height: '46px', 'border-radius': '16px' }, onclick: () => { close(); joinVoice({ group: inv.group, video: inv.video }); } }, iconNode('phone', 20)),
    h('button', { className: 'cbtn no', type: 'button', ariaLabel: 'Dismiss', style: { width: '46px', height: '46px', 'border-radius': '16px' }, onclick: close }, iconNode('x', 20)));
  box.hidden = false; inviteTimer = setTimeout(close, 30000);
}
window.addEventListener('beforeunload', () => { if (room.key) navigator.sendBeacon?.('/api/voice/leave'); });
Object.assign(nav, { joinVoice, leaveVoice });
