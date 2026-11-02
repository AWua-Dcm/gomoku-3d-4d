// 把 index.html 里的内核区间（GOMOKU-CORE-BEGIN/END）抽成可 require 的模块。
//
// 为什么需要它：网页版和 server.js 都用 new Function(CORE_SOURCE) 在运行时求值；
// 微信小程序运行时不能可靠使用 eval/new Function，所以小程序必须拿到**构建期**
// 就已经求值好的模块。抽出来的仍然是同一段源码，哈希与服务器完全一致。
//
// 规矩：
//   · 只读 Web_Gomoku3D/index.html，不改它；
//   · 切法必须和 server.js 的 hashCore / tests/rules.test.mjs 完全一致：
//     先取最外层 <script>（第一个 <script> … 最后一个 </script>），再切标记；
//   · 标记各只能出现一次；内核源码**原样**写入，不格式化、不转译、不删注释；
//   · 导出放在标记区间之外，否则改导出清单会改 CORE_HASH；
//   · 产物默认写到 dist-core/（已在 .gitignore），不要提交。
//
// 用法：
//   node _verify/build-core.mjs                 # 输出 dist-core/
//   node _verify/build-core.mjs --out path
//   node _verify/build-core.mjs --src path --out path
//
// 产物：
//   gomoku-core.js    CommonJS（微信小游戏/小程序 require）
//   gomoku-core.mjs   ES module
//   core-meta.json    { coreHash, bytes, exports }

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

function opt(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const SRC = opt("--src", "Web_Gomoku3D/index.html");
const OUT = opt("--out", "dist-core");

const BEGIN = "/* GOMOKU-CORE-BEGIN */";
const END = "/* GOMOKU-CORE-END */";

// 小程序客户端真正需要的最小集合（含建会话、重放、指纹、UI 合法范围）。
// 任何一个名字在内核里不存在，下面的 require 会在加载期抛 ReferenceError。
const CORE_EXPORTS = [
  "FourDSession", "GameSession", "RuleSet", "RestrictionTarget",
  "BoardLimits", "CoolLimits", "PhaseLimits", "normalizeDims",
  "MoveMode", "RotationDirection", "MoveStatus", "RotateStatus",
  "AXIS_X", "AXIS_Y", "AXIS_Z", "BLACK", "WHITE", "EMPTY",
  "RotationMove", "RotationRecord", "RotateOutcome", "RotationOps",
  "opponentOf", "cnOf", "sideName", "cellOf", "colourOf", "phaseOf",
  "axisName", "fingerprint", "CORE_TEXT",
  "Session2D", "fingerprint2", "validateVariant2", "normalizeVariant2", "ai2ChooseMove", "AI_PARAMS2",
];

function fail(msg) {
  console.error("致命：" + msg);
  process.exit(2);
}

if (!fs.existsSync(SRC)) fail("找不到源文件：" + SRC);
const html = fs.readFileSync(SRC, "utf8");

// 和 server.js 的 hashCore 逐字一致：先取最外层 <script>，再切标记。
const scriptStart = html.indexOf("<script>");
const scriptEnd = html.lastIndexOf("</script>");
if (scriptStart < 0 || scriptEnd <= scriptStart) fail("index.html 里找不到 <script> 块");
const script = html.slice(scriptStart + "<script>".length, scriptEnd);

const bi = script.indexOf(BEGIN);
const ei = script.indexOf(END);
if (bi < 0 || ei < 0 || ei <= bi) fail("index.html 里找不到 GOMOKU-CORE 标记区间");
if (script.indexOf(BEGIN, bi + BEGIN.length) >= 0 ||
    script.indexOf(END, ei + END.length) >= 0) {
  fail("GOMOKU-CORE 标记出现了不止一次 —— indexOf 会静默选错那一段");
}

const coreSource = script.slice(bi + BEGIN.length, ei);
const coreHash = crypto.createHash("sha256").update(coreSource).digest("hex").slice(0, 16);

const header = "// 由 _verify/build-core.mjs 从 Web_Gomoku3D/index.html 生成；不要手改。\n" +
               "// coreHash: " + coreHash + "\n" +
               "// 内核源码保持逐字节原样；导出语句在标记区间之外。\n";

const exportList = CORE_EXPORTS.map((n) => "  " + n).join(",\n");
const cjs = header + BEGIN + coreSource + END + "\n\nmodule.exports = {\n" + exportList + "\n};\n";
const esm = header + BEGIN + coreSource + END + "\n\nexport {\n" + exportList + "\n};\n";

fs.mkdirSync(OUT, { recursive: true });
const cjsPath = path.join(OUT, "gomoku-core.js");
const esmPath = path.join(OUT, "gomoku-core.mjs");
const metaPath = path.join(OUT, "core-meta.json");
fs.writeFileSync(cjsPath, cjs, "utf8");
fs.writeFileSync(esmPath, esm, "utf8");
fs.writeFileSync(metaPath, JSON.stringify({
  coreHash,
  bytes: Buffer.byteLength(coreSource, "utf8"),
  exports: CORE_EXPORTS,
}, null, 2) + "\n", "utf8");

// 生成后自检：模块能加载、导出齐全、哈希对得上、基本落子能跑。
const require = createRequire(import.meta.url);
let mod;
try {
  mod = require(path.resolve(cjsPath));
} catch (e) {
  fail("生成的 CommonJS 模块加载失败：" + (e && e.message));
}
const missing = CORE_EXPORTS.filter((n) => !(n in mod));
if (missing.length) fail("导出缺失：" + missing.join(", "));

// 哈希自检：从产物里重新切一次标记区间，必须和 coreHash 相同。
// 这条防的是"生成时多写/少写了一个字符"这类无声漂移。
const outText = fs.readFileSync(cjsPath, "utf8");
const ob = outText.indexOf(BEGIN), oe = outText.indexOf(END);
if (ob < 0 || oe <= ob) fail("产物里找不到内核标记，无法复核哈希");
const outHash = crypto.createHash("sha256")
  .update(outText.slice(ob + BEGIN.length, oe)).digest("hex").slice(0, 16);
if (outHash !== coreHash) fail("产物内核哈希 " + outHash + " != 源 " + coreHash);

try {
  const s = mod.FourDSession.create([8, 8, 8], mod.BLACK, new mod.RuleSet());
  const o = s.place(3, 4, 5);
  if (o.status === mod.MoveStatus.Rejected) fail("基本落子被拒：" + o.reason);
  if (s.moveCount !== 1) fail("基本落子后 moveCount=" + s.moveCount + "（期望 1）");
  const four = mod.FourDSession.create([8, 8, 8], mod.BLACK,
    Object.assign(new mod.RuleSet(), { allowRotation: true }));
  if (!four.rotationEnabled) fail("四维会话没有启用转动");
} catch (e) {
  fail("产物冒烟失败：" + (e && e.message));
}

console.log("内核构建：" + cjsPath + " / " + esmPath);
console.log("  源 " + SRC + "，内核 " + Buffer.byteLength(coreSource, "utf8") +
            " 字节，coreHash " + coreHash);
console.log("  导出 " + CORE_EXPORTS.length + " 个；CommonJS 加载、哈希复核、3D/4D 冒烟均通过");
