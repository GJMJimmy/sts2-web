---
name: upgrading-game-version
description: Use when upgrading the game version this port is built from (升级游戏版本，例如 v0.98.3 → v0.107.1), re-running extract / decompile / `pnpm gen` against a newer Slay the Spire 2 build, comparing a new game build with the port, or re-checking the port after such an upgrade (升级后重查).
---

# 升级游戏版本

## 概览

升级 = 换输入重跑管线 + 让旧存档照样读出来 + 把手写层跟上。按阶段走：每个阶段过了**闸门**再进下一个，标着**停**的地方把情况告诉用户、等回复再继续。

四件事决定了下面的顺序：

1. **网页存档不是原作的格式。** `packages/core/src/rt/json.ts` 的 `snapshot()` 写的是带 C# 完整类型名（`$t`）、C# 成员名、枚举**数值**的快照。原作的存档迁移用不上（它按 snake_case 键名和字符串枚举写的）。类、命名空间、成员改名，或枚举重新编号，旧存档会被悄悄读错，不报错。
2. **读失败会毁档。** `ProgressSaveManager.LoadProgress` 读失败时用默认进度覆盖文件，`.backup` 只留一代。
3. **`ref/` 不入库。** 里面是当前版本的反编译源码，包括没转译的 `Core/Nodes`（桥接和界面照着它写）。游戏一更新，旧版本就再也反编译不出来。
4. **`tsc` 查不出引用失效。** 应用通过 `G: any` 访问规则层，缺的节点落到空实现的桩上：改名的类、重载、节点都能编译通过，运行时静默失效。

硬性规则见 `AGENTS.md`（旧存档、不手改 `gen/`）。

占位符：`<旧>` / `<新>` 版本号；`<基线提交>` 阶段 0 记下的提交；`<临时>` 仓库外的临时目录；`<备份>` 仓库外、由用户指定的备份目录。e2e 命令都要带 `CHROME=<headless shell 路径>`（见 `docs/development.md`），下文省略。

## 阶段 0：基线与备份（游戏还没更新）

`git status --porcelain` 不为空就**停**：请用户先提交，升级要从一个干净的提交开始。然后：

```bash
git rev-parse HEAD                     # 记为 <基线提交>
pnpm -F @sts2/core test && pnpm -F @sts2/app exec tsc -p . --noEmit
node tools/check-refs.mjs | sed -E 's/:[0-9]+  /  /' | sort -u > <临时>/refs-before.txt   # 去掉行号，升级后才比得了
cat "/Applications/SlayTheSpire2.app/Contents/Game/SlayTheSpire2.app/Contents/Resources/release_info.json"
DOTNET_ROOT=$HOME/.dotnet DOTNET_ROLL_FORWARD=Major ~/.dotnet/tools/ilspycmd --version    # 记下来，升级全程不换版本
# 转译可复现：输出到临时目录，四个文件必须和仓库里的一致
(cd tools/cs2ts && DOTNET_ROOT=$HOME/.dotnet $HOME/.dotnet/dotnet run -c Release -- ../../ref/decompiled <临时>/gen-check)
for f in sts2.ts stubs.ts bcl-uses.txt warnings.txt; do cmp <临时>/gen-check/$f packages/core/src/gen/$f; done
# 升级后要对比的基线，对着构建产物跑（pnpm build && pnpm -F @sts2/app preview）；数值都在标准输出里，要存下来
URL=http://127.0.0.1:47174/ node tools/e2e/coverage.mjs <临时>/cov-before > <临时>/cov-before.log
CHANNEL=chrome GPU=1 URL=http://127.0.0.1:47174/ node tools/e2e/perf.mjs <临时>/perf-before > <临时>/perf-before.log
```

**闸门**：测试全绿，`cmp` 无输出。不一致就停：之后的 diff 会把工具漂移和游戏改动混在一起。

**停**，问用户三件事：目标版本（正式版还是 beta）；`<备份>` 放哪；游戏怎么更新到 `/Applications/SlayTheSpire2.app`。然后：

```bash
cp -R /Applications/SlayTheSpire2.app <备份>/SlayTheSpire2-v<旧>.app
mv ref <备份>/ref-v<旧>     # 移走而不是拷贝：decompile.sh 不清空输出目录，残留的旧 .cs 会被一起转译；
                             # 移到仓库外：.gitignore 只忽略 /ref/
```

