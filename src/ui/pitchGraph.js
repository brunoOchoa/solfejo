// Gráfico de afinação em canvas: trilha da voz rolando no tempo sobre faixas de semitons,
// com as notas-alvo desenhadas como barras (estilo "piano roll").
import { h } from '../dom.js';
import { pitchClassName } from '../music/theory.js';

const NATURALS = new Set([0, 2, 4, 5, 7, 9, 11]);
const LEFT = 38;

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const g = (v) => cs.getPropertyValue(v).trim();
  return {
    ink: g('--ink'), muted: g('--muted'), line: g('--line'), bg: g('--bg'),
    brand: g('--brand') || '#7c5cff', ok: g('--ok'), warn: g('--warn'), err: g('--err'),
  };
}

/**
 * Alvos: { t0, t1, midi, grade? } com t em ms (mesma base de performance.now()).
 * Use t0 = -Infinity e t1 = Infinity para uma nota fixa (faixa de tolerância).
 * Modo `nearest` (prática livre): vários alvos fixos ao mesmo tempo (as notas da escala); a linha e a leitura
 * numérica comparam com o alvo mais próximo. `setMarkers` desenha as notas tocadas ({t, midi, label, color}).
 */
export function createPitchGraph({ height = 220 } = {}) {
  const noteEl = h('div', { class: 'pg-note', text: '—' });
  const centsEl = h('div', { class: 'pg-cents', text: 'sem voz detectada' });
  const canvas = h('canvas', { class: 'pg-canvas', role: 'img', 'aria-label': 'Gráfico da afinação da sua voz', style: `height:${height}px` });
  const msg = h('p', { class: 'hint pg-msg' });
  const el = h('div', { class: 'pgraph' }, h('div', { class: 'pg-readout' }, noteEl, centsEl), canvas, msg);
  const g = canvas.getContext('2d');

  let colors = readColors();
  const onScheme = () => { colors = readColors(); };
  window.addEventListener('themechange', onScheme);

  let samples = [];
  let targets = [];
  let cfg = {
    fold: true, back: 4000, ahead: 0, tolCents: 25, nearest: false, maxSamples: 400,
  };
  let frozenAt = null; // ao terminar a prática livre o gráfico para, para você rever as notas
  let markers = [];
  let last = null;
  let view = null;
  let centerM = null;
  let shownN = null;
  let raf = 0;
  let alive = true;

  const activeTarget = (t) => targets.find((x) => t >= x.t0 && t < x.t1) || null;
  // alvo mais próximo (modo livre): só vale se a nota estiver a menos de ~0,75 semitom dele
  const nearestTarget = (m) => {
    let best = null;
    for (const tg of targets) if (!best || Math.abs(tg.midi - m) < Math.abs(best.midi - m)) best = tg;
    return best && Math.abs(best.midi - m) <= 0.75 ? best : null;
  };

  function push(sm) {
    samples.push({ t: sm.t, m: sm.midi });
    if (samples.length > cfg.maxSamples) samples = samples.slice(-Math.round(cfg.maxSamples * 0.75));
    last = sm;
    if (sm.midi != null) centerM = centerM == null ? sm.midi : centerM + (sm.midi - centerM) * 0.04;
  }

  function draw() {
    if (!alive) return;
    raf = requestAnimationFrame(draw);
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (!W || !H) return;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const now = frozenAt ?? performance.now();

    // faixa vertical (suavizada para não "pular")
    let lo;
    let hi;
    if (targets.length) {
      const ms = targets.map((x) => x.midi);
      const padM = cfg.nearest ? 1.5 : 3;
      lo = Math.min(...ms) - padM;
      hi = Math.max(...ms) + padM;
      if (hi - lo < 11) { const c = (lo + hi) / 2; lo = c - 5.5; hi = c + 5.5; }
    } else {
      const c = centerM ?? 60;
      lo = c - 5.5;
      hi = c + 5.5;
    }
    view = view ? { lo: view.lo + (lo - view.lo) * 0.15, hi: view.hi + (hi - view.hi) * 0.15 } : { lo, hi };

    const top = 8;
    const bottom = H - 8;
    const right = W - 8;
    const plotW = right - LEFT;
    const y = (m) => bottom - ((m - view.lo) / (view.hi - view.lo)) * (bottom - top);
    const total = cfg.back + cfg.ahead;
    const nowX = LEFT + plotW * (cfg.back / total) - (cfg.ahead === 0 ? 14 : 0);
    const pps = plotW / (total + (cfg.ahead === 0 ? total * 0.04 : 0));
    const x = (t) => nowX + (t - now) * pps;

    // grade de semitons
    g.font = "11px 'JetBrains Mono', ui-monospace, monospace";
    g.textBaseline = 'middle';
    const span = view.hi - view.lo;
    let lastLabelY = -Infinity;
    for (let s = Math.floor(view.hi); s >= Math.ceil(view.lo); s--) {
      const nat = NATURALS.has(((s % 12) + 12) % 12);
      const yy = y(s);
      g.strokeStyle = colors.line;
      g.globalAlpha = cfg.nearest ? 0.5 : nat ? 0.9 : 0.35;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(LEFT, yy);
      g.lineTo(right, yy);
      g.stroke();
      const inScale = cfg.nearest && targets.some((tg) => Math.round(tg.midi) === s);
      if (cfg.nearest) {
        if (inScale && yy - lastLabelY >= 12) { // sem sobrepor nomes quando as notas ficam apertadas
          lastLabelY = yy;
          g.globalAlpha = 1;
          g.fillStyle = colors.ink;
          g.font = "700 11px 'JetBrains Mono', ui-monospace, monospace";
          g.fillText(pitchClassName(s), 4, yy);
          g.font = "11px 'JetBrains Mono', ui-monospace, monospace";
        }
      } else if (nat || span < 14) {
        g.globalAlpha = nat ? 0.9 : 0.5;
        g.fillStyle = nat ? colors.ink : colors.muted;
        g.fillText(pitchClassName(s), 4, yy);
      }
    }
    g.globalAlpha = 1;

    // alvos
    for (const tg of targets) {
      const infinite = !Number.isFinite(tg.t0);
      const x0 = infinite ? LEFT : Math.max(LEFT, x(tg.t0));
      const x1 = infinite ? right : Math.min(right, x(tg.t1));
      if (x1 <= LEFT || x0 >= right || x1 <= x0) continue;
      const color = tg.grade ? colors[tg.grade === 'perfect' || tg.grade === 'good' ? 'ok' : tg.grade === 'ok' ? 'warn' : 'err'] : colors.brand;
      const active = now >= tg.t0 && now < tg.t1;
      if (infinite) {
        const tol = cfg.tolCents / 100;
        g.globalAlpha = cfg.nearest ? 0.1 : 0.22;
        g.fillStyle = color;
        g.fillRect(x0, y(tg.midi + tol), x1 - x0, y(tg.midi - tol) - y(tg.midi + tol));
        g.globalAlpha = cfg.nearest ? 0.4 : 0.9;
        g.strokeStyle = color;
        g.lineWidth = cfg.nearest ? 1 : 2;
        g.setLineDash(cfg.nearest ? [2, 5] : [6, 5]);
        g.beginPath();
        g.moveTo(x0, y(tg.midi));
        g.lineTo(x1, y(tg.midi));
        g.stroke();
        g.setLineDash([]);
      } else {
        const bh = Math.max(8, y(tg.midi - 0.5) - y(tg.midi + 0.5)) * 0.7;
        g.globalAlpha = active ? 0.55 : 0.28;
        g.fillStyle = color;
        g.beginPath();
        g.roundRect(x0 + 1, y(tg.midi) - bh / 2, Math.max(2, x1 - x0 - 2), bh, 5);
        g.fill();
      }
      g.globalAlpha = 1;
    }

    // trilha da voz
    const tol = cfg.tolCents || 25;
    const center = (view.lo + view.hi) / 2;
    g.lineWidth = 3.5;
    g.lineCap = 'round';
    let prev = null;
    for (const s of samples) {
      if (s.m == null || s.t < now - cfg.back - 200) { prev = null; continue; }
      let m = s.m;
      const tg = cfg.nearest ? nearestTarget(m) : activeTarget(s.t);
      if (targets.length && cfg.fold) {
        const ref = tg ? tg.midi : center;
        m += 12 * Math.round((ref - m) / 12);
      }
      const rawY = y(m);
      const p = { x: x(s.t), y: Math.max(top, Math.min(bottom, rawY)), m, t: s.t, out: rawY < top || rawY > bottom };
      if (prev && p.t - prev.t <= 130 && Math.abs(p.m - prev.m) < 2.5) {
        const dev = tg ? Math.abs(p.m - tg.midi) * 100 : Infinity;
        g.globalAlpha = p.out ? 0.35 : 1; // fora da faixa do gráfico: aparece apagado na borda
        g.strokeStyle = !tg ? colors.brand : dev <= tol ? colors.ok : dev <= 50 ? colors.warn : colors.brand;
        g.beginPath();
        g.moveTo(prev.x, prev.y);
        g.lineTo(p.x, p.y);
        g.stroke();
        g.globalAlpha = 1;
      }
      prev = p;
    }
    if (prev && now - prev.t < 300) {
      g.fillStyle = colors.ink;
      g.beginPath();
      g.arc(prev.x, prev.y, 5, 0, Math.PI * 2);
      g.fill();
    }

    // notas tocadas (prática livre): linha ligando as notas em ordem, bolinha no início de cada uma e o nome ao lado
    if (markers.length) {
      const vis = markers
        .filter((mk) => mk.t >= now - cfg.back && x(mk.t) >= LEFT && x(mk.t) <= right)
        .map((mk) => ({ ...mk, mx: x(mk.t), my: Math.max(top + 6, Math.min(bottom - 6, y(mk.midi))) }));
      g.strokeStyle = colors.muted;
      g.globalAlpha = 0.4;
      g.lineWidth = 1.5;
      g.beginPath();
      let started = false;
      for (const mk of vis) {
        if (mk.extra) continue; // notas repetidas/fora da escala não entram no contorno
        if (started) g.lineTo(mk.mx, mk.my); else g.moveTo(mk.mx, mk.my);
        started = true;
      }
      g.stroke();
      g.globalAlpha = 1;
      g.font = "700 10px 'JetBrains Mono', ui-monospace, monospace";
      g.textAlign = 'left';
      for (const mk of vis) {
        g.fillStyle = colors[mk.color] || mk.color;
        g.beginPath();
        g.arc(mk.mx, mk.my, mk.extra ? 4 : 6.5, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = colors.bg;
        g.lineWidth = 2;
        g.stroke();
        g.fillStyle = colors.ink;
        g.fillText(mk.label, mk.mx + 8, Math.max(top + 8, mk.my - 12)); // à direita e acima: o próximo ponto fica mais longe
      }
      g.textAlign = 'start';
      g.font = "11px 'JetBrains Mono', ui-monospace, monospace";
    }

    // linha do "agora"
    g.strokeStyle = colors.muted;
    g.globalAlpha = 0.6;
    g.lineWidth = 1;
    g.setLineDash([3, 4]);
    g.beginPath();
    g.moveTo(nowX, top);
    g.lineTo(nowX, bottom);
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;
  }

  // leitura numérica (atualiza devagar e com histerese para não piscar)
  const readoutTimer = setInterval(() => {
    if (last && last.midi != null && !(performance.now() - last.t > 400)) {
      const m = last.midi;
      const tg = cfg.nearest ? nearestTarget(m) : null;
      if (tg) { // prática livre: compara com a nota da escala mais próxima
        shownN = Math.round(tg.midi);
        const c = Math.round((m - tg.midi) * 100);
        const st = Math.abs(c) <= cfg.tolCents ? 'ok' : Math.abs(c) <= 50 ? 'warn' : 'err';
        noteEl.textContent = pitchClassName(shownN);
        centsEl.textContent = `${c > 0 ? '+' : ''}${c} cents`;
        el.dataset.state = st;
      } else {
        if (shownN === null || Math.abs(m - shownN) > 0.62) shownN = Math.round(m);
        const c = Math.round((m - shownN) * 100);
        noteEl.textContent = pitchClassName(shownN);
        centsEl.textContent = `${c > 0 ? '+' : ''}${c} cents`;
        el.dataset.state = cfg.nearest ? 'out' : '';
      }
    } else {
      shownN = null;
      noteEl.textContent = '—';
      centsEl.textContent = 'sem voz detectada';
      el.dataset.state = '';
    }
  }, 120);

  raf = requestAnimationFrame(draw);

  return {
    el,
    push,
    setTargets(list) { targets = list; },
    setConfig(patch) { cfg = { ...cfg, ...patch }; },
    setMarkers(list) { markers = list; },
    freeze() { frozenAt = performance.now(); },
    unfreeze() { frozenAt = null; },
    setHeight(px) {
      canvas.style.height = `${px}px`;
      el.style.setProperty('--tall-h', `${px}px`);
      el.classList.toggle('tall', px > 160);
    },
    setMessage(text) { msg.textContent = text || ''; },
    reset() { samples = []; markers = []; last = null; centerM = null; shownN = null; frozenAt = null; },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      clearInterval(readoutTimer);
      window.removeEventListener('themechange', onScheme);
    },
  };
}
