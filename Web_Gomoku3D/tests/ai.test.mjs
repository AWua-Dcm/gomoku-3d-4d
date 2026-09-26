// 电脑对手（弱人工智能）的测试。
//
// 【这套断言是按"能抓住哪一种具体的错实现"挑的，不是按覆盖率凑数】
// 每一类都有一个**可信的、会写出来的**错法对应：
//   · `run >= winLength → 赢`      → 第 2 组（长连两侧）当场红
//   · 用 Math.random 当随机源       → 第 6 组（确定性 / 源码检查）
//   · 每手调一次 fullScan           → 源码级断言 + 计时
//   · 照抄网上的"半径 2"            → 候选规模的断言
//   · 自己写一遍转动的过滤条件       → 第 7 组（probeRotate 与 rotate 逐字段等价）
//   · 挑了一手引擎会拒的动作         → 第 5 组（自对局，逐手真喂给引擎）
// 最后一条最要紧：它会表现成"电脑再也不动了"，而那种症状极难倒查到 AI 头上。
//
// 运行：node Web_Gomoku3D/tests/ai.test.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.join(HERE, "..", "index.html");

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
// 1. 抽出 script、抽内核。和 rules.test.mjs 同一套做法。
// ---------------------------------------------------------------------------
const html = fs.readFileSync(HTML_PATH, "utf8");
const scriptStart = html.indexOf("<script>");
const scriptEnd = html.lastIndexOf("</script>");
if (scriptStart < 0 || scriptEnd < 0) {
  console.error("index.html 里找不到 <script> 块");
  process.exit(2);
}
const fullScript = html.slice(scriptStart + "<script>".length, scriptEnd);

try {
  new Function(fullScript);          // 只编译不执行：抓语法错误
  passed++;
} catch (e) {
  failures.push("index.html 的 script 块有语法错误：" + e.message);
}
try {
  // 执行顶层代码。末尾的 typeof 守卫会让它不去碰 DOM。
  new Function(fullScript)();
  passed++;
} catch (e) {
  failures.push("index.html 的 script 顶层执行失败：" + e.message);
}

const BEGIN = "/* GOMOKU-CORE-BEGIN */";
const END = "/* GOMOKU-CORE-END */";
const coreSource = fullScript.slice(fullScript.indexOf(BEGIN) + BEGIN.length,
                                    fullScript.indexOf(END));

let Core;
try {
  Core = new Function(coreSource + `
    return { Board3D, RuleSet, RuleEngine, GameSession, FourDSession, DIRS13, MoveStatus,
             EMPTY, BLACK, WHITE, opponentOf, fingerprint,
             RotationMove, RotateStatus, AXIS_X, AXIS_Y, AXIS_Z,
             aiChooseMove, aiCandidates, aiRng, AI_LEVELS, AI_PARAMS };`)();
  passed++;
} catch (e) {
  console.error("内核求值失败：" + e.message + "\n" + (e.stack || ""));
  process.exit(2);
}
const { RuleSet, RuleEngine, GameSession, FourDSession, MoveStatus, EMPTY, BLACK, WHITE,
        opponentOf, fingerprint, RotationMove, RotateStatus, AXIS_X, AXIS_Y, AXIS_Z,
        aiChooseMove, aiCandidates, aiRng, AI_LEVELS, AI_PARAMS } = Core;

console.log("三档：" + AI_LEVELS.join(" / ") + "；方向数 " + Core.DIRS13.length);

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/** 测试自己的 PRNG。**测试也不许用 Math.random** —— 随机局面要能复现，红的时候才查得动。 */
function rngOf(seed) { return aiRng(seed); }

function mkSession(n, firstPlayer, fourD, cooldown) {
  const rules = new RuleSet();
  rules.allowRotation = !!fourD;
  if (cooldown) rules.rotationCooldownPlacements = cooldown;
  return FourDSession.create(n, firstPlayer, rules);
}

