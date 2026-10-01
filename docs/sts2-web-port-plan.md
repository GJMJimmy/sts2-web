# Slay the Spire 2 → Web 移植方案（C 路线：TypeScript 重写）

| 项目 | 值 |
|---|---|
| 原作版本 | Slay the Spire 2 v0.98.3（commit `cb602cef`，2026-03-09，Steam 抢先体验） |
| 原作技术栈 | Godot 4.5.1 定制版 + .NET 9 / C#，FMOD Studio，Spine 4.2 |
| 方案日期 | 2026-09-27 |
| 目标平台 | 桌面浏览器（Chrome / Edge / Firefox / Safari 18.4+），触屏平板为次要目标 |
| 仓库 | `sts2-web`（本仓库） |

---

## 0. 摘要

- **做什么**：用 TypeScript 从零重写 Slay the Spire 2 的单人模式，原作的美术、动画、音频、文本经压缩后直接复用，原作的规则代码经反编译后逐文件翻译。
- **不做什么**：多人联机、Mod 系统、Steam 集成、手柄（后置）。
- **资源已就绪**：1.65GB 的 Godot 资源包已提取并按 Web 标准压缩到 **123MB**（非音频 88MB，音频 35MB），产物在 `assets/`，脚本在 `tools/`，可一键重新生成。
- **工作量**：原估手工翻译 68 人周；实际改用 C#→TS 转译器（见“实施记录”），规则层已整体可运行，剩余工作集中在表现层打磨。
- **最大风险**：内容体量（606 张卡、297 件遗物、283 种能力、125 种怪物）和文本模板引擎的一致性，而不是任何单点技术。
- **法律边界**：原作是 Mega Crit 的商业作品。本方案仅供学习使用。

---

## 实施记录：转译器路线（2026-09-28 更新）

C 路线的目标不变（TypeScript 实现、复用原作资源），执行方式做了一处关键调整：规则层不再手工逐文件翻译，而是写了一个 **Roslyn C# → TypeScript 转译器**，把反编译出的 `sts2.dll` 规则代码和它依赖的 SmartFormat 整体机械转成 TS。第 6、7 节的手工翻译方法论和 68 人周估算因此作废，保留作参考。

**为什么这样做**：手工翻译 606 张卡、297 件遗物的行为，每一处都可能引入偏差；转译器让规则代码和原作逐语句对应，偏差只可能来自转译器或运行时，而这两处可以用测试集中修。

### 架构

```
ref/decompiled/**.cs (ILSpy)  ─┐
ref/smartformat/**.cs         ─┼─ tools/cs2ts (Roslyn 4.14, .NET 9) ─→ packages/core/src/gen/sts2.ts  规则层（约 14 万行）
                               │                                     packages/core/src/gen/stubs.ts  Godot/节点等外部类型桩
packages/core/src/rt/*.ts  ────┴─ 手写运行时：BCL、集合、LINQ、Task、Godot 基础类型、JSON、正则 …
packages/core/src/overrides.ts    少量手写替换（int32 溢出哈希、存档读写直通等）
packages/core/src/shell.ts        NGame 的非界面部分：初始化、开新局、继续/放弃存档
packages/app/src/bridge.ts        用 TS 实现规则层调用的 Godot 节点单例（NRun、NCombatRoom、NMapScreen、奖励/选牌界面、音频 …）
packages/app/src/ui/*.tsx         Preact 界面（主菜单/单人子菜单、选角、每日挑战、自定义模式、时间线、图鉴、统计与成就、存档位、
                                  制作人员、地图、战斗、事件（含古神对话）、休息点、商店、宝箱、奖励、牌组/牌堆、卡牌检视、
                                  暂停菜单、新手提示、结算、跑图历史）
packages/app/src/render/*.ts      Pixi 8 + spine-pixi：生物 Spine 动画、场景（背景/休息点/商人/古神背景/主菜单）、
                                  粒子（particles.ts）、Godot 着色器翻译与四边形批次（canvas.ts）
packages/app/src/audio.ts         WebAudio：FMOD 事件路径 → 提取出的 Opus 采样
```

### 转译器要点（tools/cs2ts）

- 单文件输出，按依赖拓扑排序；类型名扁平化，冲突加后缀；外部类型统一走 `$.ext("全名")`，未实现的成员在调用时报出全名。
- 两段式构造（`new C().$ctor_C(...)`），字段初始化 `$fi_C()`，结构体 `$zero_C()`/`$default()`；静态字段惰性求值，静态构造按原 DLL 的 `beforefieldinit` 语义触发。
- `async`/迭代器 → 生成器（`$.async`/`$.seq`），已完成的 Task 同步推进，保证和原作一致的执行顺序。
- 重载改名（`Name$1`、`Name$Type_Type`），`out/ref` 用 `{v}` 盒子，`goto` 转状态机，模式匹配、LINQ 查询语法、元组、`decimal`、整数除法、可空提升、64 位运算、无符号截断（`(uint)(x - a) <= b` 这类范围判断）都有专门处理。
- 反射元数据只为带特性的成员生成（存档 DTO 的 `[JsonPropertyName]` 等），供存档序列化和 SmartFormat 使用。
- 外部节点类型生成桩：返回节点的成员给出惰性哑对象，`Create*` 静态工厂在非测试模式下同样返回哑对象，让规则层里的视觉代码安全空转。

### 运行时与桥接要点

- **两种模式**：测试模式（`TestMode.IsOn`，无动画、无等待，用于 Vitest）和浏览器模式（走原作的非测试分支，桥接层实现节点单例）。
- **文本**：SmartFormat 原样转译，`[gold]`/`[img]` 等 BBCode 由 `ui/richtext.tsx` 渲染；全部 1468 条卡牌/遗物/药水描述在英文和简体中文下格式化零错误（`test/text.test.ts`）。
- **存档**：规则层自己的 `SaveManager`/`RunSaveManager` 照常工作，底层写到 `user://`。浏览器里 `vfs.mount()` 在启动时把 IndexedDB 中的文件全部读入内存（规则层的文件读写是同步的），之后每次写入异步落盘；旧版本放在 localStorage 的存档首次启动时迁移过去。IndexedDB 不可用时退回 localStorage，再不行只在本次会话内保存。序列化只写 DTO 的 JSON 成员；读档跳过迁移（Web 存档总由同一版本写出）。三个存档位（切换/删除）与原版一致。
- **场景**：`tools/scenes.py` 把 `.tscn` 摊平成绘制列表（变换、锚点、modulate、z 序、加/减/乘混合、`clip_children` 遮罩、实例化子场景），`render/scene.ts` 用 Pixi 重建。战斗背景由规则层的 `BackgroundAssets` 按原作的 RNG 选层，休息点、商人、古神事件背景、主菜单同理。
- **粒子**：CPUParticles2D 与 GPUParticles2D（ParticleProcessMaterial）导出为发射器参数（发射形状、方向/扩散、初速度、重力、线性/径向加速度、阻尼、角速度、缩放、颜色、爆发度、预处理、单次发射、序列帧），曲线与渐变在导出时预采样；`render/particles.ts` 在 CPU 上模拟，每个发射器一次绘制。湍流、轨道速度、色相变化、子发射器不模拟。
- **着色器**：场景里的 ShaderMaterial（含内联 Shader 与 VisualShader 生成的代码）导出到 `assets/shaders/`，`render/canvas.ts` 在运行时把 Godot 着色语言翻译成 GLSL ES 3.00（内建变量、varying、INSTANCE_CUSTOM、图集帧与重复寻址模拟、预乘 Alpha），先在离屏 WebGL2 上编译校验，失败则该物件不画。58 个着色器中 52 个可用，其余 6 个读取屏幕纹理（`SCREEN_TEXTURE`），不支持。营火火焰、风吹植被、光照闪烁等因此得以还原。
- **生物特效**：`creature_visuals` 场景也导出；挂在 SpineBoneNode 下的粒子/精灵每帧跟随骨骼世界矩阵（`afterUpdateWorldTransforms`），SpineSlotNode 下的用 spine-pixi 的插槽对象按插槽绘制顺序渲染，`show_behind_parent` 决定在骨骼前后；没有骨骼的精灵生物直接由场景绘制。战斗与怪物图鉴共用。
- **生物布局**：移植 `NCombatRoom` 的站位算法（玩家/宠物、敌人自动排布、遭遇战 `Marker2D` 槽位、镜头缩放与偏移、超宽时整体缩放）。
- **音频**：FMOD 银行的采样提取为 Opus，事件结构由 `tools/fmod_bank.py` 从银行元数据解出（字符串表 trie 里 612 个 GUID→路径；事件、时间线、参数表/触发条件、多乐器与散布器、音量自动化、过渡与循环区等）写入 `assets/audio/events.json`；`audio.ts` 用一个小型事件引擎在 Web Audio 上按这些数据播放（音乐按 `Progress` 等参数自动化切换 stem 层，环境音分层含 `Campfire`，音效带随机音高/音量与 `loop` 参数）。数据里没有的事件（静态路径中 3 个）才回退到名字匹配。`node tools/fmod_events.mjs [事件 参数=值…]` 可查看某事件会播放什么。

