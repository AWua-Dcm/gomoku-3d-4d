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
import zlib from "node:zlib";
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

// 【端口被占就当场停，别连上去】实测踩过：上一次异常结束留下的 headless 还占着 9401，
// 这一轮的 findTarget() 会**连到那个旧浏览器**上 —— 拿到的是上一轮跑完时的页面状态，
// 于是几十条断言莫名其妙地红（连 "--compact=1"、"起始界面是打开的" 这种和本轮改动
// 毫无关系的也红），而真正的原因一个字都不会出现在输出里。
// 假红灯比红灯更坏：它会把人引到完全错误的地方去查。所以这里宁可退出码 2。
try {
  await fetch(`http://127.0.0.1:${PORT}/json/version`);
  console.error("端口 " + PORT + " 已被占用 —— 多半是上一次留下的 headless 浏览器。\n" +
    "先把它关掉再跑（任务管理器里那个带 --remote-debugging-port=" + PORT + " 的 chrome），" +
    "否则这一轮会连到旧浏览器、报出一堆假的失败。");
  process.exit(2);
} catch (e) { /* 没监听才是对的 */ }

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

/** 派发一个真鼠标事件。原来定义在相机那一节里，挪到这里是因为"刚打开页面时拉条要拖不动"
 *  那条断言在很前面 —— 而它必须用【真鼠标】去拖，不能靠 JS 调 setSetupLevel。 */
const mouseAt = (type, x, y, extra) => send("Input.dispatchMouseEvent", Object.assign(
  { type: type, x: x, y: y, button: "none", clickCount: 0, pointerType: "mouse" }, extra || {}));

/**
 * 把浏览器交回来的 PNG 解成像素。**只用 node 自带的 zlib，不引任何包。**
 *
 * 【为什么需要它】有些问题只在**合成之后**才存在：画布自己读回来一切正常
 * （readPixels 说 alpha 是 0），可它贴到页面上之后整块是白的 —— 那一步发生在
 * 合成器里，JS 完全看不见，只有截了图去数像素才现形。
 * 见下面那条"藏起画布前后左半屏必须逐点相同"。
 *
 * 只认 Chrome 截图会产生的那些格式（8 位、非隔行、RGB 或 RGBA），
 * 碰到别的直接抛 —— 解错了比解不了更坏，静默返回一堆 0 会让断言变成假绿。
 */
function decodePng(buf) {
  let p = 8, w = 0, h = 0, bd = 0, ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (bd !== 8 || !ch) throw new Error("截图格式不认识：bitDepth=" + bd + " colorType=" + ct);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(stride * h);
  let prev = Buffer.alloc(stride);            // 上一行解过滤之后的字节
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 255;
    }
    prev = cur;
  }
  return { w: w, h: h,
    /** fx/fy 是 0..1 的比例，返回 [r,g,b] */
    at(fx, fy) {
      const x = Math.round(w * fx), y = Math.round(h * fy);
      const i = (y * w + x) * ch;
      return [out[i], out[i + 1], out[i + 2]];
    } };
}