/** 直接往盘上摆子（绕过 place，所以不产生 history）。构造局面用。 */
function put(s, player, cells) {
  for (const c of cells) s.board.set(c[0], c[1], c[2], player);
}

/** 把 AI 选的动作真的落到会话上。返回 engine 给的结果。 */
function applyAction(s, act) {
  if (act.kind === "place") return s.place(act.x, act.y, act.z);
  if (act.kind === "rotate") {
    return s.rotate(RotationMove.fromClockwiseTurns(act.axis, act.layer, act.turns));
  }
  return null;
}

/** 判一手棋的结果 —— 先把子摆上、问 judge、再撤掉。 */
function judgeAt(s, act, player) {
  const b = s.board;
  b.set(act.x, act.y, act.z, player);
  const o = RuleEngine.judge(b, { x: act.x, y: act.y, z: act.z }, player,
                             s.firstPlayer, s.rules);
  b.set(act.x, act.y, act.z, EMPTY);
  return o;
}

// ---------------------------------------------------------------------------
// 2. 两条硬规则之一：能立刻赢就必须赢。**而且长连规则两侧都要判对。**
//
// 【为什么这一组最重要】网上所有五子棋教程的写法都是 `run >= winLength → 赢`。
// 本作不是这样：**先手方必须恰好 winLength 连，连多了当场判负**，
// 而且一手同时做出 winLength 和更长时长连优先。照着教程写，电脑会主动把自己补成六连然后输掉，
// 而玩家一眼就看得出来"它本来能赢却没赢"。
// ---------------------------------------------------------------------------

/**
 * 一个只留一个"成五点"的局面：
 *   y=5,z=5 上白子摆成 3,4,5,6,8，中间 7 空着；两端 2 和 9 用黑子堵死。
 *   白下 7 → 连成 3..8 共 6 颗。
 *     白是后手（不受限）→ ≥winLength 即胜
 *     白是先手（受限）  → 六连判负，(6,5,5) 反而是白【不能下】的点
 * 于是同一个局面能一次问出两种身份的答案，而且答案相反。
 */
function buildSixOrFive(s, winLength) {
  const w = [];
  for (const x of [3, 4, 5, 6]) w.push([x, 5, 5]);
  w.push([8, 5, 5]);
  put(s, WHITE, w);
  put(s, BLACK, [[2, 5, 5], [9, 5, 5]]);
  s.inner.currentPlayer = WHITE;
}

for (const level of AI_LEVELS) {
  // --- 后手身份：下 (7,5,5) 就是胜，必须下
  const s1 = mkSession(15, BLACK, false);
  buildSixOrFive(s1, 5);
  const a1 = aiChooseMove(s1, { level, seed: 11 });
  const j1 = a1.kind === "place" ? judgeAt(s1, a1, WHITE) : null;
  check(a1.kind === "place" && a1.x === 7 && a1.y === 5 && a1.z === 5 && j1 && j1.status === MoveStatus.Win,
        "后手方成六即胜，电脑必须下那一手 [" + level + "]",
        "选了 " + JSON.stringify(a1) + " judge=" + (j1 && j1.status));

  // --- 先手身份：同一手会让自己判负，绝不能下
  const s2 = mkSession(15, WHITE, false);
  buildSixOrFive(s2, 5);
  const a2 = aiChooseMove(s2, { level, seed: 11 });
  const isSix = a2.kind === "place" && a2.x === 7 && a2.y === 5 && a2.z === 5;
  check(!isSix, "先手方不能走成六连自尽 [" + level + "]", "选了 " + JSON.stringify(a2));
}

// 先手方要赢只能"恰好 winLength"：两端都通时随便哪头都行
for (const level of AI_LEVELS) {
  const s = mkSession(15, WHITE, false);
  put(s, WHITE, [[3, 5, 5], [4, 5, 5], [5, 5, 5], [6, 5, 5]]);
  s.inner.currentPlayer = WHITE;
  const a = aiChooseMove(s, { level, seed: 5 });
  const j = a.kind === "place" ? judgeAt(s, a, WHITE) : null;
  check(j && j.status === MoveStatus.Win,
        "先手方连成恰好 5 颗即胜，必须下 [" + level + "]",
        "选了 " + JSON.stringify(a) + " judge=" + (j && j.status));
}

