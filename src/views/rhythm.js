import { h, field, select, isFormTarget } from '../dom.js';
import {
  TIME_SIGNATURES, FIGURES, PRESETS, RIGOR, presetFigures, presetOf,
  generateMeasures, onsetsOf, evaluateTaps, windowsFor, gradeFor,
} from '../music/rhythm.js';
import { renderRhythm } from '../render/rhythmStaff.js';
import { createOverlay } from '../render/rhythmOverlay.js';
import { createVolumeControl } from '../ui/volume.js';
import {
  section, row, toggle, segmented, createDrawer,
} from '../ui/drawer.js';
import { quickToggle } from './singShared.js';
import { createSlider, tempoName } from '../ui/slider.js';
import { getCtx, scheduleClick, scheduleBeat, stopAll, outputLatencyMs } from '../music/audio.js';
import { load, save, recordSession } from '../storage.js';
import { hit } from '../ui/fx.js';

const DEFAULTS = {
  timeSig: '4/4', preset: '1', figures: presetFigures('1'), rests: 'normal', rigor: 'normal',
  measures: 2, bpm: 70, click: true, tapSound: true, showMs: true, showBeats: true, calib: 0, calibAuto: true,
};
const REST_BIAS = { few: 0.5, normal: 1, many: 2 };
const GRADE_LABEL = { perfect: 'Perfeito', good: 'Bom', ok: 'Quase', miss: 'Perdida' };
const GRADE_FB = { perfect: 'Perfeito!', good: 'Bom!', ok: 'Quase!' };
const MAX_CALIB = 250;

// replaceChildren() transformaria `null` em texto "null"; aqui blocos opcionais são ignorados.
const fill = (el, ...kids) => el.replaceChildren(...kids.filter(Boolean));

