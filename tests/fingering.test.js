import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeNote, stringFraction } from '../src/music/fingering.js';

test('1ª posição: Sol maior começa na corda solta e usa corda solta em vez do 4º dedo', () => {
  const at = (m) => placeNote(m, '1');
  assert.deepEqual(at(55), { string: 0, s: 0, finger: 0 }); // Sol3 solta
  assert.deepEqual(at(57), { string: 0, s: 2, finger: 1 }); // Lá3
  assert.deepEqual(at(59), { string: 0, s: 4, finger: 2 }); // Si3
  assert.deepEqual(at(60), { string: 0, s: 5, finger: 3 }); // Dó4
  assert.deepEqual(at(62), { string: 1, s: 0, finger: 0 }); // Ré4: solta (e não 4º dedo na corda Sol)
  assert.deepEqual(at(64), { string: 1, s: 2, finger: 1 }); // Mi4
  assert.deepEqual(at(69), { string: 2, s: 0, finger: 0 }); // Lá4 solta
  assert.deepEqual(at(76), { string: 3, s: 0, finger: 0 }); // Mi5 solta
});

test('3ª posição e notas fora da janela', () => {
  assert.deepEqual(placeNote(60, '3'), { string: 0, s: 5, finger: 1 }); // Dó4 na corda Sol com o 1º dedo
  assert.deepEqual(placeNote(55, '3'), { string: 0, s: 0, finger: 0 }); // solta continua valendo
  assert.ok(placeNote(88, '1')); // nota aguda: usa a corda que alcança
  assert.equal(placeNote(50, '1'), null); // abaixo do Sol grave
});

test('posição ao longo da corda: oitava no meio, quinta a 1/3', () => {
  assert.ok(Math.abs(stringFraction(1200) - 0.5) < 1e-9);
  assert.ok(Math.abs(stringFraction(700) - (1 - 2 ** (-7 / 12))) < 1e-9);
  assert.equal(stringFraction(0), 0);
});

import { spellMap } from '../src/music/fingering.js';
import { buildExercise } from '../src/music/scales.js';
import { keyNFor } from '../src/music/tonic.js';

test('nomes no braço seguem a grafia da pauta (bemóis em Fá maior, sustenidos em Sol maior)', () => {
  const f = buildExercise({ keyN: keyNFor(5, 'major'), type: 'major', octave: 3, range: [25, 51] });
  const names = [...spellMap(f.notes).values()];
  assert.ok(names.includes('Si♭'));
  assert.ok(!names.includes('Lá♯'));
  const g = buildExercise({ keyN: keyNFor(7, 'major'), type: 'major', octave: 3, range: [25, 51] });
  const gn = [...spellMap(g.notes).values()];
  assert.ok(gn.includes('Fá♯'));
  const gm = buildExercise({ keyN: keyNFor(7, 'harmonic'), type: 'harmonic', octave: 3, range: [25, 51] });
  const gmn = [...spellMap(gm.notes).values()];
  assert.ok(gmn.includes('Si♭') && gmn.includes('Fá♯') && gmn.includes('Mi♭'));
  assert.equal(spellMap(f.notes).size, new Set(f.notes.map((n) => n.step * 10 + n.acc)).size);
});
