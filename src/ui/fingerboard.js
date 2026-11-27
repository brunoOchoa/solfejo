// Braço do violino em vista horizontal: mostra a nota-alvo (ou a escala inteira) com a digitação sugerida
// e um cursor ao vivo que anda pela corda conforme a altura que você toca. Mesma interface do gráfico de
// afinação (pitchGraph), para poder trocar um pelo outro.
import { h } from '../dom.js';
import { pitchClassName } from '../music/theory.js';
import { VIOLIN_STRINGS, placeNote, stringFraction } from '../music/fingering.js';

const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}, text = null) => {
  const e = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  if (text != null) e.textContent = text;
  return e;
};

const X0 = 60; // pestana
const X1 = 640; // fim do braço (a corda continua até o cavalete, fora do desenho)
const VX0 = 12; // o desenho começa logo antes dos nomes das cordas (sem margem vazia à esquerda)
const VY0 = 44; // ... e é cortado rente ao braço, para ficar centralizado na vertical
const VH = 226;
const K = 800; // comprimento (em px) da corda inteira: a posição de cada nota vem da razão de frequências
const NUT_Y = [190, 164, 138, 112]; // Sol, Ré, Lá, Mi na pestana (26 px entre cordas: cabem os círculos dos dedos)
const BR_Y = [232, 180, 128, 76]; // ... e no fim do braço
const xOf = (cents) => X0 + K * stringFraction(cents);
const yAt = (si, x) => NUT_Y[si] + (BR_Y[si] - NUT_Y[si]) * ((x - X0) / (X1 - X0));
const FINGER_DOTS = [2, 4, 5, 7]; // semitons onde costumam ficar os dedos na 1ª posição

/** midi (pode ser fracionário) → { x, y, string } na posição pedida, ou null se estiver abaixo do Sol grave. */
function spot(midi, position) {
  const pl = placeNote(midi, position);
  if (!pl) return null;
  const cents = (midi - VIOLIN_STRINGS.midis[pl.string]) * 100;
  const x = xOf(Math.max(0, cents));
  return {
    x, y: yAt(pl.string, x), string: pl.string, finger: pl.finger,
  };
}

const COLOR = { ok: 'var(--ok)', err: 'var(--err)', warn: 'var(--warn)', muted: 'var(--muted)' };

