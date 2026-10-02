# 开发文档

设计思路与实施记录见 [移植方案](sts2-web-port-plan.md)，这里只讲怎么跑、怎么测、怎么重新生成。

## 常用命令

需要 Node 20+ 和 pnpm。运行所需的游戏资源和生成代码已经在仓库里，不需要安装游戏。

```bash
pnpm install
pnpm dev                         # 开发服务器 http://127.0.0.1:47173/
pnpm build                       # tsc + vite 构建，产物在 packages/app/dist
pnpm -F @sts2/app preview        # 预览构建 http://127.0.0.1:47174/
pnpm -F @sts2/core test          # 无头测试（约 2 分钟）
```

## 页面参数

| 参数 | 作用 |
|---|---|
| `?seed=<种子>` | 指定本局种子 |
| `?lang=zhs` | 指定语言；不指定时用设置里选过的语言，没选过则跟随设备语言 |
| `?unlock=all` | 全部解锁（等同原版控制台的 unlock all：全部发现、纪元揭示、进阶 10） |
| `?tutorials=off` | 关闭新手提示 |
| `?scene=<场景路径>` | 仅开发服务器：全屏显示单个场景，如 `scenes/rest_site/hive_rest_site.tscn` |
| `?dev=1` | 启用原版的开发者控制台（开发服务器下默认启用）：按 `` ` `` 开关，命令见 [dev-console.md](dev-console.md) |

存档保存在浏览器的 IndexedDB（`sts2fs` 库）；旧版本存在 localStorage 的存档会在首次启动时自动迁移。

## 工作原理

```
游戏安装包
  ├─ tools/extract.py、audio.py、scenes.py …  ──▶  assets/                  美术、动画、音频、文本、场景
  └─ tools/decompile.sh  ──▶  ref/decompiled
                                 └─ tools/cs2ts（Roslyn） ──▶  packages/core/src/gen   转译出的规则层

packages/core   运行时：C#/.NET 语义（BCL、集合、LINQ、Task、JSON）与 Godot API 的 TypeScript 实现
packages/app    表现层：Preact UI + Pixi 渲染，通过 bridge 接上规则层调用的场景节点
```

| 目录 | 内容 |
|---|---|
| `packages/core` | 转译出的规则层（`src/gen`）和让它跑起来的运行时（`src/rt`），附无头测试 |
| `packages/app` | 浏览器应用：UI、渲染、特效、音频、存档 |
| `tools/cs2ts` | C# → TypeScript 转译器 |
| `tools/*.py` | 资源提取：Godot 资源包、FMOD 音频、Spine 索引、场景与着色器转换 |
| `tools/e2e` | Playwright 脚本：自动游玩、覆盖测试、性能测量、截图 |
| `tools/video` | 介绍视频的逐帧录制与合成 |
| `assets` | 提取并压缩后的游戏资源 |
| `docs` | 文档与截图 |

## 浏览器端测试

用 Playwright 驱动真实界面，先安装浏览器：`npx playwright install chromium-headless-shell`。

```bash
CHROME=<headless shell 路径> FAST=1 GOD=1 node tools/e2e/play.mjs /tmp/play       # 自动游玩
CHROME=<路径> UNLOCK=0 GOD=1 FULL=1 SEED=E2EFINAL node tools/e2e/play.mjs /tmp/full 12000   # 全新存档完整一局：药水、牌堆查看、每层读档检查、保存退出+刷新+继续、通关后时间线收尾
CHROME=<headless shell 路径> node tools/e2e/coverage.mjs /tmp/cov                 # 全部卡牌/药水/遭遇战/遗物/事件覆盖
CHROME=<headless shell 路径> node tools/e2e/continue.mjs /tmp/cont                # 保存并退出 → 刷新 → 继续
CHROME=<headless shell 路径> node tools/e2e/console.mjs /tmp/console             # 开发者控制台：开关、补全、执行命令、历史
CHROME=<headless shell 路径> node tools/e2e/screens.mjs /tmp/screens              # 菜单侧各界面与局内新界面截图
CHROME=<headless shell 路径> node tools/e2e/shaders.mjs                           # Godot 着色器翻译/编译检查
CHROME=<headless shell 路径> node tools/e2e/audio.mjs                             # 音效事件 → 采样解析检查
CHANNEL=chrome GPU=1 node tools/e2e/perf.mjs /tmp/perf                           # 性能测量（系统 Chrome + GPU）
```

## 从游戏包重新生成

只有在更新游戏版本或修改提取、转译工具时才需要。前提：macOS，已安装 `/Applications/SlayTheSpire2.app`。

```bash
# 1. 工具链
brew install ffmpeg vgmstream uv
curl -sSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 9.0 --install-dir ~/.dotnet
~/.dotnet/dotnet tool install --global ilspycmd
uv venv tools/.venv && uv pip install --python tools/.venv/bin/python pillow fonttools brotli zstandard

# 2. 从游戏包提取资源与参考文件（约 3 分钟）→ assets/、ref/godot、ref/dotnet
tools/.venv/bin/python tools/extract.py
tools/.venv/bin/python tools/audio.py              # FMOD → Opus + 事件数据 assets/audio/events.json（约 5 分钟）
tools/.venv/bin/python tools/audio_index.py

# 3. 反编译 sts2.dll 与 SmartFormat.dll → ref/decompiled、ref/smartformat
tools/decompile.sh

# 4. 生成索引与场景
tools/.venv/bin/python tools/spine_index.py
tools/.venv/bin/python tools/scenes.py

# 5. 转译规则层 → packages/core/src/gen
pnpm gen
```
