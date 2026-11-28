import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNotation, chordOf, buildSong, SONGS, getSong,
} from '../src/music/songs.js';
import { noteName } from '../src/music/theory.js';

test('leitor: notas, pausas, colcheias e pontuação', () => {
  const m = parseNotation('A4e B4e C#5q | rh', [2, 4]);
  assert.equal(m.length, 2);
  assert.deepEqual(m[0].items.map((i) => i.beats), [0.5, 0.5, 1]);
  assert.equal(m[0].items[2].pitch.acc, 1);
  assert.equal(m[1].items[0].rest, true);
  const d = parseNotation('G4q. G4e', [2, 4]); // semínima pontuada + colcheia = 2 tempos
  assert.deepEqual(d[0].items.map((i) => i.beats), [1.5, 0.5]);
});

test('leitor: erros claros', () => {
  assert.throws(() => parseNotation('A4q B4q C5q', [2, 4]), /tem 3 tempos/);
  assert.throws(() => parseNotation('H4q rq', [2, 4]), /não é uma nota/);
  assert.throws(() => parseNotation('A4q', [2, 4]), /tem 1 tempos/);
});

test('acordes do acompanhamento', () => {
  assert.deepEqual(chordOf('A').pcs, [9, 1, 4]); // Lá, Dó♯, Mi
  assert.deepEqual(chordOf('Am').pcs, [9, 0, 4]);
  assert.deepEqual(chordOf('Bb').pcs, [10, 2, 5]);
  assert.throws(() => chordOf('H'));
});

test('todas as músicas do catálogo fecham os compassos e têm acordes para cada um', () => {
  assert.ok(SONGS.length >= 1);
  for (const s of SONGS) {
    assert.ok(s.bars > 0 && s.notes.length > 0, s.id);
    assert.equal(s.harmony.length, s.bars, `${s.id}: um acorde por compasso`);
    const last = s.events[s.events.length - 1];
    assert.equal(last.startBeat + last.beats, s.totalBeats, `${s.id}: duração total`);
    for (const e of s.notes) assert.ok(e.string != null && e.finger != null, `${s.id}: dedilhado da nota ${e.idx}`);
  }
});

test('Song of the Wind: 14 compassos de 2/4, as notas certas e o dedilhado natural da 1ª posição', () => {
  const s = getSong('song-of-the-wind');
  assert.equal(s.bars, 14);
  assert.deepEqual(s.meter, [2, 4]);
  assert.equal(s.keyN, 3);
  const names = s.notes.map((e) => noteName(e.pitch, { system: 'cifra' }));
  assert.deepEqual(names.slice(0, 12), ['A', 'B', 'C#', 'D', 'E', 'E', 'E', 'E', 'F#', 'D', 'A', 'F#']);
  assert.equal(s.notes.length, 46); // 14 compassos, menos as 4 pausas e as colcheias que viram semínimas
  const f = (i) => `${s.notes[i].string}/${s.notes[i].finger}`;
  assert.equal(f(0), '2/0'); // Lá solto na corda Lá
  assert.equal(f(1), '2/1'); // Si, 1º dedo
  assert.equal(f(3), '2/3'); // Ré, 3º dedo na corda Lá
  assert.equal(f(4), '3/0'); // Mi solto na corda Mi
  assert.equal(f(8), '3/1'); // Fá♯, 1º dedo na corda Mi
});

test('buildSong rejeita acordes em número errado', () => {
  assert.throws(() => buildSong({
    id: 'x', meter: [2, 4], notation: 'A4q A4q | A4q A4q', harmony: ['A'],
  }), /acordes para 2 compassos/);
});