export function createFingerboard({ position = '1' } = {}) {
  let cfg = { tolCents: 25, nearest: false, position };
  let targets = [];
  let markers = [];
  let nextMidi = null;
  let names = new Map(); // nome de cada nota como está na pauta (MIDI → nome); sem isso valeria sempre o nome com sustenido
  const nameOf = (m) => names.get(Math.round(m)) ?? pitchClassName(m);
  let scale = []; // notas da escala mostradas no braço o tempo todo (guiado e metrônomo)
  let liveAct = [];
  let scaleNow = new Set(); // notas que já têm nome desenhado (escala ou fantasmas)
  let hotNow = new Set(); // nota(s) da vez: o nome dela ganha destaque
  let liveNxt = null;
  let last = null;
  let sig = '';

  const noteEl = h('div', { class: 'pg-note', text: '—' });
  const centsEl = h('div', { class: 'pg-cents', text: 'sem som detectado' });
  const msg = h('p', { class: 'hint pg-msg' });

  const svg = sv('svg', {
    viewBox: `${VX0} ${VY0} ${520 - VX0} ${VH}`, class: 'fb-svg', role: 'img', 'aria-label': 'Braço do violino com a nota-alvo e o ponto onde você está tocando',
  });
  const el = h('div', { class: 'pgraph fb' }, h('div', { class: 'pg-readout' }, noteEl, centsEl), svg, msg);

  // ---- camada fixa: braço, cordas, marcas ----
  svg.append(
    sv('polygon', { points: '60,92 640,50 640,258 60,208', class: 'fb-board' }),
    sv('rect', { x: 52, y: 88, width: 8, height: 124, rx: 2, class: 'fb-nut' }),
  );
  for (let s = 1; s <= 22; s++) {
    const x = xOf(s * 100);
    const dots = [0, 1, 2, 3].map((i) => {
      const big = FINGER_DOTS.includes(s);
      return sv('circle', { cx: x, cy: yAt(i, x), r: big ? 3 : 1.6, class: big ? 'fb-tick big' : 'fb-tick' });
    });
    svg.append(...dots);
  }
  VIOLIN_STRINGS.names.forEach((name, i) => {
    svg.append(
      sv('line', {
        x1: X0, y1: NUT_Y[i], x2: X1, y2: BR_Y[i], class: 'fb-string', 'stroke-width': 1 + (3 - i) * 0.25,
      }),
      sv('text', { x: 28, y: NUT_Y[i] + 4, class: 'fb-name', 'text-anchor': 'middle' }, name),
    );
  });
  svg.append(sv('text', { x: 56, y: 232, class: 'fb-cap', 'text-anchor': 'middle' }, 'pestana'));
  const capEnd = sv('text', { x: 440, y: 262, class: 'fb-cap', 'text-anchor': 'end' }, 'rumo ao cavalete →');
  svg.append(capEnd);

  const layer = sv('g');
  const cursor = sv('g', { class: 'fb-cursor' });
  const ring = sv('circle', { r: 12, class: 'fb-cring' });
  const dot = sv('circle', { r: 4.5, class: 'fb-cdot' });
  cursor.append(ring, dot);
  cursor.style.opacity = '0';
  svg.append(layer, cursor);

  // ---- camada dinâmica: escala fantasma, alvo, próxima, notas tocadas ----
  const ghost = (midi, { cls, label = true, r = 9 }) => {
    const sp = spot(midi, cfg.position);
    if (!sp) return;
    const g = sv('g', { class: cls });
    const key = Math.round(midi);
    g.append(sv('circle', { cx: sp.x, cy: sp.y, r, class: 'fb-gc' }));
    g.append(sv('text', {
      x: sp.x, y: sp.y + 4, class: 'fb-finger', 'text-anchor': 'middle',
    }, sp.finger));
    // o nome aparece uma vez só: não na corda solta (o nome da corda está à esquerda) e não repetido no alvo/próxima, que ficam sobre a escala
    const dup = !cls.includes('fb-ghost') && scaleNow.has(key);
    if (label && sp.finger !== 0 && !dup) {
      g.append(sv('text', { x: sp.x, y: sp.y - r - 5, class: `fb-note${hotNow.has(key) && cls.includes('fb-ghost') ? ' hot' : ''}`, 'text-anchor': 'middle' }, nameOf(midi)));
    }
    layer.append(g);
    return g;
  };

  function activeTargets(now) {
    if (cfg.nearest) return { all: [...new Set(targets.map((t) => Math.round(t.midi)))], act: [], nxt: null };
    const act = targets.filter((t) => now >= t.t0 && now < t.t1);
    const nxt = targets.filter((t) => t.t0 > now).sort((a, b) => a.t0 - b.t0)[0] || null;
    return { all: [], act, nxt };
  }

  let vbW = 520;
  function fit(midis) {
    let maxX = 0;
    midis.forEach((m) => { const sp = spot(m, cfg.position); if (sp) maxX = Math.max(maxX, sp.x); });
    const want = Math.max(520, Math.min(680, maxX + 90));
    if (want > vbW) {
      vbW = want;
      svg.setAttribute('viewBox', `${VX0} ${VY0} ${vbW - VX0} ${VH}`);
      capEnd.setAttribute('x', vbW - 20);
    }
  }

  function render() {
    const now = performance.now();
    const { all, act, nxt } = activeTargets(now);
    const scaleSet = cfg.nearest ? [] : [...new Set(scale.map((m) => Math.round(m)))];
    const key = JSON.stringify([cfg.position, cfg.nearest, all, scaleSet, act.map((t) => [t.midi, t.grade, Number.isFinite(t.t0)]), nxt?.midi, nextMidi, markers.map((m) => [m.t, m.midi, m.color, m.extra])]);
    if (key !== sig) {
      sig = key;
      scaleNow = new Set([...scaleSet, ...all]);
      hotNow = new Set(act.map((t) => Math.round(t.midi)));
      fit([...all, ...scaleSet, ...act.map((t) => t.midi), nxt?.midi, ...markers.map((m) => m.midi)].filter((m) => m != null));
      layer.replaceChildren();
      markers.forEach((mk) => {
        const sp = spot(mk.midi, cfg.position);
        if (!sp) return;
        const c = sv('circle', {
          cx: sp.x, cy: sp.y, r: mk.extra ? 3.5 : 5, class: 'fb-mark', opacity: mk.extra ? 0.6 : 0.9,
        });
        c.style.fill = COLOR[mk.color] || mk.color;
        layer.prepend(c);
      });
      all.forEach((m) => ghost(m, { cls: `fb-ghost${nextMidi != null && Math.round(nextMidi) === m ? ' next' : ''}` }));
      scaleSet.forEach((m) => ghost(m, { cls: 'fb-ghost fb-scale', r: 8.5 }));
      liveNxt = nxt && !act.some((t) => t.midi === nxt.midi) ? ghost(nxt.midi, { cls: `fb-next${Number.isFinite(nxt.t0) ? ' timed' : ''}`, r: 10 }) : null;
      liveAct = act.map((t) => ghost(t.midi, { cls: `fb-target${t.grade ? ' done' : ''}${Number.isFinite(t.t0) ? ' timed' : ''}`, r: 13 }));
    }
    // cor e pulso da nota conforme o tempo: a próxima esquenta até a hora de tocar; a atual vai de verde (agora!) a âmbar (atrasando)
    if (liveNxt && nxt) liveNxt.style.setProperty('--u', Math.max(0, Math.min(1, 1 - (nxt.t0 - now) / 1600)).toFixed(2));
    act.forEach((t, i) => {
      if (liveAct[i] && Number.isFinite(t.t0)) liveAct[i].style.setProperty('--p', Math.max(0, Math.min(1, (now - t.t0) / (t.t1 - t.t0))).toFixed(2));
    });

    // cursor ao vivo
    const fresh = last && last.midi != null && now - last.t < 350;
    const sp = fresh ? spot(last.midi, cfg.position) : null;
    if (sp) {
      cursor.style.opacity = '1';
      cursor.style.transform = `translate(${sp.x}px, ${sp.y}px)`;
      // cor: compara com o alvo mais próximo (alvo atual ou nota da escala)
      const pool = cfg.nearest ? all : act.map((t) => t.midi);
      let best = null;
      pool.forEach((m) => { if (best == null || Math.abs(m - last.midi) < Math.abs(best - last.midi)) best = m; });
      const near = best != null && Math.abs(best - last.midi) <= 0.75 ? best : null;
      let state = 'out';
      if (near != null) {
        const c = Math.round((last.midi - near) * 100);
        state = Math.abs(c) <= cfg.tolCents ? 'ok' : Math.abs(c) <= 50 ? 'warn' : 'err';
        noteEl.textContent = nameOf(near);
        centsEl.textContent = `${c > 0 ? '+' : ''}${c} cents`;
      } else {
        const n = Math.round(last.midi);
        const c = Math.round((last.midi - n) * 100);
        noteEl.textContent = nameOf(n);
        centsEl.textContent = `${c > 0 ? '+' : ''}${c} cents`;
      }
      cursor.setAttribute('data-state', state);
      el.dataset.state = state;
    } else {
      cursor.style.opacity = '0';
      noteEl.textContent = '—';
      centsEl.textContent = 'sem som detectado';
      el.dataset.state = '';
    }
  }

  const timer = setInterval(render, 50);
  render();

  return {
    el,
    push(sm) { last = sm; },
    setTargets(list) { targets = list; },
    setConfig(patch) { cfg = { ...cfg, ...patch }; },
    setMarkers(list) { markers = list; },
    setNext(m) { nextMidi = m; },
    setScale(list) { scale = list || []; sig = ''; },
    setNames(map) { names = map || new Map(); sig = ''; },
    setMessage(text) { msg.textContent = text || ''; },
    setHeight() {},
    freeze() {},
    unfreeze() {},
    reset() {
      last = null; markers = []; nextMidi = null; sig = '';
    },
    resetView() {
      vbW = 520;
      svg.setAttribute('viewBox', `${VX0} ${VY0} ${520 - VX0} ${VH}`);
      capEnd.setAttribute('x', 440);
      sig = '';
    },
    destroy() { clearInterval(timer); },
  };
}
