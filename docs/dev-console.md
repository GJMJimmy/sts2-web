# 开发者控制台

原版自带的开发者控制台（`DevConsole`）随规则层一起转译了过来，网页版给它接了界面（`packages/app/src/ui/devconsole.tsx`，对应原版的 `NDevConsole`）。用它可以直接跳到某场战斗、某个事件，或者改金币、遗物、卡牌，不必从头打一局去复现问题。

## 启用与开关

开发服务器、构建产物和线上都直接可用，不需要任何页面参数。

按 `` ` ``、`'`、`^`、`*`（或 Shift+8）任意一个打开，再按一次关闭。焦点在别的输入框里时不会打开。主菜单和局内都能开；大部分命令要在一局游戏里才有效。

控制台打开时键盘归它所有，游戏里的快捷键不会响应。

## 按键

| 按键 | 作用 |
|---|---|
| Enter | 执行命令；候选菜单里是确认选中项 |
| Tab | 补全。只有一个候选时直接填入；多个候选时打开菜单，再按是下一项 |
| ↑ / ↓ | 翻历史命令（最多 40 条）；候选菜单里是上下移动 |
| Esc | 先退出候选菜单，再按关闭控制台 |
| F11 | 半屏 / 全屏切换 |
| Ctrl+L | 清空输出 |
| Ctrl+U | 清空当前输入（内容进入粘回缓冲） |
| Ctrl+C | 清空当前输入 |
| Ctrl+A / Ctrl+E | 光标到行首 / 行尾 |
| Ctrl+K | 删到行尾 |
| Ctrl+W | 删前一个词（浏览器保留了这个组合键的平台上无效） |
| Ctrl+Y | 粘回 Ctrl+U / K / W 删掉的内容 |
| Ctrl+D | 关闭控制台 |

候选菜单打开时继续打字可以筛选。只剩一个候选时，输入框里会用灰字提示补全结果。

两点和直觉不同，都是原版的行为：

- 在控制台里按 `'` 或 `*` 会直接关掉它，所以这两个字符打不进去。
- 关闭后输入框里的文字会保留，下次打开还在。

## 约定

- **Id**：卡牌、遗物、药水、遭遇战、事件等都用大写蛇形 Id，例如 `BODY_SLAM`、`FIRE_POTION`，不是显示名。输入时大小写不敏感。记不住就输入命令加空格后按 Tab。
- **目标下标（target-index）**：战斗中所有生物的下标，`0` 是玩家，敌人从 `1` 开始。`kill` 是例外，它的下标只数敌人，`0` 是第一个敌人。
- **手牌下标（hand-index）**：从左数，`0` 是最左边那张。
- **参数写法**：`<必填>`、`[可选]`。

## 内置命令

| 命令 | 作用 |
|---|---|
| `help` | 列出所有命令 |
| `help <命令>` | 显示某个命令的参数和说明 |
| `clear` | 清空输出 |
| `exit` | 关闭控制台 |

## 跳转

都需要在一局游戏中。跳转会计入楼层数，和正常走进房间一样。

| 命令 | 作用 | 例子 |
|---|---|---|
| `fight <遭遇战>` | 进入指定遭遇战。Id 以 `_WEAK`、`_NORMAL`、`_ELITE`、`_BOSS` 结尾 | `fight BYRDONIS_ELITE` |
| `event <事件>` | 进入指定事件 | `event AROMA_OF_CHAOS` |
| `ancient <先古之民> [选项]` | 进入先古之民的事件；给了选项就强制出现文本键包含它的那个选项。可选 `NEOW`、`OROBAS`、`PAEL`、`TEZCATARA`、`NONUPEIPE`、`TANX`、`VAKUU`、`DARV` | `ancient NEOW` |
| `room <类型>` | 进入一个指定类型的房间：`Monster`、`Elite`、`Boss`、`Treasure`、`Shop`、`Event`、`RestSite`、`Map` | `room Shop` |
| `act <序号\|Id>` | 数字：跳到本局的第几幕（从 1 起）。Id：把当前这一幕替换成指定的幕并重新进入，可选 `OVERGROWTH`、`HIVE`、`GLORY`、`UNDERDOCKS` | `act 2`、`act GLORY` |
| `travel` | 开关“任意移动”：打开后地图上所有节点都能点 | `travel` |

## 玩家状态

需要在一局游戏中，战斗内外都能用。

| 命令 | 作用 | 例子 |
|---|---|---|
| `gold <数量>` | 增加金币，负数是扣除 | `gold 999`、`gold -30` |
| `heal <数量> [友方下标]` | 回复生命，默认回复玩家；数量不能为负 | `heal 20` |
| `relic [add\|remove] <遗物>` | 获得或移除遗物，不写动作就是获得。Id 可以只写一部分：先找完全相同的，再找以它开头的，最后找包含它的 | `relic add ANCHOR`、`relic remove ANCHOR` |
| `potion <药水>` | 获得药水。药水栏满了也会回显成功，但拿不到 | `potion FIRE_POTION` |
| `card <卡牌> [牌堆]` | 生成一张牌放进指定牌堆，默认 `Hand`。牌堆有 `Hand`、`Draw`、`Discard`、`Exhaust`、`Deck`。战斗外只能用 `Deck`（加进牌组）；手牌满 10 张时放不进手牌 | `card BASH`、`card BASH Deck` |
| `remove_card <卡牌> [牌堆]` | 移除第一张同 Id 的牌，牌堆只能是 `Hand`（默认，仅战斗中）或 `Deck` | `remove_card STRIKE_IRONCLAD Deck` |
| `godmode` | 开关无敌：给玩家 9999 层力量、缓冲、再生，之后每场战斗开始时都会重新加上；再执行一次关闭 | `godmode` |
| `die` | 杀死玩家，本局结束 | `die` |

