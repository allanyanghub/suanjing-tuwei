# 算境突围 服务端接口文档（客户端对接契约）

本文档与 `server/src` 的实现保持一致；接口有变化时请同步修改本文件和 `server/test/`。

- 服务端：Node 26，零第三方依赖，数据存在一个 SQLite 文件（`$DATA_DIR/suanjing.sqlite`）。
- 所有接口都在 `/api/` 下，请求和响应都是 JSON（`Content-Type: application/json`）。
- 家长管理页面：`GET /admin`（单文件页面，自带全部 CSS/JS）。

## 目录

1. [通用约定](#1-通用约定)
2. [部署与时区](#2-部署与时区)
3. [账号与存档（原有接口）](#3-账号与存档原有接口)
4. [专题目录 catalog](#4-专题目录-catalog)
5. [答题记录 answers](#5-答题记录-answers)
6. [孩子的学习小结 report/me](#6-孩子的学习小结-reportme)
7. [任务与奖励 tasks](#7-任务与奖励-tasks)
8. [游戏时间 playtime](#8-游戏时间-playtime)
9. [家长留言 messages](#9-家长留言-messages)
10. [自定义题目 custom-questions](#10-自定义题目-custom-questions)
11. [家庭排行榜 leaderboard](#11-家庭排行榜-leaderboard)
12. [个人设置 settings（难度 / 出题频率 / 比赛长度）](#12-个人设置-settings难度--出题频率--比赛长度)
13. [家长接口 /api/admin/*](#13-家长接口-apiadmin)
14. [客户端各界面需要的数据](#14-客户端各界面需要的数据)
15. [调用节奏建议](#15-调用节奏建议)
16. [离线行为](#16-离线行为)
17. [数据库结构与迁移](#17-数据库结构与迁移)
18. [合作模式 WebSocket](#18-合作模式-websocket)
19. [客户端错误日志 client-log](#19-客户端错误日志-client-log)

---

## 1. 通用约定

### 鉴权

| 类型 | 方式 | 说明 |
|---|---|---|
| 孩子（玩家） | 请求头 `Authorization: Bearer <token>` | token 来自注册 / 登录。改密码、家长重置密码后旧 token 全部失效（返回 401）。 |
| 家长 | 请求头 `X-Admin-Password: <密码>` | 密码来自环境变量 `ADMIN_PASSWORD`；为空时所有 `/api/admin/*` 一律 403。 |
| 公开 | 无 | `GET /api/health`、`GET /api/players`、`POST /api/register`、`POST /api/login`、`POST /api/logout`、`GET /api/catalog` |

所有 `/api/admin/*` 路径在找路由之前先校验家长密码，所以没有密码时连"接口是否存在"都探测不到（一律 403）。

### 错误

非 2xx 响应体固定为 `{ "error": "给人看的中文说明" }`，可以直接显示给用户。

| 状态码 | 含义 |
|---|---|
| 400 | 输入不合法（缺字段、类型不对、长度超限、格式不对） |
| 401 | 未登录 / token 失效 —— 客户端应回到登录页 |
| 403 | 家长密码不对 / 管理功能关闭；或玩家数达上限 |
| 404 | 没有这个接口 / 对象不存在 / 不属于当前玩家 |
| 405 | 路径存在但请求方式不对 |
| 409 | 冲突（名字已被占用、任务还没完成不能标记兑现） |
| 413 | 请求体太大 / 一批数据太多 |
| 429 | 登录失败太多次，暂时锁定 30 秒（规则见 §3） |
| 500 | 服务器内部错误（`{"error":"服务器出错了"}`） |

### 数值和文本

- 时间一律是毫秒时间戳（`number`）。`dueDate` / `day` 这类日期是服务器本地时区的 `"YYYY-MM-DD"`。
- 正确率 `accuracy` 一律是 **0–100 的整数百分比**，没有数据时是 `null`。
- 所有文本（留言、任务名、题目……）都是**纯文本**，服务器会去掉控制字符、首尾空白，但**不做 HTML 转义**。客户端必须按文本显示（`textContent`），不能塞进 `innerHTML`。允许换行的字段（留言、备注、题目、解析）里用 `\n` 换行。
- 长度按"字"（Unicode 字符）计算，一个汉字算 1。
- 数值字段：类型不对（例如传字符串）返回 400；类型对但超出范围的，**夹到范围内**而不是报错（文档里写的范围就是夹取范围）。

### 请求体大小上限

默认 64 KB；`PUT /api/save` 2 MB；`PUT /api/catalog`、`POST /api/answers` 256 KB；心跳 4 KB。超出返回 413。

### 跨域

响应带 `Access-Control-Allow-Origin: *`，允许方法 `GET, POST, PUT, DELETE, OPTIONS`，允许头 `Content-Type, Authorization, X-Admin-Password`。开发时网页（5183）和接口（8080）不同源也能用。

---

## 2. 部署与时区

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8080` | |
| `DATA_DIR` | `./data` | SQLite 文件所在目录（容器里是 `/data`，请挂载并定期备份） |
| `STATIC_DIR` | `../dist` | 游戏网页目录 |
| `ADMIN_PASSWORD` | 空 | 家长密码；空 = 关闭家长功能 |
| `TZ` | 系统默认（容器里通常是 UTC） | **必须设置**，例如 `TZ=Asia/Shanghai` |

**时区很重要**：每天的游戏时长、允许游戏的时间段、"今天 / 近 7 天 / 近 30 天"、排行榜的"本周"（从周一 0 点开始）全部按服务器本地时区计算。容器默认是 UTC，不设置的话北京时间早上 8 点才算"新的一天"。请在 `docker-compose.yml` 的 `environment` 里加上 `TZ: "Asia/Shanghai"`（Node 自带时区数据，alpine 镜像不需要额外装 tzdata）。启动日志和 `GET /api/health` 都会报告当前生效的时区。

```
GET /api/health
→ 200 { "ok": true, "time": 1763600000000, "schemaVersion": 3,
        "tz": "Asia/Shanghai", "tzEnv": "Asia/Shanghai", "utcOffsetMinutes": 480 }
```

`tzEnv` 为 `null` 表示没设置 `TZ`。客户端可以用 `time` 估计本机时钟偏差（见 §5 的 `at`）。

---

## 3. 账号与存档（原有接口）

行为与之前完全一致，这里只列要点。

| 方法 路径 | 鉴权 | 请求 | 响应 |
|---|---|---|---|
| `GET /api/players` | 公开 | — | `{ players: [{ name, grade }] }`（登录页的名字列表；不含任何敏感字段） |
| `POST /api/register` | 公开 | `{ name, password, grade? }` | **201** `{ token, player: { name, grade } }`；400 名字/密码不合法；409 重名；403 已满 50 人 |
| `POST /api/login` | 公开 | `{ name, password }` | `{ token, player }`；401 不对；429 锁定。**一个账号同一时间只能在一台设备上登录**：登录成功会让这个玩家的其他令牌全部失效，并断开他的合作模式连接。旧令牌之后调用任何接口返回 401 `{ "error": "这个账号在另一台设备上登录了，这台设备已自动退出" }`（客户端按「另一台设备」识别，登录页显示这句；服务器重启后变回普通的「请先登录」） |
| `POST /api/logout` | 可带 token | — | `{ ok: true }`（删除该 token） |
| `GET /api/me` | 孩子 | — | `{ player: { name, grade } }` |
| `PUT /api/me` | 孩子 | `{ grade? , password?, newPassword? }` | 改年级：`{ player }`；改密码：`{ token, player }`（返回新 token，旧 token 全部失效）；401 原密码不对 |
| `GET /api/save` | 孩子 | — | `{ data: SaveBlob, version, updatedAt }`（没有存档时 version = 0） |
| `PUT /api/save` | 孩子 | `{ baseVersion, data: SaveBlob }` | `{ data, version, updatedAt }` |

规则：名字 1–12 字，不能含 `< > " ' & \ /` 和控制字符，不区分大小写唯一；密码 4–32 位；年级 3–6（其他值按 3）。

登录限速（按名字，不区分大小写，保存在服务器内存里，重启清零）：同一个名字连续输错 5 次后锁定 30 秒——**第 5 次输错本身仍返回 401**，从第 6 次尝试起在锁定期内一律返回 429（即使密码正确），`error` 形如"密码错得太多了，请 N 秒后再试"（N 为剩余秒数）。锁定结束后失败计数从 0 重新开始（再错 5 次才会再次锁定）；登录成功或家长重置密码会清零计数。客户端在第 5 次 401 之后即可直接显示 30 秒倒计时。

`SaveBlob = { stars: {levelId: 0..3}, wrong: WrongEntry[≤200], agent, mapChoice, stats: { answered, correct, kills, wins }, rank: { pts, best, n } }`。合并规则：`baseVersion` 等于服务器当前版本时以客户端为准（但星级和统计取较大值，永不倒退）；否则两边取并集。

**段位 `rank`**：`pts` = 段位累计星数（会因输局减少，所以不能取较大值），`best` = 历史最高星数，`n` = 计入段位的局数（只增不减）。合并时取 `n` 大的那份（`n` 相同取 `pts` 大的），`best` 取较大值。旧存档没有 `rank` 时按 `min(18, wins + floor(总星星 / 3))` 补一个起始段位（`n = 0`）。段位名称和加减星规则只在客户端（`src/core/rank.ts`），服务器只存数字；实现见 `server/src/rank.ts`，两边必须一致。

> 新功能用到存档里的：`stars`（任务 `clear_level` / `clear_count`、排行榜星星和通关数）、`stats.wins`（排行榜胜利）、`wrong`（客户端按 `reviewRate` 从中重出错题）。

`PUT /api/save` 之后服务器会重新判定该孩子的任务（通关类任务可能因此完成）。

---

## 4. 专题目录 catalog

服务器不引用客户端代码，专题名 / 关卡名需要客户端上传。**每次启动游戏（登录成功后）调用一次 `PUT /api/catalog`**；内容没变时服务器不写库（`changed: false`），所以重复调用没有成本。

没上传过目录时所有功能照常工作：报告里专题名显示为原始 id，任务校验不检查 id 是否存在，关卡年级按 `"年级-序号"` 的编号规则推断。

### `PUT /api/catalog`（孩子）

```json
{
  "topics": [ { "id": "g3-hecha", "grade": 3, "name": "和差倍问题" } ],
  "levels": [ { "id": "3-1", "grade": 3, "name": "和差倍问题", "topicIds": ["g3-hecha"], "boss": false } ]
}
```

- `topics`、`levels` 各最多 400 项；id 为 `[A-Za-z0-9_-]`，专题 id ≤ 40 字符、关卡 id ≤ 16 字符，不能重复；`grade` 必须是 3–6；`name` 1–40 字；每关 `topicIds` ≤ 60 个。
- 整份替换。请直接由 `ALL_TOPICS`（`{id, grade, name}`）和 `LEVELS`（`{id, grade, name, topicIds, boss}`）映射生成。
- 响应：`{ ok: true, changed: boolean, topics: number, levels: number }`。错误：400 格式不对、413 太大、401 未登录。

### `GET /api/catalog`（公开）

`{ catalog: { topics, levels, updatedAt } | null }`

---

## 5. 答题记录 answers

孩子每答一道题（无论在哪个场景）产生一条记录。它驱动学习报告、任务进度、排行榜、自定义题"毕业"。

### `POST /api/answers`（孩子）

```json
{ "answers": [
  { "id": "k3f9a-000123", "topicId": "g3-hecha", "grade": 3, "difficulty": 2,
    "correct": true, "ms": 8400, "context": "gate", "levelId": "3-1", "at": 1763600000000 },
  { "id": "k3f9a-000124", "topicId": "custom", "grade": 3, "difficulty": 1,
    "correct": false, "ms": 15000, "context": "custom", "customId": 12, "levelId": "3-1", "at": 1763600030000 }
] }
```

| 字段 | 必填 | 规则 |
|---|---|---|
| `id` | 是 | 客户端生成的唯一 id，`[A-Za-z0-9_.:-]{1,64}`。**幂等键**：同一玩家同一 `id` 只记一次。建议 `设备随机前缀-自增序号` 或 UUID。 |
| `correct` | 是 | 必须是布尔值 |
| `context` | 是 | `gate`（门槛题）· `bonus`（加分题）· `plant`（安放）· `defuse`（拆除）· `revive`（复活）· `practice`（练习/错题本订正）· `custom`（家长出题） |
| `at` | 是 | 答题时刻（客户端毫秒时间戳）。比服务器时间快 60 秒以上的按服务器当前时间记；早于 400 天前的整条拒收。 |
| `topicId` | 非 custom 时必填 | `[A-Za-z0-9_-]{1,40}`，不能是 `"custom"` |
| `grade` | 非 custom 时必填 | 3–6，其他值整条拒收 |
| `difficulty` | 否 | 1–3，缺省 1，超出夹取 |
| `ms` | 否 | 用时（毫秒），夹到 0–600000，缺省 `null` |
| `levelId` | 否 | `[A-Za-z0-9_-]{0,16}`，不合法记为 `""` |
| `customId` | `context = "custom"` 时必填 | 自定义题 id（见 §10）。必须是出给当前孩子的题，否则整条拒收。服务器会把这条记录的 `topicId` 记为 `"custom"`、年级取题目的年级、难度记为 1。 |

- 一批最多 200 条（超过返回 413，整批不收）；空数组合法。
- **坏记录只跳过，不让整批失败**。响应：

```json
{ "accepted": 1, "duplicates": 0, "rejected": ["bad-id-or-null"], "tasksCompleted": 1 }
```

`accepted` 新入库条数，`duplicates` 之前已收过的条数，`rejected` 被拒收记录的 `id`（没有合法 id 时为 `null`），`tasksCompleted` 本次让多少个任务新完成（> 0 时可以立即刷新 `GET /api/tasks` 播放庆祝）。

**只要返回 200，就把这一批全部从本地队列删除**（包括 duplicates 和 rejected —— 重发也不会被接受）。

---

## 6. 孩子的学习小结 report/me

### `GET /api/report/me`（孩子）

只返回自己的数据：

```json
{
  "totals": { "answered": 320, "correct": 251, "accuracy": 78 },
  "week":   { "answered": 96, "correct": 80, "accuracy": 83, "startsAt": 1763251200000 },
  "today":  { "answered": 22, "correct": 19, "accuracy": 86 },
  "streak": { "current": 4, "best": 17 },
  "topics": [ { "topicId": "g3-hecha", "name": "和差倍问题", "answered": 47, "correct": 30, "accuracy": 64 } ]
}
```

`week` 从本周一 0 点算起；`topics` 按答题数从多到少；家长出题的 `topicId` 为 `"custom"`、`name` 为 `"家长出题"`。连对按答题时刻 `at` 排序计算，跨所有场景。

---

## 7. 任务与奖励 tasks

家长给某个孩子或所有孩子布置任务，服务器根据答题记录和存档星级**自动**判定进度和完成，孩子端只读。

### 任务类型 `kind` 和 `params`

| kind | params | 完成条件 | `progress.unit` |
|---|---|---|---|
| `clear_level` | `{ levelId }` | 存档里该关 ≥ 1 星（之前就通关的也算） | `level` |
| `clear_count` | `{ count, grade? }` | 存档里 ≥ 1 星的关卡数（可限定年级）≥ count；是累计数，不是"布置后新通关" | `levels` |
| `correct_in_topic` | `{ topicId, count }` | 布置之后在该专题答对 ≥ count 题 | `correct` |
| `correct_total` | `{ count }` | 布置之后累计答对 ≥ count 题 | `correct` |
| `accuracy` | `{ percent, minAnswers, topicId? }` | 布置之后（可限定专题）至少答 minAnswers 题，且正确率 ≥ percent% | `answers` |
| `streak` | `{ count }` | 布置之后出现连续答对 ≥ count 题 | `streak` |

"布置之后"按答题记录的 `at` 判断；有截止日期时只统计截止日 23:59:59 之前的答题。通关类任务过了截止日期就不再判定。**完成是锁定的**：一旦完成，之后答错也不会退回未完成。

### `GET /api/tasks`（孩子）

返回对当前孩子有效的：进行中的任务 + 已完成的任务（完成后 7 天内，或还没确认庆祝的）。不返回过期和已归档的任务，也不包含任何其他孩子的信息。

```json
{ "tasks": [ {
  "id": 7, "kind": "correct_in_topic",
  "title": "植树问题练 30 题", "description": "在「植树问题」答对 30 题",
  "note": "加油！", "reward": "周末去游乐园",
  "dueAt": 1764172799999, "dueDate": "2026-11-26",
  "bonusCredits": 200,
  "params": { "topicId": "g3-zhishu", "count": 30 },
  "createdAt": 1763000000000,
  "status": "active",
  "progress": { "current": 18, "target": 30, "unit": "correct" },
  "completedAt": null, "rewardGranted": false,
  "forAll": false, "justCompleted": false
} ] }
```

- `status`：`active` | `done`（列表里只会出现这两种）。
- `progress`：`{ current, target, unit }`，`current` 不超过 `target`，已完成时等于 `target`。`accuracy` 任务额外有 `accuracy`（当前正确率，可能为 `null`）和 `percent`（目标），此时 `current/target` 是"已答题数 / 最少题数"——显示成"已答 12/20 题，正确率 75%（目标 85%）"。
- `title` 家长没填时自动生成，等于 `description`。
- `reward`：家长承诺的现实奖励文字（可能为空）；`rewardGranted`：家长已兑现。
- `bonusCredits`：0–2000 的游戏内奖励（每回合开始时额外给的金币）。服务器只存储和返回，**如何使用由客户端决定**（建议：对 `status = "done"` 且仍在列表里的任务生效；见文末待确认问题）。
- **`justCompleted`**：已完成且该孩子还没确认过庆祝时为 `true`。客户端播放一次庆祝后调用 ack，之后永远是 `false`。没 ack 之前每次拉取都是 `true`（所以中途断网不会漏掉庆祝）。

### `POST /api/tasks/:id/ack`（孩子）

标记"已经给孩子看过完成庆祝"。响应 `{ ok: true, acked: boolean }`（`acked: false` 表示任务还没完成，什么也没做）。任务不属于当前孩子时 404。重复调用无害。

---

## 8. 游戏时间 playtime

服务器**只记录和报告**，由客户端执行限制。家长没开启时（默认）只记录时长，`allowedNow` 永远是 `true`。

### `POST /api/playtime/heartbeat`（孩子）

对局进行中每 ~30 秒发一次：`{ "seconds": 30 }`，表示距上次心跳实际玩了多少秒。

服务器的计时规则（防止虚报和囤积）：

1. `seconds` 必须是数字（否则 400），夹到 0–60。
2. 距上次心跳不到 5 秒的心跳**整个忽略**（`ignored: true, credited: 0`）。
3. 距上次心跳在 10 分钟以内时，最多计入"实际间隔 + 2 秒"。
4. 跨过午夜的心跳按真实时间拆到前后两天。

响应 = 下面的状态对象，外加 `credited`（本次实际计入秒数）和 `ignored`。

### `GET /api/playtime`（孩子）

```json
{
  "enabled": true,
  "usedToday": 1260,
  "bonusMinutesToday": 15,
  "serverTime": 1763630000000,
  "limitToday": 3600,
  "remaining": 2340,
  "allowedNow": true,
  "nextAllowedAt": null,
  "windowEndsAt": 1763641800000,
  "reason": null,
  "message": "",
  "windowsToday": [ { "start": "16:00", "end": "20:30" } ]
}
```

| 字段 | 含义 |
|---|---|
| `enabled` | 家长是否开启了时间管理 |
| `usedToday` | 今天已玩**秒数** |
| `bonusMinutesToday` | 家长今天临时加的分钟数（只当天有效） |
| `limitToday` | 今天上限**秒数**（含加时）；`null` = 不限时长（或未开启） |
| `remaining` | 今天剩余**秒数**；`null` = 不限。**注意**：`null <= 0` 在 JS 里是 `true`，请只用 `allowedNow` 判断 |
| `allowedNow` | **现在能不能开新局**（唯一需要判断的字段） |
| `reason` | `null` · `"daily_limit"`（今天时间用完） · `"outside_window"`（不在允许时间段） |
| `message` | 给孩子看的中文提示，如"今天的游戏时间用完啦，明天 16:00 再来吧" |
| `nextAllowedAt` | 不能玩时，下一次可以玩的时刻（7 天内找不到则 `null`）；能玩时为 `null` |
| `windowEndsAt` | 正在某个时间段内时，该时间段结束时刻；全天可玩时为 `null` |
| `windowsToday` | 今天的允许时间段（空数组 = 全天） |

客户端执行建议：标题页 / 选关页在 `allowedNow === false` 时禁用"开始"并显示 `message`；**正在进行的对局不要打断**，对局结束后再判断；`remaining` 小于一局时长时可以提前提醒。

---

## 9. 家长留言 messages

### `GET /api/messages`（孩子）

返回给当前孩子的和给所有人的、未过期且**该孩子还没标为已读**的留言，最新在前，最多 20 条：

```json
{ "messages": [ { "id": 31, "text": "今天表现很棒！\n继续加油", "forAll": false, "createdAt": 1763600000000, "expiresAt": null } ] }
```

纯文本，≤ 200 字，可能含 `\n`。客户端把未读留言醒目地弹出，孩子点"知道了"后调用下面的接口标为已读，之后这条留言在任何设备上都不再显示。客户端同时在本地记住已看过的 `id`（离线也能立即隐藏），服务器仍返回本地已看过的留言时补发一次已读。

### `POST /api/messages/read`（孩子）

`{ "ids": [31, 32] }`（最多 100 个）→ `{ ok: true, marked }`。只记录确实发给该孩子（或所有人）的留言，重复标记无副作用（`marked` 为本次新标记的条数）。

家长端 `GET /api/admin/messages` 的每条留言多一个 `readBy: [{ playerId, name, readAt }]`。

---

## 10. 自定义题目 custom-questions

家长出的题，四选一，不带配图。

### `GET /api/custom-questions`（孩子）

返回出给当前孩子（或所有人）、已启用、且该孩子还没"毕业"（答对次数 < 要求次数）的题，按创建先后：

```json
{ "questions": [ {
  "id": 12, "topicId": "custom", "grade": 3, "difficulty": 1,
  "text": "爸爸今年 36 岁，是你的 4 倍。\n你今年几岁？",
  "options": ["8 岁", "9 岁", "10 岁", "12 岁"], "answer": 1,
  "explain": "36 ÷ 4 = 9（岁）",
  "topicLabel": "家庭题", "remainingCorrect": 2
} ] }
```

形状与客户端 `Question` 兼容（多了 `id`、`topicLabel`、`remainingCorrect`，没有 `figure`）。作答结果通过 §5 上报，`context: "custom"`、`customId: <id>`。孩子对一道题累计答对 `requiredCorrect` 次后，这道题不再返回给他。是否用作门槛题由 `customRate` 决定（§12）。

---

## 11. 家庭排行榜 leaderboard

### `GET /api/leaderboard`（孩子）

```json
{
  "weekStartsAt": 1763251200000,
  "weekAccuracyMin": 10,
  "meHidden": false,
  "players": [ { "name": "小明", "grade": 3, "rank": 20, "stars": 18, "cleared": 9, "wins": 3,
                 "weekAnswered": 114, "weekCorrect": 69, "weekAccuracy": 61, "bestStreak": 13, "isMe": true } ],
  "boards": {
    "rank":         [ { "name": "小明", "value": 20, "rank": 1 } ],
    "stars":        [ { "name": "小明", "value": 18, "rank": 1 } ],
    "cleared":      [ … ], "weekCorrect": [ … ], "weekAccuracy": [ … ], "bestStreak": [ … ], "wins": [ … ]
  }
}
```

- "本周"从服务器时区的周一 0 点开始。`weekAccuracy` 只有本周答题 ≥ 10 时才有值，否则 `null` 且不进 `weekAccuracy` 榜。
- 每个榜从高到低；并列同名次（`rank` 相同），同分按名字排序。
- 家长可以隐藏某个孩子（`hideFromLeaderboard`）：他不出现在任何人的榜上；他自己拉取时 `meHidden: true`（客户端可以显示"排行榜已关闭"）。
- `players[].rank` / `boards.rank` 的值是段位累计星数（客户端换算成“黄金 III · 2 星”），注意它和榜单名次字段 `rank` 同名但含义不同。
- 只包含名字、年级和这些指标，没有任何敏感信息。

---

## 12. 个人设置 settings（难度 / 出题频率 / 比赛长度）

### `GET /api/settings/me`（孩子）

```json
{ "settings": {
  "grade": 3,
  "passAccuracy": 60, "botStrength": 1, "reviveSeconds": 60, "gateRequired": true,
  "gateCount": 1, "bonusCount": 2, "plantQuestions": 1, "defuseQuestions": 1, "reviewRate": 20, "customRate": 100,
  "roundsToWin": null, "bossRoundsToWin": null
} }
```

全部由**客户端应用**，服务器只存储。家长没设置过时返回默认值。

| 字段 | 范围 | 默认 | 含义（客户端如何应用） |
|---|---|---|---|
| `grade` | 3–6 | 注册时 | 孩子年级（与 `/api/me` 一致） |
| `passAccuracy` | 40–100 | 60 | 本局答题正确率 ≥ 该值才算过关 |
| `botStrength` | 0.5–1.5（步长 0.05） | 1 | 机器人强度倍率，乘到关卡的 `botSkill` 等参数上 |
| `reviveSeconds` | 20–180 | 60 | 复活答题限时（秒） |
| `gateRequired` | bool | true | 购买阶段是否必须先答对门槛题 |
| `gateCount` | 1–5 | 1 | 每回合开始前必须答对的门槛题数量（仅 `gateRequired` 时有效） |
| `bonusCount` | 0–4 | 2 | 每回合提供的可选加分题数量 |
| `plantQuestions` | 1–3 | 1 | 安放需要答对的题数 |
| `defuseQuestions` | 1–3 | 1 | 拆除需要答对的题数 |
| `reviewRate` | 0–50（%） | 20 | 每道门槛题有该概率改为**重出错题本里的题**——从存档 `wrong` 列表（`GET /api/save` 的 `data.wrong[].q`）里挑；错题本为空时照常出新题 |
| `customRate` | 0–100（%） | 100 | 有待做的家长出题（§10 列表非空）时，每道门槛题有该概率使用家长出题 |
| `roundsToWin` | 3–13 或 `null` | null | 普通关卡先赢几回合获胜；`null` = 用游戏默认（客户端默认 5） |
| `bossRoundsToWin` | 3–13 或 `null` | null | 终局（boss）关卡先赢几回合获胜；`null` = 用游戏默认（客户端默认 7） |

建议的门槛题抽题顺序：先按 `customRate` 决定是否用家长出题，否则按 `reviewRate` 决定是否重出错题，否则按关卡专题正常出题。

设置在下一局开始时生效即可（对局中途不需要热更新）。

---

## 13. 家长接口 /api/admin/*

全部需要 `X-Admin-Password`。`:id` 是玩家编号（`GET /api/admin/players` 返回的 `id`）。

### 总览与玩家

| 方法 路径 | 说明 |
|---|---|
| `GET /api/admin/dashboard` | `{ now, today, tz, tzEnv, utcOffsetMinutes, catalogLoaded, players: [卡片] }`；卡片含 `id, name, grade, stars, cleared, wins, weekAnswered, weekCorrect, weekAccuracy(≥10 题), weekAccuracyAny, bestStreak, currentStreak, todayAnswered, todayCorrect, todaySeconds, playtimeEnabled, limitToday, activeTasks, rewardsToGrant, lastAnswerAt, saveUpdatedAt, hidden` |
| `GET /api/admin/players` | `{ players: [{ id, name, grade, createdAt, updatedAt, summary: { stars, cleared, answered, correct, wins, wrong, rank } }] }` |
| `GET /api/admin/players/:id/report` | 完整学习报告，见下 |
| `GET /api/admin/players/:id/wrong` | `{ name, wrong: WrongEntry[] }`（按名字的旧接口 `GET /api/admin/wrong?name=` 仍可用） |
| `POST /api/admin/players/:id/reset-password` | `{ newPassword }` → `{ ok }`；该孩子所有 token 失效（旧接口 `POST /api/admin/reset-password {name,newPassword}` 仍可用） |
| `DELETE /api/admin/players/:id` | 删除孩子及其全部数据（存档、登录、答题记录、任务进度、专属任务、游戏时间、留言、设置、题目分配）→ `{ ok }`（旧接口 `POST /api/admin/delete-player {name}` 仍可用） |

**学习报告** `GET /api/admin/players/:id/report`：

```
{ player: { id, name, grade }, generatedAt, catalogLoaded,
  totals: { answered, correct, accuracy, avgMs, daysActive, firstAt, lastAt },
  last7: { answered, correct, accuracy },              // 含今天在内的 7 个自然日
  streak: { current, best },
  topics: [ { topicId, name, grade, answered, correct, accuracy, last7: {answered, correct, accuracy}, avgMs, lastAt } ],
  weakTopics: [ { topicId, name, answered, accuracy } ],   // 答题 ≥ weakMinSample(8) 且正确率 < 80%，最低的 5 个
  weakMinSample: 8,
  daily: [ { day: "YYYY-MM-DD", answered, correct, accuracy } ],   // 最近 30 天，旧→新，没答题的天也有
  byDifficulty: [ { difficulty: 1|2|3, answered, correct, accuracy } ],
  byContext: [ { context, answered, correct, accuracy } ] }       // 只列有数据的场景
```

### 任务

| 方法 路径 | 请求 | 响应 |
|---|---|---|
| `GET /api/admin/tasks[?playerId=]` | — | `{ tasks: [AdminTask], kinds }`（带 `playerId` 时只列该孩子的专属任务和全体任务） |
| `POST /api/admin/tasks` | TaskInput | **201** `{ task: AdminTask }` |
| `PUT /api/admin/tasks/:id` | TaskInput 的任意子集 | `{ task }`。改了类型 / 参数 / 截止日 / 对象时，未兑现的完成记录作废并按新目标重新判定 |
| `DELETE /api/admin/tasks/:id` | — | `{ ok }` |
| `POST /api/admin/tasks/:id/archive` | `{ archived: boolean }`（缺省 true） | `{ task }`；归档后孩子看不到 |
| `POST /api/admin/tasks/:id/grant` | `{ playerId?, granted?: boolean }`（全体任务必须给 playerId；granted 缺省 true，false = 撤销） | `{ task }`；没完成时 409 |

`TaskInput = { playerId: number|null(全体), kind, params, title?(≤40), note?(≤200，可换行), reward?(≤60), dueDate?: "YYYY-MM-DD"|null, bonusCredits?: 0–2000 }`。
参数范围：`count` 1–200（clear_count）/ 1–5000（correct_in_topic）/ 1–10000（correct_total）/ 2–200（streak）；`percent` 1–100；`minAnswers` 5–2000；有目录时 `levelId`、`topicId` 必须存在。最多 500 个任务。

`AdminTask` = 孩子端任务字段 + `{ playerId, playerName, archived, updatedAt, players: [{ playerId, name, status: active|done|expired|archived, progress, completedAt, rewardGranted, grantedAt, celebrated }] }`。

### 游戏时间

| 方法 路径 | 请求 | 响应 |
|---|---|---|
| `GET /api/admin/players/:id/playtime` | — | `{ settings, status, days }` |
| `PUT /api/admin/players/:id/playtime` | settings 的任意子集 | 同上 |
| `POST /api/admin/players/:id/playtime/bonus` | `{ minutes: -240..240, ≠0 }` | `{ bonusMinutesToday, status }`（今天的加时累计，夹到 0–600） |

`settings = { enabled, weekdayMinutes: 0–720|null, weekendMinutes: 0–720|null, weekdayWindows: Window[≤4], weekendWindows: Window[≤4] }`，`Window = { start: "HH:MM", end: "HH:MM" | "24:00" }`，结束要晚于开始、不能重叠（不支持跨午夜的时间段），空数组 = 全天。周六、周日用周末设置。
`status` 同 §8；`days` 是最近 14 天 `[{ day, seconds, bonusMinutes }]`（旧→新）。

### 留言

| 方法 路径 | 请求 | 响应 |
|---|---|---|
| `GET /api/admin/messages` | — | `{ messages: [{ id, text, forAll, playerId, playerName, createdAt, expiresAt, expired }] }`（最近 200 条） |
| `POST /api/admin/messages` | `{ text(1–200), playerId?: number|null, expiresInHours?: 1–720 }` | **201** `{ message }` |
| `DELETE /api/admin/messages/:id` | — | `{ ok }` |

### 自定义题目

| 方法 路径 | 请求 | 响应 |
|---|---|---|
| `GET /api/admin/custom-questions` | — | `{ questions: [AdminQuestion] }` |
| `POST /api/admin/custom-questions` | QuestionInput | **201** `{ question }` |
| `PUT /api/admin/custom-questions/:id` | QuestionInput 的任意子集 | `{ question }` |
| `DELETE /api/admin/custom-questions/:id` | — | `{ ok }`（答题记录保留在报告里） |
| `GET /api/admin/custom-questions/:id/stats` | — | `{ question, attempts: [{ playerId, name, correct, ms, at }] }`（最近 100 次） |

`QuestionInput = { text(1–300，可换行), options: [4 个互不相同的非空文本，各 ≤60], answer: 0–3, explain?(≤400), grade: 3–6, topicLabel?(≤20), playerIds?: number[]|null(全体), active?: boolean, requiredCorrect?: 1–20 }`。最多 500 道。
`AdminQuestion` = 上述字段 + `{ id, forAll, createdAt, updatedAt, stats: [{ playerId, name, answered, correct, wrong, lastAt, retired }], totals: { answered, correct } }`。

### 排行榜与个人设置

| 方法 路径 | 说明 |
|---|---|
| `GET /api/admin/leaderboard` | 同孩子端，但 `players` 含被隐藏的孩子（`hidden: true`, `id`），`boards` 不含他们 |
| `GET /api/admin/players/:id/settings` | `{ settings: { grade, …§12 全部字段, hideFromLeaderboard }, defaults }` |
| `PUT /api/admin/players/:id/settings` | 任意子集（含 `grade`、`hideFromLeaderboard`）；未给的字段不变 → 同 GET |

### 家长管理密码

| 方法 路径 | 说明 |
|---|---|
| `GET /api/admin/password` | `{ source: 'env' \| 'custom', changedAt }`：`env` = 仍在用环境变量 `ADMIN_PASSWORD`；`custom` = 在管理页改过（`changedAt` 为修改时间） |
| `POST /api/admin/password` | `{ currentPassword, newPassword }` → `{ ok, source, changedAt }`。新密码 6–64 位，只能是 ASCII 可打印字符（密码放在请求头里传，非 ASCII 传不了），首尾不能是空格；当前密码不对 → 400 |

规则（`server/src/features/admin-auth.ts`）：改过的密码加盐哈希存在 `admin_auth` 表，同时记下当时 `ADMIN_PASSWORD` 的哈希。只要 `ADMIN_PASSWORD` 不变，就以改过的密码为准；**忘了密码时把 `ADMIN_PASSWORD` 换成新值并重建容器**，新的环境变量密码生效，改过的密码作废。`ADMIN_PASSWORD` 为空时管理功能始终关闭。

---

## 14. 客户端各界面需要的数据

| 界面 | 调用 |
|---|---|
| 登录页 | `GET /api/players`（名字列表）、`POST /api/login` / `POST /api/register` |
| 登录成功 / 启动 | `PUT /api/catalog`、`GET /api/save`、`GET /api/settings/me`、`GET /api/messages`、`GET /api/tasks`、`GET /api/playtime`；把本地离线队列里的答题记录发出去 |
| 标题页 | 最新留言（新 id 弹窗一次）、进行中的任务和进度条、`justCompleted` 的任务播放庆祝后 ack、游戏时间状态（今天剩余 / 不能玩的 `message`） |
| 选关 / 开局前 | `GET /api/playtime`：`allowedNow === false` 时禁止开新局；用设置里的 `roundsToWin` / `bossRoundsToWin`、`botStrength`；`GET /api/custom-questions` 准备门槛题 |
| 对局中 | 门槛题按 `gateCount`、`customRate`、`reviewRate` 抽题；加分题 `bonusCount`；安放 / 拆除 `plantQuestions` / `defuseQuestions`；复活 `reviveSeconds`；每题结束写入本地答题队列；每 30 秒心跳 |
| 结算页 | 过关判定用 `passAccuracy`；发送答题队列；`PUT /api/save`；`GET /api/tasks`（播放新完成的庆祝） |
| 学习小结 / 我的 | `GET /api/report/me` |
| 排行榜 | `GET /api/leaderboard` |

---

## 15. 调用节奏建议

- **答题记录**：每题答完立即追加到本地队列（带好 `id` 和 `at`）。在**回合结束、对局结束、回到标题页、页面隐藏（`visibilitychange`）时**批量发送，每批 ≤ 200 条。对局中不必每题都发。
- **心跳**：只在对局进行中（含购买阶段，不含暂停 / 结算 / 菜单）每 30 秒发一次 `{ seconds: 距上次心跳实际经过的秒数 }`；对局结束时补发一次剩余秒数（不少于 5 秒间隔，否则会被忽略——可以并入下一局的第一次心跳）。页面隐藏或暂停时停止计时。心跳响应本身就是最新的游戏时间状态，不用另外拉。
- **对局结束后刷新**：发送答题队列 → `PUT /api/save` → `GET /api/tasks`（看 `justCompleted`）→ `GET /api/playtime`（下一局能否开始）→ `GET /api/custom-questions`（有的题已毕业）。
- **回到标题页**：`GET /api/messages`、`GET /api/tasks`、`GET /api/playtime`。
- **设置**：登录时和每局开始前 `GET /api/settings/me`（很便宜）。
- **目录**：每次启动 `PUT /api/catalog` 一次。

---

## 16. 离线行为

服务器在家里 NAS 上，平板离开家里网络或 NAS 重启时接口会失败。约定：

| 数据 | 离线时客户端怎么做 |
|---|---|
| 答题记录 | **必须排队**。持久化到 `localStorage`（按玩家分开），联网后按顺序重发，每批 ≤ 200。服务器按 `(玩家, id)` 去重，所以"发了但没收到响应"时直接重发即可。收到 200 后把这一批整体删掉；4xx（401 除外）也删掉以免死循环；401 时保留，重新登录后再发；5xx / 网络错误保留并指数退避重试。`at` 必须是答题当时的时间，不要用发送时间。队列建议上限约 5000 条，超出丢最旧的。 |
| 存档 | 沿用现在的做法（本地保存 + 带 `baseVersion` 合并），联网后 `PUT /api/save`。 |
| 心跳 | **不排队、不补发**。离线期间的游戏时长不计入（服务器单次最多计 60 秒，补发也没有用）。 |
| 游戏时间限制 | 用最后一次拿到的状态继续执行：本地按经过的时间递减 `remaining`，`windowEndsAt` 之后视为不可玩；跨过本地午夜后可以视为新的一天（`usedToday` 归零）但窗口规则照旧。联网后以服务器为准。 |
| 任务 / 留言 / 排行榜 / 设置 / 自定义题 | 用最后一次缓存的数据显示；不能在离线时判定任务完成（完成以服务器为准，联网发送答题后再拉 `GET /api/tasks`）。 |
| 庆祝 ack | 失败可以不重试——下次拉取 `justCompleted` 仍为 `true`，会再庆祝一次，属于可接受的重复。如果想避免，本地记下"已庆祝的任务 id"，联网后补发 ack。 |
| 自定义题作答 | 和普通答题一样进队列（`context: "custom"`, `customId`）；离线期间本地可以按 `remainingCorrect` 自行递减，避免同一题反复出现。 |

---

## 17. 数据库结构与迁移

`schema_version` 表记录结构版本（当前 5），启动时按顺序执行未执行过的迁移，全部是新增表 / 新增列，老数据库原地升级、数据不丢：

| 版本 | 内容 |
|---|---|
| 1 | 最初的 `players`、`sessions`、`saves`（老数据库没有 `schema_version`，视为 0，重放第 1 版是 `IF NOT EXISTS`，无副作用） |
| 2 | `catalog`、`answers`（主键 `(player_id, client_id)`）、`player_settings`、`tasks`、`task_progress`、`playtime_settings`、`playtime_usage`、`messages`、`custom_questions`、`custom_assign` |
| 3 | `player_settings` 增加出题频率与比赛长度列（老行自动取默认值） |
| 4 | 新增 `admin_auth`（家长在管理页改过的密码，只有一行） |
| 5 | 新增 `message_reads`（留言已读记录，留言或孩子删除时一并删除） |

所有与玩家相关的表都 `REFERENCES players(id) ON DELETE CASCADE`，删除玩家会清掉他的全部数据；全体任务和全体题目保留。

---

## 18. 合作模式 / 联机对战 WebSocket

两种玩法共用一套房间协议（建房时用 `mode` 选定，房间存在期间不变）：
- `coop` 合作：2–4 个家人组队打电脑，所有人 `team` 恒为 0；
- `versus` 对战：家人分成蓝队（`team` 0）/ 红队（`team` 1）互相打，每队人数不够关卡的每队人数时由电脑补满（补位由客户端做）。

服务器只管**房间**和**按座位转发消息**，不理解游戏内容（游戏同步由房主的客户端负责，见 `src/net/coop-link.ts`）。房间只存在内存里，服务器重启后全部消失。

### 连接

- 地址：`ws://<主机>/api/coop`（与网页同一个端口；页面是 https 时用 `wss://`）。实现在 `server/src/coop.ts`，零第三方依赖（自己处理 WebSocket 握手和帧）。
- 每条消息是一个 **文本帧**，内容是 JSON 对象，`t` 字段为类型。单条消息上限 **16 KB**，超过则服务器关闭连接（关闭码 1009）。每个连接每秒最多 **120** 条，超过关闭（1008）。
- 服务器每 15 秒发一次 WebSocket ping，35 秒内没有 pong 就断开。客户端也可以发 `{t:"ping"}`，服务器回 `{t:"pong"}`。
- 连接断开 = 离开所在房间（规则同 `leave`）。

### 鉴权

连上后 10 秒内必须发：

```json
{ "t": "hello", "token": "<登录令牌>" }
```

成功 → `{ "t": "welcome", "you": { "playerId": 1, "name": "小明", "grade": 3 } }`；令牌无效 → `{ "t": "error", "code": "auth", "message": "请先登录" }` 然后关闭（4401）。鉴权前发其他消息同样处理。

### 房间信息

```ts
interface RoomInfo {
  id: string;              // 4 位数字，如 "4821"
  state: 'lobby' | 'playing';
  mode: 'coop' | 'versus'; // 玩法（老服务器没有这个字段，客户端按 'coop' 处理）
  levelId: string;
  mapId: string;
  members: CoopMember[];   // 见 src/net/coop-link.ts；按 seat 升序；seat 0 起，加入后不变，空出的 seat 不复用
                           // 每个成员带 team（0 蓝 / 1 红；合作恒为 0；老服务器没有，客户端按 0 处理）
}
```

分队规则（仅 `versus`）：房主建房时在蓝队 0；之后进房的人去**真人少的那一队**（一样多去蓝队 0）。之后可以用 `team` 消息换队。除了房间总人数上限 4 人以外，不限制每队的真人数。

### 客户端 → 服务器

| 消息 | 说明 |
|---|---|
| `{t:"rooms"}` | 订阅房间列表：立刻回 `{t:"rooms", rooms: RoomInfo[]}`，之后只要列表有变化（任何房间建立 / 关闭 / 成员变动 / 状态变化）就再推一次，直到这个连接进入某个房间。进房后自动退订，离开房间后需要重新发 `rooms` |
| `{t:"create", levelId, mapId, agentId, mode}` | 建房，自己是房主（seat 0）→ `{t:"room", room, selfSeat: 0}`。`mode` 为 `"coop"` / `"versus"`，省略 = `"coop"`（兼容老客户端），其他值 → `bad-message` |
| `{t:"join", roomId, agentId}` | 进房 → `{t:"room", room, selfSeat}`；房里其他人收到 `{t:"room", room}`（无 `selfSeat`）。失败 → `{t:"error", code, message}`，`code` 为 `not-found` / `full`（已 4 人）/ `started`（正在对局）/ `duplicate`（同一个孩子已经在房里）/ `in-room`（自己已经在别的房间里） |
| `{t:"agent", agentId}` | 换角色（仅大厅状态）→ 全房间收到 `{t:"room", room}` |
| `{t:"level", levelId, mapId}` | 房主换关卡（仅大厅状态）→ 全房间收到 `{t:"room", room}` |
| `{t:"team", team, seat?}` | 换队（仅 `versus` 房间、仅大厅状态）。不带 `seat`（或 `seat` 是自己）= 换自己；带别人的 `seat` = 房主把那个人换过去（非房主 → `not-host`）。`team` 须为 0 / 1。成功 → 全房间收到 `{t:"room", room}`；本来就在那一队 → 无效果、无回复。合作房间 → `not-versus`；`seat` 不在房里 → `no-member` |
| `{t:"start", seed, levelId, mapId, opts}` | 房主开局（仅大厅状态）。服务器把房间改为 `playing`，补上房间的 `mode` 和当前 `members`（含 `team`），向**全房间（含房主）**发 `{t:"start", start: CoopStart}`（`start = {mode, seed, levelId, mapId, opts, members}`）。`versus` 房间里蓝队、红队都至少要有 1 个真人，否则 → `{t:"error", code:"teams", message:"红队还没有人：……"}` |
| `{t:"msg", to, d}` | 转发：`to` 是 seat 数字 / `"host"` / `"all"`（除自己外的所有人）。收件人收到 `{t:"msg", from: <发送者 seat>, d}`。大厅和对局中都可以发。发给不存在的 seat 静默丢弃 |
| `{t:"end"}` | 房主：这局打完了，房间回到 `lobby`（可以再开一局）→ 全房间收到 `{t:"room", room}` |
| `{t:"leave"}` | 离开房间。**房主离开**：房间关闭，其他人收到 `{t:"closed", reason:"房主离开了房间"}`。**其他人离开**：剩下的人收到 `{t:"left", seat}` 和新的 `{t:"room", room}` |

不在房间里时发 `agent` / `level` / `team` / `start` / `msg` / `end` → `{t:"error", code:"no-room"}`；非房主发 `level` / `start` / `end` → `{t:"error", code:"not-host"}`；未知类型 → `{t:"error", code:"bad-message"}`（不断开）。

### 服务器 → 客户端（汇总）

`welcome`、`rooms`、`room`、`start`、`msg`、`left`、`closed`、`pong`、`error`，格式见上。

### 细节约定（实现补充）

- `error` 总是带 `message`（给孩子看的中文），客户端按 `code` 判断。除上面列出的，还有：`started`——对局中发 `agent` / `level` / `team` / `start`；`in-room`——已在房间里又发 `create`；`bad-message`——字段缺失或格式不对（`levelId` / `mapId` / `agentId` 须为 1–64 字符的字符串，`seed` 须为数字，`opts` 须为对象，`to` 须为整数 / `"host"` / `"all"`，`team` 须为 0 / 1，`team` 消息的 `seat` 须为整数，`mode` 须为 `"coop"` / `"versus"`）。
- `start` 里的 `levelId` / `mapId` 可省略（沿用房间当前值）；给了就同时更新房间的关卡。`opts` 省略则为 `{}`。
- `msg` 的 `to` 省略视为 `"all"`；`d` 省略为 `null`。发给自己（自己的 seat，或房主发 `"host"`）静默丢弃，不会回显。
- `end` 在大厅状态下发：无效果、无回复。
- 主动 `leave` 的人自己不会收到任何回复（房间也不再推送给他）；想看房间列表需重新发 `rooms`。`closed` 之后其他人仍保持连接、已离开房间。
- `join` 的 `roomId` 传字符串或数字都行。
- 同一个账号进同一个房间：服务器先 ping 房里那个旧连接，3 秒内没回应就当它掉线、踢掉后让新连接进房（旧连接是房主 → 房间关闭，回 `host-gone`）；有回应 → `duplicate`。
- 这个账号在别的设备上 `POST /api/login`：现有连接收到 `{ "t": "error", "code": "replaced", "message": … }`，离开房间（是房主则房间关闭），然后关闭（4409）。
- 关闭码：4409 账号在别的设备上登录；4401 鉴权失败或 10 秒内没发 `hello`；1009 消息过大；1008 发送过快；1002 帧不合规（未加掩码等）；1003 二进制帧；1007 非 UTF-8 文本；1001 服务器停机。服务器发往某个连接的数据积压超过 4 MB（对方网络太慢或不读）时直接断开。

---

## 19. 客户端错误日志 client-log

游戏网页把脚本报错、画面丢失（WebGL 上下文丢失 / 恢复）、长时间掉帧、自动降画质等情况批量上报，方便排查"平板上画面闪一下就卡住"这类只在某些设备上出现的问题。实现在 `server/src/features/clientlog.ts`，客户端在 `src/core/errlog.ts`。

### `POST /api/client-log`（公开，不需要登录）

请求体是报告数组，或 `{ "reports": [...] }`；`Content-Type` 不限（客户端关页面时用 `sendBeacon` 发 `text/plain`）。请求体上限 128 KB，一次最多处理 20 条。

```ts
interface ClientReport {
  kind: 'error' | 'rejection' | 'loop' | 'render' | 'context-lost' | 'context-restored' | 'context-reload' | 'perf' | 'quality' | 'info';
  msg: string;          // 截到 1000 字
  stack?: string;       // 截到 2000 字
  count?: number;       // 同一错误重复次数
  t?: number;           // 客户端时间（毫秒）
  ctx?: Record<string, string | number | boolean>; // 设备 / 画质 / GPU / 关卡等，最多 30 个键，其他类型的值丢弃
}
```

→ `{ accepted, dropped }`。类型不认识、不是对象的条目丢弃；单条序列化后超过 4 KB 依次去掉 `stack`、`ctx`、截短 `msg`。每个 IP 每 10 分钟最多收 60 条，超出部分丢弃，整批都超出返回 429。请求体不是 JSON / 不是数组 → 400。

服务器给每条加上 `at`（服务器时间）和 `ip`，追加写入 `$DATA_DIR/client-errors.log`（每行一个 JSON，与数据库文件同目录）。文件超过 2 MB 时只保留较新的一半。

### `GET /api/admin/client-log?limit=200`（家长密码）

→ `{ entries: (ClientReport & { at: number; ip: string })[] }`，新的在前；`limit` 夹到 1–1000，默认 200。

---

## 待确认的问题（产品）

1. `bonusCredits`（任务的游戏内奖励）什么时候生效：任务进行中作为激励，还是完成后作为奖励、持续多久？目前服务器只存储和返回，客户端决定。
2. `clear_count` 是按存档里的**累计**通关数判定（之前通关的也算），因为存档里的星级没有时间戳。如果要"布置后再通关 N 关"，需要客户端额外上报通关事件。
3. 时间段不支持跨午夜（如 22:00–01:00），需要时请拆成两段。
