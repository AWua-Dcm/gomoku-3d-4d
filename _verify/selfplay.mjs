// ultra-vs-ultra 自对弈数据台（2D / 3D / 4D）。
//
// 只做数据采集：逐手计时、逐局记录；不做胜率分析。分析在 selfplay-analyze.mjs。
//
// 【为什么只跑 ultra vs ultra】本次实验只关心最强档自身的问题；xhigh 不参与。
// 同内核两边对打时，任何“A 方得分率”都不是棋力差，而是颜色 / 规则 / 开局的偏差。
// 这个偏差正是要如实记录的东西，所以本脚本**不**要求配对得分恰好 50.0%。
//
// 【配对】第 2k 局与第 2k+1 局共享同一个开局种子，只对调 ultra 执黑/执白。
// 两局都从黑先开始；开局棋子颜色在两局里相同，变的是“ultra 这一方”执什么色。
// 这是本工程 ai-ab.mjs / ai.test.mjs 已经用了很久的写法，便于与前例对照。
//
// 【为什么开局要随机】搜索是确定性的；固定开局下“一万局”其实是同一盘棋重复一万次。
// 每一对随机棋盘尺寸（2D 宽高 10–18、3D 10–18³、4D 8–9³），开局 0–6 手随机，
// 落点取中心盒（代码实际是 half−3..half+2，即 6×6(×6)；历史文档旧称 7×7）里的空格；
// 同一对两局共享尺寸/开局，只对调颜色。
//
// 【断点续跑】每局一行 JSON 追加到 shard-<worker>.jsonl。--resume 会扫描已有行，
// 只补没写完的局。崩溃时最后一行可能不完整，扫描时直接丢弃该行。
//
// 用法：
//   node _verify/selfplay.mjs --games 200 --workers 4 --tag pilot
//   node _verify/selfplay.mjs --games 10000 --workers 4 --tag full --resume
//   node _verify/selfplay.mjs --modes 2d --games 4 --workers 1 --tag smoke
//
// 输出：_verify/results/selfplay/<tag>/
//   meta.json      引擎哈希、git 版本、参数、机器信息
//   shard-*.jsonl  逐局记录（含逐手用时）
//   summary.json   完整性汇总（不分析颜色胜率）
//   analysis.*     由 selfplay-analyze.mjs 事后生成

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.resolve(HERE, "..");
const HTML_REL = "Web_Gomoku3D/index.html";
const LEVEL = "ultra";

// 三个模式都用各自在工程里已经验证过的标准尺寸：
// 2D 经典 15×15；3D 15³；4D 8³、转动冷却 3 手（与 ai-ab.mjs 的默认口径一致）。
const MODES = {
  "2d": { label: "2D 10–18", n: 15, fourD: false, maxPlies: 300, seedBase: 110001 },
  "3d": { label: "3D 10–18³", n: 15, fourD: false, maxPlies: 300, seedBase: 220001 },
  "4d": { label: "4D 8–9³", n: 8, fourD: true, maxPlies: 400, seedBase: 330001 },
};

// 2D 附加玩法的组合名。默认 classic = 三个机制全关。
// 参数与界面默认一致：黑洞随机 7 个、双方各放 0、交换冷却 5；寿命 30 手、灰期 3 手。
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

