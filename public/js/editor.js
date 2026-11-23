import { $, h, state, api, upload, sq, iconNode, toast, fail, fmtSize, pickFile } from './ui.js';

const FILTERS = { Original: {}, Mono: { s: -100 }, Warm: { tint: [14, 4, -12] }, Cool: { tint: [-10, 2, 14] }, Fade: { c: -18, b: 12 }, Vivid: { s: 45, c: 12 } };
const CSS_FILTER = { Original: 'none', Mono: 'grayscale(1)', Warm: 'sepia(.25) saturate(1.2) hue-rotate(-8deg)', Cool: 'saturate(1.1) hue-rotate(12deg) brightness(1.03)', Fade: 'contrast(.85) brightness(1.1) saturate(.9)', Vivid: 'saturate(1.5) contrast(1.12)' };
const ASPECTS = { free: 0, '1:1': 1, '4:5': 4 / 5, '16:9': 16 / 9, '9:16': 9 / 16, '3:1': 3 };
const shell = (title, onClose) => { const root = $('editor'); root.hidden = false; return { root, head: h('header', {}, h('strong', {}, title), h('span', { className: 'grow' }), sq('x', 'Cancel', onClose)) }; };

/* ---------- photo editor ---------- */
export function editPhoto(file, { aspect = 'free', title = 'Edit photo' } = {}) {
  return new Promise(async (resolve) => {
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) { toast('That image could not be read.', { kind: 'error' }); return resolve(null); }
    const st = { rot: 0, flip: false, aspect, b: 0, c: 0, s: 0, filter: 'Original' };
    const preview = h('canvas'); const stageCanvas = document.createElement('canvas');
    const finish = (v) => { $('editor').hidden = true; $('editor').replaceChildren(); resolve(v); };
    function adjust(ctx, w, hgt) {
      const f = FILTERS[st.filter]; const bri = st.b + (f.b ?? 0); const con = st.c + (f.c ?? 0); const sat = st.s + (f.s ?? 0); const tint = f.tint ?? [0, 0, 0];
      if (!bri && !con && !sat && !f.tint) return;
      const img = ctx.getImageData(0, 0, w, hgt); const d = img.data; const cf = (259 * (con + 255)) / (255 * (259 - con)); const sf = 1 + sat / 100;
      for (let i = 0; i < d.length; i += 4) { const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; for (let k = 0; k < 3; k++) { const v = lum + (d[i + k] - lum) * sf + bri * 2.55 + tint[k]; d[i + k] = cf * (v - 128) + 128; } }
      ctx.putImageData(img, 0, 0);
    }
    function render(canvas, maxSide) {
      const turned = st.rot % 2 === 1; const sw = turned ? bitmap.height : bitmap.width; const sh = turned ? bitmap.width : bitmap.height; let cw = sw; let ch = sh; const r = ASPECTS[st.aspect];
      if (r) { if (sw / sh > r) cw = Math.round(sh * r); else ch = Math.round(sw / r); }
      const k = Math.min(1, maxSide / Math.max(cw, ch)); canvas.width = Math.max(1, Math.round(cw * k)); canvas.height = Math.max(1, Math.round(ch * k));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.scale(k, k); ctx.translate(-Math.round((sw - cw) / 2), -Math.round((sh - ch) / 2)); ctx.translate(sw / 2, sh / 2); ctx.rotate((st.rot * Math.PI) / 2); if (st.flip) ctx.scale(-1, 1);
      ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2); ctx.setTransform(1, 0, 0, 1, 0, 0); adjust(ctx, canvas.width, canvas.height);
    }
    let queued = false; const refresh = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; render(preview, 720); }); } };
    const slider = (label, key) => h('label', { className: 'rng' }, label, h('input', { type: 'range', min: -100, max: 100, value: 0, ariaLabel: label, oninput: (e) => { st[key] = Number(e.target.value); refresh(); } }));
    const pills = (items, get, set) => { const row = h('div', { className: 'pills' }); const paint = () => row.replaceChildren(...items.map(([v, l]) => h('button', { type: 'button', className: 'pill', 'aria-pressed': String(get() === v), onclick: () => { set(v); paint(); refresh(); } }, l))); paint(); return row; };
    const { root, head } = shell(title, () => finish(null));
    root.replaceChildren(head, h('div', { className: 'stage' }, preview), h('div', { className: 'tools' },
      h('div', { className: 'row' }, sq('flip', 'Rotate', () => { st.rot = (st.rot + 1) % 4; refresh(); }), sq('flip', 'Mirror', () => { st.flip = !st.flip; refresh(); }), pills(Object.keys(ASPECTS).map((a) => [a, a === 'free' ? 'Original' : a]), () => st.aspect, (v) => { st.aspect = v; })),
      h('div', { className: 'row' }, slider('Brightness', 'b'), slider('Contrast', 'c'), slider('Saturation', 's')),
      pills(Object.keys(FILTERS).map((n) => [n, n]), () => st.filter, (v) => { st.filter = v; }),
      h('div', { className: 'row' }, h('span', { className: 'grow' }), h('button', { className: 'primary', type: 'button', onclick: () => { render(stageCanvas, 2048); stageCanvas.toBlob((b) => finish(b), 'image/jpeg', 0.9); } }, 'Done'))));
    render(preview, 720);
  });
}

