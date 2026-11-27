import { Renderer, Stave, StaveNote, Voice, Formatter, Accidental, Annotation } from 'vexflow';
import { vexKey, vexKeySignature, noteName } from '../music/theory.js';
import { highlight } from '../theme.js';

const COLORS = { perfect: '#22c55e', good: '#65a30d', ok: '#f59e0b', miss: '#f43f5e' };
const ROW_H = 150;
const PER_MEASURE = 4; // semínimas em 4/4

/**
 * Desenha a melodia em compassos 4/4 de semínimas (clave de Sol).
 * grades: lista de 'perfect'|'good'|'ok'|'miss' (uma por nota) ou null.
 * names: escreve o nome (Dó fixo) sob cada nota.
 */
export function renderMelody(el, { notes, keyN, grades = null, names = true, active = -1 }) {
  el.innerHTML = '';
  const keySig = vexKeySignature(keyN);
  const measures = [];
  for (let i = 0; i < notes.length; i += PER_MEASURE) measures.push(notes.slice(i, i + PER_MEASURE));

  const width = Math.max(280, Math.min(el.clientWidth || 640, 900));
  const perRow = width >= 560 && measures.length > 1 ? 2 : 1;
  const rows = Math.ceil(measures.length / perRow);
  const staveW = (width - 20) / perRow;

  const renderer = new Renderer(el, Renderer.Backends.SVG);
  renderer.resize(width, rows * ROW_H + 20);
  const ctx = renderer.getContext();

  let idx = 0;
  measures.forEach((group, m) => {
    const row = Math.floor(m / perRow);
    const col = m % perRow;
    const x = 10 + col * staveW;
    const y = 20 + row * ROW_H;

    const stave = new Stave(x, y, staveW);
    if (col === 0) stave.addClef('treble').addKeySignature(keySig);
    if (m === 0) stave.addTimeSignature('4/4');
    stave.setContext(ctx).draw();

    const vexNotes = group.map((pitch) => {
      const n = new StaveNote({ keys: [vexKey(pitch)], duration: 'q', clef: 'treble' });
      const color = grades ? COLORS[grades[idx]] : idx === active ? highlight() : null;
      if (color) n.setStyle({ fillStyle: color, strokeStyle: color });
      if (names) {
        n.addModifier(new Annotation(noteName(pitch)).setVerticalJustification(Annotation.VerticalJustify.BOTTOM), 0);
      }
      idx++;
      return n;
    });
    const voice = new Voice({ numBeats: PER_MEASURE, beatValue: 4 }).setStrict(false).addTickables(vexNotes);
    Accidental.applyAccidentals([voice], keySig);
    new Formatter().joinVoices([voice]).format([voice], staveW - (stave.getNoteStartX() - x) - 14);
    voice.draw(ctx, stave);
  });

  el.style.removeProperty('width'); // o VexFlow grava a largura no contêiner; sem isso a pauta trava no tamanho medido e encolhe a cada redesenho
  el.style.removeProperty('height');
  const svg = el.querySelector('svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${rows * ROW_H + 20}`);
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.style.width = '100%'; // o VexFlow grava px inline; sem isso a partitura não encolhe no celular
  svg.style.height = 'auto';
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Melodia para solfejar');
}