// 每一对（两局共享）随机棋盘尺寸。**范围按“还能正常下”定，不是为随机而随机**：
// 浮空/黑洞/寿命越多，棋盘越小越容易被机制挤死；所以带 F 的组合最小 14，HFA 最小 15。
// 2D 宽高独立；3D/4D 立方。同一对两局尺寸相同，配对仍成立。
const SIZE_RANGES = {
  "2d": {
    classic: [12, 18], h: [12, 18], ha: [12, 18], a: [12, 18],
    f: [14, 18], hf: [14, 18], fa: [14, 18], hfa: [15, 18],
  },
  "3d": [12, 18],
  "4d": [8, 9],
};
// 旧数据：0 手开局黑胜 100%，1 手 84–100% —— 后手几乎没有机会，不能算“有胜机的随机”。
// 所以最少 2 手；2–6 手的落点仍逐对变化。
const OPENING_MIN = 2;
const OPENING_MAX = 6;
const OPENING_TRIES = 20;
const OPEN_DIRS13 = [
  [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, -1, 0],
  [1, 0, 1], [1, 0, -1], [0, 1, 1], [0, 1, -1],
  [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
];

/* ------------------------------------------------------------------ */
/* 主线程                                                              */
/* ------------------------------------------------------------------ */

if (isMainThread) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
} else {
  workerMain().catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

function parseArgs(argv) {
  const o = {
    games: 200,
    workers: 4,
    modes: ["2d", "3d", "4d"],
    out: "_verify/results/selfplay",
    tag: null,
    seed: 20261029,
    resume: false,
    maxPlies: null,
    progress: 25,
    engine: null,
    // 规则口径。默认与旧数据一致：2D 经典；3D 经典；4D rotation-only、冷却 3。
    // --4d-default 切到界面默认四维：rotation + 贯通 + 晨昏 12 + 冷却 5。
    twoDVariant: "classic",
    threeDSpin: false,
    threeDWrap: false,
    fourDDefault: false,
    fourDWrap: false,
    fourDPhase: 0,
    fourDCool: 3,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = String(argv[i] || "").replace(/^--/, "");
    const v = argv[i + 1];
    if (k === "games") { o.games = parseInt(v, 10); i++; }
    else if (k === "workers") { o.workers = parseInt(v, 10); i++; }
    else if (k === "modes") { o.modes = String(v).split(",").filter(Boolean); i++; }
    else if (k === "out") { o.out = v; i++; }
    else if (k === "tag") { o.tag = v; i++; }
    else if (k === "seed") { o.seed = parseInt(v, 10) >>> 0; i++; }
    else if (k === "max-plies") { o.maxPlies = parseInt(v, 10); i++; }
    else if (k === "progress") { o.progress = parseInt(v, 10); i++; }
    else if (k === "engine") { o.engine = v; i++; }
    else if (k === "2d-variant") { o.twoDVariant = v; i++; }
    else if (k === "3d-spin") { o.threeDSpin = true; }
    else if (k === "3d-wrap") { o.threeDWrap = true; }
    else if (k === "4d-default") { o.fourDDefault = true; }
    else if (k === "4d-wrap") { o.fourDWrap = true; }
    else if (k === "4d-phase") { o.fourDPhase = parseInt(v, 10); i++; }
    else if (k === "4d-cool") { o.fourDCool = parseInt(v, 10); i++; }
    else if (k === "resume") { o.resume = true; }
    else if (k === "help" || k === "h") { printHelp(); process.exit(0); }
    else { console.error("未知参数 --" + k); process.exit(2); }
  }
  o.modes = [...new Set(o.modes)];
  for (const m of o.modes) {
    if (!MODES[m]) { console.error("--modes 只能是 2d,3d,4d，收到 " + m); process.exit(2); }
  }
  if (!Number.isInteger(o.games) || o.games < 2 || o.games % 2 !== 0) {
    console.error("--games 必须是 >=2 的偶数（配对设计）");
    process.exit(2);
  }
  if (!Number.isInteger(o.workers) || o.workers < 1 || o.workers > 12) {
    console.error("--workers 必须在 1..12");
    process.exit(2);
  }
  if (o.maxPlies !== null && (!Number.isInteger(o.maxPlies) || o.maxPlies < 10)) {
    console.error("--max-plies 至少 10");
    process.exit(2);
  }
  if (o.fourDDefault) { o.fourDWrap = true; o.fourDPhase = 12; o.fourDCool = 5; }
  if (!TWO_D_VARIANTS[o.twoDVariant]) {
    console.error("--2d-variant 只能是 " + Object.keys(TWO_D_VARIANTS).join(","));
    process.exit(2);
  }
  if (!(o.fourDPhase === 0 || (Number.isInteger(o.fourDPhase) && o.fourDPhase >= 10 && o.fourDPhase <= 40))) {
    console.error("--4d-phase 只能是 0 或 10..40");
    process.exit(2);
  }
  if (!(Number.isInteger(o.fourDCool) && o.fourDCool >= 0 && o.fourDCool <= 10)) {
    console.error("--4d-cool 只能是 0..10");
    process.exit(2);
  }
  if (!o.tag) o.tag = (o.games >= 1000 ? "full-" : "pilot-") + stamp();
  return o;
}

function printHelp() {
  console.log(`ultra-vs-ultra 自对弈数据台

  --games N      每个模式 N 局，必须是偶数（默认 200）
  --workers N    并发 worker 数（默认 4；每 worker 同时只下一局）
  --modes LIST   逗号分隔：2d,3d,4d（默认三个都跑）
  --tag NAME     运行目录名（默认按局数自动命名）
  --seed N       开局种子基准（默认 20261029）
  --max-plies N  覆盖所有模式的手数上限
  --progress N   每 N 局打印一次进度（默认 25）
  --engine PATH  换一份 index.html 内核（A/B 候选；默认 Web_Gomoku3D/index.html）
  --2d-variant NAME  classic|h|f|a|hf|ha|fa|hfa（默认 classic）
  --3d-spin      三维魔方旋转
  --3d-wrap      三维空间贯通
  --4d-default   四维界面默认：rotation+贯通+晨昏12+冷却5
  --4d-wrap      四维额外开贯通
  --4d-phase N   四维晨昏周期（0 或 10..40，默认 0）
  --4d-cool N    四维转动冷却（0..10，默认 3；--4d-default 时 5）
  --resume       续跑已有 --tag 目录

输出在 _verify/results/selfplay/<tag>/。`);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" +
         p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function gitInfo(relPath) {
  try {
    const rev = execFileSync("git", ["rev-parse", "--verify", "HEAD"],
                             { cwd: PROJ, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--", relPath],
                               { cwd: PROJ, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return { rev, dirty: dirty.length > 0 };
  } catch {
    return { rev: null, dirty: null };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const htmlRel = args.engine || HTML_REL;
  const htmlPath = path.resolve(PROJ, htmlRel);
  const htmlBuf = fs.readFileSync(htmlPath);
  const sha = crypto.createHash("sha256").update(htmlBuf).digest("hex");
  const git = gitInfo(path.relative(PROJ, htmlPath));

  const runDir = path.join(PROJ, args.out, args.tag);
  const metaPath = path.join(runDir, "meta.json");
  fs.mkdirSync(runDir, { recursive: true });

  const maxPliesByMode = Object.fromEntries(
    args.modes.map((m) => [m, args.maxPlies === null ? MODES[m].maxPlies : args.maxPlies]));

  // 规则口径必须显式进 meta：同一份数据台可以跑经典、附加玩法、四维默认；
  // 不写清楚的话，“4D 65.4%”到底是 rotation-only 还是默认四维，事后分不出来。
  const rulesByMode = {
    "2d": { variant: args.twoDVariant },
    "3d": {
      allowRotation: args.threeDSpin,
      wrapEdges: args.threeDWrap,
      rotationCooldownPlacements: 5,
      phasePeriod: 0,
    },
    "4d": {
      allowRotation: true,
      wrapEdges: args.fourDWrap,
      rotationCooldownPlacements: args.fourDCool,
      phasePeriod: args.fourDPhase,
    },
  };

  let meta;
  if (fs.existsSync(metaPath)) {
    meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    if (!args.resume) {
      console.error("★ 运行目录已存在：" + runDir + "\n  续跑请加 --resume，或换一个 --tag。");
      process.exit(2);
    }
    if (meta.engine.sha256 !== sha) {
      console.error("★ " + HTML_REL + " 在运行期间变过（sha256 不一致），拒绝续跑。");
      process.exit(2);
    }
    if (meta.args.games !== args.games ||
        meta.args.modes.join(",") !== args.modes.join(",") ||
        JSON.stringify(meta.maxPliesByMode) !== JSON.stringify(maxPliesByMode) ||
        JSON.stringify(meta.rulesByMode) !== JSON.stringify(rulesByMode)) {
      console.error("★ 续跑参数与 meta.json 不一致，拒绝续跑。");
      process.exit(2);
    }
    console.log("续跑：" + runDir);
  } else {
    meta = {
      runId: args.tag,
      createdAt: new Date().toISOString(),
      level: LEVEL,
      args: { games: args.games, workers: args.workers, modes: args.modes, seed: args.seed },
      maxPliesByMode,
      sizeRanges: SIZE_RANGES,
      openingRange: [OPENING_MIN, OPENING_MAX],
      rulesByMode,
      engine: { path: path.relative(PROJ, htmlPath), sha256: sha, bytes: htmlBuf.length, git },
      node: process.version,
      platform: process.platform,
      cpus: os.cpus().length,
      cpu: os.cpus()[0] ? os.cpus()[0].model : null,
      modeConfigs: Object.fromEntries(args.modes.map((m) => [m, MODES[m]])),
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
  }

  // 任务表：按 gameId 在外层、mode 在内层交错，静态分块时每个 worker 都能拿到
  // 三种模式的混合（4D 最贵，不能全压在一个 worker 上）。
  const allTasks = [];
  for (let gameId = 0; gameId < args.games; gameId++) {
    const pairId = gameId >> 1;
    for (const mode of args.modes) {
      const M = MODES[mode];
      allTasks.push({
        mode,
        gameId,
        pairId,
        aIsBlack: gameId % 2 === 0,
        seed: (args.seed + M.seedBase + pairId * 7919) >>> 0,
        openLength: OPENING_MIN + (pairId % (OPENING_MAX - OPENING_MIN + 1)),
        maxPlies: maxPliesByMode[mode],
        rules: rulesByMode[mode],
      });
    }
  }

  const doneKeys = scanDoneKeys(runDir);
  const tasks = allTasks.filter((t) => !doneKeys.has(t.mode + ":" + t.gameId));
  console.log("运行目录：" + path.relative(PROJ, runDir));
  console.log("引擎 sha256：" + sha.slice(0, 16) + "…" +
              (git.rev ? "  git " + git.rev.slice(0, 8) : "") +
              (git.dirty ? "  ⚠ 工作区有未提交改动" : ""));
  console.log("计划 " + allTasks.length + " 局；已完成 " + (allTasks.length - tasks.length) +
              " 局；本次补 " + tasks.length + " 局；" + args.workers + " 并发。");
  if (tasks.length === 0) {
    writeSummary(runDir, args, allTasks, meta, Date.now());
    return;
  }

  const started = Date.now();
  const workerCount = Math.min(args.workers, tasks.length);
  const chunks = Array.from({ length: workerCount }, () => []);
  tasks.forEach((t, i) => chunks[i % workerCount].push(t));

  let done = 0, failed = 0;
  const total = tasks.length;
  const onGame = (ok) => {
    if (ok) done++; else failed++;
    if ((done + failed) % Math.max(1, args.progress) === 0 || done + failed === total) {
      const elapsed = (Date.now() - started) / 1000;
      const rate = (done + failed) / Math.max(1, elapsed);
      const eta = rate > 0 ? Math.round((total - done - failed) / rate) : 0;
      process.stdout.write(`[${done + failed}/${total}] 完成 ${done}，无效 ${failed}，` +
                           `已用 ${fmtSec(elapsed)}，ETA ${fmtSec(eta)}\n`);
    }
  };

  const engineShort = sha.slice(0, 12);
  const results = await Promise.allSettled(chunks.map((chunk, idx) =>
    runChunk(chunk, idx, runDir, htmlPath, args.seed, engineShort, args.tag, onGame)));

  let chunkFailed = 0;
  for (const r of results) if (r.status === "rejected") { chunkFailed++; console.error(r.reason); }

  // 收尾前再确认一次引擎没变：否则同一批数据会混两个版本。
  const shaAfter = crypto.createHash("sha256").update(fs.readFileSync(htmlPath)).digest("hex");
  if (shaAfter !== sha) {
    console.error("★ " + HTML_REL + " 在运行期间变过；这批数据不能和分析混用。");
    process.exitCode = 2;
  }

  writeSummary(runDir, args, allTasks, meta, started);
  if (chunkFailed > 0 || failed > 0) process.exitCode = 1;
  console.log("分析：node _verify/selfplay-analyze.mjs --dir " + path.relative(PROJ, runDir));
}

function fmtSec(sec) {
  if (!Number.isFinite(sec)) return "?";
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + "h" : "") + (h || m ? m + "m" : "") + s + "s";
}

/** 读取所有 shard-*.jsonl 里出现过的 mode:gameId（有效行和无效行都算“已处理”）。 */
function scanDoneKeys(runDir) {
  const keys = new Set();
  for (const f of shardFiles(runDir)) {
    let text;
    try { text = fs.readFileSync(path.join(runDir, f), "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let r;
      try { r = JSON.parse(line); } catch { continue; }   // 崩溃留下的半行
      if (r && r.mode && r.gameId !== undefined) keys.add(r.mode + ":" + r.gameId);
    }
  }
  return keys;
}

function shardFiles(runDir) {
  try {
    return fs.readdirSync(runDir).filter((f) => /^shard-\d+\.jsonl$/.test(f)).sort();
  } catch { return []; }
}

async function runChunk(chunk, idx, runDir, htmlPath, seed, engineShort, runId, onGame) {
  let remaining = chunk;
  for (let attempt = 0; attempt <= 2; attempt++) {
    if (remaining.length === 0) return;
    const shardPath = path.join(runDir, `shard-${idx}.jsonl`);
    try {
      await runWorker(remaining, shardPath, htmlPath, seed, engineShort, runId, onGame);
      return;
    } catch (err) {
      console.error(`worker ${idx} 第 ${attempt + 1} 次异常：` + (err && err.message ? err.message : err));
      if (attempt === 2) throw err;
      // 崩溃后按已落盘的行重算剩余；半行会在 scan 时被丢掉。
      const done = scanDoneKeysForFile(shardPath);
      remaining = remaining.filter((t) => !done.has(t.mode + ":" + t.gameId));
      console.error(`worker ${idx} 重试，剩 ${remaining.length} 局`);
    }
  }
}

function scanDoneKeysForFile(file) {
  const keys = new Set();
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return keys; }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r && r.mode && r.gameId !== undefined) keys.add(r.mode + ":" + r.gameId);
  }
  return keys;
}

function runWorker(tasks, outPath, htmlPath, seed, engineShort, runId, onGame) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), {
      workerData: { tasks, outPath, htmlPath, seed, engineShort, runId },
    });
    let finished = false;
    w.on("message", (msg) => {
      if (msg && msg.type === "game") onGame(!!msg.ok);
      if (msg && msg.type === "finished") finished = true;
    });
    w.on("error", (err) => { if (!finished) reject(err); });
    w.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error("worker exit code " + code));
    });
  });
}

