// 用真实浏览器（无头 Chrome / Edge）打开网页版，验证那些【离线验证不了】的东西：
//
//   1. GLSL 到底能不能编译。桩环境里 getShaderParameter 永远返回真，
//      所以"着色器写得对不对"在 node 里是个盲区 —— 这里让真正的编译器说话。
//   2. 页面有没有控制台报错。
//   3. 布局的实际几何：起始界面和右侧面板会不会互相压住、盖板会不会透出底下的字。
//      这类问题离线桩一个字都查不出来（它没有排版引擎），而它恰恰是最容易出、
//      又最难靠读代码发现的一类。
//   4. 顺带截几张图，人眼确认配色和三维观感。
//
// 【它不是 run-all.sh 的必跑项】：需要本机装了 Chrome 或 Edge，没装就跳过。
// 用法：node _verify/browser-check.mjs [输出目录]
//
// 走 DevTools 协议，Node 22+ 自带的 WebSocket / fetch 就够，**不需要装任何 npm 包**。

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = "file:///" + path.join(HERE, "..", "Web_Gomoku3D", "index.html")
  .replace(/\\/g, "/").replace(/ /g, "%20");
const OUT_DIR = process.argv[2] || path.join(HERE, "shots");

const CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const CHROME = CANDIDATES.find((p) => fs.existsSync(p));
if (!CHROME) {
  console.log("跳过：本机没找到 Chrome / Edge。这一步是可选的，其余检查不受影响。");
  process.exit(0);
}

let passed = 0;
const failures = [];
const check = (ok, name, detail) => {
  if (ok) { passed++; return; }
  failures.push(name + (detail ? "\n      " + detail : ""));
};

fs.mkdirSync(OUT_DIR, { recursive: true });

const PORT = 9401;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), "gomoku-cdp-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  "--no-first-run", "--no-default-browser-check", "--disable-extensions",
  "--window-size=1600,900", "--hide-scrollbars", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = "";
chrome.stderr.on("data", (d) => { chromeErr += d.toString(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch (e) { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error("浏览器没起来。stderr:\n" + chromeErr.slice(0, 600));
}

let ws, id = 0;
const pending = new Map();
const events = [];
const send = (method, params) => {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  return new Promise((r) => pending.set(mid, r));
};
async function ev(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  if (r.result && r.result.exceptionDetails) {
    throw new Error("页面里求值失败：" + r.result.exceptionDetails.text + " " +
      JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || ""));
  }
  return r.result && r.result.result ? r.result.result.value : undefined;
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT_DIR, name + ".png"), Buffer.from(r.result.data, "base64"));
}

function drainConsole() {
  const out = [];
  for (const e of events) {
    if (e.method === "Runtime.consoleAPICalled") {
      out.push(e.params.type + ": " + (e.params.args || [])
        .map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(" "));
    } else if (e.method === "Log.entryAdded") {
      out.push(e.params.entry.level + ": " + e.params.entry.text);
    } else if (e.method === "Runtime.exceptionThrown") {
      const d = e.params.exceptionDetails;
      out.push("exception: " + d.text + " " + ((d.exception && d.exception.description) || ""));
    }
  }
  events.length = 0;
  return out;
}

