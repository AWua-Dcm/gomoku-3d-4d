# 网页版双人联机（公网）实现方法

目标：两个人在不同地方，各开一个浏览器，下同一局三维/四维五子棋。
前置约束：不引入任何 npm 依赖（沿用本工程一贯做法）。

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

### 4.2 上行（客户端 → 服务器，`POST /action`）

| `t` | 字段 | 说明 |
|---|---|---|
| `join` | `room`, `name` | 加入房间 |
| `place` | `seq`, `x`, `y`, `z` | 落子 |
| `rotate` | `seq`, `axis`, `layer`, `dir`, `turns` | 转层（四维） |
| `undo` | `seq` | 悔棋 |
| `restoreRotation` | `seq` | 撤销本次转动 |
| `restart` | | 重开 |
| `start` | `dims`, `mode`, `first`, `rules` | **房主开局**，全屋只认第一条 |

`dims` 是 `[nx, ny, nz]`（三维可以是长方体，四维必须立方）；`mode` 是 `"3d"` / `"4d"`；`rules` 是 `RuleSet` 的字段快照。

### 4.3 下行（服务器 → 客户端，`GET /events?room=...`）

| `t` | 字段 | 说明 |
|---|---|---|
| `joined` | `seat`, `room` | 发给自己：你执黑还是执白 |
| `peer` | `name`, `joined` | 对手进来/离开了 |
| `state` | `seq`, `dims`, `mode`, `first`, `rules` | **规则快照**，见 §2.3 ② |
| `applied` | `seq`, `by`, `action` | 权威事实：某动作已生效 |
| `rejected` | `seq`, `reason` | 你的动作没通过内核校验 |
| `reset` | `dims`, `mode`, `first`, `rules` | 重开，客户端整体重建 |
| `error` | `reason` | 房间满 / 房间不存在等 |

### 4.4 `dir` 的取值

`RotationDirection.Clockwise = 0`、`CounterClockwise = 1`（搜内核区间里的 `const RotationDirection`）。协议里直接传这个整数，**不要传 `"cw"` 之类自己发明的字符串** —— 那会多出一份需要同步的映射表。

同理 `axis` 用 `AXIS_X=0 / AXIS_Y=1 / AXIS_Z=2`，`seat` / `first` 用 `EMPTY=0 / BLACK=1 / WHITE=2`。

**通用原则：协议里的枚举值一律复用内核里已有的数值，不新造。**

---

## 5. 服务器端

新增文件：`Web_Gomoku3D/server.js`，只用 `node:http` / `node:fs` / `node:path`。

### 5.1 加载内核（这是全篇最关键的一段）

```js
import fs from "node:fs";

const HTML = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
const BEGIN = "/* GOMOKU-CORE-BEGIN */";
const END   = "/* GOMOKU-CORE-END */";
const bi = HTML.indexOf(BEGIN), ei = HTML.indexOf(END);
if (bi < 0 || ei < 0 || ei <= bi) throw new Error("index.html 里找不到 GOMOKU-CORE 标记区间");

const CORE_SOURCE = HTML.slice(bi + BEGIN.length, ei);

const Core = new Function(CORE_SOURCE + `
  return { Board3D, RuleSet, RuleEngine, GameSession, FourDSession,
           RotationMove, RotationDirection, MoveStatus, RotateStatus,
           EMPTY, BLACK, WHITE };`)();

const { FourDSession, RotationMove, RotationDirection, MoveStatus, RotateStatus, BLACK, WHITE } = Core;
```

抽取逻辑和 `tests/rules.test.mjs` 里"抽出纯规则内核"那一节**完全一样**（搜 `CORE-BEGIN`）—— 照抄，不要另写一份。

### 5.2 房间模型

```js
const rooms = new Map();   // roomId -> Room

function newRoom(id) {
  return {
    id,
    session: null,          // 开局后才有：FourDSession 实例（三维模式下它是透明壳）
    dims: null, mode: null, first: null, rules: null,
    seats: { black: null, white: null },   // seat -> {name, res}
    events: [],             // 已广播的事件，用于 Last-Event-ID 补发
    seq: 0,
    lastActivity: Date.now(),
  };
}
```

**统一用 `FourDSession` 包一层**，三维模式也不特殊处理 —— 这跟 `index.html` 里 `FourDSession.create` 那处的做法一致（"三维模式下它是个透明的转发壳"）。少一条分支就少一个 bug。

