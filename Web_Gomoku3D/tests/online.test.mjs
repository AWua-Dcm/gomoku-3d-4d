/* ==========================================================================
   联机协议测试（第 2 层：进程内直调，不经过网络）

   构造两个假客户端，各持一个 FourDSession，和服务器那份对拍。
   每走一手都断言**三边整盘逐格相等** —— 不是抽查格子，是逐字节比整个 Uint8Array。

   为什么逐格：规则分叉是"没有症状"的一类 bug（ONLINE.md §2.3②）——
   一个回合之后两个盘面长得不一样，但两边都不报错。抽查会让漏掉的那一格
   正好成为唯一没被覆盖的地方，而那格往往就是分叉所在。

   这一层跑得飞快（不需要网络、不需要浏览器），所以可以跑几千手。

   设计见 ONLINE.md §9 第 2 层。
   ========================================================================== */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// 0. 计数器（沿用本工程其它测试的形状）
// ---------------------------------------------------------------------------
let passed = 0;
const failures = [];
function check(ok, name, detail) {
  if (ok) { passed++; return; }
  failures.push(name + (detail ? "\n      " + detail : ""));
}
function eq(actual, expected, name, ctx) {
  check(actual === expected, name,
    (ctx ? ctx + " | " : "") + "期望 " + JSON.stringify(expected) + " 实际 " + JSON.stringify(actual));
}
/** 断言两者不同。用于"改变 X 必须导致 Y 变化"这类命题 —— eq 说不了这个。 */
function ne(actual, notExpected, name, ctx) {
  check(actual !== notExpected, name,
    (ctx ? ctx + " | " : "") + "不该等于 " + JSON.stringify(notExpected) + "，但它就是");
}

// ---------------------------------------------------------------------------
// 1. 加载服务器模块
//
// 【注意】server.js 只在被直接运行时才启动服务（文件末尾的 isEntryPoint 判断），
// 所以这里 import 不会开端口、不会弹防火墙。
// ---------------------------------------------------------------------------
const S = await import("../server.js");
const {
  applyAction, createRoom, joinRoom, rooms, fingerprint,
  BLACK, WHITE, MoveStatus, RotationDirection, AXIS_X, AXIS_Y, AXIS_Z,
  FourDSession,
} = S;

eq(typeof S.CORE_HASH, "string", "服务器导出了 CORE_HASH");
eq(S.CORE_HASH.length, 16, "CORE_HASH 是 16 位十六进制");

// ---------------------------------------------------------------------------
// 2. 确定性随机数
//
// 不用 Math.random：测试必须可复现。失败时能拿到同一个序列重跑，是"能定位"的前提。
// ---------------------------------------------------------------------------
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
/** 棋盘逐格展开成字符串，供"前提：两者棋盘相同"这类断言使用。 */
const cellsOf = (s) => JSON.stringify(Array.from(s.board.cells));

// ---------------------------------------------------------------------------
// 3. 假客户端
//
// 这里**故意照抄 ONLINE.md §6.3 那个 handler 的形状** —— 它要能被当作
// "客户端那一侧的参考实现"，两边行为一致才有对拍的意义。
// ---------------------------------------------------------------------------
class FakeClient {
  constructor(name) {
    this.name = name;
    this.session = null;
    this.lastSeq = 0;
    this.pending = null;
    this.resyncs = 0;
    this.checksumMismatch = 0;
  }

  /** 收到一条下行事件。返回处理结果，供测试断言。 */
  receive(ev) {
    switch (ev.t) {
      case "state":
      case "reset":
        // state 和 reset 都是"整体重建"：state 只在开局时来一次，reset 是重开。
        this.session = FourDSession.create(ev.dims, ev.first,
          Object.assign(new S.RuleSet(), ev.rules));
        this.pending = null;
        if (ev.seq !== undefined) this.lastSeq = Math.max(this.lastSeq, ev.seq);
        break;

      case "sync":
        // sync **不带 seq、不动 lastSeq** —— 这是它不会和门禁打架的原因。
        if (ev.dims === null) { this.session = null; break; }
        if (!this.session) {
          this.session = FourDSession.create(ev.dims, ev.first,
            Object.assign(new S.RuleSet(), ev.rules));
        } else if (this.session.moveCount !== ev.moveCount) {
          this.resyncs++;      // 真实客户端这里会发 resync{since:0}
        }
        this.pending = ev.pending;
        break;

      case "applied": {
        if (ev.seq <= this.lastSeq) return "duplicate";   // 幂等
        this.lastSeq = ev.seq;
        if (!this.session) { this.resyncs++; return "no-session"; }
        const a = ev.action;
        if (a.t === "place") this.session.place(a.x, a.y, a.z);
        else if (a.t === "rotate") this.session.rotateBy(a.axis, a.layer, a.dir, a.turns);
        else if (a.t === "undo") this.session.undo();
        else if (a.t === "restoreRotation") this.session.undoLastRotation();
        else return "unknown";

        // 分歧检测：服务器说"这手生效了"，本地重放出来的盘面必须和它逐位一致。
        if (fingerprint(this.session) !== ev.checksum) this.checksumMismatch++;
        break;
      }

      case "undoAsked": this.pending = { reqId: ev.reqId, by: ev.by }; break;
      case "undoResolved": this.pending = null; break;
      case "peer": case "rejected": case "error": break;   // 不影响棋局
      default: return "unknown-event-" + ev.t;
    }
    return "ok";
  }

  get fp() { return this.session ? fingerprint(this.session) : null; }
}

