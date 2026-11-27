// Afinador: violão, violino e teclado. Automático (reconhece a corda/nota) ou corda escolhida;
// ouve você afinando e/ou toca a nota de referência.
import { h, select, isFormTarget } from '../dom.js';
import { pitchClassName } from '../music/theory.js';
import {
  TUNERS, stringsOf, freqOfMidi, centsTo, midiFloat, octaveNumber, nearestString, nearestNote,
  FreqSmoother, StringLock, advice,
} from '../music/tuner.js';
import { HoldTracker } from '../music/smooth.js';
import { Mic } from '../music/mic.js';
import {
  getCtx, scheduleFreq, stopAll, feedbackTick,
} from '../music/audio.js';
import { createPitchGraph } from '../ui/pitchGraph.js';
import {
  section, row, toggle, segmented, createDrawer,
} from '../ui/drawer.js';
import { createSlider } from '../ui/slider.js';
import { createVolumeControl } from '../ui/volume.js';
import { load, save } from '../storage.js';

const DEFAULTS = {
  instr: 'guitar', mode: 'auto', tuning: 'standard', sel: 0, pianoMidi: 69,
  refA: 440, tol: 5, tone: 'instrument', hear: false,
};
const BANK = { piano: 'piano', violin: 'violin', guitar: 'guitar' };
const PIANO_NOTES = Array.from({ length: 12 }, (_, i) => i); // classes de altura a partir de Dó
const fmtHz = (f) => `${f.toFixed(1).replace('.', ',')} Hz`;
const sgn = (c) => `${c > 0 ? '+' : c < 0 ? '−' : ''}${Math.abs(Math.round(c))}`;
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function mountTuner(root) {
  const cfg = load('cfg.tuner', DEFAULTS);
  const persist = () => save('cfg.tuner', cfg);
  if (!TUNERS[cfg.instr]) cfg.instr = 'guitar';
  const prof = () => TUNERS[cfg.instr];
  const strings = () => stringsOf(cfg.instr, cfg.tuning);
  const chromatic = () => !!prof().chromatic;
  if (!chromatic() && !strings().length) cfg.tuning = 'standard';

  let tuned = new Set(); // cordas (índice) ou notas (midi) já confirmadas nesta sessão
  let lastIdx = null; // última corda reconhecida (modo automático)
  let muteUntil = 0;
  let drone = 0;
  let sinceVoiced = -Infinity;
  let shownCents = null;
  let allDoneTimer = 0;
  let lastTargetKey = '';

  const smoother = new FreqSmoother();
  const lock = new StringLock(4);
  let tracker = new HoldTracker({ tolCents: cfg.tol, holdMs: 900, graceMs: 250 });

  // ---- microfone -------------------------------------------------------------------------------
  const graph = createPitchGraph({ height: 130 });
  const mic = new Mic((frame) => onFrame(frame), prof().mic);
  const btnMic = h('button', { class: 'btn', onclick: () => toggleMic() });
  async function toggleMic() {
    if (mic.active) {
      mic.stop();
      graph.reset();
    } else {
      try {
        mic.detect = prof().mic;
        await mic.start();
        graph.setMessage('');
      } catch (err) {
        graph.setMessage(err.name === 'NotSupportedError'
          ? 'Este navegador não permite microfone (use HTTPS ou localhost).'
          : 'Microfone bloqueado. Permita o acesso no ícone de cadeado da barra de endereço e tente de novo.');
      }
    }
    drawMic();
    paintIdle();
  }
  function drawMic() {
    btnMic.textContent = mic.active ? '🎤 Mic ligado' : '🎤 Ligar mic';
    btnMic.classList.toggle('active', mic.active);
  }

  // ---- elementos -------------------------------------------------------------------------------
  const instrTabs = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Instrumento' }, Object.entries(TUNERS).map(([id, p]) =>
    h('button', { class: 'seg-btn', role: 'tab', 'data-instr': id, onclick: () => update({ instr: id }) }, h('span', { text: p.icon }), h('span', { class: 'lbl', text: ` ${p.label}` }))));
  const modeTabs = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Modo' });
  const chips = h('div', { class: 'info-row' });
  const noteEl = h('span', { class: 'nm', text: '—' });
  const octEl = h('sub', { class: 'oc' });
  const subEl = h('div', { class: 'tn-sub' });
  const needle = h('div', { class: 'needle-bar' });
  const zone = h('div', { class: 'gauge-zone' });
  const gauge = h('div', { class: 'gauge', role: 'img', 'aria-label': 'Medidor de afinação, de −50 a +50 cents' }, zone, needle,
    h('span', { class: 'g-lbl l', text: '♭ grave' }), h('span', { class: 'g-lbl c', text: '0' }), h('span', { class: 'g-lbl r', text: 'aguda ♯' }));
  const adviceEl = h('div', { class: 'tn-advice', 'aria-live': 'polite' });
  const holdFill = h('div', { class: 'hold-fill' });
  const hold = h('div', { class: 'hold-bar', role: 'progressbar', 'aria-label': 'Tempo afinada' }, holdFill);
  const display = h('div', { class: 'tn-display idle' }, h('div', { class: 'tn-note' }, noteEl, octEl), subEl, gauge, adviceEl, hold);
  const mainCard = h('section', { class: 'card tn-card' }, chips, display, graph.el);

  const listEl = h('div', { class: 'str-list' });
  const btnPlay = h('button', { class: 'btn primary', onclick: () => playRef() }, '🔊 Tocar a nota');
  const btnDrone = h('button', { class: 'btn', 'aria-pressed': 'false', onclick: () => toggleDrone() }, '🔁 Repetir');
  const btnAll = h('button', { class: 'btn', onclick: () => playAll() }, '🎼 Todas');
  const btnClear = h('button', { class: 'btn', onclick: () => { tuned = new Set(); lastIdx = null; drawList(); paintIdle(); } }, '↺ Limpar ✓');
  const side = h('section', { class: 'card tn-side' },
    h('div', { class: 'side-title' }, h('b', { class: 'st-name' }), h('span', { class: 'st-count' })),
    listEl,
    h('div', { class: 'actions' }, btnPlay, h('div', { class: 'actions-sub' }, btnDrone, btnAll, btnClear)));
  const sideName = side.querySelector('.st-name');
  const sideCount = side.querySelector('.st-count');

  const btnCfg = h('button', { class: 'btn', 'aria-haspopup': 'dialog', onclick: () => dr.set(true) }, '⚙ Ajustes');
  const dr = createDrawer('Ajustes do afinador', btnCfg);
  root.classList.add('wide');
  root.append(
    h('div', { class: 'inst-bar' }, instrTabs, modeTabs, h('span', { class: 'grow' }), btnMic, createVolumeControl({ click: false }).el, btnCfg),
    h('div', { class: 'inst-grid tuner-grid' }, mainCard, side),
    dr.scrim, dr.drawer,
  );

  // ---- alvo atual -------------------------------------------------------------------------------
  /** Corda/nota que o app considera "alvo" agora (para tocar a referência e para a lista). */
  function targetMidi() {
    if (chromatic()) return cfg.mode === 'manual' ? cfg.pianoMidi : 69;
    const s = strings();
    if (cfg.mode === 'manual') return s[Math.min(cfg.sel, s.length - 1)].midi;
    const i = lastIdx ?? s.findIndex((_, k) => !tuned.has(k));
    return s[Math.max(0, i)].midi;
  }

  // ---- referência sonora -----------------------------------------------------------------------
  const bank = () => (cfg.tone === 'instrument' ? BANK[cfg.instr] : null);
  function playMidi(midi, at, dur) {
    scheduleFreq(freqOfMidi(midi, cfg.refA), at, dur, { bank: bank(), gain: 0.32 });
  }
  function playRef() {
    stopAll();
    const dur = 2.6;
    playMidi(targetMidi(), getCtx().currentTime + 0.03, dur);
    if (!cfg.hear) muteUntil = performance.now() + dur * 1000 + 350;
  }
  function playAll() {
    stopAll();
    const c = getCtx();
    const s = strings();
    s.forEach((st, i) => playMidi(st.midi, c.currentTime + 0.05 + i * 1.1, 1.6));
    if (!cfg.hear) muteUntil = performance.now() + s.length * 1100 + 700;
  }
  function toggleDrone() {
    if (drone) { stopDrone(); return; }
    btnDrone.classList.add('active');
    btnDrone.setAttribute('aria-pressed', 'true');
    const tick = () => {
      playMidi(targetMidi(), getCtx().currentTime + 0.02, 3.2);
    };
    tick();
    drone = setInterval(tick, 3000);
    if (!cfg.hear) muteUntil = Infinity;
    paintIdle();
  }
  function stopDrone() {
    clearInterval(drone);
    drone = 0;
    stopAll();
    muteUntil = 0;
    btnDrone.classList.remove('active');
    btnDrone.setAttribute('aria-pressed', 'false');
  }

  // ---- leitura do microfone ---------------------------------------------------------------------
  function onFrame(frame) {
    if (frame.t < muteUntil) { sinceVoiced = -Infinity; return; }
    const voiced = frame.freq && frame.clarity >= 0.8;
    if (!voiced) {
      graph.push({ t: frame.t, midi: null });
      if (frame.t - sinceVoiced > 500 && shownCents !== null) { shownCents = null; tracker.update(frame.t, null); paintIdle(); }
      return;
    }
    sinceVoiced = frame.t;
    const f = smoother.push(frame.t, frame.freq);
    graph.push({ t: frame.t, midi: midiFloat(f, cfg.refA) });

    let midi;
    let cents;
    let heard = null; // nota ouvida, quando não é a escolhida (modo manual)
    let idx = null;
    if (chromatic()) {
      const n = nearestNote(f, cfg.refA);
      if (cfg.mode === 'manual') {
        midi = cfg.pianoMidi;
        cents = centsTo(f, midi, cfg.refA);
        if (Math.abs(cents) >= 100) heard = n.midi;
      } else { midi = n.midi; cents = n.cents; }
    } else {
      const s = strings();
      const near = nearestString(f, s.map((x) => x.midi), cfg.refA);
      if (cfg.mode === 'manual') {
        idx = Math.min(cfg.sel, s.length - 1);
        midi = s[idx].midi;
        cents = centsTo(f, midi, cfg.refA);
        if (Math.abs(cents) >= 100) { heard = s[near.index].midi; }
      } else {
        idx = lock.update(near.index);
        midi = s[idx].midi;
        cents = centsTo(f, midi, cfg.refA);
        if (lastIdx !== idx) { lastIdx = idx; drawList(); }
      }
    }
    const key = `${cfg.mode}|${idx ?? midi}`;
    if (key !== lastTargetKey) {
      lastTargetKey = key;
      tracker.reset();
      shownCents = null;
      graph.setTargets([{ t0: -Infinity, t1: Infinity, midi }]);
    }
    shownCents = shownCents === null ? cents : shownCents + (cents - shownCents) * 0.5;
    const tr = tracker.update(frame.t, heard ? null : cents);
    paintLive({
      midi, cents, shown: shownCents, f, heard, progress: tr.progress,
    });
    if (tr.done && !tuned.has(chromatic() ? midi : idx)) confirmTuned(chromatic() ? midi : idx);
  }

  function confirmTuned(k) {
    tuned.add(k);
    feedbackTick();
    drawList();
    display.classList.remove('done');
    void display.offsetWidth;
    display.classList.add('done');
    if (!chromatic() && tuned.size === strings().length) {
      adviceEl.textContent = '🎉 Todas as cordas afinadas!';
      clearTimeout(allDoneTimer);
    }
  }

  // ---- pintura -----------------------------------------------------------------------------------
  const strLabel = (st) => `${st.num}ª corda`;
  function setNote(midi, dim = false) {
    noteEl.textContent = midi == null ? '—' : pitchClassName(midi);
    octEl.textContent = midi == null ? '' : String(octaveNumber(midi));
    display.classList.toggle('dim', dim);
  }

  function paintLive({
    midi, cents, shown, f, heard, progress,
  }) {
    const c = Math.max(-50, Math.min(50, shown));
    needle.style.left = `${50 + c}%`;
    const isTuned = Math.abs(cents) <= cfg.tol;
    if (heard != null) {
      display.className = 'tn-display far';
      setNote(heard);
      subEl.textContent = `${fmtHz(f)} · isso soa como ${pitchClassName(heard)}${octaveNumber(heard)}`;
      const s = chromatic() ? null : strings().find((x) => x.midi === heard);
      adviceEl.textContent = chromatic()
        ? `Você escolheu ${pitchClassName(midi)}${octaveNumber(midi)}. Toque essa nota ou use o modo Automático.`
        : `Você escolheu a ${strLabel(strings().find((x) => x.midi === midi))}. ${s ? `Isso parece a ${strLabel(s)}.` : ''} Use o modo Automático para reconhecer a corda.`;
      holdFill.style.width = '0%';
      holdFill.classList.remove('in');
      return;
    }
    const a = advice(cents, cfg.tol, !chromatic());
    display.className = `tn-display ${a.kind}${display.classList.contains('done') ? ' done' : ''}`;
    setNote(midi);
    subEl.textContent = `${fmtHz(f)} · ${sgn(cents)} cents`;
    adviceEl.textContent = (!chromatic() && tuned.size === strings().length && isTuned) ? '🎉 Todas as cordas afinadas!' : a.text;
    holdFill.style.width = `${Math.round(progress * 100)}%`;
    holdFill.classList.toggle('in', isTuned);
  }

  function paintIdle() {
    needle.style.left = '50%';
    holdFill.style.width = '0%';
    holdFill.classList.remove('in');
    display.className = 'tn-display idle';
    shownCents = null;
    if (chromatic()) setNote(cfg.mode === 'manual' ? cfg.pianoMidi : null, true);
    else if (cfg.mode === 'manual') setNote(targetMidi(), true);
    else setNote(lastIdx != null ? strings()[lastIdx].midi : null, true);
    if (!mic.active && drone === 0) {
      subEl.replaceChildren(h('button', { class: 'btn cta', onclick: () => toggleMic() }, '🎤 Ligar o microfone para afinar'));
      adviceEl.textContent = 'Ou toque a nota de referência (🔊) e afine de ouvido.';
    } else {
      subEl.textContent = mic.active ? (cfg.mode === 'auto' ? (chromatic() ? 'Toque uma tecla…' : 'Toque qualquer corda…') : 'Toque a nota escolhida…') : 'Ouvindo a referência…';
      adviceEl.textContent = '';
    }
  }

  function drawChips() {
    const p = prof();
    const tn = chromatic() ? 'cromático' : p.tunings[cfg.tuning].label;
    chips.replaceChildren(
      h('span', { class: 'info-chip', text: `${p.icon} ${p.label}` }),
      h('span', { class: 'info-chip', text: tn }),
      h('span', { class: 'info-chip', text: `Lá = ${cfg.refA} Hz` }),
      h('span', { class: 'info-chip', text: `±${cfg.tol} cents` }),
    );
  }

  function drawList() {
    const p = prof();
    const manual = cfg.mode === 'manual';
    if (chromatic()) {
      sideName.textContent = 'Notas';
      sideCount.textContent = '';
      if (!manual) {
        listEl.replaceChildren(h('p', { class: 'hint pad', text: 'Toque uma tecla: o afinador reconhece a nota e mostra se está alta ou baixa. Para ouvir uma referência, escolha “Escolher nota”.' }));
        btnPlay.textContent = '🔊 Tocar o Lá';
        return;
      }
      const oct = octaveNumber(cfg.pianoMidi);
      const pc = ((cfg.pianoMidi % 12) + 12) % 12;
      listEl.replaceChildren(
        h('div', { class: 'note-grid' }, PIANO_NOTES.map((i) => h('button', {
          class: `note-btn${i === pc ? ' sel' : ''}${tuned.has(12 * (oct + 1) + i) ? ' tuned' : ''}${[1, 3, 6, 8, 10].includes(i) ? ' black' : ''}`,
          onclick: () => { cfg.pianoMidi = 12 * (oct + 1) + i; persist(); lastTargetKey = ''; drawList(); paintIdle(); playRef(); },
        }, pitchClassName(i)))),
        h('div', { class: 'oct-row' }, h('span', { text: 'Oitava' }), segmented([2, 3, 4, 5, 6].map((o) => [o, o]), oct, (v) => {
          cfg.pianoMidi = 12 * (Number(v) + 1) + pc; persist(); lastTargetKey = ''; drawList(); paintIdle();
        })),
      );
      btnPlay.textContent = `🔊 Tocar ${pitchClassName(cfg.pianoMidi)}${octaveNumber(cfg.pianoMidi)}`;
      return;
    }
    const s = strings();
    sideName.textContent = `Cordas do ${p.label.toLowerCase()}`;
    sideCount.textContent = `${tuned.size}/${s.length} afinadas`;
    const cur = manual ? Math.min(cfg.sel, s.length - 1) : lastIdx;
    listEl.replaceChildren(...s.map((st, i) => h('div', {
      class: `str${i === cur ? (manual ? ' sel' : ' hit') : ''}${tuned.has(i) ? ' tuned' : ''}`,
      role: manual ? 'button' : null,
      tabindex: manual ? '0' : null,
      onclick: manual ? () => selectString(i) : null,
      onkeydown: manual ? (e) => { if (e.key === 'Enter') selectString(i); } : null,
    },
    h('span', { class: 'num', text: st.num }),
    h('span', { class: 'nt' }, pitchClassName(st.midi), h('sub', { text: octaveNumber(st.midi) })),
    h('span', { class: 'hz', text: fmtHz(freqOfMidi(st.midi, cfg.refA)) }),
    h('span', { class: 'ck', 'aria-label': tuned.has(i) ? 'afinada' : '', text: tuned.has(i) ? '✓' : '' }),
    h('button', { class: 'str-play', 'aria-label': `Tocar ${strLabel(st)}`, title: 'Ouvir esta corda', onclick: (e) => { e.stopPropagation(); stopAll(); playMidi(st.midi, getCtx().currentTime + 0.03, 2.4); if (!cfg.hear) muteUntil = performance.now() + 2750; } }, '🔊'),
    )));
    btnPlay.textContent = manual ? `🔊 Tocar a ${strLabel(s[Math.min(cfg.sel, s.length - 1)])}` : '🔊 Tocar a nota';
  }

  function selectString(i) {
    cfg.sel = i;
    persist();
    lastTargetKey = '';
    drawList();
    paintIdle();
    playRef();
  }

  // ---- ajustes -----------------------------------------------------------------------------------
  function buildSettings() {
    const p = prof();
    dr.body.replaceChildren(
      section('🎯', 'Afinação',
        !chromatic() ? row('Afinação das cordas', p.tunings && Object.keys(p.tunings).length > 1 ? 'Troque para afinações alternativas.' : 'Afinação padrão do violino.',
          select(Object.entries(p.tunings).map(([k, v]) => [k, v.label]), cfg.tuning, (v) => update({ tuning: v }))) : null,
        row('Lá de referência', '440 Hz é o padrão; orquestras costumam usar 440–442.', createSlider({
          label: 'Lá', compact: true, min: 430, max: 450, step: 1, value: cfg.refA, mark: 440,
          format: (v) => `${v} Hz`, onChange: (v) => update({ refA: v }),
        }).el),
        row('Precisão', 'Quantos cents de erro contam como afinada (1 semitom = 100 cents).',
          segmented([[3, '±3'], [5, '±5'], [10, '±10']], cfg.tol, (v) => update({ tol: Number(v) }))),
      ),
      section('🔊', 'Som de referência',
        row('Timbre', 'O tom puro é o melhor para afinar de ouvido (sem harmônicos).',
          segmented([['instrument', 'Instrumento'], ['sine', 'Tom puro']], cfg.tone, (v) => update({ tone: v }))),
        row('Escutar o microfone durante a referência', 'Ligue só com fones de ouvido; senão o app “ouve” o próprio som.', toggle(cfg.hear, (v) => update({ hear: v }))),
      ),
      h('div', { class: 'set-tips' },
        h('p', { text: '🎧 Para afinar tocando a referência ao mesmo tempo, use fones de ouvido.' }),
        h('p', { text: '🎸 Violão: as alturas são as que soam (Mi2 = 82,4 Hz).' }),
        h('p', { text: '⌨ Espaço toca a nota · ← → trocam de corda (modo Escolher) · Esc fecha.' }),
      ),
    );
  }

  function paintTabs() {
    instrTabs.querySelectorAll('.seg-btn').forEach((b) => {
      const on = b.dataset.instr === cfg.instr;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on);
    });
    const manualLabel = chromatic() ? 'Escolher nota' : 'Escolher corda';
    modeTabs.replaceChildren(...[['auto', 'Automático'], ['manual', manualLabel]].map(([id, label]) =>
      h('button', {
        class: `seg-btn${cfg.mode === id ? ' active' : ''}`, role: 'tab', 'aria-selected': cfg.mode === id, onclick: () => update({ mode: id }),
      }, label)));
    btnAll.hidden = chromatic();
  }

  function update(patch) {
    const instrChanged = patch.instr && patch.instr !== cfg.instr;
    Object.assign(cfg, patch);
    if (instrChanged) { cfg.tuning = 'standard'; cfg.sel = 0; }
    if (patch.hear !== undefined && drone) muteUntil = cfg.hear ? 0 : Infinity;
    if (instrChanged || patch.tuning || patch.mode || patch.refA) { tuned = new Set(); lastIdx = null; lock.reset(); }
    tracker = new HoldTracker({ tolCents: cfg.tol, holdMs: 900, graceMs: 250 });
    mic.detect = prof().mic;
    lastTargetKey = '';
    graph.setConfig({ fold: false, back: 8000, ahead: 0, tolCents: cfg.tol });
    graph.setTargets([]);
    persist();
    paintTabs();
    buildSettings();
    drawChips();
    drawList();
    paintIdle();
    zone.style.left = `${50 - cfg.tol}%`;
    zone.style.width = `${2 * cfg.tol}%`;
  }

  // ---- teclado -----------------------------------------------------------------------------------
  function onKey(e) {
    if (e.key === 'Escape' && dr.isOpen()) { dr.set(false); return; }
    if (isFormTarget(e) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.key === ' ') { e.preventDefault(); playRef(); }
    else if (cfg.mode === 'manual' && !chromatic() && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      const n = strings().length;
      selectString((cfg.sel + (e.key === 'ArrowRight' ? 1 : n - 1)) % n);
    }
  }
  document.addEventListener('keydown', onKey);

  drawMic();
  graph.setMessage('');
  update({});

  return () => {
    stopDrone();
    mic.stop();
    graph.destroy();
    clearTimeout(allDoneTimer);
    document.removeEventListener('keydown', onKey);
    root.classList.remove('wide');
  };
}
