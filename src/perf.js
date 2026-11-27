// Desempenho visual: mede a fluidez nas trocas de aba e, se o aparelho não acompanhar, passa para o modo leve
// (sem desfoque de fundo, sem partículas e com troca de aba só em fade). Também dá para escolher o modo à mão.
import { load, save } from './storage.js';

const MODES = ['auto', 'full', 'lite'];
let mode = load('pref.perf', 'auto');
if (!MODES.includes(mode)) mode = 'auto';
let autoLite = load('pref.perfAuto', false) === true; // decisão do modo automático, lembrada entre sessões
const history = []; // fps de cada troca de aba (mais recentes no fim)
const byRoute = {}; // último fps de cada aba
const longFrames = []; // quadros longos (> 50 ms) com o que os causou, se o navegador informar

export const getPerfMode = () => mode;
export const isLite = () => mode === 'lite' || (mode === 'auto' && autoLite);
export const recentFps = () => history.slice(-5);

function apply() {
  document.documentElement.classList.toggle('lite', isLite());
  window.dispatchEvent(new CustomEvent('perfchange'));
}

export function setPerfMode(next) {
  mode = MODES.includes(next) ? next : 'auto';
  save('pref.perf', mode);
  if (mode === 'auto') { autoLite = false; save('pref.perfAuto', false); history.length = 0; } // recomeça a avaliar
  apply();
}

export function initPerf() {
  apply();
  // quadros longos: o Chrome diz quanto tempo cada um levou e quais scripts rodaram
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const sc = (e.scripts || []).map((s) => `${Math.round(s.duration)} ms ${s.sourceFunctionName || s.invoker || ''} ${(s.sourceURL || '').split('/').pop().split('?')[0]}`.trim()).slice(0, 2);
        longFrames.push({ at: Math.round(e.startTime), dur: Math.round(e.duration), block: Math.round(e.blockingDuration || 0), scripts: sc });
        if (longFrames.length > 40) longFrames.shift();
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch { /* navegador sem esse recurso */ }
}

/**
 * Mede os quadros por `ms` milissegundos (a mediana ignora o tropeço de montar a tela) e guarda os fps.
 * No modo automático, 3 trocas seguidas abaixo de ~30 fps ligam o modo leve.
 */
export function sampleFrames(ms = 600, label = '') {
  if (document.visibilityState !== 'visible') return;
  const d = [];
  let last = performance.now();
  const t0 = last;
  const tick = (now) => {
    d.push(now - last);
    last = now;
    if (now - t0 < ms) { requestAnimationFrame(tick); return; }
    if (document.visibilityState !== 'visible' || d.length < 5) return; // aba escondida: o navegador segura os quadros e a medida não vale
    const s = [...d.slice(1)].sort((a, b) => a - b);
    const median = s[s.length >> 1];
    const fps = Math.round(1000 / median);
    history.push(fps);
    if (label) byRoute[label] = { fps, worstMs: Math.round(s[s.length - 1]) };
    if (history.length > 20) history.shift();
    window.dispatchEvent(new CustomEvent('perfchange'));
    if (mode === 'auto' && !autoLite && history.length >= 3 && history.slice(-3).every((f) => f < 30)) {
      autoLite = true;
      save('pref.perfAuto', true);
      apply();
      window.dispatchEvent(new CustomEvent('perflite'));
    }
  };
  requestAnimationFrame(tick);
}

function gpuInfo() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return 'WebGL indisponível (aceleração de hardware desligada?)';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'renderizador oculto pelo navegador';
  } catch {
    return 'não foi possível consultar';
  }
}

/** Texto para copiar e colar: aparelho, placa de vídeo, fluidez por aba e os quadros mais demorados. */
export function perfReport() {
  const conn = navigator.connection;
  const worst = [...longFrames].sort((a, b) => b.dur - a.dur).slice(0, 6);
  return [
    'Solfejo — diagnóstico de desempenho',
    `Navegador: ${navigator.userAgent}`,
    `Tela: ${screen.width}x${screen.height} · janela ${innerWidth}x${innerHeight} · ampliação ${devicePixelRatio}`,
    `Núcleos: ${navigator.hardwareConcurrency ?? 'n/d'} · memória: ${navigator.deviceMemory ?? 'n/d'} GB · taxa de atualização da tela medida pelos quadros abaixo`,
    `Placa de vídeo: ${gpuInfo()}`,
    `Economia de dados: ${conn?.saveData ? 'sim' : 'não'} · movimento reduzido: ${matchMedia('(prefers-reduced-motion: reduce)').matches ? 'sim' : 'não'}`,
    `Modo de desempenho: ${mode}${isLite() ? ' (leve ligado)' : ''}`,
    `Fluidez por aba (fps · pior quadro): ${Object.entries(byRoute).map(([k, v]) => `${k} ${v.fps} fps · ${v.worstMs} ms`).join(' | ') || 'troque de aba para medir'}`,
    `Quadros longos (> 50 ms): ${longFrames.length}${worst.length ? '\n' : ''}${worst.map((f) => `  ${f.dur} ms (bloqueou ${f.block} ms) ${f.scripts.join(' / ')}`).join('\n')}`,
  ].join('\n');
}
