// ultra-vs-ultra 自对弈数据的分析器。
//
// 用法：
//   node _verify/selfplay-analyze.mjs --dir _verify/results/selfplay/full
//   node _verify/selfplay-analyze.mjs                 # 自动取最新的运行目录
//
// 只读 selfplay.mjs 写出的 shard-*.jsonl；不改数据、不重跑对局。
// 输出 analysis.json（机器读）与 analysis.md（人读）。
//
// 【怎么读“配对得分”】两边都是同一个 ultra 内核，所以 A 方得分率**不是棋力差**。
// 同色胜对的比例高，说明这个开局/规则下胜负主要由颜色决定，配对 50% 是设计逼出来的；
// 配对得分明显偏离 50%，说明先手/后手或规则本身不对称。两种都要如实报告，不当成测量台坏了。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.resolve(HERE, "..");
const BASE = path.join(PROJ, "_verify/results/selfplay");
const BLACK = 1, WHITE = 2;

const args = parseArgs(process.argv.slice(2));
const runDir = args.dir ? path.resolve(PROJ, args.dir) : latestRun();
if (!runDir || !fs.existsSync(runDir)) {
  console.error("找不到运行目录。用 --dir 指定，例如 _verify/results/selfplay/full");
  process.exit(2);
}
const meta = JSON.parse(fs.readFileSync(path.join(runDir, "meta.json"), "utf8"));
const all = readGames(runDir);
const invalid = all.filter((r) => r.invalid);
const games = all.filter((r) => !r.invalid);
const modes = meta.args.modes;

const report = {
  runId: meta.runId,
  engine: meta.engine,
  generatedAt: new Date().toISOString(),
  level: meta.level,
  games: games.length,
  invalid: invalid.length,
  duplicates: readDuplicates(runDir),
  modes: {},
};
for (const mode of modes) report.modes[mode] = analyzeMode(games.filter((r) => r.mode === mode), invalid.filter((r) => r.mode === mode), mode);
report.slowest = slowestMoves(games, 20);
report.colorOverall = colorSummary(games);

fs.writeFileSync(path.join(runDir, "analysis.json"), JSON.stringify(report, null, 2) + "\n");
const md = renderMarkdown(report);
fs.writeFileSync(path.join(runDir, "analysis.md"), md);
console.log(md);
console.log("已写：" + path.join(path.relative(PROJ, runDir), "analysis.md"));

/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const o = { dir: null };
  for (let i = 0; i < argv.length; i++) {
    const k = String(argv[i] || "").replace(/^--/, "");
    if (k === "dir") { o.dir = argv[i + 1]; i++; }
    else if (k === "help" || k === "h") {
      console.log("用法：node _verify/selfplay-analyze.mjs [--dir _verify/results/selfplay/<tag>]");
      process.exit(0);
    } else { console.error("未知参数 --" + k); process.exit(2); }
  }
  return o;
}

function latestRun() {
  if (!fs.existsSync(BASE)) return null;
  const dirs = fs.readdirSync(BASE)
    .map((d) => ({ d, p: path.join(BASE, d), m: fs.statSync(path.join(BASE, d)).mtimeMs }))
    .filter((x) => fs.existsSync(path.join(x.p, "meta.json")))
    .sort((a, b) => b.m - a.m);
  return dirs.length ? dirs[0].p : null;
}

function shardFiles(runDir) {
  try { return fs.readdirSync(runDir).filter((f) => /^shard-\d+\.jsonl$/.test(f)).sort(); }
  catch { return []; }
}

