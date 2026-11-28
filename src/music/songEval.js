// Avaliação de uma música tocada no tempo: cada nota tem a sua hora (compasso, tempo) e a sua duração; pausas não valem nota.
import { centsOff, TIMING, TIMING_RIGOR, GRADE_POINTS } from './instrument.js';

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * events: linha do tempo da música ({ idx, startBeat, beats, rest, midi }). onsets: notas detectadas ({ t (ms), midi }).
 * Cada nota aceita uma nota tocada perto da hora dela (startMs + startBeat × beatMs), escolhendo a mais próxima com a altura certa.
 * Notas: perfect | good | ok (certa, mas fora do tempo) | wrong (outra nota) | none (nada tocado).
 * results[idx] = { grade, cents, deltaMs, played } ou null (pausa, ou ainda não avaliada: upTo).
 */
export function evaluateSong({
  events, onsets, startMs, beatMs, tolCents = 40, anyOctave = false, rigor = 'normal', offsetMs = 0, upTo = Infinity, extraMs = 0,
}) {
  const scale = TIMING_RIGOR[rigor] || 1;
  const used = new Set();
  const results = events.map(() => null);
  let lastStart = startMs;
  let lastEnd = startMs;
  events.forEach((e) => {
    if (e.rest) return;
    if (e.idx > upTo) return;
    const T = startMs + e.startBeat * beatMs;
    const slot = e.beats * beatMs;
    const half = Math.max(110, Math.min(slot, beatMs) * 0.5); // janela: meia nota (nunca menos de 110 ms)
    lastStart = Math.min(lastStart, T);
    lastEnd = Math.max(lastEnd, T + slot);
    const cand = [];
    onsets.forEach((o, k) => {
      const t = o.t - offsetMs;
      if (!used.has(k) && t >= T - half && t < T + half) cand.push({ o, k, t });
    });
    if (!cand.length) { results[e.idx] = { grade: 'none', cents: null, deltaMs: null, played: null }; return; }
    const hits = cand.filter(({ o }) => Math.abs(centsOff(o.midi, e.midi, anyOctave)) <= tolCents).sort((a, b) => Math.abs(a.t - T) - Math.abs(b.t - T));
    if (!hits.length) {
      const c0 = cand.sort((a, b) => Math.abs(a.t - T) - Math.abs(b.t - T))[0];
      used.add(c0.k);
      results[e.idx] = {
        grade: 'wrong', cents: centsOff(c0.o.midi, e.midi, anyOctave), deltaMs: c0.t - T, played: c0.o.midi,
      };
      return;
    }
    const h = hits[0];
    used.add(h.k);
    const delta = h.t - T;
    const a = Math.abs(delta);
    const tPerfect = Math.min(TIMING.perfect, slot * 0.22) * scale + extraMs;
    const tGood = Math.min(TIMING.good, slot * 0.4) * scale + extraMs;
    results[e.idx] = {
      grade: a <= tPerfect ? 'perfect' : a <= tGood ? 'good' : 'ok', cents: centsOff(h.o.midi, e.midi, anyOctave), deltaMs: delta, played: h.o.midi,
    };
  });
  const done = results.filter(Boolean);
  const score = done.length ? done.reduce((s, r) => s + GRADE_POINTS[r.grade], 0) / done.length : 0;
  const matched = done.filter((r) => r.deltaMs !== null && r.grade !== 'wrong');
  const extra = onsets.filter((o, k) => !used.has(k) && o.t - offsetMs >= lastStart - 150 && o.t - offsetMs < lastEnd + 150).length;
  return {
    results, score, extra, medianDelta: matched.length ? median(matched.map((r) => r.deltaMs)) : 0, matched: matched.length,
  };
}

/** Estrelas da música: 3 a partir de 90% (e poucas notas erradas), 2 a partir de 70%, 1 a partir de 40%. */
export const starsFor = (score) => (score >= 0.9 ? 3 : score >= 0.7 ? 2 : score >= 0.4 ? 1 : 0);
