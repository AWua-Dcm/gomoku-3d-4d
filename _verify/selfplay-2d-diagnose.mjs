// 2D 附加玩法长局诊断：重放 F/HF/HFA 等试点，量化“为什么打不完”。
//
// 用法：
//   node _verify/selfplay-2d-diagnose.mjs --dir _verify/results/selfplay/x-2d-hfa-200 --limit 100
//   node _verify/selfplay-2d-diagnose.mjs            # 自动扫描所有 x-2d-*-200
//
// 只读 shard，不改引擎。诊断项：
//   · 漏杀：轮到自己时存在“立即成五”的落点，却走了别的
//   · 没堵住：对方只有 1 个立即成五点，走后对方仍有成五点（对方有 ≥2 个点算 fork，不怪 AI）
//   · 交换质量：交换后对方最佳威胁是否下降、自己是否反而下降
//   · 地基使用：底层落子数、在已有地基上补顶层的次数、终局空地基数
//   · 长局最后 30 手：交换/落子构成
//
// 这些指标只解释试点，不是棋力结论。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.resolve(HERE, "..");
const BASE = path.join(PROJ, "_verify/results/selfplay");
const HTML_REL = "Web_Gomoku3D/index.html";
const TWO_D_DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const VALUE = [0, 2, 15, 180, 4500, 1000000];

const args = parseArgs(process.argv.slice(2));
const dirs = args.dir ? [args.dir] : autoDirs();
if (!dirs.length) { console.error("没有找到 2D 试点目录"); process.exit(2); }
const C = loadCore(path.join(PROJ, HTML_REL));

console.log("| 变体 | 局数 | 上限 | 平均手数 | 落顶/底/交换/放洞 | 漏杀(位/局) | 没堵住 | fork | 交换 | 降对方威胁 | 中性/更差 | 伤自己 | 地基落子 | 补基地 | 空地基 | 长局末30交换 |");
console.log("|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");

