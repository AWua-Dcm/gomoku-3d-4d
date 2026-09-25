# 网页版双人联机（公网）实现方法

目标：两个人在不同地方，各开一个浏览器，下同一局三维/四维五子棋。
前置约束：不引入任何 npm 依赖（沿用本工程一贯做法）。

---

## ⚠️ 修订记录：2026-09-25，§5.3 那版伪代码跑不通

**本文档初版的 §5.3 是照着写就一定会出事的。** 下面每一条都对着 `index.html` 的内核源码逐条验证过，
不是读着不对劲，是**确定会坏**。已就地修正，修正处标了 `【已修正】`。

### A 类：必然失败

| # | 初版错在哪 | 逐条验证的后果 |
|---|---|---|
| A1 | `if (!o.accepted)` 用在 `place()` 的返回值上 | `GameSession.place()`（`class GameSession` 内）返回的是 `RuleEngine.judge` 的结论对象 `{status, winner, longestRun, line, isOverlineFoul}`。**这个对象没有 `accepted` 字段** —— `accepted` 只是 `RotateOutcome` 的 getter。`!undefined === true` → **服务器拒绝 100% 的合法落子** |
| A2 | `s.rotate(axis, layer, dir, turns)` | `FourDSession.rotate(move)` **只收一个 `RotationMove` 对象**；四参数版叫 `rotateBy(axis, layer, direction, turns)`。按初版写，`move` 收到的是数字 `0`，`move.axis/layer/turns` 全 `undefined` → 转动永远不生效，且报错指不到真正的原因 |
| A3 | 对 `undo` 施加 `isTurn(room, seat)` 检查 | `GameSession.place()` 最后一行把 `currentPlayer` 翻给了对手。所以**刚落完子的人永远"没轮到"**，而轮到的那个是**对手**。按初版写，要么悔棋永远被拒，要么悔掉的是别人的棋 |
| A4 | `switch` 里没有 `restart` case | 掉进 `default` → 回一句「未知动作 restart」。重开功能整个失效 |
| A5 | 没有 try/catch | 内核有**两种**拒法：返回 `Rejected` **和直接抛异常**。`RotationMove.create()` 在 `turns` 不在 1..3 时抛、`layer` 为负时抛；`normalizeDims()` 对非法尺寸抛。一条 `{"t":"rotate","layer":-1}` 的 POST 就能**打死服务器进程** |

### B 类：能跑，但会静默出错

| # | 问题 | 后果 |
|---|---|---|
| B1 | 没有 `create` 消息 | §5.2 的 `newRoom()` **没有任何调用方**，房间建不出来 |
| B2 | 没有座位身份 | 刷新页面后要么进不来、要么**抢走对方的座位** |
| B3 | `rejected` 带 `seq` | 客户端的 `seq > lastSeq` 门禁会**静默丢弃**它 → 表现为「点了没反应也没提示」，两端都查不出原因 |
| B4 | `reset` 不进补发日志 | 掉线期间发生的重开，对重连者**永久不可见** |
| B5 | 上行没有幂等键 | 重复 POST 一次 `undo` 会**多悔一步**，且不报错 |
| B6 | `rules` 直接信任客户端 | `winLength: 0` 能让第一手就判胜 |
| B7 | 全篇没有分歧检测器 | §2.3 ② 自己说规则分叉「没有症状」，但没有任何手段把它变成有症状 —— 见 §5.3 的 `checksum` |
| B8 | §6.2 只列了 6 个提交点 | 实际有 **7 个**。漏掉的那个是 `swapFirst()`，它直接调 `session.reset` → 「本地空盘、服务器在第 200 手」，**不报错** |

### C 类：本文档内部的自相矛盾

| # | 问题 |
|---|---|
| C1 | §9 / §10 / §11 写的「`run-all.sh` 9 步」—— 实际是 **7 步**（C# 删除前才是 9 步）。做完联机变 **8 步** |
| C2 | §9 写的「浏览器检查 49 项」—— 实际是 **63 项** |
| C3 | §7.3 推荐「先做命令版悔棋」，但本项目已拍板走**请求-同意版**。§7.3 已按请求-同意版重写 |

> 本文档**刻意不写行号**（见 §12）。定位一律用函数名、类名或 `/* GOMOKU-CORE-BEGIN */` 这类标记 ——
> 修订时正是靠这一点才没被行号带偏。

---

## 0. 结论先行

```
   玩家 A 浏览器              服务器（一台有公网 IP 的机器）            玩家 B 浏览器
   ┌──────────┐   POST /action   ┌────────────────────┐   POST /action  ┌──────────┐
   │  index   │ ───────────────► │  跑同一份内核源码   │ ◄────────────── │  index   │
   │  .html   │                  │  它是唯一裁判       │                 │  .html   │
   │          │ ◄─────────────── │                    │ ──────────────► │          │
   └──────────┘   SSE /events    └────────────────────┘   SSE /events    └──────────┘
        │                              │                                        │
        └────── 各自本地跑同一个内核，只收「动作」，不收「状态」 ──────┘
```

一句话：**服务器跑一份和浏览器逐字节相同的内核当裁判，只转发"谁做了什么"，不转发"现在盘面长什么样"。**

全程的消息量：一局几百手 × 每条约 40 字节 ≈ **10KB**。

---

## 1. 三个前提，两个是坑

### 1.1 网页版现在没有服务器，联机之后必须有

现状是 `打开流程.md` 里写的「双击 `index.html`，不需要服务器、不需要联网」。

联机之后这条**必须作废**。原因有两个，都绕不过去：

1. `EventSource`（见 §3）不能跨域，`file://` 协议下更是直接不可用。
2. 你需要一个双方都能访问到的**公网地址**，浏览器自己提供不了。

所以打开方式从「双击文件」变成「访问一个网址」，而且 `index.html` 要由服务器托管（顺手就解决了跨域）。

### 1.2 先自测：你家宽带有没有公网 IP

**这一步不做，后面全白干。** 国内家用宽带大概率在运营商 NAT 后面（CGNAT），没有公网 IP，任何"让朋友连我家电脑"的方案都不成立。

自测方法：

1. 浏览器打开 <https://ip.sb>，记下显示的 IP，记为 `X`
2. 登录路由器管理页，找 WAN 口 / 外网 IP，记为 `Y`
3. 判断：

| 情况 | 结论 |
|---|---|
| `X ≠ Y` | 运营商 NAT，**没有公网 IP** |
| `Y` 以 `100.64.` 开头 | 确定是 CGNAT，**没有公网 IP** |
| `X = Y` 且是公网段 | 有公网 IP，但要继续看第 4 步 |

4. 即使有公网 IP，**国内家宽的 80/443 端口通常被封**，要用别的端口号（如 8080）。

> 我在这台机器上跑 `curl https://api.ipify.org` 没有拿到结果（沙箱里出不去网），所以这个判断只能你自己做。

### 1.3 好消息：服务器不用再写一份规则

这是整个方案成立的地基。

`index.html` 里被 `/* GOMOKU-CORE-BEGIN */` / `/* GOMOKU-CORE-END */` 夹住的那一段（搜这两个标记即可定位），
那段注释写死了：

> 这一段被 tests/rules.test.mjs 原样抽出来在 node 里跑，用 C# 导出的向量校验。
> 所以这里【不能】引用任何 DOM / WebGL / 浏览器 API。

而且 `FourDSession`（搜 `class FourDSession`）**也在区间内**。所以四维规则服务器照样能跑。

这意味着服务器加载内核只要 6 行代码，而且拿到的是**和浏览器逐字节同一份源码**（见 §5.1）。不会出现"第三份实现"，也就不会出现"C# 改了、网页版改了、服务器忘了改"这种分叉。

---

## 2. 架构：服务器权威 + 动作中继

### 2.1 为什么不是"房主权威"

"房主的浏览器当裁判，服务器只转发"也能work，而且服务器代码更少。但在**公网 + 和真人朋友下棋**这个场景下它有两个说不通的毛病：

- 房主关掉标签页 / 断网 / 笔记本合盖 → 整局结束，对方干瞪眼。家用电脑的可用性远低于一台云主机。
- 重连、悔棋仲裁、规则快照这些麻烦事全都要在客户端之间协商，比在服务器上做麻烦得多。

用服务器权威，这些全部消失：服务器进程活着，棋局就活着；谁掉线谁重连，另一边的棋局不受影响。

代价是服务器要跑内核 —— 而 §1.3 已经证明这个代价约等于零。

### 2.2 为什么传动作，不传状态

两种做法：

| | 传状态 | 传动作（本方案） |
|---|---|---|
| 发什么 | "现在盘面上有 37 颗子，位置分别是…" | "黑棋落在 (3,4,5)" |
| 消息大小 | 几百字节～几 KB，随棋局增长 | 固定 ~40 字节 |
| 两份真相？ | 是。客户端和服务器的盘面可能不一致，且**不一致了没人知道** | 否。只有服务器有真相，客户端是重放出来的 |
| 重连 | 传一次全盘 | 重放动作序列（见 §8） |

关键在于**五子棋是完备信息 + 回合制 + 确定性的**：给定规则和动作序列，盘面只有一种可能。所以动作序列本身就等价于盘面，传状态是多余的。

（这也是为什么 Netcode for GameObjects / Mirror / Photon 在这里是净损失：它们为"每秒几十次位置广播、需要插值和外推"的实时游戏设计，解决的问题你没有。）

### 2.3 四条必须遵守的规则

违反任何一条都会产生那种"偶尔对不上、重开又好了"的玄学 bug。

**① 每条动作带 `seq`，单调递增，客户端只接受 `seq > lastSeq`。**

作用有两个：网络重发导致的重复投递无害（幂等）；SSE 断线重连时可以要求"从 seq N 之后补发"。

**② 规则快照在开局时同步一次，之后不变。**

`RuleSet` 里任何一个字段（`winLength` / `overlineLoses` / `allowRotation` / `rotationCooldownPlacements` …）两边不一致，内核就会**静默分叉** —— 不报错，只是一个回合之后两个盘面长得不一样。这是本方案里最危险的一类 bug，因为它没有症状。

