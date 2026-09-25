// 网页版规则内核的测试。
//
// 分三层：
//   1. 语法与顶层执行检查 —— 把 index.html 里的整个 <script> 编译并执行一遍。
//      渲染器 / UI 那部分虽然跑不到（没有 DOM），但顶层定义里的引用错误会被抓出来。
//   2. 一致性向量 —— 回放 vectors.json，逐手比对。
//      它由【原来的 C# 内核】导出（该实现已删除），所以这是一份【冻结的历史基线】：
//      断言的是"网页版和 2026-09 那份 C# 实现逐手一致"，不是"和某个活的对照物一致"。
//   3. 内核自身的断言 —— 对局流程、悔棋、和局、以及 judge 与 fullScan 的交叉一致性，
//      对应原 C# 侧 GomokuCoreTests 的用例（该实现已删除，用例语义保留在这里）。
//
// 运行：node Web_Gomoku3D/tests/rules.test.mjs
//
// ！vectors.json 【无法重新生成】—— 导出它的 C# 内核已经被删除。
//   不要为了让它变绿而改它（_verify/run-all.sh 第 2 步会用 md5 当场抓出来）。
//   要改规则，就改网页版内核，并在这里第 3 层加针对新规则的断言。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.join(HERE, "..", "index.html");
const VECTORS_PATH = path.join(HERE, "vectors.json");

let passed = 0;
const failures = [];

function check(ok, name, detail) {
  if (ok) { passed++; return; }
  failures.push(name + (detail ? "\n      " + detail : ""));
}
function eq(actual, expected, name, ctx) {
  check(actual === expected, name, (ctx ? ctx + " | " : "") + "期望 " + JSON.stringify(expected) + " 实际 " + JSON.stringify(actual));
}

// ---------------------------------------------------------------------------
// 1. 把整个 <script> 抽出来做语法+顶层执行检查
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
  // 只编译不执行：能抓住任何语法错误
  new Function(fullScript);
  passed++;
} catch (e) {
  failures.push("index.html 的 script 块有语法错误：" + e.message);
}

try {
  // 执行顶层代码。document / window 在 node 里不存在，
  // 脚本末尾的 `typeof document !== "undefined"` 守卫会让它不去碰 DOM，
  // 所以这里能安全地验证"顶层定义本身没有引用错误"。
  new Function(fullScript)();
  passed++;
} catch (e) {
  failures.push("index.html 的 script 顶层执行失败：" + e.message + "\n" + (e.stack || ""));
}

// ---------------------------------------------------------------------------
// 2. 抽出纯规则内核，在隔离作用域里求值
// ---------------------------------------------------------------------------
const BEGIN = "/* GOMOKU-CORE-BEGIN */";
const END = "/* GOMOKU-CORE-END */";
const bi = fullScript.indexOf(BEGIN);
const ei = fullScript.indexOf(END);
if (bi < 0 || ei < 0 || ei <= bi) {
  console.error("index.html 里找不到 GOMOKU-CORE 标记区间");
  process.exit(2);
}
// 标记本身各是一整行注释，所以直接从标记之后切到下一个标记之前
const coreSource = fullScript.slice(bi + BEGIN.length, ei);

let Core;
try {
  Core = new Function(coreSource + `
    return { Board3D, RuleSet, RuleEngine, GameSession, DIRS13, MoveStatus, RestrictionTarget,
             EMPTY, BLACK, WHITE, opponentOf, cnOf };`)();
  passed++;
} catch (e) {
  console.error("内核求值失败：" + e.message + "\n" + (e.stack || ""));
  process.exit(2);
}

const { Board3D, RuleSet, RuleEngine, GameSession, DIRS13, MoveStatus, RestrictionTarget, EMPTY, BLACK, WHITE } = Core;

console.log("内核：方向数 " + DIRS13.length + "，状态枚举 " + Object.keys(MoveStatus).length + " 个");

