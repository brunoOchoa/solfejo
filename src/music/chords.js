// Acordes da escala (campo harmônico), progressões e formas para violão e teclado. Funções puras (testáveis).
import { degreePitch, tonicFor, SCALE_TYPES } from './scales.js';
import { midiOf, noteName } from './theory.js';

const mod12 = (n) => ((n % 12) + 12) % 12;
export const PC_NAMES = ['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si'];

// qualidade a partir dos intervalos (semitons) a partir da fundamental: [terça, quinta, sétima?]
const QUALITIES = {
  '4,7': 'maj', '3,7': 'min', '3,6': 'dim', '4,8': 'aug',
  '4,7,11': 'maj7', '4,7,10': '7', '3,7,10': 'm7', '3,6,10': 'm7b5', '3,6,9': 'dim7', '3,7,11': 'mMaj7', '4,8,11': 'aug7',
};
// sufixo da cifra, nome por extenso e numeral (maiúsculo = acorde maior)
const QINFO = {
  maj: { sym: '', word: 'maior', upper: true, rn: '' },
  min: { sym: 'm', word: 'menor', upper: false, rn: '' },
  dim: { sym: '°', word: 'diminuto', upper: false, rn: '°' },
  aug: { sym: '+', word: 'aumentado', upper: true, rn: '+' },
  maj7: { sym: '7M', word: 'com sétima maior', upper: true, rn: '7M' },
  7: { sym: '7', word: 'com sétima', upper: true, rn: '7' },
  m7: { sym: 'm7', word: 'menor com sétima', upper: false, rn: '7' },
  m7b5: { sym: 'm7(♭5)', word: 'meio-diminuto', upper: false, rn: 'ø' },
  dim7: { sym: '°7', word: 'diminuto com sétima', upper: false, rn: '°7' },
  mMaj7: { sym: 'm(7M)', word: 'menor com sétima maior', upper: false, rn: '7M' },
  aug7: { sym: '+7M', word: 'aumentado com sétima maior', upper: true, rn: '+7M' },
};
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** Progressões: graus da escala (0 = I). 'harm' é a escala harmonizada, que segue a direção escolhida. */
export const PROGRESSIONS = {
  harm: { label: 'Escala harmonizada (I a VII)', degrees: null },
  cadence: { label: 'Cadência I – IV – V – I', degrees: [0, 3, 4, 0] },
  pop: { label: 'Pop I – V – vi – IV', degrees: [0, 4, 5, 3] },
  fifties: { label: 'Anos 50 I – vi – IV – V', degrees: [0, 5, 3, 4] },
  sad: { label: 'vi – IV – I – V', degrees: [5, 3, 0, 4] },
  jazz: { label: 'ii – V – I', degrees: [1, 4, 0] },
  canon: { label: 'Cânone I – V – vi – iii – IV – I – IV – V', degrees: [0, 4, 5, 2, 3, 0, 3, 4] },
};

/** Graus tocados na escala harmonizada: subindo (I..VII + I), descendo ou os dois. */
export function harmonizedDegrees(direction = 'up') {
  const up = [0, 1, 2, 3, 4, 5, 6, 7];
  const down = [7, 6, 5, 4, 3, 2, 1, 0];
  if (direction === 'down') return down;
  if (direction === 'both') return [...up, ...down.slice(1)];
  return up;
}

/** Acorde do grau `deg` (0–7+) da escala: notas, qualidade, cifra e numeral. ext: 'triad' | 'seventh'. */
export function chordAt(tonic, type, deg, ext = 'triad') {
  const count = ext === 'seventh' ? 4 : 3;
  const notes = Array.from({ length: count }, (_, k) => degreePitch(tonic, type, deg + 2 * k));
  const m = notes.map(midiOf);
  const key = m.slice(1).map((x) => x - m[0]).join(',');
  const quality = QUALITIES[key] ?? 'maj';
  const q = QINFO[quality];
  const letter = ((deg % 7) + 7) % 7;
  const numeral = (q.upper ? ROMAN[letter] : ROMAN[letter].toLowerCase()) + q.rn;
  const root = notes[0];
  return {
    deg,
    roman: numeral,
    quality,
    notes,
    rootPc: mod12(m[0]),
    pcs: m.map(mod12),
    symbol: noteName(root, { system: 'cifra' }) + q.sym,
    name: `${noteName(root)} ${q.word}`,
    tones: notes.map((n) => noteName(n)),
  };
}

// ---- violão -----------------------------------------------------------------------------------
export const GUITAR = { midis: [40, 45, 50, 55, 59, 64], names: ['Mi', 'Lá', 'Ré', 'Sol', 'Si', 'Mi'] }; // grave → aguda