/** 拍一张当前的屏幕，返回带 at(fx,fy) 的像素读取器（比例是 0..1）。 */
async function shotPixels() {
  const r = await send("Page.captureScreenshot", { format: "png" });
  return decodePng(Buffer.from(r.result.data, "base64"));
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
  // 允许名单：这几处【故意】在英文界面里留汉字。
  //   #langBtn 写的是"点了会变成什么"，英文界面下就该写「中文」；
  //   .seal 是装饰性的古风印章，换成拉丁字母和那圈楷体边框更不搭（见 STATIC_TEXT 的注释）；
  //   #inscription 是 v3.1.6 的竖排古文水印（「亦有格五／其法布子成行／以得五者胜」）。
  //     【它六种语言下都是中文原文，这是设计而不是漏翻】它是一件"挂在那里的书法作品"，
  //     切到英文界面时不该跟着变成英文 —— 就像一幅字不会因为你看的是英文说明书而变。
  //     【为什么必须显式放行，而不是"反正它扫不到"】：它现在带 <br> 子元素，
  //     而下面那道筛只看叶子（el.children.length），所以眼下恰好被跳过。
  //     但那是巧合，不是保证 —— 哪天有人把两段合成一个纯文本节点，这条就会突然变红，
  //     而红的原因（"我合并了两行"）离现象（"英文界面里有一串汉字"）很远，极难归因。
  //     显式写进名单，等于把"这是故意的"钉在代码里。
  const allow = new Set([document.getElementById("langBtn"), document.querySelector(".seal"),
                         document.getElementById("inscription")]);
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

  // ---- 0. 刚打开页面时，「对手」那一行就必须是自己该有的样子 ----
  //
  // 【这一条是冲着用户反馈"刚打开界面时拉条仍可以交互"去的】HTML 里默认选中的是「人类」，
  // 而"选中谁"之外的派生状态（拉条禁用、淡显、「谁先下」禁用）原来只写在 setSetupAi 里 ——
  // 那个函数**只在点击时跑**，启动和切语言都不经过它。于是刚打开时拉条是满色、拖得动的，
  // 「谁先下」两个键也点得动，和「人类」这个选择对不上。
  //
  // 【为什么这条断言必须放在这里，不能放到后面拉条那一节】那一节在断言之前会先
  // `Game.setSetupAi(...)` 把状态摆好再去查 —— 查的是**设过的状态**，正好绕过这个 bug。
  // 这条是唯一一条"页面刚加载完、一个字都还没设过"的断言，也是唯一能抓住它的位置。
  //
  // 【为什么要真拖】`disabled` 是平台保证没错，但用户报的是"还能交互"这个现象本身。
  // 按真鼠标拖一次、看档位动不动，才是照着现象验现象。
  const fresh = JSON.parse(await ev(`(() => {
    const r = document.getElementById("aiRange");
    const b = r.getBoundingClientRect();
    return JSON.stringify({
      ai: Game.setupAi, lv: Game.setupLevel,
      disabled: r.disabled, value: r.value,
      dim: document.getElementById("aiLevel").classList.contains("dim"),
      humanSel: document.getElementById("aiHuman").classList.contains("sel"),
      orderDisabled: [document.getElementById("orderMe").disabled,
                      document.getElementById("orderCpu").disabled],
      box: { l: b.left, t: b.top, w: b.width, h: b.height },
    });
  })()`));
  check(fresh.ai === "human" && fresh.humanSel,
    "刚打开页面时「对手」默认选中「人类」", JSON.stringify(fresh));
  check(fresh.disabled === true && fresh.dim === true,
    "刚打开页面时拉条就是淡显且不可点的（不用先点一下「人类」才生效）",
    "disabled=" + fresh.disabled + " dim=" + fresh.dim);
  check(fresh.orderDisabled[0] === true && fresh.orderDisabled[1] === true,
    "刚打开页面时「谁先下」也是禁用的（没有电脑可先下）", JSON.stringify(fresh.orderDisabled));
  // 真拖一次：按住滑块一路拖到最右
  const fr = fresh.box;
  const fry = fr.t + fr.h / 2;
  await mouseAt("mousePressed", fr.l + 8, fry, { button: "left", buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 8; i++) {
    await mouseAt("mouseMoved", fr.l + 8 + (fr.w - 16) * i / 8, fry, { button: "left", buttons: 1 });
    await sleep(16);
  }
  await mouseAt("mouseReleased", fr.l + fr.w - 8, fry, { button: "left", buttons: 0, clickCount: 1 });
  await sleep(150);
  const afterDrag = JSON.parse(await ev(`JSON.stringify({
    lv: Game.setupLevel, v: document.getElementById("aiRange").value })`));
  check(afterDrag.lv === fresh.lv && afterDrag.v === fresh.value,
    "刚打开页面时用真鼠标拖拉条，档位纹丝不动（拉条确实是死的）",
    fresh.lv + "/" + fresh.value + " → " + afterDrag.lv + "/" + afterDrag.v);

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
      viewBgColor: getComputedStyle(viewEl).backgroundColor,
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

  // 【v3.1.6：换了一种"没有缝"的实现，这两条断言跟着换】
  //
  // 旧做法 —— 给 #view 补一份和 <body> 一样的纸纹，用 background-attachment: fixed
  //   把定位基准钉在【整个视口】上，让左右两份对齐。原来那两条断言查的就是这个机制。
  // 新做法 —— **干脆只留一份纸**：#view 在起始界面下不画任何背景，
  //   纸全部来自 <body>（它本来就铺满整个视口）。
  //
  // 【为什么非换不可】字符层（#inkfield）和竖排古文水印都在 #view 底下，
  // 而 #view 那份**不透明**的纸正好把它们整个盖住了 —— 表现是"左半屏没有字符交互、
  // 也看不见水印"，而代码里一切正常。要让字从纸背面透出来，左半屏就不能再糊一层纸。
  //
  // 【缝因此不可能出现】纸只有一份，而这一份是整屏连续的。旧方案靠"两份对齐"消缝，
  // 新方案是让缝没有第二个可以出现的地方。下面两条：一条查机制（不许再有第二份），
  // 一条**真去量观感**（跨线取相邻两列比色）—— 后者比原来那两条强，因为原来那两条
  // 只证明"我们按正确的办法做了"，不证明"看起来真的没缝"。
  check(setup.viewBgImg === "none" && setup.viewBgColor === "rgba(0, 0, 0, 0)",
    "起始界面下 #view 不画任何背景（纸只留 <body> 那一份，多一份就会盖住字符层和水印）",
    "background-image = " + setup.viewBgImg + " / background-color = " + setup.viewBgColor);
  // 【为什么这两条机制断言就够，不需要再去数像素】
  // 缝的【存在条件】是"左右各有一份纸、两份没对齐"。现在纸只有一份（<body> 的），
  // 而 <body> 铺满整个视口、是整屏连续的一层 —— 缝没有第二个可以出现的地方。
  // 换句话说：只要上面这条成立，"有没有缝"在结构上就没有自由度了。
  //
  // 【试过数像素，放弃了，理由写在这里免得下次有人重走一遍】
  // 直接跨 42% 取两点比色，理论上更硬，实测却不成立：
  //   · 紧贴边界取点（0.418 / 0.422）—— 纸纹里有 repeating 的 1px/4px 纤维，
  //     两点落在不同相位上就能差出 13 个色阶，那是纹理噪声不是缝；
  //   · 拉远到 0.40 / 0.44 —— 差 4（正常）vs 8（左边糊一层平色），只差 2 倍，
  //     阈值无论定在哪都在噪声边上；
  //   · 想自校准（拿不跨线的色差当参照）—— 42% 以右全是设置面板，
  //     没有一块【裸纸】可以当参照，参照点全落在按钮和文字上，比值直接失效。
  // 结论：这条缝在本设计里本来就很细（<body> 和 #view 的清屏色都是 --bg，差的只是纹理），
  // 想用像素守住它，只能得到一条要么空转要么随机红的断言 —— 两条都比没有更坏。
  // 所以守住"只有一个纸层"这个结构前提，观感交给截图人眼看（原注释里也是这个立场）。

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
  //
  // 【v3.1.5 起分成两档量】「开始游戏」的位置在三维下**本来就有两种**：
  //   没勾新玩法 → 只有它一颗，居中；
  //   勾了任一玩法 → 「游戏教学」出现，整组居中 = 它和四维逐像素同位置。
  // 所以不变量改成"三维勾了玩法 ↔ 四维"完全一致，另外单独钉"没勾时真的居中"。
  const stable = await ev(`(() => {
    const ids = ["startBtn", "dimCube", "firstBlack", "mode3d", "setup"];
    const snap = () => ids.map(id => {
      const b = document.getElementById(id).getBoundingClientRect();
      return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)];
    });
    const off = () => {
      const b = document.getElementById("startBtn").getBoundingClientRect();
      const r = document.getElementById("startRow").getBoundingClientRect();
      return Math.round((b.left + b.width / 2) - (r.left + r.width / 2));
    };
    const tutDisp = () => getComputedStyle(document.getElementById("tutorialBtn")).display;
    Game.setSetupMode(false);
    Game.setSetupSpin(false); Game.setSetupWrap(false);
    const plain = { s: snap(), off: off(), tut: tutDisp() };
    Game.setSetupWrap(true);                       // 三维勾一个玩法：教学键出现
    const spin = { s: snap(), off: off(), tut: tutDisp() };
    const tutW = Math.round(document.getElementById("tutorialBtn").getBoundingClientRect().width) + 12;
    Game.setSetupWrap(false);
    Game.setSetupMode(true);
    const four = { s: snap(), off: off(), tut: tutDisp() };
    Game.setSetupMode(false);
    return { ids: ids, plain: plain, spin: spin, four: four, tutW: tutW };
  })()`);
  check(stable.plain.off === 0, "三维没勾新玩法时「开始游戏」在那一行里居中",
    "偏移 " + stable.plain.off + "px（不为 0 说明还留着游戏教学那颗键的宽度）");
  check(stable.plain.tut === "none", "三维没勾新玩法时「游戏教学」不出现（display:none）",
    "实际 display=" + stable.plain.tut);
  check(stable.spin.tut !== "none", "三维勾了新玩法之后「游戏教学」出现",
    "实际 display=" + stable.spin.tut);
  check(stable.four.tut !== "none", "四维下「游戏教学」出现", "实际 display=" + stable.four.tut);
  check(stable.plain.s[0][0] !== stable.spin.s[0][0],
    "（自检）「没勾」和「勾了」两种状态下开始游戏的横坐标确实不同（否则上面几条是空断言）",
    JSON.stringify(stable.plain.s[0]) + " vs " + JSON.stringify(stable.spin.s[0]));
  // 三维勾了玩法 ↔ 四维：逐像素一致（含 startBtn 向右让位之后的位置）
  for (let i = 0; i < stable.ids.length; i++) {
    const ra = stable.spin.s[i].join(","), rb = stable.four.s[i].join(",");
    check(ra === rb, "「" + stable.ids[i] + "」三维勾了玩法 ↔ 四维，位置和尺寸完全不变",
      "三维(勾了玩法) [l,t,w,h]=" + stable.spin.s[i] + "  四维=" + stable.four.s[i] +
      "（差 = " + stable.spin.s[i].map((v, k) => stable.four.s[i][k] - v).join(",") + "）");
  }
  // 剩下那四样在"没勾 ↔ 四维"之间也不许动（它们和教学键无关）
  for (let i = 1; i < stable.ids.length; i++) {
    const ra = stable.plain.s[i].join(","), rb = stable.four.s[i].join(",");
    check(ra === rb, "「" + stable.ids[i] + "」三维(没勾新玩法) ↔ 四维，位置和尺寸完全不变",
      "三维 [l,t,w,h]=" + stable.plain.s[i] + "  四维=" + stable.four.s[i]);
  }
  // 没勾时「开始游戏」比勾了(或四维)时正好右移"教学键宽 + 间距"—— 界面上少一颗键，
  // 居中的是剩下那一颗。
  // 没勾时它独占一行居中，勾了之后整组（开始游戏 + 游戏教学）居中 ——
  // 于是它自己向左挪"半个键位"。符号是负的（往左），这里只钉平移量。
  const shift = stable.plain.s[0][0] - stable.spin.s[0][0];
  check(Math.abs(shift - Math.round(stable.tutW / 2)) <= 1,
    "「开始游戏」在「没勾」和「勾了」之间正好平移半个键位（居中 → 整组居中）",
    "实测平移 " + shift + "px，期望 " + Math.round(stable.tutW / 2) + "px（教学键 " + stable.tutW + "px 含间距）");
  // 留一张四维状态的截图。上面那几条只说"没动"，看不出四维到底长什么样 ——
  // 而"四维那一版有没有多出一行、有没有留空槽位"正是这一版最容易出错的地方。
  await ev(`Game.setSetupMode(true)`);
  await freezePreview(-28);
  await shot("5-起始界面-四维模式");
  await ev(`Game.setSetupMode(false)`);

  // ---- 2d. v3.1.5：三维勾了「魔方旋转」→ 转动冷却行出现在摘要和规则之间的空位里，
  //          而且**不动任何人**（整页高度、规则行、开始游戏一个像素都不变）。
  //
  // 【为什么这几条只能在真浏览器里量】"落在空位里"的全部含义就是几何：
  // #sizeSummary 在三维下固定 92px 是给四维那 4 行摘要准备的，三维自己的摘要只有
  // 1~2 行，底部一直是空的 —— 冷却行填的就是那块。桩里量不了。
  const cool3 = await ev(`(() => {
    const box = (id) => { const el = document.getElementById(id);
      if (!el || getComputedStyle(el).display === "none") return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
    const sum = document.getElementById("sizeSummary");
    // 【"整页没长高"不能用 #setup 的高度量】它是 position:fixed + top/bottom:0，
    // 高度恒等于视口 —— 拿它比等于恒真（这一条踩过）。真正能作证的是
    // "第一行的 y"（整列居中，内容一变它就动）和"最后一行的底"（内容的下沿）。
    const first = document.getElementById("setup").firstElementChild;
    const snap = () => ({ cool: box("coolRow"), sum: box("sizeSummary"), rule: box("ruleNote"),
                          start: box("startRow"), startBtn: box("startBtn"),
                          firstY: Math.round(first.getBoundingClientRect().top),
                          startBottom: Math.round(document.getElementById("startRow").getBoundingClientRect().bottom),
                          tut: getComputedStyle(document.getElementById("tutorialBtn")).display,
                          sumOver: sum.scrollHeight - sum.clientHeight });
    Game.setSetupMode(false); Game.setSetupSpin(false); Game.setSetupWrap(false); Game.setSetupAi("human");
    const before = snap();
    Game.setSetupSpin(true);                       // 勾上：冷却行应当补进那块空位
    const after = snap();
    Game.setSetupAi("cpu");                        // 人机那句是"必须看得见"的：2 行也要塞得下
    const ai = snap();
    Game.setSetupAi("human"); Game.setSetupSpin(false);
    return { before: before, after: after, ai: ai };
  })()`);
  check(cool3.before.cool === null, "三维没勾旋转时没有「转动冷却」这一行",
    JSON.stringify(cool3.before.cool));
  check(cool3.after.cool !== null && cool3.after.cool.y >= cool3.after.sum.y + cool3.after.sum.h - 1,
    "勾了旋转：「转动冷却」出现在摘要下面",
    "冷却行 " + JSON.stringify(cool3.after.cool) + " 摘要 " + JSON.stringify(cool3.after.sum));
  check(cool3.after.cool.y + cool3.after.cool.h <= cool3.after.rule.y,
    "冷却行整行落在摘要与规则之间（不和小字打架）",
    "冷却行底 " + (cool3.after.cool.y + cool3.after.cool.h) + " 规则行顶 " + cool3.after.rule.y);
  check(cool3.after.rule.y === cool3.before.rule.y && cool3.after.start.y === cool3.before.start.y &&
        cool3.after.startBtn.y === cool3.before.startBtn.y,
    "勾这一下：规则行与「开始游戏」的位置一个像素都没动",
    JSON.stringify({ ruleBefore: cool3.before.rule.y, ruleAfter: cool3.after.rule.y,
                     startBefore: cool3.before.start.y, startAfter: cool3.after.start.y }));
  // 【反空洞】这一条以前量的是 #setup 的高度 —— 它是 fixed 顶天立地，恒等于视口，
  // 于是"整页高度不变"恒真（复核时被抓出来了）。改成量整列的第一行 y 与最后一行的底：
  // 内容一旦真的长高 48px，居中的整列会整体上移 24px、开始游戏的下沿跟着下移。
  check(cool3.after.firstY === cool3.before.firstY &&
        cool3.after.startBottom === cool3.before.startBottom,
    "整页没有长高（第一行的 y 与「开始游戏」的下沿都不动）",
    JSON.stringify({ firstY: [cool3.before.firstY, cool3.after.firstY],
                     startBottom: [cool3.before.startBottom, cool3.after.startBottom] }));
  check(cool3.after.sumOver <= 0 && cool3.ai.sumOver <= 0,
    // 槽高 = --summary-h(84) - --cool3d-take(48) = 36px，两行 13.5px 文本要真的塞进去。
    "摘要不出内部滚动条（默认 1 行、人机 2 行都塞得进那 36px）",
    JSON.stringify({ 默认: cool3.after.sumOver, 人机: cool3.ai.sumOver }));
  check(cool3.before.tut === "none" && cool3.after.tut !== "none",
    "「游戏教学」跟着勾选一起出现/收掉",
    JSON.stringify({ 没勾: cool3.before.tut, 勾了: cool3.after.tut }));
  // 留一张这一档的截图：上面几条只证明"几何没动"，看不出这一行落到空位里读起来顺不顺。
  await ev(`(() => { Game.setSetupMode(false); Game.setSetupSpin(true); Game.openSetup(); return 1; })()`);
  await freezePreview(-28);
  await shot("14-起始界面-三维勾了旋转");
  await ev(`(() => { Game.setSetupSpin(false); return 1; })()`);

  // 同一件事在【英文】和【紧凑档】各再量一遍。
  // 【为什么非量不可】"让出多少 / 补回多少"的算式在这两档里不一样：英文的摘要基准是
  // 96px（不是 92）、紧凑档（手机 / ≤700px）的 #setup 行距是 12（不是 10）。
  // 只在中文 1600×900 下量，这两档一个字都验不到 —— 实测拿写死的 44px 跑，
  // 英文差 4px、紧凑档差 2px：勾一下「魔方旋转」，规则行和「开始游戏」就被顶动。
  const cool3Again = async (label) => {
    const r = JSON.parse(await ev(`(() => {
      const first = document.getElementById("setup").firstElementChild;
      const snap = () => ({
        firstY: Math.round(first.getBoundingClientRect().top),
        rule: Math.round(document.getElementById("ruleNote").getBoundingClientRect().top),
        startBottom: Math.round(document.getElementById("startRow").getBoundingClientRect().bottom),
        cool: getComputedStyle(document.getElementById("coolRow")).display !== "none",
      });
      Game.setSetupMode(false); Game.setSetupSpin(false); Game.setSetupWrap(false); Game.setSetupAi("human");
      const before = snap();
      Game.setSetupSpin(true);
      const after = snap();
      Game.setSetupSpin(false);
      return JSON.stringify({ before: before, after: after });
    })()`));
    check(r.after.firstY === r.before.firstY && r.after.rule === r.before.rule &&
          r.after.startBottom === r.before.startBottom,
      "（" + label + "）勾「魔方旋转」：整列一行都不动（第一行 y / 规则行 / 开始游戏下沿）",
      JSON.stringify({ 勾之前: r.before, 勾之后: r.after }));
    check(r.after.cool && !r.before.cool, "（" + label + "）冷却行跟着勾选出现/收掉", JSON.stringify(r));
  };
  await ev(`Game.setLang("en")`);
  await sleep(250);
  await cool3Again("英文 1600×900");
  await ev(`Game.setLang("zh")`);
  await send("Emulation.setDeviceMetricsOverride",
    { width: 690, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(350);
  await cool3Again("紧凑档 690×800");
  await ev(`Game.setLang("en")`);
  await sleep(250);
  await cool3Again("紧凑档 + 英文 690×800");
  await ev(`Game.setLang("zh")`);
  await send("Emulation.clearDeviceMetricsOverride");
  await sleep(350);

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
    // 【v3.1.5：必须勾一个新玩法再和四维比】没勾时三维只有「开始游戏」一颗、居中，
    // 横坐标和四维本来就不同（见上面 2c 那一段）。这里要验的是"尺寸行换行、
    // 格子取 max、按钮的纵向位置纹丝不动"，所以拿同一套按钮（三维勾了玩法）对四维。
    Game.setSetupMode(false); Game.setSetupSpin(false); Game.setSetupWrap(true);
    const a = snap(); const h3 = h("dimsRow3d");
    Game.setSetupMode(true);  const c = snap(); const h4 = h("dimsRow4d");
    Game.setSetupMode(false); Game.setSetupWrap(false);
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
    "三维(勾了玩法) [l,t]=" + narrow.a + " 四维=" + narrow.c +
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
    Game.setSetupMode(false); Game.setSetupSpin(false); Game.setSetupWrap(true);  // 同上：两边都得有教学键
    const a = snap(); const h3 = h("dimsRow3d");
    Game.setSetupMode(true);  const c = snap(); const h4 = h("dimsRow4d");
    Game.setSetupMode(false); Game.setSetupWrap(false);
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
    "窄屏 + 英文下切到四维，开始游戏按钮的横纵坐标仍然完全不变（两边都带教学键）",
    "三维(勾了玩法) [l,t]=" + narrowEn.a + " 四维=" + narrowEn.c +
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
    // 【必须切到四维再量】v3.1.2 起「转动冷却」「相位周期」两行**只在四维下显示** ——
    // 三维下它们的槽位让给了「魔方旋转 / 空间贯通」那两块（见 syncCoolRow）。
    // 三维里量到的是 display:none 的 0 宽，那不是在验"行标贴合文字"，是在验"它藏起来了"。
    const keep4d = Game.fourD;
    Game.setSetupMode(true);
    const wOf = (id) => Math.round(document.getElementById(id).getBoundingClientRect().width);
    const wMode = wOf("rowLabelMode"), wCool = wOf("rowLabelCool"), wNote = wOf("coolNote");
    Game.setSetupMode(keep4d);
    return {
      lang: root.lang,
      cls: root.className,
      fontEn: enFam, fontZh: zhFam,
      labelWMode: wMode, labelWCool: wCool,
      // 每个行标占几个行盒。Range.getClientRects() 换行就多一个矩形，比拿高度除行高可靠
      // （line-height 可能是 normal，除出来是 NaN）。英文行标比中文长得多，
      // "Rotation cooldown" 就是会顶不住的典型。
      labelLines: [...document.querySelectorAll(".rowLabel")].map((el) => {
        const rg = document.createRange();
        rg.selectNodeContents(el);
        return { id: el.id, lines: rg.getClientRects().length, text: el.textContent };
      }),
      coolNoteW: wNote,
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
  // v3.1.6 改名：三维五子棋 -> Gomokube。这条断言查的是"切语言真的换了标题"，
  // 名字本身不是重点，所以跟着新名字走。
  check(en.titleText === "Gomokube", "起始界面标题是英文", "实际 " + JSON.stringify(en.titleText));

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
  // 【v3.0.0：这一格的文案换了】原来写"转动会占掉一个回合"，现在写输入框的范围
  // （和 #dimRange 同一套：范围从常量现算，玩家看得见边界）。那句话本身没丢 ——
  // 它在 #rule 里，下面 rule5 那条断言就在验它。
  check(en4d.fourD === true && en4d.note === "3 – 10 allowed",
    "起始界面已经切到四维，冷却那格写的是可填范围",
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
  // 【标签内容按用户口径改过名】四维那颗从 "4D · Rotatable" 换成 "4D · Myriad" ——
  // 这一条要钉的是"两句话没贴错按钮"，所以两个字符串都得跟着 UI 走。
  check(enMode.label3d === "3D · Classic" && enMode.label4d === "4D · Myriad",
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
        afterReload.title === "Gomokube",
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
  //   【2026-09-26 这一段的两个循环换了方向】相机的 dy 符号原来是反的
  //   （`pitch - dy`）：手指往上拖，棋盘却往下转，和水平方向"内容跟着手指走"
  //   互相矛盾。改成两轴同号之后，"往下拖"这一侧才对应正俯视。
  //   断言查的东西一个没变（两端都停在 ±89.5、不越界、不震荡、极点附近 cos < 0.02），
  //   变的是"哪一侧是对着手指的"—— 而且下面单独加了一条把方向约定钉住，
  //   免得哪天再翻回去时只有手感能发现。
  const cam = await ev(`(() => {
    const c = Game.camera;
    c.yaw = 0; c.pitch = 0;
    let prev = c.pitch, backwards = 0, over = 0;
    const pole = 89.5;
    for (let i = 0; i < 400; i++) {
      Game.applyDrag(0, 1 / 0.32);            // 每拍往下拖 1 度 → 应升到正俯视
      if (c.pitch < prev - 1e-9) backwards++;
      if (Math.abs(c.pitch) > pole + 1e-9) over++;
      prev = c.pitch;
    }
    const top = c.pitch;
    c.pitch = 0; prev = c.pitch;
    for (let i = 0; i < 400; i++) {
      Game.applyDrag(0, -1 / 0.32);           // 每拍往上拖 1 度 → 应降到正仰视
      if (c.pitch > prev + 1e-9) backwards++;
      prev = c.pitch;
    }
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
    "往下拖能到接近正俯视（cos < 0.02，即离极轴不到 1.2°）",
    "cos=" + cam.cosTop.toFixed(5));
  check(cam.backwards === 0,
    "垂直拖拽单调，不在极点附近来回震荡（被砍掉的'翻越极点'版本每拍倒退一次）",
    "倒退 " + cam.backwards + " 次");

  // 方向约定：**内容跟着手指走**，两个轴同一个隐喻。
  // 这条盯的是一个只在手感上才暴露的错法 —— 原来 dy 就是反的
  // （"上拉棋盘、棋盘却往下转"），而当时所有断言都能过。
  const dragDir = await ev(`(() => {
    const c = Game.camera; const keepY = c.yaw, keepP = c.pitch;
    c.yaw = 0; c.pitch = 0;
    Game.applyDrag(0, 40);            // 往下拖 40px
    const downPitch = c.pitch;
    c.pitch = 0;
    Game.applyDrag(40, 0);            // 往右拖 40px
    const rightYaw = c.yaw;
    c.yaw = keepY; c.pitch = keepP;
    return JSON.stringify({ downPitch: +downPitch.toFixed(3), rightYaw: +rightYaw.toFixed(3) });
  })()`);
  const dd = JSON.parse(dragDir);
  check(dd.downPitch > 0 && dd.rightYaw > 0,
    "往下拖 → 相机抬高（pitch 增加）、往右拖 → yaw 增加：两轴都是「内容跟着手指走」",
    dragDir + "（dy 取反的话 downPitch 会是负的，表现就是「上拉棋盘、棋盘却往下转」）");

  // ---- 7d-2. 真鼠标事件：右键/Shift 拖动平移、滚轮与触控板捏合的方向
  //
  // 【为什么非要用真事件】上面几条都是【直接调 applyDrag】的，验的是"角度怎么算"。
  // 而"哪颗键走哪条路、事件有没有被浏览器吃掉"一条都没验到 —— 右键那两条尤其：
  // contextmenu 不挡住的话，真实的右键拖动会在按下的那一拍被系统菜单打断，
  // 而"直接调函数"的写法永远看不见这件事（合成事件绕过了整条输入通路）。
  const cam0 = JSON.parse(await ev(`(() => {
    const c = Game.camera;
    Game.pan3d = [0, 0];
    const r = document.getElementById("gl").getBoundingClientRect();
    return JSON.stringify({ cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2),
      distance: c.distance, yaw: c.yaw, pitch: c.pitch, min: c.minDistance, max: c.maxDistance });
  })()`));
  const mouseDrag = async (button, dx, dy, steps) => {
    await mouseAt("mousePressed", cam0.cx, cam0.cy, { button: button, buttons: button === "right" ? 2 : 1, clickCount: 1 });
    for (let i = 1; i <= steps; i++) {
      await mouseAt("mouseMoved", cam0.cx + dx * i / steps, cam0.cy + dy * i / steps,
        { button: button, buttons: button === "right" ? 2 : 1 });
      await sleep(16);
    }
    await mouseAt("mouseReleased", cam0.cx + dx, cam0.cy + dy, { button: button, buttons: 0, clickCount: 1 });
    await sleep(150);
  };
  const wheelAt = (deltaY, ctrl) => mouseAt("mouseWheel", cam0.cx, cam0.cy,
    { deltaX: 0, deltaY: deltaY, modifiers: ctrl ? 2 : 0 });

  // 右键拖动 = 平移（3D 查看器的通行分工，OrbitControls 的 RIGHT = PAN）
  await mouseDrag("right", 80, 40, 8);
  const panRes = JSON.parse(await ev(`JSON.stringify({ pan: Game.pan3d.map((v) => +v.toFixed(1)),
    yaw: +Game.camera.yaw.toFixed(3), pitch: +Game.camera.pitch.toFixed(3) })`));
  check(Math.abs(panRes.pan[0] - 80) < 6 && Math.abs(panRes.pan[1] - 40) < 6 &&
        Math.abs(panRes.yaw - cam0.yaw) < 1e-6 && Math.abs(panRes.pitch - cam0.pitch) < 1e-6,
    "真鼠标右键拖 80×40 → 棋盘整体跟着走 80×40，视角一点没动",
    JSON.stringify(panRes) + "（改之前右键什么都不做）");

  const ctxBlocked = await ev(`(() => {
    const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    document.getElementById("gl").dispatchEvent(e);
    return e.defaultPrevented;
  })()`);
  check(ctxBlocked === true, "画布上的右键菜单被挡住了 —— 不挡的话真实的右键拖动会被它打断");

  // Shift + 左键 = 平移（触控板上按不出右键拖动时的那条退路）
  await ev(`Game.pan3d = [0, 0]; "ok"`);
  await mouseAt("mousePressed", cam0.cx, cam0.cy, { button: "left", buttons: 1, clickCount: 1, modifiers: 8 });
  for (let i = 1; i <= 6; i++) {
    await mouseAt("mouseMoved", cam0.cx - i * 8, cam0.cy + i * 4, { button: "left", buttons: 1, modifiers: 8 });
    await sleep(16);
  }
  await mouseAt("mouseReleased", cam0.cx - 48, cam0.cy + 24, { button: "left", buttons: 0, clickCount: 1, modifiers: 8 });
  await sleep(150);
  const shiftPan = JSON.parse(await ev(`JSON.stringify({ pan: Game.pan3d.map((v) => +v.toFixed(1)),
    yaw: +Game.camera.yaw.toFixed(3) })`));
  check(Math.abs(shiftPan.pan[0] + 48) < 6 && Math.abs(shiftPan.pan[1] - 24) < 6 &&
        Math.abs(shiftPan.yaw - cam0.yaw) < 1e-6,
    "真 Shift + 左键拖 48×24 → 同样是平移（触控板上按不出右键拖动时的退路）",
    JSON.stringify(shiftPan));

  // 滚轮 / 触控板捏合：往下滚与双指合拢都是缩小
  //
  // 【触控板的捏合走的就是 wheel】浏览器把它报成带 ctrlKey 的 wheel 事件，手指张开 = deltaY < 0。
  // 所以这里两条一起量：鼠标滚轮那条是惯例（three.js / Google Maps 同向），
  // 触控板那条是用户直接报上来的（"双指放大实际缩小"）。
  const wheelDist = async (deltaY, ctrl) => {
    await ev(`Game.camera.distance = 30; "ok"`);
    await wheelAt(deltaY, ctrl);
    await sleep(120);
    return ev(`Game.camera.distance`);
  };
  const dDown = await wheelDist(120, false);
  const dUp = await wheelDist(-120, false);
  const dOut = await wheelDist(-60, true);
  const dIn = await wheelDist(60, true);
  check(dDown > 30 && dUp < 30,
    "鼠标滚轮：往下滚 = 缩小（相机拉远）、往上滚 = 放大",
    JSON.stringify({ 往下滚: dDown, 往上滚: dUp }));
  check(dOut < 30 && dIn > 30,
    "触控板双指捏合：张开 = 放大、合拢 = 缩小（改之前是反的）",
    JSON.stringify({ 张开: dOut, 合拢: dIn }));

  // 收尾：相机和取景复位，别把状态留给下面的触屏一节
  await ev(`(() => { const c = Game.camera;
    c.distance = ${cam0.distance}; c.yaw = ${cam0.yaw}; c.pitch = ${cam0.pitch};
    c.minDistance = ${cam0.min}; c.maxDistance = ${cam0.max}; Game.pan3d = [0, 0]; return "ok"; })()`);

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
      // 【v3.0.0 起没有 .coolBtn 了】转动冷却从四个键的 2×2 网格改成和「棋盘尺寸」
      // 一样的手填数字输入框（#coolInput），相位周期同样（#phaseInput）。
      // 原来那两条断言（2 行 2 列、两列对齐）随之作废 —— 换成"两个输入框都在、
      // 且各自那一行只有一行高"，这才是新版要保证的东西。
      const coolInput = document.getElementById("coolInput");
      const phaseInput = document.getElementById("phaseInput");
      const trEn = R("topRight"), title = document.querySelector("#setup .titleRow").getBoundingClientRect();
      // 【先切到四维】v3.1.2 起「转动冷却」「相位周期」两行只在四维下显示 ——
      // 三维下它们的槽位让给了「魔方旋转 / 空间贯通」那块（见 syncCoolRow），
      // 三维里量到的是 display:none。这一条要验的是"手机宽度下那两个输入框仍排得开"，
      // 那就得在它们真的显示的那种模式下量。
      // 模式键那一行（modeRowLines）三维四维都在，不受影响。
      const keep4d = Game.fourD;
      Game.setSetupMode(true);
      const setupUi = {
        modeRowLines: tops(modeBtns).length,
        coolInputVisible: coolInput.getClientRects().length > 0,
        phaseInputVisible: phaseInput.getClientRects().length > 0,
        coolRowOneLine: tops([coolInput]) === 1,
        phaseRowOneLine: tops([phaseInput]) === 1,
        coolRowH: Math.round(document.getElementById("coolRow").getBoundingClientRect().height),
        phaseRowH: Math.round(document.getElementById("phaseRow").getBoundingClientRect().height),
        labelLines: [...document.querySelectorAll(".rowLabel")].map(lineCount),
        trTop: Math.round(trEn.top), trRight: Math.round(trEn.right),
        trHitsTitle: hits(trEn, title),
      };
      Game.setSetupMode(keep4d);
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
    check(port.setupUi.coolInputVisible && port.setupUi.phaseInputVisible,
      vp.tag + " 英文下转动冷却 / 相位周期两个输入框都看得见",
      JSON.stringify({ cool: port.setupUi.coolInputVisible, phase: port.setupUi.phaseInputVisible }));
    // 【为什么是"一行高"而不是一个具体像素】这两行在三维下是禁用状态（保留槽位），
    // 高度和四维下一样。量到 48px 以内就说明没折行 —— 折行会翻倍。
    // 【只在宽屏上要求"一行高"】360~390px 那样窄的竖屏下，行标 + 输入框 + 范围提示
    // 本来就放不下一行 —— 旧的 2×2 冷却网格在那两档下也是两行。
    // 窄屏下改为验"没有横向溢出"，那才是窄屏真正会坏的地方（见下面的 docOver）。
    check(vp.w < 600 || (port.setupUi.coolRowH <= 48 && port.setupUi.phaseRowH <= 48),
      vp.tag + " 英文下冷却 / 相位两行各占一行、没有折行",
      JSON.stringify({ 冷却行高: port.setupUi.coolRowH, 相位行高: port.setupUi.phaseRowH }));
    // 竖屏下 #stage 翻成了上下分栏，设置区在【下面】—— 角落小字说的也得是"与下方设置无关"
    const tagPort = JSON.parse(await ev(`(() => {
      Game.openSetup();
      const R = (id) => document.getElementById(id).getClientRects().length > 0;
      return JSON.stringify({ right: R("previewTagRight"), below: R("previewTagBelow"),
                              text: document.getElementById("previewTag").textContent });
    })()`));
    check(tagPort.below && !tagPort.right,
      vp.tag + " 竖屏：角落小字说的是「与下方设置无关」",
      JSON.stringify(tagPort));

    check(port.setupUi.labelLines.every((x) => x <= 1),
      vp.tag + " 英文的每个行标都只占一行（宽度贴合文字，不折行）",
      JSON.stringify(port.setupUi.labelLines));
    // ---- 竖屏 + 选了「人机」：拉条那一行会不会压到下一行、会不会探出屏幕 ----
    // 【为什么单测这一档】拉条是这一行里唯一宽度随语言变的控件，而竖屏可用宽度只有
    // 三百多像素 —— 俄语/法语下它最可能把这一行挤折，而挤折本身不报错，
    // 只表现为两行贴在一起（那正是 v2.8.1 修过的按钮互相压住）。
    const portAi = JSON.parse(await ev(`(() => {
      Game.openSetup(); Game.setSetupMode(false); Game.setSetupAi("cpu"); Game.setSetupLevel(4);
      const R = (id) => document.getElementById(id).getBoundingClientRect();
      const row = R("aiRow"), lvl = R("aiLevelRow"), rng = R("aiRange"), nxt = R("orderRow");
      return JSON.stringify({
        rowBottom: row.bottom, lvlTop: lvl.top, lvlBottom: lvl.bottom, nextTop: nxt.top,
        rangeLeft: rng.left, rangeRight: rng.right, vw: window.innerWidth,
        rowH: Math.round(row.height), lvlH: Math.round(lvl.height),
        docOver: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      });
    })()`));
    // 三行依次是「对手」「强度」「谁先下」，两两之间都不许叠上
    check(portAi.rowBottom <= portAi.lvlTop + 0.5 && portAi.lvlBottom <= portAi.nextTop + 0.5,
      vp.tag + " 选人机后：对手 / 拉条 / 谁先下 三行没有互相压住",
      JSON.stringify(portAi));
    check(portAi.rangeLeft >= -0.5 && portAi.rangeRight <= portAi.vw + 0.5,
      vp.tag + " 选人机后：拉条完整落在屏幕里",
      "left=" + portAi.rangeLeft + " right=" + portAi.rangeRight + " 视口=" + portAi.vw);
    check(portAi.docOver <= 1, vp.tag + " 选人机后：整页没有横向滚动", "溢出 " + portAi.docOver + "px");
    await ev(`Game.setSetupAi("human"); 1`);

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
                           document.getElementById("langList"),
                           document.getElementById("inscription")]);
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
    const allow = new Set([document.getElementById("langBtn"), document.querySelector(".seal"),
                           document.getElementById("inscription")]);
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
      // 人机那两屏。【顺序要紧】它们必须排在上面的"对局界面"之后：起始界面·人机
      // 会把 setupAi 设成 strong，而 newGame 是照 setupAi 开局的 —— 排在前面的话，
      // 上面那条"对局界面"就变成人机局了，后面所有几何断言都会在一个会自动走棋的
      // 棋盘上做。所以下面那条最后会把 setupAi 复位成 human。
      ["起始界面·人机", `Game.openSetup(); Game.setSetupMode(false);
                         Game.setSetupAi("cpu"); Game.setSetupLevel(4); Game.setSetupOrder("cpu"); 1`],
      ["对局界面·人机", `Game.closeSetup(); Game.newGame([15,15,15], 1);
                         Game.cancelAiTimer(); Game.runAi();
                         Game.setSetupAi("human"); Game.cancelAiTimer(); 1`],
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
      const s = document.getElementById("setup");
      const status = document.getElementById("status");
      return JSON.stringify({
        modeLines: tops(mode),
        coolRowH: Math.round(document.getElementById("coolRow").getBoundingClientRect().height),
        phaseRowH: Math.round(document.getElementById("phaseRow").getBoundingClientRect().height),
        labelLines: [...document.querySelectorAll(".rowLabel")].map(lines),
        docOver: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        setupOver: s.scrollWidth - s.clientWidth,
        statusLines: lines(status), statusText: status.textContent,
      });
    })()`);
    const g = JSON.parse(geo);
    check(g.modeLines === 1, lang + "：3D / 4D 两个模式键在同一行", JSON.stringify(g.modeLines));
    // v3.0.0：冷却和相位周期都是手填数字输入框，各占一行
    // 这一档是 1280×800（大屏），所以可以要求一行高
    check(g.coolRowH <= 48 && g.phaseRowH <= 48, lang + "：冷却 / 相位两行各占一行",
          g.coolRowH + "px / " + g.phaseRowH + "px");
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

  // -------------------------------------------------------------------------
  // 电脑对手
  //
  // 【为什么放在最后】它会开人机局、会让电脑真的落子。放在中间的话，后面那些几何
  // 断言测的就是一个"有人在自动走棋"的棋盘 —— 那种失败极难查到 AI 头上。
  //
  // 【为什么这一节真的等定时器】"电脑会不会自己动"只有让真定时器烧到才算验过：
  // dom-smoke 那边走的是手动驱动 runAi，验的是决策和落子，验不到"定时器这一环接上没接上"。
  // -------------------------------------------------------------------------

  await ev(`(() => {
    Game.setLang("zh"); Game.openSetup(); Game.setSetupMode(false);
    Game.setSetupAi("cpu"); Game.setSetupLevel(4); Game.setSetupOrder("cpu");
    return 1;
  })()`);
  await sleep(150);
  const aiSetupRaw = await ev(`(() => {
    const aiIds = ["aiHuman","aiCpu"];
    const sel = aiIds.filter((id) => document.getElementById(id).classList.contains("sel"));
    const labelLines = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return rg.getClientRects().length; };
    const sum = document.getElementById("sizeSummary");
    return JSON.stringify({
      vis: ["aiHuman","aiCpu","aiRange","aiLevelName","orderMe","orderCpu"]
             .map((id) => document.getElementById(id).getClientRects().length > 0),
      selCount: sel.length, selIs: sel[0],
      dimmed: document.getElementById("aiRange").disabled,
      lvCenterOff: (() => {
        // 拉条自己应当落在这一行的正中：档位名脱离文档流挂在右边，不参与居中
        const r = document.getElementById("aiRange").getBoundingClientRect();
        const row = document.getElementById("aiLevelRow").getBoundingClientRect();
        return Math.round((r.left + r.right) / 2 - (row.left + row.right) / 2);
      })(),
      lv: document.getElementById("aiLevel").dataset.lv,
      hintText: document.getElementById("aiHint").textContent,
      hintShown: document.getElementById("aiHint").getClientRects().length > 0,
      lvName: document.getElementById("aiLevelName").textContent,
      rangeVal: document.getElementById("aiRange").value,
      pct: document.getElementById("aiLevel").style.getPropertyValue("--pct"),
      // 【不能拿 top 去数行数】拉条比按钮高一两像素，而 .row 是 align-items:center ——
      // 居中对齐让它们 top 不同，于是同一行被数成两行。量整行高度才是对的：
      // 单行时约 40px（#setup .row 的 min-height），折行必定 >= 80px。
      aiRowH: Math.round(document.getElementById("aiRow").getBoundingClientRect().height),
      aiLevelRowH: Math.round(document.getElementById("aiLevelRow").getBoundingClientRect().height),
      orderDisabled: [document.getElementById("orderMe").disabled, document.getElementById("orderCpu").disabled],
      labelWrapped: ["rowLabelAi","rowLabelOrder"].map((id) => labelLines(document.getElementById(id))),
      summary: sum.textContent, summaryScrolls: sum.scrollHeight > sum.clientHeight + 1,
      docOver: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      setupOver: document.getElementById("setup").scrollWidth - document.getElementById("setup").clientWidth,
    });
  })()`);
  const AS = JSON.parse(aiSetupRaw);
  check(AS.vis.every(Boolean), "人机那两行的六个键都看得见", JSON.stringify(AS.vis));
  check(AS.selCount === 1 && AS.selIs === "aiCpu",
    "人类/人机里恰好选中「人机」", JSON.stringify([AS.selCount, AS.selIs]));
  check(AS.dimmed === false, "选了人机时拉条可点（不淡显）");
  // 拉条本身要在这一行的正中间 —— 档位名如果在文档流里，居中的就是"拉条+名字"那一整块，
  // 拉条会偏左半个名字的宽度。这里钉住"偏差不超过 1px"。
  check(Math.abs(AS.lvCenterOff) <= 1, "拉条自己落在这一行的正中（档位名不参与居中）",
        "偏 " + AS.lvCenterOff + "px");
  check(AS.lv === "4" && AS.rangeVal === "4" && AS.lvName.length > 0,
    "拉条停在最高档，右边写着档位名", JSON.stringify([AS.lv, AS.rangeVal, AS.lvName]));
  check(AS.pct === "100.0%", "填充比例跟着档位走", AS.pct);
  check(AS.aiRowH <= 48, "人类/人机两个键在同一行（1280 宽的窗口下）", AS.aiRowH + "px 高");
  check(AS.aiLevelRowH <= 48, "强度拉条自己占一行、没有折行", AS.aiLevelRowH + "px 高");
  // 极限档的耗时小字。**两件事一起验**：字真的出来了，而且它没有把这一行撑高 ——
  // 撑高就会把下面所有行往下推，而用户明确要求"不影响其他按键的位置"。
  check(AS.hintShown && AS.hintText.length > 0,
    "拉到「极限」时拉条下方出现耗时提示", JSON.stringify([AS.hintShown, AS.hintText]));
  check(AS.aiLevelRowH <= 48,
    "多了提示之后拉条那一行仍然没有变高（提示是脱离文档流的）", AS.aiLevelRowH + "px 高");

  // ---- 真的能拖吗 ----
  // 【这一条是冲着用户反馈"实测没法拉动"去的】上一版是五个按钮拼的假拉条，只能点。
  // 这里按的是真鼠标：按住滑块、往右拖、松开，看 value 有没有跟着走。
  const rbox = JSON.parse(await ev(`(() => {
    Game.setSetupLevel(0);
    const r = document.getElementById("aiRange").getBoundingClientRect();
    return JSON.stringify({ l: r.left, t: r.top, w: r.width, h: r.height });
  })()`));
  const ry = rbox.t + rbox.h / 2;
  await mouseAt("mousePressed", rbox.l + 8, ry, { button: "left", buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 8; i++) {
    await mouseAt("mouseMoved", rbox.l + 8 + (rbox.w - 16) * i / 8, ry, { button: "left", buttons: 1 });
    await sleep(16);
  }
  await mouseAt("mouseReleased", rbox.l + rbox.w - 8, ry, { button: "left", buttons: 0, clickCount: 1 });
  await sleep(150);
  const dragged = JSON.parse(await ev(`JSON.stringify({
    v: document.getElementById("aiRange").value,
    lv: document.getElementById("aiLevel").dataset.lv,
    pct: document.getElementById("aiLevel").style.getPropertyValue("--pct"),
    name: document.getElementById("aiLevelName").textContent,
  })`));
  check(dragged.v === "4" && dragged.lv === "4",
    "拉条拖得动：按住滑块拖到最右，档位跟着到最高档", JSON.stringify(dragged));
  check(dragged.pct === "100.0%", "拖完之后填充比例也跟到了底", dragged.pct);

  // 选「人类」时：淡显 + 不可点，**但不隐藏** —— 和 #coolRow 在三维下同一套。
  // 隐藏（visibility）会留一条空白，摘掉（display:none）会让下面所有行上移、整屏跳一下。
  const humanLv = JSON.parse(await ev(`(() => {
    Game.setSetupAi("human");
    const r = document.getElementById("aiRange");
    return JSON.stringify({
      disabled: r.disabled,
      dim: document.getElementById("aiLevel").classList.contains("dim"),
      rowH: Math.round(document.getElementById("aiLevelRow").getBoundingClientRect().height),
      vis: document.getElementById("aiLevelRow").getClientRects().length > 0,
    });
  })()`));
  check(humanLv.disabled && humanLv.dim, "选了人类时拉条淡显且不可点", JSON.stringify(humanLv));
  check(humanLv.vis && humanLv.rowH > 0,
    "选了人类时拉条那一行仍然占位（切回人机时不会整屏跳）", humanLv.rowH + "px");
  // 切回中间档：提示必须消失、拉条落回原位、行高不变
  const hintOff = JSON.parse(await ev(`(() => {
    Game.setSetupLevel(2);
    const r = document.getElementById("aiRange").getBoundingClientRect();
    const row = document.getElementById("aiLevelRow").getBoundingClientRect();
    return JSON.stringify({
      shown: document.getElementById("aiHint").getClientRects().length > 0,
      text: document.getElementById("aiHint").textContent,
      rowH: Math.round(row.height),
      off: Math.round((r.left + r.right) / 2 - (row.left + row.right) / 2),
    });
  })()`));
  check(!hintOff.shown && hintOff.text === "",
    "切回中间档时提示消失", JSON.stringify(hintOff));
  check(Math.abs(hintOff.off) <= 1, "提示消失后拉条仍然居中", hintOff.off + "px");
  check(hintOff.rowH <= 48, "切回去之后那一行仍然没有变高", hintOff.rowH + "px");
  // 选了「人类」时提示也不许出现（拉条是 disabled + dim 的）
  const hintHuman = JSON.parse(await ev(`(() => {
    Game.setSetupAi("human"); Game.setSetupLevel(4);
    return JSON.stringify({
      shown: document.getElementById("aiHint").getClientRects().length > 0,
      text: document.getElementById("aiHint").textContent,
    });
  })()`));
  check(!hintHuman.shown && hintHuman.text === "",
    "选了「人类」时（拉条灰着）不出现耗时提示", JSON.stringify(hintHuman));

  await ev("Game.setSetupAi(\"cpu\"); Game.setSetupLevel(4); 1");
  check(AS.orderDisabled[0] === false && AS.orderDisabled[1] === false,
    "选了电脑时「谁先下」是可用的", JSON.stringify(AS.orderDisabled));
  check(AS.labelWrapped.every((n) => n <= 1), "人机那两行的行标没有折行", JSON.stringify(AS.labelWrapped));
  check(AS.summary.indexOf("你执") >= 0 && AS.summary.indexOf("电脑执") >= 0,
    "起始界面把「我执哪个色」说清楚了（光看按钮的选中态推不出来）", AS.summary.slice(-70));
  check(!AS.summaryScrolls, "#sizeSummary 里多出来的那一行没有把它挤到要滚动才看得见");
  // 留一张「选中电脑档」的截图：拉条的滑块只有在这一屏才看得见（选了人类时它是收起的）。
  // 先把上一种语言扫描时留下的提示清掉 —— 它不会随语言重刷（提示是当时那一瞬的话），
  // 留在图上会是一句外语压在中文界面上。
  await ev(`Game.el.toast.classList.remove("on"); 1`);
  await sleep(250);
  await shot("8-起始界面-电脑档");

  // ---- 起始界面的总高：英文版比中文高一截（规则摘要固定高 + 说明多两行），
  // 加了两行人机行之后「开始游戏」被挤出了视口 —— 这条把它钉住。
  // 【为什么要六种语言全量一遍】高度差得很远：英文的规则摘要固定高 108px、
  // 说明还要多折两行，俄语的按钮文案最长、行更容易折。只量中文会漏掉真正溢出的那一种
  // （第一版就是这么漏的：量的是中文，过了，而英文截图里按钮是切掉的）。
  //
  // 【为什么要先关掉触屏模拟】前面测触屏时开着 touch 模拟，`pointer: coarse` 成立，
  // 于是 CSS 的小屏那一档（--compact）一直是打开的 —— 按键、标题全都小一档，
  // 量出来的"最差语言"比真实排版矮 41px，这条断言就成了空转。
  await send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await send("Emulation.setDeviceMetricsOverride",
    { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(200);
  const startWorst = JSON.parse(await ev(`(() => {
    const keep = Game.lang;
    let worst = null;
    for (const l of ["zh","en","ja","ko","ru","fr"]) {
      Game.setLang(l); Game.openSetup(); Game.setSetupMode(false);
      const r = document.getElementById("startBtn").getBoundingClientRect();
      const s = document.getElementById("setup");
      const m = { lang: l, bottom: Math.round(r.bottom), vh: window.innerHeight,
                  over: Math.round(r.bottom - window.innerHeight),
                  contentH: s.scrollHeight, boxH: s.clientHeight };
      if (!worst || m.over > worst.over) worst = m;
    }
    Game.setLang(keep); Game.openSetup();
    return JSON.stringify(worst);
  })()`));
  check(startWorst.over <= 0,
    "起始界面「开始游戏」六种语言都不用滚动就看得见",
    "最差是 " + startWorst.lang + "：按钮下沿 " + startWorst.bottom + "，视口 " + startWorst.vh +
    "，超出 " + startWorst.over + "px（内容 " + startWorst.contentH + " / 可视 " + startWorst.boxH + "）");
  // 【量完要把视口和触屏还原】不还原的话，后面那几张截图会在这个 1280×800 的临时视口下拍 ——
  // 实测过一次：7-人机对战.png 整张变成了 1280 宽，而它是 1568 宽那一版才有意义。
  await send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await send("Emulation.clearDeviceMetricsOverride");
  await sleep(200);

  // ---- 左右两半的纸纹必须一模一样 ----
  // 【为什么要有这一条】缝（一条硬边）之前就修掉了，但两半的【亮度】还差着一档：
  // 画布是 opacity .3 的，而它的清屏色原本不透明 —— 左边于是只剩 70% 强度的纸纹
  // （0.3 × 纯色 + 0.7 × 纸纹），右边是满的。看上去不像两块拼接的纸了，但仍是两种底色。
  // 修法是起始界面把画布清成【全透明】（画布因此必须开 alpha）。这里直接问 GL 要清屏色的 alpha。
  const clearAlpha = JSON.parse(await ev(`(() => {
    const keep = Game.setupOpen;
    Game.openSetup(); Game.draw3D();
    const a = Renderer.gl.getParameter(Renderer.gl.COLOR_CLEAR_VALUE);
    Game.closeSetup(); Game.draw3D();
    const b = Renderer.gl.getParameter(Renderer.gl.COLOR_CLEAR_VALUE);
    if (keep) Game.openSetup(); else Game.closeSetup();
    return JSON.stringify({ preview: a, inGame: b });
  })()`));
  check(clearAlpha.preview[3] === 0 && clearAlpha.inGame[3] === 1,
    "起始界面的画布清成全透明（纸纹才会原样透出来）、对局里仍然不透明",
    JSON.stringify(clearAlpha));
  // 【透明必须是"透明的黑"，不能是"(--bg 的 RGB, alpha 0)"】
  // 画布是 premultipliedAlpha，缓冲区里存的是预乘过的颜色 —— alpha=0 就意味着 RGB 也必须全是 0。
  // 而 clearColor 是把 RGB 原样写进去、不做预乘的，于是 (239,232,219,0) 这组
  // "RGB 比 alpha 还大"的非法值交给合成器之后，**左半屏被合成为纯白**，比不透明清屏还糟。
  // 上面那条只看 alpha，这种错它一个字都看不出来（alpha 确实是 0），所以这里必须把 RGB 也钉住。
  check(clearAlpha.preview[0] === 0 && clearAlpha.preview[1] === 0 && clearAlpha.preview[2] === 0,
    "起始界面的透明是「透明的黑」(0,0,0,0)，不是把 --bg 的 RGB 配上 alpha 0（那会整块合成成白色）",
    "实际 " + JSON.stringify(clearAlpha.preview) +
    "；premultipliedAlpha 下 RGB 比 alpha 大是非法值，合成结果不可预期");

  // ---- 合成之后，左边那半张纸必须和右边一模一样 ----
  //
  // 【为什么非要截图数像素】上面两条查的都是**画布自己**的状态，而这件事发生在
  // **合成器**里：画布读回来 alpha 全是 0、清屏值也确实是透明的黑，可它贴到页面上之后
  // 左边还是白的。JS 看不见那一步，只有截了图才现形。这个 bug 已经真的出过一次
  // （v2.10.7），当时上面那两条断言全绿、页面却是纯白。
  //
  // 【判据为什么是"藏起画布前后逐点相同"】不拿左右两半直接比：纸纹本身是横跨整个视口的
  // 渐变色（16%/18% 一处白晕、84%/82% 一处暗晕），左右两半本来就该有系统性的色差，
  // 直接比会把正常现象判成错。改成比"同一个点、同一时刻，画布可见 vs 藏起"——
  // 演示盘是透明的、压着 opacity .3，**它对底下的纸必须是零影响**。
  // 这个判据与棋盘转到哪个角度、纸纹落在哪里都无关。
  //
  // 阈值是量出来的，不是拍的：修好之后 112 个采样点里 70 个（63%）逐字节相同、
  // 差值中位数 0（不相同的那些是演示棋盘自己的格线和棋子），
  // 而出错那一版是 **0 个相同、差值中位数 28**。取 40% 留足余量。
  await freezePreview(-28);
  const grid = [];
  for (let gy = 0.04; gy <= 0.96; gy += 0.06)
    for (let gx = 0.04; gx <= 0.40; gx += 0.06) grid.push([gx, gy]);
  const withGl = await shotPixels();
  const visPx = grid.map((g) => withGl.at(g[0], g[1]));
  await ev(`document.getElementById("gl").style.visibility = "hidden"; 1`);
  await sleep(200);
  const noGl = await shotPixels();
  const hidPx = grid.map((g) => noGl.at(g[0], g[1]));
  await ev(`document.getElementById("gl").style.visibility = ""; 1`);
  await sleep(120);

  let sameN = 0;
  const diffs = [];
  for (let i = 0; i < visPx.length; i++) {
    const d = Math.max(Math.abs(visPx[i][0] - hidPx[i][0]), Math.abs(visPx[i][1] - hidPx[i][1]),
                       Math.abs(visPx[i][2] - hidPx[i][2]));
    diffs.push(d);
    if (d <= 3) sameN++;
  }
  const sorted = diffs.slice().sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  const pct = Math.round(100 * sameN / visPx.length);
  // 前置：左边那张纸得是**暖色**（R 明显大于 B）。纯白 R−B = 0 —— 这正是出错时的样子。
  // 没有这条的话，两边同时变白时"逐点相同"会假通过。
  const warm = hidPx.map((c) => c[0] - c[2]).sort((a, b) => a - b)[hidPx.length >> 1];
  check(warm >= 10,
    "前置：藏起画布后左半屏是暖色纸（不是纯白）—— 纸质 #efe8db 的 R−B ≈ 20，纯白是 0",
    "R−B 中位数 = " + warm + "，左上角像素 " + JSON.stringify(hidPx[0]));
  check(pct >= 40 && median <= 2,
    "起始界面：演示画布对底下的纸零影响（藏起画布前后左半屏逐点相同）",
    "112 点里相同 " + pct + "%、差值中位数 " + median +
    "（预期 ≥40% 且中位数 ≤2；出错那一版是 0% / 28）");

  // ---- 角落小字的方位要跟着屏幕方向走 ----
  // 横屏时设置区在右边（#stage 左右分栏），竖屏时在下面（翻成上下分栏）。
  const tagLand = JSON.parse(await ev(`(() => {
    Game.openSetup();
    const R = (id) => document.getElementById(id).getClientRects().length > 0;
    return JSON.stringify({ right: R("previewTagRight"), below: R("previewTagBelow"),
                            text: document.getElementById("previewTag").textContent });
  })()`));
  check(tagLand.right && !tagLand.below,
    "横屏：角落小字说的是「与右侧设置无关」",
    JSON.stringify(tagLand));

  check(AS.docOver <= 1 && AS.setupOver <= 1,
    "起始界面加了人机两行之后没有横向溢出", "doc " + AS.docOver + " / setup " + AS.setupOver);

  // 真定时器：电脑执先手，等它自己落子
  const ai0 = JSON.parse(await ev(`(() => {
    Game.closeSetup(); Game.setAiSeed(20260927); Game.newGame([15,15,15], 1);
    return JSON.stringify({ aiMode: Game.aiMode, aiColor: Game.aiColor,
                            pending: !!Game.aiPending, turn: Game.session.currentPlayer });
  })()`));
  check(ai0.aiMode && ai0.aiColor === 1 && ai0.pending,
    "电脑执先手：开局当场就排上了它的一手", JSON.stringify(ai0));
  await sleep(900);
  const ai1 = JSON.parse(await ev(`JSON.stringify({
    stones: Game.session.board.stoneCount, moves: Game.session.moveCount,
    status: Game.session.status, thinking: Game.aiThinking, pending: !!Game.aiPending,
    info: document.getElementById("info").textContent,
    statusLines: (() => { const rg = document.createRange();
                          rg.selectNodeContents(document.getElementById("status"));
                          return rg.getClientRects().length; })(),
  })`));
  check(ai1.stones === 1 && ai1.moves === 1, "真定时器烧到之后电脑自己落了一子", JSON.stringify(ai1));
  check(!ai1.thinking && !ai1.pending, "落完子之后不再是「思考中」", JSON.stringify(ai1));
  check(ai1.info.indexOf("电脑执") >= 0, "#info 报出了电脑执哪一方", ai1.info.slice(0, 90));
  check(ai1.statusLines <= 2, "人机模式下状态行仍然不超过两行", ai1.statusLines + " 行");

  // 交替走十几手：**一次都不许卡住**（卡住的表现是回合没交出去，下一手落不下）
  const aiLoop = JSON.parse(await ev(`(() => {
    let stuck = 0, guard = 0;
    const d = Game.session.board.dims;
    while (guard < 8 && Game.session.status === "Playing") {
      const before = Game.session.actionCount;
      // 我挑【离中心最近的空格】下。两件事一次办妥：
      //   · 不能写死坐标 —— 电脑可能正好占了那一格，那样"落不下"是正常的，
      //     会被误判成卡住（第一版就是这么红的）
      //   · 从中心往外找，棋才会聚在中间，这张截图才像一盘真棋而不是棋盘角落里的一堆
      Game.cancelAiTimer();
      const cz = Game.activeLayer;
      const cx = (d[0] - 1) >> 1, cy = (d[1] - 1) >> 1;
      const far = Math.max(d[0], d[1]);
      let found = false;
      for (let r = 0; r <= far && !found; r++) {
        for (let y = cy - r; y <= cy + r && !found; y++) {
          for (let x = cx - r; x <= cx + r && !found; x++) {
            if (y < 0 || y >= d[1] || x < 0 || x >= d[0]) continue;
            if (Game.session.board.isEmpty(x, y, cz)) { Game.tryPlace(x, y); found = true; }
          }
        }
      }
      const mid = Game.session.actionCount;
      Game.cancelAiTimer(); Game.runAi(); Game.cancelAiTimer();
      const after = Game.session.actionCount;
      if (Game.session.status === "Playing" && !(found && mid === before + 1 && after === mid + 1)) stuck++;
      guard++;
    }
    return JSON.stringify({ stuck: stuck, guard: guard, moves: Game.session.moveCount,
                            status: Game.session.status,
                            turn: Game.session.currentPlayer, aiColor: Game.aiColor });
  })()`));
  check(aiLoop.stuck === 0, "人机交替走 " + aiLoop.guard + " 轮，一次都没有卡住", JSON.stringify(aiLoop));
  check(aiLoop.moves >= 5, "人机对局真的走起来了", JSON.stringify(aiLoop));
  // 棋局可能在中途就分出胜负（强档对着随手下的对手，通常十几手就赢了）——
  // 那种情况下"轮到谁"已经不再按手数奇偶走了，所以只在还在下的时候查这一条。
  check(aiLoop.status !== "Playing" || (aiLoop.moves % 2 === 1) === (aiLoop.turn !== aiLoop.aiColor),
    "还在下的时候，轮到谁和手数对得上", JSON.stringify(aiLoop));

  // 留一张人机对局的截图。**"电脑下得像不像话"只有眼睛能判**，
  // 上面那些断言只能证明它合法、不卡死、算得快。
  await sleep(200);
  await shot("7-人机对战");

  const consoleAi = drainConsole();
  check(consoleAi.length === 0, "人机对战（含真定时器那一段）控制台没有输出", consoleAi.join("\n      "));

  // ---- 7j. 四维转动：执行 → 预览 → 确定 / 取消（**真鼠标点那三个按钮**）
  //
  // 【这一节防的是"预览了但看不出来"】预览的全部价值就是"你看得见转完的样子，
  // 而且知道它还没落地"。所以这里不调 Game.doRotate()，而是像玩家一样用真鼠标去点，逐条验：
  //   · 点「执行转动」→ 盘面真的变了（不是只翻了个状态位）
  //   · 两个键换了位置，但**这一行的几何一个像素都不动** —— 这是敢用 display:none 的前提，
  //     也是"手机端不许出现按钮位置错乱"那条要求在四维面板上的落点
  //   · 取消之后盘面逐格还原
  //   · 确定之后才记账、才换回合
  const clickEl = async (id) => {
    const p = JSON.parse(await ev(`(() => { const q = document.getElementById("${id}").getBoundingClientRect();
      return JSON.stringify({ x: Math.round(q.left + q.width / 2), y: Math.round(q.top + q.height / 2) }); })()`));
    await mouseAt("mousePressed", p.x, p.y, { button: "left", buttons: 1, clickCount: 1 });
    await mouseAt("mouseReleased", p.x, p.y, { button: "left", buttons: 0, clickCount: 1 });
    await sleep(140);
  };
  // 一个能看见四个键和这一行几何的快照；盘面用逐格字符串（比指纹更直接，红了也看得懂）
  const rotSnap = `JSON.stringify({
    board: (() => { const b = Game.session.board, d = b.dims; let s = "";
      for (let z = 0; z < d[2]; z++) for (let y = 0; y < d[1]; y++) for (let x = 0; x < d[0]; x++) s += b.get(x, y, z);
      return s; })(),
    preview: !!Game.rotPreview, rots: Game.session.rotationCount,
    turn: Game.session.currentPlayer, moves: Game.session.moveCount,
    goDisabled: document.getElementById("rotGo").disabled,
    goOff: document.getElementById("rotGo").classList.contains("off"),
    cfDisabled: document.getElementById("rotConfirm").disabled,
    caDisabled: document.getElementById("rotCancel").disabled,
    cfOff: document.getElementById("rotConfirm").classList.contains("off"),
    caOff: document.getElementById("rotCancel").classList.contains("off"),
    attn: document.getElementById("rotConfirm").classList.contains("attn"),
    row: (() => { const r = document.getElementById("rotGo").parentNode.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })(),
    /* 这一行里【看得见的那几个】各自的盒子。换键前后这两组必须逐像素相同 ——
       藏起来的那个当然没有盒子（width 0），所以比"可见的盒子"而不是比某个具体按钮。 */
    vis: Array.from(document.getElementById("rotGo").parentNode.children)
      .filter((e) => e.getBoundingClientRect().width > 0)
      .map((e) => { const q = e.getBoundingClientRect();
        return [Math.round(q.left), Math.round(q.top), Math.round(q.width), Math.round(q.height)]; }),
  })`;
  const setup4d = JSON.parse(await ev(`(() => {
    // 【必须先关掉电脑对手】上一节刚打完一盘人机，setupAi 还是 cpu ——
    // 那样 newGame 会把这一局也设成人机，于是"轮到谁"根本不受我们控制：
    // 电脑会自己走子、甚至自己转层，下面那些"点了没反应"全都不是按钮的错。
    Game.cancelAiTimer(); Game.setSetupAi("human");
    Game.closeSetup(); Game.setSetupMode(true); Game.setupCool = 0;
    Game.newGame([8, 8, 8], 1);
    const b = Game.session.board;
    [[0,0,0],[1,0,0],[2,3,0],[3,3,0],[4,4,0],[5,1,0]].forEach((c) => b.set(c[0], c[1], c[2], 1));
    Game.rotAxis = 0; Game.rotLayer = 0; Game.rotClockwise = true; Game.rotTurns = 1;
    Game.onBoardChanged(false); Game.refreshRotPanel();
    return ${rotSnap};
  })()`));
  // 前置：四个键都量得到（面板没被挤出屏幕/被别的元素压住），且「执行转动」真的可点。
  // 少了 disabled 这一条，一个"按钮是灰的"会让下面所有点击断言全红，而看不出为什么。
  check(setup4d.vis.length === 3 && setup4d.vis[0][2] > 20 && setup4d.vis[0][3] > 10 &&
        !setup4d.goOff && !setup4d.goDisabled,
    "前置：四维面板上那三个键（执行转动 / 确定操作 / 取消操作）都真的在屏幕上",
    JSON.stringify(setup4d.vis));
  // 留一张"平时"的图：确定/取消是什么样子只有眼睛能判（灰到什么程度、会不会看着像坏的）
  await shot("10-四维转动面板");
  check(setup4d.cfDisabled && setup4d.caDisabled && !setup4d.attn,
    "平时「确定操作」「取消操作」是灰的、点不动的（不用先点一下什么才生效）",
    JSON.stringify({ cf: setup4d.cfDisabled, ca: setup4d.caDisabled, attn: setup4d.attn }));

  // 【三个键挤不挤得下】「执行转动 / 确定操作 / 取消操作」都是四个汉字，
  // 而面板在竖屏手机上只有一百多像素宽。窄一档就得当场量：横向不许溢出、
  // 每个键不许被压成两行（压成两行整块面板会变高，把棋盘挤扁）。
  //
  // 【六种语言都要过，取最差的那一种】这是这个工程里反复踩过的一条：只测中文的话，
  // 俄语的「Подтвердить」比「确定操作」长一倍，中文过了一切正常、俄语被切掉半截。
  // 判据用 scrollWidth > clientWidth —— 按钮上写了 overflow:hidden，
  // 放不下的字会被**切掉而不是换行**，那种坏法眼睛很难发现（切在字中间）。
  for (const vw of [393, 320]) {
    await send("Emulation.setDeviceMetricsOverride",
      { width: vw, height: 780, deviceScaleFactor: 2, mobile: true });
    await ev(`(() => { Game.resize(); Game.refreshRotPanel(); return 1; })()`);
    await sleep(200);
    const keep = await ev(`Game.lang`);
    let worst = null, clipped = null, worstH = 0;
    for (const lang of ["zh", "en", "ja", "ko", "ru", "fr"]) {
      await ev(`(() => { Game.setLang("${lang}"); Game.refreshRotPanel(); return 1; })()`);
      const m = JSON.parse(await ev(`(() => {
        const ids = ["rotGo", "rotConfirm", "rotCancel"];
        const panel = document.getElementById("rotPanel").getBoundingClientRect();
        const boxes = ids.map((id) => { const e = document.getElementById(id);
          const q = e.getBoundingClientRect();
          return { id: id, l: Math.round(q.left), r: Math.round(q.right), h: Math.round(q.height),
                   over: e.scrollWidth - e.clientWidth }; });
        return JSON.stringify({ vw: window.innerWidth, panelR: Math.round(panel.right),
          boxes: boxes, txt: ids.map((id) => document.getElementById(id).textContent).join("·"),
          docOver: document.documentElement.scrollWidth - window.innerWidth });
      })()`));
      const mostOver = Math.max.apply(null, m.boxes.map((b) => b.over));
      if (!worst || mostOver > worst.over) worst = { lang: lang, over: mostOver, txt: m.txt,
        w: m.boxes.map((b) => b.r - b.l), right: Math.max.apply(null, m.boxes.map((b) => b.r)),
        panelR: m.panelR, docOver: m.docOver };
      if (mostOver > 0 && !clipped) clipped = lang + " 的「" + m.txt + "」";
      worstH = Math.max(worstH, Math.max.apply(null, m.boxes.map((b) => b.h)));
    }
    await ev(`(() => { Game.setLang("${keep}"); Game.refreshRotPanel(); return 1; })()`);
    // 【先证明这次测量不是空转】量到 0 宽 0 高的话，下面几条会因为"0 ≤ 阈值"永远绿。
    check(worst.w.every((w) => w > 20) && worstH > 10,
      "前置：窄屏 " + vw + "px 下那三个键真的量得到（不是 0 宽 0 高的空壳）",
      JSON.stringify(worst));
    // 【别在这里写"还空多少 px"】scrollWidth 在 overflow:hidden 上会被夹到 clientWidth，
    // 所以 over 恒 ≥ 0，量不出"还剩多少余量"。0 只说明"没被切" —— 而这正是要的判据。
    console.log("  " + vw + "px 宽（六语最差 " + worst.lang + "）：三个键宽 " +
      worst.w.join("/") + "，高 " + worstH + "，最长的一个超出 " + worst.over + "px");
    check(!clipped && worst.over <= 0,
      "四维面板三个键在 " + vw + "px 宽的屏上、六种语言里都不被切字",
      clipped ? clipped + " 被切掉了 " + worst.over + "px" : "");
    check(worst.docOver <= 0 && worst.right <= worst.panelR + 1,
      "四维面板在 " + vw + "px 宽的屏上不横向溢出（六语最差是 " + worst.lang + "）",
      "最右 " + worst.right + " / 面板右沿 " + worst.panelR + "，整页溢出 " + worst.docOver + "px");
    check(worstH <= 40,
      "四维面板在 " + vw + "px 宽上三个键都没有被压成两行（六种语言）",
      "最高的一个 " + worstH + "px");
  }
  await send("Emulation.clearDeviceMetricsOverride");
  await send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await ev(`(() => { Game.resize(); Game.refreshRotPanel(); return 1; })()`);
  await sleep(250);

  await clickEl("rotGo");
  const preview = JSON.parse(await ev(rotSnap));
  check(preview.preview && preview.rots === 0 && preview.moves === setup4d.moves &&
        preview.turn === setup4d.turn,
    "点「执行转动」进入预览：盘面转了，但没记账、没换回合（这一手还没落地）",
    JSON.stringify({ preview: preview.preview, rots: preview.rots, turn: preview.turn }));
  check(preview.board !== setup4d.board,
    "预览期间盘面是真的变了（看得见效果，不是只翻了个状态位）");
  check(preview.goDisabled && !preview.cfDisabled && !preview.caDisabled && preview.attn,
    "预览中：执行转动变灰（不许再开一个预览），确定/取消亮起来并戴上亮圈",
    JSON.stringify({ go: preview.goDisabled, cf: preview.cfDisabled, attn: preview.attn }));
  // 【这一行不许动】换上去的是同样数目的 flex:1 格子，所以位置尺寸必须逐像素相同 ——
  // 一旦有人给新键加了 padding 或者忘了 flex，手机板上这一行就会跳，这条会当场红。
  check(JSON.stringify(preview.row) === JSON.stringify(setup4d.row) &&
        JSON.stringify(preview.vis) === JSON.stringify(setup4d.vis),
    "点亮前后那一行的位置和尺寸一个像素都不动（手机端按钮错位的老毛病）",
    "行 " + JSON.stringify(setup4d.row) + " → " + JSON.stringify(preview.row) +
    "；三个格子 " + JSON.stringify(setup4d.vis) + " → " + JSON.stringify(preview.vis));
  await shot("9-四维转动预览");

  // 预览期间点棋盘：不许落子（棋盘是转过的样子，照它点会落错地方）
  const movesBefore = preview.moves;
  await ev(`(() => { const cz = Game.activeLayer;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++)
      if (Game.session.board.isEmpty(x, y, cz)) { Game.tryPlace(x, y); return 1; }
    return 0; })()`);
  const afterPlace = JSON.parse(await ev(rotSnap));
  check(afterPlace.moves === movesBefore,
    "预览期间点棋盘落不下子（棋盘是转过的样子，照着它点会落错地方）",
    movesBefore + " → " + afterPlace.moves);

  await clickEl("rotCancel");
  const cancelled = JSON.parse(await ev(rotSnap));
  check(!cancelled.preview && cancelled.board === setup4d.board && cancelled.rots === 0,
    "点「取消操作」：盘面逐格还原，等于什么都没发生过",
    JSON.stringify({ preview: cancelled.preview, rots: cancelled.rots }));
  check(cancelled.cfDisabled && cancelled.caDisabled && !cancelled.goDisabled &&
        JSON.stringify(cancelled.vis) === JSON.stringify(setup4d.vis),
    "取消之后确定/取消退回灰显、执行转动重新可点，几何仍然没动",
    JSON.stringify(cancelled.vis));

  await clickEl("rotGo");
  await clickEl("rotConfirm");
  const committed = JSON.parse(await ev(rotSnap));
  check(!committed.preview && committed.rots === 1 &&
        committed.turn !== setup4d.turn && committed.moves === setup4d.moves,
    "点「确定操作」才真的落地：记了这一次转动、换了回合、落子数不变",
    JSON.stringify({ preview: committed.preview, rots: committed.rots, turn: committed.turn }));
  check(committed.board === preview.board,
    "确定之后盘面和预览时看到的一模一样（先还原再落地，两步不能互相吃掉）");
  check(committed.attn === false && committed.cfDisabled && committed.caDisabled,
    "落地之后亮圈收掉、两个键退回灰显不可点",
    JSON.stringify({ attn: committed.attn, cf: committed.cfDisabled }));

  // 【确定之后还能不能撤回来】面板上那个「恢复本次转动」已经让位给了这两个键，
  // 但**能力不能跟着按钮一起消失**：最后一步恰好是转动时「悔棋 Z」撤的就是它。
  // 这一条真点「悔棋」那个按钮，证明那条路是通的。
  await clickEl("undoBtn");
  const restored = JSON.parse(await ev(rotSnap));
  check(restored.rots === 0 && restored.board === setup4d.board && !restored.preview,
    "确定之后仍然撤得回来：点「悔棋」就把刚才那次转动撤掉了（盘面逐格还原）",
    JSON.stringify({ rots: restored.rots, preview: restored.preview }));

  const consoleRot = drainConsole();
  check(consoleRot.length === 0, "四维转动那一节控制台没有输出", consoleRot.join("\n      "));

  // 收尾：把电脑关掉，别让它影响后面任何东西
  await ev(`(() => {
    Game.cancelAiTimer(); Game.setSetupAi("human"); Game.setSetupMode(false);
    Game.openSetup();
    return 1;
  })()`);

  // ------------------------------------------------------------------
  // 拓扑（贯通）的影子子 —— **在真浏览器里量**
  //
  // 【为什么不能只在桩里验】这一档的全部意义是"看得见"：位置对不对、画没画出来、
  // 会不会浓到被当成真子，只有真的把像素读出来才算数。桩里那几条只证明算得像的个数对。
  // 【量什么】① 面板给外面那一圈留了位置（格距按 n+2 算）② 该有影子的格子真的非空
  // ③ 关掉拓扑之后同一格必须是干净的 ④ 外部那一圈不能落子。
  // ------------------------------------------------------------------
  {
    await ev(`(() => { Game.closeSetup(); Game.setSetupMode(true); Game.startTutorial();
      Game.tutorialBuild(1); return 1; })()`);
    await sleep(700);

    const probe = `(() => {
      const cv = document.getElementById('layerBase');
      const ctx = cv.getContext('2d');
      const W = cv.width, H = cv.height;
      const img = ctx.getImageData(0, 0, W, H).data;
      const dims = Game.session.board.dims, nx = dims[0], ny = dims[1];
      const w = cv.clientWidth, h = cv.clientHeight;
      const lay = Game.gridLayout(w, h, nx, ny);
      const px = (i) => lay.ox + i * lay.cs, py = (j) => lay.oy + j * lay.cs;
      const at = (i, j) => { const X = Math.round(px(i) * (W / w)), Y = Math.round((h - py(j)) * (W / w));
        const k = (Y * W + X) * 4; return [img[k], img[k+1], img[k+2], img[k+3]]; };
      // 该有影子的格子：当前层上"在边界"的那些子，各算一份像
      const board = Game.session.board, L = Game.activeLayer;
      const want = [];
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        if (board.get(i, j, L) === 0) continue;
        const ox = wrapImages(nx, i), oy = wrapImages(ny, j);
        if (!ox.length && !oy.length) continue;
        for (const dx of (ox.length ? ox : [0])) for (const dy of (oy.length ? oy : [0])) {
          if (!dx && !dy) continue;
          want.push([i + dx, j + dy]);
        }
      }
      // 参照色：壳上一个确定空的格子
      const ref = at(-1, 0);
      const far = (c) => Math.abs(c[0]-ref[0]) + Math.abs(c[1]-ref[1]) + Math.abs(c[2]-ref[2]);
      const hits = want.filter((p) => { const c = at(p[0], p[1]); return c[3] > 0 && far(c) > 6; });
      return JSON.stringify({
        cs: +lay.cs.toFixed(2), wantN: want.length, hitN: hits.length,
        expectCs: +Math.min(w / (nx + 2), h / (ny + 2)).toFixed(2),
        wrap: !!board.wrap, layer: L,
        // 外面那一圈点下去应当落空
        ringPick: Game.cellFromEvent({ clientX: lay.ox + nx * lay.cs, clientY: h - (lay.oy + 7 * lay.cs) },
                                     document.getElementById('layerBase')) ? 1 : 0
      });
    })()`;
    const on = JSON.parse(await ev(probe));
    check(on.wrap, "拓扑关：第 2 关确实是贯通模式", JSON.stringify(on));
    check(on.wantN > 0, "拓扑关：盘上确实有「在边界上、因此有影子」的子", JSON.stringify(on));
    check(on.hitN === on.wantN,
      "拓扑关：该有影子的 " + on.wantN + " 个格子上全都有东西（实际 " + on.hitN + "）",
      JSON.stringify(on));
    check(Math.abs(on.cs - on.expectCs) < 0.05,
      "拓扑关：面板格距按 n+2 算，给外面那一圈留了位置",
      "格距 " + on.cs + " 期望 " + on.expectCs);
    check(on.ringPick === 0, "拓扑关：点棋盘外面那一圈不落子", JSON.stringify(on));
    await shot("11-拓扑影子");

    // 关掉拓扑：同一格必须变回干净的面板底 —— 影子只该在拓扑模式下出现
    const off = JSON.parse(await ev(`(() => {
      Game.session.rules.wrapEdges = false;
      Game.session.board.wrap = false;
      Game.onBoardChanged(true);
      const cv = document.getElementById('layerBase');
      const ctx = cv.getContext('2d');
      const W = cv.width, H = cv.height;
      const img = ctx.getImageData(0, 0, W, H).data;
      const dims = Game.session.board.dims;
      const w = cv.clientWidth, h = cv.clientHeight;
      const lay = Game.gridLayout(w, h, dims[0], dims[1]);
      const at = (i, j) => { const X = Math.round((lay.ox + i * lay.cs) * (W / w));
        const Y = Math.round((h - (lay.oy + j * lay.cs)) * (W / w));
        const k = (Y * W + X) * 4; return [img[k], img[k+1], img[k+2], img[k+3]]; };
      // 这里格距已经按 n 算了，所以量的是"棋盘右边外面一格"那块 —— 关掉拓扑后应当是空底
      const c = at(dims[0], 7), ref = at(-1, 0);
      return JSON.stringify({ wrap: !!Game.session.board.wrap,
        diff: Math.abs(c[0]-ref[0]) + Math.abs(c[1]-ref[1]) + Math.abs(c[2]-ref[2]) });
    })()`));
    check(!off.wrap, "关掉拓扑之后 board.wrap 为假", JSON.stringify(off));
    check(off.diff <= 6, "非拓扑模式棋盘外那一格是干净的（没有影子）", JSON.stringify(off));

    await ev(`(() => { Game.tutorialExit(); Game.closeSetup(); return 1; })()`);
    await sleep(300);
  }

  // ------------------------------------------------------------------
  // 画布位图的尺寸必须跟得上它 CSS 框的尺寸。
  //
  // 【为什么单列一条】这是"教学里切换关卡之后棋盘被拉伸变形"那个 bug 的**根因**，
  // 而且它坏起来完全没有声音：右侧面板的布局一变（转动面板显隐、时间轴显隐、
  // 条带 compact），画布的 CSS 框就换了尺寸，而位图还是旧的那张 ——
  // 浏览器把旧位图**拉伸**到新框上，比例就歪了。实测过一次：1109×519 的位图
  // 铺进 1109×722 的框，纵向拉伸 1.39 倍，第一关切到第二关必现。
  //
  // 【为什么不靠"按钮没动"那条】那条量的是布局高度，位图尺寸是另一件事 ——
  // 布局一个像素没动、位图照样可以是旧的。两件事各钉各的。
  // ------------------------------------------------------------------
  {
    const stale = JSON.parse(await ev(`(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const want = (cv) => cv && cv.clientWidth
        ? { w: Math.max(1, Math.round(cv.clientWidth * dpr)),
            h: Math.max(1, Math.round(cv.clientHeight * dpr)),
            bw: cv.width, bh: cv.height } : null;
      const read = () => {
        const out = {};
        for (const id of ["layerBase", "strip", "timeline"]) out[id] = want(document.getElementById(id));
        return out;
      };
      const bad = [];
      const checkAt = (where) => {
        const r = read();
        for (const id in r) {
          const v = r[id];
          if (!v) continue;                       // 藏起来的不算
          if (v.w !== v.bw || v.h !== v.bh) {
            bad.push(where + " / " + id + "：CSS 算出 " + v.w + "×" + v.h +
                     "，位图却是 " + v.bw + "×" + v.bh);
          }
        }
      };
      Game.closeSetup(); Game.setSetupMode(true); Game.startTutorial();
      checkAt("第 1 关");
      Game.tutorialBuild(1); checkAt("第 2 关");   // 转动面板从有到无，面板变高
      Game.tutorialBuild(2); checkAt("第 3 关");   // 时间轴出现，面板变矮
      Game.tutorialBuild(0); checkAt("回到第 1 关");
      Game.tutorialExit(); Game.closeSetup();
      return JSON.stringify({ bad: bad, dpr: dpr });
    })()`));
    check(stale.bad.length === 0,
      "教学三关来回切，画布位图尺寸始终跟得上 CSS 框（否则浏览器会把旧位图拉伸，棋盘变形）",
      JSON.stringify(stale.bad));
  }

  // ------------------------------------------------------------------
  // v3.1.5：教学的两个翻页键与自动跳关。
  //
  // 【为什么必须真等那 1 秒】倒计时是 setTimeout 驱动的，桩里只能验"挂上了没有"。
  // 而它坏掉的样子是**无声的**：忘了 clearTimeout 就会"点了上一关，一秒后被拽回去"；
  // 该跳没跳则是"过关之后停在原地什么都不发生"，看起来像关卡设计成了死局。
  // 所以这里走的是真人那条路：真过关、真等、真点。
  //
  // 【键的位置为什么也要量】用户口径是"这两个按键在同一个位置" ——
  // 一颗键时必须正好落在原来「下一关」的那个槽里（右沿距视图右边 16px），
  // 两颗时「上一关」贴在「下一关」左边同一行。桩里量不了位置。
  // 顺带钉住"和左下角提示框不打架"：两块都贴着 #view 下沿，窄窗口下会撞。
  //
  // 【"不重叠"必须在**窄**视口下量才有意义】1600 宽的窗口里 #view 有 663 ——
  // 提示框自然宽 541、一颗键的左沿在 580，本来就够不着，让位 CSS 删掉也照样绿
  // （复核时被抓出来了）。真正会撞的是窄窗口：那一档的宽度由下面的
  // #view.tutTwo 让位规则兜着，所以这里把窄视口那一遍也量上。
  // ------------------------------------------------------------------
  {
    const NAV = `(() => {
      const box = (id) => { const el = document.getElementById(id);
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height),
                 right: Math.round(b.right), off: el.classList.contains("off") }; };
      const view = document.getElementById("view").getBoundingClientRect();
      return JSON.stringify({ prev: box("tutPrev"), next: box("tutNext"),
        hint: box("hintbox"), viewR: Math.round(view.right),
        idx: Game.tutIndex, passed: Game.tutPassed, active: Game.tutActive, timer: !!Game.tutTimer,
        done: document.getElementById("tutDone").textContent,
        doneWeight: getComputedStyle(document.getElementById("tutDone")).fontWeight,
        step: document.getElementById("tutStep").textContent,
        cls: document.getElementById("view").className });
    })()`;
    await ev(`(() => { Game.setLang("zh"); Game.closeSetup(); Game.setSetupMode(true);
      // 【先把提示框展开再进教学】它是"和翻页键抢地盘"的另一方，而这之前哪一节把它折起来过
      // （折起来只剩一颗小胶囊，宽度差着几百像素）—— 不展开的话下面那条"不重叠"就是空断言。
      Game.setHintFolded(false);
      Game.startTutorial(); return 1; })()`);
    await sleep(300);
    let d = JSON.parse(await ev(NAV));
    check(d.idx === 0 && d.prev.off && d.next.off && d.step === "第 1 / 3 关",
      "第 1 关开局：两个翻页键都不显示", JSON.stringify({ step: d.step }));

    // 真过关：第 1 关的解法 = z 轴第 5 层顺转 1 次
    await ev(`(() => { Game.rotAxis = 2; Game.rotLayer = 4; Game.rotClockwise = true; Game.rotTurns = 1;
      Game.doRotate(); Game.confirmRotation(); return 1; })()`);
    await sleep(150);
    d = JSON.parse(await ev(NAV));
    check(d.passed && d.done.indexOf("过关") >= 0, "过关：教学条上出现「过关」", JSON.stringify(d.done));
    check(parseInt(d.doneWeight, 10) >= 700, "「过关」是加粗的（用户口径：要明显一点）",
      "font-weight = " + d.doneWeight);
    check(d.timer && d.prev.off && d.next.off,
      "过关瞬间：倒计时在跑，两个翻页键都不显示（不会闪一下再消失）",
      JSON.stringify({ timer: d.timer, prev: d.prev.off, next: d.next.off }));

    await sleep(1300);
    d = JSON.parse(await ev(NAV));
    check(d.idx === 1 && d.step === "第 2 / 3 关", "约 1 秒后**自动**跳到第 2 关", d.step);
    check(!d.prev.off && d.next.off, "第 2 关只显示「上一关」（它还没解出来）",
      JSON.stringify({ prev: d.prev.off, next: d.next.off }));
    const prevOnly = d.prev;
    const hintAtOne = d.hint;
    check(prevOnly.right === d.viewR - 16,
      "只有「上一关」时它正好落在原来「下一关」那个槽里（右沿距视图右边 16px）",
      "键右沿 " + prevOnly.right + "、视图右沿 " + d.viewR);
    check(hintAtOne.x + hintAtOne.w <= prevOnly.x,
      "翻页键和左下角的提示框不重叠（一颗键）",
      "提示框右沿 " + (hintAtOne.x + hintAtOne.w) + " 键左沿 " + prevOnly.x);

    // 退回第 1 关：它过过 → 有「下一关」；而且和刚才那颗「上一关」**同一个位置**
    await ev(`document.getElementById("tutPrev").click()`);
    await sleep(250);
    d = JSON.parse(await ev(NAV));
    check(d.idx === 0 && !d.next.off && d.prev.off, "点「上一关」回到第 1 关，这时它显示「下一关」",
      JSON.stringify({ idx: d.idx, step: d.step }));
    check(d.next.x === prevOnly.x && d.next.y === prevOnly.y && d.next.w === prevOnly.w,
      "两个按键在同一个位置（上一关 / 下一关只是同一颗键的两个标签）",
      JSON.stringify({ 上一关: prevOnly, 下一关: d.next }));

    // 再往前 → 第 2 关，把它也过掉（补 (2,7,7) 成五）→ 自动跳第 3 关
    await ev(`document.getElementById("tutNext").click()`);
    await sleep(250);
    // 【先在倒计时那一秒里悔一手】到点时会再确认一次"这一关还成不成立"，
    // 不成立就留在原地（并把「下一关」亮出来）—— 不能把玩家从他刚撤回的局面里拽走。
    await ev(`(() => { Game.activeLayer = 7; Game.tryPlace(2, 7); Game.undo(); return 1; })()`);
    await sleep(1400);
    d = JSON.parse(await ev(NAV));
    check(d.idx === 1 && !d.timer && d.active,
      "过关那一秒里悔棋：到点不会把玩家拽去第 3 关", JSON.stringify({ idx: d.idx, step: d.step }));
    check(!d.next.off && !d.prev.off, "留在原地后「上一关」「下一关」都亮着（这一关算过过）",
      JSON.stringify({ prev: d.prev.off, next: d.next.off }));
    // 再老老实实过一遍 → 这回该自动跳了
    await ev(`(() => { Game.tryPlace(2, 7); return 1; })()`);
    await sleep(1300);
    d = JSON.parse(await ev(NAV));
    check(d.idx === 2 && d.step === "第 3 / 3 关", "第 2 关过完自动跳到第 3 关", d.step);
    check(!d.prev.off && d.next.off, "第 3 关只显示「上一关」", JSON.stringify({ prev: d.prev.off }));

    // 退回第 2 关：它过过了 → 两个键同时在，上一关在下一关左边同一行
    await ev(`document.getElementById("tutPrev").click()`);
    await sleep(250);
    d = JSON.parse(await ev(NAV));
    check(d.idx === 1 && !d.prev.off && !d.next.off, "从第 3 关退回第 2 关：两个键同时显示",
      JSON.stringify({ idx: d.idx, prev: d.prev.off, next: d.next.off }));
    check(d.prev.x + d.prev.w <= d.next.x && d.prev.y === d.next.y,
      "「上一关」在「下一关」左侧、同一行",
      JSON.stringify({ prev: [d.prev.x, d.prev.y, d.prev.w], next: [d.next.x, d.next.y] }));
    check(d.hint.x + d.hint.w <= d.prev.x, "两颗键时和提示框也不重叠（提示框按 tutTwo 让位）",
      "提示框右沿 " + (d.hint.x + d.hint.w) + " 键左沿 " + d.prev.x);
    check(d.cls.indexOf("tutTwo") >= 0, "两个键都在时 #view 挂上 tutTwo（提示框让位）", d.cls);
    await ev(`(() => { Game.el.toast.classList.remove("on"); Game.toastTimer = 0; return 1; })()`);
    await sleep(150);
    await shot("13-教学翻页键");

    // 第 3 关过完：**不自动退出**（用户口径 v3.1.5：最后一关停在盘上，玩家自己点退出）
    await ev(`document.getElementById("tutNext").click()`);
    await sleep(250);
    await ev(`(() => { Game.activeLayer = 7; Game.tryPlace(6, 7); return 1; })()`);
    await sleep(1600);
    d = JSON.parse(await ev(NAV));
    check(d.active && d.idx === 2 && d.passed && !d.timer,
      "第 3 关过完不自动退出：停在盘上显示「过关」", JSON.stringify({ active: d.active, idx: d.idx }));
    check(!d.prev.off && d.next.off, "最后一关没有「下一关」", JSON.stringify({ next: d.next.off }));

    // ---- 窄视口那一遍：两颗键 + 展开的提示框 + 教学条，三块谁都不许压谁
    //
    // 900×700 时 #view 只有 378：提示框让出 230 之后只剩 148 宽，同一段文字会折成
    // 很高的窄柱（实测 504px 高、顶到 182px），而教学条就在它上面（top:96、约 300 高、
    // 不透明）—— 没有 max-height 那一条就会压上去。这里三块两两量一次。
    await send("Emulation.setDeviceMetricsOverride",
      { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    const narrowNav = JSON.parse(await ev(`(() => {
      const r = (id) => { const b = document.getElementById(id).getBoundingClientRect();
        return { x: Math.round(b.left), y: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) }; };
      const hit = (p, q) => p.x < q.r && q.x < p.r && p.y < q.b && q.y < p.b;
      const hint = r("hintbox"), bar = r("tutBar"), prev = r("tutPrev"), next = r("tutNext");
      return JSON.stringify({ hint: hint, bar: bar, prev: prev, next: next,
        hintBar: hit(hint, bar), hintPrev: hit(hint, prev), hintNext: hit(hint, next),
        scrolls: (() => { const h = document.getElementById("hintbox");
          return h.scrollHeight - h.clientHeight; })() });
    })()`));
    check(!narrowNav.hintBar, "窄视口（900×700）下：提示框和教学条不重叠",
      JSON.stringify({ 提示框: narrowNav.hint, 教学条: narrowNav.bar }));
    check(!narrowNav.hintPrev && !narrowNav.hintNext,
      "窄视口下：提示框和两个翻页键都不重叠（让位 + 高度夹住之后的实际几何）",
      JSON.stringify({ 提示框: narrowNav.hint, 上一关: narrowNav.prev, 下一关: narrowNav.next }));
    await send("Emulation.clearDeviceMetricsOverride");
    await sleep(300);

    // ---- 「退出」要能把那 1 秒的倒计时一起带走
    //
    // 【为什么单列一条】cancelTutTimer 的调用点里，tutorialExit 那条最容易漏：
    // 漏了的话玩家点了退出、回了起始界面，1 秒后仍会被拽进下一关 —— 而桩里
    // 验不了"之后那一秒里发生了什么"。这里真等一次。
    await ev(`(() => { Game.setLang("zh"); Game.tutorialExit(); Game.setSetupMode(true);
      Game.startTutorial(); Game.tutorialBuild(1);
      Game.activeLayer = 7; Game.tryPlace(2, 7); return 1; })()`);   // 真过关 → 挂上倒计时
    await sleep(150);
    d = JSON.parse(await ev(NAV));
    check(d.passed && d.timer, "前置：这一关真的过了、倒计时真的挂上了", JSON.stringify({ timer: d.timer }));
    await ev(`(() => { document.getElementById("setupBtn").click(); return 1; })()`);   // 教学里的「退出」
    await sleep(150);
    const t = JSON.parse(await ev(`JSON.stringify({ active: Game.tutActive, timer: !!Game.tutTimer,
      setupOpen: Game.setupOpen, idx: Game.tutIndex })`));
    check(!t.active && !t.timer && t.setupOpen, "点「退出」：教学关掉、倒计时也取消（起始界面回来了）",
      JSON.stringify(t));
    await sleep(1400);
    const after = JSON.parse(await ev(`JSON.stringify({ active: Game.tutActive, setupOpen: Game.setupOpen,
      idx: Game.tutIndex, step: document.getElementById("tutStep").textContent })`));
    check(!after.active && after.setupOpen,
      "退出之后那一秒过去：不会被拽回教学（倒计时确实被 cancelTutTimer 带走了）",
      JSON.stringify(after));
    // 【那颗键的文案要还回去】教学里它写「退出」，退出之后必须写回「设置」——
    // 漏了的话会一直写着「退出」，而且没有任何别的断言看得见（实测踩过：
    // 一次开始教学之前已经在教学里，那句"把原文案记下来"记到的就是「退出」）。
    check(await ev(`document.getElementById("setupBtn").textContent`) === "设置",
      "退出教学之后那颗键写回「设置」（不是「退出」）",
      await ev(`document.getElementById("setupBtn").textContent`));

    await ev(`(() => { Game.tutorialExit(); Game.closeSetup(); Game.setSetupMode(false); return 1; })()`);
    // 【收尾：把状态还回去，别漏给后面的步骤】这一节转了两次层，rotLayer 会被留在
    // 第 5 层上 —— 而后面那两节（相位光圈 / 给 README 的那张对局图）都是"新建一局
    // 直接截图"，三维视图里那个绿框（待转的那一层）读的正是 rotLayer：
    // 漏掉这一步，截图里的绿框会跑到里层去（实测：12-四维三种机制 差 2.3 万像素，
    // 而它平时是逐字节稳定的那一张）。
    await ev(`(() => { Game.rotAxis = AXIS_Z; Game.rotLayer = 0;
      Game.rotClockwise = true; Game.rotTurns = 1; return 1; })()`);
    await sleep(200);
  }

  // ------------------------------------------------------------------
  // 相位光圈真的画出来了。
  //
  // 【为什么要看像素】v3.1.1 把"异相位淡显"换成了"每颗子外面一圈相位色薄光"。
  // 光圈算错颜色、画在子底下、或者干脆没画，棋照样能下完 —— 但玩家再也分不出
  // 哪颗子属于哪个相位，而"只有当前相位的连线算数"正是靠这个看的。
  // 桩里只能验"有一批实例进了幽灵缓冲"，验不了颜色；这里直接数二维面板上的像素。
  // ------------------------------------------------------------------
  {
    const halo = JSON.parse(await ev(`(() => {
      Game.setSetupMode(true); Game.startTutorial(); Game.tutorialBuild(2);   // 第三关：晨昏
      const cv = document.getElementById('layerBase');
      const img = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      // 光圈是半透明的相位色叠在浅色板面上，所以判据是"偏向蓝 / 偏向红"，
      // 不是等于某个具体色值。
      let blue = 0, red = 0;
      for (let i = 0; i < img.length; i += 4) {
        if (img[i + 3] < 200) continue;
        const r = img[i], g = img[i + 1], b = img[i + 2];
        if (b > r + 18 && b > 120 && b < 235 && g > r) blue++;
        else if (r > b + 22 && r > 150 && r < 245 && r > g + 10) red++;
      }
      // 前置：这一关确实两种相位都有子（否则"只数到一种颜色"可能是关卡摆错了）
      let dawn = 0, night = 0;
      Game.session.board.forEachStone((x, y, z, v) => { if (phaseOf(v) === 0) dawn++; else night++; });
      // 【三维那一遍单独钉一条】上面数的是**二维面板**的像素 —— 只关掉三维那一遍光圈，
      // 它照样全绿（实测过：把三维那段 if 条件改成 false，348 项一条都没红）。
      // 三维的光圈走幽灵缓冲，每颗子都推一个实例进 ghPos，所以：
      //   开着相位时，幽灵实例数**至少**等于盘上子数。
      // 关掉那一遍就不成立了（剩下的只有"非当前层的子 + 影子 + 最后一手"，比子数少）。
      const withHalo = Game.ghCount;
      Game.tutorialExit(); Game.closeSetup();
      return JSON.stringify({ blue: blue, red: red, dawn: dawn, night: night,
        stones: dawn + night, withHalo: withHalo });
    })()`));
    check(halo.dawn > 0 && halo.night > 0,
      "前置：第三关盘上两种相位的子都有（否则下面那条是空断言）", JSON.stringify(halo));
    check(halo.blue > 0 && halo.red > 0,
      "相位光圈画出来了：面板上同时数得到偏蓝和偏红的像素（永夜 / 黎明）",
      JSON.stringify(halo));
    check(halo.withHalo >= halo.stones,
      "三维那一边也画了：开着相位时幽灵实例数至少等于子数（每颗子都带一圈光圈）",
      JSON.stringify(halo));
  }

  // ------------------------------------------------------------------
  // v3.1.2：「设置」和「落子：正常/缓/催」在四维下交换位置（用户口径）
  //
  // 【为什么在真浏览器里量】桩里只能验类名挂没挂上；"换没换成"终究是几何问题 ——
  // flex 的 order 被别的规则盖掉、或者两个键宽度不同导致顺序看着没变，桩都看不见。
  // 判据用【左边界】比大小，不依赖它们等宽。
  // ------------------------------------------------------------------
  {
    const order = JSON.parse(await ev(`(() => {
      const box = (id) => document.getElementById(id).getBoundingClientRect();
      const shot = () => {
        const s = box("setupBtn"), m = box("modeBtn");
        return { setupLeft: Math.round(s.left), modeLeft: Math.round(m.left),
                 setupW: Math.round(s.width), modeW: Math.round(m.width),
                 bothVisible: s.width > 0 && m.width > 0 };
      };
      Game.cancelAiTimer(); Game.setSetupAi("human");
      Game.setSetupMode(true);  Game.newGame(8, 1);  const fourD = shot();
      Game.setSetupMode(false); Game.newGame(15, 1); const threeD = shot();
      return JSON.stringify({ fourD: fourD, threeD: threeD });
    })()`));
    check(order.fourD.bothVisible,
      "前置：四维下「设置」和「落子宣告」都真的在屏幕上", JSON.stringify(order.fourD));
    check(order.fourD.modeLeft < order.fourD.setupLeft,
      "四维下「落子：正常/缓/催」排在「设置」左边（两个键换了位置）",
      JSON.stringify(order.fourD));
    // 【三维下那颗键整颗不显示】晨昏是四维常开、三维恒为 0，所以声明键在三维下
    // display:none（宽高都是 0）—— 三维那一行本来就只有四颗键，没有"换位置"可言。
    // 这一条钉的正是"三维那一行和加交换规则之前一模一样"。
    check(order.threeD.setupW > 0 && order.threeD.modeW === 0,
      "三维下「设置」照旧在最后，「落子宣告」整颗不显示（那一行没被这条规则碰到）",
      JSON.stringify(order.threeD));
  }

  // ------------------------------------------------------------------
  // 一张给 README 用的对局截图：四维的三个机制同时看得见。
  //
  // 【为什么要专门摆一个局面】README 里原来只有一张设置界面 —— v3.1.x 那几个机制
  // （相位光圈 / 贯通影子）全在对局画面上，设置界面里一点都看不出来。
  // 这个局面按要展示的东西摆：
  //   · 贴边的黑子 → 棋盘外面那一圈有它们的**影子**（贯通）
  //   · 两种相位的子 → 红圈 / 蓝圈（黎明 / 永夜）
  //   · 三种状态各留一点 → 当前层不透明、别层幽灵、影子最淡，三档一眼分得开
  // 用 Game 自己的下法摆（board.set + onBoardChanged），不走 AI —— 截图必须可复现。
  // ------------------------------------------------------------------
  {
    await ev(`(() => {
      Game.cancelAiTimer(); Game.setSetupAi("human");
      Game.closeSetup(); Game.setSetupMode(true);
      // 【先把上一节留下的视图状态清干净】截图里出现过两样残留：一条"已恢复转动前的样子"
      // 的 toast 浮在棋盘中间，以及二维面板还停在上一节缩放/平移过的机位（棋子挤在一角）。
      // 这两个都不是 bug，是前一节测试改过状态没还原 —— 但对一张要进 README 的图来说就是脏。
      Game.toastTimer = 0;
      if (Game.el.toast) { Game.el.toast.classList.remove("on"); Game.el.toast.textContent = ""; }
      Game.zoom2d = 1; Game.pan2d = [0, 0];
      Game.pan3d = [0, 0];
      Game.setHintFolded(false);
      Game.newGame(8, 1);
      const b = Game.session.board;
      const put = (x, y, z, phase) => b.set(x, y, z, cellOf(1, phase));   // 1 = 黑
      // 【相位交替着摆】一条 红-蓝-红-蓝 的横排 —— 两种光圈挨着放，颜色差别才一眼看得出；
      // 清一色同相位的话，图上只是一排深浅差不多的子，看不出"光圈在表示相位"。
      // 同时它贴着 x=0 那条棱，角上那颗的周期像最多，外面的影子也就最明显。
      for (const x of [0, 1, 2, 3, 4]) put(x, 0, 0, x % 2);
      put(0, 0, 1, 1); put(0, 1, 0, 1); put(1, 0, 1, 0);
      // 白子错开摆，给出纵深参照，也顺便让两种相位的白子各出现一颗
      b.set(4, 4, 4, cellOf(2, 0)); b.set(5, 4, 4, cellOf(2, 1)); b.set(4, 5, 4, cellOf(2, 0));
      Game.activeLayer = 0;
      Game.ghostMode = true;                      // 幽灵层：非当前层的子淡一档
      Game.setGridVisible(true);
      Game.onBoardChanged(true);
      return 1;
    })()`);
    await sleep(500);
    await shot("12-四维三种机制");
  }

  // ------------------------------------------------------------------
  // v3.1.6 · 字符粒子阵列（起始界面背景的鼠标交互层）
  //
  // 【为什么必须在这里验，而且【不能】靠截图】
  // 这个效果的全部内容是【运动】，而 Page.captureScreenshot 本身要花约 300ms、
  // 弹簧 0.55s 就归位了 —— 截到的那一帧永远是"已经归位"的样子。
  // 试过：扫完整条轨迹立刻截图，图上什么都没有。所以这里绕开截图，
  // 直接在页面里 getImageData 逐像素比。
  //
  // 【噪声底恰好是 0，所以"必须为 0"这种断言才成立】
  // 网格用的是固定种子的伪随机（见 index.html 里那条注释），不是 Math.random。
  // 实测：同一状态连拍两次逐像素完全相同。于是下面任何差异都是真信号，
  // 而"归位后残留必须恰好 0"才有资格当断言 —— 有噪声底的话这条只能写"小于某个数"，
  // 而那个数会随着渲染器版本漂，迟早变成一条没人敢碰的假绿。
  //
  // 【5a 那条为什么不是"把鼠标挪出窗口"】实测 Chrome 会【丢弃】窗口外的坐标，
  // 指针其实停在最后一次扫过的位置 —— 那一小片字被永久顶开是【正确行为】。
  // 能验的不变量是"收敛"（前后两张快照相同）和"leave 之后逐像素归位"。
  // ------------------------------------------------------------------
  {
    // 【必须先关掉触屏模拟 —— 这里踩过一次坑】
    // 这个效果有一道闸门：只在 `(hover: hover) and (pointer: fine)` 的设备上开。
    // 前面第 7 节测触屏时把 `Emulation.setTouchEmulationEnabled` 打开过，
    // 而它在那个断言之后【又被打开了并一直留着】（见"量完要把视口和触屏还原"那一段）。
    // 后果有两层：媒体查询变成 coarse（闸门该拦），而且鼠标事件会被 Chrome
    // 【转成触摸事件】，`mousemove` 根本不派发。
    // 所以这里先把它关掉，再验效果；闸门本身另外单独验一次（见下面 wants 那条）。
    // 【这一段必须重新加载页面，不能就着现有的页面接着量 —— 实测踩过两次】
    //
    // 症状：moves=0、awake=0、diff=0，看起来像"效果整个坏了"，
    //       而 cells 停在 65（≈672×616 的小视口），连 setDeviceMetricsOverride
    //       都改不动它。
    // 真相：这一轮跑到这里已经过了八十多条断言、开过触屏模拟、起过对局、换过视口，
    //       页面和模拟状态都回不到"干净"了 —— 输入派发落在一个不是我以为的视口上，
    //       Chrome 对【视口外的坐标】是静默丢弃的（同一个成因也解释了"鼠标停在窗口外
    //       不会触发 mouseleave"）。测试的手根本没伸进画面，当然什么都没发生。
    //
    // 这个工程里本来就有同样的先例："拍 6-起始界面-英文 之前要先 Page.navigate 一次"
    // （见那边的注释）。这里照做：关掉触屏 -> 钉死视口 -> 重新加载 -> 从干净状态量。
    await send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await send("Emulation.setDeviceMetricsOverride",
      { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: PAGE });
    await sleep(3000);

    // 闸门的两半都验：关掉触屏模拟之后它必须放行；
    // 而"触屏设备上要拦住"这件事由下面那段临时打开触屏再读一次来钉。
    const gateOnTouch = await ev(`(() => {
      const before = InkField.stats().wants;
      return { before: before };
    })()`);
    check(gateOnTouch.before === true,
      "鼠标设备上闸门放行（关掉触屏模拟之后 wants 为真）", JSON.stringify(gateOnTouch));

    await ev(`Game.openSetup()`);
    await sleep(700);

    const inkStats = () => ev(`InkField.stats()`);
    const grab = (name) => ev(`(() => {
      const cv = document.getElementById("inkfield");
      const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
      window.${name} = d.slice();
      return d.length;
    })()`);
    const diffFrom = (name) => ev(`(() => {
      const cv = document.getElementById("inkfield");
      const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] !== window.${name}[i]) n++;
      return n;
    })()`);

    // ---- 静止态 ----
    await sleep(400);
    const s0 = await inkStats();
    // 【闸门提示】这个效果只在"有鼠标 + 没开减少动效"的设备上开。
    // 无头 Chrome 报的是 hover:hover / pointer:fine，所以正常应该开着；
    // 真机上如果这条红了，先看是不是触屏或系统开了减少动效，而不是先怀疑代码。
    check(s0.hasCanvas === true, "字符场拿到了 2D 上下文（没降级成空转）", JSON.stringify(s0));
    check(s0.cells > 50,
      "字符场的网格建起来了（真触屏 / 系统开了「减少动态效果」时这里会是 0，那是设计）",
      "cells=" + s0.cells);
    // 【右密左疏的渐变】leftShare = 左侧格子占比 ÷ 左侧面积占比，等于 1 就是两边一样密。
    // 左侧要让位给竖排古文水印和立体演示盘，所以必须明显小于 1。
    // 【v3.1.7 更正】实测不是 0.36：CELL=42→32、FILL_L/R 改过之后，1280×800 实测 0.477、
    // 1600×900 是 0.50、900×700 是 0.45 —— 也就是"疏约 2.1 倍"。
    // （0.36 是 v3.1.6 中途那一版的数；这条注释漂了不会有断言变红，因为下面只判 0 < x < 0.75。）
    // 上界 0.75 是防"渐变被写反了/被删了"变成均匀密度 —— 均匀密度下这个值恒等于 1。
    check(s0.leftShare > 0 && s0.leftShare < 0.75,
      "字符是【右密左疏】的（左边给水印和演示盘让路）",
      "leftShare=" + (s0.leftShare || 0).toFixed(3) + "，左侧 " + s0.leftCells + " / 共 " + s0.cells);
    check(s0.awake === 0 && s0.running === false,
      "起始界面刚打开时【没有】格子醒着、rAF 循环是停的（闲置成本为 0）", JSON.stringify(s0));

    await grab("__inkRest");

    // ---- 扫过：必须真的醒 ----
    // 扫掠范围留在 1280 宽之内 —— 视口外的坐标会被 Chrome 丢掉（见上面的注释）
    for (let x = 120; x <= 1160; x += 16) {
      await send("Input.dispatchMouseEvent",
        { type: "mouseMoved", x: x, y: 420, button: "none", pointerType: "mouse" });
      await sleep(6);
    }
    const s1 = await inkStats();
    // 【诊断信息要带全】awake=0 有两种完全不同的成因：事件压根没派发（moves=0），
    // 还是事件到了但被 wanted / 筛选拦住了。只报 awake 的话这两种长得一模一样。
    const diag = JSON.stringify(s1);
    check(s1.awake > 0, "鼠标扫过之后有格子醒着", diag);
    check(s1.running === true, "循环跑起来了", diag);
    const movedPx = await diffFrom("__inkRest");
    check(movedPx > 0, "扰动确实改变了画布像素（不是「醒着但没动」）", "diff=" + movedPx);

    // ---- 指针停住：必须收敛，不能一直漂 ----
    await send("Input.dispatchMouseEvent",
      { type: "mouseMoved", x: 700, y: 450, button: "none", pointerType: "mouse" });
    await sleep(900);

    // 【判据是"连续两张快照逐像素相同"，但等法必须轮询，不能睡固定时长】
    // 物理是按 dt 积分的，而 dt 有上限（MAX_DT = 1/30s）。无头浏览器在负载下掉帧时，
    // 1.8s 挂钟时间推进的模拟时间可能只有 0.6s —— 于是"睡够再比一次"会随机红。
    // 轮询把"够不够久"交给实际状态判断；判据一个字都没放松（仍然要求恰好 0）。
    let drift = -1, tries = 0;
    for (; tries < 12; tries++) {
      await grab("__inkA");
      await sleep(500);
      drift = await diffFrom("__inkA");
      if (drift === 0) break;
    }
    // 【这一条抓的是一个真实踩过的坑】档位门槛原本只有一套，被顶住的那几格
    // 正好停在门槛上，最后几位小数一直抖 → 在两档之间反复横跳，看起来像"有个字在闪"。
    // 实测单门槛时会持续差出十几个像素；加迟滞（升档/降档两套门槛）之后收敛到 0。
    check(drift === 0,
      "指针停住之后系统收敛（连续两张快照逐像素相同，没有持续漂移）",
      "轮询 " + (tries + 1) + " 次，最后一次 diff=" + drift);

    // 【冻结：收敛之后循环必须自己停】这不是性能优化，是"指针停着不动时别烧 CPU"的前提。
    // 没有冻结机制的话，被顶住的格子会永远以【亚像素】速度趋近平衡点 ——
    // rAF 一直空转，而且偶尔跨过档位门槛、画面上像"有个字在极轻地闪"。
    // 实测：加冻结之前这条"收敛"断言两次跑一次 0 一次 213，是条假绿。
    const parked = await ev(`InkField.stats()`);
    check(parked.running === false && parked.frozen > 0,
      "指针停住且收敛之后 rAF 自己停了（格子冻在原地，不再空转）",
      JSON.stringify({ running: parked.running, frozen: parked.frozen, awake: parked.awake }));

    // ---- mouseleave：必须逐像素回到静止态 ----
    await ev(`window.dispatchEvent(new Event("mouseleave"))`);
    await sleep(2200);
    const back = await diffFrom("__inkRest");
    const s2 = await inkStats();
    check(back === 0, "鼠标离开后【逐像素】回到静止态", "diff=" + back);
    check(s2.awake === 0 && s2.running === false, "全部归位后循环自己停了", JSON.stringify(s2));

    // ---- 进对局：整层必须停掉（看不见 ≠ 不烧 CPU）----
    await ev(`document.getElementById("startBtn").click()`);
    await sleep(900);
    const off = await ev(`(() => {
      const cv = document.getElementById("inkfield");
      return { st: InkField.stats(), display: getComputedStyle(cv).display,
               preview: document.getElementById("stage").className };
    })()`);
    check(off.st.running === false, "进对局之后 rAF 循环停了（不是只在 CSS 里藏起来）", JSON.stringify(off.st));
    check(off.display === "none", "对局界面里这一层是 display:none 的", "display=" + off.display);

    // ---- 回设置：必须能重新开起来 ----
    await ev(`Game.openSetup()`);
    await sleep(700);
    const re = await ev(`(() => ({
      st: InkField.stats(),
      display: getComputedStyle(document.getElementById("inkfield")).display,
      inset: !!document.getElementById("inscription"),
      writing: document.getElementById("inscription")
        ? getComputedStyle(document.getElementById("inscription")).writingMode : null,
      insText: document.getElementById("inscription")
        ? document.getElementById("inscription").textContent : null,
      tagline: document.getElementById("setupTagline")
        ? document.getElementById("setupTagline").textContent : null,
      titleFilter: getComputedStyle(document.getElementById("setupTitle")).filter,
      previewGlFilter: getComputedStyle(document.getElementById("gl")).filter,
      // 【尺寸也量成数字】"水印要铺满半屏""主标题要显眼"是设计要求，
      // 不钉住的话下次有人调排版会悄悄把它们改回去，而截图上看不出来"变小了"。
      insFontPx: parseFloat(getComputedStyle(document.getElementById("inscription")).fontSize),
      titleFontPx: parseFloat(getComputedStyle(document.getElementById("setupTitle")).fontSize),
      vh: window.innerHeight,
      // 【断句有没有被宽度挤断】竖排下每一列 = 一个 line box = 一个 client rect。
      // 三句话就该是三个矩形；多出来就说明某一列放不下、被折成了两列。
      // height>1 是滤掉零高度的占位矩形（换行点处也会返回一个）。
      insCols: (() => {
        const el = document.getElementById("inscription");
        const rg = document.createRange(); rg.selectNodeContents(el);
        return [...rg.getClientRects()].filter((r) => r.height > 1).length;
      })(),
      insBox: (() => {
        const b = document.getElementById("inscription").getBoundingClientRect();
        return { w: Math.round(b.width), h: Math.round(b.height) };
      })(),
    }))()`);
    check(re.st.hasCanvas === true && re.st.cells > 50, "回到起始界面后网格还在", JSON.stringify(re.st));
    check(re.display === "block", "这一层重新显示出来了", "display=" + re.display);

    // ---- 闸门：触屏设备上必须【拦住】----
    // 只能验到"闸门读到的信号是对的"这一层（init 在页面加载时已经跑过了，
    // 这里改媒体查询不会让它重跑）。要验端到端得重载页面，代价不值 ——
    // 而真正会出错的是"判定条件写错"，这一条正好钉住它。
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await sleep(200);
    const onTouch = await ev(`InkField.stats()`);
    check(onTouch.wants === false,
      "触屏设备上闸门拦住（wants 为假）—— 没有 hover 可划，还最费电", JSON.stringify(onTouch));
    await send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await sleep(200);
    const offTouch = await ev(`InkField.stats()`);
    check(offTouch.wants === true, "切回鼠标设备后闸门重新放行", JSON.stringify(offTouch));

    // ---- 顺手把古风层另外三件也钉住（它们同样只有真浏览器答得了）----
    check(re.inset === true && re.writing === "vertical-rl",
      "竖排古文水印在，且真的是 vertical-rl 竖排（不是被谁改回横向了）", "writing-mode=" + re.writing);
    check(re.insText === "亦有格五其法布子成行以得五者胜",
      "水印文案 = 去标点的 15 字原文（三列断句合起来必须逐字等于原句）",
      JSON.stringify(re.insText));
    check(/^url\(/.test(re.titleFilter || ""),
      "主标题挂着 SVG 墨韵滤镜（filter: url(#…)）", "filter=" + re.titleFilter);
    check(re.tagline === "六面贯通，五子一线", "新副标题在位", JSON.stringify(re.tagline));

    // ---- 尺寸：水印要"铺满半屏"、主标题要"显眼" ----
    // 判据用【相对视口的比例】而不是绝对 px：绝对 px 只在一种视口下成立，
    // 而这两个都是"看起来够不够大"的问题。
    //   水印：12.5vh（clamp 中段），这里要求 >= 10vh。
    //   主标题：54px @ 800 高 = 6.75vh，这里要求 >= 6vh。
    check(re.insFontPx / re.vh >= 0.10,
      "竖排古文水印真的放大了（字号 >= 10vh，铺满半屏那种大）",
      re.insFontPx.toFixed(1) + "px / " + re.vh + "vh = " + (re.insFontPx / re.vh).toFixed(3));
    check(re.titleFontPx / re.vh >= 0.06,
      "主标题够显眼（字号 >= 6vh）",
      re.titleFontPx.toFixed(1) + "px / " + re.vh + "vh = " + (re.titleFontPx / re.vh).toFixed(3));

    // ---- 水印的【断句】不许被宽度挤断 ----
    // 【这一条钉的是一个真实踩过的坑】原来写的是 top:50% + translateY(-50%)，
    // 而 position:fixed 下【没写 bottom】时包含块只到视口底 —— 元素的可用高度
    // 被钉成视口的一半。竖排里 height 决定"一列放几个字"，于是 4/6/5 三句话
    // 被拆成 6 列，外框从 422×690 变成 782×401（又宽又扁，正是"横向拉长"的样子）。
    // 静态看截图只会觉得"断句怪怪的"，量 client rects 才看得见是列数不对。
    check(re.insCols === 3,
      "水印正好排成 3 列（一句话一列 —— 断句不许被可用高度挤断）",
      "实际 " + re.insCols + " 列");
    check(re.insBox.h > re.insBox.w,
      "水印是【窄而高】的竖排块，不是被拉宽的",
      re.insBox.w + "×" + re.insBox.h + "（宽高比 " + (re.insBox.w / re.insBox.h).toFixed(2) + "）");

    // ---- 水印不许和设置区的文字冲突（六种语言全查）----
    // 设计要求是：水印【可以】压在立体棋盘上（那是刻意的），但【不许】和设置区的文字重叠。
    // 而设置区内容的最左沿是随语言变的（1280 下实测 44.4%~47.4%，法语最挤），
    // 所以这条必须六种语言全跑 —— 只查中文会正好漏掉最挤的那一种。
    // 【临时探针】把异常原样带回来 —— 否则 ev() 只返回 undefined，看不出是哪一步炸的
    const clashRaw = await ev(`(() => { try {
      const keep = Game.lang; const bad = []; const per = []; const wrapped = [];
      const SEL = "#setup .row, #setup .rowLabel, #setup button, #setup .dimInput, #setup .hint," +
                  " #setup #ruleNote, #setup #sizeSummary, #setup #extraRow," +
                  " #setup h1, #setup .tagline, #setup .sub";
      for (const l of ["zh","en","ja","ko","ru","fr"]) {
        Game.setLang(l); Game.openSetup();
        const ins = document.getElementById("inscription").getBoundingClientRect();
        let minL = 1e9;
        for (const el of document.querySelectorAll(SEL)) {
          if (el.getClientRects().length === 0) continue;
          const b = el.getBoundingClientRect();
          if (b.width < 1) continue;
          if (b.left < minL) minL = b.left;
        }
        // 【主标题会不会折行】放大到 81px 之后这是个真风险：西里尔/拉丁那三种
        // 标题比中文长得多（"Гомокуб" 比 "五子魔方" 宽），一行放不下就会折成两行，
        // 而折行会同时撑高标题块、把「开始游戏」往下推。
        const linesOf = (el) => {
          const r = document.createRange(); r.selectNodeContents(el);
          return [...r.getClientRects()].filter((x) => x.height > 1).length;
        };
        const h1 = document.getElementById("setupTitle");
        const h1Lines = linesOf(h1);
        const tag = document.getElementById("setupTagline");
        const sub = document.getElementById("setupSub");
        // .serif 的字体栈也要按语言换 —— 不换的话拉丁/西里尔会掉进楷体->宋体那条回退链，
        // 而【宋体把西里尔字母画成全角宽】（实测俄语那行因此宽了 60%，856px vs 485px）
        const serifFont = getComputedStyle(sub).fontFamily;
        const h1Font = getComputedStyle(h1).fontFamily;
        per.push({ l: l, insR: Math.round(ins.right), minL: Math.round(minL),
                   gap: Math.round(minL - ins.right), h1Lines: h1Lines,
                   h1W: Math.round(h1.getBoundingClientRect().width),
                   tagLines: linesOf(tag), subLines: linesOf(sub),
                   serifFont: String(serifFont).slice(0, 40),
                   h1Font: String(h1Font).slice(0, 40) });
        // 【要求的是'留出余量'，不是'刚好不撞'】只判大于 的话，4px 的间隙也算过 ——
        // 而那种余量下次改一个字就会翻脸。这里要求至少 8px。
        if (ins.right > minL - 8) bad.push(l + "(余 " + Math.round(minL - ins.right) + "px)");
        if (h1Lines !== 1) wrapped.push(l + "(" + h1Lines + "行)");
      }
      Game.setLang(keep); Game.openSetup();
      return JSON.stringify({ per: per, bad: bad, wrapped: wrapped });
    } catch (e) { return JSON.stringify({ err: String((e && e.stack) || e) }); } })()`);
    if (clashRaw && clashRaw.indexOf('"err"') >= 0) console.log("clash 求值失败: " + clashRaw);
    const clash = JSON.parse(clashRaw);
    check(clash.bad.length === 0,
      "水印和设置区的文字【不冲突】（六种语言全查：水印右缘 <= 内容最左沿）",
      clash.bad.length
        ? "重叠的语言: " + clash.bad.join(",") + "  " + JSON.stringify(clash.per)
        : "各语言余量(px): " + clash.per.map((p) => p.l + ":" + p.gap).join(" "));
    // 主标题放大到 81px 之后必须仍然【一行】—— 折行会撑高整块、把「开始游戏」往下推，
    // 而那正是上面那条高度断言在守的东西。两种失败是连着的，分开报才好定位。
    check(clash.wrapped.length === 0,
      "主标题六种语言都还是【一行】（81px 下没有折行）",
      clash.wrapped.length ? "折行的: " + clash.wrapped.join(",")
        : clash.per.map((p) => p.l + ":" + p.h1W + "px").join(" "));

    // ---- 两行小字的折行：按语言分别要求 ----
    // 这两条是明确的设计要求，不是"看着还行"：
    //   · 副标题【英语必须一行】（俄语可以折 —— 它本来最长）
    //   · 下面那行【只有俄语折两行】，其余语言一行
    // 判据都来自实测的自然宽（换 Georgia 之后：副标题 zh135/en223/ja135/ko151/ru255/fr239；
    // 下面那行 zh319/en444/ja348/ko355/ru485/fr425），max-width 卡在中间那条缝里。
    const tagBad = clash.per.filter((p) => p.l !== "ru" && p.tagLines !== 1);
    check(tagBad.length === 0,
      "副标题除俄语外都是一行（【英语不另起一行】是明确要求）",
      tagBad.length ? "折行的: " + tagBad.map((p) => p.l + "(" + p.tagLines + ")").join(",")
        : clash.per.map((p) => p.l + ":" + p.tagLines).join(" "));
    const subBad = clash.per.filter((p) => (p.l === "ru" ? p.subLines !== 2 : p.subLines !== 1));
    check(subBad.length === 0,
      "下面那行只有俄语折两行，其余语言一行",
      subBad.length ? "不符的: " + subBad.map((p) => p.l + "(" + p.subLines + ")").join(",")
        : clash.per.map((p) => p.l + ":" + p.subLines).join(" "));

    // ---- 中文主标题必须是行书（不是楷体）----
    // 标题块三行原来都走 .serif = 楷体，一笔一画很"板正"。这一版把主标题换成
    // 内联的 Zhi Mang Xing（行书）子集。这里查的是"真的用上了"而不是"写了规则"——
    // 子集缺字时会静默回退到楷体，界面上只是"没那么行书"，不说根本看不出来。
    {
      const zh = clash.per.find((p) => p.l === "zh");
      check(/BrushSub/.test(zh.h1Font),
        "中文主标题走的是行书字体（BrushSub），不是楷体", "h1 font-family = " + zh.h1Font);
    }

    // ---- 拉丁/西里尔的标题不许掉进中文书法字体的回退链 ----
    // .serif 原来只写死了楷体/宋体，而那两种都没有西里尔字形 -> 回退到 SimSun，
    // 宋体把西里尔按【全角】画，俄语因此宽了 60%。这条钉住"按语言换 .serif"。
    const lat = clash.per.filter((p) => ["en", "fr", "ru"].includes(p.l));
    check(lat.every((p) => /Georgia|Times/.test(p.serifFont)),
      "英/法/俄的标题走衬线字体栈（不是楷体->宋体，否则西里尔会被画成全角）",
      lat.map((p) => p.l + ":" + p.serifFont).join("  "));

    // ---- 演示盘的宣纸发光（只在起始界面这一档）----
    // 0.6px 是量出来的：0.35px 改 0 个像素（等于没加），
    // 而 blur+sepia+contrast 那组会把线框整个抹掉（近白像素归零）。见 CSS 里的注释。
    check(/blur/.test(re.previewGlFilter || "") && re.previewGlFilter !== "none",
      "起始界面的演示盘挂着宣纸发光的柔化", "filter=" + re.previewGlFilter);
  }

  // 【宣纸发光只许在起始界面这一档】它挂在 #stage.preview 上，进对局必须消失 ——
  // 对局盘的线框是"白子能不能看清"那条硬约束的一部分，被柔化会直接影响可读性。
  {
    await ev(`Game.closeSetup()`);
    await sleep(300);
    const inGame = await ev(`getComputedStyle(document.getElementById("gl")).filter`);
    check(inGame === "none",
      "进对局之后演示盘那层柔化【消失】（对局盘的线框不许被模糊）", "filter=" + inGame);
    await ev(`Game.openSetup()`);
    await sleep(300);
  }

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