### 当前状态

| 模块 | 状态 |
|---|---|
| 规则层（战斗、卡牌、遗物、能力、药水、怪物 AI、地图、事件、商店、休息、宝箱、奖励、进阶） | 转译完成；无头测试跑通整幕 |
| 文本（14 种语言表，SmartFormat） | 完成；英/中 1468 条描述全量格式化零错误 |
| 浏览器完整流程：主菜单 → 选角 → 地图 → 战斗 → 奖励 → 事件/休息/商店/宝箱 → 三幕 Boss → 终局事件「建筑师」→ 胜利 / 死亡结算 | 跑通（Playwright 固定种子自动游玩全程，控制台零报错；五名角色各跑过至少一幕） |
| 存档、继续、放弃、Save & Quit | 完成（无头往返测试覆盖事件房存档） |
| 战斗表现：Spine 生物、原版站位、意图、能力、手牌、选目标、回合、伤害/治疗飘字 | 完成 |
| 场景：战斗背景（原版选层 RNG）、休息点（角色坐在营火旁）、商人、宝箱（按幕的开箱骨骼动画）、古神事件背景、主菜单动态背景、生物骨骼挂载特效 | 完成：静态、骨骼、粒子、遮罩、混合模式、可翻译的自定义着色器（52/58） |
| 地图：原版纸张贴图、点位算法与抖动、可前往规则（含起点与 Boss）、古神起点图标、图例（悬停高亮同类房间）、涂画（绘制/擦除/清除，右键随手画，按局按幕保存） | 完成 |
| 药水：饮用/投掷（投掷进入选目标）/丢弃，按原版可用性规则 | 完成 |
| 音频：音效、按段落切换的音乐、环境音、音量总线、后台静音 | 按银行事件数据播放（562/562 个事件可解析）；效果器、快照/闪避、3D 定位未实现 |
| 设置：四路音量、语言（14 种）、帧数上限、MSAA、快速模式、屏幕震动强度、常显计时、手牌序号、文字特效、长按确认、后台静音、全屏、重置教程 | 完成（写回原作的 SettingsSave/PrefsSave） |
| 键盘：数字键出牌、E 结束回合、A/S/X/D 牌堆与牌组、M 地图、Esc 暂停/关闭 | 完成（原版默认键位） |
| 离线：Service Worker（资源按需缓存、按构建版本失效）、Web App Manifest | 完成基础版 |
| 手牌：抽入/离手飞行动画、悬停放大、关键词提示；震屏 | 完成 |
| 攻击特效：VFX 场景整体播放（逐帧精灵、粒子、骨骼、着色器），房间淡入转场 | 完成 |
| 战斗布局事件（如终局「建筑师」）：嵌入式战斗场景 + 对话气泡 | 完成 |
| 结算页：战败标题/致死语句、建筑师伤害、徽章、分数进度条（按原版阈值解锁纪元）、本局发现、解锁→时间线 | 完成 |
| 跑图历史：逐局翻页，模式/日期/种子/用时、HP/金币/药水、致死语句、每层房间图标与悬浮详情、遗物、卡组（可检视） | 完成 |
| 角色专属界面：故障机器人充能球、摄政者星辰计数器（原版贴图与旋转层）、亡灵契约师宠物站位 | 完成 |
| 战斗提示：战斗开始/玩家回合/敌人回合横幅、幕开场横幅、生命/金币/层数/地图/牌组/牌堆/能量/星辰/结束回合的原版悬浮说明 | 完成 |
| 奖励界面：金币/卡牌/稀有卡/移除卡牌等原版图标，遗物与药水显示实物；Peek（按住空格或点按钮隐藏覆盖层看战场） | 完成 |
| 商人对话：购买成功、金币不足、没有空位等台词气泡（原版文案） | 完成 |
| 主菜单与进度：单人子菜单、时间线（纪元揭示/解锁队列、强制时间线）、角色解锁、进阶选择、随机角色 | 完成 |
| 每日挑战（按 UTC 日期生成角色/进阶/修改器，本地成绩）、自定义模式（种子、进阶、修改器与互斥规则） | 完成（排行榜为本地） |
| 图鉴：卡牌库（筛选/搜索/升级预览）、遗物收藏、药水实验室、怪物图鉴（Spine 动作预览）；统计与成就 | 完成（成就存进度存档） |
| 局内：暂停菜单（设置/图鉴/放弃/保存并退出）、牌组视图（四种排序、升级预览）、抽/弃/消耗牌堆、卡牌检视（翻页、升级预览、右键打开）、新手提示（11 种 + 开局询问）、古神对话 | 完成 |
| 存档位（3 个，切换/删除）、制作人员名单 | 完成 |
| 触屏 | 点按和拖拽出牌可用，竖屏时舞台自动转为横屏渲染；长按显示悬停提示 |

### 已知缺口

- **视觉**：读取屏幕纹理的着色器（水面倒影后处理、屏幕扭曲、Doom 叠加等 6 个）不绘制；粒子不做湍流/轨道速度/色相变化/子发射器，非局部坐标的旋转发射器按局部坐标模拟；由动画/脚本临时开启的特效（`emitting = false` 的发射器、隐藏节点）不播放。
- **音频**：事件结构来自银行元数据，但效果器（EQ/混响等）、快照/闪避、音高与发送自动化、非线性自动化曲线未实现；少数字段含义是推断的（播放列表模式编号、量化单位等，见 `tools/fmod_bank.py` 注释）；幕音乐同时解码多条约 250 秒的 stem，占用上百 MB 音频内存（单声道后比立体声减半，停止时释放）。
- **存档**：读档跳过版本迁移，Web 存档只能由同一版本读取；与桌面版存档格式不互通。
- **功能**：多人、Mod、手柄、按键重绑定不在范围内；每日挑战排行榜只记本地成绩。
- **触屏**：点按可玩；长按（0.45 秒）显示悬停提示且不触发点击；CSS 悬停效果只在支持悬停的设备上生效，避免点按后卡在放大状态。
- **图形设置**：复用原版 SettingsSave 的帧数上限（实时生效）与 MSAA（WebGL 只能开/关，下次载入生效）；没有独立的渲染分辨率选项，高分屏按 min(dpr, 2) 渲染。
- **场景**：`clip_children` 用 Pixi 遮罩实现（按最近的裁剪节点，不处理嵌套裁剪）；减法混合在 GL 状态里注册了反向减法。
- **转译语义**：C# 结构体在 JS 里按引用传递。已扫描全部“复制后修改”的位置，均为“改完写回原位”的写法，与值语义等价；若日后出现依赖值复制的代码，需要在转译器的复制点补浅拷贝。
- **存储**：存档在 IndexedDB（配额远大于 localStorage）。写入是异步落盘的，写入失败（配额、被清理）时界面弹出提示；同一浏览器同时开多个标签页不做互斥。

### 性能

用 `tools/e2e/perf.mjs` 测量（各界面空闲 5 秒，Chrome 自带计数器 + CPU profile）。M4 Pro、系统 Chrome、Metal：

| 界面 | 帧率 | 主线程（单核占比） | 其中 JS |
|---|---|---|---|
| 主菜单（原版动态场景：城市、云、Logo 骨骼与粒子） | 60 | 5.1% | 4.2% |
| 地图（其下为古神事件背景） | 60 | 4.5% | 2.7% |
| 战斗（玩家回合空闲，背景含粒子与着色器） | 60 | 8.3% | 7.1%（Spine 待机动画与粒子模拟为主） |

粒子与着色器时钟挂在 Pixi 应用的 ticker 上，受设置里的帧数上限约束（软件渲染时 30fps）。

