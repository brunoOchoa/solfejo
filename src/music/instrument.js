// Prática de instrumento: perfis dos instrumentos, detecção de notas tocadas e avaliação com metrônomo.
import { midiFromFreq } from './pitch.js';
import { foldCents } from './melody.js';

/**
 * lo/hi: extensão escrita (passos: Dó4 = 28). transposeOct: o violão soa uma oitava abaixo do escrito.
 * mic: faixa de frequências (Hz) do que soa, para o detector de afinação.
 */
export const INSTRUMENT_PROFILES = {
  piano: { label: 'Teclado', icon: '🎹', lo: 14, hi: 49, octaves: [2, 3, 4, 5], defOct: 4, transposeOct: 0, mic: { minFreq: 60, maxFreq: 2200 } },
  violin: { label: 'Violino', icon: '🎻', lo: 25, hi: 51, octaves: [3, 4, 5], defOct: 3, transposeOct: 0, mic: { minFreq: 180, maxFreq: 3000 } },
  guitar: { label: 'Violão', icon: '🎸', lo: 23, hi: 44, octaves: [3, 4, 5], defOct: 4, transposeOct: -1, mic: { minFreq: 75, maxFreq: 1100 } },
};

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const spread = (a) => Math.max(...a) - Math.min(...a);

/**
 * Transforma frames ({t, freq, clarity, rms?}) em notas tocadas. Uma nota nova só é aceita depois de
 * `confirm` leituras seguidas parecidas (ignora ataque/ruído) e vira um "onset" no instante da
 * primeira leitura do grupo. Há dois jeitos de começar uma nota:
 *  - mudança de altura (> `changeSemis` semitons em relação à nota ativa; 1 semitom, como Mi→Fá, já conta);
 *  - ataque de energia (o volume sobe ≥ `attackRatio` vezes em relação ao último instante calmo): pega
 *    notas repetidas e passos de semitom mesmo com a afinação um pouco fora.
 * Saltos de oitava/quinta (harmônicos de uma nota que decai) exigem o dobro de confirmações.
 * update() → { t, midi (altura confirmada ou null), shown (altura crua p/ gráfico), onset: { t, midi } | null }
 */
export class NoteDetector {
  constructor({
    minClarity = 0.85, confirm = 3, maxSpread = 0.8, releaseMs = 140, changeSemis = 0.55, attackRatio = 2.2, attackMin = 0.01,
  } = {}) {
    Object.assign(this, {
      minClarity, confirm, maxSpread, releaseMs, changeSemis, attackRatio, attackMin,
    });
    this.reset();
  }

  reset() {
    this.buf = [];
    this.active = null;
    this.lastVoicedT = -Infinity;
    this.rmsHist = [];
    this.attack = null;
    this.lastOnsetT = -Infinity;
  }

  trackEnergy(frame) {
    if (frame.rms == null) return;
    const h = this.rmsHist;
    // compara com ~90–200 ms atrás: um platô (nota sustentada) não conta como ataque; um novo ataque sim
    const older = h.filter((x) => frame.t - x.t >= 90 && frame.t - x.t <= 200).map((x) => x.r);
    if (older.length) {
      const base = Math.min(...older);
      if (frame.rms >= Math.max(this.attackMin, base * this.attackRatio) && frame.t - this.lastOnsetT > 180
        && (!this.attack || frame.t - this.attack.t > 200)) {
        this.attack = { t: frame.t };
      }
    }
    h.push({ t: frame.t, r: frame.rms });
    if (h.length > 12) h.shift();
  }

