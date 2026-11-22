/**
 * 把联网组件装进标题页（src/ui/menus.ts 的 titleScreen 生成的元素）：
 * 右栏顶部：当前玩家（切换玩家）+ 游戏时间；"我的学习""家庭排行榜"两个入口；
 * 战绩卡下面：家长留言、任务列表（含完成庆祝）。
 * 纯单机（网页旁边没有游戏服务器）时什么也不加，标题页和原来完全一样。
 */
import { audio } from '../../core/audio.ts';
import { online } from '../../net/index.ts';
import { btn, h } from '../dom.ts';
import { playerChip, playtimeChip } from './chips.ts';
import { messageCard, taskList } from './family.ts';
import type { Widget } from './common.ts';

export interface TitleHooks {
  switchPlayer(): void;
  openStudy(): void;
  openBoard(): void;
}

/** 返回清理函数（离开标题页时调用） */
export function decorateTitle(root: HTMLElement, o: TitleHooks): () => void {
  const widgets: Widget[] = [];
  const right = root.querySelector<HTMLElement>('.title-right');
  // 没有服务器、也没登录过：纯单机，保持原样
  if (!right || (online.state === 'offline' && !online.player) || online.state === 'unknown') return () => undefined;
  root.classList.add('has-online');
  right.classList.add('ol-title-right');

  const top = h('div', 'ol-title-top');
  const chip = playerChip({ onSwitch: o.switchPlayer });
  const time = playtimeChip();
  widgets.push(chip, time);
  top.append(chip, time);
  right.prepend(top);

  if (online.player) {
    const links = h('div', 'ol-title-links');
    links.append(
      btn('我的学习', 'btn btn-ghost sm', () => {
        audio.ui('open');
        o.openStudy();
      }),
      btn('家庭排行榜', 'btn btn-ghost sm', () => {
        audio.ui('open');
        o.openBoard();
      }),
    );
    top.after(links);
    const fam = h('div', 'ol-title-family');
    const msg = messageCard();
    const tasks = taskList({ max: 4 });
    widgets.push(msg, tasks);
    fam.append(msg, tasks);
    right.append(fam);
    root.classList.add('has-family');
  }
  return () => {
    for (const w of widgets) w.destroy();
  };
}
