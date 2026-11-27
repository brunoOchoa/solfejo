// Detecção de afinação (algoritmo YIN) — função pura, testável fora do navegador.

/**
 * Estima a frequência fundamental de um bloco de áudio.
 * Retorna { freq, clarity } ou null se não houver som afinado (silêncio, ruído).
 */
export function detectPitch(buf, sampleRate, { minFreq = 70, maxFreq = 1200, threshold = 0.15, minRms = 0.008 } = {}) {
  const n = buf.length;
  const W = Math.floor(n / 2);

  let sum = 0;
  for (let i = 0; i < n; i++) sum += buf[i] * buf[i];
  if (Math.sqrt(sum / n) < minRms) return null;

  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  const tauMax = Math.min(W - 2, Math.floor(sampleRate / minFreq));

  // Diferença cumulativa normalizada (CMNDF)
  const cmnd = new Float32Array(tauMax + 2);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    let d = 0;
    for (let j = 0; j < W; j++) {
      const diff = buf[j] - buf[j + tau];
      d += diff * diff;
    }
    running += d;
    cmnd[tau] = running === 0 ? 1 : (d * tau) / running;
  }

  // Primeiro vale abaixo do limiar; se não houver, o menor vale global.
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 <= tauMax && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) {
    let best = tauMin;
    for (let t = tauMin; t <= tauMax; t++) if (cmnd[t] < cmnd[best]) best = t;
    if (cmnd[best] > 0.4) return null;
    tau = best;
  }

  // Interpolação parabólica para precisão sub-amostra
  const a = cmnd[tau - 1];
  const b = cmnd[tau];
  const c = cmnd[tau + 1];
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? (a - c) / (2 * denom) : 0;
  const refined = tau + Math.max(-1, Math.min(1, shift));

  return { freq: sampleRate / refined, clarity: 1 - b };
}

/** Desvio em cents de f em relação a ref. */
export const centsBetween = (f, ref) => 1200 * Math.log2(f / ref);

/** MIDI (fracionário) de uma frequência, com Lá4 = 440 Hz. */
export const midiFromFreq = (f) => 69 + 12 * Math.log2(f / 440);