/**
 * Melhor forma de um acorde no braço: frets[6] (-1 = abafada, 0 = solta), grave → aguda.
 * 'open': formas abertas e primeiras casas; 'barre': formas móveis, sem cordas soltas (pestana).
 * Regras: o baixo é a fundamental, todas as notas do acorde aparecem, no máximo 4 dedos, sem corda abafada entre duas tocadas.
 */
export function guitarVoicing(pcs, rootPc, shape = 'open') {
  const set = new Set(pcs);
  let best = null;
  const maxBase = shape === 'barre' ? 11 : 4;
  for (let base = shape === 'barre' ? 1 : 0; base <= maxBase; base++) {
    const opts = GUITAR.midis.map((open) => {
      const o = [-1];
      if (shape !== 'barre' && base <= 3 && set.has(mod12(open))) o.push(0);
      for (let f = Math.max(1, base); f <= base + 3; f++) if (set.has(mod12(open + f))) o.push(f);
      return o;
    });
    const frets = [];
    const walk = (s) => {
      if (s === 6) {
        const v = scoreVoicing(frets, set, rootPc, shape);
        if (v && (!best || v.cost < best.cost)) best = { ...v, frets: [...frets] };
        return;
      }
      for (const f of opts[s]) { frets[s] = f; walk(s + 1); }
    };
    walk(0);
  }
  return best ? finishVoicing(best) : null;
}

function scoreVoicing(frets, set, rootPc, shape) {
  const played = frets.map((f, s) => (f >= 0 ? s : -1)).filter((s) => s >= 0);
  if (played.length < 4) return null;
  const first = played[0];
  const last = played[played.length - 1];
  for (let s = first; s <= last; s++) if (frets[s] < 0) return null; // sem corda abafada no meio
  if (mod12(GUITAR.midis[first] + frets[first]) !== rootPc) return null; // baixo = fundamental
  const pcsHeard = new Set(played.map((s) => mod12(GUITAR.midis[s] + frets[s])));
  if ([...set].some((p) => !pcsHeard.has(p))) return null;
  const fretted = played.filter((s) => frets[s] > 0);
  if (shape === 'barre' && played.length !== fretted.length) return null;
  if (!fretted.length) return null;
  const minF = Math.min(...fretted.map((s) => frets[s]));
  const maxF = Math.max(...fretted.map((s) => frets[s]));
  const barre = findBarre(frets);
  const fingers = fretted.length - (barre ? barre.count - 1 : 0);
  if (fingers > 4) return null;
  if (maxF - minF > 3) return null;
  const cost = 3.5 * (6 - played.length) + 3 * fingers + 1.6 * maxF + (barre ? 0.5 : 0) + (frets[0] < 0 && frets[1] < 0 ? 1 : 0);
  return { cost, barre };
}

/** Pestana: a casa mais baixa aparece em 2+ cordas (cobrindo 4 ou mais), e nenhuma corda entre elas é solta ou abafada nem tem casa menor. */
function findBarre(frets) {
  const fretted = frets.map((f, s) => (f > 0 ? s : -1)).filter((s) => s >= 0);
  if (fretted.length < 2) return null;
  const minF = Math.min(...fretted.map((s) => frets[s]));
  const at = fretted.filter((s) => frets[s] === minF);
  if (at.length < 2) return null;
  const from = at[0];
  const to = at[at.length - 1];
  if (to - from < 3) return null; // pestana de verdade cobre 4+ cordas; em 2–3 cordas cada uma leva um dedo
  for (let s = from; s <= to; s++) if (frets[s] < minF) return null; // solta (0) ou abafada (-1) entre elas
  return { fret: minF, from, to, count: at.length };
}

function finishVoicing(v) {
  const { frets } = v;
  const barre = findBarre(frets);
  const fingers = frets.map(() => 0);
  // dedos: a pestana é o 1; os demais sobem na ordem das casas (e das cordas)
  const rest = frets.map((f, s) => ({ f, s })).filter(({ f, s }) => f > 0 && !(barre && f === barre.fret && s >= barre.from && s <= barre.to));
  let next = barre ? Math.max(2, 5 - rest.length) : 1; // com pestana, os outros dedos ficam nos números mais altos (2–4, 3–4…)
  const byFret = [...rest].sort((a, b) => a.f - b.f || a.s - b.s);
  byFret.forEach((x) => { fingers[x.s] = Math.min(4, next++); });
  if (barre) for (let s = barre.from; s <= barre.to; s++) if (frets[s] === barre.fret) fingers[s] = 1; // só as cordas na casa da pestana
  const fretted = frets.filter((f) => f > 0);
  return {
    frets,
    fingers,
    barre,
    base: Math.min(...fretted),
    top: Math.max(...fretted),
    midis: frets.map((f, s) => (f >= 0 ? GUITAR.midis[s] + f : null)).filter((m) => m != null),
    text: frets.map((f) => (f < 0 ? 'x' : f)).join(' '),
  };
}

