/**
 * 联网相关界面组件（都只依赖 src/net 的 `online` 门面）。每个函数返回一个元素，
 * 调用方负责挂载；不再需要时调用它的 destroy()（取消事件订阅、停止定时器并移除元素）。
 *
 *   loginScreen({ onDone, onCancel? })   登录 / 选择玩家（全屏层）
 *   playerChip({ onSwitch })             当前玩家 + 同步状态（"切换玩家"入口）
 *   playtimeChip()                       今日剩余 N 分钟 / 不在可玩时间
 *   showPlayBlocked(result)              不能开局的提示弹窗（beforeMatch 返回 allowed = false 时）
 *   messageCard()                        家长留言（新留言弹一次）
 *   taskList()                           任务列表 + 完成庆祝
 *   studyScreen({ onBack })              我的学习（全屏层）
 *   leaderboardScreen({ onBack })        家庭排行榜（全屏层）
 */
export { loginScreen, type LoginOptions } from './login.ts';
export { playerChip, playtimeChip, playtimeText, showPlayBlocked } from './chips.ts';
export { messageCard, taskList, celebrateTasks, showCelebration, progressText } from './family.ts';
export { studyScreen, leaderboardScreen } from './screens.ts';
export type { Widget } from './common.ts';
