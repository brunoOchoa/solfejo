// Gaveta de ajustes (painel que desliza da direita) e componentes de formulário compartilhados.
import { h } from '../dom.js';

export const section = (icon, title, ...kids) => h('section', { class: 'set-sec' }, h('h3', {}, h('span', { class: 'set-ic', text: icon }), title), ...kids);

export const row = (label, hint, control) => h('div', { class: 'set-row' }, h('div', { class: 'set-txt' }, h('b', { text: label }), hint ? h('small', { text: hint }) : null), control);

export const toggle = (on, fn) => h('button', {
  class: 'switch', role: 'switch', 'aria-checked': String(on), onclick: (e) => { const v = e.currentTarget.getAttribute('aria-checked') !== 'true'; e.currentTarget.setAttribute('aria-checked', v); fn(v); },
}, h('span', { class: 'knob' }));

export const segmented = (options, current, fn) => h('div', { class: 'seg mini', role: 'group' }, options.map(([v, label]) => h('button', {
  class: `seg-btn${String(v) === String(current) ? ' active' : ''}`,
  onclick: (e) => { e.currentTarget.parentNode.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === e.currentTarget)); fn(v); },
}, label)));

/** Cria a gaveta. Retorna { drawer, scrim, body, set(open), isOpen(), returnFocus }. Anexe drawer e scrim ao DOM. */
export function createDrawer(title, openBtn) {
  let open = false;
  const body = h('div', { class: 'drawer-body' });
  const drawer = h('aside', { class: 'drawer card', 'aria-label': title, inert: true },
    h('div', { class: 'drawer-head' }, h('b', { text: title }),
      h('button', { class: 'btn', 'aria-label': 'Fechar', onclick: () => set(false) }, '✕')),
    body);
  const scrim = h('div', { class: 'scrim', onclick: () => set(false) });
  function set(v) {
    open = v;
    drawer.classList.toggle('open', v);
    scrim.classList.toggle('open', v);
    drawer.inert = !v;
    if (v) drawer.querySelector('select, input, button')?.focus();
    else openBtn?.focus({ preventScroll: true });
  }
  return { drawer, scrim, body, set, isOpen: () => open };
}
