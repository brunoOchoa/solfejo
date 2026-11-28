// Prática de acordes (violão e teclado): escala harmonizada e progressões. O microfone ouve o acorde inteiro
// (cromagrama) e confere se as notas dele estão soando. Guiado (espera cada acorde) ou no tempo do metrônomo.
import { h, field, select, isFormTarget } from '../dom.js';
import { MAX_ACCIDENTALS } from '../music/theory.js';
import { SCALE_TYPES, DIRECTIONS } from '../music/scales.js';
import {
  PROGRESSIONS, buildChordExercise, PC_NAMES, alignSequence,
} from '../music/chords.js';
import {
  chromaFromSpectrum, matchChord, heardPcs, evaluateChordsTimed,
} from '../music/chroma.js';
import { INSTRUMENT_PROFILES, TIMING_RIGOR } from '../music/instrument.js';
import { Mic } from '../music/mic.js';
import {
  getCtx, scheduleFreq, scheduleClick, stopAll, setInstrument, getInstrument,
} from '../music/audio.js';
import { load, save, recordSession } from '../storage.js';
import { hit } from '../ui/fx.js';
import { createFocusMode } from '../ui/focusMode.js';
import { awakeSupported, awakeEnabled, setAwakeEnabled } from '../ui/wake.js';
import { instrumentField } from './singShared.js';
import {
  migrateTonic, pickKeyN, resolveTonic, tonicOptions,
} from '../music/tonic.js';
import { createVolumeControl } from '../ui/volume.js';
import { createSlider, tempoName } from '../ui/slider.js';
import { createTargetBadge, createDots } from '../ui/targetBadge.js';
import { createChordBoard } from '../ui/chordBoard.js';
import { createMicMeter } from '../ui/micMeter.js';
import { openAudioPanel } from '../ui/audioPanel.js';
import { openCalibration } from '../ui/calibration.js';
import { openEchoCalibration } from '../ui/echoCalibration.js';
import { createPracticeNav } from '../ui/practiceNav.js';
import {
  createPracticeBar, createExerciseRows, iconButton, micGroup,
} from '../ui/practiceBar.js';
import { activeProfile, saveProfile, extraTolerance } from '../music/audioProfile.js';

export const CHORD_DEFAULTS = {
  content: 'chords', chordProg: 'harm', chordExt: 'triad', chordShape: 'open', chordBeats: 4, pianoBass: false, voiceLead: true,
};
/** Violão e teclado praticam acordes (a menos que o aluno peça notas soltas); violino sempre notas. */
export const wantsChords = (cfg) => cfg.instr !== 'violin' && cfg.content !== 'notes';

const GRADE_CLS = { perfect: 'perfect', good: 'perfect', ok: 'ok', wrong: 'wrong', none: 'none', warn: 'ok' };
const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter(Boolean));
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const names = (pcs) => pcs.map((p) => PC_NAMES[p]).join(' · ');
const replay = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