// ---- teclado ----------------------------------------------------------------------------------
/**
 * Notas (MIDI) de um acorde no teclado, da mais grave para a mais aguda. `prev` = notas do acorde anterior:
 * com `lead`, escolhe a inversão mais próxima dele (condução de vozes); senão, estado fundamental.
 * `bass` acrescenta a fundamental uma oitava abaixo do acorde, para a mão esquerda.
 */
export function pianoVoicing(chord, octave = 4, { prev = null, lead = true, bass = false } = {}) {
  const base = 12 * (octave + 1);
  const rootMidi = base + chord.rootPc;
  const ups = chord.notes.map((n) => mod12(midiOf(n) - chord.rootPc));
  const stack = ups.map((u) => rootMidi + u);
  let best = stack;
  if (lead && prev?.length) {
    const target = prev.reduce((a, b) => a + b, 0) / prev.length;
    let bestD = Infinity;
    for (let inv = 0; inv < stack.length; inv++) {
      for (const shift of [-12, 0, 12]) {
        const v = stack.map((m, i) => (i < inv ? m + 12 : m) + shift).sort((a, b) => a - b);
        const d = Math.abs(v.reduce((a, b) => a + b, 0) / v.length - target);
        if (d < bestD - 1e-9) { bestD = d; best = v; }
      }
    }
  }
  const out = [...best].sort((a, b) => a - b);
  if (bass) {
    let b = 12 * octave + chord.rootPc; // uma oitava abaixo de rootMidi
    while (b >= out[0] - 5) b -= 12;
    out.unshift(b);
  }
  return out;
}

/** Monta o exercício de acordes. */
export function buildChordExercise({
  keyN, type = 'major', prog = 'harm', direction = 'up', ext = 'triad', instr = 'piano', shape = 'open', octave = 4, bass = false, lead = true,
}) {
  const tonic = tonicFor(keyN, type, 4);
  const degrees = prog === 'harm' ? harmonizedDegrees(direction) : PROGRESSIONS[prog].degrees;
  let prev = null;
  const chords = degrees.map((deg) => {
    const c = chordAt(tonic, type, deg, ext);
    if (instr === 'guitar') c.voicing = guitarVoicing(c.pcs, c.rootPc, shape);
    else {
      c.midis = pianoVoicing(c, octave, { prev, lead, bass });
      prev = c.midis.filter((m) => !bass || m !== c.midis[0]);
    }
    return c;
  });
  const scaleNotes = Array.from({ length: 7 }, (_, i) => degreePitch(tonic, type, i));
  const scale = { pcs: scaleNotes.map((n) => mod12(midiOf(n))), names: Object.fromEntries(scaleNotes.map((n) => [mod12(midiOf(n)), noteName(n)])), tonicPc: mod12(midiOf(tonic)) };
  const tonicName = noteName(tonic);
  const scaleName = `${tonicName} ${SCALE_TYPES[type].label.toLowerCase()}`;
  return { chords, scale, keyN, type, tonic, title: prog === 'harm' ? `Escala harmonizada de ${scaleName}` : `${PROGRESSIONS[prog].label.split(' ')[0]} em ${scaleName}`, scaleName };
}

/**
 * Prática livre: alinha os acordes tocados (na ordem em que foram ouvidos) com os esperados. Acordes a mais ou fora de ordem
 * não atrapalham os que estão certos. Retorna results[i] (true = acorde esperado foi tocado) e extras (tocados que sobraram).
 */
export function alignSequence(expected, played) {
  const n = expected.length;
  const m = played.length;
  const D = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) D[i][0] = i;
  for (let j = 1; j <= m; j++) D[0][j] = j;
  const sub = (i, j) => (expected[i - 1] === played[j - 1] ? 0 : 1);
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) D[i][j] = Math.min(D[i - 1][j - 1] + sub(i, j), D[i - 1][j] + 1, D[i][j - 1] + 1);
  const results = new Array(n).fill(false);
  let used = 0;
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (D[i][j] === D[i - 1][j - 1] + sub(i, j)) { if (sub(i, j) === 0) { results[i - 1] = true; used++; } i--; j--; }
    else if (D[i][j] === D[i - 1][j] + 1) i--;
    else j--;
  }
  return { results, extras: m - used };
}
