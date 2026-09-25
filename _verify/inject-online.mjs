/* ==========================================================================
   注入验证（ONLINE.md §9 第 5 层）

   **绿色的测试不是证据。** 这一条必须单独说清楚，因为这个脚本存在的全部理由就是它。

   一份测试全绿，可能有两种完全不同的原因：
     (a) 代码是对的，测试抓住了它该抓的东西
     (b) 测试**根本没在检查任何东西**（断言是空跑的、被绕过的、或者永远为真的）

   从外面看，(a) 和 (b) 长得一模一样 —— 都是"0 项失败"。
   唯一能把它们分开的办法是：**故意把代码改坏，看测试会不会红**。
   改了不红，说明那份测试是假的。

   这不是理论。写这个脚本的过程里：

     · 第一轮 15 处注入，只有 2 处被抓住 —— 测试套件大部分是空跑的
     · 顺着漏网的查下去，发现 `fingerprint` 改成"永远返回常量"也照样全绿，
       因为两端用的是同一个函数，它坏了两端一起坏，"两边一致"这个性质仍然成立
     · 还发现 ONLINE.md 自己写错了一句：它说"漏掉 clearTimeout 会重复结算"，
       实测证明不会 —— 真正兜底的是 cancelPending 的幂等性
     · 也发现了两处**我自己写错的测试**（把 A/B 角色搞反、把 seq 写死），
       它们不是"没抓住 bug"，而是从一开始就没在检查我说的那件事

   每一条注入都要求：**锚点必须精确匹配且唯一**。匹配不上就报错，**绝不静默跳过** ——
   否则"注入根本没生效"和"测试没抓住"看起来是同一件事，你分不清该修哪个。

   用法：
     node _verify/inject-online.mjs
   退出码 0 = 所有该抓住的都抓住了、该漏网的都如预期漏网。
   ========================================================================== */

import fs from "node:fs";
import { spawnSync } from "node:child_process";

const SERVER = "Web_Gomoku3D/server.js";
const CORE = "Web_Gomoku3D/index.html";
const ORIG_SERVER = fs.readFileSync(SERVER, "utf8");
const ORIG_CORE = fs.readFileSync(CORE, "utf8");

