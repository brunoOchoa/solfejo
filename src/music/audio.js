// Áudio com Web Audio API (sem dependências).
import { frequencyOf } from './theory.js';
import { load, save } from '../storage.js';

let ctx = null;
let scheduled = [];

export function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
    if (BANKS[instrument]) queueMicrotask(() => loadBank(instrument));
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function voice(freq, start, dur, { type = 'triangle', gain = 0.3 } = {}) {
  const c = getCtx();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(c.destination);
  osc.start(start);
  osc.stop(start + dur + 0.05);
  scheduled.push(osc);
  osc.onended = () => {
    scheduled = scheduled.filter((o) => o !== osc);
  };
  return osc;
}

// ---- Instrumentos -------------------------------------------------------------------------
export const INSTRUMENTS = [
  ['piano', 'Piano (som real)'], ['violin', 'Violino solo (som real)'], ['violinSso', 'Violino SSO (vibrato gravado)'], ['violinSsoN', 'Violino SSO (vibrato próprio)'], ['guitar', 'Violão de nylon (som real)'], ['synth', 'Sintetizador simples'],
];
let instrument = load('pref.instrument', 'piano');
if (!INSTRUMENTS.some(([k]) => k === instrument)) instrument = 'piano';

export const getInstrument = () => instrument;
export function setInstrument(name) {
  instrument = name;
  save('pref.instrument', name);
  if (BANKS[name]) loadBank(name);
}

// Amostras reais. Piano: Salamander Grand Piano (Alexander Holm, CC-BY 3.0). Violão:
// tonejs-instruments (Nicholas Brosowsky, CC-BY 3.0). Notas intermediárias: muda-se a velocidade
// de reprodução (poucos semitons). `release`: tempo de soltar a nota; `hold`: sustenta até o fim da duração.
const range = (names) => names.split(' ');
const SSO_NOTES = (() => {
  const f = [];
  for (let m = 55; m <= 91; m++) f.push(`${['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'][m % 12]}${Math.floor(m / 12) - 1}`);
  return f;
})();
const BANKS = {
  piano: {
    dir: 'piano', release: 0.25, gain: 0.9, hold: true,
    files: (() => {
      const f = [];
      for (let o = 1; o <= 6; o++) {
        if (o <= 5) f.push(`A${o}`);
        if (o >= 2) f.push(`C${o}`);
        if (o >= 3 && o <= 5) f.push(`Ds${o}`);
        if (o >= 2 && o <= 5) f.push(`Fs${o}`);
      }
      return f;
    })(),
  },
  // Violino: VSCO 2 Community Edition (Versilian Studios, CC0). Cada nota tem duas intensidades (suave e forte) que se misturam.
  violin: {
    dir: 'violin-solo', layers: ['p', 'f'], bow: true, release: 0.3, gain: 2.4, hold: true,
    files: range('G3 A3 C4 E4 G4 A4 C5 E5 G5 A5 C6 E6 G6 A6 C7'),
  },
  // Sonatina Symphonic Orchestra (Peter Astman, Creative Commons Sampling Plus 1.0), solo violin 2: uma amostra por semitom
  // (sem esticar notas), com vibrato gravado ou sem vibrato (aí o vibrato é feito aqui, entrando depois do início da nota).
  violinSso: {
    dir: 'violin-sso-v', bow: true, release: 0.3, gain: 2.4, hold: true, files: SSO_NOTES,
  },
  violinSsoN: {
    dir: 'violin-sso-n', bow: true, lfo: true, release: 0.3, gain: 2.4, hold: true, files: SSO_NOTES,
  },
  guitar: {
    dir: 'guitar', release: 0.18, gain: 1, hold: false,
    files: range('B1 D2 E2 A2 Gs2 Fs2 B2 Cs3 D3 E3 Fs3 G3 A3 B3 Cs4 Ds4 E4 Fs4 Gs4 A4 B4 D5 E5 Cs5 Fs5 G5 A5 As5 Gs5'),
  },
};
const SEMI = { C: 0, Cs: 1, D: 2, Ds: 3, E: 4, F: 5, Fs: 6, G: 7, Gs: 8, A: 9, As: 10, B: 11 };
const midiOfSample = (name) => { const m = /^([A-G]s?)(\d)/.exec(name); return 12 * (Number(m[2]) + 1) + SEMI[m[1]]; };
const loaded = {}; // nome -> [{ midi, buf }]
const loading = {};

