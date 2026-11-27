// Reconhecimento de acordes pelo microfone: espectro → "cromagrama" (energia em cada uma das 12 notas) → comparação com o acorde-alvo.
// O detector de afinação do app só ouve uma nota por vez; aqui várias notas soam juntas e importa quais notas estão presentes.

const mod12 = (n) => ((n % 12) + 12) % 12;
export const SILENCE_DB = -72; // abaixo disso (pico do espectro) consideramos silêncio

/**
 * db: espectro em dB (como o AnalyserNode.getFloatFrequencyData). Retorna { chroma[12] somando 1, level (dB do pico) } ou
 * { chroma: null } quando está quieto demais.
 */
export function chromaFromSpectrum(db, sampleRate, { fmin = 75, fmax = 2200 } = {}) {
  const n = db.length;
  const binHz = sampleRate / (2 * n);
  const lo = Math.max(2, Math.floor(fmin / binHz));
  const hi = Math.min(n - 2, Math.ceil(fmax / binHz));
  let peak = -Infinity;
  for (let i = lo; i <= hi; i++) if (db[i] > peak) peak = db[i];
  if (!(peak > SILENCE_DB)) return { chroma: null, level: peak };
  const amp = (i) => 10 ** ((db[i] - peak) / 20); // 1 = pico
  const chroma = new Array(12).fill(0);
  let total = 0;
  for (let i = lo; i <= hi; i++) {
    const a = amp(i);
    if (a < 0.05 || db[i] <= db[i - 1] || db[i] < db[i + 1]) continue; // só picos
    // interpolação parabólica em dB para achar a frequência do pico
    const a0 = db[i - 1];
    const a1 = db[i];
    const a2 = db[i + 1];
    const den = a0 - 2 * a1 + a2;
    const off = den ? (0.5 * (a0 - a2)) / den : 0;
    const f = (i + Math.max(-0.5, Math.min(0.5, off))) * binHz;
    const midi = 69 + 12 * Math.log2(f / 440);
    const r = Math.round(midi);
    if (Math.abs(midi - r) > 0.45) continue; // entre duas notas: não conta
    const w = a ** 0.7;
    chroma[mod12(r)] += w;
    total += w;
  }
  if (!total) return { chroma: null, level: peak };
  return { chroma: chroma.map((x) => x / total), level: peak };
}

// Uma nota real soa com harmônicos (2ª, 3ª, 4ª, 5ª, 6ª…). Em notas (0–11) eles caem em: mesma nota, +7 (quinta), +4 (terça maior)...
const HARMONIC_SHIFT = [0, 0, 7, 0, 4, 7];
/** Cromagrama esperado de um acorde, harmônicos incluídos (amplitude 1/h), somando 1. */
function template(pcs) {
  const t = new Array(12).fill(0);
  for (const p of new Set(pcs)) HARMONIC_SHIFT.forEach((sh, k) => { t[(p + sh) % 12] += 1 / (k + 1); });
  const sum = t.reduce((a, b) => a + b, 0);
  return t.map((x) => x / sum);
}

/**
 * Compara o cromagrama com o acorde-alvo (pcs). `similarity` = cosseno com o cromagrama esperado do acorde (harmônicos
 * incluídos); `tones[i]` = quanto de cada nota do acorde apareceu, em relação ao esperado (1 = como o esperado);
 * `missing` = notas que quase não aparecem; `extras` = notas de fora que sobram depois de descontar o acorde.
 * ok = acorde completo e limpo.
 */
export function matchChord(chroma, pcs) {
  const set = [...new Set(pcs)];
  if (!chroma) return { ok: false, similarity: 0, share: 0, tones: set.map(() => 0), missing: set, present: [], extras: [] };
  const t = template(set);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < 12; i++) { dot += chroma[i] * t[i]; na += chroma[i] ** 2; nb += t[i] ** 2; }
  const similarity = dot / Math.sqrt(na * nb || 1);
  const fit = Math.max(0, Math.min(1.3, dot / (nb || 1)));
  const tones = set.map((p) => chroma[p] / (t[p] || 1));
  const missing = set.filter((p, k) => tones[k] < 0.4);
  const extras = chroma.map((v, p) => ({ p, r: v - fit * t[p] })).filter((x) => !set.includes(x.p) && x.r >= 0.07).sort((a, b) => b.r - a.r).map((x) => x.p);
  return {
    ok: similarity >= 0.85 && !missing.length,
    similarity,
    share: similarity,
    tones,
    missing,
    present: set.filter((p, k) => tones[k] >= 0.5),
    extras,
  };
}

/** Notas (0–11) com energia relevante no cromagrama, da mais forte para a mais fraca. */
export function heardPcs(chroma, min = 0.09) {
  if (!chroma) return [];
  return chroma.map((v, p) => ({ v, p })).filter((x) => x.v >= min).sort((a, b) => b.v - a.v).map((x) => x.p);
}

export const GRADE_POINTS = { perfect: 1, good: 0.85, ok: 0.6, wrong: 0, none: 0 };

/**
 * Avalia acordes no tempo do metrônomo. samples: [{ t (ms), chroma | null, level }]; chords: [{ pcs }]; cada acorde vale uma fatia
 * `slotMs` a partir de `startMs`. O acorde conta quando fica certo por 2 leituras seguidas na fatia (de um pouco antes até o fim).
 * perfect/good/ok (certo, mas fora do tempo) | wrong (tocou algo, mas não o acorde) | none (silêncio). `upTo`: avalia até esse índice.
 */
export function evaluateChordsTimed({
  chords, samples, startMs, slotMs, offsetMs = 0, rigor = 1, upTo = Infinity, extraMs = 0,
}) {
  const tPerfect = Math.min(260, slotMs * 0.25) * rigor + extraMs;
  const tGood = Math.min(520, slotMs * 0.45) * rigor + extraMs;
  const results = chords.map((c, i) => {
    if (i > upTo) return null;
    const T = startMs + i * slotMs;
    const win = samples.filter((s) => {
      const t = s.t - offsetMs;
      return t >= T - slotMs * 0.35 && t < T + slotMs;
    });
    let hitT = null;
    let run = 0;
    let loud = false;
    const acc = new Array(12).fill(0);
    for (const s of win) {
      if (s.chroma) {
        loud = true;
        s.chroma.forEach((v, p) => { acc[p] += v; });
      }
      const ok = s.chroma && matchChord(s.chroma, c.pcs).ok;
      run = ok ? run + 1 : 0;
      if (run >= 2 && hitT == null) hitT = win[win.indexOf(s) - 1].t - offsetMs;
    }
    if (hitT != null) {
      const delta = hitT - T;
      const a = Math.abs(delta);
      return { grade: a <= tPerfect ? 'perfect' : a <= tGood ? 'good' : 'ok', deltaMs: delta, heard: [] };
    }
    if (!loud) return { grade: 'none', deltaMs: null, heard: [] };
    const sum = acc.reduce((x, y) => x + y, 0) || 1;
    return { grade: 'wrong', deltaMs: null, heard: heardPcs(acc.map((v) => v / sum), 0.12) };
  });
  const done = results.filter(Boolean);
  const score = done.length ? done.reduce((s, r) => s + GRADE_POINTS[r.grade], 0) / done.length : 0;
  return { results, score };
}