- 战斗界面原先每帧整树重渲染（7.6%/6.3%），现改为跟原版一样订阅 `CombatStateTracker.CombatStateChanged`，外加 4Hz 兜底刷新。
- 加载（本机服务器、冷缓存）：进入主菜单约 0.4 秒；开局经 Neow 到地图约 3.5 秒（含古神对话与自动选择）；首场战斗可操作约 1.8 秒（加载 Spine 与背景）。
- 内存：整局 48 层，GC 后 JS 堆从约 29MB 增到约 76MB，增量几乎全是新怪物/场景首次加载的 Spine 骨骼数据缓存（有上限），实例数不累积，没有泄漏。
- 没有 GPU 时（硬件加速关闭、显卡被列入黑名单）WebGL 走 CPU 软件光栅化：自动关闭抗锯齿、半分辨率、30fps 上限，战斗界面从占满一核降到约 40%。无头测试浏览器就属于这种情况，同时开多局自动游玩时 CPU 会很高，这是测试环境造成的，不代表正常游玩。

### 测试

```bash
pnpm -F @sts2/core test      # Vitest：加载、启动、开局、战斗（断言胜利）、整幕自动游玩（断言宝箱遗物到手）、文本全量（英/中）、
                             # 存档往返（断言经过事件房）、Regex/字符串排序/舍入/集合顺序等 .NET 语义（对照 .NET 9 验证）
npx playwright install chromium-headless-shell   # 首次运行 e2e 前安装浏览器；CHROME 指向它（见下）
node tools/e2e/play.mjs <输出目录> [步数]   # 浏览器自动游玩（Playwright），每进一个新界面截图，控制台日志实时写入 console.log
                                            # 卡死时通过 CDP 暂停页面并打印调用栈；同一界面停留过久时输出游戏状态
                                            # 结束打印 RESULT WIN/LOSS/UNFINISHED/FAILED；卡死、循环或页面异常时退出码为 1
# CHROME=~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell
# 环境变量：URL=<页面地址> SEED=<种子> FAST=1（游戏自带的极速模式） CHAR=<n>（第 n 个角色）
#           GOD=1（每步回满血，测试用） GOD=2（另把敌人压到 1 血，用于快速走完整局）
node tools/e2e/ui-check.mjs <输出目录>      # 地图、卡牌悬停提示、出牌动画、设置面板截图
node tools/e2e/continue.mjs <输出目录>      # 保存并退出 → 刷新页面 → 继续游戏，校验存档在 IndexedDB、回到同一房间（失败时退出码 1）
node tools/e2e/screens.mjs <输出目录>       # 主菜单（新存档/全解锁）、选角、时间线、每日/自定义、图鉴四页、统计与成就、存档位、
                                            # 制作人员、卡牌检视、古神对话、暂停菜单与局内图鉴、牌组排序、升级预览截图
node tools/e2e/shaders.mjs                  # 在浏览器里翻译并编译 assets/shaders 下全部 Godot 着色器，列出不支持的
node tools/e2e/audio.mjs                    # 规则层里静态写出的音效事件逐个解析到采样（有未解析的则退出码 1）
node tools/e2e/scene-shots.mjs <输出目录> scenes/…tscn …   # 开发服务器上逐个全屏截图场景（粒子、着色器、骨骼渲染检查）
# tools/e2e/start.mjs 是各脚本共用的开局流程（单人 → 标准 → 选角 → 确认 → 教程询问 → 过掉 Neow 到地图）
CHANNEL=chrome GPU=1 node tools/e2e/perf.mjs <输出目录>   # 各界面空闲 CPU、加载耗时、战斗 CPU profile（用系统 Chrome + Metal）
node tools/e2e/coverage.mjs <输出目录> [cards,potions,encounters,relics,events] [过滤正则]
    # 覆盖测试：走真实 Web 桥接（非 TestMode），每张牌打一次、每种药水用一次、每场遭遇战打三回合并击杀、
    # 每件遗物带进一场战斗、每个事件的每个初始选项走到结束；逐项报告报错/卡住/超时，结果写 coverage.json
# play.mjs 的 HEAP=1 在每层采样 GC 后的 JS 堆；SNAP_FLOORS=6,42 在两层各抓堆快照并按构造函数输出增长
# LANG_UI=zhs 让 play.mjs 用中文界面游玩
# 页面参数：?seed=<种子> 固定种子，?lang=zhs 等切换语言（语言选择也会记住），?unlock=all 等同原版控制台的 unlock all，
#           ?tutorials=off 关闭新手提示；开发服务器上 ?scene=scenes/…tscn 全屏显示单个场景（渲染检查）
```

已验证的自动游玩：

| 场景 | 结果 |
|---|---|
| 铁甲战士、静默猎手，GOD=2，全程（开发服务器与生产构建各一局） | 三幕全部通关 → 终局事件「建筑师」→ 胜利结算，零报错 |
| 五名角色，GOD=1（含中文界面一局；商店购买、休息点锻造、宝箱、事件均走真实 UI） | 全部打到第二幕 Boss（第 33 层），零报错；在 The Insatiable 处落败是原版机制（Sandpit 计数归零强制吞噬），不是 bug |
| 保存并退出 → 刷新页面 → 主菜单继续（`tools/e2e/continue.mjs`） | 存档在 IndexedDB，回到同一房间、同一层，战斗可继续 |
| 新存档首局（`UNLOCK=0 GOD=2`，开启教程提示） | 教程提示逐个出现并确认，通关终局 → 结算分数解锁纪元 → “解锁”进入时间线（5 个纪元待揭示），零报错 |
| 全解锁存档整局（`GOD=2`，生产构建） | 胜利结算：建筑师伤害、徽章、分数条溢出封顶，零报错 |
| 覆盖测试（`tools/e2e/coverage.mjs`，真实 Web 桥接，全解锁存档） | 2026-09-29 复测：卡牌 577、事件选项路径 151、遭遇战 81、药水 64、遗物 289，共 1162 项零失败（古神遗物先按原版调用 `SetupForPlayer`）；四名非铁甲角色各自卡池（各 88 张）也按本角色跑过。例外 5 项与原版行为一致（MAD_SCIENCE、SEA_GLASS、DUSTY_TOME 需要事件预先设定；MASSIVE_SCROLL 只含多人卡；FUR_COAT 在无地图点的调试战斗里取不到当前地点） |

### 重新生成

完整的首次搭建顺序见仓库根目录 `README.md`。只改了转译器、索引脚本或场景脚本时：

```bash
pnpm gen                                            # 转译规则层（约 11 秒；缺少 ref/smartformat 会直接报错）
tools/.venv/bin/python tools/spine_index.py         # 生物 Spine 索引 + 遭遇战槽位（含父节点变换）
tools/.venv/bin/python tools/scenes.py              # 场景 → assets/scenes/（含粒子参数），着色器源码 → assets/shaders/
tools/.venv/bin/python tools/audio_index.py         # 音频采样清单（含跨 bank 去重的别名）
pnpm dev / pnpm build                               # build 先跑两个包的 tsc；产物中 JS 在 js/，游戏资源在 assets/
```

---

## 1. 目标与范围

### 1.1 目标

在浏览器里完整打通一局 Slay the Spire 2 单人标准模式：选角色 → 走完 4 幕地图 → 战斗、事件、商店、篝火、宝箱 → Boss → 结算，视觉、动画、音效与原作一致，14 种语言可切换，进度可存档。

### 1.2 范围内

| 模块 | 内容 |
|---|---|
| 角色 | 5 个可玩角色：Ironclad、Silent、Defect、Necrobinder、Regent |
| 幕 | 4 幕：Glory、Hive、Overgrowth、Underdocks |
| 内容 | 606 张卡牌、297 件遗物、64 种药水、283 种能力（Power）、125 种怪物、93 种遭遇、63 个事件、24 种附魔、11 种远古（Ancient）、9 种诅咒（Affliction）、6 种充能球 |
| 模式 | 标准、每日挑战（本地种子）、自定义（34 个修正器） |
| 系统 | 13 级进阶、解锁与成就（本地存储）、运行历史、统计 |
| 表现 | Spine 动画（160 个骨骼）、246 个 VFX 场景、自适应音乐分层、14 种语言 |
| 输入 | 鼠标键盘、触屏 |

### 1.3 范围外

- 多人合作（原作依赖 Steam 传输层，`Core.Multiplayer` 143 个类型全部跳过）
- Mod 支持（Harmony / MonoMod）
- Steam 成就、云存档、排行榜、Rich Presence
- Sentry 上报
- 手柄（`Core.ControllerInput` 12 个类型，M4 之后视需要补）
- 新手引导 FTUE（13 个场景，M4 之后补）

