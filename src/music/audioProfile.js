// Perfis de áudio: qual entrada usar, quanto atraso cada combinação entrada + saída tem e em que estado está o sinal do microfone.
// As funções puras (rótulos, estado do sinal, estatística da calibração) são testáveis; o resto grava em localStorage.
import { load, save } from '../storage.js';

const KEY = 'pref.audio';
const read = () => load(KEY, { input: '', profiles: {} });

// ---- entrada escolhida ------------------------------------------------------------------------
export const getPrefInput = () => read().input || '';
export function setPrefInput(id) { save(KEY, { ...read(), input: id || '' }); }
/** Motor de captura: 'auto' (AudioWorklet, com reserva) ou 'legacy' (AnalyserNode, para comparar). */
export const getPrefEngine = () => read().engine || 'auto';
export function setPrefEngine(v) { save(KEY, { ...read(), engine: v === 'legacy' ? 'legacy' : 'auto' }); }

// ---- rótulos e chave do perfil ----------------------------------------------------------------
/** 'bluetooth' (atrasa e oscila), 'speaker' (vaza no microfone), 'wired' ou 'unknown' (o navegador não informou). */
export function outputKind(label = '') {
  const l = label.toLowerCase();
  if (!l.trim()) return 'unknown';
  if (/bluetooth|airpods|buds|hands-?free|\bbt\b|wh-1000|wf-1000|jabra|beats|bose|sony.*(wh|wf)/.test(l)) return 'bluetooth';
  if (/speaker|alto-?falante|caixa|built-?in|embutid|internal|macbook|displayport|hdmi|monitor/.test(l)) return 'speaker';
  return 'wired';
}

/** Nome estável do dispositivo (sem "Default -", sem ids de hardware). */
export function normLabel(label = '') {
  return label.toLowerCase()
    .replace(/\([0-9a-f]{4}:[0-9a-f]{4}\)/g, '')
    .replace(/^(default|padrão|predefinido|communications)\s*-\s*/, '')
    .replace(/[^a-z0-9à-ÿ]+/g, ' ')
    .trim();
}

export const profileKey = (inputLabel, outputLabel) => `${normLabel(inputLabel) || 'desconhecido'}|${outputKind(outputLabel)}`;
export const profileTitle = (key) => {
  const [inp, kind] = key.split('|');
  const k = { bluetooth: 'fone Bluetooth', speaker: 'caixa de som', wired: 'fone com fio', unknown: 'saída não identificada' }[kind] ?? kind;
  return `${inp} + ${k}`;
};

// ---- perfis salvos ----------------------------------------------------------------------------
export const getProfile = (key) => read().profiles[key] ?? null;
export function saveProfile(key, data) {
  if (!key) return;
  const s = read();
  save(KEY, { ...s, profiles: { ...s.profiles, [key]: { ...s.profiles[key], ...data, at: Date.now() } } });
}

/** Dispositivo ativo (rótulos do navegador) e o perfil salvo para ele. */
export async function activeProfile(mic) {
  const inputLabel = mic?.info?.label || '';
  let outputLabel = '';
  try {
    const outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
    outputLabel = (outs.find((d) => d.deviceId === 'default') || outs[0])?.label || '';
  } catch { /* sem lista de saídas (Safari) */ }
  const key = profileKey(inputLabel, outputLabel);
  return { key, inputLabel, outputLabel, kind: outputKind(outputLabel), saved: getProfile(key) };
}

// ---- estado do sinal do microfone -------------------------------------------------------------
export const toDb = (x) => (x > 1e-5 ? 20 * Math.log10(x) : -100);

/**
 * Estado para o medidor. shortPeakDb: pico dos últimos ~1,5 s; longPeakDb: pico dos últimos ~8 s; spanMs: quanto tempo já foi observado;
 * expectSound: o app está esperando você tocar.
 */
export function micStatus({
  active, muted = false, shortPeakDb = -100, longPeakDb = -100, spanMs = 0, expectSound = false,
}) {
  if (!active) return { state: 'off', text: 'Microfone desligado' };
  if (muted) return { state: 'dead', text: 'Microfone mudo' };
  if (shortPeakDb >= -1) return { state: 'clip', text: 'Estourando: diminua o ganho do microfone' };
  if (spanMs >= 3000 && longPeakDb < -75) return { state: 'dead', text: 'Sem sinal: o microfone pode estar mudo ou a entrada ser outra' };
  if (expectSound && spanMs >= 3000 && longPeakDb < -30) return { state: 'low', text: 'Sinal fraco: aproxime o microfone ou aumente o ganho' };
  return { state: 'ok', text: longPeakDb < -50 ? 'Silêncio' : 'Sinal bom' };
}