function readGames(runDir) {
  const map = new Map();
  let duplicates = 0;
  for (const f of shardFiles(runDir)) {
    let text;
    try { text = fs.readFileSync(path.join(runDir, f), "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let r;
      try { r = JSON.parse(line); } catch { continue; }   // 崩溃留下的半行
      if (!r || !r.mode || r.gameId === undefined) continue;
      const key = r.mode + ":" + r.gameId;
      if (map.has(key)) {
        duplicates++;
        const old = map.get(key);
        if (old.invalid && !r.invalid) map.set(key, r);   // 重试成功覆盖无效记录
      } else {
        map.set(key, r);
      }
    }
  }
  const out = [...map.values()];
  out.duplicates = duplicates;
  return out;
}

function readDuplicates(runDir) {
  return readGames(runDir).duplicates || 0;
}

function nums(arr) {
  const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  const n = a.length;
  if (!n) return null;
  const sum = a.reduce((s, x) => s + x, 0);
  const q = (p) => a[Math.min(n - 1, Math.max(0, Math.floor(n * p)))];
  return { n, mean: sum / n, median: q(0.5), p05: q(0.05), p95: q(0.95), p99: q(0.99), min: a[0], max: a[n - 1], sum };
}

function wilson(k, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = k / n, den = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / den;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

function pct(x) {
  return x === null || x === undefined || !Number.isFinite(x) ? "—" : (100 * x).toFixed(1) + "%";
}

function ci(k, n) {
  const [lo, hi] = wilson(k, n);
  return pct(k / n) + " [" + pct(lo) + ", " + pct(hi) + "]";
}

function fmtMs(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms >= 1000) return (ms / 1000).toFixed(2) + "s";
  return ms.toFixed(1) + "ms";
}

function analyzeMode(games, invalid, mode) {
  const decided = games.filter((r) => r.endedReason === "decided");
  const draws = decided.filter((r) => !r.winner).length;
  const blackWins = decided.filter((r) => r.winner === BLACK).length;
  const whiteWins = decided.filter((r) => r.winner === WHITE).length;
  const decisive = blackWins + whiteWins;

  // 配对：同一个 pairId 的两局共享开局、只对调颜色。
  const byPair = new Map();
  for (const r of decided) {
    if (!byPair.has(r.pairId)) byPair.set(r.pairId, []);
    byPair.get(r.pairId).push(r);
  }
  let pairsBoth = 0, sameColor = 0, split = 0, bothWin = 0, bothLoss = 0, withDraw = 0;
  let aScoreSum = 0, aGames = 0;
  for (const [, pair] of byPair) {
    if (pair.length !== 2) continue;
    pairsBoth++;
    aScoreSum += pair[0].aScore + pair[1].aScore;
    aGames += 2;
    if (pair.some((r) => !r.winner)) withDraw++;
    else if (pair[0].winner === pair[1].winner) sameColor++;
    if (pair[0].aScore === 1 && pair[1].aScore === 1) bothWin++;
    else if (pair[0].aScore === 0 && pair[1].aScore === 0) bothLoss++;
    else if (pair[0].aScore === 0.5 && pair[1].aScore === 0.5) { /* draw pair */ }
    else split++;
  }

  const openingDecided = games.filter((r) => r.endedReason === "decided" && r.aiPlies === 0).length;
  const maxPlies = games.filter((r) => r.endedReason === "maxPlies").length;
  const none = games.filter((r) => r.endedReason === "none").length;
  const moveMs = games.flatMap((r) => (r.moves || []).map((m) => m.ms));
  const gameMs = games.map((r) => r.durationMs);
  const totalPlies = games.map((r) => r.totalPlies);
  const aiPlies = games.map((r) => r.aiPlies);

  const byKind = {};
  for (const r of games) {
    for (const m of r.moves || []) {
      if (!byKind[m.kind]) byKind[m.kind] = [];
      byKind[m.kind].push(m.ms);
    }
  }
  const kindStats = Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, nums(v)]));

  const byPlayer = { black: [], white: [] };
  for (const r of games) {
    for (const m of r.moves || []) {
      if (m.player === BLACK) byPlayer.black.push(m.ms);
      else if (m.player === WHITE) byPlayer.white.push(m.ms);
    }
  }

  const plyBuckets = {};
  for (const r of games) {
    for (const m of r.moves || []) {
      const b = m.ply <= 10 ? "1-10" : m.ply <= 20 ? "11-20" : m.ply <= 30 ? "21-30" :
                m.ply <= 40 ? "31-40" : "41+";
      if (!plyBuckets[b]) plyBuckets[b] = [];
      plyBuckets[b].push(m.ms);
    }
  }

  // 按局长分组：中盘/长局的手时分布比“按 ply 段”更能解释 3D 的双峰
  // （21–40 手段很便宜、41+ 段突然变贵）。
  const lengthBuckets = {};
  const rotationBuckets = {};
  const winnerMoveMs = [], loserMoveMs = [];
  let slow1s = 0, slow2s = 0;
  const lengthBucket = (p) => p <= 10 ? "≤10" : p <= 20 ? "11-20" : p <= 30 ? "21-30" :
                         p <= 40 ? "31-40" : p <= 60 ? "41-60" : "61+";
  for (const r of games) {
    const b = lengthBucket(r.totalPlies);
    if (!lengthBuckets[b]) lengthBuckets[b] = { games: 0, decided: 0, black: 0, white: 0, draws: 0, plies: [], gameMs: [], moveMs: [] };
    const o = lengthBuckets[b];
    o.games++; o.plies.push(r.totalPlies); o.gameMs.push(r.durationMs);
    if (r.endedReason === "decided") {
      o.decided++;
      if (r.winner === BLACK) o.black++;
      else if (r.winner === WHITE) o.white++;
      else o.draws++;
    }
    for (const m of r.moves || []) {
      o.moveMs.push(m.ms);
      if (m.ms >= 1000) slow1s++;
      if (m.ms >= 2000) slow2s++;
      if (r.endedReason === "decided" && r.winner) {
        if (m.player === r.winner) winnerMoveMs.push(m.ms); else loserMoveMs.push(m.ms);
      }
    }
    const rb = (r.rotations || 0) >= 3 ? "3+" : String(r.rotations || 0);
    if (!rotationBuckets[rb]) rotationBuckets[rb] = { games: 0, black: 0, white: 0, draws: 0, plies: [], gameMs: [] };
    const ro = rotationBuckets[rb];
    ro.games++; ro.plies.push(r.totalPlies); ro.gameMs.push(r.durationMs);
    if (r.winner === BLACK) ro.black++;
    else if (r.winner === WHITE) ro.white++;
    else if (r.endedReason === "decided") ro.draws++;
  }

  const byOpening = {};
  for (const r of games) {
    const k = String(r.openLength);
    if (!byOpening[k]) byOpening[k] = { games: 0, decided: 0, black: 0, white: 0, draws: 0, aScore: 0, plies: [] };
    const o = byOpening[k];
    o.games++;
    o.plies.push(r.totalPlies);
    if (r.endedReason === "decided") {
      o.decided++;
      o.aScore += r.aScore;
      if (r.winner === BLACK) o.black++;
      else if (r.winner === WHITE) o.white++;
      else o.draws++;
    }
  }
  const openingTable = Object.fromEntries(Object.entries(byOpening).sort((a, b) => +a[0] - +b[0]).map(([k, o]) => [k, {
    games: o.games, decided: o.decided, black: o.black, white: o.white, draws: o.draws,
    blackWinRate: o.black + o.white ? o.black / (o.black + o.white) : null,
    pairedScore: o.decided ? o.aScore / o.decided : null,
    avgPlies: o.plies.length ? o.plies.reduce((s, x) => s + x, 0) / o.plies.length : null,
  }]));

  const avg = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  const lengthTable = Object.fromEntries(
    Object.entries(lengthBuckets)
      .sort((a, b) => lenOrder(a[0]) - lenOrder(b[0]))
      .map(([k, o]) => [k, {
        games: o.games, decided: o.decided, black: o.black, white: o.white, draws: o.draws,
        blackWinRate: o.black + o.white ? o.black / (o.black + o.white) : null,
        avgPlies: avg(o.plies), avgGameMs: avg(o.gameMs), avgMoveMs: avg(o.moveMs),
      }]));
  const rotationTable = Object.fromEntries(
    Object.entries(rotationBuckets)
      .sort((a, b) => rotOrder(a[0]) - rotOrder(b[0]))
      .map(([k, o]) => [k, {
        games: o.games, black: o.black, white: o.white, draws: o.draws,
        blackWinRate: o.black + o.white ? o.black / (o.black + o.white) : null,
        avgPlies: avg(o.plies), avgGameMs: avg(o.gameMs),
      }]));

  return {
    mode,
    games: games.length,
    invalid: invalid.length,
    decided: decided.length,
    draws,
    blackWins, whiteWins,
    blackWinRate: decisive ? blackWins / decisive : null,
    blackWinRateCI: decisive ? wilson(blackWins, decisive) : null,
    pairedScore: aGames ? aScoreSum / aGames : null,
    pairedScoreCI: aGames ? wilson(aScoreSum, aGames) : null,
    pairs: pairsBoth,
    sameColorPairs: sameColor,
    sameColorRatio: pairsBoth ? sameColor / pairsBoth : null,
    pairsSplit: split, pairsBothWin: bothWin, pairsBothLoss: bothLoss, pairsWithDraw: withDraw,
    openingDecided, maxPlies, none,
    moveMs: nums(moveMs),
    gameMs: nums(gameMs),
    totalPlies: nums(totalPlies),
    aiPlies: nums(aiPlies),
    kindStats,
    blackMoveMs: nums(byPlayer.black),
    whiteMoveMs: nums(byPlayer.white),
    plyBuckets: Object.fromEntries(Object.entries(plyBuckets).sort((a, b) => bucketOrder(a[0]) - bucketOrder(b[0])).map(([k, v]) => [k, nums(v)])),
    openingTable,
    lengthTable,
    rotationTable,
    winnerMoveMs: nums(winnerMoveMs),
    loserMoveMs: nums(loserMoveMs),
    slow1s, slow2s,
    rotationsPerGame: games.length ? games.reduce((s, r) => s + (r.rotations || 0), 0) / games.length : 0,
    swapsPerGame: games.length ? games.reduce((s, r) => s + (r.swaps || 0), 0) / games.length : 0,
  };
}

