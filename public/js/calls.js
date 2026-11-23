import { $, h, state, api, nav, iconNode, avatarEl, toast, fail } from './ui.js';
import { playSound } from './audio.js';
import { mountSpectrum } from './spectrum.js';

const call = { id: null, peer: null, pc: null, local: null, screen: null, queue: [], incoming: false, video: false, videoSender: null, stopTone: null, spec: null, startedAt: 0 };
const sendSignal = (data) => api('/api/call/signal', { body: { call: call.id, data } }).catch(() => {});
const status = (t) => { $('call-status').textContent = t; };
const ICONS = { 'call-accept': 'phone', 'call-mic': 'mic', 'call-cam': 'video', 'call-share': 'screen', 'call-end': 'phoneoff' };
for (const [id, ic] of Object.entries(ICONS)) $(id).replaceChildren(iconNode(ic, 24));

const stopTone = () => { call.stopTone?.(); call.stopTone = null; call.spec?.stop(); call.spec = null; };

/* Callee hears their ringtone and sees the beat spectrum. The caller hears the calling tune and sees no spectrum. */
function ringIncoming(name, avatar) {
  stopTone();
  const s = state.sound; const own = s?.overrides.find((o) => o.kind === 'ring' && o.target === call.peer);
  const tone = own?.tone ?? s?.ringtone ?? 'ring';
  const sp = state.spectrum ?? { style: 'bars', color: '#b7c9e6' };
  call.spec = mountSpectrum($('call-spec'), { style: sp.style, color: sp.color, avatar: avatarEl(avatar, name, 200), size: Math.min(340, innerWidth - 40) });
  if (s && !state.privacy?.dnd && tone !== 'none') call.stopTone = playSound(tone, s.volume, true);
}
function ringOutgoing(name, avatar) {
  stopTone();
  const wrap = h('div', { className: 'calling-ring' }, avatarEl(avatar, name, 150));
  $('call-spec').classList.remove('spec'); $('call-spec').replaceChildren(wrap);
  let tune = state.sound?.callTune ?? 'ringback';
  if (tune === state.sound?.ringtone) tune = 'ringback'; // the caller must never hear the ringtone
  if (state.sound && tune !== 'none') call.stopTone = playSound(tune, state.sound.volume, true);
}

function cleanup(message) {
  stopTone();
  call.pc?.close();
  [call.local, call.screen].forEach((s) => s?.getTracks().forEach((t) => t.stop()));
  const was = call.id;
  Object.assign(call, { id: null, peer: null, pc: null, local: null, screen: null, queue: [], incoming: false, videoSender: null, startedAt: 0 });
  const el = $('call'); el.hidden = true; el.classList.remove('has-video', 'has-local', 'ringing');
  $('remote-video').srcObject = $('local-video').srcObject = null; $('call-spec').replaceChildren(); $('call-spec').className = '';
  $('call-mic').classList.remove('off'); $('call-cam').classList.remove('off'); $('call-share').classList.remove('off');
  if (was && message) toast(message, { ic: 'phone', ms: 4200 });
}

async function prepare(video, attach = true) {
  const { iceServers } = await api('/api/ice');
  try { call.local = await navigator.mediaDevices.getUserMedia({ audio: true, video }); }
  catch (err) { if (!video) throw err; call.local = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  $('local-video').srcObject = call.local; $('call').classList.toggle('has-local', !!call.local.getVideoTracks().length);
  const pc = new RTCPeerConnection({ iceServers }); call.pc = pc;
  const remote = new MediaStream(); $('remote-video').srcObject = remote;
  if (attach) { call.local.getAudioTracks().forEach((t) => pc.addTrack(t, call.local)); call.videoSender = pc.addTransceiver(call.local.getVideoTracks()[0] ?? 'video', { direction: 'sendrecv' }).sender; }
  pc.ontrack = (e) => { remote.addTrack(e.track); if (e.track.kind === 'video') { e.track.onunmute = () => $('call').classList.add('has-video'); } };
  pc.onicecandidate = (e) => { if (e.candidate) sendSignal({ candidate: e.candidate }); };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') { status('Connected'); call.startedAt ||= Date.now(); }
    if (pc.connectionState === 'failed') status('Connection failed. A TURN server may be needed on this network.');
  };
  $('call-cam').hidden = !call.local.getVideoTracks().length;
}

function screen(name, avatar, text, incoming) {
  $('call-name').textContent = name; $('call-accept').hidden = !incoming; $('call-share').hidden = !navigator.mediaDevices?.getDisplayMedia;
  status(text); $('call').hidden = false; $('call').classList.toggle('ringing', !!incoming);
  if (incoming) ringIncoming(name, avatar); else ringOutgoing(name, avatar);
}

export async function startCall(video) {
  if (call.id || !state.peer) return;
  const name = $('peer-name').textContent;
  try {
    await prepare(video);
    const r = await api('/api/call/start', { body: { to: state.peer, video } });
    Object.assign(call, { id: r.id, peer: state.peer, video });
    screen(name, state.peerAvatar, 'Calling…', false);
  } catch (err) { cleanup(); toast(err.name === 'NotAllowedError' || err.name === 'NotFoundError' ? 'Allow microphone access (and a camera for video) to call.' : err.message, { kind: 'error', ic: 'mic' }); }
}

