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

/**
 * 把起始界面那张演示盘钉在一个固定角度，然后才截图。
 *
 * 【为什么必须这么做】演示盘每秒自转 6°（`index.html` 里的 `PREVIEW_DEG_PER_SEC`）。
 * 截图落在哪个相位完全取决于**跑测试时的墙钟时间**，于是每次跑完测试
 * `_verify/shots/` 里的 PNG 都会变脏 —— 视觉上一模一样，字节上差几十个。
 * 后果不是"不好看"，而是 **`git status` 从此永远不可信**：真实改动和自转噪声混在一起。
 * 而 README 恰好嵌了其中一张图，所以这些 PNG 又必须留在版本库里，不能 ignore。
 *
 * 【做法】把 `drawPreview` 包一层，把 `dt` 强制成 0 —— 自转停住。
 * RAF 循环照常跑（所以对局视图的渲染一点没变），因而**不需要"冻住再解开"**，
 * 也就没有顺序依赖：这个函数在任何时刻重复调用都安全。
 *
 * 【为什么不改 `index.html`】为了截图可复现而给产品代码加测试钩子，
 * 是把测试的复杂度转嫁到被测试的东西上。这里纯测试侧就能解决。
 *
 * 【顺带清掉 toast】它是另一个时间相关的元素（会自己淡出），
 * 留着的话截图同样会飘。一起钉住。
 *
 * 【钉住相位还不够】这个函数只保证"同一个页面状态拍出来一样"。页面状态本身若在两次
 * 运行间不同，PNG 照样会漂 —— 实测漂过四千来个抗锯齿像素，全在预览棋盘那块。
 * 所以每张图拍的时机也要一样：要么都在刚加载完的页面上拍，要么拍之前先重载一次。
 * 某张图哪天又开始漂时，先看它是不是在"进过对局"的页面上拍的（见 6-起始界面-英文 那段）。
 */
async function freezePreview(yaw) {
  await ev(`(() => {
    if (!Game.__origDrawPreview) {
      Game.__origDrawPreview = Game.drawPreview;
      Game.drawPreview = function (dt) { return Game.__origDrawPreview.call(this, 0); };
    }
    Game.previewYaw = ${yaw};
    Game.el.toast.classList.remove("on");
    Game.toastTimer = 0;
    Game.drawPreview(0);          // 立刻按这个角度画一帧，不等下一次 RAF
    return Game.previewYaw;
  })()`);
  await sleep(150);               // 等合成器把这一帧真正落到屏幕上
}

/**
 * 扫一遍渲染树，把"可见的叶子文字"里可疑的那些挑出来。在页面里求值，返回数组。
 *
 * 两道筛，对应"漏翻一处"的两种长相：
 *   ① 还是中文 —— 静态文案没进表、或者 JS 现拼的句子写死了中文。
 *   ② 露出键名 —— t() 查不到键时是【把键名原样返回】的（见 index.html 里 t() 的注释），
 *      界面上就会出现 "info.moves.one" 这种东西。它是纯 ASCII，
 *      汉字那一筛看不见它，而它恰恰是最该被发现的一种：说明表和调用点对不上。
 *
 * 【"可见"必须真的判】：三种看不见都要算进来，少一种就是一条假的红，而假的红
 * 比漏报更坏 —— 它会训练人忽略这条断言。
 *   display:none —— 隐藏的往往是【祖先】（#banner / #toast 靠父元素的 class 隐掉），
 *                   而 getComputedStyle(子元素).display 照旧返回它自己的值。
 *                   getClientRects().length 把祖先链上的 display:none 一起算了进去。
 *   opacity:0    —— #toast 是靠它淡出的，盒子还在，要沿祖先链乘才知道真实不透明度。
 *   visibility   —— 它本来就是继承的，computed 拿到的就是生效值。
 */