export function loadBank(name) {
  const bank = BANKS[name];
  if (!bank) return Promise.resolve();
  if (loading[name]) return loading[name];
  const c = getCtx();
  const list = [];
  loaded[name] = list;
  const layers = bank.layers ?? [null];
  loading[name] = Promise.all(bank.files.map(async (file) => {
    try {
      const bufs = await Promise.all(layers.map(async (ly) => {
        const res = await fetch(`./samples/${bank.dir}/${ly ? `${file}_${ly}` : file}.mp3`);
        if (!res.ok) throw new Error(res.status);
        return c.decodeAudioData(await res.arrayBuffer());
      }));
      list.push({ midi: midiOfSample(file), bufs });
    } catch {
      /* amostra indisponível: a nota cai para o sintetizador */
    }
  })).then(() => list.sort((x, y) => x.midi - y.midi));
  return loading[name];
}
export const loadPiano = () => loadBank('piano');

function sampleVoice(name, freq, start, dur, kind = 'inst') {
  const bank = BANKS[name];
  const list = loaded[name];
  if (!list?.length) return false;
  const midi = 69 + 12 * Math.log2(freq / 440);
  let best = list[0];
  for (const b of list) if (Math.abs(b.midi - midi) < Math.abs(best.midi - midi)) best = b;
  const c = getCtx();
  const rate = 2 ** ((midi - best.midi) / 12);
  // mistura das intensidades: pesos de potência igual entre a camada suave e a forte
  const v = best.bufs.length > 1 ? 0.3 + Math.random() * 0.4 : 0;
  const weights = best.bufs.length > 1 ? [Math.cos(v * Math.PI / 2), Math.sin(v * Math.PI / 2)] : [1];
  const srcs = best.bufs.map((buf, i) => {
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const lg = c.createGain();
    lg.gain.value = weights[i];
    src.connect(lg);
    return { src, lg };
  });
  const g = c.createGain();
  const end = start + Math.max(dur, 0.3);
  const gn = bank.gain; // o volume fica no barramento do tipo (kind), assim vale também para notas já agendadas
  const extra = [];
  let startAt = start;
  if (bank.bow) {
    // Violino: ataque suave de arco, notas ligadas quando coladas (a anterior se dissolve enquanto a nova entra, com
    // um leve deslize de afinação), afinação e força levemente diferentes a cada nota e sala suave. O vibrato já vem gravado.
    const gv = gn * (0.94 + Math.random() * 0.1);
    const base = (Math.random() - 0.5) * 8;
    const prev = lastV;
    const legato = prev && prev.ctx === c && start >= prev.t0 && start - prev.end < 0.25;
    const t0 = Math.max(c.currentTime, start - (legato ? 0.05 : 0.025));
    if (legato) {
      const hold = Math.max(prev.t0 + 0.14, start - 0.07);
      prev.g.gain.cancelScheduledValues(prev.t0 + 0.14);
      prev.g.gain.setValueAtTime(prev.gv, hold);
      prev.g.gain.linearRampToValueAtTime(0.0001, start + 0.1);
      try { for (const o of prev.srcs) o.stop(start + 0.14); } catch { /* já parou */ }
    }
    for (const { src } of srcs) {
      src.detune.setValueAtTime(legato ? base - 20 : base - 5, t0);
      src.detune.linearRampToValueAtTime(base, t0 + (legato ? 0.1 : 0.06));
    }
    if (bank.lfo && end - start > 0.45) {
      // vibrato de quem toca: começa depois do ataque, cresce devagar e varia um pouco de nota para nota
      const lfo = c.createOscillator();
      const depth = c.createGain();
      lfo.frequency.value = 5.2 + Math.random() * 0.8;
      const v0 = start + 0.25;
      depth.gain.setValueAtTime(0, t0);
      depth.gain.setValueAtTime(0, v0);
      depth.gain.linearRampToValueAtTime(14 + Math.random() * 6, v0 + 0.5);
      lfo.connect(depth);
      for (const { src } of srcs) depth.connect(src.detune);
      lfo.start(t0);
      lfo.stop(end + bank.release + 0.05);
      extra.push(lfo);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gv, t0 + 0.07);
    g.gain.setValueAtTime(gv, Math.max(t0 + 0.08, end - 0.05));
    g.gain.exponentialRampToValueAtTime(0.0001, end + bank.release);
    lastV = { ctx: c, g, gv, t0, end, srcs: srcs.map((o) => o.src) };
    startAt = t0;
    g.connect(kindBus(c, kind, true));
  } else {
    g.gain.setValueAtTime(gn, start);
    g.gain.setValueAtTime(gn, end);
    g.gain.exponentialRampToValueAtTime(0.0001, end + bank.release);
    g.connect(kindBus(c, kind, false));
  }
  const all = srcs.map((o) => o.src);
  srcs.forEach(({ lg }) => lg.connect(g));
  for (const src of all) { src.start(startAt); src.stop(end + bank.release + 0.05); }
  scheduled.push(...all, ...extra);
  all[0].onended = () => {
    scheduled = scheduled.filter((o) => !all.includes(o) && !extra.includes(o));
  };
  return true;
}

