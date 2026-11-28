// Pauta de uma música inteira: vários compassos por linha, durações variadas, pausas, ligação de colcheias, dedilhado e nomes das notas.
import {
  Renderer, Stave, StaveNote, Voice, Formatter, Accidental, Annotation, Beam, Fraction, Dot, Barline,
} from 'vexflow';
import { effectiveTheme } from '../theme.js';
import { vexKey, vexKeySignature, noteName } from '../music/theory.js';

export const GRADE_COLOR = {
  perfect: '#22c55e', good: '#65a30d', ok: '#f59e0b', wrong: '#f43f5e', none: '#f43f5e', done: '#22c55e', warn: '#f59e0b',
};
// duração em tempos → código do VexFlow
const CODE = [[4, 'w'], [3, 'hd'], [2, 'h'], [1.5, 'qd'], [1, 'q'], [0.75, '8d'], [0.5, '8'], [0.25, '16']];
const codeOf = (beats) => (CODE.find(([b]) => Math.abs(b - beats) < 1e-9) ?? [0, 'q'])[1];

/**
 * Desenha a música em `el`. Retorna o controle: setActive(idx), setGrades(mapa idx → nota), clear(), rowOf(idx).
 * opts: names (nome sob a nota), fingers (dedo sobre a nota).
 */
export function renderSong(el, song, { names = true, fingers = true } = {}) {
  el.innerHTML = '';
  const keySig = vexKeySignature(song.keyN);
  const [num, den] = song.meter;
  const width = Math.max(380, Math.min(el.clientWidth || 700, 900));
  const EXTRA_FIRST = 84; // clave + armadura ocupam espaço no 1º compasso de cada linha
  const EXTRA_TIME = 26;
  // quantos compassos cabem por linha: cada nota pede uns 26 px (com o nome e o dedo), então compassos cheios ocupam mais espaço
  const maxNotes = Math.max(...song.measures.map((m) => m.items.length));
  const minBar = Math.max(130, maxNotes * 26 + 40);
  const perRow = Math.max(1, Math.min(4, Math.floor((width - 20 - EXTRA_FIRST - EXTRA_TIME) / minBar)));
  const rows = Math.ceil(song.bars / perRow);
  const rowH = 118 + (names ? 18 : 0) + (fingers ? 16 : 0);
  const top = 26 + (fingers ? 16 : 0);
  const height = rows * rowH + 20;

  const renderer = new Renderer(el, Renderer.Backends.SVG);
  renderer.resize(width, height);
  const ctx = renderer.getContext();
  const noteEls = new Map(); // idx do evento → elemento SVG da nota
  const rowOfIdx = new Map();

  song.measures.forEach((m, b) => {
    const row = Math.floor(b / perRow);
    const col = b % perRow;
    const inRow = Math.min(perRow, song.bars - row * perRow);
    const extra = EXTRA_FIRST + (row === 0 ? EXTRA_TIME : 0);
    const base = (width - 20 - extra) / inRow;
    const w = col === 0 ? base + extra : base;
    const x = 10 + (col === 0 ? 0 : extra + col * base);
    const y = row * rowH + top;

    const stave = new Stave(x, y, w);
    if (col === 0) stave.addClef('treble').addKeySignature(keySig);
    if (b === 0) stave.addTimeSignature(`${num}/${den}`);
    stave.setMeasure(b + 1);
    if (b === song.bars - 1) stave.setEndBarType(Barline.type.END);
    stave.setContext(ctx).draw();

    const evs = song.events.filter((e) => e.bar === b);
    const notes = evs.map((e) => {
      const rest = e.rest;
      const n = new StaveNote({ keys: [rest ? 'b/4' : vexKey(e.pitch)], duration: `${codeOf(e.beats)}${rest ? 'r' : ''}`, clef: 'treble' });
      if (codeOf(e.beats).endsWith('d')) Dot.buildAndAttach([n], { all: true });
      if (!rest && fingers) n.addModifier(new Annotation(String(e.finger)).setVerticalJustification(Annotation.VerticalJustify.TOP).setFont('JetBrains Mono, monospace', 11, 'bold'), 0);
      if (!rest && names) n.addModifier(new Annotation(noteName(e.pitch)).setVerticalJustification(Annotation.VerticalJustify.BOTTOM), 0);
      return n;
    });
    const voice = new Voice({ numBeats: num, beatValue: den }).setStrict(false).addTickables(notes);
    Accidental.applyAccidentals([voice], keySig);
    new Formatter().joinVoices([voice]).format([voice], w - (stave.getNoteStartX() - x) - 16);
    const beams = Beam.generateBeams(notes, { groups: [new Fraction(1, 4)] });
    voice.draw(ctx, stave);
    beams.forEach((bm) => bm.setContext(ctx).draw());
    notes.forEach((n, i) => {
      noteEls.set(evs[i].idx, n.getSVGElement?.() ?? null);
      rowOfIdx.set(evs[i].idx, row);
    });
  });

  el.style.removeProperty('width');
  const svg = el.querySelector('svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.style.width = '100%';
  svg.style.height = 'auto';
  svg.style.minWidth = '380px';
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Partitura de ${song.title}`);

  // colorir uma nota sem redesenhar a pauta (redesenhar a cada nota pesa e zera a rolagem)
  const paint = (idx, color) => {
    const g = noteEls.get(idx);
    if (!g) return;
    // no VexFlow 5 a cabeça é um glifo de texto e a haste é um retângulo; os dedos e nomes (anotações) ficam como estão
    const parts = [g.querySelector(':scope > .vf-notehead > text'), g.querySelector(':scope > rect'), ...g.querySelectorAll(':scope > .vf-flag text')];
    parts.forEach((p) => {
      if (!p) return;
      if (color) { p.style.fill = color; if (p.tagName !== 'text') p.style.stroke = color; } else { p.style.removeProperty('fill'); p.style.removeProperty('stroke'); }
    });
  };
  // destaque da nota atual: cor viva (azul, que não se confunde com as cores de acerto)
  const vivid = () => (effectiveTheme() === 'light' ? '#1769ff' : '#5cc8ff');
  let active = -1;
  let grades = {};
  const colorOf = (idx) => (grades[idx] ? GRADE_COLOR[grades[idx]] : idx === active ? vivid() : null);
  return {
    setActive(idx) {
      const prev = active;
      active = idx;
      if (prev >= 0) paint(prev, colorOf(prev));
      if (idx >= 0) paint(idx, colorOf(idx));
    },
    setGrades(map) {
      const old = grades;
      grades = map || {};
      new Set([...Object.keys(old), ...Object.keys(grades)]).forEach((k) => paint(Number(k), colorOf(Number(k))));
    },
    clear() { this.setGrades({}); this.setActive(-1); },
    rowOf: (idx) => rowOfIdx.get(idx) ?? 0,
    noteEl: (idx) => noteEls.get(idx) ?? null,
  };
}
