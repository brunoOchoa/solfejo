// Submenu flutuante do Praticar: uma pílula abaixo do cabeçalho com o instrumento (lista suspensa, cabe qualquer número de
// instrumentos) e as abas da área (violino: Escalas e Músicas; outros: Acordes e Notas soltas). Sempre à vista, para saber onde se está.
import { h } from '../dom.js';

const INSTR_DESC = { piano: 'acordes e notas', violin: 'escalas e músicas', guitar: 'acordes e notas' };

/** Áreas de cada instrumento: [id, rótulo]. */
export const areasFor = (instr) => (instr === 'violin' ? [['scales', 'Escalas'], ['songs', 'Músicas']] : [['chords', 'Acordes'], ['notes', 'Notas soltas']]);
/** Área ativa, a partir da configuração. */
export const areaOf = (cfg) => (cfg.instr === 'violin' ? (cfg.area === 'songs' ? 'songs' : 'scales') : (cfg.content === 'notes' ? 'notes' : 'chords'));

/**
 * instruments: { id: { label, icon } }. getCfg(): configuração atual. onInstrument(id) e onArea(id) fazem a troca.
 * Retorna { el, paint, destroy }.
 */
export function createPracticeNav({
  instruments, getCfg, onInstrument, onArea,
}) {
  const instBtn = h('button', {
    class: 'psub-inst', type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', title: 'Escolher o instrumento',
  });
  const areas = h('div', { class: 'seg psub-areas', role: 'tablist', 'aria-label': 'Área' });
  const pill = h('div', { class: 'psub-pill' }, instBtn, h('span', { class: 'psub-sep', 'aria-hidden': 'true' }), areas);
  const el = h('div', { class: 'psub' }, pill);
  let list = null;

  function paint() {
    const cfg = getCfg();
    const p = instruments[cfg.instr] ?? Object.values(instruments)[0];
    instBtn.replaceChildren(h('span', { class: 'psub-ic', text: p.icon }), h('span', { class: 'psub-name', text: p.label }), h('span', { class: 'chev', 'aria-hidden': 'true', text: '▾' }));
    instBtn.setAttribute('aria-label', `Instrumento: ${p.label}. Trocar.`);
    const active = areaOf(cfg);
    areas.replaceChildren(...areasFor(cfg.instr).map(([id, label]) => h('button', {
      class: `seg-btn${id === active ? ' active' : ''}`, role: 'tab', type: 'button', 'aria-selected': String(id === active), onclick: () => { if (id !== areaOf(getCfg())) onArea(id); },
    }, label)));
  }

  function close(refocus = false) {
    if (!list) return;
    const l = list;
    list = null;
    l.classList.add('out');
    setTimeout(() => l.remove(), 120);
    instBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onWin);
    window.removeEventListener('scroll', onWin, true);
    if (refocus) instBtn.focus({ preventScroll: true });
  }
  const onOutside = (e) => { if (!list?.contains(e.target) && !instBtn.contains(e.target)) close(); };
  const onWin = (e) => { if (!list?.contains(e?.target)) close(); };
  const onKey = (e) => {
    if (!list) return;
    const items = [...list.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(items.length - 1, i + 1)]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[Math.max(0, i - 1)]?.focus(); }
  };
  function open() {
    if (list) { close(true); return; }
    const cfg = getCfg();
    list = h('ul', { class: 'psub-list', role: 'listbox', 'aria-label': 'Instrumento' }, ...Object.entries(instruments).map(([id, p]) => h('li', {},
      h('button', {
        class: `psub-opt${id === cfg.instr ? ' sel' : ''}`, type: 'button', role: 'option', 'aria-selected': String(id === cfg.instr),
        onclick: () => { close(); if (id !== getCfg().instr) onInstrument(id); },
      }, h('span', { class: 'psub-ic', text: p.icon }), h('span', { class: 'psub-txt' }, h('b', { text: p.label }), h('small', { text: INSTR_DESC[id] ?? '' })), h('span', { class: 'psub-ck', 'aria-hidden': 'true', text: id === cfg.instr ? '✓' : '' })))));
    document.body.append(list);
    const r = instBtn.getBoundingClientRect();
    list.style.top = `${r.bottom + 6}px`;
    list.style.left = `${Math.max(8, Math.min(window.innerWidth - list.offsetWidth - 8, r.left))}px`;
    instBtn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onWin);
    window.addEventListener('scroll', onWin, true);
    (list.querySelector('.sel') || list.querySelector('button'))?.focus({ preventScroll: true });
  }
  instBtn.addEventListener('click', open);
  paint();
  return { el, paint, destroy: () => close() };
}