### 1.4 法律边界

- 反编译与资源提取仅供学习使用，不分发资源包。
- 仓库提交文档、脚本、自己写的代码，以及运行所需的 `assets/` 和 `packages/core/src/gen/`；`ref/`、`_work/` 已在 `.gitignore` 中。
---

## 2. 原作现状盘点

以下事实全部从 `/Applications/SlayTheSpire2.app` 实测得出，是本方案所有决策的依据。

### 2.1 代码

| 项目 | 值 |
|---|---|
| 程序集 | `sts2.dll`，8.8MB IL，未混淆 |
| 类型 / 方法 | 9,055 个类型，47,388 个方法，37,928 个字段 |
| 规则层 `Core.Models` | 1,635 个类型，**零 Godot 继承**，仅 13 个字段引用 Godot 值类型 |
| 表现层 `Core.Nodes` | 655 个类型，611 个继承 Godot 节点，1,926 个 Godot 字段 |
| 其他规则命名空间 | Entities 120、Combat 24、GameActions 38、Commands 22、MonsterMoves 24、Rooms 14、Map 14、Runs 37、Saves 101、Random 2、Odds 6 |
| 平台耦合 | Steamworks.NET、Sentry、FMOD GDExtension、Harmony、Vortice DirectX |
| 反编译结果 | ILSpy 9.1 输出 3,298 个 `.cs`，22MB；`Core.Models` 1,635 个文件、95,448 行，可读性高（见 6.1 的样例） |
| 内容类数量 | CardModel 578、RelicModel 289、PowerModel 249、MonsterModel 123、EncounterModel 95、PotionModel 64、EventModel 61 |

**关键结论**：原作已经把规则（Models）和表现（Nodes）分层，联机的确定性设计强迫他们这么做。重写时沿用这条分界线：规则层是纯 TS 包，表现层是 Pixi。

### 2.2 资源（原始）

| 类别 | 数量 | 原始体积 | 格式 |
|---|---|---|---|
| 贴图 | 3,367 | 1,178MB | Godot `.ctex`：WebP 2,572 张、S3TC 480 张、BPTC 315 张 |
| 音频 | 12 个 bank | 283MB | FMOD Studio，2,405 条流 |
| 字体 | 17 | 133MB | TTF/OTF，主要是 CJK |
| Spine | 160 骨骼 + 165 图集 | 22MB | Spine 4.2.03 至 4.2.43 二进制 |
| 场景 | 907 `.tscn` + 493 `.tres` | 6.6MB | Godot 文本场景 |
| 着色器 | 75 | 0.1MB | 全部 `canvas_item`，10 个用屏幕纹理 |
| 本地化 | 14 语言 × 45 JSON | 9MB | 扁平键值，SmartFormat 模板 |

### 2.3 文本模板语法

卡牌描述用 SmartFormat 风格表达式加 BBCode 标签，共 188 种不同表达式。这是必须完整移植的子系统：

```
Deal {Damage:diff()} damage.\nApply {VulnerablePower:diff()} [gold]Vulnerable[/gold].
Deal damage equal to your [gold]Block[/gold].{InCombat:\n(Deals {CalculatedDamage:diff()} damage)|}
Exhaust {Amount:plural:card|cards}.
{CalculatedEnergy:energyIcons()}
```

- `{X:diff()}`：显示数值，升级或计算后变化时高亮
- `{X:plural:a|b}`：单复数
- `{Cond:yes|no}`：条件分支
- `[gold]…[/gold]`、关键字标签：富文本着色与悬浮提示

---

## 3. 技术选型

| 决策点 | 选择 | 理由 | 放弃的选项 |
|---|---|---|---|
| 语言 | TypeScript 5.x，`strict` | 规则层需要类型约束来对照 C# | 纯 JS |
| 包管理 / 构建 | pnpm workspaces + Vite 6 | monorepo 分包，零配置静态产物 | Turborepo（暂不需要） |
| 2D 渲染 | PixiJS v8 | WebGL2 / WebGPU 双后端，成熟的 Spritesheet、Text、Filter 体系 | Phaser（自带的场景/物理/输入系统我们用不上）、Canvas 2D（VFX 着色器无法迁移） |
| 骨骼动画 | `@esotericsoftware/spine-pixi-v8` 4.2.x | 官方运行时，**主次版本必须与骨骼文件一致（4.2）**，直接加载 `.skel` 二进制 | 自己写渲染器 |
| 游戏内 UI | Pixi（`Text` / `HTMLText` / `Container`） | 场景坐标从 `.tscn` 1:1 迁移，1920×1080 逻辑坐标 | DOM 覆盖层（战斗、地图需要与画布同步的动画） |
| 游戏外 UI | DOM + Preact | 主菜单、设置、图鉴、历史这类文本密集页面用 DOM 做本地化和无障碍最省事 | 全 Pixi |
| 音频 | Web Audio API，自写约 200 行 `AudioBus` | 需要总线增益、分层交叉淡入、按幕懒加载；库解决不了 FMOD 事件映射丢失的问题 | Howler.js |
| 音频格式 | Opus in Ogg，单声道：音乐与环境 16kbps、音效 12kbps | Safari 18.4 起全平台支持 Ogg/Opus，无缝循环；按“能听即可”取体积优先（比 40k 立体声小 62%，音乐 stem 解码内存减半），失去立体声宽度，音效约 8kHz 带宽 | MP3（循环有间隙，同音质体积约翻倍）、双格式（体积翻倍）、40k 立体声（约 3 倍体积） |
| 贴图格式 | WebP，质量 75（method 6），`@0.5x` 后缀 | 全平台支持、体积最优；Pixi 原生识别 `@0.5x` 分辨率后缀 | AVIF（解码慢、Safari 旧版不支持）、KTX2（工具链重） |
| 字体 | woff2 子集 | CJK 全字库 24MB 一个，子集化后 1.4MB | 全字库 |
| 状态与确定性 | 命令日志 + 种子 RNG | 与原作 `Core.Commands` 对应，可回放、可测试、存档即种子加日志 | 快照存档 |
| 存档 | IndexedDB（`idb-keyval`） | 容量够、异步、所有浏览器可用 | localStorage（5MB 上限） |
| 测试 | Vitest | 与 Vite 同生态，规则层测试无需浏览器 | Jest |
| 部署 | 任意静态托管 + CDN，Brotli，`immutable` 缓存头 | 全静态，没有后端 | 自建服务器 |

---

## 4. 架构

> 本节是最初“手写规则层”方案的设计。规则层现由转译器生成（见文首“实施记录”），4.3 的规则引擎与 SmartFormat 子集设计已不再适用；分层原则、表现层与存档部分仍然有效。

### 4.1 分层原则

```
┌──────────────────────────────────────────────┐
│ packages/ui        DOM 界面（Preact）          │  主菜单 / 设置 / 图鉴 / 历史
├──────────────────────────────────────────────┤
│ packages/render    Pixi 表现层                  │  地图 / 战斗 / 奖励 / 商店 / 篝火 / 事件 / VFX / Spine / 音频
├──────────────────────────────────────────────┤
│ packages/core      规则引擎（纯 TS，无 DOM）     │  实体 / 内容 / 战斗 / 流程 / 命令 / RNG / 文本模板 / 存档序列化
└──────────────────────────────────────────────┘
        ↑ 单向依赖：ui → render → core。core 不 import 任何浏览器 API。
```

规则引擎通过**事件流**通知表现层（`CardPlayed`、`DamageDealt`、`PowerApplied` 等），表现层把事件排队播放动画，播放完再向引擎提交下一条命令。这对应原作 `Core.GameActions` 的动作队列模型。

### 4.2 仓库结构