修法很简单：开局参数由服务器**广播**一次（§4.3 的 `state` 消息），客户端收到后调 `session.reset(dims, first, rules)`。客户端自己的设置页在联机模式下只影响"建房请求"，不直接影响本地 session。

**③ 客户端不预判（不做本地即时执行）。**

玩家点一下 → 发出去 → 等服务器回 `applied` → 才真的落子。公网延迟 50–200ms，回合制游戏完全无感。

如果为了手感做本地预判，就必须写"收到 `rejected` 时回滚"的逻辑 —— 而回滚是本方案里唯一会引入"两份真相"的地方。**别写。** 想改善手感就在本地画一个半透明的"待确认"棋子，不改 session。

**④ 服务器不信任客户端的任何输入。**

坐标、层号、转动参数全部由服务器跑内核来校验。客户端说"我落在 (999,999,999)"，服务器回 `rejected` 就完事。内核里已经有完整的越界/占位/冷却校验（`GameSession.place` 和 `FourDSession.rotate`），直接复用。

---

## 3. 传输层：SSE + POST，不装任何东西

### 3.1 为什么不用 WebSocket

本机 Node 是 **v24.19.0**，内置 `http` 里**没有 WebSocket 服务端**。要 WebSocket 只有两条路：

- 手写 RFC 6455：握手、掩码、分片、关闭帧，约 200 行，坑不少
- `npm i ws`：只有 1 个依赖，但工程里目前**一个 `node_modules` 都没有**，这是刻意的

而这是一个**回合制**游戏，对延迟的容忍度是几百毫秒级，用 WebSocket 换来的那点延迟优势看不到。所以：

**上行用 POST（普通 `fetch`），下行用 SSE（`EventSource`）。**

### 3.2 EventSource 白送的三个特性

这三个正好砸在联机的痛点上：

| 特性 | 白送了什么 |
|---|---|
| **自动重连** | 连接一断，浏览器自己每隔几秒重试，不用写一行重连代码 |
| **`Last-Event-ID` 请求头** | 重连时浏览器自动带上"我收到的最后一条事件编号"。服务器据此补发缺失的事件 —— 断线续传不用自己设计 |
| **单行 JSON 分帧** | SSE 的 `data:` 行天然是一行一条，和 §4.1 的文本行协议完全对齐 |

### 3.3 SSE 的三个坑（都要处理）

1. **代理缓冲**：某些反向代理会攒够一批才发。加响应头 `X-Accel-Buffering: no` 和 `Cache-Control: no-cache, no-transform`。
2. **HTTP/1.1 同域连接数上限 6**：SSE 长连接会占掉一个。单页面应用无所谓，但别开第二个 SSE 连接。
3. **心跳**：中间设备会掐掉长时间没数据的连接。每 20–30 秒发一条注释行 `: ping\n\n` 保活（注释行会被 `EventSource` 忽略）。

---

## 4. 协议

### 4.1 为什么用文本行协议（每行一个 JSON）

因为**调试期能直接用眼睛看、用手打**：

```bash
curl -N "http://localhost:8080/events?room=482913"     # 看服务器推下来的所有消息
curl -X POST localhost:8080/action -d '{"t":"place","x":3,"y":4,"z":5}'
```

二进制协议省的那几十个字节，在这里一文不值。

### 4.2 上行（客户端 → 服务器，`POST /action`）【已修正】

| `t` | 字段 | 说明 |
|---|---|---|
| `create` | `name`, `dims`, `mode`, `first`, `rules`, `coreHash` | **建房（B1）**。回 `joined` + `state`。房间号由**服务器**生成，不信客户端 |
| `join` | `room`, `name`, `token?`, `coreHash` | 加入房间。带 `token` = **重连回原座位（B2）** |
| `start` | `id` | **房主开局**，全屋只认第一条。`dims`/`mode`/`first`/`rules` 在 `create` 时就定了，这里只是「我准备好了」 |
| `place` | `id`, `x`, `y`, `z` | 落子 |
| `rotate` | `id`, `axis`, `layer`, `dir`, `turns` | 转层（四维） |
| `undoReq` | `reqId` | **发起**悔棋请求（请求-同意版，见 §7.3） |
| `undoAnswer` | `reqId`, `accept` | 应答对方的悔棋请求 |
| `undoCancel` | `reqId` | 撤回自己还没被应答的请求 |
| `restoreRotation` | `id` | 撤销本次转动 |
| `restart` | `id` | 重开（**A4：初版连这个 case 都没有**） |
| `resync` | `since` | 请求从 `since` 之后补发。正常走 `Last-Event-ID`，这条是兜底 |

**`id` 是上行幂等键（B5）。** 客户端为每个**会改变状态**的动作生成一个随机 `id`
（`crypto.randomUUID()` 即可，只要同一个动作重发时 `id` 不变）。服务器按座位记住最近 N 个 `id`，
**重复的直接回上一次的结果，不重新执行**。没有这个，一次超时重发就会多悔一步棋 —— 而且不报错。

**`reqId` 是悔棋握手的键，和 `id` 分开命名。** 握手消息（`undoReq`/`undoAnswer`/`undoCancel`）
本身不改棋局状态，所以不走幂等表，走的是"每个房间同时最多一个未决请求"这条更简单的约束。

`dims` 是 `[nx, ny, nz]`（三维可以是长方体，四维必须立方）；`mode` 是 `"3d"` / `"4d"`；
`rules` 是 `RuleSet` 的字段快照 —— **服务器按白名单过滤并夹取，不直接采信（B6）**，见 §5.3。

`coreHash` 是客户端算出的内核源码哈希（见 §11）：对不上就拒绝开局。

### 4.3 下行（服务器 → 客户端，`GET /events?room=...&token=...`）【已修正】

| `t` | 字段 | 说明 |
|---|---|---|
| `joined` | `seat`, `room`, `token` | 发给自己：你执黑还是执白，外加**重连凭证（B2）** |
| `peer` | `name`, `joined` | 对手进来/离开了 |
| `state` | `seq`, `dims`, `mode`, `first`, `rules` | **规则快照**，见 §2.3 ② |
| `sync` | `seq`, `dims`, `mode`, `first`, `rules`, `moveCount`, `pending` | **每次 SSE 连接都发一条全新的**（B2/B4） |
| `applied` | `seq`, `by`, `action`, `checksum` | 权威事实：某动作已生效。**带校验和（B7）** |
| `rejected` | `reason` | 你的动作没通过校验。**绝不带 `seq`（B3）** |
| `undoAsked` | `reqId`, `by` | 有人请求悔棋 |
| `undoResolved` | `reqId`, `accept`, `reason?` | 悔棋请求有结果了：同意 / 拒绝 / 超时 / 被新动作取消 |
| `reset` | `seq`, `dims`, `mode`, `first`, `rules` | 重开，客户端整体重建。**必须是有 `seq`、可补发的事件（B4）** |
| `error` | `reason` | 房间满 / 房间不存在 / 版本不一致等 |

**`sync` 和 `state` 的区别（这两个最容易混）：**

- `state` = **规则快照**，是**棋局事件**，**要进**补发日志 —— 重连的人靠它才知道 `dims`/`rules`，否则 `session` 根本建不出来
- `sync` = **连接握手**，是**连接事件**，**不进**补发日志 —— 每次连接都现场新生成一条，进了补发日志反而会互相污染

**`rejected` / `joined` / `peer` / `error` 同样不进补发日志** —— 它们只对"此刻正在线的那个连接"有意义，
补发给一个重连的人只会让他看到一堆和自己无关的旧拒绝。

**判断标准（一句话）**：**重放这条事件会不会让客户端的 `session` 变化？** 会，就进补发日志；不会，就不进。

### 4.4 `dir` 的取值

`RotationDirection.Clockwise = 0`、`CounterClockwise = 1`（搜内核区间里的 `const RotationDirection`）。协议里直接传这个整数，**不要传 `"cw"` 之类自己发明的字符串** —— 那会多出一份需要同步的映射表。

同理 `axis` 用 `AXIS_X=0 / AXIS_Y=1 / AXIS_Z=2`，`seat` / `first` 用 `EMPTY=0 / BLACK=1 / WHITE=2`。

**通用原则：协议里的枚举值一律复用内核里已有的数值，不新造。**

---

## 5. 服务器端

新增文件：`Web_Gomoku3D/server.js`，只用 `node:http` / `node:fs` / `node:path`。

### 5.1 加载内核（这是全篇最关键的一段）【已修正】