function writeSummary(runDir, args, allTasks, meta, startedAt) {
  const seen = new Map();
  let lines = 0, duplicates = 0, invalid = 0;
  const perMode = {}, perModeMoves = {}, perModePlies = {}, perModeMs = {};
  for (const f of shardFiles(runDir)) {
    const text = fs.readFileSync(path.join(runDir, f), "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      if (!r || !r.mode || r.gameId === undefined) continue;
      lines++;
      const key = r.mode + ":" + r.gameId;
      if (seen.has(key)) { duplicates++; continue; }
      seen.set(key, r);
      if (r.invalid) { invalid++; continue; }
      perMode[r.mode] = (perMode[r.mode] || 0) + 1;
      perModeMoves[r.mode] = (perModeMoves[r.mode] || 0) + (r.moves ? r.moves.length : 0);
      perModePlies[r.mode] = (perModePlies[r.mode] || 0) + (r.totalPlies || 0);
      perModeMs[r.mode] = (perModeMs[r.mode] || 0) + (r.durationMs || 0);
    }
  }
  const expected = allTasks.length;
  const completed = [...seen.values()].filter((r) => !r.invalid).length;
  const missing = expected - completed - invalid;
  const sessionMs = Date.now() - startedAt;
  const elapsedMs = Date.now() - Date.parse(meta.createdAt);
  const summary = {
    runId: meta.runId,
    engineSha256: meta.engine.sha256,
    level: LEVEL,
    expected,
    completed,
    invalid,
    missing,
    duplicates,
    lines,
    sessionMs,
    elapsedMs,
    gamesPerSec: sessionMs > 0 ? +(completed / (sessionMs / 1000)).toFixed(4) : null,
    perMode: Object.fromEntries(args.modes.map((m) => [m, {
      games: perMode[m] || 0,
      moves: perModeMoves[m] || 0,
      totalPlies: perModePlies[m] || 0,
      avgPlies: perMode[m] ? +((perModePlies[m] || 0) / perMode[m]).toFixed(1) : 0,
      sumGameMs: Math.round(perModeMs[m] || 0),
      avgGameMs: perMode[m] ? Math.round((perModeMs[m] || 0) / perMode[m]) : 0,
    }])),
    finishedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log("完整性汇总：完成 " + completed + " / " + expected +
              "，无效 " + invalid + "，缺失 " + missing + "，重复行 " + duplicates +
              "，用时 " + fmtSec(elapsedMs / 1000));
  for (const m of args.modes) {
    const p = summary.perMode[m];
    console.log("  " + MODES[m].label + "：" + p.games + " 局，平均 " + p.avgPlies +
                " 手，平均 " + (p.avgGameMs / 1000).toFixed(2) + "s/局");
  }
}

/* ------------------------------------------------------------------ */
/* worker                                                              */
/* ------------------------------------------------------------------ */

async function workerMain() {
  const { tasks, outPath, htmlPath, engineShort, runId } = workerData;
  const C = loadCore(htmlPath);
  for (const task of tasks) {
    let rec;
    try {
      rec = playGame(C, task);
    } catch (err) {
      rec = {
        mode: task.mode, gameId: task.gameId, pairId: task.pairId,
        aIsBlack: task.aIsBlack, level: LEVEL, invalid: true,
        error: String(err && err.stack ? err.stack : err),
      };
    }
    rec.runId = runId || null;
    rec.engine = engineShort;
    rec.finishedAt = new Date().toISOString();
    fs.appendFileSync(outPath, JSON.stringify(rec) + "\n");
    parentPort.postMessage({ type: "game", ok: !rec.invalid });
  }
  parentPort.postMessage({ type: "finished" });
}

/** 从 index.html 抽内核区间并求值；与 ai-ab.mjs / tests 用同一段标记。 */
function loadCore(htmlPath) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const s = html.indexOf("<script>");
  const e = html.lastIndexOf("</script>");
  if (s < 0 || e < 0) throw new Error("找不到 <script> 块");
  const full = html.slice(s + "<script>".length, e);
  const BEGIN = "/* GOMOKU-CORE-BEGIN */";
  const END = "/* GOMOKU-CORE-END */";
  const at = full.indexOf(BEGIN), bt = full.indexOf(END);
  if (at < 0 || bt < 0) throw new Error("找不到内核标记");
  const core = full.slice(at + BEGIN.length, bt);
  return new Function(core + `
    return { FourDSession, RuleSet, RotationMove, MoveStatus, EMPTY, BLACK, WHITE,
             aiChooseMove, aiRng, Session2D, ai2ChooseMove };`)();
}