```
sts2-web/
├── docs/                         本文档与后续设计文档
├── tools/                        资源提取管线（已完成，见第 5 节）
│   ├── extract.py                PCK → 贴图/图集/Spine/字体/本地化/参考文件
│   ├── audio.py                  FMOD bank → Opus
│   ├── decompile.sh              sts2.dll → C# 源码
│   └── .venv/                    Python 依赖（Pillow、fonttools、zstandard）
├── assets/                       Web 就绪资源（生成物，gitignore）
├── ref/                          参考资料（生成物，gitignore）
│   ├── decompiled/               ILSpy 反编译的 C# 工程
│   ├── godot/                    907 个 .tscn、493 个 .tres、75 个 .gdshader、13 个 .tpsheet
│   ├── fonts/                    原始字体
│   └── audio/                    FMOD 事件名参考
├── packages/
│   ├── core/                     规则引擎
│   │   └── src/
│   │       ├── rng/              种子 PRNG（算法从 Core.Random 反编译结果移植）
│   │       ├── model/            Creature、Player、Monster、Card、Relic、Potion、Power、Orb 基类
│   │       ├── content/          每个内容一个文件，与 C# 类同名
│   │       │   ├── cards/<character>/    606 张
│   │       │   ├── relics/               297 件
│   │       │   ├── potions/              64 种
│   │       │   ├── powers/               283 种
│   │       │   ├── monsters/<act>/       125 种
│   │       │   ├── encounters/<act>/     93 种
│   │       │   └── events/<act>/         63 个
│   │       ├── combat/           CombatState、动作队列、意图、目标选择、回合流程
│   │       ├── run/              RunState、地图生成、房间、奖励、商店、篝火、宝箱
│   │       ├── commands/         玩家命令类型与回放
│   │       ├── text/             SmartFormat 子集求值器、BBCode 解析、关键字
│   │       ├── save/             存档序列化与版本迁移
│   │       └── index.ts
│   ├── render/                   Pixi 表现层
│   │   └── src/
│   │       ├── assets/           加载器：manifest、@0.5x、按幕分包
│   │       ├── spine/            Spine 加载与皮肤、动画状态封装
│   │       ├── audio/            AudioBus、音乐分层、音效池
│   │       ├── scenes/           combat/ map/ rewards/ shop/ rest/ event/ treasure/ 
│   │       ├── vfx/              从 scenes/vfx 移植的粒子与着色器效果
│   │       └── text/             富文本渲染（图标内联、关键字提示）
│   ├── ui/                       DOM 界面
│   └── app/                      Vite 入口、路由、存档管理器、设置
├── pnpm-workspace.yaml
└── package.json
```

### 4.3 规则引擎设计要点

**实体模型**（对应 `Core.Entities` 与 `Core.Models` 基类）

```ts
interface Creature { id; hp; maxHp; block; powers: Power[]; isDead; }
interface Player extends Creature { energy; maxEnergy; hand; drawPile; discardPile; exhaustPile; relics; potions; gold; deck; }
interface Monster extends Creature { moves: MonsterMove[]; nextMove; intent: Intent; }
abstract class Card { id; type; rarity; cost; target; upgraded; abstract play(ctx: CombatContext): void; description(ctx): string; }
abstract class Power { id; amount; abstract hooks: Partial<PowerHooks>; }   // onDamageDealt / atTurnStart / ...
```

**动作队列**（对应 `Core.GameActions`）

所有状态变更通过 `GameAction` 入队顺序执行，每个动作执行后产生 `GameEvent[]` 供表现层消费。这一点不能简化：能力的触发顺序（比如 Vulnerable 与 Strength 的结算顺序）完全依赖动作队列的顺序。

**命令与确定性**（对应 `Core.Commands`）

玩家输入只有一种进入引擎的方式：`engine.apply(command)`。命令类型约 22 种：`PlayCard`、`EndTurn`、`UsePotion`、`ChooseMapNode`、`ChooseReward`、`BuyItem`、`RestSiteOption`、`EventChoice` 等。存档 = 种子 + 命令日志 + 定期快照；测试 = 固定种子 + 命令序列 + 断言状态。

**RNG**

原作有按用途分流的随机流（卡牌奖励、地图、遭遇、事件、商店、药水等）。移植时保留同样的分流结构，算法以反编译的 `Core.Random` 为准，目标是同一个种子在 Web 版和原作生成同一张地图。这是可选的一致性目标，不阻塞主线。

**文本模板**（对应 `Core.Localization` 57 个类型 + `Core.RichTextTags` 16 个类型）

实现 SmartFormat 的子集：命名占位、`:diff()`、`:plural:a|b`、`:energyIcons()`、条件 `{X:a|b}`、嵌套。14 种语言的复数规则按 CLDR 处理（俄语、波兰语有 3 种复数形式）。这是 M1 的独立任务，有 188 个表达式作为测试用例。

### 4.4 表现层设计要点

- **逻辑坐标系 1920×1080**，与 Godot 工程一致，`.tscn` 里的位置、锚点、缩放可以直接抄。画布按窗口等比缩放（对应 Godot 的 `canvas_items` 拉伸模式）。
- **资源分辨率 0.5x**：所有 ≥128px 的贴图按 0.5 缩放，文件名带 `@0.5x`，Pixi 加载后 `texture.width` 自动报告逻辑尺寸，代码里不需要乘 2。
- **场景移植**：每个 `.tscn` 对应一个 `render/scenes/*.ts`，节点树用 Pixi `Container` 复现，Tween 用 Pixi 的 ticker 加自写的 60 行缓动函数（原作 `Core.Nodes` 里有 296 处 Tween 字段引用，说明动画基本是代码驱动而非 AnimationPlayer 驱动，这对移植有利）。
- **Spine**：`spine-pixi-v8` 加载 `.skel` + `.atlas`，图集页已经是 `@0.5x` WebP，UV 由图集文件里的 `size` 行计算，不受页图缩放影响（已核对 spine-ts 4.2 源码）。
- **VFX**：246 个 VFX 场景按使用频率分三档移植。第一档（受击、格挡、能力图标、卡牌飞行）M1 完成；第二档（角色专属、Boss）M3；第三档（事件、环境）M4。GPU 粒子用 Pixi 的 `ParticleContainer`；75 个 `canvas_item` 着色器逐个改写为 Pixi `Filter`（GLSL ES 3.0），其中 10 个用屏幕纹理的改用 `RenderTexture`。
- **音频**：`AudioBus` 持三条增益链（music / sfx / ambience）。每幕的音乐 bank 已解出为若干 stem（第一幕 A 版 107 条），自适应分层用 stem 之间的增益交叉淡入实现，规则从反编译的 `Core.Audio` 5 个类型移植。音效按文件名映射（`sts_sfx_Architect_attack_v2.ogg` 这类命名已经足够自描述）。

### 4.5 DOM 界面

主菜单、角色选择的文本部分、设置、图鉴（卡牌 / 遗物 / 药水 / 怪物）、运行历史、统计用 Preact 写。这些页面文本密集，需要滚动、搜索、表单控件，DOM 比 Pixi 省一个数量级的工作量。角色选择的 Spine 立绘用一个 Pixi 画布嵌入。

### 4.6 存档

- `profile`：解锁、成就、统计、设置（一个 JSON）
- `run`：当前局的种子 + 命令日志 + 最近快照
- `history`：已结束的局摘要
- 版本号写在每条记录里，加载时按版本迁移。

---

## 5. 资源管线（已完成）

### 5.1 压缩策略

| 规则 | 值 | 说明 |
|---|---|---|
| 贴图全局缩放 | 0.5 | 原作按 1920×1080 设计并附带 2x 素材，Web 按 1x 供给 |
| 小图不缩放 | 最长边 < 128px 保持 1:1 | 图标缩一半会糊 |
| 最长边上限 | 2048px | 超出的按比例进一步缩小，文件名后缀记录实际比例（如 `neow@0.355x.webp`） |
| 贴图格式 | WebP 有损，质量 75，method 6 | 带 alpha；比质量 80 / method 4 小约 16%，PSNR 约低 1 dB |
| 打包图集 | 从原图集页裁出全部精灵 → 0.5 缩放 → 重新打包 2048×2048、2px 间距 | 直接缩放原图集会产生半像素间距和渗色，所以重打包 |
| 图集描述 | Pixi JSON hash 格式，`meta.scale = "0.5"` | 多页用 `related_multi_packs` 关联 |
| Spine | `.skel` 原样，`.atlas` 只改页图文件名，页图 0.5 缩放 | UV 由 `size:` 行计算，坐标不用改 |
| 字体 | 子集为 14 种语言全部文本出现的 4,640 个字符 + ASCII，输出 woff2 | 不保留 hinting |
| 音频 | Opus 单声道，音乐与环境 16kbps、音效 12kbps，VBR（`tools/audio.py` 的 `MUSIC_KBPS`、`SFX_KBPS`、`CHANNELS`） | 跨 bank 内容相同的流只编码一次，manifest 里记录别名 |
| 本地化 | JSON 压缩空白 | 内容不变 |

### 5.2 产物清单

