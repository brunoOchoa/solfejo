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
  ['piano', 'Piano (som real)'], ['violin', 'Violino (som real)'], ['guitar', 'Violão de nylon (som real)'], ['synth', 'Sintetizador simples'],
];
let instrument = load('pref.instrument', 'piano');
if (!INSTRUMENTS.some(([k]) => k === instrument)) instrument = 'piano';

export const getInstrument = () => instrument;
export function setInstrument(name) {
  instrument = name;
  save('pref.instrument', name);
  if (BANKS[name]) loadBank(name);
}

// Amostras reais. Piano: Salamander Grand Piano (Alexander Holm, CC-BY 3.0). Violino e violão:
// tonejs-instruments (Nicholas Brosowsky, CC-BY 3.0). Notas intermediárias: muda-se a velocidade
// de reprodução (poucos semitons). `release`: tempo de soltar a nota; `hold`: sustenta até o fim da duração.
const range = (names) => names.split(' ');
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
  violin: {
    dir: 'violin', release: 0.3, gain: 0.8, hold: true,
    files: range('G3 A3 C4 E4 G4 A4 C5 E5 G5 A5 C6 E6 G6 A6 C7'),
  },
  guitar: {
    dir: 'guitar', release: 0.18, gain: 1, hold: false,
    files: range('B1 D2 E2 A2 Gs2 Fs2 B2 Cs3 D3 E3 Fs3 G3 A3 B3 Cs4 Ds4 E4 Fs4 Gs4 A4 B4 D5 E5 Cs5 Fs5 G5 A5 As5 Gs5'),
  },
};
const SEMI = { C: 0, Cs: 1, D: 2, Ds: 3, E: 4, F: 5, Fs: 6, G: 7, Gs: 8, A: 9, As: 10, B: 11 };
const midiOfSample = (name) => 12 * (Number(name.slice(-1)) + 1) + SEMI[name.slice(0, -1)];
const loaded = {}; // nome -> [{ midi, buf }]
const loading = {};

export function loadBank(name) {
  const bank = BANKS[name];
  if (!bank) return Promise.resolve();
  if (loading[name]) return loading[name];
  const c = getCtx();
  const list = [];
  loaded[name] = list;
  loading[name] = Promise.all(bank.files.map(async (file) => {
    try {
      const res = await fetch(`./samples/${bank.dir}/${file}.mp3`);
      if (!res.ok) throw new Error(res.status);
      list.push({ midi: midiOfSample(file), buf: await c.decodeAudioData(await res.arrayBuffer()) });
    } catch {
      /* amostra indisponível: a nota cai para o sintetizador */
    }
  })).then(() => list.sort((x, y) => x.midi - y.midi));
  return loading[name];
}
export const loadPiano = () => loadBank('piano');

function sampleVoice(name, freq, start, dur) {
  const bank = BANKS[name];
  const list = loaded[name];
  if (!list?.length) return false;
  const vol = getVolume('inst');
  if (vol <= 0) return true; // mudo: nada a tocar
  const midi = 69 + 12 * Math.log2(freq / 440);
  let best = list[0];
  for (const b of list) if (Math.abs(b.midi - midi) < Math.abs(best.midi - midi)) best = b;
  const c = getCtx();
  const src = c.createBufferSource();
  src.buffer = best.buf;
  src.playbackRate.value = 2 ** ((midi - best.midi) / 12);
  const g = c.createGain();
  const end = start + Math.max(dur, 0.3);
  const gn = bank.gain * vol;
  g.gain.setValueAtTime(gn, start);
  g.gain.setValueAtTime(gn, end);
  g.gain.exponentialRampToValueAtTime(0.0001, end + bank.release);
  src.connect(g).connect(c.destination);
  src.start(start);
  src.stop(end + bank.release + 0.05);
  scheduled.push(src);
  src.onended = () => {
    scheduled = scheduled.filter((o) => o !== src);
  };
  return true;
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
export function scheduleFreq(freq, at, dur = 2.5, { bank = null, gain = 0.3 } = {}) {
  if (bank && BANKS[bank]) {
    loadBank(bank);
    if (sampleVoice(bank, freq, at, dur)) return;
  }
  const vol = getVolume('inst');
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
// ---- Volumes por aba ------------------------------------------------------------------------
// Cada aba (notas, ritmo, cantar, instrumento, afinador) guarda o seu volume de "inst" (som de instrumento e
// referências) e de "click" (metrônomo e batidas). 1 = 100%; vai até 2 (200%). O volume do clique usava uma
// preferência global antiga (pref.clickVol): ela vira o valor inicial das abas.
const LEGACY_CLICK = (() => { const v = Number(load('pref.clickVol', 0.6)); return v >= 0 && v <= 2 ? v : 0.6; })();
const DEFAULT_VOL = { inst: 1, click: LEGACY_CLICK };
let currentTab = 'notas';
const vols = load('pref.vol', {});
const clampVol = (v) => Math.max(0, Math.min(2, v));
export function setAudioTab(name) { currentTab = name; }
export function getVolume(kind, tab = currentTab) {
  const v = vols[tab]?.[kind];
  return typeof v === 'number' && v >= 0 && v <= 2 ? v : DEFAULT_VOL[kind];
}
export function setVolume(kind, v, tab = currentTab) {
  vols[tab] = { ...vols[tab], [kind]: clampVol(v) };
  save('pref.vol', vols);
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
  src.connect(bp).connect(g).connect(c.destination);
  src.start(at);
  src.stop(at + dur + 0.02);
  scheduled.push(src);
  src.onended = () => {
    scheduled = scheduled.filter((o) => o !== src);
  };
}

// accent: primeiro tempo do compasso (mais agudo e forte). soft: subdivisão entre os tempos (mais grave e suave).
export function scheduleClick(at, accent = false, soft = false) {
  const vol = getVolume('click');
  if (vol <= 0) return;
  if (soft) clickVoice(at, { freq: 3500, gain: Math.min(1, 0.5 * vol), dur: 0.03 });
  else if (accent) clickVoice(at, { freq: 6000, gain: Math.min(1, 1.4 * vol), dur: 0.05 });
  else clickVoice(at, { freq: 4500, gain: Math.min(1, 1.0 * vol), dur: 0.045 });
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
}

/** Latência de saída estimada em ms (para compensar a leitura de batidas). */
export function outputLatencyMs() {
  const c = getCtx();
  return ((c.outputLatency || 0) + (c.baseLatency || 0)) * 1000;
}
