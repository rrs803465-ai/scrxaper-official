import { state } from './ui.js';

let ctx; let master; let analyser;
export function engine() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    master.connect(analyser);
    analyser.connect(ctx.destination);
  }
  ctx.resume?.();
  return { ctx, master, analyser };
}
export const getAnalyser = () => engine().analyser;

// [frequency, start, duration] (duration defaults to 0.28 s)
export const NOTES = {
  chime: [[880, 0], [1318, 0.13]], drop: [[660, 0], [440, 0.11]], pluck: [[523, 0], [659, 0.09], [784, 0.18]],
  ring: [[880, 0, 0.18], [660, 0.2, 0.18], [880, 0.6, 0.18], [660, 0.8, 0.18]], soft: [[523, 0, 0.3], [392, 0.25, 0.4]], pulse: [[740, 0], [740, 0.18], [740, 0.36]],
  ringback: [[440, 0, 1.0], [480, 0, 1.0]], dial: [[523, 0, 0.2], [659, 0.2, 0.2], [784, 0.4, 0.2], [659, 0.6, 0.2], [523, 0.8, 0.3]],
};
const LOOP_MS = { ring: 2000, soft: 2200, pulse: 1800, ringback: 3200, dial: 2400, chime: 2400, drop: 2400, pluck: 2400 };
export const BUILTIN_TONES = [['chime', 'Chime'], ['drop', 'Drop'], ['pluck', 'Pluck'], ['ring', 'Classic ring'], ['soft', 'Soft ring'], ['pulse', 'Pulse'], ['ringback', 'Ringback'], ['dial', 'Melody'], ['none', 'Silent']];

export function playTone(name, volume) {
  const notes = NOTES[name];
  if (!notes || !volume || typeof AudioContext === 'undefined') return;
  try {
    const { ctx: c, master: m } = engine();
    for (const [freq, at, dur = 0.28] of notes) {
      const osc = c.createOscillator(); const gain = c.createGain(); const t = c.currentTime + at;
      osc.type = name === 'ringback' ? 'sine' : 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(Math.max((volume / 100) * 0.28, 0.0002), t + 0.03);
      gain.gain.setValueAtTime(Math.max((volume / 100) * 0.28, 0.0002), t + Math.max(dur - 0.06, 0.04));
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.04);
      osc.connect(gain).connect(m);
      osc.start(t); osc.stop(t + dur + 0.06);
    }
  } catch { /* browsers refuse audio until the person has interacted with the page */ }
}

/* play a tone name or custom:<id>; returns a stop function. Loops when asked. */
export function playSound(value, volume, loop = false) {
  const v = String(value ?? 'none');
  if (v === 'none') return () => {};
  if (v.startsWith('custom:')) {
    try {
      const { ctx: c, master: m } = engine();
      const audio = new Audio(`/files/${v.slice(7)}`);
      audio.loop = loop; audio.volume = Math.min(Math.max(volume / 100, 0), 1);
      c.createMediaElementSource(audio).connect(m);
      audio.play().catch(() => {});
      return () => { audio.pause(); audio.src = ''; };
    } catch { return () => {}; }
  }
  playTone(v, volume);
  if (!loop) return () => {};
  const timer = setInterval(() => playTone(v, volume), LOOP_MS[v] ?? 2000);
  return () => clearInterval(timer);
}

/* play an arbitrary URL through the analyser (music preview, shared tracks) */
export function playUrl(url, volume = 80, start = 0) {
  const audio = new Audio(url);
  audio.volume = Math.min(Math.max(volume / 100, 0), 1);
  audio.currentTime = start || 0;
  audio.play().catch(() => {});
  return audio;
}

export function messagePing(kind, target) {
  const s = state.sound;
  if (!s || state.privacy?.dnd || state.mutes?.has(`${kind}:${target}`)) return;
  const own = s.overrides?.find((o) => o.kind === kind && String(o.target) === String(target));
  playSound(own?.tone ?? s.tone, s.volume);
}
