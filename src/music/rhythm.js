// Ritmo: geração de compassos e avaliação das batidas.
//
// Unidade de tempo = "tick", com 12 ticks por semínima (divide por 2, 3 e 4):
//   semibreve 48 · mínima 24 · semínima 12 · colcheia 6 · semicolcheia 3 · tercina de colcheia 4
// Nos compassos compostos o tempo é a semínima pontuada (18 ticks).
// Valores negativos são pausas.

export const TPQ = 12;

export const TIME_SIGNATURES = {
  '2/4': { beats: 2, beatTicks: 12, compound: false },
  '3/4': { beats: 3, beatTicks: 12, compound: false },
  '4/4': { beats: 4, beatTicks: 12, compound: false },
  '5/4': { beats: 5, beatTicks: 12, compound: false },
  '6/8': { beats: 2, beatTicks: 18, compound: true },
  '9/8': { beats: 3, beatTicks: 18, compound: true },
  '12/8': { beats: 4, beatTicks: 18, compound: true },
};

/** Nome da duração no VexFlow para cada valor em ticks (4 e 8 só existem dentro de tercinas). */
export const DURATIONS = { 3: '16', 4: '8', 6: '8', 8: 'q', 9: '8d', 12: 'q', 18: 'qd', 24: 'h', 36: 'hd', 48: 'w' };

// ---- Figuras configuráveis ------------------------------------------------
export const FIGURES = {
  longas: 'Notas longas (mínima, mínima pontuada, semibreve)',
  colcheias: 'Colcheias',
  semicolcheias: 'Semicolcheias',
  pontuadas: 'Pontuadas (semínima e colcheia pontuadas)',
  sincopes: 'Síncopes',
  tercinas: 'Tercinas',
  rests: 'Pausas',
};

const none = { longas: false, colcheias: false, semicolcheias: false, pontuadas: false, sincopes: false, tercinas: false, rests: false };

export const PRESETS = {
  1: { name: 'Iniciante', desc: 'semínimas, mínimas e pausas', figures: { ...none, longas: true, rests: true } },
  2: { name: 'Básico', desc: '+ colcheias', figures: { ...none, longas: true, rests: true, colcheias: true } },
  3: { name: 'Intermediário', desc: '+ semicolcheias e pontuadas', figures: { ...none, longas: true, rests: true, colcheias: true, semicolcheias: true, pontuadas: true } },
  4: { name: 'Avançado', desc: '+ síncopes', figures: { ...none, longas: true, rests: true, colcheias: true, semicolcheias: true, pontuadas: true, sincopes: true } },
  5: { name: 'Especialista', desc: '+ tercinas', figures: { longas: true, colcheias: true, semicolcheias: true, pontuadas: true, sincopes: true, tercinas: true, rests: true } },
};

export const presetFigures = (id) => ({ ...PRESETS[id].figures });

/** Qual predefinição bate exatamente com este conjunto de figuras ('custom' se nenhuma). */
export function presetOf(figures) {
  const same = (a, b) => Object.keys(FIGURES).every((k) => !!a[k] === !!b[k]);
  return Object.keys(PRESETS).find((id) => same(PRESETS[id].figures, figures)) || 'custom';
}

