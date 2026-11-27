// Nota única: aparece uma nota, o app toca, você canta e ele confirma quando você a sustenta afinado.
import { h, field, select, isFormTarget } from '../dom.js';
import { MAX_ACCIDENTALS, keyLabel, noteName, midiOf, pitchClassName, transpose } from '../music/theory.js';
import { generateNote, foldCents } from '../music/melody.js';
import { HoldTracker } from '../music/smooth.js';
import { renderNote } from '../render/staff.js';
import { getCtx, scheduleNote, stopAll } from '../music/audio.js';
import { recordSession } from '../storage.js';
import { hit } from '../ui/fx.js';
import { createTargetBadge, createDots } from '../ui/targetBadge.js';
import {
  keyOptions, pickKey, REGISTER_OPTIONS, smoothField, instrumentField, quickToggle,
} from './singShared.js';
import {
  section, row, toggle, segmented, createDrawer,
} from '../ui/drawer.js';
import { createVolumeControl } from '../ui/volume.js';

const TONE_S = 1.3;

export function mountNoteMode(host, ctx) {
  const { cfg, graph } = ctx;
  let sess = null; // { n, hits, ms, items: [{name, ok}] }
  let cur = null; // { pitch, keyN, target, listenFrom, doneAt }
  let prev = null;
  let tracker = null;
  let timers = [];
  let lastFeedback = '';

  const status = h('div', { class: 'status big', 'aria-live': 'polite' });
  const staff = h('div', { class: 'staff wide paper' });
  const badge = createTargetBadge();
  const dots = createDots();
  const holdFill = h('div', { class: 'hold-fill' });
  const hold = h('div', { class: 'hold-bar', role: 'progressbar', 'aria-label': 'Tempo sustentando a nota' }, holdFill);
  const feedback = h('div', { class: 'feedback', 'aria-live': 'polite' });
  const resultBox = h('div', { class: 'result' });
  const btnStart = h('button', { class: 'btn primary', onclick: () => begin() }, '▶ Começar (Enter)');
  const btnReplay = h('button', { class: 'btn', onclick: () => replay(), disabled: true }, '🔊 Ouvir a nota');
  const btnSkip = h('button', { class: 'btn', onclick: () => skip(), disabled: true }, '⏭ Pular');
  const btnStop = h('button', { class: 'btn', onclick: () => endSession(), disabled: true }, '■ Encerrar');
  const quick = h('div', { class: 'quick' });
  const btnCfg = h('button', { class: 'btn', 'aria-haspopup': 'dialog', onclick: () => dr.set(true) }, '⚙ Ajustes');
  const dr = createDrawer('Ajustes da nota única', btnCfg);
  ctx.slot.append(createVolumeControl({ click: false }).el, quickToggle(quick), btnCfg);
  const staffCard = h('section', { class: 'card staff-card' }, staff, graph.el);
  const liveCard = h('section', { class: 'card live' },
    h('div', { class: 'live-top' }, badge.el, h('div', { class: 'live-info' }, dots.el, status)),
    hold, feedback,
    h('div', { class: 'actions' }, btnStart, h('div', { class: 'actions-sub' }, btnReplay, btnSkip, btnStop)));
  host.append(
    quick,
    h('div', { class: 'inst-grid' }, staffCard, h('div', { class: 'inst-side' }, liveCard, h('section', { class: 'card result-card' }, resultBox))),
    dr.scrim, dr.drawer,
  );

  const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

  const unsub = ctx.subscribe((frame, sm) => {
    if (!cur || cur.doneAt || sm.t < cur.listenFrom) return;
    let cents = null;
    if (sm.midi != null) {
      cents = (sm.midi - cur.target) * 100;
      if (cfg.anyOctave) cents = foldCents(cents);
    }
    const r = tracker.update(sm.t, cents);
    holdFill.style.width = `${Math.round(r.progress * 100)}%`;
    holdFill.classList.toggle('in', r.inTol);
    if (r.done) return success(cents);
    setFeedback(describe(cents, sm.midi));
  });

  function describe(cents, midi) {
    if (cents === null) return ['', 'Cante a nota…'];
    const c = Math.round(cents);
    const sign = c > 0 ? '+' : '';
    if (Math.abs(cents) <= cfg.tol) return ['ok', `Afinado (${sign}${c} cents) — segure…`];
    if (Math.abs(cents) > 100) return ['err', `Você está em ${pitchClassName(midi)} — procure ${noteName(cur.pitch)}`];
    return ['warn', cents > 0 ? `Um pouco alto (${sign}${c} cents) ↓` : `Um pouco baixo (${c} cents) ↑`];
  }

  function setFeedback([kind, text]) {
    const key = `${kind}|${text}`;
    if (key === lastFeedback) return;
    lastFeedback = key;
    feedback.className = `feedback ${kind}`;
    feedback.textContent = text;
  }

  function setButtons(running) {
    btnStart.disabled = running;
    btnReplay.disabled = !running;
    btnSkip.disabled = !running;
    btnStop.disabled = !running;
  }

  async function begin() {
    if (sess) return;
    if (!(await ctx.ensureMic())) return;
    sess = { n: 0, hits: 0, ms: 0, items: [], marks: [] };
    status.textContent = '';
    resultBox.replaceChildren();
    prev = null;
    setButtons(true);
    nextNote();
  }

  function nextNote() {
    clearTimers();
    if (sess.n >= cfg.count) return endSession();
    const keyN = pickKey(cfg);
    const pitch = generateNote({ keyN, chromatic: cfg.chromatic, avoid: prev });
    prev = pitch;
    const sounding = transpose(pitch, cfg.register);
    cur = { pitch, sounding, keyN, target: midiOf(sounding), listenFrom: Infinity, doneAt: null };
    tracker = new HoldTracker({ tolCents: cfg.tol, holdMs: cfg.hold });
    holdFill.style.width = '0%';
    holdFill.classList.remove('in');
    lastFeedback = '';
    ctx.resetPitch();
    graph.setConfig({ fold: cfg.anyOctave, back: 5000, ahead: 0, tolCents: cfg.tol });
    graph.setTargets([{ t0: -Infinity, t1: Infinity, midi: cur.target }]);
    renderNote(staff, { pitch, clef: 'treble', keyN });
    dots.set(cfg.count, sess.marks, sess.n);
    showBadge('idle', '');
    if (cfg.auto) playTone();
    else {
      cur.listenFrom = performance.now();
      showBadge('sing', '🎤 Cante agora');
      setFeedback(['', 'Cante a nota… (use “Ouvir a nota” para ouvir a referência)']);
    }
  }

  function showBadge(state, label) {
    badge.set({
      name: cfg.showName ? noteName(cur.pitch) : '?',
      sub: `Nota ${sess.n + 1} de ${cfg.count} · ${keyLabel(cur.keyN).split(' / ')[0]}`,
      state,
      label,
    });
  }

  function playTone() {
    stopAll();
    showBadge('listen', '🔊 Ouça a nota');
    const c = getCtx();
    scheduleNote(cur.sounding, c.currentTime + 0.05, TONE_S);
    cur.listenFrom = performance.now() + 50 + TONE_S * 1000 + 250; // ignora o próprio som do app
    tracker.reset();
    holdFill.style.width = '0%';
    setFeedback(['', 'Ouça a nota…']);
    later(() => {
      if (!cur || cur.doneAt) return;
      showBadge('sing', '🎤 Cante agora');
      setFeedback(['', 'Cante a nota e segure…']);
    }, TONE_S * 1000 + 300);
  }

  function replay() {
    if (cur && !cur.doneAt) playTone();
  }

  function success(cents) {
    const ms = performance.now() - cur.listenFrom;
    cur.doneAt = performance.now();
    sess.n++;
    sess.hits++;
    sess.ms += ms;
    sess.items.push({ name: noteName(cur.pitch), ok: true });
    sess.marks.push('ok');
    hit(staff, 'perfect', 'Afinado');
    dots.set(cfg.count, sess.marks, sess.n);
    badge.set({
      name: noteName(cur.pitch), sub: `${(ms / 1000).toFixed(1)} s para acertar`, state: 'ok', label: '✓ Afinado',
    });
    holdFill.style.width = '100%';
    holdFill.classList.add('in');
    feedback.className = 'feedback ok';
    lastFeedback = 'done';
    feedback.textContent = `✓ Afinado! ${noteName(cur.pitch)} em ${(ms / 1000).toFixed(1)}s`;
    graph.setTargets([{ t0: -Infinity, t1: Infinity, midi: cur.target, grade: 'perfect' }]);
    later(nextNote, 1400);
  }

  function skip() {
    if (!cur || cur.doneAt) return;
    sess.n++;
    sess.items.push({ name: noteName(cur.pitch), ok: false });
    sess.marks.push('skip');
    nextNote();
  }

  function endSession() {
    clearTimers();
    stopAll();
    const s = sess;
    sess = null;
    cur = null;
    graph.setTargets([]);
    setButtons(false);
    holdFill.style.width = '0%';
    feedback.className = 'feedback';
    feedback.textContent = '';
    staff.replaceChildren();
    badge.set();
    dots.clear();
    if (!s || s.n === 0) {
      status.textContent = 'Sessão encerrada.';
      return;
    }
    const avg = s.hits ? (s.ms / s.hits / 1000).toFixed(1) : '—';
    status.textContent = 'Sessão concluída';
    resultBox.replaceChildren(
      h('div', { class: 'big-score', text: `${s.hits}/${s.n}` }),
      h('p', { text: `notas afinadas · ${avg}s em média para acertar` }),
      h('div', { class: 'chips' }, s.items.map((i) => h('span', { class: `chip ${i.ok ? 'perfect' : 'miss'}`, text: `${i.ok ? '✓' : '✗'} ${i.name}` }))),
    );
    recordSession({ mode: 'sing', kind: 'note', score: s.hits / s.n, total: s.n, hits: s.hits, avgMs: s.hits ? s.ms / s.hits : 0 });
  }

  function onKey(e) {
    if (e.key === 'Escape' && dr.isOpen()) { dr.set(false); return; }
    if (isFormTarget(e) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.key === 'Enter' && !sess) begin();
    else if (e.key === ' ' && sess) { e.preventDefault(); replay(); }
    else if (e.key === 'ArrowRight' && sess) skip();
    else if (e.key === 'Escape' && sess) endSession();
  }
  document.addEventListener('keydown', onKey);

  function buildQuick() {
    quick.replaceChildren(
      field('Tom', select(keyOptions(), cfg.key, (v) => update({ key: v }))),
      field('Registro', select(REGISTER_OPTIONS, cfg.register, (v) => update({ register: Number(v) }))),
      field('Notas por sessão', select([[5, '5'], [10, '10'], [20, '20']], cfg.count, (v) => update({ count: Number(v) }))),
    );
  }

  function buildSettings() {
    dr.body.replaceChildren(
      section('🎼', 'Exercício',
        row('Se o tom for sorteado', 'Máximo de sustenidos e bemóis.', select(
          Array.from({ length: MAX_ACCIDENTALS + 1 }, (_, n) => [n, n === 0 ? 'Só Dó maior' : `Até ${n}`]),
          cfg.maxAcc, (v) => update({ maxAcc: Number(v) }))),
        row('Incluir notas cromáticas (♯ ♭)', null, toggle(cfg.chromatic, (v) => update({ chromatic: v }))),
        row('Mostrar o nome da nota', 'Desligue para ler só pela pauta.', toggle(cfg.showName, (v) => update({ showName: v }))),
      ),
      section('🎯', 'Validação',
        row('Tolerância de afinação', '1 semitom = 100 cents.', segmented([[15, '±15'], [25, '±25'], [40, '±40']], cfg.tol, (v) => update({ tol: Number(v) }))),
        row('Sustentar por', 'Tempo afinado até confirmar.', segmented([[500, '0,5 s'], [800, '0,8 s'], [1200, '1,2 s']], cfg.hold, (v) => update({ hold: Number(v) }))),
        row('Aceitar qualquer oitava', 'Útil para vozes mais graves ou agudas.', toggle(cfg.anyOctave, (v) => update({ anyOctave: v }))),
      ),
      section('🔊', 'Som e gráfico',
        row('Tocar a nota automaticamente', null, toggle(cfg.auto, (v) => update({ auto: v }))),
        h('div', { class: 'set-row stacked' }, instrumentField()),
        h('div', { class: 'set-row stacked' }, smoothField(cfg, ctx)),
      ),
      h('div', { class: 'set-tips' }, h('p', { text: '⌨ Enter começa · Espaço ouve a nota de novo · → pula · Esc encerra.' })),
    );
  }

  function update(patch) {
    Object.assign(cfg, patch);
    ctx.persist();
    buildSettings();
    if (sess) { sess = null; endSession(); }
  }

  buildQuick();
  buildSettings();
  graph.setConfig({ fold: cfg.anyOctave, back: 5000, ahead: 0, tolCents: cfg.tol });
  graph.setTargets([]);
  status.textContent = 'Toque em “Começar”: o app mostra e toca uma nota, você canta e ele confirma.';
  staff.replaceChildren();

  return () => {
    clearTimers();
    stopAll();
    unsub();
    document.removeEventListener('keydown', onKey);
  };
}