// ---------------------------------------------------------------------------
// 4. 对拍：三边必须完全一致
// ---------------------------------------------------------------------------
let cheapChecks = 0;
function assertAllEqual(label, server, clients, checksumFromEvent) {
  const s = server.session;
  // 逐字节比整盘 —— Array.from 只为在失败时能打印出差异位置
  const ref = s.board.cells;
  for (const c of clients) {
    if (!c.session) { check(false, label + "：" + c.name + " 没有会话"); continue; }
    const got = c.session.board.cells;
    if (got.length !== ref.length) {
      check(false, label + "：" + c.name + " 的棋盘大小对不上",
        "服务器 " + ref.length + " 格，客户端 " + got.length + " 格");
      continue;
    }
    let diff = -1, n = 0;
    for (let i = 0; i < ref.length; i++) if (ref[i] !== got[i]) { if (diff < 0) diff = i; n++; }
    check(n === 0, label + "：" + c.name + " 的盘面和服务器逐格相同",
      n === 0 ? "" : n + " 格不同，第一处在 index " + diff +
        "（服务器 " + ref[diff] + "，客户端 " + got[diff] + "）");

    eq(c.session.moveCount, s.moveCount, label + "：" + c.name + " 的落子数");
    eq(c.session.rotationCount, s.rotationCount, label + "：" + c.name + " 的转动数");
    eq(c.session.status, s.status, label + "：" + c.name + " 的棋局状态");
    eq(c.session.winner, s.winner, label + "：" + c.name + " 的胜者");
    eq(c.session.currentPlayer, s.currentPlayer, label + "：" + c.name + " 的出子权");
    eq(c.fp, fingerprint(s), label + "：" + c.name + " 的指纹");
    cheapChecks++;
  }
  if (checksumFromEvent !== undefined) {
    eq(checksumFromEvent, fingerprint(s), label + "：applied 事件带的 checksum");
  }
}

// ---------------------------------------------------------------------------
// 5. 开一局（走服务器的真实建房/加入路径，不手工拼 room 对象）
// ---------------------------------------------------------------------------
function openRoom(opts) {
  // mode 必须和 rules.allowRotation 一致 —— 服务器会拿这两个对账，对不上直接拒绝建房。
  // 这也说明协议里 mode 不是独立事实，只是把 allowRotation 说成人话。
  const r = createRoom({
    name: "房主", dims: opts.dims,
    mode: opts.rules.allowRotation ? "4d" : "3d",
    first: BLACK,
    rules: opts.rules,
  });
  if (!r.ok) throw new Error("建房失败：" + r.reason);
  const j = joinRoom(r.room, { name: "客人" });
  if (!j.ok) throw new Error("加入失败：" + j.reason);

  const a = new FakeClient("A");
  const b = new FakeClient("B");
  // 建房时写进补发日志的 state，两个客户端都要收到
  for (const ev of r.room.events) { a.receive(ev); b.receive(ev); }
  for (const ev of j.events) { a.receive(ev); b.receive(ev); }
  return { room: r.room, tokenA: r.room.seats[r.seat].token, tokenB: r.room.seats[j.seat].token,
           seatA: r.seat, seatB: j.seat, a, b };
}

// ---------------------------------------------------------------------------
// 6. 随机走一手（走服务器入口，让服务器自己校验）
// ---------------------------------------------------------------------------
function randomAction(room, rng) {
  const s = room.session;
  const seat = s.currentPlayer;

  // 有一定概率尝试转动（只有四维、且冷却到了才可能成）
  if (s.rotationEnabled && rng() < 0.25) {
    return { seat, msg: {
      t: "rotate", id: "r" + Math.floor(rng() * 1e9),
      axis: pick(rng, [AXIS_X, AXIS_Y, AXIS_Z]),
      layer: Math.floor(rng() * s.board.dims[0]),
      dir: pick(rng, [RotationDirection.Clockwise, RotationDirection.CounterClockwise]),
      turns: 1 + Math.floor(rng() * 3),
    }};
  }

  // 落子：先随机试，试到空格为止（大棋盘上空格多，几次就中）
  const [nx, ny, nz] = s.board.dims;
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < 200; i++) {
    x = Math.floor(rng() * nx); y = Math.floor(rng() * ny); z = Math.floor(rng() * nz);
    if (s.board.isEmpty(x, y, z)) break;
  }
  return { seat, msg: { t: "place", id: "p" + Math.floor(rng() * 1e9), x, y, z } };
}

/* ==========================================================================
   场景 A：三维随机对局，每手整盘对拍
   ========================================================================== */
{
  const { room, a, b } = openRoom({
    dims: [8, 8, 8], cubic: true,
    rules: { winLength: 5, overlineLoses: true, restricted: 1,
             overlineTakesPrecedence: true, allowRotation: false, rotationCooldownPlacements: 5 },
  });
  const rng = makeRng(20260925);
  let applied = 0, rejected = 0;

  for (let i = 0; i < 400 && room.session.status === "Playing"; i++) {
    const { seat, msg } = randomAction(room, rng);
    const r = applyAction(room, seat, msg);
    if (!r.ok) { rejected++; continue; }
    applied++;
    let evChecksum;
    for (const ev of r.events) {
      if (ev.t === "applied") evChecksum = ev.checksum;
      a.receive(ev); b.receive(ev);
    }
    assertAllEqual("三维第 " + (i + 1) + " 手", room, [a, b], evChecksum);
  }

  check(applied > 20, "三维随机对局真的走了足够多手（否则下面那些断言是空跑）",
    "实际生效 " + applied + " 手，被拒 " + rejected + " 手");
  eq(a.resyncs, 0, "全程没有触发过 resync");
  eq(a.checksumMismatch + b.checksumMismatch, 0, "全程没有出现过指纹不一致");

  // 补一条：整局走完，两边的指纹仍然相同（前面每手都断言了，这里是收尾的确认）
  eq(a.fp, b.fp, "对局结束后两个客户端指纹仍相同");
}

/* ==========================================================================
   场景 B：四维随机对局（含转动）—— 服务器**独有语义**的那一半
   ========================================================================== */
{
  const { room, a, b } = openRoom({
    dims: [10, 10, 10], cubic: true,
    rules: { winLength: 5, overlineLoses: true, restricted: 1,
             overlineTakesPrecedence: true, allowRotation: true, rotationCooldownPlacements: 3 },
  });
  const rng = makeRng(77700123);
  let applied = 0, rotations = 0;

  for (let i = 0; i < 400 && room.session.status === "Playing"; i++) {
    const { seat, msg } = randomAction(room, rng);
    const r = applyAction(room, seat, msg);
    if (!r.ok) continue;
    applied++;
    if (msg.t === "rotate") rotations++;
    let evChecksum;
    for (const ev of r.events) {
      if (ev.t === "applied") evChecksum = ev.checksum;
      a.receive(ev); b.receive(ev);
    }
    assertAllEqual("四维第 " + (i + 1) + " 手", room, [a, b], evChecksum);
  }

  check(applied > 20, "四维随机对局走了足够多手", "实际生效 " + applied + " 手");
  check(rotations >= 3, "四维对局里真的发生了转动（否则 B 场景没验到转动）",
    "实际转动 " + rotations + " 次");
  eq(a.resyncs, 0, "四维全程没有触发过 resync");
  eq(a.checksumMismatch + b.checksumMismatch, 0, "四维全程没有出现过指纹不一致");
}