function bucketOrder(b) { return ["1-10", "11-20", "21-30", "31-40", "41+"].indexOf(b); }
function lenOrder(b) { return ["≤10", "11-20", "21-30", "31-40", "41-60", "61+"].indexOf(b); }
function rotOrder(b) { return ["0", "1", "2", "3+"].indexOf(b); }

function slowestMoves(games, n) {
  const all = [];
  for (const r of games) {
    for (const m of r.moves || []) {
      all.push({ mode: r.mode, gameId: r.gameId, ply: m.ply, player: m.player, kind: m.kind, ms: m.ms, action: m.action });
    }
  }
  all.sort((a, b) => b.ms - a.ms);
  return all.slice(0, n);
}

function colorSummary(games) {
  const decided = games.filter((r) => r.endedReason === "decided");
  const black = decided.filter((r) => r.winner === BLACK).length;
  const white = decided.filter((r) => r.winner === WHITE).length;
  return { decided: decided.length, black, white, draws: decided.length - black - white, blackWinRate: black + white ? black / (black + white) : null };
}

function renderMarkdown(rep) {
  const L = [];
  L.push("# 自对弈数据报告：" + rep.runId);
  L.push("");
  L.push("- 引擎 sha256：`" + rep.engine.sha256 + "`");
  L.push("- git：" + (rep.engine.git && rep.engine.git.rev ? "`" + rep.engine.git.rev + "`" : "（无提交）") +
         (rep.engine.git && rep.engine.git.dirty ? " ⚠ 工作区有改动" : ""));
  L.push("- 档位：ultra vs ultra；有效对局 " + rep.games + "，无效 " + rep.invalid + "，重复行 " + rep.duplicates);
  L.push("");
  L.push("## 分模式总览");
  L.push("");
  L.push("| 模式 | 局数 | 平均手数 | 黑胜 | 白胜 | 和 | 黑胜率 (95% CI) | 配对得分 (95% CI) | 同色胜对 | 率先结束/上限/无手 |");
  L.push("|---|---:|---:|---:|---:|---:|---|---|---|---|");
  for (const mode of Object.keys(rep.modes)) {
    const m = rep.modes[mode];
    const ciStr = m.blackWinRate === null ? "—" : ci(m.blackWins, m.blackWins + m.whiteWins);
    const pci = m.pairedScore === null ? "—" : pct(m.pairedScore) + " [" +
      pct(m.pairedScoreCI ? m.pairedScoreCI[0] : 0) + ", " + pct(m.pairedScoreCI ? m.pairedScoreCI[1] : 0) + "]";
    L.push("| " + mode + " | " + m.games + " | " + (m.totalPlies ? m.totalPlies.mean.toFixed(1) : "—") +
           " | " + m.blackWins + " | " + m.whiteWins + " | " + m.draws +
           " | " + ciStr + " | " + pci +
           " | " + (m.sameColorRatio === null ? "—" : pct(m.sameColorRatio)) +
           " (" + m.sameColorPairs + "/" + m.pairs + ")" +
           " | " + m.openingDecided + "/" + m.maxPlies + "/" + m.none + " |");
  }
  L.push("");
  L.push("> 同色胜对 = 配对两局赢家颜色相同。比例高说明这个开局/规则下胜负主要由颜色决定，配对 50% 是设计逼出来的；配对得分偏离 50% 说明先手/后手或规则不对称，不是「谁更强」。");
  L.push("");
  L.push("## 用时");
  L.push("");
  L.push("| 模式 | 每手中位 | p95 | p99 | 最慢 | 每局中位 | 每局平均 | 黑方每手中位 | 白方每手中位 |");
  L.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const mode of Object.keys(rep.modes)) {
    const m = rep.modes[mode];
    L.push("| " + mode + " | " + fmtMs(m.moveMs && m.moveMs.median) + " | " + fmtMs(m.moveMs && m.moveMs.p95) +
           " | " + fmtMs(m.moveMs && m.moveMs.p99) + " | " + fmtMs(m.moveMs && m.moveMs.max) +
           " | " + fmtMs(m.gameMs && m.gameMs.median) + " | " + fmtMs(m.gameMs && m.gameMs.mean) +
           " | " + fmtMs(m.blackMoveMs && m.blackMoveMs.median) + " | " + fmtMs(m.whiteMoveMs && m.whiteMoveMs.median) + " |");
  }
  L.push("");
  L.push("慢手计数（每手）：" + Object.keys(rep.modes).map((mode) => {
    const m = rep.modes[mode];
    return mode + " ≥1s " + m.slow1s + " / ≥2s " + m.slow2s;
  }).join("；"));
  L.push("赢家/输家每手中位：" + Object.keys(rep.modes).map((mode) => {
    const m = rep.modes[mode];
    return mode + " " + fmtMs(m.winnerMoveMs && m.winnerMoveMs.median) + " / " + fmtMs(m.loserMoveMs && m.loserMoveMs.median);
  }).join("；"));
  L.push("");
  L.push("## 按手数段（AI 每手耗时）");
  L.push("");
  for (const mode of Object.keys(rep.modes)) {
    const m = rep.modes[mode];
    const rows = Object.entries(m.plyBuckets);
    if (!rows.length) continue;
    L.push("**" + mode + "**：" + rows.map(([k, v]) => k + " 手 " + fmtMs(v.median)).join(" / "));
  }
  L.push("");
  L.push("## 按局长");
  L.push("");
  L.push("| 模式 | 总手数 | 局数 | 黑胜 | 白胜 | 黑胜率 | 平均局时 | 平均每手 |");
  L.push("|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const mode of Object.keys(rep.modes)) {
    const m = rep.modes[mode];
    for (const [k, o] of Object.entries(m.lengthTable)) {
      L.push("| " + mode + " | " + k + " | " + o.games + " | " + o.black + " | " + o.white +
             " | " + pct(o.blackWinRate) + " | " + fmtMs(o.avgGameMs) + " | " + fmtMs(o.avgMoveMs) + " |");
    }
  }
  L.push("");
  L.push("## 转动分布");
  L.push("");
  L.push("| 模式 | 每局转动 | 局数 | 黑胜 | 白胜 | 黑胜率 | 平均局时 |");
  L.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const mode of Object.keys(rep.modes)) {
    const m = rep.modes[mode];
    for (const [k, o] of Object.entries(m.rotationTable)) {
      L.push("| " + mode + " | " + k + " | " + o.games + " | " + o.black + " | " + o.white +
             " | " + pct(o.blackWinRate) + " | " + fmtMs(o.avgGameMs) + " |");
    }
  }
  L.push("");
  L.push("## 按开局长度");
  L.push("");
  L.push("| 模式 | 开局手 | 局数 | 已决 | 黑胜 | 白胜 | 黑胜率 | 配对得分 | 平均手数 |");
  L.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const mode of Object.keys(rep.modes)) {
    const m = rep.modes[mode];
    for (const [k, o] of Object.entries(m.openingTable)) {
      L.push("| " + mode + " | " + k + " | " + o.games + " | " + o.decided + " | " + o.black + " | " + o.white +
             " | " + pct(o.blackWinRate) + " | " + pct(o.pairedScore) + " | " + (o.avgPlies ? o.avgPlies.toFixed(1) : "—") + " |");
    }
  }
  L.push("");
  L.push("## 动作类型耗时");
  L.push("");
  for (const mode of Object.keys(rep.modes)) {
    const m = rep.modes[mode];
    const parts = Object.entries(m.kindStats).map(([k, v]) => k + " " + v.n + " 手，中位 " + fmtMs(v.median) + "，p95 " + fmtMs(v.p95));
    L.push("- **" + mode + "**：" + (parts.length ? parts.join("；") : "—"));
  }
  L.push("");
  L.push("## 最慢的 20 手");
  L.push("");
  L.push("| 模式 | 局 | 手 | 方 | 动作 | 用时 |");
  L.push("|---|---:|---:|---|---|---:|");
  for (const s of rep.slowest) {
    L.push("| " + s.mode + " | " + s.gameId + " | " + s.ply + " | " + (s.player === BLACK ? "黑" : "白") +
           " | " + s.kind + " | " + fmtMs(s.ms) + " |");
  }
  L.push("");
  L.push("## 异常");
  L.push("");
  for (const mode of Object.keys(rep.modes)) {
    const m = rep.modes[mode];
    L.push("- **" + mode + "**：无效 " + m.invalid + "，未终局（上限）" + m.maxPlies + "，AI 返回 none " + m.none +
           "，开局即终局 " + m.openingDecided + "，转动/交换每局 " + m.rotationsPerGame.toFixed(2) + "/" + m.swapsPerGame.toFixed(2));
  }
  L.push("");
  L.push("## 读法提醒");
  L.push("");
  L.push("- 这是 **ultra 打 ultra**，没有强弱对照组；任何得分率都只能解释为颜色/规则/开局偏差。");
  L.push("- 配对得分与黑胜率的置信区间都列出来了；20 局级别的数据不要解读，等全量。");
  L.push("- 同色胜对比例高时，配对得分会天然接近 50%，这不等于「平衡」。");
  return L.join("\n");
}