for (const dir of dirs) {
  const abs = path.resolve(PROJ, dir);
  const meta = JSON.parse(fs.readFileSync(path.join(abs, "meta.json"), "utf8"));
  if (meta.args.modes[0] !== "2d") continue;
  const variantName = (meta.rulesByMode && meta.rulesByMode["2d"] && meta.rulesByMode["2d"].variant) || "classic";
  const recs = readGames(abs).slice(0, args.limit);
  const agg = {
    games: 0, maxPlies: 0, plies: 0,
    top: 0, base: 0, swap: 0, hole: 0,
    missedPositions: 0, missedGames: 0,
    failedBlock: 0, fork: 0,
    swaps: 0, swapReduceFoe: 0, swapNeutral: 0, swapWorse: 0, swapHurtMine: 0,
    baseMoves: 0, reusedBase: 0, finalEmptyBases: 0,
    longLast30Swap: 0, longGames: 0,
  };
  for (const rec of recs) {
    const s = replayStart(C, rec, variantName);
    if (!s) continue;
    agg.games++;
    agg.plies += rec.totalPlies || 0;
    if (rec.endedReason === "maxPlies") { agg.maxPlies++; agg.longGames++; }
    let missedGame = false;
    for (const m of rec.moves || []) {
      if (s.status !== "Playing") break;
      const mover = s.currentPlayer, foe = C.opponentOf(mover);
      const winsMover = immediateWins(C, s, mover);
      const winsFoeBefore = immediateWins(C, s, foe);
      const chosenWin = m.kind === "place" && m.action.layer !== "base" &&
                        winsMover.some((w) => w[0] === m.action.x && w[1] === m.action.y);
      if (winsMover.length > 0 && !chosenWin) {
        agg.missedPositions++;
        if (!missedGame) { missedGame = true; agg.missedGames++; }
      }
      if (m.kind === "swap") {
        const beforeMine = bestThreat(C, s, mover), beforeFoe = bestThreat(C, s, foe);
        const copy = s.clone();
        const r = copy.swapLines(m.action.axis, m.action.i, m.action.j);
        if (r && r.status !== C.MoveStatus.Rejected) {
          const afterMine = bestThreat(C, copy, mover), afterFoe = bestThreat(C, copy, foe);
          agg.swaps++;
          if (afterFoe < beforeFoe) agg.swapReduceFoe++;
          else if (afterFoe === beforeFoe) agg.swapNeutral++;
          else agg.swapWorse++;
          if (afterMine < beforeMine) agg.swapHurtMine++;
        }
      }
      if (m.kind === "place" && m.action.layer === "base") agg.baseMoves++;
      if (m.kind === "place" && m.action.layer === "top") {
        const k = s.index(m.action.x, m.action.y);
        if (s.base[k]) agg.reusedBase++;
      }
      // 执行记录里的这一手
      const r = applyMove(s, m);
      if (!r || r.status === C.MoveStatus.Rejected) break;
      if (m.kind === "place" && m.action.layer === "base") agg.base++;
      else if (m.kind === "place") agg.top++;
      else if (m.kind === "swap") agg.swap++;
      else if (m.kind === "placeHole") agg.hole++;
      // 对方只有一个立即成五点，走后仍有 → 没堵住；≥2 个点算 fork
      const winsFoeAfter = s.status === "Playing" ? immediateWins(C, s, foe) : [];
      if (winsFoeAfter.length > 0) {
        if (winsFoeBefore.length === 1) agg.failedBlock++;
        else if (winsFoeBefore.length > 1) agg.fork++;
      }
    }
    for (let k = 0; k < s.base.length; k++) if (s.base[k] && !s.top[k]) agg.finalEmptyBases++;
    if (rec.endedReason === "maxPlies") {
      const last = (rec.moves || []).slice(-30);
      agg.longLast30Swap += last.filter((m) => m.kind === "swap").length;
    }
  }
  const avgPlies = agg.games ? agg.plies / agg.games : 0;
  console.log("| " + variantName + " | " + agg.games + " | " + agg.maxPlies + " | " + avgPlies.toFixed(1) + " | " +
    agg.top + "/" + agg.base + "/" + agg.swap + "/" + agg.hole + " | " +
    agg.missedPositions + "/" + agg.missedGames + " | " + agg.failedBlock + " | " + agg.fork + " | " +
    agg.swaps + " | " + agg.swapReduceFoe + " | " + (agg.swapNeutral + agg.swapWorse) + " | " + agg.swapHurtMine + " | " +
    agg.baseMoves + " | " + agg.reusedBase + " | " + agg.finalEmptyBases + " | " + agg.longLast30Swap + " |");
}

/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const o = { dir: null, limit: 100 };
  for (let i = 0; i < argv.length; i++) {
    const k = String(argv[i] || "").replace(/^--/, "");
    if (k === "dir") { o.dir = argv[i + 1]; i++; }
    else if (k === "limit") { o.limit = parseInt(argv[i + 1], 10); i++; }
    else if (k === "help" || k === "h") {
      console.log("用法：node _verify/selfplay-2d-diagnose.mjs [--dir <runDir>] [--limit N]");
      process.exit(0);
    } else { console.error("未知参数 --" + k); process.exit(2); }
  }
  return o;
}

function autoDirs() {
  if (!fs.existsSync(BASE)) return [];
  return fs.readdirSync(BASE).filter((d) => /^x-2d-.*-200$/.test(d))
    .map((d) => "_verify/results/selfplay/" + d).sort();
}

function readGames(dir) {
  const map = new Map();
  for (const f of fs.readdirSync(dir).filter((f) => /^shard-\d+\.jsonl$/.test(f))) {
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      if (!r || r.mode !== "2d" || r.invalid) continue;
      const k = r.mode + ":" + r.gameId;
      if (!map.has(k)) map.set(k, r);
    }
  }
  return [...map.values()];
}

function loadCore(htmlPath) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const s = html.indexOf("<script>");
  const e = html.lastIndexOf("</script>");
  const full = html.slice(s + "<script>".length, e);
  const BEGIN = "/* GOMOKU-CORE-BEGIN */";
  const END = "/* GOMOKU-CORE-END */";
  const at = full.indexOf(BEGIN), bt = full.indexOf(END);
  const core = full.slice(at + BEGIN.length, bt);
  return new Function(core + `
    return { Session2D, RuleSet, MoveStatus, EMPTY, BLACK, WHITE, opponentOf, RuleEngine };`)();
}

