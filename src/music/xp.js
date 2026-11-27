// XP, nível, meta diária, medalhas e domínio por nota. Funções puras: o XP vem sempre da precisão real, nunca do tempo de uso.

export const DAILY_GOAL = 100;
export const NOTE_NAMES = ['Dó', 'Ré', 'Mi', 'Fá', 'Sol', 'Lá', 'Si'];

/** XP ganho em uma sessão concluída (o mesmo objeto gravado em recordSession). */
export function sessionXp(s) {
  if (!s) return 0;
  const bonus = (acc, total) => (total >= 5 && acc >= 0.9 ? 20 : 0);
  let xp = 0;
  if (s.mode === 'notes') {
    const total = s.total || 0;
    xp = (s.correct || 0) * 10 + bonus(total ? s.correct / total : 0, total);
  } else if (s.mode === 'rhythm') {
    xp = Math.round((s.score || 0) * 100);
  } else if (s.mode === 'sing' && s.kind === 'melody') {
    xp = Math.round((s.score || 0) * 100);
  } else if (typeof s.score === 'number' && s.total) {
    xp = Math.round(s.score * s.total * (s.mode === 'sing' ? 15 : 10)) + bonus(s.score, s.total);
  }
  return Math.max(0, xp);
}

/** XP acumulado necessário para ALCANÇAR o nível L (L1 = 0, L2 = 100, L3 = 300, L4 = 600…). */
export const xpToReach = (level) => 50 * level * (level - 1);

const TITLES = [[1, 'Iniciante'], [3, 'Aprendiz'], [5, 'Intérprete'], [8, 'Solista'], [12, 'Virtuose'], [18, 'Maestro']];
export const levelTitle = (level) => TITLES.reduce((t, [from, name]) => (level >= from ? name : t), TITLES[0][1]);

export function levelInfo(xp) {
  const total = Math.max(0, Math.round(xp || 0));
  let level = 1;
  while (xpToReach(level + 1) <= total) level++;
  const from = xpToReach(level);
  const span = xpToReach(level + 1) - from;
  const into = total - from;
  return { level, title: levelTitle(level), xp: total, into, span, pct: span ? into / span : 0 };
}

export const todayKey = () => new Date().toISOString().slice(0, 10);

/** XP ganho hoje e fração da meta diária. */
export function dailyProgress(sessions, today = todayKey()) {
  const xp = sessions.filter((s) => s.date === today).reduce((a, s) => a + sessionXp(s), 0);
  return { xp, goal: DAILY_GOAL, pct: Math.min(1, xp / DAILY_GOAL), done: xp >= DAILY_GOAL };
}

/** Domínio por nota: { name, answers, pct, state } com state 'new' | 'train' | 'good' | 'master'. */
export function noteMastery(notes) {
  return NOTE_NAMES.map((name) => {
    const n = notes?.[name];
    const answers = n ? n.ok + n.err : 0;
    const pct = answers ? Math.round((n.ok / answers) * 100) : null;
    let state = 'new';
    if (answers >= 5) state = pct >= 90 ? 'master' : pct >= 70 ? 'good' : 'train';
    else if (answers > 0) state = pct >= 70 ? 'good' : 'train';
    return { name, answers, pct, state };
  });
}

const modes = (sessions) => new Set(sessions.map((s) => s.mode));
const correctNotes = (stats) => NOTE_NAMES.reduce((a, n) => a + (stats.notes?.[n]?.ok || 0), 0);

/** Medalhas: id, ícone, nome, descrição e o teste (ctx = { sessions, stats, streak, level }). */
export const BADGES = [
  { id: 'first', icon: '🎵', name: 'Primeiro passo', desc: 'Conclua uma sessão', test: (c) => c.sessions.length >= 1 },
  { id: 'sessions10', icon: '🔟', name: 'Pegando o ritmo', desc: 'Conclua 10 sessões', test: (c) => c.sessions.length >= 10 },
  { id: 'sessions50', icon: '🏁', name: 'Veterano', desc: 'Conclua 50 sessões', test: (c) => c.sessions.length >= 50 },
  { id: 'streak3', icon: '🔥', name: 'Aquecendo', desc: '3 dias seguidos', test: (c) => c.streak >= 3 },
  { id: 'streak7', icon: '⚡', name: 'Semana de fogo', desc: '7 dias seguidos', test: (c) => c.streak >= 7 },
  { id: 'streak30', icon: '👑', name: 'Hábito de ferro', desc: '30 dias seguidos', test: (c) => c.streak >= 30 },
  { id: 'notes100', icon: '🎼', name: 'Leitor fluente', desc: '100 notas lidas certas', test: (c) => correctNotes(c.stats) >= 100 },
  {
    id: 'perfect', icon: '💎', name: 'Sessão perfeita', desc: '100% em uma sessão de 5+ itens',
    test: (c) => c.sessions.some((s) => (s.total || 0) >= 5 && sessionXp(s) > 0 && ((s.score ?? (s.correct / s.total)) >= 1)),
  },
  { id: 'allmodes', icon: '🎯', name: 'Músico completo', desc: 'Pratique notas, ritmo, canto e instrumento', test: (c) => ['notes', 'rhythm', 'sing', 'instrument'].every((m) => modes(c.sessions).has(m)) },
  { id: 'mapa', icon: '🗺', name: 'Mapa completo', desc: 'Domine as 7 notas (90%+)', test: (c) => noteMastery(c.stats.notes).every((n) => n.state === 'master') },
  { id: 'level5', icon: '⭐', name: 'Intérprete', desc: 'Chegue ao nível 5', test: (c) => c.level >= 5 },
  { id: 'level10', icon: '🌟', name: 'Estrela', desc: 'Chegue ao nível 10', test: (c) => c.level >= 10 },
];

/** Ids das medalhas cujo teste passa agora. */
export const earnedBadges = (ctx) => BADGES.filter((b) => b.test(ctx)).map((b) => b.id);