/* ==========================================================================
   场景 C：幂等 —— 同一个 id 重复投递
   ========================================================================== */
{
  const { room, a, b, seatA, seatB } = openRoom({
    dims: [8, 8, 8], cubic: true,
    rules: { winLength: 5, overlineLoses: true, restricted: 1,
             overlineTakesPrecedence: true, allowRotation: false, rotationCooldownPlacements: 5 },
  });

  // 先落一手，好让 undo 有东西可悔、也把出子权交给对方
  const m1 = { t: "place", id: "idem-1", x: 1, y: 1, z: 1 };
  const r1 = applyAction(room, seatA, m1);
  eq(r1.ok, true, "第一次 place 成功");
  for (const ev of r1.events) { a.receive(ev); b.receive(ev); }
  const countAfterFirst = room.session.moveCount;

  // 原样重发一次
  const r2 = applyAction(room, seatA, m1);
  eq(r2.ok, true, "重复投递同一个 id 仍然返回成功（回放上次结果，不是报错）");
  eq(room.session.moveCount, countAfterFirst, "重复投递**没有**多落一颗子");
  eq(r2.events === undefined || r2.events.length === 0, true,
    "重复投递不产生新事件（否则会对端重放一次）");

  // 换一个 id 走同样一步 —— 应该被内核拒（格子已被占），证明上面省掉的不是"越界检查"
  const r3 = applyAction(room, seatB, { t: "place", id: "idem-2", x: 1, y: 1, z: 1 });
  eq(r3.ok, false, "换 id 走同一格被拒（说明幂等表没有把'不同动作'误判成重复）");
  check(/已有棋子/.test(r3.reason), "拒绝理由是'该位置已有棋子'", "实际：" + r3.reason);
}

/* ==========================================================================
   场景 D：悔棋（请求-同意版）
   ========================================================================== */
{
  const { room, a, b, seatA, seatB } = openRoom({
    dims: [8, 8, 8], cubic: true,
    rules: { winLength: 5, overlineLoses: true, restricted: 1,
             overlineTakesPrecedence: true, allowRotation: false, rotationCooldownPlacements: 5 },
  });
  const feed = (r) => { for (const ev of r.events || []) { a.receive(ev); b.receive(ev); } };

  const step = (seat, msg) => { const r = applyAction(room, seat, msg); feed(r); return r; };

  // 出子权顺序（first = BLACK = seatA）：
  //   d1 A落 -> 轮到B    d2 B落 -> 轮到A    d3 A落 -> 轮到B
  // 所以**最后那一手的做出者是 A**，而此刻在等出子的是 B。
  // 这个区分是整段的关键：所有权看的是"谁下的最后一手"，不是"轮到谁"。
  step(seatA, { t: "place", id: "d1", x: 0, y: 0, z: 0 });
  step(seatB, { t: "place", id: "d2", x: 1, y: 1, z: 1 });
  step(seatA, { t: "place", id: "d3", x: 2, y: 2, z: 2 });
  eq(room.session.moveCount, 3, "前提：走了三手");
  eq(room.session.currentPlayer, seatB, "前提：现在轮到 B 出子");

  // --- D1 所有权：不是最后那一手的做出者，不能发起 ---
  const wrong = applyAction(room, seatB, { t: "undoReq", reqId: "req-x" });
  eq(wrong.ok, false, "B 不是最后那一手的做出者（A 才是），不能发起悔棋");
  check(/只能悔自己刚下的那一手/.test(wrong.reason), "拒绝理由说清了所有权",
    "实际：" + wrong.reason);

  // --- D2 正确的发起者 ---
  const req = applyAction(room, seatA, { t: "undoReq", reqId: "req-1" });
  eq(req.ok, true, "A 是最后那一手的做出者，可以发起");
  feed(req);
  eq(a.pending && a.pending.reqId, "req-1", "两个客户端都收到了待应答的请求");
  eq(room.pending !== null, true, "服务器记下了未决请求");

  // --- D3 未决期间**不锁棋盘**：正在等出子的 B 可以直接落子，而且这一手要成功 ---
  const interrupt = applyAction(room, seatB, { t: "place", id: "d4", x: 3, y: 3, z: 3 });
  eq(interrupt.ok, true, "未决期间对方（B）仍然可以落子 —— 不锁棋盘");
  const kinds = (interrupt.events || []).map((e) => e.t);
  eq(kinds[0], "undoResolved", "被接受的落子先把未决请求结算掉，顺序在 applied 之前");
  eq(interrupt.events[0].accept, false, "这一条是「取消」而不是「拒绝」");
  check(/作废|棋盘动过/.test(interrupt.events[0].reason), "理由说清了为什么作废",
    "实际：" + interrupt.events[0].reason);
  eq(kinds[1], "applied", "紧接着才是 applied");
  feed(interrupt);
  eq(room.pending, null, "未决请求已被清掉");
  eq(a.pending, null, "客户端那边的待应答提示也跟着清了");

  // --- D4 同意：真的悔一步 ---
  // 现在最后那一手是 B 下的（d4），所以轮到 B 发起。
  const countBeforeUndo = room.session.moveCount;
  const req2 = applyAction(room, seatB, { t: "undoReq", reqId: "req-2" });
  eq(req2.ok, true, "B 刚下完 d4，可以发起");
  feed(req2);

  const yes = applyAction(room, seatA, { t: "undoAnswer", reqId: "req-2", accept: true });
  eq(yes.ok, true, "对方同意");
  eq(room.session.moveCount, countBeforeUndo - 1, "同意之后真的悔了一步");
  eq(yes.events[0].t, "undoResolved", "先播 undoResolved（带 accept:true）");
  eq(yes.events[0].accept, true, "这一条是「同意」");
  eq(yes.events[1].t, "applied", "再播 applied —— 悔棋也是一个会改变棋局的已生效动作");
  eq(yes.events[1].action.t, "undo", "applied 里的动作类型是 undo");
  feed(yes);
  eq(a.fp, b.fp, "悔棋之后两边指纹仍然相同");
  eq(fingerprint(room.session), a.fp, "而且和服务器也相同");

  // --- D5 自己不能同意自己 ---
  // 悔掉 d4 之后，最后那一手回到 d3（A 下的），所以又能由 A 发起。
  const req3 = applyAction(room, seatA, { t: "undoReq", reqId: "req-3" });
  eq(req3.ok, true, "悔一步之后 A 又成了最后那一手的做出者");
  const self = applyAction(room, seatA, { t: "undoAnswer", reqId: "req-3", accept: true });
  eq(self.ok, false, "不能自己同意自己");
  check(/自己同意自己/.test(self.reason), "拒绝理由说清了", "实际：" + self.reason);

  // --- D6 撤回 ---
  const cancel = applyAction(room, seatA, { t: "undoCancel", reqId: "req-3" });
  eq(cancel.ok, true, "发起者可以撤回自己的请求");
  eq(room.pending, null, "撤回之后未决请求没了");
  feed(cancel);
  const cancel2 = applyAction(room, seatA, { t: "undoCancel", reqId: "req-3" });
  eq(cancel2.ok, false, "重复撤回被拒（已经没有未决请求了）");

  // --- D7 请求过期：reqId 对不上 ---
  step(seatA, { t: "place", id: "d7", x: 5, y: 5, z: 5 });
  const req5 = applyAction(room, seatA, { t: "undoReq", reqId: "req-5" });
  eq(req5.ok, true, "再发起一个");
  const stale = applyAction(room, seatB, { t: "undoAnswer", reqId: "req-老", accept: true });
  eq(stale.ok, false, "reqId 对不上的应答被拒");
  check(/过期/.test(stale.reason), "拒绝理由说清了是过期", "实际：" + stale.reason);
}