function playGame(C, task) {
  const M = MODES[task.mode];
  const { mode, gameId, pairId, aIsBlack, seed, openLength } = task;
  const maxPlies = task.maxPlies || M.maxPlies;
  let n = M.n, w = 0, h = 0;
  const sizeRng = C.aiRng((seed ^ 0x51ed270b) >>> 0);
  const tGame0 = process.hrtime.bigint();

  // 尺寸按组合限制在“可下”的范围内；同一对两局共享 seed，所以尺寸相同。
  const range = mode === "2d"
    ? (SIZE_RANGES["2d"][task.rules.variant] || SIZE_RANGES["2d"].classic)
    : SIZE_RANGES[mode];
  const span = range[1] - range[0] + 1;
  if (mode === "2d") {
    w = range[0] + ((sizeRng() * span) | 0);
    h = range[0] + ((sizeRng() * span) | 0);
  } else {
    n = range[0] + ((sizeRng() * span) | 0);
  }

  const makeSession = () => {
    if (mode === "2d") {
      const variant2 = build2DVariant(task.rules.variant, seed, w, h);
      return C.Session2D.create(w, h, C.BLACK, new C.RuleSet(), variant2);
    }
    const rules = new C.RuleSet();
    rules.allowRotation = !!task.rules.allowRotation;
    rules.wrapEdges = !!task.rules.wrapEdges;
    rules.rotationCooldownPlacements = task.rules.rotationCooldownPlacements;
    rules.phasePeriod = task.rules.phasePeriod;
    return C.FourDSession.create(n, C.BLACK, rules);
  };

  let session = makeSession();
  const rngMove = C.aiRng((seed ^ 0xa5a5a5a5) >>> 0);
  const ai = mode === "2d"
    ? (s, sd, stats) => C.ai2ChooseMove(s, { level: LEVEL, seed: sd, stats })
    : (s, sd, stats) => C.aiChooseMove(s, { level: LEVEL, seed: sd, stats });
  const apply = mode === "2d"
    ? (s, a) => a.kind === "place" ? s.place(a.x, a.y, a.layer)
             : a.kind === "swap" ? s.swapLines(a.axis, a.i, a.j)
             : a.kind === "placeHole" ? s.placeHole(a.x, a.y)
             : null
    : (s, a) => a.kind === "place" ? s.place(a.x, a.y, a.z)
             : a.kind === "rotate" ? s.rotate(C.RotationMove.fromClockwiseTurns(a.axis, a.layer, a.turns))
             : null;

  // 随机开局：两局配对共享 seed / 尺寸 / openLength / 尝试序列，所以开局棋子完全一样。
  // 2–6 手来自实测（0/1 手后手机会太小），不是为随机而随机；再拒绝任何一方三连的开局。
  const dims = mode === "2d" ? [w, h] : [n, n, n];
  const loX = Math.max(0, ((dims[0] / 2) | 0) - 3), hiX = Math.min(dims[0], ((dims[0] / 2) | 0) + 3);
  const loY = Math.max(0, ((dims[1] / 2) | 0) - 3), hiY = Math.min(dims[1], ((dims[1] / 2) | 0) + 3);
  const loZ = Math.max(0, ((dims[2] || 1) / 2 | 0) - 3), hiZ = Math.min(dims[2] || 1, ((dims[2] || 1) / 2 | 0) + 3);

  const opening = [];
  let openingAttempts = 0, openingBalancedOk = false;
  for (let attempt = 0; attempt < OPENING_TRIES; attempt++) {
    openingAttempts++;
    session = makeSession();
    opening.length = 0;
    const rngOpen = C.aiRng((seed ^ 0x9e3779b9 ^ Math.imul(attempt, 0x85ebca6b)) >>> 0);
    for (let j = 0; j < openLength && session.status === "Playing"; j++) {
      const player = session.currentPlayer;
      const em = [];
      if (mode === "2d") {
        for (let y = loY; y < hiY; y++) for (let x = loX; x < hiX; x++) {
          if (session.canPlace(x, y)) em.push([x, y]);
        }
      } else {
        for (let z = loZ; z < hiZ; z++) for (let y = loY; y < hiY; y++) for (let x = loX; x < hiX; x++) {
          if (session.board.isEmpty(x, y, z)) em.push([x, y, z]);
        }
      }
      if (em.length === 0) break;
      const m = em[(rngOpen() * em.length) | 0];
      const r = mode === "2d" ? session.place(m[0], m[1]) : session.place(m[0], m[1], m[2]);
      if (!r || r.status === C.MoveStatus.Rejected) {
        throw new Error("开局被拒：" + JSON.stringify(m));
      }
      opening.push(mode === "2d"
        ? { x: m[0], y: m[1], player }
        : { x: m[0], y: m[1], z: m[2], player });
      if (session.status !== "Playing") break;
    }
    if (openingBalanced(session, mode)) { openingBalancedOk = true; break; }
  }

  const moves = [];
  let rotations = 0, swaps = 0, endedReason = null;
  while (session.status === "Playing" && opening.length + moves.length < maxPlies) {
    const player = session.currentPlayer;
    const beforePlayer = session.currentPlayer;
    const stats = {};
    const moveSeed = (rngMove() * 4294967296) >>> 0;
    const t0 = process.hrtime.bigint();
    const act = ai(session, moveSeed, stats);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;

    if (!act || act.kind === "none") { endedReason = "none"; break; }

    const r = apply(session, act);
    if (!r) throw new Error("apply 返回 null：" + JSON.stringify(act));
    if (mode === "2d") {
      if (r.status === C.MoveStatus.Rejected) {
        throw new Error("2D 引擎拒绝：" + JSON.stringify(act) + " / " + JSON.stringify(r));
      }
    } else if (r.status === C.MoveStatus.Rejected ||
               (act.kind === "rotate" && !r.accepted)) {
      throw new Error("3D/4D 引擎拒绝：" + JSON.stringify(act) + " / " + JSON.stringify(r));
    }
    if (act.kind === "rotate") rotations++;
    if (act.kind === "swap") swaps++;
    moves.push({
      ply: opening.length + moves.length + 1,
      player,
      kind: act.kind,
      action: actionRecord(act),
      ms: Math.round(ms * 1000) / 1000,
      stats: compactStats(stats),
    });
    if (session.status === "Playing" && session.currentPlayer === beforePlayer) {
      throw new Error("落子后回合没有翻转：" + JSON.stringify(act));
    }
  }

  if (session.status !== "Playing") endedReason = "decided";
  else if (endedReason === null) endedReason = "maxPlies";

  const winner = session.winner | 0;
  const aScore = winner === 0 ? 0.5 : ((winner === C.BLACK) === aIsBlack ? 1 : 0);
  const totalPlies = opening.length + moves.length;
  return {
    mode, gameId, pairId, aIsBlack, level: LEVEL,
    size: mode === "2d" ? [w, h] : [n, n, n],
    rules: mode === "2d"
      ? { variant: task.rules.variant, winLength: 5, overlineLoses: true }
      : { allowRotation: !!task.rules.allowRotation, wrapEdges: !!task.rules.wrapEdges,
          rotationCooldownPlacements: task.rules.rotationCooldownPlacements,
          phasePeriod: task.rules.phasePeriod },
    seed, openLength, openingPlies: opening.length, openingAttempts, openingBalanced: openingBalancedOk,
    aiPlies: moves.length, totalPlies,
    opening, moves,
    winner, winnerColor: winner, aScore,
    status: session.status, endedReason,
    rotations, swaps,
    durationMs: Math.round(Number(process.hrtime.bigint() - tGame0) / 1e6 * 1000) / 1000,
  };
}

