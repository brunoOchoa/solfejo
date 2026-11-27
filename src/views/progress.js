import { h } from '../dom.js';
import { SOLFEGE } from '../music/theory.js';
import { getStats, streakDays, resetStats } from '../storage.js';
import { levelInfo, dailyProgress, noteMastery, BADGES } from '../music/xp.js';
import { hero, mastery } from './progressWidgets.js';

const pct = (ok, err) => (ok + err ? Math.round((ok / (ok + err)) * 100) : null);

function bar(label, value, detail) {
  return h('div', { class: 'bar-row' },
    h('span', { class: 'bar-label', text: label }),
    h('div', { class: 'bar' }, h('div', {
      class: `fill ${value == null ? 'none' : value >= 85 ? 'good' : value >= 60 ? 'mid' : 'bad'}`,
      style: `width:${value ?? 0}%`,
    })),
    h('span', { class: 'bar-val', text: value == null ? '—' : `${value}%${detail ? ` · ${detail}` : ''}` }),
  );
}

export function mountProgress(root) {
  const stats = getStats();
  const sessions = stats.sessions;
  const noteSessions = sessions.filter((s) => s.mode === 'notes');
  const rhythmSessions = sessions.filter((s) => s.mode === 'rhythm');
  const singSessions = sessions.filter((s) => s.mode === 'sing');

  const answers = noteSessions.reduce((a, s) => a + s.total, 0);
  const correct = noteSessions.reduce((a, s) => a + s.correct, 0);

  const lv = levelInfo(stats.xp);
  const daily = dailyProgress(sessions);
  root.append(
    hero(lv, daily, streakDays(sessions)),
    h('section', { class: 'card' },
      h('h2', { text: 'Mapa de domínio' }),
      h('p', { class: 'hint', text: 'Cada tecla acende conforme você acerta aquela nota na leitura.' }),
      mastery(noteMastery(stats.notes)),
    ),
    h('section', { class: 'card' },
      h('h2', { text: `Medalhas · ${stats.badges.length}/${BADGES.length}` }),
      h('div', { class: 'badges' }, BADGES.map((b) => {
        const got = stats.badges.includes(b.id);
        return h('div', { class: `badge-tile${got ? ' got' : ''}`, title: b.desc },
          h('span', { class: 'bt-ic', text: got ? b.icon : '🔒' }),
          h('b', { text: b.name }),
          h('small', { text: b.desc }));
      })),
    ),
    h('section', { class: 'card' },
      h('h2', { text: 'Resumo' }),
      h('div', { class: 'stats' },
        stat(streakDays(sessions), 'dias seguidos'),
        stat(sessions.length, 'sessões'),
        stat(answers ? `${Math.round((correct / answers) * 100)}%` : '—', 'acerto em notas'),
        stat(rhythmSessions.length
          ? `${Math.round((rhythmSessions.slice(-10).reduce((a, s) => a + s.score, 0) / Math.min(10, rhythmSessions.length)) * 100)}%`
          : '—', 'ritmo (últimas 10)'),
      ),
    ),
    h('section', { class: 'card' },
      h('h2', { text: 'Leitura de notas por nota' }),
      ...SOLFEGE.map((name) => {
        const n = stats.notes[name];
        return bar(name, n ? pct(n.ok, n.err) : null, n ? `${((n.ms / (n.ok + n.err)) / 1000).toFixed(1)}s` : '');
      }),
      h('h2', { class: 'sub', text: 'Por clave' }),
      ...[['clef:treble', 'Sol'], ['clef:bass', 'Fá']].map(([k, label]) => {
        const n = stats.notes[k];
        return bar(label, n ? pct(n.ok, n.err) : null, n ? `${n.ok + n.err} resp.` : '');
      }),
    ),
    h('section', { class: 'card' },
      h('h2', { text: 'Últimos 14 dias' }),
      activity(sessions),
    ),
    h('section', { class: 'card' },
      h('h2', { text: 'Ritmo — últimas sessões' }),
      rhythmSessions.length
        ? h('div', { class: 'spark' }, rhythmSessions.slice(-20).map((s) =>
          h('div', { class: 'spark-bar', title: `${Math.round(s.score * 100)}% · ${s.timeSig} · ${s.bpm} bpm`,
            style: `height:${Math.max(4, s.score * 100)}%` })))
        : h('p', { class: 'hint', text: 'Nenhuma sessão de ritmo ainda.' }),
    ),
    h('section', { class: 'card' },
      h('h2', { text: 'Solfejo cantado — últimas sessões' }),
      singSessions.length
        ? h('div', { class: 'spark' }, singSessions.slice(-20).map((s) =>
          h('div', { class: 'spark-bar sing', title: `${Math.round(s.score * 100)}% · ${s.kind === 'note' ? 'nota única' : `melodia nível ${s.level}`}`,
            style: `height:${Math.max(4, s.score * 100)}%` })))
        : h('p', { class: 'hint', text: 'Nenhuma sessão cantada ainda.' }),
    ),
    h('button', {
      class: 'btn danger',
      onclick: () => {
        if (confirm('Apagar todo o histórico de progresso? Isso não pode ser desfeito.')) {
          resetStats();
          root.replaceChildren();
          mountProgress(root);
        }
      },
    }, 'Apagar histórico'),
  );
  return () => {};
}

function stat(value, label) {
  return h('div', { class: 'stat' }, h('div', { class: 'v', text: String(value) }), h('div', { class: 'l', text: label }));
}

function activity(sessions) {
  const counts = {};
  sessions.forEach((s) => (counts[s.date] = (counts[s.date] || 0) + 1));
  const cells = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const c = counts[key] || 0;
    cells.push(h('div', { class: `day l${Math.min(c, 4)}`, title: `${key}: ${c} sessão(ões)` },
      h('span', { text: String(d.getDate()) })));
  }
  return h('div', { class: 'days' }, cells);
}
