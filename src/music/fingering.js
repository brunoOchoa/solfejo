// Digitação sugerida do violino: em que corda e com qual dedo tocar cada nota. Funções puras (testáveis).

import { midiOf, noteName } from './theory.js';

export const VIOLIN_STRINGS = { midis: [55, 62, 69, 76], names: ['Sol', 'Ré', 'Lá', 'Mi'] }; // grave → aguda

// dedo para cada distância (em semitons) da corda solta
const FINGER_1 = [0, 1, 1, 2, 2, 3, 3, 4, 4];
const FINGER_3 = {
  0: 0, 4: 1, 5: 1, 6: 2, 7: 2, 8: 3, 9: 3, 10: 4, 11: 4, 12: 4,
};

/** Posição horizontal relativa (0 = pestana, 1 = cavalete) de uma nota a `cents` acima da corda solta. */
export const stringFraction = (cents) => 1 - 2 ** (-cents / 1200);

/**
 * Onde tocar a nota (MIDI): { string (0 = Sol … 3 = Mi), s (semitons acima da corda solta), finger (0 = solta) }.
 * position '1' (1ª posição: solta e dedos 1–4 até +8) ou '3' (3ª posição: corda solta ou +4 a +12).
 * Regra: entre as cordas que alcançam a nota, a que pede o menor deslocamento (corda solta ganha do 4º dedo).
 * Retorna null para notas abaixo do Sol grave.
 */
export function placeNote(midi, position = '1') {
  const m = Math.round(midi);
  const inWindow = (s) => (position === '3' ? s === 0 || (s >= 4 && s <= 12) : s >= 0 && s <= 8);
  let best = null;
  VIOLIN_STRINGS.midis.forEach((open, string) => {
    const s = m - open;
    if (inWindow(s) && (!best || s < best.s)) best = { string, s };
  });
  if (!best) { // fora da janela da posição: usa a corda que alcança com o menor deslocamento
    VIOLIN_STRINGS.midis.forEach((open, string) => {
      const s = m - open;
      if (s >= 0 && s <= 24 && (!best || s < best.s)) best = { string, s };
    });
  }
  if (!best) return null;
  const finger = position === '3' ? (FINGER_3[best.s] ?? 4) : (FINGER_1[best.s] ?? 4);
  return { ...best, finger };
}

/** Nome de cada nota do exercício, como está escrito na pauta (Si♭ e não Lá♯ em Fá maior): MIDI → nome. */
export function spellMap(notes) {
  const m = new Map();
  notes.forEach((n) => { if (!m.has(midiOf(n))) m.set(midiOf(n), noteName(n)); });
  return m;
}