### 5.3 处理动作：核心就这几行

```js
function applyAction(room, seat, msg) {
  const s = room.session;
  if (!s) return { ok: false, reason: "还没开局" };
  if (!isTurn(room, seat)) return { ok: false, reason: "还没轮到你" };

  let o;
  switch (msg.t) {
    case "place":   o = s.place(msg.x, msg.y, msg.z); break;
    case "rotate":  o = s.rotate(msg.axis, msg.layer, msg.dir, msg.turns); break;
    case "undo":    o = { accepted: s.undo() }; break;
    case "restoreRotation": o = { accepted: s.undoLastRotation() }; break;
    default: return { ok: false, reason: "未知动作 " + msg.t };
  }
  if (!o.accepted) return { ok: false, reason: o.reason || o.describe?.() || "动作无效" };

  room.seq++;
  broadcast(room, room.seq, { t: "applied", seq: room.seq, by: seat, action: msg });
  return { ok: true };
}
```

注意 `s.place()` 的返回值：`MoveOutcome.status === MoveStatus.Rejected` 时 `accepted` 是 false。而 `RotateOutcome` 有 `.accepted` getter。这里的差异**直接在服务器上照抄内核语义**，不要在服务器上重新判断一遍规则。

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

### 6.2 六个提交点：改成"联机时只发不走本地"

全部在 `Game` 对象里，位置已定位好：

| # | 位置 | 现状 | 改成 |
|---|---|---|---|
| 1 | `tryPlace()` 内 `this.session.place(x, y, this.activeLayer)` | 本地执行 | 联机时 `Net.send({t:"place",x,y,z})` 后 **`return`** |
| 2 | `doRotate()` 内 `this.session.rotateBy(...)` | 本地执行 | 联机时发 `{t:"rotate",...}` 后 return |
| 3 | `undo()` | `this.session.undo()` | 联机时发 `{t:"undo"}` |
| 4 | `restart()` | `this.session.restart()` | 联机时发 `{t:"restart"}` |
| 5 | `restoreRotation()` | `this.session.undoLastRotation()` | 联机时发 `{t:"restoreRotation"}` |
| 6 | `startSession()` 内 `this.session.reset(d, first, rules)` | 本地重置 | **联机时禁止调用**，只能由收到 `state` / `reset` 消息来触发 |

第 6 条最容易漏，也最致命：客户端如果能自己 `reset`，两边的 `RuleSet` 就会分叉（§2.3 ②）。

每个点的改法就一种形状：

```js
tryPlace(x, y) {
  if (this.setupOpen) return;
  if (!this.session || this.session.status !== "Playing") return;
  if (Net.online) {
    if (this.session.currentPlayer !== Net.mySeat) { this.toast("还没轮到你", false); return; }
    Net.send({ t: "place", x, y, z: this.activeLayer });
    return;                                   // ← 关键：不本地执行
  }
  const o = this.session.place(x, y, this.activeLayer);
  if (o.status === MoveStatus.Rejected) this.toast(o.reason, false);
}
```

### 6.3 一个变更点：事件订阅那几行**不动**

`onMoveApplied` / `onMoveUndone` / `onReset` / `onRotationApplied` / `onRotationUndone`
这五行订阅（搜 `onMoveApplied.push`）**一行都不用改**。

因为收到 `applied` 消息后的处理，就是去调**已有的 session 方法**：

```js
Net.on("applied", (m) => {
  const a = m.action, s = Game.session;
  if (a.t === "place") s.place(a.x, a.y, a.z);
  else if (a.t === "rotate") s.rotateBy(a.axis, a.layer, a.dir, a.turns);
  else if (a.t === "undo") s.undo();
  else if (a.t === "restoreRotation") s.undoLastRotation();
  // 视图更新全部由已有的 session.onXxx 事件自动完成 —— 这里不需要碰渲染
});
```

**这是整个设计的要点**：网络层不产生新的渲染路径，它只是"另一个输入源"。原有的 `place → 事件 → 视图` 链路原封不动。

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

### 7.3 悔棋：请求还是命令？

这是个**规则问题，不是技术问题**，必须你定：

