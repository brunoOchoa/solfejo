// Teoria musical em Dó fixo (padrão brasileiro).
// Um "pitch" é { step, acc }:
//   step = oitava * 7 + índice da letra (C4 = 28)
//   acc  = alteração em semitons (-1 bemol, 0 natural, 1 sustenido)

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
export const SOLFEGE = ['Dó', 'Ré', 'Mi', 'Fá', 'Sol', 'Lá', 'Si'];
const SEMITONES = [0, 2, 4, 5, 7, 9, 11];

export const ACC_SYMBOL = { '-2': '𝄫', '-1': '♭', '0': '', '1': '♯', '2': '𝄪' };
const ACC_VEX = { '-2': 'bb', '-1': 'b', '0': '', '1': '#', '2': '##' };
const ACC_CIFRA = { '-2': 'bb', '-1': 'b', '0': '', '1': '#', '2': '##' };

export const letterOf = (step) => ((step % 7) + 7) % 7;
export const octaveOf = (step) => Math.floor(step / 7);

export function midiOf({ step, acc }) {
  return 12 * (octaveOf(step) + 1) + SEMITONES[letterOf(step)] + acc;
}

export function frequencyOf(pitch) {
  return 440 * Math.pow(2, (midiOf(pitch) - 69) / 12);
}

/** Nome da nota. system: 'solfejo' (Dó, Ré…) ou 'cifra' (C, D…). */
export function noteName(pitch, { system = 'solfejo', octave = false } = {}) {
  const l = letterOf(pitch.step);
  const base = system === 'cifra' ? LETTERS[l] + ACC_CIFRA[pitch.acc] : SOLFEGE[l] + ACC_SYMBOL[pitch.acc];
  return octave ? `${base}${octaveOf(pitch.step)}` : base;
}

/** Chave no formato do VexFlow, ex.: 'f#/4'. */
export function vexKey(pitch) {
  return `${LETTERS[letterOf(pitch.step)].toLowerCase()}${ACC_VEX[pitch.acc]}/${octaveOf(pitch.step)}`;
}

// ---- Armaduras de clave -------------------------------------------------
// n > 0: n sustenidos; n < 0: |n| bemóis.
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // Fá Dó Sol Ré Lá Mi Si
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]; // Si Mi Lá Ré Sol Dó Fá

const VEX_KEYS = {
  0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B',
  '-1': 'F', '-2': 'Bb', '-3': 'Eb', '-4': 'Ab', '-5': 'Db',
};

const KEY_LABELS = {
  0: 'Dó maior / Lá menor',
  1: 'Sol maior / Mi menor',
  2: 'Ré maior / Si menor',
  3: 'Lá maior / Fá♯ menor',
  4: 'Mi maior / Dó♯ menor',
  5: 'Si maior / Sol♯ menor',
  '-1': 'Fá maior / Ré menor',
  '-2': 'Si♭ maior / Sol menor',
  '-3': 'Mi♭ maior / Dó menor',
  '-4': 'Lá♭ maior / Fá menor',
  '-5': 'Ré♭ maior / Si♭ menor',
};

export const MAX_ACCIDENTALS = 5;
export const vexKeySignature = (n) => VEX_KEYS[n];
export const keyLabel = (n) => KEY_LABELS[n];

/** Mapa letra -> alteração imposta pela armadura. */
export function keyAccidentals(n) {
  const map = [0, 0, 0, 0, 0, 0, 0];
  if (n > 0) for (let i = 0; i < n; i++) map[SHARP_ORDER[i]] = 1;
  if (n < 0) for (let i = 0; i < -n; i++) map[FLAT_ORDER[i]] = -1;
  return map;
}

// ---- Claves e extensões -------------------------------------------------
// Passos (steps) cobertos por clave. "basic" fica dentro da pauta (com uma
// linha suplementar de folga); "extended" abre para várias linhas suplementares.
export const CLEFS = {
  treble: { label: 'Clave de Sol', vex: 'treble', basic: [30, 38], extended: [26, 42] }, // E4–F5 | A3–C6
  bass: { label: 'Clave de Fá', vex: 'bass', basic: [18, 26], extended: [14, 30] }, // G2–A3 | C2–E4
};

/** Sorteia uma nota. `rand` é injetável para testes. */
export function randomPitch({ clef, range, keyAcc, chromaticChance = 0, avoid = null, rand = Math.random }) {
  const [lo, hi] = CLEFS[clef][range];
  let pitch;
  let guard = 0;
  do {
    const step = lo + Math.floor(rand() * (hi - lo + 1));
    let acc = keyAcc[letterOf(step)];
    if (rand() < chromaticChance) {
      const options = [-1, 0, 1].filter((a) => a !== acc);
      acc = options[Math.floor(rand() * options.length)];
    }
    pitch = { step, acc };
    guard++;
  } while (avoid && guard < 20 && avoid.step === pitch.step && avoid.acc === pitch.acc);
  return pitch;
}

const PITCH_CLASSES = ['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si'];
/** Nome (Dó fixo, sem oitava) de um número MIDI, usando sustenidos. */
export const pitchClassName = (midi) => PITCH_CLASSES[((Math.round(midi) % 12) + 12) % 12];

/** Sobe/desce oitavas (octaves pode ser negativo) mantendo o nome da nota. */
export const transpose = (pitch, octaves) => ({ step: pitch.step + 7 * octaves, acc: pitch.acc });

export const samePitch = (a, b) => a.step === b.step && a.acc === b.acc;