/* ==========================================================================
   场景 E：断线重连 —— 补发 + sync
   ========================================================================== */
{
  const { room, a, b, seatA, seatB } = openRoom({
    dims: [8, 8, 8], cubic: true,
    rules: { winLength: 5, overlineLoses: true, restricted: 1,
             overlineTakesPrecedence: true, allowRotation: false, rotationCooldownPlacements: 5 },
  });
  const feed = (r) => { for (const ev of r.events || []) { a.receive(ev); b.receive(ev); } };
  const step = (seat, msg) => { const r = applyAction(room, seat, msg); feed(r); return r; };

  for (let i = 0; i < 6; i++) {
    const seat = room.session.currentPlayer;
    step(seat, { t: "place", id: "e" + i, x: i, y: i, z: i });
  }
  eq(room.session.moveCount, 6, "前提：走了六手");

  // 补发日志的形状：state 是 seq 1，之后 6 手是 seq 2..7。
  // 断言它，免得下面那条 since=3 因为序号变了而悄悄失去意义。
  eq(room.events[0].t, "state", "补发日志的第一条是 state");
  eq(room.events[0].seq, 1, "state 的 seq 是 1");

  // --- E1 真实重连：EventSource 自动重连（同一个对象，内存里的会话还在） ---
  // 形状是"已经收到 seq ≤ 3，然后断了，重连时带 Last-Event-ID: 3"。
  const since = 3;
  const c = new FakeClient("C");
  for (const ev of room.events) if (ev.seq <= since) c.receive(ev);   // 断线前收到的
  eq(c.session.moveCount, 2, "前提：断开时 C 已经收到 2 手（seq 2 和 3）");

  let replayed = 0;
  for (const ev of room.events) if (ev.seq > since) { c.receive(ev); replayed++; }
  c.receive(S.syncOf(room));
  check(replayed > 0, "有事件被补发（否则下面那条是空断言）", "补发了 " + replayed + " 条");
  eq(c.resyncs, 0, "E1 全程不需要 resync —— 补发就够了");
  eq(c.fp, fingerprint(room.session), "断线重连后补发出的盘面和服务器逐字节相同");

  // --- E2 刷新页面：全新客户端，浏览器不带 Last-Event-ID，从 seq 1 全量重放 ---
  const d = new FakeClient("D");
  for (const ev of room.events) d.receive(ev);
  d.receive(S.syncOf(room));
  eq(d.resyncs, 0, "E2 全程不需要 resync");
  eq(d.fp, fingerprint(room.session), "刷新页面（从头重放）重放出的盘面和服务器逐字节相同");

  // --- E3 人为构造的坏状态：没有会话，却带着靠后的 Last-Event-ID ---
  // 现实中到不了这里（刷新会丢掉 Last-Event-ID，重连则内存里还有会话）。
  // 但**必须可检测**：客户端绝不能悄悄拿着一个空盘继续下，还觉得自己是对的。
  // 第一版测试就是栽在这儿 —— 它以为这种情况下补发能把盘面恢复出来，实际不能，
  // 而那恰恰是正确行为：检测器报警，客户端去 resync。
  const e3 = new FakeClient("E3");
  for (const ev of room.events) if (ev.seq > 5) e3.receive(ev);
  e3.receive(S.syncOf(room));
  check(e3.resyncs > 0, "缺少会话时补发 → 客户端察觉到了断层（而不是静默拿个空盘）",
    "resyncs = " + e3.resyncs);
  eq(e3.fp, fingerprint(FourDSession.create([8, 8, 8], BLACK, new S.RuleSet())),
    "而且它手里确实是个空盘 —— 正因如此，报警是必须的");

  // 重开：reset 必须是有 seq、可补发的事件
  const re = applyAction(room, seatA, { t: "restart", id: "e-restart" });
  eq(re.ok, true, "房主可以重开");
  const resetEv = (re.events || []).find((e) => e.t === "reset");
  check(!!resetEv, "重开产生了一条 reset 事件");
  eq(typeof resetEv.seq, "number", "reset 带 seq（所以它会进补发日志）");
  feed(re);
  eq(room.session.moveCount, 0, "重开之后落子数归零");
  eq(a.fp, b.fp, "重开之后两边指纹仍然相同");

  // 掉线期间发生的重开，对重连者必须可见
  const e2 = new FakeClient("E2");
  for (const ev of room.events) e2.receive(ev);
  e2.receive(S.syncOf(room));
  eq(e2.session.moveCount, 0, "掉线期间的重开，对重连者可见（靠的是 reset 进了补发日志）");

  // 非房主不能重开
  const bad = applyAction(room, seatB, { t: "restart", id: "e-restart-2" });
  eq(bad.ok, false, "非房主不能重开");
}