// 换个 winLength 再跑一遍 —— 写死 5 的实现会在这里露出来
for (const wl of [4, 6]) {
  const s = mkSession(15, BLACK, false);
  s.rules.winLength = wl;
  const w = [];
  for (let x = 3; x < 3 + wl - 1; x++) w.push([x, 5, 5]);       // 摆 wl-1 颗
  put(s, WHITE, w);
  put(s, BLACK, [[2, 5, 5]]);        // 只堵一头，另一头 (3+wl-1) 就是那个必胜点
  s.inner.currentPlayer = WHITE;
  const a = aiChooseMove(s, { level: "strong", seed: 9 });
  const j = a.kind === "place" ? judgeAt(s, a, WHITE) : null;
  check(j && j.status === MoveStatus.Win,
        "winLength=" + wl + " 时同样要抓住必胜点",
        "选了 " + JSON.stringify(a) + " judge=" + (j && j.status));
}

// ---------------------------------------------------------------------------
// 3. 两条硬规则之二：对方下一步能赢就必须堵 —— 而且"对方下下去会判长负"的点不是威胁。
// ---------------------------------------------------------------------------

for (const level of AI_LEVELS) {
  const s = mkSession(15, WHITE, false);        // 黑先手（受限），白后手
  put(s, BLACK, [[3, 5, 5], [4, 5, 5], [5, 5, 5], [6, 5, 5]]);
  s.inner.currentPlayer = WHITE;
  const a = aiChooseMove(s, { level, seed: 13 });
  const blocks = a.kind === "place" && (a.x === 2 || a.x === 7) && a.y === 5 && a.z === 5;
  check(blocks, "对方四连时必须去堵 [" + level + "]", "选了 " + JSON.stringify(a));
}

// 对方是受限方时，(7,5,5) 会让他成六判负 —— 那不是威胁，是陷阱。
{
  const s = mkSession(15, BLACK, false);        // 黑先手（受限）
  put(s, BLACK, [[2, 5, 5], [3, 5, 5], [4, 5, 5], [5, 5, 5], [7, 5, 5]]);
  s.inner.currentPlayer = WHITE;
  const a = aiChooseMove(s, { level: "strong", seed: 17 });
  // 黑下 (6,5,5) 会连成 2..7 六颗 → 黑判负，所以白不该把 (6,5,5) 当成威胁去堵。
  // 这里只断言"白没有把子下在 (6,5,5) 上"（那一手对白毫无价值）。
  const wasted = a.kind === "place" && a.x === 6 && a.y === 5 && a.z === 5;
  check(!wasted, "对方成六自尽的点不是威胁，电脑不该去堵它", "选了 " + JSON.stringify(a));
}

// ---------------------------------------------------------------------------
// 4. 空盘、边界、候选生成
// ---------------------------------------------------------------------------

for (const n of [8, 13, 15]) {
  for (const level of AI_LEVELS) {
    const s = mkSession(n, BLACK, false);
    const a = aiChooseMove(s, { level, seed: 1 });
    const mid = (n - 1) >> 1;
    eq(a.kind + ":" + a.x + "," + a.y + "," + a.z, "place:" + mid + "," + mid + "," + mid,
       "空盘首手下天元 [" + n + "³ " + level + "]");
  }
}

// 平边上的子不能让候选点绕到棋盘另一头 —— 扁平下标加减的经典 bug
{
  const s = mkSession(8, BLACK, false);
  put(s, BLACK, [[0, 0, 0], [7, 0, 0], [0, 7, 0], [0, 0, 7], [7, 7, 7]]);
  const cand = aiCandidates(s.board, 20000);
  let bad = 0;
  for (let i = 0; i < cand.length; i += 3) {
    if (!s.board.inBounds(cand[i], cand[i + 1], cand[i + 2])) bad++;
    if (s.board.cells[cand[i] + 8 * (cand[i + 1] + 8 * cand[i + 2])] !== EMPTY) bad++;
  }
  check(cand.length > 0 && bad === 0, "边界上的候选点全部合法且不环绕",
        "候选 " + (cand.length / 3) + " 个，其中 " + bad + " 个非法");
}

