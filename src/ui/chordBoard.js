// Desenho do acorde no instrumento: braço do violão (6 cordas e casas) ou teclado. As notas do acorde acendem em verde
// conforme o microfone as reconhece. Mesmo estilo do braço do violino.
import { h } from '../dom.js';
import { GUITAR } from '../music/chords.js';

const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}, text = null) => {
  const e = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  if (text != null) e.textContent = text;
  return e;
};
const mod12 = (n) => ((n % 12) + 12) % 12;
const SOLFEGE_PC = ['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si'];
const IS_BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];

// ---- braço do violão --------------------------------------------------------------------------
const GX0 = 78; // pestana
const FRET_W = 104;
const FRETS = 5;
const GY0 = 36;
const GAP = 30; // entre cordas
const yOf = (s) => GY0 + (5 - s) * GAP; // corda 0 (Mi grave) embaixo

function guitarSvg(v, tonePcs) {
  const svg = sv('svg', { viewBox: `0 0 ${GX0 + FRET_W * FRETS + 16} ${GY0 + 5 * GAP + 40}`, class: 'cb-svg', role: 'img', 'aria-label': `Acorde no violão: ${v.text}` });
  const start = v.top <= FRETS ? 1 : v.base;
  const xAt = (f) => GX0 + (f - start + 0.5) * FRET_W;
  const wood = sv('rect', { x: GX0, y: GY0 - 14, width: FRET_W * FRETS, height: 5 * GAP + 28, rx: 6, class: 'cb-wood' });
  svg.append(wood);
  // casas
  for (let k = 0; k <= FRETS; k++) {
    svg.append(sv('line', { x1: GX0 + k * FRET_W, x2: GX0 + k * FRET_W, y1: GY0 - 14, y2: GY0 + 5 * GAP + 14, class: k === 0 && start === 1 ? 'cb-nut' : 'cb-fret' }));
  }
  // marcações (3, 5, 7, 9, 12)
  for (let f = start; f < start + FRETS; f++) {
    if ([3, 5, 7, 9, 12].includes(f)) {
      const cx = xAt(f);
      const cy = GY0 + 2.5 * GAP;
      if (f === 12) { svg.append(sv('circle', { cx, cy: cy - GAP, r: 5, class: 'cb-inlay' }), sv('circle', { cx, cy: cy + GAP, r: 5, class: 'cb-inlay' })); }
      else svg.append(sv('circle', { cx, cy, r: 5.5, class: 'cb-inlay' }));
    }
    svg.append(sv('text', { x: xAt(f), y: GY0 + 5 * GAP + 34, class: 'cb-fretnum', 'text-anchor': 'middle' }, String(f)));
  }
  // cordas (as graves são mais grossas)
  GUITAR.names.forEach((name, s) => {
    svg.append(sv('line', { x1: GX0 - 4, x2: GX0 + FRET_W * FRETS, y1: yOf(s), y2: yOf(s), class: 'cb-string', 'stroke-width': 1.2 + (5 - s) * 0.35 }));
    svg.append(sv('text', { x: 14, y: yOf(s) + 4, class: 'cb-sname' }, name));
  });
  // pestana
  if (v.barre) {
    const x = xAt(v.barre.fret);
    svg.append(sv('rect', { x: x - 14, y: yOf(v.barre.to) - 14, width: 28, height: yOf(v.barre.from) - yOf(v.barre.to) + 28, rx: 14, class: 'cb-barre' }));
  }
  const items = [];
  v.frets.forEach((f, s) => {
    const pc = f >= 0 ? mod12(GUITAR.midis[s] + f) : null;
    if (f < 0) {
      svg.append(sv('text', { x: GX0 - 30, y: yOf(s) + 5, class: 'cb-mute', 'text-anchor': 'middle' }, '×'));
    } else if (f === 0) {
      const g = sv('g', { class: 'cb-note open', 'data-pc': pc });
      g.append(sv('circle', { cx: GX0 - 30, cy: yOf(s), r: 9 }));
      svg.append(g); items.push(g);
    } else {
      const g = sv('g', { class: `cb-note${pc === tonePcs[0] ? ' root' : ''}`, 'data-pc': pc });
      g.append(sv('circle', { cx: xAt(f), cy: yOf(s), r: 13 }), sv('text', { x: xAt(f), y: yOf(s) + 5, 'text-anchor': 'middle' }, String(v.fingers[s] || '')));
      svg.append(g); items.push(g);
    }
  });
  if (start > 1) svg.append(sv('text', { x: GX0 + 6, y: GY0 - 20, class: 'cb-fretnum big' }, `${start}ª casa`));
  return { svg, items };
}


