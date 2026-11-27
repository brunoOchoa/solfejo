import test from 'node:test';
import assert from 'node:assert/strict';
import {
  outputKind, normLabel, profileKey, profileTitle, micStatus, calStats, calVerdict, extraTolerance, toDb,
} from '../src/music/audioProfile.js';

test('tipo de saída pelo nome', () => {
  assert.equal(outputKind('Default - AirPods Pro'), 'bluetooth');
  assert.equal(outputKind('Galaxy Buds2 Pro'), 'bluetooth');
  assert.equal(outputKind('Alto-falantes (Realtek(R) Audio)'), 'speaker');
  assert.equal(outputKind('MacBook Pro Speakers'), 'speaker');
  assert.equal(outputKind('Headphones (USB-C)'), 'wired');
  assert.equal(outputKind(''), 'unknown');
});

test('chave do perfil ignora prefixo e id de hardware', () => {
  const a = profileKey('Default - Microphone (HyperX QuadCast) (0951:16df)', 'Fones (USB)');
  const b = profileKey('Microphone (HyperX QuadCast)', 'Fones (USB)');
  assert.equal(a, b);
  assert.equal(normLabel('Default - Microphone (HyperX QuadCast) (0951:16df)'), 'microphone hyperx quadcast');
  assert.match(profileTitle(a), /fone com fio/);
  assert.equal(profileKey('', ''), 'desconhecido|unknown');
});

test('estado do sinal', () => {
  const ok = { active: true, spanMs: 8000 };
  assert.equal(micStatus({ active: false }).state, 'off');
  assert.equal(micStatus({ ...ok, muted: true }).state, 'dead');
  assert.equal(micStatus({ ...ok, shortPeakDb: -0.2, longPeakDb: -0.2 }).state, 'clip');
  assert.equal(micStatus({ ...ok, shortPeakDb: -90, longPeakDb: -90 }).state, 'dead');
  assert.equal(micStatus({ active: true, spanMs: 1000, longPeakDb: -90 }).state, 'ok'); // pouco tempo de observação
  assert.equal(micStatus({ ...ok, longPeakDb: -40, expectSound: true }).state, 'low');
  assert.equal(micStatus({ ...ok, longPeakDb: -40, expectSound: false }).state, 'ok');
  assert.equal(micStatus({ ...ok, longPeakDb: -12, expectSound: true }).text, 'Sinal bom');
  assert.equal(toDb(0), -100);
  assert.ok(Math.abs(toDb(1)) < 1e-9);
});

test('estatística e veredito da calibração', () => {
  const st = calStats([100, 110, 90, null, 105, 95, 100, 102]);
  assert.equal(st.n, 7);
  assert.equal(st.median, 100);
  assert.ok(st.std < 10);
  assert.equal(calVerdict(st).level, 'ok');
  assert.equal(calVerdict({ n: 3, std: 5 }).level, 'bad');
  assert.equal(calVerdict({ n: 8, std: 40 }).level, 'warn');
  assert.equal(calVerdict({ n: 8, std: 90 }).level, 'bad');
  assert.deepEqual(calStats([null, null]), { n: 0, median: 0, std: 0, range: 0 });
});

test('folga extra para equipamento instável', () => {
  assert.equal(extraTolerance(10), 0);
  assert.equal(extraTolerance(45), 10);
  assert.equal(extraTolerance(200), 60);
});

import { clickLeak } from '../src/music/audioProfile.js';

test('vazamento do clique na contagem', () => {
  const clicks = [1000, 1750, 2500, 3250];
  assert.equal(clickLeak(clicks, [1040, 1790, 2530, 3290]), 4); // ataques logo depois de cada clique
  assert.equal(clickLeak(clicks, []), 0);
  assert.equal(clickLeak(clicks, [1500, 2200]), 0); // sons que não coincidem com os cliques
  assert.equal(clickLeak(clicks, [1100]), 1);
});

import { snrAdvice } from '../src/music/audioProfile.js';

test('diferença entre sinal e ruído: conselhos', () => {
  assert.equal(snrAdvice({ noiseDb: -40, signalDb: -12, peakDb: -4 }).level, 'ok'); // 28 dB
  const mid = snrAdvice({ noiseDb: -40, signalDb: -22, peakDb: -10 });
  assert.equal(mid.level, 'warn');
  assert.match(mid.text, /aumentar o ganho/);
  const bad = snrAdvice({ noiseDb: -40, signalDb: -32, peakDb: -20 });
  assert.equal(bad.level, 'bad');
  assert.match(bad.text, /Aproxime/);
  const clip = snrAdvice({ noiseDb: -40, signalDb: -6, peakDb: -0.2 });
  assert.equal(clip.level, 'bad');
  assert.match(clip.text, /estourando/);
  assert.equal(snrAdvice({ noiseDb: -60, signalDb: -20, peakDb: -6 }).snr, 40);
});