// 终局 / 满盘 → none，而且绝不抛
{
  const s = mkSession(8, BLACK, false);
  put(s, BLACK, [[3, 3, 3], [4, 3, 3], [5, 3, 3], [6, 3, 3], [7, 3, 3]]);
  s.inner.currentPlayer = BLACK;
  const o = RuleEngine.judge(s.board, { x: 7, y: 3, z: 3 }, BLACK, BLACK, s.rules);
  s.inner.status = "Decided"; s.inner.winner = BLACK;
  eq(aiChooseMove(s, { level: "strong" }).kind, "none", "已终局的棋局返回 none");
  check(o.status === MoveStatus.Win || o.status === MoveStatus.LoseByOverline,
        "构造的终局局面本身是有效的", o.status);
}

// ---------------------------------------------------------------------------
// 5. 自对局：**每一手都真的喂给引擎**，三档两两组合，三维与四维都跑。
//
// 这是"电脑永远不会卡住"的那条保证：只要 AI 挑了一手引擎会拒的动作，
// 回合就不会翻转，下一轮立刻红在这条断言上。
// ---------------------------------------------------------------------------

function selfPlay(n, firstPlayer, fourD, lvBlack, lvWhite, seed, maxPlies, cooldown) {
  const s = mkSession(n, firstPlayer, fourD, cooldown);
  const rng = rngOf(seed);
  let plies = 0;
  let rejected = 0;
  let overline = 0;
  let rotations = 0;
  while (s.status === "Playing" && plies < maxPlies) {
    const level = s.currentPlayer === BLACK ? lvBlack : lvWhite;
    const before = s.currentPlayer;
    const act = aiChooseMove(s, { level, seed: (rng() * 4294967296) >>> 0 });
    if (act.kind === "none") break;
    const r = applyAction(s, act);
    if (act.kind === "rotate") rotations++;
    if (!r || r.status === MoveStatus.Rejected ||
        (act.kind === "rotate" && !r.accepted)) {
      rejected++;
      break;
    }
    if (r.status === MoveStatus.LoseByOverline) overline++;
    // 回合必须真的翻转（终局与和局除外）
    if (s.status === "Playing" && s.currentPlayer === before) { rejected++; break; }
    plies++;
  }
  return { plies, rejected, overline, rotations, status: s.status };
}

for (const lv of AI_LEVELS) {
  const r = selfPlay(15, BLACK, false, lv, lv, 101, 400);
  check(r.rejected === 0, "自对局里每一手都被引擎接受 [" + lv + " 三维]",
        "卡在第 " + r.plies + " 手，rejected=" + r.rejected);
  check(r.overline === 0, "自对局里没有人走出长连自尽 [" + lv + " 三维]",
        "overline=" + r.overline);
  check(r.plies > 20 || r.status !== "Playing",
        "自对局真的在下棋 [" + lv + " 三维]", "只走了 " + r.plies + " 手");
}

{
  const r = selfPlay(8, WHITE, true, "medium", "strong", 202, 300, 3);
  check(r.rejected === 0, "自对局里每一手都被引擎接受 [四维]",
        "卡在第 " + r.plies + " 手，rejected=" + r.rejected);
  check(r.plies > 20 || r.status !== "Playing", "四维自对局真的在下棋",
        "只走了 " + r.plies + " 手");
  console.log("四维自对局：" + r.plies + " 手，其中转动 " + r.rotations + " 次");
}

