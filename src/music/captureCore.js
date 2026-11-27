// Núcleo da captura de áudio: peças puras (testáveis fora do navegador) usadas pelo AudioWorklet, pelo Worker e pelo modo clássico.
//
// Caminho novo:   microfone → AudioWorklet (recorta blocos com a hora exata do relógio de áudio)
//                          → Worker (mede volume e afinação, fora da thread principal) → Mic (converte a hora e avisa as telas)
// Caminho clássico (reserva): AnalyserNode lido por setInterval na thread principal.
import { detectPitch } from './pitch.js';

export const WINDOW = 4096; // amostras analisadas por bloco (~85 ms a 48 kHz)
/** Passo entre blocos: ~30 ms (a cadência que o detector de notas já usava), nunca menor que um quantum de 128 amostras. */
export const hopFor = (sampleRate) => Math.max(128, Math.round(sampleRate * 0.03));

/**
 * Guarda as últimas `win` amostras e entrega um bloco a cada `hop` amostras, com a hora exata do fim dele.
 * Roda dentro do AudioWorklet (o texto desta classe é copiado para lá), então não pode usar nada de fora dela. hop ≥ 128.
 */
export class HopBuffer {
  constructor(win, hop) {
    this.win = win;
    this.hop = hop;
    this.ring = new Float32Array(win);
    this.w = 0;
    this.filled = 0;
    this.since = 0;
  }

  /** x: amostras novas; startSec: hora (relógio do contexto) da primeira; sr: taxa. Retorna { buf, endSec } ou null. */
  push(x, startSec, sr) {
    let out = null;
    for (let i = 0; i < x.length; i++) {
      this.ring[this.w] = x[i];
      this.w = (this.w + 1) % this.win;
      this.since++;
      if (this.filled < this.win) this.filled++;
      if (this.since >= this.hop && this.filled >= this.win) {
        this.since = 0;
        const buf = new Float32Array(this.win);
        buf.set(this.ring.subarray(this.w), 0);
        buf.set(this.ring.subarray(0, this.w), this.win - this.w);
        out = { buf, endSec: startSec + (i + 1) / sr };
      }
    }
    return out;
  }
}

/** Código do AudioWorklet (módulo de texto): recorta blocos e os envia direto ao Worker por uma porta, sem passar pela thread principal. */
export function workletSource() {
  return `const HopBuffer = ${HopBuffer.toString()};
class SolfejoCapture extends AudioWorkletProcessor {
  constructor(o) {
    super();
    const p = o.processorOptions;
    this.hb = new HopBuffer(p.win, p.hop);
    this.out = null;
    this.seq = 0;
    this.e0 = 0;
    this.e1 = 0;
    this.port.onmessage = (e) => { if (e.data && e.data.port) this.out = e.data.port; };
  }
  process(inputs) {
    const inp = inputs[0];
    if (!inp || !inp[0]) return true;
    let x = inp[0];
    if (inp[1]) {
      // microfones/interfaces estéreo: usa o canal que tem som (o outro pode estar vazio ou em oposição de fase)
      let a = 0, b = 0;
      for (let i = 0; i < x.length; i++) { a += x[i] * x[i]; b += inp[1][i] * inp[1][i]; }
      this.e0 = this.e0 * 0.98 + a;
      this.e1 = this.e1 * 0.98 + b;
      if (this.e1 > this.e0 * 2) x = inp[1];
    }
    const r = this.hb.push(x, currentTime, sampleRate);
    if (r && this.out) this.out.postMessage({ buf: r.buf, endSec: r.endSec, seq: this.seq++ }, [r.buf.buffer]);
    return true;
  }
}
registerProcessor('solfejo-capture', SolfejoCapture);`;
}

/**
 * Ataques de som numa série de volumes [{ t (ms), r (rms) }]: o volume sobe pelo menos `ratio` vezes em relação a 90–220 ms antes,
 * passa do chão de ruído (3×) e de um mínimo absoluto, e só conta um ataque a cada `refractoryMs`.
 */
export function findOnsets(levels, {
  floor = 0, minAbs = 0.008, ratio = 2.5, refractoryMs = 300,
} = {}) {
  const out = [];
  let last = -Infinity;
  for (let i = 0; i < levels.length; i++) {
    const { t, r } = levels[i];
    let lo = Infinity;
    for (let j = i - 1; j >= 0 && t - levels[j].t <= 220; j--) if (t - levels[j].t >= 90 && levels[j].r < lo) lo = levels[j].r;
    if (lo === Infinity) continue;
    if (r >= Math.max(minAbs, floor * 3, lo * ratio) && t - last > refractoryMs) { out.push({ t }); last = t; }
  }
  return out;
}

/** Medidas de um bloco: volume (rms e pico), volume só da parte grave/média (sem estalos agudos) e altura (YIN). */
export function analyzeBlock(buf, sampleRate, detect = {}, noPitch = false) {
  const n = buf.length;
  let s = 0;
  let pk = 0;
  for (let i = 0; i < n; i++) {
    const v = buf[i];
    s += v * v;
    const a = v < 0 ? -v : v;
    if (a > pk) pk = a;
  }
  const out = {
    rms: Math.sqrt(s / n), peak: pk, rmsLow: 0, freq: null, clarity: 0,
  };
  if (noPitch) return out;
  // volume só abaixo de ~1,8 kHz: estalos agudos, como o clique do metrônomo, quase não contam e não viram "ataques de nota"
  const alpha = 1 - Math.exp((-2 * Math.PI * 1800) / sampleRate);
  let y = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    y += alpha * (buf[i] - y);
    sum += y * y;
  }
  out.rmsLow = Math.sqrt(sum / n);
  const r = detectPitch(buf, sampleRate, detect);
  if (r) { out.freq = r.freq; out.clarity = r.clarity; }
  return out;
}

/**
 * Converte a hora do relógio de áudio para a do performance.now(). Lemos os dois juntos de tempos em tempos; como um atraso
 * na leitura só aumenta (performance − áudio), o menor valor recente é o mais fiel.
 */
export class ClockMap {
  constructor(max = 120) {
    this.max = max;
    this.s = [];
    this.off = 0;
  }

  add(ctxSec, perfMs) {
    this.s.push(perfMs - ctxSec * 1000);
    if (this.s.length > this.max) this.s.shift();
    this.off = Math.min(...this.s);
  }

  perfOf(ctxSec) {
    return ctxSec * 1000 + this.off;
  }
}

/** Regularidade dos quadros: desvio do intervalo entre horas e atraso de entrega (hora do quadro → chegada à tela). */
export class FrameStats {
  constructor(max = 200) {
    this.max = max;
    this.t = [];
    this.d = [];
  }

  add(tMs, deliverMs = 0) {
    this.t.push(tMs);
    this.d.push(deliverMs);
    if (this.t.length > this.max) { this.t.shift(); this.d.shift(); }
  }

  reset() { this.t = []; this.d = []; }

  summary() {
    const n = this.t.length;
    if (n < 3) return { n, dtMean: 0, dtStd: 0, dtMax: 0, deliverMean: 0, deliverMax: 0 };
    const dts = [];
    for (let i = 1; i < n; i++) dts.push(this.t[i] - this.t[i - 1]);
    const mean = dts.reduce((a, b) => a + b, 0) / dts.length;
    const std = Math.sqrt(dts.reduce((a, b) => a + (b - mean) ** 2, 0) / dts.length);
    return {
      n,
      dtMean: mean,
      dtStd: std,
      dtMax: Math.max(...dts),
      deliverMean: this.d.reduce((a, b) => a + b, 0) / n,
      deliverMax: Math.max(...this.d),
    };
  }
}
