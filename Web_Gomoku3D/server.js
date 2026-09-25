#!/usr/bin/env node
/* ==========================================================================
   三维/四维五子棋 —— 双人联机服务器

   零依赖：只用 node:http / node:fs / node:path / node:crypto / node:child_process。
   完整设计见 ONLINE.md（本文档的每一段都在那份文档里有对应章节）。

   【一句话架构】服务器跑一份和浏览器**逐字节相同**的内核当裁判，只转发"谁做了什么"，
   不转发"现在盘面长什么样"。依据是五子棋完备信息 + 回合制 + 确定性 ——
   给定规则和动作序列，盘面只有一种可能，所以动作序列本身就等价于盘面。

   【三条不能破的规矩】
     ① 补发日志只放"改变棋局真相"的事件（state / applied / reset）——
        判断标准：重放这条事件会不会让客户端的 session 变化
     ② 一条事件有 seq ⟺ 它进补发日志 ⟺ 它在 SSE 帧里带 id: 行（三者是同一件事）
     ③ 所有对 session 的调用都在 applyAction 里，别处不许有

   【用法】
     node server.js                          默认 0.0.0.0:8080
     node server.js --port 8081
     node server.js --host 127.0.0.1         只监听本机（测试用；Windows 上监听
                                             0.0.0.0 会弹防火墙授权框）
     node server.js --port 0                 让系统分配空闲端口，启动后往 stdout
                                             打一行 READY {json}（自动化测试用）
     node server.js --skip-selfcheck         跳过启动自检（只在开发时图快）
   ========================================================================== */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ==========================================================================
   1. 加载内核

   必须和 tests/rules.test.mjs 的抽法**逐字一致**：先取 <script> 块，再在块内切标记。
   直接切 HTML 也能跑，但那样"服务器跑的规则"和"测试验过的规则"就不是同一段切法了 ——
   这种"看起来一样"的分歧正是最该避免的。
   ========================================================================== */

export const HTML_PATH = path.join(HERE, "index.html");
export const HTML = fs.readFileSync(HTML_PATH, "utf8");

const scriptStart = HTML.indexOf("<script>");
const scriptEnd = HTML.lastIndexOf("</script>");
if (scriptStart < 0 || scriptEnd <= scriptStart) {
  console.error("致命：index.html 里找不到 <script> 块");
  process.exit(2);
}
const fullScript = HTML.slice(scriptStart + "<script>".length, scriptEnd);

const BEGIN = "/* GOMOKU-CORE-BEGIN */";
const END = "/* GOMOKU-CORE-END */";
const bi = fullScript.indexOf(BEGIN);
const ei = fullScript.indexOf(END);
if (bi < 0 || ei < 0 || ei <= bi) {
  console.error("致命：index.html 里找不到 GOMOKU-CORE 标记区间");
  process.exit(2);
}
// 标记必须唯一。否则哪天有人复制粘贴出第二个，indexOf 会**静默**选中前面那个，
// 服务器就和浏览器跑的不是同一段规则了 —— 这是"两份真相"的入口，在这里堵死。
if (fullScript.indexOf(BEGIN, bi + BEGIN.length) >= 0 ||
    fullScript.indexOf(END, ei + END.length) >= 0) {
  console.error("致命：GOMOKU-CORE 标记出现了不止一次 —— indexOf 会静默选错那一段");
  process.exit(2);
}

const CORE_SOURCE = fullScript.slice(bi + BEGIN.length, ei);

/**
 * 从一份 index.html 源码里切出内核区间并算哈希。
 * 启动时算一次（作为服务器的身份），自检**之后**再算一次 —— 两次不同就说明
 * "被验证过的源码"和"要发给浏览器的源码"已经不是同一份了，必须拒绝启动。
 */
function hashCore(html) {
  const s0 = html.indexOf("<script>"), s1 = html.lastIndexOf("</script>");
  if (s0 < 0 || s1 <= s0) return null;
  const script = html.slice(s0 + "<script>".length, s1);
  const b = script.indexOf(BEGIN), e = script.indexOf(END);
  if (b < 0 || e <= b) return null;
  return crypto.createHash("sha256").update(script.slice(b + BEGIN.length, e))
    .digest("hex").slice(0, 16);
}

/**
 * 内核源码哈希。客户端连上时报自己的，两边对不上就拒绝开局。
 * 钉的是**规则本身**，所以哈希 CORE_SOURCE 而不是整个 index.html ——
 * 改界面配色不该导致开不了局，改判胜逻辑必须导致开不了局。
 */
export const CORE_HASH = crypto.createHash("sha256").update(CORE_SOURCE).digest("hex").slice(0, 16);

/**
 * 导出清单只列服务器真正要用的，但必须完整。
 * 漏一个名字 → new Function 执行时立刻 ReferenceError，是**加载期**错误而不是运行期错误。
 * 这是好事：宁可在启动时炸，不要在下棋中途炸。
 */
let Core;
try {
  Core = new Function(CORE_SOURCE + `
    return { FourDSession, RuleSet, RestrictionTarget,
             BoardLimits, normalizeDims,
             RotationDirection, MoveStatus, RotateStatus,
             AXIS_X, AXIS_Y, AXIS_Z, BLACK, WHITE, EMPTY,
             RotationMove, RotationRecord,
             opponentOf, cnOf, fingerprint };`)();
} catch (e) {
  console.error("致命：内核求值失败：" + e.message);
  process.exit(2);
}

