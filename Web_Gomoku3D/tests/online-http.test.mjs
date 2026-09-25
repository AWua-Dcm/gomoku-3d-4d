/* ==========================================================================
   联机协议测试（第 2.5 层：真实 HTTP + 真实 SSE）

   第 2 层（online.test.mjs）在进程内直调，绕过了网络层 —— 于是**网络层本身完全没被验过**，
   而 ONLINE.md §3.3 那三个坑（代理缓冲、连接数、心跳）全都在网络层里。这一层补上。

   用 node:http 自己发请求、自己读 SSE 流，**不引任何 HTTP 客户端库**（本工程零依赖）。

   【必须绑 127.0.0.1】Windows 上监听 0.0.0.0 会弹防火墙授权框，自动化步骤卡在那儿
   就永远不返回。绑 loopback 顺带也满足"没外网的机器上也能跑"。

   【--port 0】让系统分配空闲端口，从 stdout 的 READY 行拿端口 —— 写死端口号在 CI 上会撞。

   设计见 ONLINE.md §9 第 2.5 层。
   ========================================================================== */

import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "..", "server.js");

// ---------------------------------------------------------------------------
// 计数器
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

// ---------------------------------------------------------------------------
// 起服务器
// ---------------------------------------------------------------------------
const child = spawn(process.execPath,
  [SERVER, "--port", "0", "--host", "127.0.0.1"],
  { cwd: path.join(HERE, ".."), stdio: ["ignore", "pipe", "pipe"] });

let serverOut = "";
let ready = null;
const readyPromise = new Promise((resolve, reject) => {
  const to = setTimeout(() => reject(new Error("服务器 15 秒内没打出 READY 行。stdout:\n" + serverOut)), 15000);
  child.stdout.on("data", (c) => {
    serverOut += c.toString("utf8");
    const m = serverOut.match(/^READY (\{.*\})$/m);
    if (m && !ready) { ready = JSON.parse(m[1]); clearTimeout(to); resolve(ready); }
  });
  child.stderr.on("data", (c) => { serverOut += c.toString("utf8"); });
  child.on("exit", (code) => { clearTimeout(to); reject(new Error("服务器提前退出，码 " + code + "\n" + serverOut)); });
});
try {
  await readyPromise;
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

const PORT = ready.port;
const BASE = "http://127.0.0.1:" + PORT;
check(typeof PORT === "number" && PORT > 0, "服务器报出了端口", "READY = " + JSON.stringify(ready));
check(ready.host === "127.0.0.1", "服务器绑在了 loopback（不会弹防火墙框）", ready.host);
eq(ready.coreHash.length, 16, "READY 行里带内核哈希");

// ---------------------------------------------------------------------------
// HTTP 小工具
// ---------------------------------------------------------------------------
function request(method, path_, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
    const req = http.request(BASE + path_, {
      method,
      headers: Object.assign(
        payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {},
        headers || {}),
    }, (res) => {
      // 【防挂死】SSE 响应**永远不会结束**。误用 request() 去开流的话，
      // 这里会永远等不到 'end'，整个测试进程当场卡死 —— 而且没有任何报错，
      // 你只会看到命令一直不返回。第一版就是这么挂的（HTTP-2 里一行 hand 写的
      // await get("/events?…")）。按 Content-Type 直接判定，不要靠超时兜 ——
      // 超时会把"服务器真的慢"和"我调用错了"混成一件事。
      if (/text\/event-stream/.test(res.headers["content-type"] || "")) {
        res.destroy();
        return resolve({ status: res.statusCode, headers: res.headers,
                         text: "", json: null, wasSSE: true });
      }
      let text = "";
      res.on("data", (c) => { text += c.toString("utf8"); });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* 非 JSON 也允许 */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    // 网络层错误**不 reject** —— reject 会变成未处理的 Promise 拒绝，把整个测试进程
    // 打挂，而报错信息只有一个 "socket hang up"，指不到是哪条断言。
    // 解析成 status 0 让它在下一条 eq 里响亮地失败。
    req.on("error", (e) => resolve({ status: 0, headers: {}, text: "", json: null,
                                     netError: e.message }));
    if (payload) req.write(payload);
    req.end();
  });
}
const post = (p, body, headers) => request("POST", p, { body, headers });
const get = (p, headers) => request("GET", p, { headers });

/** 打开一条 SSE 流并持续收集。返回的对象可 await 到满足条件的帧。 */
function openSSE(room, token, lastEventId) {
  const state = { status: 0, headers: null, raw: "", frames: [], closed: false, res: null };
  const headers = lastEventId !== undefined ? { "Last-Event-ID": String(lastEventId) } : {};
  const done = new Promise((resolve, reject) => {
    const req = http.get(BASE + "/events?room=" + room + "&token=" + token, { headers }, (res) => {
      state.status = res.statusCode;
      state.headers = res.headers;
      state.res = res;
      res.on("data", (c) => { state.raw += c.toString("utf8"); state.frames = parseFrames(state.raw); });
      res.on("end", () => { state.closed = true; });
      resolve(state);
    });
    req.on("error", reject);
  });
  state.ready = done;
  state.close = () => { try { state.res && state.res.destroy(); } catch { /* 已经断了 */ } };
  return state;
}
function parseFrames(raw) {
  const out = [];
  for (const block of raw.split("\n\n")) {
    if (!block.trim()) continue;
    const rec = { id: undefined, comment: null, data: null };
    for (const l of block.split("\n")) {
      if (l.startsWith("id: ")) rec.id = Number(l.slice(4));
      else if (l.startsWith("data: ")) { try { rec.data = JSON.parse(l.slice(6)); } catch { /* 半个帧 */ } }
      else if (l.startsWith(":")) rec.comment = l;
    }
    if (rec.data || rec.comment) out.push(rec);
  }
  return out;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 等到 frames 满足条件，或超时。返回是否等到。 */
async function waitFor(s, pred, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred(s.frames)) return true;
    if (s.closed) return pred(s.frames);
    await sleep(25);
  }
  return pred(s.frames);
}
const dataOf = (s) => s.frames.filter((f) => f.data).map((f) => f.data);