/** 2D 附加玩法的 variant2 模板。黑洞种子按局/对变化，保证每对的两局洞位相同。 */
/** 开局不能已经给某一方做出三连（否则后手从一开始就被迫挨打，数据没有“胜机”可言）。 */
function openingBalanced(session, mode) {
  if (mode === "2d") {
    // 浮空开局只铺地基（顶层为空），没有三连可判。
    if (session.variant2.float.on) return true;
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
  const nx = session.board.nx, ny = session.board.ny, nz = session.board.nz;
  const cells = session.board.cells;
  const at = (x, y, z) => cells[x + nx * (y + ny * z)];
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const c = at(x, y, z);
    if (c !== 1 && c !== 2) continue;
    for (const [dx, dy, dz] of OPEN_DIRS13) {
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

function build2DVariant(name, seed, w, h) {
  const flags = TWO_D_VARIANTS[name] || TWO_D_VARIANTS.classic;
  // 黑洞随机数必须随面积缩放：10×10 的上限是 floor(100/15)=6，写死 7 会被 validateVariant2 拒。
  const randomCount = Math.max(3, Math.min(7, Math.floor(w * h / 15)));
  return {
    on: true, w, h, freeRule: false,
    holes: { on: flags.h, randomCount, perPlayer: 0, cooldown: 5, seed: (seed >>> 0), layout: null },
    float: { on: flags.f, life: 20, opening: 8 },
    age: { on: flags.a, turns: 30, gray: 3, aura: flags.h && flags.a },
  };
}

function actionRecord(act) {
  if (act.kind === "place") {
    return act.z === undefined
      ? { x: act.x, y: act.y, layer: act.layer }
      : { x: act.x, y: act.y, z: act.z };
  }
  if (act.kind === "rotate") return { axis: act.axis, layer: act.layer, turns: act.turns };
  if (act.kind === "swap") return { axis: act.axis, i: act.i, j: act.j };
  if (act.kind === "placeHole") return { x: act.x, y: act.y };
  return { ...act };
}

function compactStats(stats) {
  const out = {};
  for (const k of ["points", "nodes", "candidates", "judgeCalls", "rotProbes",
                   "searchNodes", "vcfNodes", "aiPointsUsed"]) {
    if (typeof stats[k] === "number") out[k] = stats[k];
  }
  return out;
}
