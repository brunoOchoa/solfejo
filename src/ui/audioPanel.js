// Painel "Áudio e latência": entrada do microfone, medidor, perfil de latência do aparelho, diagnóstico e relatório para copiar.
import { h, select } from '../dom.js';
import { Mic } from '../music/mic.js';
import { getCtx, outputLatencyMs } from '../music/audio.js';
import {
  getPrefInput, setPrefInput, getPrefEngine, setPrefEngine, activeProfile, profileTitle, toDb, snrAdvice,
} from '../music/audioProfile.js';
import { createMicMeter } from './micMeter.js';

let current = null;
const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter(Boolean));
const ms = (v) => `${Math.round(v)} ms`;

function platformTips() {
  const ua = navigator.userAgent;
  const mac = /Macintosh/.test(ua) && !/Mobile/.test(ua) && navigator.maxTouchPoints < 2;
  const android = /Android/.test(ua);
  const win = /Windows/.test(ua);
  const tips = [];
  if (mac) {
    tips.push('Mac: no Centro de Controle, deixe o “Modo do microfone” em Padrão (o Isolamento de voz filtra o instrumento).');
    tips.push('Safari não informa a latência da saída: use a calibração.');
  }
  if (win) {
    tips.push('Windows: em Configurações › Som, confira se o microfone certo está ativo e desligue as “Melhorias de áudio” dele.');
    tips.push('Microfone USB (como o QuadCast): padrão cardioide, voltado para o instrumento, e ganho que leve a barra até a metade sem encostar no fim.');
  }
  if (android) {
    tips.push('Android: fone com fio USB-C atrasa bem menos que Bluetooth.');
    tips.push('Se você abrir ou fechar o aparelho dobrável, confira o medidor e refaça a calibração se o sinal mudar.');
  }
  tips.push('Use fones com fio para o clique não entrar no microfone, e deixe o microfone de 20 a 50 cm do instrumento.');
  return tips;
}

