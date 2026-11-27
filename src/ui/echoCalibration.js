// Calibração automática por eco: o app toca sinais curtos pela caixa de som, o microfone ouve e o app mede o intervalo.
// É o atraso do equipamento sem o seu erro de tempo no meio (tocar junto com o clique mistura os dois).
import { h } from '../dom.js';
import { getCtx, scheduleBeep } from '../music/audio.js';
import { pairCalibration } from '../music/instrument.js';
import { findOnsets } from '../music/captureCore.js';
import { calStats, calVerdict } from '../music/audioProfile.js';

const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter(Boolean));
const calSgn = (d) => `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(Math.round(d))} ms`;
const round5 = (x) => Math.round(x / 5) * 5;
const N = 10; // sinais
const SKIP = 2; // os dois primeiros esquentam o sistema e não entram na conta
const dots = () => Array.from({ length: N }, (_, i) => h('div', { class: `cal-dot wait${i < SKIP ? ' warm' : ''}` }, h('span', { class: 'cd-n', text: i + 1 }), h('small', { class: 'cd-ms', text: '' })));

/**
 * host: onde colocar o painel. mic: Mic da tela. ensureMic(): liga o microfone se preciso.
 * onApply(offsetMs, { std, n, source: 'echo' }): chamado quando o aluno aceita. Retorna { close }.
 */