// 棋力不同档之间也要能对完一局（混档跑，防止某一档单独有毛病）
{
  const r = selfPlay(13, WHITE, false, "weak", "strong", 303, 400);
  check(r.rejected === 0 && r.overline === 0, "弱 vs 强也能正常对完", JSON.stringify(r));
}

// ---------------------------------------------------------------------------
// 6. 随机源：确定性 + 不许用 Math.random
// ---------------------------------------------------------------------------

{
  const s = mkSession(15, BLACK, false);
  put(s, BLACK, [[7, 7, 7], [8, 8, 8]]);
  put(s, WHITE, [[6, 6, 6], [7, 8, 8]]);
  s.inner.currentPlayer = BLACK;
  const a = JSON.stringify(aiChooseMove(s, { level: "weak", seed: 42 }));
  const b = JSON.stringify(aiChooseMove(s, { level: "weak", seed: 42 }));
  eq(b, a, "同种子同局面必须给出同一动作");

  const seen = new Set();
  for (let seed = 0; seed < 200; seed++) {
    seen.add(JSON.stringify(aiChooseMove(s, { level: "weak", seed })));
  }
  check(seen.size >= 3, "种子真的接在决策上了（200 个种子至少 3 种不同的动作）",
        "只出现了 " + seen.size + " 种");
}

check(fullScript.indexOf("Math.random(") < 0,
      "全项目没有一处 Math.random() —— 随机源只能是那个种子 PRNG");

// fullScan 是 O(N³×13)，只许出现在转动判定里，绝不许进每手的热路径
{
  const aiStart = fullScript.indexOf("电脑对手：");
  const aiEnd = fullScript.indexOf("aiChooseMove(session, opts)");
  const aiBody = fullScript.slice(aiEnd);
  const hits = (aiBody.match(/fullScan/g) || []).length;
  eq(hits, 0, "aiChooseMove 的正文里不能出现 fullScan");
  // 整段 AI 代码（含注释）里只许在说明文字里提到它
  const whole = fullScript.slice(aiStart, fullScript.indexOf("/**\n * 盘面指纹。"));
  const codeHits = (whole.match(/RuleEngine\.fullScan/g) || []).length;
  eq(codeHits, 0, "AI 段里一次都不许真的调 fullScan");
}

// ---------------------------------------------------------------------------
// 7. 四维：probeRotate 与 rotate 必须逐字段等价，而且探针不留痕
// ---------------------------------------------------------------------------

function replay(n, firstPlayer, moves, fourD, cooldown) {
  const s = mkSession(n, firstPlayer, fourD, cooldown);
  for (const m of moves) s.place(m[0], m[1], m[2]);
  return s;
}

{
  // 一局四维棋的落子序列（坐标固定，跑几次都一样）
  const moves = [];
  const rng = rngOf(77);
  const probe = replay(8, BLACK, [], true, 3);
  while (probe.status === "Playing" && moves.length < 12) {
    const empty = [];
    probe.board.forEachStone(() => {});
    for (let z = 0; z < 8; z++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      if (probe.board.isEmpty(x, y, z) && x >= 3 && x <= 4 && y >= 3 && y <= 4) empty.push([x, y, z]);
    }
    const m = empty[(rng() * empty.length) | 0];
    probe.place(m[0], m[1], m[2]);
    moves.push(m);
  }

  let mismatched = 0, accepted = 0, checked = 0;
  for (const axis of [AXIS_X, AXIS_Y, AXIS_Z]) {
    for (let layer = 0; layer < 8; layer++) {
      for (let turns = 1; turns <= 3; turns++) {
        const a = replay(8, BLACK, moves, true, 3);
        const b = replay(8, BLACK, moves, true, 3);
        const mv = RotationMove.fromClockwiseTurns(axis, layer, turns);
        const ra = a.probeRotate(mv);
        const rb = b.rotate(mv);
        checked++;
        if (ra.status !== rb.status) mismatched++;
        if (rb.accepted) accepted++;
        // 探针必须不留痕
        if (ra.status === RotateStatus.Rotated && a.rotations.length !== 0) mismatched++;
      }
    }
  }
  eq(mismatched, 0, "probeRotate 的判定和 rotate 逐字段一致（" + checked + " 组，其中 " + accepted + " 组合法）");
  check(accepted > 0, "这组局面上确实有合法转动可探", "accepted=" + accepted);
}

