// Medidor do sinal do microfone: barra de volume e aviso de mudo, sem sinal, fraco ou estourando.
import { h } from '../dom.js';
import { micStatus, toDb } from '../music/audioProfile.js';

const DB_MIN = -60;
const pct = (db) => Math.max(0, Math.min(100, ((db - DB_MIN) / -DB_MIN) * 100));

/**
 * big: versão grande (painel de Áudio). onClick: transforma o medidor num botão. expectSound: () => o app espera que você toque agora.
 * Retorna { el, destroy, setNotice(texto), status() }.
 */
export function createMicMeter(mic, { big = false, onClick = null, expectSound = () => false } = {}) {
  const fillEl = h('i');
  const hold = h('b', { class: 'mm-hold' });
  const note = h('span', { class: 'mm-note', hidden: true, 'aria-hidden': 'true', text: '!' });
  const txt = h('span', { class: 'mm-txt' });
  const el = h(onClick ? 'button' : 'div', { class: `mic-meter${big ? ' big' : ''}`, 'data-state': 'off', type: onClick ? 'button' : null }, h('span', { class: 'mm-bar' }, fillEl, hold), txt, note);
  if (onClick) el.addEventListener('click', onClick);
  const hist = [];
  let lastT = 0;
  let notice = '';
  let cur = { state: 'off', text: '' };

  function tick() {
    const now = performance.now();
    if (!mic.active) { hist.length = 0; lastT = 0; } else if (mic.level.t !== lastT) {
      lastT = mic.level.t;
      hist.push({ t: now, db: toDb(mic.level.peak) });
    }
    while (hist.length && now - hist[0].t > 8000) hist.shift();
    const peakSince = (ms) => hist.reduce((m, x) => (now - x.t <= ms && x.db > m ? x.db : m), -100);
    const shortPk = peakSince(1500);
    const longPk = peakSince(8000);
    cur = micStatus({
      active: mic.active, muted: mic.muted, shortPeakDb: shortPk, longPeakDb: longPk, spanMs: hist.length ? now - hist[0].t : 0, expectSound: expectSound(),
    });
    if (el.dataset.state !== cur.state) el.dataset.state = cur.state;
    fillEl.style.width = `${pct(mic.active ? toDb(mic.level.peak) : -100).toFixed(0)}%`;
    hold.style.left = `${pct(shortPk).toFixed(0)}%`;
    const full = notice ? `${cur.text} · ${notice}` : cur.text;
    if (txt.textContent !== cur.text) txt.textContent = cur.text;
    note.hidden = !notice || big;
    el.title = full;
    el.setAttribute('aria-label', `Sinal do microfone: ${full}`);
  }
  const timer = setInterval(tick, 70);
  tick();

  return {
    el,
    destroy() { clearInterval(timer); },
    setNotice(t) { notice = t || ''; tick(); },
    status: () => cur,
  };
}