export function mountRhythm(root) {
  const cfg = load('cfg.rhythm', DEFAULTS);
  // migra configurações antigas (antes só havia "level")
  cfg.figures = { ...presetFigures('1'), ...cfg.figures };
  cfg.preset = presetOf(cfg.figures); // o nível sempre reflete as figuras marcadas

  let ex = null;
  let run = null;
  let result = null;
  let overlay = null;
  let raf = 0;
  let hasRun = false;
  let padKey = '';

  const howto = h('div', { class: 'howto' },
    h('strong', { text: 'Como funciona' }),
    h('ol', {},
      h('li', {}, 'Aperte ', h('b', { text: '▶ Começar' }), ' e ouça 1 compasso de contagem.'),
      h('li', {}, 'Toque no botão ', h('b', { text: 'TOQUE AQUI' }), ' (ou a barra de espaço) exatamente em cada nota. Nas pausas, silêncio.'),
      h('li', {}, 'A linha azul mostra onde você está. As bolinhas sob as notas acendem a cada batida: verde = no ritmo, laranja = quase, vermelho = perdida.'),
    ),
  );
  const info = h('div', { class: 'info-row' });
  const status = h('div', { class: 'status big', 'aria-live': 'polite' });
  const staff = h('div', { class: 'staff wide paper' });
  const resultBox = h('div', { class: 'result' });
  const padMain = h('span', { class: 'pad-main' });
  const padFb = h('span', { class: 'pad-fb', 'aria-live': 'polite' });
  const pad = h('button', { class: 'tap-pad idle', 'aria-label': 'Toque aqui no ritmo (ou barra de espaço)' }, padMain, padFb);
  const btnPlay = h('button', { class: 'btn primary', onclick: () => start('play') }, '▶ Começar (Enter)');
  const btnListen = h('button', { class: 'btn', onclick: () => start('listen') }, '🔊 Ouvir');
  const btnStop = h('button', { class: 'btn', onclick: () => stop(), disabled: true }, '■ Parar');
  const btnNew = h('button', { class: 'btn', onclick: () => newExercise() }, '↻ Novo ritmo');
  const quick = h('div', { class: 'quick' });
  const metroRow = h('div', { class: 'metro-row one' });
  const btnCfg = h('button', { class: 'btn', 'aria-haspopup': 'dialog', onclick: () => dr.set(true) }, '⚙ Ajustes');
  const dr = createDrawer('Ajustes do ritmo', btnCfg);
  const staffCard = h('section', { class: 'card staff-card rhythm-staff' }, info, staff, status);
  const liveCard = h('section', { class: 'card live rhythm-live' },
    pad,
    h('div', { class: 'actions' }, btnPlay, h('div', { class: 'actions-sub' }, btnListen, btnStop, btnNew)));
  root.classList.add('wide');
  root.append(
    h('div', { class: 'inst-bar' }, h('b', { class: 'bar-title', text: '🥁 Ritmo' }), h('span', { class: 'grow' }),
      createVolumeControl({ inst: false }).el, quickToggle(quick, metroRow), btnCfg),
    quick, metroRow,
    h('div', { class: 'inst-grid rhythm-grid' }, staffCard, h('div', { class: 'inst-side' }, liveCard, howto, h('section', { class: 'card result-card' }, resultBox))),
    dr.scrim, dr.drawer,
  );

  const sig = () => TIME_SIGNATURES[cfg.timeSig];
  const beatMs = () => 60000 / cfg.bpm;
  const tickMs = () => beatMs() / sig().beatTicks;
  const scale = () => RIGOR[cfg.rigor] ?? 1;
  const presetName = () => (PRESETS[cfg.preset] ? `Nível ${cfg.preset} · ${PRESETS[cfg.preset].name}` : 'Personalizado');

  // ---- visual -------------------------------------------------------------
  function drawStaff(grades = null) {
    const r = renderRhythm(staff, { measures: ex.measures, timeSig: cfg.timeSig, grades });
    overlay = createOverlay(r.svg, r.layout, { showBeats: cfg.showBeats, showMs: cfg.showMs });
  }

  function drawInfo() {
    const chip = (text) => h('span', { class: 'info-chip', text });
    info.replaceChildren(chip(presetName()), chip(cfg.timeSig), chip(`${cfg.bpm} bpm`), chip(`${cfg.measures} compasso${cfg.measures > 1 ? 's' : ''}`));
  }

  function setPad(state, main) {
    const key = `${state}|${main}`;
    if (key === padKey) return;
    padKey = key;
    const hit = pad.classList.contains('hit');
    pad.className = `tap-pad ${state}${hit ? ' hit' : ''}`;
    padMain.textContent = main;
  }

  function padFeedback(kind, text) {
    padFb.className = `pad-fb ${kind}`;
    padFb.textContent = text;
    if (kind === 'perfect' || kind === 'good') hit(pad, kind, kind === 'perfect' ? 'Perfeito' : 'Bom');
    else if (kind === 'ok') hit(pad, 'warn', 'Quase');
    else if (kind === 'extra') hit(pad, 'err', 'Extra');
  }

  function pulseTap() {
    pad.classList.remove('hit');
    void pad.offsetWidth; // reinicia a animação
    pad.classList.add('hit');
  }

  function nudgePlay() {
    btnPlay.classList.remove('nudge');
    void btnPlay.offsetWidth;
    btnPlay.classList.add('nudge');
  }

  function setRunning(on) {
    btnPlay.disabled = on;
    btnListen.disabled = on;
    btnNew.disabled = on;
    btnStop.disabled = !on;
  }

  // ---- exercício ----------------------------------------------------------
  function newExercise() {
    stop(true);
    const measures = generateMeasures({
      timeSig: cfg.timeSig, figures: cfg.figures, measures: cfg.measures, restBias: REST_BIAS[cfg.rests] ?? 1,
    });
    ex = { measures, onsets: onsetsOf(measures, cfg.timeSig), totalTicks: cfg.measures * sig().beats * sig().beatTicks };
    result = null;
    resultBox.replaceChildren();
    status.textContent = '';
    howto.hidden = hasRun;
    drawInfo();
    drawStaff();
    padKey = '';
    setPad('idle', 'Aperte ▶ Começar');
    padFeedback('', '');
  }

  function start(mode) {
    stop(true);
    hasRun = true;
    howto.hidden = true;
    const c = getCtx();
    const lead = 0.2;
    const s = sig();
    const bMs = beatMs();
    const tMs = tickMs();
    const t0 = c.currentTime + lead;
    const perf0 = performance.now() + lead * 1000;
    const countIn = s.beats;
    const totalBeats = s.beats * cfg.measures;
    for (let i = 0; i < countIn; i++) scheduleClick(t0 + (i * bMs) / 1000, i === 0);
    const rStartCtx = t0 + (countIn * bMs) / 1000;
    if (mode === 'listen' || cfg.click) {
      for (let i = 0; i < totalBeats; i++) scheduleClick(rStartCtx + (i * bMs) / 1000, i % s.beats === 0);
    }
    if (mode === 'listen') ex.onsets.forEach((u) => scheduleBeat(rStartCtx + (u * tMs) / 1000));

    // latency = atraso estimado entre agendar o som e ouvi-lo (só para a parte visual);
    // calibUsed = compensação aplicada às batidas nesta rodada (automática + ajuste, ou só o valor manual).
    const latency = outputLatencyMs();
    const calibUsed = cfg.calibAuto ? latency + cfg.calib : cfg.calib;
    run = {
      mode, perf0, countIn, totalBeats, latency, calibUsed,
      start: perf0 + countIn * bMs,
      end: perf0 + (countIn + totalBeats) * bMs + 600 + Math.max(0, calibUsed),
      taps: [], matched: ex.onsets.map(() => false), marked: ex.onsets.map(() => false), extra: 0,
    };
    result = null;
    resultBox.replaceChildren();
    drawStaff();
    padFeedback('', '');
    setRunning(true);
    loop();
  }

  function loop() {
    if (!run) return;
    const now = performance.now();
    if (now >= run.end) return finish();
    const s = sig();
    const bMs = beatMs();
    const tMs = tickMs();
    const rel = now - run.start - run.latency; // tempo "ouvido" (guia visual)
    const tapRel = now - run.start - run.calibUsed; // mesmo referencial das batidas

    if (now < run.perf0) {
      status.textContent = 'Prepare-se…';
      setPad('count', 'Prepare-se…');
    } else if (rel < 0) {
      const k = Math.min(run.countIn, Math.floor((now - run.perf0) / bMs) + 1);
      status.textContent = `Contagem: ${k}`;
      setPad('count', `${k}`);
    } else {
      const beat = Math.min(run.totalBeats - 1, Math.floor(rel / bMs));
      status.textContent = `${run.mode === 'play' ? 'Toque!' : 'Ouvindo'} · compasso ${Math.floor(beat / s.beats) + 1} · tempo ${(beat % s.beats) + 1}`;
      setPad(run.mode === 'play' ? 'go' : 'listen', run.mode === 'play' ? 'TOQUE AQUI' : 'Ouvindo…');
      overlay.setPlayhead(Math.min(rel / tMs, ex.totalTicks));

      const win = windowsFor(tMs, scale());
      ex.onsets.forEach((u, i) => {
        const t = u * tMs;
        if (run.marked[i]) return;
        if (run.mode === 'listen') {
          if (rel >= t) { run.marked[i] = true; overlay.markListen(i); }
        } else if (!run.matched[i] && tapRel > t + win.ok) {
          run.marked[i] = true;
          overlay.markOnset(i, 'miss');
        }
      });
    }
    raf = requestAnimationFrame(loop);
  }

  function stop(silent = false) {
    cancelAnimationFrame(raf);
    stopAll();
    run = null;
    setRunning(false);
    if (!silent) {
      status.textContent = 'Parado.';
      setPad('idle', 'Aperte ▶ Começar');
      padFeedback('', '');
      if (ex) drawStaff();
    }
  }

  function paintResult() {
    drawStaff(result.notes.map((n) => n.grade));
    result.notes.forEach((n, i) => overlay.markOnset(i, n.grade, n.delta));
    result.extraAt.forEach((t) => overlay.addExtra(t / tickMs()));
  }

  function applyCalibration(delta) {
    // valor absoluto: o que foi usado nesta rodada + o desvio medido (sem somar estimativas do navegador)
    const next = Math.max(-MAX_CALIB, Math.min(MAX_CALIB, Math.round((result.calibUsed + delta) / 5) * 5));
    update({ calibAuto: false, calib: next }, false);
    status.textContent = `Compensação de ${next} ms aplicada. Toque “Começar” para testar de novo.`;
    resultBox.querySelector('.calib-box')?.replaceChildren(
      h('p', { class: 'hint ok-text', text: `✓ Compensação de ${next} ms aplicada. Tente de novo: o desvio médio deve ficar perto de zero.` }),
    );
  }

  function finish() {
    const r = run;
    cancelAnimationFrame(raf);
    run = null;
    setRunning(false);
    if (r.mode === 'listen') {
      status.textContent = 'Agora é a sua vez: toque “Começar”.';
      setPad('idle', 'Agora é com você ▶');
      drawStaff();
      return;
    }
    const tMs = tickMs();
    result = evaluateTaps(ex.onsets.map((u) => u * tMs), r.taps, tMs, scale());
    result.calibUsed = r.calibUsed;
    paintResult();
    const pct = Math.round(result.score * 100);
    status.textContent = `Precisão: ${pct}%`;
    setPad('done', `${pct}%`);
    padFeedback(pct >= 80 ? 'perfect' : pct >= 50 ? 'ok' : 'extra', pct >= 80 ? 'Muito bem!' : pct >= 50 ? 'Quase lá, tente de novo' : 'Vamos de novo, com calma');

    const counts = result.notes.reduce((m, n) => ((m[n.grade] = (m[n.grade] || 0) + 1), m), {});
    const mean = result.medianDelta;
    const consistent = result.matched >= 4 && result.consistency >= 0.65 && Math.abs(mean) >= 25;
    fill(resultBox,
      h('div', { class: 'big-score', text: `${pct}%` }),
      h('div', { class: 'chips' },
        ['perfect', 'good', 'ok', 'miss'].map((g) => h('span', { class: `chip ${g}${counts[g] ? '' : ' zero'}`, text: `${counts[g] || 0} ${GRADE_LABEL[g].toLowerCase()}` })),
        result.extra ? h('span', { class: 'chip extra', text: `× ${result.extra} a mais` }) : null,
      ),
      h('p', { class: 'hint', text: Math.abs(mean) < 15
        ? 'Sem tendência de adiantar ou atrasar.'
        : `Tendência: você ${mean > 0 ? 'atrasa' : 'adianta'} ~${Math.round(Math.abs(mean))} ms em média.` }),
      consistent
        ? h('div', { class: 'calib-box' },
          h('p', { class: 'hint', text: 'Se você sempre erra para o mesmo lado, pode ser a latência do áudio do seu equipamento (fones Bluetooth, por exemplo), não o seu ritmo.' }),
          h('button', { class: 'btn', onclick: () => applyCalibration(mean) }, `⚙ Compensar ${Math.round(Math.abs(mean))} ms (${mean > 0 ? 'você atrasa' : 'você adianta'})`),
        )
        : null,
      result.extra
        ? h('p', { class: 'hint err-text', text: 'Batidas marcadas com × não têm nota nesse ponto. Toque só onde há nota; nas pausas, silêncio.' })
        : null,
      h('p', { class: 'hint', text: `Bolinhas: verde = no ritmo · laranja = quase · vermelho = perdida.${cfg.showMs ? ' O número é o desvio em ms (− adiantou, + atrasou).' : ''}` }),
    );
    recordSession({ mode: 'rhythm', score: result.score, level: cfg.preset, timeSig: cfg.timeSig, bpm: cfg.bpm });
  }

  // ---- toques -------------------------------------------------------------
  function tap(ev) {
    pulseTap();
    if (!run) {
      padFeedback('hint', 'Aperte ▶ Começar primeiro');
      nudgePlay();
      return;
    }
    if (run.mode !== 'play') {
      padFeedback('hint', 'Agora é só ouvir 🙂');
      return;
    }
    const ts = ev.timeStamp > 1e12 ? performance.now() : ev.timeStamp;
    const tMs = tickMs();
    const rel = ts - run.start - run.calibUsed;
    if (rel < -tMs * 4.5) {
      padFeedback('hint', 'Aguarde a contagem…');
      return;
    }
    if (cfg.tapSound) scheduleBeat(getCtx().currentTime);
    run.taps.push(rel);

    let best = -1;
    let bestDist = Infinity;
    ex.onsets.forEach((u, i) => {
      if (run.matched[i]) return;
      const d = Math.abs(rel - u * tMs);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    const grade = best >= 0 ? gradeFor(bestDist, tMs, scale()) : null;
    if (grade) {
      const delta = rel - ex.onsets[best] * tMs;
      run.matched[best] = true;
      overlay.markOnset(best, grade, delta);
      padFeedback(grade, `${GRADE_FB[grade]} ${Math.round(Math.abs(delta))} ms ${delta > 0 ? 'tarde' : 'cedo'}`);
    } else {
      run.extra++;
      overlay.addExtra(rel / tMs);
      padFeedback('extra', 'Sem nota aqui ×');
    }
  }

  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    tap(e);
  });

  function onKey(e) {
    if (e.key === 'Escape' && dr.isOpen()) { dr.set(false); return; }
    if (isFormTarget(e) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.key === ' ') {
      e.preventDefault();
      tap(e);
    } else if (e.key === 'Enter' && !run) start('play');
    else if (e.key === 'Escape') stop();
  }
  document.addEventListener('keydown', onKey);

  // ---- configurações ------------------------------------------------------
  function setPreset(id) {
    cfg.preset = id;
    if (id !== 'custom') cfg.figures = presetFigures(id);
    persistAndRegenerate();
  }

  function setFigure(key, on) {
    cfg.figures = { ...cfg.figures, [key]: on };
    cfg.preset = presetOf(cfg.figures);
    persistAndRegenerate();
  }

  function persistAndRegenerate() {
    save('cfg.rhythm', cfg);
    if (presetSel) presetSel.value = cfg.preset;
    buildSettings();
    newExercise();
  }

  // opções rápidas: criadas uma vez; só o seletor de nível é sincronizado quando as figuras mudam
  let presetSel = null;
  const presetOptions = () => [...Object.entries(PRESETS).map(([id, p]) => [id, `${id} · ${p.name}`]), ['custom', 'Personalizado']];
  function buildQuick() {
    presetSel = select(presetOptions(), cfg.preset, (v) => setPreset(v));
    quick.replaceChildren(
      field('Nível', presetSel),
      field('Compasso', select(Object.keys(TIME_SIGNATURES).map((k) => [k, k]), cfg.timeSig, (v) => update({ timeSig: v }))),
      field('Compassos', select([1, 2, 3, 4].map((n) => [n, n]), cfg.measures, (v) => update({ measures: Number(v) }))),
      field('Quantidade de pausas', select([['few', 'Poucas'], ['normal', 'Normal'], ['many', 'Muitas']], cfg.rests, (v) => update({ rests: v }))),
    );
    metroRow.replaceChildren(createSlider({
      label: 'Andamento', icon: '🥁', min: 40, max: 160, step: 2, value: cfg.bpm, tap: true, format: (v) => `${v} bpm`,
      caption: tempoName, onChange: (v) => update({ bpm: v }, false),
    }).el);
  }

  function buildSettings() {
    dr.body.replaceChildren(
      section('🎼', 'Figuras',
        h('p', { class: 'hint pad-hint', text: 'Marque as figuras que podem aparecer (a semínima sempre aparece). Mudar uma figura passa o nível para “Personalizado”.' }),
        h('div', { class: 'fig-chips' }, Object.entries(FIGURES).map(([key, label]) => h('button', {
          class: `fig-chip${cfg.figures[key] ? ' on' : ''}`, type: 'button', 'aria-pressed': String(!!cfg.figures[key]),
          onclick: () => setFigure(key, !cfg.figures[key]),
        }, label))),
      ),
      section('🎯', 'Avaliação',
        row('Rigor', 'Quão perto do tempo você precisa bater.', segmented([['easy', 'Leve'], ['normal', 'Normal'], ['hard', 'Exigente']], cfg.rigor, (v) => update({ rigor: v }, false))),
      ),
      section('👁', 'Aparência e som',
        row('Mostrar o desvio em ms sob as bolinhas', null, toggle(cfg.showMs, (v) => update({ showMs: v }, false))),
        row('Mostrar números dos tempos (1 2 3 4)', null, toggle(cfg.showBeats, (v) => update({ showBeats: v }, false))),
        row('Metrônomo durante a prática', null, toggle(cfg.click, (v) => update({ click: v }, false))),
        row('Som ao bater', 'Confirma cada toque com um estalo.', toggle(cfg.tapSound, (v) => update({ tapSound: v }, false))),
      ),
      section('⏱', 'Latência',
        row('Usar a latência estimada pelo navegador', 'Desligue para usar só a compensação manual.', toggle(cfg.calibAuto, (v) => update({ calibAuto: v }, false))),
        row(cfg.calibAuto ? 'Ajuste extra' : 'Compensação manual', 'Depois de uma rodada o resultado calcula este valor para você. Fones Bluetooth costumam ter latência alta.', createSlider({
          label: 'Latência', compact: true, min: -MAX_CALIB, max: MAX_CALIB, step: 5, value: cfg.calib, mark: 0,
          format: (v) => `${v > 0 ? '+' : ''}${v} ms`, onChange: (v) => update({ calib: v }, false),
        }).el),
      ),
      h('div', { class: 'set-tips' }, h('p', { text: '⌨ Espaço bate · Enter começa · Esc para/fecha.' })),
    );
  }

  function update(patch, regenerate = true) {
    Object.assign(cfg, patch);
    save('cfg.rhythm', cfg);
    buildSettings();
    if (regenerate) newExercise();
    else if (ex && !run) {
      drawInfo();
      if (result) paintResult();
      else drawStaff();
    }
  }

  // Redesenha a partitura quando o painel muda de largura (janela, divisão de painéis, celular girado).
  let lastW = 0;
  const resizeObs = new ResizeObserver(() => {
    const w = Math.round(staff.clientWidth);
    if (!ex || run || !w || w === lastW) return;
    lastW = w;
    if (result) paintResult();
    else drawStaff();
  });
  resizeObs.observe(staff);

  buildQuick();
  buildSettings();
  newExercise();

  return () => {
    stop(true);
    document.removeEventListener('keydown', onKey);
    resizeObs.disconnect();
    root.classList.remove('wide');
  };
}
