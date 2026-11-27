// Escalas e padrões de estudo (escalas, terças, quintas, arpejos) em Dó fixo.
import { midiOf, keyAccidentals, noteName } from './theory.js';

export const SCALE_TYPES = {
  major: { label: 'Maior', semis: [0, 2, 4, 5, 7, 9, 11] },
  minor: { label: 'Menor natural', semis: [0, 2, 3, 5, 7, 8, 10] },
  harmonic: { label: 'Menor harmônica', semis: [0, 2, 3, 5, 7, 8, 11] },
  melodic: { label: 'Menor melódica', semis: [0, 2, 3, 5, 7, 9, 11], descSemis: [0, 2, 3, 5, 7, 8, 10] },
};

// Tônica maior de cada armadura: [índice da letra (Dó=0…Si=6), alteração]
const MAJOR_TONIC = {
  0: [0, 0], 1: [4, 0], 2: [1, 0], 3: [5, 0], 4: [2, 0], 5: [6, 0],
  '-1': [3, 0], '-2': [6, -1], '-3': [2, -1], '-4': [5, -1], '-5': [1, -1],
};

/** Tônica para uma armadura e um tipo de escala, na oitava indicada. */
export function tonicFor(keyN, type, octave = 4) {
  const [letter, acc] = MAJOR_TONIC[keyN];
  if (type === 'major') return { step: octave * 7 + letter, acc };
  const l = (letter + 5) % 7; // sexto grau = relativa menor
  return { step: octave * 7 + l, acc: keyAccidentals(keyN)[l] };
}

/** Nota do grau i (0 = tônica; 7 = tônica uma oitava acima). dir: 'up' | 'down'. */
export function degreePitch(tonic, type, i, dir = 'up') {
  const t = SCALE_TYPES[type];
  const semis = dir === 'down' && t.descSemis ? t.descSemis : t.semis;
  const oct = Math.floor(i / 7);
  const d = ((i % 7) + 7) % 7;
  const step = tonic.step + i;
  return { step, acc: midiOf(tonic) + 12 * oct + semis[d] - midiOf({ step, acc: 0 }) };
}

const range = (a, b) => (a <= b
  ? Array.from({ length: b - a + 1 }, (_, k) => a + k)
  : Array.from({ length: a - b + 1 }, (_, k) => a - k));

const pairs = (from, to, gap) => {
  const out = [];
  if (from <= to) for (let i = from; i <= to; i++) out.push(i, i + gap);
  else for (let i = from; i >= to; i--) out.push(i, i - gap);
  return out;
};

/** Padrões: graus tocados na subida (`up`) e na descida (`down`) para `top` graus acima da tônica. */
export const PATTERNS = {
  scale: { label: 'Escala (grau a grau)', up: (top) => range(0, top), down: (top) => range(top, 0) },
  thirds: { label: 'Em terças', up: (top) => pairs(0, top - 2, 2), down: (top) => pairs(top, 2, 2) },
  fifths: { label: 'Em quintas', up: (top) => pairs(0, top - 4, 4), down: (top) => pairs(top, 4, 4) },
  arpeggio: {
    label: 'Arpejo da tríade',
    up: (top) => { const o = []; for (let b = 0; b < top; b += 7) o.push(b, b + 2, b + 4); o.push(top); return o; },
    down: (top) => { const o = [top]; for (let b = top - 7; b >= 0; b -= 7) o.push(b + 4, b + 2, b); return o; },
  },
};

export const DIRECTIONS = { up: 'Subindo', down: 'Descendo', both: 'Subindo e descendo' };

/**
 * Monta o exercício (notas escritas). `range` = [passo mínimo, passo máximo] do instrumento:
 * se a escala não couber, ela é deslocada por oitavas inteiras.
 */
export function buildExercise({
  keyN, type, pattern = 'scale', direction = 'up', octaves = 1, octave = 4, range: rng = null,
}) {
  const top = 7 * octaves;
  const pat = PATTERNS[pattern];
  const seq = [];
  const push = (degrees, dir) => {
    degrees.forEach((i, k) => {
      // não repete a nota de emenda entre a subida e a descida
      if (k === 0 && seq.length && seq[seq.length - 1].i === i) return;
      seq.push({ i, dir });
    });
  };
  if (direction !== 'down') push(pat.up(top), 'up');
  if (direction !== 'up') push(pat.down(top), 'down');

  let tonic = tonicFor(keyN, type, octave);
  const build = (t) => seq.map(({ i, dir }) => degreePitch(t, type, i, dir));
  let notes = build(tonic);
  if (rng) {
    const lo = () => Math.min(...notes.map((n) => n.step));
    const hi = () => Math.max(...notes.map((n) => n.step));
    for (let g = 0; g < 4 && lo() < rng[0]; g++) { tonic = { ...tonic, step: tonic.step + 7 }; notes = build(tonic); }
    for (let g = 0; g < 4 && hi() > rng[1]; g++) { tonic = { ...tonic, step: tonic.step - 7 }; notes = build(tonic); }
  }
  return { notes, tonic, keyN, type, name: `${noteName(tonic)} ${SCALE_TYPES[type].label.toLowerCase()}` };
}
