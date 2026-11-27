// Sons curtos de interface e vibração. Desligados nas telas que escutam o microfone (para não virarem "notas" detectadas).
import { getCtx, getVolume } from '../music/audio.js';
import { load, save } from '../storage.js';

let on = load('pref.fx', true) !== false;
let micRoute = false;

export const fxEnabled = () => on;
export function setFxEnabled(v) {
  on = !!v;
  save('pref.fx', on);
}
/** Informa a aba atual: nas que usam o microfone, só vibração e as fanfarras de fim de sessão. */
export function setSfxRoute(name) { micRoute = ['cantar', 'instrumento', 'afinador'].includes(name); }

function tone(freq, at, dur, { type = 'sine', gain = 0.1, to = null } = {}) {
  const ctx = getCtx();
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const v = gain * Math.min(1, getVolume('inst'));
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

const SOUNDS = {
  ok: () => { tone(784, 0, 0.14, { gain: 0.09 }); tone(1175, 0.06, 0.18, { gain: 0.07 }); },
  perfect: () => { tone(784, 0, 0.12, { gain: 0.09 }); tone(988, 0.07, 0.12, { gain: 0.08 }); tone(1319, 0.14, 0.26, { gain: 0.08 }); },
  warn: () => tone(660, 0, 0.14, { type: 'triangle', gain: 0.07 }),
  err: () => tone(220, 0, 0.22, { type: 'triangle', gain: 0.09, to: 150 }),
  badge: () => { [988, 1319, 1568].forEach((f, i) => tone(f, i * 0.09, 0.22, { gain: 0.07 })); },
  level: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.1, 0.34, { gain: 0.08, type: 'triangle' })); },
};
// sons que podem tocar mesmo nas abas com microfone (acontecem quando a sessão já terminou)
const ALWAYS = new Set(['badge', 'level']);

const HAPTIC = { ok: 12, perfect: [10, 30, 16], warn: 8, err: [30, 40, 30], badge: [15, 40, 15], level: [20, 50, 20, 50, 40] };

export function sfx(kind) {
  if (!on) return;
  if ((!micRoute || ALWAYS.has(kind)) && SOUNDS[kind]) {
    try { SOUNDS[kind](); } catch { /* áudio indisponível: ignora */ }
  }
  try { navigator.vibrate?.(HAPTIC[kind] ?? 0); } catch { /* sem vibração */ }
}