## 战斗

只在战斗中有效。

| 命令 | 作用 | 例子 |
|---|---|---|
| `kill [敌人下标\|all]` | 杀死一个敌人，默认第一个；`all` 是全部 | `kill all` |
| `win` | 清掉所有敌人的能力后全部杀死，赢下这场战斗 | `win` |
| `damage <数量> [目标下标]` | 造成不受加成影响的伤害，默认打所有敌人 | `damage 10`、`damage 5 0` |
| `block <数量> [目标下标]` | 给予格挡，默认给玩家 | `block 20` |
| `power <能力> <层数> <目标下标>` | 给目标加能力，三个参数都必填。Id 以 `_POWER` 结尾；目标已有该能力时是在原有层数上加，负数是减 | `power VULNERABLE_POWER 2 1` |
| `energy <数量>` | 增加能量 | `energy 5` |
| `stars <数量>` | 增加辉星 | `stars 3` |
| `draw [张数]` | 抽牌，默认 1 张 | `draw 2` |
| `upgrade [手牌下标]` | 升级一张手牌，默认最左边那张 | `upgrade 2` |
| `enchant <附魔> [数量] [手牌下标]` | 给一张手牌加附魔，数量默认 1，默认最左边那张 | `enchant ADROIT 1 0` |
| `afflict <侵蚀> [数量] [手牌下标]` | 给一张手牌加侵蚀，数量默认 0，默认最左边那张 | `afflict BOUND 1 0` |

## 进度与其他

不需要在一局游戏中。

| 命令 | 作用 | 例子 |
|---|---|---|
| `unlock <类型> [Id…]` | 把内容标记为已发现并写入进度档。类型有 `cards`、`potions`、`relics`、`monsters`、`events`、`epochs`、`ascensions`、`all`；不写 Id 就是该类型的全部。`unlock all` 等同页面参数 `?unlock=all` | `unlock all`、`unlock cards BASH` |
| `achievement <unlock\|revoke\|check> [成就]` | 解锁、撤销或查询成就。成就 Id 是小写蛇形；`unlock` 和 `revoke` 不写 Id 就是全部 | `achievement check all_cards_upgraded` |
| `instant` | 开关 Instant 快速模式（没有动画和等待）。有些事件的动画循环在这个模式下会空转；下次启动会恢复成 Fast | `instant` |

## 常用组合

```text
# 复现某场战斗，不怕死
fight BYRDONIS_ELITE
godmode

# 带着某个遗物打 Boss
relic add ANCHOR
room Boss

# 试一张牌：放进手里，给够能量
card BODY_SLAM
energy 5

# 看第三幕的地图，并且随便走
act 3
travel
```

## 对存档的影响

- 命令改的是运行中的状态，按正常流程存档：格式不变，刷新后改动还在。
- `unlock` 和 `achievement` 写的是进度档，一局结束后也不会消失。
- 历史命令存在 `user://` 下的 `console_history.log`，只在第一次打开控制台时才会创建。
- 不想动常用存档时，用无痕窗口或另一个浏览器配置来调试。

## 网页版的差异和已知问题

没有注册的命令（依赖 Steam、Sentry、系统文件管理器或网页版没有的场景）：`art`、`cloud`、`getlogs`、`leaderboard`、`log-history`、`multiplayer`、`open`、`sentry`、`trailer`。

注册了但有问题的：

- `log [类型] <级别>`：不可用，总是报参数无法解析（泛型枚举转字符串的转译问题）。
- `dump`：回显成功，但内容是写到 Info 级日志里的，浏览器控制台看不到。
- `power`：效果正常，回显里的目标名是一串字符码而不是 Id。
- 依赖手牌的命令（`card` 默认牌堆、`remove_card` 默认牌堆、`upgrade`）在战斗外会报 `Tried to get Hand pile while out of combat`；`remove_card` 在战斗外也没有补全候选。

## 相关代码

| 位置 | 内容 |
|---|---|
| `packages/app/src/ui/devconsole.tsx` | 界面、按键、补全菜单、屏蔽名单 |
| `packages/core/src/gen/sts2.ts` 里的 `DevConsole`、`*ConsoleCmd` | 转译出的命令实现，不要手改 |
| `ref/decompiled/MegaCrit/sts2/Core/DevConsole/` | 原版 C#（不入库） |
| `tools/e2e/console.mjs` | 浏览器端检查：开关、补全、候选菜单、执行命令、历史 |
