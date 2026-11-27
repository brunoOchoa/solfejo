// Afinador: cordas dos instrumentos, desvio em cents e estabilização da leitura. Funções puras (testáveis).
import { pitchClassName } from './theory.js';

/**
 * Afinações (alturas que SOAM, em MIDI). Violão: Mi2 Lá2 Ré3 Sol3 Si3 Mi4 (cordas 6 → 1).
 * Teclado: cromático (sem cordas).
 */
export const TUNERS = {
  piano: { label: 'Teclado', icon: '🎹', chromatic: true, mic: { minFreq: 40, maxFreq: 2200 } },
  violin: {
    label: 'Violino', icon: '🎻', mic: { minFreq: 150, maxFreq: 1500 },
    tunings: { standard: { label: 'Padrão (Sol Ré Lá Mi)', midis: [55, 62, 69, 76] } },
  },
  guitar: {
    label: 'Violão', icon: '🎸', mic: { minFreq: 60, maxFreq: 700 },
    tunings: {
      standard: { label: 'Padrão (Mi Lá Ré Sol Si Mi)', midis: [40, 45, 50, 55, 59, 64] },
      dropd: { label: 'Ré na 6ª (Drop D)', midis: [38, 45, 50, 55, 59, 64] },
      half: { label: 'Meio tom abaixo', midis: [39, 44, 49, 54, 58, 63] },
      dadgad: { label: 'DADGAD (Ré Lá Ré Sol Lá Ré)', midis: [38, 45, 50, 55, 57, 62] },
      openg: { label: 'Sol aberto (Ré Sol Ré Sol Si Ré)', midis: [38, 43, 50, 55, 59, 62] },
    },
  },
};

export const freqOfMidi = (midi, refA = 440) => refA * 2 ** ((midi - 69) / 12);
export const centsTo = (freq, midi, refA = 440) => 1200 * Math.log2(freq / freqOfMidi(midi, refA));
export const midiFloat = (freq, refA = 440) => 69 + 12 * Math.log2(freq / refA);
export const octaveNumber = (midi) => Math.floor(midi / 12) - 1;
export const noteLabel = (midi) => pitchClassName(midi);
export const noteLabelOct = (midi) => `${pitchClassName(midi)}${octaveNumber(midi)}`;

/** Lista de cordas: { midi, num } com num = número da corda (1 = mais aguda), na ordem grave → aguda. */
export function stringsOf(instr, tuning) {
  const t = TUNERS[instr]?.tunings;
  if (!t) return [];
  const midis = (t[tuning] || Object.values(t)[0]).midis;
  return midis.map((midi, i) => ({ midi, num: midis.length - i }));
}

/** Corda mais próxima (em cents) de freq. */
export function nearestString(freq, midis, refA = 440) {
  let best = { index: 0, cents: Infinity };
  midis.forEach((m, index) => {
    const c = centsTo(freq, m, refA);
    if (Math.abs(c) < Math.abs(best.cents)) best = { index, cents: c };
  });
  return best;
}

/** Nota mais próxima no modo cromático. */
export function nearestNote(freq, refA = 440) {
  const midi = Math.round(midiFloat(freq, refA));
  return { midi, cents: centsTo(freq, midi, refA) };
}

/** Mediana das últimas leituras (descarta picos isolados); esquece tudo após uma pausa. */
export class FreqSmoother {
  constructor({ size = 5, gapMs = 300 } = {}) {
    Object.assign(this, { size, gapMs });
    this.reset();
  }

  reset() { this.buf = []; this.lastT = -Infinity; }

  push(t, freq) {
    if (t - this.lastT > this.gapMs) this.buf = [];
    this.lastT = t;
    this.buf.push(freq);
    if (this.buf.length > this.size) this.buf.shift();
    const s = [...this.buf].sort((a, b) => a - b);
    return s[s.length >> 1];
  }
}

/** Troca de corda só depois de `need` leituras seguidas apontando para outra (evita pular entre cordas). */
export class StringLock {
  constructor(need = 4) { this.need = need; this.reset(); }

  reset() { this.idx = null; this.cand = null; this.count = 0; }

  update(idx) {
    if (this.idx === null || idx === this.idx) { this.idx = idx; this.cand = null; this.count = 0; return this.idx; }
    if (idx === this.cand) this.count++;
    else { this.cand = idx; this.count = 1; }
    if (this.count >= this.need) { this.idx = idx; this.cand = null; this.count = 0; }
    return this.idx;
  }
}

/** Orientação para o usuário a partir do desvio. */
export function advice(cents, tol, strings = true) {
  if (Math.abs(cents) <= tol) return { kind: 'ok', text: 'Afinada!' };
  const up = cents < 0; // abaixo do alvo → precisa subir
  const far = Math.abs(cents) > 25;
  if (up) return { kind: far ? 'far' : 'near', text: `${far ? 'Muito grave' : 'Quase'}: suba o som${strings ? ' (aperte a corda)' : ''}` };
  return { kind: far ? 'far' : 'near', text: `${far ? 'Muito aguda' : 'Quase'}: desça o som${strings ? ' (afrouxe a corda)' : ''}` };
}
