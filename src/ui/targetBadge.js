// Componentes visuais do treino cantado: crachá da nota-alvo e pontos de progresso.
import { h } from '../dom.js';

/**
 * Crachá grande com a nota atual acima da pauta.
 * state: 'idle' | 'listen' (ouvindo o app) | 'count' | 'sing' (sua vez) | 'ok'
 */
export function createTargetBadge() {
  const pill = h('div', { class: 'pill', hidden: true });
  const name = h('div', { class: 'tb-name', hidden: true });
  const sub = h('div', { class: 'tb-sub' });
  const el = h('div', { class: 'target-badge', 'aria-live': 'polite' }, pill, name, sub);
  let key = '';
  return {
    el,
    set({ name: n = '', sub: s = '', state = 'idle', label = '' } = {}) {
      const k = `${n}|${s}|${state}|${label}`;
      if (k === key) return;
      key = k;
      pill.hidden = !label;
      pill.className = `pill ${state}`;
      pill.textContent = label;
      name.hidden = !n;
      name.className = `tb-name ${state}`;
      if (name.textContent !== n) { // reinicia a animação de "pop" quando a nota muda
        name.style.animation = 'none';
        void name.offsetWidth;
        name.style.animation = '';
      }
      name.textContent = n;
      sub.textContent = s;
    },
  };
}

/** Linha de pontinhos: um por nota da sessão (verde = acertou, vermelho = pulou, anel = atual). */
export function createDots() {
  const el = h('div', { class: 'dots', role: 'img', 'aria-label': 'Progresso da sessão' });
  return {
    el,
    set(total, results, current) {
      if (el.children.length !== total) el.replaceChildren(...Array.from({ length: total }, () => h('span', { class: 'dot' })));
      Array.from(el.children).forEach((d, i) => { // atualiza no lugar: só o ponto que mudou anima
        const r = results[i];
        const cls = r === 'ok' ? 'ok' : r === 'skip' ? 'skip' : r === 'warn' ? 'warn' : i === current ? 'cur' : '';
        const next = `dot ${cls}`.trim();
        if (d.className !== next) d.className = next;
      });
    },
    clear() { el.replaceChildren(); },
  };
}
