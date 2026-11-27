// Calibração guiada da latência para qualquer instrumento (inclusive acordes): o app dá cliques, você toca junto e o app mede
// o atraso entre o clique e o ataque do som (aumento rápido de volume). Não depende de altura: funciona com notas, acordes e palhetadas.
import { h } from '../dom.js';
import { getCtx, scheduleClick } from '../music/audio.js';
import { pairCalibration } from '../music/instrument.js';
import {
  calStats, calVerdict, clickLeak, leakText,
} from '../music/audioProfile.js';

const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter(Boolean));
const calSgn = (d) => `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(Math.round(d))} ms`;
const round5 = (x) => Math.round(x / 5) * 5;
const dots = (n = 8) => Array.from({ length: n }, (_, i) => h('div', { class: 'cal-dot wait' }, h('span', { class: 'cd-n', text: i + 1 }), h('small', { class: 'cd-ms', text: '' })));

/**
 * host: onde colocar o painel. mic: o Mic da tela (ligado). ensureMic(): liga o microfone se preciso.
 * onApply(offsetMs, { std, n }): chamado quando o aluno aceita o resultado. instrumentLabel: "violão", "teclado"…
 * Retorna { close }.
 */
export function openCalibration({
  host, mic, ensureMic, onApply, instrumentLabel = 'instrumento', onClose = null,
}) {
  let timer = 0;
  let raf = 0;
  let run = null;
  const body = h('div', { class: 'cal-body' });
  const scrim = h('div', { class: 'modal-scrim', onclick: (e) => { if (e.target === scrim) close(); } },
    h('div', { class: 'modal card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Calibrar latência' }, body));
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
      h('h2', { text: '🎯 Calibrar a latência' }),
      h('p', { class: 'hint', text: 'Microfone e fones têm um pequeno atraso. Vou medir o do seu equipamento para o app descontar nas avaliações com metrônomo.' }),
      h('ol', { class: 'cal-steps' },
        h('li', {}, h('b', { text: 'Use fones de ouvido' }), ', para o clique não entrar no microfone.'),
        h('li', {}, h('b', { text: 'Escolha um som curto e seco' }), ` no ${instrumentLabel} (uma nota, ou um acorde palhetado) e deixe-o pronto.`),
        h('li', {}, 'Vão soar ', h('b', { text: '4 cliques de contagem' }), ' e depois ', h('b', { text: '8 cliques' }), '. Toque ', h('b', { text: 'no instante de cada um dos 8' }), '.'),
      ),
      h('div', { class: 'cal-dots preview' }, dots()),
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
    const b = 750;
    const lead = 0.35;
    const t0 = c.currentTime + lead;
    const perf0 = performance.now() + lead * 1000;
    for (let i = 0; i < 12; i++) scheduleClick(t0 + (i * b) / 1000, i === 0 || i === 4);
    run = {
      b, countStart: perf0, clicks: Array.from({ length: 8 }, (_, i) => perf0 + (4 + i) * b), end: perf0 + 12 * b + 650, onsets: [], lastVoiced: 0, hist: [], lastOnset: -1e9,
    };
    // ataque = volume sobe pelo menos 2,5 vezes em relação a ~100–200 ms antes
    const lag = mic.lagMs || 42;
    timer = setInterval(() => {
      const t = mic.level.t;
      const r = mic.level.rms;
      const h2 = run.hist;
      if (h2.length && h2[h2.length - 1].t === t) return;
      const older = h2.filter((x) => t - x.t >= 90 && t - x.t <= 220).map((x) => x.r);
      if (older.length && r >= Math.max(0.012, Math.min(...older) * 2.5) && t - run.lastOnset > 300) {
        run.onsets.push({ t: t - lag });
        run.lastOnset = t;
      }
      if (r > 0.012) run.lastVoiced = t;
      h2.push({ t, r });
      if (h2.length > 20) h2.shift();
    }, 20);
    const ui = { d: dots(), head: h('div', { class: 'cal-head', 'aria-live': 'polite' }), micEl: h('div', { class: 'cal-mic' }, h('span', { class: 'pulse-dot' }), ' ouvindo você…') };
    fill(body, h('h2', { text: 'Toque junto com o clique' }), ui.head, h('div', { class: 'cal-dots' }, ui.d), ui.micEl,
      h('div', { class: 'cal-actions' }, h('button', { class: 'btn', onclick: close }, 'Cancelar')));
    const loop = () => {
      const now = performance.now();
      if (now >= run.end) { finish(); return; }
      const k = Math.floor((now - run.countStart) / run.b);
      ui.head.textContent = k < 0 ? 'Já vai começar…' : k < 4 ? `Prepare-se… ${k + 1}` : '🎵 Toque agora, um por clique!';
      ui.head.classList.toggle('go', k >= 4);
      const pr = pairCalibration(run.clicks, run.onsets);
      ui.d.forEach((d, i) => {
        const delta = pr.deltas[i];
        let st = 'wait';
        if (delta !== null) st = 'hit';
        else if (now > run.clicks[i] + 380) st = 'miss';
        else if (now >= run.clicks[i] - 150) st = 'now';
        if (!d.classList.contains(st)) d.className = `cal-dot ${st}`;
        d.querySelector('.cd-ms').textContent = delta !== null ? calSgn(delta) : st === 'miss' ? '—' : '';
      });
      ui.micEl.classList.toggle('on', performance.now() - mic.level.t < 300 && mic.level.t - run.lastVoiced < 300);
      raf = requestAnimationFrame(loop);
    };
    loop();
  }

  function finish() {
    clearInterval(timer);
    cancelAnimationFrame(raf);
    const pr = pairCalibration(run.clicks, run.onsets);
    const st = calStats(pr.deltas);
    const verdict = calVerdict(st);
    const d = dots();
    pr.deltas.forEach((x, i) => { d[i].className = `cal-dot ${x === null ? 'miss' : 'hit'}`; d[i].querySelector('.cd-ms').textContent = x === null ? '—' : calSgn(x); });
    if (st.n < 5) {
      fill(body, h('h2', { text: 'Não consegui medir' }), h('p', { class: 'hint', text: `Só detectei ${st.n} de 8 toques. ${verdict.text}` }), h('div', { class: 'cal-dots' }, d),
        h('div', { class: 'cal-actions' }, h('button', { class: 'btn primary', onclick: () => intro() }, '↻ Tentar de novo'), h('button', { class: 'btn', onclick: close }, 'Fechar')));
      return;
    }
    const off = Math.max(-100, Math.min(400, round5(st.median)));
    const leak = clickLeak([0, 1, 2, 3].map((i) => run.countStart + i * run.b), run.onsets.map((o) => o.t));
    const bad = leak >= 2 || verdict.level === 'bad';
    fill(body,
      h('h2', { text: 'Resultado' }),
      h('div', { class: 'cal-result' }, h('div', { class: 'big-score', text: calSgn(off) }), h('span', { class: `chip cal-q ${leak >= 2 ? 'bad' : verdict.level === 'ok' ? 'good' : verdict.level === 'warn' ? 'mid' : 'bad'}`, text: leak >= 2 ? 'Clique vazando' : verdict.level === 'ok' ? 'Medida confiável' : verdict.level === 'warn' ? 'Medida razoável' : 'Variação alta' })),
      h('p', { class: 'hint', text: leak >= 2 ? leakText(leak) : verdict.text }),
      h('p', { class: 'hint', text: off > 0 ? `Seus toques chegam cerca de ${off} ms depois do clique (atraso do equipamento + seu tempo). Vou considerá-los ${off} ms mais cedo.` : off < 0 ? `Seus toques chegam ${-off} ms antes do clique. Vou considerá-los ${-off} ms mais tarde.` : 'Seus toques chegam junto com o clique: não precisa de ajuste.' }),
      h('div', { class: 'cal-dots' }, d),
      h('div', { class: 'cal-actions' },
        h('button', { class: `btn${bad ? '' : ' primary'}`, onclick: () => { onApply(off, { ...st, source: 'play' }); close(); } }, bad ? `Usar ${calSgn(off)} mesmo assim` : `✓ Usar ${calSgn(off)}`),
        h('button', { class: 'btn', onclick: () => intro() }, '↻ Repetir'),
        h('button', { class: 'btn', onclick: close }, 'Fechar')),
    );
    (body.querySelector('.btn.primary') || body.querySelector('.btn'))?.focus();
  }

  intro();
  return { close };
}