/** Mede o ruído de fundo por 2 s (fique em silêncio). Retorna { avgDb, peakDb }. */
async function measureNoise(mic, onTick) {
  // contagem regressiva primeiro: o clique do mouse e o movimento da mão não entram na medida
  for (const k of [3, 2, 1]) {
    onTick?.(`Fique em silêncio… ${k}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  onTick?.('Medindo…');
  const vals = [];
  const t0 = performance.now();
  while (performance.now() - t0 < 2500) {
    vals.push(mic.level);
    await new Promise((r) => setTimeout(r, 50));
  }
  const sorted = vals.map((v) => v.rms).sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1] ?? 0; // a mediana ignora um estalo isolado
  return { avgDb: toDb(median), peakDb: toDb(Math.max(0, ...vals.map((v) => v.peak))) };
}

const ENGINE_NAME = { worklet: 'AudioWorklet', analyser: 'Clássico (AnalyserNode)' };
/** Texto da regularidade dos quadros do motor atual. */
function statsText(mic) {
  const s = mic.frameStats.summary();
  if (!mic.active || s.n < 5) return 'Ligue o microfone para medir.';
  return `${ENGINE_NAME[mic.engine] ?? '—'} · regularidade ±${s.dtStd.toFixed(1)} ms · maior intervalo ${s.dtMax.toFixed(0)} ms · entrega ${s.deliverMean.toFixed(0)} ms (máx ${s.deliverMax.toFixed(0)})`;
}

/** Mede o seu sinal por 5 s (toque ou cante): volume típico (percentil 90) e pico. */
async function measureSignal(mic, onTick) {
  const vals = [];
  const t0 = performance.now();
  while (performance.now() - t0 < 5000) {
    vals.push(mic.level);
    onTick?.(Math.ceil((5000 - (performance.now() - t0)) / 1000));
    await new Promise((r) => setTimeout(r, 50));
  }
  const rms = vals.map((v) => v.rms).sort((a, b) => a - b);
  return { signalDb: toDb(rms[Math.floor(rms.length * 0.9)] ?? 0), peakDb: toDb(Math.max(0, ...vals.map((v) => v.peak))) };
}

/** Teste de carga: ocupa a thread principal por 4 s (como uma página pesada) e mede a regularidade dos quadros. */
async function runStress(mic, onTick) {
  mic.frameStats.reset();
  const t0 = performance.now();
  while (performance.now() - t0 < 4000) {
    const b = performance.now();
    while (performance.now() - b < 25) { /* ocupa a thread */ }
    onTick?.(Math.round((performance.now() - t0) / 40));
    await new Promise((r) => setTimeout(r, 15));
  }
  return { engine: mic.engine, ...mic.frameStats.summary() };
}

/**
 * mic: instância do Mic da tela. ensureMic(): liga o microfone. restartMic(): recomeça com a entrada nova.
 * onCalibrate(): abre a calibração da tela. getProfile(): perfil ativo ({ key, inputLabel, outputLabel, kind, saved }).
 */
export function openAudioPanel({
  mic, ensureMic, restartMic, onCalibrate, onEcho, getProfile, host = document.body,
}) {
  current?.close();
  const body = h('div', { class: 'ap-body' });
  const scrim = h('div', { class: 'modal-scrim', onclick: (e) => { if (e.target === scrim) close(); } },
    h('div', { class: 'modal card ap', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Áudio e latência' }, body));
  host.append(scrim);
  const meter = createMicMeter(mic, { big: true, expectSound: () => false });
  let noise = null;
  let stress = null;
  let signal = null;
  const statsEl = h('p', { class: 'ap-stats' });
  const paintStats = () => { statsEl.textContent = statsText(mic); };
  const statsTimer = setInterval(paintStats, 500);
  paintStats();
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);

  function close() {
    clearInterval(statsTimer);
    meter.destroy();
    document.removeEventListener('keydown', onKey, true);
    scrim.remove();
    if (current?.close === close) current = null;
  }
  current = { close };

  async function render() {
    const inputs = await Mic.listInputs();
    const prof = getProfile?.() ?? (mic.active ? await activeProfile(mic) : null);
    const info = mic.info;
    const ctx = getCtx();
    const outMs = outputLatencyMs();
    const proc = info?.processing ?? {};
    const forced = ['echoCancellation', 'noiseSuppression', 'autoGainControl'].filter((k) => proc[k] === true);
    const saved = prof?.saved;
    const rateMismatch = info?.sampleRate && info.sampleRate !== ctx.sampleRate;

    const inputSel = select(
      [['', 'Padrão do sistema'], ...inputs.map((d, i) => [d.deviceId, d.label || `Entrada ${i + 1}`])],
      getPrefInput(),
      async (v) => { setPrefInput(v); await restartMic?.(); render(); },
    );
    const row = (k, v, cls = '') => h('div', { class: `ap-row ${cls}` }, h('span', { text: k }), h('b', { text: v }));

    fill(body,
      h('div', { class: 'ap-head' }, h('h2', { text: '🎚 Áudio e latência' }), h('button', { class: 'btn', 'aria-label': 'Fechar', onclick: close }, '✕')),

      h('section', { class: 'ap-sec' },
        h('h3', { text: 'Entrada do microfone' }),
        inputSel,
        inputs.length && !inputs[0].label ? h('p', { class: 'hint', text: 'Ligue o microfone para ver o nome de cada entrada.' }) : null,
        h('div', { class: 'ap-meter' }, meter.el),
        h('p', { class: 'hint', text: 'Toque ou cante: a barra deve passar da metade sem encostar no fim. Sem barra, confira se o microfone não está mudo (o QuadCast muda com um toque na parte de cima) e se a entrada acima é a certa.' }),
        mic.active ? null : h('button', { class: 'btn primary', onclick: async () => { await ensureMic?.(); render(); } }, '🎤 Ligar o microfone'),
      ),

      h('section', { class: 'ap-sec' },
        h('h3', { text: 'Seu aparelho' }),
        row('Entrada', info?.label || (mic.active ? 'sem nome' : 'microfone desligado')),
        row('Taxa de amostragem', `${ctx.sampleRate} Hz${info?.sampleRate && info.sampleRate !== ctx.sampleRate ? ` (microfone: ${info.sampleRate} Hz)` : ''}`),
        row('Canais', info?.channelCount ? String(info.channelCount) : '—'),
        row('Saída de som', prof?.outputLabel || 'o navegador não informa', prof?.kind === 'bluetooth' ? 'warn' : ''),
        row('Latência do navegador', `base ${ms((ctx.baseLatency || 0) * 1000)} · saída ${outMs ? ms(outMs) : 'não informada'}`),
        rateMismatch ? h('p', { class: 'ap-warn', text: `O microfone (${info.sampleRate} Hz) e o áudio do navegador (${ctx.sampleRate} Hz) estão em taxas diferentes: o Chrome reamostra e soma um pouco de atraso. No Windows, em Configurações › Som, deixe o formato da caixa/fone e o do microfone iguais (48000 Hz).` }) : null,
        forced.length ? h('p', { class: 'ap-warn', text: `O aparelho está aplicando processamento de voz (${forced.join(', ')}). Isso pode atrapalhar a detecção de afinação.` }) : null,
        prof?.kind === 'bluetooth' ? h('p', { class: 'ap-warn', text: 'Fone Bluetooth: o atraso é grande e oscila, e o microfone dele derruba a qualidade do áudio. Prefira fone com fio.' }) : null,
        prof?.kind === 'speaker' ? h('p', { class: 'ap-warn', text: 'Som saindo pela caixa: o clique e a referência vão entrar no microfone. Use fones com fio.' }) : null,
      ),

      h('section', { class: 'ap-sec' },
        h('h3', { text: 'Motor de captura' }),
        select([['auto', 'Automático (AudioWorklet, com reserva)'], ['legacy', 'Clássico (para comparar)']], getPrefEngine(), async (v) => { setPrefEngine(v); stress = null; await restartMic?.(); render(); }),
        statsEl,
        mic.engineNote ? h('p', { class: 'hint', text: mic.engineNote }) : null,
        h('p', { class: 'hint', text: 'O AudioWorklet marca a hora de cada bloco de som no relógio do áudio e analisa fora da página, então uma página pesada ou uma aba em segundo plano não atrasam a medida. Rode o teste de carga em cada motor para comparar.' }),
        h('div', { class: 'cal-actions' },
          h('button', { class: 'btn', disabled: !mic.active, onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            stress = await runStress(mic, (k) => { btn.textContent = `Testando… ${Math.min(100, k)}%`; });
            render();
          } }, '⚙ Teste de carga (4 s)')),
        stress ? row('Teste de carga', `${ENGINE_NAME[stress.engine] ?? '—'}: regularidade ±${stress.dtStd.toFixed(1)} ms · maior intervalo ${stress.dtMax.toFixed(0)} ms · entrega máx ${stress.deliverMax.toFixed(0)} ms`) : null,
      ),

      h('section', { class: 'ap-sec' },
        h('h3', { text: 'Latência deste aparelho' }),
        prof ? h('p', { class: 'ap-prof', text: `Perfil: ${profileTitle(prof.key)}` }) : null,
        saved
          ? h('p', { class: 'hint', text: `Salvo: ${saved.offset > 0 ? '+' : ''}${saved.offset} ms${saved.std != null ? ` · variação ±${Math.round(saved.std)} ms` : ''}${saved.source === 'echo' ? ' · por eco' : saved.source === 'play' ? ' · tocando' : ''}${saved.at ? ` · ${new Date(saved.at).toLocaleDateString('pt-BR')}` : ''}. O app troca sozinho quando você muda de microfone ou de fone.` })
          : h('p', { class: 'hint', text: 'Ainda sem calibração para esta combinação de microfone e saída.' }),
        h('div', { class: 'cal-actions' },
          onEcho ? h('button', { class: 'btn primary', onclick: () => { close(); onEcho(); } }, '🔊 Calibrar por eco (automático)') : null,
          onCalibrate ? h('button', { class: 'btn', onclick: () => { close(); onCalibrate(); } }, '🎯 Calibrar tocando') : null,
          h('button', { class: 'btn', disabled: !mic.active, onclick: async (e) => {
            e.currentTarget.disabled = true;
            const btn = e.currentTarget;
            noise = await measureNoise(mic, (t) => { btn.textContent = t; });
            render();
          } }, '🔇 Medir ruído de fundo')),
        h('div', { class: 'cal-actions' },
          h('button', { class: 'btn', disabled: !mic.active || !noise, title: noise ? '' : 'Meça o ruído de fundo primeiro', onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            signal = await measureSignal(mic, (k) => { btn.textContent = `Toque agora… ${k}`; });
            render();
          } }, '🎼 Medir meu sinal (toque por 5 s)')),
        signal && noise ? (() => {
          const adv = snrAdvice({ noiseDb: noise.avgDb, signalDb: signal.signalDb, peakDb: signal.peakDb });
          return [row('Seu sinal', `${signal.signalDb.toFixed(0)} dB (pico ${signal.peakDb.toFixed(0)} dB) · diferença ${adv.snr.toFixed(0)} dB`, adv.level === 'ok' ? '' : 'warn'),
            h('p', { class: adv.level === 'ok' ? 'ap-ok' : 'ap-warn', text: adv.text })];
        })() : null,
        noise ? row('Ruído de fundo', `${noise.avgDb.toFixed(0)} dB (mediana) · pico ${noise.peakDb.toFixed(0)} dB`, noise.avgDb > -50 ? 'warn' : '') : null,
        noise && noise.avgDb > -50 ? h('p', { class: 'ap-warn', text: 'Ruído de fundo alto (o ideal é abaixo de −55 dB). Diminua o ganho do microfone (no QuadCast, o botão de ganho na base), pause qualquer som saindo do computador, desligue ventilador ou ar-condicionado e afaste o microfone de teclado e mouse. Depois meça de novo.' }) : null,
        saved && saved.std > 50 ? h('p', { class: 'ap-warn', text: `A calibração salva tem variação alta (±${Math.round(saved.std)} ms) e não é confiável. Resolva o ruído e o som saindo pela caixa e calibre de novo.` }) : null,
      ),

      h('section', { class: 'ap-sec' },
        h('h3', { text: 'Dicas para o seu aparelho' }),
        h('ul', { class: 'ap-tips' }, platformTips().map((t) => h('li', { text: t }))),
      ),

      h('div', { class: 'cal-actions' },
        h('button', { class: 'btn', onclick: async (e) => {
          const text = buildReport({
            mic, prof, ctx, outMs, noise, meter, stress, signal,
          });
          try { await navigator.clipboard.writeText(text); e.currentTarget.textContent = '✓ Relatório copiado'; } catch { e.currentTarget.textContent = 'Não consegui copiar'; }
        } }, '📋 Copiar relatório de diagnóstico'),
        h('button', { class: 'btn', onclick: close }, 'Fechar')),
    );
  }

  render();
  return { close };
}

function buildReport({
  mic, prof, ctx, outMs, noise, meter, stress, signal,
}) {
  const info = mic.info ?? {};
  const saved = prof?.saved;
  const lines = [
    'Solfejo — diagnóstico de áudio',
    `Navegador: ${navigator.userAgent}`,
    `Tela: ${innerWidth}x${innerHeight} (${devicePixelRatio}x)`,
    `Contexto de áudio: ${ctx.sampleRate} Hz · baseLatency ${((ctx.baseLatency || 0) * 1000).toFixed(1)} ms · outputLatency ${outMs ? outMs.toFixed(1) : 'n/d'} ms · estado ${ctx.state}`,
    `Entrada: ${info.label || 'n/d'} · ${info.sampleRate || 'n/d'} Hz · ${info.channelCount || 'n/d'} canal(is)`,
    `Processamento pedido desligado → aplicado: eco ${info.processing?.echoCancellation}, ruído ${info.processing?.noiseSuppression}, ganho automático ${info.processing?.autoGainControl}`,
    `Saída: ${prof?.outputLabel || 'n/d'} (${prof?.kind || 'n/d'})`,
    `Perfil: ${prof ? profileTitle(prof.key) : 'n/d'}`,
    `Calibração salva: ${saved ? `${saved.offset} ms · variação ±${saved.std != null ? Math.round(saved.std) : 'n/d'} ms · ${saved.n ?? '?'} medidas · ${saved.source === 'echo' ? 'por eco' : saved.source === 'play' ? 'tocando' : 'origem n/d'}` : 'nenhuma'}`,
    `Sinal agora: ${meter.status().text}`,
    noise ? `Ruído de fundo: ${noise.avgDb.toFixed(1)} dB (pico ${noise.peakDb.toFixed(1)} dB)` : 'Ruído de fundo: não medido',
    signal && noise ? `Sinal tocando: ${signal.signalDb.toFixed(1)} dB (pico ${signal.peakDb.toFixed(1)} dB) · diferença ${(signal.signalDb - noise.avgDb).toFixed(1)} dB` : 'Sinal tocando: não medido',
    `Taxa: contexto ${ctx.sampleRate} Hz · microfone ${info.sampleRate || 'n/d'} Hz`,
    `Motor de captura: ${ENGINE_NAME[mic.engine] ?? 'n/d'}${mic.engineNote ? ` (${mic.engineNote})` : ''}`,
    `Regularidade dos quadros: ${statsText(mic)}`,
    stress ? `Teste de carga (${ENGINE_NAME[stress.engine] ?? 'n/d'}): ±${stress.dtStd.toFixed(1)} ms · maior intervalo ${stress.dtMax.toFixed(0)} ms · entrega máx ${stress.deliverMax.toFixed(0)} ms` : 'Teste de carga: não feito',
  ];
  return lines.join('\n');
}
