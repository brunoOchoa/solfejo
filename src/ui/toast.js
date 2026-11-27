// Avisos curtos (XP, medalhas, meta) e a celebração de subida de nível. Fila simples, um de cada vez por canto.
import { burst } from './fx.js';

let box = null;
function getBox() {
  if (!box || !box.isConnected) {
    box = document.createElement('div');
    box.className = 'toasts';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.append(box);
  }
  return box;
}

/** icon: emoji · title/text: textos · kind: 'xp' | 'badge' | 'goal' */
export function toast({
  icon = '✨', title = '', text = '', kind = 'xp', ms = 3200,
}) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = '<span class="t-ic" aria-hidden="true"></span><span class="t-tx"><b></b><small></small></span>';
  el.querySelector('.t-ic').textContent = icon;
  el.querySelector('b').textContent = title;
  el.querySelector('small').textContent = text;
  getBox().append(el);
  const out = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 320);
  };
  setTimeout(out, ms);
  el.addEventListener('click', out);
  return el;
}

/** Tela de nível novo: cartão central com fogos de partículas. */
export function levelUp({ level, title }) {
  const wrap = document.createElement('div');
  wrap.className = 'lvlup';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-label', `Nível ${level}`);
  wrap.innerHTML = '<div class="lvlup-card"><small>Subiu de nível</small><div class="lvlup-n"></div><b></b><button type="button" class="btn primary">Continuar</button></div>';
  wrap.querySelector('.lvlup-n').textContent = String(level);
  wrap.querySelector('b').textContent = title;
  document.body.append(wrap);
  const card = wrap.querySelector('.lvlup-card');
  const close = () => { wrap.classList.add('out'); setTimeout(() => wrap.remove(), 260); };
  wrap.querySelector('button').addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  setTimeout(() => { burst(card, 'tune', { n: 36, spread: 150 }); burst(card, 'ok', { n: 24, spread: 110 }); }, 220);
  setTimeout(close, 6000);
  wrap.querySelector('button').focus({ preventScroll: true });
}
