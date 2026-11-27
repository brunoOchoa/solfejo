import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PitchSmoother, HoldTracker, SMOOTHING } from '../src/music/smooth.js';
import { generateNote } from '../src/music/melody.js';
import { keyAccidentals, letterOf } from '../src/music/theory.js';

const freqOf = (midi) => 440 * 2 ** ((midi - 69) / 12);
const frame = (t, midi, clarity = 0.95) => ({ t, freq: midi == null ? null : freqOf(midi), clarity });

function rng(seed) {
  let a = seed;
  return () => ((a = (a * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

test('suavizador: ruído e picos isolados não fazem a altura oscilar', () => {
  const sm = new PitchSmoother();
  const r = rng(3);
  const out = [];
  for (let i = 0; i < 100; i++) {
    let m = 60 + (r() - 0.5) * 0.6; // ±30 cents de ruído
    if (i % 17 === 5) m = 72; // erro de oitava isolado
    if (i % 23 === 7) m = 67; // erro de quinta isolado
    out.push(sm.update(frame(i * 30, m)));
  }
  const steady = out.slice(10);
  assert.ok(steady.every((o) => o.midi !== null));
  const mids = steady.map((o) => o.midi);
  assert.ok(Math.max(...mids) - Math.min(...mids) < 0.4, `variação ${Math.max(...mids) - Math.min(...mids)}`);
});

test('suavizador: acompanha uma troca real de nota em poucos quadros', () => {
  const sm = new PitchSmoother();
  let last;
  for (let i = 0; i < 20; i++) last = sm.update(frame(i * 30, 60));
  assert.ok(Math.abs(last.midi - 60) < 0.05);
  for (let i = 20; i < 30; i++) last = sm.update(frame(i * 30, 65));
  assert.ok(Math.abs(last.midi - 65) < 0.1, `got ${last.midi}`);
});

test('suavizador: segura falhas curtas e zera no silêncio', () => {
  const sm = new PitchSmoother();
  for (let i = 0; i < 10; i++) sm.update(frame(i * 30, 62));
  const gap = sm.update(frame(300 + 90, null));
  assert.ok(gap.midi !== null && gap.held);
  let o;
  for (let t = 330; t < 1000; t += 30) o = sm.update(frame(t, null));
  assert.equal(o.midi, null);
  assert.equal(sm.update(frame(1100, 0, 0.3)).midi, null); // baixa clareza = sem voz
});

test('HoldTracker: conclui após segurar a nota, tolera falhas curtas e reinicia nas longas', () => {
  const h = new HoldTracker({ tolCents: 25, holdMs: 800, graceMs: 150 });
  let r;
  for (let t = 0; t <= 600; t += 30) r = h.update(t, 10);
  assert.ok(r.progress > 0.7 && !r.done);
  r = h.update(630, null); // falha curta
  assert.ok(r.progress > 0.7);
  for (let t = 660; t <= 900; t += 30) r = h.update(t, -12);
  assert.ok(r.done);

  const h2 = new HoldTracker({ tolCents: 25, holdMs: 800, graceMs: 150 });
  for (let t = 0; t <= 400; t += 30) h2.update(t, 5);
  for (let t = 430; t <= 700; t += 30) r = h2.update(t, 80); // fora do alvo
  assert.equal(r.progress, 0);
});

test('nota única: dentro da escala do tom e sem repetir a anterior', () => {
  for (const keyN of [-4, 0, 2, 5]) {
    const keyAcc = keyAccidentals(keyN);
    let prev = null;
    for (let i = 0; i < 200; i++) {
      const p = generateNote({ keyN, avoid: prev });
      assert.equal(p.acc, keyAcc[letterOf(p.step)]);
      if (prev) assert.notEqual(p.step, prev.step);
      prev = p;
    }
  }
  const chroma = Array.from({ length: 300 }, () => generateNote({ keyN: 0, chromatic: true }));
  assert.ok(chroma.some((p) => p.acc !== 0));
});

test('suavizador: ruído no ataque da voz (leituras inconsistentes) não é emitido', () => {
  const sm = new PitchSmoother();
  const garbage = [48, 71, 55, 66]; // transientes sem relação entre si
  const outs = garbage.map((m, i) => sm.update(frame(i * 30, m)));
  assert.ok(outs.every((o) => o.midi === null));
  let o;
  for (let i = 4; i < 9; i++) o = sm.update(frame(i * 30, 62)); // nota real e estável
  assert.ok(o.midi !== null && Math.abs(o.midi - 62) < 0.1);
});

test('suavizador: vibrato e tremor são muito atenuados, deslizes continuam acompanhados', () => {
  const freqCents = (cents) => 60 + cents / 100;
  for (const [level, maxPeak] of [['normal', 0.12], ['soft', 0.08]]) {
    const sm = new PitchSmoother(SMOOTHING[level]);
    const out = [];
    for (let i = 0; i < 200; i++) {
      const vib = 0.3 * Math.sin(2 * Math.PI * 5.5 * (i * 0.03)); // ±30 cents a 5,5 Hz
      out.push(sm.update(frame(i * 30, 60 + vib)).midi);
    }
    const steady = out.slice(60);
    assert.ok(Math.max(...steady) - Math.min(...steady) < maxPeak * 2, `${level}: pico-a-pico ${Math.max(...steady) - Math.min(...steady)}`);
    assert.ok(Math.abs(steady.reduce((a, b) => a + b, 0) / steady.length - 60) < 0.05);
  }
  // deslize de 2 semitonos em 200 ms: em 400 ms deve estar perto do destino
  const sm = new PitchSmoother();
  let t = 0;
  for (; t < 600; t += 30) sm.update(frame(t, 60));
  let last;
  for (let k = 0; k <= 13; k++, t += 30) last = sm.update(frame(t, Math.min(62, 60 + (k * 30) / 100)));
  assert.ok(Math.abs(last.midi - 62) < 0.5, `deslize: ${last.midi}`);
  assert.equal(freqCents(0), 60);
});