const { FourDSession, RuleSet, RestrictionTarget,
        BoardLimits, normalizeDims,
        RotationDirection, MoveStatus, RotateStatus,
        AXIS_X, AXIS_Y, AXIS_Z, BLACK, WHITE, EMPTY,
        RotationMove, RotationRecord,
        opponentOf, cnOf, fingerprint } = Core;

const AXES = [AXIS_X, AXIS_Y, AXIS_Z];

/* ==========================================================================
   2. 启动自检

   服务器是内核的**第三个**使用处。C# 和浏览器那份靠向量对拍已经有证据了，服务器这份默认没有。

   做法是**直接跑现成的那两个测试脚本**，而不是在这里再写一份回放 ——
   再写一份就等于多了一份会分叉的实现，而且"自检通过了"这句话的含金量会变得含糊。
   两个脚本加起来约 0.4 秒（实测），代价可以忽略。
   ========================================================================== */

function selfCheck() {
  const tests = [
    ["三维规则基线", "tests/rules.test.mjs"],
    // ⚠️ 只跑前者是不够的：转动恰恰是服务器**独有语义**的那一半 ——
    // 浏览器里转动是玩家点的，服务器里转动是它自己算的。
    ["四维转动一致性", "tests/rotation.test.mjs"],
  ];

  for (const [name, rel] of tests) {
    const r = spawnSync(process.execPath, [path.join(HERE, rel)], {
      cwd: HERE, encoding: "utf8",
    });
    if (r.status !== 0) {
      console.error("致命：内核自检失败 —— " + name + "（" + rel + "）");
      console.error((r.stdout || "") + (r.stderr || ""));
      process.exit(2);
    }
    const line = (r.stdout || "").split("\n").find((s) => s.includes("项通过 /"));
    console.log("  自检通过  " + name + "  " + (line ? line.trim() : ""));
  }

  // 自检那零点几秒里 index.html 有可能被改动（比如你正好在另一个窗口里编辑）。
  // 那样的话"验过的源码"和"发出去的源码"就不是同一份了 —— 重算哈希堵住这个窗口。
  const recomputed = hashCore(fs.readFileSync(HTML_PATH, "utf8"));
  if (recomputed !== CORE_HASH) {
    console.error("致命：自检期间 index.html 被改动了（内核哈希从 " + CORE_HASH +
                  " 变成 " + recomputed + "）。请重新启动。");
    process.exit(2);
  }
}

/* ==========================================================================
   3. 开局参数清洗

   客户端发来的一切都不可信。这里是唯一的入口。
   ========================================================================== */

/**
 * rules 白名单 + 夹取。六个字段正好是 RuleSet.clone() 覆盖的那六个，一个不多一个不少。
 * 不这么做：客户端发 winLength: 0，第一手就判胜。
 *
 * 关键在**从默认值出发**，而不是"从客户端对象出发再删掉坏的"。
 * 白名单是"允许覆盖哪些"，黑名单是"禁止哪些" —— 后者的漏网方式你永远想不到。
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

function snapshotRules(r) {
  return {
    winLength: r.winLength, overlineLoses: r.overlineLoses, restricted: r.restricted,
    overlineTakesPrecedence: r.overlineTakesPrecedence,
    allowRotation: r.allowRotation, rotationCooldownPlacements: r.rotationCooldownPlacements,
  };
}

/**
 * 尺寸校验。**范围从内核的 BoardLimits 取，不在服务器上抄一份 8/50。**
 * 抄一份就又多了一个"改了这边忘了那边"的地方。
 *
 * 是**拒绝**而不是夹取：悄悄把 5³ 变成 8³ 会让人以为程序坏了；
 * 而且夹取必须在构造 Board3D **之前**完成，否则 10000³ 会先去申请 10¹² 字节然后 OOM。
 * 拒绝同时解决这两件事。
 */
