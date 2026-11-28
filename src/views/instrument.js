// Prática de instrumento (teclado, violino, violão): escalas, terças, quintas e arpejos.
// O microfone escuta o que você toca e valida nota a nota, sem tempo (espera cada nota) ou no tempo do metrônomo.
import { h, field, select, checkbox, isFormTarget } from '../dom.js';
import {
  MAX_ACCIDENTALS, noteName, midiOf, transpose, pitchClassName,
} from '../music/theory.js';
import { SCALE_TYPES, PATTERNS, DIRECTIONS, buildExercise } from '../music/scales.js';
import {
  INSTRUMENT_PROFILES, NoteDetector, evaluateTimed, centsOff, pairCalibration, summarizeTimed, alignScale,
} from '../music/instrument.js';
import { HoldTracker } from '../music/smooth.js';
import { Mic } from '../music/mic.js';
import {
  getCtx, scheduleClick, scheduleNote, stopAll, setInstrument,
} from '../music/audio.js';
import {
  renderExercise, clefFor, FIGURES, FIGURE_BEATS, FIGURE_NAME,
} from '../render/exerciseStaff.js';
import { createPitchGraph } from '../ui/pitchGraph.js';
import { createFingerboard } from '../ui/fingerboard.js';
import { spellMap } from '../music/fingering.js';
import { createTargetBadge, createDots } from '../ui/targetBadge.js';
import { load, save, recordSession } from '../storage.js';
import { hit } from '../ui/fx.js';
import { highlight } from '../theme.js';
import { createFocusMode } from '../ui/focusMode.js';
import { awakeSupported, awakeEnabled, setAwakeEnabled } from '../ui/wake.js';
import { instrumentField } from './singShared.js';
import {
  migrateTonic, pickKeyN, resolveTonic, tonicOptions,
} from '../music/tonic.js';
import { createVolumeControl } from '../ui/volume.js';
import { createSlider, tempoName } from '../ui/slider.js';
import { createMicMeter } from '../ui/micMeter.js';
import { openAudioPanel } from '../ui/audioPanel.js';
import { openEchoCalibration } from '../ui/echoCalibration.js';
import {
  createPracticeBar, createExerciseRows, iconButton, micGroup,
} from '../ui/practiceBar.js';
import { activeProfile, saveProfile, calStats, extraTolerance, clickLeak, leakText } from '../music/audioProfile.js';
import { mountChords, wantsChords, CHORD_DEFAULTS } from './chordPractice.js';
import { mountSong, SONG_DEFAULTS } from './songPractice.js';
import { createPracticeNav } from '../ui/practiceNav.js';

const DEFAULTS = {
  instr: 'piano', mode: 'free', type: 'major', pattern: 'scale', direction: 'up', octaves: 1,
  key: '0', maxAcc: 0, reg: { piano: 4, violin: 3, guitar: 4 }, regVer: 3, showScale: true,
  tol: 40, anyOctave: false, names: true,
  bpm: 60, figure: 'q', position: '1', click: true, clickSub: true, tonicRef: true, rigor: 'normal', offset: 0,
  ...CHORD_DEFAULTS,
  ...SONG_DEFAULTS,
};

// nota certa, mas fora da tolerância de afinação (menos de 1 semitom de erro)
const closeMiss = (r) => r.cents != null && Math.abs(r.cents) < 100;
const sgnC = (c) => `${c > 0 ? '+' : '−'}${Math.abs(Math.round(c))}`;
/** Texto curto sob cada nota da pauta: acerto + desvio de tempo em ms. */
/** Cor da nota na pauta: nota certa mas desafinada ('tune') tem cor própria, distinta de "outra nota". */
const gradeOf = (x) => (x ? (x.grade === 'wrong' && closeMiss(x) ? 'tune' : x.grade) : null);
const resultLabel = (x, dense = false) => {
  if (!x) return null;
  const ms = x.deltaMs == null ? '' : `${x.deltaMs > 0 ? '+' : x.deltaMs < 0 ? '−' : '±'}${Math.abs(Math.round(x.deltaMs))}${dense ? '' : 'ms'}`;
  if (x.grade === 'none') return '✗ —';
  if (x.grade === 'wrong') return closeMiss(x) ? `≈ ${x.cents > 0 ? '+' : '−'}${Math.abs(Math.round(x.cents))}¢` : `✗ ${pitchClassName(x.played)}`;
  return `${x.grade === 'ok' ? '~' : '✓'} ${ms}`;
};
/** Rótulo sob a nota no modo sem tempo: acertou de primeira (com o tempo gasto), errou antes de acertar ou pulou. */
const freeLabel = (it) => {
  if (!it) return null;
  if (it.skipped) return '✗ pulou';
  const secs = `${(it.ms / 1000).toFixed(1).replace('.', ',')}s`;
  return it.errors ? `~ ${it.errors}× ${secs}` : `✓ ${secs}`;
};
const round5 = (x) => Math.round(x / 5) * 5;
const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter(Boolean));
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Número do resultado sobe até o valor final; 100% ganha um "pop" de comemoração. */
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