const SWEEP_EXPR = `(() => {
  // 允许名单：这两处【故意】在英文界面里留汉字。
  //   #langBtn 写的是"点了会变成什么"，英文界面下就该写「中文」；
  //   .seal 是装饰性的古风印章，换成拉丁字母和那圈楷体边框更不搭（见 STATIC_TEXT 的注释）。
  const allow = new Set([document.getElementById("langBtn"), document.querySelector(".seal")]);
  const visible = (el) => {
    if (el.getClientRects().length === 0) return false;
    if (getComputedStyle(el).visibility === "hidden") return false;
    let o = 1;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity);
    return o >= 0.05;
  };
  const out = [];
  for (const el of document.querySelectorAll("*")) {
    if (allow.has(el)) continue;
    if (!document.body.contains(el)) continue;      // <title>/<style> 里的中文不算界面文案
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style") continue;  // #rulesSrc 那份中文正文还在页面上，只是没被选
    if (el.children.length) continue;               // 只看叶子：父元素的 textContent 是子元素的拼接
    if (!visible(el)) continue;
    const t = (el.textContent || "").trim();
    if (!t) continue;
    const where = el.id ? "#" + el.id : tag;
    if (/[\\u4e00-\\u9fff]/.test(t)) out.push({ kind: "cjk", what: where + " = " + JSON.stringify(t.slice(0, 50)) });
    // 【按子串找，不是整串比对】漏翻一条 JS 拼的句子时，键名是混在一句话中间的：
    // #info 会渲染成 "info.moves.one · board 15×15×15 · …"，整串当然不是键名。
    // 只认"整串恰好是键名"的话，这类漏翻正好从缝里漏过去（注入 b 就是这么漏的）。
    // 前后那个 [^A-Za-z0-9_.] 是防误报：句末的 "index.html." 因为后面跟着句点不算，
    // "e.g." 同理 —— 缩写后面那个点被 lookahead 挡掉了。
    else if (/(?:^|[^A-Za-z0-9_.])[a-z][A-Za-z]*(?:\\.[A-Za-z][A-Za-z]*)+(?![A-Za-z0-9_.])/.test(t)) {
      out.push({ kind: "key", what: where + " = " + JSON.stringify(t.slice(0, 80)) });
    }
  }
  return out;
})()`;

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
  await freezePreview(-28);
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

  // -28° 是 `index.html` 里 `previewYaw` 的初值 —— 这张图就是"刚打开时看到的样子"
  await freezePreview(-28);
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

  await ev(`Game.openSetup()`);
  await sleep(700);                 // 等 openSetup 的布局/过渡稳定下来再冻
  // 130° 是刻意挑的：它和 -28° 差得足够远，能看清"转到另一面"之后三维格线的
  // 读感有没有变（这是唯一一张从别的角度看演示盘的图）。
  await freezePreview(130);
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

  // ---- 5b. 窄屏 + 英文：同样不能溢出、按钮同样不能动
  //
  // 【必须在 900×700 下量，不能挪到宽屏去】：英文的每一句都比中文长，横向更容易
  // 溢出；而"按钮不动"这条不变量在英文下的前提是"两条尺寸行都换了行、格子高度取 max"。
  // 在 1600×900 下测英文，两条尺寸行可能根本不换行 —— 那这条就是在重复中文那边
  // 已经验过的东西，等于没测。所以趁着手上的视口还是窄的，立刻把语言切过去量一遍。
  const narrowEn = await ev(`(() => {
    Game.setLang("en");
    const s = document.getElementById("setup");
    const snap = () => {
      const b = document.getElementById("startBtn").getBoundingClientRect();
      return [Math.round(b.left), Math.round(b.top)];
    };
    const h = (id) => Math.round(document.getElementById(id).getBoundingClientRect().height);
    Game.setSetupMode(false); const a = snap(); const h3 = h("dimsRow3d");
    Game.setSetupMode(true);  const c = snap(); const h4 = h("dimsRow4d");
    Game.setSetupMode(false);
    return { docOver: document.documentElement.scrollWidth - document.documentElement.clientWidth,
             setupOver: s.scrollWidth - s.clientWidth,
             a: a, c: c, h3: h3, h4: h4,
             startText: document.getElementById("startBtn").textContent };
  })()`);
  // 先确认真的切过去了 —— 否则下面这几条全在中文界面上量，而中文那边已经绿了
  check(narrowEn.startText === "Start game", "窄屏下切语言真的生效了（未生效的话下面几条是空断言）",
    "#startBtn 上是 " + JSON.stringify(narrowEn.startText));
  check(narrowEn.docOver <= 1, "窄屏（900×700）+ 英文下整个页面没有横向滚动",
    "溢出 " + narrowEn.docOver + "px —— 英文每句都比中文长，这里是它最容易撑破的地方");
  check(narrowEn.setupOver <= 1, "窄屏 + 英文下起始界面本身没有横向滚动", "溢出 " + narrowEn.setupOver + "px");
  check(narrowEn.a.join(",") === narrowEn.c.join(","),
    "窄屏 + 英文下切到四维，开始游戏按钮的横纵坐标仍然完全不变",
    "三维 [l,t]=" + narrowEn.a + " 四维=" + narrowEn.c +
    "（尺寸行高度：三维 " + narrowEn.h3 + "px / 四维 " + narrowEn.h4 + "px）");
  // 【反空洞】和中文那条同一个道理：不换行的话上面那条什么都没测到
  check(narrowEn.h3 > 60, "窄屏 + 英文下三维尺寸行确实换行了（否则上面那条是空断言）",
    "实际高度 " + narrowEn.h3 + "px");

  await send("Emulation.clearDeviceMetricsOverride");

  // ---- 6. 英文界面：语言标记、CSS 真的换了、状态行不压按钮
  const en = await ev(`(() => {
    // 回到起始界面，这样 #status / #topRight 那对比的是对局中的右上角
    Game.openSetup();
    Game.setLang("en");
    const root = document.documentElement;
    const rowLabel = document.querySelector(".rowLabel");
    const coolNote = document.getElementById("coolNote");
    const btn = document.getElementById("rulesBtn");
    const st  = document.getElementById("status");
    const r = (el) => { const b = el.getBoundingClientRect();
      return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
    Game.closeRules();
    // 【"英文排版那一段 CSS 真的生效了"的证据】原来查的是 .rowLabel 的计算宽度 == 138px
    // （中文 96px）。行标改成【贴合自己的文字】之后那个数不再是常量，所以改成查字体：
    // 字体栈正是 html.lang-en body 那一条设的，而且这里把中文那一侧也量一遍、
    // 拿两者【必须不同】当判据 —— 只查类名的话，选择器写错成 html[lang="en"] 照样绿。
    const fam = () => getComputedStyle(rowLabel).fontFamily.split(",")[0].trim();
    const enFam = fam();
    Game.setLang("zh"); const zhFam = fam();
    Game.setLang("en");
    // 行标宽度：不再写死，所以它必须随文字长短变 —— 中英都是"Mode 比 Rotation cooldown 短"，
    // 两个都相等反而说明宽度还在被某个固定值支配。
    const wOf = (id) => Math.round(document.getElementById(id).getBoundingClientRect().width);
    return {
      lang: root.lang,
      cls: root.className,
      fontEn: enFam, fontZh: zhFam,
      labelWMode: wOf("rowLabelMode"), labelWCool: wOf("rowLabelCool"),
      // 每个行标占几个行盒。Range.getClientRects() 换行就多一个矩形，比拿高度除行高可靠
      // （line-height 可能是 normal，除出来是 NaN）。英文行标比中文长得多，
      // "Rotation cooldown" 就是会顶不住的典型。
      labelLines: [...document.querySelectorAll(".rowLabel")].map((el) => {
        const rg = document.createRange();
        rg.selectNodeContents(el);
        return { id: el.id, lines: rg.getClientRects().length, text: el.textContent };
      }),
      coolNoteW: Math.round(coolNote.getBoundingClientRect().width),
      ruleNote: document.getElementById("ruleNote").textContent.replace(/\\s+/g, " ").trim(),
      hintText: document.getElementById("hint").textContent.replace(/\\s+/g, " ").trim(),
      btn: r(btn), status: r(st),
      titleText: document.getElementById("setupTitle").textContent,
      // 中文那份规则正文此时【还在页面上】，只是没被选择 —— 顺带确认没被删掉
      zhRulesLen: (document.getElementById("rulesSrc").textContent || "").length,
      enRulesLen: (document.getElementById("rulesSrcEn").textContent || "").length,
    };
  })()`);

  check(en.lang === "en", "切到英文后 documentElement.lang 是 en（屏幕阅读器要认这个）",
    "实际 " + JSON.stringify(en.lang));
  check((" " + en.cls + " ").indexOf(" lang-en ") >= 0,
    "切到英文后 html 上有 .lang-en —— 英文排版那一段 CSS 靠它生效",
    "实际 class=" + JSON.stringify(en.cls));
  // 这一条查的是"CSS 覆盖真的生效了"，不是"类名挂上了"：html.lang-en body 那条把字体
  // 从中文栈切成拉丁 UI 字体栈。只查类名的话，选择器写错（比如还是 html[lang="en"]）照样绿。
  check(en.fontEn !== en.fontZh && en.fontEn === "system-ui",
    "英文排版生效：行标的字体栈切到了拉丁 UI 字体（中文那一侧不是）",
    "英文 " + JSON.stringify(en.fontEn) + " vs 中文 " + JSON.stringify(en.fontZh));
  // 行标宽度不再写死（曾经英文 138 / 中文 96，对每一行都生效）—— "Mode" 白占 100px，
  // 把英文的模式行撑到折行。现在它贴合自己的文字，所以同一个界面里两个行标就不该等宽。
  check(en.labelWMode > 0 && en.labelWMode < en.labelWCool,
    "行标宽度贴合自己的文字（不再是一个对所有行都生效的固定值）",
    "Mode=" + en.labelWMode + "px, Rotation cooldown=" + en.labelWCool + "px");
  check(en.coolNoteW > 0, "冷却说明行在英文下量得到宽度", "实际 " + en.coolNoteW);
  // 行标必须都只占一行。折行的后果不是"难看"那么轻：行表把三条尺寸输入框对齐在一条竖线上，
  // 行标一折，"转动冷却"那一行就比别的行高一截，整块面板的节奏全乱。
  // 这跟"切模式时按钮不动"是同一条链上的东西 —— 那一列宽度是常量，靠的就是行标不折行。
  check(en.labelLines.every((x) => x.lines <= 1),
    "英文的行标都排得下一行（宽度够，没有折行）",
    en.labelLines.filter((x) => x.lines > 1)
      .map((x) => x.id + " = " + JSON.stringify(x.text) + " 占了 " + x.lines + " 行").join("；"));
  check(en.titleText === "3D Gomoku", "起始界面标题是英文", "实际 " + JSON.stringify(en.titleText));

  // 规则摘要读的是【渲染出来的文字】，和中文那几条同一个套路。
  // 光查"切了语言"是不够的：data-i18n-html 那条通路（走 innerHTML 而不是 textContent）
  // 只有这一处断言能验到，中文那三条验的是另一个方向。
  for (const needle of ["exactly five", "overline", "13 winning directions"])
    check(en.ruleNote.indexOf(needle) >= 0, "英文起始界面的规则摘要里有「" + needle + "」",
      "渲染出来的文字：" + en.ruleNote);
  check(/[一-鿿]/.test(en.ruleNote) === false, "英文规则摘要里没有汉字", en.ruleNote);
  check(en.hintText.indexOf("Drag to rotate") >= 0, "英文操作提示也换了（同样是 data-i18n-html）",
    "渲染出来的文字：" + en.hintText);

  // 两份规则正文都还在页面上，只是按语言选一份用
  check(en.zhRulesLen > 3000 && en.enRulesLen > 3000,
    "中英两份规则正文都还嵌在页面里",
    "中文 " + en.zhRulesLen + " 字符 / 英文 " + en.enRulesLen + " 字符");

  // 右上角：英文的按钮更宽，状态行留白是【实测】算出来的 ——
  // 算漏了的表现就是按钮压住状态文字，而那种重叠只有真排版引擎量得出来
  const overlapEn = !(en.btn.l >= en.status.r || en.btn.r <= en.status.l ||
                      en.btn.b <= en.status.t || en.btn.t >= en.status.b);
  check(!overlapEn, "英文下右上角按钮不压状态文字",
    JSON.stringify(en.btn) + " vs " + JSON.stringify(en.status));

  // 切语言这条路径上任何一句 console.warn 都会让这条红。localStorage 在 file:// 下
  // 可能抛 SecurityError，storeGet/storeSet 必须安静降级 —— 这就是验它的地方。
  const consoleEn = drainConsole();
  check(consoleEn.length === 0, "切到英文、开合浮层的过程中控制台没有输出",
    consoleEn.join("\n      "));

  // 英文规则浮层：切语言后必须重渲染，而且渲染出来的得是英文
  const enRules = await ev(`(() => {
    document.getElementById("rulesBtn").click();
    const body = document.getElementById("rulesBody");
    const out = { text: body.textContent.replace(/\\s+/g, " ").trim(),
                  hasZh: /[\\u4e00-\\u9fff]/.test(body.textContent),
                  len: body.innerHTML.length };
    document.getElementById("rulesClose").click();
    return out;
  })()`);
  check(enRules.text.indexOf("Winning directions") >= 0, "英文下规则浮层渲染的是英文正文",
    "开头：" + enRules.text.slice(0, 80));
  check(!enRules.hasZh, "英文规则浮层里没有汉字（有的话是取到了 #rulesSrc）",
    "开头：" + enRules.text.slice(0, 80));
  check(enRules.len > 5000, "英文规则正文渲染出来的长度合理", "实际 " + enRules.len + " 字符");

  // ---- 6b. 英文界面逐屏扫一遍：不许剩中文，也不许露出键名
  //
  // 【为什么值得单独扫一遍】这一版写完之后，界面上仍然留着两处中文：
  // #dimRange 的"可填"和 #coolNote 的"四维模式才有" —— 它们是 JS 现拼的句子
  // （值从 BoardLimits 算出来），既不在 HTML 里、也不经过任何一张表，
  // 所以"源码扫描"和"表里有没有这个键"两类检查都看不见它们。
  // **是靠英文截图用眼睛发现的。** 眼睛不能每次都用，所以这里把它变成断言：
  // 切到英文，把整棵渲染树扫一遍，凡是可见的叶子文字都要过下面两道筛。
  //
  // 这一条能抓到的是整个类别 —— 以后任何人加一句硬编码的界面文案，
  // 只要它出现在英文界面上，这里就红，不需要谁记得去更新什么清单。
  //
  // 【必须逐屏扫，不能只扫起始界面】：起始界面上根本看不到 #modeGhost / #modeSlice
  // （那两个按钮只在对局里显示）、看不到转动面板、看不到状态行 —— 只扫起始界面的话，
  // 漏翻一个"幽灵层"按钮在这里是隐形的。注入验证第一次就漏了这一条。
  const sweep = (async (screen) => {
    const bad = await ev(SWEEP_EXPR);
    check(bad.length === 0,
      "英文界面上（" + screen + "）没有一处可见文字是中文或键名",
      "还有 " + bad.length + " 处：\n      " + bad.map((b) => b.what).join("\n      "));
  });

  await sweep("起始界面");

  // 起始界面切到四维，再扫一遍。#dimsSlot 是把三维行和四维行叠在同一个格子里，
  // 【每次只显示一条】，所以上面那一遍只扫到了三维那条 —— #dimRange4d 的"必须立方"
  // 和 #coolNote 的冷却说明都还是隐形的。它们恰好也都是 JS 现拼的句子。
  const en4d = await ev(`(() => {
    Game.setSetupMode(true);
    const sum = () => document.getElementById("sizeSummary").textContent;
    // 「每 N 手可转动一层」这句在【两个地方】各写了一遍：起始界面的小结走文案表
    // （setup.fourD.everyOne / everyMany），游戏里的 #rule 走内核（RuleSet.describe）。
    // 两处都得钉 —— 单复数各钉一次，写错哪一处这里都会红。
    // 界面上选不到冷却 1（按钮是 3/5/8/10），所以"every 1 moves"这种错自己不会露头。
    Game.setSetupCool(5);
    const many = sum();
    Game.setSetupCool(1);
    const one = sum();
    // #rule 那条路：冷却是在开局那一刻拷进 rules 的，改完冷却得重新开局才看得见。
    Game.newGame([15, 15, 15], 1);
    const rule1 = document.getElementById("rule").textContent;
    Game.setSetupCool(5);
    Game.newGame([15, 15, 15], 1);
    const rule5 = document.getElementById("rule").textContent;
    return { fourD: Game.fourD, note: document.getElementById("coolNote").textContent,
             many: many, one: one, rule1: rule1, rule5: rule5 };
  })()`);
  check(en4d.fourD === true && en4d.note === "A rotation uses up the whole turn",
    "起始界面已经切到四维，下面那一遍扫的是四维的尺寸行",
    JSON.stringify(en4d));
  check(en4d.many.indexOf("every 5 moves you may rotate one layer") >= 0 &&
        en4d.one.indexOf("every move you may rotate one layer") >= 0 &&
        en4d.one.indexOf("every 1 moves") < 0,
    "起始界面小结里的「每 N 手可转动一层」按单复数换了形",
    JSON.stringify({ many: en4d.many, one: en4d.one }));
  check(en4d.rule5.indexOf("every 5 moves you may rotate one layer") >= 0 &&
        en4d.rule1.indexOf("every move you may rotate one layer") >= 0 &&
        en4d.rule1.indexOf("every 1 moves") < 0,
    "内核那一份（游戏里的规则行）也按单复数换了形",
    JSON.stringify({ rule1: en4d.rule1, rule5: en4d.rule5 }));
  await sweep("起始界面·四维");

  // 进对局：这一步把状态行、信息行、坐标行、层号、幽灵层/切片按钮、
  // 转动面板全都变成可见的，然后重新扫一遍。
  const enPlay = await ev(`(() => {
    Game.setSetupMode(true);                    // 四维：转动面板那一片也会显示出来
    document.getElementById("startBtn").click();
    Game.session.place(0, 0, 0);
    Game.session.place(1, 1, 1);
    Game.session.rotateBy(0, 3, true, 1);       // 转一次，把 #rotStatus 的文案也逼出来
    Game.onBoardChanged(true);
    Game.setActiveLayer(3);
    Game.setHover([2, 3, 3]);
    Game.el.toast.classList.remove("on");       // 提示是按时淡出的，留着会飘
    Game.toastTimer = 0;
    Game.draw3D();
    return { fourD: Game.fourD, setupOpen: Game.setupOpen,
             rotVisible: getComputedStyle(document.getElementById("rotPanel")).visibility };
  })()`);
  check(enPlay.setupOpen === false && enPlay.fourD === true,
    "英文对局开起来了（四维），下面那一遍扫的是对局界面",
    JSON.stringify(enPlay));

  await sweep("对局界面·四维");

  // 再来一遍对局界面，这次只落 1 手、只转 1 次 —— 专为【单数形态】走一遍。
  // 上面那遍走了 2 手，英文表里被用到的全是复数键（info.moves.many），
  // 单数键（info.moves.one / info.rotations.one）一次都没露过面：把它们从英文表里
  // 删掉，界面上什么都不会变，扫描也就什么都扫不到（注入 b 就是这么漏的）。
  // 而英文的单复数正是最容易"只对了一半"的地方 —— 两条都写着，错一条另一条照样好看。
  const enOne = await ev(`(() => {
    // 冷却默认 5 手，落第 1 手就转会被拒（"还要再落 4 子才能转动"）——
    // 拒了的话 info.rotations.* 这一整段根本不会渲染，上面那个"单数键露过面"
    // 的前提就不成立，后面那一遍扫描也就成了空扫。所以先把冷却调成 1。
    Game.setSetupCool(1);
    Game.newGame([15, 15, 15], 1);
    Game.session.place(0, 0, 0);
    // 转【棋子所在的那一层】：空层会被拒（"该层是空的，转动不改变任何东西"），
    // 拒了同样拿不到 info.rotations.* 那段文案。
    const o = Game.session.rotateBy(0, 0, true, 1);
    Game.onBoardChanged(true);
    Game.el.toast.classList.remove("on");
    Game.toastTimer = 0;
    return { info: document.getElementById("info").textContent,
             moves: Game.session.moveCount, rots: Game.session.rotationCount,
             fourD: Game.fourD, rotStatus: o.status, rotReason: o.reason };
  })()`);
  check(enOne.moves === 1 && enOne.rots === 1 &&
        enOne.info.indexOf("1 move played") === 0 && enOne.info.indexOf(" · 1 rotation") > 0,
    "单数文案（第 1 手 / 第 1 次转动）真的渲染出来了，下面那一遍扫得到它",
    JSON.stringify(enOne));
  await sweep("对局界面·单数");

  // 终局横幅也扫一遍。它是【唯一】一处 white-space: pre-line 的文案，
  // 中英文都在对应位置放了 \\n —— 漏翻的话这里会显示中文。
  const enOver = await ev(`(() => {
    Game.newGame([15, 15, 15], 1);            // 黑先
    const P = Game.session;
    // 【长连只能靠"一手把两段接起来"造出来】—— 按规则第 5.2 节，先手连到第 5 颗
    // 就已经赢了、棋局当场结束，根本走不到第 6 颗。所以黑先摆 0,1,2 和 4,5 两段，
    // 再落 3 把它们接成 6 连。白棋摆在 0,2,4,6,8 上，隔着落、自己连不成 5 颗。
    const black = [0, 1, 2, 4, 5, 3];
    for (let i = 0; i < black.length; i++) {
      P.place(black[i], 0, 0);                // 轮到黑
      if (i < black.length - 1) P.place(i * 2, 8, 8);   // 轮到白，最后一步黑直接终局
    }
    Game.onBoardChanged(true);
    Game.showBanner();
    Game.el.toast.classList.remove("on");
    Game.toastTimer = 0;
    return { title: document.getElementById("bannerTitle").textContent,
             sub: document.getElementById("bannerSub").textContent,
             run: P.lastOutcome.longestRun,
             overline: P.lastOutcome.status === MoveStatus.LoseByOverline,
             on: document.getElementById("banner").classList.contains("on") };
  })()`);
  check(enOver.overline === true && enOver.run === 6,
    "构造出来的确实是一次长连终局（否则下面那两条是空断言）",
    JSON.stringify(enOver));
  check(enOver.on === true, "终局横幅显示出来了", JSON.stringify(enOver));
  await sweep("终局横幅");

  // 顺手把横幅本身也断言掉：它是 JS 写的、不挂 data-i18n，扫一遍只能说明"不是中文"，
  // 说明不了"是那句该有的英文"。长连犯规这句还带一个数字，两件事一起钉。
  check(enOver.title.indexOf("Overline") >= 0 && enOver.title.indexOf("6") >= 0,
    "英文终局横幅写的是长连犯规并带上了连子数",
    "实际 " + JSON.stringify(enOver.title));
  check(enOver.sub === "The first player must make exactly 5 in a row",
    "英文终局横幅的副标题跟着换了", "实际 " + JSON.stringify(enOver.sub));

  // 回起始界面，后面那几条模式按钮的断言都按"设置页开着"的样子来。
  // 【冷却调回默认 5】上面为了逼出单数文案把它设成了 1，留着的话那一屏会写着
  // "every 1 moves"，而界面上根本选不出这个值。
  // 【模式调回三维】这样下面那条"高亮的按钮和当前模式一致"断的是三维那一侧，
  // 加上上面四维那一侧，两个方向都走过。模式不调回去也行，但页面会停在一个
  // 谁都到不了的组合上（冷却 1 + 四维），后面再往这段里加断言的人会被它绊一下。
  await ev(`Game.setSetupCool(5); Game.setSetupMode(false); Game.openSetup()`);
  await sleep(400);

  // 模式按钮：选中的那个必须就是当前模式，英文标签也不能左右对调。
  //
  // 【为什么扫描扫不出来】：中文那版是「三维 · 经典 / 四维 · 可转层」，一眼能认出
  // 哪个对哪个；英文那版是「3D · Classic / 4D · Rotatable」，两条都是一句地道的英文，
  // 表里把两句话写反了，扫描照样全绿 —— 它只知道"不是中文"，不知道"贴错了按钮"。
  // 而这一屏是有对照物的：四维才有的"must be cubic"和转动冷却就在它下面一行。
  //
  // 光看类名不够（.sel 在不在，是代码自己说的），所以连背景色一起量：
  // button.sel 的底色是 --accent，和未选中的那个必须真的不一样 ——
  // 否则"选中"只存在于类名里，屏幕上看不出来。
  const enMode = await ev(`(() => {
    const lum = (el) => {
      const m = getComputedStyle(el).backgroundColor.match(/[\\d.]+/g) || [];
      return (+m[0]) * 0.299 + (+m[1]) * 0.587 + (+m[2]) * 0.114;
    };
    const a = document.getElementById("mode3d"), b = document.getElementById("mode4d");
    return { fourD: Game.fourD,
             sel3d: a.classList.contains("sel"), sel4d: b.classList.contains("sel"),
             label3d: a.textContent, label4d: b.textContent,
             l3: Math.round(lum(a)), l4: Math.round(lum(b)) };
  })()`);
  check(enMode.label3d === "3D · Classic" && enMode.label4d === "4D · Rotatable",
    "英文的模式按钮标签没有左右对调", JSON.stringify(enMode));
  check(enMode.sel4d === enMode.fourD && enMode.sel3d === !enMode.fourD,
    "高亮的模式按钮和当前模式一致", JSON.stringify(enMode));
  check(enMode.sel4d ? enMode.l4 < enMode.l3 - 40 : enMode.l3 < enMode.l4 - 40,
    "选中的模式按钮底色明显更深（选中在屏幕上真的看得出来）", JSON.stringify(enMode));

  // 英文截图。**必须走 freezePreview()**：演示盘每秒自转 6°，不钉住的话
  // 每次跑测试这张 PNG 都会变脏，真实改动和自转噪声就混在一起了。
  //
  // 【为什么拍之前要重新加载一次】上面那一串检查把页面留在"刚打完一局"的状态里，
  // 而 1..5 那几张都是**刚加载完**的页面上拍的。实测：同一次运行内连拍四张逐字节相同
  // （所以不是有动画在跑），但两次运行之间预览棋盘那块会差出四千来个抗锯齿像素 ——
  // 进过对局的画布和刚加载的画布，收尾状态不是一个东西。重载之后 EN 这张和中文那张
  // 就是同一个起点，两张摆在一起能直接比。
  //
  // 顺带钉住一件本来就该验的事：语言选择存在 localStorage 里，重载之后必须还是英文。
  await send("Page.navigate", { url: PAGE });
  await sleep(2600);
  const afterReload = await ev(`({
    lang: Game.lang,
    domLang: document.documentElement.lang,
    cls: document.documentElement.className,
    title: document.getElementById("setupTitle").textContent,
    setupOpen: Game.setupOpen,
    fourD: Game.fourD,
    cool: Game.setupCool,
    dims: Game.setupDims.join("×"),
    label3d: (document.getElementById("mode3d") || {}).textContent
  })`);
  check(afterReload.lang === "en" && afterReload.domLang === "en" &&
        (" " + afterReload.cls + " ").indexOf(" lang-en ") >= 0 &&
        afterReload.title === "3D Gomoku",
    "重载之后界面还是英文（语言选择存在 localStorage 里，不是只活在内存里）",
    JSON.stringify(afterReload));
  check(afterReload.setupOpen === true && afterReload.fourD === false &&
        afterReload.cool === 5 && afterReload.dims === "15×15×15",
    "重载之后停在默认的起始界面（三维、冷却 5、15³）—— 和 1-起始界面.png 中文那张同状态",
    JSON.stringify(afterReload));

  await freezePreview(-28);
  await shot("6-起始界面-英文");

  // 切回中文再收尾：后面没有别的断言了，但让页面停在默认状态，
  // 免得下次有人在这段后面接着写断言时，捡到一个英文界面。
  await ev(`Game.setLang("zh")`);

  // ---- 7. 游玩界面：格线开关 / 终局横幅的关闭与拖动 / 相机夹取
  //
  // 这一节全是"只有真浏览器答得了"的问题：transform 叠加有没有被 CSS 吃掉、
  // 拖完之后矩形到底落在哪、开关有没有真的重画。node 桩里没有排版引擎，
  // getBoundingClientRect 是个写死的 {0,0,800,600}，一个字都验不出来。
  await ev(`(() => { Game.closeSetup(); Game.newGame([15, 15, 15], 1); return 1; })()`);

  // ---- 7a. 格线开关：状态位 + 计数 + **画布上真的少了一大片墨**
  //
  // 【为什么数像素，而不是"比两次截图的字节"】一开始用的是 Page.captureScreenshot
  // 两次、断言 base64 不相等。那是**假阳性断言**：这个页面的抗锯齿本身就在抖
  // （`freezePreview` 的注释里写着"实测漂过四千来个抗锯齿像素"），所以不相等几乎必然成立，
  // 跟格线关没关没关系。要证明"画面真的变了"，只能量**变了多少**。
  //
  // 数像素走 gl.readPixels，不走截图，有两个好处：
  //   · `Game.draw3D()` 和 `readPixels` 在**同一个任务**里，合成器还没参与，
  //     拿到的是刚画出来的那一帧，不受抗锯齿抖动影响 —— 同一状态重复量是同一个数；
  //   · 顺便能量到"还剩多少墨"，于是"只隐藏静态灰网、蓝框要留着"这条产品选择
  //     可以在**像素层面**钉住，而不只是钉一个状态位。
  const gOn = await ev(`(() => {
    Game.setGridVisible(true);
    Game.el.toast.classList.remove("on"); Game.toastTimer = 0;
    return { n: Game.staticGridCount, v: Game.gridVisible, sel: Game.el.modeGrid.classList.contains("sel") };
  })()`);
  const ink = await ev(`(() => {
    const ctx = document.getElementById("gl").getContext("webgl2");
    const measure = () => {
      Game.draw3D();                       // 同一个任务里画完就读，别等合成器
      const w = ctx.drawingBufferWidth, h = ctx.drawingBufferHeight;
      const a = new Uint8Array(w * h * 4);
      ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, a);
      const bg = [a[0], a[1], a[2]];       // 左下角那一点当背景色（清屏色就是 --bg）
      let n = 0;
      for (let i = 0; i < a.length; i += 4)
        if (Math.abs(a[i]-bg[0]) + Math.abs(a[i+1]-bg[1]) + Math.abs(a[i+2]-bg[2]) > 8) n++;
      return n;
    };
    const total = ctx.drawingBufferWidth * ctx.drawingBufferHeight;
    const on = measure();
    Game.setGridVisible(false);
    const off = measure();
    // 状态必须在**恢复之前**读 —— 放在 setGridVisible(true) 后面读到的就是恢复后的值，
    // 那样这条断言会永远看到 v:true（这是我自己第一版踩的坑）。
    const gOff = { n: Game.staticGridCount, v: Game.gridVisible,
                   sel: Game.el.modeGrid.classList.contains("sel") };
    Game.setGridVisible(true);
    return { total: total, on: on, off: off, offState: gOff };
  })()`);
  const wantSeg = (3 * 15 * 15 + 12) * 12;
  check(gOn.v === true && gOn.n === wantSeg && gOn.sel === true &&
        ink.offState.v === false && ink.offState.n === wantSeg && ink.offState.sel === false,
    "格线开关：状态位翻转、按钮 sel 跟着掉，而 staticGridCount 原样不动（只闸 draw 不闸 upload）",
    JSON.stringify(gOn) + " → " + JSON.stringify(ink.offState) + "，期望 " + wantSeg);
  // 先确认这次测量本身有效 —— 否则下面那条比例断言会因为"两边都是 0"而假通过。
  // 15³ 满格线时实测约 24.7 万像素有墨（总 53 万），这里只要求"明显有东西"。
  check(ink.on > 50000,
    "前置：开着格线时画布上确实有大量墨（测量本身有效，不是读回一片空白）",
    "ink=" + ink.on + " / total=" + ink.total);
  // 真正的断言：关掉格线要能去掉绝大部分墨。实测 24.7 万 → 2.9 万（5.4%）。
  // 阈值放到 40% 是留余量 —— 这条要抓的是"开关根本没接到绘制上"（那样两边一样多），
  // 不是去卡一个精确比例。
  check(ink.off < ink.on * 0.4,
    "关掉格线之后画布上的墨确实大幅减少（开关真的接到了绘制上，不只是翻了个状态位）",
    "ink " + ink.on + " → " + ink.off + "（" + (100 * ink.off / ink.on).toFixed(1) + "%）");
  // 而剩下的那部分不能是零：蓝色当前层框、悬停线、落点光标、获胜连线都是要留着的。
  // 「只隐藏静态灰网」这个选择在像素层面被钉在这里 —— 以后有人顺手把 active 也关掉，这条会红。
  check(ink.off > 5000,
    "关掉格线后不是一片空白：当前层蓝框还在画（钉住'只隐藏静态灰网'这个产品选择）",
    "ink=" + ink.off);

  // ---- 7b. 终局横幅：可关、可拖、拖不出 #view
  const ban = await ev(`(() => {
    Game.newGame([15, 15, 15], 1);
    const P = Game.session;
    for (let i = 0; i < 5; i++) { P.place(i, 0, 0); if (i < 4) P.place(i * 2, 8, 8); }
    Game.onBoardChanged(true); Game.showBanner();
    Game.el.toast.classList.remove("on"); Game.toastTimer = 0;

    const b = document.getElementById("banner"), v = document.getElementById("view");
    const close = document.getElementById("bannerClose");
    const r0 = b.getBoundingClientRect(), c = close.getBoundingClientRect();
    const vr = v.getBoundingClientRect();
    // 用**真的 PointerEvent**驱动，不走合成函数：这一节要验的正是
    // "指针事件 + transform 叠加在真浏览器里到底对不对"，绕开事件系统就白测了。
    const mk = (x, y) => new PointerEvent("pointerdown", { bubbles: true, cancelable: true,
      pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y });
    const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    b.dispatchEvent(mk(cx, cy));
    window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true,
      pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1,
      clientX: cx + 60, clientY: cy + 40 }));
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true,
      pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 0,
      clientX: cx + 60, clientY: cy + 40 }));
    const r1 = b.getBoundingClientRect();

    // 再往死里拖一次，看夹取
    b.dispatchEvent(mk(cx + 60, cy + 40));
    window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true,
      pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1,
      clientX: cx + 9000, clientY: cy + 9000 }));
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true,
      pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 0,
      clientX: cx + 9000, clientY: cy + 9000 }));
    const r2 = b.getBoundingClientRect();

    return {
      dx: r1.left - r0.left, dy: r1.top - r0.top,
      inside: r2.left >= vr.left - 0.5 && r2.right <= vr.right + 0.5 &&
              r2.top >= vr.top - 0.5 && r2.bottom <= vr.bottom + 0.5,
      r2: { l: r2.left, t: r2.top, r: r2.right, b: r2.bottom },
      vr: { l: vr.left, t: vr.top, r: vr.right, b: vr.bottom },
      // 关闭按钮必须落在横幅里面（它原来是绝对定位钉右上角的，钉歪了会飘到棋盘上）
      closeInside: c.left >= r0.left - 0.5 && c.right <= r0.right + 0.5 &&
                   c.top >= r0.top - 0.5 && c.bottom <= r0.bottom + 0.5,
      on: b.classList.contains("on"),
      tf: b.style.transform,
    };
  })()`);
  // 位移必须**等于**鼠标位移。这里最容易错的就是 transform 叠加写漏一半 ——
  // 那样 CSS 里居中的 translate(-50%,-50%) 会被覆盖，横幅瞬间跳到右下角，
  // 表现是"一拖就飞走"。差值断言正好抓住它。
  check(Math.abs(ban.dx - 60) <= 1 && Math.abs(ban.dy - 40) <= 1,
    "横幅拖动跟手：位移等于鼠标位移（transform 叠加写对了，没把居中吃掉）",
    "实际位移 (" + ban.dx.toFixed(1) + "," + ban.dy.toFixed(1) + ")，期望 (60,40)；transform=" + JSON.stringify(ban.tf));
  check(ban.inside,
    "横幅拖到超界时被夹在 #view 里（#view 是 overflow:hidden，拖出去就永久够不着）",
    JSON.stringify(ban.r2) + " vs #view " + JSON.stringify(ban.vr));
  check(ban.closeInside, "关闭按钮落在横幅框内（绝对定位没钉歪）", JSON.stringify(ban.r2));
  check(ban.on === true, "前置：拖动不该把横幅关掉");

  // ---- 7c. 关掉横幅之后：仍然不能落子，悔棋之后才能继续
  const afterClose = await ev(`(() => {
    const before = Game.session.moveCount;
    document.getElementById("bannerClose").click();
    const hidden = !document.getElementById("banner").classList.contains("on");
    const st = Game.session.status;
    // 点棋盘正中：终局之后必须落不下
    const gl = document.getElementById("gl"), r = gl.getBoundingClientRect();
    Game.tryPlace(7, 7);
    const placed = Game.session.moveCount !== before;
    const toast = document.getElementById("toast").textContent;
    Game.undo();
    const resumed = Game.session.status;
    return { hidden: hidden, status: st, placed: placed, toast: toast, resumed: resumed };
  })()`);
  check(afterClose.hidden === true, "点关闭之后横幅真的消失了（真浏览器的 class + display）");
  check(afterClose.status === "Decided" && afterClose.placed === false,
    "关掉横幅不改变棋局：状态仍是 Decided，落子落不下",
    JSON.stringify(afterClose));
  check(afterClose.toast.indexOf("本局已结束") >= 0,
    "终局后点棋盘有可读提示（原来是静默吞掉，看起来像页面卡了）",
    "实际 " + JSON.stringify(afterClose.toast));
  check(afterClose.resumed === "Playing",
    "悔棋之后回到进行中 —— 这是终局后继续本局的唯一出路", JSON.stringify(afterClose));

  // ---- 7d. 相机：垂直能拖到接近正俯视，且不会震荡/越界
  const cam = await ev(`(() => {
    const c = Game.camera;
    c.yaw = 0; c.pitch = 0;
    const seq = []; let prev = c.pitch, backwards = 0, over = 0;
    const pole = (window.__camPole = 89.5);
    for (let i = 0; i < 400; i++) {
      Game.applyDrag(0, -1 / 0.32);           // 每拍往上拖 1 度
      if (c.pitch < prev - 1e-9) backwards++;
      if (Math.abs(c.pitch) > pole + 1e-9) over++;
      prev = c.pitch;
    }
    seq.push(c.pitch);
    const top = c.pitch;
    c.pitch = 0;
    for (let i = 0; i < 400; i++) Game.applyDrag(0, 1 / 0.32);
    const bot = c.pitch;
    c.yaw = -32; c.pitch = 24;
    return { top: top, bot: bot, backwards: backwards, over: over,
             cosTop: Math.cos(top * Math.PI / 180) };
  })()`);
  check(cam.over === 0 && Math.abs(cam.top - 89.5) < 1e-9 && Math.abs(cam.bot + 89.5) < 1e-9,
    "相机垂直拖到上限就停住，不越界（上限不是 90，否则 lookAt 会退化成画面滚半圈）",
    JSON.stringify(cam));
  // 这条钉的是"顶面真的正对了"：85° 时 cos=0.087（还偏轴 5°），89.5° 时 cos=0.0087（偏 0.5°）。
  check(cam.cosTop < 0.02,
    "往上拖能到接近正俯视（cos < 0.02，即离极轴不到 1.2°）",
    "cos=" + cam.cosTop.toFixed(5));
  check(cam.backwards === 0,
    "垂直拖拽单调，不在极点附近来回震荡（被砍掉的'翻越极点'版本每拍倒退一次）",
    "倒退 " + cam.backwards + " 次");

  // ---- 7e. 触屏加固：拖动面必须禁掉浏览器手势
  const ta = await ev(`(() => {
    const g = getComputedStyle(document.getElementById("gl"));
    const b = getComputedStyle(document.getElementById("banner"));
    return { gl: g.touchAction, banner: b.touchAction, cursor: b.cursor };
  })()`);
  check(ta.gl === "none" && ta.banner === "none",
    "两个拖拽面（#gl / #banner）都关掉了浏览器的触屏手势",
    JSON.stringify(ta));
  check(ta.cursor === "move", "横幅上显示 move 光标（能拖的提示）", JSON.stringify(ta));

  // ---- 7f. 窄窗口下关闭按钮不能跑到 #view 外面
  //
  // #view 只有视口的 42%。横幅原来的 min-width 是死数 300px，所以在 600px 宽的窗口里
  // 横幅（300px）比 #view（252px）还宽，被 overflow:hidden 裁掉右边一截 ——
  // 而关闭按钮恰好钉在右上角。那样返回的是"悔棋/再来一局（居中）点得到、
  // 关闭（靠右）点不到"，也就是又变回"关不掉"，正好是这次要修的问题。
  // 900×700 那道窄屏检查（第 5 节）触发不到这个：900 宽时 #view = 378px > 300px。
  //
  // 【高度是 500 不是 700】这一条原来写的是 600×700。网页版加了"竖屏改上下分栏"之后，
  // 600×700 是竖屏（高 > 宽），#view 变成整幅 600px 宽、横幅 300px —— 比 #view 窄得多，
  // 上面那条 `bannerW <= viewW` 就永远成立，等于把这条断言变成空断言（正是第 5 节那段
  // 注释里点名的失败模式）。600×500 仍然是横屏，#view = 42% × 600 = 252px，
  // 和改动前的几何完全一致，验的还是原来那件事。
  await send("Emulation.setDeviceMetricsOverride",
    { width: 600, height: 500, deviceScaleFactor: 1, mobile: false });
  const tiny = await ev(`(() => {
    Game.closeSetup(); Game.newGame([15, 15, 15], 1);
    const P = Game.session;
    for (let i = 0; i < 5; i++) { P.place(i, 0, 0); if (i < 4) P.place(i * 2, 8, 8); }
    Game.onBoardChanged(true); Game.showBanner();
    Game.el.toast.classList.remove("on"); Game.toastTimer = 0;
    const v = document.getElementById("view").getBoundingClientRect();
    const b = document.getElementById("banner").getBoundingClientRect();
    const c = document.getElementById("bannerClose").getBoundingClientRect();
    return { viewW: v.width, bannerW: b.width,
             closeInView: c.left >= v.left - 0.5 && c.right <= v.right + 0.5 &&
                          c.top >= v.top - 0.5 && c.bottom <= v.bottom + 0.5,
             bannerInView: b.left >= v.left - 0.5 && b.right <= v.right + 0.5,
             c: { l: Math.round(c.left), r: Math.round(c.right), t: Math.round(c.top) },
             v: { l: Math.round(v.left), r: Math.round(v.right) } };
  })()`);
  check(tiny.bannerW <= tiny.viewW + 0.5,
    "窄窗口（600px）下横幅不比 #view 宽（min()/max-width 生效）",
    "横幅 " + Math.round(tiny.bannerW) + "px vs #view " + Math.round(tiny.viewW) + "px");
  check(tiny.closeInView && tiny.bannerInView,
    "窄窗口下关闭按钮完整落在 #view 里（不被 overflow:hidden 裁掉，否则就是'关不掉'）",
    "关闭按钮 " + JSON.stringify(tiny.c) + " vs #view " + JSON.stringify(tiny.v));
  await send("Emulation.clearDeviceMetricsOverride");

  // ---- 7g. 竖屏：左右分栏必须变成上下分栏
  //
  // 上面两道窄屏检查（900×700、600×500）都是横屏，触发不到这一支 —— 竖屏那条分支
  // 只有 CSS 媒体查询在管，没有任何 JS 参与，离线桩一个字都验不到，所以必须在这里量。
  //
  // 【为什么先验 matchMedia】下面几条断言本身在横屏下也照样能成立（横屏只是把
  // "上/下"换成"左/右"，比大小的写法一样）。不先钉住"这一档确实是竖屏"，
  // 哪天媒体查询的条件被改坏（比如写成 min-aspect-ratio），整节就会悄悄退化成
  // "又在横屏下量了一遍"，而且全绿。
  //
  // 【两档尺寸都要量】大屏那档（390×844）所有东西都装得下，兜底那三条 CSS 等于没生效；
  // 小屏那档（360×640）才真正走到"面板装不下、靠滚动救回来"那条路。只量前者的话，
  // 把 overflow-y/min-height 那三条全删掉也照样全绿。
  let portCamDist = 0;
  for (const vp of [{ w: 390, h: 844, tag: "390×844" }, { w: 360, h: 640, tag: "360×640" }]) {
    await send("Emulation.setDeviceMetricsOverride",
      { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: false });
    // 等一下 resize 事件。布局那几条断言不等也行（getBoundingClientRect 会同步重排），
    // 但 camDist 是【事件监听器】里改的，事件是异步任务 —— 不等的话读到的是上一档的值，
    // 下面"转屏后相机重算了"那条断言就会时红时绿。实测确实红过一次。
    await sleep(200);
    const port = await ev(`(() => {
      const R = (id) => document.getElementById(id).getBoundingClientRect();
      const v = R("view"), p = R("panel"), btn = R("buttons"), mb = R("modebar"), tr = R("topRight");
      const panelEl = document.getElementById("panel");
      // 底部按钮排要么直接看得见，要么滚一下能够到。360×640 实测走的是后者：
      // 面板里不可压缩的几块加起来 417px，而它只分到 371px。
      const byScroll = () => {
        const before = panelEl.scrollTop;
        panelEl.scrollTop = panelEl.scrollHeight;
        const ok = R("buttons").bottom <= innerHeight + 0.5;
        panelEl.scrollTop = before;
        return ok;
      };
      // 【起始界面那几条必须在这里量】上面那些都在对局状态下量的，而模式行/冷却行/
      // 右上角两键都是起始界面里的东西：只有把 #setup 打开（#stage 带上 preview）
      // 才有几何可量。英文单独验一遍 —— 按钮文字比中文宽，出问题的从来是英文那一侧。
      const hits = (a, b) => !(a.right <= b.left || b.right <= a.left ||
                               a.bottom <= b.top || b.bottom <= a.top);
      const lineCount = (el) => { const rg = document.createRange(); rg.selectNodeContents(el);
        return rg.getClientRects().length; };
      const tops = (els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().top)))];
      const cols = (els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))];
      Game.openSetup();
      Game.setLang("en");
      const modeBtns = [document.getElementById("mode3d"), document.getElementById("mode4d")];
      const coolBtns = [...document.querySelectorAll(".coolBtn")];
      const trEn = R("topRight"), title = document.querySelector("#setup .titleRow").getBoundingClientRect();
      const coolCols = cols(coolBtns);
      // "两列对齐"：每一列里那两个键的左边缘必须相同，而两列之间必须不同
      const colOf = (i) => Math.round(coolBtns[i].getBoundingClientRect().left);
      const setupUi = {
        modeRowLines: tops(modeBtns).length,
        coolRowLines: tops(coolBtns).length,
        coolCols: coolCols.length,
        coolColAligned: colOf(0) === colOf(2) && colOf(1) === colOf(3) && colOf(0) !== colOf(1),
        labelLines: [...document.querySelectorAll(".rowLabel")].map(lineCount),
        trTop: Math.round(trEn.top), trRight: Math.round(trEn.right),
        trHitsTitle: hits(trEn, title),
      };
      Game.setLang("zh");
      Game.closeSetup();
      return {
        isPortrait: matchMedia("(orientation: portrait)").matches,
        viewBottom: Math.round(v.bottom), panelTop: Math.round(p.top),
        stacked: v.bottom <= p.top + 0.5,                     // 三维视图整个在面板上方
        fullWidth: Math.abs(v.left - p.left) < 1 && Math.abs(v.width - p.width) < 1,
        btnReachable: btn.bottom <= innerHeight + 0.5 || byScroll(),
        modebarClear: mb.right <= tr.left || tr.right <= mb.left ||
                      mb.bottom <= tr.top || tr.bottom <= mb.top,
        // 相机取景距离。竖屏和横屏的 #view 高宽比不同，frameBoard() 会算出不同的值
        // （竖屏受竖边限制、横屏受横边限制），下面拿它反向印证"转屏之后 resize 真的跑了"。
        camDist: Game.camera.distance,
        mb: { r: Math.round(mb.right), b: Math.round(mb.bottom) },
        tr: { l: Math.round(tr.left), t: Math.round(tr.top) },
        setupUi: setupUi,
      };
    })()`);
    if (vp.tag === "390×844") portCamDist = port.camDist;
    check(port.isPortrait, vp.tag + " 确实是竖屏（先钉住这一档，否则下面几条会在横屏下空转）");
    check(port.stacked && port.fullWidth,
      vp.tag + " 下三维视图和面板是【上下】两块、且都占满整幅宽度（不是左右分栏）",
      JSON.stringify({ viewBottom: port.viewBottom, panelTop: port.panelTop }));
    check(port.btnReachable,
      vp.tag + " 下底部那排按钮够得着（直接可见，或滚动面板后可见）");
    check(port.modebarClear,
      vp.tag + " 下左上角的模式条不压住右上角的 EN / 具体规则（横屏时两者分处两侧，不会碰）",
      "模式条右下角 " + JSON.stringify(port.mb) + " vs 右上角按钮左上角 " + JSON.stringify(port.tr));

    // ---- 起始界面（英文）在三处手机宽度下的几条硬要求。
    // 这几条都是"改了才知道会坏"的那种：模式行折行是 2026-09 报上来的手机版错位，
    // 冷却行折行时四个键落在两个互不对齐的列上，右上角两键原本压着标题。
    check(port.setupUi.modeRowLines === 1,
      vp.tag + " 英文下 3D / 4D 两个模式键在同一行",
      "实测分成 " + port.setupUi.modeRowLines + " 行 —— 行标曾经是写死的 138px，"
      + "把 \"Mode\" 也撑到 138，这一行就超了 32.7px");
    check(port.setupUi.coolRowLines === 2 && port.setupUi.coolCols === 2 && port.setupUi.coolColAligned,
      vp.tag + " 英文下转动冷却四键排成 2×2 且两列各自对齐",
      JSON.stringify({ 行数: port.setupUi.coolRowLines, 列数: port.setupUi.coolCols,
                       两列对齐: port.setupUi.coolColAligned }));
    check(port.setupUi.labelLines.every((x) => x <= 1),
      vp.tag + " 英文的每个行标都只占一行（宽度贴合文字，不折行）",
      JSON.stringify(port.setupUi.labelLines));
    check(port.setupUi.trTop <= 40 && !port.setupUi.trHitsTitle,
      vp.tag + " 起始界面下右上角两键钉在视口顶部、且不压标题",
      "top=" + port.setupUi.trTop + " 压标题=" + port.setupUi.trHitsTitle
      + "（改之前它俩在 42dvh+14 那一行，实测正好落在 y=371.8~399.8，压着 y=383.8 起的标题块）");
  }
  await send("Emulation.setDeviceMetricsOverride",
    { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });

  // 起始界面那块盖板：横屏写的是 left:42%（跟 #view 的 flex-basis 对齐），竖屏必须
  // 翻成 top:42%，否则盖板和三维画布错开 —— 表现是中间裂出一条缝，而且缝里露出来的
  // 是演示棋盘的一角（#setup 在竖屏下不再盖住它）。
  const seam = await ev(`(() => {
    Game.openSetup();
    const v = document.getElementById("view").getBoundingClientRect();
    const s = document.getElementById("setup").getBoundingClientRect();
    return { viewBottom: v.bottom, setupTop: s.top, setupBottom: s.bottom, vh: innerHeight,
             gap: Math.abs(s.top - v.bottom) };
  })()`);
  check(seam.gap < 1.5,
    "竖屏下 #setup 的上边缘和 #view 的下边缘对齐（42% 那两处没有错开）",
    "view.bottom=" + Math.round(seam.viewBottom) + " setup.top=" + Math.round(seam.setupTop));
  check(seam.setupBottom <= seam.vh + 0.5,
    "竖屏下 #setup 没有伸出视口底部（伸出去的那截会被 body 的 overflow:hidden 切掉）",
    "setup.bottom=" + Math.round(seam.setupBottom) + " vs 视口高 " + seam.vh);

  // 反过来钉住横屏：媒体查询绝不能在横屏下生效
  await send("Emulation.setDeviceMetricsOverride",
    { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(200);   // 同上：等 resize 事件，否则 camera 那一条读到的是竖屏的值
  const land = await ev(`(() => {
    const R = (id) => document.getElementById(id).getBoundingClientRect();
    const v = R("view"), p = R("panel");
    return { isPortrait: matchMedia("(orientation: portrait)").matches,
             sideBySide: v.right <= p.left + 0.5,
             camDist: Game.camera.distance,
             viewTop: Math.round(v.top), panelTop: Math.round(p.top) };
  })()`);
  check(!land.isPortrait && land.sideBySide && land.viewTop === land.panelTop,
    "1600×900 是横屏，仍然是左右分栏（媒体查询没有漏到横屏上）",
    JSON.stringify(land));
  // 从竖屏转回横屏：相机必须重算过。转屏只走 window 的 resize 那条路，
  // 一旦那条路断了，相机就会停在竖屏的取景距离上（棋盘被裁掉一角），
  // 而布局几何那边照样全绿 —— 所以这条单独钉。
  check(Math.abs(land.camDist - portCamDist) > 0.01,
    "转屏（竖→横）之后相机重算了取景距离，没有停在竖屏那档",
    "竖屏 " + portCamDist.toFixed(3) + " vs 横屏 " + land.camDist.toFixed(3));
  await send("Emulation.clearDeviceMetricsOverride");
  await ev("(() => { Game.closeSetup(); return 1; })()");

  // ---- 7h. 小屏 / 触屏：提示框默认收起，按键整体收一档
  //
  // 【为什么必须重新加载】提示框的默认折叠态只在 init 里算一次 —— 之后既不跟 resize
  // 也不跟转屏重算（否则玩家手动展开过之后会被窗口变化收回去）。所以"手机上打开就是
  // 收起的"这件事，只有真的以那个尺寸重新加载一次才验得到。
  //
  // 【触屏模拟必须显式打开】实测：CDP 的 setDeviceMetricsOverride({mobile:true})
  // 【不会】让 CSS 的 pointer: coarse 生效。不打开的话，844×390（手机横屏）那一档
  // 只能靠 max-width:700px 命中 —— 而它命不中，按键一个都不缩。而那一档恰恰是最挤的
  // 一档（面板只剩 390px 高），所以这是这个媒体查询里最要紧的一条，必须验到。
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Emulation.setDeviceMetricsOverride",
    { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send("Page.navigate", { url: PAGE });
  await sleep(1600);
  const reloadConsole = drainConsole();
  check(reloadConsole.length === 0,
    "以小屏档重新加载页面时控制台没有报错", reloadConsole.join("\n      "));
  // 重载后落地在起始界面，而 #stage.preview #hintbox 是 display:none —— 不关掉设置页
  // 就直接量，量到的是 0×0，下面那几条"提示框占多大"会全部空转通过（实测踩过）：
  // 折叠态 0% ≤ 15% 成立，展开后 0% > 0% 不成立，一红一绿全是假的。
  await ev("(() => { Game.closeSetup(); Game.newGame([15,15,15],1); return 1; })()");
  await sleep(500);

  const SMALL_PROBE = `(() => {
    const R = (id) => { const e = document.getElementById(id); return e ? e.getBoundingClientRect() : null; };
    const v = R("view"), hb = R("hintbox");
    return {
      coarse: matchMedia("(pointer: coarse)").matches,
      compact: getComputedStyle(document.documentElement).getPropertyValue("--compact").trim(),
      folded: Game.hintFolded,
      cls: document.getElementById("hintbox").className,
      txt: document.getElementById("hintToggle").textContent,
      hintH: Math.round(hb.height), hintShare: Math.round(hb.height / v.height * 100),
      bigBtn: Math.round(R("undoBtn").height),      // 普通按钮
      miniBtn: Math.round(R("prevLayer").height),   // mini 按钮
      modeBtn: R("modeGhost") ? Math.round(R("modeGhost").height) : null,
      docOver: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`;
  const small = await ev(SMALL_PROBE);
  check(small.coarse && small.compact === "1",
    "390×844 触屏：CSS 认得出这是小屏/触屏档（--compact=1）", JSON.stringify(small));
  check(small.folded && small.cls.indexOf("folded") >= 0 && small.txt === "提示",
    "小屏档下提示框【默认就是收起的】，胶囊按钮写「提示」",
    JSON.stringify({ folded: small.folded, cls: small.cls, txt: small.txt }));
  // hintH > 0 是防空转的前提：元素被 display:none 时高度是 0，而 0 ≤ 15 恒成立 ——
  // 少了这半边，提示框就算整个没渲染，这条也照样绿。
  check(small.hintH > 0 && small.hintShare <= 15,
    "收起后的提示框只占三维视图一小块（实测从 40% 降到 11%，这正是它挡棋盘的那个问题）",
    "占 " + small.hintShare + "%（高 " + small.hintH + "px）");
  check(small.bigBtn <= 32 && small.miniBtn <= 28 && small.modeBtn <= 28,
    "小屏档下按键整体收了一档（实测 38→30 / 31→26）",
    "普通 " + small.bigBtn + " · mini " + small.miniBtn + " · 模式条 " + small.modeBtn);
  check(small.docOver <= 1, "小屏档下整个页面没有横向溢出", "溢出 " + small.docOver + "px");

  // 点一下胶囊：这是玩家恢复说明的唯一入口，必须真的能点开
  const opened = await ev(`(() => {
    document.getElementById("hintToggle").click();
    const v = document.getElementById("view").getBoundingClientRect();
    const hb = document.getElementById("hintbox").getBoundingClientRect();
    return { folded: Game.hintFolded, cls: document.getElementById("hintbox").className,
             txt: document.getElementById("hintToggle").textContent,
             share: Math.round(hb.height / v.height * 100),
             coordsVisible: document.getElementById("coords").getBoundingClientRect().height > 0 };
  })()`);
  check(!opened.folded && opened.cls.indexOf("folded") < 0 && opened.txt === "收起" && opened.coordsVisible,
    "点一下胶囊就展开：坐标行和帮助正文都回来了，按钮改写成「收起」",
    JSON.stringify(opened));
  check(opened.share > small.hintShare, "展开后提示框确实变大了（折叠不是个空开关）",
    small.hintShare + "% → " + opened.share + "%");

  const reclosed = await ev(`(() => {
    document.getElementById("hintToggle").click();
    return { folded: Game.hintFolded, txt: document.getElementById("hintToggle").textContent };
  })()`);
  check(reclosed.folded && reclosed.txt === "提示", "再点一下又收回去（开与关都走得通）",
    JSON.stringify(reclosed));

  // ---- 7i. 手机横屏：宽度 844 > 700，只能靠 pointer: coarse 命中
  await send("Emulation.setDeviceMetricsOverride",
    { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
  await sleep(200);
  const landPhone = await ev(SMALL_PROBE);
  check(landPhone.coarse && landPhone.compact === "1" && landPhone.bigBtn <= 32 && landPhone.miniBtn <= 28,
    "手机横屏（844×390）：宽度超了 700px，靠 pointer:coarse 命中，按键照样收一档",
    "宽度 844 · --compact=" + landPhone.compact + " · 普通 " + landPhone.bigBtn + " · mini " + landPhone.miniBtn);
  check(landPhone.docOver <= 1, "手机横屏下页面没有横向溢出", "溢出 " + landPhone.docOver + "px");

  // 关掉触屏模拟、回到桌面尺寸：这一档必须【一点都没变】
  await send("Emulation.setTouchEmulationEnabled", { enabled: false, maxTouchPoints: 1 });
  await send("Emulation.setDeviceMetricsOverride",
    { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: PAGE });
  await sleep(1600);
  const desktopConsole = drainConsole();
  check(desktopConsole.length === 0,
    "以桌面尺寸重新加载页面时控制台没有报错", desktopConsole.join("\n      "));
  await ev("(() => { Game.closeSetup(); Game.newGame([15,15,15],1); return 1; })()");
  await sleep(500);
  const desk = await ev(SMALL_PROBE);
  // 桌面的三维视图有 900px 高，按"占百分之几"写会很难看（展开的提示框只占 16%）。
  // 这里要钉的是"它是展开的"，所以直接比高度：展开态是三行正文，收起来只有一颗胶囊。
  check(desk.hintH > 100,
    "桌面下提示框是展开的（三行正文都在），和改动前的行为一致",
    "高 " + desk.hintH + "px");
  check(desk.compact === "0" && !desk.folded && desk.txt === "收起",
    "桌面（1600×900）：--compact=0，提示框【默认展开】、按钮写「收起」——这一档一点没变",
    JSON.stringify({ compact: desk.compact, folded: desk.folded, txt: desk.txt }));
  check(desk.bigBtn >= 36 && desk.miniBtn >= 30,
    "桌面的按键尺寸和改动前一致（没有被小屏那一档漏过去）",
    "普通 " + desk.bigBtn + " · mini " + desk.miniBtn);
  await send("Emulation.clearDeviceMetricsOverride");

  const consoleAfter7 = drainConsole();
  check(consoleAfter7.length === 0,
    "第 7 节交互过程中控制台没有报错", consoleAfter7.join("\n      "));

  // ---- 8. 触屏手势：两指缩放 / 平移 / 双击复位
  //
  // 【为什么必须用真的合成触摸事件】这一整块的全部风险都在"浏览器到底把什么
  // 交给了我们"：CSS 的 touch-action 会把双指手势从我们手里抢走（页面跟着放大）、
  // 两指松开后浏览器可能补一个 click（捏一下就在棋盘上落了一子）、
  // 而 pointerdown 是一个指针一个事件（"现在有几根手指"没有现成 API）。
  // 桩里一条都验不到，DOM 桩连 getBoundingClientRect 都是常量。
  //
  // 【方向那两条是重点】符号推错的表现是"往左拖、棋子往右跑"，而推符号的人
  // （我）在纸上推两遍很可能两遍推反。所以方向不查 pan3d 的符号，
  // 而是把【棋盘中心投影到屏幕上】看它往哪边跑 —— 用页面自己的 view 矩阵，
  // 加一段独立的矩阵乘法，和游戏里的绘制路径只共享 lookAt 那一处。
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Emulation.setDeviceMetricsOverride",
    { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: PAGE });
  await sleep(2000);

  const touch = (type, pts) => send("Input.dispatchTouchEvent",
    { type, touchPoints: pts.map((p) => ({ x: p[0], y: p[1], id: p[2] })) });
  // 两指手势：从间距 fromD 走到 toD，中点停在 (cx, cy)
  const pinchAt = async (fromD, toD, cx, cy, steps) => {
    const p = (d) => [[cx - d / 2, cy, 1], [cx + d / 2, cy, 2]];
    await touch("touchStart", [p(fromD)[0]]);
    await touch("touchStart", p(fromD));
    for (let i = 1; i <= steps; i++) {
      await touch("touchMove", p(fromD + (toD - fromD) * (i / steps)));
      await sleep(16);
    }
    await touch("touchEnd", []);
    // 留出比 PINCH_TAIL_MS 更长的时间再让调用方点：捏完那一拍的点击是被
    // 故意吃掉的（防误落子），所以"紧接着就点"量到的不是后面的逻辑
    await sleep(320);
  };
  const drag2 = async (dx, dy, cx, cy, steps) => {
    const a = [[cx - 40, cy, 1], [cx + 40, cy, 2]];
    await touch("touchStart", [a[0]]);
    await touch("touchStart", a);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await touch("touchMove", [[a[0][0] + dx * t, a[0][1] + dy * t, 1],
                                [a[1][0] + dx * t, a[1][1] + dy * t, 2]]);
      await sleep(16);
    }
    await touch("touchEnd", []);
    await sleep(60);
  };
  const tapAt = async (x, y) => {
    await touch("touchStart", [[x, y, 1]]);
    await sleep(30);
    await touch("touchEnd", []);
  };
  // 棋盘中心在屏幕上的位置：页面自己的 view 矩阵 × 本文件自算的透视矩阵
  const CENTER_PROBE = `(() => {
    function mul(a, b) { const o = new Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
    function persp(fovy, aspect, near, far) { const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
      return [f / aspect,0,0,0, 0,f,0,0, 0,0,(far + near) * nf,-1, 0,0,2 * far * near * nf,0]; }
    const c = document.getElementById("gl"), r = c.getBoundingClientRect();
    const cam = Game.camera;
    const vp = mul(persp(cam.fov, r.width / r.height, 0.1, 800), cam.view(Game.pan3d, r.height));
    const x = vp[0] * 0 + vp[8] * 0 + vp[12], y = vp[5] * 0 + vp[13], w = vp[15];
    return JSON.stringify([(x / w * 0.5 + 0.5) * r.width, (0.5 - y / w * 0.5) * r.height]);
  })()`;

  await ev(`document.getElementById("startBtn").click()`);
  await sleep(700);
  const GY = 150;   // 竖屏下三维视图是上面 42%（y 0..357.8）

  const dz0 = await ev(`Game.camera.distance`);
  await pinchAt(80, 300, 196, GY, 10);
  const dz1 = await ev(`Game.camera.distance`);
  check(dz1 < dz0 * 0.75, "两指撑开 → 三维棋盘放大（相机拉近）",
    "distance " + dz0.toFixed(2) + " → " + dz1.toFixed(2));
  await pinchAt(300, 80, 196, GY, 10);
  const dz2 = await ev(`Game.camera.distance`);
  check(dz2 > dz1, "两指收拢 → 三维棋盘缩小（相机推远）",
    "distance " + dz1.toFixed(2) + " → " + dz2.toFixed(2));

  const c0 = JSON.parse(await ev(CENTER_PROBE));
  await drag2(80, 0, 196, GY, 8);
  const c1 = JSON.parse(await ev(CENTER_PROBE));
  check(Math.abs((c1[0] - c0[0]) - 80) < 12,
    "两指往右拖 80px → 屏幕上的棋盘中心也往右走约 80px（内容和手指同向）",
    "棋盘中心 " + c0[0].toFixed(1) + " → " + c1[0].toFixed(1) + "（位移 " +
    (c1[0] - c0[0]).toFixed(1) + "px）");

  // 平移之后"看到的"必须还是"点到的"：把棋盘中心的屏幕坐标往回挪一个平移量，
  // 拾取到的应当还是同一格 —— 这是 pick 和 draw3D 共用 camera.view() 的直接证据
  const pickOk = await ev(`(() => {
    const r = Game.el.gl.getBoundingClientRect();
    const a = Game.pick(r.width / 2 + (Game.el.gl.getBoundingClientRect().left - r.left), r.height / 2);
    const cx = r.width / 2, cy = r.height / 2;
    const atCenter = Game.pick(cx, cy);
    const back = Game.pick(cx - Game.pan3d[0], cy - Game.pan3d[1]);
    return JSON.stringify({ atCenter: atCenter, back: back });
  })()`);
  const pk = JSON.parse(pickOk);
  check(pk.atCenter !== null || pk.back !== null,
    "平移之后拾取仍然可用（不是整块点不到）", pickOk);

  await ev(`Game.resetView("gl")`);
  const yaw0 = await ev(`Game.camera.yaw`);
  await touch("touchStart", [[150, GY, 1]]);
  for (let i = 1; i <= 6; i++) { await touch("touchMove", [[150 + i * 15, GY, 1]]); await sleep(16); }
  await touch("touchEnd", []);
  const yaw1 = await ev(`Game.camera.yaw`);
  check(Math.abs(yaw1 - yaw0) > 5 && Math.abs(await ev(`Game.pan3d[0]`)) < 1,
    "单指拖拽仍然只转视角、不会顺带平移",
    "yaw " + yaw0.toFixed(1) + " → " + yaw1.toFixed(1) + "，pan3d=" + await ev(`JSON.stringify(Game.pan3d)`));

  // 【1 倍下必须是零延迟】这条是这次改动最要紧的代价控制：双击复位只在
  // "视图被放大或平移过"时才需要，1 倍下每一子都要晚 300ms 生效是不能接受的
  await ev(`Game.resetView("gl"); Game.newGame(15, 1)`);
  const mv0 = await ev(`Game.session.moveCount`);
  await tapAt(196, GY);
  await sleep(60);
  const mv1 = await ev(`Game.session.moveCount`);
  check(mv1 === mv0 + 1, "1 倍下点一下【立刻】落子（点击后 60ms 内就落上了，没有等双击窗口）",
    "moveCount " + mv0 + " → " + mv1);

  // 放大之后：第一下不落子，第二下（同一处）→ 复位
  await ev(`Game.resetView("gl")`);
  await pinchAt(80, 300, 196, GY, 10);
  const home = await ev(`Game.camera.homeDistance`);
  const zz = await ev(`Game.camera.distance`);
  check(Math.abs(zz - home) > 1, "（前置）这时确实处于放大状态",
    "distance " + zz.toFixed(2) + " vs 开局取景 " + home.toFixed(2));
  const mm0 = await ev(`Game.session.moveCount`);
  await tapAt(196, GY);
  await sleep(60);
  const mm1 = await ev(`Game.session.moveCount`);
  check(mm1 === mm0, "放大后第一下点击不立刻落子（在等双击窗口）",
    "moveCount " + mm0 + " → " + mm1);
  await tapAt(198, GY + 2);
  await sleep(80);
  check(Math.abs((await ev(`Game.camera.distance`)) - home) < 0.01,
    "第二下（同一处）→ 双击复位，相机回到开局取景距离",
    "distance " + (await ev(`Game.camera.distance`)).toFixed(3) + " vs " + home.toFixed(3));
  check((await ev(`Game.session.moveCount`)) === mm0 && Math.abs(await ev(`Game.pan3d[0]`)) < 0.01,
    "双击复位不落子、并把平移一起清掉");

  // 放大后只点一下（不是双击）：窗口过后那一子要补上 —— 扣住的落子绝不能丢
  await ev(`Game.resetView("gl")`);
  await pinchAt(80, 300, 196, GY, 10);
  const k0 = await ev(`Game.session.moveCount`);
  await tapAt(196, GY);
  await sleep(450);
  check((await ev(`Game.session.moveCount`)) === k0 + 1,
    "放大后单击（不是双击）：窗口过后扣住的那一子补上了，没被吞",
    "moveCount " + k0 + " → " + (await ev(`Game.session.moveCount`)));

  // 捏完松手那一拍：不能落子
  await ev(`Game.resetView("gl"); Game.newGame(15, 1)`);
  const j0 = await ev(`Game.session.moveCount`);
  await pinchAt(100, 200, 196, GY, 6);
  await sleep(120);
  check((await ev(`Game.session.moveCount`)) === j0,
    "两指捏完松手那一拍没有落子（浏览器补的那一下 click 被吃掉了）",
    "moveCount " + j0 + " → " + (await ev(`Game.session.moveCount`)));

  // 单层棋盘：两指缩放 / 平移 / 双击复位 / 点到的格子仍然对
  const lr = JSON.parse(await ev(`(() => { const r = Game.el.layerBase.getBoundingClientRect();
    return JSON.stringify([r.left, r.top, r.width, r.height]); })()`));
  const lcx = lr[0] + lr[2] / 2, lcy = lr[1] + lr[3] / 2;
  const z0 = await ev(`Game.zoom2d`);
  await pinchAt(40, 140, lcx, lcy, 10);
  const z1 = await ev(`Game.zoom2d`);
  check(z1 > z0 + 0.5, "单层棋盘两指撑开 → 放大", "zoom2d " + z0 + " → " + z1.toFixed(2));
  const centerCell = await ev(`(() => {
    const c = Game.el.layerBase, r = c.getBoundingClientRect();
    const d = Game.session.board.dims;
    const lay = Game.gridLayout(r.width, r.height, d[0], d[1]);
    const mx = r.left + lay.ox + lay.cs * (d[0] - 1) / 2;
    const my = r.top + (r.height - (lay.oy + lay.cs * (d[1] - 1) / 2));
    return JSON.stringify(Game.cellFromEvent({ clientX: mx, clientY: my }, c));
  })()`);
  const ccell = JSON.parse(centerCell);
  check(ccell && ccell.x === 7 && ccell.y === 7,
    "单层棋盘放大之后，棋盘正中那一格仍然点得到（看到的 = 点到的）", centerCell);
  const p0 = JSON.parse(await ev(`JSON.stringify(Game.pan2d)`));
  await drag2(-60, 0, lcx, lcy, 8);
  const p1 = JSON.parse(await ev(`JSON.stringify(Game.pan2d)`));
  check(p1[0] < p0[0], "单层棋盘两指往左拖 → 平移跟着往负方向走",
    JSON.stringify(p0) + " → " + JSON.stringify(p1));
  // 单层棋盘走的是 click 那条路（浏览器在两指松开后可能补发一个 click），
  // 所以"捏完不吃成落子"这件事【必须在这个棋盘上单独验一遍】——
  // 三维那侧走的是 pointerup，天然不会补 click，验了也证明不了这里
  const lj0 = await ev(`Game.session.moveCount`);
  await pinchAt(60, 160, lcx, lcy, 8);
  await sleep(120);
  check((await ev(`Game.session.moveCount`)) === lj0,
    "单层棋盘捏完那一拍也没有落子（浏览器补的 click 被吃掉了）",
    "moveCount " + lj0 + " → " + (await ev(`Game.session.moveCount`)));
  // 双击之间必须等过那个窗口（PINCH_TAIL_MS），否则第一下会被当成"捏完那一拍"吃掉
  await sleep(320);
  await tapAt(lcx, lcy);
  await sleep(60);
  await tapAt(lcx + 2, lcy + 2);
  await sleep(80);
  check(Math.abs((await ev(`Game.zoom2d`)) - 1) < 1e-6 &&
        (await ev(`JSON.stringify(Game.pan2d)`)) === "[0,0]",
    "单层棋盘双击 → 回到 1 倍、平移清零",
    "zoom2d=" + await ev(`Game.zoom2d`) + " pan=" + await ev(`JSON.stringify(Game.pan2d)`));

  // ---- 9. 六种语言：逐屏扫一遍 + 语言列表 + 排版几何
  //
  // 【为什么日文不能复用上面那条"没有汉字"的扫描】日文本来就用汉字
  // （「黒の手番」「回転」全是汉字），那条判据在日语界面上会满屏假红，
  // 而假红比漏报更坏 —— 它会训练人忽略这条断言。所以按语言分两套判据：
  //
  //   ru / fr / ko → 沿用"没有 CJK 汉字"那条。俄语法语根本没有汉字，
  //                  韩语是谚文（汉字只可能出现在「長連」这种刻意的术语里，
  //                  所以韩语那侧允许这两个字，见下面的 extraAllow）。
  //   ja           → 改用【简体专用字】黑名单：日语用的是日本字形（層/転/設/規/則/
  //                  盤/請/説…），简体字出现在日文界面上基本只可能是中文漏翻。
  //                  【名单是推出来的，不是拍脑袋】：把中文语料（HTML 里的 data-i18n
  //                  原文 + CORE_TEXT 的 zh 值 + 界面里 say(() => "…") 的中文）里的
  //                  汉字减去日语语料里的汉字，得到 196 个"只出现在中文里"的字，
  //                  再【人工剔掉日语里也合法的那些】（三/下/不/会/里/只/和/才…），
  //                  剩下面这些 —— 每一个都是简体专有形。
  //                  这条判据窄，所以再补一条【正向】的：每个带 data-i18n 的元素，
  //                  文字必须等于 ja 表里那一条 —— 那条能抓住所有"这块没换语言"。
  //
  // 【这一节是被一个真 bug 逼出来的】第一轮翻译漏了 22 条内核文案（提取脚本只抓了
  // 单行条目），界面上表现为"半句外语半句中文"。中文那半句恰好落在汉字的判据外面
  // （它就该是汉字），所以只有逐语言的扫描 + 正向比对才抓得住。
  /**
   * 日语的判据：**屏幕上的汉字串必须在该语言自己的译文语料里出现过**。
   *
   * 【为什么不用"有没有汉字"】日语本来就全是汉字，那条判据会满屏假红。
   * 【为什么也不用"简体专有字"黑名单】那个名单是我从语料里挑的，能抓住
   * 「须恰好」「及以上判负」这类，但抓不住**整句退回中文**的情况 ——
   * 实测注入 e（把内核 status.turn 的日语译文删掉）之后界面上是
   * 「黑棋落子（第 1 手）」，而这七个字**每一个日语里都有**（黑/棋/落/子/第/手
   * 都是日语汉字），字符级判据看不见它。
   *
   * 所以改成语料比对：把该语言所有译文（三张表里那个语言的每一格）里的
   * 汉字串收集成"允许集合"，再看屏幕上有没有 ≥4 字的汉字串不在这个集合里 ——
   * 出现了就说明那一段不是这种语言的译文（退回中文、或者混了中文）。
   * 这条判据不维护名单、跟着译文走，也不会因为某天译文里新用了某个汉字而假红。
   *
   * 韩语同理（韩文界面上出现 4 个以上汉字只可能是中文残留；「長連」这种
   * 术语在它自己的语料里，不会被误判）。
   */
  const CORPUS_SWEEP = (lang) => `(() => {
    const RUN = /[\\u4e00-\\u9fff]{4,}/g;
    const corpus = new Set();
    const eat = (s) => { const m = (s || "").match(RUN); if (m) for (const x of m) corpus.add(x); };
    const table = (o) => { if (o) for (const k in o) if (typeof o[k] === "string") eat(o[k]); };
    table(TEXT[${JSON.stringify(lang)}]);
    table(STATIC_TEXT[${JSON.stringify(lang)}]);
    for (const k in CORE_TEXT) eat(CORE_TEXT[k][${JSON.stringify(lang)}]);
    const allow = new Set([document.getElementById("langBtn"), document.querySelector(".seal"),
                           document.getElementById("langList")]);
    const visible = (el) => {
      if (el.getClientRects().length === 0) return false;
      if (getComputedStyle(el).visibility === "hidden") return false;
      let o = 1;
      for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity);
      return o >= 0.05;
    };
    const out = [];
    for (const el of document.querySelectorAll("*")) {
      if (allow.has(el)) continue;
      if (!document.body.contains(el)) continue;
      const tag = el.tagName.toLowerCase();
      if (tag === "script" || tag === "style") continue;
      if (el.children.length) continue;
      if (!visible(el)) continue;
      const t = (el.textContent || "").trim();
      if (!t) continue;
      const where = el.id ? "#" + el.id : tag;
      const runs = t.match(RUN) || [];
      const bad = runs.filter((r) => !corpus.has(r));
      if (bad.length) out.push(where + " = " + JSON.stringify(t.slice(0, 60)) + "（不在译文里：" + bad.join("/") + "）");
      else if (/(?:^|[^A-Za-z0-9_.])[a-z][A-Za-z]*(?:\\.[A-Za-z][A-Za-z]*)+(?![A-Za-z0-9_.])/.test(t))
        out.push(where + " = " + JSON.stringify(t.slice(0, 80)));
    }
    return out;
  })()`;

  const sweepWith = (judge, extraAllow) => `(() => {
    const allow = new Set([document.getElementById("langBtn"), document.querySelector(".seal")]);
    ${extraAllow || ""}
    const visible = (el) => {
      if (el.getClientRects().length === 0) return false;
      if (getComputedStyle(el).visibility === "hidden") return false;
      let o = 1;
      for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity);
      return o >= 0.05;
    };
    const out = [];
    for (const el of document.querySelectorAll("*")) {
      if (allow.has(el)) continue;
      if (!document.body.contains(el)) continue;
      const tag = el.tagName.toLowerCase();
      if (tag === "script" || tag === "style") continue;
      if (el.children.length) continue;
      if (!visible(el)) continue;
      const t = (el.textContent || "").trim();
      if (!t) continue;
      const where = el.id ? "#" + el.id : tag;
      if (${judge}.test(t)) out.push(where + " = " + JSON.stringify(t.slice(0, 60)));
      else if (/(?:^|[^A-Za-z0-9_.])[a-z][A-Za-z]*(?:\\.[A-Za-z][A-Za-z]*)+(?![A-Za-z0-9_.])/.test(t))
        out.push(where + " = " + JSON.stringify(t.slice(0, 80)));
    }
    return out;
  })()`;

  await send("Emulation.setDeviceMetricsOverride",
    { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send("Emulation.clearDeviceMetricsOverride");
  await sleep(200);

  const OTHER_LANGS = ["ja", "ko", "ru", "fr"];
  for (const lang of OTHER_LANGS) {
    const setup = await ev(`(() => {
      Game.openSetup();
      Game.setSetupMode(false);
      Game.setLang(${JSON.stringify(lang)});
      return document.documentElement.lang + "|" + document.documentElement.className;
    })()`);
    const info = await ev(`JSON.stringify(LANG_INFO[${JSON.stringify(lang)}])`);
    const meta = JSON.parse(info);
    check(setup.indexOf(meta.tag) >= 0, lang + "：html 的 lang 属性切到了 " + meta.tag, setup);
    check(setup.indexOf("lang-" + lang) >= 0, lang + "：html 上有 .lang-" + lang + "（那种语言的排版修正靠它）", setup);
    const others = OTHER_LANGS.concat(["en"]).filter((l) => l !== lang);
    check(others.every((l) => setup.indexOf("lang-" + l) < 0),
      lang + "：其它语言的类都摘掉了（挂着两个类时排版会按样式表顺序随机生效）", setup);

    // 逐屏扫。三种屏幕：起始界面（三维 / 四维）、对局、终局横幅
    const screens = [
      ["起始界面", `1`],
      ["起始界面·四维", `Game.setSetupMode(true); 1`],
      ["对局界面", `Game.closeSetup(); Game.newGame([15,15,15], 1); 1`],
    ];
    for (const [name, prep] of screens) {
      await ev(`(() => { ${prep}; return 1; })()`);
      await sleep(150);
      // 日语和韩语走语料比对（它们本来就用汉字，CJK 判据在它们身上会满屏假红）；
      // 俄语和法语根本没有汉字，直接用"没有 CJK"那条，最省事也最硬。
      const bad = await ev(lang === "ja" || lang === "ko"
        ? CORPUS_SWEEP(lang)
        : sweepWith(`/[\\u4e00-\\u9fff]/`, `allow.add(document.getElementById("langList"));`));
      check(bad.length === 0, lang + " 界面上（" + name + "）没有中文残留、也没有漏翻的键名", bad.join("；"));
    }

    // 正向：带 data-i18n 的元素必须等于该语言的表值（这条能抓住"这块根本没换语言"）
    const positive = await ev(`(() => {
      const bad = [];
      for (const el of document.querySelectorAll("[data-i18n]")) {
        if (el.getClientRects().length === 0) continue;
        const key = el.getAttribute("data-i18n") || el.id;
        const want = (STATIC_TEXT[${JSON.stringify(lang)}] || {})[key];
        if (want === undefined) { bad.push(key + "（表里没有）"); continue; }
        if (el.textContent !== want) bad.push(el.id + " 显示的是别的语言");
      }
      return bad;
    })()`);
    check(positive.length === 0, lang + "：每个带 data-i18n 的元素都写上了该语言的文案", positive.join("；"));

    // 语言列表：点开 → 六项都在、写的是本族名、当前项高亮；点另一种 → 真的切过去
    const list = await ev(`(() => {
      Game.toggleLangList(true);
      const items = Game.langItemIds.map((id) => {
        const el = Game.el[id];
        return { code: el.getAttribute("data-lang"), text: el.textContent,
                 sel: el.classList.contains("sel"), vis: el.getClientRects().length > 0 };
      });
      const openState = { open: Game.langListOpen, expanded: Game.el.langBtn.getAttribute("aria-expanded") };
      Game.toggleLangList(false);
      const closed = { open: Game.langListOpen, expanded: Game.el.langBtn.getAttribute("aria-expanded") };
      return JSON.stringify({ items: items, openState: openState, closed: closed, btn: Game.el.langBtn.textContent,
                              names: LANGS.map((l) => LANG_INFO[l].name) });
    })()`);
    const L = JSON.parse(list);
    check(L.items.length === 6 && L.items.every((x) => x.vis),
      lang + "：语言列表点开后六种语言都在、都看得见", JSON.stringify(L.items.map((x) => x.text)));
    check(L.items.every((x, i) => x.text === L.names[i]),
      lang + "：列表里写的是各语言的【本族名】，不是字母代码", JSON.stringify(L.items.map((x) => x.text)));
    check(L.items.filter((x) => x.sel).length === 1 &&
          L.items.filter((x) => x.sel)[0].code === lang,
      lang + "：列表里当前语言那一项高亮、且只有一项", JSON.stringify(L.items.map((x) => [x.code, x.sel])));
    check(L.openState.open && L.openState.expanded === "true" && !L.closed.open && L.closed.expanded === "false",
      lang + "：列表的开合状态和 aria-expanded 一致（屏幕阅读器靠它）", JSON.stringify([L.openState, L.closed]));
    check(L.btn === meta.short, lang + "：语言按钮上写的是当前语言的短标签 " + meta.short, L.btn);

    // 排版几何：模式行一行、冷却 2×2、行标不折行、没有横向滚动
    const geo = await ev(`(() => {
      Game.openSetup(); Game.setSetupMode(false); Game.setLang(${JSON.stringify(lang)});
      const tops = (els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().top)))].length;
      const cols = (els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))].length;
      const lines = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return rg.getClientRects().length; };
      const mode = [document.getElementById("mode3d"), document.getElementById("mode4d")];
      const cool = [...document.querySelectorAll(".coolBtn")];
      const s = document.getElementById("setup");
      const status = document.getElementById("status");
      return JSON.stringify({
        modeLines: tops(mode), coolLines: tops(cool), coolCols: cols(cool),
        labelLines: [...document.querySelectorAll(".rowLabel")].map(lines),
        docOver: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        setupOver: s.scrollWidth - s.clientWidth,
        statusLines: lines(status), statusText: status.textContent,
      });
    })()`);
    const g = JSON.parse(geo);
    check(g.modeLines === 1, lang + "：3D / 4D 两个模式键在同一行", JSON.stringify(g.modeLines));
    check(g.coolLines === 2 && g.coolCols === 2, lang + "：冷却键是 2 行 2 列", g.coolLines + "行" + g.coolCols + "列");
    check(g.labelLines.every((n) => n <= 1), lang + "：行标都没有折行", JSON.stringify(g.labelLines));
    check(g.docOver <= 1, lang + "：整个页面没有横向滚动", "溢出 " + g.docOver + "px");
    // 【状态行那一条是"记录现状"不是"保证"】中文基线本来就折成两行（202.7px 文字
    // 塞进 183px，改动前就是这样，拿今天早些时候的副本对拍过）。所以这里钉的是
    // "不比中文更差"：任何语言都不许超过两行。
    check(g.statusLines <= 2, lang + "：状态行不超过两行（中文基线就是两行）",
      g.statusLines + " 行：" + JSON.stringify(g.statusText));
  }
  // 【复数真的换了形没有】这是"机制还在不在"的检查。把俄语的 .few 形和 .many 形
  // 摆在一起比：如果 pluralForm 退化成"永远 many"、或者查表顺序错了，
  // 3 手那一句就会用 many 形 —— 中文和英文都看不出这个区别（中英没有这一形）。
  const ruPlural = await ev(`(() => {
    Game.setLang("ru");
    Game.closeSetup();
    Game.newGame([15,15,15], 1);
    Game.tryPlace(7,7); Game.tryPlace(8,7); Game.tryPlace(9,7);   // 3 手
    const info = document.getElementById("info").textContent;
    const fill = (s) => (s || "").split("{n}").join("3");
    const few = fill(TEXT.ru["info.moves.few"]), many = fill(TEXT.ru["info.moves.many"]);
    Game.setLang("zh");
    return JSON.stringify({ info: info, few: few, many: many });
  })()`);
  const RP = JSON.parse(ruPlural);
  check(RP.few !== RP.many && RP.info.indexOf(RP.few) >= 0,
    "俄语的「3 手」用的是少数形（.few），不是 many 形 —— 复数机制真的在选形",
    "界面：" + JSON.stringify(RP.info.slice(0, 60)) + " · few=" + JSON.stringify(RP.few) +
    " · many=" + JSON.stringify(RP.many));

  await ev(`Game.setLang("zh"); Game.closeSetup();`);

  const consoleAfterTouch = drainConsole();
  check(consoleAfterTouch.length === 0,
    "触屏手势过程中控制台没有报错", consoleAfterTouch.join("\n      "));
  await ev(`Game.resetView("gl"); Game.resetView("layer");`);

  // 收尾：回到干净的起始界面，并清掉这一节留下的位移/格线状态
  await ev(`(() => {
    Game.setGridVisible(true);
    Game.bannerDX = 0; Game.bannerDY = 0; Game.bannerDrag = null; Game.applyBannerOffset();
    Game.openSetup();
    return 1;
  })()`);
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
