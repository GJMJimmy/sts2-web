# sts2-web

把本机安装的《Slay the Spire 2》（v0.98.3）移植到浏览器：规则层由反编译的 C# 经 Roslyn 转译器（`tools/cs2ts`）机械转成 TypeScript（`packages/core`），表现层是 Preact + Pixi（`packages/app`）。设计与进度见 `docs/sts2-web-port-plan.md`。

仅供个人私用。游戏资源、反编译代码和生成代码都来自你本机的正版游戏，已在 `.gitignore` 中排除，不要发布。

## 首次搭建（按顺序）

前提：macOS，已安装 `/Applications/SlayTheSpire2.app`，Node 20+ 与 pnpm。

```bash
# 1. 工具链
brew install ffmpeg vgmstream uv
curl -sSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 9.0 --install-dir ~/.dotnet
~/.dotnet/dotnet tool install --global ilspycmd
uv venv tools/.venv && uv pip install --python tools/.venv/bin/python pillow fonttools brotli zstandard
pnpm install

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

# 6. 运行
ln -sfn ../../../assets packages/app/public/assets   # 开发服务器从这里提供游戏资源
pnpm dev                                             # http://127.0.0.1:47173/（预览构建：pnpm build && pnpm -F @sts2/app preview → 47174）
```

## 常用命令

```bash
pnpm -F @sts2/core test     # 无头测试（约 2 分钟）
pnpm build                  # tsc + vite 构建，产物在 packages/app/dist
npx playwright install chromium-headless-shell
CHROME=<headless shell 路径> FAST=1 GOD=1 node tools/e2e/play.mjs /tmp/play   # 浏览器自动游玩
CHROME=<路径> UNLOCK=0 GOD=1 FULL=1 SEED=E2EFINAL node tools/e2e/play.mjs /tmp/full 12000   # 全新存档完整一局：药水、牌堆查看、每层读档检查、保存退出+刷新+继续、通关后时间线收尾
CHROME=<headless shell 路径> node tools/e2e/coverage.mjs /tmp/cov                 # 全部卡牌/药水/遭遇战/遗物/事件覆盖测试
CHANNEL=chrome GPU=1 node tools/e2e/perf.mjs /tmp/perf                           # 性能测量（系统 Chrome + GPU）
CHROME=<headless shell 路径> node tools/e2e/continue.mjs /tmp/cont                # 保存并退出 → 刷新 → 继续
CHROME=<headless shell 路径> node tools/e2e/screens.mjs /tmp/screens              # 菜单侧各界面与局内新界面截图
CHROME=<headless shell 路径> node tools/e2e/shaders.mjs                           # Godot 着色器翻译/编译检查
CHROME=<headless shell 路径> node tools/e2e/audio.mjs                             # 音效事件 → 采样解析检查
```

页面参数：`?seed=<种子>`、`?lang=zhs`、`?unlock=all`（原版控制台的 unlock all：全部发现、纪元揭示、进阶 10）、
`?tutorials=off`（关闭新手提示）；开发服务器上 `?scene=scenes/rest_site/hive_rest_site.tscn` 全屏显示单个场景。

存档保存在浏览器的 IndexedDB（`sts2fs` 库）；旧版本存在 localStorage 的存档会在首次启动时自动迁移。
