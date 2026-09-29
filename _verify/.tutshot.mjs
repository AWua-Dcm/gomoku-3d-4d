// 一次性脚本：把教学三关各截一张图，用来肉眼找显示问题。
// 用完就删 —— 它不是验证，是"看一眼"。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = "file:///" + path.join(HERE, "..", "Web_Gomoku3D", "index.html")
  .replace(/\\/g, "/").replace(/ /g, "%20");
const OUT = path.join(HERE, ".tutshots");
fs.mkdirSync(OUT, { recursive: true });

const CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const CHROME = CANDIDATES.find((p) => fs.existsSync(p));
if (!CHROME) { console.log("没找到浏览器"); process.exit(0); }

const PORT = 9411;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), "gomoku-tut-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  "--no-first-run", "--no-default-browser-check", "--disable-extensions",
  "--window-size=1600,900", "--hide-scrollbars", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function findTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (p) return p;
    } catch (e) { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error("浏览器没起来");
}

let ws, id = 0;
const pending = new Map();
const send = (method, params) => {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  return new Promise((r) => pending.set(mid, r));
};
async function ev(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  if (r.result && r.result.exceptionDetails) {
    throw new Error("求值失败：" + JSON.stringify(r.result.exceptionDetails));
  }
  return r.result && r.result.result ? r.result.result.value : undefined;
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, name + ".png"), Buffer.from(r.result.data, "base64"));
}

const t = await findTarget();
ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: PAGE });
await sleep(3000);
console.log("href=" + await ev("location.href"));
console.log("typeof Game=" + await ev("typeof Game"));

// 进教学
await ev(`(() => { Game.setSetupMode(true); Game.setSetupAi("human"); 1; })()`);
await sleep(200);
await ev(`(() => { Game.startTutorial(); 1; })()`);
await sleep(1200);

for (let i = 0; i < 3; i++) {
  await ev(`(() => { Game.tutorialBuild(${i}); 1; })()`);
  await sleep(900);
  await shot("level-" + (i + 1));
  // 顺便把几何也打出来 —— 有些问题看图看不准
  const geo = await ev(`(() => {
    const R = (id) => { const e = document.getElementById(id); if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
               vis: e.getClientRects().length > 0 }; };
    return JSON.stringify({ bar: R("tutBar"), exit: R("tutExit"), next: R("tutNext"),
      modebar: R("modebar"), hintbox: R("hintbox"), board: R("boardWrap"), timeline: R("timelineWrap"),
      status: R("statusRow"), buttons: R("buttons") });
  })()`);
  console.log("level " + (i + 1) + " " + geo);
}

chrome.kill();
console.log("截图在 " + OUT);
process.exit(0);