  update(frame) {
    this.trackEnergy(frame);
    const voiced = frame.freq && frame.clarity >= this.minClarity;
    if (!voiced) {
      this.buf = [];
      if (this.active && frame.t - this.lastVoicedT > this.releaseMs) this.active = null;
      return { t: frame.t, midi: this.active ? this.active.midi : null, shown: null, onset: null };
    }
    this.lastVoicedT = frame.t;
    const m = midiFromFreq(frame.freq);
    this.buf.push({ t: frame.t, m });
    if (this.buf.length > 12) this.buf.shift();
    const shown = median(this.buf.slice(-3).map((x) => x.m)); // altura "crua", para o gráfico (sem esperar confirmação)

    let need = this.confirm;
    if (this.active) {
      const d = Math.abs(m - this.active.midi);
      if ([12, 19, 24].some((x) => Math.abs(d - x) <= 0.8)) need = this.confirm * 2;
    }
    const recent = this.buf.slice(-need);
    if (recent.length < need || spread(recent.map((x) => x.m)) > this.maxSpread) {
      return { t: frame.t, midi: this.active ? this.active.midi : null, shown, onset: null };
    }
    const est = median(recent.map((x) => x.m));
    let onset = null;
    const changed = !this.active || Math.abs(est - this.active.midi) > this.changeSemis;
    const attacked = this.attack && recent[recent.length - 1].t - this.attack.t <= 400;
    if (changed || attacked) {
      const t0 = recent[0].t;
      const t = this.attack && Math.abs(t0 - this.attack.t) <= 300 ? Math.min(t0, this.attack.t) : t0;
      onset = { t, midi: est };
      this.active = { midi: est };
      this.lastOnsetT = frame.t;
      this.attack = null;
    } else {
      this.active.midi = est;
    }
    return { t: frame.t, midi: est, shown, onset };
  }
}

/** Desvio (cents) de `midi` em relação ao alvo; com anyOctave, ignora a oitava. */
export const centsOff = (midi, target, anyOctave = false) => {
  const c = (midi - target) * 100;
  return anyOctave ? foldCents(c) : c;
};

export const TIMING = { perfect: 90, good: 180 }; // ms (multiplicados pelo rigor)
export const TIMING_RIGOR = { easy: 1.4, normal: 1, hard: 0.7 };
export const GRADE_POINTS = { perfect: 1, good: 0.85, ok: 0.6, wrong: 0, none: 0 };

/**
 * Avalia uma passagem com metrônomo. targets: alturas soantes (MIDI) esperadas, uma por fatia de
 * `slotMs` a partir de `startMs`. onsets: notas detectadas ({t, midi}). Cada fatia aceita um onset
 * dentro de ± meia fatia do tempo esperado. Notas: perfect | good | ok (certa, mas fora do tempo)
 * | wrong (outra nota) | none (nada tocado). `upTo`: só avalia até esse índice (avaliação ao vivo).
 */
export function evaluateTimed({
  targets, startMs, slotMs, onsets, tolCents = 40, anyOctave = false, rigor = 'normal', offsetMs = 0, upTo = Infinity, extraMs = 0,
}) {
  const used = new Set();
  const scale = TIMING_RIGOR[rigor] || 1;
  // figuras rápidas têm fatias curtas: as faixas de tempo encolhem junto (sem mudar nada para fatias ≥ 410 ms)
  const tPerfect = Math.min(TIMING.perfect, slotMs * 0.22);
  const tGood = Math.min(TIMING.good, slotMs * 0.4);
  const results = [];
  for (let i = 0; i < targets.length; i++) {
    const T = startMs + i * slotMs;
    if (i > upTo) { results.push(null); continue; }
    const cand = [];
    onsets.forEach((o, k) => {
      const t = o.t - offsetMs;
      if (!used.has(k) && t >= T - slotMs / 2 && t < T + slotMs / 2) cand.push({ o, k, t });
    });
    if (!cand.length) { results.push({ grade: 'none', cents: null, deltaMs: null, played: null }); continue; }
    const hit = cand.find(({ o }) => Math.abs(centsOff(o.midi, targets[i], anyOctave)) <= tolCents);
    if (!hit) {
      used.add(cand[0].k);
      results.push({
        grade: 'wrong', cents: centsOff(cand[0].o.midi, targets[i], anyOctave), deltaMs: cand[0].t - T, played: cand[0].o.midi,
      });
      continue;
    }
    used.add(hit.k);
    const delta = hit.t - T;
    const a = Math.abs(delta);
    const grade = a <= tPerfect * scale + extraMs ? 'perfect' : a <= tGood * scale + extraMs ? 'good' : 'ok'; // extraMs: folga para equipamento instável
    results.push({ grade, cents: centsOff(hit.o.midi, targets[i], anyOctave), deltaMs: delta, played: hit.o.midi });
  }
  const done = results.filter(Boolean);
  const extra = onsets.filter((o, k) => !used.has(k)
    && o.t - offsetMs >= startMs - slotMs / 2 && o.t - offsetMs < startMs + targets.length * slotMs).length;
  const score = done.length ? done.reduce((s, r) => s + GRADE_POINTS[r.grade], 0) / done.length : 0;
  const matched = done.filter((r) => r.deltaMs !== null && r.grade !== 'wrong');
  return {
    results,
    score,
    extra,
    medianDelta: matched.length ? median(matched.map((r) => r.deltaMs)) : 0,
    meanCents: matched.length ? matched.reduce((s, r) => s + r.cents, 0) / matched.length : 0,
    matched: matched.length,
  };
}

