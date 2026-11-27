// Painel "Aparência": modo (auto/claro/escuro) + paleta de cores, com prévia ao vivo.
import { h } from '../dom.js';
import {
  getPerfMode, setPerfMode, isLite, recentFps, perfReport,
} from '../perf.js';
import { icon } from './icons.js';
import {
  PALETTES, THEME_LABEL, getTheme, setTheme, getPaletteId, setPalette, effectiveTheme,
} from '../theme.js';

const MODE_ICON = { auto: 'auto', light: 'sol', dark: 'lua' };
let current = null; // { close }

export function toggleThemePicker(anchor) {
  if (current) { current.close(); return; }
  current = openPicker(anchor);
}

function openPicker(anchor) {
  const modeBtns = Object.keys(THEME_LABEL).map((m) => {
    const b = h('button', { type: 'button', class: 'tp-mode', role: 'radio', 'data-mode': m },
      (() => { const i = h('span', { class: 'tp-mi' }); i.innerHTML = icon(MODE_ICON[m], '1.05rem'); return i; })(), h('span', { text: THEME_LABEL[m] }));
    b.addEventListener('click', () => { setTheme(m); paint(); });
    return b;
  });
  const modes = h('div', { class: 'tp-modes', role: 'radiogroup', 'aria-label': 'Modo' }, ...modeBtns);

  const cards = PALETTES.map((p) => {
    const c = h('button', { type: 'button', class: 'tp-card', role: 'radio', 'data-id': p.id },
      h('span', { class: 'tp-prev', 'aria-hidden': 'true' },
        h('i', { class: 'tp-bar' }), h('i', { class: 'tp-dot a' }), h('i', { class: 'tp-dot b' }), h('i', { class: 'tp-line' })),
      h('span', { class: 'tp-name', text: p.name }),
      h('span', { class: 'tp-tag', text: p.tag }));
    c.addEventListener('click', () => { setPalette(p.id); paint(); });
    return c;
  });
  const grid = h('div', { class: 'tp-grid', role: 'radiogroup', 'aria-label': 'Paleta de cores' }, ...cards);

  const panel = h('div', { class: 'tp', role: 'dialog', 'aria-label': 'Aparência' },
    h('div', { class: 'tp-head' }, h('b', { text: 'Aparência' }), h('button', { type: 'button', class: 'tp-x', 'aria-label': 'Fechar', text: '✕' })),
    h('div', { class: 'tp-sec', text: 'Modo' }), modes,
    h('div', { class: 'tp-sec', text: 'Paleta' }), grid);
  const perfLabels = { auto: 'Auto', full: 'Completo', lite: 'Leve' };
  const perfBtns = Object.keys(perfLabels).map((m) => {
    const b = h('button', { type: 'button', class: 'tp-mode', role: 'radio', 'data-perf': m, text: perfLabels[m] });
    b.addEventListener('click', () => { setPerfMode(m); paint(); });
    return b;
  });
  const perfInfo = h('p', { class: 'tp-perf' });
  panel.append(
    h('div', { class: 'tp-sec', text: 'Desempenho' }),
    h('div', { class: 'tp-modes', role: 'radiogroup', 'aria-label': 'Desempenho' }, ...perfBtns),
    perfInfo,
    h('button', { type: 'button', class: 'btn tp-copy', onclick: async (e) => {
      const b = e.currentTarget;
      try { await navigator.clipboard.writeText(perfReport()); b.textContent = '✓ Relatório copiado'; } catch { b.textContent = 'Não consegui copiar'; }
    } }, '📋 Copiar relatório de desempenho'),
  );
  const scrim = h('div', { class: 'tp-scrim' });

  function paint() {
    const pm = getPerfMode();
    perfBtns.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.perf === pm)));
    const f = recentFps();
    perfInfo.textContent = `${isLite() ? 'Modo leve ligado: animações simplificadas. ' : ''}${f.length ? `Fluidez nas últimas trocas de aba: ${f.join(', ')} fps.` : 'Troque de aba para medir a fluidez.'} Auto liga o modo leve sozinho se o aparelho ficar abaixo de ~30 fps.`;
    const m = getTheme();
    modeBtns.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === m)));
    const pid = getPaletteId();
    const eff = effectiveTheme();
    cards.forEach((c) => {
      const p = PALETTES.find((x) => x.id === c.dataset.id)[eff];
      c.setAttribute('aria-checked', String(c.dataset.id === pid));
      c.style.setProperty('--p-bg', p.bg); c.style.setProperty('--p-card', p.card); c.style.setProperty('--p-ink', p.ink);
      c.style.setProperty('--p-a', p.brand); c.style.setProperty('--p-b', p.brand2); c.style.setProperty('--p-line', p.line);
    });
  }
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const onThemeChange = () => paint();
  function close() {
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('themechange', onThemeChange);
    window.removeEventListener('perfchange', onThemeChange);
    panel.classList.add('out'); scrim.classList.add('out');
    setTimeout(() => { panel.remove(); scrim.remove(); }, 160);
    anchor.setAttribute('aria-expanded', 'false');
    current = null;
    anchor.focus({ preventScroll: true });
  }
  panel.querySelector('.tp-x').addEventListener('click', close);
  scrim.addEventListener('pointerdown', close);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('themechange', onThemeChange);
  window.addEventListener('perfchange', onThemeChange);
  anchor.setAttribute('aria-expanded', 'true');
  paint();
  document.body.append(scrim, panel);
  panel.querySelector(`.tp-card[aria-checked="true"]`)?.focus({ preventScroll: true });
  return { close };
}
