// 生成公开发行版 index.html：默认剥联机；--keep-online 保留联机；--no-tip 再剥打赏。
//
// 规矩：
//   · 源码里联机相关的整块代码用 /* ONLINE-BEGIN */ … /* ONLINE-END */
//     （HTML 用 <!-- ONLINE-BEGIN --> … <!-- ONLINE-END -->）包住；
//   · 打赏相关的整块代码用 /* TIP-BEGIN */ … /* TIP-END */
//     （HTML 用 <!-- TIP-BEGIN --> … <!-- TIP-END -->）包住；
//   · **会员已经整体删除**，不存在 PAY 块；
//   · 默认模式整行删除联机专用 i18n（"online…"、"surrenderBtn"、"exitRoomBtn"、
//     "rematchBtn"）和 `// ---- 联机（P1）` 分节注释 —— 它们都是单行 key-value；
//   · --no-tip 整行删除 `"tip…"` 文案键与 `// ---- 打赏` 分节注释；
//   · 生成后再扫一遍：该剥的符号残留、或该留的符号不见了，都失败。
//
// 用法：
//   node _verify/build-public.mjs                 # 输出 dist-public/index.html（离线公开版）
//   node _verify/build-public.mjs --out _site     # GitHub Pages 用这个
//   node _verify/build-public.mjs --keep-online --out dist-online
//                                                 # 线上部署版：保留联机 + 打赏
//   node _verify/build-public.mjs --keep-online --no-tip
//                                                 # 备案审核版：保留联机、无打赏
//                                                 # （默认输出 dist-online-review）
//   node _verify/build-public.mjs --src path --out path
//
// 【边界】默认模式只保证**产物**里没有联机代码；--keep-online 只保证联机符号仍在。
// 仓库的 git 历史里仍然有联机代码（联机是后来才加的）。要连历史一起清掉，
// 得另开公开仓或重写历史 —— 那是另一个决定，不在这里做。

import fs from "node:fs";
import path from "node:path";

