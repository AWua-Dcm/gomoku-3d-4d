// 附加玩法试点的“制胜线”诊断：重放每局，看终局盘面里的 ≥5 连线有没有跨面（贯通）。
//
// 用法：
//   node _verify/selfplay-lines.mjs --dir _verify/results/selfplay/x-4d-default-200
//   node _verify/selfplay-lines.mjs            # 自动扫描 x-3d-*/x-4d-* 试点
//
// 只读 selfplay.mjs 的 shard-*.jsonl；不跑 AI、不改数据。
// 结论口径：`终局含跨面≥5线` 是“贯通出现在终局盘面”；`最后一手落在跨面线上` 才是
// “这一手直接靠贯通完成连线”的直接证据。转动结束的局不强行归因，另外计数。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.resolve(HERE, "..");
const BASE = path.join(PROJ, "_verify/results/selfplay");
const HTML_REL = "Web_Gomoku3D/index.html";

const args = parseArgs(process.argv.slice(2));
const dirs = args.dirs.length ? args.dirs : autoDirs();
if (!dirs.length) { console.error("没有找到 3D/4D 试点目录"); process.exit(2); }
const C = loadCore(path.join(PROJ, HTML_REL));

console.log("| 臂 | 模式 | 规则 | 局数 | 重放不符 | 终局含跨面≥5线 | 最后一手落跨面线 | 末手转动 | 末手转动且含跨面线 |");
console.log("|---|---|---|---:|---:|---:|---:|---:|---:|");
for (const dir of dirs) {
  const abs = path.resolve(PROJ, dir);
  const meta = JSON.parse(fs.readFileSync(path.join(abs, "meta.json"), "utf8"));
  const mode = meta.args.modes[0];
  if (mode !== "3d" && mode !== "4d") continue;
  const rules = (meta.rulesByMode && meta.rulesByMode[mode]) || {};
  const recs = readGames(abs, mode);
  let mismatch = 0, wrappedLine = 0, lastPlaceWrapped = 0, lastRotate = 0, lastRotateWrapped = 0;
  for (const rec of recs) {
    try {
      const s = replay(C, rec, rules);
      if (s.status !== rec.status || (s.winner | 0) !== (rec.winner | 0)) mismatch++;
      const lines = C.RuleEngine.fullScan(s.board, s.rules.winLength);
      const wrapped = [];
      for (const line of lines) {
        if (lineWraps(line, s.board.nx, s.board.ny, s.board.nz)) wrapped.push(line);
      }
      if (wrapped.length) wrappedLine++;
      const last = (rec.moves && rec.moves.length) ? rec.moves[rec.moves.length - 1] : null;
      if (last && last.kind === "place") {
        const cell = [last.action.x, last.action.y, last.action.z];
        if (wrapped.some((line) => lineContains(line, cell, s.board.nx, s.board.ny, s.board.nz))) lastPlaceWrapped++;
      }
      if (last && last.kind === "rotate") {
        lastRotate++;
        if (wrapped.length) lastRotateWrapped++;
      }
    } catch (err) {
      mismatch++;
    }
  }
  console.log("| " + path.basename(abs) + " | " + mode + " | " + ruleLabel(mode, rules) + " | " +
              recs.length + " | " + mismatch + " | " + wrappedLine + " | " + lastPlaceWrapped + " | " +
              lastRotate + " | " + lastRotateWrapped + " |");
}

/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const o = { dirs: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = String(argv[i] || "").replace(/^--/, "");
    if (k === "dir") { o.dirs.push(argv[i + 1]); i++; }
    else if (k === "help" || k === "h") {
      console.log("用法：node _verify/selfplay-lines.mjs [--dir <runDir> ...]");
      process.exit(0);
    } else { console.error("未知参数 --" + k); process.exit(2); }
  }
  return o;
}

function autoDirs() {
  if (!fs.existsSync(BASE)) return [];
  return fs.readdirSync(BASE)
    .filter((d) => /^x-(3d|4d)-.*-200$/.test(d))
    .map((d) => "_verify/results/selfplay/" + d)
    .sort();
}

function ruleLabel(mode, r) {
  if (mode === "3d") return "spin=" + !!r.allowRotation + " wrap=" + !!r.wrapEdges;
  return "wrap=" + !!r.wrapEdges + " phase=" + r.phasePeriod + " cool=" + r.rotationCooldownPlacements;
}

function readGames(dir, mode) {
  const map = new Map();
  for (const f of fs.readdirSync(dir).filter((f) => /^shard-\d+\.jsonl$/.test(f))) {
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      if (!r || r.mode !== mode || r.invalid) continue;
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
    return { FourDSession, GameSession, RuleSet, RotationMove, MoveStatus, EMPTY, BLACK, WHITE, RuleEngine };`)();
}

function replay(C, rec, rules) {
  const r = new C.RuleSet();
  r.allowRotation = !!rules.allowRotation;
  r.wrapEdges = !!rules.wrapEdges;
  r.rotationCooldownPlacements = rules.rotationCooldownPlacements;
  r.phasePeriod = rules.phasePeriod;
  const dims=rec.size;
  if(!Array.isArray(dims)||dims.length!==3||!dims.every(n=>Number.isInteger(n)&&n>=5))throw new Error('缺少合法 rec.size');
  if(rec.mode==='4d'&&!dims.every(n=>n===dims[0]))throw new Error('4D 非立方尺寸');
  const s = rec.mode==='4d'?C.FourDSession.create(dims[0],C.BLACK,r):C.FourDSession.wrap(C.GameSession.create(dims,C.BLACK,r));
  for (const o of rec.opening || []) {
    const res = s.place(o.x, o.y, o.z);
    if (!res || res.status === C.MoveStatus.Rejected) throw new Error("opening rejected");
  }
  for (const m of rec.moves || []) {
    let res;
    if (m.kind === "place") res = s.place(m.action.x, m.action.y, m.action.z);
    else if (m.kind === "rotate") res = s.rotate(C.RotationMove.fromClockwiseTurns(m.action.axis, m.action.layer, m.action.turns));
    else throw new Error("unsupported action " + m.kind);
    if (!res || res.status === C.MoveStatus.Rejected || (m.kind === "rotate" && !res.accepted)) {
      throw new Error("action rejected at ply " + m.ply);
    }
  }
  return s;
}

/** 一条极大的连线在行走过程中是否会越界绕回（或整圈同色）。 */
function lineWraps(line, nx, ny, nz) {
  const [dx, dy, dz] = line.dir;
  if (line.length >= Math.max(nx, ny, nz)) return true;
  let x = line.start[0], y = line.start[1], z = line.start[2];
  for (let i = 1; i < line.length; i++) {
    if (x + dx < 0 || x + dx >= nx || y + dy < 0 || y + dy >= ny || z + dz < 0 || z + dz >= nz) return true;
    x = (x + dx + nx) % nx;
    y = (y + dy + ny) % ny;
    z = (z + dz + nz) % nz;
  }
  return false;
}

function lineContains(line, cell, nx, ny, nz) {
  let x = line.start[0], y = line.start[1], z = line.start[2];
  const [dx, dy, dz] = line.dir;
  for (let i = 0; i < line.length; i++) {
    if (x === cell[0] && y === cell[1] && z === cell[2]) return true;
    x = (x + dx + nx) % nx;
    y = (y + dy + ny) % ny;
    z = (z + dz + nz) % nz;
  }
  return false;
}