/* ==========================================================================
   HTTP-1 静态托管
   ========================================================================== */
{
  const r = await get("/");
  eq(r.status, 200, "GET / 返回 200");
  check(/text\/html/.test(r.headers["content-type"] || ""), "Content-Type 是 HTML",
    r.headers["content-type"]);
  check(r.text.indexOf("GOMOKU-CORE-BEGIN") >= 0, "托管的就是那份 index.html（能找到内核标记）");
  check(r.text.indexOf("GOMOKU-CORE-END") >= 0, "内核区间是完整的");
  check(r.text.indexOf("<script>") >= 0, "script 块还在");

  const h = await get("/health");
  eq(h.status, 200, "GET /health 返回 200");
  eq(h.json.coreHash, ready.coreHash, "健康检查里的内核哈希和 READY 行一致");

  const nf = await get("/不存在的路径");
  eq(nf.status, 404, "未知路径返回 404");

  const wrongMethod = await get("/action");
  eq(wrongMethod.status, 404, "GET /action 返回 404（它只收 POST）");
}

/* ==========================================================================
   HTTP-2 建房 / 加入 / 参数校验
   ========================================================================== */
const RULES_3D = { winLength: 5, overlineLoses: true, restricted: 1,
                   overlineTakesPrecedence: true, allowRotation: false, rotationCooldownPlacements: 5 };
