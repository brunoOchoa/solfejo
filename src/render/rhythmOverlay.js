// Camada animada sobre a partitura rítmica: guias de tempo, linha de reprodução e marcadores de acerto.
const NS = 'http://www.w3.org/2000/svg';
const COLORS = { perfect: '#22c55e', good: '#65a30d', ok: '#f59e0b', miss: '#f43f5e', listen: '#5ad6ff', extra: '#f43f5e' };

function node(tag, attrs = {}) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

// A folha de estilo global define "svg text { fill: currentColor }", que vence atributos de apresentação.
// Por isso as cores do overlay vão em style (e usam as variáveis do tema, legíveis no claro e no escuro).
function text(attrs, fill, content) {
  const t = node('text', attrs);
  t.style.fill = fill;
  t.style.stroke = 'none'; // o <svg> do VexFlow define stroke preto de 1px; sem isto o texto herda um contorno escuro
  t.textContent = content;
  return t;
}

export function createOverlay(svg, layout, { showBeats = true, showMs = true } = {}) {
  const g = node('g', { class: 'rh-overlay' });
  svg.append(g);
  const measures = layout.points.length;
  const total = measures * layout.unitsPerMeasure;

  /** Posição (x, linha) para um instante em ticks desde o início do ritmo. */
  function posAt(u) {
    const clamped = Math.max(0, Math.min(total - 1e-6, u));
    const m = Math.floor(clamped / layout.unitsPerMeasure);
    const local = clamped - m * layout.unitsPerMeasure;
    const pts = layout.points[m];
    let k = 0;
    while (k < pts.length - 2 && pts[k + 1].u <= local) k++;
    const a = pts[k];
    const b = pts[k + 1];
    const f = b.u === a.u ? 0 : (local - a.u) / (b.u - a.u);
    const row = layout.measureRow[m];
    return { x: a.x + (b.x - a.x) * f, lineY: layout.rowLineY[row] };
  }

  // guias de tempo: linha fina e número do tempo acima da pauta
  if (showBeats) {
    for (let m = 0; m < measures; m++) {
      for (let k = 0; k < layout.beats; k++) {
        const p = posAt(m * layout.unitsPerMeasure + k * layout.beatTicks);
        const guide = node('line', {
          x1: p.x, x2: p.x, y1: p.lineY - 44, y2: p.lineY + 24, 'stroke-width': 1, 'stroke-dasharray': '2 4', 'stroke-linecap': 'round',
        });
        guide.style.stroke = 'var(--muted)';
        guide.style.opacity = k === 0 ? 0.45 : 0.28;
        g.append(guide);
        g.append(text(
          { x: p.x, y: p.lineY - 54, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': k === 0 ? 800 : 600 },
          k === 0 ? 'var(--ink)' : 'var(--muted)', String(k + 1),
        ));
      }
    }
  }

  const playhead = node('line', {
    stroke: COLORS.listen, 'stroke-width': 3, 'stroke-linecap': 'round', visibility: 'hidden', opacity: 0.95,
  });
  g.append(playhead);

  const markers = layout.onsets.map((o) => {
    const y = layout.rowLineY[o.row] + 36;
    const dot = node('circle', { cx: o.x, cy: y, r: 6, fill: 'none', 'stroke-width': 1.5 });
    dot.style.stroke = 'var(--muted)';
    const label = text({ x: o.x, y: y + 21, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700 }, 'var(--ink)', '');
    g.append(dot, label);
    return { dot, label };
  });

  function paint(m, color, r) {
    m.dot.setAttribute('fill', color);
    m.dot.style.stroke = color;
    m.dot.setAttribute('r', r);
  }

  return {
    /** u em ticks (ou null para esconder). */
    setPlayhead(u) {
      if (u === null) {
        playhead.setAttribute('visibility', 'hidden');
        return;
      }
      const p = posAt(u);
      playhead.setAttribute('x1', p.x);
      playhead.setAttribute('x2', p.x);
      playhead.setAttribute('y1', p.lineY - 46);
      playhead.setAttribute('y2', p.lineY + 56);
      playhead.setAttribute('visibility', 'visible');
    },
    /** Marca uma nota esperada: grade perfect|good|ok|miss, delta em ms (tap − esperado). */
    markOnset(i, grade, delta = null) {
      const m = markers[i];
      if (!m) return;
      paint(m, COLORS[grade], grade === 'miss' ? 5 : 7);
      m.label.textContent = showMs && delta !== null ? `${delta > 0 ? '+' : ''}${Math.round(delta)}` : '';
    },
    /** Acende a nota que acabou de soar (modo "Ouvir"). */
    markListen(i) {
      const m = markers[i];
      if (m) paint(m, COLORS.listen, 7);
    },
    /** Batida sem nota correspondente: "×" na posição em que você bateu. */
    addExtra(u) {
      const p = posAt(u);
      const x = text({ x: p.x, y: p.lineY + 42, 'text-anchor': 'middle', 'font-size': 20, 'font-weight': 800 }, COLORS.extra, '×');
      x.style.opacity = 0.9;
      g.append(x);
    },
  };
}