// ---------------------------------------------------------------------------
// 3. 一致性向量回放
// ---------------------------------------------------------------------------
const vectors = JSON.parse(fs.readFileSync(VECTORS_PATH, "utf8"));

function rulesOf(v) {
  const r = new RuleSet();
  r.winLength = v.winLength;
  r.overlineLoses = v.overlineLoses;
  r.restricted = v.restricted;
  r.overlineTakesPrecedence = v.overlineTakesPrecedence;
  return r;
}

function compareOutcome(actual, expected, ctx) {
  eq(actual.status, expected.status, "status", ctx);
  eq(actual.longestRun, expected.longestRun, "longestRun", ctx);
  eq(actual.winner, expected.winner, "winner", ctx);
  const al = actual.line ? actual.line.length : 0;
  eq(al, expected.lineLength, "line 长度", ctx);
  if (expected.line && actual.line) {
    let same = actual.line.length === expected.line.length;
    if (same) {
      for (let i = 0; i < expected.line.length; i++) {
        const a = actual.line[i], e = expected.line[i];
        if (a[0] !== e[0] || a[1] !== e[1] || a[2] !== e[2]) { same = false; break; }
      }
    }
    check(same, "line 坐标序列", ctx + " | 期望 " + JSON.stringify(expected.line) + " 实际 " + JSON.stringify(actual.line));
  }
}

// --- 对局用例：逐手回放
let gameMovesChecked = 0;
for (let gi = 0; gi < vectors.gameCases.length; gi++) {
  const g = vectors.gameCases[gi];
  const ctx0 = "对局#" + gi + " size=" + g.size + " win=" + g.winLength + " overline=" + g.overlineLoses;

  const session = GameSession.create(g.size, g.firstPlayer, rulesOf(g));
  eq(session.rules.winLength, g.winLength, "规则快照 winLength", ctx0);

  for (let i = 0; i < g.moves.length; i++) {
    const m = g.moves[i];
    const ctx = ctx0 + " 第" + (i + 1) + "手(" + m[0] + "," + m[1] + "," + m[2] + ")";
    const o = session.place(m[0], m[1], m[2]);
    compareOutcome(o, g.expect[i], ctx);
    gameMovesChecked++;
  }
}
console.log("对局向量：" + vectors.gameCases.length + " 局，" + gameMovesChecked + " 手逐手比对");

// --- 局面用例：构造盘面后单点判定
for (let pi = 0; pi < vectors.positionCases.length; pi++) {
  const p = vectors.positionCases[pi];
  const board = new Board3D(p.size);
  for (const s of p.stones) board.set(s[0], s[1], s[2], s[3]);

  const move = { x: p.move[0], y: p.move[1], z: p.move[2] };
  eq(board.get(move.x, move.y, move.z), p.movePlayer, "局面用例落子格应为落子方的子", p.name);

  const o = RuleEngine.judge(board, move, p.movePlayer, p.firstPlayer, rulesOf(p));
  compareOutcome(o, p.expect, "局面#" + p.name);
}
console.log("局面向量：" + vectors.positionCases.length + " 个");

// ---------------------------------------------------------------------------
// 4. 内核自身断言（与 C# 侧 GomokuCoreTests 对应）
// ---------------------------------------------------------------------------

