// 新旧电脑对手的配对 A/B 测量台。
//
// 【为什么必须是"配对"，不能是"两色各半"】这个工程已经踩过一次：
// 两边内核**完全相同**的对照组照样打出 53 / 55 / 53 / 60% —— 第一方被系统性照顾。
// 原因是颜色和开局手数各排各的周期，混在一起了。现在第 2k 局与第 2k+1 局
// **共享同一个开局种子、只对调颜色**，于是对照组恒等于 50.0%。
// 对照组的分数不是恰好 50.0% 就说明测量台坏了，这时**不许报胜率**。
// （这套方法论见 Web_Gomoku3D/tests/ai.test.mjs 的 selfPlay 那一节。）
//
// 【为什么旧版从 git 取】"新旧对拍"要的是两份真的内核，不是同一份代码换个参数。
// --old 可以给 git revision（如 4337e18），脚本用 git show 取出那一版 index.html
// 再抽内核；也可以直接给一个文件路径。
//
// 用法：
//   node _verify/ai-ab.mjs --mode 2d --2d-variant classic --games 2000 \
//        --new Web_Gomoku3D/index.html --old _verify/fixtures/ultra-baseline-6203b1a0.html
//   node _verify/ai-ab.mjs --mode 4d --4d-default --games 2000 \
//        --new Web_Gomoku3D/index.html --old _verify/fixtures/ultra-baseline-6203b1a0.html
//   node _verify/ai-ab.mjs --mode 3d --size 15 --games 40 --new HEAD --old 4337e18
//   # 测量台自检：新旧都给同一份文件，得分率必须恰好 50.0%
//   node _verify/ai-ab.mjs --mode 2d --2d-variant classic --games 20 \
//        --new _verify/fixtures/ultra-baseline-6203b1a0.html \
//        --old _verify/fixtures/ultra-baseline-6203b1a0.html
//
// 退出码：0 = 达到目标线（或对照组自检通过）；1 = 未达到 / 对照组坏了。
// 中途开发时（新版还没变强）会返回 1，那是预期的，看输出里的数字就行。

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { engineTiming } from './ai-ab-timing.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.resolve(HERE, "..");
const HTML_REL = "Web_Gomoku3D/index.html";
let checkpoint = null;

// 2D 附加玩法的组合名，与 _verify/selfplay.mjs 完全一致。
const TWO_D_VARIANTS = {
  classic: { h: false, f: false, a: false },
  h:       { h: true,  f: false, a: false },
  f:       { h: false, f: true,  a: false },
  a:       { h: false, f: false, a: true  },
  hf:      { h: true,  f: true,  a: false },
  ha:      { h: true,  f: false, a: true  },
  fa:      { h: false, f: true,  a: true  },
  hfa:     { h: true,  f: true,  a: true  },
};

// 与 _verify/selfplay.mjs 的 SIZE_RANGES["2d"] 一致。2D 宽高独立。
const SIZE_RANGES_2D = {
  classic: [12, 18], h: [12, 18], ha: [12, 18], a: [12, 18],
  f: [14, 18], hf: [14, 18], fa: [14, 18], hfa: [15, 18],
};
const SIZE_RANGE_4D = [8, 9];
const OPENING_MIN = 2;
const OPENING_MAX = 6;
const OPENING_TRIES = 20;

function parseArgs(argv) {
  const o = {
    mode: "3d", size: null, cooldown: 3, games: 40,
    new: "HEAD", old: "HEAD", nlv: "ultra", olv: "ultra",
    twoDVariant: "classic", fourDDefault: false, fourDWrap: false,
    fourDPhase: 0, maxPlies: null, seed: 40001, target: null,
    tag: null, json: null, checkpoint:null, resume:false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = String(argv[i] || "").replace(/^--/, "");
    const v = argv[i + 1];
    const next = () => { i++; return v; };
    if (k === "mode") o.mode = next();
    else if (k === "size") o.size = parseInt(next(), 10);
    else if (k === "cooldown") o.cooldown = parseInt(next(), 10);
    else if (k === "games") o.games = parseInt(next(), 10);
    else if (k === "new") o.new = next();
    else if (k === "old") o.old = next();
    else if (k === "nlv") o.nlv = next();
    else if (k === "olv") o.olv = next();
    else if (k === "2d-variant") o.twoDVariant = next();
    else if (k === "4d-default") o.fourDDefault = true;
    else if (k === "4d-wrap") o.fourDWrap = true;
    else if (k === "4d-phase") o.fourDPhase = parseInt(next(), 10);
    else if (k === "max-plies") o.maxPlies = parseInt(next(), 10);
    else if (k === "seed") o.seed = parseInt(next(), 10) >>> 0;
    else if (k === "target") o.target = parseFloat(next());
    else if (k === "tag") o.tag = next();
    else if (k === "json") o.json = next();
    else if (k === "checkpoint") o.checkpoint = next();
    else if (k === "resume") o.resume = true;
    else { console.error("未知参数 --" + k); process.exit(2); }
  }
  if (!["2d", "3d", "4d"].includes(o.mode)) {
    console.error("--mode 只能是 2d、3d 或 4d，收到 " + o.mode); process.exit(2);
  }
  // 【必须是 4 的倍数】duel 内部每两局配一对（aIsBlack=i%2），而 --games 又拆成
  // 两个半场各 half=games/2 局。games≡2 (mod 4) 时每个半场末尾会剩一局没有配对，
  // 对照组就不再必然 50.0% —— 这个坑是审查量出来的（--games 2 --seed 40001 曾
  // 报“自检通过”但 pairs=0）。所以两个条件一起卡。
  if (!(o.games >= 4) || o.games % 4 !== 0) {
    console.error("--games 必须是 >=4 且是 4 的倍数（每个半场还要再配对）"); process.exit(2);
  }
  if (!TWO_D_VARIANTS[o.twoDVariant]) {
    console.error("--2d-variant 只能是 " + Object.keys(TWO_D_VARIANTS).join(","));
    process.exit(2);
  }
  if (o.fourDDefault) { o.fourDWrap = true; o.fourDPhase = 12; o.cooldown = 5; }
  // 方案与 _verify/ultra-ab-config.json 的验收线统一是 55%；3D/4D 历史上用过 70%，
  // 但 P0/P1 的口径是 55%，不再按 mode 悄悄分叉。要 70% 请显式 --target 70。
  if (o.target === null) o.target = 55;
  if (!Number.isFinite(o.target) || o.target <= 0 || o.target >= 100) {
    console.error("--target 是百分数（如 55）"); process.exit(2);
  }
  if (o.size === null) o.size = o.mode === "4d" ? 8 : 15;
  if (o.maxPlies !== null && (!Number.isInteger(o.maxPlies) || o.maxPlies < 10)) {
    console.error("--max-plies 至少 10"); process.exit(2);
  }
  return o;
}

