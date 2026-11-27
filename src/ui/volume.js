// Botão "🔊 Volume" com um painel de controles: volume do instrumento e do metrônomo, separados por aba.
import { h } from '../dom.js';
import { createSlider } from './slider.js';
import {
  getVolume, setVolume, getCtx, scheduleClick, playPitch,
} from '../music/audio.js';

const icon = (v) => (v === 0 ? '🔇' : v < 50 ? '🔈' : v < 120 ? '🔉' : '🔊');
const caption = (v) => (v === 0 ? 'Sem som' : v > 100 ? 'Acima do normal: use fones para não vazar no microfone' : v === 100 ? 'Volume normal' : '');

/**
 * inst: mostra o volume do instrumento (notas, referência). click: mostra o do metrônomo.
 * Os valores valem para a aba atual (a aba é definida em main.js via setAudioTab).
 */
export function createVolumeControl({ inst = true, click = true } = {}) {
  const btn = h('button', { class: 'btn vol-btn', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', onclick: () => toggle() }, '🔊 Volume');
  const sliders = [];
  if (inst) {
    sliders.push(createSlider({
      label: 'Instrumento', icon, min: 0, max: 200, step: 5, value: Math.round(getVolume('inst') * 100), mark: 100,
      format: (v) => `${v}%`, caption, className: 'vol-slider',
      onInput: (v) => setVolume('inst', v / 100),
      onChange: () => { getCtx(); playPitch({ step: 28, acc: 0 }, 0.7); },
    }));
  }
  if (click) {
    sliders.push(createSlider({
      label: 'Metrônomo', icon, min: 0, max: 200, step: 5, value: Math.round(getVolume('click') * 100), mark: 100,
      format: (v) => `${v}%`, caption, className: 'vol-slider',
      onInput: (v) => setVolume('click', v / 100),
      onChange: () => { const t = getCtx().currentTime + 0.03; scheduleClick(t, true); scheduleClick(t + 0.4); },
    }));
  }
  const pop = h('div', { class: 'vol-pop card', role: 'dialog', 'aria-label': 'Volume', hidden: true },
    h('div', { class: 'vol-title' }, h('b', { text: 'Volume desta aba' }), h('small', { text: 'cada aba guarda o seu' })),
    ...sliders.map((s) => s.el));
  const el = h('div', { class: 'vol-wrap' }, btn, pop);

  function place() {
    const r = btn.getBoundingClientRect();
    const w = Math.min(340, window.innerWidth - 20);
    pop.style.width = `${w}px`;
    pop.style.top = `${r.bottom + 6}px`;
    pop.style.left = `${Math.max(10, Math.min(window.innerWidth - w - 10, r.right - w))}px`;
  }
  function close() {
    if (pop.hidden) return;
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', close);
  }
  function onOutside(e) { if (!el.contains(e.target)) close(); }
  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); btn.focus(); } }
  function toggle() {
    if (!pop.hidden) { close(); return; }
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    place();
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
  }
  return { el, close };
}