// 13 个方向 × 正反两个朝向
{
  let cases = 0;
  for (let di = 0; di < DIRS13.length; di++) {
    const d = DIRS13[di];
    for (const sign of [1, -1]) {
      const start = sign > 0 ? [5, 5, 5] : [9, 9, 9];
      const board = new Board3D(15);
      const cells = [];
      for (let i = 0; i < 5; i++) {
        const c = [start[0] + i * sign * d[0], start[1] + i * sign * d[1], start[2] + i * sign * d[2]];
        cells.push(c);
        board.set(c[0], c[1], c[2], BLACK);
      }
      board.set(start[0] - sign * d[0], start[1] - sign * d[1], start[2] - sign * d[2], WHITE);
      board.set(start[0] + 5 * sign * d[0], start[1] + 5 * sign * d[1], start[2] + 5 * sign * d[2], WHITE);

      for (let i = 0; i < 5; i++) {
        const o = RuleEngine.judge(board, { x: cells[i][0], y: cells[i][1], z: cells[i][2] },
                                   BLACK, BLACK, new RuleSet());
        eq(o.status, MoveStatus.Win, "方向" + d + " 符号" + sign + " 第" + i + "格", "");
        eq(o.longestRun, 5, "方向" + d + " 长度", "");
        cases++;
      }
    }
  }
  console.log("方向断言：" + cases + " 次判定");
}

// 接起两段分离的连线
{
  const board = new Board3D(15);
  board.set(0, 0, 0, BLACK); board.set(1, 0, 0, BLACK);
  board.set(3, 0, 0, BLACK); board.set(4, 0, 0, BLACK);
  eq(RuleEngine.judge(board, { x: 0, y: 0, z: 0 }, BLACK, BLACK, new RuleSet()).status,
     MoveStatus.Placed, "只连成 2 个不应判胜");

  board.set(2, 0, 0, BLACK);
  const o = RuleEngine.judge(board, { x: 2, y: 0, z: 0 }, BLACK, BLACK, new RuleSet());
  eq(o.status, MoveStatus.Win, "接起 0-4 应判胜");
  eq(o.longestRun, 5, "接起后长度应为 5");
}

// 长连规则的全部变体
function makeSix(player) {
  const board = new Board3D(15);
  for (let x = 0; x < 6; x++) board.set(x, 3, 3, player);
  return board;
}
{
  const o1 = RuleEngine.judge(makeSix(BLACK), { x: 5, y: 3, z: 3 }, BLACK, BLACK, new RuleSet());
  eq(o1.status, MoveStatus.LoseByOverline, "先手 6 连应判负");
  eq(o1.winner, WHITE, "长连犯规时对手获胜");

  const o2 = RuleEngine.judge(makeSix(WHITE), { x: 5, y: 3, z: 3 }, WHITE, BLACK, new RuleSet());
  eq(o2.status, MoveStatus.Win, "后手没有长连限制，6 连直接胜");

  const r3 = new RuleSet(); r3.overlineLoses = false;
  eq(RuleEngine.judge(makeSix(BLACK), { x: 5, y: 3, z: 3 }, BLACK, BLACK, r3).status,
     MoveStatus.Win, "关闭长连后 6 连应判胜");

  const r4 = new RuleSet(); r4.restricted = RestrictionTarget.None;
  eq(RuleEngine.judge(makeSix(BLACK), { x: 5, y: 3, z: 3 }, BLACK, BLACK, r4).status,
     MoveStatus.Win, "不设限时 6 连应判胜");

  // 白先时限制跟着先手走
  eq(RuleEngine.judge(makeSix(WHITE), { x: 5, y: 3, z: 3 }, WHITE, WHITE, new RuleSet()).status,
     MoveStatus.LoseByOverline, "白先时白棋受长连限制");
  eq(RuleEngine.judge(makeSix(BLACK), { x: 5, y: 3, z: 3 }, BLACK, WHITE, new RuleSet()).status,
     MoveStatus.Win, "白先时黑棋不受长连限制");

  // 固定绑黑棋
  const r5 = new RuleSet(); r5.restricted = RestrictionTarget.Black;
  eq(RuleEngine.judge(makeSix(BLACK), { x: 5, y: 3, z: 3 }, BLACK, WHITE, r5).status,
     MoveStatus.LoseByOverline, "限制固定绑黑棋时，即使白先黑棋仍犯规");
}