| 类别 | 数量 | 原始 | 产出 | 压缩比 |
|---|---|---|---|---|
| 贴图（`images/` + Spine 页图 + 其他） | 3,358 张 | 1,112MB | 38.9MB | 29× |
| 重打包图集 `atlases/` | 13 套 → 15 页，2,575 个精灵 | 约 66MB | 3.7MB | 18× |
| Spine 骨骼 `.skel` | 160 | 22.0MB | 22.0MB | 原样 |
| Spine 图集 `.atlas` | 165 | 0.3MB | 0.3MB | 原样 |
| 字体 `fonts/` | 17 | 133MB | 8.0MB | 17× |
| 本地化 `i18n/` | 631 个文件，14 种语言 | 9MB | 8.4MB | 1× |
| 音频 `audio/` | 12 bank，2,405 流，去重后 2,219 文件 | 283MB | 31.4MB | 9× |
| **合计** | | **约 1,626MB** | **123.0MB** | 13× |

音频里音乐与环境约 26MB，音效约 5MB。音乐按幕懒加载，每幕约 4 到 5MB；首屏（菜单 + 第一场战斗）实际需要的资源约 15MB。

### 5.3 目录说明

```
assets/
├── manifest.json               贴图/图集/字体/Spine 的完整清单（源路径、尺寸、比例、字节数）
├── images/<原路径>@0.5x.webp    3,150 张独立贴图，路径与 res://images/ 一致
├── animations/<原路径>/         Spine：name.skel、name.atlas、name@0.5x.webp
├── scenes/backgrounds/…        少量放在 scenes 下的 Spine 背景
├── atlases/<name>-<n>.json/.webp   card_atlas、relic_atlas、power_atlas、potion_atlas、intent_atlas、ui_atlas 等
├── fonts/<name>.woff2
├── i18n/<lang>/<table>.json    lang ∈ eng zhs jpn kor fra deu spa esp ita ptb rus pol tur tha
└── audio/
    ├── manifest.json           每个 bank 的流数、去重别名、码率
    ├── act1_a1/ act1_a2/ act1_b1/ act2_a1/ act2_a2/ act3_a1/ act3_a2/   音乐 stem
    ├── ambience/ Master/       环境音、通用
    └── sfx/ temp_sfx/          音效，按原始文件名

ref/
├── decompiled/                 ILSpy 输出的 C# 工程，3,298 个文件（规则翻译的输入）
├── godot/                      场景、材质、着色器、图集描述、.import 映射（表现层移植的输入）
├── fonts/                      原始 TTF/OTF
```

### 5.4 重新生成

```bash
# 依赖：Homebrew 的 ffmpeg、vgmstream；.NET 9 SDK + ilspycmd；tools/.venv 里的 Pillow、fonttools、zstandard
uv venv tools/.venv && uv pip install --python tools/.venv/bin/python pillow fonttools brotli zstandard
brew install ffmpeg vgmstream
curl -sSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 9.0 --install-dir ~/.dotnet
~/.dotnet/dotnet tool install --global ilspycmd        # 装到 ~/.dotnet/tools，decompile.sh 会自动找到

tools/.venv/bin/python tools/extract.py          # 全部阶段，约 3 分钟
tools/.venv/bin/python tools/extract.py --only textures,atlases   # 只重跑某些阶段，manifest 会合并
tools/.venv/bin/python tools/audio.py            # 约 5 分钟，中间 WAV 在 _work/audio/（4.4GB，可删）
tools/decompile.sh                               # 输出到 ref/decompiled/
```

调参数改 `tools/extract.py` 顶部的常量：`SCALE`、`MIN_SCALE_SIDE`、`FULL_RES`（不缩放的路径前缀：卡面图集、主角 Spine 贴图，后者同时存为无损）、`MAX_SIDE`、`WEBP_Q`、`ATLAS_Q`（单个图集的质量覆盖）、`WEBP_METHOD`、`ATLAS_PAD`；`tools/audio.py` 顶部的 `MUSIC_KBPS`、`SFX_KBPS`、`CHANNELS`。原作更新版本后重跑一遍即可。

### 5.5 已知缺口

| 缺口 | 影响 | 处理 |
|---|---|---|
| FMOD 事件内部的样本选择与随机权重没有随 bank 导出 | 一个事件对应多个候选音效时不知道权重 | 代码里有 341 个 `event:/…` 路径，音乐事件名与 stem 文件名直接对应（`event:/music/act1_a1_v1` ↔ `audio/act1_a1/`）；音效在 `DamageCmd…WithHitFx(vfx, _, "blunt_attack.mp3")` 这类调用点上按名字引用，`Core/Audio/FmodSfx.cs` 负责解析。M1 从这两处生成映射表，候选权重取均匀分布 |
| 自适应音乐的分层规则在 FMOD 工程里 | 只有 stem，没有"战斗时叠加哪层"的逻辑 | M4 按战斗状态做简单叠层，规则从 341 个事件名的命名约定（`_v1/_v2`、`_boss`、`_Ringing`）和试听推断 |
| 4 张贴图缩放比例不是 0.5（超过 4096px 的背景） | 逻辑尺寸靠文件名后缀识别 | Pixi 自动处理，无需代码 |
| `images/packed/` 与打包图集有 229 个同名文件 | 无影响，输出保留了完整相对路径 | 无 |
| 手柄按键图集 `controller_atlas` | 手柄在范围外 | 已提取，暂不使用 |

---

## 6. 规则翻译方法论（已由转译器路线取代，见“实施记录”）

这是整个项目工作量最大、最容易失控的部分。原则只有一条：**逐文件、同名、同结构地翻译，不发明新的抽象**。原作规则是代码，Web 版规则也是代码；不做"卡牌 DSL"或"数据驱动效果系统"，那会把 606 张卡的行为差异重新变成设计问题。

### 6.1 反编译

```bash
tools/decompile.sh    # ILSpy，输出 ref/decompiled/，按命名空间分目录
```

规则翻译只看这些目录，其余（Nodes、Multiplayer、Modding、Platform、DevConsole）不看：

```
ref/decompiled/MegaCrit/Sts2/Core/Models/      内容与基类
ref/decompiled/MegaCrit/Sts2/Core/Entities/    实体
ref/decompiled/MegaCrit/Sts2/Core/Combat/
ref/decompiled/MegaCrit/Sts2/Core/GameActions/
ref/decompiled/MegaCrit/Sts2/Core/Commands/
ref/decompiled/MegaCrit/Sts2/Core/MonsterMoves/
ref/decompiled/MegaCrit/Sts2/Core/Rooms/  Map/  Runs/  Rewards/  Events/
ref/decompiled/MegaCrit/Sts2/Core/Random/  Odds/  Saves/  Localization/  RichTextTags/
```

反编译输出的可读性以 `Models/Cards/Bash.cs` 为例，这就是翻译的输入形态：

```csharp
public sealed class Bash : CardModel
{
    protected override IEnumerable<DynamicVar> CanonicalVars => [ new DamageVar(8m, ValueProp.Move), new PowerVar<VulnerablePower>(2m) ];
    public Bash() : base(2, CardType.Attack, CardRarity.Basic, TargetType.AnyEnemy) { }
    protected override async Task OnPlay(PlayerChoiceContext choiceContext, CardPlay cardPlay)
    {
        await DamageCmd.Attack(DynamicVars.Damage.BaseValue).FromCard(this).Targeting(cardPlay.Target)
            .WithHitFx("vfx/vfx_attack_blunt", null, "blunt_attack.mp3").Execute(choiceContext);
        await PowerCmd.Apply<VulnerablePower>(cardPlay.Target, DynamicVars.Vulnerable.BaseValue, Owner.Creature, this);
    }
    protected override void OnUpgrade() { DynamicVars.Damage.UpgradeValueBy(2m); DynamicVars.Vulnerable.UpgradeValueBy(1m); }
}
```

三个直接影响架构的观察：

1. **规则层是 `async` 的**。543 / 578 张卡的 `OnPlay` 是 `async Task`，因为出牌中途要等玩家选择（`PlayerChoiceContext`）。TS 里保留 `async` / `Promise`，玩家选择即"等待下一条命令"，不影响确定性回放。
2. **有一套流式命令 API**（`DamageCmd`、`PowerCmd`、`CardCmd` 等，`Core.Commands` 22 个类型）。这是全部内容代码的骨架，M1 先 1:1 移植它，之后每张卡的翻译就是逐行改语法。
3. **数值类型是 C# `decimal`**。Models 里带小数的字面量只有约 20 处（0.5、1.5、0.75、0.25 可精确表示；1.2、0.2、1.3、1.1、0.8、0.7、0.3、0.33 不可）。TS 用 `number`，但在每一处乘法后按 C# 代码的舍入调用（`Math.Floor` / `Math.Round`）做同样的舍入，并为这约 20 处各写一个用例。