```js
import fs from "node:fs";
import crypto from "node:crypto";

export const HTML = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");

// 【第一步：先取 <script> 块】——不是直接切 HTML。
// 这一点必须和 tests/rules.test.mjs 的抽法逐字一致（那里也是 indexOf("<script>")
// 配 lastIndexOf("</script>")，取最外层那一块），否则服务器跑的规则可能和测试验过的不是同一段。
const scriptStart = HTML.indexOf("<script>");
const scriptEnd   = HTML.lastIndexOf("</script>");
if (scriptStart < 0 || scriptEnd <= scriptStart) throw new Error("index.html 里找不到 <script> 块");
const fullScript = HTML.slice(scriptStart + "<script>".length, scriptEnd);

// 【第二步：在块内切标记】
const BEGIN = "/* GOMOKU-CORE-BEGIN */";
const END   = "/* GOMOKU-CORE-END */";
const bi = fullScript.indexOf(BEGIN), ei = fullScript.indexOf(END);
if (bi < 0 || ei < 0 || ei <= bi) throw new Error("index.html 里找不到 GOMOKU-CORE 标记区间");

// 【第三步：断言标记唯一】——否则哪天有人复制粘贴出第二个标记，
// indexOf 会静默选中前面那个，服务器就和浏览器跑的不是同一段规则了。
// 这是"两种真相"的入口，必须在这里堵死。
if (fullScript.indexOf(BEGIN, bi + BEGIN.length) >= 0 ||
    fullScript.indexOf(END,   ei + END.length)   >= 0) {
  throw new Error("GOMOKU-CORE 标记出现了不止一次 —— indexOf 会静默选错那一段");
}

const CORE_SOURCE = fullScript.slice(bi + BEGIN.length, ei);

/**
 * 内核源码的哈希。用途见 §11：客户端连上时报自己的，两边对不上就拒绝开局。
 * 钉的是**规则本身**，所以哈希的是 CORE_SOURCE 而不是整个 index.html ——
 * 改界面配色不该导致开不了局，改判胜逻辑必须导致开不了局。
 */
export const CORE_HASH = crypto.createHash("sha256").update(CORE_SOURCE).digest("hex").slice(0, 16);

// 【导出清单只列服务器真正要用的，但必须完整】
// 漏一个名字 → new Function 执行时立刻 ReferenceError，是**加载期**错误而不是运行期错误。
// 这是好事：宁可在启动时炸，不要在下棋中途炸。
// 清单里每一个名字都在 §5.3 有出处，没有"以后可能用得上"这种占位。
const Core = new Function(CORE_SOURCE + `
  return { FourDSession, RuleSet, RestrictionTarget,
           BoardLimits, normalizeDims,
           RotationDirection, MoveStatus, RotateStatus,
           AXIS_X, AXIS_Y, AXIS_Z, BLACK, WHITE, EMPTY,
           opponentOf, cnOf };`)();

const { FourDSession, RuleSet, RestrictionTarget,
        BoardLimits, normalizeDims,
        RotationDirection, MoveStatus, RotateStatus,
        AXIS_X, AXIS_Y, AXIS_Z, BLACK, WHITE, EMPTY,
        opponentOf, cnOf } = Core;
```

（`GameSession` / `Board3D` / `RuleEngine` 不在清单里：服务器一律通过 `FourDSession` 说话。
这正是 §5.2 说的"少一条分支就少一个 bug"—— 服务器只有一条会话路径。）

**§5.1 初版缺的三个导出（已补）**：`BoardLimits` / `normalizeDims`（§5.3 夹取尺寸要用）、
`AXIS_X/Y/Z`（协议里要校验 `axis` 的取值，不能只信客户端给个 0/1/2 以外的数）。

**为什么不能把约束留给客户端**：服务器是唯一裁判，它必须自己能从内核里拿到"合法范围是多少"。
从别处抄一份 8/50 过来，就又多了一份需要同步的常量。

### 5.2 房间模型【已修正】

```js
const rooms = new Map();   // roomId -> Room

function newRoom(id, hostSeat) {
  return {
    id,
    host: hostSeat,                 // 【B1】谁建的房。只有他能 start / restart
    session: null,                  // 开局后才有：FourDSession 实例（三维下是透明壳）
    dims: null, mode: null, first: null, rules: null, started: false,

    // seat(BLACK/WHITE) -> { name, token, res }
    // 【B2】token 是重连凭证：刷新页面后带着它回来 = 坐回原位；
    // 不带 token 就只能是"新来的"，位子满了就进不来。没有这一条，刷新的人
    // 要么进不来，要么（更糟）把对方挤掉、自己坐上对方的位子 —— 而且两边都不报错。
    seats: { [BLACK]: null, [WHITE]: null },

    events: [],                     // 补发日志。**只放 state / applied / reset**
    seq: 0,
    pending: null,                  // 未决的悔棋请求，见 §7.3
    seenIds: { [BLACK]: new Map(), [WHITE]: new Map() },   // 【B5】幂等表
    lastActivity: Date.now(),
  };
}
```

**补发日志只放三类事件**（`state` / `applied` / `reset`），判断标准见 §4.3。
`joined` / `peer` / `sync` / `rejected` / `undoAsked` / `undoResolved` / `error` **都不进**。

**统一用 `FourDSession` 包一层**，三维模式也不特殊处理 —— 和 `index.html` 里 `startSession`
那处的做法一致（"三维模式下它是个透明的转发壳"）。少一条分支就少一个 bug。

---

### 5.3 处理动作（**初版这一段整个跑不通，已重写**）

A1–A5 五个致命错误全部集中在这一段。重写成三层：**幂等闸门 → 分派 → 各动作自己的守卫**。

#### 5.3.1 闸门

```js
/**
 * 唯一的动作入口。**所有对 session 的调用都在这里，别处不许有。**
 * 返回 { ok: true, events: [...] } 或 { ok: false, reason: "..." }
 */
function applyAction(room, seat, msg) {
  // 【B5】幂等闸门：同一个 id 重复投递 → 回上一次的结果，不重新执行。
  // 没有这一层，一次超时重发就会多悔一步棋，而且不报错。
  if (msg.id) {
    const memo = room.seenIds[seat];
    if (memo.has(msg.id)) return memo.get(msg.id);
  }

  // 【A5】内核有**两种**拒法：返回 Rejected **和直接抛异常**。
  // 这一层 try 不是"防御性编程"，它是唯一挡住"一条 POST 打死服务器进程"的东西。
  //   RotationMove.create() 在 turns 不在 1..3 时抛、layer 为负时抛
  //   normalizeDims() 对非法尺寸抛
  //   GameSession 构造函数对 firstPlayer 不是黑白时抛
  let result;
  try {
    result = dispatch(room, seat, msg);
  } catch (e) {
    // 对客户端是"你这步不合法"，对服务器是"我记下了，但进程还活着"。
    result = { ok: false, reason: "内核拒绝了这个动作：" + (e && e.message) };
  }

  if (msg.id) {
    const memo = room.seenIds[seat];
    memo.set(msg.id, result);
    // FIFO 淘汰。64 条远大于"一个动作重发几次"的需要，又不会无界增长。
    if (memo.size > 64) memo.delete(memo.keys().next().value);
  }
  return result;
}
```

> **幂等表为什么按座位分开**：`id` 是客户端生成的随机串，撞的概率本来就极低。按座位分开是为了让
> "对方能不能拿我的 id 去探测我下过什么"这个问题**根本不存在**。多一个维度，少一类问题。

#### 5.3.2 分派：**把 `isTurn` 从全局位置上拿掉**

```js
function dispatch(room, seat, msg) {
  if (!room.session) return { ok: false, reason: "还没开局" };
  switch (msg.t) {
    case "place":           return doPlace(room, seat, msg);
    case "rotate":          return doRotate(room, seat, msg);
    case "restoreRotation": return doRestoreRotation(room, seat, msg);
    case "restart":         return doRestart(room, seat, msg);   // 【A4】初版没有这个 case
    default:                return { ok: false, reason: "未知动作 " + msg.t };
  }
}
```

**【A3】"轮到谁"不能再当全局前置条件。** 初版把它放在所有动作前面，于是：

- `GameSession.place()` 成功后的最后一步是 `currentPlayer = opponentOf(player)` ——
  **刚落完子的人立刻就"没轮到"了**
- 所以「悔棋的人」永远过不了这道闸门；**能过闸门的是对手**，他会悔掉别人的棋
- `restart` / `restoreRotation` 的合法性和"现在轮到谁"本来就无关

正确做法：**只有 `place` 和 `rotate` 需要查 `currentPlayer`，而且在各自的处理函数里查。**

#### 5.3.3 落子

```js
/** 落子。**只有这个动作需要"轮到你"检查。** */
function doPlace(room, seat, msg) {
  const s = room.session;
  if (s.status !== "Playing") return { ok: false, reason: "棋局已结束，请先悔棋或重开" };
  if (s.currentPlayer !== seat) return { ok: false, reason: "还没轮到你" };

  const o = s.place(msg.x, msg.y, msg.z);

  // 【A1】GameSession.place() 返回的是 RuleEngine.judge 的结论对象
  //   { status, winner, longestRun, line, isOverlineFoul }
  // ——**这个对象没有 accepted 字段。**
  // `accepted` 只存在于 RotateOutcome（转动专用的结果对象），那是另一个类。
  // 初版写的是 `if (!o.accepted)` → `!undefined === true` → **每一次合法落子都被拒**，
  // 服务器直接变成一台只会说"动作无效"的机器。
  // 判断"成没成"唯一正确的办法是看 status。
  if (o.status === MoveStatus.Rejected) return { ok: false, reason: o.reason };

  return commit(room, seat, msg);
}
```

#### 5.3.4 转层

```js
/** 转层。四维才有。参数一律先过白名单，再允许进内核。 */
function doRotate(room, seat, msg) {
  const s = room.session;
  if (s.status !== "Playing") return { ok: false, reason: "棋局已结束" };
  if (s.currentPlayer !== seat) return { ok: false, reason: "还没轮到你" };
  if (!s.rotationEnabled) return { ok: false, reason: "当前不是四维模式" };

  // --- 白名单：不要让任意数字进内核 ---
  const axis = msg.axis, dir = msg.dir, layer = msg.layer, turns = msg.turns;
  if (axis !== AXIS_X && axis !== AXIS_Y && axis !== AXIS_Z) {
    return { ok: false, reason: "轴必须是 0/1/2" };
  }
  if (dir !== RotationDirection.Clockwise && dir !== RotationDirection.CounterClockwise) {
    return { ok: false, reason: "方向必须是 0/1" };
  }
  // 【A5】下面两条**不是**在重复内核的校验，它们是**把一个会抛异常的输入挡在 try 外面**，
  // 顺便给玩家一句能读懂的话 —— 而不是"内核拒绝了这个动作：层号不能为负：-1"。
  if (!Number.isInteger(layer) || layer < 0) return { ok: false, reason: "层号必须是非负整数" };
  if (!Number.isInteger(turns) || turns < 1 || turns > 3) {
    return { ok: false, reason: "转动次数必须是 1..3（4 次等于不动）" };
  }

  // 【A2】四参数版叫 rotateBy。
  //   rotate(move) 只收一个 RotationMove 对象；rotateBy(axis, layer, direction, turns) 才是四参数。
  // 按初版写 s.rotate(axis, layer, dir, turns)，move 收到的是数字 0，
  // move.axis / move.layer / move.turns 全是 undefined → **转动永远不生效**。
  const o = s.rotateBy(axis, layer, dir, turns);

  // RotateOutcome **确实**有 accepted getter（它和落子的结论对象是两个不同的类）。
  // 四种结果里只有 Rotated 会改变棋盘和回合，其余三种原样报给玩家 —— 它们的共同语义
  // 就是"棋盘和回合都没动"。
  if (!o.accepted) return { ok: false, reason: o.reason || o.describe() };

  return commit(room, seat, msg);
}
```

