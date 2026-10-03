<div align="center">

# sts2-web

**在浏览器里运行的《Slay the Spire 2》**

把原作（v0.98.3）的规则代码机械转译成 TypeScript，再用 Preact + Pixi 重建表现层。
没有后端，纯静态页面，打开就能玩。

[截图](#截图) · [特性](#特性) · [本地运行](#本地运行) · [部署文档](docs/deployment.md) · [开发文档](docs/development.md) · [设计文档](docs/sts2-web-port-plan.md)

<img src="docs/screenshots/menu.jpg" alt="主菜单" width="860">

</div>

> [!IMPORTANT]
> 这是一个非官方的学习项目，仅供学习使用，与 Mega Crit 无关。
> 《Slay the Spire 2》及其美术、音频、文本的版权归 Mega Crit 所有。喜欢这个游戏请[购买正版](https://store.steampowered.com/app/2868840/Slay_the_Spire_2/)。

## 截图

| | |
|:---:|:---:|
| <img src="docs/screenshots/character-select.jpg" alt="角色选择"><br>角色选择 | <img src="docs/screenshots/map.jpg" alt="地图"><br>地图 |
| <img src="docs/screenshots/combat.jpg" alt="战斗"><br>战斗 | <img src="docs/screenshots/boss.jpg" alt="Boss 战"><br>Boss 战 |
| <img src="docs/screenshots/event.jpg" alt="事件"><br>事件 | <img src="docs/screenshots/shop.jpg" alt="商店"><br>商店 |
| <img src="docs/screenshots/upgrade.jpg" alt="升级卡牌"><br>休息处升级卡牌 | <img src="docs/screenshots/treasure.jpg" alt="宝箱"><br>宝箱 |

## 特性

- **规则与原作一致**：规则层不是手工重写，而是由反编译的 C# 经 Roslyn 转译器整体生成（约 14.6 万行 TypeScript），卡牌、遗物、能力、怪物、事件的结算逻辑都来自原作代码。
- **完整的单人流程**：五个角色、地图、战斗、事件、商店、休息处、宝箱、Boss，以及每日挑战和自定义模式。
- **菜单侧界面**：图鉴（卡牌库、遗物、药水）、时间线、统计、历史记录、存档档位、设置。
- **原作的表现**：Spine 骨骼动画、Godot 场景与粒子、着色器、战斗特效都在 Web 上重建；FMOD 音频转成 Opus 后由自己的事件引擎播放。
- **14 种语言**：沿用原作的本地化文本，默认跟随设备语言，可在设置里切换。
- **本地存档**：存档保存在浏览器的 IndexedDB，支持保存并退出后继续。
- **可离线**：Service Worker 缓存访问过的资源，可作为 PWA 安装。

暂不支持：多人联机、Mod、Steam 集成、手柄。

## 本地运行

需要 Node 20+ 和 pnpm，不需要安装游戏。

```bash
git clone https://github.com/moonrailgun/sts2-web.git
cd sts2-web
pnpm install
pnpm dev        # http://127.0.0.1:47173/
```

构建、测试、页面参数、工作原理以及如何从游戏包重新生成资源，见[开发文档](docs/development.md)。

## 部署

Docker、Docker Hub 镜像发布和 Cloudflare Workers 的部署步骤见[部署文档](docs/deployment.md)。

## 声明

本项目仅供学习使用，不得用于商业用途。仓库中的游戏资源（`assets/`）和转译生成的规则层（`packages/core/src/gen/`）来自《Slay the Spire 2》，版权归 Mega Crit 所有；如权利人认为不妥，请提 issue，会及时处理。
