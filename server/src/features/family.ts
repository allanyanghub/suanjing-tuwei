/** 家庭排行榜 + 家长总览（两者用同一套每人指标） */
import type { PlayerRow } from '../db.ts';
import type { Env, Route } from '../http.ts';
import { loadSave, summarize } from '../save.ts';
import { correctSeq, countAnswers, pct, streaks } from '../stats.ts';
import { dayKey, startOfDay, startOfWeek, timeZoneInfo } from '../time.ts';
import type { CatalogStore } from './catalog.ts';
import type { PlaytimeService } from './playtime.ts';
import { getSettings } from './settings.ts';
import type { TaskService } from './tasks.ts';

/** 本周正确率至少要答这么多题才上榜 */
export const WEEK_ACCURACY_MIN = 10;
export const METRICS = ['rank', 'stars', 'cleared', 'weekCorrect', 'weekAccuracy', 'bestStreak', 'wins'] as const;

export function metricsOf(env: Env, p: PlayerRow) {
  const now = env.now();
  const sum = summarize(loadSave(env.db, p.id).data);
  const week = countAnswers(env.db, p.id, startOfWeek(now));
  const st = streaks(correctSeq(env.db, p.id));
  return {
    name: p.name,
    grade: p.grade,
    rank: sum.rank,
    stars: sum.stars,
    cleared: sum.cleared,
    wins: sum.wins,
    weekAnswered: week.answered,
    weekCorrect: week.correct,
    weekAccuracy: week.answered >= WEEK_ACCURACY_MIN ? pct(week.correct, week.answered) : null,
    bestStreak: st.best,
    currentStreak: st.current,
  };
}

type Metrics = ReturnType<typeof metricsOf>;

function boards(rows: Metrics[]) {
  const out: Record<string, { name: string; value: number; rank: number }[]> = {};
  for (const m of METRICS) {
    const list = rows
      .filter((r) => r[m] !== null)
      .map((r) => ({ name: r.name, value: r[m] as number }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
    let rank = 0;
    out[m] = list.map((x, i) => ({ ...x, rank: i > 0 && list[i - 1].value === x.value ? rank : (rank = i + 1) }));
  }
  return out;
}

export function familyRoutes(env: Env, catalog: CatalogStore, tasks: TaskService, playtime: PlaytimeService): Route[] {
  const { db } = env;
  return [
    {
      method: 'GET',
      path: '/api/leaderboard',
      handler: (c) => {
        const me = c.auth();
        const now = env.now();
        const visible = db.allPlayerRows().filter((p) => !getSettings(env, p.id).hideFromLeaderboard);
        const rows = visible.map((p) => metricsOf(env, p));
        return {
          weekStartsAt: startOfWeek(now),
          weekAccuracyMin: WEEK_ACCURACY_MIN,
          meHidden: !visible.some((p) => p.id === me.id),
          players: rows.map((r, i) => {
            const { currentStreak: _c, ...pub } = r;
            return { ...pub, isMe: visible[i].id === me.id };
          }),
          boards: boards(rows),
        };
      },
    },
    {
      method: 'GET',
      path: '/api/admin/leaderboard',
      handler: () => {
        const all = db.allPlayerRows().map((p) => ({ p, hidden: getSettings(env, p.id).hideFromLeaderboard }));
        const rows = all.map(({ p, hidden }) => ({ id: p.id, hidden, ...metricsOf(env, p) }));
        return { weekStartsAt: startOfWeek(env.now()), weekAccuracyMin: WEEK_ACCURACY_MIN, players: rows, boards: boards(rows.filter((r) => !r.hidden)) };
      },
    },
    {
      method: 'GET',
      path: '/api/admin/dashboard',
      handler: () => {
        const now = env.now();
        const players = db.allPlayerRows().map((p) => {
          tasks.evaluate(p.id);
          const m = metricsOf(env, p);
          const today = countAnswers(db, p.id, startOfDay(now));
          let active = 0;
          let doneUngranted = 0;
          for (const t of tasks.tasksFor(p.id, false)) {
            const v = tasks.view(t, p.id);
            if (v.status === 'active') active++;
            else if (v.status === 'done' && !v.rewardGranted && t.reward) doneUngranted++;
          }
          const pt = playtime.status(p.id);
          const last = db.q('SELECT MAX(at) AS t FROM answers WHERE player_id = ?').get(p.id) as { t: number | null };
          return {
            id: p.id,
            ...m,
            weekAccuracyAny: pct(m.weekCorrect, m.weekAnswered),
            todayAnswered: today.answered,
            todayCorrect: today.correct,
            todaySeconds: pt.usedToday,
            playtimeEnabled: pt.enabled,
            limitToday: pt.limitToday,
            activeTasks: active,
            rewardsToGrant: doneUngranted,
            lastAnswerAt: last.t,
            saveUpdatedAt: loadSave(db, p.id).updatedAt,
            hidden: getSettings(env, p.id).hideFromLeaderboard,
          };
        });
        return { now, today: dayKey(now), ...timeZoneInfo(now), catalogLoaded: catalog.get() !== null, players };
      },
    },
  ];
}
