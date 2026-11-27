// Melodias para solfejo cantado: geração e avaliação do que foi cantado.
import { keyAccidentals, letterOf, frequencyOf, midiOf, pitchClassName } from './theory.js';
import { centsBetween } from './pitch.js';
import { POINTS } from './rhythm.js';

// Letra da tônica (maior) por armadura.
const TONIC_LETTER = { 0: 0, 1: 4, 2: 1, 3: 5, 4: 2, 5: 6, '-1': 3, '-2': 6, '-3': 2, '-4': 5, '-5': 1 };

export const MELODY_LEVELS = {
  1: 'Nível 1 — graus conjuntos',
  2: 'Nível 2 — + saltos de terça',
  3: 'Nível 3 — + saltos de quarta e quinta',
};

const MOVES = {
  1: [[-1, 4], [1, 4], [0, 1]],
  2: [[-1, 4], [1, 4], [-2, 2], [2, 2], [0, 1]],
  3: [[-1, 4], [1, 4], [-2, 2], [2, 2], [-3, 1], [3, 1], [-4, 1], [4, 1], [0, 1]],
};

function weighted(list, rand) {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of list) {
    r -= w;
    if (r < 0) return v;
  }
  return list[0][0];
}

/** Gera uma melodia diatônica em tom maior; começa e termina na tônica. */
export function generateMelody({ keyN = 0, level = 1, length = 8, rand = Math.random }) {
  const keyAcc = keyAccidentals(keyN);
  const tonicStep = 28 + TONIC_LETTER[keyN]; // oitava 4
  const toPitch = (d) => {
    const step = tonicStep + d;
    return { step, acc: keyAcc[letterOf(step)] };
  };
  const degrees = [0];
  while (degrees.length < length - 1) {
    const prev = degrees[degrees.length - 1];
    let d;
    let guard = 0;
    do {
      d = prev + weighted(MOVES[level], rand);
      guard++;
    } while (
      guard < 30
      && (d < -2 || d > 7 || (degrees.length >= 2 && d === prev && degrees[degrees.length - 2] === prev))
    );
    if (d < -2 || d > 7) d = prev;
    degrees.push(d);
  }
  const last = degrees[degrees.length - 1];
  degrees.push(Math.abs(last) <= Math.abs(last - 7) ? 0 : 7);
  return { keyN, tonic: toPitch(0), notes: degrees.map(toPitch) };
}

/** Sorteia uma única nota da escala do tom (de dois graus abaixo da tônica até a oitava acima). */
export function generateNote({ keyN = 0, chromatic = false, avoid = null, rand = Math.random }) {
  const keyAcc = keyAccidentals(keyN);
  const tonicStep = 28 + TONIC_LETTER[keyN];
  let pitch;
  let guard = 0;
  do {
    const step = tonicStep - 2 + Math.floor(rand() * 10); // graus -2..7
    let acc = keyAcc[letterOf(step)];
    if (chromatic && rand() < 0.35) {
      const alts = [-1, 0, 1].filter((a) => a !== acc);
      acc = alts[Math.floor(rand() * alts.length)];
    }
    pitch = { step, acc };
    guard++;
  } while (avoid && guard < 20 && midiOf(pitch) === midiOf(avoid));
  return pitch;
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Reduz um desvio em cents ao intervalo [-600, 600) (equivalência de oitava). */
export const foldCents = (c) => ((((c + 600) % 1200) + 1200) % 1200) - 600;

/**
 * Compara o que foi cantado com a melodia.
 * frames: [{t, freq, clarity}] com t em ms (mesma base de startMs)
 * startMs: instante da primeira nota; beatMs: duração de cada nota
 */
export function evaluateSung({ notes, frames, startMs, beatMs, anyOctave = true }) {
  const results = notes.map((pitch, i) => {
    const from = startMs + i * beatMs + beatMs * 0.3;
    const to = startMs + (i + 1) * beatMs - beatMs * 0.05;
    const target = frequencyOf(pitch);
    const cents = frames
      .filter((f) => f.freq && f.clarity > 0.75 && f.t >= from && f.t <= to)
      .map((f) => {
        const c = centsBetween(f.freq, target);
        return anyOctave ? foldCents(c) : c;
      });
    if (cents.length < 3) return { grade: 'miss', cents: null, sung: null, voiced: cents.length };
    const m = median(cents);
    const abs = Math.abs(m);
    const grade = abs <= 20 ? 'perfect' : abs <= 40 ? 'good' : abs <= 70 ? 'ok' : 'miss';
    return { grade, cents: m, sung: pitchClassName(midiOf(pitch) + Math.round(m / 100)), voiced: cents.length };
  });
  const score = notes.length ? results.reduce((s, r) => s + POINTS[r.grade], 0) / notes.length : 0;
  // Tendência só com notas "quase certas": uma nota errada não deve distorcer a média.
  const measured = results.filter((r) => r.grade !== 'miss').map((r) => r.cents);
  const meanCents = measured.length ? measured.reduce((a, b) => a + b, 0) / measured.length : 0;
  return { results, score, meanCents };
}