function sanitizeDims(raw, allowRotation) {
  const d = normalizeDims(raw);     // 非法尺寸内核自己会抛 —— 调用方的 try 接住
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

/* ==========================================================================
   4. 房间模型
   ========================================================================== */

export const LIMITS = {
  roomIdDigits: 6,
  maxRooms: 200,
  maxStreamsPerIp: 8,
  maxBodyBytes: 4096,
  idleReapMs: 30 * 60 * 1000,
  // 【为什么是 30 而不是更小】真人下棋一秒最多点两下，30 是 15 倍余量。
  // 第一版写的 10 —— 结果测试自己就被挡住了：一次完整的建房流程（建房 + 5 个非法参数
  // + 加入 + 重连…）在 50 毫秒内就要发十几条请求。
  // 限流要挡的是**脚本洪水**，不是"手脚快的玩家"；定得太紧，第一个受害者是正常用户。
  // 而且它只是第一道闸：真正防滥用的是 §5.4 那张表的其它几条（房间数、单 IP 连接数、请求体大小）。
  actionsPerSec: 30,
  pendingUndoMs: 60000,
  replayLogMax: 20000,   // 见下面的说明：这不是"滑动窗口"，是崩溃前的兜底
};

const rooms = new Map();          // roomId -> Room
const streamsByIp = new Map();    // ip -> Set<res>
const rateByIp = new Map();       // ip -> {count, resetAt}

function newRoom(id, hostSeat, hostName) {
  return {
    id,
    host: hostSeat,                       // 只有他能 restart
    session: null,
    dims: null, mode: null, first: null, rules: null,

    // seat(BLACK/WHITE) -> { name, token, conns:Set<res> }
    // token 是重连凭证：刷新页面后带它回来 = 坐回原位。没有这一条，刷新的人
    // 要么进不来、要么（更糟）把对方挤掉自己坐上去 —— 而且两边都不报错。
    seats: { [BLACK]: null, [WHITE]: null },

    events: [],       // 补发日志。**只放 state / applied / reset**
    seq: 0,
    pending: null,    // 未决的悔棋请求
    seenIds: { [BLACK]: new Map(), [WHITE]: new Map() },
    lastActivity: Date.now(),
  };
}

function newSeat(name, token) {
  return { name: String(name || "").slice(0, 24) || "无名", token, conns: new Set() };
}

const isEmpty = (s) => !s || s.conns.size === 0;
/** 两个座位都有人 = 可以开始下棋。 */
const bothSeated = (room) => !!room.seats[BLACK] && !!room.seats[WHITE];
/** 对手是谁。三维/四维都是二人局，找那个不是我的座位。 */
const peerOf = (room, seat) => room.seats[opponentOf(seat)];

function roomId() {
  for (let i = 0; i < 200; i++) {
    const id = String(crypto.randomInt(0, 1000000)).padStart(LIMITS.roomIdDigits, "0");
    if (!rooms.has(id)) return id;
  }
  return null;   // 100 万个里挑 200 个还能全撞上，那一定是别的地方坏了
}

/** 定长比较，避免用 === 比 token 时的长度/前缀泄漏。 */
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ba = Buffer.from(a), bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function seatOfToken(room, token) {
  if (!token) return null;
  for (const s of [BLACK, WHITE]) {
    if (room.seats[s] && safeEqual(room.seats[s].token, token)) return s;
  }
  return null;
}

function touch(room) { room.lastActivity = Date.now(); }

/* ==========================================================================
   5. 动作处理

   【所有对 session 的调用都在这一节里，别处不许有。】
   分三层：幂等闸门 → 分派 → 各动作自己的守卫。
   ========================================================================== */

/**
 * 唯一的动作入口。
 * @returns {{ok:true, events:Array}|{ok:false, reason:string}}
 */
function applyAction(room, seat, msg) {
  // 幂等闸门：同一个 id 重复投递 → 回上一次的结果，不重新执行。
  // 没有这一层，一次超时重发就会多悔一步棋，而且不报错。
  if (msg.id) {
    const memo = room.seenIds[seat];
    if (memo.has(msg.id)) return memo.get(msg.id);
  }

  // 内核有**两种**拒法：返回 Rejected **和直接抛异常**。
  // 这一层 try 不是"防御性编程"，它是唯一挡住"一条 POST 打死服务器进程"的东西：
  //   RotationMove.create() 在 turns 不在 1..3 时抛、layer 为负时抛
  //   normalizeDims() 对非法尺寸抛
  let result;
  try {
    result = dispatch(room, seat, msg);
  } catch (e) {
    // 对客户端是"你这步不合法"，对服务器是"我记下了，但进程还活着"。
    result = { ok: false, reason: "内核拒绝了这个动作：" + ((e && e.message) || e) };
  }

  if (msg.id) {
    const memo = room.seenIds[seat];
    // 【存进幂等表的必须是"没有 events 的版本"】
    // 不然重复投递会把同一个动作**再广播一遍**。对端有 seq 门禁挡着不会错，
    // 但会白白多一轮网络往返，而且日志里会出现同一条 applied 两次 —— 排查时会误导。
    // 失败的 reason 要原样保留：客户端重发后应该看到和第一次一样的话。
    memo.set(msg.id, result.ok ? { ok: true } : result);
    if (memo.size > 64) memo.delete(memo.keys().next().value);   // FIFO，64 条足够
  }
  return result;
}

function dispatch(room, seat, msg) {
  if (!room.session) return { ok: false, reason: "房间还没开局" };
  if (!bothSeated(room)) return { ok: false, reason: "对方还没进来" };

  switch (msg.t) {
    case "place":           return doPlace(room, seat, msg);
    case "rotate":          return doRotate(room, seat, msg);
    case "restoreRotation": return doRestoreRotation(room, seat, msg);
    case "restart":         return doRestart(room, seat, msg);
    case "undoReq":         return doUndoReq(room, seat, msg);
    case "undoAnswer":      return doUndoAnswer(room, seat, msg);
    case "undoCancel":      return doUndoCancel(room, seat, msg);
    default:                return { ok: false, reason: "未知动作 " + msg.t };
  }
}

/**
 * "轮到谁"**不是**全局前置条件。
 *
 * 【为什么】GameSession.place() 成功后的最后一步是 currentPlayer = opponentOf(player)，
 * 于是**刚落完子的人立刻就"没轮到"了**。把 isTurn 放在所有动作前面，结果是：
 * 悔棋的人永远过不了闸门，能过闸门的是**对手** —— 他会悔掉别人的棋。
 *
 * 所以只有 place / rotate 查 currentPlayer，而且在各自的处理函数里查。
 */
function requireTurn(room, seat) {
  const s = room.session;
  if (s.status !== "Playing") return "棋局已结束，请先悔棋或重开";
  if (s.currentPlayer !== seat) return "还没轮到你";
  return null;
}

/** 落子。**只有这个动作需要"轮到你"检查。** */
function doPlace(room, seat, msg) {
  const bad = requireTurn(room, seat);
  if (bad) return { ok: false, reason: bad };

  const s = room.session;
  const o = s.place(msg.x, msg.y, msg.z);

  // GameSession.place() 返回的是 RuleEngine.judge 的结论对象
  //   { status, winner, longestRun, line, isOverlineFoul }
  // ——**没有 accepted 字段**。accepted 只存在于 RotateOutcome，那是另一个类。
  // 写成 if (!o.accepted) 的话 !undefined === true，**每一次合法落子都会被拒**。
  if (o.status === MoveStatus.Rejected) return { ok: false, reason: o.reason };

  return commit(room, seat, msg);
}

/** 转层。四维才有。参数一律先过白名单，再允许进内核。 */
function doRotate(room, seat, msg) {
  const bad = requireTurn(room, seat);
  if (bad) return { ok: false, reason: bad };

  const s = room.session;
  if (!s.rotationEnabled) return { ok: false, reason: "当前不是四维模式" };

  const axis = msg.axis, dir = msg.dir, layer = msg.layer, turns = msg.turns;
  if (!AXES.includes(axis)) return { ok: false, reason: "轴必须是 0/1/2" };
  if (dir !== RotationDirection.Clockwise && dir !== RotationDirection.CounterClockwise) {
    return { ok: false, reason: "方向必须是 0/1" };
  }
  // 下面两条**不是**在重复内核的校验，是把会抛异常的输入挡在 try 外面，
  // 顺便给玩家一句能读懂的话 —— 而不是"内核拒绝了这个动作：层号不能为负：-1"。
  if (!Number.isInteger(layer) || layer < 0) return { ok: false, reason: "层号必须是非负整数" };
  if (!Number.isInteger(turns) || turns < 1 || turns > 3) {
    return { ok: false, reason: "转动次数必须是 1..3（4 次等于不动）" };
  }

  // 四参数版叫 rotateBy。rotate() 只收一个 RotationMove 对象 ——
  // 写成 rotate(axis, layer, dir, turns) 的话 move 收到数字 0，转动永远不生效。
  const o = s.rotateBy(axis, layer, dir, turns);

  // RotateOutcome 确实有 accepted getter（它和落子的结论对象是两个不同的类）。
  // 四种结果里只有 Rotated 会改变棋盘和回合，其余三种原样报给玩家。
  if (!o.accepted) return { ok: false, reason: o.reason || o.describe() };

  return commit(room, seat, msg);
}

/**
 * 最后一步是谁做的。转动算转动的人，落子算落子的人。
 * 悔棋的所有权判断和"轮到谁"无关，靠的是它。
 */
function lastActorOf(s) {
  const r = s.rotations[s.rotations.length - 1];
  if (r && r.placementsBefore === s.moveCount) return r.player;   // 最后一步是转动
  const h = s.history[s.history.length - 1];
  return h ? h.player : null;                                      // 最后一步是落子
}

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

/** 重开。房主独有。 */
function doRestart(room, seat, msg) {
  if (seat !== room.host) return { ok: false, reason: "只有房主能重开" };

  const events = [];
  const cancelEv = cancelPending(room, "房主重开了");
  if (cancelEv) events.push(emitTransient(room, cancelEv));

  room.session.restart();      // 触发 onReset → 转动记录跟着清空（ONLINE.md §7.4）

  // reset 必须是一个**有 seq、进补发日志**的事件。否则掉线期间发生的重开对重连者
  // 永久不可见 —— 他会继续在旧盘面上落子，而且之后每条 applied 都能"成功"。
  events.push(emit(room, {
    t: "reset", dims: room.dims.slice(), mode: room.mode, first: room.first,
    rules: snapshotRules(room.session.rules),
  }));
  return { ok: true, events };
}

/* ---------------------------------------------------------------- 悔棋（请求-同意版） */

/**
 * 取消未决的悔棋请求。返回要广播的事件；没有未决请求时返回 null。
 *
 * 【为什么叫"取消"而不是"拒绝"】语义不同：拒绝是对方点了"不同意"，
 * 取消是这一步已经作废了（棋盘动了 / 被重开 / 超时）。给玩家的提示必须区分开。
 */
function cancelPending(room, why) {
  const p = room.pending;
  if (!p) return null;
  // 【必须】否则 60 秒后那个定时器会**再结算一次**，把早就作废的请求又播一遍 ——
  // 而且是在棋盘已经往前走了之后。这个 bug 只在"玩家没回应"时出现，正常走一遍测不到。
  clearTimeout(p.timer);
  room.pending = null;
  return { t: "undoResolved", reqId: p.reqId, accept: false, reason: why };
}

/**
 * 发起悔棋请求。
 * 【所有权】请求者必须是**最后那一手的做出者**。一条判断同时解决了四个问题：
 * 谁有权发起 / 撤销的是哪一步 / 反复悔棋怎么限流 / 对方能不能替我做决定。
 */
function doUndoReq(room, seat, msg) {
  if (room.pending) return { ok: false, reason: "已经有一个待应答的请求" };
  const s = room.session;
  if (s.actionCount === 0) return { ok: false, reason: "还没有可悔的棋" };
  if (lastActorOf(s) !== seat) return { ok: false, reason: "只能悔自己刚下的那一手" };

  const p = {
    reqId: String(msg.reqId || crypto.randomUUID()).slice(0, 64),
    by: seat, peer: opponentOf(seat),
    seqAsked: room.seq, timer: null,
  };
  p.timer = setTimeout(() => {
    if (room.pending !== p) return;    // 已经被别的路径结算过了，别再播一次
    const ev = cancelPending(room, "对方 " + Math.round(LIMITS.pendingUndoMs / 1000) + " 秒没回应");
    if (ev) emitTransient(room, ev);
  }, LIMITS.pendingUndoMs);
  room.pending = p;

  return { ok: true, events: [emitTransient(room, { t: "undoAsked", reqId: p.reqId, by: seat })] };
}

/** 结算未决请求并播出去。三个"取消"分支共用 —— 写成一行是为了不可能漏掉广播。 */
function settle(room, why) {
  const ev = cancelPending(room, why);
  return { ok: true, events: ev ? [emitTransient(room, ev)] : [] };
}

/** 应答对方的悔棋请求。同意时**再复核两次**。 */
function doUndoAnswer(room, seat, msg) {
  const p = room.pending;
  if (!p) return { ok: false, reason: "没有待应答的悔棋请求" };
  if (msg.reqId !== p.reqId) return { ok: false, reason: "请求已过期" };
  if (seat === p.by) return { ok: false, reason: "不能自己同意自己" };

  // ── 两道复核 ──────────────────────────────────────────────────────────
  // 【它们当前是**不可达**的，留着是有意的】
  // 因为每一条会改变 room.seq 的路径（commit / doRestart）都会**先**取消未决请求，
  // 所以"有未决请求"恒蕴含"seq 没动过"，也就恒蕴含"最后一手还是请求者做的"。
  //
  // 那为什么还留着？因为它们是**对内核不变量的断言**，而不是业务流程的一环：
  // 哪天有人加了一条"改变了 seq 却忘了取消未决请求"的路径（比如房主中途改规则），
  // 这两行会当场把那个错误挡住，而不是让一个错位的 undo 悄悄生效 ——
  // 那种 bug 的症状是"悔掉了不该悔的一步"，而玩家只会觉得是运气问题。
  //
  // 代价是两次 O(1) 的读。这种事前设防比事后查"为什么会悔错一步"便宜太多。
  // tests/online.test.mjs 里有一条断言专门钉着"有未决请求 ⟹ seq 没动过"这条前提，
  // 所以如果哪天它不再成立，测试会先红，而不是让这两行变成真的死代码。
  if (room.seq !== p.seqAsked) return settle(room, "请求发出后棋盘动过");
  if (lastActorOf(room.session) !== p.by) return settle(room, "最后一手已经不是你的了");
  if (!msg.accept) return settle(room, "对方拒绝了");

  clearTimeout(p.timer);
  room.pending = null;
  room.session.undo();
  const events = [emitTransient(room, { t: "undoResolved", reqId: p.reqId, accept: true })];
  events.push(emit(room, {
    t: "applied", by: p.by, action: { t: "undo" }, checksum: fingerprint(room.session),
  }));
  return { ok: true, events };
}

/** 撤回自己还没被应答的请求。没有它，玩家点了悔棋又改主意就只能干等 60 秒超时。 */
function doUndoCancel(room, seat, msg) {
  const p = room.pending;
  if (!p) return { ok: false, reason: "没有待应答的悔棋请求" };
  if (p.by !== seat) return { ok: false, reason: "只能撤回自己发起的请求" };
  if (msg.reqId !== p.reqId) return { ok: false, reason: "请求已过期" };

  const ev = cancelPending(room, "对方主动撤回了请求");
  return { ok: true, events: ev ? [emitTransient(room, ev)] : [] };
}

/* ---------------------------------------------------------------- 汇合点 */

/**
 * 广播一条**不改变棋局真相**的事件（peer / undoAsked / undoResolved / error）。
 *
 * 【为什么要和 emit 分开命名】因为它们进不进补发日志是两回事，而且这个区别是**语义上的**：
 * 重连的人不需要知道"三分钟前有人点过一次悔棋又被拒了"。用两个名字写出来，
 * 比在一个函数里加个 `if (logged)` 参数更难搞错。
 */
function emitTransient(room, ev) {
  broadcast(room, ev);
  return ev;
}

/**
 * 进补发日志（带 seq）+ 广播。**改变棋局真相的事件必须走这个。**
 *
 * 【为什么合成一个函数】这两件事分开写迟早会漏一个。这个文件的第一版就是这样：
 * pushEvent 只负责"记日志"，广播交给 HTTP 层调用方做 —— 于是
 * ① 注释里那句"忘记广播不可能发生"是**假的**，它只保证记了日志
 * ② 进程内直调（测试、将来的其它入口）根本不会广播
 * 绑在一起之后这两件事在结构上分不开了。
 */
function emit(room, ev) {
  pushEvent(room, ev);
  broadcast(room, ev);
  return ev;
}

/** 记序号、进补发日志。单独用它的地方只有"先记后播"这类需要拆开的场景。 */
function pushEvent(room, ev) {
  room.seq++;
  ev.seq = room.seq;
  room.events.push(ev);
  if (room.events.length > LIMITS.replayLogMax) {
    // 【这**不是**滑动窗口，是崩溃前的兜底】正常对局几百条，永远到不了这个数。
    // 真到了这里说明有东西在狂发事件，与其吃掉内存不如大声报错。
    console.error("警告：房间 " + room.id + " 的补发日志超过 " + LIMITS.replayLogMax +
                  " 条，可能是异常流量");
    room.events.shift();
  }
  return ev;
}

/**
 * 一个动作已经在内核里真的生效了。
 * 【关键】任何被接受的落子/转动，**必须先取消未决的悔棋请求，再应用**。
 * 这不是妥协，是正确性要求：seq 变了之后，那个 undo 撤销的会是**另一步棋**。
 */
function commit(room, seat, action) {
  const events = [];
  const cancelEv = cancelPending(room, "对方下了新的一手，请求已作废");
  if (cancelEv) events.push(emitTransient(room, cancelEv));

  events.push(emit(room, {
    t: "applied", by: seat, action,
    // 盘面指纹。ONLINE.md §2.3② 自己说"规则分叉没有症状"，
    // 这一行就是把它变成有症状的唯一手段。客户端算一遍，对不上就 resync。
    checksum: fingerprint(room.session),
  }));
  return { ok: true, events };
}

/* ==========================================================================
   6. 开局 / 加入
   ========================================================================== */

function createRoom(body) {
  if (rooms.size >= LIMITS.maxRooms) return { ok: false, reason: "房间数量已达上限，稍后再试" };

  const rules = sanitizeRules(body.rules);
  const dims = sanitizeDims(body.dims, rules.allowRotation);
  // mode 不作为独立事实：它只是和 rules.allowRotation 对账用的。
  // 真正的来源只有一个 —— 客户端自己的 index.html 里 fourD 和 allowRotation 本来就是一回事。
  const mode = rules.allowRotation ? "4d" : "3d";
  if (body.mode && body.mode !== mode) {
    return { ok: false, reason: "mode(" + body.mode + ") 和 rules.allowRotation(" +
                                rules.allowRotation + ") 对不上" };
  }
  let first = body.first;
  if (first !== BLACK && first !== WHITE) first = BLACK;

  if (body.coreHash && body.coreHash !== CORE_HASH) {
    return { ok: false, reason: "版本不一致：服务器内核 " + CORE_HASH +
                                "，你的是 " + body.coreHash + "。请刷新页面重试。" };
  }

  const id = roomId();
  if (!id) return { ok: false, reason: "房间号分配失败，稍后再试" };

  const room = newRoom(id, BLACK, body.name);
  room.dims = dims; room.mode = mode; room.first = first;
  room.rules = rules;
  room.seats[BLACK] = newSeat(body.name, crypto.randomUUID());

  room.session = FourDSession.create(dims, first, rules);
  pushEvent(room, {
    t: "state", dims: dims.slice(), mode, first, rules: snapshotRules(rules),
  });

  rooms.set(id, room);
  return { ok: true, room, seat: BLACK, events: [] };
}

function joinRoom(room, body, token) {
  if (body.coreHash && body.coreHash !== CORE_HASH) {
    return { ok: false, reason: "版本不一致：服务器内核 " + CORE_HASH +
                                "，你的是 " + body.coreHash + "。请刷新页面重试。" };
  }

  // 带 token 回来 = 重连回原座位（token 可能来自请求体，也可能来自 URL 查询串）
  const back = seatOfToken(room, token);
  if (back !== null) return { ok: true, room, seat: back, reconnect: true, events: [] };

  const free = [BLACK, WHITE].find((s) => !room.seats[s]);
  if (free === undefined) return { ok: false, reason: "房间满了（两个人已经就位）" };

  room.seats[free] = newSeat(body.name, crypto.randomUUID());
  const events = [];
  if (bothSeated(room)) {
    // 两个人都就位才开始计时。之前进来的那个人这时候才知道对手到了。
    // peer 不改变棋局真相 —— 重连的人不需要知道"三分钟前有人进来过"。
    events.push(emitTransient(room, { t: "peer", name: room.seats[free].name, joined: true }));
  }
  return { ok: true, room, seat: free, events };
}

/* ==========================================================================
   7. HTTP
   ========================================================================== */

function sseWrite(res, ev) {
  // 有 seq 的才写 id: 行 —— 因为"有 seq ⟺ 进补发日志 ⟺ 带 id: 行"是同一件事。
  // 给 rejected 之类写 id: 的话，浏览器的 Last-Event-ID 会被它们推着前移，
  // 重连时就会**跳过真正的棋局事件**。
  if (ev.seq !== undefined) res.write("id: " + ev.seq + "\n");
  res.write("data: " + JSON.stringify(ev) + "\n\n");
}

function broadcast(room, ev) {
  for (const s of [BLACK, WHITE]) {
    if (!room.seats[s]) continue;
    for (const res of room.seats[s].conns) {
      try { sseWrite(res, ev); } catch { /* 连接已经断了，close 事件会清理 */ }
    }
  }
}

function syncOf(room) {
  return {
    t: "sync",
    dims: room.dims ? room.dims.slice() : null,
    mode: room.mode, first: room.first,
    rules: room.rules ? snapshotRules(room.rules) : null,
    moveCount: room.session ? room.session.moveCount : 0,
    started: bothSeated(room),
    pending: room.pending ? { reqId: room.pending.reqId, by: room.pending.by } : null,
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0, over = false;
    const chunks = [];
    req.on("data", (c) => {
      if (over) return;                 // 已经超限：继续读（把剩下的排空），但不再累积
      n += c.length;
      if (n > LIMITS.maxBodyBytes) {
        over = true;
        chunks.length = 0;              // 立刻放掉已经攒下的，别等着 GC
        // 【不要在这里 req.destroy()】那会把 socket 直接掐掉，客户端拿到的是
        // ECONNRESET，而不是我们想给它的 413 —— 报错信息完全指不到"请求体太大"
        // 这件事上（实测就是这么挂的，客户端表现为"socket hang up"）。
        // 正确做法：停止累积，但仍然让上面那层把 413 写回去。
        // 剩下的数据必须继续读掉：不排空的话对端会因为写不进来而卡住。
        reject(new Error("请求体超过 " + LIMITS.maxBodyBytes + " 字节"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => { if (!over) resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", (e) => { if (!over) reject(e); });
  });
}

function json(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8",
                        "Content-Length": body.length,
                        "Cache-Control": "no-store" });
  res.end(body);
}

function clientIp(req) {
  return req.socket.remoteAddress || "?";
}

/** 简单的每秒计数。超过就拒绝，不排队 —— 排队只会把内存堆起来。 */
function rateOk(ip) {
  const now = Date.now();
  let r = rateByIp.get(ip);
  if (!r || now >= r.resetAt) { r = { count: 0, resetAt: now + 1000 }; rateByIp.set(ip, r); }
  r.count++;
  return r.count <= LIMITS.actionsPerSec;
}

function handleAction(req, res, url) {
  const ip = clientIp(req);
  if (!rateOk(ip)) return json(res, 429, { ok: false, reason: "请求太频繁" });

  readBody(req).then((text) => {
    let body;
    try { body = JSON.parse(text || "{}"); }
    catch { return json(res, 400, { ok: false, reason: "请求体不是合法 JSON" }); }
    if (!body || typeof body.t !== "string") {
      return json(res, 400, { ok: false, reason: "缺少动作类型 t" });
    }

    /* ---- 建房 ---- */
    if (body.t === "create") {
      // 【必须在这里单独 catch】外层那个 .catch 是给"请求体读不出来"用的，它回 413。
      // 不分开的话，一个尺寸写错的建房请求会得到 **413 Payload Too Large** ——
      // 一个纯粹误导人的状态码，会让人去查请求体大小，而真正的问题是 dims 填错了。
      // sanitizeDims 里的 normalizeDims 是会抛的，所以这条路径真的会被走到。
      let r;
      try {
        r = createRoom(body);
      } catch (e) {
        return json(res, 400, { ok: false, reason: (e && e.message) || String(e) });
      }
      if (!r.ok) return json(res, 400, r);
      touch(r.room);
      console.log("房间 " + r.room.id + " 建立（" + r.room.mode + " " +
                  r.room.dims.join("×") + "）");
      return json(res, 200, { ok: true, room: r.room.id, seat: r.seat,
                              token: r.room.seats[r.seat].token, coreHash: CORE_HASH });
    }

    /* ---- 其它动作都要房间 ---- */
    //
    // 【room 和 token 两边都收，别只收一边】POST /action?room=X&token=Y 是 REST 的常态写法
    // （把资源定位信息和请求体分开）。第一版 room 两边都收、token 只认请求体 ——
    // 于是每条把 token 放在 URL 里的请求都回 403"座位凭证无效"，
    // 而那个提示会让你去查凭证本身，完全指不到"它压根没读到"这个真正的原因。
    const roomParam = url.searchParams.get("room") || body.room;
    const tokenParam = body.token || url.searchParams.get("token");
    const room = roomParam ? rooms.get(String(roomParam)) : null;
    if (!room) return json(res, 404, { ok: false, reason: "房间不存在或已回收" });

    /* ---- 加入 / 重连 ---- */
    if (body.t === "join") {
      const r = joinRoom(room, body, tokenParam);
      if (!r.ok) return json(res, 400, r);
      touch(room);
      // peer 事件已经由 joinRoom 自己播出去了，这里不再重播（重播会发两遍）
      if (!r.reconnect) {
        console.log("房间 " + room.id + "：" + room.seats[r.seat].name +
                    " 加入，执" + cnOf(r.seat));
      }
      return json(res, 200, { ok: true, room: room.id, seat: r.seat,
                              token: room.seats[r.seat].token, reconnect: !!r.reconnect,
                              coreHash: CORE_HASH });
    }

    /* ---- 棋局动作 ---- */
    const seat = seatOfToken(room, tokenParam);
    if (seat === null) return json(res, 403, { ok: false, reason: "座位凭证无效，请刷新页面" });

    touch(room);
    // 广播已经在 applyAction 内部完成了（emit / emitTransient）——
    // 这里**故意什么都不做**：广播和"改棋局"绑在一起，调用方就没有漏掉它的机会。
    const r = applyAction(room, seat, body);
    if (!r.ok) {
      // rejected **绝不带 seq**：带了会被客户端的 seq > lastSeq 门禁静默丢弃，
      // 表现为"点了没反应也没提示"，两端都查不出原因。
      return json(res, 200, { ok: false, reason: r.reason });
    }
    return json(res, 200, { ok: true });
  }).catch((e) => {
    json(res, 413, { ok: false, reason: e.message });
  });
}

function handleEvents(req, res, url) {
  const ip = clientIp(req);
  const room = rooms.get(String(url.searchParams.get("room") || ""));
  if (!room) return json(res, 404, { ok: false, reason: "房间不存在或已回收" });

  const seat = seatOfToken(room, url.searchParams.get("token"));
  if (seat === null) return json(res, 403, { ok: false, reason: "座位凭证无效，请刷新页面" });

  let set = streamsByIp.get(ip);
  if (!set) { set = new Set(); streamsByIp.set(ip, set); }
  if (set.size >= LIMITS.maxStreamsPerIp) {
    return json(res, 429, { ok: false, reason: "同一个 IP 的连接太多了" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    // 某些反向代理会攒够一批才发。这两个头是叫它别攒。
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");   // 立刻吐一个字节，让客户端和中间设备都知道流活了

  set.add(res);
  room.seats[seat].conns.add(res);
  touch(room);

  // 顺序定死：**先补发，后 sync**。
  // 反过来的话 sync 里的 seq 会把客户端的 lastSeq 一把推到当前值，
  // 紧接着补发的 1..N 全被 seq > lastSeq 挡住 —— 客户端"连上了、也收到了、但什么都没发生"。
  const since = Number(req.headers["last-event-id"] || 0) || 0;
  for (const ev of room.events) if (ev.seq > since) sseWrite(res, ev);
  sseWrite(res, syncOf(room));    // sync 不带 seq、不动 lastSeq，所以永远不会和门禁打架

  const hb = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { /* 下面 close 会清理 */ }
  }, 20000);

  const cleanup = () => {
    clearInterval(hb);
    set.delete(res);
    if (set.size === 0) streamsByIp.delete(ip);
    const s = room.seats[seat];
    if (s) {
      s.conns.delete(res);
      if (s.conns.size === 0) broadcast(room, { t: "peer", name: s.name, joined: false });
    }
    touch(room);
  };
  req.on("close", cleanup);
  req.on("error", cleanup);
}

function serveIndex(res) {
  const body = Buffer.from(HTML, "utf8");   // 发出去的就是启动时读进来的那一份
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8",
                       "Content-Length": body.length,
                       "Cache-Control": "no-cache" });
  res.end(body);
}

function requestHandler(req, res) {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    return serveIndex(res);
  }
  if (url.pathname === "/events" && req.method === "GET") {
    return handleEvents(req, res, url);
  }
  if (url.pathname === "/action" && req.method === "POST") {
    return handleAction(req, res, url);
  }
  if (url.pathname === "/health") {
    return json(res, 200, { ok: true, coreHash: CORE_HASH, rooms: rooms.size });
  }
  json(res, 404, { ok: false, reason: "没有这个路径" });
}

/* ==========================================================================
   8. 回收与启动
   ========================================================================== */

setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (now - room.lastActivity > LIMITS.idleReapMs) {
      if (room.pending) cancelPending(room, "房间已回收");
      for (const s of [BLACK, WHITE]) {
        if (room.seats[s]) for (const res of room.seats[s].conns) { try { res.end(); } catch {} }
      }
      rooms.delete(id);
      console.log("回收空闲房间 " + id);
    }
  }
  for (const [ip, r] of rateByIp) if (now >= r.resetAt) rateByIp.delete(ip);
}, 60000).unref();