// ---- escala inteira no braço do violão -----------------------------------------------------------
const SFW = 60;
const SFRETS = 12;
function guitarScaleSvg(scale) {
  const set = new Set(scale.pcs);
  const svg = sv('svg', { viewBox: `0 0 ${GX0 + SFW * SFRETS + 16} ${GY0 + 5 * GAP + 40}`, class: 'cb-svg wide', role: 'img', 'aria-label': 'Notas da escala no braço do violão' });
  const xAt = (f) => GX0 + (f - 0.5) * SFW;
  svg.append(sv('rect', { x: GX0, y: GY0 - 14, width: SFW * SFRETS, height: 5 * GAP + 28, rx: 6, class: 'cb-wood' }));
  for (let k = 0; k <= SFRETS; k++) svg.append(sv('line', { x1: GX0 + k * SFW, x2: GX0 + k * SFW, y1: GY0 - 14, y2: GY0 + 5 * GAP + 14, class: k === 0 ? 'cb-nut' : 'cb-fret' }));
  for (let f = 1; f <= SFRETS; f++) {
    const cy = GY0 + 2.5 * GAP;
    if (f === 12) svg.append(sv('circle', { cx: xAt(f), cy: cy - GAP * 1.2, r: 4.5, class: 'cb-inlay' }), sv('circle', { cx: xAt(f), cy: cy + GAP * 1.2, r: 4.5, class: 'cb-inlay' }));
    else if ([3, 5, 7, 9].includes(f)) svg.append(sv('circle', { cx: xAt(f), cy, r: 5, class: 'cb-inlay' }));
    svg.append(sv('text', { x: xAt(f), y: GY0 + 5 * GAP + 34, class: 'cb-fretnum', 'text-anchor': 'middle' }, String(f)));
  }
  GUITAR.names.forEach((name, s) => {
    svg.append(sv('line', { x1: GX0 - 4, x2: GX0 + SFW * SFRETS, y1: yOf(s), y2: yOf(s), class: 'cb-string', 'stroke-width': 1.2 + (5 - s) * 0.35 }));
    svg.append(sv('text', { x: 14, y: yOf(s) + 4, class: 'cb-sname' }, name));
  });
  const items = [];
  GUITAR.midis.forEach((open, s) => {
    for (let f = 0; f <= SFRETS; f++) {
      const pc = mod12(open + f);
      if (!set.has(pc)) continue;
      const cx = f === 0 ? GX0 - 30 : xAt(f);
      const g = sv('g', { class: `cb-note scale${f === 0 ? ' open' : ''}${pc === scale.tonicPc ? ' root' : ''}`, 'data-pc': pc });
      g.append(sv('circle', { cx, cy: yOf(s), r: f === 0 ? 10 : 12 }), sv('text', { x: cx, y: yOf(s) + 3.5, 'text-anchor': 'middle' }, scale.names[pc] ?? ''));
      svg.append(g);
      items.push(g);
    }
  });
  return { svg, items };
}

// ---- teclado ----------------------------------------------------------------------------------
const WW = 38;
const WH = 150;
const BW = 23;
const BH = 94;
const TOP = 12; // tampa do teclado (sombra no alto)