function buildVariant(name, seed, w, height) {
  const map = {
    classic: [false, false, false], h: [true, false, false], f: [false, true, false],
    a: [false, false, true], hf: [true, true, false], ha: [true, false, true],
    fa: [false, true, true], hfa: [true, true, true],
  };
  const [h, f, a] = map[name] || map.classic;
  return {
    on: true, w, h: height, freeRule: false,
    holes: { on: h, randomCount: Math.max(3,Math.min(7,Math.floor(w*height/15))), perPlayer: 0, cooldown: 5, seed: (seed >>> 0), layout: null },
    float: { on: f, life:20, opening:8 },
    age: { on: a, turns: 30, gray: 3, aura: h && a },
  };
}

function replayStart(C, rec, variantName) {
  const [w,h]=rec.size||[];
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<5||h<5)throw new Error('缺少合法 rec.size');
  const s = C.Session2D.create(w,h,C.BLACK,new C.RuleSet(),rec.cfg2||buildVariant(variantName,rec.seed,w,h));
  for (const o of rec.opening || []) {
    const r = s.place(o.x, o.y);
    if (!r || r.status === C.MoveStatus.Rejected) return null;
  }
  return s;
}

function applyMove(s, m) {
  if (m.kind === "place") return s.place(m.action.x, m.action.y, m.action.layer);
  if (m.kind === "swap") return s.swapLines(m.action.axis, m.action.i, m.action.j);
  if (m.kind === "placeHole") return s.placeHole(m.action.x, m.action.y);
  return null;
}

/** 当前轮到自己，所有能立即成五的顶层落点。 */
function immediateWins(C, s, p) {
  const out = [];
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    if (!s.canPlace(x, y)) continue;
    const k = s.index(x, y);
    const actual = s.variant2.float.on && !s.base[k] ? "base" : "top";
    if (actual !== "top") continue;
    if (!wouldWin(C, s, x, y, p)) continue;
    out.push([x, y]);
  }
  return out;
}

function wouldWin(C, s, x, y, p) {
  let max = 1;
  for (const [dx, dy] of TWO_D_DIRS) {
    let n = 1;
    for (const sign of [1, -1]) {
      let xx = x + dx * sign, yy = y + dy * sign;
      while (s.inBounds(xx, yy) && s.top[s.index(xx, yy)] === p) { n++; xx += dx * sign; yy += dy * sign; }
    }
    if (n > max) max = n;
  }
  if (max < 5) return false;
  const k = s.index(x, y), before = s.board.cells[k];
  s.board.cells[k] = p;
  const out = C.RuleEngine.judge(s.board, { x, y, z: 0 }, p, s.firstPlayer, s.rules, p);
  s.board.cells[k] = before;
  return out.status === C.MoveStatus.Win;
}

/** 与 ai2ChooseMove 的 value() 同构，只用于交换前后对比。 */
function bestThreat(C, s, p) {
  let best = 0;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    if (!s.canPlace(x, y)) continue;
    const k = s.index(x, y);
    const actual = s.variant2.float.on && !s.base[k] ? "base" : "top";
    if (actual !== "top") continue;
    const v = valueAt(s, x, y, p);
    if (v > best) best = v;
  }
  return best;
}

function valueAt(s, x, y, p) {
  let total = 0;
  const limit = s.rules.winLength;
  for (const [dx, dy] of TWO_D_DIRS) for (let offset = 0; offset < limit; offset++) {
    let count = 0, empty = 0, life = 1, blocked = false;
    for (let j = 0; j < limit; j++) {
      const xx = x + (j - offset) * dx, yy = y + (j - offset) * dy;
      if (!s.inBounds(xx, yy)) { blocked = true; break; }
      const k = s.index(xx, yy), t = s.top[k];
      if (s.hole[k] || t === 3 || (t && t !== p)) { blocked = true; break; }
      if ((xx === x && yy === y) || t === p) {
        count++;
        if (t === p && s.variant2.age.on) life = Math.min(life, Math.min(1, s.remainingOf(xx, yy) / 8));
      } else empty++;
    }
    if (!blocked) total += VALUE[count] * life / (1 + empty * 0.1);
  }
  return total;
}