// ---- Padrões --------------------------------------------------------------
// ev = eventos em ticks (negativo = pausa) · w = peso · tags = figuras exigidas.
// Cada padrão ocupa um número inteiro de tempos (span), calculado abaixo.
const SIMPLE = [
  { ev: [12], w: 9, tags: [] },
  { ev: [-12], w: 2, tags: ['rests'] },
  { ev: [24], w: 3, tags: ['longas'] },
  { ev: [-24], w: 1, tags: ['longas', 'rests'] },
  { ev: [36], w: 1.2, tags: ['longas'] },
  { ev: [48], w: 0.8, tags: ['longas'] },
  { ev: [6, 6], w: 5, tags: ['colcheias'] },
  { ev: [6, -6], w: 1.5, tags: ['colcheias', 'rests'] },
  { ev: [-6, 6], w: 1.5, tags: ['colcheias', 'rests'] },
  { ev: [3, 3, 3, 3], w: 3, tags: ['semicolcheias'] },
  { ev: [6, 3, 3], w: 2.5, tags: ['colcheias', 'semicolcheias'] },
  { ev: [3, 3, 6], w: 2.5, tags: ['colcheias', 'semicolcheias'] },
  { ev: [-6, 3, 3], w: 1, tags: ['colcheias', 'semicolcheias', 'rests'] },
  { ev: [18, 6], w: 3, tags: ['pontuadas'] },
  { ev: [9, 3], w: 2.5, tags: ['pontuadas', 'semicolcheias'] },
  { ev: [3, 9], w: 1.2, tags: ['pontuadas', 'semicolcheias'] },
  { ev: [6, 12, 6], w: 3, tags: ['sincopes'] },
  { ev: [3, 6, 3], w: 2, tags: ['sincopes', 'semicolcheias'] },
  { ev: [4, 4, 4], w: 3, tags: ['tercinas'] },
  { ev: [4, 4, -4], w: 1, tags: ['tercinas', 'rests'] },
  { ev: [8, 4], w: 1.2, tags: ['tercinas'] },
  { ev: [4, 8], w: 1.2, tags: ['tercinas'] },
];

const COMPOUND = [
  { ev: [18], w: 6, tags: [] },
  { ev: [-18], w: 1.5, tags: ['rests'] },
  { ev: [36], w: 1.5, tags: ['longas'] },
  { ev: [-36], w: 0.5, tags: ['longas', 'rests'] },
  { ev: [12, 6], w: 4, tags: ['colcheias'] },
  { ev: [6, 6, 6], w: 4, tags: ['colcheias'] },
  { ev: [6, 6, -6], w: 1.2, tags: ['colcheias', 'rests'] },
  { ev: [-6, 6, 6], w: 1.2, tags: ['colcheias', 'rests'] },
  { ev: [12, -6], w: 1, tags: ['colcheias', 'rests'] },
  { ev: [6, 12], w: 2, tags: ['sincopes'] },
  { ev: [9, 3, 6], w: 3, tags: ['pontuadas', 'semicolcheias'] },
  { ev: [6, 3, 3, 6], w: 2, tags: ['semicolcheias'] },
  { ev: [6, 6, 3, 3], w: 2, tags: ['semicolcheias'] },
  { ev: [3, 3, 6, 6], w: 2, tags: ['semicolcheias'] },
  { ev: [3, 3, 3, 3, 6], w: 1, tags: ['semicolcheias'] },
];

for (const [table, beatTicks] of [[SIMPLE, 12], [COMPOUND, 18]]) {
  for (const p of table) {
    p.span = p.ev.reduce((s, e) => s + Math.abs(e), 0) / beatTicks;
    p.hasRest = p.ev.some((e) => e < 0);
  }
}

export const PATTERNS = { SIMPLE, COMPOUND };

function pickWeighted(list, weightOf, rand) {
  const total = list.reduce((s, p) => s + weightOf(p), 0);
  let r = rand() * total;
  for (const p of list) {
    r -= weightOf(p);
    if (r < 0) return p;
  }
  return list[0];
}

/**
 * Gera compassos; cada compasso é uma lista de durações em ticks (negativo = pausa).
 * figures: quais figuras podem aparecer (veja FIGURES). restBias: 0.5 poucas pausas … 2 muitas.
 */
export function generateMeasures({ timeSig, figures, measures, restBias = 1, rand = Math.random }) {
  const sig = TIME_SIGNATURES[timeSig];
  const table = sig.compound ? COMPOUND : SIMPLE;
  const pool = table.filter((p) => p.tags.every((t) => figures[t]));
  const weight = (p) => p.w * (p.hasRest ? restBias : 1);
  const result = [];
  for (let m = 0; m < measures; m++) {
    let events;
    for (let attempt = 0; attempt < 12; attempt++) {
      events = [];
      let beat = 0;
      while (beat < sig.beats) {
        const first = m === 0 && beat === 0; // o exercício nunca começa em pausa
        const options = pool.filter((p) => p.span <= sig.beats - beat && !(first && p.ev[0] < 0));
        const p = pickWeighted(options, weight, rand);
        events.push(...p.ev);
        beat += p.span;
      }
      if (events.some((e) => e > 0)) break; // evita compasso só de pausas
    }
    result.push(events);
  }
  return result;
}