{
  // 无痕的精确证明：fingerprint 覆盖整盘 + 出子权 + 手数 + 转动数 + 状态 + 胜者
  const s = replay(8, BLACK, [[3, 3, 3], [4, 4, 4], [5, 5, 5], [3, 4, 4], [4, 3, 3]], true, 3);
  const before = fingerprint(s);
  const movesBefore = s.moveCount;
  const playerBefore = s.currentPlayer;
  let probed = 0;
  for (const axis of [AXIS_X, AXIS_Y, AXIS_Z]) {
    for (let layer = 0; layer < 8; layer++) {
      for (let turns = 1; turns <= 3; turns++) {
        s.probeRotate(RotationMove.fromClockwiseTurns(axis, layer, turns));
        probed++;
      }
    }
  }
  eq(fingerprint(s), before, "一批探针（" + probed + " 次）之后盘面指纹逐位相同");
  eq(s.moveCount, movesBefore, "探针不改落子数");
  eq(s.currentPlayer, playerBefore, "探针不抢回合");
  eq(s.rotations.length, 0, "探针不留下转动记录");
}

{
  // 求值回调抛异常时，棋盘也必须还原 —— 否则整局棋就毁了
  // （冷却 3，所以这里必须真的落满 3 手，否则探针根本走不到"转成功"那一步）
  const s = replay(8, BLACK, [[3, 3, 3], [4, 3, 3], [5, 5, 5]], true, 3);
  const before = fingerprint(s);
  let threw = false;
  try {
    s.probeRotate(RotationMove.fromClockwiseTurns(AXIS_Z, 3, 1), () => { throw new Error("故意"); });
  } catch (e) { threw = true; }
  check(threw, "求值回调抛的异常会原样冒出来");
  eq(fingerprint(s), before, "求值回调抛异常之后棋盘照样还原");
}

{
  // 四维下强档必须真的去探转动。
  // 【子要摆得散】三颗子两两都不共线相邻，否则会造出"对方有活三"的局面，
  // 强档会先去堵活三、根本走不到探转动那一步（第一版就是这么红的）。
  const s = replay(8, BLACK, [], true, 3);
  s.place(0, 0, 0); s.place(2, 5, 7); s.place(7, 2, 3);
  const st = {};
  aiChooseMove(s, { level: "strong", seed: 8, stats: st });
  check(st.rotProbes > 0, "四维下强档会去探转动", "rotProbes=" + st.rotProbes);
  check(st.rotProbes <= AI_PARAMS.strong.rotProbe, "探针数受参数表上限约束",
        "rotProbes=" + st.rotProbes);
  // 三维下一次都不许探
  const s3 = mkSession(8, BLACK, false);
  s3.place(3, 3, 3);
  const st3 = {};
  aiChooseMove(s3, { level: "strong", seed: 8, stats: st3 });
  eq(st3.rotProbes, 0, "三维模式下一次转动都不该探");
}

{
  // 冷却没到就不许探转动
  const s = mkSession(8, BLACK, true, 5);
  s.place(3, 3, 3);
  const st = {};
  aiChooseMove(s, { level: "strong", seed: 8, stats: st });
  eq(st.rotProbes, 0, "冷却未到时一次转动都不该探");
}

// ---------------------------------------------------------------------------
// 8. 三档的强弱关系：对方做活三时去堵的比例，弱 < 中 < 强
// ---------------------------------------------------------------------------