function celebrate(el, pct) {
  if (reduceMotion()) { el.textContent = `${pct}%`; return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 700);
    el.textContent = `${Math.round(pct * (1 - (1 - k) ** 3))}%`;
    if (k < 1 && el.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  el.classList.toggle('gold', pct === 100);
}

export function mountChords(root, { defaults, remount }) {
  const cfg = load('cfg.instrument', defaults);
  const persist = () => save('cfg.instrument', cfg);
  if (migrateTonic(cfg)) persist();
  const prof = () => INSTRUMENT_PROFILES[cfg.instr];
  const mode = () => (cfg.mode === 'timed' || cfg.mode === 'open' ? cfg.mode : 'free');
  const guitar = () => cfg.instr === 'guitar';

  let ex = null;
  let run = null;
  let finished = null; // { grades[], mode }
  let raf = 0;
  let timers = [];
  let settingsOpen = false;
  let lastFeedback = '';
  let sel = 0; // acorde mostrado no quadro quando nada está rodando
  let grades = []; // nota de cada acorde (cores do cartão)
  let live = null; // última leitura do microfone

  // ---- microfone (só espectro) ------------------------------------------------------------
  const mic = new Mic(() => {}, {});
  mic.noPitch = true;
  let sampler = 0;
  let profile = null;
  let audioPanel = null;
  let calib = null;
  const meter = createMicMeter(mic, { onClick: () => openAudio(), expectSound: () => !!run && run.mode !== 'listen' });
  async function syncProfile() {
    profile = await activeProfile(mic);
    const saved = profile.saved;
    if (saved && saved.offset !== cfg.offset) { cfg.offset = saved.offset; persist(); buildSettings(); } // cada aparelho com a sua latência
    meter.setNotice(saved ? '' : 'Sem calibração para este aparelho');
    if (mic.fellBack) statusMsg.textContent = 'A entrada escolhida não está disponível: usando a padrão do sistema.';
  }
  mic.onEnded = () => { clearInterval(sampler); sampler = 0; drawMicButton(); meter.setNotice(''); statusMsg.textContent = 'O microfone foi desconectado. Ligue de novo.'; };
  const onDevChange = () => { if (mic.active) syncProfile(); };
  navigator.mediaDevices?.addEventListener?.('devicechange', onDevChange);
  function openAudio() {
    audioPanel = openAudioPanel({
      mic, ensureMic, host: root, getProfile: () => profile,
      restartMic: async () => { clearInterval(sampler); sampler = 0; mic.stop(); await ensureMic(); },
      onCalibrate: () => openCal(),
      onEcho: () => openEcho(),
    });
  }
  let echo = null;
  function openEcho() {
    echo?.close();
    echo = openEchoCalibration({
      host: root, mic, ensureMic,
      onApply: (off, st) => { update({ offset: off }, false); if (profile) saveProfile(profile.key, { offset: off, ...st }); },
    });
  }
  function openCal() {
    calib?.close();
    calib = openCalibration({
      host: root, mic, ensureMic, instrumentLabel: prof().label.toLowerCase(),
      onApply: (off, st) => { update({ offset: off }, false); if (profile) saveProfile(profile.key, { offset: off, std: st.std, n: st.n, source: st.source }); },
    });
  }
  async function ensureMic() {
    if (!mic.active) {
      try {
        await mic.start();
        statusMsg.textContent = '';
        syncProfile();
      } catch (err) {
        statusMsg.textContent = err.name === 'NotSupportedError'
          ? 'Este navegador não permite microfone (use HTTPS ou localhost).'
          : 'Microfone bloqueado. Permita o acesso no ícone de cadeado da barra de endereço e tente de novo.';
        drawMicButton();
        return false;
      }
    }
    if (!sampler) sampler = setInterval(sample, 70);
    drawMicButton();
    return true;
  }
  function stopMic() {
    clearInterval(sampler);
    sampler = 0;
    mic.stop();
    live = null;
    board.setHeard([]);
    paintTones();
    drawMicButton();
  }
  const btnMic = h('button', { class: 'btn', onclick: async () => { if (mic.active) stopMic(); else await ensureMic(); } });
  function drawMicButton() {
    btnMic.textContent = mic.active ? '🎤 Mic ligado' : '🎤 Ligar mic';
    btnMic.classList.toggle('active', mic.active);
  }

  // ---- elementos --------------------------------------------------------------------------
  const nav = createPracticeNav({
    instruments: INSTRUMENT_PROFILES,
    getCfg: () => cfg,
    onInstrument: (id) => update({ instr: id }),
    onArea: (id) => update({ content: id }),
  });
  const modeTabs = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Modo' }, [['free', 'Guiado'], ['open', 'Livre'], ['timed', 'Metrônomo']].map(([id, label]) =>
    h('button', { class: 'seg-btn', role: 'tab', 'data-mode': id, onclick: () => update({ mode: id }) }, label)));
  const chips = h('div', { class: 'info-row' });
  const strip = h('div', { class: 'chord-strip', role: 'list', 'aria-label': 'Acordes do exercício' });
  const board = createChordBoard();
  const tones = h('div', { class: 'tone-row', 'aria-live': 'off' });
  const statusMsg = h('div', { class: 'chord-msg' });
  const boardHost = h('div', { class: 'graph-host chord-host' }, board.el, tones, statusMsg);
  const status = h('div', { class: 'status big', 'aria-live': 'polite' });
  const badge = createTargetBadge();
  const dots = createDots();
  const holdFill = h('div', { class: 'hold-fill' });
  const hold = h('div', { class: 'hold-bar', role: 'progressbar', 'aria-label': 'Tempo no acorde' }, holdFill);
  const feedback = h('div', { class: 'feedback', 'aria-live': 'polite' });
  const resultBox = h('div', { class: 'result' });
  const btnStart = h('button', { class: 'btn primary', onclick: () => start() });
  const btnListen = h('button', { class: 'btn', onclick: () => listen() }, '🔊 Ouvir');
  const btnSkip = h('button', { class: 'btn', onclick: () => skip() }, '⏭ Pular');
  const btnStop = h('button', { class: 'btn', onclick: () => (run?.mode === 'open' ? finishOpen() : stop()), disabled: true }, '■ Parar');
  const btnNew = h('button', { class: 'btn', onclick: () => newExercise() }, '↻ Novo');
  const btnQuick = h('button', { class: 'btn quick-toggle', 'aria-expanded': 'false', onclick: () => {
    const open = quick.classList.toggle('open');
    btnQuick.setAttribute('aria-expanded', open);
  } }, '🎼 Exercício');
  const btnCfg = iconButton('ajustes', 'Ajustes', () => toggleDrawer(true), { 'aria-haspopup': 'dialog' });
  const focus = createFocusMode({ iconOnly: true });
  const rows = createExerciseRows();
  const quick = rows.el;
  const metroRow = h('div'); // o andamento agora fica na faixa do exercício; o elemento só guarda o estado "escondido"
  const staffCard = h('section', { class: 'card staff-card chord-card' }, chips, strip, boardHost);
  const liveCard = h('section', { class: 'card live' },
    h('div', { class: 'live-top' }, badge.el, h('div', { class: 'live-info' }, dots.el, status)),
    hold, feedback,
    h('div', { class: 'actions' }, btnStart, h('div', { class: 'actions-sub' }, btnListen, btnSkip, btnStop, btnNew)),
  );
  const result = h('section', { class: 'card result-card' }, resultBox);
  const drawerBody = h('div', { class: 'drawer-body' });
  const drawer = h('aside', { class: 'drawer card', 'aria-label': 'Ajustes da prática', inert: true },
    h('div', { class: 'drawer-head' }, h('b', { text: 'Ajustes da prática' }),
      h('button', { class: 'btn', 'aria-label': 'Fechar ajustes', onclick: () => toggleDrawer(false) }, '✕')),
    drawerBody);
  const scrim = h('div', { class: 'scrim', onclick: () => toggleDrawer(false) });
  root.classList.add('wide');
  root.append(
    nav.el,
    createPracticeBar([modeTabs], [micGroup(btnMic, meter.el), createVolumeControl({ iconOnly: true }).el, focus.btn, btnQuick, btnCfg]),
    quick,
    h('div', { class: 'inst-grid' }, staffCard, h('div', { class: 'inst-side' }, liveCard, result)),
    scrim, drawer, focus.exit,
  );

  function toggleDrawer(open) {
    settingsOpen = open;
    drawer.classList.toggle('open', open);
    scrim.classList.toggle('open', open);
    drawer.inert = !open;
    if (open) drawer.querySelector('select, input, button')?.focus();
    else btnCfg.focus({ preventScroll: true });
  }

  const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
  const bMs = () => 60000 / cfg.bpm;
  const slotMs = () => bMs() * cfg.chordBeats;
  const chordOf = (i) => ex.chords[i];

  function setFeedback([kind, text]) {
    const key = `${kind}|${text}`;
    if (key === lastFeedback) return;
    lastFeedback = key;
    feedback.className = `feedback ${kind}`;
    feedback.textContent = text;
    if (kind === 'ok' || kind === 'err') replay(feedback, 'bump');
    if (kind === 'ok' || kind === 'warn' || kind === 'err') hit(board.el, kind, kind === 'ok' ? 'Certo' : kind === 'warn' ? 'Quase' : 'Errou', staffCard);
  }

  // ---- exercício --------------------------------------------------------------------------
  function newExercise() {
    stop(true);
    ex = buildChordExercise({
      keyN: pickKeyN(cfg), type: cfg.type, prog: cfg.chordProg, direction: cfg.direction, ext: cfg.chordExt, instr: cfg.instr,
      shape: cfg.chordShape, octave: cfg.reg[cfg.instr] ?? prof().defOct, bass: cfg.pianoBass, lead: cfg.voiceLead,
    });
    finished = null;
    grades = [];
    sel = 0;
    shown = -1;
    resultBox.replaceChildren();
    holdFill.style.width = '0%';
    setFeedback(['', '']);
    drawChips();
    drawStrip();
    showChord(0);
    status.textContent = {
      free: 'Toque o primeiro acorde: o app espera cada acorde e confirma quando as notas dele estiverem soando.',
      open: 'Prática livre: as notas da escala estão no instrumento. Toque os acordes na ordem, do seu jeito e sem pressa; no fim você vê o que acertou.',
      timed: 'O app toca o primeiro acorde, dá 4 tempos de contagem e você troca de acorde no ritmo.',
    }[mode()];
    badge.set();
    dots.clear();
  }

  function drawChips() {
    const n = ex.chords.length;
    fill(chips,
      h('span', { class: 'info-chip', text: ex.title }),
      h('span', { class: 'info-chip', text: `${n} acordes` }),
      h('span', { class: 'info-chip', text: cfg.chordExt === 'seventh' ? 'com sétima' : 'tríades' }),
      guitar() ? h('span', { class: 'info-chip', text: cfg.chordShape === 'barre' ? 'com pestana' : 'formas abertas' }) : null,
      mode() === 'open' ? h('span', { class: 'info-chip', text: 'prática livre' }) : null,
      mode() === 'timed' ? h('span', { class: 'info-chip', text: `${cfg.bpm} bpm · ${cfg.chordBeats} tempos` }) : null,
    );
  }

  function drawStrip() {
    fill(strip, ex.chords.map((c, i) => h('button', {
      type: 'button', class: 'cc', role: 'listitem', 'data-i': i, title: `${c.name} (${c.tones.join(' · ')})`,
      onclick: () => { if (!run) { sel = i; showChord(i); } },
    }, h('span', { class: 'cc-r', text: c.roman }), h('b', { class: 'cc-s', text: c.symbol }), h('small', { class: 'cc-n', text: c.name }))));
    paintStrip();
  }

  function paintStrip(active = -1) {
    [...strip.children].forEach((el, i) => {
      const g = grades[i];
      el.className = `cc${i === active ? ' cur' : ''}${!run && i === sel && active < 0 ? ' sel' : ''}${g ? ` ${GRADE_CLS[g]}` : ''}`;
    });
    const cur = strip.children[active >= 0 ? active : sel];
    if (cur) { // rola só a tira (não a página) para manter o cartão atual à vista
      const sr = strip.getBoundingClientRect();
      const er = cur.getBoundingClientRect();
      if (er.top < sr.top || er.bottom > sr.bottom) strip.scrollTop += (er.top - sr.top) - (strip.clientHeight - er.height) / 2;
      if (er.left < sr.left || er.right > sr.right) strip.scrollLeft += (er.left - sr.left) - (strip.clientWidth - er.width) / 2;
    }
  }

  let shown = -1;
  function showChord(i) {
    if (!ex) return;
    const c = chordOf(i);
    const key = mode() === 'open' ? 'scale' : i;
    if (shown !== key || !board.el.firstChild) {
      if (key === 'scale') board.setScale(cfg.instr, ex.scale, cfg.reg.piano ?? 4); else board.set(cfg.instr, c);
      shown = key;
    }
    paintTones();
    paintStrip(run ? i : -1);
  }

  /** Notas do acorde atual como pastilhas: acendem quando o microfone as ouve; notas de fora aparecem em vermelho. */
  function paintTones() {
    const i = run ? run.view : sel;
    const c = ex && chordOf(i);
    if (!c) { tones.replaceChildren(); return; }
    if (mode() === 'open') { paintScaleTones(); return; }
    const m = matchChord(live?.chroma ?? null, c.pcs);
    const out = c.pcs.map((p, k) => h('span', { class: `tone${m.present.includes(p) ? ' on' : ''}`, title: k === 0 ? 'fundamental' : '', text: PC_NAMES[p] }));
    m.extras.slice(0, 3).forEach((p) => out.push(h('span', { class: 'tone bad', text: `+ ${PC_NAMES[p]}` })));
    const sig = out.map((e) => e.className + e.textContent).join('|');
    if (sig !== tones.dataset.sig) { tones.dataset.sig = sig; fill(tones, out); }
    board.setHeard(m.present);
  }

  /** Prática livre: as 7 notas da escala como pastilhas; acendem quando o microfone as ouve. */
  function paintScaleTones() {
    const heard = live?.chroma ? heardPcs(live.chroma) : [];
    const set = new Set(ex.scale.pcs);
    const out = ex.scale.pcs.map((p) => h('span', { class: `tone${heard.includes(p) ? ' on' : ''}`, text: ex.scale.names[p] }));
    heard.filter((p) => !set.has(p)).slice(0, 3).forEach((p) => out.push(h('span', { class: 'tone bad', text: `+ ${PC_NAMES[p]}` })));
    const sig = out.map((e) => e.className + e.textContent).join('|');
    if (sig !== tones.dataset.sig) { tones.dataset.sig = sig; fill(tones, out); }
    board.setHeard(heard.filter((p) => set.has(p)));
  }

  function setRunning(on) {
    btnStart.disabled = on;
    liveCard.classList.toggle('running', on);
    staffCard.classList.toggle('running', on);
    btnNew.disabled = on;
    btnStop.disabled = !on;
    btnSkip.hidden = !(on && run?.mode === 'free');
    btnListen.disabled = on && run?.mode !== 'free';
  }

  // ---- som --------------------------------------------------------------------------------
  function playChord(c, at, dur) {
    const midis = guitar() ? c.voicing.midis : c.midis;
    midis.forEach((m, k) => scheduleFreq(440 * 2 ** ((m - 69) / 12), at + (guitar() ? k * 0.04 : 0), dur, { bank: getInstrument() }));
  }

  function listen() {
    if (run?.mode === 'free') { stopAll(); playChord(chordOf(run.i), getCtx().currentTime + 0.03, 1.6); return; }
    if (run) return;
    stop(true);
    const step = mode() === 'timed' ? slotMs() / 1000 : 1.6;
    const t0 = getCtx().currentTime + 0.15;
    run = { mode: 'listen', view: 0 };
    setRunning(true);
    ex.chords.forEach((c, i) => {
      playChord(c, t0 + i * step, step * 0.95);
      later(() => { run.view = i; showChord(i); badge.set({ name: c.name, sub: `${c.symbol} · ${c.roman}`, state: 'listen', label: '🔊 Ouvindo' }); }, 150 + i * step * 1000);
    });
    later(() => { run = null; setRunning(false); badge.set(); showChord(sel); status.textContent = ''; }, 150 + ex.chords.length * step * 1000 + 200);
  }

  // ---- leitura do microfone ---------------------------------------------------------------
  function sample() {
    const sp = mic.spectrum();
    if (!sp) return;
    const r = chromaFromSpectrum(sp.db, sp.sampleRate);
    live = { chroma: r.chroma, level: r.level, t: performance.now() - sp.lagMs };
    if (run?.mode === 'timed') run.samples.push({ t: live.t, chroma: live.chroma, level: live.level });
    paintTones();
    if (run?.mode === 'free') freeStep();
    else if (run?.mode === 'open') openStep();
  }

  // ---- guiado: espera cada acorde ---------------------------------------------------------
  async function start() {
    if (run) return;
    if (!(await ensureMic())) return;
    if (mode() === 'free') startFree(); else if (mode() === 'open') startOpen(); else startTimed();
  }

  function stop(silent = false) {
    cancelAnimationFrame(raf);
    clearTimers();
    stopAll();
    run = null;
    holdFill.style.width = '0%';
    setRunning(false);
    badge.set();
    dots.clear();
    setFeedback(['', '']);
    if (!silent) { status.textContent = 'Parado.'; showChord(sel); }
  }

  function startFree() {
    finished = null;
    grades = [];
    resultBox.replaceChildren();
    run = { mode: 'free', i: 0, view: 0, marks: [], items: [], hits: 0, mistakes: 0, ms: 0 };
    setRunning(true);
    status.textContent = '';
    showTarget();
  }

  function showTarget() {
    const r = run;
    if (!r) return;
    const c = chordOf(r.i);
    r.view = r.i;
    r.shownAt = performance.now();
    r.listenFrom = r.shownAt + (r.i ? 700 : 300);
    r.doneAt = null;
    r.okRun = 0;
    r.errors = 0;
    r.errRun = 0;
    r.inErr = false;
    holdFill.style.width = '0%';
    holdFill.classList.remove('in');
    setFeedback(['', 'Toque o acorde…']);
    dots.set(ex.chords.length, r.marks, r.i);
    badge.set({ name: c.name, sub: `${c.symbol} · ${c.roman} · acorde ${r.i + 1} de ${ex.chords.length}`, state: 'sing', label: `${prof().icon} Toque` });
    showChord(r.i);
  }

  function freeStep() {
    const r = run;
    if (r.doneAt || performance.now() < r.listenFrom) return;
    const c = chordOf(r.i);
    const m = matchChord(live.chroma, c.pcs);
    r.okRun = m.ok ? r.okRun + 1 : 0;
    holdFill.style.width = `${Math.round(Math.min(1, r.okRun / 4) * 100)}%`;
    holdFill.classList.toggle('in', m.ok);
    if (r.okRun >= 4) { freeSuccess(); return; }
    if (!live.chroma) { setFeedback(['', 'Toque o acorde…']); r.errRun = 0; return; }
    if (m.ok) { setFeedback(['ok', 'Acorde certo — segure…']); r.errRun = 0; return; }
    if (m.similarity >= 0.6 && m.missing.length) { setFeedback(['warn', `Quase: falta ${names(m.missing)}`]); r.errRun = 0; return; }
    const heard = heardPcs(live.chroma).slice(0, 3);
    if (heard.length) {
      r.errRun++;
      setFeedback(['err', `Ouvi ${names(heard)} — procure ${c.symbol} (${c.tones.join(' · ')})`]);
      if (r.errRun === 6 && !r.inErr) { r.errors++; r.inErr = true; } // um erro por "tentativa errada" sustentada
    }
  }

  function freeSuccess() {
    const r = run;
    r.doneAt = performance.now();
    const c = chordOf(r.i);
    const clean = r.errors === 0;
    r.marks.push(clean ? 'ok' : 'warn');
    r.items.push({ name: c.symbol, errors: r.errors, ms: r.doneAt - r.shownAt });
    r.ms += r.doneAt - r.shownAt;
    r.mistakes += r.errors;
    if (clean) r.hits++;
    grades[r.i] = clean ? 'perfect' : 'ok';
    dots.set(ex.chords.length, r.marks, r.i + 1);
    holdFill.style.width = '100%';
    holdFill.classList.add('in');
    feedback.className = `feedback ${clean ? 'ok' : 'warn'}`;
    lastFeedback = 'done';
    replay(feedback, 'bump');
    replay(liveCard, clean ? 'flash-ok' : 'flash-warn');
    feedback.textContent = clean ? `✓ ${c.symbol}` : `✓ ${c.symbol} (depois de ${r.errors} tentativa${r.errors > 1 ? 's' : ''} errada${r.errors > 1 ? 's' : ''})`;
    hit(board.el, clean ? 'ok' : 'warn', c.symbol, staffCard);
    paintStrip(r.i);
    if (r.i + 1 >= ex.chords.length) { later(finishFree, 700); return; }
    r.i++;
    later(showTarget, 450);
  }

  function skip() {
    const r = run;
    if (!r || r.mode !== 'free' || r.doneAt) return;
    r.marks.push('skip');
    r.items.push({ name: chordOf(r.i).symbol, errors: r.errors, ms: 0, skipped: true });
    r.mistakes += r.errors;
    grades[r.i] = 'none';
    if (r.i + 1 >= ex.chords.length) { finishFree(); return; }
    r.i++;
    showTarget();
  }

  function finishFree() {
    const r = run;
    if (!r) return;
    clearTimers();
    run = null;
    setRunning(false);
    badge.set();
    dots.clear();
    holdFill.style.width = '0%';
    setFeedback(['', '']);
    finished = { mode: 'free' };
    paintStrip();
    showChord(0);
    const n = ex.chords.length;
    const done = r.items.filter((x) => !x.skipped);
    const avg = done.length ? (r.ms / done.length / 1000).toFixed(1) : '—';
    const pct = Math.round((r.hits / n) * 100);
    status.textContent = `${ex.title}: ${r.hits} de ${n} acordes de primeira`;
    const scoreEl = h('div', { class: 'big-score', text: '0%' });
    fill(resultBox,
      h('div', { class: 'score-row' }, scoreEl,
        h('p', { text: `de primeira · ${r.mistakes} tentativa${r.mistakes === 1 ? '' : 's'} errada${r.mistakes === 1 ? '' : 's'} no caminho · ${avg}s por acorde` })),
      h('p', { class: 'hint', text: 'Verde: acertou de primeira · âmbar: errou antes de acertar · vermelho: pulou.' }));
    celebrate(scoreEl, pct);
    recordSession({
      mode: 'instrument', kind: 'free', instr: cfg.instr, score: r.hits / n, total: n, hits: r.hits, scale: ex.title, pattern: 'chords',
    });
  }

  // ---- livre: toque os acordes do seu jeito; o app confere a sequência no fim ------------------
  function startOpen() {
    finished = null;
    grades = [];
    resultBox.replaceChildren();
    run = {
      mode: 'open', view: 0, ptr: 0, seq: [], last: null, cand: null, candN: 0, silent: 0,
    };
    setRunning(true);
    status.textContent = '';
    badge.set({ name: 'Toque', sub: 'os acordes da escala, do seu jeito', state: 'sing', label: `${prof().icon} Livre` });
    setFeedback(['', 'Toque os acordes na ordem, sem pressa…']);
    showChord(0);
  }

  function openStep() {
    const r = run;
    if (!live.chroma) { r.silent++; if (r.silent >= 6) r.last = null; r.cand = null; r.candN = 0; return; }
    r.silent = 0;
    let best = null;
    for (const c of ex.chords) {
      const m = matchChord(live.chroma, c.pcs);
      if (m.ok && (!best || m.similarity > best.sim)) best = { sym: c.symbol, sim: m.similarity };
    }
    if (!best) { r.cand = null; r.candN = 0; return; }
    if (r.cand === best.sym) r.candN++; else { r.cand = best.sym; r.candN = 1; }
    if (r.candN !== 3 || best.sym === r.last) return;
    r.seq.push(best.sym);
    r.last = best.sym;
    const exp = ex.chords.map((c) => c.symbol);
    const k = exp[r.ptr] === best.sym ? r.ptr : exp.indexOf(best.sym, r.ptr + 1);
    if (k >= 0 && k <= r.ptr + 2) { // seguiu a ordem (ou pulou um ou dois): marca no cartão
      grades[k] = 'perfect';
      r.ptr = k + 1;
      r.view = Math.min(r.ptr, exp.length - 1);
      setFeedback(['ok', `✓ ${best.sym}`]);
      paintStrip(r.view);
      if (r.ptr >= exp.length) later(finishOpen, 900);
    } else setFeedback(['warn', `Ouvi ${best.sym} (fora da ordem)`]);
  }

  function finishOpen() {
    const r = run;
    if (!r || r.mode !== 'open') return;
    clearTimers();
    run = null;
    setRunning(false);
    badge.set();
    setFeedback(['', '']);
    if (!r.seq.length) { grades = []; paintStrip(); status.textContent = 'Não ouvi nenhum acorde. Confira o microfone e tente de novo.'; return; }
    const exp = ex.chords.map((c) => c.symbol);
    const al = alignSequence(exp, r.seq);
    grades = al.results.map((ok) => (ok ? 'perfect' : 'none'));
    finished = { mode: 'open' };
    paintStrip();
    const n = exp.length;
    const okN = al.results.filter(Boolean).length;
    const pct = Math.round((okN / n) * 100);
    const missed = exp.filter((_, i) => !al.results[i]);
    status.textContent = `${ex.title}: ${okN} de ${n} acordes`;
    const scoreEl = h('div', { class: 'big-score', text: '0%' });
    fill(resultBox,
      h('div', { class: 'score-row' }, scoreEl, h('p', { text: `${okN} de ${n} acordes na ordem${al.extras ? ` · ${al.extras} a mais ou fora de ordem` : ''}` })),
      missed.length ? h('p', { class: 'hint', text: `Faltaram: ${missed.join(', ')}.` }) : null,
      h('p', { class: 'hint', text: 'Verde: acorde tocado na ordem · vermelho tracejado: não ouvi. Acordes repetidos só contam depois de uma pausa ou de outro acorde.' }));
    celebrate(scoreEl, pct);
    recordSession({
      mode: 'instrument', kind: 'open', instr: cfg.instr, score: okN / n, total: n, hits: okN, scale: ex.title, pattern: 'chords',
    });
  }

  // ---- no tempo do metrônomo --------------------------------------------------------------
  const evalNow = (upTo) => evaluateChordsTimed({
    chords: ex.chords, samples: run.samples, startMs: run.startPerf, slotMs: run.slot, offsetMs: cfg.offset,
    rigor: TIMING_RIGOR[cfg.rigor] || 1, upTo, extraMs: extraTolerance(profile?.saved?.std ?? 0),
  });

  function startTimed() {
    stop(true);
    finished = null;
    grades = [];
    resultBox.replaceChildren();
    const c = getCtx();
    const lead = 0.25;
    const b = bMs();
    const slot = slotMs();
    const t0 = c.currentTime + lead;
    const perf0 = performance.now() + lead * 1000;
    const n = ex.chords.length;
    const refDur = cfg.tonicRef ? 1.6 : 0;
    if (cfg.tonicRef) playChord(ex.chords[0], t0, 1.5);
    const countStart = t0 + refDur;
    for (let k = 0; k < 4; k++) scheduleClick(countStart + (k * b) / 1000, k === 0);
    const noteStart = countStart + (4 * b) / 1000;
    if (cfg.click) for (let k = 0; k < n * cfg.chordBeats; k++) scheduleClick(noteStart + (k * b) / 1000, k % cfg.chordBeats === 0);
    const startPerf = perf0 + refDur * 1000 + 4 * b;
    run = {
      mode: 'timed', n, slot, b, samples: [], view: 0, countStart: perf0 + refDur * 1000, startPerf, end: startPerf + n * slot + 700, shownActive: -2, shownFinal: -2,
    };
    setRunning(true);
    status.textContent = '';
    loop();
  }

  function loop() {
    if (!run) return;
    const now = performance.now();
    if (now >= run.end) { finishTimed(); return; }
    const r = run;
    if (now < r.countStart) {
      const c0 = chordOf(0);
      badge.set({ name: c0.name, sub: 'acorde de partida', state: 'listen', label: '🔊 Ouça o acorde' });
      showChord(0);
    } else if (now < r.startPerf) {
      badge.set({ name: String(Math.floor((now - r.countStart) / r.b) + 1), sub: 'contagem', state: 'count', label: 'Prepare-se' });
    } else {
      const i = Math.min(r.n - 1, Math.floor((now - r.startPerf) / r.slot));
      const lastFinal = Math.min(r.n - 1, Math.floor((now - r.startPerf - 260) / r.slot) - 1);
      const c = chordOf(i);
      badge.set({ name: c.name, sub: `${c.symbol} · ${c.roman} · acorde ${i + 1} de ${r.n}`, state: 'sing', label: `${prof().icon} Toque!` });
      if (i !== r.shownActive || lastFinal !== r.shownFinal) {
        r.shownActive = i;
        r.shownFinal = lastFinal;
        r.view = i;
        showChord(i);
        if (lastFinal >= 0) {
          const ev = evalNow(lastFinal);
          ev.results.forEach((x, k) => { if (x) grades[k] = x.grade; });
          paintStrip(i);
          const last = ev.results[lastFinal];
          if (last) setFeedback(chordFeedback(last, lastFinal));
        }
      }
    }
    raf = requestAnimationFrame(loop);
  }

  function chordFeedback(res, i) {
    const c = chordOf(i);
    const ms = res.deltaMs == null ? '' : ` ${res.deltaMs > 0 ? '+' : ''}${Math.round(res.deltaMs)} ms`;
    if (res.grade === 'none') return ['err', `${c.symbol}: não ouvi`];
    if (res.grade === 'wrong') return ['err', `${c.symbol}: você tocou ${names(res.heard.slice(0, 3)) || 'outra coisa'}`];
    if (res.grade === 'ok') return ['warn', `${c.symbol} certo, mas fora do tempo${ms}`];
    return ['ok', `${c.symbol} ✓${ms}`];
  }

  function finishTimed() {
    const r = run;
    cancelAnimationFrame(raf);
    const ev = evalNow(Infinity);
    run = null;
    setRunning(false);
    badge.set();
    finished = { mode: 'timed', ev };
    grades = ev.results.map((x) => x.grade);
    setFeedback(['', '']);
    paintStrip();
    showChord(0);
    const pct = Math.round(ev.score * 100);
    status.textContent = `${ex.title}: ${pct}%`;
    const cnt = (fn) => ev.results.filter(fn).length;
    const onTime = cnt((x) => x.grade === 'perfect' || x.grade === 'good');
    const late = cnt((x) => x.grade === 'ok');
    const wrong = cnt((x) => x.grade === 'wrong');
    const none = cnt((x) => x.grade === 'none');
    const cats = [
      { n: onTime, cls: 'perfect', icon: '✓', text: 'no tempo' },
      { n: late, cls: 'ok', icon: '~', text: 'fora do tempo' },
      { n: wrong, cls: 'miss', icon: '✗', text: wrong === 1 ? 'outro acorde' : 'outros acordes' },
      { n: none, cls: 'none', icon: '—', text: 'sem som' },
    ].filter((x) => x.n > 0);
    const scoreEl = h('div', { class: 'big-score', text: '0%' });
    const med = (() => {
      const d = ev.results.map((x) => x.deltaMs).filter((x) => x != null).sort((a, b) => a - b);
      return d.length ? d[d.length >> 1] : 0;
    })();
    fill(resultBox,
      h('div', { class: 'score-row' }, scoreEl,
        h('p', { class: 'score-sub' }, h('b', { text: `${onTime + late} de ${r.n}` }), ` acorde${onTime + late === 1 ? '' : 's'} certo${onTime + late === 1 ? '' : 's'}`, h('br'), h('span', { text: `${onTime} no tempo` }))),
      h('div', { class: 'stack-bar', role: 'img', 'aria-label': 'Distribuição do resultado' }, cats.map((c) => h('span', { class: `seg ${c.cls}`, style: `flex:${c.n}`, title: `${c.n} ${c.text}` }))),
      h('div', { class: 'legend' }, cats.map((c) => h('span', { class: `lg ${c.cls}` }, h('i', { text: c.icon }), h('b', { text: c.n }), ` ${c.text}`))),
      h('div', { class: 'tiles' }, h('div', { class: `tile ${Math.abs(med) < 120 ? 'ok' : 'warn'}` }, h('span', { class: 't-ic', text: '⏱' }), h('small', { text: 'Troca de acorde' }),
        h('b', { text: Math.abs(med) < 120 ? 'no ponto' : `${med > 0 ? 'atrasa' : 'adianta'} ~${Math.round(Math.abs(med))} ms` }))),
      h('p', { class: 'hint', text: 'Cada acorde vale quando todas as notas dele soam juntas. Em cartões: verde no tempo · âmbar fora do tempo · vermelho outro acorde ou nada.' }),
    );
    celebrate(scoreEl, pct);
    recordSession({
      mode: 'instrument', kind: 'timed', instr: cfg.instr, score: ev.score, total: r.n, scale: ex.title, pattern: 'chords', bpm: cfg.bpm,
    });
  }

  // ---- teclado ----------------------------------------------------------------------------
  function onKey(e) {
    if (e.key === 'Escape' && settingsOpen) { toggleDrawer(false); return; }
    if (isFormTarget(e) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.key === 'Enter' && run?.mode === 'open') finishOpen();
    else if (e.key === 'Enter' && !run) start();
    else if (e.key === 'Escape' && run) stop();
    else if (e.key === ' ' && run?.mode === 'free') { e.preventDefault(); listen(); }
    else if (e.key === 'ArrowRight' && run?.mode === 'free') skip();
  }
  document.addEventListener('keydown', onKey);

  // ---- opções rápidas e ajustes -----------------------------------------------------------
  const bpmSlider = createSlider({
    label: 'Andamento', min: 40, max: 140, step: 2, value: cfg.bpm, compact: true,
    format: (v) => `${v} bpm`, onChange: (v) => update({ bpm: v }, false),
  });
  const bpmField = field('Andamento', bpmSlider.el);
  const beatsField = field('Tempos por acorde', select([[1, '1 tempo'], [2, '2 tempos'], [4, '4 tempos (1 compasso)']], cfg.chordBeats, (v) => update({ chordBeats: Number(v) })));
  const dirField = field('Direção', select(Object.entries(DIRECTIONS), cfg.direction, (v) => update({ direction: v })));
  const shapeField = field('Formas', select([['open', 'Abertas'], ['barre', 'Com pestana']], cfg.chordShape, (v) => update({ chordShape: v })));
  function buildQuick() {
    rows.set(
      [
      field('Exercício', select(Object.entries(PROGRESSIONS).map(([k, v]) => [k, v.label]), cfg.chordProg, (v) => update({ chordProg: v }))),
      field('Tonalidade', select([['auto', 'Sorteada'], ...tonicOptions(cfg.type)], cfg.tonic, (v) => update({ tonic: v }))),
      field('Escala', select(Object.entries(SCALE_TYPES).map(([k, v]) => [k, v.label]), cfg.type, (v) => update({ type: v }))),
      bpmField,
      ],
      [
      field('Acordes', select([['triad', 'Tríades'], ['seventh', 'Com sétima']], cfg.chordExt, (v) => update({ chordExt: v }))),
      dirField, shapeField, beatsField,
      ],
    );
  }

  const section = (icon, title, ...kids) => h('section', { class: 'set-sec' }, h('h3', {}, h('span', { class: 'set-ic', text: icon }), title), ...kids);
  const row = (label, hint, control) => h('div', { class: 'set-row' }, h('div', { class: 'set-txt' }, h('b', { text: label }), hint ? h('small', { text: hint }) : null), control);
  const toggle = (on, fn) => h('button', {
    class: 'switch', role: 'switch', 'aria-checked': String(on), onclick: (e) => { const v = e.currentTarget.getAttribute('aria-checked') !== 'true'; e.currentTarget.setAttribute('aria-checked', v); fn(v); },
  }, h('span', { class: 'knob' }));
  const segmented = (options, current, fn) => h('div', { class: 'seg mini', role: 'group' }, options.map(([v, label]) => h('button', {
    class: `seg-btn${String(v) === String(current) ? ' active' : ''}`,
    onclick: (e) => { e.currentTarget.parentNode.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === e.currentTarget)); fn(v); },
  }, label)));

  function buildSettings() {
    drawerBody.replaceChildren(
      section('🎼', 'Exercício',
        row('O que praticar', 'Acordes (escala harmonizada e progressões) ou notas soltas, uma por vez.', segmented([['chords', 'Acordes'], ['notes', 'Notas soltas']], cfg.content, (v) => update({ content: v }))),
        cfg.instr === 'piano'
          ? row('Baixo na mão esquerda', 'Acrescenta a fundamental uma oitava abaixo do acorde.', toggle(cfg.pianoBass, (v) => update({ pianoBass: v })))
          : null,
        cfg.instr === 'piano'
          ? row('Inversões próximas', 'Escolhe a inversão de cada acorde mais perto do anterior (a mão quase não se mexe). Desligado: sempre em estado fundamental.', toggle(cfg.voiceLead, (v) => update({ voiceLead: v })))
          : null,
        cfg.instr === 'piano'
          ? row('Registro', 'Oitava do acorde da mão direita.', select([[3, 'Oitava 3 (grave)'], [4, 'Oitava 4 (central)'], [5, 'Oitava 5 (aguda)']], cfg.reg.piano ?? 4, (v) => update({ reg: { ...cfg.reg, piano: Number(v) } })))
          : null,
        row('Tonalidade sorteada', 'Quando a tonalidade está em “Sorteada”: máximo de sustenidos/bemóis.', select(
          Array.from({ length: MAX_ACCIDENTALS + 1 }, (_, n) => [n, n === 0 ? 'Só Dó maior / Lá menor' : `Até ${n} alterações`]), cfg.maxAcc, (v) => update({ maxAcc: Number(v) }))),
      ),
      section('⏱', 'Metrônomo',
        row('Rigor do tempo', 'Quão perto do pulso você precisa trocar de acorde.', segmented([['easy', 'Leve'], ['normal', 'Normal'], ['hard', 'Exigente']], cfg.rigor, (v) => update({ rigor: v }, false))),
        row('Clique do metrônomo', null, toggle(cfg.click, (v) => update({ click: v }, false))),
        row('Tocar o primeiro acorde antes da contagem', 'Referência do tom para você começar.', toggle(cfg.tonicRef, (v) => update({ tonicRef: v }, false))),
        row('Latência do equipamento', 'Atraso do microfone e do áudio. Se o app diz que você “atrasa ~100 ms”, coloque 100.', createSlider({
          label: 'Latência', compact: true, min: -100, max: 400, step: 5, value: cfg.offset, mark: 0,
          format: (v) => `${v > 0 ? '+' : ''}${v} ms`, onChange: (v) => update({ offset: v }, false),
        }).el),
      ),
      section('🎚', 'Áudio',
        row('Medir a latência', 'Assistente passo a passo: você toca junto com o clique e o app calcula. O valor fica salvo para este microfone e esta saída de som.',
          h('button', { class: 'btn', onclick: () => { toggleDrawer(false); openCal(); } }, '🎯 Calibrar')),
        row('Calibrar por eco', 'Automático: o app toca sinais pela caixa de som e mede o atraso, sem você tocar. Não funciona com fones fechados.',
          h('button', { class: 'btn', onclick: () => { toggleDrawer(false); openEcho(); } }, '🔊 Calibrar')),
        row('Áudio e microfone', 'Escolher a entrada, ver o nível do sinal, perfis por aparelho e relatório de diagnóstico.',
          h('button', { class: 'btn', onclick: () => { toggleDrawer(false); openAudio(); } }, '🎚 Abrir'))),
      section('🔊', 'Som', h('div', { class: 'set-row stacked' }, instrumentField())),
      ...(awakeSupported()
        ? [section('📱', 'Tela', row('Manter a tela ligada', 'Evita que o celular apague a tela enquanto você pratica (vale para todas as abas de prática).', toggle(awakeEnabled(), (v) => setAwakeEnabled(v))))]
        : []),
      h('div', { class: 'set-tips' },
        h('p', { text: '🎧 Use fones: assim a referência e o clique não entram no microfone.' }),
        h('p', { text: '🎤 O microfone ouve o acorde inteiro: todas as notas dele precisam soar juntas e limpas (abafe as cordas que não fazem parte).' }),
        h('p', { text: '🎸 Nas formas do violão, × = não toque a corda, ○ = corda solta, números = dedos.' }),
        h('p', { text: '⌨ Guiado: Enter começa · Espaço ouve o acorde · → pula · Esc para.' }),
      ),
    );
  }

  function paintTabs() {
    nav.paint();
    modeTabs.querySelectorAll('.seg-btn').forEach((b) => {
      const on = b.dataset.mode === mode();
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on);
    });
    btnStart.textContent = { free: '▶ Começar (Enter)', open: '▶ Começar a tocar (Enter)', timed: '▶ Tocar no tempo (Enter)' }[mode()];
    btnStop.textContent = mode() === 'open' ? '✓ Terminar' : '■ Parar';
    btnSkip.hidden = true;
    bpmField.hidden = mode() !== 'timed';
    beatsField.hidden = mode() !== 'timed';
    dirField.hidden = cfg.chordProg !== 'harm';
    shapeField.hidden = !guitar();
  }

  function update(patchIn, regenerate = true) {
    let patch = patchIn;
    if (patch.type && cfg.tonic !== 'auto') patch = { ...patch, tonic: String(resolveTonic(Number(cfg.tonic), patch.type)) }; // mantém a tônica ao trocar o tipo
    Object.assign(cfg, patch);
    if (patch.instr) setInstrument(patch.instr);
    persist();
    if (patch.offset !== undefined && profile) saveProfile(profile.key, { offset: patch.offset }); // vale para este aparelho
    if (patch.instr || patch.content) {
      if (!wantsChords(cfg)) { remount(); return; }
      if (patch.instr) { remount(); return; } // teclado ↔ violão: refaz a tela (quadro e ajustes mudam)
    }
    if (patch.type !== undefined || patch.tonic !== undefined) buildQuick(); // a lista de tônicas muda com o tipo de escala
    paintTabs();
    buildSettings();
    if (regenerate || patch.mode) newExercise();
    else if (ex && !run) drawChips();
  }

  drawMicButton();
  buildQuick();
  paintTabs();
  buildSettings();
  newExercise();

  return () => {
    focus.destroy();
    stop(true);
    clearInterval(sampler);
    mic.stop();
    meter.destroy();
    nav.destroy();
    audioPanel?.close();
    echo?.close();
    calib?.close();
    navigator.mediaDevices?.removeEventListener?.('devicechange', onDevChange);
    document.removeEventListener('keydown', onKey);
    root.classList.remove('wide');
  };
}