#### 5.3.5 撤销本次转动

```js
/** 撤销本次转动。合法性看的是**所有权**（自己转的自己撤），和"轮到谁"无关。 */
function doRestoreRotation(room, seat, msg) {
  const s = room.session;
  const last = s.rotations[s.rotations.length - 1];

  // 和 canUndoLastRotation 同一条判断：转动恰好插在"第 placementsBefore 手"之后，
  // 所以 placementsBefore === 当前落子数 ⟺ 它就是最后一步（后面没人落过子）。
  if (!last || last.placementsBefore !== s.moveCount) {
    return { ok: false, reason: "最后一步不是转动，没法恢复" };
  }
  if (last.player !== seat) return { ok: false, reason: "只能撤销自己做的转动" };

  if (!s.undoLastRotation()) return { ok: false, reason: "最后一步不是转动，没法恢复" };
  return commit(room, seat, msg);
}
```

#### 5.3.6 重开

```js
/** 重开。房主独有。 */
function doRestart(room, seat, msg) {
  if (seat !== room.host) return { ok: false, reason: "只有房主能重开" };

  const events = [];
  const cancelEv = cancelPending(room, "房主重开了");
  if (cancelEv) events.push(cancelEv);

  room.session.restart();   // 触发 onReset → 转动记录跟着清空（见 §7.4）

  // 【B4】reset 必须是一个**有 seq、进补发日志**的事件。
  // 否则掉线期间发生的重开对重连者永久不可见 —— 他会继续在旧盘面上落子，
  // 而且之后每一条 applied 都能"成功"，两边再也对不上。
  room.seq++;
  const ev = {
    t: "reset", seq: room.seq,
    dims: room.dims.slice(), mode: room.mode, first: room.first,
    rules: snapshotRules(room.rules),
  };
  room.events.push(ev);
  events.push(ev);
  return { ok: true, events: events };
}
```

#### 5.3.7 汇合点：`commit` 与校验和

```js
/**
 * 一个动作已经在内核里真的生效了 —— 记序号、算校验和、进补发日志。
 * **所有会改变棋局的动作最后都汇到这里**，所以"忘记广播"在结构上不可能发生。
 */
function commit(room, seat, action) {
  const events = [];

  // 【关键】任何被接受的落子/转动，**必须先取消未决的悔棋请求，再应用**。
  // 这不是妥协，是正确性要求：targetSeq 变了之后，那个 undo 撤销的会是**另一步棋**。
  const cancelEv = cancelPending(room, "对方下了新的一手，请求已作废");
  if (cancelEv) events.push(cancelEv);

  room.seq++;
  const ev = {
    t: "applied", seq: room.seq, by: seat, action: action,
    // 【B7】盘面指纹。§2.3 ② 自己说"规则分叉没有症状"，
    // 这一行就是把它变成有症状的唯一手段。客户端算一遍，对不上就 resync。
    checksum: fingerprint(room.session),
  };
  room.events.push(ev);
  events.push(ev);
  return { ok: true, events: events };
}
```

> #### ⚠️ 指纹函数**必须**放在内核区间里，不能在这儿现写一个
>
> 这是修订过程中发现的一个陷阱：**服务器和客户端各写一份哈希实现，那本身就是一处会分叉的地方** ——
> 用来自查分叉的机制自己分叉了，而且这次连"没有症状"都算不上，它会**天天误报**，
> 最后被人当成噪音关掉。
>
> 所以 `fingerprint(session)` 写进 `/* GOMOKU-CORE-BEGIN */` … `/* GOMOKU-CORE-END */` 那一区，
> **服务器和浏览器共用同一个函数体**。有三件事因此免费成立：
>
> 1. 算法只有一份，改不岔
> 2. 它是纯 JS（FNV-1a 之类的整数哈希即可，**不用 `node:crypto` 也不用 `crypto.subtle`**）——
>    后者是异步的，会把整条重放链染成 async，得不偿失。这里只需要检测分叉，不需要抗碰撞
> 3. **它自己被 `CORE_HASH` 覆盖** —— 两边连"哈希算法是否一致"都由握手保证，形成闭环
>
> 覆盖范围：**整盘每一格 + 出子权 + 落子数 + 转动数 + 状态 + 胜者**。
>
> - **不能抽查格子**：抽查漏掉的那格正是最危险的分叉
> - **不能只看棋盘**：四维下"棋盘逐格相同"**不蕴含**"两边一致" ——
>   转动记录决定了「恢复本次转动」还灵不灵、下一次冷却从哪算起
> - **不能含时间/本地状态**：两端算出来必须逐位相同

#### 5.3.8 开局参数的清洗

```js
/**
 * 【B6】rules 白名单 + 夹取。六个字段正好是 RuleSet.clone() 覆盖的那六个，一个不多一个不少。
 * 不这么做的话：客户端发 winLength: 0，**第一手就判胜**。
 *
 * 关键在**从默认值出发**，而不是"从客户端对象出发再删掉坏的"。白名单是"允许覆盖哪些"，
 * 黑名单是"禁止哪些"—— 后者的漏网方式你永远想不到。
 */
function sanitizeRules(raw) {
  const r = new RuleSet();
  if (!raw || typeof raw !== "object") return r;

  if (Number.isInteger(raw.winLength) && raw.winLength >= 2 && raw.winLength <= 10) {
    r.winLength = raw.winLength;
  }
  r.overlineLoses = raw.overlineLoses === true;
  r.overlineTakesPrecedence = raw.overlineTakesPrecedence !== false;
  if (raw.restricted === RestrictionTarget.None ||
      raw.restricted === RestrictionTarget.FirstPlayer ||
      raw.restricted === RestrictionTarget.Black) {
    r.restricted = raw.restricted;
  }
  r.allowRotation = raw.allowRotation === true;
  if (Number.isInteger(raw.rotationCooldownPlacements) &&
      raw.rotationCooldownPlacements >= 1 && raw.rotationCooldownPlacements <= 50) {
    r.rotationCooldownPlacements = raw.rotationCooldownPlacements;
  }
  return r;
}

/**
 * 尺寸校验。**范围从内核的 BoardLimits 取，不在服务器上抄一份 8/50。**
 * 抄一份就又多了一个"改了这边忘了那边"的地方。
 *
 * 【和初版计划的差异】计划里写的是"夹取到 BoardLimits"。实现时改成**拒绝**：
 * 悄悄把 5³ 变成 8³ 会让人以为程序坏了；而且夹取需要在构造 Board3D 之前就做，
 * 否则 10000³ 会先去申请 10¹² 字节然后 OOM。拒绝同时解决了这两件事。
 */
function sanitizeDims(raw, allowRotation) {
  const d = normalizeDims(raw);       // 内核自己会抛非法尺寸 —— 外层 try 接住
  for (let i = 0; i < 3; i++) {
    if (d[i] < BoardLimits.Min || d[i] > BoardLimits.Max) {
      throw new Error("棋盘尺寸必须在 " + BoardLimits.Min + " – " + BoardLimits.Max +
                      " 之间，收到 [" + d.join(",") + "]");
    }
  }
  // 四维必须立方（转层要求两个自由轴等长）。和 index.html 里 startSession 的做法一致：
  // **直接拉齐而不是拒绝** —— 那里理由写得对："按钮点了没反应"比"自动修正"更难查。
  if (allowRotation) d[1] = d[2] = d[0];
  return d;
}
```

> **`mode` 不作为独立事实传递。** 客户端发来的 `mode` 只用来和 `rules.allowRotation` **对账**：
> 对得上就用，对不上就拒绝建房。真正的来源只有一个 —— `rules.allowRotation`。
> （`index.html` 里 `fourD` 和 `rules.allowRotation` 本来就是一回事，协议里没必要再存一份。）

### 5.4 安全和资源上限（公网必做）

服务器一旦有公网地址，**几小时内就会被扫描器发现**。以下每一项都不是可选的：

| 项 | 值 | 为什么 |
|---|---|---|
| 房间号位数 | **6 位**随机数字 | 4 位只有 1 万种，会被枚举；6 位是 100 万 |
| 房间总数上限 | 200 | 否则有人建满内存 |
| 单房间人数 | 2（第三个拒绝） | |
| 单 IP 的 SSE 连接数 | 8 | 否则一个脚本就能撑爆文件描述符 |
| POST 请求体上限 | 4 KB | 正常消息不到 200 字节 |
| 房间空置回收 | 30 分钟 | 否则 `rooms` 只增不减 |
| 落子频率限制 | 单连接 5 次/秒 | 防脚本刷 |

另外：**国内云服务器的 80/443 端口要 ICP 备案才能开**，用 8080 之类的非标端口通常不需要。这是国内部署一个绕不开的实际限制。

---

## 6. 客户端改动：只有 7 个点

这是本方案"改动可控"的关键。**渲染、UI、面板、相机、着色器一行都不用动**，因为所有改动都落在"提交动作"和"订阅事件"这两类位置上。

### 6.1 先加一个 `Net` 对象

```js
const Net = {
  online: false, room: null, mySeat: null, lastSeq: 0, handlers: {},
  on(t, fn) { this.handlers[t] = fn; },
  send(msg) {
    fetch("/action", { method: "POST", headers: { "Content-Type": "application/json" },
                       body: JSON.stringify({ ...msg, room: this.room }) });
  },
  connect(room) { /* new EventSource("/events?room=" + room)，按 t 分发到 handlers */ },
};
```

### 6.2 **七个**提交点（初版写的是"六个"，漏了一个）【已修正】

