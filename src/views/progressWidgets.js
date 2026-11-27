// Peças visuais do Progresso: anel de nível, cartão de herói (nível + meta do dia) e teclas de domínio por nota.
import { h } from '../dom.js';
import { DAILY_GOAL } from '../music/xp.js';

function ring(pct, label, sub) {
  const R = 46;
  const C = 2 * Math.PI * R;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('class', 'ring-svg');
  svg.innerHTML = `<defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--brand)"/><stop offset="1" stop-color="var(--brand-2)"/></linearGradient></defs>
    <circle cx="60" cy="60" r="${R}" class="ring-bg"/>
    <circle cx="60" cy="60" r="${R}" class="ring-fg" stroke-dasharray="${C}" stroke-dashoffset="${C}" transform="rotate(-90 60 60)"/>`;
  const fg = svg.querySelector('.ring-fg');
  requestAnimationFrame(() => requestAnimationFrame(() => { fg.style.strokeDashoffset = String(C * (1 - pct)); }));
  return h('div', { class: 'ring' }, svg, h('div', { class: 'ring-tx' }, h('b', { text: label }), h('small', { text: sub })));
}

export function hero(lv, daily, streak) {
  return h('section', { class: 'card hero' },
    ring(lv.pct, `Nv ${lv.level}`, lv.title),
    h('div', { class: 'hero-side' },
      h('div', { class: 'hero-xp' },
        h('b', { text: `${lv.xp.toLocaleString('pt-BR')} XP` }),
        h('small', { text: `faltam ${lv.span - lv.into} para o nível ${lv.level + 1}` })),
      h('div', { class: 'goal' },
        h('div', { class: 'goal-top' }, h('span', { text: '🎯 Meta do dia' }), h('b', { text: `${Math.min(daily.xp, DAILY_GOAL)}/${DAILY_GOAL} XP` })),
        h('div', { class: `goal-bar${daily.done ? ' done' : ''}` }, h('i', { style: `width:${Math.round(daily.pct * 100)}%` }))),
      h('div', { class: 'hero-chips' },
        h('span', { class: 'hud-chip streak on' }, h('span', { class: 'hi', text: '🔥' }), `${streak} dia(s)`),
        h('span', { class: 'hud-chip', text: `🎵 ${daily.xp} XP hoje` }))));
}

export function mastery(list) {
  return h('div', { class: 'keys' }, list.map((n, i) =>
    h('div', {
      class: `key ${n.state}`,
      style: `--i:${i}`,
      title: n.answers ? `${n.name}: ${n.pct}% em ${n.answers} resposta(s)` : `${n.name}: ainda sem respostas`,
    },
    h('span', { class: 'k-fill', style: `height:${n.pct ?? 0}%` }),
    h('b', { text: n.name }),
    h('small', { text: n.pct == null ? '—' : `${n.pct}%` }))));
}