async function onSignal(data) {
  if (!call.pc) return;
  if (data.description) {
    await call.pc.setRemoteDescription(data.description);
    for (const c of call.queue.splice(0)) await call.pc.addIceCandidate(c).catch(() => {});
    if (data.description.type === 'offer') {
      for (const t of call.pc.getTransceivers()) {
        const isAudio = t.receiver.track.kind === 'audio';
        await t.sender.replaceTrack(isAudio ? call.local.getAudioTracks()[0] : call.local.getVideoTracks()[0] ?? null); t.direction = 'sendrecv'; if (!isAudio) call.videoSender = t.sender;
      }
      await call.pc.setLocalDescription(await call.pc.createAnswer()); sendSignal({ description: call.pc.localDescription });
    }
  } else if (data.candidate) { if (call.pc.remoteDescription) call.pc.addIceCandidate(data.candidate).catch(() => {}); else call.queue.push(data.candidate); }
}

export function onCallEvent(m) {
  if (m.type === 'incoming') {
    if (call.id) return;
    Object.assign(call, { id: m.id, peer: m.from, incoming: true, video: m.video });
    screen(m.name, m.avatar, m.video ? 'Incoming video call' : 'Incoming call', true);
    nav.systemNotify?.('dm', m.from, m.name, 'Incoming call');
  } else if (m.id !== call.id) return;
  else if (m.type === 'answered') {
    stopTone(); $('call-spec').replaceChildren(h('div', { className: 'calling-ring' }, avatarEl(state.peerAvatar, state.peer, 150))); status('Connecting…');
    call.pc.createOffer().then(async (o) => { await call.pc.setLocalDescription(o); sendSignal({ description: call.pc.localDescription }); });
  } else if (m.type === 'signal') onSignal(m.data).catch(() => {});
  else if (m.type === 'ended') cleanup(m.text ?? 'Call ended');
}

/* a ringing call that arrived while the app was closed (opened from a notification) */
export async function checkPending() {
  if (call.id) return;
  const p = await api('/api/call/pending').catch(() => ({}));
  if (p.id) onCallEvent({ type: 'incoming', id: p.id, from: p.from, name: p.name, avatar: p.avatar, video: p.video });
}

/* Studio preview: a fake incoming call with my own picture */
export function previewIncoming(style, color) {
  if (call.id) return;
  call.id = -1; call.peer = null;
  const prev = state.spectrum; state.spectrum = { style: style ?? prev?.style, color: color ?? prev?.color };
  const name = state.displayName || state.me;
  $('call-name').textContent = name; status('Preview — this is how incoming calls look to you'); $('call-accept').hidden = false; $('call-share').hidden = true; $('call').hidden = false;
  ringIncoming(name, state.avatar); state.spectrum = prev;
}

$('call-accept').addEventListener('click', async () => {
  if (call.id === -1) return cleanup();
  stopTone(); $('call').classList.remove('ringing'); $('call-spec').replaceChildren(h('div', { className: 'calling-ring' }, avatarEl(null, $('call-name').textContent, 150)));
  try { await prepare(call.video, false); $('call-accept').hidden = true; status('Connecting…'); await api('/api/call/answer', { body: { call: call.id } }); }
  catch (err) { await api('/api/call/decline', { body: { call: call.id } }).catch(() => {}); cleanup(); toast('Allow microphone access to answer calls.', { kind: 'error', ic: 'mic' }); }
});
$('call-end').addEventListener('click', async () => {
  if (call.id === -1) return cleanup();
  const path = call.incoming && !$('call-accept').hidden ? '/api/call/decline' : '/api/call/end';
  await api(path, { body: { call: call.id } }).catch(() => {});
  cleanup(call.startedAt ? undefined : 'Call ended');
});
const toggle = (btn, kind, onLabel, offLabel) => {
  const tracks = call.local?.[kind]() ?? []; const on = !tracks[0]?.enabled; tracks.forEach((t) => { t.enabled = on; });
  btn.classList.toggle('off', !on); btn.setAttribute('aria-label', on ? onLabel : offLabel);
};
$('call-mic').addEventListener('click', () => { toggle($('call-mic'), 'getAudioTracks', 'Mute microphone', 'Unmute microphone'); $('call-mic').replaceChildren(iconNode($('call-mic').classList.contains('off') ? 'micoff' : 'mic', 24)); });
$('call-cam').addEventListener('click', () => { toggle($('call-cam'), 'getVideoTracks', 'Turn camera off', 'Turn camera on'); $('call-cam').replaceChildren(iconNode($('call-cam').classList.contains('off') ? 'videooff' : 'video', 24)); });
async function stopShare() {
  if (!call.screen) return;
  call.screen.getTracks().forEach((t) => t.stop()); call.screen = null;
  await call.videoSender?.replaceTrack(call.local?.getVideoTracks()[0] ?? null); $('local-video').srcObject = call.local; $('call-share').classList.remove('off');
}
$('call-share').addEventListener('click', async () => {
  if (call.screen) return stopShare();
  try { call.screen = await navigator.mediaDevices.getDisplayMedia({ video: true }); } catch { return; }
  const track = call.screen.getVideoTracks()[0]; await call.videoSender.replaceTrack(track); track.onended = stopShare;
  $('local-video').srcObject = call.screen; $('call').classList.add('has-local'); $('call-share').classList.add('off');
});

Object.assign(nav, { startCall, previewIncoming, checkPending });