| 方案 | 行为 | 实现成本 |
|---|---|---|
| **命令**（推荐先做） | 谁都能悔，一步棋直接消失 | 零。就是上面 `applyAction` 里的 `undo` |
| **请求-同意** | 悔棋方发 `undoReq`，对方点"同意"才生效 | 多两个消息类型 + 客户端一个弹窗 |

朋友之间下棋，**命令**大概率够用，但它有个真实的社交尴尬：对方正盯着棋盘思考，棋盘突然退了一步。

建议：先做命令版，但**在 UI 上给个提示**（"对方悔棋了"），并考虑加一条"每局最多悔 N 次"的软限制。等你真被这件事膈应到了，再升级成请求版。

### 7.4 还有一个四维特有的问题：`restart` 之后转动记录

`FourDSession` 靠订阅内层 `ResetPerformed` 来清空 `_rotations`（见 `FourDSession` 里那个 `onReset` 订阅）。服务器调 `s.reset(...)` 时会自动触发，所以转动记录会跟着清掉。**这条链路是现成的，不要绕过 `reset` 直接改 `board`。**

---

## 8. 断线重连

SSE 白送了一半（§3.2），剩下一半是**服务器要能补发**。

前提：服务器保留 `room.events`（所有已广播事件的数组）。断线时浏览器自动重连并带上 `Last-Event-ID: N`，服务器：

```js
const since = Number(req.headers["last-event-id"] || 0);
for (const ev of room.events) if (ev.seq > since) sendEvent(res, ev.seq, ev);
```

**不要用"传一次全盘"来做重连。** 那需要一条"从棋盘反推状态"的路径，而这条路径没有任何测试覆盖，也没法和动作序列互验。补发动作序列虽然听起来笨，但它是**唯一真相的自然延伸**，不会引入第二份状态。

内存：一局几百条事件 × 每条几十字节，一个房间不到 100KB。`room.events` 不需要落盘。

需要处理的两个边界：

1. **刷新页面** → `lastSeq` 归零 → 服务器从 0 补发全部动作 → 客户端重放出一模一样的盘面。**这是免费得到的"恢复现场"**，而且比传全盘更可靠。
2. **`state` 消息（规则快照）也要进 `events`**。否则重连的人不知道 `dims`/`rules`，`session` 建不出来。

---

## 9. 验证方法（分四层，从便宜到贵）

本工程的传统是"证据链"。这四层是配套的，缺一层就会出现没被钉住的假设。

### 第 1 层：服务器内核自检（约 20 行代码，强烈建议）

启动时让服务器跑一遍 **`tests/vectors.json` 全程回放**，断言 11733 项全过。

为什么值得：**服务器是内核的第三个使用处**。C# 和浏览器那份靠向量对拍已经有证据了，服务器这份**默认没有**。加上这一步，`vectors.json` 就同时钉住了三处。

做法可以直接从 `tests/rules.test.mjs` 的向量回放那一段抄。

> 顺带说明：如果只是比较"服务器加载的源码字符串"和"index.html 里那一段"是否相等，那是同义反复（服务器本来就是切的），**不构成证据**。要钉住的是"这段代码的行为正确"，所以必须回放向量。

### 第 2 层：双端对放测试（核心，`tests/online.test.mjs`）

**不经过网络**，直接在 Node 里 `import` 服务器的模块，构造两个假客户端各持一个 `FourDSession`：

1. 固定随机种子，跑一局随机对局直到分出胜负
2. 每一步：客户端 A 调服务器的 `applyAction` → 取服务器广播的事件 → 喂给两个客户端的 session
3. 断言**每一步之后**：
   - 两边 `board.cells`（`Uint8Array`）逐字节相等
   - 两边 `moveCount` / `status` / `winner` / `rotationCount` 相等
   - 两边都等于服务器 session 的这些值

这一条能抓住绝大多数协议 bug，而且跑得飞快、不需要网络、不需要浏览器。

**注入验证（必做）**：故意改一处让它必须失败 —— 例如让服务器对 `place` 不广播、或让客户端的 `rotate` 参数错一位。如果改了之后测试**仍然全绿**，说明测试是假绿的，得重写。

（这个工程已经踩过两次假测试的坑，见 `.claude` 记忆里的"注入验证的三条教训"。）

### 第 3 层：幂等与重连