/**
 * 取一份 index.html 的正文。参数是 git revision 或文件路径。
 *
 * ★【--new HEAD 读的是【已提交】的那一版，不是工作区】这一条踩过三次：
 * 改完代码直接跑 --new HEAD，其实一直在量上一次提交的旧代码 —— 而症状是
 * **三次不同的改动给出逐字节相同的结果**（31.3% / 31.3% / 31.3%），
 * 因为那三次量的都是同一份提交。所以下面加了脏工作区告警。
 * 想量还没提交的改动，**直接给文件路径**：--new Web_Gomoku3D/index.html
 */
function readHtml(revOrPath) {
  if (fs.existsSync(revOrPath)) return fs.readFileSync(revOrPath, "utf8");
  try {
    return execFileSync("git", ["show", revOrPath + ":" + HTML_REL],
                        { cwd: PROJ, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    console.error("取不到 " + revOrPath + " 的 index.html：" + e.message);
    process.exit(2);
  }
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

const CORE_BEGIN = "/* GOMOKU-CORE-BEGIN */";
const CORE_END = "/* GOMOKU-CORE-END */";

function coreOf(html) {
  const s = html.indexOf("<script>");
  const e = html.lastIndexOf("</script>");
  if (s < 0 || e < 0) return "";
  const full = html.slice(s + "<script>".length, e);
  const at = full.indexOf(CORE_BEGIN), bt = full.indexOf(CORE_END);
  if (at < 0 || bt < 0) return "";
  return full.slice(at + CORE_BEGIN.length, bt);
}

/**
 * 与 mode 相关的内核。
 *
 * 【为什么不能只比整份 HTML】两个 fixture 可以只在“另一模式”上不同（例如只改 2D 块），
 * 整份 HTML 不同、mode 内核却逐字节相同 —— 这时 A/B 会静默打出 50.0%，看起来像
 * “两边一样强”。所以 3D/4D 先去掉 2D 块，2D 去掉 3D/4D 的 AI 段（AI_PARAMS 起），
 * 只留共享规则 + 2D 块。守卫比较的是这个 mode 内核，JSON 也写它的 sha。
 */
function modeCoreOf(html, mode) {
  const core = coreOf(html);
  if (!core) return "";
  if (mode === "2d") {
    const ai = core.indexOf("const AI_PARAMS =");
    const d2 = core.indexOf("/* GOMOKU-2D-EMBED-CORE-BEGIN */");
    if (ai >= 0 && d2 > ai) return core.slice(0, ai) + core.slice(d2);
    return core;
  }
  return core.replace(/\/\* GOMOKU-2D-EMBED-CORE-BEGIN \*\/[\s\S]*?\/\* GOMOKU-2D-EMBED-CORE-END \*\//, "");
}

/** 从 index.html 抽内核区间并求值。和 tests/ai.test.mjs 用的是同一段标记。 */
function loadCore(html, label) {
  const core = coreOf(html);
  if (!core) { console.error(label + "：找不到内核区间"); process.exit(2); }
  try {
    return new Function(core + `
      return { FourDSession, RuleSet, RotationMove, MoveStatus, EMPTY, BLACK, WHITE,
               opponentOf, aiChooseMove, aiRng, Session2D, ai2ChooseMove,
               fingerprint2, AI_PARAMS2 };`)();
  } catch (err) {
    console.error(label + "：内核求值失败 —— " + err.message);
    process.exit(2);
  }
}

/* ------------------------------------------------------------------ */
/* 3D / 4D                                                             */
/* ------------------------------------------------------------------ */

function mkSession(C, o, n) {
  const rules = new C.RuleSet();
  rules.allowRotation = o.mode === "4d";
  rules.wrapEdges = !!o.fourDWrap;
  rules.rotationCooldownPlacements = o.cooldown;
  rules.phasePeriod = o.fourDPhase | 0;
  return C.FourDSession.create(n, C.BLACK, rules);   // 永远黑先，颜色靠 aIsBlack 对调
}

function applyAction(C, s, act) {
  if (act.kind === "place") return s.place(act.x, act.y, act.z);
  if (act.kind === "rotate") {
    return s.rotate(C.RotationMove.fromClockwiseTurns(act.axis, act.layer, act.turns));
  }
  return null;
}

function openingBalancedCube(session, dirs) {
  const nx = session.board.nx, ny = session.board.ny, nz = session.board.nz;
  const cells = session.board.cells;
  const at = (x, y, z) => cells[x + nx * (y + ny * z)];
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const c = at(x, y, z);
    if (c !== 1 && c !== 2) continue;
    for (const [dx, dy, dz] of dirs) {
      let n = 1;
      for (let k = 1; k < 3; k++) {
        const xx = x + dx * k, yy = y + dy * k, zz = z + dz * k;
        if (xx < 0 || yy < 0 || zz < 0 || xx >= nx || yy >= ny || zz >= nz) break;
        if (at(xx, yy, zz) !== c) break;
        n++;
      }
      if (n >= 3) return false;
    }
  }
  return true;
}

const OPEN_DIRS13 = [
  [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, -1, 0],
  [1, 0, 1], [1, 0, -1], [0, 1, 1], [0, 1, -1],
  [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
];

/**
 * 一局 3D/4D。aIsBlack 决定 A 方执什么颜色。
 * **开局完全由 seed 决定**（搜索是确定性的、不消耗随机数），所以配对的两局
 * （seed 相同、aIsBlack 相反）走的是同一个开局、同一个 AI 种子序列，
 * 只是两边换了个颜色。
 *
 * --4d-default 时按 selfplay 的 B 口径：8–9³ 随机、开局 2–6 手、拒绝三连、
 * 贯通 + 晨昏 12 + 冷却 5。非默认的 4D/3D 沿用老口径（固定尺寸、0–6 手、无平衡过滤），
 * 避免让历史数据不可比。
 */
function playOneCube(CA, CB, o, aIsBlack, seed, pairId, maxPlies) {
  const balanced = o.mode === "4d" && o.fourDDefault;
  let n = o.size;
  if (balanced) {
    const rngSize = CA.aiRng((seed ^ 0x51ed270b) >>> 0);
    const span = SIZE_RANGE_4D[1] - SIZE_RANGE_4D[0] + 1;
    n = SIZE_RANGE_4D[0] + ((rngSize() * span) | 0);
  }
  let session = mkSession(CA, o, n);
  const rng = CA.aiRng(seed);
  const openLength = balanced
    ? OPENING_MIN + (pairId % (OPENING_MAX - OPENING_MIN + 1))
    : seed % 7;                      // 老口径：0..6 手
  // 【实际是 6×6×6，不是文档旧称的 7×7×7】hi 是开区间：half-3 .. half+2 只有 6 格。
  // 与 selfplay.mjs 的写法完全一致，所以配对/历史可比；meta.opening.note 里如实写明。
  const half = (n / 2) | 0;
  const lo = Math.max(0, half - 3), hi = Math.min(n, half + 3);
  let openingPlies = 0;

  let openingBalancedOk = false;
  if (balanced) {
    // 最多 20 次尝试；同一对两局共享 seed / 尝试序列，所以开局完全一样。
    let ok = false, lastSession = null, lastPlayed = 0;
    for (let attempt = 0; attempt < OPENING_TRIES && !ok; attempt++) {
      const s = mkSession(CA, o, n);
      const rngOpen = CA.aiRng((seed ^ 0x9e3779b9 ^ Math.imul(attempt, 0x85ebca6b)) >>> 0);
      let played = 0;
      for (let j = 0; j < openLength && s.status === "Playing"; j++) {
        const em = [];
        for (let z = lo; z < hi; z++) for (let y = lo; y < hi; y++) for (let x = lo; x < hi; x++) {
          if (s.board.isEmpty(x, y, z)) em.push([x, y, z]);
        }
        if (!em.length) break;
        const m = em[(rngOpen() * em.length) | 0];
        const r = s.place(m[0], m[1], m[2]);
        if (!r || r.status === CA.MoveStatus.Rejected) {
          throw new Error("4D 开局被拒：" + JSON.stringify(m));
        }
        played++;
      }
      lastSession = s; lastPlayed = played;
      if (openingBalancedCube(s, OPEN_DIRS13)) {
        // 直接用这份平衡开局；后面从它继续下。
        session = s;
        openingPlies = played;
        openingBalancedOk = true;
        ok = true;
      }
    }
    if (!ok && lastSession) {
      // 与 selfplay 一致：20 次都没过就接受最后一次尝试，不再另开一局。
      // openingBalancedOk 保持 false，JSON 里能看出这次没有通过平衡过滤。
      session = lastSession;
      openingPlies = lastPlayed;
    }
  } else {
    for (let j = 0; j < openLength && session.status === "Playing"; j++) {
      const em = [];
      for (let z = lo; z < hi; z++) for (let y = lo; y < hi; y++) for (let x = lo; x < hi; x++) {
        if (session.board.isEmpty(x, y, z)) em.push([x, y, z]);
      }
      if (em.length === 0) break;
      const m = em[(rng() * em.length) | 0];
      session.place(m[0], m[1], m[2]);
      openingPlies++;
    }
  }

  let plies = 0, rotations = 0, swaps = 0, invalid = 0, none = 0, endedReason = null;
  const msList = [], aMsList = [], bMsList = [];
  while (session.status === "Playing" && openingPlies + plies < maxPlies) {
    const aToMove = (session.currentPlayer === CA.BLACK) === aIsBlack;
    const lv = aToMove ? o.nlv : o.olv;
    const C = aToMove ? CA : CB;
    const t0 = process.hrtime.bigint();
    const act = C.aiChooseMove(session, { level: lv, seed: (rng() * 4294967296) >>> 0 });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    msList.push(ms); (aToMove ? aMsList : bMsList).push(ms);
    if (!act || act.kind === "none") { none++; endedReason = "none"; break; }
    const r = applyAction(CA, session, act);
    if (act.kind === "rotate") rotations++;
    if (act.kind === "swap") swaps++;
    if (!r || r.status === CA.MoveStatus.Rejected || (act.kind === "rotate" && !r.accepted)) {
      invalid++; endedReason = "invalid"; break;
    }
    plies++;
  }
  if (session.status !== "Playing" && !endedReason) endedReason = "decided";
  else if (session.status === "Playing" && !endedReason) endedReason = "maxPlies";

  const winColor = session.winner | 0;
  const aWon = (winColor === CA.BLACK && aIsBlack) || (winColor === CA.WHITE && !aIsBlack);
  const aScore = winColor === 0 ? 0.5 : (aWon ? 1 : 0);
  return {
    aScore, plies: openingPlies + plies, rotations, swaps, winColor,
    msList, aMsList, bMsList, invalid, none, endedReason,
    size: [n, n, n], openingBalanced: balanced ? openingBalancedOk : null,
  };
}

/* ------------------------------------------------------------------ */
/* 2D                                                                  */
/* ------------------------------------------------------------------ */

/** 与 selfplay.mjs 的 build2DVariant 完全一致。 */
function build2DVariant(name, seed, w, h) {
  const flags = TWO_D_VARIANTS[name] || TWO_D_VARIANTS.classic;
  const randomCount = Math.max(3, Math.min(7, Math.floor(w * h / 15)));
  return {
    on: true, w, h, freeRule: false,
    holes: { on: flags.h, randomCount, perPlayer: 0, cooldown: 5, seed: (seed >>> 0), layout: null },
    float: { on: flags.f, life: 20, opening: 8 },
    age: { on: flags.a, turns: 30, gray: 3, aura: flags.h && flags.a },
  };
}

/** 与 selfplay.mjs 的 openingBalanced 2D 分支一致。 */
function openingBalanced2D(session) {
  if (session.variant2.float.on) return true;   // 浮空开局只铺地基，没有三连可判
  const w = session.w, h = session.h, top = session.top;
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = top[x + y * w];
    if (c !== 1 && c !== 2) continue;
    for (const [dx, dy] of dirs) {
      let n = 1;
      for (let k = 1; k < 3; k++) {
        const xx = x + dx * k, yy = y + dy * k;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h || top[xx + yy * w] !== c) break;
        n++;
      }
      if (n >= 3) return false;
    }
  }
  return true;
}

function applyAction2D(C, s, act) {
  if (act.kind === "place") return s.place(act.x, act.y, act.layer);
  if (act.kind === "swap") return s.swapLines(act.axis, act.i, act.j);
  if (act.kind === "placeHole") return s.placeHole(act.x, act.y);
  return null;
}

/**
 * 一局 2D。尺寸、开局、AI 种子全部由 seed 决定；配对的两局共享 seed，只换颜色。
 * 尺寸范围与 selfplay.mjs 的 SIZE_RANGES["2d"] 一致（classic/H/HA/A 12–18，
 * F/HF/FA 14–18，HFA 15–18）；开局 2–6 手、中心 7×7、拒绝任何一方三连。
 */
function playOne2D(CA, CB, o, aIsBlack, seed, pairId, maxPlies) {
  const range = SIZE_RANGES_2D[o.twoDVariant] || SIZE_RANGES_2D.classic;
  const span = range[1] - range[0] + 1;
  const sizeRng = CA.aiRng((seed ^ 0x51ed270b) >>> 0);
  const w = range[0] + ((sizeRng() * span) | 0);
  const h = range[0] + ((sizeRng() * span) | 0);
  const openLength = OPENING_MIN + (pairId % (OPENING_MAX - OPENING_MIN + 1));

  const makeSession = () => CA.Session2D.create(
    w, h, CA.BLACK, new CA.RuleSet(), build2DVariant(o.twoDVariant, seed, w, h));

  let session = makeSession();
  const rngMove = CA.aiRng((seed ^ 0xa5a5a5a5) >>> 0);
  // 实际 6×6（开区间 half-3..half+2），与 selfplay 完全一致；文档旧称 7×7。
  const loX = Math.max(0, ((w / 2) | 0) - 3), hiX = Math.min(w, ((w / 2) | 0) + 3);
  const loY = Math.max(0, ((h / 2) | 0) - 3), hiY = Math.min(h, ((h / 2) | 0) + 3);

  let openingPlies = 0, openingAttempts = 0, openingBalancedOk = false;
  for (let attempt = 0; attempt < OPENING_TRIES; attempt++) {
    openingAttempts++;
    session = makeSession();
    openingPlies = 0;
    const rngOpen = CA.aiRng((seed ^ 0x9e3779b9 ^ Math.imul(attempt, 0x85ebca6b)) >>> 0);
    for (let j = 0; j < openLength && session.status === "Playing"; j++) {
      const em = [];
      for (let y = loY; y < hiY; y++) for (let x = loX; x < hiX; x++) {
        if (session.canPlace(x, y)) em.push([x, y]);
      }
      if (!em.length) break;
      const m = em[(rngOpen() * em.length) | 0];
      const r = session.place(m[0], m[1]);
      if (!r || r.status === CA.MoveStatus.Rejected) {
        throw new Error("2D 开局被拒：" + JSON.stringify(m));
      }
      openingPlies++;
    }
    if (openingBalanced2D(session)) { openingBalancedOk = true; break; }
  }
  if (!openingBalancedOk) {
    // 与 selfplay 一致：20 次都不过就接受最后一次，并把标记带进结果。
  }

  let plies = 0, rotations = 0, swaps = 0, invalid = 0, none = 0, endedReason = null;
  const msList = [], aMsList = [], bMsList = [];
  while (session.status === "Playing" && openingPlies + plies < maxPlies) {
    const aToMove = (session.currentPlayer === CA.BLACK) === aIsBlack;
    const lv = aToMove ? o.nlv : o.olv;
    const C = aToMove ? CA : CB;
    const t0 = process.hrtime.bigint();
    const act = C.ai2ChooseMove(session, { level: lv, seed: (rngMove() * 4294967296) >>> 0 });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    msList.push(ms); (aToMove ? aMsList : bMsList).push(ms);
    if (!act || act.kind === "none") { none++; endedReason = "none"; break; }
    const r = applyAction2D(CA, session, act);
    if (act.kind === "swap") swaps++;
    if (!r || r.status === CA.MoveStatus.Rejected) {
      invalid++; endedReason = "invalid"; break;
    }
    plies++;
  }
  if (session.status !== "Playing" && !endedReason) endedReason = "decided";
  else if (session.status === "Playing" && !endedReason) endedReason = "maxPlies";

  const winColor = session.winner | 0;
  const aWon = (winColor === CA.BLACK && aIsBlack) || (winColor === CA.WHITE && !aIsBlack);
  const aScore = winColor === 0 ? 0.5 : (aWon ? 1 : 0);
  return {
    aScore, plies: openingPlies + plies, rotations, swaps, winColor,
    msList, aMsList, bMsList, invalid, none, endedReason,
    size: [w, h], openingBalanced: openingBalancedOk, openingAttempts,
  };
}

/* ------------------------------------------------------------------ */
/* 配对                                                                */
/* ------------------------------------------------------------------ */

/**
 * 跑 games 局，A 方是"新版"那个内核。
 *
 * ★【这里踩过一次，别再合并回一个参数】第一版只收一个内核 CA，然后把它同时喂给两边 ——
 * 于是"新旧对拍"实际上跑的是**同一份内核自己打自己**，得分必然恒等于 50.0%。
 * 症状极隐蔽：数字看着正常（50.0% 正是"一样强"的合理读数），
 * 只有"两个半场都是 12/24"这种过分对称才露馅。
 * 现在每局按"轮到谁"选内核（见 playOne*），并且开头有一道断言把两份源码不同钉死。
 */
function duel(CA, CB, o, games, seedBase, maxPlies) {
  let gameElapsedMs=0;
  let score = 0, wins = 0, losses = 0, draws = 0, plies = 0;
  let rotations = 0, swaps = 0, invalid = 0, none = 0, maxPliesGames = 0;
  let blackWins = 0, blackDecided = 0;
  // A 方按“它自己执什么颜色”累计；不能拿 r1/r2 的半场分冒充执黑/执白 ——
  // 每个半场内部 aIsBlack 也在交替，半场是混合色。
  let aScoreAsBlack = 0, aGamesAsBlack = 0, aScoreAsWhite = 0, aGamesAsWhite = 0;
  const pairWins = [];
  const msList = [], aMsList = [], bMsList = [];
  let openingBalancedOk = 0, openingAttemptsSum = 0;
  for (let i = 0; i < games; i++) {
    const aIsBlack = i % 2 === 0;
    const pairId = i >> 1;
    const seed = (seedBase + pairId * 7919) >>> 0;
    const key=seedBase+':'+i;
    let r=checkpoint?.records.get(key);
    if(!r){
      const started=Date.now();
      r = o.mode === "2d"
        ? playOne2D(CA, CB, o, aIsBlack, seed, pairId, maxPlies)
        : playOneCube(CA, CB, o, aIsBlack, seed, pairId, maxPlies);
      r.elapsedMs=Date.now()-started;
      if(checkpoint){fs.appendFileSync(checkpoint.file,JSON.stringify({key,r})+'\n');checkpoint.records.set(key,r);}
    }
    gameElapsedMs+=r.elapsedMs;
    score += r.aScore;
    plies += r.plies;
    rotations += r.rotations;
    swaps += r.swaps;
    invalid += r.invalid;
    none += r.none;
    if (r.endedReason === "maxPlies") maxPliesGames++;
    if (r.openingBalanced) openingBalancedOk++;
    if (r.openingAttempts) openingAttemptsSum += r.openingAttempts;
    msList.push(...r.msList);
    aMsList.push(...r.aMsList); bMsList.push(...r.bMsList);
    if (r.winColor !== 0) {
      blackDecided++;
      if (r.winColor === (CA.BLACK | 0)) blackWins++;
    }
    if (r.aScore === 1) wins++; else if (r.aScore === 0) losses++; else draws++;
    if (aIsBlack) { aScoreAsBlack += r.aScore; aGamesAsBlack++; }
    else { aScoreAsWhite += r.aScore; aGamesAsWhite++; }
    pairWins.push(r.winColor);
    if(checkpoint&&(i+1)%20===0)console.log('进度 seedBase='+seedBase+' '+(i+1)+'/'+games+'；A 得分 '+score+'，invalid/none '+invalid+'/'+none);
  }
  // 【为什么要数这个】配对设计（同开局、只对调颜色）在"胜者由颜色决定"时会**恒等于 50%**：
  // 两局同色胜 → A 一胜一负。这时 50% 不说明两边一样强，只说明这个开局是颜色决定的。
  let sameColorPairs = 0, pairs = 0;
  for (let i = 0; i + 1 < pairWins.length; i += 2) {
    pairs++;
    if (pairWins[i] !== 0 && pairWins[i] === pairWins[i + 1]) sameColorPairs++;
  }
  return {
    score, wins, losses, draws, games, avg: Math.round(plies / games),
    rotations, swaps, invalid, none, maxPliesGames,
    blackWins, blackDecided,
    sameColorPairs, pairs,
    aScoreAsBlack, aGamesAsBlack, aScoreAsWhite, aGamesAsWhite,
    openingBalancedOk, openingAttemptsSum,
    msList, aMsList, bMsList,
    gameElapsedMs,
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarize(msList) {
  const sorted = msList.slice().sort((a, b) => a - b);
  const sum = sorted.reduce((n, v) => n + v, 0);
  return {
    moves: sorted.length,
    avg: sorted.length ? Math.round((sum / sorted.length) * 1000) / 1000 : 0,
    p50: Math.round(percentile(sorted, 50) * 1000) / 1000,
    p95: Math.round(percentile(sorted, 95) * 1000) / 1000,
    p99: Math.round(percentile(sorted, 99) * 1000) / 1000,
    max: sorted.length ? Math.round(sorted[sorted.length - 1] * 1000) / 1000 : 0,
  };
}

function wilson(success, total) {
  if (!total) return [0, 0];
  const z = 1.96, p = success / total;
  const denom = 1 + z * z / total;
  const centre = (p + z * z / (2 * total)) / denom;
  const half = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

const o = parseArgs(process.argv.slice(2));
const maxPlies = o.maxPlies ?? (o.mode === "4d" ? 400 : 300);
// 【必须同时比档位】只比 revision 的话，"同一份内核、两边用不同档位"会被当成对照组，
// 而那种跑法恰恰是用来验测量台分辨率的，误报会把人吓一跳。
const control = o.new === o.old && o.nlv === o.olv;

// 【--games 指的是总对局数，不是每侧】两个半场各跑一半，合起来才是 --games。
const half = Math.round(o.games / 2);
const sizeLabel = o.mode === "2d"
  ? (SIZE_RANGES_2D[o.twoDVariant] || SIZE_RANGES_2D.classic).join("–") + " 随机"
  : o.mode === "4d" && o.fourDDefault
    ? "8–9³ 随机"
    : o.size + "³";
console.log("测量台：" + o.mode + (o.mode === "2d" ? " · " + o.twoDVariant : "") +
            "，尺寸 " + sizeLabel +
            (o.mode === "4d" ? "，转动冷却 " + o.cooldown + " 手" +
              (o.fourDWrap ? "，贯通" : "") + (o.fourDPhase ? "，晨昏 " + o.fourDPhase : "") : "") +
            "，配对计分，共 " + (half * 2) + " 局（两个半场各 " + half + " 局）");
if (control) {
  console.log("【对照组】新旧是同一份内核 —— 得分率必须是恰好 50.0%，否则测量台坏了。");
}

// 【脏工作区告警】工作区改了但还没提交时，--new HEAD 量的是旧代码。
// 不告警的话，症状是"改了半天数字纹丝不动"，而那看起来很像"改动没用"。
if (!fs.existsSync(o.new)) {
  let dirty = false;
  try {
    if (fs.readFileSync(path.join(PROJ, HTML_REL), "utf8") !== readHtml(o.new)) dirty = true;
  } catch (e) { /* 读不到就算了 */ }
  if (dirty) {
    console.log("⚠ 工作区的 " + HTML_REL + " 和 " + o.new + " 不一致 —— 这次量的是【已提交】的那一版，" +
                "不是你刚改的。要量未提交的改动，把 --new 直接写成文件路径。");
  }
}
const HTML_NEW = readHtml(o.new);
const HTML_OLD = o.old === o.new ? HTML_NEW : readHtml(o.old);
// 【守卫】新旧给了不同 revision，取回来的正文却一模一样 → 这次对拍毫无意义，
// 而且它会伪装成"两边一样强（50.0%）"这种看起来完全合理的读数。**宁可当场报错。**
if (o.new !== o.old && HTML_NEW === HTML_OLD) {
  console.error("★ " + o.new + " 和 " + o.old + " 取回来的 index.html 逐字节相同 —— " +
                "这次对拍比的是同一份内核，结果没有意义。检查 revision 或路径。");
  process.exit(2);
}
const CORE_NEW = modeCoreOf(HTML_NEW, o.mode);
const CORE_OLD = modeCoreOf(HTML_OLD, o.mode);
// 【更细的守卫】整份 HTML 不同、但本 mode 的内核相同（例如只改了另一模式的块）：
// 同样是对拍同一份东西。整份 HTML 的守卫抓不到这种，必须单独比 mode 内核。
if (o.new !== o.old && CORE_NEW === CORE_OLD) {
  console.error("★ " + o.new + " 和 " + o.old + " 的 " + o.mode + " 内核逐字节相同 —— " +
                "这次对拍比的是同一份内核，结果没有意义。检查是否只改了别的模式。");
  process.exit(2);
}
const CN = loadCore(HTML_NEW, "新版");
const CO = loadCore(HTML_OLD, "旧版");
if(o.resume&&!o.checkpoint)throw new Error('--resume 必须同时指定 --checkpoint');
if(o.checkpoint){
  const file=path.resolve(PROJ,o.checkpoint),records=new Map();
  const signature=sha256(JSON.stringify({...o,resume:false,checkpoint:null,json:null,tag:null,
    new:sha256(HTML_NEW),old:sha256(HTML_OLD),...(o.nlv===o.olv?{}:{levelProtocol:2})}));
  fs.mkdirSync(path.dirname(file),{recursive:true});
  if(fs.existsSync(file)){
    if(!o.resume)throw new Error('断点已存在；核对后用 --resume：'+file);
    const raw=fs.readFileSync(file,'utf8'),lines=raw.split('\n');
    const header=JSON.parse(lines.shift());
    if(header.signature!==signature)throw new Error('断点的参数或引擎哈希不同，拒绝混用');
    // 最后半行可能是断电时未写完；只允许丢弃末尾未换行的记录。
    const tail=lines.pop();
    if(tail)fs.writeFileSync(file,raw.slice(0,raw.lastIndexOf('\n')+1));
    for(const line of lines){if(!line)continue;const item=JSON.parse(line);if(records.has(item.key))throw new Error('重复断点记录');records.set(item.key,item.r);}
  }else fs.writeFileSync(file,JSON.stringify({version:1,signature})+'\n');
  checkpoint={file,records};
}

// 两个半场：新版先执黑，再执白。这样"第一方优势"两边各照顾一次。
const t0 = Date.now();
const r1 = duel(CN, CO, o, half, o.seed, maxPlies);
const r2 = duel(CO, CN, {...o,nlv:o.olv,olv:o.nlv}, half, o.seed + 10000, maxPlies);
const elapsedMs = checkpoint ? r1.gameElapsedMs+r2.gameElapsedMs : Date.now()-t0;

const total = r1.games + r2.games;
const newScore = r1.score + (r2.games - r2.score);   // r2 里新版执的是 B 方
const pct = (100 * newScore / total).toFixed(1);
const ci = wilson(newScore, total);
const allWins = r1.wins + r2.losses;      // r2 里 CN 是 B 方：CN 胜 = r2.losses
const allLosses = r1.losses + r2.wins;
const allDraws = r1.draws + r2.draws;
const blackWins = r1.blackWins + r2.blackWins;
const blackDecided = r1.blackDecided + r2.blackDecided;
const msList = r1.msList.concat(r2.msList);
const timing = summarize(msList);
const timingByEngine = engineTiming(r1,r2);
const sameColorPairs = r1.sameColorPairs + r2.sameColorPairs;
const pairs = r1.pairs + r2.pairs;
const invalid = r1.invalid + r2.invalid;
const none = r1.none + r2.none;
const maxPliesGames = r1.maxPliesGames + r2.maxPliesGames;
const rotations = r1.rotations + r2.rotations;
const swaps = r1.swaps + r2.swaps;

// 新版真正的执黑/执白分项：
//   r1: A=新版，aIsBlack=true 时新版执黑；
//   r2: A=旧版，aIsBlack=false 时新版（B）执黑，得分要取反。
const newAsBlackScore = r1.aScoreAsBlack + (r2.aGamesAsWhite - r2.aScoreAsWhite);
const newAsBlackGames = r1.aGamesAsBlack + r2.aGamesAsWhite;
const newAsWhiteScore = r1.aScoreAsWhite + (r2.aGamesAsBlack - r2.aScoreAsBlack);
const newAsWhiteGames = r1.aGamesAsWhite + r2.aGamesAsBlack;
const colorGamesOk = newAsBlackGames + newAsWhiteGames === total;
const pairsComplete = pairs * 2 === total;
const controlOk = control ? Math.abs(newScore - total / 2) < 1e-9 : null;
const valid = (control ? controlOk : true) && pairsComplete && colorGamesOk && invalid === 0 && none === 0;

console.log("");
console.log("第 1 半场（新版=A）：" + r1.score + "/" + r1.games +
            "（胜 " + r1.wins + " / 负 " + r1.losses + " / 和 " + r1.draws + "）");
console.log("第 2 半场（新版=B）：" + (r2.games - r2.score) + "/" + r2.games +
            "（胜 " + r2.losses + " / 负 " + r2.wins + " / 和 " + r2.draws + "）");
console.log("新版执黑：" + newAsBlackScore + "/" + newAsBlackGames +
            "；执白：" + newAsWhiteScore + "/" + newAsWhiteGames);
console.log("新版合计：" + newScore + "/" + total + " = " + pct + "%" +
            "（95% CI " + (ci[0] * 100).toFixed(1) + "–" + (ci[1] * 100).toFixed(1) + "%）");
console.log("原始黑胜率：" + blackWins + "/" + blackDecided +
            (blackDecided ? " = " + (100 * blackWins / blackDecided).toFixed(1) + "%" : "（无已决局）") +
            "；和棋 " + allDraws + "；上限 " + maxPliesGames + "；无效 " + invalid + "；none " + none);
console.log("平均 " + Math.round((r1.avg + r2.avg) / 2) + " 手，转动 " + rotations +
            " 次，交换 " + swaps + " 次，用时 " + (elapsedMs / 1000).toFixed(1) + "s");
console.log("每手耗时：p50 " + timing.p50 + "ms / p95 " + timing.p95 +
            "ms / p99 " + timing.p99 + "ms / max " + timing.max + "ms（" + timing.moves + " 手）");
console.log('独立耗时（新版/旧版）p95：'+timingByEngine.new.p95+'/'+timingByEngine.old.p95+
  'ms；p99：'+timingByEngine.new.p99+'/'+timingByEngine.old.p99+'ms');
console.log("配对里「同色胜」的比例：" + sameColorPairs + "/" + pairs +
            (pairs ? " = " + (100 * sameColorPairs / pairs).toFixed(1) + "%" : "") +
            "（接近 100% 说明配对里的 50.0% 是设计逼出来的，不代表两边一样强）");
if (!valid) {
  console.log("★ 本批作废：controlOk=" + controlOk + " pairsComplete=" + pairsComplete +
              " colorGamesOk=" + colorGamesOk + " invalid=" + invalid + " none=" + none);
}

// 机读结果：P0 要求每次 A/B 都留一份，报告里能直接引用 sha 和口径。
// 作废批次写 `.invalid.json`，避免后续 glob 把坏数据当正常测量。
const openingInfo = (o.mode === "2d" || (o.mode === "4d" && o.fourDDefault))
  ? { min: OPENING_MIN, max: OPENING_MAX, balanced: true,
      note: "中心盒代码实际是 half-3..half+2（6×6），与 selfplay 完全一致；历史文档写的 7×7 是旧称" }
  : { min: 0, max: 6, balanced: false, method: "seed % 7",
      note: "老口径：0–6 手、不做三连平衡过滤" };
const tag = o.tag || ("ab-" + o.mode + "-" + o.games + "-" + path.basename(o.new).replace(/\W+/g, "_") +
                      "-vs-" + path.basename(o.old).replace(/\W+/g, "_"));
const jsonPath = o.json
  ? (valid ? o.json : o.json.replace(/(?:\.invalid)?\.json$/,'')+'.invalid.json')
  : path.join(PROJ, "_verify/results/ai-ab",tag + (valid ? "" : ".invalid") + ".json");
const report = {
  meta: {
    runAt: new Date().toISOString(),
    mode: o.mode,
    twoDVariant: o.mode === "2d" ? o.twoDVariant : null,
    fourDDefault: !!o.fourDDefault,
    fourDWrap: !!o.fourDWrap,
    fourDPhase: o.fourDPhase | 0,
    cooldown: o.cooldown,
    size: o.mode === "2d" ? null : o.size,
    sizeRange: o.mode === "2d"
      ? (SIZE_RANGES_2D[o.twoDVariant] || SIZE_RANGES_2D.classic)
      : (o.mode === "4d" && o.fourDDefault ? SIZE_RANGE_4D : [o.size, o.size]),
    openingRange: [openingInfo.min, openingInfo.max],
    opening: openingInfo,
    openingTries: OPENING_TRIES,
    maxPlies,
    games: total,
    seedBase: o.seed,
    levels: { new: o.nlv, old: o.olv },
    levelProtocol:2,
    targetPct: o.target,
    control,
    new: { arg: o.new, sha256: sha256(HTML_NEW), coreSha256: sha256(CORE_NEW) },
    old: { arg: o.old, sha256: sha256(HTML_OLD), coreSha256: sha256(CORE_OLD) },
    node: process.version,
    platform: process.platform,
  },
  results: {
    newScore,
    total,
    pct: Number(pct),
    ci95: [Number((ci[0] * 100).toFixed(2)), Number((ci[1] * 100).toFixed(2))],
    wins: allWins, losses: allLosses, draws: allDraws,
    asBlack: { score: newAsBlackScore, games: newAsBlackGames,
               pct: newAsBlackGames ? Number((100 * newAsBlackScore / newAsBlackGames).toFixed(2)) : null },
    asWhite: { score: newAsWhiteScore, games: newAsWhiteGames,
               pct: newAsWhiteGames ? Number((100 * newAsWhiteScore / newAsWhiteGames).toFixed(2)) : null },
    rawBlackWins: blackWins,
    rawBlackDecided: blackDecided,
    rawBlackPct: blackDecided ? Number((100 * blackWins / blackDecided).toFixed(2)) : null,
    sameColorPairs, pairs,
    sameColorPct: pairs ? Number((100 * sameColorPairs / pairs).toFixed(2)) : null,
    invalid, none, maxPliesGames,
    avgPlies: Math.round((r1.avg + r2.avg) / 2),
    rotations, swaps,
    timing,
    timingByEngine,
    elapsedMs,
    openingBalancedOk: r1.openingBalancedOk + r2.openingBalancedOk,
    openingAttempts: r1.openingAttemptsSum + r2.openingAttemptsSum,
    valid,
    selfCheck: {
      control,
      controlOk,
      pairsComplete,
      colorGamesOk,
      invalidAllowed: invalid === 0,
      noneAllowed: none === 0,
    },
  },
  halves: [
    { label: "half1-new-A", score: r1.score, games: r1.games, wins: r1.wins, losses: r1.losses, draws: r1.draws },
    { label: "half2-new-B", score: r2.games - r2.score, games: r2.games, wins: r2.losses, losses: r2.wins, draws: r2.draws },
  ],
};
fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");
console.log("结果已写入：" + path.relative(PROJ, jsonPath));

if (control) {
  console.log(valid ? "对照组自检通过（恰好 50.0%，配对完整）"
                    : "★对照组自检失败（不是 50.0% / 配对不完整），这批数字全部作废★");
  process.exit(valid ? 0 : 1);
}
if (invalid > 0 || none > 0) {
  console.log("★ 本批作废：invalid=" + invalid + "，none=" + none + "（冻结口径要求 0）");
  process.exit(1);
}
if (!pairsComplete) {
  console.log("★ 本批作废：完整配对 " + pairs + " / 应为 " + (total / 2));
  process.exit(1);
}
if (Number(pct) < o.target) {
  console.log("未达 " + o.target + "% 目标线。");
  process.exit(1);
}
console.log("达到 " + o.target + "% 目标线。");
