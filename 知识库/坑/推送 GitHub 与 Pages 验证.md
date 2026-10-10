# 推送 GitHub 与 Pages 验证

**症状**：`git push` 到 `github.com` 直连必失败（`github.com:443` 连接重置；`curl` rc=56、收到 0 字节）。注意：`api.github.com` 和 `codeload.github.com` 是通的——**别拿后两者通就当网络没问题**，push 走的是 github.com 主站。

**原因**：本机网络环境下 github.com 主站要经本地代理（Clash 默认混合端口 127.0.0.1:7897）才通。

**规矩**：

- 走**一次性参数**、`-c` 必须写在子命令**之前**：
  `git -c http.proxy=http://127.0.0.1:7897 push origin main`
  （写在 push 后面会被当成 push 自己的选项，只打印用法、什么都不做。）
- 代理**不一定开着**（实测过 7897 无监听、无代理进程、系统代理关闭——注册表里仍写着 127.0.0.1:7897，别被它骗）。这时直连也是 reset，**只有让用户手动把代理客户端打开**这一条路；轮询 `netstat -ano | grep LISTENING | grep :7897` 等端口起来再推。
- **别去改系统代理或全局 git config 来"绕过"**（会污染其他仓库和将来的排查）。
- **推成功但线上 Pages 没更新**时的查序（全走直连，这几条代理反而不通）：①抓线上页面比标记（新版有「五子魔方」，注意看 `rc` 和字节数完整——代理会静默截断，见 [[坑/curl 抓大文件看退出码]]）；②查 Actions runs 的 `status` / `conclusion`；③查 githubstatus.com 的 Actions 组件——当天就是它 `degraded_performance`，等恢复即可、本地什么都不用改。Pages 由 `.github/workflows/pages.yml` 在 push main 时自动重建，发布的就是 `index.html` 原件。

**出处**：2026-10-05 / 10-06 实测记录。
