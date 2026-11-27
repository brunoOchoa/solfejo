import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExercise, tonicFor } from '../src/music/scales.js';
import { noteName, midiOf, vexKey } from '../src/music/theory.js';
import {
  NoteDetector, evaluateTimed, INSTRUMENT_PROFILES, pairCalibration, summarizeTimed, alignScale,
} from '../src/music/instrument.js';

const names = (ex) => ex.notes.map((n) => noteName(n));
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

test('Dó maior sobe com 8 notas naturais', () => {
  const ex = buildExercise({ keyN: 0, type: 'major', octave: 4 });
  assert.deepEqual(names(ex), ['Dó', 'Ré', 'Mi', 'Fá', 'Sol', 'Lá', 'Si', 'Dó']);
  assert.equal(midiOf(ex.notes[0]), 60);
  assert.equal(midiOf(ex.notes[7]), 72);
});

test('Fá maior usa Si♭ e Ré♭ maior usa 5 bemóis', () => {
  assert.ok(names(buildExercise({ keyN: -1, type: 'major' })).includes('Si♭'));
  const db = buildExercise({ keyN: -5, type: 'major' });
  assert.equal(db.name, 'Ré♭ maior');
  assert.deepEqual(names(db).slice(0, 4), ['Ré♭', 'Mi♭', 'Fá', 'Sol♭']);
});

test('menores: natural, harmônica e melódica (sobe e desce diferente)', () => {
  assert.deepEqual(names(buildExercise({ keyN: 0, type: 'minor' })), ['Lá', 'Si', 'Dó', 'Ré', 'Mi', 'Fá', 'Sol', 'Lá']);
  assert.deepEqual(names(buildExercise({ keyN: 0, type: 'harmonic' })), ['Lá', 'Si', 'Dó', 'Ré', 'Mi', 'Fá', 'Sol♯', 'Lá']);
  const mel = names(buildExercise({ keyN: 0, type: 'melodic', direction: 'both' }));
  assert.deepEqual(mel, ['Lá', 'Si', 'Dó', 'Ré', 'Mi', 'Fá♯', 'Sol♯', 'Lá', 'Sol', 'Fá', 'Mi', 'Ré', 'Dó', 'Si', 'Lá']);
});

test('tônica da relativa menor e dupla alteração (Sol♯ menor harmônica)', () => {
  assert.equal(noteName(tonicFor(3, 'minor')), 'Fá♯');
  assert.equal(noteName(tonicFor(-3, 'minor')), 'Dó');
  const ex = buildExercise({ keyN: 5, type: 'harmonic' });
  assert.equal(noteName(ex.notes[6]), 'Fá𝄪');
  assert.equal(vexKey(ex.notes[6]).includes('##'), true);
});

test('padrões em terças e quintas', () => {
  const t = names(buildExercise({ keyN: 0, type: 'major', pattern: 'thirds' }));
  assert.deepEqual(t.slice(0, 6), ['Dó', 'Mi', 'Ré', 'Fá', 'Mi', 'Sol']);
  assert.equal(t.length, 12);
  const f = names(buildExercise({ keyN: 0, type: 'major', pattern: 'fifths' }));
  assert.deepEqual(f, ['Dó', 'Sol', 'Ré', 'Lá', 'Mi', 'Si', 'Fá', 'Dó']);
  const down = names(buildExercise({ keyN: 0, type: 'major', pattern: 'thirds', direction: 'down' }));
  assert.deepEqual(down.slice(0, 4), ['Dó', 'Lá', 'Si', 'Sol']);
});

test('subindo e descendo não repete a nota do topo; arpejo e 2 oitavas', () => {
  const ex = buildExercise({ keyN: 0, type: 'major', direction: 'both' });
  assert.equal(ex.notes.length, 15);
  const arp = names(buildExercise({ keyN: 0, type: 'major', pattern: 'arpeggio', octaves: 2 }));
  assert.deepEqual(arp, ['Dó', 'Mi', 'Sol', 'Dó', 'Mi', 'Sol', 'Dó']);
  assert.equal(buildExercise({ keyN: 0, type: 'major', octaves: 2 }).notes.length, 15);
});

