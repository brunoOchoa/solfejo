import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stringsOf, freqOfMidi, centsTo, nearestString, nearestNote, FreqSmoother, StringLock, advice, noteLabelOct, TUNERS,
} from '../src/music/tuner.js';

test('afinação padrão do violão e do violino', () => {
  assert.deepEqual(stringsOf('guitar', 'standard').map((s) => noteLabelOct(s.midi)), ['Mi2', 'Lá2', 'Ré3', 'Sol3', 'Si3', 'Mi4']);
  assert.deepEqual(stringsOf('guitar', 'standard').map((s) => s.num), [6, 5, 4, 3, 2, 1]);
  assert.deepEqual(stringsOf('violin', 'standard').map((s) => noteLabelOct(s.midi)), ['Sol3', 'Ré4', 'Lá4', 'Mi5']);
  assert.deepEqual(stringsOf('piano', 'x'), []);
  assert.equal(stringsOf('guitar', 'dropd')[0].midi, 38);
  for (const t of Object.values(TUNERS.guitar.tunings)) assert.equal(t.midis.length, 6);
});

test('frequências e cents com Lá de referência', () => {
  assert.ok(Math.abs(freqOfMidi(69) - 440) < 1e-9);
  assert.ok(Math.abs(freqOfMidi(40) - 82.407) < 0.01);
  assert.ok(Math.abs(freqOfMidi(69, 442) - 442) < 1e-9);
  assert.ok(Math.abs(centsTo(440 * 2 ** (10 / 1200), 69) - 10) < 1e-6);
  assert.ok(centsTo(430, 69) < 0);
  assert.ok(Math.abs(centsTo(442, 69, 442)) < 1e-9);
});

test('corda mais próxima, mesmo desafinada', () => {
  const midis = stringsOf('guitar', 'standard').map((s) => s.midi);
  const r = nearestString(freqOfMidi(45) * 2 ** (-30 / 1200), midis);
  assert.equal(r.index, 1);
  assert.ok(Math.abs(r.cents + 30) < 1e-6);
  assert.equal(nearestString(freqOfMidi(64), midis).index, 5);
});

test('modo cromático', () => {
  const r = nearestNote(freqOfMidi(61) * 2 ** (12 / 1200));
  assert.equal(r.midi, 61);
  assert.ok(Math.abs(r.cents - 12) < 1e-6);
});

test('FreqSmoother: mediana ignora pico e esquece após pausa', () => {
  const s = new FreqSmoother();
  let v;
  [100, 100, 200, 100, 100].forEach((f, i) => { v = s.push(i * 30, f); });
  assert.equal(v, 100);
  assert.equal(s.push(2000, 300), 300);
});

test('StringLock: só troca depois de leituras seguidas', () => {
  const l = new StringLock(3);
  assert.equal(l.update(1), 1);
  assert.equal(l.update(2), 1);
  assert.equal(l.update(2), 1);
  assert.equal(l.update(2), 2);
  assert.equal(l.update(1), 2);
  assert.equal(l.update(2), 2);
});

test('orientação: sobe quando está grave, desce quando está aguda', () => {
  assert.equal(advice(2, 5).kind, 'ok');
  assert.match(advice(-30, 5).text, /suba/);
  assert.match(advice(12, 5).text, /desça/);
  assert.doesNotMatch(advice(12, 5, false).text, /corda/);
});