翻译工作量按类统计：

| 基类 | 子类数 | 目录 |
|---|---|---|
| CardModel | 578 | `Models/Cards/` |
| RelicModel | 289 | `Models/Relics/` |
| PowerModel | 249 | `Models/Powers/` |
| MonsterModel | 123 | `Models/Monsters/` |
| EncounterModel | 95 | `Models/Encounters/` |
| PotionModel | 64 | `Models/Potions/` |
| EventModel | 61 | `Models/Events/` |

本地化里的 ID 数（606 张卡、297 件遗物）略多于类数，差异是没有独立类的条目（变体文本、卡池定义），追踪表以类数为准。

### 6.2 清单与追踪

M0 里写一个脚本 `tools/inventory.py`，扫描 `ref/decompiled/…/Models/` 生成 `docs/content-tracker.md`：每个 C# 类一行，列出类别、角色、行数、目标 TS 文件路径、状态（未开始 / 已翻译 / 已测试）。所有进度以这张表为准。

### 6.3 翻译规范

| 规则 | 说明 |
|---|---|
| 一个 C# 类 → 一个 TS 文件，同名 | `BashCard.cs` → `content/cards/ironclad/BashCard.ts`，方便对照与 review |
| 方法名、字段名保持一致 | 只做大小写风格转换（`OnPlay` → `onPlay`） |
| C# 特有结构的固定译法 | `async Task` → `async` 返回 `Promise`（保留，见 6.1）；`IEnumerable<T>` 惰性序列 → 数组或 `Generator`；`decimal` → `number` 加显式舍入；泛型 `PowerCmd.Apply<VulnerablePower>` → `PowerCmd.apply(VulnerablePower, …)`；`Harmony` 钩子与 `[Multiplayer]` 特性 → 忽略 |
| 数值一个不改 | 伤害、格挡、费用、概率、进阶修正全部照抄，不"顺手平衡"；`decimal` 舍入点逐处对照 |
| 表现引用照抄为字符串 | `WithHitFx("vfx/vfx_attack_blunt", null, "blunt_attack.mp3")` 里的 VFX 与音效名原样保留，表现层按名字查表 |
| 引用 Godot 的地方 | Models 里只有 13 处（Color、Vector2），用 core 里的同名小类型替代 |
| 表现相关调用 | 规则层里出现的 VFX、音效触发改为发事件，由表现层订阅 |

### 6.4 测试规范

- 每个内容文件一个测试文件，至少一个用例：构造最小战斗状态 → 打出这张牌 / 触发这个遗物 → 断言关键数值。
- 引擎层（动作队列、能力结算顺序、回合流程）用命令序列回放测试：固定种子，跑固定命令，断言最终状态哈希。哈希变了就是行为变了。
- 文本模板 188 个表达式各一个用例，14 种语言的复数规则各一个用例。
- 覆盖率不作为指标；"每个内容有一个测试"作为指标。

### 6.5 一致性验证

- **静态对照**：review 时 C# 与 TS 并排看。
- **种子对照**：如果 RNG 算法移植成功，同一种子下地图结构、第一间房的遭遇、前三次卡牌奖励应与原作一致，可以手动对照。
- **运行历史对照**：原作把每局的 `run_history.json` 写在用户目录（`Core.Saves` 101 个类型里有格式）。把原作的一局命令序列在 Web 版回放，比对每层的 HP、金币、牌组。这是最强的验证手段，M2 建立。

---

## 7. 分阶段计划（手工翻译估算，已作废，留档）

### M0 脚手架与资源加载（1 人周）

**目标**：空项目能在浏览器里显示一个 Spine 怪物、一张卡牌、播一段音乐、显示一句中文。

**任务**

1. `pnpm init`，建 `packages/{core,render,ui,app}`，TypeScript strict，Vite，Vitest，ESLint。
2. `pnpm add pixi.js@^8 @esotericsoftware/spine-pixi-v8@^4.2 preact idb-keyval`。
3. `render/assets/loader.ts`：读 `assets/manifest.json`，注册 Pixi `Assets` 的 bundle：`boot`（UI 图集、字体、eng 文本）、`act1`…`act4`（背景、怪物 Spine、音乐）。
4. `render/spine/load.ts`：加载 `animations/monsters/<name>/<name>.skel|.atlas`，播放 `idle`。验证 4.2.43 版本骨骼在 spine-pixi-v8 上正常。
5. `render/audio/bus.ts`：`AudioContext` + 三条增益，`playMusic(url, loop)`、`playSfx(url)`。验证 Opus 在 Chrome、Firefox、Safari 解码。
6. `render/text/richText.ts`：用 `HTMLText` 渲染 `[gold]…[/gold]` 与内联能量图标。
7. `tools/inventory.py` → `docs/content-tracker.md`。
8. 全局字体：按语言映射 `fonts/` 里的 woff2（zhs → SourceHanSerifSC，jpn → NotoSansCJKjp，kor → Gyeonggi，tha → CSChatThaiUI，rus/pol/tur → FiraSansExtraCondensed，其余 → kreon / spectral / bitter）。

**验收**：`pnpm dev` 打开页面，看到 Spine 怪物待机动画、一张有富文本描述的卡、背景音乐在播，控制台无错误。

### M1 战斗垂直切片（5 人周）

**目标**：Ironclad 起始牌组对第一幕前两组遭遇，能打完一场战斗。

**任务**

1. `core/rng`：移植 `Core.Random`。
2. `core/model`：Creature、Player、Monster、Card、Power、Relic、Potion 基类；能力钩子表（`atTurnStart`、`onDamageDealt`、`onCardPlayed` 等，从 `Core.Models` 的 Power 基类抄钩子清单）。
3. `core/combat`：CombatState、动作队列、回合流程（抽牌 → 出牌 → 结束回合 → 怪物行动 → 能力衰减）、目标选择、伤害与格挡计算（含 Strength、Dexterity、Vulnerable、Weak、Frail 的顺序）。
4. `core/text`：SmartFormat 子集求值器 + BBCode 解析，188 个表达式用例全绿。
5. 内容：Ironclad 起始牌组（Strike、Defend、Bash）+ 10 张常见牌；第一幕前两组遭遇的怪物（含意图与行动模式）；3 件起始/常见遗物；2 种药水。
6. `render/scenes/combat`：手牌布局与悬停、拖拽出牌、能量、抽牌堆/弃牌堆、怪物意图、HP/格挡条、能力图标、结束回合按钮；第一档 VFX（受击、格挡、卡牌飞入弃牌堆）；音效映射表第一版。
7. 命令日志与回放：`PlayCard`、`EndTurn`、`UsePotion`、`ChooseTarget`。

**验收**：固定种子从战斗开始到胜利的命令序列回放测试通过；手动打 10 场无报错；伤害数值与原作逐回合对照一致（用原作同种子对照）。

### M2 第一幕闭环（7 人周）

**目标**：从选 Ironclad 到打完第一幕 Boss，含存档。

**任务**

1. `core/run`：RunState、地图生成（从 `Core.Map` 14 个类型移植，含房间类型分布与路径规则）、楼层推进。
2. 房间：怪物、精英、Boss、事件（第一幕的事件）、商店（定价、移除卡）、篝火（休息、升级、其他选项）、宝箱。
3. 奖励：卡牌奖励（稀有度概率、`Core.Odds`）、金币、药水、遗物。
4. 内容：Ironclad 全部卡牌（约 120 张）、第一幕全部怪物与遭遇（含精英、Boss）、第一幕事件、第一幕可出现的遗物与药水。
5. `render/scenes/{map,rewards,shop,rest,event,treasure}`：按 `ref/godot/scenes/` 移植布局。
6. `app/save`：IndexedDB 存档、继续游戏、放弃。
7. 结算画面、运行历史写入。
8. 运行历史对照工具：导入原作 `run_history.json`，回放并比对。

**验收**：一局完整第一幕从头到尾无阻塞；中途刷新页面可继续；至少一局与原作同种子对照地图结构一致。

### M3 全内容（24 人周，可 2 到 3 人并行）

