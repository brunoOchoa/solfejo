import { Renderer, Stave, StaveNote, Voice, Formatter, Beam, Dot, Fraction, Tuplet } from 'vexflow';
import { TIME_SIGNATURES, DURATIONS, tripletGroups } from '../music/rhythm.js';

const COLORS = { perfect: '#22c55e', good: '#65a30d', ok: '#f59e0b', miss: '#f43f5e' };
const ROW_H = 132;
const HEAD_DX = 6; // centro aproximado da cabeça da nota

/**
 * Desenha os compassos numa pauta de uma linha e devolve o layout (posições x/y de cada
 * figura) para o overlay animado. As durações vêm em ticks (12 por semínima; veja music/rhythm.js).
 * grades: lista (uma por nota tocada) com 'perfect' | 'good' | 'ok' | 'miss' (colore as notas).
 */
export function renderRhythm(el, { measures, timeSig, grades = null }) {
  el.innerHTML = '';
  const sig = TIME_SIGNATURES[timeSig];
  const [num, den] = timeSig.split('/').map(Number);
  const ticksPerMeasure = sig.beats * sig.beatTicks;
  const width = Math.max(280, Math.min(el.clientWidth || 640, 640)); // limite: acima disso a pauta só ganha escala (notas maiores)
  const perRow = width >= 560 && measures.length > 1 ? 2 : 1;
  const rows = Math.ceil(measures.length / perRow);
  const staveW = (width - 20) / perRow;
  const height = rows * ROW_H + 20;

  const renderer = new Renderer(el, Renderer.Backends.SVG);
  renderer.resize(width, height);
  const ctx = renderer.getContext();

  const layout = {
    unitsPerMeasure: ticksPerMeasure, beats: sig.beats, beatTicks: sig.beatTicks,
    points: [], measureRow: [], rowLineY: [], onsets: [], width, height,
  };
  let played = 0;

  measures.forEach((events, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const x = 10 + col * staveW;
    const y = 10 + row * ROW_H;

    const stave = new Stave(x, y + 18, staveW);
    stave.setConfigForLines([
      { visible: false }, { visible: false }, { visible: true }, { visible: false }, { visible: false },
    ]);
    if (i === 0) stave.addTimeSignature(timeSig);
    stave.setContext(ctx).draw();
    layout.rowLineY[row] = stave.getYForLine(2);
    layout.measureRow[i] = row;

    const notes = events.map((e) => {
      const rest = e < 0;
      const dur = DURATIONS[Math.abs(e)];
      const note = new StaveNote({ keys: ['b/4'], duration: dur + (rest ? 'r' : ''), clef: 'treble', stemDirection: 1 });
      if (dur.endsWith('d')) Dot.buildAndAttach([note], { all: true });
      if (!rest && grades) {
        const color = COLORS[grades[played]] || '#888';
        note.setStyle({ fillStyle: color, strokeStyle: color });
      }
      if (!rest) played++;
      return note;
    });

    // tercinas: colchete "3" (3 notas no tempo de 2)
    const tuplets = tripletGroups(events).map(([a, b]) => new Tuplet(notes.slice(a, b), { numNotes: 3, notesOccupied: 2 }));

    const voice = new Voice({ numBeats: num, beatValue: den }).setStrict(false).addTickables(notes);
    const avail = staveW - (stave.getNoteStartX() - x) - 12;
    new Formatter().joinVoices([voice]).format([voice], avail);

    const group = sig.compound ? new Fraction(3, 8) : new Fraction(1, 4);
    const beams = Beam.generateBeams(notes, { groups: [group], stemDirection: 1 });
    voice.draw(ctx, stave);
    beams.forEach((b) => b.setContext(ctx).draw());
    tuplets.forEach((t) => t.setContext(ctx).draw());

    // posições (em ticks desde o início do compasso) para o overlay
    let tick = 0;
    const pts = [];
    notes.forEach((n, k) => {
      const nx = n.getAbsoluteX() + HEAD_DX;
      pts.push({ u: tick, x: nx });
      if (events[k] > 0) layout.onsets.push({ u: i * ticksPerMeasure + tick, x: nx, row });
      tick += Math.abs(events[k]);
    });
    pts.push({ u: tick, x: x + staveW - 6 });
    layout.points[i] = pts;
  });

  el.style.removeProperty('width'); // o VexFlow fixa a largura do contêiner em px e a pauta não crescia com a tela
  const svg = el.querySelector('svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.style.width = '100%'; // o VexFlow grava px inline; sem isso a partitura não encolhe no celular
  svg.style.height = 'auto';
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Partitura rítmica');
  return { svg, layout };
}
