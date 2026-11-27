// Suavização das leituras de afinação e detecção de "nota sustentada".
import { midiFromFreq } from './pitch.js';

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const spread = (a) => Math.max(...a) - Math.min(...a);
const lowpassAlpha = (cutoffHz, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoffHz * dt));

/** Níveis de suavização do gráfico (maior suavidade = linha mais calma, com um pouco mais de atraso). */
export const SMOOTHING = {
  soft: { minCutoff: 0.45, beta: 0.12 },
  normal: { minCutoff: 0.7, beta: 0.2 },
  fast: { minCutoff: 1.4, beta: 0.4 },
};

/**
 * Transforma frames crus ({t, freq, clarity}) numa altura (MIDI fracionário) estável:
 *  - descarta leituras de baixa clareza;
 *  - exige 3 leituras consistentes para aceitar uma nota após o silêncio (ataque da voz);
 *  - mediana móvel remove picos isolados (erros de oitava/quinta do detector);
 *  - um salto grande só vale se se repetir (troca real de nota);
 *  - filtro "One Euro": suaviza forte quando a voz está firme (tremor/vibrato) e acompanha
 *    rápido quando a altura realmente muda (deslizes e trocas de nota);
 *  - segura o último valor por alguns ms em falhas curtas (evita piscar).
 */
export class PitchSmoother {
  constructor({
    minClarity = 0.8, size = 5, maxJump = 4, confirm = 3, holdMs = 220,
    minCutoff = SMOOTHING.normal.minCutoff, beta = SMOOTHING.normal.beta, dCutoff = 1,
  } = {}) {
    Object.assign(this, { minClarity, size, maxJump, confirm, holdMs, minCutoff, beta, dCutoff });
    this.reset();
  }

  /** Troca o nível de suavização sem perder o estado. */
  configure({ minCutoff, beta }) {
    Object.assign(this, { minCutoff, beta });
  }

  reset() {
    this.win = [];
    this.x = null; // altura filtrada (MIDI)
    this.dx = 0; // velocidade filtrada (semitons/s)
    this.lastT = 0;
    this.outliers = [];
    this.pending = [];
    this.lastVoicedT = -Infinity;
  }

  restart(value, t) {
    this.x = value;
    this.dx = 0;
    this.lastT = t;
  }

  filter(value, t) {
    if (this.x == null) return this.restart(value, t), this.x;
    const dt = Math.max(0.005, (t - this.lastT) / 1000);
    this.lastT = t;
    this.dx += lowpassAlpha(this.dCutoff, dt) * ((value - this.x) / dt - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += lowpassAlpha(cutoff, dt) * (value - this.x);
    return this.x;
  }

  update(frame) {
    const voiced = frame.freq && frame.clarity >= this.minClarity;
    if (!voiced) {
      this.pending = [];
      return this.hold(frame.t);
    }

    const m = midiFromFreq(frame.freq);

    // Ataque da voz: só aceita uma nota nova depois de 3 leituras consistentes seguidas
    // (descarta cliques, respiração e transientes que enganam o detector).
    if (this.win.length === 0) {
      this.pending.push(m);
      if (this.pending.length > 3) this.pending.shift();
      if (this.pending.length < 3 || spread(this.pending) > 1.5) return { t: frame.t, midi: null, held: false };
      this.win = [...this.pending];
      this.restart(median(this.pending), frame.t);
      this.pending = [];
      this.lastVoicedT = frame.t;
      return { t: frame.t, midi: this.x, held: false };
    }

    if (this.win.length >= 3 && Math.abs(m - median(this.win)) > this.maxJump) {
      this.outliers.push(m);
      if (this.outliers.length > this.confirm) this.outliers.shift();
      if (this.outliers.length >= this.confirm && spread(this.outliers) <= 2) {
        this.win = [...this.outliers];
        this.restart(median(this.outliers), frame.t); // troca real de nota: sem atraso
        this.outliers = [];
      } else {
        return this.hold(frame.t);
      }
    } else {
      this.outliers = [];
      this.win.push(m);
      if (this.win.length > this.size) this.win.shift();
      this.filter(median(this.win), frame.t);
    }
    this.lastVoicedT = frame.t;
    return { t: frame.t, midi: this.x, held: false };
  }

  hold(t) {
    const dt = t - this.lastVoicedT;
    if (this.x != null && dt <= this.holdMs) return { t, midi: this.x, held: true };
    if (dt > 400) {
      this.win = [];
      this.x = null;
      this.outliers = [];
      this.pending = [];
    }
    return { t, midi: null, held: false };
  }
}

/** Mede por quanto tempo a voz ficou dentro da tolerância (em cents) da nota alvo. */
export class HoldTracker {
  constructor({ tolCents = 25, holdMs = 800, graceMs = 160 } = {}) {
    Object.assign(this, { tolCents, holdMs, graceMs });
    this.reset();
  }

  reset() {
    this.since = null;
    this.lastIn = -Infinity;
  }

  /** cents = desvio da nota alvo, ou null se não há voz. */
  update(t, cents) {
    const inTol = cents !== null && Math.abs(cents) <= this.tolCents;
    if (inTol) {
      if (this.since === null) this.since = t;
      this.lastIn = t;
    } else if (this.since !== null && t - this.lastIn > this.graceMs) {
      this.since = null;
    }
    const progress = this.since === null ? 0 : Math.min(1, (this.lastIn - this.since) / this.holdMs);
    return { progress, done: progress >= 1, inTol };
  }
}