let ROOM, TOKEN_A, TOKEN_B, SEAT_A, SEAT_B;
{
  const r = await post("/action", { t: "create", name: "甲", dims: [8, 8, 8], mode: "3d",
                                    first: 1, rules: RULES_3D });
  eq(r.status, 200, "建房返回 200");
  eq(r.json.ok, true, "建房成功");
  check(/^\d{6}$/.test(r.json.room || ""), "房间号是 6 位数字", r.json.room);
  eq(r.json.seat, 1, "建房者执黑");
  check(typeof r.json.token === "string" && r.json.token.length > 10, "发了一个座位凭证");
  ROOM = r.json.room; TOKEN_A = r.json.token; SEAT_A = r.json.seat;

  // --- 各种非法建房 ---
  const badDims = await post("/action", { t: "create", name: "x", dims: [1, 1, 1], mode: "3d",
                                          first: 1, rules: RULES_3D });
  eq(badDims.status, 400, "尺寸越界 -> 400");
  check(/8 – 50/.test(badDims.json.reason || ""), "拒绝理由里给的范围是从内核 BoardLimits 取的",
    badDims.json.reason);

  const badDims2 = await post("/action", { t: "create", name: "x", dims: "abc", mode: "3d",
                                           first: 1, rules: RULES_3D });
  eq(badDims2.status, 400, "尺寸不是数字/数组 -> 400（而不是把进程打挂）");

  const modeMismatch = await post("/action", { t: "create", name: "x", dims: [8, 8, 8], mode: "4d",
                                               first: 1, rules: RULES_3D });
  eq(modeMismatch.status, 400, "mode 和 rules.allowRotation 对不上 -> 400");
  check(/对不上/.test(modeMismatch.json.reason || ""), "理由说清是这两者对不上",
    modeMismatch.json.reason);

  const hashMismatch = await post("/action", { t: "create", name: "x", dims: [8, 8, 8], mode: "3d",
                                               first: 1, rules: RULES_3D, coreHash: "deadbeefdeadbeef" });
  eq(hashMismatch.status, 400, "内核版本对不上 -> 400");
  check(/版本不一致/.test(hashMismatch.json.reason || ""), "理由说清是版本问题",
    hashMismatch.json.reason);

  const evilRules = await post("/action", { t: "create", name: "x", dims: [8, 8, 8], mode: "3d",
                                            first: 1,
                                            rules: Object.assign({}, RULES_3D, { winLength: 0 }) });
  eq(evilRules.status, 200, "winLength=0 建房本身被接受（白名单把它夹回默认值 5）");
  eq(evilRules.json.ok, true, "  —— 但规则被清洗过，不是原样采信");
  const evilRoom = evilRules.json.room, evilTok = evilRules.json.token;
  // 两个人就位，然后落一手。如果 winLength 真被采信成 0，第一手就会判胜 ——
  // 所以下面这条"棋局仍在进行"才是真正验到清洗生效的地方。
  await post("/action", { t: "join", name: "y", room: evilRoom });
  const afterEvil = await post("/action?room=" + evilRoom + "&token=" + evilTok,
                               { t: "place", id: "ev1", x: 0, y: 0, z: 0 });
  eq(afterEvil.json.ok, true, "  —— 落一手成功");
  const evilStream = openSSE(evilRoom, evilTok);
  await evilStream.ready;
  await waitFor(evilStream, (f) => f.some((x) => x.data && x.data.t === "sync"));
  const evilSync = dataOf(evilStream).find((d) => d.t === "sync");
  eq(evilSync.rules.winLength, 5, "**服务器把 winLength=0 夹回了默认的 5**（白名单生效）");
  eq(evilSync.rules.restricted, 1, "其余规则字段也来自默认值，不是客户端那个对象");
  evilStream.close();

  // --- 加入 ---
  const j = await post("/action?room=" + ROOM, { t: "join", name: "乙" });
  eq(j.status, 200, "加入返回 200");
  eq(j.json.seat, 2, "加入者执白");
  TOKEN_B = j.json.token; SEAT_B = j.json.seat;
  check(TOKEN_B !== TOKEN_A, "两个座位的凭证不同");

  const third = await post("/action?room=" + ROOM, { t: "join", name: "丙" });
  eq(third.status, 400, "第三个人加入被拒");
  check(/满了/.test(third.json.reason || ""), "理由说清是满了", third.json.reason);

  const reconnect = await post("/action?room=" + ROOM, { t: "join", name: "乙", token: TOKEN_B });
  eq(reconnect.status, 200, "带 token 重连返回 200");
  eq(reconnect.json.seat, 2, "重连回到原来的座位（不会被挤到别的座位）");
  eq(reconnect.json.reconnect, true, "而且标明了这是一次重连");
  eq(reconnect.json.token, TOKEN_B, "凭证不变");

  const noRoom = await post("/action?room=000000", { t: "join", name: "x" });
  eq(noRoom.status, 404, "加入不存在的房间 -> 404");
}

