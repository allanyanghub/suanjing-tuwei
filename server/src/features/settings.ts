/** 每位玩家的难度设置与出题频率（家长设置，客户端读取后自行应用） */
import { bool, num, optNum, type Env, type Route } from '../http.ts';
import { playerParam, validGrade } from './core.ts';

export interface PlayerSettings {
  /** 过关所需正确率（%） */
  passAccuracy: number;
  /** 机器人强度倍率 */
  botStrength: number;
  /** 复活答题限时（秒） */
  reviveSeconds: number;
  /** 购买阶段是否必须先答对门槛题 */
  gateRequired: boolean;
  /** 不出现在家庭排行榜上 */
  hideFromLeaderboard: boolean;
  // ---- 出题频率 ----
  /** 每回合开始前必须答对的门槛题数量（仅 gateRequired 时有效） */
  gateCount: number;
  /** 每回合提供的可选加分题数量 */
  bonusCount: number;
  /** 安放需要答对的题数 */
  plantQuestions: number;
  /** 拆除需要答对的题数 */
  defuseQuestions: number;
  /** 门槛题从错题本里重出的概率（%） */
  reviewRate: number;
  /** 有待做的家长出题时，门槛题使用家长出题的概率（%） */
  customRate: number;
  // ---- 比赛长度 ----
  /** 普通关卡先赢几回合获胜；null = 用游戏默认（客户端默认 5） */
  roundsToWin: number | null;
  /** 终局（boss）关卡先赢几回合获胜；null = 用游戏默认（客户端默认 7） */
  bossRoundsToWin: number | null;
}

export const DEFAULT_SETTINGS: PlayerSettings = {
  passAccuracy: 60,
  botStrength: 1,
  reviveSeconds: 60,
  gateRequired: true,
  hideFromLeaderboard: false,
  gateCount: 1,
  bonusCount: 2,
  plantQuestions: 1,
  defuseQuestions: 1,
  reviewRate: 20,
  customRate: 100,
  roundsToWin: null,
  bossRoundsToWin: null,
};

interface SettingsRow {
  pass_accuracy: number;
  bot_strength: number;
  revive_seconds: number;
  gate_required: number;
  hide_from_leaderboard: number;
  gate_count: number;
  bonus_count: number;
  plant_questions: number;
  defuse_questions: number;
  review_rate: number;
  custom_rate: number;
  rounds_to_win: number | null;
  boss_rounds_to_win: number | null;
}

export function getSettings(env: Env, playerId: number): PlayerSettings {
  const r = env.db.q('SELECT * FROM player_settings WHERE player_id = ?').get(playerId) as SettingsRow | undefined;
  if (!r) return { ...DEFAULT_SETTINGS };
  return {
    passAccuracy: r.pass_accuracy,
    botStrength: r.bot_strength,
    reviveSeconds: r.revive_seconds,
    gateRequired: r.gate_required === 1,
    hideFromLeaderboard: r.hide_from_leaderboard === 1,
    gateCount: r.gate_count,
    bonusCount: r.bonus_count,
    plantQuestions: r.plant_questions,
    defuseQuestions: r.defuse_questions,
    reviewRate: r.review_rate,
    customRate: r.custom_rate,
    roundsToWin: r.rounds_to_win,
    bossRoundsToWin: r.boss_rounds_to_win,
  };
}

