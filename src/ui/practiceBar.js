// Barra de controles das telas de Praticar (escalas, acordes e músicas), em duas faixas:
//  1) contexto à esquerda (instrumento, área, modo) e ferramentas à direita (microfone, volume, foco, ajustes);
//  2) o exercício: o essencial à vista e "Mais opções" abrindo o resto.
import { h } from '../dom.js';
import { icon } from './icons.js';
import { load, save } from '../storage.js';

/** Botão só de ícone (40 × 40), com nome para leitor de tela e dica ao passar o mouse. */
export function iconButton(name, label, onclick, extra = {}) {
  const b = h('button', {
    class: 'btn icon-btn', type: 'button', title: label, 'aria-label': label, onclick, ...extra,
  });
  b.innerHTML = icon(name, '1.2rem');
  return b;
}

/** Microfone e medidor de sinal juntos, como um botão só. */
export const micGroup = (btnMic, meterEl) => h('div', { class: 'pbar-mic' }, btnMic, meterEl);

/** Faixa 1. ctx e tools são listas de elementos. */
export function createPracticeBar(ctx, tools) {
  return h('div', { class: 'inst-bar pbar-bar' }, h('div', { class: 'pbar-ctx' }, ...ctx.filter(Boolean)), h('div', { class: 'pbar-tools' }, ...tools.filter(Boolean)));
}

/**
 * Faixa 2. set(primary, extra): primary fica sempre à vista; extra abre com "Mais opções" (a escolha é lembrada).
 * No celular o painel inteiro abre pelo botão "Exercício" da barra e mostra tudo.
 */
export function createExerciseRows() {
  const el = h('div', { class: 'pbar-rows collapsible' });
  const main = h('div', { class: 'pbar-ex' });
  const moreIn = h('div', { class: 'pbar-more-in' });
  const more = h('div', { class: 'pbar-more' }, moreIn);
  const btn = h('button', { class: 'btn pbar-morebtn', type: 'button', 'aria-expanded': 'false' }, 'Mais opções ', h('span', { class: 'chev', 'aria-hidden': 'true', text: '▾' }));
  let open = load('ui.moreOpts', false) === true;
  const paint = () => {
    more.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.classList.toggle('on', open);
  };
  btn.addEventListener('click', () => { open = !open; save('ui.moreOpts', open); paint(); });
  el.append(main, more);
  paint();
  return {
    el,
    set(primary, extra = []) {
      main.replaceChildren(...primary.filter(Boolean), extra.length ? btn : null);
      moreIn.replaceChildren(...extra.filter(Boolean));
      more.toggleAttribute('hidden', !extra.length);
    },
  };
}