/* ==========================================================================
   HTTP-3 SSE：帧格式、补发、sync
   ========================================================================== */
{
  const noToken = await get("/events?room=" + ROOM);
  eq(noToken.status, 403, "没带 token 开流 -> 403");

  const badToken = await get("/events?room=" + ROOM + "&token=乱写");
  eq(badToken.status, 403, "token 不对 -> 403");

  const badRoom = await get("/events?room=999999&token=" + TOKEN_A);
  eq(badRoom.status, 404, "房间不存在 -> 404");

  // --- 正常开一条流 ---
  const s = openSSE(ROOM, TOKEN_A);
  await s.ready;
  eq(s.status, 200, "带正确 token 开流 -> 200");
  check(/text\/event-stream/.test(s.headers["content-type"] || ""), "Content-Type 是 event-stream",
    s.headers["content-type"]);
  eq(s.headers["x-accel-buffering"], "no", "带了 X-Accel-Buffering: no（叫代理别攒）");
  check(/no-cache/.test(s.headers["cache-control"] || ""), "带了 no-cache", s.headers["cache-control"]);

  // 第一条应该是注释行 —— 立刻吐一个字节，让客户端和中间设备都知道流活了
  await waitFor(s, (f) => f.length > 0, 2000);
  check(s.frames.length > 0 && s.frames[0].comment === ": connected",
    "开流后第一件事是吐一个注释行（探活）",
    JSON.stringify(s.frames[0]));

  // 建房时那条 state 应该被补发出来
  eq(await waitFor(s, (f) => f.some((x) => x.data && x.data.t === "state")), true,
    "开流后补发出了 state（建房时写进补发日志的那条）");
  eq(await waitFor(s, (f) => f.some((x) => x.data && x.data.t === "sync")), true,
    "补发之后跟了一条 sync");

  const initial = dataOf(s);
  const stateEv = initial.find((d) => d.t === "state");
  const syncEv = initial.find((d) => d.t === "sync");
  eq(stateEv.seq, 1, "state 的 seq 是 1（补发日志的第一条）");
  eq(stateEv.dims.join(","), "8,8,8", "state 带上了尺寸");
  eq(stateEv.first, 1, "state 带上了先手");
  eq(stateEv.rules.winLength, 5, "state 带上了规则快照");

  // 【关键】sync 不带 seq —— 它不动客户端的 lastSeq 门禁
  eq("seq" in syncEv, false, "sync **不带 seq**（带了会把 lastSeq 一把推到当前值，补发全被挡掉）");
  eq(syncEv.started, true, "sync 说两个人已经就位");
  eq(syncEv.pending, null, "sync 说没有未决的悔棋请求");
  eq(syncEv.moveCount, 0, "sync 说还没落子");

  // 补发在前、sync 在后 —— 顺序定死
  const iState = initial.findIndex((d) => d.t === "state");
  const iSync = initial.findIndex((d) => d.t === "sync");
  check(iState < iSync, "补发在前、sync 在后（反过来的话补发会被门禁挡住）",
    "state 在第 " + iState + " 条，sync 在第 " + iSync + " 条");

  // --- 落一手，看它怎么推下来 ---
  const place = await post("/action?room=" + ROOM + "&token=" + TOKEN_A,
                           { t: "place", id: "http-p1", x: 0, y: 0, z: 0 });
  eq(place.status, 200, "落子返回 200");
  eq(place.json.ok, true, "落子成功");
  eq(await waitFor(s, (f) => f.some((x) => x.data && x.data.t === "applied")), true,
    "SSE 里收到了 applied");

  const ap = dataOf(s).find((d) => d.t === "applied");
  eq(ap.by, SEAT_A, "applied 标明了是谁走的");
  eq(ap.action.t, "place", "applied 里带的是动作本身（不是盘面）");
  eq(typeof ap.checksum, "string", "applied 带了指纹（分歧检测靠它）");
  eq(ap.checksum.length, 8, "指纹是 8 位十六进制");
  const apFrame = s.frames.find((f) => f.data && f.data.t === "applied");
  eq(apFrame.id, ap.seq, "**id: 行 == 事件的 seq**（那条三合一的不变量在线上格式里的样子）");

  s.close();
}