function pianoSvg(midis, { range = null, rootPc = null, names = null } = {}) {
  let lo = Math.floor(Math.min(...midis) / 12) * 12;
  let hi = Math.ceil((Math.max(...midis) + 1) / 12) * 12;
  if (hi - lo < 24) hi = lo + 24;
  if (range) [lo, hi] = range;
  const targets = new Set(midis);
  const rootP = rootPc ?? mod12(Math.min(...midis));
  const whites = [];
  for (let m = lo; m <= hi; m++) if (!IS_BLACK[mod12(m)]) whites.push(m);
  const W = whites.length * WW + 8;
  const svg = sv('svg', { viewBox: `0 0 ${W} ${WH + TOP + 8}`, class: 'cb-svg piano', role: 'img', 'aria-label': 'Acorde no teclado' });
  const defs = sv('defs');
  const grad = (id, stops, dir = 'v') => {
    const g = sv('linearGradient', dir === 'v' ? { id, x1: 0, y1: 0, x2: 0, y2: 1 } : { id, x1: 0, y1: 0, x2: 1, y2: 0 });
    stops.forEach(([o, c, op = 1]) => g.append(sv('stop', { offset: o, 'stop-color': c, 'stop-opacity': op })));
    defs.append(g);
  };
  grad('pk-shade-w', [[0, '#000', 0.22], [0.12, '#000', 0], [0.82, '#000', 0], [1, '#000', 0.18]]);
  grad('pk-shade-b', [[0, '#fff', 0.2], [0.5, '#fff', 0.02], [1, '#000', 0.35]]);
  grad('pk-side-b', [[0, '#fff', 0.14], [0.25, '#fff', 0], [0.8, '#000', 0], [1, '#000', 0.3]], 'h');
  grad('pk-cover', [[0, '#050507'], [1, '#26262e']]);
  svg.append(defs);
  svg.append(sv('rect', { x: 0, y: 0, width: W, height: WH + TOP + 8, rx: 9, class: 'pk-frame' }));
  svg.append(sv('rect', { x: 4, y: 0, width: W - 8, height: TOP + 6, class: 'pk-cover', fill: 'url(#pk-cover)' }));
  const items = [];
  const xOfWhite = new Map(whites.map((m, i) => [m, 4 + i * WW]));
  const wkeys = sv('g');
  const bkeys = sv('g');
  const mark = (g, cx, cy, r, m) => {
    const mk = sv('g', { class: `pk-mark${mod12(m) === rootP ? ' root' : ''}`, 'data-pc': mod12(m) });
    mk.append(sv('circle', { cx, cy, r }), sv('text', { x: cx, y: cy + 3.5, 'text-anchor': 'middle', class: r < 12 ? 'sm' : '' }, (names && names[mod12(m)]) || SOLFEGE_PC[mod12(m)]));
    g.append(mk);
    items.push(mk);
  };
  whites.forEach((m) => {
    const x = xOfWhite.get(m);
    const t = targets.has(m);
    const g = sv('g', { class: `pk white${t ? ' target' : ''}`, 'data-pc': mod12(m) });
    g.append(
      sv('path', { d: `M${x} ${TOP} h${WW} v${WH - 6} a5 5 0 0 1 -5 5 h${-(WW - 10)} a5 5 0 0 1 -5 -5 z`, class: 'key' }),
      sv('path', { d: `M${x} ${TOP} h${WW} v${WH - 6} a5 5 0 0 1 -5 5 h${-(WW - 10)} a5 5 0 0 1 -5 -5 z`, fill: 'url(#pk-shade-w)', 'pointer-events': 'none' }),
    );
    wkeys.append(g);
    if (t) items.push(g);
    if (t) mark(wkeys, x + WW / 2, TOP + WH - 24, 13, m);
  });
  for (let m = lo; m <= hi; m++) {
    if (!IS_BLACK[mod12(m)] || !xOfWhite.has(m - 1)) continue;
    const x = xOfWhite.get(m - 1) + WW - BW / 2;
    const t = targets.has(m);
    const g = sv('g', { class: `pk black${t ? ' target' : ''}`, 'data-pc': mod12(m) });
    g.append(
      sv('rect', { x: x + 1, y: TOP + 2, width: BW, height: BH, rx: 4, fill: '#000', opacity: 0.35 }), // sombra
      sv('path', { d: `M${x} ${TOP} h${BW} v${BH - 5} a4 4 0 0 1 -4 4 h${-(BW - 8)} a4 4 0 0 1 -4 -4 z`, class: 'key' }),
      sv('path', { d: `M${x} ${TOP} h${BW} v${BH - 5} a4 4 0 0 1 -4 4 h${-(BW - 8)} a4 4 0 0 1 -4 -4 z`, fill: 'url(#pk-side-b)', 'pointer-events': 'none' }),
      sv('rect', { x: x + 3.5, y: TOP + 2, width: BW - 7, height: BH - 18, rx: 2.5, fill: 'url(#pk-shade-b)', 'pointer-events': 'none' }),
    );
    bkeys.append(g);
    if (t) items.push(g);
    if (t) mark(bkeys, x + BW / 2, TOP + BH - 24, 10.5, m);
  }
  svg.append(wkeys, bkeys);
  return { svg, items };
}

/** Quadro do acorde. set(instr, acorde) desenha; setHeard(pcs) acende as notas reconhecidas. */
export function createChordBoard() {
  const el = h('div', { class: 'chord-board' });
  let items = [];
  let heard = new Set();
  const paint = () => items.forEach((g) => g.classList.toggle('heard', heard.has(Number(g.getAttribute('data-pc')))));
  return {
    el,
    set(instr, chord) {
      const r = instr === 'guitar' && chord.voicing ? guitarSvg(chord.voicing, chord.pcs) : pianoSvg(chord.midis ?? [], { rootPc: chord.rootPc });
      items = r.items;
      el.replaceChildren(r.svg);
      paint();
    },
    /** A escala inteira no instrumento: todas as casas do violão (0 a 12) ou duas oitavas do teclado. */
    setScale(instr, scale, octave = 4) {
      const set = new Set(scale.pcs);
      let r;
      if (instr === 'guitar') r = guitarScaleSvg(scale);
      else {
        const lo = 12 * (octave + 1);
        const notes = Array.from({ length: 25 }, (_, k) => lo + k).filter((m) => set.has(mod12(m)));
        r = pianoSvg(notes, { range: [lo, lo + 24], rootPc: scale.tonicPc, names: scale.names });
      }
      items = r.items;
      el.replaceChildren(r.svg);
      paint();
    },
    clear() { items = []; el.replaceChildren(); },
    setHeard(pcs) {
      const next = new Set(pcs);
      if (next.size === heard.size && [...next].every((p) => heard.has(p))) return;
      heard = next;
      paint();
    },
  };
}