function opt(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const SRC = opt("--src", "Web_Gomoku3D/index.html");
const KEEP_ONLINE = process.argv.includes("--keep-online");
if (KEEP_ONLINE) throw new Error("本工程为无联机开源版，不包含联机构建。");
const NO_TIP = process.argv.includes("--no-tip");
const OUT = opt("--out",
  KEEP_ONLINE ? (NO_TIP ? "dist-online-review" : "dist-online")
              : (NO_TIP ? "dist-public-notip" : "dist-public"));

if (!fs.existsSync(SRC)) {
  console.error("找不到源文件：" + SRC);
  process.exit(2);
}

const lines = fs.readFileSync(SRC, "utf8").split(/\r?\n/);
const kept = [];
let removed = 0;
// 标记块的结构检查：未闭合会让脚本静默吞掉文件后半段，嵌套则说明标记写错了。
// 两种都比"构建成功"更坏，所以宁可当场拒写。
let tipDepth = 0, onlineDepth = 0, skipping = "";

function markerError(msg, lineNo) {
  console.error("致命：" + msg + "（源文件第 " + lineNo + " 行）");
  process.exit(2);
}

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const lineNo = i + 1;

  // 两种标记块分开处理：保留时只删标记行，剥的时候整块跳过。
  const tipMarker = line.match(/TIP-(BEGIN|END)/);
  if (tipMarker) {
    const begin = tipMarker[1] === "BEGIN";
    if (begin) {
      if (tipDepth || skipping) markerError("TIP-BEGIN 嵌套在另一个标记块里", lineNo);
      tipDepth = 1;
      if (NO_TIP) skipping = "TIP";
    } else {
      if (!tipDepth || (skipping && skipping !== "TIP")) markerError("TIP-END 没有对应的 TIP-BEGIN", lineNo);
      tipDepth = 0;
      if (skipping === "TIP") skipping = "";
    }
    removed++;
    continue;
  }

  const onlineMarker = line.match(/ONLINE-(BEGIN|END)/);
  if (onlineMarker) {
    const begin = onlineMarker[1] === "BEGIN";
    if (begin) {
      if (onlineDepth || skipping) markerError("ONLINE-BEGIN 嵌套在另一个标记块里", lineNo);
      onlineDepth = 1;
      if (!KEEP_ONLINE) skipping = "ONLINE";
    } else {
      if (!onlineDepth || (skipping && skipping !== "ONLINE")) markerError("ONLINE-END 没有对应的 ONLINE-BEGIN", lineNo);
      onlineDepth = 0;
      if (skipping === "ONLINE") skipping = "";
    }
    removed++;
    continue;
  }

  if (skipping) { removed++; continue; }

  // 联机专用文案：键名都以 online 开头，另外三颗在线按钮的键单独列出。
  // 这些行都是单行 key-value，整行删不会切断字符串。
  if (!KEEP_ONLINE &&
      (/^\s*"(online|surrenderBtn|exitRoomBtn|rematchBtn)/.test(line) ||
       /联机（P1）/.test(line))) {
    removed++;
    continue;
  }

  // 打赏文案同样是单行 key-value；分节注释也只在完整版里才有意义。
  if (NO_TIP &&
      (/^\s*"tip[A-Z]/.test(line) || /^\s*\/\/ ---- 打赏\s*$/.test(line))) {
    removed++;
    continue;
  }

  kept.push(line);
}

if (tipDepth || onlineDepth) {
  markerError(tipDepth ? "TIP-BEGIN 没有对应的 TIP-END" : "ONLINE-BEGIN 没有对应的 ONLINE-END",
              lines.length);
}

const html = kept.join("\n");

// 生成后自检：任何联机符号残留都失败。**这是这个脚本唯一值得信任的地方。**
const ONLINE_CHECKS = [
  ["ONLINE_READY", /ONLINE_READY/],
  ["ONLINE_CORE_HASH", /ONLINE_CORE_HASH/],
  ["ONLINE_TOKEN_PREFIX", /ONLINE_TOKEN_PREFIX/],
  ["Net.", /\bNet\./],
  ["onlinePanel", /onlinePanel/],
  ["onlineBtn", /onlineBtn/],
  ["onlineSettings", /onlineSettings/],
  ["onlineAsk", /onlineAsk/],
  ["onlineStart", /onlineStart/],
  ["surrenderBtn", /surrenderBtn/],
  ["exitRoomBtn", /exitRoomBtn/],
  ["rematchBtn", /rematchBtn/],
  ["online.* key", /"online\./],
];

// 打赏符号：保留打赏时必须都在；--no-tip 时必须一个都不在。
const TIP_CHECKS = [
  ["tipBtn", /id="tipBtn"|"tipBtn"/],
  ["tipPanel", /id="tipPanel"|"tipPanel"/],
  ["tipClose", /"tipClose"/],
  ["tipTitle", /"tipTitle"/],
  ["tipQrs", /id="tipQrs"/],
  ["tipAfdian", /id="tipAfdian"/],
];

// --no-tip 的反向检查。宁可宽一点：多抓到一处，审核版就少一次意外。
const TIP_ABSENT_CHECKS = [
  ["tipBtn", /\btipBtn\b/],
  ["tipPanel", /\btipPanel\b/],
  ["tipQrs", /\btipQrs\b/],
  ["tipAfdian", /\btipAfdian\b/],
  ["tip 元素/方法", /\btip(?:Card|Head|Body|Title|Intro|Close|Note|Wechat|Alipay|Open)\b/],
  ["tip i18n key", /"tip[A-Z]/],
  ["打赏", /打赏/],
  ["afdian", /afdian/i],
];

// 会员必须彻底消失（源码里已经删了；这条防的是以后合并时又带回来）。
const NO_MEMBER_CHECKS = [
  ["membershipBtn", /membershipBtn/],
  ["memberPanel", /memberPanel/],
  ["memberTitle", /memberTitle/],
  ["memberSoon", /memberSoon/],
  ["memberPlanNote", /memberPlanNote/],
  ["plusPrice", /plusPrice/],
  ["proPrice", /proPrice/],
  ["closeMembership", /closeMembership/],
  ["PAY marker", /PAY-(BEGIN|END)/],
];

const outLines = html.split("\n");
const bad = [];
for (const [name, re] of NO_MEMBER_CHECKS) {
  for (let i = 0; i < outLines.length; i++) {
    if (re.test(outLines[i])) bad.push(name + " @ " + (i + 1) + ": " + outLines[i].trim().slice(0, 140));
  }
}

if (NO_TIP) {
  // 审核版的硬要求：打赏相关的标识、文案、链接一个都不许留。
  for (const [name, re] of TIP_ABSENT_CHECKS) {
    for (let i = 0; i < outLines.length; i++) {
      if (re.test(outLines[i])) bad.push(name + " @ " + (i + 1) + ": " + outLines[i].trim().slice(0, 140));
    }
  }
} else {
  const missingTip = TIP_CHECKS.filter(([, re]) => !re.test(html)).map(([name]) => name);
  if (missingTip.length) bad.push("打赏符号不见了：" + missingTip.join(", "));
}

if (KEEP_ONLINE) {
  const missing = ONLINE_CHECKS.filter(([, re]) => !re.test(html)).map(([name]) => name);
  if (missing.length) bad.push("线上版要求保留联机，但以下符号不见了：" + missing.join(", "));
} else {
  for (const [name, re] of ONLINE_CHECKS) {
    for (let i = 0; i < outLines.length; i++) {
      if (re.test(outLines[i])) bad.push(name + " @ " + (i + 1) + ": " + outLines[i].trim().slice(0, 140));
    }
  }
}

if (bad.length) {
  const label = (KEEP_ONLINE ? "线上版" : "公开版") + (NO_TIP ? "（无打赏）" : "");
  console.error("★ " + label + "自检失败，拒绝写出：");
  console.error(bad.slice(0, 40).join("\n"));
  if (bad.length > 40) console.error("…另有 " + (bad.length - 40) + " 处");
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
const dest = path.join(OUT, "index.html");
fs.writeFileSync(dest, html, "utf8");
const label = (KEEP_ONLINE ? "线上版（保留联机" : "公开版") +
              (NO_TIP ? "，无打赏" : "") + (KEEP_ONLINE ? "）" : "");
console.log(label + "：" + dest + "（源 " + lines.length + " 行，删 " + removed +
            " 行，剩 " + outLines.length + " 行）");