/* ==========================================================================
   场景 F：A1 / A2 那两个"初版真实犯过的错"必须被抓住
   ========================================================================== */
{
  // A1：place 的返回值没有 accepted 字段。这里直接断言那个事实，
  // 免得以后有人"顺手"给 place 的返回值加上 accepted 而把这条依赖改掉。
  const { room, seatA, seatB } = openRoom({
    dims: [8, 8, 8], cubic: true,
    rules: { winLength: 5, overlineLoses: true, restricted: 1,
             overlineTakesPrecedence: true, allowRotation: false, rotationCooldownPlacements: 5 },
  });
  const o = room.session.place(3, 3, 3);
  eq(o.accepted, undefined, "GameSession.place() 的返回值**没有** accepted 字段（A1 的根因）");
  eq(o.status, MoveStatus.Placed, "它有的是 status");

  // A2：rotate 只收一个 RotationMove，四参数版叫 rotateBy
  eq(typeof room.session.rotate, "function", "FourDSession.rotate 存在");
  eq(room.session.rotate.length, 1, "rotate 只收 1 个参数（所以 rotate(a,l,d,t) 一定错）");
  eq(typeof room.session.rotateBy, "function", "四参数版叫 rotateBy");
  eq(room.session.rotateBy.length, 4, "rotateBy 收 4 个参数");
  void seatA; void seatB;
}

/* ==========================================================================
   场景 G：指纹的判别力 + 回归基准值

   【为什么必须有这一节】注入验证发现：把 fingerprint 改成"永远返回常量"，
   上面所有"两边指纹相同"的断言**全部照样通过** —— 因为两端用的是同一个函数，
   它坏了两端一起坏，而"一致"这个性质仍然成立。

   所以指纹必须被**独立地**钉住，用两种手段：

     ① 回归基准值：把当前实现的输出写死。它的作用**不是**证明这个值是对的
        （没有独立对照物，证不了），而是**钉住算法**：以后谁改了指纹的算法、
        混入的字段、或者 FNV 的常数，这里立刻红。改基准值必须是一个**有意识的动作**。
     ② 判别力：不同的局面必须给出不同的指纹。这一条才真正对应它的用途 ——
        它要能发现分叉，就必须对分叉敏感。
   ========================================================================== */
{
  const R = (rot) => {
    const r = new S.RuleSet();
    r.allowRotation = !!rot; r.rotationCooldownPlacements = 3;
    return r;
  };
  const mk = (n, rot) => FourDSession.create(n, BLACK, R(rot));

  // --- G1 回归基准值 ---
  eq(fingerprint(mk(8, false)), "0e684e7d", "基准：8³ 空盘 黑先");
  eq(fingerprint(mk(9, false)), "7fd24970", "基准：9³ 空盘 黑先");
  eq(fingerprint(mk(10, false)), "324b7657", "基准：10³ 空盘 黑先");
  eq(fingerprint(FourDSession.create(10, WHITE, R(false))), "e45e4832", "基准：10³ 空盘 白先");

  // --- G2 判别力：出子权 ---
  const p = mk(8, false); p.place(0, 0, 0);                 // 落完自然是白出子
  eq(p.currentPlayer, WHITE, "  G2 前提：黑落完之后轮到白");
  eq(fingerprint(p), "20387bd8", "基准：8³ 落(0,0,0)、白出子");
  const q = mk(8, false); q.place(0, 0, 0);
  q.inner.currentPlayer = BLACK;                            // 只有出子权不同
  eq(q.currentPlayer, BLACK, "  G2 前提：强行把出子权掰回黑");
  eq(cellsOf(q), cellsOf(p), "  G2 前提：两者棋盘逐格相同");
  eq(fingerprint(q), "8a781041", "基准：同盘、黑出子（和上一行只差出子权）");
  ne(fingerprint(p), fingerprint(q),
    "G2 同盘不同出子权 -> 指纹不同（只看棋盘会漏掉这类分叉）");

  // --- G3 判别力：转动记录（四维最危险的一类）---
  const c = mk(10, true);
  c.place(1, 1, 0); c.place(2, 2, 0); c.place(3, 3, 0);
  eq(c.canRotate, true, "  G3 前提：冷却到了，转得动");
  const rot = c.rotateBy(AXIS_Z, 0, RotationDirection.Clockwise, 1);
  eq(rot.accepted, true, "  G3 前提：转动生效");
  eq(fingerprint(c), "236cf087", "基准：10³ 四维 三子 转过一次");

  const d2 = mk(10, true);
  d2.place(1, 1, 0); d2.place(2, 2, 0); d2.place(3, 3, 0);
  d2.rotateBy(AXIS_Z, 0, RotationDirection.Clockwise, 1);
  // 再推一条记录：棋盘、落子数、出子权全都不动，只有转动历史多一条。
  // 这是"只看棋盘"永远发现不了的分叉 —— 它会让「恢复本次转动」和冷却计算两边不一致。
  d2.rotations.push(new S.RotationRecord(new S.RotationMove(AXIS_Z, 0, 1), BLACK, 3, 3));
  eq(d2.currentPlayer, c.currentPlayer, "  G3 前提：出子权相同");
  eq(d2.moveCount, c.moveCount, "  G3 前提：落子数相同");
  eq(cellsOf(d2), cellsOf(c), "  G3 前提：棋盘逐格相同");
  eq(d2.rotationCount - c.rotationCount, 1, "  G3 前提：转动数差 1");
  eq(fingerprint(d2), "166ed54c", "基准：同盘同权、只多一条转动记录");
  ne(fingerprint(c), fingerprint(d2),
    "G3 同盘同出子权、只有转动记录不同 -> 指纹不同（四维最危险的那类分叉）");
}