## 阶段 1：新版就位（用户操作）

用户更新游戏后，再读一次 `release_info.json` 确认版本。游戏不在 `/Applications/SlayTheSpire2.app`（或不是 macOS）时，路径写死在：`tools/decompile.sh`、`tools/extract.py`（`audio.py`、`fmod_bank.py` 引用它）、`tools/cs2ts/Program.cs`；`package.json` 的 `gen` 写死 `~/.dotnet`。

## 阶段 2：只看不改

不动任何入库文件：产物只进 `ref/`（不入库）和 `<临时>`。

```bash
tools/.venv/bin/python tools/extract.py --out <临时>/assets   # 约 5 分钟；同时重建 ref/godot、ref/dotnet。末尾应是 "textures: N ok, 0 failed"
tools/decompile.sh
(cd tools/cs2ts && DOTNET_ROOT=$HOME/.dotnet $HOME/.dotnet/dotnet run -c Release -- ../../ref/decompiled <临时>/gen-new)
bash .claude/skills/upgrading-game-version/compare.sh <备份>/ref-v<旧> <临时>/gen-new > <临时>/compare.txt
```

`compare.sh` 分七节输出，没变化的节是空的：

| 节 | 内容 | 用来判断 |
|---|---|---|
| 1 | 样本里出现的每个存档类型（`$t`）的新旧源码 diff | 类型、成员的增删改名 |
| 2 | 存档里存成数值的枚举（原作注册了字符串转换器的那些） | 成员移位、删除 |
| 3 | 消失的类 | 被删或改名的模型（卡牌、遗物、怪物、事件…） |
| 4 | 新的转译警告；新用到、不再用到的 BCL / Godot 成员 | `tools/cs2ts` 和 `rt/` 要补什么 |
| 5 | `stubs.ts` 的差异 | 规则层新调用了哪些没转译的节点和方法 |
| 6 | 变了、新增、消失的 `Core/Nodes` 文件，以及有多少手写文件提到它 | 桥接和界面的工作清单 |
| 7 | `overrides.ts`、`shell.ts`、`rt/` 重写或打补丁的原作成员里，原作变了的；`Core/Random` | 手写的替换是否还成立 |

**停**，交一份报告，固定包含：七节各自的结论；资源提取的失败项；对**进行中的对局（`current_run.save`）能否原样继续**的初步判断（依据第 1、2、3、7 节，实测在阶段 3）。是否继续由用户决定。

## 阶段 3：规则层与旧存档

```bash
pnpm gen
tools/.venv/bin/python tools/extract.py --only i18n           # 核心测试读 assets/i18n，文本表要和规则层同一版本
pnpm -F @sts2/core exec vitest run test/old-saves.test.ts     # 第一道闸门
pnpm -F @sts2/core test
```

转译或运行失败，只在 `tools/cs2ts`、`packages/core/src/rt`、`packages/core/src/overrides.ts` 里修。

`old-saves.test.ts` 查四件事：枚举编号没动；每个文件读回再写出不丢成员；样本里的模型 Id 都还在；`SaveManager` 读得出来、对局能继续且数值和浏览器导出时一致。它不过的时候，按下面做，**方案先给用户看**：

- **兼容写在哪**：`rt/json.ts` 的 `restore()`。应用读档（`JsonSerializer.Deserialize`）和测试的往返比较都经过它；只写在 `overrides.ts` 的 `LoadWithAggressiveRecovery` 里，直接调 `restore()` 的往返比较覆盖不到。旧类型名、旧成员名、旧模型 Id、旧枚举值到新值的转换表放在这里并导出。
- **怎么区分新旧存档**：新构建写出的存档要带一个网页版自己的版本标记（由 `rt/json.ts` 在写出的根对象上加、读的时候跳过），没有标记的就是 v0.98.3 时期的存档；转换只对旧的做。`SchemaVersion` 不能当这个标记：原作把枚举存成字符串，枚举重新编号时它不变。
- **消失的模型**：原作自己有规则，不用写代码（`SaveUtil.*OrDeprecated` 换成 `Deprecated*` 占位，进度统计丢弃未知 Id）。要做的是列出样本里受影响的 Id，让用户知道玩家会看到什么。
- **测试只允许这三种改法**，每一种都要用户先同意：
  1. 往返比较和模型 Id 检查之前，把 `restore()` 用的同一张转换表作用到旧文件上；
  2. 枚举那一项改成"旧编号经过转换表之后，等于同名成员现在的编号"；
  3. 用户确认为上游删除的 Id，在测试里逐个列明并写上版本。
