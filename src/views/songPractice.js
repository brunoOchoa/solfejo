// Praticar músicas no violino: a pauta da música inteira + o braço com as notas do trecho.
// Modos: Ouvir (o app toca), Guiado (espera cada nota) e Tocar junto (no tempo, com metrônomo e/ou piano de acompanhamento).
import { h, field, select, isFormTarget } from '../dom.js';
import { SONGS, getSong } from '../music/songs.js';
import { renderSong } from '../render/songStaff.js';
import { evaluateSong, starsFor } from '../music/songEval.js';
import { Mic } from '../music/mic.js';
import {
  NoteDetector, INSTRUMENT_PROFILES, TIMING_RIGOR, centsOff,
} from '../music/instrument.js';
import { HoldTracker } from '../music/smooth.js';
import {
  getCtx, scheduleClick, scheduleFreq, stopAll, loadBank, setInstrument,
} from '../music/audio.js';
import { createFingerboard } from '../ui/fingerboard.js';
import { createTargetBadge } from '../ui/targetBadge.js';
import { createVolumeControl } from '../ui/volume.js';
import { createFocusMode } from '../ui/focusMode.js';
import { createSlider, tempoName } from '../ui/slider.js';
import { createMicMeter } from '../ui/micMeter.js';
import { openAudioPanel } from '../ui/audioPanel.js';
import { openCalibration } from '../ui/calibration.js';
import { openEchoCalibration } from '../ui/echoCalibration.js';
import { awakeSupported, awakeEnabled, setAwakeEnabled } from '../ui/wake.js';
import {
  activeProfile, saveProfile, extraTolerance,
} from '../music/audioProfile.js';
import { spellMap } from '../music/fingering.js';
import { pitchClassName } from '../music/theory.js';
import { load, save, recordSession } from '../storage.js';
import { hit } from '../ui/fx.js';
import { instrumentField } from './singShared.js';
import { createPracticeNav } from '../ui/practiceNav.js';
import {
  createPracticeBar, createExerciseRows, iconButton, micGroup,
} from '../ui/practiceBar.js';

export const SONG_DEFAULTS = {
  area: 'scales', songId: SONGS[0].id, songMode: 'timed', songTempo: 0, songAccomp: 'both', songRange: 'all', songNames: true, songFingers: true,
};
const ACCOMP = [['both', 'Piano + metrônomo'], ['piano', 'Só piano'], ['click', 'Só metrônomo'], ['none', 'Sem acompanhamento']];
const MODES = [['listen', 'Ouvir'], ['follow', 'Guiado'], ['timed', 'Tocar junto']];
const PROGRESS_KEY = 'songs.progress';
const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter(Boolean));
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const replay = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);
const GRADE_CLS = { perfect: 'perfect', good: 'perfect', ok: 'ok', wrong: 'wrong', none: 'none' };

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