// ---- calibração -------------------------------------------------------------------------------
/** Estatística dos desvios (ms) medidos: mediana, desvio-padrão (jitter) e amplitude. */
export function calStats(deltas) {
  const d = deltas.filter((x) => x != null);
  if (!d.length) return { n: 0, median: 0, std: 0, range: 0 };
  const s = [...d].sort((a, b) => a - b);
  const m = s.length >> 1;
  const median = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  const std = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / d.length);
  return { n: d.length, median, std, range: s[s.length - 1] - s[0] };
}

/** Quanto confiar na medida: o jitter (std) é o que não dá para corrigir com um número fixo. */
export function calVerdict({ n, std }) {
  if (n < 5) return { level: 'bad', text: 'Poucas notas detectadas: toque mais forte, mais perto do microfone, uma por clique.' };
  if (std <= 25) return { level: 'ok', text: `Medida confiável (variação de ±${Math.round(std)} ms).` };
  if (std <= 50) return { level: 'warn', text: `Medida razoável (variação de ±${Math.round(std)} ms): repita para ter mais certeza.` };
  return { level: 'bad', text: `Variação alta (±${Math.round(std)} ms). Pode ser o equipamento (Bluetooth, aparelho sobrecarregado) ou notas fora do clique; as notas vão ser avaliadas com mais folga.` };
}

/**
 * Diferença entre o seu sinal e o ruído do ambiente (dB) e o que fazer. noiseDb: volume do ruído (mediana); signalDb: volume tocando;
 * peakDb: pico tocando. Meta: pico perto de −6 dB (sem estourar) e diferença de 25 dB ou mais.
 */
export function snrAdvice({ noiseDb, signalDb, peakDb }) {
  const snr = signalDb - noiseDb;
  const toTarget = Math.round(-6 - peakDb); // quanto o pico precisaria subir (+) ou descer (−) para chegar a −6 dB
  if (peakDb >= -1) return { level: 'bad', snr, text: `O sinal está estourando (pico ${peakDb.toFixed(0)} dB). Diminua o ganho do microfone em uns ${Math.max(6, -toTarget)} dB.` };
  const gain = Math.abs(toTarget) >= 4 ? (toTarget > 0 ? ` Dá para aumentar o ganho em uns ${toTarget} dB (ou aproximar o microfone).` : ` Dá para diminuir o ganho em uns ${-toTarget} dB.`) : '';
  if (snr < 15) return { level: 'bad', snr, text: `Diferença de só ${snr.toFixed(0)} dB entre o seu som e o ruído: o ruído atrapalha. Aproxime o microfone do instrumento (metade da distância = +6 dB de sinal) ou reduza o ruído do ambiente.${gain}` };
  if (snr < 25) return { level: 'warn', snr, text: `Diferença de ${snr.toFixed(0)} dB: dá para usar, mas notas fracas podem se perder no ruído. Aproximar o microfone ajuda.${gain}` };
  return { level: 'ok', snr, text: `Diferença de ${snr.toFixed(0)} dB: boa.${gain}` };
}

/** Folga extra (ms) para a avaliação quando o equipamento é instável: metade do jitter acima de 25 ms, até 60 ms. */
export const extraTolerance = (std) => (std > 25 ? Math.min(60, Math.round((std - 25) / 2)) : 0);

/**
 * Vazamento do clique: nos cliques de contagem você ainda não está tocando. Se há "ataques de som" logo depois deles,
 * o clique está entrando no microfone (caixa de som em vez de fones). Retorna quantos cliques vazaram.
 */
export function clickLeak(clickTimes, onsetTimes, before = 60, after = 300) {
  return clickTimes.filter((c) => onsetTimes.some((t) => t - c > -before && t - c < after)).length;
}
export const leakText = (n) => `O clique está entrando no microfone: ouvi ${n} dos 4 cliques de contagem, quando você ainda não estava tocando. Use fones com fio e refaça; esta medida não é confiável.`;