/* ==========================================================================
   HTTP-4 B3：拒绝的线上格式**不带 seq**

   【为什么只能在这一层验】rejected 走的是 POST 的响应体，不是 SSE。
   进程内直调看不到"响应体长什么样"。
   ========================================================================== */
{
  // 轮到白方了（黑刚下过），让黑再下一次 —— 会被"还没轮到你"拒掉
  const r = await post("/action?room=" + ROOM + "&token=" + TOKEN_A,
                       { t: "place", id: "http-bad1", x: 5, y: 5, z: 5 });
  eq(r.status, 200, "被拒的动作返回 200（这是业务拒绝，不是 HTTP 错误）");
  eq(r.json.ok, false, "ok 是 false");
  check(typeof r.json.reason === "string" && r.json.reason.length > 0, "带一句能读懂的理由",
    r.json.reason);
  eq("seq" in r.json, false,
    "**拒绝的响应体里没有 seq** —— 有的话客户端会把它当成事件序号推进门禁，然后静默丢弃真事件");

  // 占位（同一个格子）也是一种拒绝
  const r2 = await post("/action?room=" + ROOM + "&token=" + TOKEN_B,
                        { t: "place", id: "http-bad2", x: 0, y: 0, z: 0 });
  eq(r2.json.ok, false, "落在已有棋子的位置被拒");
  eq("seq" in r2.json, false, "这类拒绝同样不带 seq");
  check(/已有棋子/.test(r2.json.reason || ""), "理由说得具体", r2.json.reason);

  // 凭证不对
  const r3 = await post("/action?room=" + ROOM + "&token=乱写", { t: "place", id: "x", x: 1, y: 1, z: 1 });
  eq(r3.status, 403, "凭证不对 -> 403");
}