/* ==========================================================================
   场景 H：非法输入不能打死服务器

   【为什么必须有这一节】注入验证发现：把 applyAction 里的 try/catch 去掉，
   整个测试**照样全绿** —— 因为测试从来没给内核喂过会抛异常的输入。
   而 ONLINE.md 的 A5 说的正是这个：一条 {"t":"rotate","layer":-1} 的 POST
   就能打死服务器进程。

   判据很简单：每条都返回 ok:false，而且跑完这一节之后**进程还活着**。
   ========================================================================== */
{
  const { room, seatA } = openRoom({
    dims: [10, 10, 10], cubic: true,
    rules: { winLength: 5, overlineLoses: true, restricted: 1,
             overlineTakesPrecedence: true, allowRotation: true, rotationCooldownPlacements: 3 },
  });
  // 让 seatA 落三手，把冷却凑够，这样转动类输入会真的走到内核那一层
  for (let i = 0; i < 3; i++) {
    applyAction(room, room.session.currentPlayer, { t: "place", id: "h" + i, x: i, y: i, z: 0 });
  }
  eq(room.session.canRotate, true, "  H 前提：现在转得动，非法转动参数会直达内核");

  const evil = [
    ["转动次数 4（内核会抛）", { t: "rotate", id: "h-r1", axis: 0, layer: 0, dir: 0, turns: 4 }],
    ["转动次数 0（内核会抛）", { t: "rotate", id: "h-r2", axis: 0, layer: 0, dir: 0, turns: 0 }],
    ["转动次数是字符串", { t: "rotate", id: "h-r3", axis: 0, layer: 0, dir: 0, turns: "2" }],
    ["层号为负（内核会抛）", { t: "rotate", id: "h-r4", axis: 0, layer: -1, dir: 0, turns: 1 }],
    ["层号越界", { t: "rotate", id: "h-r5", axis: 0, layer: 999, dir: 0, turns: 1 }],
    ["轴不是 0/1/2", { t: "rotate", id: "h-r6", axis: 9, layer: 0, dir: 0, turns: 1 }],
    ["轴是 undefined", { t: "rotate", id: "h-r7", axis: undefined, layer: 0, dir: 0, turns: 1 }],
    ["方向非法", { t: "rotate", id: "h-r8", axis: 0, layer: 0, dir: 7, turns: 1 }],
    ["坐标越界", { t: "place", id: "h-p1", x: 999, y: 999, z: 999 }],
    ["坐标是负数", { t: "place", id: "h-p2", x: -1, y: 0, z: 0 }],
    ["坐标是小数", { t: "place", id: "h-p3", x: 1.5, y: 2.5, z: 0.5 }],
    ["坐标是字符串", { t: "place", id: "h-p4", x: "1", y: "2", z: "3" }],
    ["坐标是 null/undefined", { t: "place", id: "h-p5", x: null, y: undefined, z: 0 }],
    ["坐标整个缺失", { t: "place", id: "h-p6" }],
    ["动作类型不存在", { t: "自爆", id: "h-x1" }],
    ["动作类型是数字", { t: 42, id: "h-x2" }],
  ];

  for (const [label, msg] of evil) {
    let r;
    try {
      r = applyAction(room, seatA, msg);
    } catch (e) {
      check(false, "H 非法输入【" + label + "】必须被拒绝，而不是抛出",
        "抛出了：" + e.message);
      continue;
    }
    eq(r.ok, false, "H 非法输入【" + label + "】被拒绝");
    check(typeof r.reason === "string" && r.reason.length > 0,
      "H 非法输入【" + label + "】带一句能读懂的原因", "reason = " + r.reason);
  }

  // 最硬的一条断言：跑到这里本身就证明进程没死。但把棋局状态也验一下，
  // 确保这些非法输入**一个都没留下痕迹**。
  eq(room.session.moveCount, 3, "H 16 条非法输入之后，棋局仍然停在三手");
  eq(room.session.rotationCount, 0, "H 16 条非法输入之后，一次转动都没发生过");
  check(true, "H 服务器进程在 16 条非法输入之后仍然活着");

  // 非法输入之后再走一手正常的，确认棋盘没被搞坏
  const okMsg = { t: "place", id: "h-after", x: 5, y: 5, z: 5 };
  const after = applyAction(room, room.session.currentPlayer, okMsg);
  eq(after.ok, true, "H 非法输入之后仍然可以正常落子");

  // --- H2 直接验证 try/catch 本身 ---
  //
  // 【为什么必须单独验】上面 16 条非法输入**全都到不了内核**：doRotate 的白名单
  // 在进内核之前就把它们挡掉了。也就是说 try/catch 那层**靠喂非法输入是验不到的** ——
  // 注入验证证实了这一点：把整块 try/catch 拿掉，16 条断言照样全绿。
  //
  // 它防的是"以后有人加了一条会抛异常的路径"。所以这里直接把一个会抛的方法挂上去，
  // 验的是**机制**而不是某个具体输入。
  const realPlace = room.session.place;
  room.session.place = () => { throw new Error("模拟内核抛异常"); };
  let threw = false, r2;
  try {
    r2 = applyAction(room, room.session.currentPlayer, { t: "place", id: "h-throw", x: 6, y: 6, z: 0 });
  } catch (e) {
    threw = true;
  } finally {
    room.session.place = realPlace;
  }
  eq(threw, false, "H2 内核抛出的异常**不许冒泡出去**（否则一条 POST 就能打死服务器进程）");
  eq(r2 && r2.ok, false, "H2 它被转成了一次普通的拒绝");
  check(r2 && /内核拒绝了这个动作/.test(r2.reason), "H2 而且带一句说明",
    "实际：" + (r2 && r2.reason));

  // H2 之后一切照常
  const r3 = applyAction(room, room.session.currentPlayer, { t: "place", id: "h-after2", x: 6, y: 6, z: 0 });
  eq(r3.ok, true, "H2 异常被接住之后，棋局照常继续");
}

