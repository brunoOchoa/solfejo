// Persistência local (localStorage). Isolada aqui para trocar por backend depois.
import {
  sessionXp, levelInfo, earnedBadges, dailyProgress,
} from './music/xp.js';

const PREFIX = 'solfejo:';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    const val = JSON.parse(raw);
    // objetos: mescla com os padrões (campos novos); valores simples (texto, número…) voltam como estão
    const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
    return isObj(fallback) && isObj(val) ? { ...fallback, ...val } : val;
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* modo privado / cheio: ignora */
  }
}

const todayKey = () => new Date().toISOString().slice(0, 10);

const emptyStats = () => ({ notes: {}, sessions: [] });

export function getStats() {
  const s = load('stats', emptyStats());
  if (!s.notes) s.notes = {};
  if (!Array.isArray(s.sessions)) s.sessions = [];
  // XP e medalhas são gravados à parte (as sessões antigas saem do histórico); histórico existente vira XP na primeira leitura
  if (typeof s.xp !== 'number') s.xp = s.sessions.reduce((a, x) => a + sessionXp(x), 0);
  if (!Array.isArray(s.badges)) {
    s.badges = earnedBadges({
      sessions: s.sessions, stats: s, streak: streakDays(s.sessions), level: levelInfo(s.xp).level,
    });
    save('stats', s);
  }
  return s;
}

/** Registra uma resposta individual de leitura de notas. */
export function recordNoteAnswer(label, correct, ms) {
  const stats = getStats();
  const n = stats.notes[label] || { ok: 0, err: 0, ms: 0 };
  if (correct) n.ok++;
  else n.err++;
  n.ms += ms;
  stats.notes[label] = n;
  save('stats', stats);
}

/** Registra uma sessão concluída (notas ou ritmo). */
export function recordSession(session) {
  const stats = getStats();
  stats.sessions.push({ date: todayKey(), ...session });
  if (stats.sessions.length > 300) stats.sessions = stats.sessions.slice(-300);
  const before = levelInfo(stats.xp);
  const doneBefore = dailyProgress(stats.sessions.slice(0, -1)).done;
  const gain = sessionXp(session);
  stats.xp += gain;
  const after = levelInfo(stats.xp);
  const ctx = {
    sessions: stats.sessions, stats, streak: streakDays(stats.sessions), level: after.level,
  };
  const newBadges = earnedBadges(ctx).filter((id) => !stats.badges.includes(id));
  stats.badges.push(...newBadges);
  save('stats', stats);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('xpgain', {
    detail: {
      gain, xp: stats.xp, level: after.level, title: after.title, leveledUp: after.level > before.level, newBadges,
      goalReached: !doneBefore && dailyProgress(stats.sessions).done,
    },
  }));
}

/** Sequência de dias seguidos com prática. */
export function streakDays(sessions) {
  const days = new Set(sessions.map((s) => s.date));
  let streak = 0;
  const d = new Date();
  // Se ainda não praticou hoje, a sequência conta a partir de ontem.
  if (!days.has(d.toISOString().slice(0, 10))) d.setDate(d.getDate() - 1);
  while (days.has(d.toISOString().slice(0, 10))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

export function resetStats() {
  save('stats', emptyStats());
}