/* ==========================================================================
   HTTP-5 E：补发的边界 —— 带 Last-Event-ID: N 时，第 N 条**不能**被重发
   ========================================================================== */
{
  // 先多走几手，让补发日志长一点。
  // 【必须交替出子】第一版只拿 TOKEN_B 连下四手，结果只有第一手成功 ——
  // 服务器校验出子权，后面三手都被"还没轮到你"拒了，seq 只到 3，
  // 于是 Last-Event-ID=3 什么都补不出来，那几条断言变成了空跑。
  // 每手都断言成功，这样出子权一旦变了这里会先响。
  for (let i = 0; i < 4; i++) {
    const tok = (i % 2 === 0) ? TOKEN_B : TOKEN_A;   // HTTP-3 那一手是 A 下的，所以轮到 B
    const r = await post("/action?room=" + ROOM + "&token=" + tok,
                         { t: "place", id: "http-e" + i, x: 1 + i, y: 0, z: 0 });
    eq(r.json && r.json.ok, true, "HTTP-5 造事件用的第 " + (i + 1) + " 手落子成功",
      JSON.stringify(r.json));
  }
  const probe = openSSE(ROOM, TOKEN_A);
  await probe.ready;
  await waitFor(probe, (f) => f.some((x) => x.data && x.data.t === "sync"));
  const all = dataOf(probe);
  probe.close();

  const seqs = all.filter((d) => d.seq !== undefined).map((d) => d.seq);
  check(seqs.length >= 3, "补发日志里有足够多的带 seq 事件（否则下面几条是空断言）",
    "共 " + seqs.length + " 条：" + seqs.join(","));
  eq(seqs[0], 1, "从头补发时第一条是 seq 1");

  for (const since of [1, 2, 3]) {
    const p = openSSE(ROOM, TOKEN_A, since);
    await p.ready;
    await waitFor(p, (f) => f.some((x) => x.data && x.data.t === "sync"));
    const got = p.frames.filter((f) => f.data && f.data.seq !== undefined).map((f) => f.id);
    p.close();
    check(got.length > 0, "Last-Event-ID=" + since + " 时有事件被补发", "补发了 " + got.length + " 条");
    eq(got[0], since + 1,
      "Last-Event-ID=" + since + " 时**从 " + (since + 1) + " 开始**补发（第 " + since + " 条不重发）");
    eq(got.every((s2) => s2 > since), true,
      "Last-Event-ID=" + since + " 时补发的每一条都严格大于它");
  }

  // Last-Event-ID 超过最新 seq：什么都不补发，但仍然要发 sync
  const future = openSSE(ROOM, TOKEN_A, 99999);
  await future.ready;
  await waitFor(future, (f) => f.some((x) => x.data && x.data.t === "sync"));
  eq(future.frames.filter((f) => f.data && f.data.seq !== undefined).length, 0,
    "Last-Event-ID 超过最新 seq 时不补发任何事件");
  check(future.frames.some((f) => f.data && f.data.t === "sync"),
    "但 sync 照发（它是连接握手，和补发无关）");
  future.close();
}

/* ==========================================================================
   HTTP-6 悔棋走真 HTTP（含 sync 里带回 pending）
   ========================================================================== */
{
  const s = openSSE(ROOM, TOKEN_A);
  await s.ready;
  await waitFor(s, (f) => f.some((x) => x.data && x.data.t === "sync"));

  // 找出最后那一手是谁下的：从补发日志里最后一条 applied 读 by
  const last = dataOf(s).filter((d) => d.t === "applied").pop();
  const actor = last.by;
  const actorToken = actor === SEAT_A ? TOKEN_A : TOKEN_B;
  const otherToken = actor === SEAT_A ? TOKEN_B : TOKEN_A;

  const req = await post("/action?room=" + ROOM + "&token=" + actorToken,
                         { t: "undoReq", reqId: "http-req-1" });
  eq(req.status, 200, "发起悔棋返回 200");
  eq(req.json.ok, true, "最后那一手的做出者可以发起");

  eq(await waitFor(s, (f) => f.some((x) => x.data && x.data.t === "undoAsked")), true,
    "对方收到了 undoAsked");
  const asked = dataOf(s).find((d) => d.t === "undoAsked");
  eq(asked.reqId, "http-req-1", "带上了 reqId");
  eq(asked.by, actor, "标明了是谁请求的");
  const askedFrame = s.frames.find((f) => f.data && f.data.t === "undoAsked");
  eq(askedFrame.id, undefined, "undoAsked **不带 id: 行**（它不进补发日志）");

  // 【关键】未决期间新开一条流，sync 里必须带回 pending
  const s2 = openSSE(ROOM, otherToken);
  await s2.ready;
  await waitFor(s2, (f) => f.some((x) => x.data && x.data.t === "sync"));
  const sync2 = dataOf(s2).find((d) => d.t === "sync");
  check(sync2.pending !== null && sync2.pending !== undefined,
    "新连接（= 重连的人）从 sync 里就知道有一个待应答的悔棋请求");
  eq(sync2.pending.reqId, "http-req-1", "pending 里带上了 reqId");
  eq(sync2.pending.by, actor, "pending 里带上了是谁请求的");
  s2.close();

  // 同意
  const before = dataOf(s).filter((d) => d.t === "applied").length;
  const ans = await post("/action?room=" + ROOM + "&token=" + otherToken,
                         { t: "undoAnswer", reqId: "http-req-1", accept: true });
  eq(ans.json.ok, true, "同意返回 ok");
  eq(await waitFor(s, (f) => f.some((x) => x.data && x.data.t === "undoResolved")), true,
    "收到了 undoResolved");
  const res = dataOf(s).find((d) => d.t === "undoResolved");
  eq(res.accept, true, "这一条是同意");
  // 注意 waitFor 的谓词收到的是**帧数组**，不是流对象 —— dataOf 要的是后者
  eq(await waitFor(s, (f) => f.filter((x) => x.data && x.data.t === "applied").length > before), true,
    "同意之后多了一条 applied（悔棋真的生效了）");
  const undoApplied = dataOf(s).filter((d) => d.t === "applied").pop();
  eq(undoApplied.action.t, "undo", "而且那条 applied 的动作类型是 undo");
  seqCheck(undoApplied, "悔棋的 applied 也带 seq");
  function seqCheck(ev, label) { eq(typeof ev.seq, "number", label); }

  s.close();
}