- 同一条 `place` POST 两次 → 断言只落一颗子
- 模拟 `Last-Event-ID: N` 重连 → 断言补发的事件序列 + 本地已有状态 = 服务器状态
- 模拟"客户端从头重连（`Last-Event-ID` 为空）" → 断言重放出的 `board.cells` 和服务器逐字节相等

### 第 4 层：真实浏览器双开（最贵，但必须）

工程里已有 `_verify/browser-check.mjs`（无头 Chrome，49 项）。扩展它：

1. 起服务器
2. 开两个 page，一个建房一个加入
3. 交替落子若干手，其中包含一次转动
4. 断言两个 page 的 DOM 文字（`#status` 之类）和 canvas 状态一致

这一层是唯一能验证"`EventSource` 真的连上了""SSE 没被缓冲""两个标签页真的看到同一个盘面"的手段。前 3 层全绿也可能第 4 层挂 —— 比如代理缓冲了 SSE。

### 回归护栏

**阶段 2 完成后，`_verify/run-all.sh` 的 9 步必须仍然全绿。**

联机代码在 `Net.online === false` 时应该是一条**完全不走**的分支，所以原有 11733 + 19408 + 98 + 53 + 49 项断言不受任何影响。如果 `run-all.sh` 挂了，说明改动漏进了非联机路径，必须回头修 —— 不要改断言。

---

## 10. 分阶段落地 + 每阶段验收标准

| 阶段 | 做什么 | 验收标准 | 大致工时 |
|---|---|---|---|
| **0** | 在 Node 里加载内核（§5.1），跑通第 1 层向量自检 | 11733 项全过 | 30 分钟 |
| **1** | 写 `server.js`：静态托管 + 房间 + SSE + POST。**不改 `index.html`** | `curl` 手工发 `start`/`place`，在 `/events` 里能看到正确广播 | 半天 |
| **2** | 改 `index.html` 的 6 个提交点 + `Net` 对象；本机开两个标签页对下 | ① 能下完一整局，两边盘面一致 ② **`run-all.sh` 9 步仍然全绿** | 半天 |
| **3** | 断线重连（§8）+ 悔棋提示 | 第 3 层测试全过；手动刷新页面能恢复现场 | 半天 |
| **4** | 上公网：租服务器 / 部署 / 端口 / 让朋友连 | 朋友在异地能下完一整局 | 见 §11 |

**阶段 1 和 2 的先后顺序不要换**。先用 `curl` 把服务器调通，再动 `index.html`。反过来的话，服务器 bug 和客户端 bug 会搅在一起，很难定位。

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
- 服务器上的 `index.html` 和 `server.js` 要**同版本**。动了 `index.html` 的内核区间就要一起传，否则服务器的裁判规则和客户端的重放规则不一致 —— 这是最容易出的线上 bug，而且**没有症状**（见 §2.3 ②）
  - 防法：服务器启动时把 `CORE_SOURCE` 的 hash 打在日志里，客户端连上时也报一个，不一致就拒绝开局

分享方式：房间号 6 位，直接发链接 `http://你的地址:8080/?room=482913`。

---

## 12. 我验证过什么 / 没验证什么

> 本文档**刻意不写行号**。写过的行号在一次无关的编辑之后就全偏了（实测偏移 4 行），
> 而一个指向错误位置的行号比没有行号更坏。定位一律用函数名或 `/* GOMOKU-CORE-BEGIN */` 这类标记。

**已实际验证（读代码 + 跑命令得到的事实）：**

- 内核区间（`/* GOMOKU-CORE-BEGIN */` … `/* GOMOKU-CORE-END */`）是 DOM-free 的，
  且已被 `tests/rules.test.mjs` 用 `new Function()` 在纯 Node 里执行成功
- `FourDSession` 在区间内 → 四维规则服务器可直接复用
- `index.html` 末尾有 `module.exports` 分支，本来就支持 Node 消费
- 六个提交点都定位到了：`tryPlace` / `doRotate` / `undo` / `restart` / `restoreRotation`，
  以及 `startSession` 里的 `session.reset`；事件订阅 5 行也集中在那里
- Node **v24.19.0**、npm 12.0.2；工程内**没有任何 `node_modules`**
- `RotationDirection.Clockwise = 0`、`AXIS_X/Y/Z = 0/1/2`、`CellState Black=1/White=2` 的数值

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
