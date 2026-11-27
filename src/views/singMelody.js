import { h, field, select, isFormTarget } from '../dom.js';
import { MAX_ACCIDENTALS, keyLabel, noteName, midiOf, transpose } from '../music/theory.js';
import { generateMelody, evaluateSung, MELODY_LEVELS } from '../music/melody.js';
import { renderMelody } from '../render/melodyStaff.js';
import { getCtx, scheduleClick, scheduleNote, stopAll } from '../music/audio.js';
import { recordSession } from '../storage.js';
import { createTargetBadge } from '../ui/targetBadge.js';
import {
  keyOptions, pickKey, REGISTER_OPTIONS, smoothField, instrumentField, quickToggle,
} from './singShared.js';
import {
  section, row, toggle, createDrawer,
} from '../ui/drawer.js';
import { createSlider, tempoName } from '../ui/slider.js';
import { createVolumeControl } from '../ui/volume.js';

const GRADE_ICON = { perfect: '✓', good: '✓', ok: '~', miss: '✗' };

export function mountMelodyMode(host, ctx) {
  const { cfg, graph } = ctx;
  let melody = null;
  let run = null;
  let evalRes = null;
  let raf = 0;
  let shownActive = -2;

  const status = h('div', { class: 'status big', 'aria-live': 'polite' });
  const badge = createTargetBadge();
  const staff = h('div', { class: 'staff wide paper' });
  const resultBox = h('div', { class: 'result' });
  const btnPlay = h('button', { class: 'btn primary', onclick: () => start('sing') }, '🎤 Cantar (Enter)');
  const btnListen = h('button', { class: 'btn', onclick: () => start('listen') }, '🔊 Ouvir');
  const btnStop = h('button', { class: 'btn', onclick: () => stop(), disabled: true }, '■ Parar');
  const btnNew = h('button', { class: 'btn', onclick: () => newMelody() }, '↻ Nova melodia');
  const quick = h('div', { class: 'quick' });
  const btnCfg = h('button', { class: 'btn', 'aria-haspopup': 'dialog', onclick: () => dr.set(true) }, '⚙ Ajustes');
  const dr = createDrawer('Ajustes da melodia', btnCfg);
  const bpmSlider = createSlider({
    label: 'Andamento', icon: '🥁', min: 40, max: 100, step: 2, value: cfg.bpm, tap: true, format: (v) => `${v} bpm`,
    caption: tempoName, onChange: (v) => update({ bpm: v }, false),
  });
  const metroRow = h('div', { class: 'metro-row one' }, bpmSlider.el);
  ctx.slot.append(createVolumeControl().el, quickToggle(quick, metroRow), btnCfg);
  const staffCard = h('section', { class: 'card staff-card' }, staff, graph.el);
  const liveCard = h('section', { class: 'card live' },
    h('div', { class: 'live-top' }, badge.el, h('div', { class: 'live-info' }, status)),
    h('div', { class: 'actions' }, btnPlay, h('div', { class: 'actions-sub' }, btnListen, btnStop, btnNew)));
  host.append(
    quick, metroRow,
    h('div', { class: 'inst-grid' }, staffCard, h('div', { class: 'inst-side' }, liveCard, h('section', { class: 'card result-card' }, resultBox))),
    dr.scrim, dr.drawer,
  );

  const beatMs = () => 60000 / cfg.bpm;
  const shifted = () => melody.notes.map((p) => transpose(p, cfg.register));

  const unsub = ctx.subscribe((frame) => {
    if (run && run.mode === 'sing') run.frames.push(frame);
  });

  function newMelody() {
    stop(true);
    const keyN = pickKey(cfg);
    melody = generateMelody({ keyN, level: cfg.level, length: cfg.length });
    evalRes = null;
    graph.setTargets([]);
    resultBox.replaceChildren();
    status.textContent = `${keyLabel(keyN).split(' / ')[0]} · ouça a tônica, depois cante as notas no pulso.`;
    draw();
  }

  function draw() {
    renderMelody(staff, {
      notes: melody.notes, keyN: melody.keyN, names: cfg.names || !!evalRes,
      grades: evalRes ? evalRes.results.map((r) => r.grade) : null,
    });
  }

  function setRunning(on) {
    btnPlay.disabled = on;
    btnListen.disabled = on;
    btnNew.disabled = on;
    btnStop.disabled = !on;
  }

  async function start(mode) {
    stop(true);
    if (mode === 'sing' && !(await ctx.ensureMic())) return;
    const c = getCtx();
    const lead = 0.2;
    const bMs = beatMs();
    const tonicDur = 1.2;
    const t0 = c.currentTime + lead;
    const perf0 = performance.now() + lead * 1000;
    const notes = shifted();

    scheduleNote(transpose(melody.tonic, cfg.register), t0, 1.0);
    const countStart = t0 + tonicDur;
    const countIn = 4;
    for (let i = 0; i < countIn; i++) scheduleClick(countStart + (i * bMs) / 1000, i === 0);
    const singStart = countStart + (countIn * bMs) / 1000;
    const n = notes.length;
    if (mode === 'listen') {
      notes.forEach((p, i) => scheduleNote(p, singStart + (i * bMs) / 1000, (bMs * 0.9) / 1000));
    } else if (cfg.click) {
      for (let i = 0; i < n; i++) scheduleClick(singStart + (i * bMs) / 1000, i % 4 === 0);
    }

    const singStartPerf = perf0 + tonicDur * 1000 + countIn * bMs;
    run = {
      mode, perf0, countStart: perf0 + tonicDur * 1000, singStartPerf, n, notes,
      end: singStartPerf + n * bMs + 350, frames: [],
    };
    evalRes = null;
    resultBox.replaceChildren();
    ctx.resetPitch();
    graph.setConfig({ fold: cfg.anyOctave, back: 1800, ahead: 4200, tolCents: 40 });
    graph.setTargets(notes.map((p, i) => ({
      t0: singStartPerf + i * bMs, t1: singStartPerf + (i + 1) * bMs, midi: midiOf(p),
    })));
    draw();
    setRunning(true);
    loop();
  }

  function loop() {
    if (!run) return;
    const now = performance.now();
    if (now >= run.end) return finish();
    const bMs = beatMs();
    if (now < run.countStart) {
      badge.set({ name: noteName(melody.tonic), sub: 'tônica', state: 'listen', label: '🔊 Ouça a tônica' });
    } else if (now < run.singStartPerf) {
      const k = Math.floor((now - run.countStart) / bMs) + 1;
      badge.set({ name: String(k), sub: 'contagem', state: 'count', label: 'Prepare-se' });
    } else {
      const i = Math.min(run.n - 1, Math.floor((now - run.singStartPerf) / bMs));
      badge.set({
        name: cfg.names ? noteName(melody.notes[i]) : '♪',
        sub: `nota ${i + 1} de ${run.n}`,
        state: run.mode === 'sing' ? 'sing' : 'listen',
        label: run.mode === 'sing' ? '🎤 Cante!' : '🔊 Ouvindo',
      });
      if (i !== shownActive) {
        shownActive = i;
        renderMelody(staff, { notes: melody.notes, keyN: melody.keyN, names: cfg.names, active: i });
      }
    }
    raf = requestAnimationFrame(loop);
  }

  function stop(silent = false) {
    cancelAnimationFrame(raf);
    stopAll();
    run = null;
    shownActive = -2;
    setRunning(false);
    graph.setTargets([]);
    badge.set();
    if (!silent) {
      status.textContent = 'Parado.';
      if (melody) draw();
    }
  }

  function finish() {
    const r = run;
    cancelAnimationFrame(raf);
    run = null;
    shownActive = -2;
    setRunning(false);
    graph.setTargets([]);
    badge.set();
    if (r.mode === 'listen') {
      status.textContent = 'Agora cante você: toque “Cantar”.';
      draw();
      return;
    }
    evalRes = evaluateSung({
      notes: r.notes, frames: r.frames, startMs: r.singStartPerf, beatMs: beatMs(), anyOctave: cfg.anyOctave,
    });
    draw();
    const pct = Math.round(evalRes.score * 100);
    status.textContent = `Afinação: ${pct}%`;

    const mean = evalRes.meanCents;
    const trend = Math.abs(mean) < 10
      ? 'Afinação centrada.'
      : `Tendência: você canta ${mean > 0 ? 'acima (alto)' : 'abaixo (baixo)'} ~${Math.round(Math.abs(mean))} cents.`;
    const silent = evalRes.results.filter((x) => x.cents === null).length;
    resultBox.replaceChildren(
      h('div', { class: 'big-score', text: `${pct}%` }),
      h('div', { class: 'chips' }, evalRes.results.map((x, i) => {
        const target = noteName(melody.notes[i]);
        const text = x.cents === null
          ? `${target}: não ouvi`
          : x.grade === 'miss' ? `${target} → ${x.sung}` : `${target} ${x.cents > 0 ? '+' : ''}${Math.round(x.cents)}¢`;
        return h('span', { class: `chip ${x.grade}`, text: `${GRADE_ICON[x.grade]} ${text}` });
      })),
      h('p', { class: 'hint', text: `${trend}${silent ? ` ${silent} nota(s) sem voz detectada: cante mais perto do microfone.` : ''}` }),
      h('p', { class: 'hint', text: 'Verde ≤ 40 cents · laranja ≤ 70 · vermelho = nota errada ou ausente (100 cents = 1 semitom).' }),
    );
    recordSession({ mode: 'sing', kind: 'melody', score: evalRes.score, level: cfg.level, keyN: melody.keyN, bpm: cfg.bpm });
  }

  function onKey(e) {
    if (e.key === 'Escape' && dr.isOpen()) { dr.set(false); return; }
    if (isFormTarget(e) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.key === 'Enter' && !run) start('sing');
    else if (e.key === 'Escape') stop();
  }
  document.addEventListener('keydown', onKey);

  function buildQuick() {
    quick.replaceChildren(
      field('Tom', select(keyOptions(), cfg.key, (v) => update({ key: v }))),
      field('Nível', select(Object.entries(MELODY_LEVELS), cfg.level, (v) => update({ level: Number(v) }))),
      field('Notas', select([[4, '4 (1 compasso)'], [8, '8 (2 compassos)'], [12, '12 (3 compassos)']], cfg.length, (v) => update({ length: Number(v) }))),
      field('Registro', select(REGISTER_OPTIONS, cfg.register, (v) => update({ register: Number(v) }, false))),
    );
  }

  function buildSettings() {
    dr.body.replaceChildren(
      section('🎼', 'Exercício',
        row('Se o tom for sorteado', 'Máximo de sustenidos e bemóis.', select(
          Array.from({ length: MAX_ACCIDENTALS + 1 }, (_, n) => [n, n === 0 ? 'Só Dó maior' : `Até ${n}`]),
          cfg.maxAcc, (v) => update({ maxAcc: Number(v) }))),
        row('Mostrar nomes das notas', 'Desligue para ler só pela pauta.', toggle(cfg.names, (v) => update({ names: v }, false))),
      ),
      section('🎯', 'Validação',
        row('Aceitar qualquer oitava', 'Útil para vozes mais graves ou agudas.', toggle(cfg.anyOctave, (v) => update({ anyOctave: v }, false))),
      ),
      section('⏱', 'Metrônomo',
        row('Metrônomo enquanto canta', null, toggle(cfg.click, (v) => update({ click: v }, false))),
      ),
      section('🔊', 'Som e gráfico',
        h('div', { class: 'set-row stacked' }, instrumentField()),
        h('div', { class: 'set-row stacked' }, smoothField(cfg, ctx)),
      ),
      h('div', { class: 'set-tips' }, h('p', { text: '🎤 Cante “Dó, Ré, Mi…” (Dó fixo) em cada pulso, com vogais longas: o app mede a afinação, não a sílaba.' })),
    );
  }

  function update(patch, regenerate = true) {
    Object.assign(cfg, patch);
    ctx.persist();
    buildSettings();
    if (regenerate) newMelody();
    else if (melody && !run) draw();
  }

  let lastW = 0;
  const resizeObs = new ResizeObserver(() => {
    const w = Math.round(staff.clientWidth);
    if (!melody || run || !w || w === lastW) return;
    lastW = w;
    draw();
  });
  resizeObs.observe(staff);

  buildQuick();
  buildSettings();
  graph.setConfig({ fold: cfg.anyOctave, back: 4000, ahead: 0, tolCents: 25 });
  graph.setTargets([]);
  newMelody();

  return () => {
    stop(true);
    unsub();
    document.removeEventListener('keydown', onKey);
    resizeObs.disconnect();
  };
}