| # | 位置 | 现状 | 改成 |
|---|---|---|---|
| 1 | `startSession()` 里 `FourDSession.create(...)` 和 `this.session.reset(d, first, rules)` | 建/重置本地会话 | **联机时禁止在本地建会话**，只能由收到 `state` / `sync` / `reset` 消息来建 |
| 2 | `tryPlace()` 内 `this.session.place(x, y, this.activeLayer)` | 本地执行 | 联机时发 `{t:"place",...}`，**不本地执行** |
| 3 | `doRotate()` 内 `this.session.rotateBy(...)` | 本地执行 | 联机时发 `{t:"rotate",...}`，不本地执行 |
| 4 | `restoreRotation()` 内 `this.session.undoLastRotation()` | 本地执行 | 联机时发 `{t:"restoreRotation"}` |
| 5 | `undo()` 内 `this.session.undo()` | 本地执行 | 联机时发 `{t:"undoReq"}`（请求-同意版，见 §7.3） |
| 6 | `restart()` 内 `this.session.restart()` | 本地执行 | 联机时发 `{t:"restart"}` |
| 7 | **`swapFirst()` 内 `this.session.reset(...)`** | **本地重置** | **联机时直接拒绝**（见下） |

**第 7 条就是初版漏掉的那个，而它恰恰是最危险的一类。** `swapFirst()` 是"重开，改为对方先手"
那个按钮的处理函数，它**直接调 `session.reset`** —— 不经过任何别的路径。

初版漏掉它的后果：联机时按一下，**本地盘面清空，服务器还停在第 200 手**。
接下来服务器发来的每一条 `applied` 都能在本地"成功"应用到一个空盘上，
于是两边从那一刻起永久分叉 —— 而且**没有任何报错**，只是"对方说我下了，我这儿看不到"。

这个错误的形状值得记住：**它不是"某处写错了"，而是"少列了一处"**。
漏列是列不完的 —— 所以下面用一个**门面 + 静态断言**把这件事变成结构上不可能。

### 6.2.1 门面：联机判断只出现一次

**不要**在上面 7 个点里各写一遍 `if (Net.online)`。那是必然漏的，第 7 条就是这么漏的。

改成一个门面，7 个调用点全部改成调它：

```js
/**
 * 唯一的提交门面。**联机分支在整份 index.html 里只出现这一次。**
 * 返回 { ok, reason }：ok 表示"这一步被接受了"（联机时是"已发给服务器"，不是"已生效"）。
 */
commit(kind, payload) {
  if (Net.online) {
    // 联机：只发不走本地。视图更新由收到的 applied 事件驱动（§6.3）。
    // 第 7 条（swapFirst）在这里被挡住 —— 座位和先手由服务器定，本地无权改。
    const r = Net.send(kind, payload);
    if (!r.ok) return r;
    return { ok: true };
  }
  return this.commitLocal(kind, payload);
},

/** 单机路径。**原来那几行一字未改地搬进来** —— 这是"非联机路径零影响"的物理保证。 */
commitLocal(kind, payload) {
  const s = this.session;
  switch (kind) {
    case "place": {
      const o = s.place(payload.x, payload.y, payload.z);
      return o.status === MoveStatus.Rejected ? { ok: false, reason: o.reason } : { ok: true };
    }
    case "rotate": {
      const o = s.rotateBy(payload.axis, payload.layer, payload.dir, payload.turns);
      return o.accepted ? { ok: true } : { ok: false, reason: o.describe() };
    }
    case "restoreRotation":
      return s.undoLastRotation() ? { ok: true } : { ok: false, reason: "最后一步不是转动，没法恢复" };
    case "undo":
      return s.undo() ? { ok: true } : { ok: false, reason: "没有可悔的棋了" };
    case "restart":
      s.restart();
      return { ok: true };
    default:
      throw new Error("未知动作 " + kind);   // 单机路径不该出现别的 kind
  }
},
```

调用点于是变成一种统一形状（`tryPlace` 为例）：

```js
tryPlace(x, y) {
  if (this.setupOpen) return;
  if (!this.session || this.session.status !== "Playing") return;
  if (Net.online && this.session.currentPlayer !== Net.mySeat) {
    this.toast("还没轮到你", false); return;
  }
  const r = this.commit("place", { x: x, y: y, z: this.activeLayer });
  if (!r.ok) this.toast(r.reason, false);
},
```

### 6.2.2 结构保证：一条 grep 静态断言

门面本身不防止"以后有人又加了第 8 个调用点直接调 `session`"。所以配一条静态断言，
放进 `tests/dom-smoke.test.mjs`：

```js
// 内核区间**之外**，对 session 变更方法的调用只允许出现在 commitLocal 里，且数量固定。
const outside = html.slice(coreEnd).match(
  /this\.session\.(place|rotateBy|undo|restart|reset|undoLastRotation)\s*\(/g) || [];
eq(outside.length, 5, "内核区间外对 session 变更方法的调用点数量",
   "多了一个就说明有人绕过 Game.commit 直接改了会话 —— swapFirst 就是这么漏掉的");
```

> **为什么断言的是"数量"而不是"位置"**：数量会随每次合法改动一起更新（改的人必须顺手改这个数字），
> 而位置断言需要解析代码、脆得多。数量断言的失效方式是"有人改了数字让它变绿" —— 这是**故意的**：
> 那个数字就在那里等着被看见，比一个悄悄多出来的调用点好得多。
>
> 数字 `5` 是 `commitLocal` 里 `place` / `rotateBy` / `undo` / `undoLastRotation` / `restart`
> 五个分支各一次（`reset` 不在 `commitLocal` 里 —— 单机路径的 reset 走 `startSession` / `swapFirst`
> 各自的独立逻辑，联机时它们被门面挡住）。写代码时以实际值为准。

### 6.3 事件订阅：形状不变，但**要加分歧检测**

初版说"`onMoveApplied` 那几行订阅一行都不用改" —— **这句是对的，保留**。
因为收到 `applied` 之后要做的，就是去调**已有的 session 方法**：网络层不产生新的渲染路径，
它只是"另一个输入源"。

但初版漏了 `checksum` 的校验（因为初版根本没有 `checksum`）。加上之后：

```js
Net.on("applied", (m) => {
  // 幂等：同一条 applied 可能被补发两次（Last-Event-ID 的边界情况）
  if (m.seq <= Net.lastSeq) return;
  Net.lastSeq = m.seq;

  const a = m.action, s = Game.session;
  if (!s) { Net.resync("还没建会话就收到了动作"); return; }

  switch (a.t) {
    case "place":           s.place(a.x, a.y, a.z); break;
    case "rotate":          s.rotateBy(a.axis, a.layer, a.dir, a.turns); break;
    case "undo":            s.undo(); break;
    case "restoreRotation": s.undoLastRotation(); break;
    default: Net.resync("收到不认识的动作 " + a.t); return;
  }

  // 【B7】分歧检测。服务器说"这一手生效了"，那本地重放出来的盘面**必须**和它逐位一致。
  // 对不上 = 规则分叉。这一刻是唯一能当场抓住它的时刻 ——
  // 再往后拖，两条分支只会越走越远，而整局都不会再报一次错。
  if (fingerprint(s) !== m.checksum) {
    Net.resync("盘面和服务器对不上（规则分叉）");
  }
});
```

> **`resync` 要做什么**：清空本地会话 → 重放服务器补发的完整事件序列 → 再比一次指纹。
> 它是"最后一道防线"，不是"日常路径"。真触发到它，说明前面某一层已经有 bug 了，
> **必须同时往控制台打一条显眼的错误**，别让它悄悄自愈 —— 悄悄自愈等于把 bug 藏起来。
>
> **注意 `restart` 不在这个 switch 里**：服务器重开发的是 `reset` 事件而不是 `applied`，
> 客户端整体重建会话（见 §4.3）。这两条路径不能混。

### 6.3.1 那五条订阅**确实**一行都不用改

`onMoveApplied` / `onMoveUndone` / `onReset` / `onRotationApplied` / `onRotationUndone`
这五行订阅（搜 `onMoveApplied.push`）**一行都不用改** —— 上面那个 handler 调的还是
**已有的 session 方法**，视图更新全部由已有的 `session.onXxx` 事件自动完成。

**这是整个设计的要点**：网络层不产生新的渲染路径，它只是"另一个输入源"。
原有的 `place → 事件 → 视图` 链路原封不动。

如果发现自己在渲染函数里加 `if (Net.online)`，说明走错了路。

---

## 7. 四维转动的联机语义

### 7.1 转动本身：简单

`FourDSession.rotate()` 的四种结果里，**只有 `Rotated` 会改变棋盘和回合**（见 `rotate()` 开头那几个拒绝分支）。所以服务器只要：

- `accepted`（即 `Status === RotateStatus.Rotated`）→ 广播 `applied`
- 其余三种（`Rejected` / `NoRotation` / `CreatesLine`）→ 回 `rejected` 并带上 `o.reason`

不需要为"NoRotation"和"CreatesLine"做特殊处理，因为它们的共同语义就是**棋盘和回合都没动**。

### 7.2 「撤销本次转动」：语义天然对齐

`restoreRotation` 有个特殊约束（见 `undoLastRotation` / `canUndoLastRotation`）：只有当最后一步确实是转动时才能撤销，一旦有人落子就"落地"了，不能再单独撤回。

联机下这个约束**自动成立**：服务器是唯一执行者，所有动作都过它的 `_rotations` 数组，`PlacementsBefore == moveCount` 这个判断在服务器上永远是对的。客户端不需要知道这条规则。

### 7.3 悔棋：请求-同意版【已按本项目决定重写】

初版推荐"先做命令版"。**本项目已拍板走请求-同意版**，所以本节按请求-同意版重写 ——
初版只给了一句方向，真实现时每一步都得定死。

#### 7.3.1 所有权：谁有权发起

> **请求者必须是最后那一手的做出者。**

服务器 O(1) 可判：看 `history` 最后一条的 `player`；若最后一步是转动，看 `rotations` 最后一条的 `player`。

**一条判断同时解决了四个问题：**