**目标**：5 角色、4 幕、全部内容、进阶、解锁、每日、自定义。

**工作量拆分（按 6.2 的追踪表推进）**

| 内容 | 数量 | 单件估算 | 小计 |
|---|---|---|---|
| 卡牌（剩余） | 约 470 | 1.0 小时（读 C#、翻译、测试） | 12 人周 |
| 遗物 | 297 | 0.5 小时 | 4 人周 |
| 能力 | 283 | 0.5 小时 | 3.5 人周 |
| 怪物与遭遇（剩余） | 约 105 + 80 | 2 小时（行动模式、意图、Spine 接线） | 6 人周 |
| 事件（剩余） | 约 50 | 2 小时 | 2.5 人周 |
| 药水、附魔、远古、诅咒、充能球 | 64 + 24 + 11 + 9 + 6 | 0.5 小时 | 1.5 人周 |
| 第二至四幕地图、Boss 流程、结局 | | | 2 人周 |
| 角色专属机制（Defect 充能球、Necrobinder、Regent） | | | 3 人周 |
| 进阶 13 级、解锁、成就、每日、自定义修正器 | | | 2 人周 |
| 第二档 VFX（角色与 Boss 专属） | | | 3 人周 |

以上约 39.5 人周，其中卡牌、遗物、能力三类可完全并行，按 2.5 人并行折算日历约 16 周。这里记 24 人周是因为并行会带来接口对齐与 review 成本。

**验收**：追踪表全部"已测试"；5 个角色各通关一次；进阶 10 各通关一次。

### M4 打磨与发布（8 人周）

1. 第三档 VFX、卡牌升级预览、悬浮提示、关键字提示。
2. 自适应音乐分层、音效映射补全、音量设置。
3. 14 种语言逐一走查（字体、换行、复数、文本溢出）。
4. 触屏适配（拖拽出牌改为点选，最小点击区域 44px）。
5. 性能：首屏 15MB 内，战斗稳定 60fps，2048 图集数控制在 GPU 内存 256MB 内；低端设备降级（关闭部分粒子）。
6. 部署：静态托管、Brotli、资源文件名加内容哈希、`Cache-Control: immutable`、Service Worker 缓存已访问过的幕。
7. 图鉴、统计、运行历史 DOM 页面。

**验收**：Chrome、Firefox、Safari 各通关一局；Lighthouse 性能 > 80；14 种语言截图走查完成。

### 7.1 工作量汇总

| 阶段 | 人周 | 累计 |
|---|---|---|
| M0 | 1 | 1 |
| M1 | 5 | 6 |
| M2 | 7 | 13 |
| M3 | 24 | 37 |
| M4 | 8 | 45 |
| 基线合计 | 45 | |
| 内容估算的不确定性余量（+30%，主要在 M3） | 约 7 | 52 |
| 引擎与验证的不确定性余量（+30%，主要在 M1、M2） | 约 4 | 56 |
| **建议预算** | **约 56 到 68 人周（14 到 16 人月）** | |

1 人全职：约 14 到 16 个月。M3 起 2 到 3 人：日历约 8 到 9 个月。

---

## 8. 风险与对策

| 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|
| 内容翻译量超估（卡牌行为比预想复杂） | 高 | 进度 | 追踪表每周看燃尽；M1 结束时用前 30 张卡的实际耗时校准 M3 估算 |
| 文本模板求值器与原作不一致（14 种语言、188 个表达式） | 中 | 显示错误 | M1 独立任务、全量用例；原作 SmartFormat 是开源库，可对照其语义 |
| 能力结算顺序错误 | 中 | 数值错误、难以察觉 | 动作队列严格按反编译代码顺序；命令回放哈希测试；同种子与原作逐回合对照 |
| spine-pixi-v8 与 4.2.43 骨骼有兼容问题 | 低 | 动画缺失 | M0 第一天验证；备选是 spine-webgl 独立画布叠加 |
| 原作抢先体验期间每周更新，内容漂移 | 高 | 内容过时 | 锁定 v0.98.3；管线可重跑；正式版发布后再做一次 diff 迁移 |
| FMOD 事件内部的随机权重与音乐分层规则丢失 | 确定 | 音效随机性、音乐动态与原作有差异 | 5.5 节的处理；事件名与调用点都在代码里，映射本身可重建；接受 M4 之前音乐分层是"能听"而非"一致" |
| RNG 算法移植失败，无法与原作同种子对照 | 中 | 失去最强验证手段 | 退回运行历史回放对照（不依赖 RNG 一致） |
| 反编译代码里 async 状态机、lambda 难读 | 中 | 翻译慢 | Models 层基本是同步的普通代码，问题集中在 Nodes 层，而 Nodes 层我们不翻译只参考 |
| 版权 | 确定 | 可能被权利人要求下架 | 仅供学习使用 |

---

## 9. 验收标准

**功能**：5 角色各通关标准模式一次；进阶 10 通关一次；每日与自定义模式各跑一局；存档在刷新、关闭浏览器后可继续。

**一致性**：随机抽 50 张卡、20 件遗物、20 种能力，人工与原作对照描述与数值，零差异；至少 3 局原作运行历史在 Web 版回放后每层 HP、金币一致。

**表现**：Spine 动画、第一二档 VFX、音效在战斗中齐全；14 种语言无文本溢出。

**性能**：首屏资源 ≤ 15MB；战斗 60fps（M2 MacBook Air / 中端 Windows 笔记本核显）；单幕资源包 ≤ 30MB。

**兼容**：Chrome 120+、Firefox 120+、Safari 18.4+、Edge 120+；iPad Safari 可玩。

---

## 附录 A 命令速查

```bash
# 资源
tools/.venv/bin/python tools/extract.py                    # 全部
tools/.venv/bin/python tools/extract.py --only fonts       # 单阶段
tools/.venv/bin/python tools/audio.py
tools/decompile.sh

# 开发（M0 之后）
pnpm install
pnpm dev                      # packages/app，Vite
pnpm test                     # Vitest，全部包
pnpm -F @sts2/core test       # 只跑规则层
pnpm build                    # 静态产物到 packages/app/dist

# 检查
tools/.venv/bin/python -c "import json;m=json.load(open('assets/manifest.json'));print(len(m['textures']))"
```

## 附录 B Godot → Web 概念对照

| Godot / C# | Web 版 |
|---|---|
| `Node2D` / `Control` 场景树 | Pixi `Container` 树 |
| `.tscn` 位置、锚点、缩放 | 直接抄到 `render/scenes/*.ts`，逻辑坐标 1920×1080 |
| `CompressedTexture2D` `.ctex` | `assets/images/**.webp`（`@0.5x`） |
| `AtlasTexture` + `.tpsheet` | Pixi Spritesheet JSON |
| `SpineSprite` (spine-godot) | `spine-pixi-v8` `Spine` 对象 |
| `Tween` | Pixi ticker + 缓动函数 |
| `GpuParticles2D` / `CpuParticles2D` | Pixi `ParticleContainer` + 自写发射器 |
| `ShaderMaterial` (`canvas_item`) | Pixi `Filter`（GLSL ES 3.0） |
| `ShaderMaterial` 用 `hint_screen_texture` | `RenderTexture` 采样 |
| FMOD 事件 | `AudioBus.playSfx(name)` + 映射表 |
| FMOD 参数驱动的音乐 | stem 增益交叉淡入 |
| `FontFile` `.fontdata` | `@font-face` woff2 |
| `Translation` JSON + SmartFormat | `core/text` 求值器 + 同一份 JSON |
| `user://` 存档 | IndexedDB |
| `GameAction` 队列 | `core/combat/actions` 队列，语义一致 |
| `Command`（联机同步用） | `core/commands`，仅用于存档与回放 |
| Steam 成就 / 云存档 | 本地 profile |

## 附录 C 本方案之外的两个备选（已否决，留档）

- **A 云串流**：原版跑在带 GPU 的服务器上，WebRTC 推流。置信度 90%，1 到 2 周，但按并发用户线性付费，不是"移植"。
- **D 规则层 wasm + Web 表现层**：`Core.Models` 用 .NET browser-wasm 编译进浏览器，表现层重做。置信度 55 到 60%。工作量比 C 少约 40%，但引入 Mono wasm 运行时（约 3MB 启动开销）和 C# / TS 双语言维护。若日后 C 路线内容翻译进度不达预期，D 是可以中途切换的方案，因为表现层的工作两者完全相同。
