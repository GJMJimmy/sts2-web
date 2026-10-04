# 存档云同步

把本机存档上传到一个同步服务器,或凭存档码从服务器恢复。这是网页版的自有功能(原版游戏没有),客户端与
[OnscripterShiki](https://github.com/GJMJimmy/OnscripterShiki) 的存档同步服务器使用同一协议,服务端通用。

## 协议

服务端只做不透明字节的中转,客户端自己序列化(sts2-web 上传一个 JSON 信封):

| 方法 | 路径 | 请求体 | 成功 | 失败 |
|---|---|---|---|---|
| GET | `/save/{存档码}` | — | 200,`application/octet-stream` 的存储字节 | 404 该存档码无存档 |
| POST | `/save/{存档码}` | 原始字节 | 200 `ok` | 400 存档码非法;413 超过大小上限 |

- 存档码规则:`^[\p{L}\p{N}_\-]{1,64}$/u`(1–64 个字母/数字/下划线/连字符,中文也算字母)。
- 所有响应带 `Access-Control-Allow-Origin: *` 等全开 CORS 头。
- 存档码就是唯一的身份凭证:知道码的任何人都可能下载这份存档,请用不易被猜中的字符串。
- sts2-web 的请求体格式:`{"version":1,"app":"sts2-web","files":{"user://default/1/profile.save":"<文件全文>",…}}`,
  覆盖 `user://` 下全部存档文件(profile / settings / prefs / progress / current_run / history 等,不含 `*.tmp`)。

## 客户端使用

主菜单右上角(版本号下方)或游戏内暂停菜单 → **存档云同步**。填服务器链接与存档码:

- **上传**:先把内存中的最新状态刷进存档(与关页时的保存一致),再打包上传,覆盖云端同码存档。
- **恢复**:确认后用云端副本**替换**本机全部存档文件(多余的本机文件会被删除,避免残留出假的"继续"),等写入
  落盘后自动刷新页面。刷新后会跳过一次关页保存,防止旧的内存状态盖回刚恢复的文件。
- 服务器链接与存档码记在 localStorage(`sts2web_sync_server` / `sts2web_sync_slot`),下次打开自动回填。

## 自备服务端

以下两种都可直接使用(详见 OnscripterShiki 仓库的同步服务文件):

- **纯 Python**(局域网/本机测试):`ons_shiki_sync_server.py`,标准库实现,`python3 ons_shiki_sync_server.py --port 8765`,
  存储为 `{目录}/{存档码}.zip`(文件内容与扩展名无关,sts2-web 的 JSON 信封同样可存),上限 64 MB。
- **Cloudflare Workers**:`sync-worker-r2/`(R2,强一致,64 MB,推荐)或 `sync-worker-kv/`(KV,免绑卡但 24 MB、
  最终一致约 60 秒、免费档每日 1000 次写入)。`wrangler deploy` 即可;在 `wrangler.toml` 里设置
  `SYNC_TOKEN` 后,所有路径需以 `/{SYNC_TOKEN}` 开头,客户端填的服务器链接带上这个前缀即可。

## 注意事项

- **混合内容**:页面是 https(如部署站点)时,浏览器禁止向 http 服务器发请求;`http://127.0.0.1` 除外
  (浏览器的本地回环豁免)。公网服务器请配置 https(Workers 自带)。
- 上传会覆盖云端同码存档(最后写入者胜),服务端没有历史版本;重要存档建议不同进度用不同存档码。
- 浏览器的存档按域名隔离:上传与恢复务必使用同一个访问地址。
