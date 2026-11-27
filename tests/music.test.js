import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  midiOf, noteName, vexKey, keyAccidentals, randomPitch, CLEFS, letterOf,
} from '../src/music/theory.js';
import {
  TIME_SIGNATURES, PRESETS, PATTERNS, FIGURES, RIGOR, generateMeasures, onsetsOf, evaluateTaps, tripletGroups,
  presetFigures, presetOf, windowsFor, gradeFor,
} from '../src/music/rhythm.js';

function seeded(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('midi: Dó4 = 60, Lá4 = 69', () => {
  assert.equal(midiOf({ step: 28, acc: 0 }), 60);
  assert.equal(midiOf({ step: 33, acc: 0 }), 69);
  assert.equal(midiOf({ step: 32, acc: 1 }), 68); // Sol♯4
});

test('nomes em Dó fixo e cifra', () => {
  assert.equal(noteName({ step: 28, acc: 0 }), 'Dó');
  assert.equal(noteName({ step: 32, acc: 1 }, { octave: true }), 'Sol♯4');
  assert.equal(noteName({ step: 30, acc: -1 }, { system: 'cifra' }), 'Eb');
  assert.equal(vexKey({ step: 32, acc: 1 }), 'g#/4');
});

test('armaduras', () => {
  assert.deepEqual(keyAccidentals(1), [0, 0, 0, 1, 0, 0, 0]); // Fá♯
  assert.deepEqual(keyAccidentals(-2), [0, 0, -1, 0, 0, 0, -1]); // Mi♭ e Si♭
  assert.deepEqual(keyAccidentals(0), [0, 0, 0, 0, 0, 0, 0]);
});

test('notas sorteadas ficam na extensão da clave e respeitam a armadura', () => {
  const rand = seeded(1);
  for (const clef of ['treble', 'bass']) {
    for (const range of ['basic', 'extended']) {
      const keyAcc = keyAccidentals(3);
      for (let i = 0; i < 300; i++) {
        const p = randomPitch({ clef, range, keyAcc, rand });
        const [lo, hi] = CLEFS[clef][range];
        assert.ok(p.step >= lo && p.step <= hi);
        assert.equal(p.acc, keyAcc[letterOf(p.step)]);
      }
    }
  }
});

test('todo padrão ocupa um número inteiro de tempos', () => {
  for (const p of PATTERNS.SIMPLE) assert.ok(Number.isInteger(p.span) && p.span >= 1, JSON.stringify(p.ev));
  for (const p of PATTERNS.COMPOUND) assert.ok(Number.isInteger(p.span) && p.span >= 1, JSON.stringify(p.ev));
});

test('compassos gerados somam exatamente o tamanho do compasso, em todos os níveis', () => {
  const rand = seeded(7);
  for (const [name, sig] of Object.entries(TIME_SIGNATURES)) {
    for (const id of Object.keys(PRESETS)) {
      for (let i = 0; i < 80; i++) {
        const measures = generateMeasures({ timeSig: name, figures: presetFigures(id), measures: 3, rand });
        for (const m of measures) {
          assert.equal(m.reduce((s, e) => s + Math.abs(e), 0), sig.beats * sig.beatTicks, `${name} nível ${id}`);
          assert.ok(m.some((e) => e > 0), 'compasso com pelo menos uma nota');
        }
        assert.ok(measures[0][0] > 0, 'primeiro evento deve ser nota');
      }
    }
  }
});

test('cada nível só usa as figuras habilitadas', () => {
  const rand = seeded(11);
  const allowed = (id, timeSig) => {
    const f = presetFigures(id);
    const set = new Set([12, 18]); // semínima / semínima pontuada (tempo)
    if (f.longas) [24, 36, 48].forEach((v) => set.add(v));
    if (f.colcheias) set.add(6);
    if (f.semicolcheias) set.add(3);
    if (f.pontuadas) set.add(9);
    if (f.tercinas) { set.add(4); set.add(8); }
    return set;
  };
  for (const id of Object.keys(PRESETS)) {
    for (const timeSig of ['4/4', '3/4', '6/8']) {
      const ok = allowed(id, timeSig);
      for (let i = 0; i < 100; i++) {
        for (const m of generateMeasures({ timeSig, figures: presetFigures(id), measures: 2, rand })) {
          for (const e of m) {
            if (!presetFigures(id).rests) assert.ok(e > 0, `nível ${id}: sem pausas`);
            if (TIME_SIGNATURES[timeSig].compound === false && Math.abs(e) === 18) {
              assert.ok(presetFigures(id).pontuadas, 'semínima pontuada só com "pontuadas"');
            } else assert.ok(ok.has(Math.abs(e)), `nível ${id} ${timeSig}: valor ${e} não permitido`);
          }
        }
      }
    }
  }
});

test('nível 1 só tem semínimas, mínimas, semibreves e pausas; nível 5 pode ter tercinas', () => {
  const rand = seeded(5);
  const seen = new Set();
  for (let i = 0; i < 300; i++) for (const m of generateMeasures({ timeSig: '4/4', figures: presetFigures(1), measures: 2, rand })) m.forEach((e) => seen.add(Math.abs(e)));
  assert.deepEqual([...seen].sort((a, b) => a - b), [12, 24, 36, 48]);
  const seen5 = new Set();
  for (let i = 0; i < 400; i++) for (const m of generateMeasures({ timeSig: '4/4', figures: presetFigures(5), measures: 2, rand })) m.forEach((e) => seen5.add(Math.abs(e)));
  assert.ok(seen5.has(4) && seen5.has(8) && seen5.has(3) && seen5.has(9));
});

test('tercinas vêm em grupos que somam uma semínima', () => {
  const rand = seeded(3);
  let groups = 0;
  for (let i = 0; i < 300; i++) {
    for (const m of generateMeasures({ timeSig: '4/4', figures: presetFigures(5), measures: 2, rand })) {
      const tg = tripletGroups(m);
      groups += tg.length;
      for (const [a, b] of tg) assert.equal(m.slice(a, b).reduce((s, e) => s + Math.abs(e), 0), 12);
      const tripletEvents = m.filter((e) => Math.abs(e) === 4 || Math.abs(e) === 8).length;
      assert.equal(tripletEvents, tg.reduce((s, [a, b]) => s + (b - a), 0), 'toda nota de tercina pertence a um grupo');
    }
  }
  assert.ok(groups > 0);
});

test('figuras personalizadas: só colcheias + semínima; frequência de pausas', () => {
  const rand = seeded(9);
  const figures = { longas: false, colcheias: true, semicolcheias: false, pontuadas: false, sincopes: false, tercinas: false, rests: false };
  const seen = new Set();
  for (let i = 0; i < 200; i++) for (const m of generateMeasures({ timeSig: '2/4', figures, measures: 2, rand })) m.forEach((e) => seen.add(e));
  assert.deepEqual([...seen].sort((a, b) => a - b), [6, 12]);
  assert.equal(presetOf(figures), 'custom');
  assert.equal(presetOf(presetFigures(3)), '3');
  const count = (bias) => {
    const r = seeded(21);
    let rests = 0;
    for (let i = 0; i < 400; i++) for (const m of generateMeasures({ timeSig: '4/4', figures: presetFigures(2), measures: 2, restBias: bias, rand: r })) rests += m.filter((e) => e < 0).length;
    return rests;
  };
  assert.ok(count(2) > count(0.5) * 1.5, 'mais pausas com restBias alto');
  assert.ok(Object.keys(FIGURES).length === 7);
});

test('onsets ignoram pausas', () => {
  assert.deepEqual(onsetsOf([[12, -12, 24]], '4/4'), [0, 24]);
  assert.deepEqual(onsetsOf([[12, 12, 12, 12], [-48]], '4/4'), [0, 12, 24, 36]);
  assert.deepEqual(onsetsOf([[4, 4, 4, 12, 12, 12]], '4/4'), [0, 4, 8, 12, 24, 36]);
});

test('avaliação de batidas', () => {
  const tick = 50; // semicolcheia = 150 ms
  const exact = evaluateTaps([0, 600, 1200], [0, 600, 1200], tick);
  assert.equal(exact.score, 1);
  const late = evaluateTaps([0, 600], [60, 660], tick);
  assert.ok(Math.round(late.meanDelta) === 60);
  const missed = evaluateTaps([0, 600], [0], tick);
  assert.equal(missed.notes[1].grade, 'miss');
  const extra = evaluateTaps([0], [0, 300], tick);
  assert.equal(extra.extra, 1);
  assert.equal(extra.extraAt[0], 300);
  assert.ok(extra.score < 1);
});

test('tendência usa a mediana: acertos "quase" isolados não enganam', () => {
  const tick = 50;
  const expected = [0, 600, 1200, 1800, 2400, 3000, 3600];
  // 5 batidas ~45 ms adiantadas e 2 "quase" atrasadas
  const taps = [-45, 555, 1155, 1755, 2355, 3100, 3710];
  const r = evaluateTaps(expected, taps, tick);
  assert.ok(r.meanDelta > -30, 'a média é puxada pelos atrasados');
  assert.ok(Math.abs(r.medianDelta - -45) <= 5, `mediana ${r.medianDelta}`);
  assert.ok(r.consistency >= 0.65);
  const mixed = evaluateTaps(expected, [-45, 645, 1155, 1845, 2355, 3045, 3555], tick);
  assert.ok(mixed.consistency < 0.65, 'erros para os dois lados não são tendência');
});

test('bater sem parar não zera o placar (penalidade limitada)', () => {
  const taps = Array.from({ length: 30 }, (_, i) => i * 100);
  const r = evaluateTaps([0, 600, 1200, 1800], taps, 50);
  assert.ok(r.score > 0, 'com acertos, o placar não zera');
  assert.ok(r.extra >= 20);
});

test('rigor muda as janelas de tolerância', () => {
  const tick = 60;
  const normal = windowsFor(tick, RIGOR.normal);
  const hard = windowsFor(tick, RIGOR.hard);
  const easy = windowsFor(tick, RIGOR.easy);
  assert.ok(hard.ok < normal.ok && normal.ok < easy.ok);
  const dist = (normal.good + normal.ok) / 2; // "ok" no normal
  assert.equal(gradeFor(dist, tick, RIGOR.normal), 'ok');
  assert.equal(gradeFor(dist, tick, RIGOR.easy), 'good');
  assert.equal(gradeFor(dist, tick, RIGOR.hard), null);
});
