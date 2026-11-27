import test from 'node:test';
import assert from 'node:assert/strict';
import { chromaFromSpectrum, matchChord, evaluateChordsTimed } from '../src/music/chroma.js';

const SR = 48000;
const N = 8192; // bins (fftSize 16384)
const binHz = SR / (2 * N);

/** Espectro sintético: cada nota com 6 harmônicos (amplitude 1/h) e um pico estreito. */
function spectrum(midis, alpha = 1) {
  const db = new Float32Array(N).fill(-100);
  for (const m of midis) {
    const f0 = 440 * 2 ** ((m - 69) / 12);
    for (let h = 1; h <= 6; h++) {
      const c = (f0 * h) / binHz;
      const a = 20 * Math.log10(1 / h ** alpha);
      for (let k = -2; k <= 2; k++) {
        const i = Math.round(c) + k;
        const v = a - 6 * (k - (c - Math.round(c))) ** 2;
        if (i > 0 && i < N) db[i] = Math.max(db[i], v - 20);
      }
    }
  }
  return db;
}
const C = [48, 60, 64, 67]; // C3 C4 E4 G4
const Am = [45, 57, 60, 64];
const pc = (arr) => [...new Set(arr.map((m) => m % 12))];

test('reconhece o acorde tocado e rejeita outros', () => {
  const { chroma } = chromaFromSpectrum(spectrum(C), SR);
  assert.ok(matchChord(chroma, [0, 4, 7]).ok, 'C maior');
  assert.ok(!matchChord(chroma, [9, 0, 4]).ok, 'Lá menor não');
  assert.ok(!matchChord(chroma, [5, 9, 0]).ok, 'Fá maior não');
  const am = chromaFromSpectrum(spectrum(Am), SR).chroma;
  assert.ok(matchChord(am, [9, 0, 4]).ok);
  assert.ok(!matchChord(am, [0, 4, 7]).ok);
});

test('acorde incompleto aponta a nota que falta', () => {
  const { chroma } = chromaFromSpectrum(spectrum([48, 55, 60, 67]), SR); // C sem E
  const r = matchChord(chroma, [0, 4, 7]);
  assert.ok(!r.ok);
  assert.deepEqual(r.missing, [4]);
});

test('silêncio não vira acorde', () => {
  const r = chromaFromSpectrum(new Float32Array(N).fill(-110), SR);
  assert.equal(r.chroma, null);
  assert.ok(!matchChord(null, [0, 4, 7]).ok);
});

test('avaliação no tempo: acerto, atraso, outro acorde e silêncio', () => {
  const cC = chromaFromSpectrum(spectrum(C), SR).chroma;
  const cAm = chromaFromSpectrum(spectrum(Am), SR).chroma;
  const chords = [{ pcs: pc(C) }, { pcs: pc(Am) }, { pcs: [5, 9, 0] }, { pcs: [7, 11, 2] }];
  const slot = 2000;
  const samples = [];
  const at = (t, ch) => samples.push({ t, chroma: ch, level: -20 });
  [0, 60, 120, 180].forEach((d) => at(100 + d, cC)); // 1: no tempo (+100 ms)
  [0, 60, 120, 180].forEach((d) => at(2000 + 1300 + d, cAm)); // 2: atrasado (~1300 ms)
  [0, 60, 120].forEach((d) => at(4000 + 100 + d, cC)); // 3: tocou C em vez de F
  const ev = evaluateChordsTimed({ chords, samples, startMs: 0, slotMs: slot });
  assert.equal(ev.results[0].grade, 'perfect');
  assert.equal(ev.results[1].grade, 'ok');
  assert.equal(ev.results[2].grade, 'wrong');
  assert.ok(ev.results[2].heard.includes(0));
  assert.equal(ev.results[3].grade, 'none');
  assert.ok(Math.abs(ev.score - (1 + 0.6) / 4) < 1e-9);
});

test('campo harmônico inteiro: cada acorde só é aceito para si mesmo (sem confundir harmônicos)', () => {
  const T = {
    C: [48, 60, 64, 67], Dm: [50, 62, 65, 69], Em: [52, 64, 67, 71], F: [53, 65, 69, 72], G: [55, 67, 71, 74], Am: [45, 57, 60, 64], Bdim: [47, 59, 62, 65],
  };
  for (const [a, ma] of Object.entries(T)) {
    const { chroma } = chromaFromSpectrum(spectrum(ma), SR);
    for (const [b, mb] of Object.entries(T)) {
      const r = matchChord(chroma, pc(mb));
      assert.equal(r.ok, a === b, `tocou ${a}, alvo ${b}: similaridade ${r.similarity.toFixed(2)}`);
    }
    assert.deepEqual(matchChord(chroma, pc(ma)).extras, [], `${a}: harmônicos não são notas a mais`);
  }
});

test('nota de fora aparece como extra', () => {
  const { chroma } = chromaFromSpectrum(spectrum([48, 60, 64, 67, 62]), SR); // C + Ré
  const r = matchChord(chroma, [0, 4, 7]);
  assert.ok(r.extras.includes(2));
});

test('robusto a instrumentos com timbres diferentes (harmônicos mais fortes ou mais fracos)', () => {
  const T = {
    C: [48, 60, 64, 67], Dm: [50, 62, 65, 69], Em: [52, 64, 67, 71], F: [53, 65, 69, 72], G: [55, 67, 71, 74], Am: [45, 57, 60, 64], Bdim: [47, 59, 62, 65],
  };
  for (const alpha of [0.5, 1.6, 2.2]) {
    for (const [a, ma] of Object.entries(T)) {
      const { chroma } = chromaFromSpectrum(spectrum(ma, alpha), SR);
      for (const [b, mb] of Object.entries(T)) {
        const r = matchChord(chroma, pc(mb));
        assert.equal(r.ok, a === b, `alpha ${alpha}: tocou ${a}, alvo ${b}: ${r.similarity.toFixed(2)}`);
      }
    }
  }
});