| 问题 | 怎么被解决的 |
|---|---|
| 谁有权发起？ | 只有刚下完那一手的人 |
| 撤销的是哪一步？ | 必然是最后一步，不可能是别的 |
| 反复悔棋怎么限流？ | 悔完出子权回到自己，但**已经没有"自己刚下的那一手"了**（见下），连悔两次在结构上不成立 |
| 对方能不能替我做决定？ | 不能 —— 请求者不可能是"没下过棋"的那个人 |

> **"连悔两次在结构上不成立"值得展开**：悔棋之后 `currentPlayer` 回到请求者身上，
> 而 `history` 的最后一条变成了**对方的**那一手。这时请求者已经不是"最后那一手的做出者"了，
> 再点悔棋会被服务器拒。想连悔，得对方先下、然后由**对方**发起。
>
> **这是免费得到的限流**，不需要额外写"每局最多悔 N 次"。

#### 7.3.2 未决期间**不锁棋盘**

对方 AFK 时把棋盘锁死，比"退一步"糟得多 —— 一个去接电话的人能让整局停摆。

规则：**任何被接受的 `place` / `rotate` 先取消未决请求，再应用。**

```js
/**
 * 取消未决的悔棋请求。返回要广播的事件；没有未决请求时返回 null。
 * 【为什么叫"取消"而不是"拒绝"】语义不同：拒绝是对方点了"不同意"，
 * 取消是这一步已经作废了（棋盘动了 / 被重开）。给玩家的提示必须区分开。
 */
function cancelPending(room, why) {
  const p = room.pending;
  if (!p) return null;
  clearTimeout(p.timer);   // 【必须】否则 60 秒后它会**再结算一次**，把已作废的请求又播一遍
  room.pending = null;
  return { t: "undoResolved", reqId: p.reqId, accept: false, reason: why };
}
```

**这不只是体验取舍，是正确性要求。** 悔棋请求里存着"请求发出时的 `seq`"。
一旦棋盘动了，那个目标指向的就是**另一步棋**了 —— 这时同意它，撤销的会是玩家没想撤的那一手。

#### 7.3.3 同意时**再复核两次**

```js
function doUndoAnswer(room, seat, msg) {
  const p = room.pending;
  if (!p) return { ok: false, reason: "没有待应答的悔棋请求" };
  if (msg.reqId !== p.reqId) return { ok: false, reason: "请求已过期" };
  if (seat === p.by) return { ok: false, reason: "不能自己同意自己" };

  // 复核一：请求发出之后，棋盘没动过
  if (room.seq !== p.seqAsked) {
    const ev = cancelPending(room, "请求发出后棋盘动过");
    return { ok: true, events: ev ? [ev] : [] };
  }
  // 复核二：最后一手仍然是请求者做的。
  // 理论上"复核一通过"已经蕴含"复核二通过"，这条看起来冗余 —— 但它是对
  // **内核不变量**的直接检测。代价是一次 O(1) 的读，换来的是"悔错了一步"不可能发生。
  if (lastActorOf(room.session) !== p.by) {
    const ev = cancelPending(room, "最后一手已经不是你的了");
    return { ok: true, events: ev ? [ev] : [] };
  }

  if (!msg.accept) {
    const ev = cancelPending(room, "对方拒绝了");
    return { ok: true, events: ev ? [ev] : [] };
  }

  clearTimeout(p.timer);
  room.pending = null;
  room.session.undo();          // 真的悔
  room.seq++;
  const applied = {
    t: "applied", seq: room.seq, by: p.by, action: { t: "undo" },
    checksum: fingerprint(room.session),
  };
  room.events.push(applied);
  return { ok: true, events: [
    { t: "undoResolved", reqId: p.reqId, accept: true },
    applied,
  ]};
}

/** 最后一步是谁做的。转动算转动的人，落子算落子的人。 */
function lastActorOf(s) {
  const r = s.rotations[s.rotations.length - 1];
  if (r && r.placementsBefore === s.moveCount) return r.player;   // 最后一步是转动
  const h = s.history[s.history.length - 1];
  return h ? h.player : null;                                      // 最后一步是落子
}
```

#### 7.3.4 发起 + 超时 60 秒

```js
function doUndoReq(room, seat, msg) {
  if (room.pending) return { ok: false, reason: "已经有一个待应答的请求" };
  const s = room.session;
  if (s.actionCount === 0) return { ok: false, reason: "还没有可悔的棋" };
  // 【所有权】只有刚下完那一手的人能发起
  if (lastActorOf(s) !== seat) return { ok: false, reason: "只能悔自己刚下的那一手" };

  const p = { reqId: msg.reqId, by: seat, peer: opponentOf(seat),
              seqAsked: room.seq, timer: null };
  p.timer = setTimeout(() => {
    if (room.pending !== p) return;    // 已经被别的路径结算过了，别再播一次
    const ev = cancelPending(room, "对方 60 秒没回应");
    if (ev) broadcast(room, ev);
  }, 60000);
  room.pending = p;

  return { ok: true, events: [{ t: "undoAsked", reqId: p.reqId, by: seat }] };
}

/** 撤回自己还没被应答的请求。只有发起者本人能撤。 */
function doUndoCancel(room, seat, msg) {
  const p = room.pending;
  if (!p) return { ok: false, reason: "没有待应答的悔棋请求" };
  if (p.by !== seat) return { ok: false, reason: "只能撤回自己发起的请求" };
  if (msg.reqId !== p.reqId) return { ok: false, reason: "请求已过期" };

  const ev = cancelPending(room, "对方主动撤回了请求");
  return { ok: true, events: ev ? [ev] : [] };
}
```

> **`undoCancel` 为什么必须存在**：没有它，玩家点了"悔棋"又改主意，就只能干等 60 秒超时 ——
> 而这 60 秒里对方一直看到"对方请求悔棋"的提示，还会以为自己不回应就没事。
> **一个能自己撤销的请求，比一个只能靠超时结束的请求好得多。**
>
> ⚠️ **重复结算这件事有三道防线，而且它们是冗余的 —— 这一段是注入验证纠正过来的。**
>
> 本文档初版在这里写"漏掉任何一个 `clearTimeout`，60 秒后定时器会再结算一次"。
> **那句话是错的。** 实测（把 `clearTimeout` 删掉、跑完整测试）证明重复结算**没有发生**，
> 因为下面三道里**任意一道**都足以挡住它：
>
> | # | 防线 | 它拦住的情形 |
> |---|---|---|
> | 1 | `clearTimeout(p.timer)` | 别的路径结算过之后，定时器**压根不会触发** |
> | 2 | 超时回调开头的 `if (room.pending !== p) return` | `p` 是每个请求独占的对象；结算过之后 `room.pending` 要么是 `null`、要么是另一个 `p` |
> | 3 | **`cancelPending` 自己是幂等的**（`if (!p) return null`） | 前两道都漏了，它也只会返回 `null`，播不出第二条 |
>
> **第 3 道才是真正兜底的那一道**，前两道是性能上的优化（少跑一次无用回调、少一次无用分配）。
> 所以"删掉 `clearTimeout` 测试必须变红"这条注入**做不到** —— 不是测试不行，是那个 bug 不存在。
>
> **正确的验法是两条**：
>
> ① 行为上断言"恰好一条、之后不再有"（`tests/online.test.mjs` 场景 J2）
> ② 直接注入一次重复结算这个**现象**，确认那条断言真的看得见它（`_verify/inject-online.mjs` 的 D2b）
>
> 只做 ① 的话，它可能是一句永远为真的空话 —— 而"永远为真"和"验过了"看起来一模一样。
> 这正是 §9 第 5 层存在的理由。

#### 7.3.5 请求者断线**不取消**

移动网络切个基站、笔记本合盖再打开，都会断一次。**没有任何理由因此取消一个正常玩家的请求。**

- `sync` 消息里带回 `pending`，重连的人立刻知道自己有一个待应答的请求
- 请求者重连后仍然收得到 `undoResolved`
- 只有 `cancelPending` 的四个理由才会终结它：对方拒绝 / 棋盘动了 / 被重开 / 超时

#### 7.3.6 一个反直觉但正确的点

可能有人担心："那对方趁我请求悔棋的时候抢着下一手，我的请求不就废了？"
—— **对，而且这是对的。**

对方选择"继续下"而不是"回应你的请求"，**本身就是一种回应**。
真正要问的是：**凭什么让一个人的请求冻结另一个人的棋盘？**
回合制游戏里，时间是双方共有的，不是任何一方的资源。

### 7.4 还有一个四维特有的问题：`restart` 之后转动记录

`FourDSession` 靠订阅内层 `ResetPerformed` 来清空 `_rotations`（见 `FourDSession` 里那个 `onReset` 订阅）。服务器调 `s.reset(...)` 时会自动触发，所以转动记录会跟着清掉。**这条链路是现成的，不要绕过 `reset` 直接改 `board`。**

---

## 8. 断线重连【已修正】

SSE 白送了一半（§3.2），剩下一半是**服务器要能补发**。

### 8.1 一条不变量，管三件事

> **一条事件有 `seq` ⟺ 它进 `room.events` 补发日志 ⟺ 它在 SSE 帧里带 `id:` 行。**

这三件事是**同一件事**，不是三件碰巧一致的事。把它当成一条规则来记，能一次消掉一整类 bug：

- `rejected` 不带 `seq` → 所以它既不进日志、也不带 `id:` —— 于是浏览器的 `Last-Event-ID`
  **不会**因为它而前移（前移了的话，重连时会跳过真正的棋局事件）
- 客户端的 `seq > lastSeq` 门禁只看带 `seq` 的事件 → 所以"被静默丢弃"这件事
  在结构上不可能发生在该被处理的事件上（**B3 就是这么来的**）
- 加新消息时只需要问一句"它改变棋局吗"，不需要再想"那它要不要进日志、要不要带 id"

**SSE 帧长这样**（有 `seq` 的才写 `id:` 行）：

