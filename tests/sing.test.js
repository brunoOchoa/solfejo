import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch, centsBetween } from '../src/music/pitch.js';
import { generateMelody, evaluateSung, foldCents } from '../src/music/melody.js';
import { frequencyOf, keyAccidentals, letterOf } from '../src/music/theory.js';

const SR = 48000;

function tone(freq, { n = 4096, harmonics = [1, 0.5, 0.25], amp = 0.3, noise = 0 } = {}) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    harmonics.forEach((a, h) => (v += a * Math.sin((2 * Math.PI * freq * (h + 1) * i) / SR)));
    buf[i] = amp * v + noise * (Math.random() - 0.5);
  }
  return buf;
}

test('YIN acerta a afinação de vozes graves e agudas (tolerância 5 cents)', () => {
  for (const f of [98, 130.81, 220, 261.63, 440, 659.25, 987.77]) {
    const r = detectPitch(tone(f), SR);
    assert.ok(r, `detectou ${f} Hz`);
    assert.ok(Math.abs(centsBetween(r.freq, f)) < 5, `${f} Hz -> ${r.freq.toFixed(2)}`);
    assert.ok(r.clarity > 0.9);
  }
});

test('YIN tolera ruído moderado e ignora silêncio', () => {
  const r = detectPitch(tone(329.63, { noise: 0.1 }), SR);
  assert.ok(r && Math.abs(centsBetween(r.freq, 329.63)) < 15);
  assert.equal(detectPitch(new Float32Array(4096), SR), null);
  assert.equal(detectPitch(tone(220, { amp: 0.0005 }), SR), null);
});

test('YIN não confunde com a oitava quando o 2º harmônico é forte', () => {
  const r = detectPitch(tone(196, { harmonics: [0.6, 1, 0.5] }), SR);
  assert.ok(Math.abs(centsBetween(r.freq, 196)) < 10, `got ${r.freq}`);
});

test('foldCents mantém no intervalo [-600, 600)', () => {
  assert.equal(foldCents(1210), 10);
  assert.equal(foldCents(-1190), 10);
  assert.equal(foldCents(-20), -20);
});

test('melodias: dentro da escala, começam e terminam na tônica', () => {
  for (const keyN of [-5, -2, 0, 1, 4, 5]) {
    for (const level of [1, 2, 3]) {
      for (let i = 0; i < 60; i++) {
        const m = generateMelody({ keyN, level, length: 8 });
        assert.equal(m.notes.length, 8);
        const keyAcc = keyAccidentals(keyN);
        for (const p of m.notes) assert.equal(p.acc, keyAcc[letterOf(p.step)]);
        assert.equal(letterOf(m.notes[0].step), letterOf(m.tonic.step));
        assert.equal(letterOf(m.notes.at(-1).step), letterOf(m.tonic.step));
      }
    }
  }
});

test('nível 1 só anda por graus conjuntos (exceto o retorno final à tônica)', () => {
  for (let i = 0; i < 100; i++) {
    const m = generateMelody({ keyN: 0, level: 1, length: 8 });
    for (let k = 1; k < 7; k++) assert.ok(Math.abs(m.notes[k].step - m.notes[k - 1].step) <= 1);
  }
});

function framesFor(notes, { startMs, beatMs, centsOff = 0, octaves = 0, skip = [] }) {
  const frames = [];
  notes.forEach((p, i) => {
    if (skip.includes(i)) return;
    for (let t = startMs + i * beatMs; t < startMs + (i + 1) * beatMs; t += 30) {
      frames.push({ t, freq: frequencyOf(p) * 2 ** (centsOff / 1200) * 2 ** octaves, clarity: 0.95 });
    }
  });
  return frames;
}

test('avaliação: cantar certo = 100%, aceitando outra oitava', () => {
  const m = generateMelody({ keyN: 0, level: 2, length: 6 });
  const opts = { startMs: 1000, beatMs: 1000 };
  const ok = evaluateSung({ notes: m.notes, frames: framesFor(m.notes, opts), ...opts });
  assert.equal(ok.score, 1);
  const lower = evaluateSung({ notes: m.notes, frames: framesFor(m.notes, { ...opts, octaves: -1 }), ...opts });
  assert.equal(lower.score, 1);
  const strict = evaluateSung({ notes: m.notes, frames: framesFor(m.notes, { ...opts, octaves: -1 }), ...opts, anyOctave: false });
  assert.equal(strict.score, 0);
});

test('avaliação: desafinado, nota errada e nota não cantada', () => {
  const m = generateMelody({ keyN: 0, level: 1, length: 4 });
  const opts = { startMs: 0, beatMs: 1000 };
  const sharp = evaluateSung({ notes: m.notes, frames: framesFor(m.notes, { ...opts, centsOff: 30 }), ...opts });
  assert.ok(sharp.results.every((r) => r.grade === 'good'));
  assert.ok(Math.abs(sharp.meanCents - 30) < 1);
  const wrong = evaluateSung({ notes: m.notes, frames: framesFor(m.notes, { ...opts, centsOff: 200 }), ...opts });
  assert.ok(wrong.results.every((r) => r.grade === 'miss' && r.sung));
  const silent = evaluateSung({ notes: m.notes, frames: framesFor(m.notes, { ...opts, skip: [1] }), ...opts });
  assert.equal(silent.results[1].grade, 'miss');
  assert.equal(silent.results[1].cents, null);
  assert.equal(silent.results[0].grade, 'perfect');
});