/* ---------- video editor: trim, speed, filter, mute, crop; re-encoded in the browser ---------- */
const durationOf = (v) => new Promise((res) => {
  const ok = () => Number.isFinite(v.duration) && v.duration > 0;
  if (ok()) return res(v.duration);
  v.currentTime = 1e7; const t = setTimeout(() => res(0), 5000);
  v.ondurationchange = () => { if (ok()) { clearTimeout(t); v.ondurationchange = null; v.currentTime = 0; res(v.duration); } };
});
export function editVideo(file, { maxSeconds = 60, title = 'Edit reel' } = {}) {
  return new Promise(async (resolve) => {
    const url = URL.createObjectURL(file);
    const video = h('video', { src: url, playsInline: true, preload: 'auto', loop: false });
    await new Promise((r) => { video.onloadedmetadata = r; video.onerror = r; });
    const dur = await durationOf(video);
    if (!dur) { toast('That video could not be read. Try an MP4 or WebM file.', { kind: 'error' }); URL.revokeObjectURL(url); return resolve(null); }
    const st = { start: 0, end: Math.min(dur, maxSeconds), speed: 1, filter: 'Original', mute: false, crop: false, flip: false };
    const canEncode = typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;
    const finish = (v) => { video.pause(); URL.revokeObjectURL(url); $('editor').hidden = true; $('editor').replaceChildren(); resolve(v); };
    const time = h('small', { style: { color: 'var(--muted)' } });
    const paint = () => { video.style.setProperty('filter', CSS_FILTER[st.filter]); video.style.setProperty('transform', st.flip ? 'scaleX(-1)' : 'none'); video.style.setProperty('aspect-ratio', st.crop ? '9 / 16' : ''); video.style.setProperty('object-fit', st.crop ? 'cover' : 'contain'); video.muted = st.mute; time.textContent = `${st.start.toFixed(1)}s – ${st.end.toFixed(1)}s · ${((st.end - st.start) / st.speed).toFixed(1)}s final`; };
    const range = (label, key, min, max) => h('label', { className: 'rng' }, label, h('input', { type: 'range', min, max, step: 0.1, value: st[key], ariaLabel: label, oninput: (e) => { st[key] = Number(e.target.value); if (key === 'start' && st.start >= st.end - 0.5) st.start = st.end - 0.5; if (key === 'end' && st.end <= st.start + 0.5) st.end = st.start + 0.5; if (key === 'end' && st.end - st.start > maxSeconds * st.speed) st.end = st.start + maxSeconds * st.speed; video.currentTime = key === 'start' ? st.start : Math.max(st.start, st.end - 0.3); paint(); } }));
    const pills = (items, get, set) => { const row = h('div', { className: 'pills' }); const p = () => row.replaceChildren(...items.map(([v, l]) => h('button', { type: 'button', className: 'pill', 'aria-pressed': String(get() === v), onclick: () => { set(v); p(); paint(); } }, l))); p(); return row; };
    let playing = false;
    video.addEventListener('timeupdate', () => { if (playing && video.currentTime >= st.end) { video.currentTime = st.start; } });
    const play = sq('play', 'Preview', () => { playing = !playing; if (playing) { video.currentTime = st.start; video.playbackRate = st.speed; video.play(); } else video.pause(); play.replaceChildren(iconNode(playing ? 'pause' : 'play', 20)); });
    const progress = h('div', { className: 'progress', hidden: true }, h('i'));
    const done = h('button', { className: 'primary', type: 'button' }, 'Done');
    done.addEventListener('click', async () => {
      const untouched = st.start === 0 && st.end >= dur - 0.05 && st.speed === 1 && st.filter === 'Original' && !st.mute && !st.crop && !st.flip;
      if (untouched && dur <= maxSeconds) return finish(file);
      if (!canEncode) { if (dur > maxSeconds) { toast('Editing is not supported in this browser, and the video is longer than 60 seconds.', { kind: 'error' }); return; } toast('Editing is not supported in this browser; using the original video.'); return finish(file); }
      done.disabled = true; progress.hidden = false; playing = false; video.pause();
      try { finish(await encode(video, st, (p) => progress.firstChild.style.setProperty('width', `${p * 100}%`))); } catch (e) { done.disabled = false; progress.hidden = true; fail(e); }
    });
    const { root, head } = shell(title, () => finish(null));
    root.replaceChildren(head, h('div', { className: 'stage' }, video), h('div', { className: 'tools' },
      h('div', { className: 'row' }, play, time), h('div', { className: 'row' }, range('Start', 'start', 0, dur), range('End', 'end', 0, dur)),
      h('div', { className: 'row' }, pills([[0.5, '0.5×'], [1, '1×'], [1.5, '1.5×'], [2, '2×']], () => st.speed, (v) => { st.speed = v; video.playbackRate = v; }), pills([[false, 'Fit'], [true, 'Fill 9:16']], () => st.crop, (v) => { st.crop = v; }),
        pills([[false, 'Sound on'], [true, 'Muted']], () => st.mute, (v) => { st.mute = v; })),
      pills(Object.keys(FILTERS).map((n) => [n, n]), () => st.filter, (v) => { st.filter = v; }),
      progress, h('div', { className: 'row' }, !canEncode ? h('small', { style: { color: 'var(--muted)' } }, 'Trim and filters need Chrome, Edge or Firefox.') : '', h('span', { className: 'grow' }), done)));
    paint();
  });
}
async function encode(video, st, onProgress) {
  const vw = video.videoWidth || 720; const vh = video.videoHeight || 1280;
  const outH = st.crop ? 1280 : Math.min(vh, 1280); const outW = st.crop ? 720 : Math.round((vw / vh) * outH);
  const canvas = Object.assign(document.createElement('canvas'), { width: outW - (outW % 2), height: outH - (outH % 2) }); const ctx = canvas.getContext('2d');
  const stream = canvas.captureStream(30); let actx = null;
  if (!st.mute) { try { actx = new AudioContext(); const dest = actx.createMediaStreamDestination(); actx.createMediaElementSource(video).connect(dest); dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t)); } catch { /* silent export */ } }
  const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  if (!type) throw new Error('This browser cannot record video.');
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 3_500_000 }); const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  video.muted = false; video.currentTime = st.start; await new Promise((r) => { video.onseeked = r; }); video.onseeked = null; video.playbackRate = st.speed;
  const done = new Promise((res) => { rec.onstop = () => res(new Blob(chunks, { type: 'video/webm' })); });
  rec.start(250); await video.play();
  await new Promise((resolve) => {
    const draw = () => {
      const t = video.currentTime;
      ctx.filter = CSS_FILTER[st.filter]; ctx.save();
      if (st.flip) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
      const scale = st.crop ? Math.max(canvas.width / vw, canvas.height / vh) : Math.min(canvas.width / vw, canvas.height / vh); const dw = vw * scale; const dh = vh * scale;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(video, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh); ctx.restore();
      onProgress(Math.min(1, (t - st.start) / (st.end - st.start)));
      if (t >= st.end - 0.04 || video.ended) return resolve(); requestAnimationFrame(draw);
    };
    draw();
  });
  video.pause(); rec.stop(); actx?.close();
  const blob = await done;
  if (!blob.size) throw new Error('The edited video came out empty. Try again.');
  return blob;
}

