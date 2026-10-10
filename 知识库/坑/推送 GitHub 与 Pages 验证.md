# 推送 GitHub 与 Pages 验证

**症状**：`git push` 直连 `github.com` 必失败——主站 443 被重置，`curl` 拿到 rc=56、0 字节。**别被骗**：`api.github.com` 和 `codeload.github.com` 都通，但 push 走的是主站，那两个通不代表推得动。

**原因**：本机网络环境下 github.com 主站要经本地代理（Clash 默认混合端口 127.0.0.1:7897）才通。

**规矩**：

- 走**一次性参数**、`-c` 必须写在子命令**之前**：
  `git -c http.proxy=http://127.0.0.1:7897 push origin main`
  （写在 push 后面会被当成 push 自己的选项，只打印用法、什么都不做。）
- 代理**不一定开着**（实测过 7897 无监听、无代理进程、系统代理关闭——注册表里仍写着 127.0.0.1:7897，别被它骗）。这时直连也是 reset，**只有让用户手动把代理客户端打开**这一条路；轮询 `netstat -ano | grep LISTENING | grep :7897` 等端口起来再推。
- **别去改系统代理或全局 git config 来"绕过"**（会污染其他仓库和将来的排查）。
- **推成功但线上 Pages 没更新**时按这个顺序排查（注意：这几条查询都该走直连，代理反而不通）：①先抓线上页面找特征词（新版会出现「五子魔方」，注意看 `rc` 和字节数完整——代理会静默截断，见 [[坑/curl 抓大文件看退出码]]）；②查 Actions runs 的 `status` / `conclusion`；③查 githubstatus.com 的 Actions 组件——真赶上它"性能降级"就等它恢复，本地一个字不用改。线上是 push main 触发重建的（工作流在 `.github/workflows/pages.yml`），发布物就是仓库里那份 `index.html`，服务器上不留副本。

**出处**：2026-10-05 / 10-06 实测记录。