/** Reinicia uma animação CSS curta (classe) no elemento. */
function replay(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

const REG_VER = 3; // sobe quando o registro padrão de algum instrumento mudar

/** Violino pratica notas; violão e teclado praticam acordes (ou notas soltas, se o aluno preferir). Troca de tela sem recarregar. */
export function mountInstrument(root) {
  let off = null;
  const go = () => {
    off?.();
    root.replaceChildren();
    const cfg = load('cfg.instrument', DEFAULTS);
    if (cfg.instr === 'violin' && cfg.area === 'songs') off = mountSong(root, { defaults: DEFAULTS, remount: go }); // músicas (só violino)
    else off = wantsChords(cfg) ? mountChords(root, { defaults: DEFAULTS, remount: go }) : mountNotes(root, { remount: go });
  };
  go();
  return () => { off?.(); off = null; };
}

function mountNotes(root, { remount }) {
  const cfg = load('cfg.instrument', DEFAULTS);
  const persist = () => save('cfg.instrument', cfg);
  if (migrateTonic(cfg)) persist(); // a tonalidade passou a ser a tônica (Sol + menor = Sol menor), não a armadura
  if (!INSTRUMENT_PROFILES[cfg.instr]) cfg.instr = 'piano';
  // violino: escalas começam na corda Sol solta. A versão precisa ser lida do que está GRAVADO: o load() preenche campos
  // ausentes com os padrões, então cfg.regVer sempre parecia atualizado e quem tinha configuração antiga ficava no registro errado.
  const stored = load('cfg.instrument', null);
  if (!stored || stored.regVer !== REG_VER) {
    cfg.reg = { ...DEFAULTS.reg, ...(cfg.reg || {}), violin: 3 };
    cfg.regVer = REG_VER;
    persist();
  }
  const prof = () => INSTRUMENT_PROFILES[cfg.instr];

  let ex = null; // exercício atual
  let run = null; // execução em andamento
  let finished = null; // avaliação do último exercício
  let raf = 0;
  let timers = [];
  let settingsOpen = false;
  let lastFeedback = '';

  // ---- microfone e detecção -------------------------------------------------------------
  // No violino o braço do instrumento substitui o gráfico de afinação; os dois recebem os mesmos dados
  // e só um fica visível (applyGraphView).
  const gPitch = createPitchGraph({ height: 140 });
  const gBoard = createFingerboard({ position: cfg.position });
  const both = [gPitch, gBoard];
  const graph = {
    el: h('div', { class: 'graph-host' }, gPitch.el, gBoard.el),
    push: (x) => both.forEach((g) => g.push(x)),
    setTargets: (x) => both.forEach((g) => g.setTargets(x)),
    setConfig: (x) => both.forEach((g) => g.setConfig(x)),
    setMarkers: (x) => both.forEach((g) => g.setMarkers(x)),
    setMessage: (x) => both.forEach((g) => g.setMessage(x)),
    setHeight: (x) => gPitch.setHeight(x),
    setNext: (x) => gBoard.setNext(x),
    setScale: (x) => gBoard.setScale(x),
    setNames: (x) => gBoard.setNames(x),
    resetView: () => gBoard.resetView(),
    freeze: () => both.forEach((g) => g.freeze()),
    unfreeze: () => both.forEach((g) => g.unfreeze()),
    reset: () => both.forEach((g) => g.reset()),
    destroy: () => both.forEach((g) => g.destroy()),
  };
  function applyGraphView() {
    const board = cfg.instr === 'violin';
    gBoard.el.hidden = !board;
    gPitch.el.hidden = board;
    gBoard.setConfig({ position: cfg.position });
  }
  applyGraphView();
  const detector = new NoteDetector();
  const mic = new Mic((frame) => {
    const out = detector.update(frame);
    // com metrônomo o gráfico usa a altura crua e já compensa a latência: o que você vê é o que é avaliado
    const rawView = run && run.mode !== 'free';
    const timedView = run?.mode === 'timed'; // só o modo com metrônomo desloca o gráfico pela latência
    if (run?.mode === 'calib' && out.shown != null) run.lastVoiced = performance.now();
    graph.push({ t: out.t - (timedView ? cfg.offset : 0), midi: rawView ? out.shown : out.midi });
    onFrame(out);
  }, prof().mic);

  async function ensureMic() {
    if (!mic.active) {
      try {
        mic.detect = prof().mic;
        await mic.start();
        graph.setMessage('');
        syncProfile();
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

  // ---- áudio: perfil do aparelho (entrada + saída), medidor e painel -----------------------------
  let profile = null;
  let audioPanel = null;
  const meter = createMicMeter(mic, { onClick: () => openAudio(), expectSound: () => !!run && run.mode !== 'calib' && run.mode !== 'listen' });
  async function syncProfile() {
    profile = await activeProfile(mic);
    const saved = profile.saved;
    if (saved && saved.offset !== cfg.offset) { cfg.offset = saved.offset; persist(); buildSettings(); paintTabs(); } // cada aparelho com a sua latência
    meter.setNotice(saved ? '' : 'Sem calibração para este aparelho');
    if (mic.fellBack) graph.setMessage('A entrada escolhida não está disponível: usando a padrão do sistema.');
  }
  mic.onEnded = () => { drawMicButton(); meter.setNotice(''); graph.setMessage('O microfone foi desconectado. Ligue de novo.'); };
  const onDevChange = () => { if (mic.active) syncProfile(); };
  navigator.mediaDevices?.addEventListener?.('devicechange', onDevChange);
  function openAudio() {
    audioPanel = openAudioPanel({
      mic, ensureMic, host: root, getProfile: () => profile,
      restartMic: async () => { mic.stop(); detector.reset(); graph.reset(); await ensureMic(); },
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

  const btnMic = h('button', { class: 'btn', onclick: async () => {
    if (mic.active) {
      mic.stop();
      detector.reset();
      graph.reset();
      drawMicButton();
    } else {
      await ensureMic();
    }
  } });
  function drawMicButton() {
    btnMic.textContent = mic.active ? '🎤 Mic ligado' : '🎤 Ligar mic';
    btnMic.classList.toggle('active', mic.active);
    idleOpen();
  }

  // ---- elementos da tela -----------------------------------------------------------------
  // submenu flutuante: instrumento (lista) e área (violino: Escalas ou Músicas; outros: Acordes ou Notas soltas)
  const nav = createPracticeNav({
    instruments: INSTRUMENT_PROFILES,
    getCfg: () => cfg,
    onInstrument: (id) => update({ instr: id }),
    onArea: (id) => {
      if (cfg.instr === 'violin') { cfg.area = id; persist(); remount(); } else update({ content: id });
    },
  });
  const modeTabs = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Modo' }, [['free', 'Guiado'], ['open', 'Livre'], ['timed', 'Metrônomo']].map(([id, label]) =>
    h('button', { class: 'seg-btn', role: 'tab', 'data-mode': id, onclick: () => update({ mode: id }) }, label)));
  const chips = h('div', { class: 'info-row' });
  const status = h('div', { class: 'status big', 'aria-live': 'polite' });
  const badge = createTargetBadge();
  const dots = createDots();
  const staff = h('div', { class: 'staff wide paper' });
  const holdFill = h('div', { class: 'hold-fill' });
  const hold = h('div', { class: 'hold-bar', role: 'progressbar', 'aria-label': 'Tempo na nota' }, holdFill);
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
  const staffCard = h('section', { class: 'card staff-card' }, chips, staff, graph.el);
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
  const slotMs = () => bMs() * FIGURE_BEATS[cfg.figure];
  const instrIcon = () => prof().icon;
  const nameOf = (i) => (cfg.names || finished ? noteName(ex.notes[i]) : '?');
  const sounding = (p) => transpose(p, prof().transposeOct);

  function setFeedback([kind, text]) {
    const key = `${kind}|${text}`;
    if (key === lastFeedback) return;
    lastFeedback = key;
    feedback.className = `feedback ${kind}`;
    feedback.textContent = text;
    if (kind === 'ok' || kind === 'err') replay(feedback, 'bump');
    if (kind === 'ok' || kind === 'warn' || kind === 'err') hit(staff, kind, kind === 'ok' ? 'Certo' : kind === 'warn' ? 'Quase' : 'Errou', staffCard);
  }

  // ---- exercício -------------------------------------------------------------------------
  function newExercise() {
    stop(true);
    const keyN = pickKeyN(cfg);
    const p = prof();
    const octave = cfg.reg[cfg.instr] ?? p.defOct;
    ex = buildExercise({
      keyN, type: cfg.type, pattern: cfg.pattern, direction: cfg.direction, octaves: cfg.octaves, octave, range: [p.lo, p.hi],
    });
    ex.clef = clefFor(ex.notes, cfg.instr === 'piano');
    staff.scrollTop = 0;
    lastFollow = -1;
    ex.targets = ex.notes.map((n) => midiOf(n) + 12 * p.transposeOct);
    finished = null;
    resultBox.replaceChildren();
    graph.setTargets([]);
    graph.setConfig({
      fold: cfg.anyOctave, back: 4000, ahead: 0, tolCents: cfg.tol, nearest: false, maxSamples: 400,
    });
    graph.unfreeze();
    graph.resetView(); // o braço volta ao zoom inicial e se ajusta às notas do novo exercício
    graph.setMarkers([]);
    applyScaleView();
    graph.setHeight(140);
    if (cfg.mode === 'open') setOpenGraph();
    holdFill.style.width = '0%';
    setFeedback(['', '']);
    drawChips();
    draw();
    status.textContent = {
      free: 'Toque a primeira nota: o app espera cada nota e confirma quando estiver certa.',
      open: 'Prática livre: toque a escala do seu jeito, sem metrônomo e sem pressa. No fim você vê o que acertou.',
      timed: 'O app toca a tônica, dá 4 tempos de contagem e você toca uma nota por pulso.',
    }[cfg.mode];
    armedAt = performance.now() + 600;
    idleOpen();
  }

  /** Guiado e metrônomo: a escala toda (posição e dedos de cada nota) fica no braço; a nota da vez pulsa. */
  function applyScaleView() {
    graph.setNames(ex ? spellMap(ex.notes) : new Map()); // os nomes no braço seguem a pauta (Si♭, não Lá♯)
    graph.setScale(ex && cfg.showScale && cfg.mode !== 'open' ? [...new Set(ex.targets)] : []);
  }

  function drawChips() {
    const n = ex.notes.length;
    chips.replaceChildren(...[
      h('span', { class: 'info-chip', text: ex.name }),
      h('span', { class: 'info-chip', text: PATTERNS[cfg.pattern].label.replace(' (grau a grau)', '') }),
      h('span', { class: 'info-chip', text: `${n} notas` }),
      cfg.mode === 'open' ? h('span', { class: 'info-chip', text: 'prática livre' }) : null,
      cfg.mode === 'timed' ? h('span', { class: 'info-chip', text: `${cfg.bpm} bpm · ${FIGURE_NAME[cfg.figure]}` }) : null,
      cfg.mode === 'timed' && slotMs() < 220 ? h('span', { class: 'info-chip warn-chip', title: 'Notas muito curtas: o microfone pode não separá-las bem', text: '⚠ muito rápido' }) : null,
    ].filter(Boolean));
  }

  let lastFollow = -1;
  function draw(opts = {}) {
    if (!ex) return;
    // redesenhar esvazia a pauta e o navegador zera a rolagem: guarda e devolve a posição, senão ela "pula" a cada nota
    const keep = staff.scrollTop;
    renderExercise(staff, {
      notes: ex.notes, keyN: ex.keyN, clef: ex.clef, figure: cfg.mode === 'timed' ? cfg.figure : 'q',
      names: cfg.names || !!finished, grades: opts.grades || null, active: opts.active ?? -1, labels: opts.labels || null,
    });
    staff.scrollTop = keep;
    const a = opts.active ?? -1;
    if (a < 0) lastFollow = -1;
    else if (a !== lastFollow) { lastFollow = a; followActive(); } // só ao mudar de nota
  }

  /** Pauta longa rola dentro do próprio quadro (o braço fica sempre à vista): leva a nota atual para o meio dela, sem animação. */
  function followActive() {
    const el = staff.querySelector(`[fill="${highlight()}" i], [stroke="${highlight()}" i]`);
    if (!el || staff.scrollHeight <= staff.clientHeight + 2) return;
    const sr = staff.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    if (er.top >= sr.top + 8 && er.bottom <= sr.bottom - 8) return; // já está à vista: não mexe
    staff.scrollTop += (er.top - sr.top) - (staff.clientHeight - er.height) / 2;
  }

  /** Opções de desenho da pauta com o resultado do último exercício (cores + rótulos). */
  function finishedOpts() {
    if (finished?.ev) {
      const dense = cfg.figure === '8' || cfg.figure === '16';
      return { grades: finished.ev.results.map(gradeOf), labels: finished.ev.results.map((x) => resultLabel(x, dense)) };
    }
    if (finished?.al) return { grades: finished.al.results.map((x) => OPEN_GRADE[x.status]), labels: finished.al.results.map(openLabel) };
    if (finished?.items) return { grades: finished.items.map((x) => x.grade), labels: finished.items.map(freeLabel) };
    return {};
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

  // ---- começar / parar -------------------------------------------------------------------
  async function start() {
    if (run) return;
    if (!(await ensureMic())) return;
    if (cfg.mode === 'free') startFree();
    else if (cfg.mode === 'open') startOpen();
    else startTimed('timed');
  }

  function stop(silent = false) {
    cancelAnimationFrame(raf);
    clearTimers();
    stopAll();
    if (run?.timer) clearInterval(run.timer);
    run = null;
    armedAt = performance.now() + 800; // evita reiniciar sozinho com o resto do som
    holdFill.style.width = '0%';
    setRunning(false);
    graph.setTargets([]);
    if (cfg.mode === 'open' && ex) setOpenGraph();
    badge.set();
    dots.clear();
    setFeedback(['', '']);
    if (!silent) {
      status.textContent = 'Parado.';
      draw();
    }
  }

  function listen() {
    if (run?.mode === 'free') {
      stopAll();
      scheduleNote(sounding(ex.notes[run.i]), getCtx().currentTime + 0.03, 1.2);
      return;
    }
    if (!run) {
      if (cfg.mode === 'open') listenOpen();
      else startTimed('listen');
    }
  }

  // ---- sem tempo: espera cada nota -------------------------------------------------------
  function startFree() {
    finished = null;
    resultBox.replaceChildren();
    run = { mode: 'free', i: 0, marks: [], items: [], ms: 0, hits: 0, mistakes: 0 };
    detector.reset();
    setRunning(true);
    status.textContent = '';
    showTarget();
  }

  function showTarget() {
    const r = run;
    if (!r) return;
    r.tracker = new HoldTracker({ tolCents: cfg.tol, holdMs: 180, graceMs: 200 });
    r.shownAt = performance.now();
    r.listenFrom = r.shownAt + (r.i ? 150 : 0);
    r.doneAt = null;
    r.errors = 0;
    r.wrong = null;
    holdFill.style.width = '0%';
    holdFill.classList.remove('in');
    setFeedback(['', 'Toque a nota…']);
    graph.reset();
    graph.setConfig({ fold: cfg.anyOctave, back: 5000, ahead: 0, tolCents: cfg.tol });
    graph.setTargets([{ t0: -Infinity, t1: Infinity, midi: ex.targets[r.i] }]);
    dots.set(ex.notes.length, r.marks, r.i);
    badge.set({
      name: nameOf(r.i), sub: `nota ${r.i + 1} de ${ex.notes.length} · ${ex.name}`, state: 'sing', label: `${instrIcon()} Toque`,
    });
    draw({ grades: r.items.map((x) => x.grade), active: r.i, labels: r.items.map(freeLabel) });
  }

  function describe(out, target, prevTarget) {
    if (out.midi == null) return ['', 'Toque a nota…'];
    if (prevTarget != null && Math.abs(centsOff(out.midi, prevTarget, cfg.anyOctave)) <= 60 && performance.now() - run.shownAt < 1200) {
      return ['', 'Toque a próxima nota…'];
    }
    const c = centsOff(out.midi, target, cfg.anyOctave);
    const rc = Math.round(c);
    if (Math.abs(c) <= cfg.tol) return ['ok', `Afinado (${rc > 0 ? '+' : ''}${rc} cents) — segure…`];
    if (Math.abs(c) > 100) return ['err', `Você tocou ${pitchClassName(out.midi)} — procure ${noteName(ex.notes[run.i])}`];
    return ['warn', c > 0 ? `Um pouco alto (+${rc} cents) ↓` : `Um pouco baixo (${rc} cents) ↑`];
  }

  function freeFrame(out) {
    const r = run;
    if (r.doneAt || out.t < r.listenFrom) return;
    const target = ex.targets[r.i];
    const prevTarget = r.i > 0 ? ex.targets[r.i - 1] : null;
    const cents = out.midi == null ? null : centsOff(out.midi, target, cfg.anyOctave);
    const tr = r.tracker.update(out.t, cents);
    holdFill.style.width = `${Math.round(tr.progress * 100)}%`;
    holdFill.classList.toggle('in', tr.inTol);
    if (tr.done) { freeSuccess(); return; }

    if (out.onset && out.onset.t >= r.shownAt + 250) {
      const oc = centsOff(out.onset.midi, target, cfg.anyOctave);
      const ringing = prevTarget != null && Math.abs(centsOff(out.onset.midi, prevTarget, cfg.anyOctave)) <= 60;
      if (Math.abs(oc) > 60 && !ringing) {
        r.errors++;
        r.wrong = pitchClassName(out.onset.midi);
      }
    }
    setFeedback(describe(out, target, prevTarget));
  }

  function freeSuccess() {
    const r = run;
    r.doneAt = performance.now();
    const ms = r.doneAt - r.shownAt;
    const clean = r.errors === 0;
    r.marks.push(clean ? 'ok' : 'warn');
    r.items.push({ grade: clean ? 'perfect' : 'warn', name: noteName(ex.notes[r.i]), errors: r.errors, ms });
    r.ms += ms;
    r.mistakes += r.errors;
    if (clean) r.hits++;
    dots.set(ex.notes.length, r.marks, r.i + 1);
    holdFill.style.width = '100%';
    holdFill.classList.add('in');
    feedback.className = `feedback ${clean ? 'ok' : 'warn'}`;
    lastFeedback = 'done';
    replay(feedback, 'bump');
    replay(liveCard, clean ? 'flash-ok' : 'flash-warn');
    feedback.textContent = clean ? `✓ ${noteName(ex.notes[r.i])}` : `✓ ${noteName(ex.notes[r.i])} (depois de ${r.errors} tentativa${r.errors > 1 ? 's' : ''} errada${r.errors > 1 ? 's' : ''})`;
    graph.setTargets([{ t0: -Infinity, t1: Infinity, midi: ex.targets[r.i], grade: 'perfect' }]);
    draw({ grades: r.items.map((x) => x.grade), active: -1, labels: r.items.map(freeLabel) });
    if (r.i + 1 >= ex.notes.length) { later(finishFree, 700); return; }
    r.i++;
    later(showTarget, 350);
  }

  function skip() {
    const r = run;
    if (!r || r.mode !== 'free' || r.doneAt) return;
    r.marks.push('skip');
    r.items.push({ grade: 'none', name: noteName(ex.notes[r.i]), errors: r.errors, ms: 0, skipped: true });
    r.mistakes += r.errors;
    if (r.i + 1 >= ex.notes.length) { finishFree(); return; }
    r.i++;
    showTarget();
  }

  function finishFree() {
    const r = run;
    if (!r) return;
    clearTimers();
    run = null;
    setRunning(false);
    graph.setTargets([]);
    badge.set();
    dots.clear();
    holdFill.style.width = '0%';
    setFeedback(['', '']);
    finished = { mode: 'free', items: r.items };
    const n = ex.notes.length;
    const done = r.items.filter((x) => !x.skipped);
    const avg = done.length ? (r.ms / done.length / 1000).toFixed(1) : '—';
    draw({ grades: r.items.map((x) => x.grade), labels: r.items.map(freeLabel) });
    const pct = Math.round((r.hits / n) * 100);
    status.textContent = `${ex.name}: ${r.hits} de ${n} notas de primeira`;
    const scoreEl = h('div', { class: 'big-score', text: '0%' });
    resultBox.replaceChildren(
      h('div', { class: 'score-row' }, scoreEl,
        h('p', { text: `de primeira · ${r.mistakes} nota${r.mistakes === 1 ? '' : 's'} errada${r.mistakes === 1 ? '' : 's'} no caminho · ${avg}s por nota` })),
      h('p', { class: 'hint', text: 'Sob cada nota: ✓ de primeira (tempo gasto) · ~ errou antes de acertar (tentativas erradas) · ✗ pulou.' }),
    );
    celebrate(scoreEl, pct);
    recordSession({
      mode: 'instrument', kind: 'free', instr: cfg.instr, score: r.hits / n, total: n, hits: r.hits, scale: ex.name, pattern: cfg.pattern,
    });
  }

  // ---- com metrônomo ---------------------------------------------------------------------
  function startTimed(mode) {
    stop(true);
    finished = null;
    resultBox.replaceChildren();
    const c = getCtx();
    const lead = 0.25;
    const b = bMs();
    const slot = slotMs();
    const t0 = c.currentTime + lead;
    const perf0 = performance.now() + lead * 1000;
    const n = ex.notes.length;
    const withRef = cfg.tonicRef;
    const refDur = withRef ? 1.2 : 0;
    if (withRef) scheduleNote(sounding(ex.notes[0]), t0, 1.0);
    const countStart = t0 + refDur;
    // subdivisão: em colcheias/semicolcheias o clique marca cada nota (tempos fortes + cliques suaves entre eles)
    const perBeat = cfg.clickSub && FIGURE_BEATS[cfg.figure] < 1 ? Math.round(1 / FIGURE_BEATS[cfg.figure]) : 1;
    const clicks = (startSec, nBeats, limitMs) => {
      for (let k = 0; k < nBeats; k++) {
        for (let q = 0; q < perBeat; q++) {
          const off = k * b + (q * b) / perBeat;
          if (off >= limitMs - 1) return;
          scheduleClick(startSec + off / 1000, k % 4 === 0 && q === 0, q > 0);
        }
      }
    };
    clicks(countStart, 4, 4 * b);
    const noteStart = countStart + (4 * b) / 1000;
    if (mode === 'listen') {
      ex.notes.forEach((p, i) => scheduleNote(sounding(p), noteStart + (i * slot) / 1000, (slot * 0.9) / 1000));
    } else if (cfg.click) {
      const beats = Math.ceil(n * FIGURE_BEATS[cfg.figure] - 1e-9);
      clicks(noteStart, beats, n * slot);
    }
    const startPerf = perf0 + refDur * 1000 + 4 * b;
    run = {
      mode, n, slot, b, onsets: [], countStart: perf0 + refDur * 1000, startPerf, end: startPerf + n * slot + 450,
      shownActive: -2, shownFinal: -2,
    };
    detector.reset();
    graph.reset();
    graph.setConfig({ fold: cfg.anyOctave, back: 1800, ahead: 4200, tolCents: cfg.tol });
    graph.setTargets(ex.targets.map((m, i) => ({ t0: startPerf + i * slot, t1: startPerf + (i + 1) * slot, midi: m })));
    setRunning(true);
    status.textContent = '';
    draw();
    loop();
  }

  const evalNow = (upTo) => evaluateTimed({
    targets: ex.targets, startMs: run.startPerf, slotMs: run.slot, onsets: run.onsets, tolCents: cfg.tol,
    anyOctave: cfg.anyOctave, rigor: cfg.rigor, offsetMs: cfg.offset, upTo, extraMs: extraTolerance(profile?.saved?.std ?? 0),
  });

  // ---- calibração guiada da latência -----------------------------------------------------------
  let calibModal = null;
  let calibUi = null;
  function closeCal() {
    if (run?.mode === 'calib') stop(true);
    calibModal?.remove();
    calibModal = null;
    calibUi = null;
  }
  function openCal() {
    closeCal();
    const body = h('div', { class: 'cal-body' });
    calibModal = h('div', { class: 'modal-scrim', onclick: (e) => { if (e.target === calibModal) closeCal(); } },
      h('div', { class: 'modal card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Calibrar latência' }, body));
    calibModal.body = body;
    root.append(calibModal);
    calIntro();
  }
  const calDots = (n = 8) => Array.from({ length: n }, (_, i) => h('div', { class: 'cal-dot wait' }, h('span', { class: 'cd-n', text: i + 1 }), h('small', { class: 'cd-ms', text: '' })));
  const calSgn = (d) => `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(Math.round(d))} ms`;

  function calIntro() {
    fill(calibModal.body,
      h('h2', { text: '🎯 Calibrar a latência' }),
      h('p', { class: 'hint', text: 'Microfone e caixa de som têm um pequeno atraso. Vou medir o do seu equipamento para o app descontar nas avaliações com metrônomo.' }),
      h('ol', { class: 'cal-steps' },
        h('li', {}, h('b', { text: 'Use fones de ouvido' }), ', para o clique não entrar no microfone.'),
        h('li', {}, h('b', { text: 'Escolha UMA nota fácil' }), ` no ${prof().label.toLowerCase()} e deixe-a pronta.`),
        h('li', {}, 'Vão soar ', h('b', { text: '4 cliques de contagem' }), ' e depois ', h('b', { text: '8 cliques' }), '. Toque a nota ', h('b', { text: 'no instante de cada um dos 8' }), '.'),
      ),
      h('div', { class: 'cal-dots preview' }, calDots()),
      h('div', { class: 'cal-actions' },
        h('button', { class: 'btn primary', onclick: () => startCal() }, mic.active ? '▶ Começar' : '🎤 Ligar o microfone e começar'),
        h('button', { class: 'btn', onclick: () => closeCal() }, 'Cancelar')),
    );
    (calibModal.body.querySelector('.btn.primary') || calibModal.body.querySelector('.btn'))?.focus();
  }

  async function startCal() {
    if (run && run.mode !== 'calib') return;
    if (!(await ensureMic())) { calibModal && fill(calibModal.body, h('h2', { text: 'Microfone indisponível' }), h('p', { class: 'hint', text: 'Permita o microfone no navegador e tente de novo.' }), h('div', { class: 'cal-actions' }, h('button', { class: 'btn', onclick: () => closeCal() }, 'Fechar'))); return; }
    stop(true);
    finished = null;
    const c = getCtx();
    const b = 750;
    const lead = 0.35;
    const t0 = c.currentTime + lead;
    const perf0 = performance.now() + lead * 1000;
    for (let i = 0; i < 12; i++) scheduleClick(t0 + (i * b) / 1000, i === 0 || i === 4);
    run = {
      mode: 'calib', onsets: [], b, countStart: perf0, clicks: Array.from({ length: 8 }, (_, i) => perf0 + (4 + i) * b), end: perf0 + 12 * b + 650, lastVoiced: 0,
    };
    detector.reset();
    graph.reset();
    graph.setConfig({ fold: true, back: 3000, ahead: 0, tolCents: 50 });
    graph.setTargets([]);
    setRunning(true);
    const dots = calDots();
    const head = h('div', { class: 'cal-head', 'aria-live': 'polite' });
    const micEl = h('div', { class: 'cal-mic' }, h('span', { class: 'pulse-dot' }), ' ouvindo você…');
    calibUi = { dots, head, micEl };
    fill(calibModal.body,
      h('h2', { text: 'Toque junto com o clique' }),
      head,
      h('div', { class: 'cal-dots' }, dots),
      micEl,
      h('div', { class: 'cal-actions' }, h('button', { class: 'btn', onclick: () => closeCal() }, 'Cancelar')),
    );
    calLoop();
  }

  function calLoop() {
    if (run?.mode !== 'calib' || !calibUi) return;
    const now = performance.now();
    if (now >= run.end) { finishCal(); return; }
    const k = Math.floor((now - run.countStart) / run.b);
    const { dots, head, micEl } = calibUi;
    if (k < 0) head.textContent = 'Já vai começar…';
    else if (k < 4) head.textContent = `Prepare-se… ${k + 1}`;
    else head.textContent = '🎵 Toque agora, um por clique!';
    head.classList.toggle('go', k >= 4);
    const pr = pairCalibration(run.clicks, run.onsets);
    dots.forEach((d, i) => {
      const click = run.clicks[i];
      const delta = pr.deltas[i];
      let st = 'wait';
      if (delta !== null) st = 'hit';
      else if (now > click + 380) st = 'miss';
      else if (now >= click - 150) st = 'now';
      if (!d.classList.contains(st)) d.className = `cal-dot ${st}`;
      d.querySelector('.cd-ms').textContent = delta !== null ? calSgn(delta) : st === 'miss' ? '—' : '';
    });
    micEl.classList.toggle('on', now - run.lastVoiced < 300);
    raf = requestAnimationFrame(calLoop);
  }

  function finishCal() {
    const r = run;
    cancelAnimationFrame(raf);
    run = null;
    setRunning(false);
    badge.set();
    status.textContent = '';
    if (!calibModal) return;
    const pr = pairCalibration(r.clicks, r.onsets);
    const dots = calDots();
    pr.deltas.forEach((d, i) => {
      dots[i].className = `cal-dot ${d === null ? 'miss' : 'hit'}`;
      dots[i].querySelector('.cd-ms').textContent = d === null ? '—' : calSgn(d);
    });
    if (pr.matched < 5) {
      fill(calibModal.body,
        h('h2', { text: 'Não consegui medir' }),
        h('p', { class: 'hint', text: `Só detectei ${pr.matched} de 8 notas. Toque mais forte, mais perto do microfone, uma nota por clique, e tente de novo.` }),
        h('div', { class: 'cal-dots' }, dots),
        h('div', { class: 'cal-actions' }, h('button', { class: 'btn primary', onclick: () => calIntro() }, '↻ Tentar de novo'), h('button', { class: 'btn', onclick: () => closeCal() }, 'Fechar')));
      return;
    }
    const off = Math.max(-100, Math.min(400, round5(pr.median)));
    const cs = calStats(pr.deltas);
    const stats = { std: cs.std, n: cs.n, source: 'play' };
    const leak = clickLeak([0, 1, 2, 3].map((i) => r.countStart + i * r.b), r.onsets.map((o) => o.t));
    const quality = pr.spread <= 100 ? ['good', 'Medida confiável'] : pr.spread <= 200 ? ['mid', 'Medida razoável'] : ['bad', 'Notas muito espalhadas: repita para ter mais certeza'];
    fill(calibModal.body,
      h('h2', { text: 'Resultado' }),
      h('div', { class: 'cal-result' }, h('div', { class: 'big-score', text: calSgn(off) }), h('span', { class: `chip cal-q ${leak >= 2 ? 'bad' : quality[0]}`, text: leak >= 2 ? 'Clique vazando' : quality[1] })),
      leak >= 2 ? h('p', { class: 'hint', text: leakText(leak) }) : null,
      h('p', { class: 'hint', text: off > 0
        ? `Suas notas chegam cerca de ${off} ms depois do clique (atraso do equipamento + seu tempo). Vou considerá-las ${off} ms mais cedo na avaliação.`
        : off < 0 ? `Suas notas chegam cerca de ${-off} ms antes do clique. Vou considerá-las ${-off} ms mais tarde na avaliação.` : 'Suas notas chegam junto com o clique: não precisa de ajuste.' }),
      h('div', { class: 'cal-dots' }, dots),
      h('div', { class: 'cal-actions' },
        h('button', { class: `btn${leak >= 2 || cs.std > 50 ? '' : ' primary'}`, onclick: () => { update({ offset: off }, false); if (profile) saveProfile(profile.key, { offset: off, ...stats }); closeCal(); } }, leak >= 2 || cs.std > 50 ? `Usar ${calSgn(off)} mesmo assim` : `✓ Usar ${calSgn(off)}`),
        h('button', { class: 'btn', onclick: () => calIntro() }, '↻ Repetir'),
        h('button', { class: 'btn', onclick: () => closeCal() }, 'Fechar')),
    );
    calibModal.body.querySelector('.btn.primary').focus();
  }

  function loop() {
    if (!run) return;
    const now = performance.now();
    if (now >= run.end) { finishTimed(); return; }
    const r = run;
    if (now < r.countStart) {
      badge.set({ name: noteName(ex.notes[0]), sub: 'tônica', state: 'listen', label: '🔊 Ouça a tônica' });
    } else if (now < r.startPerf) {
      const k = Math.floor((now - r.countStart) / r.b) + 1;
      badge.set({ name: String(k), sub: 'contagem', state: 'count', label: 'Prepare-se' });
    } else {
      const i = Math.min(r.n - 1, Math.floor((now - r.startPerf) / r.slot));
      const lastFinal = r.mode === 'timed'
        ? Math.min(r.n - 1, Math.floor((now - r.startPerf - r.slot / 2 - 160 - Math.max(0, cfg.offset)) / r.slot))
        : -1;
      badge.set({
        name: nameOf(i), sub: `nota ${i + 1} de ${r.n}`, state: r.mode === 'timed' ? 'sing' : 'listen',
        label: r.mode === 'timed' ? `${instrIcon()} Toque!` : '🔊 Ouvindo',
      });
      if (i !== r.shownActive || lastFinal !== r.shownFinal) {
        r.shownActive = i;
        r.shownFinal = lastFinal;
        const ev = r.mode === 'timed' && lastFinal >= 0 ? evalNow(lastFinal) : null;
        draw({ active: i, grades: ev ? ev.results.map(gradeOf) : null, labels: ev ? ev.results.map((x) => resultLabel(x, cfg.figure === '8' || cfg.figure === '16')) : null });
        const last = ev && ev.results[lastFinal];
        if (last) setFeedback(timedFeedback(last, lastFinal));
      }
    }
    raf = requestAnimationFrame(loop);
  }

  function timedFeedback(res, i) {
    const name = noteName(ex.notes[i]);
    const ms = res.deltaMs === null ? '' : ` ${res.deltaMs > 0 ? '+' : ''}${Math.round(res.deltaMs)} ms`;
    if (res.grade === 'none') return ['err', `${name}: não ouvi`];
    if (res.grade === 'wrong') return ['err', closeMiss(res) ? `${name}: afinação ${sgnC(res.cents)} cents` : `${name}: você tocou ${pitchClassName(res.played)}`];
    if (res.grade === 'ok') return ['warn', `${name} certa, mas fora do tempo${ms}`];
    return ['ok', `${name} ✓${ms}`];
  }

  function finishTimed() {
    const r = run;
    cancelAnimationFrame(raf);
    run = null;
    setRunning(false);
    graph.setTargets([]);
    badge.set();
    if (r.mode === 'listen') {
      status.textContent = 'Agora é com você: toque “Tocar no tempo”.';
      draw();
      return;
    }
    run = r; // evalNow lê o run
    const ev = evalNow(Infinity);
    run = null;
    finished = { mode: 'timed', ev };
    setFeedback(['', '']);
    draw({ grades: ev.results.map(gradeOf), labels: ev.results.map((x) => resultLabel(x, cfg.figure === '8' || cfg.figure === '16')) });
    const pct = Math.round(ev.score * 100);
    status.textContent = `${ex.name}: ${pct}%`;

    const med = ev.medianDelta;
    const consistentTiming = ev.matched >= 4 && Math.abs(med) >= 25;
    const cents = ev.meanCents;
    const sm = summarizeTimed(ev);
    const scoreEl = h('div', { class: 'big-score', text: '0%' });
    const pl = (n, one, many) => (n === 1 ? one : many);
    const cats = [
      { n: sm.onTime, cls: 'perfect', icon: '✓', text: 'no tempo', tip: 'Nota certa e dentro da janela de tempo.' },
      { n: sm.late, cls: 'ok', icon: '~', text: 'fora do tempo', tip: 'Nota certa, mas adiantada ou atrasada demais.' },
      { n: sm.offTune, cls: 'tune', icon: '≈', text: pl(sm.offTune, 'desafinada', 'desafinadas'), tip: 'Era a nota certa, mas fora da tolerância de afinação.' },
      { n: sm.wrong, cls: 'miss', icon: '✗', text: pl(sm.wrong, 'outra nota', 'outras notas'), tip: 'Você tocou uma nota diferente da pauta.' },
      { n: sm.none, cls: 'none', icon: '—', text: pl(sm.none, 'sem nota', 'sem notas'), tip: 'Nenhuma nota foi detectada nesse tempo.' },
    ].filter((c) => c.n > 0); // categorias vazias não aparecem
    const timeTile = Math.abs(med) < 25
      ? ['ok', '⏱', 'Tempo', 'no ponto']
      : ['warn', '⏱', 'Tempo', `${med > 0 ? 'atrasa' : 'adianta'} ~${Math.round(Math.abs(med))} ms`];
    const tuneTile = ev.matched && Math.abs(cents) >= 12
      ? ['warn', '🎯', 'Afinação', `${cents > 0 ? 'alta' : 'baixa'} ~${Math.round(Math.abs(cents))}¢`]
      : ['ok', '🎯', 'Afinação', ev.matched ? 'centrada' : '—'];
    fill(resultBox,
      h('div', { class: 'score-row' }, scoreEl,
        h('p', { class: 'score-sub' }, h('b', { text: `${sm.rightNotes} de ${sm.total}` }), ` ${pl(sm.rightNotes, 'nota certa', 'notas certas')}`,
          h('br'), h('span', { text: `${sm.onTime} no tempo` }))),
      h('div', { class: 'stack-bar', role: 'img', 'aria-label': 'Distribuição do resultado' }, cats.map((c) => h('span', {
        class: `seg ${c.cls}`, style: `flex:${c.n}`, title: `${c.n} ${c.text}`,
      }))),
      h('div', { class: 'legend' }, cats.map((c) => h('span', { class: `lg ${c.cls}`, title: c.tip }, h('i', { text: c.icon }), h('b', { text: c.n }), ` ${c.text}`))),
      sm.extra
        ? h('p', { class: 'extra-note', title: 'Toques sem nota correspondente na pauta' },
          h('b', { text: `+${sm.extra} ${pl(sm.extra, 'toque extra', 'toques extras')}` }),
          ' sem nota na pauta: repetição, ruído ou nota fora do tempo.')
        : null,
      h('div', { class: 'tiles' }, [timeTile, tuneTile].map(([k, ic, name, val]) => h('div', { class: `tile ${k}` }, h('span', { class: 't-ic', text: ic }), h('small', { text: name }), h('b', { text: val })))),
      consistentTiming
        ? h('div', { class: 'calib-box' },
          h('p', { class: 'hint', text: 'Se você sempre erra para o mesmo lado, pode ser o atraso do microfone/áudio do seu equipamento, não o seu tempo.' }),
          h('button', { class: 'btn', onclick: () => {
            update({ offset: Math.max(-100, Math.min(400, round5(cfg.offset + med))) }, false);
            resultBox.querySelector('.calib-box')?.replaceChildren(h('p', { class: 'hint', text: `✓ Ajuste de ${cfg.offset} ms aplicado. Tente de novo.` }));
          } }, `⚙ Compensar ${Math.round(Math.abs(med))} ms (${med > 0 ? 'você atrasa' : 'você adianta'})`),
        )
        : null,
      h('p', { class: 'hint', text: 'Sob cada nota: ✓ no tempo · ~ fora do tempo · ≈ desafinada (cents) · ✗ outra nota ou nada. Em ms: − adiantou, + atrasou.' }),
    );
    celebrate(scoreEl, pct);
    recordSession({
      mode: 'instrument', kind: 'timed', instr: cfg.instr, score: ev.score, total: ex.notes.length, scale: ex.name, pattern: cfg.pattern, bpm: cfg.bpm, figure: cfg.figure,
    });
  }

  // ---- prática livre: toque a escala do seu jeito e veja o resultado no fim ---------------------
  const OPEN_GRADE = { ok: 'perfect', tune: 'tune', wrong: 'wrong', miss: 'none' };
  const OPEN_MARKER = { ok: 'ok', tune: '#a855f7', wrong: 'err', extra: 'muted' };

  function openLabel(r) {
    if (!r || r.status === 'miss') return r ? '✗ —' : null;
    if (r.status === 'wrong') return `✗ ${pitchClassName(r.played)}`;
    return `${r.status === 'ok' ? '✓' : '≈'} ${sgnC(r.cents)}¢`;
  }

  /** Gráfico em modo livre: todas as notas da escala viram faixas fixas e o gráfico fica mais alto. */
  function setOpenGraph() {
    const uniq = [...new Set(ex.targets)];
    graph.setConfig({
      fold: cfg.anyOctave, back: 14000, ahead: 0, tolCents: cfg.tol, nearest: true, maxSamples: 2400,
    });
    graph.setTargets(uniq.map((midi) => ({ t0: -Infinity, t1: Infinity, midi })));
    // altura proporcional ao tamanho da escala (≈14 px por semitom): 2 oitavas ficam legíveis
    const span = Math.max(...ex.targets) - Math.min(...ex.targets) + 3;
    graph.setHeight(Math.round(Math.min(400, Math.max(230, span * 14))));
  }

  /** Marcadores do gráfico; a nota desafinada leva o nome da nota da escala (não o semitom mais próximo). */
  function openMarkers(onsets, al) {
    return onsets.map((o, j) => {
      const st = al.playedStatus[j];
      const i = st === 'tune' ? al.results.findIndex((x) => x.played === o.midi) : -1;
      return {
        t: o.t, midi: o.midi, label: i >= 0 ? noteName(ex.notes[i]) : pitchClassName(o.midi), color: OPEN_MARKER[st], extra: st === 'extra',
      };
    });
  }

  function openAlign(onsets) {
    return alignScale(ex.targets, onsets, { tol: cfg.tol, anyOctave: cfg.anyOctave });
  }

  // A prática livre começa sozinha: com o microfone ligado, a primeira nota que o app ouvir inicia a sessão.
  let armedAt = 0; // ignora notas antes disso (eco do som do próprio app, troca de tela)
  const canAutoStart = () => cfg.mode === 'open' && !run && !finished && mic.active && performance.now() >= armedAt && ex;
  function idleOpen() {
    if (cfg.mode !== 'open' || run || finished || !ex) return;
    badge.set({
      name: noteName(ex.notes[0]), sub: mic.active ? 'toque para começar' : 'ligue o microfone', state: 'listen', label: mic.active ? '🎤 Ouvindo você' : '🎤 Microfone desligado',
    });
    status.textContent = mic.active
      ? 'É só tocar: a prática começa sozinha na primeira nota que o app ouvir. Toque a escala do seu jeito, sem metrônomo.'
      : 'Ligue o microfone (botão acima): depois é só tocar, e a prática começa sozinha.';
  }

  function startOpen(auto = false) {
    finished = null;
    resultBox.replaceChildren();
    run = {
      mode: 'open', onsets: [], lastAt: performance.now(), startedAt: performance.now(), complete: false,
    };
    badge.set();
    if (!auto) { // início automático: a primeira nota já está soando; não reiniciar o detector (viraria uma nota repetida)
      detector.reset();
      graph.reset();
    }
    setOpenGraph();
    setRunning(true);
    status.textContent = 'Toque a escala do seu jeito, no seu ritmo. Ao completar, o app avisa; ou toque “Terminar”.';
    setFeedback(['', 'Pode começar…']);
    badge.set({
      name: noteName(ex.notes[0]), sub: 'primeira nota', state: 'sing', label: `${instrIcon()} Toque livremente`,
    });
    draw({ active: 0 });
    run.timer = setInterval(openTick, 250);
  }

  function liveOpen() {
    const r = run;
    const al = openAlign(r.onsets);
    let lastMatched = -1;
    al.results.forEach((x, i) => { if (x.status !== 'miss') lastMatched = i; });
    const next = Math.min(ex.notes.length - 1, lastMatched + 1);
    const grades = al.results.map((x, i) => (i <= lastMatched ? OPEN_GRADE[x.status] : null));
    const labels = al.results.map((x, i) => (i <= lastMatched ? openLabel(x) : null));
    draw({ active: lastMatched + 1 < ex.notes.length ? next : -1, grades, labels });
    graph.setNext(lastMatched + 1 < ex.notes.length ? ex.targets[next] : null); // destaca no braço a próxima nota da escala
    graph.setMarkers(openMarkers(r.onsets, al));
    r.complete = al.results.every((x) => x.status === 'ok' || x.status === 'tune');
    // comentário sobre a última nota tocada
    const j = r.onsets.length - 1;
    const st = al.playedStatus[j];
    const o = r.onsets[j];
    const expectedNow = ex.notes[next];
    if (st === 'ok') setFeedback(['ok', `✓ ${pitchClassName(o.midi)} certa`]);
    else if (st === 'tune') {
      const i = al.results.findIndex((x) => x.played === o.midi);
      const c = i >= 0 ? al.results[i].cents : 0;
      setFeedback(['warn', `${pitchClassName(o.midi)}: ${c > 0 ? 'um pouco alta' : 'um pouco baixa'} (${sgnC(c)}¢)`]);
    } else if (st === 'wrong') setFeedback(['err', `Você tocou ${pitchClassName(o.midi)}; a escala pede ${noteName(expectedNow)}`]);
    else setFeedback(['warn', 'Nota a mais (repetida ou fora da escala)']);
    badge.set(lastMatched + 1 < ex.notes.length
      ? { name: noteName(expectedNow), sub: `próxima · ${lastMatched + 1} de ${ex.notes.length} tocadas`, state: 'sing', label: `${instrIcon()} Toque livremente` }
      : { name: '✓', sub: 'escala completa', state: 'ok', label: 'Terminou?' });
  }

  function openTick() {
    if (run?.mode !== 'open') return;
    if (run.complete && performance.now() - run.lastAt > 2500) finishOpen();
  }

  function finishOpen() {
    const r = run;
    if (r?.mode !== 'open') return;
    clearInterval(r.timer);
    run = null;
    setRunning(false);
    badge.set();
    setFeedback(['', '']);
    const al = openAlign(r.onsets);
    const n = ex.notes.length;
    const count = (s) => al.results.filter((x) => x.status === s).length;
    const ok = count('ok');
    const tune = count('tune');
    const wrong = count('wrong');
    const miss = count('miss');
    finished = { mode: 'open', al };
    graph.setNext(null);
    draw({ grades: al.results.map((x) => OPEN_GRADE[x.status]), labels: al.results.map(openLabel) });
    graph.setMarkers(openMarkers(r.onsets, al));
    graph.setConfig({ back: Math.min(60000, Math.max(14000, performance.now() - r.startedAt + 1500)) });
    graph.freeze(); // o gráfico para: dá para rever cada nota tocada
    const score = (ok + 0.6 * tune) / n;
    const pct = Math.round(score * 100);
    const pl = (k, one, many) => (k === 1 ? one : many);
    let verdict;
    if (ok === n) verdict = '🎉 Escala completa e afinada!';
    else if (wrong === 0 && miss === 0) verdict = `Escala completa, com ${tune} ${pl(tune, 'nota desafinada', 'notas desafinadas')}.`;
    else if (wrong === 0) verdict = `Faltaram ${miss} ${pl(miss, 'nota', 'notas')} da escala.`;
    else verdict = `${wrong} ${pl(wrong, 'nota saiu', 'notas saíram')} diferente${wrong === 1 ? '' : 's'} da escala.`;
    status.textContent = `${ex.name}: ${verdict}`;
    const cats = [
      { n: ok, cls: 'perfect', icon: '✓', text: pl(ok, 'certa e afinada', 'certas e afinadas'), tip: 'Nota certa, dentro da tolerância de afinação.' },
      { n: tune, cls: 'tune', icon: '≈', text: pl(tune, 'desafinada', 'desafinadas'), tip: 'Era a nota certa, mas fora da tolerância.' },
      { n: wrong, cls: 'miss', icon: '✗', text: pl(wrong, 'outra nota', 'outras notas'), tip: 'Você tocou uma nota diferente da escala.' },
      { n: miss, cls: 'none', icon: '—', text: pl(miss, 'não tocada', 'não tocadas'), tip: 'Esta nota da escala não foi tocada.' },
    ].filter((c) => c.n > 0);
    const played = al.results.filter((x) => x.cents != null && (x.status === 'ok' || x.status === 'tune'));
    const meanC = played.length ? played.reduce((s, x) => s + x.cents, 0) / played.length : 0;
    const meanAbs = played.length ? played.reduce((s, x) => s + Math.abs(x.cents), 0) / played.length : 0;
    const scoreEl = h('div', { class: 'big-score', text: '0%' });
    fill(resultBox,
      h('div', { class: 'score-row' }, scoreEl,
        h('p', { class: 'score-sub' }, h('b', { text: verdict }), h('br'), h('span', { text: `${ok + tune} de ${n} ${pl(ok + tune, 'nota tocada', 'notas tocadas')}` }))),
      h('div', { class: 'stack-bar', role: 'img', 'aria-label': 'Distribuição do resultado' }, cats.map((c) => h('span', { class: `seg ${c.cls}`, style: `flex:${c.n}`, title: `${c.n} ${c.text}` }))),
      h('div', { class: 'legend' }, cats.map((c) => h('span', { class: `lg ${c.cls}`, title: c.tip }, h('i', { text: c.icon }), h('b', { text: c.n }), ` ${c.text}`))),
      al.extras
        ? h('p', { class: 'extra-note' }, h('b', { text: `+${al.extras} ${pl(al.extras, 'nota a mais', 'notas a mais')}` }), ' (repetidas ou fora da escala). Não contam como erro.')
        : null,
      h('div', { class: 'tiles' },
        h('div', { class: `tile ${meanAbs <= cfg.tol / 2 ? 'ok' : 'warn'}` }, h('span', { class: 't-ic', text: '🎯' }), h('small', { text: 'Afinação média' }), h('b', { text: played.length ? `±${Math.round(meanAbs)}¢${Math.abs(meanC) >= 12 ? (meanC > 0 ? ' · alta' : ' · baixa') : ''}` : '—' })),
        h('div', { class: 'tile ok' }, h('span', { class: 't-ic', text: '🎼' }), h('small', { text: 'Notas tocadas' }), h('b', { text: `${r.onsets.length}` }))),
      h('p', { class: 'hint', text: 'Sob cada nota: ✓ certa (desvio em cents) · ≈ desafinada · ✗ outra nota ou não tocada. No gráfico, cada bolinha é uma nota que você tocou.' }),
    );
    celebrate(scoreEl, pct);
    recordSession({
      mode: 'instrument', kind: 'open', instr: cfg.instr, score, total: n, hits: ok, scale: ex.name, pattern: cfg.pattern,
    });
  }

  /** Ouvir a escala (sem clique): cada nota 0,65 s, destacando na pauta. */
  function listenOpen() {
    stop(true);
    run = { mode: 'hear' };
    setRunning(true);
    const c = getCtx();
    const step = 0.65;
    const t0 = c.currentTime + 0.15;
    ex.notes.forEach((p, i) => {
      scheduleNote(sounding(p), t0 + i * step, step * 0.95);
      later(() => draw({ active: i }), 150 + i * step * 1000);
    });
    later(() => { run = null; setRunning(false); draw(); armedAt = performance.now() + 1200; idleOpen(); }, 150 + ex.notes.length * step * 1000 + 300);
  }

  function onFrame(out) {
    if (!run) {
      if (out.onset && canAutoStart()) {
        startOpen(true);
        run.onsets.push(out.onset);
        run.lastAt = performance.now();
        liveOpen();
      }
      return;
    }
    if (run.mode === 'free') freeFrame(out);
    else if (run.mode === 'open') {
      if (out.onset) { run.onsets.push(out.onset); run.lastAt = performance.now(); liveOpen(); }
    }
    else if ((run.mode === 'timed' || run.mode === 'calib') && out.onset) run.onsets.push(out.onset);
  }

  // ---- teclado e configurações -----------------------------------------------------------
  function onKey(e) {
    if (e.key === 'Escape' && calibModal) { closeCal(); return; }
    if (e.key === 'Escape' && settingsOpen) { toggleDrawer(false); return; }
    if (isFormTarget(e) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.key === 'Enter' && run?.mode === 'open') finishOpen();
    else if (e.key === 'Enter' && !run) start();
    else if (e.key === 'Escape' && run) stop();
    else if (e.key === ' ' && run?.mode === 'free') { e.preventDefault(); listen(); }
    else if (e.key === 'ArrowRight' && run?.mode === 'free') skip();
  }
  document.addEventListener('keydown', onKey);

  const regLabel = (o) => (cfg.instr === 'violin'
    ? { 3: 'Grave (a partir do Sol da corda solta)', 4: 'Média (a partir do Sol da corda Ré)', 5: 'Aguda' }[o]
    : `Oitava ${o}${o === 4 ? ' (central)' : ''}`);

  // seletores rápidos, sempre à vista (não são recriados a cada mudança: o foco do teclado não se perde)
  const bpmSlider = createSlider({
    label: 'Andamento', min: 40, max: 140, step: 2, value: cfg.bpm, compact: true,
    format: (v) => `${v} bpm`, onChange: (v) => update({ bpm: v }, false),
  });
  const bpmField = field('Andamento', bpmSlider.el);
  const btnCal = h('button', { class: 'btn cal-btn', onclick: () => openCal() });
  const figField = field('Figura (metrônomo)', select(FIGURES, cfg.figure, (v) => update({ figure: v })));
  function buildQuick() {
    rows.set(
      [
        field('Tonalidade', select([['auto', 'Sorteada'], ...tonicOptions(cfg.type)], cfg.tonic, (v) => update({ tonic: v }))),
        field('Escala', select(Object.entries(SCALE_TYPES).map(([k, v]) => [k, v.label]), cfg.type, (v) => update({ type: v }))),
        bpmField,
      ],
      [
      field('Padrão', select(Object.entries(PATTERNS).map(([k, v]) => [k, v.label.replace(' (grau a grau)', '')]), cfg.pattern, (v) => update({ pattern: v }))),
      field('Direção', select(Object.entries(DIRECTIONS), cfg.direction, (v) => update({ direction: v }))),
      field('Oitavas', select([[1, '1 oitava'], [2, '2 oitavas']], cfg.octaves, (v) => update({ octaves: Number(v) }))),
      figField,
      ],
    );
  }

  // componentes da gaveta: seções, linhas com explicação, interruptores e botões segmentados
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
    const p = prof();
    drawerBody.replaceChildren(
      section('🎼', 'Exercício',
        cfg.instr !== 'violin'
          ? row('O que praticar', 'Acordes (escala harmonizada e progressões) ou notas soltas, uma por vez.', segmented([['chords', 'Acordes'], ['notes', 'Notas soltas']], cfg.content, (v) => update({ content: v })))
          : null,
        cfg.instr === 'violin'
          ? row('Posição do braço', 'Digitação sugerida que aparece no braço do violino: 1ª posição (a mais comum) ou 3ª.', segmented([['1', '1ª posição'], ['3', '3ª posição']], cfg.position, (v) => update({ position: v }, false)))
          : null,
        cfg.instr === 'violin'
          ? row('Escala toda no braço', 'Guiado e metrônomo: mostra a posição e o dedo de todas as notas da escala, e a nota da vez pulsa (muda de cor conforme a hora de tocar). Desligado: só a nota atual.', toggle(cfg.showScale, (v) => { cfg.showScale = v; persist(); applyScaleView(); }))
          : null,
        row('Mostrar nomes das notas', 'Esconda para treinar leitura sem “colar”.', toggle(cfg.names, (v) => update({ names: v }, false))),
        row(`Registro do ${p.label.toLowerCase()}`, 'Em que oitava a escala começa.', select(p.octaves.map((o) => [o, regLabel(o)]), cfg.reg[cfg.instr] ?? p.defOct, (v) => update({ reg: { ...cfg.reg, [cfg.instr]: Number(v) } }))),
        row('Tonalidade sorteada', 'Quando a tonalidade está em “Sorteada”: máximo de sustenidos/bemóis.', select(
          Array.from({ length: MAX_ACCIDENTALS + 1 }, (_, n) => [n, n === 0 ? 'Só Dó maior / Lá menor' : `Até ${n} alterações`]),
          cfg.maxAcc, (v) => update({ maxAcc: Number(v) }))),
      ),
      section('🎯', 'Validação',
        row('Tolerância de afinação', 'Quantos cents de erro ainda contam como certo (1 semitom = 100 cents).',
          segmented([[25, '±25'], [40, '±40'], [50, '±50']], cfg.tol, (v) => update({ tol: Number(v) }, false))),
        row('Aceitar qualquer oitava', 'A nota certa vale em qualquer oitava. Útil se o microfone confunde a oitava.', toggle(cfg.anyOctave, (v) => update({ anyOctave: v }, false))),
      ),
      section('⏱', 'Metrônomo',
        row('Rigor do tempo', 'Quão perto do pulso você precisa tocar.', segmented([['easy', 'Leve'], ['normal', 'Normal'], ['hard', 'Exigente']], cfg.rigor, (v) => update({ rigor: v }, false))),
        row('Clique do metrônomo', null, toggle(cfg.click, (v) => update({ click: v }, false))),
        row('Clicar em cada nota', 'Em colcheias e semicolcheias o clique marca todas as notas (tempos fortes e cliques suaves entre eles), em vez de só um por tempo.', toggle(cfg.clickSub, (v) => update({ clickSub: v }, false))),
        row('Tocar a tônica antes da contagem', 'Referência do tom para você começar afinado.', toggle(cfg.tonicRef, (v) => update({ tonicRef: v }, false))),
        row('Latência do equipamento', 'Atraso do microfone e do áudio. Se o app diz que você “atrasa ~100 ms”, coloque 100.', createSlider({
          label: 'Latência', compact: true, min: -100, max: 400, step: 5, value: cfg.offset, mark: 0,
          format: (v) => `${v > 0 ? '+' : ''}${v} ms`, onChange: (v) => update({ offset: v }, false),
        }).el),
        row('Medir a latência', 'Assistente passo a passo: você toca no clique e o app calcula. O valor fica salvo para este microfone e esta saída de som.',
          h('button', { class: 'btn', onclick: () => { toggleDrawer(false); openCal(); } }, '🎯 Calibrar')),
        row('Calibrar por eco', 'Automático: o app toca sinais pela caixa de som e mede o atraso, sem você tocar. Não funciona com fones fechados.',
          h('button', { class: 'btn', onclick: () => { toggleDrawer(false); openEcho(); } }, '🔊 Calibrar')),
        row('Áudio e microfone', 'Escolher a entrada, ver o nível do sinal, perfis por aparelho e relatório de diagnóstico.',
          h('button', { class: 'btn', onclick: () => { toggleDrawer(false); openAudio(); } }, '🎚 Abrir')),
      ),
      section('🔊', 'Som', h('div', { class: 'set-row stacked' }, instrumentField())),
      ...(awakeSupported()
        ? [section('📱', 'Tela', row('Manter a tela ligada', 'Evita que o celular apague a tela enquanto você pratica (vale para todas as abas de prática).', toggle(awakeEnabled(), (v) => setAwakeEnabled(v))))]
        : []),
      h('div', { class: 'set-tips' },
        h('p', { text: '🎧 Use fones: assim a referência e o clique não entram no microfone.' }),
        h('p', { text: '🎸 Violão: a pauta é escrita uma oitava acima do que soa.' }),
        h('p', { text: '🎤 O microfone ouve uma nota por vez (sem acordes).' }),
        h('p', { text: '⌨ Sem tempo: Enter começa · Espaço ouve a nota · → pula · Esc para.' }),
      ),
    );
  }

  function paintTabs() {
    nav.paint();
    modeTabs.querySelectorAll('.seg-btn').forEach((b) => {
      const on = b.dataset.mode === cfg.mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on);
    });
    btnStart.textContent = { free: '▶ Começar (Enter)', open: '▶ Começar a tocar (Enter)', timed: '▶ Tocar no tempo (Enter)' }[cfg.mode];
    btnStop.textContent = cfg.mode === 'open' ? '✓ Terminar' : '■ Parar';
    btnSkip.hidden = true;
    bpmField.hidden = cfg.mode !== 'timed';
    figField.hidden = cfg.mode !== 'timed';
    btnCal.textContent = `🎯 Calibrar latência (${cfg.offset > 0 ? '+' : ''}${cfg.offset} ms)`;
  }

  function update(patchIn, regenerate = true) {
    let patch = patchIn;
    // trocar o tipo de escala mantém a tônica (Sol maior → Sol menor); se ela não existir no tipo novo, usa a vizinha
    if (patch.type && cfg.tonic !== 'auto') patch = { ...patch, tonic: String(resolveTonic(Number(cfg.tonic), patch.type)) };
    const modeChanged = patch.mode && patch.mode !== cfg.mode;
    Object.assign(cfg, patch);
    if (patch.instr || patch.position) applyGraphView();
    if (patch.instr) setInstrument(patch.instr); // o som acompanha o instrumento (dá para trocar em Ajustes › Som)
    mic.detect = prof().mic;
    persist();
    if ((patch.instr || patch.content) && wantsChords(cfg)) { remount(); return; } // violão/teclado voltam para os acordes
    if (patch.offset !== undefined && profile) saveProfile(profile.key, { offset: patch.offset }); // vale para este aparelho
    if (patch.type !== undefined || patch.tonic !== undefined) buildQuick(); // a lista de tônicas muda com o tipo de escala
    paintTabs();
    buildSettings();
    if (regenerate || modeChanged) newExercise();
    else if (ex && !run) { drawChips(); draw(finishedOpts()); }
    if (modeChanged && cfg.mode === 'open') ensureMic();
  }

  let lastW = 0;
  const resizeObs = new ResizeObserver(() => {
    const w = Math.round(staff.clientWidth);
    if (!ex || run || !w || w === lastW) return;
    lastW = w;
    draw(finishedOpts());
  });
  resizeObs.observe(staff);

  drawMicButton();
  graph.setMessage('Use fones de ouvido para a referência e o metrônomo não entrarem no microfone.');
  buildQuick();
  paintTabs();
  buildSettings();
  newExercise();
  if (cfg.mode === 'open') ensureMic();

  return () => {
    focus.destroy();
    stop(true);
    meter.destroy();
    nav.destroy();
    audioPanel?.close();
    echo?.close();
    navigator.mediaDevices?.removeEventListener?.('devicechange', onDevChange);
    calibModal?.remove();
    mic.stop();
    graph.destroy();
    document.removeEventListener('keydown', onKey);
    resizeObs.disconnect();
    root.classList.remove('wide');
  };
}