try {
  const target = await findTarget();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) events.push(msg);
  };
  await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable");
  await send("Page.navigate", { url: PAGE });
  await sleep(2600);

  const consoleOnLoad = drainConsole();
  check(consoleOnLoad.length === 0, "页面加载期间控制台没有输出",
    consoleOnLoad.join("\n      "));

  // ---- 1. WebGL2 与两段着色器
  const gl = await ev(`(() => {
    const gl = Renderer.gl;
    if (!gl) return { ok: false };
    const shaders = [];
    for (const [name, p] of [["stone", Renderer.progStone], ["line", Renderer.progLine]]) {
      for (const s of (gl.getAttachedShaders(p) || [])) {
        shaders.push({ prog: name,
          type: gl.getShaderParameter(s, gl.SHADER_TYPE) === gl.VERTEX_SHADER ? "vertex" : "fragment",
          ok: gl.getShaderParameter(s, gl.COMPILE_STATUS),
          log: (gl.getShaderInfoLog(s) || "").trim() });
      }
      shaders.push({ prog: name, type: "link",
        ok: gl.getProgramParameter(p, gl.LINK_STATUS),
        log: (gl.getProgramInfoLog(p) || "").trim() });
    }
    return { ok: true, version: gl.getParameter(gl.VERSION), shaders: shaders };
  })()`);
  check(gl && gl.ok, "拿得到 WebGL2 上下文", "Renderer.gl 是 null —— 浏览器或驱动不支持");
  if (gl && gl.ok) {
    check(gl.shaders.length === 6, "两段程序共 4 个着色器 + 2 次链接都要查到",
      "实际查到 " + gl.shaders.length + " 项");
    for (const s of gl.shaders) {
      check(s.ok && s.log === "", `${s.prog} 的 ${s.type} 编译/链接通过且无日志`,
        "编译日志：" + s.log);
    }
  }

  // ---- 2. 起始界面：演示盘 + 布局不互相压
  const setup = await ev(`(() => {
    const g = Game;
    const setupEl = document.getElementById("setup");
    const viewEl = document.getElementById("view");
    const panelEl = document.getElementById("panel");
    const r = (el) => { const b = el.getBoundingClientRect();
      return { l: Math.round(b.left), t: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
    return {
      setupOpen: g.setupOpen,
      previewDims: g.previewBoard && g.previewBoard.dims.join("x"),
      previewStones: g.previewBoard && g.previewBoard.stoneCount,
      opq: g.opqCount,
      gridCount: g.staticGridCount,
      setup: r(setupEl), view: r(viewEl), panel: r(panelEl),
      panelVisibility: getComputedStyle(panelEl).visibility,
      setupBg: getComputedStyle(setupEl).backgroundColor,
      viewBgImg: getComputedStyle(viewEl).backgroundImage,
      viewBgAttach: getComputedStyle(viewEl).backgroundAttachment,
      glOpacity: getComputedStyle(document.getElementById("gl")).opacity,
      ruleNote: getComputedStyle(document.getElementById("ruleNote")).display === "none"
        ? "" : document.getElementById("ruleNote").textContent.replace(/\\s+/g, " ").trim(),
      bg: getComputedStyle(document.body).backgroundColor,
      cssBg: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
      docW: document.documentElement.clientWidth,
    };
  })()`);
  check(setup.setupOpen === true, "打开页面时起始界面是打开的");
  check(setup.previewDims === "10x10x10", "左侧演示盘是 10×10×10", "实际 " + setup.previewDims);
  check(setup.previewStones > 0, "演示盘上有棋子");
  check(setup.opq === setup.previewStones, "画出来的实例数等于演示盘的棋子数",
    "opq=" + setup.opq + " 棋子=" + setup.previewStones);
  // 3n²+12 条线段 × 12 个顶点
  const wantGrid = (3 * 100 + 12) * 12;
  check(setup.gridCount === wantGrid, "演示盘的格线顶点数是 (3·10²+12)×12",
    "期望 " + wantGrid + " 实际 " + setup.gridCount);

  // 左右分栏：设置卡片必须【不】盖住左侧画布，且两者拼起来正好是整屏
  check(Math.abs(setup.setup.l - setup.view.w) <= 1,
    "起始界面紧贴在画布右侧（left == #view 的宽度）",
    "setup.left=" + setup.setup.l + " view.width=" + setup.view.w);
  check(setup.setup.w + setup.setup.l === setup.docW,
    "起始界面 + 画布正好铺满整屏", setup.setup.l + "+" + setup.setup.w + " vs " + setup.docW);
  check(setup.panelVisibility === "hidden",
    "起始界面打开时对局面板必须不可见（半透明盖板会让底下的字透上来）",
    "visibility=" + setup.panelVisibility);

  // ---- 2b. "缝没了"的机制本身
  //
  // 【这一条取代的是原来的"起始界面盖板必须是不透明的面板色"。那个要求属于旧设计：
  //   当时 #setup 是一块 --panel 色的不透明盖板，不透明是为了挡住底下 #panel 的字。
  //   现在 #setup 完全不画背景了（左右才会是同一张纸），"不透明"这条自然不再成立 ——
  //   但**它保护的东西一个字都没变**，只是换了守的位置：真正的前提是 #panel 必须隐藏
  //   （就是上面那条断言）。两条必须一起看：任何一条单独都不足以说明"不会透出字"，
  //   而 #setup 一旦不是透明，下面这条会立刻红。】
  check(setup.setupBg === "rgba(0, 0, 0, 0)", "起始界面自己不画任何背景",
    "实际 " + setup.setupBg + " —— 一旦有底色，它就和左边的三维画布不同色，中间重新出现一条竖线");

  // 缝的成因不是色差（画布清屏色和页面底色本来就都是 --bg），而是**纸纹只画在 <body> 上、
  // 被画布盖住了左边 42%**。所以修法是给 #view 补上同一份纸纹。
  // 关键是 background-attachment: fixed —— 它让渐变的定位基准是**整个视口**，
  // 而不是 #view 自己那个 42% 宽的盒子。没有它，同一个 "16% 18%" 会落在
  // 16% × 0.42 ≈ 视口 6.7% 处，而右边是真 16%，两边对不上、缝原样还在。
  // 这两条查的是"缝为什么没了"的机制，不是观感 —— 观感只能靠截图人眼看。
  check(setup.viewBgImg && setup.viewBgImg !== "none",
    "#view 在起始界面下带上了纸纹", "background-image = " + setup.viewBgImg);
  // 注意 background-attachment 是**逐层**返回的：纸纹是 4 个渐变叠出来的，
  // 所以计算值形如 "fixed, fixed, fixed, fixed"，不是单个 "fixed"。
  // 只认第一层是不够的 —— 只要有一层漏成 scroll，那一层的径向就会按 #view 的盒子定位，
  // 在 42% 处露出来。
  const attachLayers = String(setup.viewBgAttach).split(",").map((s) => s.trim());
  check(attachLayers.length > 0 && attachLayers.every((a) => a === "fixed"),
    "#view 的纸纹每一层都以视口为定位基准（background-attachment: fixed）",
    "实际 " + setup.viewBgAttach + "；不是 fixed 的话左右纸纹对不上，42% 处会重新裂出一条缝");

  // 演示棋盘压淡。**必须是 CSS opacity，不能是改调色板或着色器** ——
  // 演示盘和对局盘共用同一个 draw3D() 和同一批着色器，改调色板等于把真棋盘也改淡，
  // 而淡底上白子和底色只有 1.3:1，全靠 --stone-edge 那圈描边才读得出来。
  check(parseFloat(setup.glOpacity) > 0 && parseFloat(setup.glOpacity) < 0.5,
    "起始界面的演示棋盘被压淡（0 < opacity < 0.5）",
    "实际 opacity = " + setup.glOpacity + "（=1 说明淡化没生效；=0 说明棋盘被藏没了）");

  // ---- 2c. 按钮位置在三维/四维之间必须一个像素都不动
  //
  // 【这条只能在真实排版引擎里验】：DOM 桩的 getBoundingClientRect 对所有元素
  // 一律返回 800×600，在桩里这个测试恒真、等于没测。
  //
  // 跳动的两个来源都要被它盖住：
  //   ① 模式相关的三行原来用 display:none 切换，行数一变、居中重排，整列一起跳；
  //   ② #sizeSummary 的文案长度在两种模式间差一倍以上，它下面的东西跟着跳。
  // 切换模式时 setSetupMode 还会把尺寸重置成 15³ / 8³，所以 ② 一定会被触发 ——
  // 这条断言跑的就是它。
  const stable = await ev(`(() => {
    const ids = ["startBtn", "dimCube", "firstBlack", "mode3d", "setup"];
    const snap = () => ids.map(id => {
      const b = document.getElementById(id).getBoundingClientRect();
      return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)];
    });
    Game.setSetupMode(false); const a = snap();
    Game.setSetupMode(true);  const b = snap();
    Game.setSetupMode(false);
    return { ids: ids, a: a, b: b };
  })()`);
  for (let i = 0; i < stable.ids.length; i++) {
    const ra = stable.a[i].join(","), rb = stable.b[i].join(",");
    check(ra === rb, "「" + stable.ids[i] + "」切到四维再切回来，位置和尺寸完全不变",
      "三维 [l,t,w,h]=" + stable.a[i] + "  四维=" + stable.b[i] +
      "（差 = " + stable.a[i].map((v, k) => stable.b[i][k] - v).join(",") + "）");
  }
  // 留一张四维状态的截图。上面那几条只说"没动"，看不出四维到底长什么样 ——
  // 而"四维那一版有没有多出一行、有没有留空槽位"正是这一版最容易出错的地方。
  await ev(`Game.setSetupMode(true)`);
  await shot("5-起始界面-四维模式");
  await ev(`Game.setSetupMode(false)`);

  // 配色真的生效了（CSS 是唯一事实源，但得确认浏览器读到的就是它）
  check(setup.cssBg === "#efe8db", "CSS 变量 --bg 是古风宣纸色", "实际 " + setup.cssBg);
  const rgb = setup.bg.match(/\d+/g).map(Number);
  check(setup.bg === "rgb(239, 232, 219)", "页面底色解析出来就是 #efe8db",
    "实际 " + setup.bg);
  check(rgb[0] > rgb[2], "底色是暖色（R > B）", setup.bg);

  // 规则摘要：读的是【渲染出来的文字】，不是 HTML 源码 —— 能顺带抓到
  // "文字在 HTML 里但被 CSS 藏了 / 被后面的元素盖住了"这类只看源码发现不了的问题。
  for (const needle of ["恰好 5 连", "长连", "13 个"])
    check(setup.ruleNote.indexOf(needle) >= 0, "起始界面的规则摘要里有「" + needle + "」",
      "渲染出来的文字：" + setup.ruleNote);
  // 反方向：开发者向的句子已经删掉了。这条不是洁癖 —— 它保证"删掉"这件事
  // 本身是被验证过的，而且以后谁再加回来会当场红。
  for (const gone of ["RULES_SPEC", "测试向量", "覆盖它"])
    check(setup.ruleNote.indexOf(gone) < 0, "起始界面不该再出现开发者向的「" + gone + "」",
      "渲染出来的文字：" + setup.ruleNote);

  await shot("1-起始界面");

  // ---- 3. 开始游戏 + 长方形棋盘
  const inGame = await ev(`(() => {
    document.getElementById("startBtn").click();
    Game.newGame([8, 12, 30], 1);
    Game.onBoardChanged(true);
    Game.session.place(0, 0, 29); Game.session.place(7, 11, 0);
    Game.onBoardChanged(true);
    Game.setActiveLayer(29);
    Game.el.toast.classList.remove("on");       // 免得截图里留着一条正在淡出的提示
    Game.toastTimer = 0;
    Game.draw3D();
    const b = Game.session.board;
    return { dims: b.dims.join("x"), nx: b.nx, ny: b.ny, nz: b.nz,
             setupOpen: Game.setupOpen, panelVisibility: getComputedStyle(document.getElementById("panel")).visibility,
             opq: Game.opqCount, gh: Game.ghCount, grid: Game.staticGridCount,
             glOpacity: getComputedStyle(document.getElementById("gl")).opacity,
             viewBgImg: getComputedStyle(document.getElementById("view")).backgroundImage };
  })()`);
  check(inGame.setupOpen === false, "点了开始游戏之后起始界面关闭");
  check(inGame.panelVisibility === "visible", "进入对局后右侧面板重新可见");
  // 反向断言：演示态那两条样式必须**完全撤掉**。少了这两条，一个写成
  // `#view { opacity: .3 }`（漏掉 .preview 前缀）的错法就永远不会被发现 ——
  // 它会让**真棋盘**也是淡的，而起始界面那边一切正常，看起来像"对局模式配色就这样"。
  check(inGame.glOpacity === "1", "进入对局后三维视图的不透明度恢复成 1",
    "实际 opacity = " + inGame.glOpacity + "（演示用的压淡漏进对局视图了）");
  check(inGame.viewBgImg === "none", "进入对局后 #view 不再带纸纹",
    "实际 background-image = " + inGame.viewBgImg);
  check(inGame.dims === "8x12x30", "长方体棋盘开起来了", "实际 " + inGame.dims);
  const wantBoxGrid = (8 * 12 + 12 * 30 + 30 * 8 + 12) * 12;
  check(inGame.grid === wantBoxGrid, "8×12×30 的格线顶点数按三条边各算一份",
    "期望 " + wantBoxGrid + " 实际 " + inGame.grid);
  await sleep(500);
  await shot("2-长方体棋盘");

  const consoleAfter = drainConsole();
  check(consoleAfter.length === 0, "交互过程中控制台没有报错", consoleAfter.join("\n      "));

  // ---- 4. 规则全文：按钮位置、正文渲染、Esc 关闭
  const rules = await ev(`(() => {
    const btn = document.getElementById("rulesBtn");
    const st  = document.getElementById("status");
    const r = (el) => { const b = el.getBoundingClientRect();
      return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
    const before = { btn: r(btn), status: r(st), vw: document.documentElement.clientWidth };
    btn.click();
    const body = document.getElementById("rulesBody");
    return {
      before: before,
      open: !document.getElementById("rulesPanel").classList.contains("off"),
      len: body.innerHTML.length,
      html: body.innerHTML,
      text: body.textContent,
      scrollH: body.scrollHeight,
    };
  })()`);

  check(rules.open === true, "点了「具体规则」之后浮层打开");
  // 右上角：贴着视口右边，且不压住状态文字
  check(Math.abs((rules.before.vw - rules.before.btn.r) - 14) <= 2,
    "按钮贴在视口右边 14px 处", "实际右边距 " + (rules.before.vw - rules.before.btn.r));
  check(rules.before.btn.t <= 20, "按钮在顶部", "top=" + rules.before.btn.t);
  const overlap = !(rules.before.btn.l >= rules.before.status.r ||
                    rules.before.btn.r <= rules.before.status.l ||
                    rules.before.btn.b <= rules.before.status.t ||
                    rules.before.btn.t >= rules.before.status.b);
  check(!overlap, "按钮不能和状态文字重叠（对局时它压着「黑棋落子」）",
    JSON.stringify(rules.before.btn) + " vs " + JSON.stringify(rules.before.status));

  // 正文必须真的渲染出来了 —— 只判"浮层打开"是不够的：
  // 内容空着、或者渲染成一堆空标签，浮层照样能打开
  check(rules.len > 5000, "规则正文渲染出来的长度合理", "实际 " + rules.len + " 字符");
  for (const [tag, want] of [["<h2>", "# 标题"], ["<h3>", "## 标题"], ["<table>", "表格"],
                             ["<th>", "表头"], ["<li>", "列表"], ["<code>", "行内 code"],
                             ["<b>", "粗体"]]) {
    check(rules.html.indexOf(tag) >= 0, "正文里有 " + want + "（" + tag + "）");
  }
  // 抽一句规则原文，确认不是"渲染出一堆空壳"
  check(rules.text.indexOf("恰好 5 连") >= 0, "正文里有规则原文（恰好 5 连）");
  check(rules.text.indexOf("长连") >= 0, "正文里有规则原文（长连）");
  check(rules.text.indexOf("四维") >= 0, "正文里有 10 节的四维说明");
  // 表格的行数：RULES_SPEC.md 里 34 行以 | 开头，渲染出来不该是一条都没有
  const trCount = (rules.html.match(/<tr>/g) || []).length;
  check(trCount >= 20, "表格行渲染出来了", "实际 <tr> " + trCount + " 个");

  await shot("4-规则全文");

  const closed = await ev(`(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    return document.getElementById("rulesPanel").classList.contains("off");
  })()`);
  check(closed === true, "按 Esc 能关掉规则浮层");

  await ev(`(() => { Game.openSetup(); Game.previewYaw = 130; return true; })()`);
  await sleep(700);
  await ev(`(() => { Game.el.toast.classList.remove("on"); Game.toastTimer = 0; Game.drawPreview(0.016); return true; })()`);
  await sleep(300);
  await shot("3-起始界面-转到另一面");

  // ---- 5. 窄屏：换行是对的，但不能横向溢出，也不能让按钮又动起来
  //
  // 这一版靠"两条尺寸行叠在同一个网格格子里"来保证高度恒定，前提是
  // **无论哪一条换行、格子高度都取两者的 max**。这个前提只有在窄窗口下才会被检验到 ——
  // 1600×900 下两条尺寸行都不换行，等于没测。所以这里真的把视口压窄。
  await send("Emulation.setDeviceMetricsOverride",
    { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
  const narrow = await ev(`(() => {
    const s = document.getElementById("setup");
    const h = (id) => Math.round(document.getElementById(id).getBoundingClientRect().height);
    const snap = () => {
      const b = document.getElementById("startBtn").getBoundingClientRect();
      return [Math.round(b.left), Math.round(b.top)];
    };
    Game.setSetupMode(false); const a = snap(); const h3 = h("dimsRow3d");
    Game.setSetupMode(true);  const c = snap(); const h4 = h("dimsRow4d");
    Game.setSetupMode(false);
    return { docOver: document.documentElement.scrollWidth - document.documentElement.clientWidth,
             setupOver: s.scrollWidth - s.clientWidth,
             a: a, c: c, h3: h3, h4: h4 };
  })()`);
  check(narrow.docOver <= 1, "窄屏（900×700）下整个页面没有横向滚动",
    "溢出 " + narrow.docOver + "px —— .row 是 wrap 的，溢出只可能来自别处");
  check(narrow.setupOver <= 1, "窄屏下起始界面本身没有横向滚动", "溢出 " + narrow.setupOver + "px");
  // 【反空洞】下面那条断言的全部价值，在于"尺寸行真的换了行、格子高度真的取了 max"。
  // 如果 900px 下根本没换行，那条断言就只是在重复 1600×900 下已经验过的东西 ——
  // 一条永远为真的断言等于没写。这个工程踩过两次假测试的坑，所以这里显式钉住前提。
  check(narrow.h3 > 60, "窄屏（900×700）下三维尺寸行确实换行了（否则下面那条是空断言）",
    "实际高度 " + narrow.h3 + "px。若不再换行，说明窗口不够窄或布局变了，" +
    "需要重新挑一个更窄的宽度来测");
  // 这条才是重点：窄屏下尺寸行会换行，但格子高度取两条的 max，
  // 所以换行的发生与否不能影响"开始游戏"按钮的位置。
  check(narrow.a.join(",") === narrow.c.join(","),
    "窄屏下切到四维，开始游戏按钮的横纵坐标仍然完全不变",
    "三维 [l,t]=" + narrow.a + " 四维=" + narrow.c +
    "（尺寸行高度：三维 " + narrow.h3 + "px / 四维 " + narrow.h4 + "px —— " +
    "这就是换行发生了但按钮没动）");
  await send("Emulation.clearDeviceMetricsOverride");
} catch (e) {
  check(false, "浏览器检查整体跑通", String(e && e.stack || e));
} finally {
  try { ws && ws.close(); } catch (e) {}
  chrome.kill();
  await sleep(300);
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
}

console.log("");
console.log("==================================================");
console.log("  " + passed + " 项通过 / " + failures.length + " 项失败");
console.log("==================================================");
if (failures.length) {
  console.log("");
  for (const f of failures) console.log("FAIL: " + f);
  process.exit(1);
}
console.log("");
console.log("截图在 " + OUT_DIR + "。上面的断言只覆盖「能否编译 / 有没有报错 / 布局几何」，");
console.log("配色好不好看、三维观感、手感，仍然要你自己在浏览器里看这几张图。");