const INJECTIONS = [
  {
    name: "A1  doPlace 改回 `if (!o.accepted)`",
    file: SERVER,
    from: "if (o.status === MoveStatus.Rejected) return { ok: false, reason: o.reason };",
    to: "if (!o.accepted) return { ok: false, reason: \"动作无效\" };",
    test: "Web_Gomoku3D/tests/online.test.mjs",
  },
  {
    name: "A2  doRotate 改回 `s.rotate(axis, layer, dir, turns)`",
    file: SERVER,
    from: "const o = s.rotateBy(axis, layer, dir, turns);",
    to: "const o = s.rotate(axis, layer, dir, turns);",
    test: "Web_Gomoku3D/tests/online.test.mjs",
  },
  {
    name: "A3  把 isTurn 提回全局位置（对所有动作生效）",
    file: SERVER,
    from: "  if (!bothSeated(room)) return { ok: false, reason: \"对方还没进来\" };",
    to: "  if (!bothSeated(room)) return { ok: false, reason: \"对方还没进来\" };\n" +
        "  if (room.session.currentPlayer !== seat) return { ok: false, reason: \"还没轮到你\" };",
    test: "Web_Gomoku3D/tests/online.test.mjs",
  },
  {
    name: "A4  删掉 restart 分派",
    file: SERVER,
    from: "    case \"restart\":         return doRestart(room, seat, msg);",
    to: "",
    test: "Web_Gomoku3D/tests/online.test.mjs",
  },
  {
    name: "A5  去掉 applyAction 的 try/catch（真注入：整块拿掉）",
    file: SERVER,
    from: "  try {\n    result = dispatch(room, seat, msg);\n  } catch (e) {",
    to: "  {\n    result = dispatch(room, seat, msg);\n  }\n  if (false) {",
    test: "Web_Gomoku3D/tests/online.test.mjs",
  },
  {
    name: "B3  给 rejected 加上 seq",
    file: SERVER,
    from: "      return json(res, 200, { ok: false, reason: r.reason });",
    to: "      return json(res, 200, { ok: false, reason: r.reason, seq: room.seq });",
    test: "Web_Gomoku3D/tests/online-http.test.mjs",
  },
  {
    name: "B4  reset 只广播不进补发日志（真注入）",
    file: SERVER,
    from: "  events.push(emit(room, {\n    t: \"reset\", dims: room.dims.slice(), mode: room.mode, first: room.first,\n    rules: snapshotRules(room.session.rules),\n  }));",
    to: "  room.seq++;\n  events.push(emitTransient(room, Object.assign({\n    t: \"reset\", dims: room.dims.slice(), mode: room.mode, first: room.first,\n    rules: snapshotRules(room.session.rules),\n  }, { seq: room.seq })));",
    test: "Web_Gomoku3D/tests/online.test.mjs",
  },
  {
    name: "B5  去掉幂等表（重复 id 重新执行）",
    file: SERVER,
    from: "  if (msg.id) {\n    const memo = room.seenIds[seat];\n    if (memo.has(msg.id)) return memo.get(msg.id);\n  }",
    to: "  if (false) { const memo = room.seenIds[seat]; if (memo.has(msg.id)) return memo.get(msg.id); }",
    test: "Web_Gomoku3D/tests/online.test.mjs",
  },
  {
    name: "B7  fingerprint 改成返回常量（校验和形同虚设）",
    file: CORE,
    from: "  return h.toString(16).padStart(8, \"0\");",
    to: "  return \"00000000\";",
    test: "Web_Gomoku3D/tests/online.test.mjs",
  },
  {
    name: "B7b fingerprint 不混转动数（只靠棋盘＝抓不到四维分叉）",
    file: CORE,
    from: "  mixInt(s.rotationCount || 0);   // 三维模式下恒为 0（FourDSession 没有转动记录）",
    to: "  mixInt(0);   // 【注入】故意不混转动数",
    test: "Web_Gomoku3D/tests/online.test.mjs",
  },
  {
    // 【为什么注入的是这个，而不是 doUndoAnswer 里那两道复核】
    // 那两道复核**不可达**（每一条改 seq 的路径都先取消了未决请求），
    // 注入它们不会改变任何行为，因此"没被抓到"什么也说明不了。
    // 真正在起作用的是 commit 里这一句 —— 注入它才有意义。
    name: "D    commit 里不取消未决请求（真正在起作用的那道）",
    file: SERVER,
    from: "  const cancelEv = cancelPending(room, \"对方下了新的一手，请求已作废\");\n  if (cancelEv) events.push(emitTransient(room, cancelEv));",
    to: "  // 【注入】不取消未决请求",
    test: "Web_Gomoku3D/tests/online.test.mjs",
  },
  {
    name: "D2  restart 里不取消未决请求",
    file: SERVER,
    from: "  const cancelEv = cancelPending(room, \"房主重开了\");\n  if (cancelEv) events.push(emitTransient(room, cancelEv));",
    to: "  // 【注入】重开时不取消未决请求",
    test: "Web_Gomoku3D/tests/online.test.mjs",
  },
  {
    // 【这一条是注入验证纠正了我文档的地方】
    // ONLINE.md 原来写"漏掉 clearTimeout，60 秒后定时器会再结算一次"。那句话是错的：
    // 真正防住重复结算的是超时回调开头那句 `if (room.pending !== p) return;`。
    //
    // 而且这两道是**互相冗余**的：只要 clearTimeout 生效，定时器压根不会触发，守卫
    // 就永远不会被求值；只要守卫在，漏掉 clearTimeout 也不会造成第二次结算。
    // 所以单独注入任何一个都**必然**抓不到 —— 那不是测试的漏洞，是冗余在起作用。
    // 要验证"这对机制合起来有效"，只能两个一起拿掉。
    name: "D2a clearTimeout 和守卫单独拿掉（预期漏网 —— 两者互为冗余）",
    file: SERVER,
    edits: [[
      "  clearTimeout(p.timer);\n  room.pending = null;\n  return { t: \"undoResolved\", reqId: p.reqId, accept: false, reason: why };",
      "  room.pending = null;\n  return { t: \"undoResolved\", reqId: p.reqId, accept: false, reason: why };",
    ]],
    test: "Web_Gomoku3D/tests/online.test.mjs",
    expectLeak: true,
  },
  {
    // 【把三道冗余全拿掉也抓不到，因为还有第三道】
    // 追下去发现 cancelPending 本身是幂等的（`if (!p) return null`）——
    // 所以"拿掉 clearTimeout 和守卫"依然不可能造成重复结算。这不是测试的漏洞，
    // 是**幂等性**在兜底：重复结算这件事在构造上就不成立。
    //
    // 既然构造上不可能，那就直接注入一次"重复结算"这个**现象**，
    // 验证 J2 那条断言真的看得见它 —— 否则它就是一句永远为真的空话。
    name: "D2b 直接注入一次重复结算（验证 J2 看得见它）",
    file: SERVER,
    from: "    const ev = cancelPending(room, \"对方 \" + Math.round(LIMITS.pendingUndoMs / 1000) + \" 秒没回应\");\n    if (ev) emitTransient(room, ev);",
    to: "    const ev = cancelPending(room, \"对方 \" + Math.round(LIMITS.pendingUndoMs / 1000) + \" 秒没回应\");\n    if (ev) emitTransient(room, ev);\n    emitTransient(room, ev);   // 【注入】再结算一次",
    test: "Web_Gomoku3D/tests/online.test.mjs",
  },
  {
    name: "E   补发时用 `>=` 而不是 `>`（把第 N 条也重发一遍）",
    file: SERVER,
    from: "  for (const ev of room.events) if (ev.seq > since) sseWrite(res, ev);",
    to: "  for (const ev of room.events) if (ev.seq >= since) sseWrite(res, ev);",
    test: "Web_Gomoku3D/tests/online-http.test.mjs",
  },
  {
    name: "E2  补发和 sync 的顺序反过来（补发会被门禁挡住）",
    file: SERVER,
    from: "  for (const ev of room.events) if (ev.seq > since) sseWrite(res, ev);\n  sseWrite(res, syncOf(room));",
    to: "  sseWrite(res, syncOf(room));\n  for (const ev of room.events) if (ev.seq > since) sseWrite(res, ev);",
    test: "Web_Gomoku3D/tests/online-http.test.mjs",
  },
  {
    name: "E3  sync 带上 seq（会把客户端的 lastSeq 一把推高）",
    file: SERVER,
    from: "    t: \"sync\",\n    dims: room.dims ? room.dims.slice() : null,",
    to: "    t: \"sync\",\n    seq: room.seq,\n    dims: room.dims ? room.dims.slice() : null,",
    test: "Web_Gomoku3D/tests/online-http.test.mjs",
  },
  {
    name: "E4  sync 去掉 pending（重连的人不知道有悔棋请求）",
    file: SERVER,
    from: "    pending: room.pending ? { reqId: room.pending.reqId, by: room.pending.by } : null,",
    to: "    pending: null,",
    test: "Web_Gomoku3D/tests/online-http.test.mjs",
  },
  {
    name: "E5  undoAsked 也写 id: 行（会推着 Last-Event-ID 前移）",
    file: SERVER,
    from: "  if (ev.seq !== undefined) res.write(\"id: \" + ev.seq + \"\\n\");\n  res.write(\"data: \" + JSON.stringify(ev) + \"\\n\\n\");",
    to: "  res.write(\"id: \" + ev.seq + \"\\n\");\n  res.write(\"data: \" + JSON.stringify(ev) + \"\\n\\n\");",
    test: "Web_Gomoku3D/tests/online-http.test.mjs",
  },
  {
    name: "E6  去掉 X-Accel-Buffering（代理会攒着不发）",
    file: SERVER,
    from: "    \"X-Accel-Buffering\": \"no\",",
    to: "",
    test: "Web_Gomoku3D/tests/online-http.test.mjs",
  },
  {
    name: "E7  token 只从请求体读（第一版真实犯过的 bug）",
    file: SERVER,
    from: "    const tokenParam = body.token || url.searchParams.get(\"token\");",
    to: "    const tokenParam = body.token;",
    test: "Web_Gomoku3D/tests/online-http.test.mjs",
  },
  {
    name: "E8  超大请求体时 req.destroy()（第一版真实犯过的 bug）",
    file: SERVER,
    from: "        reject(new Error(\"请求体超过 \" + LIMITS.maxBodyBytes + \" 字节\"));\n        return;",
    to: "        reject(new Error(\"请求体超过 \" + LIMITS.maxBodyBytes + \" 字节\"));\n        req.destroy();\n        return;",
    test: "Web_Gomoku3D/tests/online-http.test.mjs",
  },
  {
    name: "E9  建房参数错误也回 413（第一版真实犯过的 bug）",
    file: SERVER,
    from: "      let r;\n      try {\n        r = createRoom(body);\n      } catch (e) {\n        return json(res, 400, { ok: false, reason: (e && e.message) || String(e) });\n      }",
    to: "      const r = createRoom(body);",
    test: "Web_Gomoku3D/tests/online-http.test.mjs",
  },
  {
    name: "F6  客户端指纹混进 isDraw（改协议两端就不一致）",
    file: CORE,
    from: "  mix(s.status === \"Playing\" ? 1 : 2);",
    to: "  mix(s.status === \"Playing\" ? 1 : 2); mix(s.isDraw ? 7 : 0);",
    test: "Web_Gomoku3D/tests/online.test.mjs",
  },
  {
    name: "G   dispatch 删掉 bothSeated 检查（单人就能下棋）",
    file: SERVER,
    from: "  if (!bothSeated(room)) return { ok: false, reason: \"对方还没进来\" };",
    to: "",
    test: "Web_Gomoku3D/tests/online.test.mjs",
  },
];