/* ---------- inline music picker for posts, reels and stories ---------- */
export function musicField() {
  const val = { id: null, label: '', start: 0 }; let preview = null;
  const box = h('div', { className: 'card' }); const list = h('div', { style: { display: 'grid', gap: '6px' } });
  const stop = () => { preview?.pause(); preview = null; };
  const summary = h('div', { className: 'field-row' });
  const startRange = h('input', { type: 'range', min: 0, max: 180, step: 1, value: 0, ariaLabel: 'Start time', oninput: () => { val.start = Number(startRange.value); label.textContent = `Starts at ${val.start}s`; } });
  const label = h('small', {}, 'Starts at 0s'); const startRow = h('label', { className: 'rng', hidden: true }, label, startRange);
  const paintSummary = () => { summary.replaceChildren(iconNode('music', 18), h('span', { style: { flex: '1' } }, val.id ? val.label : 'No music'), val.id ? sq('x', 'Remove music', () => { val.id = null; stop(); startRow.hidden = true; paintSummary(); }, 'small') : '', h('button', { className: 'ghost', type: 'button', onclick: toggle }, val.id ? 'Change' : 'Add music')); };
  const load = async () => {
    const lib = await api('/api/sounds').catch(() => []);
    list.replaceChildren(...lib.map((t) => h('div', { className: 'lib-row' }, iconNode('music', 18), h('span', { className: 'meta' }, h('b', {}, t.label || 'Track'), h('small', {}, fmtSize(t.size ?? 0))),
      sq('play', 'Preview', () => { stop(); preview = new Audio(`/files/${t.id}`); preview.currentTime = val.start || 0; preview.play().catch(() => {}); setTimeout(stop, 12000); }, 'small'),
      h('button', { className: 'primary small', type: 'button', onclick: () => { Object.assign(val, { id: t.id, label: t.label || 'Track' }); startRow.hidden = false; list.hidden = true; upBtn.hidden = true; stop(); paintSummary(); } }, 'Use'))),
      lib.length ? '' : h('p', { className: 'help' }, 'Your music library is empty. Upload a track (up to 10 MB, any length).'));
  };
  const upBtn = h('button', { className: 'ghost', type: 'button', onclick: () => pickFile('audio/*', async (f) => { try { await upload('sound', f, '', f.name); toast('Added to your library', { ic: 'check' }); load(); } catch (e) { fail(e); } }) }, 'Upload a track');
  function toggle() { list.hidden = !list.hidden; upBtn.hidden = list.hidden; if (!list.hidden) load(); }
  list.hidden = true; upBtn.hidden = true; paintSummary(); box.append(summary, startRow, list, upBtn);
  return { node: box, value: () => (val.id ? { id: val.id, start: val.start } : null), stop };
}