test('ajusta a escala à extensão do instrumento', () => {
  const g = INSTRUMENT_PROFILES.guitar;
  const ex = buildExercise({ keyN: 0, type: 'major', octaves: 2, octave: 2, range: [g.lo, g.hi] });
  assert.ok(Math.min(...ex.notes.map((n) => n.step)) >= g.lo);
  const v = INSTRUMENT_PROFILES.violin;
  const hi = buildExercise({ keyN: 0, type: 'major', octaves: 2, octave: 7, range: [v.lo, v.hi] });
  assert.ok(Math.max(...hi.notes.map((n) => n.step)) <= v.hi);
});

test('NoteDetector: confirma notas, marca onset e solta no silêncio', () => {
  const d = new NoteDetector();
  const onsets = [];
  let t = 1000;
  const feed = (m, n) => {
    for (let i = 0; i < n; i++) {
      const r = d.update({ t, freq: m ? hz(m) : null, clarity: m ? 0.95 : 0 });
      if (r.onset) onsets.push(r.onset);
      t += 30;
    }
  };
  feed(60, 8); feed(null, 8); feed(64, 8); feed(67, 8);
  assert.equal(onsets.length, 3);
  assert.deepEqual(onsets.map((o) => Math.round(o.midi)), [60, 64, 67]);
  assert.equal(onsets[0].t, 1000);
});

test('NoteDetector: harmônico fugaz (oitava) não vira nota', () => {
  const d = new NoteDetector();
  const onsets = [];
  let t = 0;
  const feed = (m, n) => {
    for (let i = 0; i < n; i++) {
      const r = d.update({ t, freq: hz(m), clarity: 0.95 });
      if (r.onset) onsets.push(r.onset);
      t += 30;
    }
  };
  feed(60, 6); feed(72, 2); feed(60, 4);
  assert.equal(onsets.length, 1);
});

test('evaluateTimed: tempo, nota errada e notas ausentes', () => {
  const targets = [60, 62, 64, 65];
  const onsets = [{ t: 1010, midi: 60.1 }, { t: 1640, midi: 62 }, { t: 2000, midi: 61 }];
  const r = evaluateTimed({ targets, startMs: 1000, slotMs: 500, onsets });
  assert.deepEqual(r.results.map((x) => x.grade), ['perfect', 'good', 'wrong', 'none']);
  assert.equal(r.results[1].deltaMs, 140);
  assert.ok(r.score > 0.4 && r.score < 0.6);
  const strictT = evaluateTimed({ targets, startMs: 1000, slotMs: 500, onsets, rigor: 'hard' });
  assert.equal(strictT.results[1].grade, 'ok');
});

test('evaluateTimed: oitava errada só passa com "qualquer oitava"; compensação de latência', () => {
  const targets = [60];
  const strict = evaluateTimed({ targets, startMs: 0, slotMs: 500, onsets: [{ t: 20, midi: 72 }] });
  assert.equal(strict.results[0].grade, 'wrong');
  const any = evaluateTimed({ targets, startMs: 0, slotMs: 500, onsets: [{ t: 20, midi: 72 }], anyOctave: true });
  assert.equal(any.results[0].grade, 'perfect');
  const off = evaluateTimed({ targets, startMs: 0, slotMs: 500, onsets: [{ t: 100, midi: 60 }], offsetMs: 80 });
  assert.equal(off.results[0].grade, 'perfect');
});

test('NoteDetector: passo de semitom e nota repetida (ataque de energia)', () => {
  const d = new NoteDetector();
  const onsets = [];
  let t = 0;
  // m = nota (fracionária); r = volume; n = quadros de 30 ms
  const feed = (m, r, n) => {
    for (let i = 0; i < n; i++) {
      const out = d.update({ t, freq: m ? hz(m) : null, clarity: m ? 0.95 : 0, rms: r });
      if (out.onset) onsets.push(out.onset);
      t += 30;
    }
  };
  feed(null, 0.001, 6);
  feed(71.3, 0.2, 3); feed(71.3, 0.08, 9); // Si um pouco alto, decaindo
  feed(71.7, 0.25, 3); feed(71.7, 0.1, 9); // Dó um pouco baixo: só 0,4 semitom depois (ataque novo)
  feed(71.7, 0.3, 3); feed(71.7, 0.1, 9); // mesma nota repetida
  assert.equal(onsets.length, 3);
});