/** 只更新请求里给出的字段；数字类型不对报错，超出范围夹到范围内 */
function applyPatch(cur: PlayerSettings, b: Record<string, unknown>): PlayerSettings {
  const s = { ...cur };
  if (b.passAccuracy !== undefined) s.passAccuracy = num(b.passAccuracy, '过关正确率', 40, 100);
  if (b.botStrength !== undefined) s.botStrength = Math.round(num(b.botStrength, '对手强度', 0.5, 1.5, false) * 20) / 20;
  if (b.reviveSeconds !== undefined) s.reviveSeconds = num(b.reviveSeconds, '复活答题时间', 20, 180);
  if (b.gateRequired !== undefined) s.gateRequired = bool(b.gateRequired, '门槛题开关');
  if (b.hideFromLeaderboard !== undefined) s.hideFromLeaderboard = bool(b.hideFromLeaderboard, '排行榜隐藏开关');
  if (b.gateCount !== undefined) s.gateCount = num(b.gateCount, '门槛题数量', 1, 5);
  if (b.bonusCount !== undefined) s.bonusCount = num(b.bonusCount, '加分题数量', 0, 4);
  if (b.plantQuestions !== undefined) s.plantQuestions = num(b.plantQuestions, '安放题数', 1, 3);
  if (b.defuseQuestions !== undefined) s.defuseQuestions = num(b.defuseQuestions, '拆除题数', 1, 3);
  if (b.reviewRate !== undefined) s.reviewRate = num(b.reviewRate, '错题重出概率', 0, 50);
  if (b.customRate !== undefined) s.customRate = num(b.customRate, '家长出题概率', 0, 100);
  if (b.roundsToWin !== undefined) s.roundsToWin = optNum(b.roundsToWin, '获胜回合数', 3, 13);
  if (b.bossRoundsToWin !== undefined) s.bossRoundsToWin = optNum(b.bossRoundsToWin, '终局获胜回合数', 3, 13);
  return s;
}

function saveSettings(env: Env, playerId: number, s: PlayerSettings): void {
  env.db
    .q(
      `INSERT INTO player_settings (player_id, pass_accuracy, bot_strength, revive_seconds, gate_required, hide_from_leaderboard,
         gate_count, bonus_count, plant_questions, defuse_questions, review_rate, custom_rate, rounds_to_win, boss_rounds_to_win, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(player_id) DO UPDATE SET pass_accuracy = excluded.pass_accuracy, bot_strength = excluded.bot_strength,
         revive_seconds = excluded.revive_seconds, gate_required = excluded.gate_required, hide_from_leaderboard = excluded.hide_from_leaderboard,
         gate_count = excluded.gate_count, bonus_count = excluded.bonus_count, plant_questions = excluded.plant_questions,
         defuse_questions = excluded.defuse_questions, review_rate = excluded.review_rate, custom_rate = excluded.custom_rate,
         rounds_to_win = excluded.rounds_to_win, boss_rounds_to_win = excluded.boss_rounds_to_win,
         updated_at = excluded.updated_at`,
    )
    .run(
      playerId, s.passAccuracy, s.botStrength, s.reviveSeconds, s.gateRequired ? 1 : 0, s.hideFromLeaderboard ? 1 : 0,
      s.gateCount, s.bonusCount, s.plantQuestions, s.defuseQuestions, s.reviewRate, s.customRate, s.roundsToWin, s.bossRoundsToWin, env.now(),
    );
}

export function settingsRoutes(env: Env): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/settings/me',
      handler: (c) => {
        const p = c.auth();
        const { hideFromLeaderboard: _h, ...rest } = getSettings(env, p.id);
        return { settings: { grade: p.grade, ...rest } };
      },
    },
    {
      method: 'GET',
      path: '/api/admin/players/:id/settings',
      handler: (c) => {
        const p = playerParam(env, c.params.id);
        return { settings: { grade: p.grade, ...getSettings(env, p.id) }, defaults: DEFAULT_SETTINGS };
      },
    },
    {
      method: 'PUT',
      path: '/api/admin/players/:id/settings',
      handler: async (c) => {
        const p = playerParam(env, c.params.id);
        const b = await c.body();
        const next = applyPatch(getSettings(env, p.id), b);
        env.db.tx(() => {
          if (b.grade !== undefined) env.db.setGrade(p.id, validGrade(num(b.grade, '年级', 3, 6)));
          saveSettings(env, p.id, next);
        });
        return { settings: { grade: env.db.playerById(p.id)!.grade, ...next }, defaults: DEFAULT_SETTINGS };
      },
    },
  ];
}