```
id: 17
data: {"t":"applied","seq":17,"by":1,"action":{"t":"place","x":3,"y":4,"z":5},"checksum":"a1b2..."}

data: {"t":"rejected","reason":"该位置已有棋子 3,4,5"}

```

### 8.2 连接建立时的顺序

```
1. 补发（带 id）      Last-Event-ID 之后的全部棋局事件
2. sync（不带 id）    当前真相摘要：dims/mode/first/rules/moveCount/pending
```

**补发在前，`sync` 在后。** 这个顺序是有意的：

- **补发在前** → 重连的人先拿到自己缺的那一段，`seq` 门禁自然放行
- **`sync` 在后** → 它是**一致性检查**，不是**建会话的手段**。
  因为 `sync` **不带 `id`、不动 `lastSeq`**，它永远不会和门禁打架

**如果反过来（`sync` 在前）**，`sync` 里的 `seq` 会把客户端的 `lastSeq` 一把推到当前值，
紧接着补发的 `1..N` 全部被 `seq > lastSeq` 挡住 —— 客户端"连上了、也收到了、但什么都没发生"。
这个 bug 完全无声，所以顺序定死。

### 8.3 `sync` 的三种用途

客户端收到 `sync` 后：

| 情况 | 处理 |
|---|---|
| `dims === null` | 房间还没开局 → 显示等待界面 |
| 没有本地 `session` | 用 `sync` 里的 `dims`/`first`/`rules` **建一个**（补发里可能没有 `state`，比如服务器重启过） |
| 有本地 `session` | **对账**：`moveCount` 一致 → 什么都不做；不一致 → 发 `resync{since:0}` |

`pending` 字段也在 `sync` 里 —— 重连的人立刻知道自己有一个待应答的悔棋请求（§7.3.5）。

### 8.4 `room.events` **永不截断**

只靠"房间空闲 30 分钟就整体回收"来限制内存，**不做滑动窗口**。

原因：一旦截断，`Last-Event-ID` 落在窗口之外的重连者就永久拿不到开头那一段 ——
他会建不出 `session`，而且**没有任何办法自愈**（服务器手上也没有了）。

代价是可控的：一局几百条事件 × 每条几十字节，一个房间不到 100KB；
房间数上限 200（§5.4）→ 最坏 20MB。**用 20MB 换掉一整类不可恢复的 bug，值得。**

> 初版这里还写着 "`state` 消息也要进 `events`" —— 那是对的，§4.3 已经把它写成了
> 「有 `seq` ⟺ 进日志」这条不变量的推论，不再是需要单独记住的一条。

### 8.5 会话是怎么建起来的（把这四条连起来看）

| 时机 | 谁触发 |
|---|---|
| 第一局 | 服务器的 `state` 事件 → 客户端 `FourDSession.create(dims, first, rules)` |
| 重开 | 服务器的 `reset` 事件 → 客户端整体重建 |
| 重连，补发里有 `state` | 补发过程里自然建起来 |
| 重连，补发里没有 `state`（服务器重启过） | `sync` 兜底建起来 |

**四条路径都要能建出结构相同的 `session`** —— 这就是 §9 第 3 层要验的东西。
`index.html` 里 `startSession` 那处的 `if (!this.session) { create } else { reset }` 结构正好可以复用：
**联机时把它的触发源从"用户点开始"换成"收到 state/sync"**，形状一个字都不用改。

---

## 9. 验证方法（分四层，从便宜到贵）

本工程的传统是"证据链"。这四层是配套的，缺一层就会出现没被钉住的假设。

### 第 1 层：服务器内核自检（约 20 行代码，强烈建议）

启动时让服务器跑**两份向量的全程回放**，断言 **11733 + 19408 项全过**：

| 文件 | 项数 | 为什么不能只跑一份 |
|---|---|---|
| `tests/vectors.json` | 11733 | 三维规则基线（落子/判胜/长连/悔棋） |
| `tests/rotation-vectors.json` | 19408 | **四维转动** |

⚠️ **初版只提了前者，那是不够的。** 转动恰恰是服务器**独有语义**的那一半 ——
浏览器里转动是玩家点的，服务器里转动是它自己算的；不覆盖它等于没验。
而且两份加起来才 31141 项，比一份多不了多少时间。

为什么值得：**服务器是内核的第三个使用处**。C# 和浏览器那份靠向量对拍已经有证据了，
服务器这份**默认没有**。加上这一步，两份向量就同时钉住了三处。

做法直接从 `tests/rules.test.mjs` 和 `tests/rotation.test.mjs` 的回放段抄。

> 顺带说明：如果只是比较"服务器加载的源码字符串"和 `index.html` 里那一段是否相等，
> 那是**同义反复**（服务器本来就是切出来的），**不构成证据**。
> 要钉住的是"这段代码的行为正确"，所以必须回放向量。

### 第 2 层：双端对放测试（核心，`tests/online.test.mjs`）

**不经过网络**，直接在 Node 里 `import` 服务器模块，构造两个假客户端各持一个 `FourDSession`：

1. 固定随机种子，跑一局随机对局直到分出胜负
2. 每一步：客户端 A 调服务器的 `applyAction` → 取服务器广播的事件 → 喂给两个客户端的 session
3. 断言**每一步之后**（不是抽查，是每一步）：
   - 两边 `board.cells`（扁平 `Uint8Array`）**整个数组逐字节相等** —— 不抽查格子
   - 两边 `moveCount` / `status` / `winner` / `rotationCount` 相等
   - 两边都等于服务器 session 的这些值
   - 三边的 `fingerprint()` **完全一致**（这条是上面几条的冗余，留着 —— 它在两边都对、但都对错了的时候仍然不响，
     所以要配合下面第 2.5 层的真 HTTP 才能形成闭环）

跑得飞快、不需要网络、不需要浏览器，所以**可以跑几千局**。别只跑一局。

### 第 2.5 层：真实 HTTP + 真实 SSE（初版没有这一层）

第 2 层绕过了网络，于是**网络层本身完全没被验过** —— 而 §3.3 那三个坑（代理缓冲、连接数、
心跳）全都在网络层里。所以补一层：

```
node server.js --port 0 --host 127.0.0.1
```

- `--port 0` 让操作系统分配空闲端口，测试从 stdout 的 ready 行拿端口（**不能写死端口号**：CI 上会撞）
- **必须绑 `127.0.0.1`，不能绑 `0.0.0.0`** —— Windows 上监听 `0.0.0.0` 会弹防火墙授权框，
  自动化步骤卡在那儿就永远不返回。绑 loopback 顺带也满足"没外网的机器上也能跑"
- 用 `node:http` 自己发请求、自己读 SSE 流（**不引任何 HTTP 客户端库**）

覆盖：HTTP 路由、SSE 帧格式与刷出时机、`Last-Event-ID` **真实请求头**、进程崩溃、
资源上限（§5.4 那张表里的每一条）、20 秒心跳。

### 第 3 层：幂等与重连

- 同一条 `place` POST 两次（同 `id`）→ 断言只落一颗子
- 同一条 `undoReq` POST 两次（同 `reqId`）→ 断言只产生一个待应答请求
- 模拟 `Last-Event-ID: N` 重连 → 断言补发的事件序列 + 本地已有状态 = 服务器状态
- 模拟从头重连（`Last-Event-ID` 为空）→ 断言重放出的 `board.cells` 和服务器**逐字节相等**
- **悔棋超时**：发起请求后不回应，快进 60 秒 → 断言恰好收到一条 `undoResolved{accept:false}`，
  而且**再过 60 秒不再有第二条**（这条专抓 §7.3.4 那个 `clearTimeout` 的坑）
- **未决期间不锁棋盘**：发起悔棋请求后，对方直接落子 → 断言这一手**成功**了，
  并且 `undoResolved{accept:false, reason:"棋盘动过"}` 紧跟在它前面

### 第 4 层：真实浏览器双开（最贵，但必须）

工程里已有 `_verify/browser-check.mjs`（无头 Chrome，**63 项** —— 初版写的 49 是阶段 1 之前的旧数字）。扩展它：

1. 起服务器（同样 `--port 0 --host 127.0.0.1`）
2. 开两个 page，一个建房一个加入
3. 交替落子若干手，其中包含一次转动
4. 断言两个 page 的 DOM 文字（`#status` 之类）和 canvas 状态一致

⚠️ **这一步需要实打实的重构**：`browser-check.mjs` 目前是"单连接"形状的 ——
`ws` / `send` / `ev` / `shot` 都是模块级的全局。要开两个 page 就必须改成
**每个连接一个对象**（`const a = await connect(); const b = await connect();`）。
这不是加几行，是改掉整个文件的骨架，所以要单独一次提交。

这一层是**唯一**能验证"`EventSource` 真的连上了""SSE 没被缓冲""两个标签页真的看到同一个盘面"的手段。
前 3 层全绿也可能第 4 层挂 —— 比如中间设备把 SSE 缓冲成了"攒够 4KB 才发"。

### 第 5 层：注入验证（**必做**，不是可选项）

故意改坏一处，**指定的测试必须变红**。全绿就说明测试是假绿的，得重写。

这个工程已经踩过两次假测试的坑。沿用 `inject-rulenote.py` 那套锚点自检：
**锚点匹配不上就 `exit 2`，不许静默跳过** —— 否则"注入成功但测试没红"和"注入根本没生效"
长得一模一样，你分不清是测试有用还是脚本没干活。

11 处注入（每一处都必须让指定测试变红）：

