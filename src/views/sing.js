import { h } from '../dom.js';
import { Mic } from '../music/mic.js';
import { PitchSmoother, SMOOTHING } from '../music/smooth.js';
import { createPitchGraph } from '../ui/pitchGraph.js';
import { load, save } from '../storage.js';
import { SING_DEFAULTS } from './singShared.js';
import { mountMelodyMode } from './singMelody.js';
import { mountNoteMode } from './singNote.js';

const MODES = {
  melody: { label: 'Melodia', mount: mountMelodyMode },
  note: { label: 'Nota única', mount: mountNoteMode },
};

export function mountSing(root) {
  const cfg = load('cfg.sing', SING_DEFAULTS);
  const persist = () => save('cfg.sing', cfg);
  const graph = createPitchGraph({ height: 150 });
  const smoother = new PitchSmoother(SMOOTHING[cfg.smooth] || SMOOTHING.soft);
  const listeners = new Set();
  let unmountMode = null;

  const mic = new Mic((frame) => {
    const sm = smoother.update(frame);
    graph.push(sm);
    listeners.forEach((fn) => fn(frame, sm));
  });

  async function ensureMic() {
    if (!mic.active) {
      try {
        await mic.start();
        graph.setMessage('');
      } catch (err) {
        graph.setMessage(err.name === 'NotSupportedError'
          ? 'Este navegador não permite microfone (use HTTPS ou localhost).'
          : 'Microfone bloqueado. Permita o acesso no ícone de cadeado da barra de endereço e tente de novo.');
        drawMicButton();
        return false;
      }
    }
    drawMicButton();
    return true;
  }

  const btnMic = h('button', { class: 'btn', onclick: async () => {
    if (mic.active) {
      mic.stop();
      smoother.reset();
      graph.reset();
      graph.setMessage('');
      drawMicButton();
    } else {
      await ensureMic();
    }
  } });
  function drawMicButton() {
    btnMic.textContent = mic.active ? '🎤 Mic ligado' : '🎤 Ligar mic';
    btnMic.classList.toggle('active', mic.active);
  }

  const tabs = h('div', { class: 'seg', role: 'tablist' }, Object.entries(MODES).map(([id, m]) =>
    h('button', { class: 'seg-btn', role: 'tab', 'data-mode': id, onclick: () => setMode(id) }, m.label)));
  const host = h('div', { class: 'stack' });
  const slot = h('span', { class: 'head-slot' }); // cada modo coloca aqui o seu botão de ajustes
  root.classList.add('wide');
  root.append(h('div', { class: 'inst-bar' }, tabs, h('span', { class: 'grow' }), btnMic, slot), host);

  const ctx = {
    cfg, persist, graph, ensureMic, slot,
    setSmoothing(level) {
      cfg.smooth = level;
      persist();
      smoother.configure(SMOOTHING[level]);
    },
    resetPitch() {
      smoother.reset();
      graph.reset();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  function setMode(id) {
    if (unmountMode) unmountMode();
    host.replaceChildren();
    slot.replaceChildren();
    cfg.mode = id;
    persist();
    tabs.querySelectorAll('.seg-btn').forEach((b) => {
      const on = b.dataset.mode === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on);
    });
    graph.reset();
    unmountMode = MODES[id].mount(host, ctx);
  }

  drawMicButton();
  graph.setMessage('Use fones de ouvido para a nota de referência e o metrônomo não entrarem no microfone.');
  setMode(MODES[cfg.mode] ? cfg.mode : 'melody');

  return () => {
    if (unmountMode) unmountMode();
    mic.stop();
    graph.destroy();
    root.classList.remove('wide');
  };
}
