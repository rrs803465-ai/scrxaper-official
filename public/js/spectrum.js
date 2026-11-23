import { h } from './ui.js';
import { getAnalyser } from './audio.js';

export const SPECTRUM_STYLES = [['bars', 'Equalizer'], ['radial', 'Halo'], ['cd', 'Spinning CD'], ['wave', 'Wave ring'], ['pulse', 'Pulse'], ['orbit', 'Orbit']];
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

/* Draws a beat-reactive spectrum around an avatar. `feed(freq, time)` fills two Uint8Arrays; when omitted the shared audio analyser is used. */
export function mountSpectrum(host, { style = 'bars', color = '#b7c9e6', avatar, size = 300, feed, still = false } = {}) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const canvas = h('canvas', { className: 'spec-canvas', width: size * dpr, height: size * dpr });
  canvas.style.setProperty('width', `${size}px`); canvas.style.setProperty('height', `${size}px`);
  const face = h('div', { className: 'spec-face' }, avatar);
  const faceSize = size * 0.44;
  face.style.setProperty('width', `${faceSize}px`); face.style.setProperty('height', `${faceSize}px`);
  host.replaceChildren(canvas, face);
  host.classList.add('spec'); host.style.setProperty('width', `${size}px`); host.style.setProperty('height', `${size}px`);
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const analyser = feed ? null : (() => { try { return getAnalyser(); } catch { return null; } })();
  const freq = new Uint8Array(analyser ? analyser.frequencyBinCount : 128); const time = new Uint8Array(analyser ? analyser.fftSize : 256);
  let cfg = { style, color }; let raf = 0; let angle = 0; let avg = 0; const rings = []; let beatCool = 0; const t0 = performance.now();
  const cx = size / 2; const R = faceSize / 2;
  const reduced = () => document.documentElement.dataset.motion === 'reduced';

  const bandsOf = (n) => { const out = new Array(n); const usable = Math.floor(freq.length * 0.7); for (let i = 0; i < n; i++) { const a = Math.floor((i / n) ** 1.5 * usable); const b = Math.max(a + 1, Math.floor(((i + 1) / n) ** 1.5 * usable)); let s = 0; for (let k = a; k < b; k++) s += freq[k]; out[i] = s / (b - a) / 255; } return out; };

  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    if (feed) feed(freq, time, (now - t0) / 1000); else if (analyser) { analyser.getByteFrequencyData(freq); analyser.getByteTimeDomainData(time); }
    const bass = (freq[1] + freq[2] + freq[3] + freq[4]) / (4 * 255);
    avg = avg * 0.94 + bass * 0.06;
    const beat = bass > avg * 1.25 && bass > 0.35 && beatCool <= 0;
    beatCool -= 1; if (beat) beatCool = 8;
    ctx.clearRect(0, 0, size, size);
    ctx.lineCap = 'round';
    const col = cfg.color;
    if (cfg.style === 'bars') {
      const n = 26; const b = bandsOf(n); const gap = size / (n * 2 + 2); const bw = gap * 0.62;
      for (let i = 0; i < n; i++) for (const side of [-1, 1]) {
        const x = cx + side * (R * 0.55 + i * gap + gap) ; const hgt = Math.max(3, b[i] * size * 0.34 + 3);
        ctx.fillStyle = rgba(col, 0.35 + b[i] * 0.65); ctx.beginPath(); ctx.roundRect(x - bw / 2, cx - hgt / 2, bw, hgt, bw / 2); ctx.fill();
      }
    } else if (cfg.style === 'radial') {
      const n = 72; const b = bandsOf(36);
      ctx.lineWidth = Math.max(2, size * 0.011);
      for (let i = 0; i < n; i++) {
        const v = b[i < 36 ? i : 71 - i]; const a = (i / n) * Math.PI * 2 - Math.PI / 2; const r0 = R + 8; const r1 = r0 + 4 + v * (cx - r0 - 6);
        ctx.strokeStyle = rgba(col, 0.4 + v * 0.6); ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cx + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cx + Math.sin(a) * r1); ctx.stroke();
      }
    } else if (cfg.style === 'cd') {
      if (!reduced() && !still) angle += 0.012 + bass * 0.09; else if (still) angle += 0.008;
      const D = R * 1.58;
      const g = ctx.createRadialGradient(cx, cx, R, cx, cx, D); g.addColorStop(0, '#1b1f27'); g.addColorStop(1, '#0a0c10');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cx, D, 0, 7); ctx.fill();
      for (let r = R + 6; r < D; r += 5) { ctx.strokeStyle = `rgba(255,255,255,${0.04 + (r % 3) * 0.01})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cx, r, 0, 7); ctx.stroke(); }
      if (ctx.createConicGradient) { const cg = ctx.createConicGradient(angle, cx, cx); cg.addColorStop(0, rgba(col, 0.0)); cg.addColorStop(0.12, rgba(col, 0.38 + bass * 0.4)); cg.addColorStop(0.25, rgba(col, 0)); cg.addColorStop(0.5, rgba(col, 0)); cg.addColorStop(0.62, rgba(col, 0.3 + bass * 0.4)); cg.addColorStop(0.75, rgba(col, 0)); cg.addColorStop(1, rgba(col, 0)); ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cx, D, 0, 7); ctx.arc(cx, cx, R + 2, 0, 7, true); ctx.fill('evenodd'); }
      ctx.strokeStyle = rgba(col, 0.55 + bass * 0.45); ctx.lineWidth = 2 + bass * 4; ctx.shadowColor = col; ctx.shadowBlur = 8 + bass * 22; ctx.beginPath(); ctx.arc(cx, cx, D, 0, 7); ctx.stroke(); ctx.shadowBlur = 0;
      face.style.setProperty('transform', `rotate(${angle}rad)`);
    } else if (cfg.style === 'wave') {
      for (const [k, alpha, off] of [[1, 1, 0], [0.6, 0.35, 6]]) {
        ctx.strokeStyle = rgba(col, alpha); ctx.lineWidth = k === 1 ? 3 : 2; ctx.shadowColor = col; ctx.shadowBlur = k === 1 ? 14 : 0; ctx.beginPath();
        const n = 120;
        for (let i = 0; i <= n; i++) { const idx = Math.floor((i % n) / n * (time.length - 1)); const v = (time[idx] - 128) / 128; const a = (i / n) * Math.PI * 2; const r = R + 16 + off + v * R * 0.55 * (0.6 + bass); const x = cx + Math.cos(a) * r; const y = cx + Math.sin(a) * r; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
        ctx.closePath(); ctx.stroke();
      }
      ctx.shadowBlur = 0;
    } else if (cfg.style === 'pulse') {
      if (beat || (still && (now | 0) % 900 < 20)) rings.push({ r: R + 4, a: 0.9 });
      for (let i = rings.length - 1; i >= 0; i--) { const rg = rings[i]; rg.r += 1.6 + bass * 3; rg.a -= 0.012; if (rg.a <= 0 || rg.r > cx) { rings.splice(i, 1); continue; } ctx.strokeStyle = rgba(col, rg.a); ctx.lineWidth = 2 + rg.a * 5; ctx.beginPath(); ctx.arc(cx, cx, rg.r, 0, 7); ctx.stroke(); }
      ctx.strokeStyle = rgba(col, 0.5 + bass * 0.5); ctx.lineWidth = 3 + bass * 8; ctx.shadowColor = col; ctx.shadowBlur = 10 + bass * 24; ctx.beginPath(); ctx.arc(cx, cx, R + 6 + bass * 8, 0, 7); ctx.stroke(); ctx.shadowBlur = 0;
    } else if (cfg.style === 'orbit') {
      angle += reduced() ? 0 : 0.01 + bass * 0.04; const b = bandsOf(24);
      [[R + 14, 8, 1], [R + 32, 12, -1.4], [R + 50, 16, 0.8]].forEach(([r, n, sp], ring) => {
        for (let i = 0; i < n; i++) { const v = b[(ring * 7 + i) % 24]; const a = angle * sp + (i / n) * Math.PI * 2; const rr = r + v * 10; ctx.fillStyle = rgba(col, 0.45 + v * 0.55); ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rr, cx + Math.sin(a) * rr, 2.5 + v * 6, 0, 7); ctx.fill(); }
        ctx.strokeStyle = rgba(col, 0.1); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cx, r, 0, 7); ctx.stroke();
      });
    }
    if (cfg.style !== 'cd') face.style.setProperty('transform', `scale(${1 + bass * 0.05})`);
  };
  raf = requestAnimationFrame(frame);
  return { stop: () => cancelAnimationFrame(raf), set: (next) => { cfg = { ...cfg, ...next }; if (next.style && next.style !== 'cd') face.style.setProperty('transform', 'none'); } };
}

/* fake music-like data for previews and the landing page */
export const demoFeed = (freq, time, t) => {
  const beatPhase = (t * 2) % 1; const kick = Math.max(0, 1 - beatPhase * 4);
  for (let i = 0; i < freq.length; i++) { const lo = 1 - i / freq.length; freq[i] = Math.max(0, Math.min(255, 255 * (0.12 + lo * (0.35 + kick * 0.55) * (0.7 + 0.3 * Math.sin(t * 6 + i * 0.7)) + 0.1 * Math.sin(t * 3 + i)))); }
  for (let i = 0; i < time.length; i++) time[i] = 128 + 60 * Math.sin(t * 9 + i * 0.35) * (0.4 + kick);
};