/** Grupos de tercina: índices [início, fim) de eventos de 4 ou 8 ticks que somam 12 (uma semínima). */
export function tripletGroups(events) {
  const groups = [];
  let start = -1;
  let sum = 0;
  events.forEach((e, i) => {
    const a = Math.abs(e);
    if (a === 4 || a === 8) {
      if (start < 0) { start = i; sum = 0; }
      sum += a;
      if (sum === 12) {
        groups.push([start, i + 1]);
        start = -1;
      }
    }
  });
  return groups;
}

/** Posições (em ticks, desde o início) das notas tocadas (não pausas). */
export function onsetsOf(measures, timeSig) {
  const sig = TIME_SIGNATURES[timeSig];
  const perMeasure = sig.beats * sig.beatTicks;
  const onsets = [];
  measures.forEach((events, m) => {
    let pos = m * perMeasure;
    for (const e of events) {
      if (e > 0) onsets.push(pos);
      pos += Math.abs(e);
    }
  });
  return onsets;
}

export const POINTS = { perfect: 1, good: 0.75, ok: 0.4, miss: 0 };

/** Rigor: multiplica as janelas de tolerância. */
export const RIGOR = { easy: 1.4, normal: 1, hard: 0.7 };

/**
 * Janelas de tolerância (ms) para perfeito / bom / ok.
 * tickMs = duração de um tick; a referência é a semicolcheia (3 ticks).
 */
export function windowsFor(tickMs, scale = 1) {
  const sixteenth = tickMs * 3;
  return {
    perfect: Math.min(70, sixteenth * 0.3) * scale,
    good: Math.min(130, sixteenth * 0.55) * scale,
    ok: Math.min(210, sixteenth * 0.9) * scale,
  };
}

/** Classifica um desvio (ms, em valor absoluto) ou devolve null se estiver fora da janela. */
export function gradeFor(dist, tickMs, scale = 1) {
  const w = windowsFor(tickMs, scale);
  if (dist > w.ok) return null;
  return dist <= w.perfect ? 'perfect' : dist <= w.good ? 'good' : 'ok';
}

/**
 * Compara as batidas do usuário com o ritmo esperado.
 * expectedMs: instantes esperados (ms desde o início do ritmo)
 * tapsMs: batidas do usuário (ms desde o início do ritmo)
 * Batidas a mais custam pontos, limitado a metade da nota (bater sem parar não zera tudo).
 */
export function evaluateTaps(expectedMs, tapsMs, tickMs, scale = 1) {
  const used = new Array(tapsMs.length).fill(false);
  const notes = expectedMs.map((t) => {
    let best = -1;
    let bestDist = Infinity;
    tapsMs.forEach((tap, i) => {
      if (used[i]) return;
      const d = Math.abs(tap - t);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    const grade = best < 0 ? null : gradeFor(bestDist, tickMs, scale);
    if (!grade) return { grade: 'miss', delta: null };
    used[best] = true;
    return { grade, delta: tapsMs[best] - t };
  });
  const extraAt = tapsMs.filter((_, i) => !used[i]);
  const extra = extraAt.length;
  const penalty = Math.min(extra * 0.2, expectedMs.length * 0.5);
  const points = notes.reduce((s, n) => s + POINTS[n.grade], 0) - penalty;
  const score = expectedMs.length ? Math.max(0, Math.min(1, points / expectedMs.length)) : 0;
  const deltas = notes.filter((n) => n.delta !== null).map((n) => n.delta);
  const meanDelta = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
  // A mediana ignora acertos "quase" isolados e mostra a tendência real (adianta/atrasa).
  const sorted = [...deltas].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const medianDelta = !sorted.length ? 0 : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  // fração das batidas que erraram para o mesmo lado da mediana (e por pelo menos 15 ms)
  const sameSide = deltas.filter((d) => Math.sign(d) === Math.sign(medianDelta) && Math.abs(d) >= 15).length;
  const consistency = deltas.length ? sameSide / deltas.length : 0;
  return { notes, extra, extraAt, score, meanDelta, medianDelta, consistency, matched: deltas.length };
}