/* ==========================================================================
   HTTP-7 资源上限
   ========================================================================== */
{
  // 请求体上限。这一条同时验证"超限时**没有**粗暴地把 socket 掐掉" ——
  // 掐掉的话客户端拿到的是 ECONNRESET（status 0），而不是一个能读懂的 413。
  const big = await post("/action", { t: "create", name: "x".repeat(5000), dims: [8, 8, 8],
                                      mode: "3d", first: 1, rules: RULES_3D });
  eq(big.netError, undefined, "超大请求体不会让客户端拿到网络层错误", big.netError);
  eq(big.status, 413, "超过 4KB 的请求体被拒（413）");
  check(/超过/.test((big.json && big.json.reason) || ""), "413 的响应体里说明了原因",
    JSON.stringify(big.json));

  // 不是 JSON
  const notJson = await new Promise((resolve, reject) => {
    const body = Buffer.from("这不是 JSON", "utf8");
    const req = http.request(BASE + "/action", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": body.length },
    }, (res) => {
      let t = ""; res.on("data", (c) => { t += c; });
      res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch { } resolve({ status: res.statusCode, json: j }); });
    });
    req.on("error", reject); req.write(body); req.end();
  });
  eq(notJson.status, 400, "请求体不是 JSON -> 400");

  // 缺少动作类型
  const noType = await post("/action", { name: "x" });
  eq(noType.status, 400, "缺少 t 字段 -> 400");

  // 频率限制：并发打 80 次，limit 是 30/秒，应该有相当一部分被 429 挡掉。
  // 打 30 次是不够的 —— 那正好卡在边界上，测出来的结果取决于机器快慢。
  const burst = await Promise.all(Array.from({ length: 80 }, (_, i) =>
    post("/action?room=" + ROOM + "&token=" + TOKEN_A, { t: "place", id: "burst" + i, x: 0, y: 0, z: 0 })));
  const limited = burst.filter((r) => r.status === 429).length;
  check(limited > 0, "并发 80 次会被频率限制挡掉一部分", "被挡 " + limited + " 次");
  check(limited < burst.length, "但不是**全部**被挡（否则说明限流把正常请求也误伤了）",
    "被挡 " + limited + " / " + burst.length);
  eq(await (async () => { const h = await get("/health"); return h.status; })(), 200,
    "而且服务器仍然活着");
  // 洪水过后静置一秒，应该恢复正常
  await sleep(1100);
  const after = await get("/health");
  eq(after.status, 200, "静置一秒后恢复（限流是按秒滑动的，不是永久封禁）");
}

/* ==========================================================================
   收尾
   ========================================================================== */
try { child.kill(); } catch { /* 已经退了 */ }

console.log("联机 HTTP 测试：端口 " + PORT + "，内核 " + ready.coreHash);
console.log("");
if (failures.length > 0) {
  console.log("失败项：");
  for (const f of failures) console.log("  ✗ " + f);
  console.log("");
}
console.log("  " + passed + " 项通过 / " + failures.length + " 项失败");
process.exit(failures.length === 0 ? 0 : 1);
