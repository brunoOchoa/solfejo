import { Renderer, Stave, StaveNote, Voice, Formatter, Accidental } from 'vexflow';
import { CLEFS, vexKey, vexKeySignature } from '../music/theory.js';

const W = 300;
const H = 200;

/** Desenha uma única nota numa pauta (clave + armadura). */
export function renderNote(el, { pitch, clef, keyN }) {
  el.innerHTML = '';
  const renderer = new Renderer(el, Renderer.Backends.SVG);
  renderer.resize(W, H);
  const ctx = renderer.getContext();
  const vexClef = CLEFS[clef].vex;
  const keySig = vexKeySignature(keyN);

  const stave = new Stave(10, 60, W - 20);
  stave.addClef(vexClef).addKeySignature(keySig);
  stave.setContext(ctx).draw();

  const note = new StaveNote({ keys: [vexKey(pitch)], duration: 'q', clef: vexClef });
  const voice = new Voice({ numBeats: 1, beatValue: 4 }).addTickables([note]);
  Accidental.applyAccidentals([voice], keySig);

  const start = stave.getNoteStartX();
  new Formatter().joinVoices([voice]).format([voice], 40);
  note.setXShift(Math.max(0, (W - 20 - (start - 10)) / 2 - 20));
  voice.draw(ctx, stave);

  el.style.removeProperty('width'); // o VexFlow fixa a largura do contêiner em px
  const svg = el.querySelector('svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.style.width = '100%'; // o VexFlow grava px inline; sem isso a partitura não encolhe no celular
  svg.style.height = 'auto';
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Partitura com uma nota para identificar');
}
