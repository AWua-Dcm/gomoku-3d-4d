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
//   node _verify/ai-ab.mjs --mode 4d --size 8 --cooldown 3 --games 40 \
//        --new HEAD --old 4337e18
//   node _verify/ai-ab.mjs --mode 3d --size 15 --games 40 --new HEAD --old 4337e18
//   # 测量台自检：新旧都给同一个 revision，得分率必须恰好 50.0%
//   node _verify/ai-ab.mjs --mode 4d --size 8 --cooldown 3 --games 20 --new HEAD --old HEAD
//
// 退出码：0 = 达到目标线（或对照组自检通过）；1 = 未达到 / 对照组坏了。
// 中途开发时（新版还没变强）会返回 1，那是预期的，看输出里的数字就行。

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.resolve(HERE, "..");
const HTML_REL = "Web_Gomoku3D/index.html";

function parseArgs(argv) {
  const o = { mode: "3d", size: 15, cooldown: 3, games: 40, new: "HEAD", old: "HEAD", nlv: "ultra", olv: "ultra" };
  for (let i = 0; i < argv.length; i += 2) {
    const k = String(argv[i] || "").replace(/^--/, "");
    const v = argv[i + 1];
    if (k === "mode") o.mode = v;
    else if (k === "size") o.size = parseInt(v, 10);
    else if (k === "cooldown") o.cooldown = parseInt(v, 10);
    else if (k === "games") o.games = parseInt(v, 10);
    else if (k === "new") o.new = v;
    else if (k === "old") o.old = v;
    else if (k === "nlv") o.nlv = v;
    else if (k === "olv") o.olv = v;
    else { console.error("未知参数 --" + k); process.exit(2); }
  }
  if (o.mode !== "3d" && o.mode !== "4d") {
    console.error("--mode 只能是 3d 或 4d，收到 " + o.mode); process.exit(2);
  }
  if (!(o.games >= 2)) { console.error("--games 至少要 2（配对计分）"); process.exit(2); }
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

/** 从 index.html 抽内核区间并求值。和 tests/ai.test.mjs 用的是同一段标记。 */
function loadCore(html, label) {
  const s = html.indexOf("<script>");
  const e = html.lastIndexOf("</script>");
  if (s < 0 || e < 0) { console.error(label + "：找不到 <script> 块"); process.exit(2); }
  const full = html.slice(s + "<script>".length, e);
  const BEGIN = "/* GOMOKU-CORE-BEGIN */";
  const END = "/* GOMOKU-CORE-END */";
  const at = full.indexOf(BEGIN), bt = full.indexOf(END);
  if (at < 0 || bt < 0) { console.error(label + "：找不到内核标记"); process.exit(2); }
  const core = full.slice(at + BEGIN.length, bt);
  try {
    return new Function(core + `
      return { FourDSession, RuleSet, RotationMove, MoveStatus, EMPTY, BLACK, WHITE,
               opponentOf, aiChooseMove, aiRng };`)();
  } catch (err) {
    console.error(label + "：内核求值失败 —— " + err.message);
    process.exit(2);
  }
}

function mkSession(C, n, fourD, cooldown) {
  const rules = new C.RuleSet();
  rules.allowRotation = !!fourD;
  if (cooldown !== undefined) rules.rotationCooldownPlacements = cooldown;
  return C.FourDSession.create(n, C.BLACK, rules);   // 永远黑先，颜色靠 aIsBlack 对调
}

function applyAction(C, s, act) {
  if (act.kind === "place") return s.place(act.x, act.y, act.z);
  if (act.kind === "rotate") {
    return s.rotate(C.RotationMove.fromClockwiseTurns(act.axis, act.layer, act.turns));
  }
  return null;
}

/**
 * 一局。aIsBlack 决定 A 方执什么颜色。
 * **开局完全由 seed 决定**（搜索是确定性的、不消耗随机数），所以配对的两局
 * （seed 相同、aIsBlack 相反）走的是同一个开局、同一个 AI 种子序列，
 * 只是两边换了个颜色。
 * @returns {aScore, plies, rotations}  aScore ∈ {1, 0.5, 0}
 */
function playOne(CA, CB, n, fourD, cooldown, lvA, lvB, aIsBlack, seed, maxPlies) {
  const s = mkSession(CA, n, fourD, cooldown);
  const rng = CA.aiRng(seed);
  // 随机开局：固定开局下"N 局"其实是同一盘棋重复 N 次。
  // 落子范围取中心附近的一个盒子，免得开局就散在棋盘角落。
  const open = seed % 7;                      // 0..6 手
  const lo = Math.max(0, ((n / 2) | 0) - 3);
  const hi = Math.min(n, ((n / 2) | 0) + 3);
  for (let j = 0; j < open && s.status === "Playing"; j++) {
    const em = [];
    for (let z = lo; z < hi; z++) for (let y = lo; y < hi; y++) for (let x = lo; x < hi; x++) {
      if (s.board.isEmpty(x, y, z)) em.push([x, y, z]);
    }
    if (em.length === 0) break;
    const m = em[(rng() * em.length) | 0];
    s.place(m[0], m[1], m[2]);
  }
  let plies = 0, rotations = 0;
  while (s.status === "Playing" && plies < maxPlies) {
    const aToMove = (s.currentPlayer === CA.BLACK) === aIsBlack;
    const lv = aToMove ? lvA : lvB;
    // ★ 这里必须按"轮到谁"选内核 —— 见 duel 上面那段。
    const C = aToMove ? CA : CB;
    const act = C.aiChooseMove(s, { level: lv, seed: (rng() * 4294967296) >>> 0 });
    if (act.kind === "none") break;
    const r = applyAction(CA, s, act);
    if (act.kind === "rotate") rotations++;
    // 引擎拒了任何一手都是硬故障（电脑会卡住），立刻暴露
    if (!r || r.status === C.MoveStatus.Rejected || (act.kind === "rotate" && !r.accepted)) {
      console.error("!! 引擎拒绝了动作：" + JSON.stringify(act));
      process.exit(2);
    }
    plies++;
  }
  const aWon = (s.winner === CA.BLACK && aIsBlack) || (s.winner === CA.WHITE && !aIsBlack);
  const aScore = s.winner === CA.EMPTY ? 0.5 : (aWon ? 1 : 0);
  return { aScore, plies, rotations, winColor: s.winner };
}

/** A 方视角的得分。games 必须是偶数，第 2k 局与第 2k+1 局配对。 */
/**
 * 跑 games 局，A 方是"新版"那个内核。
 *
 * ★【这里踩过一次，别再合并回一个参数】第一版只收一个内核 CA，然后把它同时喂给两边 ——
 * 于是"新旧对拍"实际上跑的是**同一份内核自己打自己**，得分必然恒等于 50.0%。
 * 症状极隐蔽：数字看着正常（50.0% 正是"一样强"的合理读数），
 * 只有"两个半场都是 12/24"这种过分对称才露馅。
 * 现在每局按"轮到谁"选内核（见 playOne），并且开头有一道断言把两份源码不同钉死。
 */
function duel(CA, CB, n, fourD, cooldown, games, seedBase, lvA, lvB, maxPlies) {
  let score = 0, wins = 0, losses = 0, draws = 0, plies = 0, rotations = 0;
  const pairWins = [];
  for (let i = 0; i < games; i++) {
    const aIsBlack = i % 2 === 0;
    const seed = seedBase + (i >> 1) * 7919;    // 同 (i>>1) 的两局共享种子
    const r = playOne(CA, CB, n, fourD, cooldown, lvA, lvB, aIsBlack, seed, maxPlies);
    score += r.aScore;
    plies += r.plies;
    rotations += r.rotations;
    if (r.aScore === 1) wins++; else if (r.aScore === 0) losses++; else draws++;
    pairWins.push(r.winColor);
  }
  // 【为什么要数这个】配对设计（同开局、只对调颜色）在"胜者由颜色决定"时会**恒等于 50%**：
  // 两局同色胜 → A 一胜一负。这时 50% 不说明两边一样强，只说明这个开局是颜色决定的。
  let sameColorPairs = 0, pairs = 0;
  for (let i = 0; i + 1 < pairWins.length; i += 2) {
    pairs++;
    if (pairWins[i] !== 0 && pairWins[i] === pairWins[i + 1]) sameColorPairs++;
  }
  return { score, wins, losses, draws, games, avg: Math.round(plies / games), rotations,
           sameColorPairs, pairs };
}

const o = parseArgs(process.argv.slice(2));
const fourD = o.mode === "4d";
const maxPlies = fourD ? 400 : 300;
// 【必须同时比档位】只比 revision 的话，"同一份内核、两边用不同档位"会被当成对照组，
// 而那种跑法恰恰是用来验测量台分辨率的，误报会把人吓一跳。
const control = o.new === o.old && o.nlv === o.olv;

// 【--games 指的是总对局数，不是每侧】两个半场各跑一半，合起来才是 --games。
// 这句话原来写成"每侧 N 局"，而实际每半场只有 N/2 —— 报告口径错了就是在骗人。
const half = Math.round(o.games / 2);
console.log("测量台：" + o.mode + "，尺寸 " + o.size + "³" +
            (fourD ? "，转动冷却 " + o.cooldown + " 手" : "") +
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
const CN = loadCore(HTML_NEW, "新版");
const CO = loadCore(HTML_OLD, "旧版");

// 两个半场：新版先执黑，再执白。这样"第一方优势"两边各照顾一次。
const r1 = duel(CN, CO, o.size, fourD, o.cooldown, half, 40001, o.nlv, o.olv, maxPlies);
const r2 = duel(CO, CN, o.size, fourD, o.cooldown, half, 50001, o.olv, o.nlv, maxPlies);

const total = r1.games + r2.games;
const newScore = r1.score + (r2.games - r2.score);   // r2 里新版执的是 B 方
const pct = (100 * newScore / total).toFixed(1);

console.log("");
console.log("新版执黑半场：" + r1.score + "/" + r1.games +
            "（胜 " + r1.wins + " / 负 " + r1.losses + " / 和 " + r1.draws + "）");
console.log("新版执白半场：" + (r2.games - r2.score) + "/" + r2.games);
console.log("新版合计：" + newScore + "/" + total + " = " + pct + "%");
console.log("平均 " + Math.round((r1.avg + r2.avg) / 2) + " 手，转动 " +
            (r1.rotations + r2.rotations) + " 次");
console.log("配对里「同色胜」的比例：" + (r1.sameColorPairs + r2.sameColorPairs) + "/" +
            (r1.pairs + r2.pairs) + "（接近 100% 说明配对里的 50.0% 是设计逼出来的，" +
            "不代表两边一样强）");

if (control) {
  const ok = Math.abs(newScore - total / 2) < 1e-9;
  console.log(ok ? "对照组自检通过（恰好 50.0%）"
                 : "★对照组不是 50.0%，这批数字全部作废★");
  process.exit(ok ? 0 : 1);
}
if (newScore / total < 0.70) {
  console.log("未达 70% 目标线。");
  process.exit(1);
}
console.log("达到 70% 目标线。");
