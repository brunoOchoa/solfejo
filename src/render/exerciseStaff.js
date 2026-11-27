import {
  Renderer, Stave, StaveNote, Voice, Formatter, Accidental, Annotation, Beam, Fraction,
} from 'vexflow';
import { vexKey, vexKeySignature, noteName } from '../music/theory.js';
import { highlight } from '../theme.js';

const COLORS = { tune: '#a855f7', perfect: '#22c55e', good: '#65a30d', ok: '#f59e0b', wrong: '#f43f5e', none: '#f43f5e', warn: '#f59e0b' };

/** Figuras: duração em tempos (semínima = 1). w semibreve, h mínima, q semínima, 8 colcheia, 16 semicolcheia. */
export const FIGURE_BEATS = { w: 4, h: 2, q: 1, 8: 0.5, 16: 0.25 };
export const FIGURES = [
  ['w', 'Semibreve (4 tempos)'], ['h', 'Mínima (2 tempos)'], ['q', 'Semínima (1 tempo)'], ['8', 'Colcheia (½ tempo)'], ['16', 'Semicolcheia (¼ de tempo)'],
];
export const FIGURE_NAME = { w: 'semibreves', h: 'mínimas', q: 'semínimas', 8: 'colcheias', 16: 'semicolcheias' };
const MIN_DRAW = { w: 320, h: 320, q: 320, 8: 480, 16: 800 };

// Linhas da pauta (passos diatônicos): clave de Sol E4–F5, de Fá G2–A3
const SPAN = { treble: [30, 38], bass: [18, 26] };

/** Clave: Sol, exceto teclado com a maior parte das notas abaixo do Lá3 (clave de Fá). */
export const clefFor = (notes, allowBass) => {
  if (!allowBass) return 'treble';
  const mid = notes.map((n) => n.step).sort((a, b) => a - b)[notes.length >> 1];
  return mid < 26 ? 'bass' : 'treble';
};

/**
 * Desenha o exercício em compassos 4/4 (1 ou 2 notas por tempo).
 * grades: lista (uma por nota) com 'perfect'|'good'|'ok'|'wrong'|'none'|'warn' ou null; active: nota atual.
 * Armadura: a da tonalidade; sustenidos/bemóis extras (menor harmônica/melódica) aparecem como acidentes.
 */
export function renderExercise(el, {
  notes, keyN, clef = 'treble', figure = 'q', grades = null, active = -1, names = true, labels = null,
}) {
  el.innerHTML = '';
  const keySig = vexKeySignature(keyN);
  const perMeasure = Math.round(4 / FIGURE_BEATS[figure]);
  const measures = [];
  for (let i = 0; i < notes.length; i += perMeasure) measures.push(notes.slice(i, i + perMeasure));

  const [spanLo, spanHi] = SPAN[clef];
  const steps = notes.map((n) => n.step);
  const above = Math.max(0, Math.ceil((Math.max(...steps) - spanHi) / 2));
  const below = Math.max(0, Math.ceil((spanLo - Math.min(...steps)) / 2));
  const rowH = 104 + 10 * (above + below) + (names ? 18 : 0) + (labels ? 16 : 0);
  const top = 22 + 10 * above;

  // largura mínima de desenho (o SVG encolhe via viewBox): 8 colcheias + armadura não cabem em menos
  const width = Math.max(MIN_DRAW[figure], Math.min(el.clientWidth || 640, 900));
  const maxNotesRow = width >= 880 ? 16 : width >= 560 ? 8 : 4;
  const perRow = Math.max(1, Math.min(4, Math.floor(maxNotesRow / perMeasure), measures.length));
  const rows = Math.ceil(measures.length / perRow);
  const staveW = (width - 20) / perRow;
  const height = rows * rowH + 20;

  const renderer = new Renderer(el, Renderer.Backends.SVG);
  renderer.resize(width, height);
  const ctx = renderer.getContext();

  let idx = 0;
  measures.forEach((group, m) => {
    const row = Math.floor(m / perRow);
    const col = m % perRow;
    const x = 10 + col * staveW;
    const y = row * rowH + top - 22 + 22;

    const stave = new Stave(x, y, staveW);
    if (col === 0) stave.addClef(clef).addKeySignature(keySig);
    if (m === 0) stave.addTimeSignature('4/4');
    stave.setContext(ctx).draw();

    const vexNotes = group.map((pitch) => {
      const n = new StaveNote({ keys: [vexKey(pitch)], duration: figure, clef });
      const color = grades && grades[idx] ? COLORS[grades[idx]] : idx === active ? highlight() : null;
      if (color) {
        n.setStyle({ fillStyle: color, strokeStyle: color });
        n.setKeyStyle(0, { fillStyle: color, strokeStyle: color }); // cabeça da nota
      }
      if (names) {
        n.addModifier(new Annotation(noteName(pitch)).setVerticalJustification(Annotation.VerticalJustify.BOTTOM), 0);
      }
      const lb = labels?.[idx];
      if (lb) n.addModifier(new Annotation(lb).setVerticalJustification(Annotation.VerticalJustify.BOTTOM).setFont('JetBrains Mono, monospace', 10, 'bold'), 0);
      idx++;
      return n;
    });
    const voice = new Voice({ numBeats: 4, beatValue: 4 }).setStrict(false).addTickables(vexNotes);
    Accidental.applyAccidentals([voice], keySig);
    new Formatter().joinVoices([voice]).format([voice], staveW - (stave.getNoteStartX() - x) - 14);
    const beams = figure === '8' || figure === '16' ? Beam.generateBeams(vexNotes, { groups: [new Fraction(1, 4)] }) : [];
    voice.draw(ctx, stave);
    beams.forEach((b) => b.setContext(ctx).draw());
  });

  // rótulos de resultado: a regra de CSS da pauta pinta todo texto da cor da tinta; aqui recolorimos pelo símbolo
  const LABEL_COLOR = {
    '✓': COLORS.perfect, '~': COLORS.ok, '✗': COLORS.wrong, '≈': COLORS.tune,
  };
  el.querySelectorAll('svg text').forEach((t) => {
    const c = LABEL_COLOR[t.textContent?.[0]];
    if (c && t.textContent.length > 1) { t.style.fill = c; t.style.fontWeight = '700'; }
  });

  el.style.removeProperty('width'); // o VexFlow fixa a largura do contêiner em px; o SVG escala por viewBox
  const svg = el.querySelector('svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.style.width = '100%';
  svg.style.height = 'auto';
  svg.style.minWidth = figure === '8' || figure === '16' ? `${MIN_DRAW[figure]}px` : ''; // figuras rápidas: no celular a pauta rola para os lados
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Partitura do exercício');
}