export function mountSong(root, { defaults, remount }) {
  const cfg = load('cfg.instrument', defaults);
  const persist = () => save('cfg.instrument', cfg);
  cfg.instr = 'violin';
  const prof = INSTRUMENT_PROFILES.violin;
  const song = () => getSong(cfg.songId);
  const tempo = () => cfg.songTempo || song().tempo;
  const beatMs = () => 60000 / tempo();
  const vbank = () => (['violinSso', 'violinSsoN'].includes(load('pref.violinBank', 'violin')) ? load('pref.violinBank', 'violin') : 'violin'); // som do violino: solo ou naipe
  loadBank(vbank());
  loadBank('piano');

  // ---- trecho (compassos) --------------------------------------------------------------------
  const ranges = () => {
    const s = song();
    const out = [['all', `Música toda (${s.bars} compassos)`]];
    for (let a = 1; a <= s.bars; a += 4) { const b = Math.min(s.bars, a + 3); out.push([`${a}-${b}`, `Compassos ${a} a ${b}`]); }
    return out;
  };
  const rangeBars = () => {
    const s = song();
    if (cfg.songRange === 'all') return [0, s.bars - 1];
    const [a, b] = cfg.songRange.split('-').map(Number);
    return [Math.max(0, a - 1), Math.min(s.bars - 1, b - 1)];
  };
  /** Eventos do trecho, com o tempo contado a partir do começo dele. */
  const rangeEvents = () => {
    const s = song();
    const [b0, b1] = rangeBars();
    const base = b0 * s.barBeats;
    return s.events.filter((e) => e.bar >= b0 && e.bar <= b1).map((e) => ({ ...e, startBeat: e.startBeat - base }));
  };
  const rangeBeats = () => { const [b0, b1] = rangeBars(); return (b1 - b0 + 1) * song().barBeats; };

  let run = null;
  let finished = null; // { ev, mode }
  let raf = 0;
  let timers = [];
  let settingsOpen = false;
  let lastFeedback = '';
  let ctrl = null; // controle da pauta
  let grades = {};
  let activeIdx = -1;

  // ---- microfone --------------------------------------------------------------------------------
  const board = createFingerboard({ position: '1' });
  const detector = new NoteDetector();
  const mic = new Mic((frame) => {
    const out = detector.update(frame);
    const timed = run?.mode === 'timed';
    board.push({ t: out.t - (timed ? cfg.offset : 0), midi: run && run.mode !== 'follow' ? out.shown : out.midi });
    onFrame(out);
  }, prof.mic);
  let profile = null;
  let audioPanel = null;
  let calib = null;
  let echo = null;
  const meter = createMicMeter(mic, { onClick: () => openAudio(), expectSound: () => run?.mode === 'timed' || run?.mode === 'follow' });
  async function syncProfile() {
    profile = await activeProfile(mic);
    const saved = profile.saved;
    if (saved && saved.offset !== cfg.offset) { cfg.offset = saved.offset; persist(); buildSettings(); }
    meter.setNotice(saved ? '' : 'Sem calibração para este aparelho');
  }
  mic.onEnded = () => { drawMic(); meter.setNotice(''); };
  async function ensureMic() {
    if (!mic.active) {
      try {
        mic.detect = prof.mic;
        await mic.start();
        syncProfile();
      } catch (err) {
        statusEl.textContent = err.name === 'NotSupportedError'
          ? 'Este navegador não permite microfone (use HTTPS ou localhost).'
          : 'Microfone bloqueado. Permita o acesso no ícone de cadeado da barra de endereço e tente de novo.';
        drawMic();
        return false;
      }
    }
    drawMic();
    return true;
  }
  const btnMic = h('button', { class: 'btn', onclick: async () => { if (mic.active) { mic.stop(); detector.reset(); board.reset(); drawMic(); } else await ensureMic(); } });
  function drawMic() {
    btnMic.textContent = mic.active ? '🎤 Mic ligado' : '🎤 Ligar mic';
    btnMic.classList.toggle('active', mic.active);
  }
  function openAudio() {
    audioPanel = openAudioPanel({
      mic, ensureMic, host: root, getProfile: () => profile,
      restartMic: async () => { mic.stop(); detector.reset(); board.reset(); await ensureMic(); },
      onCalibrate: () => openCal(),
      onEcho: () => openEcho(),
    });
  }
  function openCal() {
    calib?.close();
    calib = openCalibration({
      host: root, mic, ensureMic, instrumentLabel: 'violino',
      onApply: (off, st) => { update({ offset: off }); if (profile) saveProfile(profile.key, { offset: off, std: st.std, n: st.n, source: st.source }); },
    });
  }
  function openEcho() {
    echo?.close();
    echo = openEchoCalibration({
      host: root, mic, ensureMic,
      onApply: (off, st) => { update({ offset: off }); if (profile) saveProfile(profile.key, { offset: off, ...st }); },
    });
  }
  const onDevChange = () => { if (mic.active) syncProfile(); };
  navigator.mediaDevices?.addEventListener?.('devicechange', onDevChange);

  // ---- elementos --------------------------------------------------------------------------------
  const nav = createPracticeNav({
    instruments: INSTRUMENT_PROFILES,
    getCfg: () => cfg,
    onInstrument: (id) => { cfg.instr = id; persist(); remount(); }, // outro instrumento: a tela dele abre
    onArea: (id) => { cfg.area = id; persist(); remount(); },
  });
  const modeTabs = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Modo' }, MODES.map(([id, label]) =>
    h('button', { class: 'seg-btn', role: 'tab', 'data-mode': id, onclick: () => update({ songMode: id }) }, label)));
  const chips = h('div', { class: 'info-row' });
  const staff = h('div', { class: 'staff wide paper song-staff' });
  const status = h('div', { class: 'status big', 'aria-live': 'polite' });
  const statusEl = h('div', { class: 'chord-msg' });
  const badge = createTargetBadge();
  const holdFill = h('div', { class: 'hold-fill' });
  const hold = h('div', { class: 'hold-bar', role: 'progressbar', 'aria-label': 'Tempo na nota' }, holdFill);
  const feedback = h('div', { class: 'feedback', 'aria-live': 'polite' });
  const resultBox = h('div', { class: 'result' });
  const btnStart = h('button', { class: 'btn primary', onclick: () => start() });
  const btnStop = h('button', { class: 'btn', onclick: () => stop(), disabled: true }, '■ Parar');
  const btnHear = h('button', { class: 'btn', onclick: () => hearNote() }, '🔊 Ouvir a nota');
  const btnSkip = h('button', { class: 'btn', onclick: () => skip() }, '⏭ Pular');
  const btnCfg = iconButton('ajustes', 'Ajustes', () => toggleDrawer(true), { 'aria-haspopup': 'dialog' });
  const focus = createFocusMode({ iconOnly: true, onChange: () => setTimeout(() => drawStaff(), 60) });
  const rows = createExerciseRows();
  const quick = rows.el;
  const btnQuick = h('button', { class: 'btn quick-toggle', 'aria-expanded': 'false', onclick: () => {
    const open = quick.classList.toggle('open');
    btnQuick.setAttribute('aria-expanded', open);
  } }, '🎼 Exercício');
  const staffCard = h('section', { class: 'card staff-card song-card' }, chips, staff, h('div', { class: 'graph-host' }, board.el));
  const liveCard = h('section', { class: 'card live' },
    h('div', { class: 'live-top' }, badge.el, h('div', { class: 'live-info' }, status)),
    hold, feedback, statusEl,
    h('div', { class: 'actions' }, btnStart, h('div', { class: 'actions-sub' }, btnHear, btnSkip, btnStop)),
  );
  const result = h('section', { class: 'card result-card' }, resultBox);
  const drawerBody = h('div', { class: 'drawer-body' });
  const drawer = h('aside', { class: 'drawer card', 'aria-label': 'Ajustes da prática', inert: true },
    h('div', { class: 'drawer-head' }, h('b', { text: 'Ajustes da prática' }), h('button', { class: 'btn', 'aria-label': 'Fechar ajustes', onclick: () => toggleDrawer(false) }, '✕')),
    drawerBody);
  const scrim = h('div', { class: 'scrim', onclick: () => toggleDrawer(false) });
  root.classList.add('wide');
  root.append(
    nav.el,
    createPracticeBar([modeTabs], [micGroup(btnMic, meter.el), createVolumeControl({ iconOnly: true, song: true }).el, focus.btn, btnQuick, btnCfg]),
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

  function setFeedback([kind, text]) {
    const key = `${kind}|${text}`;
    if (key === lastFeedback) return;
    lastFeedback = key;
    feedback.className = `feedback ${kind}`;
    feedback.textContent = text;
    if (kind === 'ok' || kind === 'err') replay(feedback, 'bump');
    if (kind === 'ok' || kind === 'warn' || kind === 'err') hit(staff, kind, kind === 'ok' ? 'Certo' : kind === 'warn' ? 'Quase' : 'Errou', staffCard);
  }

  // ---- pauta e braço ------------------------------------------------------------------------------
  function drawStaff() {
    ctrl = renderSong(staff, song(), { names: cfg.songNames || !!finished, fingers: cfg.songFingers });
    ctrl.setGrades(grades);
    ctrl.setActive(activeIdx);
  }
  function followStaff(idx) {
    const el = ctrl?.noteEl(idx);
    if (!el || staff.scrollHeight <= staff.clientHeight + 2) return;
    const sr = staff.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    if (er.top >= sr.top + 8 && er.bottom <= sr.bottom - 8) return;
    staff.scrollTop += (er.top - sr.top) - (staff.clientHeight - er.height) / 2;
  }
  function setActive(idx) {
    if (idx === activeIdx) return;
    activeIdx = idx;
    ctrl?.setActive(idx);
    if (idx >= 0) { followStaff(idx); showBoardFor(idx); }
  }
  /** O braço mostra as notas do compasso atual e do próximo (a da vez pulsa). */
  function showBoardFor(idx) {
    const s = song();
    const e = s.events[idx];
    const bar = e ? e.bar : rangeBars()[0];
    const [, b1] = rangeBars();
    const notes = s.events.filter((x) => !x.rest && x.bar >= bar && x.bar <= Math.min(bar + 1, b1));
    board.setNames(spellMap(notes.map((n) => ({ step: n.pitch.step, acc: n.pitch.acc }))));
    board.setScale([...new Set(notes.map((n) => n.midi))]);
  }
  function resetBoard() {
    board.setTargets([]);
    board.reset();
    board.resetView();
    board.setConfig({
      fold: false, back: 4000, ahead: 0, tolCents: cfg.tol ?? 40, nearest: false, maxSamples: 400, position: '1',
    });
    const first = rangeEvents().find((e) => !e.rest);
    showBoardFor(first ? first.idx : 0);
    if (first) board.setTargets([{ t0: -Infinity, t1: Infinity, midi: first.midi }]);
  }

  function drawChips() {
    const s = song();
    const pr = load(PROGRESS_KEY, {})[s.id];
    fill(chips,
      h('span', { class: 'info-chip', text: s.title }),
      h('span', { class: 'info-chip', text: `${s.meter[0]}/${s.meter[1]} · ${tempo()} bpm` }),
      cfg.songRange !== 'all' ? h('span', { class: 'info-chip', text: ranges().find((r) => r[0] === cfg.songRange)?.[1] ?? '' }) : null,
      pr ? h('span', { class: 'info-chip', title: `Melhor resultado: ${Math.round(pr.best * 100)}%`, text: `${'★'.repeat(pr.stars)}${'☆'.repeat(3 - pr.stars)}` }) : null,
    );
  }

  function newView() {
    stop(true);
    finished = null;
    grades = {};
    activeIdx = -1;
    resultBox.replaceChildren();
    holdFill.style.width = '0%';
    setFeedback(['', '']);
    drawChips();
    drawStaff();
    resetBoard();
    badge.set();
    status.textContent = {
      listen: 'Ouça a música com acompanhamento. Os dedos e as notas aparecem na pauta e no braço.',
      follow: 'Guiado: o app espera cada nota e confirma quando estiver afinada. Notas repetidas pedem um novo golpe de arco.',
      timed: 'Tocar junto: o app dá a contagem, toca o acompanhamento e você toca no tempo.',
    }[cfg.songMode];
  }

  // ---- som: acompanhamento e melodia ------------------------------------------------------------------
  /** Agenda cliques e piano do trecho a partir de t0 (segundos do relógio de áudio). */
  function scheduleAccomp(t0, { withClick = true, withPiano = true } = {}) {
    const s = song();
    const [b0, b1] = rangeBars();
    const b = beatMs() / 1000;
    for (let bar = b0; bar <= b1; bar++) {
      const chord = s.harmony[bar];
      for (let k = 0; k < s.barBeats; k++) {
        const at = t0 + ((bar - b0) * s.barBeats + k) * b;
        if (withClick) scheduleClick(at, k === 0);
        if (withPiano && chord) {
          if (k === 0) scheduleFreq(midiHz(48 + chord.root), at, b * 0.95, { bank: 'piano', gain: 0.35, kind: 'accomp' }); // baixo
          else chord.pcs.forEach((pc) => scheduleFreq(midiHz(60 + pc), at, b * 0.9, { bank: 'piano', gain: 0.22, kind: 'accomp' })); // acorde
        }
      }
    }
  }
  const accompFlags = () => ({
    withClick: cfg.songAccomp === 'click' || cfg.songAccomp === 'both',
    withPiano: cfg.songAccomp === 'piano' || cfg.songAccomp === 'both',
  });
  function scheduleMelody(t0) {
    const b = beatMs() / 1000;
    rangeEvents().filter((e) => !e.rest).forEach((e) => scheduleFreq(midiHz(e.midi), t0 + e.startBeat * b, e.beats * b * 0.95, { bank: vbank(), gain: 0.4, kind: 'melody' }));
  }

  // ---- iniciar e parar ------------------------------------------------------------------------------------
  function setRunning(on) {
    btnStart.disabled = on;
    liveCard.classList.toggle('running', on);
    staffCard.classList.toggle('running', on);
    btnStop.disabled = !on;
    btnSkip.hidden = !(on && run?.mode === 'follow');
    btnHear.hidden = !(on && run?.mode === 'follow');
  }
  function stop(silent = false) {
    cancelAnimationFrame(raf);
    clearTimers();
    stopAll();
    if (run?.timer) clearInterval(run.timer);
    run = null;
    holdFill.style.width = '0%';
    setRunning(false);
    badge.set();
    setFeedback(['', '']);
    if (!silent) { status.textContent = 'Parado.'; setActive(-1); resetBoard(); }
  }
  async function start() {
    if (run) return;
    finished = null;
    grades = {};
    resultBox.replaceChildren();
    ctrl?.clear();
    activeIdx = -1;
    if (cfg.songMode === 'listen') startListen();
    else {
      if (!(await ensureMic())) return;
      if (cfg.songMode === 'follow') startFollow(); else startTimed();
    }
  }

  // ---- ouvir ---------------------------------------------------------------------------------------------------
  function startListen() {
    const c = getCtx();
    const lead = 0.3;
    const t0 = c.currentTime + lead;
    const startPerf = performance.now() + lead * 1000;
    scheduleMelody(t0);
    scheduleAccomp(t0, accompFlags());
    const evs = rangeEvents();
    run = { mode: 'listen', startPerf, end: startPerf + (rangeBeats() + 0.6) * beatMs(), evs, shown: -1 };
    setRunning(true);
    status.textContent = '';
    board.setConfig({ ahead: 0 });
    const loop = () => {
      if (!run) return;
      const now = performance.now();
      if (now >= run.end) { stop(true); status.textContent = 'Pronto. Agora tente tocar junto!'; setActive(-1); resetBoard(); return; }
      const beat = (now - run.startPerf) / beatMs();
      let cur = null;
      for (const e of run.evs) { if (!e.rest && e.startBeat <= beat + 1e-6 && beat < e.startBeat + e.beats) { cur = e; break; } }
      if (cur && cur.idx !== run.shown) {
        run.shown = cur.idx;
        setActive(cur.idx);
        board.setTargets([{ t0: -Infinity, t1: Infinity, midi: cur.midi }]);
        badge.set({ name: pitchClassName(cur.midi) && spellMap([cur.pitch]).get(cur.midi), sub: `compasso ${cur.bar + 1}`, state: 'listen', label: '🔊 Ouvindo' });
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
  }

  // ---- guiado: espera cada nota ------------------------------------------------------------------------------
  function startFollow() {
    const notes = rangeEvents().filter((e) => !e.rest);
    run = {
      mode: 'follow', notes, i: 0, results: [], hits: 0, mistakes: 0,
    };
    detector.reset();
    setRunning(true);
    status.textContent = '';
    showTarget();
  }
  function showTarget() {
    const r = run;
    if (!r) return;
    const e = r.notes[r.i];
    r.tracker = new HoldTracker({ tolCents: cfg.tol ?? 40, holdMs: 180, graceMs: 200 });
    r.shownAt = performance.now();
    r.listenFrom = r.shownAt + (r.i ? 150 : 0);
    r.doneAt = null;
    r.errors = 0;
    r.sawOnset = false;
    const prev = r.i ? r.notes[r.i - 1].midi : null;
    r.needOnset = prev != null && Math.abs(prev - e.midi) < 0.6; // nota repetida: só vale com um novo golpe de arco
    holdFill.style.width = '0%';
    holdFill.classList.remove('in');
    setFeedback(['', r.needOnset ? 'Toque a nota de novo…' : 'Toque a nota…']);
    setActive(e.idx);
    board.setTargets([{ t0: -Infinity, t1: Infinity, midi: e.midi }]);
    badge.set({ name: spellMap([e.pitch]).get(e.midi), sub: `nota ${r.i + 1} de ${r.notes.length} · compasso ${e.bar + 1} · dedo ${e.finger}`, state: 'sing', label: '🎻 Toque' });
  }
  function followFrame(out) {
    const r = run;
    if (r.doneAt || out.t < r.listenFrom) return;
    const e = r.notes[r.i];
    const prev = r.i ? r.notes[r.i - 1].midi : null;
    const tol = cfg.tol ?? 40;
    if (out.onset && out.onset.t >= r.shownAt + 60 && Math.abs(centsOff(out.onset.midi, e.midi)) <= tol * 1.5) r.sawOnset = true;
    const cents = out.midi == null ? null : centsOff(out.midi, e.midi);
    const tr = r.tracker.update(out.t, cents);
    holdFill.style.width = `${Math.round(tr.progress * 100)}%`;
    holdFill.classList.toggle('in', tr.inTol);
    if (tr.done && (!r.needOnset || r.sawOnset)) { followSuccess(); return; }
    if (out.midi == null) { setFeedback(['', r.needOnset ? 'Toque a nota de novo…' : 'Toque a nota…']); return; }
    const ringing = prev != null && Math.abs(centsOff(out.midi, prev)) <= 60 && performance.now() - r.shownAt < 1200;
    if (ringing && !r.needOnset) { setFeedback(['', 'Toque a próxima nota…']); return; }
    const c = centsOff(out.midi, e.midi);
    if (Math.abs(c) <= tol) setFeedback(['ok', 'Afinado — segure…']);
    else if (Math.abs(c) > 100) {
      if (out.onset && out.onset.t >= r.shownAt + 250 && !ringing) r.errors++;
      setFeedback(['err', `Você tocou ${pitchClassName(out.midi)} — procure ${spellMap([e.pitch]).get(e.midi)}`]);
    } else setFeedback(['warn', c > 0 ? `Um pouco alto (+${Math.round(c)} cents) ↓` : `Um pouco baixo (${Math.round(c)} cents) ↑`]);
  }
  function followSuccess() {
    const r = run;
    r.doneAt = performance.now();
    const e = r.notes[r.i];
    const clean = r.errors === 0;
    grades[e.idx] = clean ? 'perfect' : 'ok';
    ctrl.setGrades(grades);
    r.results.push(clean ? 'perfect' : 'ok');
    if (clean) r.hits++;
    r.mistakes += r.errors;
    holdFill.style.width = '100%';
    holdFill.classList.add('in');
    feedback.className = `feedback ${clean ? 'ok' : 'warn'}`;
    lastFeedback = 'done';
    replay(feedback, 'bump');
    feedback.textContent = clean ? `✓ ${spellMap([e.pitch]).get(e.midi)}` : `✓ ${spellMap([e.pitch]).get(e.midi)} (depois de ${r.errors} tentativa${r.errors > 1 ? 's' : ''} errada${r.errors > 1 ? 's' : ''})`;
    hit(staff, clean ? 'ok' : 'warn', '', staffCard);
    if (r.i + 1 >= r.notes.length) { later(finishFollow, 600); return; }
    r.i++;
    later(showTarget, 280);
  }
  function skip() {
    const r = run;
    if (!r || r.mode !== 'follow' || r.doneAt) return;
    const e = r.notes[r.i];
    grades[e.idx] = 'none';
    ctrl.setGrades(grades);
    r.results.push('none');
    r.mistakes += r.errors;
    if (r.i + 1 >= r.notes.length) { finishFollow(); return; }
    r.i++;
    showTarget();
  }
  function hearNote() {
    const r = run;
    if (!r || r.mode !== 'follow') return;
    const e = r.notes[r.i];
    stopAll();
    scheduleFreq(midiHz(e.midi), getCtx().currentTime + 0.03, 1.1, { bank: vbank(), gain: 0.45, kind: 'melody' });
  }
  function finishFollow() {
    const r = run;
    if (!r) return;
    clearTimers();
    run = null;
    setRunning(false);
    badge.set();
    setFeedback(['', '']);
    holdFill.style.width = '0%';
    finished = { mode: 'follow' };
    setActive(-1);
    drawStaff();
    const n = r.notes.length;
    const score = r.hits / n;
    status.textContent = `${song().title}: ${r.hits} de ${n} notas de primeira`;
    showResult({ score, total: n, hits: r.hits, lines: [`${r.mistakes} tentativa${r.mistakes === 1 ? '' : 's'} errada${r.mistakes === 1 ? '' : 's'} no caminho`] }, 'free');
  }

  // ---- tocar junto: no tempo ---------------------------------------------------------------------------------
  function startTimed() {
    const c = getCtx();
    const lead = 0.3;
    const b = beatMs();
    const s = song();
    const t0 = c.currentTime + lead;
    const perf0 = performance.now() + lead * 1000;
    // contagem: um compasso de cliques; depois o trecho com o acompanhamento escolhido
    for (let k = 0; k < s.barBeats; k++) scheduleClick(t0 + (k * b) / 1000, k === 0);
    const musicSec = t0 + (s.barBeats * b) / 1000;
    scheduleAccomp(musicSec, accompFlags());
    const startPerf = perf0 + s.barBeats * b;
    const evs = rangeEvents();
    run = {
      mode: 'timed', evs, onsets: [], countStart: perf0, startPerf, end: startPerf + (rangeBeats() + 0.9) * b, shown: -2, shownFinal: -2,
    };
    detector.reset();
    board.reset();
    board.setConfig({ back: 1800, ahead: 3500, nearest: false });
    board.setTargets(evs.filter((e) => !e.rest).map((e) => ({ t0: startPerf + e.startBeat * b, t1: startPerf + (e.startBeat + e.beats) * b, midi: e.midi })));
    setRunning(true);
    status.textContent = '';
    loop();
  }
  const evalNow = (upTo) => evaluateSong({
    events: run.evs, onsets: run.onsets, startMs: run.startPerf, beatMs: beatMs(), tolCents: cfg.tol ?? 40, rigor: cfg.rigor, offsetMs: cfg.offset,
    extraMs: extraTolerance(profile?.saved?.std ?? 0), upTo,
  });
  function loop() {
    if (run?.mode !== 'timed') return;
    const now = performance.now();
    const r = run;
    if (now >= r.end) { finishTimed(); return; }
    const b = beatMs();
    if (now < r.startPerf) {
      const k = Math.floor((now - r.countStart) / b) + 1;
      badge.set({ name: String(Math.max(1, k)), sub: 'contagem', state: 'count', label: 'Prepare-se' });
    } else {
      const beat = (now - r.startPerf) / b;
      let cur = null;
      for (const e of r.evs) { if (!e.rest && e.startBeat <= beat + 1e-6 && beat < e.startBeat + e.beats) { cur = e; break; } }
      // última nota já fechada (passou da hora dela + folga): ganha a cor do resultado
      let lastFinal = -1;
      for (const e of r.evs) { if (!e.rest && now - r.startPerf > (e.startBeat + e.beats) * b + 160 + Math.max(0, cfg.offset)) lastFinal = e.idx; }
      if (cur) badge.set({ name: spellMap([cur.pitch]).get(cur.midi), sub: `compasso ${cur.bar + 1} · dedo ${cur.finger}`, state: 'sing', label: '🎻 Toque!' });
      if ((cur?.idx ?? -1) !== r.shown || lastFinal !== r.shownFinal) {
        r.shown = cur?.idx ?? -1;
        r.shownFinal = lastFinal;
        if (cur) setActive(cur.idx);
        if (lastFinal >= 0) {
          const ev = evalNow(lastFinal);
          ev.results.forEach((x, i) => { if (x) grades[i] = x.grade; });
          ctrl.setGrades(grades);
          const last = ev.results[lastFinal];
          if (last) setFeedback(feedbackFor(last, r.evs.find((e) => e.idx === lastFinal)));
        }
      }
    }
    raf = requestAnimationFrame(loop);
  }
  function feedbackFor(res, e) {
    const name = spellMap([e.pitch]).get(e.midi);
    const ms = res.deltaMs == null ? '' : ` ${res.deltaMs > 0 ? '+' : ''}${Math.round(res.deltaMs)} ms`;
    if (res.grade === 'none') return ['err', `${name}: não ouvi`];
    if (res.grade === 'wrong') return ['err', `${name}: você tocou ${pitchClassName(res.played)}`];
    if (res.grade === 'ok') return ['warn', `${name} certa, mas fora do tempo${ms}`];
    return ['ok', `${name} ✓${ms}`];
  }
  function finishTimed() {
    const r = run;
    cancelAnimationFrame(raf);
    const ev = evalNow(Infinity);
    run = null;
    setRunning(false);
    badge.set();
    setFeedback(['', '']);
    finished = { mode: 'timed', ev };
    grades = {};
    ev.results.forEach((x, i) => { if (x) grades[i] = x.grade; });
    setActive(-1);
    drawStaff();
    const done = ev.results.filter(Boolean);
    const cnt = (fn) => done.filter(fn).length;
    const onTime = cnt((x) => x.grade === 'perfect' || x.grade === 'good');
    const late = cnt((x) => x.grade === 'ok');
    const wrong = cnt((x) => x.grade === 'wrong');
    const none = cnt((x) => x.grade === 'none');
    // compassos para revisar: onde mais notas falharam
    const bad = new Map();
    r.evs.forEach((e) => { const x = ev.results[e.idx]; if (x && (x.grade === 'wrong' || x.grade === 'none')) bad.set(e.bar + 1, (bad.get(e.bar + 1) ?? 0) + 1); });
    const worst = [...bad.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([bar]) => bar).sort((a, b) => a - b);
    status.textContent = `${song().title}: ${Math.round(ev.score * 100)}%`;
    showResult({
      score: ev.score, total: done.length, hits: onTime + late, cats: [[onTime, 'perfect', '✓', 'no tempo'], [late, 'ok', '~', 'fora do tempo'], [wrong, 'miss', '✗', 'outra nota'], [none, 'none', '—', 'sem som']],
      lines: [worst.length ? `Compassos para revisar: ${worst.join(', ')}` : 'Nenhum compasso com erro grave', ev.extra ? `+${ev.extra} toque${ev.extra === 1 ? '' : 's'} extra${ev.extra === 1 ? '' : 's'}` : null],
      med: ev.medianDelta,
    }, 'timed');
  }

  // ---- resultado e progresso --------------------------------------------------------------------------------------
  function showResult(res, kind) {
    const pct = Math.round(res.score * 100);
    const stars = starsFor(res.score);
    const scoreEl = h('div', { class: 'big-score', text: '0%' });
    fill(resultBox,
      h('div', { class: 'score-row' }, scoreEl, h('p', { class: 'score-sub' }, h('b', { text: `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}` }), h('br'), h('span', { text: `${res.hits} de ${res.total} notas certas` }))),
      res.cats ? h('div', { class: 'stack-bar', role: 'img', 'aria-label': 'Distribuição do resultado' }, res.cats.filter((c) => c[0] > 0).map((c) => h('span', { class: `seg ${c[1]}`, style: `flex:${c[0]}`, title: `${c[0]} ${c[3]}` }))) : null,
      res.cats ? h('div', { class: 'legend' }, res.cats.filter((c) => c[0] > 0).map((c) => h('span', { class: `lg ${c[1]}` }, h('i', { text: c[2] }), h('b', { text: c[0] }), ` ${c[3]}`))) : null,
      ...(res.lines ?? []).filter(Boolean).map((t) => h('p', { class: 'hint', text: t })),
      res.med != null && Math.abs(res.med) >= 120 ? h('p', { class: 'hint', text: `Você ${res.med > 0 ? 'atrasa' : 'adianta'} cerca de ${Math.round(Math.abs(res.med))} ms: se for sempre assim, calibre a latência em Ajustes.` }) : null,
      h('p', { class: 'hint', text: 'Cores na pauta: verde certa · âmbar fora do tempo · vermelho errada ou sem som.' }),
    );
    celebrate(scoreEl, pct);
    const pr = load(PROGRESS_KEY, {});
    const old = pr[song().id] ?? { best: 0, stars: 0, plays: 0 };
    pr[song().id] = { best: Math.max(old.best, res.score), stars: Math.max(old.stars, stars), plays: old.plays + 1, last: Date.now() };
    save(PROGRESS_KEY, pr);
    drawChips();
    recordSession({
      mode: 'instrument', kind: kind === 'timed' ? 'timed' : 'free', instr: 'violin', score: res.score, total: res.total, hits: res.hits, scale: song().title, pattern: 'song', bpm: tempo(),
    });
  }

  // ---- microfone → tela ----------------------------------------------------------------------------------------------
  function onFrame(out) {
    if (!run) return;
    if (run.mode === 'follow') followFrame(out);
    else if (run.mode === 'timed' && out.onset) run.onsets.push(out.onset);
  }

  // ---- teclado -----------------------------------------------------------------------------------------------------------
  function onKey(e) {
    if (e.key === 'Escape' && settingsOpen) { toggleDrawer(false); return; }
    if (isFormTarget(e) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.key === 'Enter' && !run) start();
    else if (e.key === 'Escape' && run) stop();
    else if (e.key === ' ' && run?.mode === 'follow') { e.preventDefault(); hearNote(); }
    else if (e.key === 'ArrowRight' && run?.mode === 'follow') skip();
  }
  document.addEventListener('keydown', onKey);

  // ---- opções e ajustes --------------------------------------------------------------------------------------------------
  const tempoSlider = createSlider({
    label: 'Andamento', min: 40, max: 140, step: 2, value: tempo(), compact: true,
    format: (v) => `${v} bpm`, onChange: (v) => update({ songTempo: v }),
  });
  const tempoField = field('Andamento', tempoSlider.el);
  function buildQuick() {
    rows.set(
      [
      field('Música', select(SONGS.map((s) => [s.id, `${s.title} · ${s.pt}`]), cfg.songId, (v) => update({ songId: v, songTempo: 0, songRange: 'all' }))),
      field('Acompanhamento', select(ACCOMP, cfg.songAccomp, (v) => update({ songAccomp: v }))),
      tempoField,
      ],
      [field('Trecho', select(ranges(), cfg.songRange, (v) => update({ songRange: v }))),
        field('Som do violino', select([['violin', 'Solo VSCO'], ['violinSso', 'SSO · vibrato gravado'], ['violinSsoN', 'SSO · vibrato próprio']], vbank(), (v) => { save('pref.violinBank', v); setInstrument(v); loadBank(v); }))],
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
      section('🎼', 'Pauta',
        row('Mostrar o dedo sobre a nota', 'O número do dedo (0 = corda solta), como nos livros de iniciante.', toggle(cfg.songFingers, (v) => update({ songFingers: v }))),
        row('Mostrar o nome das notas', 'Esconda para treinar a leitura sem “colar”.', toggle(cfg.songNames, (v) => update({ songNames: v })))),
      section('🎯', 'Validação',
        row('Tolerância de afinação', 'Quantos cents de erro ainda contam como certo.', segmented([[25, '±25'], [40, '±40'], [50, '±50']], cfg.tol ?? 40, (v) => update({ tol: Number(v) }))),
        row('Rigor do tempo', 'Quão perto do pulso você precisa tocar.', segmented([['easy', 'Leve'], ['normal', 'Normal'], ['hard', 'Exigente']], cfg.rigor, (v) => update({ rigor: v })))),
      section('⏱', 'Latência',
        row('Latência do equipamento', 'Atraso do microfone e do áudio. Fica salvo para este microfone e esta saída de som.', createSlider({
          label: 'Latência', compact: true, min: -100, max: 400, step: 5, value: cfg.offset, mark: 0, format: (v) => `${v > 0 ? '+' : ''}${v} ms`, onChange: (v) => update({ offset: v }),
        }).el),
        row('Calibrar por eco', 'Automático: o app toca sinais pela caixa de som e mede o atraso.', h('button', { class: 'btn', onclick: () => { toggleDrawer(false); openEcho(); } }, '🔊 Calibrar')),
        row('Calibrar tocando', 'Você toca junto com o clique e o app calcula.', h('button', { class: 'btn', onclick: () => { toggleDrawer(false); openCal(); } }, '🎯 Calibrar')),
        row('Áudio e microfone', 'Entrada, nível do sinal, perfis por aparelho e diagnóstico.', h('button', { class: 'btn', onclick: () => { toggleDrawer(false); openAudio(); } }, '🎚 Abrir'))),
      section('🔊', 'Som', h('div', { class: 'set-row stacked' }, instrumentField())),
      ...(awakeSupported() ? [section('📱', 'Tela', row('Manter a tela ligada', 'Evita que o celular apague a tela enquanto você pratica.', toggle(awakeEnabled(), (v) => setAwakeEnabled(v))))] : []),
      h('div', { class: 'set-tips' },
        h('p', { text: '🎧 Use fones: assim o piano e o metrônomo não entram no microfone.' }),
        h('p', { text: '🎻 Música de teste: “Song of the Wind”, canção folclórica (domínio público), escrita para este app.' }),
        h('p', { text: '⌨ Enter começa · Espaço ouve a nota (guiado) · → pula · Esc para.' })),
    );
  }
  function paintTabs() {
    modeTabs.querySelectorAll('.seg-btn').forEach((b) => {
      const on = b.dataset.mode === cfg.songMode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on);
    });
    btnStart.textContent = { listen: '▶ Ouvir a música (Enter)', follow: '▶ Começar (Enter)', timed: '▶ Tocar junto (Enter)' }[cfg.songMode];
    btnSkip.hidden = true;
    btnHear.hidden = true;
  }
  function update(patch) {
    Object.assign(cfg, patch);
    persist();
    if (patch.offset !== undefined && profile) saveProfile(profile.key, { offset: patch.offset });
    if ('songId' in patch || 'songRange' in patch) buildQuick();
    paintTabs();
    buildSettings();
    if ('songTempo' in patch && patch.songTempo === 0) tempoSlider.set?.(tempo());
    newView();
  }

  const resizeObs = new ResizeObserver(() => {
    const w = Math.round(staff.clientWidth);
    if (run || !w || w === lastW) return;
    lastW = w;
    drawStaff();
  });
  let lastW = 0;
  resizeObs.observe(staff);

  setInstrument(vbank());
  drawMic();
  buildQuick();
  paintTabs();
  buildSettings();
  newView();

  return () => {
    focus.destroy();
    stop(true);
    meter.destroy();
    nav.destroy();
    audioPanel?.close();
    calib?.close();
    echo?.close();
    mic.stop();
    board.destroy();
    navigator.mediaDevices?.removeEventListener?.('devicechange', onDevChange);
    document.removeEventListener('keydown', onKey);
    resizeObs.disconnect();
    root.classList.remove('wide');
  };
}
