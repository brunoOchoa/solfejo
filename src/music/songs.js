// Músicas para praticar no violino: formato, leitor e catálogo.
// Só entram melodias de domínio público (folclore e compositores antigos), escritas aqui por nós; nada copiado de edições de livros.
import { midiOf } from './theory.js';
import { placeNote } from './fingering.js';

// durações em tempos (semínima = 1): w semibreve, h mínima, q semínima, e colcheia, s semicolcheia; "." aumenta metade
const DUR = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25 };
const LETTER = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * Lê "A4e B4e C#5e D5e | E5q rq | …": nota = letra + (#|b) + oitava + duração; pausa = r + duração; "|" separa compassos.
 * Retorna os compassos [{ items: [{ pitch, beats, rest }] }]. Lança erro se um compasso não fechar com o tamanho do compasso.
 */
export function parseNotation(text, meter = [4, 4]) {
  const barBeats = (meter[0] * 4) / meter[1];
  return text.split('|').map((chunk) => chunk.trim()).filter(Boolean).map((bar, b) => {
    const items = bar.split(/\s+/).map((tok) => {
      const m = /^(?:([A-G])([#b]?)(\d)|r)([wheqs])(\.?)$/.exec(tok);
      if (!m) throw new Error(`compasso ${b + 1}: “${tok}” não é uma nota nem uma pausa`);
      const beats = DUR[m[4]] * (m[5] ? 1.5 : 1);
      if (tok.startsWith('r')) return { rest: true, beats };
      const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
      return { rest: false, beats, pitch: { step: Number(m[3]) * 7 + LETTER[m[1]], acc } };
    });
    const total = items.reduce((s, i) => s + i.beats, 0);
    if (Math.abs(total - barBeats) > 1e-9) throw new Error(`compasso ${b + 1}: tem ${total} tempos, o compasso pede ${barBeats}`);
    return { items };
  });
}

/** Acorde do acompanhamento: "A", "Am", "F#", "Bb" → { name, pcs: [fundamental, terça, quinta] }. */
export function chordOf(name) {
  const m = /^([A-G])([#b]?)(m?)$/.exec(name);
  if (!m) throw new Error(`acorde inválido: ${name}`);
  const root = (PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  return { name, root, pcs: [root, (root + (m[3] ? 3 : 4)) % 12, (root + 7) % 12] };
}

/** Monta a música a partir da definição: compassos, linha do tempo de eventos e acordes. */
export function buildSong(def) {
  const measures = parseNotation(def.notation, def.meter);
  const barBeats = (def.meter[0] * 4) / def.meter[1];
  const events = [];
  measures.forEach((m, bar) => {
    let t = bar * barBeats;
    m.items.forEach((it) => {
      const midi = it.rest ? null : midiOf(it.pitch);
      const place = it.rest ? null : placeNote(midi, '1'); // dedilhado automático (1ª posição): corda e dedo
      events.push({
        idx: events.length, bar, startBeat: t, beats: it.beats, rest: it.rest, pitch: it.pitch ?? null, midi, string: place?.string ?? null, finger: place?.finger ?? null,
      });
      t += it.beats;
    });
  });
  const harmony = (def.harmony ?? []).map(chordOf);
  if (harmony.length && harmony.length !== measures.length) throw new Error(`${def.id}: ${harmony.length} acordes para ${measures.length} compassos`);
  return {
    ...def, measures, events, barBeats, bars: measures.length, totalBeats: measures.length * barBeats, harmony,
    notes: events.filter((e) => !e.rest),
  };
}

// ---- catálogo ------------------------------------------------------------------------------------------------
const DEFS = [
  {
    id: 'song-of-the-wind',
    title: 'Song of the Wind',
    pt: 'Canção do Vento',
    origin: 'Canção folclórica (domínio público)',
    level: 1,
    keyN: 3, // Lá maior: 3 sustenidos
    meter: [2, 4],
    tempo: 80,
    tags: ['1ª posição', 'colcheias', 'cordas Lá e Mi'],
    notation: [
      'A4e B4e C#5e D5e | E5e E5e E5e E5e | F#5e D5e A5e F#5e | E5q rq',
      'F#5e D5e A5e F#5e | E5q rq | E5e D5e D5e D5e | D5e C#5e C#5e C#5e',
      'C#5e B4e B4e B4e | A4e C#5e E5q | E5e D5e D5e D5e | D5e C#5e C#5e C#5e',
      'C#5e B4e B4e B4e | A4q rq',
    ].join(' | '),
    harmony: ['A', 'A', 'D', 'A', 'D', 'A', 'A', 'E', 'E', 'A', 'A', 'E', 'E', 'A'],
  },
  {
    id: 'may-song',
    title: 'May Song',
    pt: 'Canção de Maio',
    origin: 'Canção folclórica (domínio público)',
    level: 2,
    keyN: 3, // Lá maior: 3 sustenidos
    meter: [4, 4],
    tempo: 92,
    tags: ['1ª posição', 'ponto de aumento', 'colcheias', 'cordas Lá e Mi'],
    notation: [
      'A4q. C#5e E5q A5q | F#5q A5e F#5e E5h | D5q. E5e C#5q A4q | B4h A4h',
      'E5q E5q D5q D5q | C#5q E5e C#5e B4h | E5q E5q D5q D5q | C#5q E5e C#5e B4h',
      'A4q. C#5e E5q A5q | F#5q A5e F#5e E5h | D5q. E5e C#5q A4q | B4h A4h',
    ].join(' | '),
    harmony: ['A', 'D', 'A', 'E', 'A', 'E', 'A', 'E', 'A', 'D', 'A', 'E'],
  },
  {
    id: 'allegro',
    title: 'Allegro',
    pt: 'Allegro (alegre e animado)',
    origin: 'Melodia tradicional (domínio público)',
    level: 2,
    keyN: 3, // Lá maior: 3 sustenidos
    meter: [4, 4],
    tempo: 100,
    tags: ['1ª posição', 'staccato (notas curtas)', 'colcheias', 'cordas Lá e Mi'],
    notation: [
      'A5q A5q E5q E5q | F#5e G#5e A5e F#5e E5q E5q | D5q D5q C#5q C#5q | B4e A4e B4e C#5e A4h',
      'A5q A5q E5q E5q | F#5e G#5e A5e F#5e E5q E5q | D5q D5q C#5q C#5q | B4e A4e B4e C#5e A4h',
      'F#5q F#5q E5q A4q | F#5q F#5q E5q A4q | F#5q G#5q A5q F#5q | E5q C#5q B4h',
      'A5q A5q E5q E5q | F#5e G#5e A5e F#5e E5q E5q | D5q D5q C#5q C#5q | B4e A4e B4e C#5e A4h',
    ].join(' | '),
    harmony: ['A', 'A', 'D', 'E', 'A', 'A', 'D', 'E', 'D', 'D', 'A', 'E', 'A', 'A', 'D', 'A'],
  },
];

export const SONGS = DEFS.map(buildSong);
export const getSong = (id) => SONGS.find((s) => s.id === id) ?? SONGS[0];