/**
 * Calibração: casa cada clique (ms) com a nota tocada mais próxima (até `maxMs`). Retorna os desvios
 * (positivo = você foi lido depois do clique), `null` onde não houve nota, e a mediana.
 */
export function pairCalibration(clicks, onsets, maxMs = 380) {
  const used = new Set();
  const deltas = clicks.map((ct) => {
    let best = -1;
    let bd = Infinity;
    onsets.forEach((o, k) => {
      const d = Math.abs(o.t - ct);
      if (!used.has(k) && d < bd) { bd = d; best = k; }
    });
    if (best < 0 || bd > maxMs) return null;
    used.add(best);
    return onsets[best].t - ct;
  });
  const got = deltas.filter((d) => d !== null);
  return {
    deltas, matched: got.length, median: got.length ? median(got) : 0, spread: got.length ? spread(got) : 0,
  };
}

/**
 * Resumo de uma avaliação com metrônomo, em categorias que não se sobrepõem:
 * onTime (nota certa, no tempo), late (nota certa, fora do tempo), offTune (nota certa mas desafinada,
 * a menos de 1 semitom do alvo), wrong (outra nota), none (nada tocado). extra = toques sem nota na pauta.
 */
export function summarizeTimed(ev) {
  const r = ev.results.filter(Boolean);
  const count = (fn) => r.filter(fn).length;
  const onTime = count((x) => x.grade === 'perfect' || x.grade === 'good');
  const late = count((x) => x.grade === 'ok');
  const offTune = count((x) => x.grade === 'wrong' && x.cents != null && Math.abs(x.cents) < 100);
  const wrong = count((x) => x.grade === 'wrong') - offTune;
  const none = count((x) => x.grade === 'none');
  return {
    total: r.length, onTime, late, offTune, wrong, none, extra: ev.extra, rightNotes: onTime + late,
  };
}

/**
 * Prática livre: alinha o que foi tocado (notas em ordem) com a escala esperada, sem olhar o tempo.
 * Alinhamento por programação dinâmica: casar nota certa custa 0, afinação a menos de 1 semitom custa 0,45,
 * outra nota custa 1 e pular/sobrar uma nota custa 1 (então tocar de novo uma nota que errou vira "nota a mais",
 * e uma nota errada no lugar de outra é "outra nota", não uma falta e uma sobra).
 * Retorna results[i] = { status: 'ok'|'tune'|'wrong'|'miss', played, cents } por nota esperada,
 * playedStatus[j] ('ok'|'tune'|'wrong'|'extra') por nota tocada e extras (quantas sobraram).
 */
export function alignScale(expected, played, { tol = 40, anyOctave = false } = {}) {
  const n = expected.length;
  const m = played.length;
  const cents = (i, j) => centsOff(played[j].midi, expected[i], anyOctave);
  const subCost = (i, j) => {
    const a = Math.abs(cents(i, j));
    return a <= tol ? 0 : a < 100 ? 0.45 : 1;
  };
  const D = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) D[i][0] = i;
  for (let j = 1; j <= m; j++) D[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      D[i][j] = Math.min(D[i - 1][j - 1] + subCost(i - 1, j - 1), D[i - 1][j] + 1, D[i][j - 1] + 1);
    }
  }
  const results = new Array(n).fill(null).map(() => ({ status: 'miss', played: null, cents: null }));
  const playedStatus = new Array(m).fill('extra');
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && Math.abs(D[i][j] - (D[i - 1][j - 1] + subCost(i - 1, j - 1))) < 1e-9) {
      const c = cents(i - 1, j - 1);
      const a = Math.abs(c);
      const status = a <= tol ? 'ok' : a < 100 ? 'tune' : 'wrong';
      results[i - 1] = { status, played: played[j - 1].midi, cents: c };
      playedStatus[j - 1] = status;
      i--; j--;
    } else if (i > 0 && Math.abs(D[i][j] - (D[i - 1][j] + 1)) < 1e-9) {
      i--; // nota esperada que não foi tocada
    } else {
      j--; // nota tocada a mais
    }
  }
  return { results, playedStatus, extras: playedStatus.filter((x) => x === 'extra').length };
}