test('NoteDetector: vibrato e decaimento não geram notas a mais', () => {
  const d = new NoteDetector();
  let count = 0;
  let t = 0;
  for (let i = 0; i < 60; i++) {
    const out = d.update({ t, freq: hz(69 + 0.3 * Math.sin(i / 2)), clarity: 0.95, rms: 0.2 * 0.97 ** i });
    if (out.onset) count++;
    t += 30;
  }
  assert.equal(count, 1);
});

test('pairCalibration: mediana do atraso e cliques sem nota', () => {
  const clicks = [1000, 1750, 2500, 3250];
  const onsets = [{ t: 1130 }, { t: 1880 }, { t: 3390 }]; // 130, 130, (sem nota), 140
  const r = pairCalibration(clicks, onsets);
  assert.deepEqual(r.deltas, [130, 130, null, 140]);
  assert.equal(r.matched, 3);
  assert.equal(r.median, 130);
});

test('NoteDetector: nota longa depois do silêncio gera uma única nota', () => {
  const d = new NoteDetector();
  let t = 0;
  let count = 0;
  const feed = (m, r, n) => {
    for (let i = 0; i < n; i++) {
      const out = d.update({ t, freq: m ? hz(m) : null, clarity: m ? 0.95 : 0, rms: r });
      if (out.onset) count++;
      t += 30;
    }
  };
  feed(null, 0.001, 20);
  feed(60, 0.08, 1); feed(60, 0.2, 40); // sobe e sustenta por 1,2 s
  assert.equal(count, 1);
});

test('violino: escala de Sol maior começa no Sol da corda solta (Sol3) e cabe em 2 oitavas', () => {
  const v = INSTRUMENT_PROFILES.violin;
  const ex = buildExercise({ keyN: 1, type: 'major', octaves: 2, octave: v.defOct, range: [v.lo, v.hi] });
  assert.equal(noteName(ex.notes[0], { octave: true }), 'Sol3');
  assert.equal(noteName(ex.notes[ex.notes.length - 1], { octave: true }), 'Sol5');
});

test('summarizeTimed: categorias não se sobrepõem e extras ficam à parte', () => {
  const ev = {
    results: [
      { grade: 'perfect', cents: 3 }, { grade: 'good', cents: -5 }, { grade: 'ok', cents: 2 },
      { grade: 'wrong', cents: 43 }, { grade: 'wrong', cents: 300 }, { grade: 'none', cents: null },
    ],
    extra: 2,
  };
  assert.deepEqual(summarizeTimed(ev), {
    total: 6, onTime: 2, late: 1, offTune: 1, wrong: 1, none: 1, extra: 2, rightNotes: 3,
  });
});

test('alignScale: escala perfeita, nota errada, nota que faltou e nota repetida', () => {
  const exp = [60, 62, 64, 65];
  const p = (...ms) => ms.map((midi, t) => ({ midi, t }));
  const st = (r) => r.results.map((x) => x.status).join(',');
  assert.equal(st(alignScale(exp, p(60, 62, 64, 65))), 'ok,ok,ok,ok');
  assert.equal(st(alignScale(exp, p(60, 62, 63, 65))), 'ok,ok,wrong,ok'); // 63 no lugar de 64 (1 semitom: 100 cents = outra nota)
  assert.equal(st(alignScale(exp, p(60, 62, 65))), 'ok,ok,miss,ok');
  const retry = alignScale(exp, p(60, 62, 65, 64, 65)); // errou, tocou de novo
  assert.equal(st(retry), 'ok,ok,ok,ok');
  assert.equal(retry.extras, 1);
  const tune = alignScale(exp, p(60, 62.6, 64, 65)); // 60 cents alto: desafinada
  assert.equal(st(tune), 'ok,tune,ok,ok');
  assert.ok(Math.abs(tune.results[1].cents - 60) < 1e-6);
});

test('alignScale: qualquer oitava e nada tocado', () => {
  const r = alignScale([60, 62], [{ midi: 72, t: 0 }, { midi: 74, t: 1 }], { anyOctave: true });
  assert.deepEqual(r.results.map((x) => x.status), ['ok', 'ok']);
  const none = alignScale([60, 62], []);
  assert.deepEqual(none.results.map((x) => x.status), ['miss', 'miss']);
});
