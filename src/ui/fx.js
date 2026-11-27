// Efeitos de recompensa: partículas, texto flutuante, tremida e combo. Só usa transform/opacity (leve, não atrapalha a escuta).
import { sfx } from './sfx.js';

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

let layer = null;
function getLayer() {
  if (!layer || !layer.isConnected) {
    layer = document.createElement('div');
    layer.className = 'fx-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.append(layer);
  }
  return layer;
}

const VAR = { perfect: '--ok', good: '--ok', ok: '--ok', tune: '--brand', warn: '--warn', err: '--err', extra: '--err' };
const colorOf = (kind) => `var(${VAR[kind] || '--brand'})`;

/** Centro de um elemento em coordenadas da janela. */
function center(el) {
  if (!el || !el.isConnected) return { x: innerWidth / 2, y: innerHeight / 2 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function spawn(cls, x, y) {
  const e = document.createElement('span');
  e.className = cls;
  e.style.left = `${x}px`;
  e.style.top = `${y}px`;
  getLayer().append(e);
  return e;
}

/** Explosão de partículas ao redor de um elemento. */
export function burst(anchor, kind = 'ok', { n = 16, spread = 70 } = {}) {
  if (reduced()) return;
  const { x, y } = center(anchor);
  for (let i = 0; i < n; i++) {
    const p = spawn('fx-p', x, y);
    p.style.background = colorOf(kind);
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.6;
    const d = spread * (0.55 + Math.random() * 0.75);
    const s = 4 + Math.random() * 5;
    p.style.width = `${s}px`;
    p.style.height = `${s}px`;
    p.animate([
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d + 14}px)) scale(.2)`, opacity: 0 },
    ], { duration: 520 + Math.random() * 260, easing: 'cubic-bezier(.16,.8,.3,1)', fill: 'forwards' }).onfinish = () => p.remove();
  }
}

/** Texto que sobe e some ("Perfeito +10"). */
export function pop(anchor, text, kind = 'ok') {
  if (reduced() || !text) return;
  const { x, y } = center(anchor);
  const t = spawn(`fx-pop ${kind}`, x, y - 10);
  t.textContent = text;
  t.style.color = colorOf(kind);
  t.animate([
    { transform: 'translate(-50%,0) scale(.6)', opacity: 0 },
    { transform: 'translate(-50%,-14px) scale(1.12)', opacity: 1, offset: 0.25 },
    { transform: 'translate(-50%,-52px) scale(1)', opacity: 0 },
  ], { duration: 900, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' }).onfinish = () => t.remove();
}

/** Brilho de borda no painel (acerto ou erro). */
export function flash(el, kind = 'ok') {
  if (reduced() || !el) return;
  el.animate([
    { boxShadow: `0 0 0 0 color-mix(in srgb, ${colorOf(kind)} 70%, transparent)` },
    { boxShadow: `0 0 0 14px color-mix(in srgb, ${colorOf(kind)} 0%, transparent)` },
  ], { duration: 520, easing: 'ease-out' });
}

// ---- combo ----
let combo = 0;
let best = 0;
export const getCombo = () => combo;
function emit() { window.dispatchEvent(new CustomEvent('combochange', { detail: { combo, best } })); }
export function resetCombo() { if (combo) { combo = 0; emit(); } }

/**
 * Reação a um resultado. kind: perfect | good | ok (acerto) · warn (quase) · err | extra (erro).
 * anchor: elemento de onde saem os efeitos (a pauta). panel: elemento que pisca (opcional).
 */
export function hit(anchor, kind, text = '', panel = null) {
  const good = kind === 'perfect' || kind === 'good' || kind === 'ok';
  sfx(kind === 'good' ? 'ok' : kind === 'tune' ? 'warn' : kind === 'extra' ? 'err' : kind);
  if (good) {
    combo += 1;
    best = Math.max(best, combo);
    emit();
    burst(anchor, kind, { n: kind === 'perfect' ? 22 : 14 });
    pop(anchor, combo >= 3 ? `${text || 'Certo'} ×${combo}` : text, kind);
    flash(panel || anchor, 'ok');
  } else if (kind === 'warn' || kind === 'tune') {
    pop(anchor, text, kind);
  } else {
    resetCombo();
    pop(anchor, text, 'err');
    flash(panel || anchor, 'err');
  }
}
