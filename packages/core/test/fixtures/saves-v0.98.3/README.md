# 旧存档样本（游戏 v0.98.3 的网页版）

线上玩家浏览器里的存档长什么样，这里就是什么样：每个目录是某一时刻 `user://` 下的全部文件，原样拷出，没有改过。
`test/old-saves.test.ts` 用它们验证"旧存档还能读、读出来不丢东西、进行中的对局能继续"。

**不要修改、不要重新生成这些文件。** 它们代表已经存在于玩家浏览器里的数据；以后存档格式变了，应该新增一个目录放新版本的样本，这个目录原样保留。

## 内容

| 目录 | 来源 |
|---|---|
| `ironclad-new-profile/` | 全新档案（不带 `unlock=all`）的铁甲战士整局：`fresh` 首次进主菜单，`f6` / `f25` / `f41` 三幕各一次"保存并退出"之后，`postrun` 通关回到主菜单之后 |
| `silent/` `regent/` `necrobinder/` `defect/` | 其余四个角色（`unlock=all` 的档案）：`f25` 第二幕"保存并退出"之后，`postrun` 整局结束回到主菜单之后 |

每个时间点有一个同名的 `.json`，记录导出时浏览器从这些文件读到的值（文件数、楼层、生命、金币、牌组和遗物数量、对局历史条数），测试拿它和无头环境读出来的结果对照。

`enums.json` 是这一版里存档用到的枚举的"成员名 → 编号"表（`node tools/save-enums.mjs` 生成，需要 `ref/decompiled`）。存档里的枚举存的是编号，新版本里某个成员换了编号，旧存档的含义就悄悄变了；测试拿这张表和当前规则层对照。

## 生成方式

提交 `ff422ee` 的构建产物（`vite build` + `vite preview`），真实界面自动游玩，`DUMP` 开关见 `tools/e2e/play.mjs` 文件头：

```bash
UNLOCK=0 GOD=2 FULL=1 SEED=E2EFINAL DUMP=<目录>/ironclad-new-profile node tools/e2e/play.mjs <输出> 12000
CHAR=2 GOD=2 SAVEQUIT=25 POSTRUN=1 SAVECHECK=1 POTIONS=1 SEED=OLDSAVE2 DUMP=<目录>/silent node tools/e2e/play.mjs <输出> 12000
# CHAR=3 regent（SEED=OLDSAVE3B）、CHAR=4 necrobinder（OLDSAVE4B）、CHAR=5 defect（OLDSAVE5）同上
```

五局都通关（`postrun.json` 里 `result` 是 `WIN`）。`GOD=2` 只改生命值（玩家回满、敌人剩 1 点），不影响存档的结构。
`unlock=all` 的四个档案在 `fresh` 时刻的导出没有收进来：那是开发参数造出来的状态，玩家不会有。