function main() {
  const argv = process.argv.slice(2);
  const arg = (name, dflt) => {
    const i = argv.indexOf("--" + name);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
  };
  const port = Number(arg("port", 8080));
  // 默认 0.0.0.0（朋友的浏览器要连得上）。测试会显式传 127.0.0.1 ——
  // Windows 上监听 0.0.0.0 会弹防火墙授权框，自动化步骤卡在那儿就永远不返回。
  const host = arg("host", "0.0.0.0");
  const skipCheck = argv.includes("--skip-selfcheck");

  console.log("内核：" + CORE_HASH + "（" + CORE_SOURCE.length + " 字节）");
  if (skipCheck) console.log("⚠️  跳过启动自检（--skip-selfcheck）");
  else {
    console.log("启动自检……");
    selfCheck();
  }

  const server = http.createServer(requestHandler);
  server.on("error", (e) => {
    console.error("致命：无法监听 " + host + ":" + port + " —— " + e.message);
    if (e.code === "EADDRINUSE") console.error("      端口被占用了，换一个：--port 8081");
    process.exit(1);
  });

  server.listen(port, host, () => {
    const actual = server.address().port;
    console.log("");
    console.log("  服务已启动   http://" + (host === "0.0.0.0" ? "localhost" : host) + ":" + actual);
    console.log("  把地址发给朋友，两边打开同一个房间号即可");
    console.log("");
    // 自动化测试靠这一行拿端口（--port 0 时端口是系统分配的，写死不了）
    console.log("READY " + JSON.stringify({ port: actual, host, coreHash: CORE_HASH }));
  });
}

/**
 * 【只有直接运行本文件时才启动服务】
 * 测试要 `import` 这个模块、在进程内直接调 applyAction（第 2 层），
 * 无条件 main() 的话 import 会当场起一个服务器 —— 端口、防火墙、句柄全来了。
 */
const isEntryPoint = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) main();

export { applyAction, dispatch, createRoom, joinRoom, rooms, newRoom, newSeat,
         syncOf, commit, pushEvent, cancelPending, lastActorOf, broadcast,
         sanitizeRules, sanitizeDims, snapshotRules, requestHandler, main,
         bothSeated, seatOfToken, BLACK, WHITE, EMPTY, MoveStatus, RotateStatus,
         RotationDirection, AXIS_X, AXIS_Y, AXIS_Z, BoardLimits, FourDSession, RuleSet,
         RotationMove, RotationRecord, fingerprint };
