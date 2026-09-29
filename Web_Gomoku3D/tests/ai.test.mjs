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

/**
 * 【开发时用】AI_TEST_FAIL_FAST=1 → 第一条断言失败就立刻退出，不跑完剩下的。
 *
 * 为什么要有它：这个文件后面有几十局自对局，跑完要八分多钟。写测试的时候
 * "写完立刻看它红"要等八分钟，人就会开始偷懒跳过这一步 —— 而跳过才是真的贵。
 * 跑完整套件（CI / 提交前）时不要设它，那时需要看到全部失败项。
 */
const FAIL_FAST = process.env.AI_TEST_FAIL_FAST === "1";

function check(ok, name, detail) {
  if (ok) { passed++; return; }
  const line = name + (detail ? "\n      " + detail : "");
  failures.push(line);
  if (FAIL_FAST) {
    console.log("");
    console.log("FAIL（fail-fast）：" + line);
    console.log("已过 " + passed + " 项；剩下的没跑（AI_TEST_FAIL_FAST=1）。");
    process.exit(1);
  }
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
             aiChooseMove, aiCandidates, aiThreatAt, aiThreatAtSlow, aiThreatValue,
             aiRng, AI_LEVELS, AI_PARAMS,
             aiThreatBest, aiTier, AI_W, Board3D,
             aiZobristBoard, aiZobristMove, aiTtReset, aiTtProbe, aiTtStore,
             TT_EXACT, TT_LOWER, TT_UPPER };`)();
  passed++;
} catch (e) {
  console.error("内核求值失败：" + e.message + "\n" + (e.stack || ""));
  process.exit(2);
}
const { RuleSet, RuleEngine, GameSession, FourDSession, MoveStatus, EMPTY, BLACK, WHITE,
        opponentOf, fingerprint, RotationMove, RotateStatus, AXIS_X, AXIS_Y, AXIS_Z,
        aiChooseMove, aiCandidates, aiThreatAt, aiThreatValue, aiRng, AI_LEVELS, AI_PARAMS,
        aiThreatBest, aiTier, AI_W, Board3D, aiThreatAtSlow,
        aiZobristBoard, aiZobristMove, aiTtReset, aiTtStore, aiTtProbe,
        TT_EXACT, TT_LOWER, TT_UPPER } = Core;

console.log("五档：" + AI_LEVELS.join(" / ") + "；方向数 " + Core.DIRS13.length);

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
// 1b. Zobrist 置换表
//
// 【为什么不测"开关置换表选出同一动作"】那一条是错的，做不到也不该要求：
// 置换表会改变 α-β 的剪枝顺序，同分着法的 tie-break 本来就会跟着变。
// 要它逐字段相同，等于要求置换表什么都不做。真正要钉住的是三件事：
// 键算得对、代数戳真的清了表、碰撞不至于翻车。
// ---------------------------------------------------------------------------
{
  const mk = (dims) => new Board3D(dims[0], dims[1], dims[2]);

  // --- 键算得对：同样的盘面 → 同样的键；动一格 → 键一定变
  const b = mk([10, 10, 10]);
  b.set(3, 4, 5, BLACK); b.set(7, 2, 1, WHITE);
  const h0 = aiZobristBoard(b);
  check(h0 === aiZobristBoard(b), "同一盘面两次算出的键相同");
  const h1 = aiZobristMove(h0, BLACK, b.index(1, 1, 1));
  check(h1 !== h0, "放一颗子键会变");
  check(aiZobristMove(h1, BLACK, b.index(1, 1, 1)) === h0, "放完再撤键回到原值");

  // --- 黑白互换必须是不同的键（否则两方会互认）
  const b2 = mk([10, 10, 10]);
  b2.set(3, 4, 5, WHITE); b2.set(7, 2, 1, BLACK);
  check(aiZobristBoard(b2) !== h0, "黑白对调后键不同");

  // --- 按尺寸惰性分配：尺寸变了要重建，不能沿用旧表
  const b3 = mk([30, 30, 30]);
  b3.set(29, 29, 29, BLACK);
  check(aiZobristBoard(b3) !== 0, "30³ 上也能算出键（表按尺寸重建）");
  check(aiZobristBoard(mk([8, 8, 8])) === 0, "空盘的键是 0（EMPTY 不占表项）");

  // --- 转动后转回来，键必须回到原值（四维的转动是整层置换）
  const s4 = mkSession(8, BLACK, true, 3);
  s4.board.set(2, 3, 4, BLACK); s4.board.set(5, 5, 5, WHITE); s4.board.set(1, 1, 1, BLACK);
  const hb = aiZobristBoard(s4.board);
  for (let axis = 0; axis < 3; axis++) {
    for (const layer of [1, 4]) {
      s4.board.rotateLayer(axis, layer, 1);
      s4.board.rotateLayer(axis, layer, 3);
      check(aiZobristBoard(s4.board) === hb,
            "转动一手再转回来，整盘键回到原值（axis=" + axis + " layer=" + layer + "）");
    }
  }

  // --- 代数戳真的清了表：重置之后同键必须探不到
  aiTtReset(1);
  aiTtStore(0x12345678, 5, TT_EXACT, 999, 1, 2, 3);
  check(aiTtProbe(0x12345678, 5) !== null, "同一代里存进去探得到");
  aiTtReset(2);
  check(aiTtProbe(0x12345678, 5) === null, "代数戳 +1 之后整表作废");
  // --- 浅的结果不许覆盖深的
  aiTtReset(3);
  aiTtStore(0x0badf00d, 7, TT_EXACT, 111, 1, 1, 1);
  aiTtStore(0x0badf00d, 3, TT_EXACT, 222, 2, 2, 2);
  const deep = aiTtProbe(0x0badf00d, 3);
  check(deep && deep.value === 111 && deep.x === 1, "浅结果不覆盖同槽的深结果",
        JSON.stringify(deep));
  // --- 要的层比存的深时不许用。上面存的是 depth 7，所以问 7 探得到、问 8 探不到。
  check(aiTtProbe(0x0badf00d, 7) !== null, "要的层和存的一样深时探得到");
  check(aiTtProbe(0x0badf00d, 8) === null, "要的层比存的深时探不到（不能用浅的冒充深的）");

  // --- 碰撞压力：反复往同一个槽位灌不同的键，探到的必须还是本次那一条
  aiTtReset(99);
  let collisions = 0;
  for (let i = 0; i < 200; i++) {
    const k = i * 65536;               // 低位全 0 → 全部落在槽 0 上
    aiTtStore(k, 5, TT_EXACT, i, 1, 1, 1);
    const got = aiTtProbe(k, 5);
    if (got && got.value !== i) collisions++;
  }
  check(collisions === 0, "同槽反复覆写之后探到的仍是本次存进去的那一项",
        collisions + " 次探到了别的项");

  // --- 硬规则在开了置换表之后照旧成立
  const s1 = mkSession(15, BLACK, false);
  buildSixOrFive(s1, 5);
  const a1 = aiChooseMove(s1, { level: "ultra", seed: 11 });
  const j1 = a1.kind === "place" ? judgeAt(s1, a1, WHITE) : null;
  check(j1 && j1.status === MoveStatus.Win, "开了置换表，「能赢必赢」照旧", JSON.stringify(a1));
}

{
  // --- 悔棋 / 换尺寸重开之后复用同一个 session：置换表与哈希基准必须跟着重置
  const s = mkSession(15, BLACK, false);
  const rng = rngOf(1212);
  for (let j = 0; j < 10 && s.status === "Playing"; j++) {
    const em = [];
    for (let z = 5; z < 10; z++) for (let y = 5; y < 10; y++) for (let x = 5; x < 10; x++) {
      if (s.board.isEmpty(x, y, z)) em.push([x, y, z]);
    }
    const m = em[(rng() * em.length) | 0];
    s.place(m[0], m[1], m[2]);
  }
  // 同一个局面、同一个种子，出招两次必须一样。
  // 【别写成"悔 3 手再问"】那问的是另一个局面，动作当然会变 —— 这一条要模拟的是
  // "电脑出了这一手 → 玩家悔棋 → 电脑重新算"，所以必须把那一手真的走出去再悔回来。
  const before = aiChooseMove(s, { level: "ultra", seed: 77 });
  if (before.kind === "place") { s.place(before.x, before.y, before.z); s.undo(); }
  const after = aiChooseMove(s, { level: "ultra", seed: 77 });
  check(before.kind === after.kind && before.x === after.x &&
        before.y === after.y && before.z === after.z,
        "悔棋之后同局面同种子给出同一动作（置换表没有残影）",
        JSON.stringify([before, after]));

  // 换一个尺寸重开：Zobrist 表必须跟着重建
  s.reset([8, 8, 8], BLACK, s.rules);
  const a8 = aiChooseMove(s, { level: "ultra", seed: 5 });
  check(a8.kind === "place" && s.board.inBounds(a8.x, a8.y, a8.z),
        "换尺寸重开之后出招仍落在盘内", JSON.stringify(a8));
}

// ---------------------------------------------------------------------------
// （这里原来有一组"两段式预筛差异量化"，随预筛一起撤掉了）
//
// 预筛实测直接垮掉，细节记在 index.html 的 aiOrderTop 注释里。它撤掉之后这一组
// 没有东西可量了；而**抓到它的那条断言就在下面第 8 组**（对方活三时去堵的比例，
// 极限档从 60/60 掉到 0/60）—— 所以那个位置不要动，它是这条路的墓志铭。
// ---------------------------------------------------------------------------

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
  const a = aiChooseMove(s, { level: "ultra", seed: 9 });
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
  const a = aiChooseMove(s, { level: "ultra", seed: 17 });
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
  eq(aiChooseMove(s, { level: "ultra" }).kind, "none", "已终局的棋局返回 none");
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
  const r = selfPlay(8, WHITE, true, "medium", "ultra", 202, 300, 3);
  check(r.rejected === 0, "自对局里每一手都被引擎接受 [四维]",
        "卡在第 " + r.plies + " 手，rejected=" + r.rejected);
  check(r.plies > 20 || r.status !== "Playing", "四维自对局真的在下棋",
        "只走了 " + r.plies + " 手");
  console.log("四维自对局：" + r.plies + " 手，其中转动 " + r.rotations + " 次");
}

// 棋力不同档之间也要能对完一局（混档跑，防止某一档单独有毛病）
{
  const r = selfPlay(13, WHITE, false, "low", "ultra", 303, 400);
  check(r.rejected === 0 && r.overline === 0, "弱 vs 强也能正常对完", JSON.stringify(r));
}

// ---------------------------------------------------------------------------
// 5b. 四维转动：**只在必要的时候转**
//
// 用户报的两件事：「不要一直旋转」「发现对方要连成四颗/三颗时，有旋转机会就立马旋转」。
// 原来那条判据（"转动层 ±1 带里我最好的一手变高了就转"）实测每局转 3 次、占自己回合的
// 三分之一，而其中只有三分之一真的把对方的最强威胁压下去过 —— 慢镜头里还有
// "对方一点威胁都没有时它照样转，转完对方原地点了同一格"这种白送一手。
//
// 这一组把新判据钉成**不变量**（跑完整局，每一手都真的喂给引擎）：
//   · 转完永远不许给对方留下活三以上 —— 那是把必须回应的麻烦从别人手里接过来
//   · 转之前对方就有活三以上的（拆形）→ 转完必须真的低于活三
//   · 转之前对方没有威胁的（调形）→ 我自己必须真的跨了一档
// 再加一条上界：转动占自己回合的比例不许超过 1/6（现在是 3~7%，留了一倍余量）。
// ---------------------------------------------------------------------------
function selfPlayRotAudit(n, firstPlayer, lvBlack, lvWhite, seed, maxPlies, cooldown) {
  const s = mkSession(n, firstPlayer, true, cooldown);
  const rng = rngOf(seed);
  const winLength = s.rules.winLength;
  const threat = (who) => aiThreatBest(s.board, aiCandidates(s.board, 20000), who, winLength,
                                       s.rules.isRestricted(who, s.firstPlayer));
  const bad = [];
  let plies = 0, rotations = 0, myTurns = 0;
  while (s.status === "Playing" && plies < maxPlies) {
    const me = s.currentPlayer, you = opponentOf(me);
    const mineBefore = threat(me), foeBefore = threat(you);
    const act = aiChooseMove(s, { level: me === BLACK ? lvBlack : lvWhite,
                                  seed: (rng() * 4294967296) >>> 0 });
    if (act.kind === "none") break;
    myTurns++;
    const r = applyAction(s, act);
    if (!r || r.status === MoveStatus.Rejected || (act.kind === "rotate" && !r.accepted)) {
      bad.push("第 " + plies + " 手被引擎拒了");
      break;
    }
    if (act.kind === "rotate") {
      rotations++;
      const foeAfter = threat(you), mineAfter = threat(me);
      if (foeAfter >= AI_W.THREE) {
        bad.push("第 " + plies + " 手：转完还给对方留了活三以上（" + foeAfter + "）");
      } else if (foeBefore >= AI_W.THREE) {
        if (!(foeAfter < foeBefore)) {
          bad.push("第 " + plies + " 手：对方本来有活三以上，转完却没降下去");
        }
      } else if (!(aiTier(mineAfter) > aiTier(mineBefore))) {
        bad.push("第 " + plies + " 手：既没拆对方的形、自己也没跨档，白转一手");
      }
    }
    if (s.status === "Playing" && s.currentPlayer === me) { bad.push("第 " + plies + " 手回合没翻转"); break; }
    plies++;
  }
  return { bad, plies, rotations, myTurns, status: s.status };
}

for (const lv of ["medium", "high", "xhigh", "ultra"]) {
  const r = selfPlayRotAudit(10, BLACK, lv, lv, 771, 140, 3);
  check(r.bad.length === 0,
    "四维转动的不变量 [" + lv + "]：转完不给对方留活三、拆形真的拆掉了、调形真的跨了档",
    r.bad.slice(0, 3).join("；"));
}
{
  // 上界的样本要够大：单档跑一局可能刚好一手都没转，那种"0 ≤ 上界"是空转的。
  let rotations = 0, turns = 0;
  for (const lv of ["medium", "high", "xhigh", "ultra"]) {
    for (let g = 0; g < 3; g++) {
      const r = selfPlayRotAudit(10, BLACK, lv, lv, 900 + g * 13, 140, 3);
      rotations += r.rotations; turns += r.myTurns;
    }
  }
  check(turns > 60, "前置：转动比例的样本量够（真跑了不少手）", "回合 " + turns);
  check(rotations / Math.max(1, turns) <= 1 / 6,
    "四维里转动是可数的少数派（不超过自己回合的 1/6），不是「一直在转」",
    "转了 " + rotations + " 次 / 自己走了 " + turns + " 手 = " +
    (100 * rotations / Math.max(1, turns)).toFixed(1) + "%");
  console.log("四维转动审计：" + rotations + " 次转动 / " + turns + " 个回合");
}

// 四维要比三维想得深。**这条是源码级的** —— 只验"参数接上了"，
// 深度到底带来多少棋力靠上面那组自对局的强弱关系，以及人工试玩。
{
  const fn = fullScript.slice(fullScript.indexOf("function aiSearchMove"),
                              fullScript.indexOf("function aiGreedyMove"));
  check(fn.indexOf("rotationEnabled") >= 0 && fn.indexOf("depth4d") >= 0,
    "搜索在四维下用的是 depth4d（三维下仍用 searchDepth）",
    "aiSearchMove 里没有读到 rotationEnabled / depth4d");
  const shallow = AI_LEVELS.filter((l) => (AI_PARAMS[l].depth4d || 0) < (AI_PARAMS[l].searchDepth || 0));
  check(shallow.length === 0,
    "四维的深度没有一档比三维浅（否则就是「四维反而想得更少」）", shallow.join(","));
  // 【为什么只点名中/高，而不是"至少三档变深"】四维下"多算一层"要到手机上也还划得来，
  // 但顶两档在三维就已经是深 5 了，四维再加一层就是深 6 —— 实测单手上限 1.2 秒（三维，
  // 本机），手机还要再慢三四倍。所以这条钉的是"该深的那两档确实深了"，不是"深的档数够多"。
  const deeper = AI_LEVELS.filter((l) => (AI_PARAMS[l].depth4d || 0) > (AI_PARAMS[l].searchDepth || 0));
  check(deeper.indexOf("medium") >= 0 && deeper.indexOf("high") >= 0,
    "四维下中档和高档确实比三维想得深", "实际加深的是 " + (deeper.join(",") || "（一档都没有）"));
}

// 搜索深度一律用**奇数**。这条不是审美，是量出来的。
//
// 【量法】同一套参数只改 searchDepth、两色各半、每组 24 局：
//   深 2 打深 1  = 29.2%   ← 更深反而更弱
//   深 3 打深 2  = 83.3%
//   深 4 打深 3  = 33.3%   ← 更深反而更弱
//   深 5 打深 4  = 45.8%
//   深 6 打深 5  = 62.5%   ← 这一对是偶数赢的
//   深 5 打深 3  = 75.0%   ← 所以"加深度"这条路本身是通的
//
// 【为什么不写成"偶数一律差"】6 打 5 就是偶数赢的（62.5%，24 局的噪声里）。
// 机理没有定论：通行解释是叶子评估和"轮到谁"绑得太紧（aiEvalLeaf 里那个 0.5 折扣
// 是给"该走的那一方"满权），奇偶一翻含义就变；要根治得做静止搜索，这一版没做。
// **于是我们不解它，只避开它**：阶梯按 1 / 3 / 5 排。以后谁想加一档深度，
// 先把上面这张表在自己那套参数上重量一遍 —— 别照着"越深越强"想当然。
{
  const even = [];
  for (const l of AI_LEVELS) {
    const p = AI_PARAMS[l] || {};
    if ((p.searchDepth || 0) > 0 && p.searchDepth % 2 === 0) even.push(l + "(三维" + p.searchDepth + ")");
    if ((p.depth4d || 0) > 0 && p.depth4d % 2 === 0) even.push(l + "(四维" + p.depth4d + ")");
  }
  check(even.length === 0, "搜索深度一律是奇数（偶数深度实测打不过比它浅一层的奇数深度）",
        "这几个是偶数：" + even.join(","));
}

// ---------------------------------------------------------------------------
// 6. 随机源：确定性 + 不许用 Math.random
// ---------------------------------------------------------------------------

{
  const s = mkSession(15, BLACK, false);
  put(s, BLACK, [[7, 7, 7], [8, 8, 8]]);
  put(s, WHITE, [[6, 6, 6], [7, 8, 8]]);
  s.inner.currentPlayer = BLACK;
  const a = JSON.stringify(aiChooseMove(s, { level: "low", seed: 42 }));
  const b = JSON.stringify(aiChooseMove(s, { level: "low", seed: 42 }));
  eq(b, a, "同种子同局面必须给出同一动作");

  const seen = new Set();
  for (let seed = 0; seed < 200; seed++) {
    seen.add(JSON.stringify(aiChooseMove(s, { level: "low", seed })));
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
  aiChooseMove(s, { level: "ultra", seed: 8, stats: st });
  check(st.rotProbes > 0, "四维下强档会去探转动", "rotProbes=" + st.rotProbes);
  check(st.rotProbes <= AI_PARAMS.ultra.rotProbe, "探针数受参数表上限约束",
        "rotProbes=" + st.rotProbes);
  // 三维下一次都不许探
  const s3 = mkSession(8, BLACK, false);
  s3.place(3, 3, 3);
  const st3 = {};
  aiChooseMove(s3, { level: "ultra", seed: 8, stats: st3 });
  eq(st3.rotProbes, 0, "三维模式下一次转动都不该探");
}

{
  // 冷却没到就不许探转动
  const s = mkSession(8, BLACK, true, 5);
  s.place(3, 3, 3);
  const st = {};
  aiChooseMove(s, { level: "ultra", seed: 8, stats: st });
  eq(st.rotProbes, 0, "冷却未到时一次转动都不该探");
}

// ---------------------------------------------------------------------------
// 8. 五档的强弱关系：对方做活三时去堵的比例（low 明显低，搜索档全 100%）
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
  console.log("对方活三时去堵的比例（各 60 局）：low " + counts.low +
              " / medium " + counts.medium + " / high " + counts.high + " / xhigh " + counts.xhigh + " / ultra " + counts.ultra);
  // 【注意这个指标在搜索档上饱和了】中/强 都是 100%，所以它只能证明"弱档不总堵、
  // 搜索档每次都堵"，证不了"中 < 强"。后者由下面第 8.5 组的真对局来证。
  check(counts.low < counts.medium,
        "low 档不是每个活三都去堵（这是它「弱」的主要来源）",
        "low " + counts.low + " / medium " + counts.medium + "（各 60 局）");
  // 四个搜索档都该 100%：活三的堵点就是"对方在那里做活四"，威胁计数看得见
  for (const lv of ["medium", "high", "xhigh", "ultra"]) {
    eq(counts[lv], 60, lv + " 档每个活三都去堵（它已经会搜索了）");
  }
}

// ---------------------------------------------------------------------------
// 8.5 「你选的这一手像不像话」—— 名次不变量
//
// 【这一组是冲着 v2.10.0 的一个真 bug 去的】那一版里 `scored.sort()` 被写在
// `if (blockAt)` 分支**里面**，于是没有活三威胁的时候那个数组从来没排过序，
// `scored[0]` 拿的是"扫描到的第一个候选"（基本就是 z/y/x 最小的那一带，棋盘角落）。
// 三档在大多数回合里都在乱下 —— 而当时的 66 项断言全绿，因为它们只测了硬规则
// （能赢必赢、必堵必堵、不自尽）和堵活三的比例，**没有一条问过"你选的这一手像不像话"**。
// 硬规则是判断链兜住的，判断链之外的着法当时完全没人管。
//
// 这里钉的是结构性的那一条：无论走打分还是走搜索，选中的那一手必须在引擎自己的
// 排序键里排前 4 名（打分档从前 topK 名里挑，搜索档只看前 branch 名，都是 4）。
// 那个 bug 下选中的角落格子名次在两百名开外，这一条会当场红。
// ---------------------------------------------------------------------------

{
  const wl = 5;
  // 排序键和引擎用的是同一把尺子：威胁计数 → 分值，攻守相加。
  // 【必须和引擎口径一致】这两边一旦漂移，这条不变量就成了"自己跟自己比"，
  // 什么都验不出来 —— 所以这里用的是引擎导出的那两个函数，不是另写一份。
  const keyOf = (s, x, y, z, mover) => {
    const foe = opponentOf(mover);
    const myRes = s.rules.isRestricted(mover, s.firstPlayer);
    const foeRes = s.rules.isRestricted(foe, s.firstPlayer);
    return aiThreatValue(aiThreatAt(s.board, x, y, z, mover, wl, myRes)) +
           aiThreatValue(aiThreatAt(s.board, x, y, z, foe, wl, foeRes));
  };
  const rankOf = (s, a, mover) => {
    const mine = keyOf(s, a.x, a.y, a.z, mover);
    const cand = aiCandidates(s.board, 20000);
    let better = 0;
    for (let i = 0; i < cand.length; i += 3) {
      if (keyOf(s, cand[i], cand[i + 1], cand[i + 2], mover) > mine) better++;
    }
    return better + 1;
  };

  // 三个局面：都没有"立刻分出胜负"的点，所以判断链一步都不会提前返回，
  // 走的一定是打分/搜索那条路 —— 正好是 bug 藏身的地方。
  const cases = [
    ["自己两连", (s) => { put(s, BLACK, [[5, 5, 5], [6, 5, 5]]);
                          put(s, WHITE, [[8, 9, 9], [9, 9, 9]]); }],
    ["对方两连", (s) => { put(s, WHITE, [[5, 5, 5], [6, 5, 5]]);
                          put(s, BLACK, [[8, 9, 9]]); }],
    ["对方活三", (s) => { put(s, WHITE, [[5, 5, 5], [6, 5, 5], [7, 5, 5]]);
                          put(s, BLACK, [[5, 9, 9], [6, 9, 9]]); }],
    ["开局散子", (s) => { put(s, BLACK, [[7, 7, 7], [9, 9, 9]]);
                          put(s, WHITE, [[6, 6, 6], [8, 8, 8]]); }],
  ];

  // 名次上界按档位分开：
  //   · 中/强 走搜索，而搜索**只看排序后的前 branch(=4) 个**，所以 4 是结构性保证
  //   · 弱档有噪声（乘性抖动会把低分格抬进前几名），还有一条按 defBest 走的堵活三分支
  //     （它挑的是"对方在那里最能做出东西"的点，未必是全键的前几名），所以放宽到 40。
  //     实测最差 19 名。**那个 bug 下这个数是两百名开外**，所以 40 一样抓得住。
  // 【ultra 单独放宽】它先跑算杀（VCF），而算杀挑的是"能补成四"的点，
  // 不保证那个点在全键的前 4 名（全键里"对方在那做活四"的点分更高）。
  // 放宽到 64 仍然远小于那个 bug 下的两百名开外。
  const RANK_MAX = { low: 40, medium: 4, high: 4, xhigh: 4, ultra: 64 };

  for (const [name, setup] of cases) {
    for (const level of AI_LEVELS) {
      const seeds = level === "low" ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 1, 2];
      let worst = 0;
      for (const seed of seeds) {
        const s = mkSession(15, BLACK, false);
        setup(s);
        s.inner.currentPlayer = BLACK;
        const a = aiChooseMove(s, { level, seed });
        if (a.kind !== "place") { worst = 999; break; }
        const r = rankOf(s, a, BLACK);
        if (r > worst) worst = r;
      }
      check(worst <= RANK_MAX[level],
            "选的那一手排在引擎自己排序键的前 " + RANK_MAX[level] + " 名 [" + level + " · " + name + "]",
            "最差名次 " + worst + "（超了就说明着法不是按分数挑的）");
    }
  }
}

// ---------------------------------------------------------------------------
// 8.6 开局：人机的第二手必须接着**自己**那一手，不许跟着玩家跑到别的层去
//
// 【这是一条冲着 v2.10.14 修掉的那个真 bug 去的断言】症状是玩家报的：人机先手天元 (7,7,7)，
// 玩家下在第一层的角落，人机第二手跟着下到第一层去 —— 而它本该接着自己那一手。
//
// 【根因在排序，不在评估】搜索档只看排序键的前 `branch`(=4) 名。开局时"贴我这颗子"
// 和"贴玩家那颗子"的键**恰好同分**（都是活二 40 分，两边各二十几个点全是 40），
// 平手时 aiSearchCompare 按 (x,y,z) 升序排 —— 于是前 4 名永远是坐标最小的那一角，
// 也就是玩家下棋的那一层。搜索再聪明也没用：它压根没看到自己那一带的点。
// （打分档的 aiCompare 有"离中心近优先"的二级键，所以低档反而没这个毛病 —— 这也是
//  这条 bug 只出现在中档以上的原因。）
//
// 断言直接钉行为：**第二手必须落在自己第一手的邻域里**。开局只有两颗散子，
// 接着自己下是本手；跑去找玩家那一层是纯粹被带着走。
// ---------------------------------------------------------------------------
{
  /** 谢比雪夫距离：一子在不在另一子的 26 邻域里。 */
  const cheb = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  const CENTER = [7, 7, 7];
  // 玩家的落点覆盖各个方向：角落里、贴边、自己正下方、上一层、最远的角
  const foeAt = [[2, 2, 0], [0, 0, 0], [12, 3, 0], [7, 7, 0], [3, 11, 1], [14, 14, 14]];

  for (const p of foeAt) {
    for (const level of AI_LEVELS) {
      // 低档有噪声和"从前几名里随机挑"，所以要多数几个种子；其余档是确定性的
      const seeds = level === "low" ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 1, 2];
      let worst = 0;
      for (const seed of seeds) {
        const s = mkSession(15, BLACK, false);
        s.place(CENTER[0], CENTER[1], CENTER[2]);      // 人机先手：天元
        s.place(p[0], p[1], p[2]);                     // 玩家
        const a = aiChooseMove(s, { level, seed });
        if (a.kind !== "place") { worst = 999; break; }
        const d = cheb(CENTER, [a.x, a.y, a.z]);
        if (d > worst) worst = d;
      }
      check(worst <= 1,
            "第二手接着自己那一手 " + "[玩家 (" + p.join(",") + ") · " + level + "]",
            "离天元 " + worst + "（本应 ≤1；跑到玩家那一层说明它被带着走了）");
    }
  }
}

// ---------------------------------------------------------------------------
// 8.7 五档的强弱关系，用**真对局**量
//
// 上面那条"堵活三比例"在搜索档上饱和了（都是 100%），所以强弱只能靠对局。
// 方法论上有三处必须做对，否则量出来的是假数据（三条我都踩过）：
//   1. **随机开局**。搜索是确定性的、不消耗随机数，固定开局下"40 局"其实是同一盘棋重复 40 次。
//   2. **两色各半**。这个棋里先手优势很大，同色自比几乎恒为"黑胜"，所以必须两边都下一遍。
//   3. **配对计分**（v2.10.14 补的）。光"两色各半"不够：如果颜色和开局手数各排各的
//      （偶数局执黑、开局手数又按另一个周期走），两者就混在一起了。实测过一次：
//      两边内核**完全相同**的对照组照样打出 53 / 55 / 53 / 60% —— 第一方被系统性照顾。
//      现在第 2k 局与第 2k+1 局共享开局种子、只对调颜色，对照组的分数**恒等于 50.0%**，
//      拿它当"测量台有没有坏"的自检。测试运行时的耗时也因此减半（同一开局下
//      两边走出的棋一模一样，胜负必然对调）。
// 断言不看单局、只看胜分率，而且留了余量。
// ---------------------------------------------------------------------------

{
  function duel(levelA, levelB, games, seedBase) {
    let score = 0, wins = 0, losses = 0, draws = 0, plies = 0;
    for (let i = 0; i < games; i++) {
      const aIsBlack = i % 2 === 0;
      const s = mkSession(15, BLACK, false);
      // 配对：同 (i>>1) 的两局共享开局种子，只对调颜色
      const rng = rngOf(seedBase + (i >> 1) * 7);
      const open = ((i >> 1) % 4) * 2;             // 0 / 2 / 4 / 6 手随机开局
      for (let j = 0; j < open && s.status === "Playing"; j++) {
        const em = [];
        for (let z = 4; z < 9; z++) for (let y = 4; y < 9; y++) for (let x = 4; x < 9; x++) {
          if (s.board.isEmpty(x, y, z)) em.push([x, y, z]);
        }
        const m = em[(rng() * em.length) | 0];
        s.place(m[0], m[1], m[2]);
      }
      let n = open;
      while (s.status === "Playing" && n < 240) {
        const lv = ((s.currentPlayer === BLACK) === aIsBlack) ? levelA : levelB;
        const a = aiChooseMove(s, { level: lv, seed: (rng() * 4294967296) >>> 0 });
        if (a.kind !== "place") break;
        if (s.place(a.x, a.y, a.z).status === MoveStatus.Rejected) break;
        n++;
      }
      plies += n;
      const aWon = (s.winner === BLACK && aIsBlack) || (s.winner === WHITE && !aIsBlack);
      if (s.winner === EMPTY) { score += 0.5; draws++; }
      else if (aWon) { score += 1; wins++; }
      else losses++;
    }
    return { score: score, wins: wins, losses: losses, draws: draws, games: games,
             avg: Math.round(plies / games) };
  }

  // 【阈值定在 55%，不是 70%】实测相邻两档的差距在 52.5%~87.5% 之间（各 40 局、配对计分）：
  // 中打低 87.5%、高打中 85.0%、极高打高 77.5%，而**极限打极高只有 52.5%** ——
  // 极限档比极高档多的只有"根节点那一遍算杀"和"够便宜就多算一层"，两样加起来落在噪声里。
  // 越往上边际收益越小，所以阈值只用来抓"档次被写反了"这类回归。
  // **这条断言确实抓到过一次**：v2.10.14 之前极高档是深 4，而实测**深 4 打不过深 3**
  // （33.3%，24 局）—— 极高档一直比高档弱。当时这条断言是能过的（16 局拿到 9 胜，
  // 概率约 11%），**是靠噪声过的**。配对计分之后这种运气没了。
  for (const [strong, weak] of [["medium", "low"], ["high", "medium"], ["xhigh", "high"], ["ultra", "xhigh"], ["ultra", "low"]]) {
    const r = duel(strong, weak, 16, 4000);
    console.log(`${strong} vs ${weak}：${r.score}/${r.games}（胜 ${r.wins} / 负 ${r.losses} / 和 ${r.draws}）平均 ${r.avg} 手`);
    check(r.score > r.games * 0.55,
          strong + " 档强于 " + weak + " 档（真对局，随机开局 + 两色各半）",
          `得分 ${r.score}/${r.games}`);
  }
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
  const act = aiChooseMove(s, { level: "ultra", seed: 3, stats: st });
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
  // 30³ 的最坏情况：一条"墙"里塞满子。
  // 【为什么从 50³ 改成 30³】v2.10.15 把 BoardLimits.Max 从 50 降到 30，
  // 50³ 这个最坏情况整个不存在了。这一块仍然要有 —— 它是"密盘不失控"的唯一证据。
  const s = mkSession(30, BLACK, false);
  for (let z = 0; z < 4; z++) {
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < 30; x++) {
        if ((x + y + z) % 2 === 0) s.board.set(x, y, z, ((x + y) % 4 < 2) ? BLACK : WHITE);
      }
    }
  }
  s.inner.currentPlayer = BLACK;
  const st = {};
  const t0 = Date.now();
  aiChooseMove(s, { level: "low", seed: 1, stats: st });
  const ms = Date.now() - t0;
  check(st.candidates <= 20000, "30³ 密集局面下候选数被截到上限以内",
        "候选 " + st.candidates);
  check(ms < 1500, "30³ 密集局面单手在 1500ms 以内", ms + "ms（候选 " + st.candidates + "）");
  console.log("30³ 密集（" + s.board.stoneCount + " 子）：候选 " + st.candidates + "，用时 " + ms + "ms");

  // 【顶上两档也必须在这块盘上量一遍】算杀进搜索之后，密盘上的开销全在算杀上 ——
  // 候选上千个，算杀每走一格要扫两遍。不量的话，"极限档在密盘上单手 2.9 秒"
  // 这种事故没有任何断言拦得住（那个数就是这么发现的，v2.10.14 把预算改成按
  // "扫了多少个点"记账之后压到 0.7 秒）。
  // 【为什么还留一条墙钟】记账只保证"扫的点数有上限"，但一个点要扫多久是机器的
  // 事 —— 这条兜底的是"有人把预算那几行删了"。v2.10.15 只把【极限档】那条撤掉
  // （改用计数上界，见下面的 AI_POINT_BUDGET_MAX），极高档这条保留。
  for (const lv of ["xhigh", "ultra"]) {
    const st2 = {};
    const t1 = Date.now();
    aiChooseMove(s, { level: lv, seed: 1, stats: st2 });
    const ms2 = Date.now() - t1;
    check(ms2 < 2000, "30³ 密集局面下 " + lv + " 档单手在 2000ms 以内",
          ms2 + "ms（候选 " + st2.candidates + "，算杀 " + st2.vcfNodes + " 格）");
    console.log("30³ 密集 · " + lv + "：用时 " + ms2 + "ms，算杀 " + st2.vcfNodes + " 格");
  }
}

// ---------------------------------------------------------------------------
// 10. 威胁计数的「条带」重写必须是【无损】的
//
// 这一组是全计划里唯一一处"只求变快、不许改结果"的改动，所以判据只能是
// **与旧实现逐字段对拍**。旧实现冻结在下面（aiThreatAtRef），它就是 v2.10.14 的那一段，
// 一个字没动。【别以为这是废话】热循环重写最容易出的错是"大部分局面都对，
// 只在某种跳形/边界上差一格" —— 那种错在自对局里根本看不出来，只会让棋力悄悄降一点。
// ---------------------------------------------------------------------------

/**
 * 【冻结的基准】v2.10.14 的 aiThreatAt 原文。**不许改它**，也不许"顺手优化"。
 * 它的唯一用途是给新实现当对拍基准 —— 改了它，对拍就变成了拿新实现跟自己比。
 */
const REF_DIRS = Core.DIRS13;
const REF_NEG = REF_DIRS.map((d) => [-d[0], -d[1], -d[2]]);
const REF_PT = { x: 0, y: 0, z: 0 };   // 提到函数外：在函数里 map 一遍会让基准每次都分配，
                                       // 那样计时对拍就不公平了（基准慢的是分配，不是算法）
function aiThreatAtRef(board, x, y, z, player, winLength, restricted) {
  const DIRS = REF_DIRS;
  const NEG = REF_NEG;
  const PT = REF_PT;
  let wins = 0, fours = 0, openFours = 0, threes = 0, twos = 0, over = 0;
  for (let i = 0; i < DIRS.length; i++) {
    const d = DIRS[i], nd = NEG[i];
    PT.x = x; PT.y = y; PT.z = z;
    const neg = RuleEngine.countRun(board, PT, nd, player);
    const pos = RuleEngine.countRun(board, PT, d, player);
    const run = 1 + neg + pos;
    if (run > winLength) { over++; continue; }
    const ax = x - (neg + 1) * d[0], ay = y - (neg + 1) * d[1], az = z - (neg + 1) * d[2];
    const bx = x + (pos + 1) * d[0], by = y + (pos + 1) * d[1], bz = z + (pos + 1) * d[2];
    const openA = board.inBounds(ax, ay, az) && board.get(ax, ay, az) === EMPTY;
    const openB = board.inBounds(bx, by, bz) && board.get(bx, by, bz) === EMPTY;
    let need = winLength;
    for (let s = -(winLength - 1); s <= 0 && need > 0; s++) {
      let ok = true, mine = 0;
      for (let k = 0; k < winLength; k++) {
        if (s + k === 0) continue;
        const px = x + (s + k) * d[0], py = y + (s + k) * d[1], pz = z + (s + k) * d[2];
        if (!board.inBounds(px, py, pz)) { ok = false; break; }
        const v = board.get(px, py, pz);
        if (v === EMPTY) continue;
        if (v === player) mine++; else { ok = false; break; }
      }
      if (!ok) continue;
      const gap = winLength - (mine + 1);
      if (gap < need) need = gap;
    }
    if (need === 0) wins++;
    else if (need === 1) { fours++; if (run === winLength - 1 && openA && openB) openFours++; }
    else if (need === 2) threes++;
    else if (need === 3) twos++;
  }
  return { wins: wins, fours: fours, openFours: openFours, threes: threes, twos: twos, over: over };
}

{
  const STONES = [EMPTY, BLACK, WHITE];
  let mismatches = 0, checked = 0;
  const rng = rngOf(20260929);
  for (let trial = 0; trial < 400; trial++) {
    // 尺寸在边界上取：8（下限）和 30（新上限），外加一个长方体
    const dims = trial % 3 === 0 ? [8, 8, 8] : (trial % 3 === 1 ? [30, 30, 30] : [8, 30, 30]);
    const b = new Board3D(dims[0], dims[1], dims[2]);
    const fill = 0.15 + 0.5 * rng();
    for (let z = 0; z < dims[2]; z++)
      for (let y = 0; y < dims[1]; y++)
        for (let x = 0; x < dims[0]; x++)
          if (rng() < fill) b.set(x, y, z, STONES[(rng() * 3) | 0]);
    for (let k = 0; k < 40; k++) {
      const x = (rng() * dims[0]) | 0, y = (rng() * dims[1]) | 0, z = (rng() * dims[2]) | 0;
      const player = rng() < 0.5 ? BLACK : WHITE;
      const a = aiThreatAt(b, x, y, z, player, 5, false);
      const c = aiThreatAtRef(b, x, y, z, player, 5, false);
      checked++;
      if (a.wins !== c.wins || a.fours !== c.fours || a.openFours !== c.openFours ||
          a.threes !== c.threes || a.twos !== c.twos || a.over !== c.over) {
        mismatches++;
        if (mismatches <= 3) {
          console.log("  差异 @" + [x, y, z] + " " + dims + " player=" + player +
                      " 新 " + JSON.stringify(a) + " 旧 " + JSON.stringify(c));
        }
      }
    }
  }
  check(checked > 10000, "对拍样本量够", "只比了 " + checked + " 个点");
  check(mismatches === 0, "条带重写与旧实现逐字段一致（无损）",
        mismatches + " / " + checked + " 个点不一致");
  console.log("威胁计数对拍：" + checked + " 个点，" + mismatches + " 处不一致");
}

{
  // 条带是定长 9 的数组，winLength 一变大就会越界写。
  // 这一条钉住"装不下时退回老路"，退回去的那条路也必须真的算对。
  const b = new Board3D(20, 20, 20);
  const rng = rngOf(777);
  for (let k = 0; k < 400; k++) b.set((rng() * 20) | 0, (rng() * 20) | 0, (rng() * 20) | 0,
                                      rng() < 0.5 ? BLACK : WHITE);
  let bad = 0;
  for (let k = 0; k < 200; k++) {
    const x = (rng() * 20) | 0, y = (rng() * 20) | 0, z = (rng() * 20) | 0;
    // winLength = 6：条带装不下，必须走慢路，且结果与参考实现一致
    const a = aiThreatAt(b, x, y, z, BLACK, 6, false);
    const c = aiThreatAtRef(b, x, y, z, BLACK, 6, false);
    if (JSON.stringify(a) !== JSON.stringify(c)) bad++;
  }
  check(bad === 0, "winLength ≠ 5 时退回老写法，且结果一致", bad + " 处不一致");
}

{
  // 【不是断言，是出数字】墙钟在慢机器上会抖，所以只打印不判红。
  // 这个数进 commit message，是 3.3「走法生成优化」这半边的唯一证据。
  //
  // 【棋盘必须用真实局面，不能用密盘】条带的收益随盘面密度**急剧变化**：
  // 老写法在密盘上大量窗口会撞到对手子而提前 break，条带却是固定读满 11 格，
  // 于是密盘上只快 1.2×；而真实对局是稀疏局面（老写法要一路扫到底），那里快近 2×。
  // 第一版用 30³ 塞 6000 子的密盘测，报出来 1.17×，把这条优化的价值说小了一半。
  const b = new Board3D(15, 15, 15);
  const rng = rngOf(31337);
  let placed = 0, guard = 0;
  while (placed < 40 && guard++ < 4000) {
    const x = 3 + ((rng() * 9) | 0), y = 3 + ((rng() * 9) | 0), z = 3 + ((rng() * 9) | 0);
    if (b.isEmpty(x, y, z)) { b.set(x, y, z, rng() < 0.5 ? BLACK : WHITE); placed++; }
  }
  const cands = aiCandidates(b, 20000);
  // 【必须重复很多遍】一轮只有 600 多个候选、不到 1ms，而 Date.now() 的分辨率是 1ms ——
  // 单轮计时会量出 "0ms vs 1ms，快 100×" 这种胡说，而它比不量还糟（会被人当真引用）。
  // 所以固定跑 REPEATS 轮、报总耗时，比值按总耗时算。
  const REPEATS = 200;
  const bench = (fn) => {
    const t0 = Date.now();
    for (let r = 0; r < REPEATS; r++)
      for (let i = 0; i < cands.length; i += 3)
        for (const p of [BLACK, WHITE]) fn(b, cands[i], cands[i + 1], cands[i + 2], p, 5, false);
    return Date.now() - t0;
  };
  bench(aiThreatAt); bench(aiThreatAtRef);          // 预热，甩掉 JIT 冷启动
  let msNew = Infinity, msOld = Infinity;
  for (let r = 0; r < 5; r++) { msNew = Math.min(msNew, bench(aiThreatAt));
                                msOld = Math.min(msOld, bench(aiThreatAtRef)); }
  check(msNew <= msOld, "条带版不比旧版慢（同机同批候选）",
        "新 " + msNew + "ms vs 旧 " + msOld + "ms（各 " + REPEATS + " 轮）");
  console.log("威胁计数（15³ 中盘 " + b.stoneCount + " 子、" + (cands.length / 3) +
              " 候选 × 2 方 × " + REPEATS + " 轮）：新 " + msNew + "ms / 旧 " + msOld +
              "ms（快 " + (msOld / Math.max(1, msNew)).toFixed(2) + "×）");
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