- 样本文件（包括 `enums.json`）一个字节都不动，也不重新导出覆盖。

**闸门**：`old-saves.test.ts` 全绿，`git status --porcelain packages/core/test/fixtures` 为空，`git diff <基线提交> -- packages/core/src/rt/godot.ts` 里存储部分没动。

**停**：进行中的对局实测能不能继续（测试的最后一项）报告用户；不能继续的，怎么处理由用户决定，不要自己丢弃。

## 阶段 4：资源

脚本产出的目录先删再生成，上游删掉的资源才会在 `git status` 里显形（都在版本管理里，删错了能恢复）：

```bash
rm -rf assets/{addons,animations,atlases,fonts,i18n,images,scenes,shaders} assets/spine-index.json
tools/.venv/bin/python tools/extract.py | tee <临时>/extract.log
tools/.venv/bin/python tools/audio.py && tools/.venv/bin/python tools/audio_index.py
tools/.venv/bin/python tools/spine_index.py && tools/.venv/bin/python tools/scenes.py | tee <临时>/scenes.log
git status --short assets | grep '^ D'
```

- ` D` 不一定是上游删的：`scenes.py` 转换失败只打印一行 `skip <场景> <错误>` 就跳过；字体失败只记在 `assets/manifest.json` 的 `fonts` 条目的 `error` 里。先排除这两种，再确认它的源（场景文件，或贴图的 `.import`）在新的 `ref/godot` 里确实没有了，才 `git rm`。
- v0.98.3 上核对过：除音频外，上面的输出和仓库逐字节一致；`fonts/*.woff2` 每次只差时间戳，`manifest.json` 键的顺序会变，这两样的 diff 不代表内容变了。
- `audio.py` 的可复现性没核对过，音频的 diff 是不是噪音不知道。它重编码前会清掉每个 bank 的输出目录，所以只有整个被上游删掉的 bank 和 `assets/audio/debug` 不会自动清理。
- `assets/patch_notes/`（含 `index.json`）没有脚本产出：从 `ref/godot/localization/eng/patch_notes/` 手工更新。

**闸门**：提取输出 `0 failed`，`scenes.log` 里没有 `skip`，`manifest.json` 里没有字体 `error`，每个 ` D` 都有结论。

## 阶段 5：表现层

```bash
node tools/check-refs.mjs | sed -E 's/:[0-9]+  /  /' | sort -u | diff <临时>/refs-before.txt -    # 只允许减少
pnpm -F @sts2/app exec tsc -p . --noEmit
```

按 `compare.txt` 第 5、6、7 节的清单更新 `packages/app/src/bridge.ts`、界面、`overrides.ts`、`shell.ts`。`check-refs.mjs` 看不到写成裸数字的枚举值（例如 `rt/json.ts` 里的 `type !== 1 /* BaseDynamic */`）：第 2 节里变了的枚举，在手写代码里搜一遍它的成员名。新系统逐个定"实现"还是"明确不做"，不做的写进 `README.md` 的"暂不支持"。

## 阶段 6：新版本的样本

按 `packages/core/test/fixtures/saves-v0.98.3/README.md` 的做法，用新构建导出样本，放进**新目录** `fixtures/saves-v<新>/`，再冻结这一版的枚举表：

```bash
node tools/save-enums.mjs > packages/core/test/fixtures/saves-v<新>/enums.json
```

`old-saves.test.ts` 会自动跑到新目录；旧目录原样保留。

## 阶段 7：升级后重查

对着**构建产物**跑（`pnpm build && pnpm -F @sts2/app preview`，`URL=http://127.0.0.1:47174/`）；只有 `shaders.mjs`、`audio.mjs` 要对着开发服务器（它们的钩子只在 DEV 下有，跑的时候不要改 `packages/`）。

