/** 数据存储：一个 SQLite 文件（Node 自带的 node:sqlite，无需额外依赖） */
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface PlayerRow {
  id: number;
  name: string;
  pass_hash: string;
  salt: string;
  grade: number;
  created_at: number;
}

export interface SaveRow {
  player_id: number;
  data: string;
  version: number;
  updated_at: number;
}

/**
 * 数据库结构的版本迁移。只能往后追加，已发布的迁移不要改。
 * 第 1 版是最初的三张表（players / sessions / saves）；老数据库没有 schema_version 表，按第 0 版处理，
 * 所有语句都是 IF NOT EXISTS，所以对已有这三张表的数据库重复执行也安全。
 */
const MIGRATIONS: string[] = [
  // 1：最初的三张表
  `CREATE TABLE IF NOT EXISTS players (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL UNIQUE COLLATE NOCASE,
     pass_hash TEXT NOT NULL,
     salt TEXT NOT NULL,
     grade INTEGER NOT NULL DEFAULT 3,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS sessions (
     token TEXT PRIMARY KEY,
     player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     last_seen INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS saves (
     player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
     data TEXT NOT NULL,
     version INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );`,
  // 2：答题记录、任务、游戏时间、留言、自定义题目、个人设置、专题目录
  `CREATE TABLE IF NOT EXISTS catalog (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     data TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS answers (
     player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
     client_id TEXT NOT NULL,
     topic_id TEXT NOT NULL,
     grade INTEGER NOT NULL,
     difficulty INTEGER NOT NULL,
     correct INTEGER NOT NULL,
     ms INTEGER,
     context TEXT NOT NULL,
     level_id TEXT NOT NULL,
     custom_id INTEGER,
     at INTEGER NOT NULL,
     received_at INTEGER NOT NULL,
     PRIMARY KEY (player_id, client_id)
   );
   CREATE INDEX IF NOT EXISTS answers_player_at ON answers(player_id, at);
   CREATE INDEX IF NOT EXISTS answers_custom ON answers(custom_id) WHERE custom_id IS NOT NULL;
   CREATE TABLE IF NOT EXISTS player_settings (
     player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
     pass_accuracy INTEGER NOT NULL DEFAULT 60,
     bot_strength REAL NOT NULL DEFAULT 1,
     revive_seconds INTEGER NOT NULL DEFAULT 60,
     gate_required INTEGER NOT NULL DEFAULT 1,
     hide_from_leaderboard INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS tasks (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
     kind TEXT NOT NULL,
     title TEXT NOT NULL,
     note TEXT NOT NULL DEFAULT '',
     reward TEXT NOT NULL DEFAULT '',
     due_at INTEGER,
     bonus_credits INTEGER NOT NULL DEFAULT 0,
     params TEXT NOT NULL,
     archived INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS task_progress (
     task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
     player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
     completed_at INTEGER,
     celebrated INTEGER NOT NULL DEFAULT 0,
     granted_at INTEGER,
     PRIMARY KEY (task_id, player_id)
   );
   CREATE TABLE IF NOT EXISTS playtime_settings (
     player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
     enabled INTEGER NOT NULL DEFAULT 0,
     weekday_minutes INTEGER,
     weekend_minutes INTEGER,
     weekday_windows TEXT NOT NULL DEFAULT '[]',
     weekend_windows TEXT NOT NULL DEFAULT '[]',
     last_beat_at INTEGER,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS playtime_usage (
     player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
     day TEXT NOT NULL,
     seconds INTEGER NOT NULL DEFAULT 0,
     bonus_minutes INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (player_id, day)
   );
   CREATE TABLE IF NOT EXISTS messages (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
     text TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     expires_at INTEGER
   );
   CREATE TABLE IF NOT EXISTS custom_questions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     text TEXT NOT NULL,
     options TEXT NOT NULL,
     answer INTEGER NOT NULL,
     explain TEXT NOT NULL DEFAULT '',
     grade INTEGER NOT NULL,
     topic_label TEXT NOT NULL DEFAULT '',
     for_all INTEGER NOT NULL DEFAULT 1,
     active INTEGER NOT NULL DEFAULT 1,
     required_correct INTEGER NOT NULL DEFAULT 1,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS custom_assign (
     question_id INTEGER NOT NULL REFERENCES custom_questions(id) ON DELETE CASCADE,
     player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
     PRIMARY KEY (question_id, player_id)
   );`,
  // 3：出题频率与比赛长度（个人设置里新增的列；老行自动取默认值）
  `ALTER TABLE player_settings ADD COLUMN gate_count INTEGER NOT NULL DEFAULT 1;
   ALTER TABLE player_settings ADD COLUMN bonus_count INTEGER NOT NULL DEFAULT 2;
   ALTER TABLE player_settings ADD COLUMN plant_questions INTEGER NOT NULL DEFAULT 1;
   ALTER TABLE player_settings ADD COLUMN defuse_questions INTEGER NOT NULL DEFAULT 1;
   ALTER TABLE player_settings ADD COLUMN review_rate INTEGER NOT NULL DEFAULT 20;
   ALTER TABLE player_settings ADD COLUMN custom_rate INTEGER NOT NULL DEFAULT 100;
   ALTER TABLE player_settings ADD COLUMN rounds_to_win INTEGER;
   ALTER TABLE player_settings ADD COLUMN boss_rounds_to_win INTEGER;`,
  // 4：家长在管理页里改过的密码（只有一行）。env_hash 记录改密码时 ADMIN_PASSWORD 的值，
  //    之后若 ADMIN_PASSWORD 换了，就视为"用环境变量重置密码"，这一行作废。
  `CREATE TABLE IF NOT EXISTS admin_auth (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     pass_hash TEXT NOT NULL,
     salt TEXT NOT NULL,
     env_hash TEXT NOT NULL,
     changed_at INTEGER NOT NULL
   );`,
  // 5：留言已读记录（孩子点"知道了"后，这条留言不再给他显示；家长能看到谁读过）
  `CREATE TABLE IF NOT EXISTS message_reads (
     message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
     player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
     read_at INTEGER NOT NULL,
     PRIMARY KEY (message_id, player_id)
   );`,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export class Db {
  readonly sql: DatabaseSync;
  /** 时钟；createApp 会换成注入的时钟，便于测试模拟时间流逝 */
  now: () => number = Date.now;
  private cache = new Map<string, StatementSync>();

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.sql = new DatabaseSync(file);
    this.sql.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    this.migrate();
  }

  private migrate(): void {
    this.sql.exec('CREATE TABLE IF NOT EXISTS schema_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)');
    const row = this.sql.prepare('SELECT version FROM schema_version WHERE id = 1').get() as { version: number } | undefined;
    let v = row?.version ?? 0;
    while (v < MIGRATIONS.length) {
      const next = v + 1;
      this.tx(() => {
        this.sql.exec(MIGRATIONS[v]);
        this.sql.prepare('INSERT INTO schema_version (id, version) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET version = excluded.version').run(next);
      });
      v = next;
    }
  }

  schemaVersion(): number {
    return (this.sql.prepare('SELECT version FROM schema_version WHERE id = 1').get() as { version: number }).version;
  }

  /** 预编译语句缓存 */
  q(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.sql.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  tx<T>(fn: () => T): T {
    this.sql.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.sql.exec('COMMIT');
      return r;
    } catch (e) {
      this.sql.exec('ROLLBACK');
      throw e;
    }
  }

  close(): void {
    this.sql.close();
  }

  listPlayers(): { name: string; grade: number }[] {
    return this.q('SELECT name, grade FROM players ORDER BY name').all() as { name: string; grade: number }[];
  }

  allPlayerRows(): PlayerRow[] {
    return this.q('SELECT * FROM players ORDER BY name').all() as unknown as PlayerRow[];
  }

  playerByName(name: string): PlayerRow | undefined {
    return this.q('SELECT * FROM players WHERE name = ?').get(name) as PlayerRow | undefined;
  }

  playerById(id: number): PlayerRow | undefined {
    return this.q('SELECT * FROM players WHERE id = ?').get(id) as PlayerRow | undefined;
  }

  createPlayer(name: string, passHash: string, salt: string, grade: number): PlayerRow {
    const r = this.q('INSERT INTO players (name, pass_hash, salt, grade, created_at) VALUES (?, ?, ?, ?, ?)').run(name, passHash, salt, grade, this.now());
    return this.playerById(Number(r.lastInsertRowid))!;
  }

  setPassword(id: number, passHash: string, salt: string): void {
    this.q('UPDATE players SET pass_hash = ?, salt = ? WHERE id = ?').run(passHash, salt, id);
    this.q('DELETE FROM sessions WHERE player_id = ?').run(id);
  }

  setGrade(id: number, grade: number): void {
    this.q('UPDATE players SET grade = ? WHERE id = ?').run(grade, id);
  }

  deletePlayer(id: number): void {
    this.q('DELETE FROM players WHERE id = ?').run(id);
  }

  createSession(token: string, playerId: number): void {
    const now = this.now();
    this.q('INSERT INTO sessions (token, player_id, created_at, last_seen) VALUES (?, ?, ?, ?)').run(token, playerId, now, now);
  }

  playerBySession(token: string): PlayerRow | undefined {
    const s = this.q('SELECT player_id FROM sessions WHERE token = ?').get(token) as { player_id: number } | undefined;
    if (!s) return undefined;
    this.q('UPDATE sessions SET last_seen = ? WHERE token = ?').run(this.now(), token);
    return this.playerById(s.player_id);
  }

  /** 这个玩家现有的全部登录令牌 */
  sessionTokensOf(playerId: number): string[] {
    return (this.q('SELECT token FROM sessions WHERE player_id = ?').all(playerId) as { token: string }[]).map((r) => r.token);
  }

  /** 退出这个玩家在所有设备上的登录 */
  deleteSessionsOf(playerId: number): void {
    this.q('DELETE FROM sessions WHERE player_id = ?').run(playerId);
  }

  deleteSession(token: string): void {
    this.q('DELETE FROM sessions WHERE token = ?').run(token);
  }

  getSave(playerId: number): SaveRow | undefined {
    return this.q('SELECT * FROM saves WHERE player_id = ?').get(playerId) as SaveRow | undefined;
  }

  putSave(playerId: number, data: string, version: number): void {
    this.q(
      `INSERT INTO saves (player_id, data, version, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(player_id) DO UPDATE SET data = excluded.data, version = excluded.version, updated_at = excluded.updated_at`,
    ).run(playerId, data, version, this.now());
  }

  adminAuth(): AdminAuthRow | undefined {
    return this.q('SELECT pass_hash, salt, env_hash, changed_at FROM admin_auth WHERE id = 1').get() as AdminAuthRow | undefined;
  }

  setAdminAuth(passHash: string, salt: string, envHash: string): void {
    this.q(
      `INSERT INTO admin_auth (id, pass_hash, salt, env_hash, changed_at) VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET pass_hash = excluded.pass_hash, salt = excluded.salt, env_hash = excluded.env_hash, changed_at = excluded.changed_at`,
    ).run(passHash, salt, envHash, this.now());
  }

  clearAdminAuth(): void {
    this.q('DELETE FROM admin_auth WHERE id = 1').run();
  }
}

export interface AdminAuthRow {
  pass_hash: string;
  salt: string;
  env_hash: string;
  changed_at: number;
}