// 同一手同时命中恰好 5 连和 6 连的优先级
{
  function precedenceBoard() {
    const board = new Board3D(15);
    for (let y = 2; y <= 6; y++) board.set(7, y, 7, BLACK);
    board.set(5, 7, 7, BLACK); board.set(6, 7, 7, BLACK);
    board.set(8, 7, 7, BLACK); board.set(9, 7, 7, BLACK);
    board.set(7, 7, 7, BLACK);
    return board;
  }
  const rp = new RuleSet(); rp.overlineTakesPrecedence = true;
  eq(RuleEngine.judge(precedenceBoard(), { x: 7, y: 7, z: 7 }, BLACK, BLACK, rp).status,
     MoveStatus.LoseByOverline, "长连优先时应判负");

  const rn = new RuleSet(); rn.overlineTakesPrecedence = false;
  eq(RuleEngine.judge(precedenceBoard(), { x: 7, y: 7, z: 7 }, BLACK, BLACK, rn).status,
     MoveStatus.Win, "恰好5连优先时应判胜");
}

// 十字交叉不能把各方向长度加起来
{
  const board = new Board3D(15);
  board.set(6, 5, 5, BLACK); board.set(8, 5, 5, BLACK);
  board.set(7, 4, 5, BLACK); board.set(7, 6, 5, BLACK);
  board.set(7, 5, 6, BLACK); board.set(7, 5, 7, BLACK);
  const o = RuleEngine.judge(board, { x: 7, y: 5, z: 5 }, BLACK, BLACK, new RuleSet());
  eq(o.status, MoveStatus.Placed, "十字交叉不应判胜");
  eq(o.longestRun, 3, "十字交叉最长连线应为 3");
}

// 对局流程：轮流、悔棋、重开、规则快照
{
  const s = GameSession.create(15, BLACK, new RuleSet());
  eq(s.currentPlayer, BLACK, "黑先时初始轮到黑棋");
  s.place(0, 0, 0);
  eq(s.currentPlayer, WHITE, "落子后应切换到白棋");
  s.place(1, 0, 0);
  eq(s.currentPlayer, BLACK, "再落一子应切回黑棋");
  eq(s.moveCount, 2, "手数应为 2");

  eq(s.place(0, 0, 0).status, MoveStatus.Rejected, "重复落子应被拒绝");
  eq(s.moveCount, 2, "被拒绝后手数不变");
  eq(s.place(-1, 0, 0).status, MoveStatus.Rejected, "越界应被拒绝");

  check(s.undo(), "悔棋应成功");
  eq(s.board.isEmpty(1, 0, 0), true, "悔棋应清掉那颗子");
  check(s.undo(), "再悔一步应成功");
  eq(s.moveCount, 0, "全部悔完后手数应为 0");
  eq(s.currentPlayer, BLACK, "全部悔完后应回到先手方");
  check(!s.undo(), "空棋盘悔棋应返回 false");

  // 白先
  const w = GameSession.create(15, WHITE, new RuleSet());
  eq(w.currentPlayer, WHITE, "白先时初始轮到白棋");
  w.place(0, 0, 0);
  eq(w.currentPlayer, BLACK, "白棋落子后应轮到黑棋");

  // 规则快照
  const rules = new RuleSet();
  const snap = GameSession.create(15, BLACK, rules);
  rules.winLength = 3;
  eq(snap.rules.winLength, 5, "进行中的对局必须用自己的规则快照");
  snap.reset(0, EMPTY, rules);
  eq(snap.rules.winLength, 3, "重开后新配置才生效");
}