let lastV = null; // última nota de violino agendada (para ligar as notas)

// Sala e timbre do violino: um pouco de calor nos graves-médios, brilho áspero domado e reverberação curta.
let vBus = null;
function violinBus(c) {
  if (vBus?.ctx === c) return vBus.input;
  const input = c.createGain();
  const warm = c.createBiquadFilter();
  warm.type = 'peaking'; warm.frequency.value = 500; warm.Q.value = 0.9; warm.gain.value = 3;
  const air = c.createBiquadFilter();
  air.type = 'lowpass'; air.frequency.value = 7500; air.Q.value = 0.5;
  const len = Math.ceil(c.sampleRate * 1.7);
  const ir = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      lp += (Math.random() * 2 - 1 - lp) * 0.35; // ruído mais escuro, como uma sala de verdade
      d[i] = lp * (1 - i / len) ** 3.2 * 1.6;
    }
  }
  const verb = c.createConvolver();
  verb.buffer = ir;
  const wet = c.createGain();
  wet.gain.value = 0.2;
  input.connect(warm).connect(air);
  air.connect(c.destination);
  air.connect(verb).connect(wet).connect(c.destination);
  vBus = { ctx: c, input };
  return input;
}

function noteVoice(pitch, start, dur) {
  const f = frequencyOf(pitch);
  if (BANKS[instrument] && sampleVoice(instrument, f, start, dur)) return;
  const vol = getVolume('inst');
  if (vol > 0) voice(f, start, dur, { type: 'triangle', gain: 0.35 * vol });
}

/**
 * Nota por frequência (afinador). bank: 'piano' | 'violin' | 'guitar' usa as amostras reais; senão tom puro
 * (seno) sustentado por `dur` segundos.
 */
export function scheduleFreq(freq, at, dur = 2.5, { bank = null, gain = 0.3, kind = 'inst' } = {}) {
  if (bank && BANKS[bank]) {
    loadBank(bank);
    if (sampleVoice(bank, freq, at, dur, kind)) return;
  }
  const vol = getVolume(kind);
  if (vol <= 0) return;
  gain = Math.min(1, gain * vol);
  const c = getCtx();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, at);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.04);
  g.gain.setValueAtTime(gain, at + dur - 0.12);
  g.gain.linearRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(c.destination);
  osc.start(at);
  osc.stop(at + dur + 0.05);
  scheduled.push(osc);
  osc.onended = () => {
    scheduled = scheduled.filter((o) => o !== osc);
  };
}

/** Sinal curto e firme (calibração por eco): toca pela saída com volume próprio, para o microfone conseguir ouvir. */
export function scheduleBeep(at, freq = 1000, dur = 0.09) {
  voice(freq, at, dur, { type: 'sine', gain: 0.6 });
}

/** Agenda uma nota (at em segundos do AudioContext). */
export function scheduleNote(pitch, at, dur = 0.8) {
  noteVoice(pitch, at, dur);
}

export function playPitch(pitch, dur = 0.9) {
  noteVoice(pitch, getCtx().currentTime + 0.01, dur);
}