{
  const counts = {};
  for (const level of AI_LEVELS) {
    let blocked = 0;
    for (let seed = 0; seed < 60; seed++) {
      const s = mkSession(15, BLACK, false);
      put(s, WHITE, [[5, 5, 5], [6, 5, 5], [7, 5, 5]]);   // 白活三，两头 (4,5,5)/(8,5,5) 都空
      put(s, BLACK, [[5, 9, 9], [6, 9, 9]]);              // 黑自己有一点东西，但不是威胁
      s.inner.currentPlayer = BLACK;
      const a = aiChooseMove(s, { level, seed, });
      const blocks = a.kind === "place" && a.y === 5 && a.z === 5 && (a.x === 4 || a.x === 8);
      if (blocks) blocked++;
    }
    counts[level] = blocked;
  }
  console.log("对方活三时去堵的比例（各 60 局）：弱 " + counts.weak +
              " / 中 " + counts.medium + " / 强 " + counts.strong);
  check(counts.weak < counts.medium && counts.medium < counts.strong,
        "对方活三时去堵的比例：弱 < 中 < 强",
        "弱 " + counts.weak + " / 中 " + counts.medium + " / 强 " + counts.strong + "（各 60 局）");
  eq(counts.strong, 60, "强档每个活三都去堵");
}

// ---------------------------------------------------------------------------
// 9. 计算量的上界（用计数器，不用墙钟；墙钟只留一条很松的兜底）
// ---------------------------------------------------------------------------

{
  // 15³ 中盘
  const s = mkSession(15, BLACK, false);
  const rng = rngOf(4);
  let placed = 0;
  while (placed < 40 && s.status === "Playing") {
    const empty = [];
    for (let z = 4; z < 9; z++) for (let y = 4; y < 9; y++) for (let x = 4; x < 9; x++) {
      if (s.board.isEmpty(x, y, z)) empty.push([x, y, z]);
    }
    const m = empty[(rng() * empty.length) | 0];
    s.place(m[0], m[1], m[2]);
    placed++;
  }
  const st = {};
  const t0 = Date.now();
  const act = aiChooseMove(s, { level: "strong", seed: 3, stats: st });
  const ms = Date.now() - t0;
  const stones = s.board.stoneCount;
  check(st.candidates <= 26 * stones + 3, "候选数不超过 26 × 子数（半径 1 的邻域上界）",
        "候选 " + st.candidates + " / 子 " + stones);
  check(st.judgeCalls <= 3 * st.candidates, "judge 的调用次数受候选数约束",
        "judgeCalls=" + st.judgeCalls + " 候选=" + st.candidates);
  check(ms < 500, "15³ 中盘单手在 500ms 以内", ms + "ms");
  console.log("15³ 中盘（" + stones + " 子）：候选 " + st.candidates +
              "，judge " + st.judgeCalls + "，用时 " + ms + "ms，动作 " + act.kind);
}

{
  // 50³ 的最坏情况：一条"墙"里塞满子
  const s = mkSession(50, BLACK, false);
  for (let z = 0; z < 4; z++) {
    for (let y = 0; y < 50; y++) {
      for (let x = 0; x < 50; x++) {
        if ((x + y + z) % 2 === 0) s.board.set(x, y, z, ((x + y) % 4 < 2) ? BLACK : WHITE);
      }
    }
  }
  s.inner.currentPlayer = BLACK;
  const st = {};
  const t0 = Date.now();
  aiChooseMove(s, { level: "weak", seed: 1, stats: st });
  const ms = Date.now() - t0;
  check(st.candidates <= 20000, "50³ 密集局面下候选数被截到上限以内",
        "候选 " + st.candidates);
  check(ms < 1500, "50³ 密集局面单手在 1500ms 以内", ms + "ms（候选 " + st.candidates + "）");
  console.log("50³ 密集（" + s.board.stoneCount + " 子）：候选 " + st.candidates + "，用时 " + ms + "ms");
}

// ---------------------------------------------------------------------------
console.log("");
console.log("==================================================");
console.log("  " + passed + " 项通过 / " + failures.length + " 项失败");
console.log("==================================================");
if (failures.length) {
  console.log("");
  for (const f of failures) console.log("FAIL: " + f);
  process.exit(1);
}
