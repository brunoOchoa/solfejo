import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HopBuffer, analyzeBlock, ClockMap, FrameStats, hopFor, WINDOW, workletSource,
} from '../src/music/captureCore.js';

const SR = 48000;
const sine = (f, n, amp = 0.3, start = 0) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * f * (start + i)) / SR));

test('HopBuffer: blocos na cadência certa, ordenados e com a hora exata do fim', () => {
  const hb = new HopBuffer(512, 300);
  const out = [];
  let idx = 0;
  for (let q = 0; q < 40; q++) {
    const x = Float32Array.from({ length: 128 }, (_, i) => idx + i);
    const r = hb.push(x, idx / SR, SR);
    if (r) out.push({ ...r, endIdx: idx + 128 }); // endIdx só aproxima; conferimos pelo conteúdo
    idx += 128;
  }
  assert.ok(out.length >= 10);
  for (const b of out) {
    const last = b.buf[b.buf.length - 1];
    assert.equal(b.buf[0], last - 511, 'amostras seguidas, da mais antiga à mais nova');
    assert.ok(Math.abs(b.endSec - (last + 1) / SR) < 1e-9, 'hora do fim = hora da última amostra');
  }
  for (let i = 1; i < out.length; i++) assert.ok(Math.abs(out[i].endSec - out[i - 1].endSec - 300 / SR) < 1e-9, 'intervalo fixo de hop amostras');
});

test('HopBuffer: só entrega depois de encher a janela', () => {
  const hb = new HopBuffer(1024, 256);
  let first = null;
  let pushed = 0;
  while (!first) { first = hb.push(new Float32Array(128), pushed / SR, SR); pushed += 128; }
  assert.equal(pushed, 1024);
});

test('hop de ~30 ms e janela de 4096', () => {
  assert.equal(hopFor(48000), 1440);
  assert.equal(hopFor(44100), 1323);
  assert.ok(hopFor(1000) >= 128);
  assert.equal(WINDOW, 4096);
});

test('código do worklet contém a classe e registra o processador', () => {
  const src = workletSource();
  assert.match(src, /registerProcessor\('solfejo-capture'/);
  assert.match(src, /class\s*\{?/);
  // o texto copiado da classe tem que funcionar sozinho
  const HB = new Function(`return ${HopBuffer.toString()}`)();
  const hb = new HB(256, 128);
  let r = null;
  for (let i = 0; i < 3; i++) r = hb.push(new Float32Array(128), 0, SR) || r;
  assert.ok(r);
});

test('análise do bloco: volume, afinação e silêncio', () => {
  const a = analyzeBlock(sine(196, WINDOW), SR, { minFreq: 150, maxFreq: 1000 });
  assert.ok(Math.abs(a.freq - 196) < 1, `freq ${a.freq}`);
  assert.ok(a.clarity > 0.9);
  assert.ok(Math.abs(a.rms - 0.3 / Math.SQRT2) < 0.01);
  assert.ok(Math.abs(a.peak - 0.3) < 0.01);
  const q = analyzeBlock(new Float32Array(WINDOW), SR);
  assert.equal(q.freq, null);
  assert.equal(q.rms, 0);
  const np = analyzeBlock(sine(196, WINDOW), SR, {}, true);
  assert.equal(np.freq, null);
  assert.ok(np.rms > 0.2);
});

test('ClockMap: o menor desvio recente vence os atrasos de leitura', () => {
  const m = new ClockMap();
  const trueOff = 5000; // performance = áudio + 5000 ms
  for (let k = 0; k < 50; k++) {
    const ctx = k * 0.1;
    const stale = k % 7 === 0 ? 0 : 3 + (k % 5); // leituras atrasadas de 3 a 7 ms; uma em cada sete é fresca
    m.add(ctx, ctx * 1000 + trueOff + stale);
  }
  assert.ok(Math.abs(m.perfOf(2.0) - (2000 + trueOff)) < 0.001);
});

test('FrameStats: intervalos regulares dão desvio ~0; intervalos irregulares, não', () => {
  const ok = new FrameStats();
  for (let i = 0; i < 50; i++) ok.add(i * 30, 12);
  const a = ok.summary();
  assert.ok(a.dtStd < 1e-9);
  assert.equal(Math.round(a.dtMean), 30);
  assert.equal(a.deliverMax, 12);
  const bad = new FrameStats();
  let t = 0;
  for (let i = 0; i < 50; i++) { t += i % 5 === 0 ? 90 : 20; bad.add(t, 0); }
  assert.ok(bad.summary().dtStd > 20);
  assert.equal(bad.summary().dtMax, 90);
  assert.equal(new FrameStats().summary().n, 0);
});

import { findOnsets } from '../src/music/captureCore.js';

test('ataques de som: acha o início de cada toque e ignora ruído e repetição', () => {
  const lv = [];
  for (let t = 0; t <= 3000; t += 30) {
    let r = 0.004; // ruído
    if (t >= 500 && t < 800) r = 0.2;
    if (t >= 1500 && t < 1800) r = 0.15;
    if (t >= 1560 && t < 1600) r = 0.3; // oscilação dentro do mesmo toque
    lv.push({ t, r });
  }
  const on = findOnsets(lv, { floor: 0.004 });
  assert.equal(on.length, 2);
  assert.ok(on[0].t >= 500 && on[0].t <= 620);
  assert.ok(on[1].t >= 1500 && on[1].t <= 1620);
  assert.equal(findOnsets(lv.map((x) => ({ t: x.t, r: 0.004 })), { floor: 0.004 }).length, 0);
});
