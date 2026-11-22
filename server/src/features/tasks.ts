/** 任务与奖励：家长布置任务，服务器根据答题记录和存档自动计算进度并判定完成 */
import { HttpError, Reply, idText, intParam, isObj, num, optNum, optText, type Env, type Route } from '../http.ts';
import { loadSave } from '../save.ts';
import { correctSeq, countAnswers, pct, streaks } from '../stats.ts';
import { DAY_MS, addDays, dayKey, parseDay } from '../time.ts';
import type { CatalogStore } from './catalog.ts';
import { playerParam } from './core.ts';

export const TASK_KINDS = ['clear_level', 'clear_count', 'correct_in_topic', 'correct_total', 'accuracy', 'streak'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/** 完成后在孩子的任务列表里继续显示的天数 */
const RECENT_DONE_DAYS = 7;
const MAX_TASKS = 500;
const GRADE_NAMES: Record<number, string> = { 3: '三年级', 4: '四年级', 5: '五年级', 6: '六年级' };

export interface TaskParams {
  levelId?: string;
  count?: number;
  grade?: number;
  topicId?: string;
  percent?: number;
  minAnswers?: number;
}

interface TaskRow {
  id: number;
  player_id: number | null;
  kind: TaskKind;
  title: string;
  note: string;
  reward: string;
  due_at: number | null;
  bonus_credits: number;
  params: string;
  archived: number;
  created_at: number;
  updated_at: number;
}

interface ProgressRow {
  completed_at: number | null;
  celebrated: number;
  granted_at: number | null;
}

export interface Progress {
  current: number;
  target: number;
  /** 'level' | 'levels' | 'correct' | 'answers' | 'streak' */
  unit: string;
  /** 仅 accuracy 任务：当前正确率（%）与目标正确率 */
  accuracy?: number | null;
  percent?: number;
}

const params = (t: TaskRow): TaskParams => {
  try {
    const p: unknown = JSON.parse(t.params);
    return isObj(p) ? (p as TaskParams) : {};
  } catch {
    return {};
  }
};

export function describeTask(kind: TaskKind, p: TaskParams, catalog: CatalogStore): string {
  const topic = p.topicId ? `在「${catalog.topicName(p.topicId)}」` : '';
  switch (kind) {
    case 'clear_level':
      return `通关「${catalog.levelName(p.levelId ?? '')}」`;
    case 'clear_count':
      return `通关 ${p.count} 个${p.grade ? GRADE_NAMES[p.grade] : ''}关卡`;
    case 'correct_in_topic':
      return `${topic}答对 ${p.count} 题`;
    case 'correct_total':
      return `累计答对 ${p.count} 题`;
    case 'accuracy':
      return `${topic}至少答 ${p.minAnswers} 题，正确率达到 ${p.percent}%`;
    case 'streak':
      return `连续答对 ${p.count} 题`;
  }
}

/** 校验任务参数 */
function parseParams(kind: TaskKind, b: Record<string, unknown>, catalog: CatalogStore): TaskParams {
  const topicOk = (v: unknown): string => {
    const id = idText(v, '专题');
    if (catalog.get() && !catalog.topic(id)) throw new HttpError(400, '没有这个专题');
    return id;
  };
  switch (kind) {
    case 'clear_level': {
      const id = idText(b.levelId, '关卡', 16);
      if (catalog.get() && !catalog.level(id)) throw new HttpError(400, '没有这个关卡');
      return { levelId: id };
    }
    case 'clear_count': {
      const grade = optNum(b.grade, '年级', 3, 6);
      return grade ? { count: num(b.count, '关卡数', 1, 200), grade } : { count: num(b.count, '关卡数', 1, 200) };
    }
    case 'correct_in_topic':
      return { topicId: topicOk(b.topicId), count: num(b.count, '题数', 1, 5000) };
    case 'correct_total':
      return { count: num(b.count, '题数', 1, 10000) };
    case 'accuracy': {
      const p: TaskParams = { percent: num(b.percent, '正确率', 1, 100), minAnswers: num(b.minAnswers, '最少答题数', 5, 2000) };
      if (b.topicId !== undefined && b.topicId !== null && b.topicId !== '') p.topicId = topicOk(b.topicId);
      return p;
    }
    case 'streak':
      return { count: num(b.count, '连对题数', 2, 200) };
  }
}

export class TaskService {
  private env: Env;
  private catalog: CatalogStore;

  constructor(env: Env, catalog: CatalogStore) {
    this.env = env;
    this.catalog = catalog;
  }

  private get db() {
    return this.env.db;
  }

  taskById(id: number): TaskRow | undefined {
    return this.db.q('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
  }

  /** 对某位玩家适用的任务 */
  tasksFor(playerId: number, includeArchived: boolean): TaskRow[] {
    return this.db
      .q(`SELECT * FROM tasks WHERE (player_id = ? OR player_id IS NULL) ${includeArchived ? '' : 'AND archived = 0'} ORDER BY created_at DESC, id DESC`)
      .all(playerId) as unknown as TaskRow[];
  }

  progressRow(taskId: number, playerId: number): ProgressRow | undefined {
    return this.db.q('SELECT completed_at, celebrated, granted_at FROM task_progress WHERE task_id = ? AND player_id = ?').get(taskId, playerId) as ProgressRow | undefined;
  }

  /** 计算进度；done 表示已满足完成条件 */
  measure(t: TaskRow, playerId: number): { progress: Progress; done: boolean } {
    const p = params(t);
    const until = t.due_at ?? Number.MAX_SAFE_INTEGER;
    switch (t.kind) {
      case 'clear_level': {
        const stars = loadSave(this.db, playerId).data.stars[p.levelId ?? ''] ?? 0;
        const cur = stars >= 1 ? 1 : 0;
        return { progress: { current: cur, target: 1, unit: 'level' }, done: cur >= 1 };
      }
      case 'clear_count': {
        const stars = loadSave(this.db, playerId).data.stars;
        const n = Object.entries(stars).filter(([id, s]) => s >= 1 && (!p.grade || this.catalog.levelGrade(id) === p.grade)).length;
        const target = p.count ?? 1;
        return { progress: { current: Math.min(n, target), target, unit: 'levels' }, done: n >= target };
      }
      case 'correct_in_topic':
      case 'correct_total': {
        const c = countAnswers(this.db, playerId, t.created_at, until, t.kind === 'correct_in_topic' ? p.topicId : undefined).correct;
        const target = p.count ?? 1;
        return { progress: { current: Math.min(c, target), target, unit: 'correct' }, done: c >= target };
      }
      case 'accuracy': {
        const tally = countAnswers(this.db, playerId, t.created_at, until, p.topicId);
        const acc = pct(tally.correct, tally.answered);
        const target = p.minAnswers ?? 5;
        const done = tally.answered >= target && (tally.correct / tally.answered) * 100 >= (p.percent ?? 100);
        return { progress: { current: Math.min(tally.answered, target), target, unit: 'answers', accuracy: acc, percent: p.percent ?? 100 }, done };
      }
      case 'streak': {
        const best = streaks(correctSeq(this.db, playerId, t.created_at, until)).best;
        const target = p.count ?? 2;
        return { progress: { current: Math.min(best, target), target, unit: 'streak' }, done: best >= target };
      }
    }
    return { progress: { current: 0, target: 1, unit: 'unknown' }, done: false };
  }

  /** 重新检查玩家所有未完成的任务，满足条件的记为完成。返回本次新完成的数量。 */
  evaluate(playerId: number): number {
    const now = this.env.now();
    let n = 0;
    for (const t of this.tasksFor(playerId, false)) {
      const pr = this.progressRow(t.id, playerId);
      if (pr?.completed_at) continue;
      // 依赖存档星级的任务过期后不再判定（星级没有时间戳）；按答题记录的任务只统计截止时间前的答题
      if (t.due_at !== null && now > t.due_at && (t.kind === 'clear_level' || t.kind === 'clear_count')) continue;
      if (!this.measure(t, playerId).done) continue;
      this.db
        .q(
          `INSERT INTO task_progress (task_id, player_id, completed_at, celebrated) VALUES (?, ?, ?, 0)
           ON CONFLICT(task_id, player_id) DO UPDATE SET completed_at = excluded.completed_at`,
        )
        .run(t.id, playerId, now);
      n++;
    }
    return n;
  }

  /** 某任务对某玩家的完整视图 */
  view(t: TaskRow, playerId: number) {
    const pr = this.progressRow(t.id, playerId);
    const m = this.measure(t, playerId);
    const done = !!pr?.completed_at;
    const now = this.env.now();
    const status = t.archived ? 'archived' : done ? 'done' : t.due_at !== null && now > t.due_at ? 'expired' : 'active';
    return {
      status,
      progress: done ? { ...m.progress, current: Math.max(m.progress.current, m.progress.target) } : m.progress,
      completedAt: pr?.completed_at ?? null,
      rewardGranted: !!pr?.granted_at,
      grantedAt: pr?.granted_at ?? null,
      celebrated: !!pr?.celebrated,
    };
  }

  base(t: TaskRow) {
    const p = params(t);
    return {
      id: t.id,
      kind: t.kind,
      title: t.title,
      description: describeTask(t.kind, p, this.catalog),
      note: t.note,
      reward: t.reward,
      dueAt: t.due_at,
      dueDate: t.due_at !== null ? dayKey(t.due_at) : null,
      bonusCredits: t.bonus_credits,
      params: p,
      createdAt: t.created_at,
    };
  }
}

/** 解析家长提交的任务（新建时 cur 为空；编辑时缺省字段沿用原值） */
function parseTaskBody(env: Env, catalog: CatalogStore, b: Record<string, unknown>, cur?: TaskRow) {
  const kindRaw = b.kind ?? cur?.kind;
  if (typeof kindRaw !== 'string' || !(TASK_KINDS as readonly string[]).includes(kindRaw)) throw new HttpError(400, '任务类型不正确');
  const kind = kindRaw as TaskKind;
  const paramSrc = isObj(b.params) ? b.params : cur && b.kind === undefined ? params(cur) : {};
  const p = parseParams(kind, paramSrc as Record<string, unknown>, catalog);

  let playerId: number | null;
  if (b.playerId === undefined) playerId = cur ? cur.player_id : null;
  else if (b.playerId === null) playerId = null;
  else {
    if (typeof b.playerId !== 'number' || !Number.isInteger(b.playerId)) throw new HttpError(400, '玩家不正确');
    if (!env.db.playerById(b.playerId)) throw new HttpError(404, '没有这个玩家');
    playerId = b.playerId;
  }

  const title = b.title !== undefined ? optText(b.title, '任务名称', 40) : cur?.title ?? '';
  const note = b.note !== undefined ? optText(b.note, '备注', 200, true) : cur?.note ?? '';
  const reward = b.reward !== undefined ? optText(b.reward, '奖励', 60) : cur?.reward ?? '';
  const bonusCredits = b.bonusCredits !== undefined && b.bonusCredits !== null ? num(b.bonusCredits, '游戏内奖励', 0, 2000) : cur?.bonus_credits ?? 0;

  let dueAt: number | null = cur?.due_at ?? null;
  if (b.dueDate !== undefined) {
    if (b.dueDate === null || b.dueDate === '') dueAt = null;
    else {
      const d = typeof b.dueDate === 'string' ? parseDay(b.dueDate) : null;
      if (d === null) throw new HttpError(400, '截止日期格式应为 YYYY-MM-DD');
      dueAt = addDays(d, 1) - 1; // 当天 23:59:59.999
      if (dueAt < env.now() - DAY_MS * 366) throw new HttpError(400, '截止日期太早了');
    }
  }
  return { kind, p, playerId, title: title || describeTask(kind, p, catalog), note, reward, bonusCredits, dueAt };
}

export function taskRoutes(env: Env, catalog: CatalogStore, svc: TaskService): Route[] {
  const { db } = env;

  const taskParam = (s: string | undefined): TaskRow => {
    const t = svc.taskById(intParam(s, '任务编号'));
    if (!t) throw new HttpError(404, '没有这个任务');
    return t;
  };

  const adminView = (t: TaskRow) => {
    const players = t.player_id === null ? db.allPlayerRows() : [db.playerById(t.player_id)!].filter(Boolean);
    return {
      ...svc.base(t),
      playerId: t.player_id,
      playerName: t.player_id === null ? null : players[0]?.name ?? null,
      archived: !!t.archived,
      updatedAt: t.updated_at,
      players: players.map((p) => ({ playerId: p.id, name: p.name, ...svc.view(t, p.id) })),
    };
  };

  return [
    {
      method: 'GET',
      path: '/api/tasks',
      handler: (c) => {
        const p = c.auth();
        svc.evaluate(p.id);
        const now = env.now();
        const tasks = svc
          .tasksFor(p.id, false)
          .map((t) => ({ t, v: svc.view(t, p.id) }))
          .filter(({ v }) => v.status === 'active' || (v.status === 'done' && (!v.celebrated || (v.completedAt ?? 0) >= now - RECENT_DONE_DAYS * DAY_MS)))
          .map(({ t, v }) => {
            const { celebrated, grantedAt: _g, ...rest } = v;
            return { ...svc.base(t), ...rest, forAll: t.player_id === null, justCompleted: v.status === 'done' && !celebrated };
          });
        return { tasks };
      },
    },
    {
      method: 'POST',
      path: '/api/tasks/:id/ack',
      handler: (c) => {
        const p = c.auth();
        const t = svc.taskById(intParam(c.params.id, '任务编号'));
        if (!t || (t.player_id !== null && t.player_id !== p.id)) throw new HttpError(404, '没有这个任务');
        const r = db.q('UPDATE task_progress SET celebrated = 1 WHERE task_id = ? AND player_id = ? AND completed_at IS NOT NULL').run(t.id, p.id);
        return { ok: true, acked: Number(r.changes) > 0 };
      },
    },

    // ---- 家长 ----
    {
      method: 'GET',
      path: '/api/admin/tasks',
      handler: (c) => {
        const pid = c.url.searchParams.get('playerId');
        const players = pid ? [playerParam(env, pid)] : db.allPlayerRows();
        for (const p of players) svc.evaluate(p.id);
        const rows = (pid
          ? db.q('SELECT * FROM tasks WHERE player_id = ? OR player_id IS NULL ORDER BY archived, created_at DESC, id DESC').all(players[0].id)
          : db.q('SELECT * FROM tasks ORDER BY archived, created_at DESC, id DESC').all()) as unknown as TaskRow[];
        return { tasks: rows.map(adminView), kinds: TASK_KINDS };
      },
    },
    {
      method: 'POST',
      path: '/api/admin/tasks',
      handler: async (c) => {
        const b = await c.body();
        const n = (db.q('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n;
        if (n >= MAX_TASKS) throw new HttpError(403, '任务太多了，请先删除一些旧任务');
        const x = parseTaskBody(env, catalog, b);
        const now = env.now();
        const r = db
          .q('INSERT INTO tasks (player_id, kind, title, note, reward, due_at, bonus_credits, params, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)')
          .run(x.playerId, x.kind, x.title, x.note, x.reward, x.dueAt, x.bonusCredits, JSON.stringify(x.p), now, now);
        const t = svc.taskById(Number(r.lastInsertRowid))!;
        for (const p of x.playerId === null ? db.allPlayerRows() : [db.playerById(x.playerId)!]) svc.evaluate(p.id);
        return new Reply(201, { task: adminView(t) });
      },
    },
    {
      method: 'PUT',
      path: '/api/admin/tasks/:id',
      handler: async (c) => {
        const cur = taskParam(c.params.id);
        const b = await c.body();
        const x = parseTaskBody(env, catalog, b, cur);
        const goalChanged = x.kind !== cur.kind || JSON.stringify(x.p) !== cur.params || x.dueAt !== cur.due_at || x.playerId !== cur.player_id;
        db.tx(() => {
          db.q('UPDATE tasks SET player_id = ?, kind = ?, title = ?, note = ?, reward = ?, due_at = ?, bonus_credits = ?, params = ?, updated_at = ? WHERE id = ?')
            .run(x.playerId, x.kind, x.title, x.note, x.reward, x.dueAt, x.bonusCredits, JSON.stringify(x.p), env.now(), cur.id);
          // 目标变了：还没兑现奖励的完成记录作废，按新目标重新判定
          if (goalChanged) db.q('DELETE FROM task_progress WHERE task_id = ? AND granted_at IS NULL').run(cur.id);
        });
        for (const p of x.playerId === null ? db.allPlayerRows() : [db.playerById(x.playerId)!]) svc.evaluate(p.id);
        return { task: adminView(svc.taskById(cur.id)!) };
      },
    },
    {
      method: 'DELETE',
      path: '/api/admin/tasks/:id',
      handler: (c) => {
        const t = taskParam(c.params.id);
        db.q('DELETE FROM tasks WHERE id = ?').run(t.id);
        return { ok: true };
      },
    },
    {
      method: 'POST',
      path: '/api/admin/tasks/:id/archive',
      handler: async (c) => {
        const t = taskParam(c.params.id);
        const b = await c.body();
        const archived = b.archived === undefined ? true : b.archived === true;
        db.q('UPDATE tasks SET archived = ?, updated_at = ? WHERE id = ?').run(archived ? 1 : 0, env.now(), t.id);
        return { task: adminView(svc.taskById(t.id)!) };
      },
    },
    {
      method: 'POST',
      path: '/api/admin/tasks/:id/grant',
      handler: async (c) => {
        const t = taskParam(c.params.id);
        const b = await c.body();
        const pid = typeof b.playerId === 'number' ? b.playerId : t.player_id;
        if (pid === null || (t.player_id !== null && pid !== t.player_id) || !db.playerById(pid)) throw new HttpError(400, '请指定是哪位孩子的奖励');
        const granted = b.granted === undefined ? true : b.granted === true;
        const pr = svc.progressRow(t.id, pid);
        if (granted && !pr?.completed_at) throw new HttpError(409, '任务还没完成，不能标记为已兑现');
        db.q('UPDATE task_progress SET granted_at = ? WHERE task_id = ? AND player_id = ?').run(granted ? env.now() : null, t.id, pid);
        return { task: adminView(svc.taskById(t.id)!) };
      },
    },
  ];
}