// 悔棋之后要能继续下
{
  const s = GameSession.create(15, BLACK, new RuleSet());
  for (let x = 0; x < 4; x++) { s.place(x, 0, 0); s.place(x, 1, 0); }
  eq(s.place(4, 0, 0).status, MoveStatus.Win, "黑棋第 5 手应判胜");
  eq(s.status, "Decided", "分出胜负后状态应为 Decided");
  eq(s.place(7, 7, 7).status, MoveStatus.Rejected, "结束后不能再落子");

  check(s.undo(), "悔掉取胜那一手应成功");
  eq(s.status, "Playing", "悔棋后必须回到进行中");
  eq(s.winner, EMPTY, "悔棋后胜者应清空");
  eq(s.board.isEmpty(4, 0, 0), true, "获胜的那颗子应被撤掉");
  eq(s.currentPlayer, BLACK, "轮到被撤掉的那一方重下");
  check(s.place(0, 0, 1).status !== MoveStatus.Rejected, "换一个落点后棋局应能继续");
}

// 和局：2³ 棋盘上不存在长度 3 的连线
{
  const rules = new RuleSet(); rules.winLength = 3;
  const s = GameSession.create(2, BLACK, rules);
  let guard = 0;
  while (s.status === "Playing" && guard++ < 100) {
    let placed = false;
    for (let z = 0; z < 2 && !placed; z++)
      for (let y = 0; y < 2 && !placed; y++)
        for (let x = 0; x < 2 && !placed; x++)
          if (s.canPlace(x, y, z)) { s.place(x, y, z); placed = true; }
    if (!placed) break;
  }
  eq(s.status, "Decided", "2³ 棋盘最终应结束");
  eq(s.isDraw, true, "2³ 棋盘只可能和局");
  eq(s.moveCount, 8, "应下满 8 手");
  eq(s.board.isFull, true, "棋盘应已填满");
}

// judge 与 fullScan 的交叉一致性（随机对局）—— 和 C# 侧同一条测试对应
{
  function makeRng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function runContains(run, c) {
    const dx = c[0] - run.start[0], dy = c[1] - run.start[1], dz = c[2] - run.start[2];
    let k = null;
    const comps = [[dx, run.dir[0]], [dy, run.dir[1]], [dz, run.dir[2]]];
    for (const [dc, dd] of comps) {
      if (dd !== 0) {
        if (dc % dd !== 0) return false;
        const kk = dc / dd;
        if (k === null) k = kk; else if (k !== kk) return false;
      } else if (dc !== 0) return false;
    }
    return k !== null && k >= 0 && k < run.length;
  }

  let checked = 0;
  for (const [size, seed] of [[5, 12345], [6, 999], [8, 4242]]) {
    const rng = makeRng(seed);
    const s = GameSession.create(size, BLACK, new RuleSet());
    let guard = 0;
    while (s.status === "Playing" && guard++ < size * size * size * 2 + 10) {
      const x = Math.floor(rng() * size), y = Math.floor(rng() * size), z = Math.floor(rng() * size);
      if (!s.canPlace(x, y, z)) continue;
      const o = s.place(x, y, z);
      if (o.status === MoveStatus.Rejected) { check(false, "随机落子被拒绝", o.reason || ""); continue; }

      const runs = RuleEngine.fullScan(s.board, 1);
      let best = null;
      for (const r of runs) {
        if (!runContains(r, [x, y, z])) continue;
        if (!best || r.length > best.length) best = r;
      }
      check(best !== null, "全盘扫描应能找到穿过新落子的连线 @" + x + "," + y + "," + z + " size=" + size);
      if (best) {
        eq(o.longestRun, best.length, "最长连线不一致 @" + x + "," + y + "," + z + " size=" + size);
        eq(s.history[s.moveCount - 1].player, best.player, "连线归属方不一致 @" + x + "," + y + "," + z);
      }

      if (o.status === MoveStatus.Placed || o.status === MoveStatus.Draw) {
        // 未分出胜负的盘面上不应存在任何 ≥5 的连线
        const big = RuleEngine.fullScan(s.board, 5);
        eq(big.length, 0, "未结束的盘面上出现了 " + big.length + " 条 ≥5 连线 @" + x + "," + y + "," + z + " size=" + size);
      }
      checked++;
    }
  }
  console.log("随机对局交叉验证：" + checked + " 手");
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