export function openEchoCalibration({
  host, mic, ensureMic, onApply, onClose = null,
}) {
  let timer = 0;
  let raf = 0;
  let run = null;
  const body = h('div', { class: 'cal-body' });
  const scrim = h('div', { class: 'modal-scrim', onclick: (e) => { if (e.target === scrim) close(); } },
    h('div', { class: 'modal card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Calibração automática por eco' }, body));
  host.append(scrim);
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);

  function close() {
    clearInterval(timer);
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey, true);
    scrim.remove();
    onClose?.();
  }

  function intro() {
    fill(body,
      h('h2', { text: '🔊 Calibração automática (por eco)' }),
      h('p', { class: 'hint', text: 'O app toca 10 sinais curtos pela caixa de som e escuta pelo microfone. O intervalo entre tocar e ouvir é o atraso do seu equipamento, medido sem a sua mão no meio.' }),
      h('ol', { class: 'cal-steps' },
        h('li', {}, h('b', { text: 'O som precisa sair pela caixa' }), ' (não funciona com fones fechados) e chegar ao microfone: volume médio, microfone voltado para a caixa.'),
        h('li', {}, h('b', { text: 'Fique em silêncio' }), ' e não toque nada durante os 10 sinais (uns 9 segundos).'),
        h('li', {}, 'O resultado vale para esta combinação de microfone e saída. Para outro fone ou caixa, calibre de novo.'),
      ),
      h('div', { class: 'cal-dots ten preview' }, dots()),
      h('div', { class: 'cal-actions' },
        h('button', { class: 'btn primary', onclick: () => start() }, mic.active ? '▶ Começar' : '🎤 Ligar o microfone e começar'),
        h('button', { class: 'btn', onclick: close }, 'Cancelar')),
    );
    body.querySelector('.btn.primary').focus();
  }

  async function start() {
    if (!(await ensureMic())) {
      fill(body, h('h2', { text: 'Microfone indisponível' }), h('p', { class: 'hint', text: 'Permita o microfone no navegador e tente de novo.' }), h('div', { class: 'cal-actions' }, h('button', { class: 'btn', onclick: close }, 'Fechar')));
      return;
    }
    const c = getCtx();
    const b = 700;
    const pre = 1.2; // silêncio antes: mede o ruído de fundo
    const lead = 0.35;
    const t0 = c.currentTime + lead + pre;
    const perf0 = performance.now() + (lead + pre) * 1000;
    for (let i = 0; i < N; i++) scheduleBeep(t0 + (i * b) / 1000);
    run = {
      b, perf0, clicks: Array.from({ length: N }, (_, i) => perf0 + i * b), end: perf0 + N * b + 700, levels: [], pre: [], lastT: 0,
    };
    const lag = mic.lagMs || 42;
    timer = setInterval(() => {
      const { t, rms } = mic.level;
      if (t === run.lastT) return;
      run.lastT = t;
      run.levels.push({ t, r: rms });
      if (t < perf0 - 150) run.pre.push(rms);
    }, 15);
    const ui = { d: dots(), head: h('div', { class: 'cal-head', 'aria-live': 'polite' }) };
    fill(body, h('h2', { text: 'Escutando…' }), ui.head, h('div', { class: 'cal-dots ten' }, ui.d),
      h('p', { class: 'hint', text: 'Fique em silêncio. Os sinais vão soar pela caixa.' }),
      h('div', { class: 'cal-actions' }, h('button', { class: 'btn', onclick: close }, 'Cancelar')));
    const floor = () => { const s = [...run.pre].sort((x, y) => x - y); return s[s.length >> 1] || 0; };
    const loop = () => {
      const now = performance.now();
      if (now >= run.end) { finish(); return; }
      const k = Math.floor((now - perf0) / b);
      ui.head.textContent = now < perf0 ? 'Medindo o ruído de fundo…' : `Sinal ${Math.min(N, k + 1)} de ${N}`;
      const on = findOnsets(run.levels, { floor: floor(), minAbs: 0.006 }).map((o) => ({ t: o.t - lag }));
      const pr = pairCalibration(run.clicks, on, 450);
      ui.d.forEach((d, i) => {
        const delta = pr.deltas[i];
        let st = 'wait';
        if (delta !== null) st = 'hit';
        else if (now > run.clicks[i] + 500) st = 'miss';
        else if (now >= run.clicks[i] - 150) st = 'now';
        if (!d.classList.contains(st)) d.className = `cal-dot ${st}${i < SKIP ? ' warm' : ''}`;
        d.querySelector('.cd-ms').textContent = delta !== null ? calSgn(delta) : st === 'miss' ? '—' : '';
      });
      raf = requestAnimationFrame(loop);
    };
    loop();
  }

  function finish() {
    clearInterval(timer);
    cancelAnimationFrame(raf);
    const s = [...run.pre].sort((x, y) => x - y);
    const floor = s[s.length >> 1] || 0;
    const lag = mic.lagMs || 42;
    const on = findOnsets(run.levels, { floor, minAbs: 0.006 }).map((o) => ({ t: o.t - lag }));
    const pr = pairCalibration(run.clicks, on, 450);
    const st = calStats(pr.deltas.slice(SKIP));
    const verdict = calVerdict(st);
    const d = dots();
    pr.deltas.forEach((x, i) => { d[i].className = `cal-dot ${x === null ? 'miss' : 'hit'}${i < SKIP ? ' warm' : ''}`; d[i].querySelector('.cd-ms').textContent = x === null ? '—' : calSgn(x); });
    if (st.n < 5) {
      fill(body, h('h2', { text: 'Não ouvi os sinais' }),
        h('p', { class: 'hint', text: `Só ouvi ${st.n} de ${N - SKIP} sinais. O som precisa sair pela caixa e chegar ao microfone: aumente o volume do computador, aponte o microfone para a caixa, feche a janela se houver barulho e tente de novo. Com fones fechados este teste não funciona; use a calibração tocando.` }),
        h('div', { class: 'cal-dots ten' }, d),
        h('div', { class: 'cal-actions' }, h('button', { class: 'btn primary', onclick: () => intro() }, '↻ Tentar de novo'), h('button', { class: 'btn', onclick: close }, 'Fechar')));
      return;
    }
    const off = Math.max(-100, Math.min(400, round5(st.median)));
    const bad = verdict.level === 'bad';
    fill(body,
      h('h2', { text: 'Resultado' }),
      h('div', { class: 'cal-result' }, h('div', { class: 'big-score', text: calSgn(off) }),
        h('span', { class: `chip cal-q ${verdict.level === 'ok' ? 'good' : verdict.level === 'warn' ? 'mid' : 'bad'}`, text: verdict.level === 'ok' ? 'Medida confiável' : verdict.level === 'warn' ? 'Medida razoável' : 'Variação alta' })),
      h('p', { class: 'hint', text: verdict.text }),
      h('p', { class: 'hint', text: off > 0
        ? `O app só “ouve” cada som cerca de ${off} ms depois de ele ser tocado (saída + entrada + análise). Vou considerar seus toques ${off} ms mais cedo na avaliação.`
        : off < 0 ? `O app “ouve” cada som cerca de ${-off} ms antes do esperado (a análise marca a hora no meio do bloco de áudio). Vou considerar seus toques ${-off} ms mais tarde na avaliação.` : 'O app ouve os sons junto com o clique: não precisa de ajuste.' }),
      h('div', { class: 'cal-dots ten' }, d),
      h('div', { class: 'cal-actions' },
        h('button', { class: `btn${bad ? '' : ' primary'}`, onclick: () => { onApply(off, { std: st.std, n: st.n, source: 'echo' }); close(); } }, bad ? `Usar ${calSgn(off)} mesmo assim` : `✓ Usar ${calSgn(off)}`),
        h('button', { class: `btn${bad ? ' primary' : ''}`, onclick: () => intro() }, '↻ Repetir'),
        h('button', { class: 'btn', onclick: close }, 'Fechar')),
    );
    (body.querySelector('.btn.primary') || body.querySelector('.btn'))?.focus();
  }

  intro();
  return { close };
}