/** Clique do metrônomo (accent = primeiro tempo). `at` em segundos do AudioContext. */
// Barramentos de volume: cada tipo (instrumento, melodia, acompanhamento, metrônomo) passa por um ganho único que segue o
// controle de volume ao vivo, inclusive para notas já agendadas (ex.: a música tocando em "Ouvir"). O violino passa antes pela sala.
const buses = new Map(); // `${kind}:${bow}` → { ctx, node, kind }
function kindBus(c, kind, bow) {
  const key = `${kind}:${bow ? 1 : 0}`;
  let b = buses.get(key);
  if (!b || b.ctx !== c) {
    const node = c.createGain();
    node.gain.value = getVolume(kind);
    node.connect(bow ? violinBus(c) : c.destination);
    b = { ctx: c, node, kind };
    buses.set(key, b);
  }
  return b.node;
}
function refreshBuses() {
  for (const b of buses.values()) b.node.gain.setTargetAtTime(getVolume(b.kind), b.ctx.currentTime, 0.02);
}

// ---- Volumes por aba ------------------------------------------------------------------------
// Cada aba (notas, ritmo, cantar, instrumento, afinador) guarda o seu volume de "inst" (som de instrumento e
// referências) e de "click" (metrônomo e batidas). 1 = 100%; vai até 2 (200%). O volume do clique usava uma
// preferência global antiga (pref.clickVol): ela vira o valor inicial das abas.
const LEGACY_CLICK = (() => { const v = Number(load('pref.clickVol', 0.6)); return v >= 0 && v <= 2 ? v : 0.6; })();
const DEFAULT_VOL = { inst: 1, click: LEGACY_CLICK, melody: 1, accomp: 1 };
let currentTab = 'notas';
const vols = load('pref.vol', {});
const clampVol = (v) => Math.max(0, Math.min(2, v));
export function setAudioTab(name) { currentTab = name; refreshBuses(); }
export function getVolume(kind, tab = currentTab) {
  const v = vols[tab]?.[kind];
  return typeof v === 'number' && v >= 0 && v <= 2 ? v : DEFAULT_VOL[kind];
}
export function setVolume(kind, v, tab = currentTab) {
  vols[tab] = { ...vols[tab], [kind]: clampVol(v) };
  save('pref.vol', vols);
  refreshBuses();
}
// Clique do metrônomo: um "tic" curto de ruído em frequência alta (3,5–6 kHz), como um metrônomo de verdade.
// Ruído não tem altura definida e fica acima da faixa dos instrumentos: o detector de notas do microfone não o
// confunde com uma nota tocada (o antigo clique em onda quadrada era lido como nota e atrapalhava a detecção).
let noiseBuf = null;
function clickVoice(at, { freq, gain, dur }) {
  const c = getCtx();
  if (!noiseBuf || noiseBuf.sampleRate !== c.sampleRate) {
    noiseBuf = c.createBuffer(1, Math.ceil(c.sampleRate * 0.1), c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 1.2;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(bp).connect(g).connect(kindBus(c, 'click', false));
  src.start(at);
  src.stop(at + dur + 0.02);
  scheduled.push(src);
  src.onended = () => {
    scheduled = scheduled.filter((o) => o !== src);
  };
}

// accent: primeiro tempo do compasso (mais agudo e forte). soft: subdivisão entre os tempos (mais grave e suave).
export function scheduleClick(at, accent = false, soft = false) {
  if (soft) clickVoice(at, { freq: 3500, gain: 0.5, dur: 0.03 });
  else if (accent) clickVoice(at, { freq: 6000, gain: 1, dur: 0.05 });
  else clickVoice(at, { freq: 4500, gain: 1, dur: 0.045 });
}

export function scheduleBeat(at) {
  const vol = getVolume('click');
  if (vol <= 0) return;
  voice(660, at, 0.09, { type: 'sine', gain: Math.min(1, 0.4 * (vol / 0.6)) }); // 60% = volume de sempre
}

export function feedbackTick() {
  const c = getCtx();
  voice(880, c.currentTime, 0.06, { type: 'sine', gain: 0.15 });
}

export function stopAll() {
  for (const o of scheduled) {
    try {
      o.stop();
    } catch {
      /* já parado */
    }
  }
  scheduled = [];
  lastV = null;
}

/** Latência de saída estimada em ms (para compensar a leitura de batidas). */
export function outputLatencyMs() {
  const c = getCtx();
  return ((c.outputLatency || 0) + (c.baseLatency || 0)) * 1000;
}