| # | 注入 | 必须变红的测试 |
|---|---|---|
| 1 | `commit()` 里删掉 `room.events.push(ev)` | 第 3 层：重连补发 |
| 2 | `room.seq++` 改成 `room.seq += 2` | 第 2 层：整盘逐格比对 |
| 3 | 给 `rejected` 加上 `seq` | 第 4 层：客户端行为（"点了没反应"） |
| 4 | `state` 事件的 `seq` 写成 0 | 第 3 层：从头重连 |
| 5 | 悔棋复核 `!==` 改成 `>=` | 第 3 层：未决期间不锁棋盘 |
| 6 | **直接注入一次重复结算**（在超时回调里多播一条 `undoResolved`） | 第 3 层：悔棋超时。⚠️ **删 `clearTimeout` 是抓不到的** —— 重复结算在构造上就不可能（见 §7.3.4 那张表）。所以这里注入的是**现象**而不是某句代码 |
| 7 | `sync` 里去掉 `pending` 字段 | 第 3 层：断线重连后仍知道有请求 |
| 8 | `sanitizeRules` 里放行 `winLength: 0` | 第 2.5 层：资源上限 |
| 9 | `fingerprint()` 改成返回常量 | 第 2 层：指纹一致（**这条要是没红，说明校验和根本没接上**） |
| 10 | `doPlace` 改回 `if (!o.accepted)`（A1 那个错误） | 第 2 层：**必须全线崩** |
| 11 | `doRotate` 改回 `s.rotate(...)`（A2 那个错误） | 第 2 层：四维对局 |

> **第 10、11 条的意义和在别处不同**：它们注入的正是本文档初版真实犯过的错。
> 如果注入它们之后测试**仍然全绿**，那说明这套测试**根本抓不住初版那些 bug** ——
> 那么"修订版是正确的"这句话就同样没有证据。**这两条是本文档自我验证的一部分。**

### 回归护栏

**阶段 2 完成后，`_verify/run-all.sh` 的 8 步必须仍然全绿。**

（初版这里写"9 步"，那是 C# 删除**之前**的旧数字。现在是 7 步，做完联机变 8 步 ——
新增的那一步是联机测试，**不可跳过**。）

联机代码在 `Net.online === false` 时应该是一条**完全不走**的分支，
所以原有 **11733 + 19408 + 98 + 53 + 63 = 31355** 项断言不受任何影响。

（初版写的 `49` 是阶段 1 之前的旧数字，阶段 1 把它加到了 63。）

**如果 `run-all.sh` 挂了，说明改动漏进了非联机路径，必须回头修 —— 不要改断言。**
这是本项目唯一那道回归护栏，改断言等于把它拆了。

---

## 10. 分阶段落地 + 每阶段验收标准

| 阶段 | 做什么 | 验收标准 | 大致工时 |
|---|---|---|---|
| **0** | 在 Node 里加载内核（§5.1），跑通第 1 层**两份**向量自检 | 11733 + 19408 项全过 | 30 分钟 |
| **1** | 写 `server.js`：静态托管 + 房间 + SSE + POST + `fingerprint` 进内核区间。**不改 `index.html`**（除了加 `fingerprint`） | `curl` 手工发 `create`/`place`，在 `/events` 里能看到正确广播 | 半天 |
| **2** | 改 `index.html` 的 **7 个**提交点 → 收敛成 `Game.commit` 门面 + `Net` 对象；本机开两个标签页对下 | ① 能下完一整局，两边盘面一致 ② **`run-all.sh` 仍 7 步全绿**（此时联机测试还没进 run-all） | 半天 |
| **3** | 断线重连（§8）+ 请求-同意悔棋（§7.3） | 第 3 层测试全过；手动刷新页面能恢复现场 | 半天 |
| **4** | 把 `tests/online.test.mjs` 接进 `run-all.sh`（7 步 → 8 步），六条 banner 文案同步改；`browser-check.mjs` 重构成多连接并加双标签页 | 第 2.5 / 4 / 5 层全过；**8 步全绿，31355 项一条不动** | 一天 |
| **5** | 上公网：租服务器 / 部署 / 端口 / 让朋友连 | 朋友在异地能下完一整局 | 见 §11 |

**阶段 1 和 2 的先后顺序不要换**。先用 `curl` 把服务器调通，再动 `index.html`。
反过来做的话，服务器 bug 和客户端 bug 会搅在一起，很难定位 —— 你会不知道该看哪一边。

⚠️ **阶段 4 单独列出来的理由**：`browser-check.mjs` 从"单连接"改成"每连接一个对象"
是**改骨架**，不是加功能。它和第 4 层的新断言必须一起做，而且做完要单独提交 ——
否则一旦 `run-all.sh` 变红，你分不清是"联机代码漏进了单机路径"还是"重构把检查脚本改坏了"。

---

## 11. 公网部署：三条路，选一条

| 方案 | 成本 | 前提 | 评价 |
|---|---|---|---|
| **a. 云服务器** | 学生机约 ¥50–100/年 | 会 SSH 就行 | **推荐**。装 Node，`node server.js` 就跑。稳定、不受你电脑开关机影响 |
| **b. 内网穿透**（cloudflared / frp） | 免费 | 你的电脑得一直开着 | 想零成本先试。国内免费通道速度不稳，且朋友下棋时你不能关电脑 |
| **c. WebRTC P2P** | 仍要一台信令服务器 | 打洞不是 100% 成功 | **不推荐**。绕不开服务器，还多了 ICE/STUN 一堆复杂度 |

部署时要额外注意：

- 国内云服务器 **80/443 需要 ICP 备案**，用 8080 之类端口
- 服务器安全组 / 防火墙要**放行你选的端口**
- 服务器上的 `index.html` 和 `server.js` 要**同版本**。动了 `index.html` 的内核区间就要一起传，
  否则服务器的裁判规则和客户端的重放规则不一致 —— 这是最容易出的线上 bug，而且**没有症状**（见 §2.3 ②）
  - **防法（已具体化）**：服务器启动时把 `CORE_HASH` 打进日志；客户端建房/加入时带上自己的
    `coreHash`；**两边对不上就拒绝开局**，并回一条能看懂的 `error`
  - 注意哈希的是 `CORE_SOURCE`（内核区间那一段），**不是整个 `index.html`** ——
    改界面配色不该导致开不了局，改判胜逻辑必须导致开不了局
  - 这一条和第 3 层 / 第 2 层的测试形成两层防护：**握手挡住"根本不同的版本"，
    `fingerprint` 挡住"同一版本里的规则分叉"**

分享方式：房间号 6 位，直接发链接 `http://你的地址:8080/?room=482913`。

---

## 12. 我验证过什么 / 没验证什么

> 本文档**刻意不写行号**。写过的行号在一次无关的编辑之后就全偏了（实测偏移 4 行），
> 而一个指向错误位置的行号比没有行号更坏。定位一律用函数名或 `/* GOMOKU-CORE-BEGIN */` 这类标记。

**已实际验证（读代码 + 跑命令得到的事实）：**

- 内核区间（`/* GOMOKU-CORE-BEGIN */` … `/* GOMOKU-CORE-END */`）是 DOM-free 的，
  且已被 `tests/rules.test.mjs` 用 `new Function()` 在纯 Node 里执行成功
- **内核区间里没有 `crypto` / `Date` / `Math.random` / `performance`** ——
  它不只是 DOM-free，是**整个环境无关**的纯函数集合。所以服务器跑它不会有环境差异，
  这也是 `fingerprint` 可以放进去、且两端结果必然相同的前提
- `FourDSession` 在区间内 → 四维规则服务器可直接复用
- 标记 `/* GOMOKU-CORE-BEGIN */` 和 `/* GOMOKU-CORE-END */` 在 `index.html` 里**各只出现一次**
  （`grep -c` 实测），所以 §5.1 那条"断言标记唯一"的检查不是多余的
- 抽取必须**先取 `<script>` 块再切标记**（`indexOf("<script>")` 配 `lastIndexOf("</script>")`），
  和 `tests/rules.test.mjs` 逐字一致
- `board.cells` 是**扁平 `Uint8Array`**（索引 `x + nx*(y + ny*z)`）→ 可以整块喂给哈希
- `normalizeDims()` 同时接受数字（立方）和 `[x,y,z]`（长方体），非法输入**抛异常**
- **七个**提交点都定位到了：`startSession`（`FourDSession.create` + `session.reset`）/
  `tryPlace` / `doRotate` / `restoreRotation` / `undo` / `restart` / **`swapFirst`**。
  初版写"六个"，**漏掉的是 `swapFirst`** —— 它直接调 `session.reset`，是本方案里最危险的漏网方式
- Node **v24.19.0**；工程内**没有任何 `node_modules`**
- `RotationDirection = { Clockwise: 0, CounterClockwise: 1 }`、`AXIS_X/Y/Z = 0/1/2`、
  `BLACK = 1 / WHITE = 2`、`MoveStatus` 5 个值、`RotateStatus` 4 个值
- `rotationCooldownPlacements` 的界面取值是 **3 / 5 / 8 / 10**（默认 5）；
  `winLength` **没有界面入口，恒为 5** —— 但协议仍然带它，所以仍然要白名单夹取
- `run-all.sh` 现在是 **7 步**（初版写的"9 步"是 C# 删除前的旧数字）
- `browser-check.mjs` 现在是 **63 项**（初版写的"49"是阶段 1 之前的旧数字）

**注意**：这份文档写于 2026-09-25，当时 Unity/C# 实现已删除、`RULES_SPEC.md` 已移到
`Web_Gomoku3D/`。本方案只依赖网页版，**不受那次改动的后续影响**。

**没验证（你要自己走一遍）：**

- **你家宽带有没有公网 IP** —— 沙箱里 `curl` 出不去网，测不了（§1.2 的自测方法）
- **`System.Net.Sockets` 之类与本方案无关**，本方案是纯 Node + 浏览器
- **`EventSource` 在真实网络（尤其国内运营商）下的表现** —— 第 4 层浏览器测试只能验本机 `localhost`，跨网的表现（心跳、代理缓冲、移动网络切换）必须真人异地实测
- **服务器在公网暴露后的实际抗扫描情况** —— §5.4 的上限值是经验值，不是测出来的
- **云服务器的备案/端口限制** —— 政策会变，部署前自己确认

---

## 附：一句话回顾

> 不要引入网络框架。你的内核已经是确定性的，联机只需要传动作。
> 服务器跑同一份内核当裁判，客户端只负责把"我做了什么"发上去、把"发生了什么"放回已有的 session 方法里。
> 真正的难点只有三个：**规则快照别分叉、动作序号要幂等、断线靠补发而不是传全盘。**
