import test from 'node:test';
import assert from 'node:assert/strict';
import { tonicFor } from '../src/music/scales.js';
import {
  chordAt, guitarVoicing, pianoVoicing, buildChordExercise, harmonizedDegrees, PROGRESSIONS,
} from '../src/music/chords.js';

const tonicC = tonicFor(0, 'major', 4);
const harm = (keyN, type, ext = 'triad') => buildChordExercise({ keyN, type, ext }).chords;

test('campo harmônico de Dó maior', () => {
  const c = harm(0, 'major');
  assert.deepEqual(c.slice(0, 7).map((x) => x.symbol), ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'B°']);
  assert.deepEqual(c.slice(0, 7).map((x) => x.roman), ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
  assert.equal(c[7].symbol, 'C'); // volta à tônica
  assert.equal(c.length, 8);
});

test('campo harmônico de Lá menor e de Sol maior (com F♯)', () => {
  assert.deepEqual(harm(0, 'minor').slice(0, 7).map((x) => x.symbol), ['Am', 'B°', 'C', 'Dm', 'Em', 'F', 'G']);
  const g = harm(1, 'major');
  assert.deepEqual(g.slice(0, 7).map((x) => x.symbol), ['G', 'Am', 'Bm', 'C', 'D', 'Em', 'F#°']);
  assert.equal(g[6].name, 'Fá♯ diminuto');
});

test('acordes com sétima', () => {
  const c = harm(0, 'major', 'seventh');
  assert.deepEqual(c.slice(0, 7).map((x) => x.symbol), ['C7M', 'Dm7', 'Em7', 'F7M', 'G7', 'Am7', 'Bm7(♭5)']);
});

test('notas do acorde (classes de altura)', () => {
  assert.deepEqual(chordAt(tonicC, 'major', 5).pcs, [9, 0, 4]); // Lá menor
  assert.deepEqual(chordAt(tonicC, 'major', 4).tones, ['Sol', 'Si', 'Ré']);
});

test('escala harmonizada: direções', () => {
  assert.deepEqual(harmonizedDegrees('down'), [7, 6, 5, 4, 3, 2, 1, 0]);
  assert.equal(harmonizedDegrees('both').length, 15);
  assert.equal(harmonizedDegrees('both')[7], 7);
});

test('progressões usam graus válidos', () => {
  for (const [id, p] of Object.entries(PROGRESSIONS)) if (p.degrees) assert.ok(p.degrees.every((d) => d >= 0 && d <= 6), id);
});

const voice = (sym, shape = 'open') => {
  const c = harm(0, 'major').concat(harm(0, 'minor')).find((x) => x.symbol === sym);
  return guitarVoicing(c.pcs, c.rootPc, shape).text;
};

test('violão: acordes abertos clássicos', () => {
  assert.equal(voice('C'), 'x 3 2 0 1 0');
  assert.equal(voice('Am'), 'x 0 2 2 1 0');
  assert.equal(voice('Dm'), 'x x 0 2 3 1');
  assert.equal(voice('Em'), '0 2 2 0 0 0');
  assert.equal(voice('F'), '1 3 3 2 1 1');
});

test('violão: cada forma contém todas as notas e tem o baixo na fundamental', () => {
  for (const ext of ['triad', 'seventh']) {
    for (const keyN of [0, 1, 2, -1, -3]) {
      for (const shape of ['open', 'barre']) {
        for (const c of harm(keyN, 'major', ext).slice(0, 7)) {
          const v = guitarVoicing(c.pcs, c.rootPc, shape);
          assert.ok(v, `${c.symbol} ${shape}`);
          const pcs = new Set(v.midis.map((m) => m % 12));
          assert.ok(c.pcs.every((p) => pcs.has(p)), `${c.symbol} ${shape} incompleto: ${v.text}`);
          assert.equal(v.midis[0] % 12, c.rootPc, `${c.symbol} ${shape} baixo: ${v.text}`);
          assert.ok(Math.max(...v.fingers) <= 4);
        }
      }
    }
  }
});

test('violão: pestana não usa cordas soltas', () => {
  const c = harm(0, 'major')[0];
  const v = guitarVoicing(c.pcs, c.rootPc, 'barre');
  assert.ok(!v.frets.includes(0));
});

test('teclado: estado fundamental e baixo', () => {
  const c = harm(0, 'major')[0];
  assert.deepEqual(pianoVoicing(c, 4, { lead: false }), [60, 64, 67]);
  assert.deepEqual(pianoVoicing(c, 4, { lead: false, bass: true }), [48, 60, 64, 67]);
});

test('teclado: inversões próximas mantêm as mãos perto', () => {
  const ex = buildChordExercise({ keyN: 0, type: 'major', instr: 'piano', lead: true }).chords;
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  for (let i = 1; i < ex.length; i++) {
    assert.ok(Math.abs(avg(ex[i].midis) - avg(ex[i - 1].midis)) <= 7, `${ex[i - 1].symbol}→${ex[i].symbol}`);
  }
  assert.ok(ex.every((c) => c.midis.length === 3));
});

import { alignSequence } from '../src/music/chords.js';

test('prática livre: sequência tocada contra a esperada', () => {
  assert.deepEqual(alignSequence(['C', 'Dm', 'Em'], ['C', 'Dm', 'Em']), { results: [true, true, true], extras: 0 });
  assert.deepEqual(alignSequence(['C', 'Dm', 'Em'], ['C', 'Em']), { results: [true, false, true], extras: 0 });
  assert.deepEqual(alignSequence(['C', 'Dm', 'Em'], ['C', 'F', 'Dm', 'Em']), { results: [true, true, true], extras: 1 });
  assert.deepEqual(alignSequence(['C', 'Dm'], []), { results: [false, false], extras: 0 });
});

test('escala do exercício de acordes', () => {
  const ex = buildChordExercise({ keyN: 1, type: 'major' });
  assert.deepEqual(ex.scale.pcs, [7, 9, 11, 0, 2, 4, 6]);
  assert.equal(ex.scale.names[6], 'Fá♯');
  assert.equal(ex.scale.tonicPc, 7);
});
