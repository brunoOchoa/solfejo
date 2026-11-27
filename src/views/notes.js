import { h, field, select, isFormTarget } from '../dom.js';
import {
  CLEFS, SOLFEGE, LETTERS, MAX_ACCIDENTALS, keyAccidentals, keyLabel, letterOf, noteName, randomPitch,
} from '../music/theory.js';
import { renderNote } from '../render/staff.js';
import { playPitch } from '../music/audio.js';
import { instrumentField, quickToggle } from './singShared.js';
import { createVolumeControl } from '../ui/volume.js';
import {
  section, row, toggle, createDrawer,
} from '../ui/drawer.js';
import { load, save, recordNoteAnswer, recordSession } from '../storage.js';
import { hit } from '../ui/fx.js';

const DEFAULTS = { clef: 'treble', range: 'basic', maxAcc: 0, chromatic: 0, strict: true, len: 20, cifra: false };
const ACC_BUTTONS = [[-1, '♭', 'Bemol'], [0, '♮', 'Bequadro'], [1, '♯', 'Sustenido']];

export function mountNotes(root) {
  const cfg = load('cfg.notes', DEFAULTS);
  let session;
  let q = null;
  let accSel = null;
  let answered = false;
  let last = null;
  let nextTimer = null;

  const gameL = h('section', { class: 'card staff-card notes-left' });
  const gameR = h('section', { class: 'card notes-right' });
  const quick = h('div', { class: 'quick' });
  const btnCfg = h('button', { class: 'btn', 'aria-haspopup': 'dialog', onclick: () => dr.set(true) }, '⚙ Ajustes');
  const dr = createDrawer('Ajustes das notas', btnCfg);
  root.classList.add('wide');
  root.append(
    h('div', { class: 'inst-bar' }, h('b', { class: 'bar-title', text: '🎼 Leitura de notas' }), h('span', { class: 'grow' }), createVolumeControl({ click: false }).el, quickToggle(quick), btnCfg),
    quick,
    h('div', { class: 'inst-grid notes-grid' }, gameL, gameR),
    dr.scrim, dr.drawer,
  );

  const persist = () => save('cfg.notes', cfg);

  function newSession() {
    clearTimeout(nextTimer);
    session = { n: 0, correct: 0, ms: 0, wrong: {}, done: false };
    nextQuestion();
  }

  function nextQuestion() {
    clearTimeout(nextTimer);
    if (session.n >= cfg.len) return finish();
    const clef = cfg.clef === 'both' ? (Math.random() < 0.5 ? 'treble' : 'bass') : cfg.clef;
    const keyN = cfg.maxAcc ? Math.floor(Math.random() * (2 * cfg.maxAcc + 1)) - cfg.maxAcc : 0;
    const pitch = randomPitch({
      clef, range: cfg.range, keyAcc: keyAccidentals(keyN), chromaticChance: cfg.chromatic, avoid: last,
    });
    last = pitch;
    q = { pitch, clef, keyN, t0: performance.now(), result: null, picked: null };
    accSel = null;
    answered = false;
    draw();
  }

  function expectedAcc(letter) {
    if (accSel !== null) return accSel;
    return cfg.strict ? 0 : keyAccidentals(q.keyN)[letter];
  }

  function answer(letter) {
    if (answered || !q) return;
    answered = true;
    const acc = expectedAcc(letter);
    const correct = letter === letterOf(q.pitch.step) && acc === q.pitch.acc;
    const ms = performance.now() - q.t0;
    q.result = correct;
    q.picked = { step: letter, acc };
    session.n++;
    session.ms += ms;
    const correctLetter = SOLFEGE[letterOf(q.pitch.step)];
    if (correct) session.correct++;
    else session.wrong[correctLetter] = (session.wrong[correctLetter] || 0) + 1;
    recordNoteAnswer(correctLetter, correct, ms);
    recordNoteAnswer(`clef:${q.clef}`, correct, ms);
    playPitch(q.pitch);
    draw();
    hit(gameL.querySelector('.staff'), correct ? 'ok' : 'err', correct ? 'Certo' : 'Errou', gameL);
    if (correct) nextTimer = setTimeout(nextQuestion, 1000);
  }

  function finish() {
    session.done = true;
    const avgMs = session.n ? session.ms / session.n : 0;
    recordSession({ mode: 'notes', total: session.n, correct: session.correct, avgMs });
    draw();
  }

  function pickAcc(value) {
    if (answered) return;
    accSel = accSel === value ? null : value;
    draw();
  }

  function onKey(e) {
    if (e.key === 'Escape' && dr.isOpen()) { dr.set(false); return; }
    if (isFormTarget(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (session.done) return;
    if (/^[1-7]$/.test(e.key)) answer(Number(e.key) - 1);
    else if (e.key === '+' || e.key === '#' || e.key === '=') pickAcc(1);
    else if (e.key === '-') pickAcc(-1);
    else if (e.key.toLowerCase() === 'n') pickAcc(0);
    else if ((e.key === 'Enter' || e.key === ' ') && answered) {
      e.preventDefault();
      nextQuestion();
    }
  }
  document.addEventListener('keydown', onKey);

  function describe(pitch) {
    const s = noteName(pitch, { octave: true });
    return cfg.cifra ? `${s} (${noteName(pitch, { system: 'cifra', octave: true })})` : s;
  }

  function draw() {
    gameL.replaceChildren();
    gameR.replaceChildren();
    if (session.done) return drawSummary();

    const acc = session.n ? Math.round((session.correct / session.n) * 100) : 0;
    const pctDone = Math.round((session.n / cfg.len) * 100);
    gameL.append(
      h('div', { class: 'status' },
        h('span', { text: `Pergunta ${Math.min(session.n + 1, cfg.len)}/${cfg.len}` }),
        h('span', { text: `Acertos: ${session.correct}${session.n ? ` (${acc}%)` : ''}` }),
      ),
      h('div', { class: 'hold-bar', role: 'progressbar', 'aria-label': 'Progresso da sessão' }, h('div', { class: 'hold-fill in', style: `width:${pctDone}%` })),
    );
    const staff = h('div', { class: 'staff paper' });
    gameL.append(staff);
    renderNote(staff, q);

    const fb = h('div', { class: `feedback ${answered ? (q.result ? 'ok' : 'err') : ''}`, 'aria-live': 'polite' });
    if (answered) {
      fb.append(q.result
        ? `✓ Correto! ${describe(q.pitch)}`
        : `✗ Era ${describe(q.pitch)}. Você respondeu ${noteName(q.picked)}.`);
      if (!q.result) fb.append(h('div', { class: 'hint', text: `Armadura: ${keyLabel(q.keyN)}` }));
    } else {
      fb.append(cfg.strict && q.keyN !== 0 ? 'Atenção à armadura de clave: informe a alteração se houver.' : ' ');
    }
    gameL.append(fb);

    gameR.append(...[
      h('div', { class: 'side-title' }, h('b', { text: 'Qual é a nota?' }), h('span', { class: 'st-count', text: 'atalhos 1–7' })),
      h('div', { class: 'acc-row', role: 'group', 'aria-label': 'Alteração' },
        ACC_BUTTONS.map(([value, sym, name]) =>
          h('button', {
            class: `btn acc${accSel === value ? ' active' : ''}`, 'aria-pressed': accSel === value,
            'aria-label': name, title: name, disabled: answered, onclick: () => pickAcc(value),
          }, sym)),
      ),
      h('div', { class: 'note-row' },
        SOLFEGE.map((name, i) => {
          const cls = ['btn', 'note'];
          if (answered) {
            if (i === letterOf(q.pitch.step)) cls.push('right');
            else if (i === q.picked.step && !q.result) cls.push('wrong');
          }
          return h('button', { class: cls.join(' '), disabled: answered, onclick: () => answer(i) },
            h('span', { class: 'n', text: name }),
            cfg.cifra ? h('span', { class: 'c', text: LETTERS[i] }) : null,
            h('kbd', { text: String(i + 1) }));
        }),
      ),
      answered && !q.result ? h('button', { class: 'btn primary', onclick: nextQuestion }, 'Próxima ▸ (Enter)') : null,
    ].filter(Boolean)); // append(null) escreveria "null" na tela
  }

  function drawSummary() {
    const pct = session.n ? Math.round((session.correct / session.n) * 100) : 0;
    const avg = session.n ? (session.ms / session.n / 1000).toFixed(1) : '0.0';
    const worst = Object.entries(session.wrong).sort((a, b) => b[1] - a[1]).slice(0, 3);
    gameL.append(
      h('h2', { text: 'Sessão concluída' }),
      h('div', { class: 'big-score', text: `${pct}%` }),
      h('p', { text: `${session.correct} de ${session.n} acertos · ${avg}s por nota` }),
      worst.length
        ? h('p', { class: 'hint', text: `Revisar: ${worst.map(([n, c]) => `${n} (${c}×)`).join(', ')}` })
        : h('p', { class: 'hint', text: 'Sem erros. Aumente a dificuldade nas configurações.' }),
      h('button', { class: 'btn primary', onclick: newSession }, 'Nova sessão'),
    );
  }

  // seletores rápidos (criados uma vez, para o foco do teclado não se perder) e gaveta com o restante
  function buildQuick() {
    quick.replaceChildren(
      field('Clave', select([['treble', 'Sol'], ['bass', 'Fá'], ['both', 'Ambas']], cfg.clef, (v) => update({ clef: v }))),
      field('Extensão', select([['basic', 'Dentro da pauta'], ['extended', 'Com linhas suplementares']], cfg.range, (v) => update({ range: v }))),
      field('Armaduras', select(
        Array.from({ length: MAX_ACCIDENTALS + 1 }, (_, n) => [n, n === 0 ? 'Sem armadura' : `Até ${n} alteração(ões)`]),
        cfg.maxAcc, (v) => update({ maxAcc: Number(v) }))),
      field('Notas por sessão', select([[10, '10'], [20, '20'], [50, '50']], cfg.len, (v) => update({ len: Number(v) }))),
    );
  }

  function buildSettings() {
    dr.body.replaceChildren(
      section('🎼', 'Exercício',
        row('Alterações ocasionais', 'Sustenidos e bemóis fora da armadura.', select([[0, 'Nunca'], [0.15, 'Às vezes'], [0.3, 'Frequente']], cfg.chromatic, (v) => update({ chromatic: Number(v) }))),
        row('Exigir a alteração da armadura', 'Você precisa informar ♯/♭ quando a armadura pede.', toggle(cfg.strict, (v) => update({ strict: v }))),
        row('Mostrar cifras (C D E…)', null, toggle(cfg.cifra, (v) => update({ cifra: v }))),
      ),
      section('🔊', 'Som', h('div', { class: 'set-row stacked' }, instrumentField())),
      h('div', { class: 'set-tips' }, h('p', { text: '⌨ 1–7 = Dó…Si · + sustenido · − bemol · N bequadro · Enter próxima · Esc fecha.' })),
    );
  }

  function update(patch) {
    Object.assign(cfg, patch);
    persist();
    buildSettings();
    newSession();
  }

  buildQuick();
  buildSettings();
  newSession();

  return () => {
    clearTimeout(nextTimer);
    document.removeEventListener('keydown', onKey);
    root.classList.remove('wide');
  };
}
