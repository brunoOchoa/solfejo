import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSong, starsFor } from '../src/music/songEval.js';
import { getSong } from '../src/music/songs.js';

const song = getSong('song-of-the-wind');
const beatMs = 750; // 80 bpm
const START = 10000;
const onsetFor = (e, dt = 0, midi = e.midi) => ({ t: START + e.startBeat * beatMs + dt, midi });

test('toca tudo no tempo: nota máxima e nenhuma sobra', () => {
  const onsets = song.notes.map((e) => onsetFor(e, 12));
  const ev = evaluateSong({ events: song.events, onsets, startMs: START, beatMs });
  assert.equal(ev.results.filter(Boolean).length, song.notes.length);
  assert.ok(ev.results.filter(Boolean).every((r) => r.grade === 'perfect'));
  assert.equal(ev.score, 1);
  assert.equal(ev.extra, 0);
  song.events.filter((e) => e.rest).forEach((e) => assert.equal(ev.results[e.idx], null)); // pausa não vale nota
});

test('atraso grande, nota errada e nota que faltou', () => {
  const evs = song.notes;
  const onsets = evs.map((e, i) => {
    if (i === 3) return onsetFor(e, 170); // atrasada, mas certa
    if (i === 5) return onsetFor(e, 0, e.midi + 3); // outra nota
    return onsetFor(e, 0);
  }).filter((_, i) => i !== 7); // a nota 7 não foi tocada
  const ev = evaluateSong({ events: song.events, onsets, startMs: START, beatMs });
  const r = (i) => ev.results[evs[i].idx];
  assert.equal(r(3).grade, 'ok');
  assert.equal(r(5).grade, 'wrong');
  assert.equal(r(7).grade, 'none');
  assert.equal(r(0).grade, 'perfect');
  assert.ok(ev.score < 1 && ev.score > 0.8);
});

test('notas repetidas (Mi Mi Mi Mi) casam cada uma com o seu toque', () => {
  const four = song.notes.slice(4, 8); // E E E E em colcheias
  const onsets = four.map((e, i) => onsetFor(e, i % 2 ? 25 : -20));
  const ev = evaluateSong({ events: song.events, onsets, startMs: START, beatMs, upTo: four[3].idx });
  four.forEach((e) => assert.ok(['perfect', 'good'].includes(ev.results[e.idx].grade)));
  assert.equal(ev.extra, 0);
});

test('afinação fora da tolerância vira "outra nota"; folga extra aceita mais atraso', () => {
  const e = song.notes[0];
  const sharp = evaluateSong({ events: song.events, onsets: [onsetFor(e, 0, e.midi + 0.8)], startMs: START, beatMs, upTo: e.idx });
  assert.equal(sharp.results[e.idx].grade, 'wrong');
  const late = [onsetFor(e, 170)];
  assert.equal(evaluateSong({ events: song.events, onsets: late, startMs: START, beatMs, upTo: e.idx }).results[e.idx].grade, 'ok');
  assert.ok(['perfect', 'good'].includes(evaluateSong({
    events: song.events, onsets: late, startMs: START, beatMs, upTo: e.idx, extraMs: 60,
  }).results[e.idx].grade));
});

test('estrelas', () => {
  assert.equal(starsFor(0.95), 3);
  assert.equal(starsFor(0.75), 2);
  assert.equal(starsFor(0.5), 1);
  assert.equal(starsFor(0.2), 0);
});