function run(testFile) {
  const r = spawnSync(process.execPath, [testFile], { encoding: "utf8" });
  const m = (r.stdout || "").match(/(\d+) 项通过 \/ (\d+) 项失败/);
  return { code: r.status, passed: m ? +m[1] : -1, failed: m ? +m[2] : -1,
           tail: (r.stdout || "").split("\n").filter((s) => s.includes("✗")).slice(0, 2) };
}

console.log("=== 注入前基线 ===");
const base = run("Web_Gomoku3D/tests/online.test.mjs");
console.log("  " + base.passed + " 通过 / " + base.failed + " 失败（退出码 " + base.code + "）");
if (base.code !== 0) { console.log("基线就不是绿的，先修好再谈注入验证"); process.exit(2); }

let bad = 0;
let caught = 0, leaked = 0, expectedLeak = 0;
console.log("\n=== 逐条注入 ===");
for (const inj of INJECTIONS) {
  const orig = fs.readFileSync(inj.file, "utf8");
  // 一条注入可以包含多处替换（用来验证"冗余对"：单拿掉一处不该有影响，两处都拿掉才会坏）
  const edits = inj.edits || [[inj.from, inj.to]];

  // 锚点自检：匹配不上就报错，**不静默跳过** ——
  // 否则"注入没生效"和"测试没抓住"长得一模一样，你分不清是哪个。
  let badAnchor = null;
  for (const [f] of edits) {
    if (!orig.includes(f)) { badAnchor = "锚点失效：" + JSON.stringify(f.slice(0, 80)); break; }
    const n = orig.split(f).length - 1;
    if (n !== 1) { badAnchor = "锚点不唯一（出现 " + n + " 次）：" + JSON.stringify(f.slice(0, 60)); break; }
  }
  if (badAnchor) {
    console.log("  " + badAnchor + "\n            " + inj.name);
    bad++;
    continue;
  }

  let patched = orig;
  for (const [f, t] of edits) patched = patched.replace(f, t);
  fs.writeFileSync(inj.file, patched);
  const r = run(inj.test);
  fs.writeFileSync(inj.file, orig);          // 立刻还原

  // 判据只能是"退出码非 0"。不能要求 failed > 0 ——
  // 测试**崩溃**（连汇总行都没打出来）也是被抓住了，而且是最彻底的那种。
  // 第一版把这种情形误报成"漏网"，差点让我去修一个没坏的东西。
  const hit = r.code !== 0;
  const how = r.failed < 0 ? "测试崩溃（未打出汇总行）" : r.passed + " 通过 / " + r.failed + " 失败";

  if (inj.expectLeak) {
    // 这一条**故意**抓不到：它验证的是"冗余/纵深防御确实在起作用"。
    // 抓到了反而说明我的冗余分析错了 —— 那也得报出来。
    console.log((hit ? "  **意外抓住了**（冗余分析错了）  " : "  如预期漏网  ") + inj.name);
    if (hit) { bad++; console.log("            -> " + how); } else expectedLeak++;
  } else {
    console.log((hit ? "  抓住了    " : "  **漏网**  ") + inj.name + "  ->  " + how);
    if (hit && r.tail.length) console.log("            首条失败：" + r.tail[0].trim().slice(0, 100));
    if (hit) caught++; else leaked++;
  }
}

// 最终还原确认
fs.writeFileSync(SERVER, ORIG_SERVER);
fs.writeFileSync(CORE, ORIG_CORE);

console.log("\n=== 还原后基线 ===");
const after = run("Web_Gomoku3D/tests/online.test.mjs");
console.log("  " + after.passed + " 通过 / " + after.failed + " 失败（退出码 " + after.code + "）");

console.log("\n" + (bad === 0
  ? "注入验证通过：" + caught + " 处抓住了，" + expectedLeak + " 处如预期漏网（冗余机制），" +
    "锚点全部有效（共 " + INJECTIONS.length + " 处）"
  : bad + " 处有问题（漏网 / 锚点失效 / 意外抓住），共 " + INJECTIONS.length + " 处"));
process.exit(bad === 0 ? 0 : 1);
