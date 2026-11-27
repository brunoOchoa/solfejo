import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sessionXp, levelInfo, xpToReach, dailyProgress, noteMastery, earnedBadges, DAILY_GOAL,
} from '../src/music/xp.js';

test('XP de notas: 10 por acerto e bônus com 90%+', () => {
  assert.equal(sessionXp({ mode: 'notes', total: 10, correct: 6 }), 60);
  assert.equal(sessionXp({ mode: 'notes', total: 10, correct: 9 }), 110);
  assert.equal(sessionXp({ mode: 'notes', total: 3, correct: 3 }), 30); // sessão curta não ganha bônus
});

test('XP de ritmo e melodia vem da nota (0–100)', () => {
  assert.equal(sessionXp({ mode: 'rhythm', score: 0.83 }), 83);
  assert.equal(sessionXp({ mode: 'sing', kind: 'melody', score: 0.5 }), 50);
});

test('XP de instrumento e nota cantada usa score × itens', () => {
  assert.equal(sessionXp({ mode: 'instrument', score: 0.5, total: 8 }), 40);
  assert.equal(sessionXp({ mode: 'instrument', score: 1, total: 8 }), 100);
  assert.equal(sessionXp({ mode: 'sing', kind: 'note', score: 1, total: 5 }), 95);
  assert.equal(sessionXp(null), 0);
});

test('níveis: L2 em 100, L3 em 300', () => {
  assert.equal(xpToReach(2), 100);
  assert.equal(xpToReach(3), 300);
  assert.equal(levelInfo(0).level, 1);
  assert.equal(levelInfo(99).level, 1);
  assert.equal(levelInfo(100).level, 2);
  const i = levelInfo(200);
  assert.deepEqual([i.level, i.into, i.span], [2, 100, 200]);
  assert.equal(i.pct, 0.5);
});

test('meta diária soma só o dia de hoje', () => {
  const s = [
    { date: '2026-01-01', mode: 'rhythm', score: 1 },
    { date: '2026-01-02', mode: 'rhythm', score: 0.6 },
    { date: '2026-01-02', mode: 'notes', total: 5, correct: 2 },
  ];
  const d = dailyProgress(s, '2026-01-02');
  assert.equal(d.xp, 80);
  assert.equal(d.goal, DAILY_GOAL);
  assert.equal(d.done, false);
  assert.equal(dailyProgress(s, '2026-01-01').done, true);
});

test('domínio por nota', () => {
  const m = noteMastery({ Dó: { ok: 10, err: 0 }, Ré: { ok: 3, err: 3 }, Mi: { ok: 1, err: 0 } });
  assert.equal(m[0].state, 'master');
  assert.equal(m[1].state, 'train');
  assert.equal(m[2].state, 'good');
  assert.equal(m[3].state, 'new');
  assert.equal(m[3].pct, null);
});

test('medalhas', () => {
  const ctx = {
    sessions: [{ mode: 'notes', total: 10, correct: 10 }], stats: { notes: { Dó: { ok: 100, err: 0 } } }, streak: 3, level: 1,
  };
  const ids = earnedBadges(ctx);
  assert.ok(ids.includes('first') && ids.includes('streak3') && ids.includes('notes100') && ids.includes('perfect'));
  assert.ok(!ids.includes('streak7') && !ids.includes('level5'));
});