| 重查什么 | 怎么查 | 通过标准 |
|---|---|---|
| 旧存档、枚举编号 | `pnpm -F @sts2/core exec vitest run test/old-saves.test.ts` | 全绿，旧样本无改动 |
| 存储位置 | `git diff <基线提交> -- packages/core/src/rt/godot.ts` | `sts2fs`、`sts2fs:`、`sts2fs-j:`、localStorage 迁移都没改 |
| 存档路径 | 阶段 6 的新样本对比旧样本的目录结构 | 仍是 `default/1/profile<N>/saves/…` |
| 手写引用 | 阶段 5 的 `check-refs` 对比 | 相比基线无新增 |
| 重写过的原作成员 | `compare.txt` 第 7 节列出的每个文件，对照新源码 | 每条有结论：已跟进，或确认不受影响 |
| 桥接缺口 | `compare.txt` 第 5、6 节 | 新增的节点、方法逐个有结论 |
| 运行时缺口 | `compare.txt` 第 4 节 | 新增项都已实现或确认无害 |
| 随机数 | 同一 `SEED` 跑两次 `play.mjs`，标准输出各存一份再 diff；再和原作同种子对照开局 | 两次的楼层、房间、生命一致；和原作不一致要报告 |
| 整局流程 | `UNLOCK=0 GOD=1 FULL=1 SEED=E2EFINAL node tools/e2e/play.mjs <输出> 12000`；其余角色 `CHAR=<2..5> GOD=1 FULL=1 node tools/e2e/play.mjs <输出> 12000`（不带 `UNLOCK=0`） | **退出码 0**，且打印 `RESULT WIN` 或 `RESULT LOSS`。`UNFINISHED` 不算；收尾检查失败时照样打印 `RESULT WIN`，只有退出码是 1 |
| 全内容 | `node tools/e2e/coverage.mjs <输出>`，`coverage.json` 对比 `<临时>/cov-before` | 无新增失败（它直接调视图方法，点不到的界面查不出来） |
| 存读档 | `node tools/e2e/continue.mjs <输出>` | 打印 `OK` |
| 单项界面 | `console.mjs`、`crystal-sphere.mjs`、`screens.mjs` | 前两个打印 `OK`；`screens.mjs` 打印 `no errors`（它永远退出码 0），截图和新界面要人看 |
| 着色器、音频 | `URL=http://127.0.0.1:47173/ node tools/e2e/shaders.mjs`，`audio.mjs` 同样 | 无失败项 |
| 本地化 | 核心测试里的 `locale.test.ts`、`text.test.ts`；`LANG_UI=zhs` 跑一局 `play.mjs` | 无缺键、无方块字 |
| 性能 | `CHANNEL=chrome GPU=1 node tools/e2e/perf.mjs <输出> > <临时>/perf-after.log` 对比 `perf-before.log` | 无明显退化 |
| 版本号 | `grep -rn "<旧>" README.md AGENTS.md docs packages/app/src packages/core/src/rt` | 只剩历史记录里的 |

版本号目前写在：`README.md`、`AGENTS.md`、`docs/sts2-web-port-plan.md`、`packages/core/src/rt/bcl.ts`（程序集版本）、`packages/app/src/i18n.ts`、`packages/app/src/ui/menu.tsx`。

还没有脚本覆盖的一项：把旧样本写进浏览器的 IndexedDB 再点"继续"。补一个脚本，或手工做一次。

## 阶段 8：收尾

**停**，把重查表逐行的结果交给用户，分三组：通过的、没通过的、**没跑的**（写明原因）。没跑的不算通过。有没通过的就不要建议部署；有没跑的，部不部署由用户决定。提交、推送、部署都等用户开口。

部署前要说清一点：新构建写过存档之后，旧构建不保证读得了，所以不能回滚；部署时还开着旧页面的玩家也在这个范围里。

## 常见错误

| 错误 | 后果 |
|---|---|
| 为了让测试变绿去改样本，或用新构建重新导出覆盖旧样本 | 验收标准没了，玩家的旧存档照样读坏 |
| `tsc` 通过就认为引用没问题 | `G: any`，改名的类和重载到运行时才静默失效 |
| 只跑 `coverage.mjs` 就算界面验过 | 它不走鼠标，被遮住、点不到的界面查不出来 |
| 对着开发服务器跑 e2e 的同时改 `packages/` | HMR 中途重载，产生假失败 |
| 中途换了 `ilspycmd` 或 Python 依赖的版本 | 输出变了，diff 里分不清是工具还是游戏 |
| 阶段 2 就 `pnpm gen`、提取到 `assets/` | 还没决定升不升，工作区已经改了上百兆 |