/* ==========================================================================
   场景 I：只有一个人时不能下棋
   ========================================================================== */
{
  const r = createRoom({
    name: "独狼", dims: [8, 8, 8], mode: "3d", first: BLACK,
    rules: { winLength: 5, overlineLoses: true, restricted: 1,
             overlineTakesPrecedence: true, allowRotation: false, rotationCooldownPlacements: 5 },
  });
  eq(r.ok, true, "建房成功");
  eq(S.bothSeated(r.room), false, "前提：只有一个人");

  const solo = applyAction(r.room, r.seat, { t: "place", id: "i1", x: 0, y: 0, z: 0 });
  eq(solo.ok, false, "对方还没进来时不能落子");
  check(/对方还没进来/.test(solo.reason), "拒绝理由说清了是在等人", "实际：" + solo.reason);
  eq(r.room.session.moveCount, 0, "被拒之后棋盘还是空的");

  // 第二个人进来之后就可以了
  const j = joinRoom(r.room, { name: "来客" });
  eq(j.ok, true, "第二个人可以加入");
  const both = applyAction(r.room, r.seat, { t: "place", id: "i2", x: 0, y: 0, z: 0 });
  eq(both.ok, true, "两个人都就位之后可以落子");

  // 第三个人进不来
  const third = joinRoom(r.room, { name: "第三者" });
  eq(third.ok, false, "第三个人被拒绝（房间满了）");
  rooms.delete(r.room.id);
}

/* ==========================================================================
   场景 J：SSE 帧格式 + 悔棋超时

   用一个假的 res 对象挂进房间的 conns 里，就能截获服务器真正写出去的字节。
   这比"只看 applyAction 的返回值"强得多 —— 它验的是**线上格式**。
   ========================================================================== */
