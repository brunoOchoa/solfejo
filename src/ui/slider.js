// Controle deslizante bonito: valor grande, botões − / +, trilha preenchida e legenda.
import { h } from '../dom.js';

/**
 * label/icon: título (icon pode ser função do valor). format(v): texto do valor. caption(v): legenda sob a trilha.
 * mark: valor com marcador na trilha (ex.: 100%). tap: mostra botão "Tap" para marcar o andamento batendo.
 * compact: sem cabeçalho (para linhas de ajustes). onInput: enquanto arrasta; onChange: ao soltar/clicar.
 */
export function createSlider({
  label = '', icon = null, min, max, step = 1, value, format = (v) => String(v), caption = null,
  mark = null, tap = false, compact = false, onInput = () => {}, onChange = () => {}, className = '',
}) {
  let v = value;
  const out = h('output', { class: 'sl-val' });
  const ic = h('span', { class: 'sl-ic', 'aria-hidden': 'true' });
  const cap = h('div', { class: 'sl-cap' });
  const input = h('input', {
    type: 'range', min, max, step, value: v, 'aria-label': label || 'valor',
    oninput: (e) => { v = Number(e.target.value); paint(); onInput(v); },
    onchange: (e) => { v = Number(e.target.value); paint(); onChange(v); },
  });
  const clamp = (x) => Math.max(min, Math.min(max, x));
  const nudge = (d) => { v = clamp(Math.round((v + d) / step) * step); input.value = v; paint(); onInput(v); onChange(v); };
  const stepBtn = (sym, d, aria) => h('button', {
    class: 'sl-step', type: 'button', 'aria-label': aria, onclick: (e) => nudge(d * step * (e.shiftKey ? 5 : 1)),
  }, sym);
  const track = h('div', { class: 'sl-track' }, input);
  if (mark != null) {
    track.style.setProperty('--mark', `${((mark - min) / (max - min)) * 100}%`);
    track.classList.add('has-mark');
  }

  let taps = [];
  const tapBtn = tap ? h('button', {
    class: 'sl-tap', type: 'button', title: 'Bata no ritmo desejado (4 toques ou mais)',
    onclick: () => {
      const now = performance.now();
      if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
      taps.push(now);
      taps = taps.slice(-6);
      if (taps.length >= 3) {
        const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
        v = clamp(Math.round(60000 / avg / step) * step);
        input.value = v; paint(); onInput(v); onChange(v);
      }
    },
  }, '👆 Tap') : null;

  function paint() {
    out.textContent = format(v);
    const pct = ((v - min) / (max - min)) * 100;
    el.style.setProperty('--pct', `${pct}%`);
    const i = typeof icon === 'function' ? icon(v) : icon;
    ic.textContent = i || '';
    cap.textContent = caption ? caption(v) : '';
    cap.hidden = !caption;
    el.classList.toggle('over', mark != null && v > mark);
  }

  const head = compact ? null : h('div', { class: 'sl-head' }, ic, h('span', { class: 'sl-label', text: label }), tapBtn, out);
  const el = h('div', { class: `slider${compact ? ' compact' : ''} ${className}`.trim() },
    head,
    h('div', { class: 'sl-row' }, stepBtn('−', -1, `Diminuir ${label}`), track, stepBtn('+', 1, `Aumentar ${label}`), compact ? out : null),
    compact ? null : cap);
  paint();
  return {
    el,
    set(x) { v = clamp(x); input.value = v; paint(); },
    get value() { return v; },
  };
}

/** Nome italiano do andamento. */
export function tempoName(bpm) {
  if (bpm <= 60) return 'Largo (bem lento)';
  if (bpm <= 76) return 'Adagio (lento)';
  if (bpm <= 108) return 'Andante (caminhando)';
  if (bpm <= 120) return 'Moderato';
  if (bpm <= 156) return 'Allegro (rápido)';
  return 'Vivace (bem rápido)';
}