function parseFrames(chunks) {
  const out = [];
  for (const block of chunks.join("").split("\n\n")) {
    if (!block.trim()) continue;
    const lines = block.split("\n");
    const rec = { id: undefined, comment: null, data: null };
    for (const l of lines) {
      if (l.startsWith("id: ")) rec.id = Number(l.slice(4));
      else if (l.startsWith("data: ")) rec.data = JSON.parse(l.slice(6));
      else if (l.startsWith(":")) rec.comment = l;
    }
    if (rec.data || rec.comment) out.push(rec);
  }
  return out;
}
function attachProbe(room, seat) {
  const chunks = [];
  const res = { write(s) { chunks.push(s); return true; } };
  room.seats[seat].conns.add(res);
  return { chunks, parsed: () => parseFrames(chunks), clear: () => { chunks.length = 0; },
           detach: () => room.seats[seat].conns.delete(res) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

{
  const { room, seatA, seatB } = openRoom({
    dims: [8, 8, 8], cubic: true,
    rules: { winLength: 5, overlineLoses: true, restricted: 1,
             overlineTakesPrecedence: true, allowRotation: false, rotationCooldownPlacements: 5 },
  });
  const probe = attachProbe(room, seatB);

  // --- J1 SSE 帧格式：只有带 seq 的事件才写 id: 行 ---
  //
  // 【断言的是不变量，不是魔数】"id: 行 == 事件自己的 seq" 就是那条
  // 「有 seq ⟺ 进补发日志 ⟺ 带 id: 行」在线上格式里的样子。
  // 第一版把 seq 写死成 1/2，结果因为建房时那条 state 已经占了 seq=1 而失败 ——
  // 写死数字的断言既脆又什么都没说明。
  probe.clear();
  const seqBefore = room.seq;
  applyAction(room, seatA, { t: "place", id: "j1", x: 0, y: 0, z: 0 });
  let fr = probe.parsed();
  eq(fr.length, 1, "J1 落一手只写出一帧");
  eq(fr[0].data.t, "applied", "J1 帧内容是一条 applied");
  eq(fr[0].id, fr[0].data.seq, "J1 帧的 id: 行 == 事件的 seq");
  eq(fr[0].id, seqBefore + 1, "J1 seq 是单调递增的（比上一手大 1）");

  probe.clear();
  applyAction(room, seatB, { t: "place", id: "j2", x: 0, y: 1, z: 0 });   // 同列，不会被判胜
  fr = probe.parsed();
  eq(fr[0].id, fr[0].data.seq, "J1 第二帧同样满足 id == seq");

  // 悔棋握手类事件**不带 seq**，所以**不能有 id: 行** ——
  // 有的话浏览器的 Last-Event-ID 会被它推着前移，重连时就会跳过真正的棋局事件。
  probe.clear();
  applyAction(room, seatB, { t: "undoReq", reqId: "j-req" });
  fr = probe.parsed();
  eq(fr.length, 1, "J1 悔棋请求写出一帧");
  eq(fr[0].data.t, "undoAsked", "J1 帧内容是一条 undoAsked");
  eq(fr[0].id, undefined, "J1 **undoAsked 没有 id: 行**（它不进补发日志）");

  // 清掉未决请求，免得影响下面的超时测试
  applyAction(room, seatB, { t: "undoCancel", reqId: "j-req" });
  probe.clear();

  // --- J2 悔棋超时 + clearTimeout ---
  // 把超时压到 40ms。LIMITS 是导出对象，改它比等 60 秒现实得多。
  const savedMs = S.LIMITS.pendingUndoMs;
  S.LIMITS.pendingUndoMs = 40;
  try {
    // 现在最后那一手是 seatB 下的（j2），所以由 seatB 发起
    const req = applyAction(room, seatB, { t: "undoReq", reqId: "j-timeout" });
    eq(req.ok, true, "J2 发起悔棋请求");

    await sleep(150);   // 远超 40ms

    let resolved = probe.parsed().filter((f) => f.data && f.data.t === "undoResolved");
    eq(resolved.length, 1, "J2 超时之后**恰好**收到一条 undoResolved");
    eq(resolved[0].data.accept, false, "J2 超时的这一条是 accept:false");
    check(/60 秒|没回应/.test(resolved[0].data.reason), "J2 理由说明是对方没回应",
      "实际：" + resolved[0].data.reason);
    eq(room.pending, null, "J2 未决请求已被清掉");
    eq(room.session.moveCount, 2, "J2 超时**没有**真的悔棋（棋盘还是两手）");

    // 【这一条专抓 clearTimeout 的坑】再等一个超时周期，
    // 如果 cancelPending 忘了 clearTimeout，那个定时器会**再结算一次**。
    // 这个 bug 只在"玩家不回应"时出现，正常走一遍流程永远测不到。
    probe.clear();
    await sleep(150);
    resolved = probe.parsed().filter((f) => f.data && f.data.t === "undoResolved");
    eq(resolved.length, 0, "J2 再等一个周期，**没有第二条** undoResolved（clearTimeout 生效）");

    // 超时之后还能正常下棋
    const after = applyAction(room, room.session.currentPlayer, { t: "place", id: "j-after", x: 2, y: 2, z: 2 });
    eq(after.ok, true, "J2 超时之后棋局照常继续");
  } finally {
    S.LIMITS.pendingUndoMs = savedMs;
  }

  probe.detach();
}

/* ==========================================================================
   场景 K：不变量 —— **每一条改变 seq 的路径都必须先取消未决请求**

   【为什么单独列出来】doUndoAnswer 里那两道复核（"seq 动过吗""最后一手还是你吗"）
   当前是**不可达**的，靠的就是这条不变量。它一旦被打破，那两道复核就变成活代码 ——
   也就是说"悔棋有没有可能悔错一步"这件事，取决于这条不变量在这里是否被钉住。

   把三条路径各验一遍，等于把"复核是死代码"这个结论也纳入了证据链。
   ========================================================================== */
{
  const R4 = { winLength: 5, overlineLoses: true, restricted: 1,
               overlineTakesPrecedence: true, allowRotation: true, rotationCooldownPlacements: 3 };
  const { room, seatA, seatB } = openRoom({ dims: [10, 10, 10], cubic: true, rules: R4 });

  // 【这里的坑值得记一笔】"最后那一手的做出者"**不是** history 最后一条的 player。
  // 转动不写进 history，所以一次转动之后，最后那一手是**转动**，做出者是转动的那个人。
  // 第一版测试用 history[last].player 取，场景 K3 就取错了人（取到了转动前落子的那个），
  // 导致请求根本没发出去，后面的断言全落空。
  // 服务器里那个 lastActorOf 就是为这件事存在的 —— 这里直接用它，别自己再推一遍。
  const requestFrom = (reqId) => {
    const seat = S.lastActorOf(room.session);
    const r = applyAction(room, seat, { t: "undoReq", reqId });
    eq(r.ok, true, "K 前提：最后那一手的做出者（座位 " + seat + "）可以发起悔棋（" + reqId + "）");
    return r;
  };

  // --- K1 place 走 commit → 必须先取消 ---
  applyAction(room, room.session.currentPlayer, { t: "place", id: "k1a", x: 0, y: 0, z: 0 });
  requestFrom("k-req-1");
  eq(room.pending.seqAsked, room.seq, "K1 不变量成立：有未决请求时 seq 没动过");
  const pl = applyAction(room, room.session.currentPlayer, { t: "place", id: "k1b", x: 1, y: 1, z: 0 });
  eq(pl.ok, true, "K1 place 成功");
  eq(room.pending, null, "K1 place 之后未决请求被取消了");
  eq(pl.events[0].t, "undoResolved", "K1 而且取消这件事被播出去了（不是悄悄清掉）");

  // --- K2 rotate 走 commit → 必须先取消 ---
  // 先落够冷却
  for (let i = 0; i < 3; i++) {
    applyAction(room, room.session.currentPlayer, { t: "place", id: "k2p" + i, x: 2 + i, y: 5, z: 0 });
  }
  eq(room.session.canRotate, true, "K2 前提：冷却到了");
  requestFrom("k-req-2");
  const rt = applyAction(room, room.session.currentPlayer,
    { t: "rotate", id: "k2r", axis: AXIS_Z, layer: 0, dir: RotationDirection.Clockwise, turns: 1 });
  eq(rt.ok, true, "K2 rotate 成功");
  eq(room.pending, null, "K2 rotate 之后未决请求被取消了");
  eq(rt.events[0].t, "undoResolved", "K2 取消也播出去了");

  // --- K3 restart → 必须先取消 ---
  // 注意此刻最后那一手是**转动**，做出者是转动的那个人（不是 history 末尾的落子者）。
  requestFrom("k-req-3");
  const rs = applyAction(room, seatA, { t: "restart", id: "k3" });
  eq(rs.ok, true, "K3 房主重开成功");
  eq(room.pending, null, "K3 restart 之后未决请求被取消了");
  eq(rs.events[0].t, "undoResolved", "K3 取消排在最前面（在 reset 之前）");
  eq(rs.events[1].t, "reset", "K3 然后才是 reset");
  eq(rs.events[0].reason.indexOf("重开") >= 0, true,
    "K3 取消的理由说的是'房主重开了'，不是含糊的'作废了'");

  // --- K4 反过来说：只要没有未决请求，seq 就可以自由变化 ---
  eq(room.pending, null, "K4 前提：此刻没有未决请求");
  const seqBefore = room.seq;
  applyAction(room, room.session.currentPlayer, { t: "place", id: "k4", x: 7, y: 7, z: 0 });
  eq(room.seq, seqBefore + 1, "K4 没有未决请求时，place 正常推进 seq");
  eq(room.pending, null, "K4 而且没有凭空造出一个未决请求");
}

/* ==========================================================================
   收尾
   ========================================================================== */
console.log("联机协议测试：内核 " + S.CORE_HASH + "，逐格对拍 " + cheapChecks + " 组");
console.log("");
if (failures.length > 0) {
  console.log("失败项：");
  for (const f of failures) console.log("  ✗ " + f);
  console.log("");
}
console.log("  " + passed + " 项通过 / " + failures.length + " 项失败");
process.exit(failures.length === 0 ? 0 : 1);
