// 网页版渲染层 / UI 层的冒烟测试。
//
// 我这边没有浏览器，所以不可能真正验证"画面好不好看"。但有一大类 bug 是可以在 node 里抓到的：
// 拼错方法名、id 写错、忘了判空、属性名不对 —— 这些在真实浏览器里就是控制台一条红字 + 白屏。
//
// 做法是搭一套 DOM / WebGL2 桩，然后【真的把 Game.init() 跑一遍】，
// 再手动驱动各条绘制与交互路径，任何抛出的异常都算失败。
//
// 两个让桩不至于变成"什么都放行"的设计：
//   1. document.getElementById 只对 index.html 里【真实存在】的 id 返回元素，
//      其它一律返回 null。这样 el 列表里任何拼错的 id 都会立刻变成空引用。
//   2. WebGL 用 Proxy 生成：任何属性访问都返回一个可调用对象。
//      它抓不到"gl.drwArrays 拼错了"（因为不存在的方法也返回桩），
//      但抓得到我自己代码里的拼写错误和调用顺序错误 —— 那才是真正会写错的部分。
//
// 能抓到：自己的方法名拼错、元素为 null、属性名写错、参数结构错、状态机走错分支。
// 抓不到：着色器 GLSL 能否编译、布局对不对、视觉效果、真实 API 的签名是否匹配。
//
// 运行：node Web_Gomoku3D/tests/dom-smoke.test.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.join(HERE, "..", "index.html");
// 规则正文的权威来源。index.html 里嵌的那份是【生成物】，
// 断言的正是"生成物逐字节等于它"。
const RULES_PATH = path.join(HERE, "..", "RULES_SPEC.md");
const RULES_EN_PATH = path.join(HERE, "..", "RULES_SPEC.en.md");
const html = fs.readFileSync(HTML_PATH, "utf8");

let passed = 0;
const failures = [];
function ok(name) { passed++; }
function bad(name, e) { failures.push(name + "\n      " + (e && e.stack ? e.stack.split("\n").slice(0, 4).join("\n      ") : String(e))); }
function step(name, fn) { try { fn(); ok(name); } catch (e) { bad(name, e); } }

// ---------------------------------------------------------------------------
// 从 HTML 里收集真实存在的 id 和 class，桩只对它们生效
// ---------------------------------------------------------------------------
const realIds = new Set();
for (const m of html.matchAll(/\sid="([^"]+)"/g)) realIds.add(m[1]);

// 尺寸改成输入框之后，这里要钉的是「输入框真的在 HTML 里」。
// 从 HTML 解析而不是在桩里另写一份：HTML 改了 id 而这里没跟着改，桩会静默地把
// getElementById 变成 null，测试立刻报空引用 —— 那正是这套桩要抓的东西。
const dimInputIds = [...html.matchAll(/<input id="(dim[XYZNC])"[^>]*class="dimInput"[^>]*>/g)].map((m) => m[1]);
const dimInputMax = new Map();
for (const m of html.matchAll(/<input id="(dim[XYZNC])"[^>]*max="(\d+)"[^>]*>/g)) dimInputMax.set(m[1], parseInt(m[2], 10));

console.log("HTML 里的 id 共 " + realIds.size + " 个；尺寸输入框 " + dimInputIds.length + " 个");

// ---------------------------------------------------------------------------
// DOM 桩
// ---------------------------------------------------------------------------
function makeClassList() {
  const set = new Set();
  return {
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    contains: (c) => set.has(c),
    toggle: (c, force) => {
      const want = force === undefined ? !set.has(c) : !!force;
      if (want) set.add(c); else set.delete(c);
      return want;
    },
    _set: set,
  };
}

let nextAnimationFrame = null;

function makeElement(tag, id) {
  const el = {
    tagName: tag,
    id: id || "",
    classList: makeClassList(),
    style: {},
    dataset: {},
    textContent: "",
    innerHTML: "",
    // 真属性的影子本。collectStatic 现在读的是 data-i18n 的【属性值】（不是 id），
    // 桩里没有这一层的话 applyStatic 会在 getAttribute 上直接抛 TypeError ——
    // 那样"切语言"这条路径在桩里根本跑不到，后面的断言就全成了空断言。
    _attrs: {},
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null;
    },
    setAttribute(name, v) { this._attrs[name] = String(v); },
    width: 300,
    height: 200,
    clientWidth: 800,
    clientHeight: 600,
    _listeners: {},
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    removeEventListener() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight,
               width: this.clientWidth, height: this.clientHeight, x: 0, y: 0 };
    },
    getContext(kind) {
      // 同一个 canvas 的同一个 kind 必须返回同一个上下文对象 ——
      // 每次新建的话，测试拿到的 ops 和 Game 实际在画的那个不是同一份。
      this._ctxs = this._ctxs || {};
      if (!this._ctxs[kind]) {
        this._ctxs[kind] = kind === "2d" ? makeCtx2d() : makeStub("webgl2-context");
      }
      return this._ctxs[kind];
    },
    dispatch(type, ev) {
      for (const fn of (this._listeners[type] || [])) fn(ev);
    },
  };
  // canvas 的 clientWidth 用 CSS 像素，width 用设备像素 —— 两者刻意给不同的值，
  // 这样 drawLayerBase 里的 setCanvasSize 会走"尺寸变了要重设"的分支，覆盖到那段逻辑
  if (tag === "canvas") { el.width = 1600; el.height = 1200; el.clientWidth = 800; el.clientHeight = 600; }
  return el;
}

function makeCtx2d() {
  const noop = () => {};
  // ops 记录"画了什么矩形"。二维面板的坐标约定（板面按 nx×ny 铺、线在交织点上、
  // 最外圈离板边半格）是这块代码反复出错的地方，而它的错法全都不报错、
  // 只表现为"屏幕上差半格"—— 空实现的上下文一个字都查不出来。
  // 记下 fillRect 的四个数，就能把"板面矩形"这类东西真的钉住。
  const ctx = {
    ops: [],
    fillStyle: "", strokeStyle: "", lineWidth: 1, font: "",
    setTransform: noop, clearRect: noop,
    fillRect(x, y, w, h) { ctx.ops.push({ op: "fillRect", x: x, y: y, w: w, h: h }); },
    strokeRect(x, y, w, h) { ctx.ops.push({ op: "strokeRect", x: x, y: y, w: w, h: h }); },
    beginPath: noop, arc: noop, fill: noop, stroke: noop, moveTo: noop, lineTo: noop,
    fillText: noop, save: noop, restore: noop, translate: noop, scale: noop,
  };
  return ctx;
}

function makeStub(name) {
  const cache = Object.create(null);
  const target = function () { return makeStub(name + "()"); };
  target._name = name;
  return new Proxy(target, {
    get(t, prop) {
      if (prop === Symbol.toPrimitive) return () => 1;
      if (prop === "then") return undefined;          // 避免被当成 Promise
      if (prop === "length") return 1;
      if (!(prop in cache)) cache[prop] = makeStub(name + "." + String(prop));
      return cache[prop];
    },
  });
}

const elementsById = new Map();
for (const id of realIds) elementsById.set(id, makeElement("div", id));
// 几个需要特殊处理的元素
elementsById.set("gl", makeElement("canvas", "gl"));
elementsById.set("layerBase", makeElement("canvas", "layerBase"));
elementsById.set("layerOverlay", makeElement("canvas", "layerOverlay"));
elementsById.set("strip", makeElement("canvas", "strip"));
elementsById.set("view", makeElement("div", "view"));
elementsById.set("setup", makeElement("div", "setup"));
// #rulesSrc / #rulesSrcEn 是 <script type="text/plain">，文本就是嵌进去的规则全文。
// 桩里必须放【真内容】：否则渲染出来是空字符串，所有"正文里有没有 xxx"的断言
// 都会在空字符串上做文章 —— 那正是"假测试"的典型长相。
// 两份都要灌：只灌中文那份的话，英文浮层在桩里渲染的是空字符串，
// 而那几条"英文规则里有 xxx"的断言照样会过（在空串上找子串本来就找不到，
// 但"找不到就报错"的断言会红 —— 反过来"找到了就报错"的断言会静默通过）。
for (const id of ["rulesSrc", "rulesSrcEn"]) {
  const rm = html.match(new RegExp('<script type="text\\/plain" id="' + id + '">\\n([\\s\\S]*?)\\n<\\/script>'));
  if (!rm) throw new Error("index.html 里找不到 #" + id + " 的 script 块");
  const el = makeElement("div", id);
  el.textContent = rm[1] + "\n";
  elementsById.set(id, el);
}
// 开局时设置页是打开的（CSS 默认不是 display:none），这里如实反映
elementsById.get("setup").classList.add("off"); // 启动后会被 Game 打开设置页的流程覆盖

// 尺寸输入框做成真 input：带初始 value，addEventListener / dispatch 由 makeElement 提供。
for (const id of dimInputIds) {
  const el = makeElement("input", id);
  el.value = "15";
  elementsById.set(id, el);
}

// 四维面板上那几组按钮。和尺寸按钮一样从 HTML 里解析出取值，不在这里另写一份 ——
// 否则 HTML 改了取值而这里没跟着改，桩会静默地测一套跟真实页面不一样的东西。
const rotAxisValues = [];
for (const m of html.matchAll(/class="rotAxis[^"]*"\s+data-axis="(\d+)"/g)) rotAxisValues.push(parseInt(m[1], 10));
const rotTurnValues = [];
for (const m of html.matchAll(/class="rotTurns[^"]*"\s+data-turns="(\d+)"/g)) rotTurnValues.push(parseInt(m[1], 10));
const coolValues = [];
for (const m of html.matchAll(/class="coolBtn[^"]*"\s+data-cool="(\d+)"/g)) coolValues.push(parseInt(m[1], 10));

function group(sel, values, field) {
  return values.map((v) => {
    const el = makeElement("button");
    el.dataset[field] = String(v);
    el.classList.add(sel.slice(1));
    return el;
  });
}
const rotAxisEls = group(".rotAxis", rotAxisValues, "axis");
const rotTurnEls = group(".rotTurns", rotTurnValues, "turns");
const coolEls = group(".coolBtn", coolValues, "cool");

// 这三组原来【一条长度断言都没有】。它们的取值靠上面那三条正则从 HTML 里抠，
// 而正则要求 data-axis / data-turns / data-cool 紧跟 class —— 往中间插一个新属性
// （比如 data-i18n）就会让数组静默变空，然后 syncCoolRow / setSetupCool 在桩里
// 变成空操作，所有断言照样绿。这里把它钉死：抠出来的条数必须和 HTML 里 class 的
// 出现次数一致。
for (const [name, els, cls] of [["rotAxis", rotAxisEls, ".rotAxis"],
                                ["rotTurns", rotTurnEls, ".rotTurns"],
                                ["coolBtn", coolEls, ".coolBtn"]]) {
  const inHtml = (html.match(new RegExp('class="' + cls.slice(1) + '[^"]*"', "g")) || []).length;
  if (els.length !== inHtml || els.length === 0) {
    throw new Error(`桩解析 ${name} 得到 ${els.length} 个，HTML 里有 ${inHtml} 个 —— ` +
      `dom-smoke 顶部那三条正则要求 data-* 紧跟 class，中间插了别的属性就会静默抠空`);
  }
}

// 带 data-i18n / data-i18n-html 的静态文案元素。和上面几组同一个套路：从 HTML 里解析。
// 【这一块不加，applyLang 在桩里就是静默空操作】—— querySelectorAll 只认三个选择器，
// 认不出 [data-i18n] 就返回空数组，applyStatic 遍历一个空列表，然后所有"切到英文"的
// 断言都会通过，因为它们压根没有元素可查。那正是"假测试"的标准长相。
// 正文取 HTML 里的原文，所以切回中文时写回的就是 HTML 里那一份，不是桩另编的。
const i18nEls = [];
const i18nHtmlEls = [];
{
  const re = /<(\w+)\b([^>]*\bdata-i18n(-html)?="([^"]+)"[^>]*)>([\s\S]*?)<\/\1>/g;
  for (const m of html.matchAll(re)) {
    const attrs = m[2], isHtml = !!m[3], key = m[4], body = m[5];
    const idm = attrs.match(/\bid="([^"]+)"/);
    if (!idm) throw new Error("data-i18n 的元素没有 id，没法当键：" + m[0].slice(0, 60));
    const el = elementsById.get(idm[1]);
    if (!el) throw new Error('<' + m[1] + ' id="' + idm[1] + '"> 不在 realIds 里');
    // 【键是属性值，不是 id】和 index.html 里 collectStatic() 取键的方式保持一致。
    // 两边不一致的话，桩里"切到英文"用的键和浏览器里用的不是同一个 ——
    // 那这条断言就只是在验证桩自己的想象。
    el.setAttribute(isHtml ? "data-i18n-html" : "data-i18n", key);
    el.dataset.i18n = key;
    if (isHtml) { el.innerHTML = body; i18nHtmlEls.push(el); }
    else { el.textContent = body; i18nEls.push(el); }
  }
  // 分母只数【标签里的】属性（<标签 … data-i18n="…"），不是整份源文件里数子串。
  // 源码里提一句 data-i18n="…" 的地方不止标签：JS 注释里解释这个属性时就会写到，
  // 而那种提及不是元素、也不会被解析 —— 按子串数的话，注释一写多就报
  // "有元素没被解析到"，把真正要抓的"非叶子元素"淹没在假警报里。
  const decl = [...html.matchAll(/<\w+\b[^>]*\bdata-i18n(-html)?="[^"]+"/g)].length;
  if (i18nEls.length + i18nHtmlEls.length !== decl) {
    throw new Error(`HTML 的标签里有 ${decl} 个 data-i18n 属性，桩只解析出 ` +
      `${i18nEls.length + i18nHtmlEls.length} 个 —— 有元素没被解析到（可能不是叶子元素）`);
  }
  if (i18nEls.length === 0) throw new Error("一个 data-i18n 元素都没解析出来，静态文案的检查会全部空转");
}

// <html> 元素。语言切换要往它上面写类名和 lang —— stubs 里没有的话，
// applyLang 会在 documentElement 上是 undefined 的地方直接抛 TypeError，
// 那样"切换语言"这条路径在桩里根本跑不到，后面的断言就都成了空断言。
// lang 的初值从 HTML 里解析，和别的 id 一样不在这里另写一份。
const htmlEl = makeElement("html");
{
  const m = html.match(/<html[^>]*\slang="([^"]+)"/);
  htmlEl.lang = m ? m[1] : "";
}

const documentStub = {
  readyState: "complete",
  documentElement: htmlEl,
  getElementById(id) { return elementsById.has(id) ? elementsById.get(id) : null; },
  createElement(tag) { return makeElement(tag); },
  querySelectorAll(sel) {
    if (sel === ".rotAxis") return rotAxisEls;
    if (sel === ".rotTurns") return rotTurnEls;
    if (sel === ".coolBtn") return coolEls;
    if (sel === "[data-i18n]") return i18nEls;
    if (sel === "[data-i18n-html]") return i18nHtmlEls;
    return [];
  },
  addEventListener() {},
  body: makeElement("body"),
};

// window 要【记录】监听器：规则浮层那条"开着时不吃快捷键"的断言必须真的按键，
// 而快捷键是挂在 window 上的 —— 不记录就无从触发，那条断言只能退化成"看着像对"。
const windowStub = {
  devicePixelRatio: 1,
  _listeners: {},
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
  removeEventListener() {},
  innerWidth: 1600,
  innerHeight: 900,
};
const windowStubListeners = windowStub._listeners;
const pressKey = (key) => {
  for (const fn of (windowStubListeners.keydown || [])) fn({ key: key });
};

// ---------------------------------------------------------------------------
// 提取整个 script 并在桩环境里执行
// ---------------------------------------------------------------------------
const scriptStart = html.indexOf("<script>");
const scriptEnd = html.lastIndexOf("</script>");
const fullScript = html.slice(scriptStart + 8, scriptEnd);

let Game = null;
let PALETTE = null, FALLBACK_COLORS = null, cellSize = null, BoardLimits = null, CoreNS = null;
let renderRulesMarkdown = null, escapeHtmlNS = null;
let TEXT_EN = null, STATIC_EN = null, t = null;
let RendererNS = null;
// 相机拖拽的两个常量。**从源码里抓，不在这里抄一份** —— 抄了就会各自漂移，
// 而"夹取到底是 85 还是 89.95"正是这几条测试要钉的东西。
const camConst = (name) => {
  const m = html.match(new RegExp("const " + name + "\\s*=\\s*([0-9.]+)"));
  if (!m) throw new Error("源码里找不到常量 " + name);
  return parseFloat(m[1]);
};
step("script 能在 DOM 桩环境里加载并完成 Game.init()", () => {
  const runner = new Function(
    "document", "window", "requestAnimationFrame", "console", "Set", "Map",
    fullScript + "\nreturn { Game: (typeof Game !== 'undefined') ? Game : null," +
      " Palette: Palette, FALLBACK_COLORS: FALLBACK_COLORS, cellSize: cellSize," +
      " BoardLimits: BoardLimits," +
      " renderRulesMarkdown: renderRulesMarkdown, escapeHtml: escapeHtml," +
      // 两张表和 t() 都要露出来：语言那几步检查的就是"表里有没有这一条"，
      // 只能从表本身问，不能从界面上反推（界面上少一条英文的表现是"那一处还是中文"，
      // 而这一条恰恰是检查要抓的东西）。表的键是【键名】不是 DOM，不违反"桩不另写一份"。
      " TEXT_EN: TEXT.en, STATIC_EN: STATIC_TEXT.en, t: t," +
      // Renderer 露出来是为了让"格线开关只闸 draw、不闸 upload"这条能被真正观测：
      // WebGL 桩是个 Proxy，gl.drawArrays 这类调用什么都记不下来，但 Renderer.drawLines
      // 是普通 JS 方法，可以整体换成记录器。不露出来的话，"关闭格线时确实不画 static 线"
      // 就只剩"读代码确认"这一条路。
      " Renderer: Renderer," +
      " CoreNS: { GameSession: GameSession, FourDSession: FourDSession, RuleSet: RuleSet," +
      "           RotateStatus: RotateStatus, MoveStatus: MoveStatus } };"
  );
  // requestAnimationFrame 故意做成空实现：render loop 不能无限递归
  const NS = runner(documentStub, windowStub, () => 0, console, Set, Map);
  Game = NS.Game;
  PALETTE = NS.Palette; FALLBACK_COLORS = NS.FALLBACK_COLORS;
  cellSize = NS.cellSize; BoardLimits = NS.BoardLimits; CoreNS = NS.CoreNS;
  renderRulesMarkdown = NS.renderRulesMarkdown; escapeHtmlNS = NS.escapeHtml;
  TEXT_EN = NS.TEXT_EN; STATIC_EN = NS.STATIC_EN; t = NS.t;
  RendererNS = NS.Renderer;
  if (!TEXT_EN || !STATIC_EN || !t) throw new Error("英文文案表没有暴露出来");
  if (!RendererNS) throw new Error("Renderer 没有暴露出来");
  if (!Game) throw new Error("Game 对象没有暴露出来");
  if (!PALETTE || !FALLBACK_COLORS || !cellSize || !BoardLimits)
    throw new Error("调色板 / cellSize / BoardLimits 没有暴露出来");
});

if (!Game) {
  console.log("");
  console.log("==================================================");
  console.log("  0 项通过 / " + failures.length + " 项失败");
  console.log("==================================================");
  for (const f of failures) console.log("FAIL: " + f);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 驱动各条路径
// ---------------------------------------------------------------------------
step("init 之后对局已建立：15³、黑先", () => {
  if (!Game.session) throw new Error("session 为 null");
  if (Game.session.size !== 15) throw new Error("尺寸应为 15，实际 " + Game.session.size);
  if (Game.session.firstPlayer !== 1) throw new Error("应为黑先");
  if (Game.moveCount !== undefined && Game.session.moveCount !== 0) throw new Error("初始手数应为 0");
});

step("各元素引用都取到了（id 拼错会在这里暴露）", () => {
  for (const key of Object.keys(Game.el)) {
    if (!Game.el[key]) throw new Error("元素 '" + key + "' 为 null —— id 可能拼错了");
  }
});

step("draw3D 能跑（实例缓冲上传 + 三趟绘制）", () => { Game.draw3D(); });
step("drawLayerBase 能跑", () => { Game.drawLayerBase(); });
step("drawLayerOverlay 能跑", () => { Game.drawLayerOverlay(); });
step("drawStrip 能跑", () => { Game.drawStrip(); });

step("落子 → 视图重建 → 胜负有判定", () => {
  for (let x = 0; x < 4; x++) {
    Game.tryPlace(x, 0);
    Game.tryPlace(x, 1);
  }
  const o = Game.session.place(4, 0, 0);
  if (o.status !== "Win") throw new Error("黑棋第 5 手应判胜，实际 " + o.status);
  Game.onMoveApplied(Game.session.history[Game.session.moveCount - 1], o);
  Game.draw3D();
});

step("获胜横幅已显示且文字正确", () => {
  if (!Game.el.banner.classList.contains("on")) throw new Error("banner 没有显示");
  if (Game.el.bannerTitle.textContent.indexOf("黑棋胜") < 0)
    throw new Error("横幅文字不对：" + Game.el.bannerTitle.textContent);
});

step("悔棋 → 回到进行中 → 能继续下", () => {
  Game.undo();
  if (Game.session.status !== "Playing") throw new Error("悔棋后应为进行中");
  if (Game.session.moveCount !== 8) throw new Error("悔棋后手数应为 8，实际 " + Game.session.moveCount);
  Game.draw3D();
});

step("换层会重建活动层网格与实例", () => {
  Game.setActiveLayer(7);
  if (Game.activeLayer !== 7) throw new Error("当前层应为 7，实际 " + Game.activeLayer);
  Game.setActiveLayer(0);
});

step("切换幽灵层 / 切片模式", () => {
  Game.setGhostMode(false);
  Game.draw3D();
  Game.setGhostMode(true);
  Game.draw3D();
});

step("在切片模式下换层（切片深度跟随当前层）", () => {
  Game.setGhostMode(false);
  Game.setActiveLayer(3);
  Game.draw3D();
  Game.setGhostMode(true);
});

step("长连犯规路径：横幅显示犯规文案", () => {
  Game.newGame(15, 1);
  const s = Game.session;
  const blackX = [0, 1, 2, 4, 5], whiteX = [0, 2, 4, 6, 8];
  for (let i = 0; i < blackX.length; i++) {
    s.place(blackX[i], 0, 0);
    s.place(whiteX[i], 5, 5);
  }
  const o = s.place(3, 0, 0);
  if (o.status !== "LoseByOverline") throw new Error("应判长连犯规，实际 " + o.status);
  Game.onMoveApplied(s.history[s.moveCount - 1], o);
  if (Game.el.bannerTitle.textContent.indexOf("长连犯规") < 0)
    throw new Error("横幅应显示长连犯规：" + Game.el.bannerTitle.textContent);
  Game.draw3D();
});

step("重开清空棋盘与横幅", () => {
  Game.restart();
  if (Game.session.moveCount !== 0) throw new Error("重开后手数应为 0");
  if (Game.el.banner.classList.contains("on")) throw new Error("重开后横幅应隐藏");
  Game.draw3D();
});

step("换到 50³ 并落子（覆盖实例分批与缩略条布局）", () => {
  Game.newGame(50, 2);
  if (Game.session.size !== 50) throw new Error("尺寸应为 50");
  if (Game.session.currentPlayer !== 2) throw new Error("白先时第一个应轮到白棋");
  for (let i = 0; i < 60; i++) Game.session.place(i % 50, (i * 7) % 50, (i * 13) % 50);
  Game.onBoardChanged(false);
  Game.draw3D();
  Game.setActiveLayer(49);
  Game.draw3D();
});

step("三维棋子实例跟着棋盘走 + 切片模式真的不画被切掉的部分", () => {
  Game.newGame(15, 1);
  Game.setActiveLayer(0);
  Game.setGhostMode(true);

  if (Game.opqCount !== 0 || Game.ghCount !== 0)
    throw new Error("空盘不应有棋子实例：opq=" + Game.opqCount + " gh=" + Game.ghCount);

  // 第 0 层 = 当前层 → 不透明
  Game.session.place(0, 0, 0);
  Game.onBoardChanged(false);
  if (Game.opqCount !== 1)
    throw new Error("落子后不透明棋子应为 1，实际 " + Game.opqCount);
  // gh 里还有 1 个"最后一手"的光晕
  if (Game.ghCount !== 1)
    throw new Error("当前层的子不应变成幽灵子（gh 应为 1，即只有光晕），实际 " + Game.ghCount);

  // 第 1 层 → 幽灵层模式下是幽灵子
  Game.session.place(1, 1, 1);
  Game.onBoardChanged(false);
  if (Game.opqCount !== 1) throw new Error("不透明棋子应仍为 1，实际 " + Game.opqCount);
  if (Game.ghCount !== 2)
    throw new Error("非当前层的子应成为幽灵子（1 颗幽灵 + 1 个光晕 = 2），实际 " + Game.ghCount);

  // 切片模式：z > 当前层的棋子完全不画，gh 里只剩最后一手的光晕
  Game.setGhostMode(false);
  if (Game.opqCount !== 1) throw new Error("切片模式：当前层应仍然不透明，实际 " + Game.opqCount);
  if (Game.ghCount !== 1)
    throw new Error("切片模式：被切掉的那一层必须一颗都不画（gh 应只剩光晕 1），实际 " + Game.ghCount);

  Game.setGhostMode(true);
});

step("设置页尺寸联动提示文案", () => {
  Game.setSetupSize(50);
  if (Game.el.sizeSummary.textContent.indexOf("125,000") < 0)
    throw new Error("50³ 应提示 125,000 格：" + Game.el.sizeSummary.textContent);
  Game.setSetupSize(15);
  if (Game.el.sizeSummary.textContent.indexOf("3,375") < 0)
    throw new Error("15³ 应显示 3,375 格：" + Game.el.sizeSummary.textContent);
});

step("面板点击坐标换算（cellFromEvent）命中【交织点】", () => {
  Game.newGame(15, 1);
  const n = 15;
  const w = Game.el.layerBase.clientWidth, h = Game.el.layerBase.clientHeight;
  // gridLayout 现在收 nx, ny（长方体棋盘两条边不一样长）。立方时传两次同一个 n。
  const lay = Game.gridLayout(w, h, n, n);
  // (i,j) 交织点的屏幕坐标：canvas 的 y 向下，所以 y 要翻过来
  const sx = (i) => lay.ox + i * lay.cs;
  const sy = (j) => h - (lay.oy + j * lay.cs);

  // 1) 往返一致：交织点 → 屏幕 → 必须还是同一个交织点（含四角与另外两角）
  for (const [cx, cy] of [[0, 0], [1, 3], [14, 14], [7, 7], [0, 14], [14, 0]]) {
    const cell = Game.cellFromEvent({ clientX: sx(cx), clientY: sy(cy) }, Game.el.layerBase);
    if (!cell) throw new Error("(" + cx + "," + cy + ") 应能换算成格子");
    if (cell.x !== cx || cell.y !== cy)
      throw new Error("换算错位：期望 (" + cx + "," + cy + ") 实际 (" + cell.x + "," + cell.y + ")");
  }

  // 2) 偏着点也必须命中【最近】的那个交织点。
  //    这一条专门盯死"用 floor 算格子、再当成格点用"的写法：那种写法整体偏半格，
  //    点在交织点右下时会被算到右下那一格去，而且是系统性偏差、越往边越明显。
  for (const [fx, fy] of [[7.4, 3.4], [0.4, 0.4], [13.6, 13.6], [7.5, 9.3]]) {
    const want = [Math.round(fx), Math.round(fy)];
    const cell = Game.cellFromEvent(
      { clientX: lay.ox + fx * lay.cs, clientY: h - (lay.oy + fy * lay.cs) }, Game.el.layerBase);
    if (!cell) throw new Error("(" + fx + "," + fy + ") 应能换算成格子");
    if (cell.x !== want[0] || cell.y !== want[1])
      throw new Error("(" + fx + "," + fy + ") 应命中最近交织点 " + want +
                      "，实际 (" + cell.x + "," + cell.y + ")");
  }

  // 3) 最外圈线再往外一整个格，必须落空。命中区只向外扩半格（round 的必然结果），
  //    不能扩到"整块画布都有响应" —— 那会让棋盘外的空白也变成可落子区。
  const outX = Game.cellFromEvent({ clientX: sx(0) - lay.cs, clientY: sy(7) }, Game.el.layerBase);
  if (outX) throw new Error("板外一格应落空，却命中了 " + JSON.stringify(outX));
  const outY = Game.cellFromEvent({ clientX: sx(7), clientY: h - (lay.oy - lay.cs) }, Game.el.layerBase);
  if (outY) throw new Error("板外一格应落空，却命中了 " + JSON.stringify(outY));
});

step("三维棋盘铺满 x/y/z 三个方向的格线", () => {
  // 顶点数 = 线段数 × 12（见 Renderer.buildLines：每条线段两个四边形、每个四边形 6 个顶点）
  // 线段数必须是 3n²（三个方向各 n²）+ 12（外框棱）。少画一个方向就会立刻露馅 ——
  // 这正是"立体棋盘要有 x/y/z 三个方向的线"这句话唯一能自动验的部分。
  for (const n of [15, 50]) {
    Game.newGame(n, 1);
    const want = (3 * n * n + 12) * 12;
    if (Game.staticGridCount !== want)
      throw new Error(n + "³ 静态格线顶点数：期望 " + want + "，实际 " + Game.staticGridCount);
  }
  Game.newGame(15, 1);
});

step("悬停校准线：过即将落子的格点，且 x/y/z 三个方向各一条", () => {
  Game.newGame(15, 1);
  const n = 15, cs = 10 / n, o = (n - 1) * 0.5;
  const world = (c) => [(c[0] - o) * cs, (c[1] - o) * cs, (c[2] - o) * cs];

  Game.setActiveLayer(6);
  Game.setHover({ x: 4, y: 9 });
  const segs = Game.hoverLineSegments();
  if (!segs || segs.length !== 3)
    throw new Error("应返回 3 条校准线，实际 " + (segs && segs.length));

  // 1) 每条线都必须真的穿过那个格点 —— 校准线偏了就是功能失效，不是"不好看"
  const p = world([4, 9, 6]);
  for (const s of segs) {
    for (let k = 0; k < 3; k++) {
      const lo = Math.min(s[0][k], s[1][k]), hi = Math.max(s[0][k], s[1][k]);
      if (p[k] < lo - 1e-6 || p[k] > hi + 1e-6)
        throw new Error("校准线 [" + s[0] + "]→[" + s[1] + "] 在第 " + k + " 维上不含格点 " +
                        p[k] + "（该维范围 " + lo + ".." + hi + "）");
    }
  }

  // 2) 每条只能沿一个轴延伸，且三个方向必须 x/y/z 各一条。
  //    这一条专门盯"三个方向各写一遍下标"里写反分量的错法 —— 那种错在屏幕上
  //    只表现为红线偏了一点，和"本来就这样"分不开。
  const dirs = segs.map((s) => {
    let d = -1;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(s[0][k] - s[1][k]) <= 1e-6) continue;
      if (d >= 0) throw new Error("校准线不是轴向的：[" + s[0] + "]→[" + s[1] + "]");
      d = k;
    }
    if (d < 0) throw new Error("校准线长度为 0：[" + s[0] + "]→[" + s[1] + "]");
    return d;
  }).sort();
  if (dirs.join(",") !== "0,1,2")
    throw new Error("三条校准线应覆盖 x/y/z 各一次，实际方向下标 " + dirs.join(","));
  if (!Game.hoverLineCount) throw new Error("悬停时应上传校准线，实际 hoverLineCount=" + Game.hoverLineCount);

  // 3) 没悬停 → 没有红线
  Game.setHover(null);
  if (Game.hoverLineSegments() !== null) throw new Error("没有悬停时不该返回校准线");
  if (Game.hoverLineCount !== 0) throw new Error("没有悬停时 hoverLineCount 应为 0");

  // 4) 已分胜负 → 没有红线（此时落子已被拒绝，再显示"即将落子"的引导线是自相矛盾的）
  Game.setHover({ x: 4, y: 9 });
  for (let x = 0; x < 4; x++) { Game.tryPlace(x, 0); Game.tryPlace(x, 1); }
  const out = Game.session.place(4, 0, 6);
  Game.onMoveApplied(Game.session.history[Game.session.moveCount - 1], out);
  if (Game.session.status !== "Decided")
    throw new Error("这一手应分出胜负，实际 " + Game.session.status);
  if (Game.hoverLineSegments() !== null) throw new Error("已分胜负时不该返回校准线");
  if (Game.hoverLineCount !== 0) throw new Error("已分胜负时 hoverLineCount 应为 0");

  Game.newGame(15, 1);   // 复位，别影响后面的步骤
});

step("三维拾取（pick）在默认视角下命中棋盘中心附近", () => {
  Game.newGame(15, 1);
  const r = Game.el.gl.getBoundingClientRect();
  // 相机默认朝向原点，屏幕中心应当落在当前层平面上的棋盘范围内
  const cell = Game.pick(r.width / 2, r.height / 2);
  if (!cell) throw new Error("屏幕中心应能拾取到格子");
  if (cell.x < 0 || cell.x >= 15 || cell.y < 0 || cell.y >= 15)
    throw new Error("拾取结果越界：" + JSON.stringify(cell));
});

step("悬停状态切换会更新坐标文字", () => {
  Game.setHover({ x: 3, y: 4 });
  if (Game.el.coords.textContent.indexOf("(3,4,") < 0)
    throw new Error("坐标文字不对：" + Game.el.coords.textContent);
  Game.setHover(null);
});

step("提示框：折叠开关翻转类和按钮文字，切语言也跟着走", () => {
  // 桩里没有 getComputedStyle，readCompact() 返回 false —— 也就是【大屏 = 默认展开】。
  // 这一条同时钉住了那个兜底：哪天 readCompact 在桩里意外返回 true，这里会先红。
  if (Game.hintFolded) throw new Error("桩环境是大屏，提示框不该默认折叠");
  if (Game.el.hintbox.classList.contains("folded"))
    throw new Error("大屏下不该带 .folded 类");
  if (Game.el.hintToggle.textContent !== "收起")
    throw new Error("展开态按钮应写「收起」，实际 " + JSON.stringify(Game.el.hintToggle.textContent));

  Game.toggleHint();
  if (!Game.hintFolded) throw new Error("toggleHint 之后 hintFolded 应为 true");
  if (!Game.el.hintbox.classList.contains("folded"))
    throw new Error("折叠后 #hintbox 应带 .folded（CSS 靠它把整块收成一颗胶囊）");
  if (Game.el.hintToggle.textContent !== "提示")
    throw new Error("折叠态按钮应写「提示」，实际 " + JSON.stringify(Game.el.hintToggle.textContent));

  // 按钮文字是 JS 写的，applyStatic 那条静态通路管不到它 —— 切语言必须能重刷。
  Game.setLang("en");
  if (Game.el.hintToggle.textContent !== "Hints")
    throw new Error("英文界面下折叠态按钮应为 Hints，实际 " + JSON.stringify(Game.el.hintToggle.textContent));
  Game.toggleHint();
  if (Game.el.hintToggle.textContent !== "Hide")
    throw new Error("英文界面下展开态按钮应为 Hide，实际 " + JSON.stringify(Game.el.hintToggle.textContent));
  Game.setLang("zh");
  if (Game.el.hintToggle.textContent !== "收起") throw new Error("切回中文后按钮文字没跟着回去");

  if (Game.hintFolded || Game.el.hintbox.classList.contains("folded"))
    throw new Error("展开了还留着 .folded");
});

step("提示框：WebGL2 起不来时强制展开（折叠态会把故障说明藏起来）", () => {
  // #hint 是 data-i18n-html 元素，内容有快照；这一段跑完必须原样放回去，
  // 否则后面那条"切回中文后每个静态元素与 HTML 原文逐字节相等"会被这里改脏。
  const savedHint = Game.el.hint.innerHTML;
  const savedFailed = Game.glFailed;
  try {
    Game.setHintFolded(true);
    Game.glFailed = true;
    Game.refreshHint();
    if (Game.hintFolded) throw new Error("WebGL2 故障时提示框必须强制展开");
    if (Game.el.hintbox.classList.contains("folded")) throw new Error("强制展开后 .folded 应被摘掉");
    if (Game.el.hint.innerHTML.indexOf("WebGL2") < 0)
      throw new Error("故障说明没写进 #hint：" + Game.el.hint.innerHTML.slice(0, 60));
  } finally {
    Game.glFailed = savedFailed;
    Game.el.hint.innerHTML = savedHint;
    Game.setHintFolded(false);
  }
});

// ---------------------------------------------------------------------------
// 四维模式：转动面板
// ---------------------------------------------------------------------------

step("转动面板随模式显隐，且三维模式确实转不动", () => {
  Game.setSetupMode(false);
  Game.newGame(15, 1);
  if (Game.session.rotationEnabled) throw new Error("三维模式下不该允许转动");
  if (!Game.el.rotPanel.classList.contains("off"))
    throw new Error("三维模式下转动面板应带 off 类（完全不占位）");

  Game.setSetupMode(true);
  if (Game.setupSize !== 8) throw new Error("切到四维后尺寸应重置为默认 8，实际 " + Game.setupSize);
  Game.newGame(Game.setupSize, 1);
  if (!Game.session.rotationEnabled) throw new Error("四维模式下应允许转动");
  if (Game.el.rotPanel.classList.contains("off"))
    throw new Error("四维模式下转动面板不该带 off 类");
  if (!Game.el.stripWrap.classList.contains("compact"))
    throw new Error("四维模式下缩略条应让位（compact），否则棋盘区会被挤扁");

  // 三维模式点「执行转动」必须什么都不发生（回调挂上了，但内核会拒）
  Game.setSetupMode(false);
  Game.newGame(15, 1);
  Game.doRotate();
  if (Game.session.rotationCount !== 0)
    throw new Error("三维模式下转动竟然生效了");
});

step("冷却门槛：落满 5 手前转不动，之后才可转", () => {
  Game.setSetupMode(true);
  Game.setupCool = 5;
  Game.newGame(8, 1);

  const stoneIn = (x, y, z) => Game.session.board.set(x, y, z, 1);   // 1 = 黑
  stoneIn(0, 0, 0);              // 给 z=0 层放一颗，免得撞上"空层"判定
  Game.refreshRotPanel();

  if (!Game.el.rotGo.disabled) throw new Error("开局（0 手）不该能转动");
  for (let i = 0; i < 5; i++) { Game.tryPlace(i + 1, 0); }
  if (Game.session.moveCount !== 5) throw new Error("应已落 5 手");
  if (Game.el.rotGo.disabled) throw new Error("落满 5 手后应可以转动");
  if (!Game.el.rotStatus.textContent.includes("可以转动"))
    throw new Error("状态文字应说可以转动，实际：" + Game.el.rotStatus.textContent);

  // 转一次
  const before = Game.session.moveCount;
  const turnBefore = Game.session.currentPlayer;
  Game.doRotate();
  if (Game.session.rotationCount !== 1) throw new Error("转动应被记录，实际 " + Game.session.rotationCount);
  if (Game.session.moveCount !== before) throw new Error("转动不该改变落子数");
  if (Game.session.currentPlayer === turnBefore) throw new Error("转动必须占掉一整个回合");
  if (!Game.el.rotGo.disabled) throw new Error("刚转完应重新进入冷却");
});

step("恢复本次转动：只在最后一步是转动时可用，且完整还原盘面", () => {
  Game.setSetupMode(true);
  Game.setupCool = 0;
  Game.newGame(8, 1);

  Game.session.board.set(0, 0, 0, 1);   // 1 = 黑
  Game.rotAxis = 0; Game.rotLayer = 0; Game.rotClockwise = true; Game.rotTurns = 1;
  Game.refreshRotPanel();

  const snapshot = () => {
    const b = Game.session.board; let s = "";
    for (let z = 0; z < b.size; z++) for (let y = 0; y < b.size; y++) for (let x = 0; x < b.size; x++) s += b.get(x, y, z);
    return s;
  };

  if (!Game.el.rotRestore.disabled) throw new Error("还没转过的时候不该能恢复");
  const before = snapshot();
  Game.doRotate();
  if (Game.session.rotationCount !== 1) throw new Error("转动应成功");
  if (snapshot() === before) throw new Error("转动应该改变了盘面（否则这条测试没意义）");
  if (Game.el.rotRestore.disabled) throw new Error("刚转完应能恢复");

  Game.restoreRotation();
  if (Game.session.rotationCount !== 0) throw new Error("恢复后转动记录应被撤掉");
  if (snapshot() !== before) throw new Error("恢复后盘面必须逐格还原");
  if (Game.el.rotRestore.disabled === false) throw new Error("恢复之后不该还能再恢复");

  // 转完再落一手，就不能再单独恢复那次转动了
  Game.doRotate();
  Game.tryPlace(7, 7);
  if (!Game.el.rotRestore.disabled)
    throw new Error("已经有人落子了，不该还能单独撤销那次转动");
});

step("空层提示要说清是【空的】，而不是默默失败", () => {
  Game.setSetupMode(true);
  Game.setupCool = 0;
  Game.newGame(8, 1);
  Game.rotAxis = 2; Game.rotLayer = 5;    // z=5 没有任何子
  Game.refreshRotPanel();

  if (Game.el.rotLayerLabel.textContent.indexOf("0 子") < 0)
    throw new Error("层标签应显示本层 0 子，实际：" + Game.el.rotLayerLabel.textContent);
  if (Game.el.rotHint.textContent.indexOf("空") < 0)
    throw new Error("应提示这一层是空的，实际：" + Game.el.rotHint.textContent);

  Game.doRotate();
  if (Game.session.rotationCount !== 0) throw new Error("转空层不该留下记录");
  if (Game.toastTimer <= 0) throw new Error("转空层应给出一次提示");
});

step("待转层绿框：四条边都落在该平面上，且是轴向的矩形", () => {
  // 这一条盯的是"三个轴的自由轴顺序各写一遍下标"里写反分量的错法 ——
  // 那种错在屏幕上只表现为绿框跑到了另一个平面上，和"本来就这样"肉眼分不开。
  Game.setSetupMode(true);
  Game.newGame(8, 1);
  const n = 8, cs = 10 / n, ext = (n - 1) * 0.5 * cs, off = (n - 1) * 0.5;

  for (const axis of [0, 1, 2]) {
    for (const layer of [0, 3, 7]) {
      Game.rotAxis = axis;
      Game.rotLayer = layer;
      const segs = Game.rotationOutlineSegments(n, cs);
      if (!segs || segs.length !== 4)
        throw new Error("轴" + axis + " 层" + layer + " 应返回 4 条边，实际 " + (segs && segs.length));

      const want = (layer - off) * cs;
      const i = (axis + 1) % 3, j = (axis + 2) % 3;

      for (const s of segs) {
        for (const p of [s[0], s[1]]) {
          if (p.length !== 3) throw new Error("绿框顶点应是三维坐标");
          if (Math.abs(p[axis] - want) > 1e-6)
            throw new Error("轴" + axis + " 层" + layer + "：绿框顶点在该轴上是 " + p[axis] + "，应为 " + want);
          for (const k of [i, j]) {
            if (Math.abs(Math.abs(p[k]) - ext) > 1e-6)
              throw new Error("轴" + axis + " 层" + layer + "：绿框顶点在第 " + k + " 维上是 " + p[k] +
                              "，应落在 ±" + ext);
          }
        }
        const di = Math.abs(s[0][i] - s[1][i]) > 1e-6;
        const dj = Math.abs(s[0][j] - s[1][j]) > 1e-6;
        if (di === dj)
          throw new Error("轴" + axis + " 层" + layer + "：绿框的边不是轴向的 [" + s[0] + "]→[" + s[1] + "]");
      }

      // 矩形必须是 2 条沿一个轴、2 条沿另一个轴 —— 少一条或三条都会在这里露馅
      let alongI = 0, alongJ = 0;
      for (const s of segs) (Math.abs(s[0][i] - s[1][i]) > 1e-6) ? alongI++ : alongJ++;
      if (alongI !== 2 || alongJ !== 2)
        throw new Error("轴" + axis + " 层" + layer + "：绿框应是 2×2 条边，实际 " + alongI + "/" + alongJ);
    }
  }

  // 非四维模式不画绿框
  Game.setSetupMode(false);
  Game.newGame(15, 1);
  if (Game.rotationOutlineSegments(15, 10 / 15) !== null)
    throw new Error("三维模式下不该有绿框");
});

step("转动之后，最后一手标记不能挂在一颗无关的子（或空格）上", () => {
  // 转动会把棋子搬走。原来的实现只判"那一格不空"，于是一个被搬空的格子
  // （或恰好被对手子顶上的格子）也会亮起"最后一手"的光晕。
  Game.setSetupMode(true);
  Game.setupCool = 0;
  Game.newGame(8, 1);
  Game.setActiveLayer(0);
  Game.setGhostMode(true);          // 幽灵层模式：非当前层的子进 gh

  Game.tryPlace(0, 0);              // 落在 (0,0,0)，属于当前层 z=0
  if (Game.opqCount !== 1) throw new Error("当前层的子应是不透明实例，实际 opq=" + Game.opqCount);
  if (Game.ghCount !== 1) throw new Error("最后一手的光晕应有 1 个，实际 gh=" + Game.ghCount);

  // 绕 x 轴转第 0 层：(0,0,0) -> (0,0,7)，离开当前层，且原来的格子变空
  Game.rotAxis = 0; Game.rotLayer = 0; Game.rotClockwise = true; Game.rotTurns = 1;
  Game.doRotate();
  if (Game.session.rotationCount !== 1) throw new Error("转动应成功");
  if (!Game.session.board.isEmpty(0, 0, 0)) throw new Error("(0,0,0) 应该已经被搬空了");

  if (Game.opqCount !== 0)
    throw new Error("被搬走之后当前层不该还有不透明子，实际 opq=" + Game.opqCount);
  if (Game.ghCount !== 1)
    throw new Error("应只剩那颗被搬走的幽灵子（光晕不该跟着跑到空格上），实际 gh=" + Game.ghCount);

  Game.setSetupMode(false);
  Game.newGame(15, 1);
});

// ---------------------------------------------------------------------------
// 新增：可编辑尺寸、长方体棋盘、起始界面演示盘、调色板单一事实源
// ---------------------------------------------------------------------------

step("尺寸输入框：HTML 的 min/max 必须和 BoardLimits 是同一组数", () => {
  // 夹取用的是 BoardLimits，而输入框上还写着一份 min/max（浏览器自带的上下箭头和校验用它）。
  // 两份数不一致的话，用户能填进一个 JS 会立刻夹掉的数 —— 表现为"填完就自己变了"。
  if (dimInputMax.size !== 4)
    throw new Error("4 个尺寸输入框都要有 max 属性，实际解析到 " + dimInputMax.size + " 个");
  for (const [id, mx] of dimInputMax) {
    if (mx !== BoardLimits.Max)
      throw new Error(id + " 的 max=" + mx + " 与 BoardLimits.Max=" + BoardLimits.Max + " 不一致");
  }
  const mins = [...html.matchAll(/<input id="dim[XYZNC]"[^>]*min="(\d+)"/g)].map((m) => parseInt(m[1], 10));
  if (mins.length !== 4) throw new Error("4 个尺寸输入框都要有 min 属性，实际 " + mins.length + " 个");
  for (const mn of mins) {
    if (mn !== BoardLimits.Min)
      throw new Error("min=" + mn + " 与 BoardLimits.Min=" + BoardLimits.Min + " 不一致");
  }
});

step("尺寸输入框：三轴联动时改一个等于改三个，且夹到 [Min, Max]", () => {
  Game.setSetupMode(false);
  Game.setSetupCube(true);
  Game.setSetupDims(15, 15, 15);

  const x = Game.el.dimX;
  x.value = "20";
  x.dispatch("change");
  if (Game.setupDims.join(",") !== "20,20,20")
    throw new Error("三轴联动时改 x 应把三个轴都设成 20，实际 " + Game.setupDims.join(","));
  if (Game.el.dimY.value !== "20" || Game.el.dimZ.value !== "20")
    throw new Error("输入框没有同步：" + Game.el.dimY.value + "," + Game.el.dimZ.value);

  // 越界：夹取，并且把输入框标红（告诉用户数被改过）
  x.value = "99";
  x.dispatch("change");
  if (Game.setupDims[0] !== BoardLimits.Max)
    throw new Error("99 应夹到上限 " + BoardLimits.Max + "，实际 " + Game.setupDims[0]);
  if (!x.classList.contains("bad")) throw new Error("被夹取过的输入框应标红");
  if (x.value !== String(BoardLimits.Max)) throw new Error("输入框里应显示夹取后的值");

  x.value = "3";
  x.dispatch("change");
  if (Game.setupDims[0] !== BoardLimits.Min)
    throw new Error("3 应夹到下限 " + BoardLimits.Min + "，实际 " + Game.setupDims[0]);

  // 空 / 乱打：退回原值，而不是当成"要最小的盘"
  const before = Game.setupDims[0];
  x.value = "";
  x.dispatch("change");
  if (Game.setupDims[0] !== before)
    throw new Error("空输入应退回原值 " + before + "，实际 " + Game.setupDims[0]);
  x.value = "abc";
  x.dispatch("change");
  if (Game.setupDims[0] !== before)
    throw new Error("非数字应退回原值 " + before + "，实际 " + Game.setupDims[0]);
});

step("三轴联动关掉后可以填长方体，说明行按三条边各算一遍", () => {
  Game.setSetupMode(false);
  Game.setSetupCube(false);
  Game.setSetupDims(8, 12, 30);
  if (Game.setupDims.join(",") !== "8,12,30")
    throw new Error("长方体尺寸没生效：" + Game.setupDims.join(","));
  if (Game.el.sizeSummary.textContent.indexOf("8 × 12 × 30") < 0)
    throw new Error("说明行应显示 8 × 12 × 30：" + Game.el.sizeSummary.textContent);
  if (Game.el.sizeSummary.textContent.indexOf("2,880") < 0)
    throw new Error("8×12×30 应显示 2,880 格：" + Game.el.sizeSummary.textContent);
  // 长方体必须明说它是网页版独有的扩展 —— 否则 README 里"两份实现逐条一致"会被悄悄推翻
  if (Game.el.sizeSummary.textContent.indexOf("网页版独有") < 0)
    throw new Error("长方体必须写明是网页版独有的扩展：" + Game.el.sizeSummary.textContent);

  Game.setSetupCube(true);
  if (Game.setupDims.join(",") !== "8,8,8")
    throw new Error("开回三轴联动应该立刻变立方，实际 " + Game.setupDims.join(","));
});

step("切到四维：尺寸换成单个 N，且必须立方", () => {
  Game.setSetupMode(true);
  if (Game.setupDims.join(",") !== "8,8,8")
    throw new Error("切到四维应重置成 8³，实际 " + Game.setupDims.join(","));
  if (Game.setupSize !== 8) throw new Error("setupSize 应是 8，实际 " + Game.setupSize);
  if (!Game.setupCube) throw new Error("四维模式必须保持三轴联动");
  const n = Game.el.dimN;
  n.value = "30";
  n.dispatch("change");
  if (Game.setupDims.join(",") !== "30,30,30")
    throw new Error("四维下改 N 应得到立方，实际 " + Game.setupDims.join(","));
  Game.setSetupMode(false);
  if (Game.el.sizeSummary.textContent.indexOf("15 × 15 × 15") < 0)
    throw new Error("切回三维应重置成 15³：" + Game.el.sizeSummary.textContent);
});

step("长方体棋盘能开局：内核、面板、缩略条、三维实例都跟着走", () => {
  Game.setSetupMode(false);
  Game.setSetupCube(false);
  Game.newGame([8, 12, 30], 1);
  const d = Game.session.board.dims;
  if (d.join(",") !== "8,12,30") throw new Error("dims 应为 8,12,30，实际 " + d.join(","));
  // 长方体下【不该】去读 .size：那个 getter 会按设计抛异常，为的就是让
  // 「只改了三个轴里的一个」这类漏改在第一次执行时就暴露，而不是拿 nx 继续算下去。
  if (Game.session.board.nx !== 8 || Game.session.board.ny !== 12 || Game.session.board.nz !== 30)
    throw new Error("nx/ny/nz 应为 8/12/30");
  let sizeThrew = false;
  try { void Game.session.size; } catch (e) { sizeThrew = true; }
  if (!sizeThrew) throw new Error("长方体棋盘读 .size 必须抛异常，而不是返回某个数");
  // colCounts 的长度是 nx*ny、layerCounts 是 nz —— 长方体下这两个数各不相同，
  // 用同一个 n 算的话面板会在某一层读到 undefined（表现为"提示方块整片消失"）
  if (Game.colCounts.length !== 8 * 12) throw new Error("colCounts 长度应为 96，实际 " + Game.colCounts.length);
  if (Game.layerCounts.length !== 30) throw new Error("layerCounts 长度应为 30，实际 " + Game.layerCounts.length);

  Game.session.place(0, 0, 29);
  Game.session.place(7, 11, 0);
  Game.onBoardChanged(true);
  Game.draw3D();
  if (Game.opqCount !== 1) throw new Error("第 0 层应有 1 个不透明实例（其他层是幽灵），实际 " + Game.opqCount);
  if (Game.ghCount !== 2) throw new Error("应有 1 个幽灵 + 1 个最后一手光晕，实际 " + Game.ghCount);

  Game.setActiveLayer(29);
  if (Game.opqCount !== 1) throw new Error("换到第 29 层后应有 1 个不透明实例，实际 " + Game.opqCount);
  Game.newGame(15, 1);
});

step("长方体棋盘：格线几何 —— 每条线只沿一条轴，半长必须是那条轴自己的", () => {
  // 只数条数是不够的：把 ∥y 的线的半长从 ey 误写成 ex，条数一个不差，
  // 屏幕上却表现为"y 方向的格线戳出了棋盘"—— 这类错只能靠校验几何本身抓住。
  const d = [8, 12, 30];
  Game.newGame(d, 1);
  const cs = cellSize(d);
  const ext = [(d[0] - 1) * 0.5 * cs, (d[1] - 1) * 0.5 * cs, (d[2] - 1) * 0.5 * cs];
  const segs = Game.gridSegments(d, cs, cs * 0.06);

  const lineCount = { 0: 0, 1: 0, 2: 0 };
  const bad = [];
  for (const seg of segs) {
    const [a, b] = seg;
    // 每条线段只能沿一个轴延伸
    let k = -1;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(a[i] - b[i]) > 1e-9) {
        if (k >= 0) { bad.push("不是轴向的：[" + a + "]→[" + b + "]"); k = -2; break; }
        k = i;
      }
    }
    if (k < 0) continue;
    lineCount[k]++;
    // 两端必须关于原点对称，半长恰好是这条轴自己的 ext
    if (Math.abs(a[k] + b[k]) > 1e-9)
      bad.push("第 " + k + " 维两端不对称：" + a[k] + " 与 " + b[k]);
    else if (Math.abs(Math.abs(a[k]) - ext[k]) > 1e-9)
      bad.push("第 " + k + " 维半长应为 " + ext[k] + "，实际 " + Math.abs(a[k]));
    // 另外两维必须落在棋盘范围内 —— 这一条专门抓"两个方向的 ext 写反"
    for (let i = 0; i < 3; i++) {
      if (i === k) continue;
      if (Math.abs(a[i]) > ext[i] + 1e-9)
        bad.push("第 " + i + " 维的固定坐标 " + a[i] + " 超出了棋盘 " + ext[i]);
    }
  }
  if (bad.length) throw new Error(bad.slice(0, 4).join(" / "));

  // 方向的条数：∥x 由 (y,z) 决定 → ny*nz 条，依此类推
  if (lineCount[0] !== d[1] * d[2] + 4)   // 内含的外框棱也沿 x
    throw new Error("∥x 的线段数应为 ny*nz+4=" + (d[1] * d[2] + 4) + "，实际 " + lineCount[0]);
  if (lineCount[1] !== d[0] * d[2] + 4)
    throw new Error("∥y 的线段数应为 nx*nz+4=" + (d[0] * d[2] + 4) + "，实际 " + lineCount[1]);
  if (lineCount[2] !== d[0] * d[1] + 4)
    throw new Error("∥z 的线段数应为 nx*ny+4=" + (d[0] * d[1] + 4) + "，实际 " + lineCount[2]);
  Game.newGame(15, 1);
});

step("长方体棋盘：缩略条里的棋子必须画在瓦片内，且两个方向同一个格距", () => {
  // 缩略条是"每层一格"，瓦片是方的而棋盘不是 —— 格距必须按两个方向里大的那个算，
  // 否则 12 行的棋盘会被按 8 列的比例撑开，棋子整列画到瓦片外面去。
  // 桩里的 2D 上下文记了 fillRect，这里就能真的查"有没有溢出去"。
  const d = [8, 12, 30];
  Game.newGame(d, 1);
  const board = Game.session.board;
  board.set(0, 0, 0, 1); board.set(7, 11, 0, 2); board.set(3, 5, 0, 1);
  Game.onBoardChanged(true);

  const ctx = Game.ctxStrip;
  if (!ctx || !ctx.ops) throw new Error("桩的 2D 上下文没有记录绘制调用");
  ctx.ops.length = 0;
  Game.drawStrip();

  const cw = Game.el.strip.clientWidth, ch = Game.el.strip.clientHeight;
  const tile = Game.stripTileRect(0, cw, ch, d[2]);
  if (!tile) throw new Error("第 0 层应该有瓦片");
  // 棋子是小方块：只挑尺寸明显小于瓦片的 fillRect（板面/占用条不是这个量级）
  // 棋子的方块是【正方形】，而每层底部的占用条是又宽又扁的一条 —— 靠长宽比区分。
  // 不能只按"尺寸小"筛：占用条的高度只有瓦片的 8%，也会被当成棋子。
  const stoneRects = ctx.ops.filter((o) => o.op === "fillRect" &&
    o.w > 0 && Math.abs(o.w - o.h) < 1e-6 && o.w < tile.size * 0.5);
  if (stoneRects.length < 3)
    throw new Error("第 0 层的 3 颗子都应画出小方块，实际只有 " + stoneRects.length + " 个");

  const out = stoneRects.filter((o) =>
    o.x < tile.x - 1e-6 || o.x + o.w > tile.x + tile.size + 1e-6 ||
    o.y < tile.y - 1e-6 || o.y + o.h > tile.y + tile.size + 1e-6);
  if (out.length)
    throw new Error(out.length + " 颗子画到了瓦片外面，例如 " +
                    JSON.stringify(out[0]) + "，瓦片 " + JSON.stringify(tile));

  // 格距必须是 t.size / max(nx,ny)，子的大小是它的 0.68 倍（和三维球体、面板圆的比值一致）。
  // 用 t.size/nx 算的话，12 行的棋盘会被按 8 列的比例撑开 —— 也就是上面那条溢出。
  const cs = tile.size / Math.max(d[0], d[1]);
  if (Math.abs(stoneRects[0].w - Math.max(1, cs * 0.68)) > 1e-6)
    throw new Error("缩略条里子的大小应为 " + (cs * 0.68) + "，实际 " + stoneRects[0].w);

  // 同一层里三颗子的相对位置必须按 (x,y) 的格距走 —— 两个方向共用一个 cs
  const byX = stoneRects.slice().sort((a, b) => a.x - b.x);
  // (0,0) 与 (3,5)：横距 3cs、纵距 5cs
  if (Math.abs((byX[1].x - byX[0].x) - 3 * cs) > 1e-6)
    throw new Error("横向格距不对：期望 " + 3 * cs + "，实际 " + (byX[1].x - byX[0].x));
  if (Math.abs(Math.abs(byX[1].y - byX[0].y) - 5 * cs) > 1e-6)
    throw new Error("纵向格距不对：期望 " + 5 * cs + "，实际 " + Math.abs(byX[1].y - byX[0].y));

  Game.newGame(15, 1);
});

step("长方体棋盘：面板布局必须填满画布的至少一个方向", () => {
  // 往返一致只证明"两处约定相同"，证明不了约定本身对 ——
  // 把 cs 换成 min(w,h)/max(nx,ny) 之后往返依然一致，只是棋盘白白缩小了一圈。
  // 真正的不变量：板面至少把一个方向铺满（棋盘的尺寸利用率必须是最大的）。
  const w = Game.el.layerBase.clientWidth, h = Game.el.layerBase.clientHeight;
  for (const d of [[8, 12], [12, 8], [8, 8], [20, 8], [8, 50]]) {
    const lay = Game.gridLayout(w, h, d[0], d[1]);
    const spansW = Math.abs(lay.cs * d[0] - w) < 1e-6;
    const spansH = Math.abs(lay.cs * d[1] - h) < 1e-6;
    if (!spansW && !spansH)
      throw new Error(d.join("×") + " 的布局没有铺满任何一个方向：cs=" + lay.cs +
                      " 板面 " + (lay.cs * d[0]) + "×" + (lay.cs * d[1]) + " 画布 " + w + "×" + h);
    // 居中的定义：两条边各自留白相等
    const mx = w - lay.cs * (d[0] - 1) - 2 * lay.ox;
    const my = h - lay.cs * (d[1] - 1) - 2 * lay.oy;
    if (Math.abs(mx) > 1e-6 || Math.abs(my) > 1e-6)
      throw new Error(d.join("×") + " 的布局没有居中");
  }
});

step("长方体棋盘：面板板面的矩形必须按 nx × ny 铺", () => {
  // 板面（"棋盘纸"）的尺寸是 layout 约定的一部分，而且它只在 canvas 上留一个矩形 ——
  // 写错的话页面上只是"棋盘纸比格子多出来或少了一块"，没有任何测试会报警。
  // 桩里的 2D 上下文是空实现，这里让它把 fillRect 记下来，才能真的查这个矩形。
  const ctx = Game.ctxBase;
  if (!ctx || !ctx.ops) throw new Error("桩的 2D 上下文没有记录绘制调用（makeCtx2d 应该记 ops）");
  const d = [8, 12, 30];
  Game.newGame(d, 1);
  ctx.ops.length = 0;
  Game.drawLayerBase();
  const w = Game.el.layerBase.clientWidth, h = Game.el.layerBase.clientHeight;
  const lay = Game.gridLayout(w, h, d[0], d[1]);
  const cs = lay.cs;
  const face = ctx.ops.filter((o) => o.op === "fillRect" &&
    Math.abs(o.w - cs * d[0]) < 1e-6 && Math.abs(o.h - cs * d[1]) < 1e-6);
  if (face.length !== 1)
    throw new Error("板面矩形应恰好有一个 " + (cs * d[0]) + "×" + (cs * d[1]) +
                    " 的 fillRect，实际找到 " + face.length + " 个");
  // 位置：外圈线再往外半个格
  const f = face[0];
  if (Math.abs(f.x - (lay.ox - cs * 0.5)) > 1e-6 || Math.abs(f.y - (lay.oy - cs * 0.5)) > 1e-6)
    throw new Error("板面矩形的起点应为外圈线外半格，实际 (" + f.x + "," + f.y + ")");
  Game.newGame(15, 1);
});

step("长方体棋盘：格线条数按三条边各算一份", () => {
  // 线段数必须是 nx*ny + ny*nz + nz*nx（三个方向各按自己的边长铺）+ 12 条外框棱。
  // 立方时它退化成 3n²，也就是这个文件里原来那条断言的公式 —— 两条公式必须是同一个。
  for (const d of [[15, 15, 15], [50, 50, 50], [8, 12, 30], [30, 8, 8], [8, 50, 8]]) {
    Game.newGame(d, 1);
    const want = (d[0] * d[1] + d[1] * d[2] + d[2] * d[0] + 12) * 12;
    if (Game.staticGridCount !== want)
      throw new Error(d.join("×") + " 静态格线顶点数：期望 " + want + "，实际 " + Game.staticGridCount);
  }
  Game.newGame(15, 1);
});

step("长方体棋盘：悬停校准线各按自己那条轴延伸", () => {
  const d = [8, 20, 12];
  Game.newGame(d, 1);
  const cs = cellSize(d);
  const span = [(d[0] - 1) * 0.5 * cs, (d[1] - 1) * 0.5 * cs, (d[2] - 1) * 0.5 * cs];

  Game.setActiveLayer(7);
  Game.setHover({ x: 3, y: 14 });
  const segs = Game.hoverLineSegments();
  if (!segs || segs.length !== 3) throw new Error("应返回 3 条校准线");

  const target = [(3 - (d[0] - 1) * 0.5) * cs, (14 - (d[1] - 1) * 0.5) * cs, (7 - (d[2] - 1) * 0.5) * cs];
  for (let k = 0; k < 3; k++) {
    const s = segs[k];
    // 每条线只能沿【一条】轴延伸，而且是第 k 条轴
    for (let a = 0; a < 3; a++) {
      const varies = s[0][a] !== s[1][a];
      if (varies !== (a === k))
        throw new Error("第 " + k + " 条线应在第 " + k + " 维上延伸，实际在第 " + a + " 维" +
                        (varies ? "延伸" : "不变"));
    }
    // 必须穿过即将落子的那个格点。判据是【区间包含】而不是逐维相等 ——
    // 第 k 条线在第 k 维上正是变化的那一维，它的端点当然不等于落点。
    for (let a = 0; a < 3; a++) {
      const lo = Math.min(s[0][a], s[1][a]), hi = Math.max(s[0][a], s[1][a]);
      if (target[a] < lo - 1e-9 || target[a] > hi + 1e-9)
        throw new Error("第 " + k + " 条线在第 " + a + " 维上不含落点 " + target[a] +
                        "（该维范围 " + lo + ".." + hi + "）");
    }
    // 半长必须是【这条轴自己的】，而且以世界原点为中心（棋盘中心）：
    // 用同一个 ext 会让短轴上的线戳出棋盘外。注意不能拿落点当尺子量 ——
    // 落点在第 k 维上的坐标是它在棋盘里的位置，不是这条线的中心。
    if (Math.abs(s[0][k] + s[1][k]) > 1e-9)
      throw new Error("第 " + k + " 条线的两端应关于原点对称：" + s[0][k] + " 与 " + s[1][k]);
    const got = Math.abs(s[0][k]);
    if (Math.abs(got - span[k]) > 1e-9)
      throw new Error("第 " + k + " 条线的半长应为 " + span[k] + "，实际 " + got);
  }
  Game.setHover(null);
  Game.newGame(15, 1);
});

step("长方体棋盘：面板交织点换算往返一致，且板外一格必须落空", () => {
  const d = [8, 20, 12];
  Game.newGame(d, 1);
  Game.setActiveLayer(4);
  const w = Game.el.layerBase.clientWidth, h = Game.el.layerBase.clientHeight;
  const lay = Game.gridLayout(w, h, d[0], d[1]);
  const sx = (i) => lay.ox + i * lay.cs;
  const sy = (j) => h - (lay.oy + j * lay.cs);

  for (const [cx, cy] of [[0, 0], [7, 19], [7, 0], [0, 19], [3, 14]]) {
    const cell = Game.cellFromEvent({ clientX: sx(cx), clientY: sy(cy) }, Game.el.layerBase);
    if (!cell) throw new Error("(" + cx + "," + cy + ") 应能换算成格子");
    if (cell.x !== cx || cell.y !== cy)
      throw new Error("换算错位：期望 (" + cx + "," + cy + ") 实际 (" + cell.x + "," + cell.y + ")");
  }
  // x 和 y 的边长不同，边界必须各按各的判 —— 用同一个 n 判会让短边之外也能点中
  const outX = Game.cellFromEvent({ clientX: sx(0) - lay.cs, clientY: sy(10) }, Game.el.layerBase);
  if (outX) throw new Error("x 方向板外一格应落空，却命中 " + JSON.stringify(outX));
  const outY = Game.cellFromEvent({ clientX: sx(3), clientY: h - (lay.oy - lay.cs) }, Game.el.layerBase);
  if (outY) throw new Error("y 方向板外一格应落空，却命中 " + JSON.stringify(outY));
  Game.newGame(15, 1);
});

step("起始界面：演示盘是 10³、确定性、且不画对局才有的东西", () => {
  Game.setSetupMode(false);
  // 先关掉再打开：只断言"打开了有 preview 类"是查不出问题的 ——
  // init() 在启动时就已经加上这个类了，那条断言在"openSetup 忘了加类"时照样通过。
  Game.closeSetup();
  if (Game.el.stage.classList.contains("preview"))
    throw new Error("closeSetup 之后 #stage 不该还有 preview 类");
  Game.openSetup();
  if (!Game.setupOpen) throw new Error("openSetup 之后 setupOpen 应为 true");
  if (!Game.el.stage.classList.contains("preview")) throw new Error("应给 #stage 加上 preview 类");
  if (Game.el.setup.classList.contains("off")) throw new Error("#setup 不该带 off");

  const pb = Game.ensurePreview();
  if (pb.dims.join(",") !== "10,10,10") throw new Error("演示盘应是 10³，实际 " + pb.dims.join(","));
  if (pb.stoneCount <= 0) throw new Error("演示盘上应该有棋子");
  // 固定哈希：两次构造必须逐格相同，否则每次刷新页面看到的盘都不一样
  const again = Game.buildPreviewBoard();
  let diff = 0;
  for (let z = 0; z < 10; z++) for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++)
    if (pb.get(x, y, z) !== again.get(x, y, z)) diff++;
  if (diff !== 0) throw new Error("演示盘必须是确定性的，两次构造差了 " + diff + " 格");

  Game.uploadPreviewInstances();
  if (Game.opqCount !== pb.stoneCount)
    throw new Error("演示盘的不透明实例数应等于棋子数 " + pb.stoneCount + "，实际 " + Game.opqCount);
  if (Game.ghCount !== 0) throw new Error("演示盘不该有幽灵子/光晕，实际 " + Game.ghCount);
  if (Game.cursorData !== null) throw new Error("演示盘不该有落点光标");
  if (Game.hoverLineCount !== 0) throw new Error("演示盘不该有悬停校准线");
  if (Game.activeGridCount !== 0) throw new Error("演示盘不该画当前层蓝框");
  // 演示盘的格线也要按 10³ 重算，而不是沿用开局那张 15³ 的
  const wantGrid = (10 * 10 * 3 + 12) * 12;
  if (Game.staticGridCount !== wantGrid)
    throw new Error("演示盘格线顶点数应为 " + wantGrid + "，实际 " + Game.staticGridCount);
});

step("演示盘的棋子必须向中心聚拢，不能散到最外圈", () => {
  // 这是需求原话："棋子聚集到中心一点，不要太散"。
  // 断言的是【性质】而不是某个具体坐标：改 PREVIEW_BIAS 只要还满足"居中 + 比均匀更紧"
  // 就该通过，改坏了（比如退回均匀分布、或者偏到一边去）才该报错。
  const pb = Game.ensurePreview();
  const n = pb.dims[0];
  const pts = [];
  pb.forEachStone((x, y, z) => pts.push([x, y, z]));
  if (pts.length < 40)
    throw new Error("演示盘上的棋子太少（" + pts.length + " 颗），看起来会像空盘");

  // 1) 居中是【对称】的：三个轴的均值都必须贴着棋盘中心。
  //    偏到一边的表现是"棋子挤在某个角上"，但那种偏差在小尺寸截图里不明显，只能靠数字查。
  const center = (n - 1) / 2;
  for (let k = 0; k < 3; k++) {
    const vals = pts.map((p) => p[k]);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (Math.abs(mean - center) > 1.0)
      throw new Error("第 " + k + " 维的均值 " + mean.toFixed(2) + " 偏离中心 " + center + " 太多");
  }

  // 2) 必须比均匀分布更紧。均匀分布时每个轴的 sd = sqrt((n²-1)/12) ≈ 2.87（n=10），
  //    聚拢之后应明显更小。
  const uniformSd = Math.sqrt((n * n - 1) / 12);
  for (let k = 0; k < 3; k++) {
    const vals = pts.map((p) => p[k]);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, v) => a + (v - mean) * (v - mean), 0) / vals.length);
    if (sd > uniformSd * 0.75)
      throw new Error("第 " + k + " 维的 sd " + sd.toFixed(2) + " 接近均匀分布（" +
                      uniformSd.toFixed(2) + "），说明没有聚拢");
  }

  // 3) 最外圈（任一坐标为 0 或 n-1）基本不该有子 —— 这是"不要太散"最直观的那一眼。
  //    均匀分布下这条大约占 1-(1-2/n)³ ≈ 49%，聚拢之后应该接近 0。
  const outer = pts.filter((p) => p.some((v) => v === 0 || v === n - 1)).length;
  if (outer > pts.length * 0.06)
    throw new Error("有 " + outer + " / " + pts.length + " 颗子落在最外圈，太散了");
});

step("聚拢强度：跨多档取值都必须【居中】，而且越大越紧", () => {
  // 这一条专门盯"取平均的那几个种子用完了"这个错法：种子表不够长时 salts[k] 是 undefined，
  // Math.imul(x, undefined) 得 0，于是平均值被往 0 那一侧拽 —— 棋子在屏幕上表现为
  // 整团偏到某个角上。默认值恰好落在表长以内时，只测默认值是【测不出来】的，
  // 而调旋钮的人看到的就是"越调越偏"。所以这里跨档取一遍。
  const n = Game.ensurePreview().dims[0];
  const center = (n - 1) / 2;
  const stat = (bias) => {
    const pb = Game.buildPreviewBoard(bias);
    const pts = [];
    pb.forEachStone((x, y, z) => pts.push([x, y, z]));
    const axes = [0, 1, 2].map((k) => {
      const v = pts.map((p) => p[k]);
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      return { mean: mean, sd: Math.sqrt(v.reduce((a, t) => a + (t - mean) * (t - mean), 0) / v.length) };
    });
    return { count: pts.length, mean: axes.reduce((a, x) => a + x.mean, 0) / 3,
             sd: axes.reduce((a, x) => a + x.sd, 0) / 3,
             worstMean: Math.max(...axes.map((x) => Math.abs(x.mean - center))) };
  };

  // 1) 无论取哪一档，整团都不能偏离中心
  for (const bias of [1, 2, 3, 4, 5, 6, 7]) {
    const st = stat(bias);
    if (st.count < 40)
      throw new Error("bias=" + bias + " 只放下 " + st.count + " 颗子，太少");
    if (st.worstMean > 1.0)
      throw new Error("bias=" + bias + " 的某个轴均值偏离中心 " + st.worstMean.toFixed(2) +
                      "（超过 1 格）—— 整团偏到一边去了");
  }

  // 2) 越大越紧：sd 必须单调不增（允许一点点抖动，格坐标是离散的）
  let prev = Infinity;
  for (const bias of [1, 2, 3, 4, 5, 6, 7]) {
    const st = stat(bias);
    if (st.sd > prev + 0.15)
      throw new Error("bias=" + bias + " 的 sd " + st.sd.toFixed(2) +
                      " 比上一档还大（" + prev.toFixed(2) + "），旋钮方向反了");
    prev = st.sd;
  }

  // 3) 默认档必须明显比均匀分布紧（均匀时 sd ≈ sqrt((n²-1)/12)）
  const uniformSd = Math.sqrt((n * n - 1) / 12);
  const def = stat(undefined);          // 不传 = 用 PREVIEW_BIAS
  if (def.sd > uniformSd * 0.7)
    throw new Error("默认档的 sd " + def.sd.toFixed(2) + " 接近均匀分布 " + uniformSd.toFixed(2));

  // 4) 越界必须【报错】而不是悄悄偏掉 —— 这条是上面那个 bug 的正面防线
  let threw = false;
  try { Game.buildPreviewBoard(99); } catch (e) {
    threw = String(e.message).indexOf("种子表") >= 0;
  }
  if (!threw) throw new Error("聚拢强度超过种子表长度时必须抛异常（越界会让整团偏到角上）");
  let threw2 = false;
  try { Game.buildPreviewBoard(0); } catch (e) { threw2 = true; }
  if (!threw2) throw new Error("聚拢强度 0 必须抛异常");
});

step("起始界面：drawPreview 还回相机的五个字段，自转与帧率无关，且不接受落子/拾取", () => {
  Game.newGame(15, 1);
  const cam = Game.camera;
  cam.yaw = -32; cam.pitch = 24; cam.distance = 22;
  const keys = ["yaw", "pitch", "distance", "minDistance", "maxDistance"];
  const keep = keys.map((k) => cam[k]);
  Game.openSetup();
  Game.drawPreview(1 / 60);
  for (let i = 0; i < keys.length; i++) {
    if (cam[keys[i]] !== keep[i])
      throw new Error("相机字段 " + keys[i] + " 没有被还原（起始界面的取景会漏进对局）");
  }
  // 自转必须是时间驱动的：同样 0.1 秒的墙钟时间，一步走完和分六步走完转过的角度必须一样。
  // 写成每帧固定增量的话，144Hz 屏上的转速会是 60Hz 屏的两倍多。
  // （分步的 dt 都远小于下面的上限，所以这里比的是纯粹的按时间积分。）
  Game.previewYaw = 0;
  Game.drawPreview(0.1);
  const oneBig = Game.previewYaw;
  Game.previewYaw = 0;
  for (let i = 0; i < 6; i++) Game.drawPreview(1 / 60);
  const sixSmall = Game.previewYaw;
  if (Math.abs(oneBig - sixSmall) > 1e-9)
    throw new Error("自转应与帧率无关：一步 0.1 秒转了 " + oneBig + "，六步 1/60 秒转了 " + sixSmall);

  // 单帧必须有上限：标签页切回来时 dt 可能是几十秒，不夹的话棋盘会唰地跳过去一大截。
  // 上限是 0.2 秒 → 单帧最多转 6*0.2 = 1.2 度。
  Game.previewYaw = 0;
  Game.drawPreview(1000);
  if (Math.abs(Game.previewYaw - 1.2) > 1e-9)
    throw new Error("单帧转角上限应为 1.2 度，实际 " + Game.previewYaw);
  Game.previewYaw = 0;
  Game.drawPreview(-5);            // 时钟回拨 / dt 为负也不能倒转
  if (Math.abs(Game.previewYaw) > 1e-9)
    throw new Error("dt 为负时不该转动，实际 " + Game.previewYaw);

  Game.el.layerBase.dispatch("click", { clientX: 100, clientY: 100 });
  if (Game.session.moveCount !== 0) throw new Error("起始界面打开时不该能落子");
  if (Game.pick(400, 300) !== null) throw new Error("起始界面打开时不该有三维拾取");

  Game.closeSetup();
  if (Game.setupOpen) throw new Error("closeSetup 之后 setupOpen 应为 false");
  if (Game.el.stage.classList.contains("preview")) throw new Error("preview 类应被移除");
  Game.newGame(15, 1);
});

step("调色板：JS 兜底表必须和 CSS 的 :root 逐条一致", () => {
  // 这次改动的核心保证之一：颜色原来散在五处（CSS、gl.clearColor、着色器常量、两块 canvas），
  // "改主题漏一处"只能靠肉眼发现。现在唯一事实源是 CSS，JS 只解析一次；
  // 兜底表是"读不到 CSS"（node 桩、老浏览器）时用的，它一旦和 CSS 不一致，
  // 就意味着那种环境下的页面配色会整体不同 —— 而这里没有浏览器，看不出来。
  const root = html.match(/:root\s*\{([\s\S]*?)\}/);
  if (!root) throw new Error("HTML 里找不到 :root 块");
  const css = new Map();
  for (const m of root[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) css.set(m[1], m[2].trim());

  const bad = [];
  for (const k of Object.keys(FALLBACK_COLORS)) {
    if (!css.has(k)) { bad.push(k + " 不在 CSS 里"); continue; }
    const a = css.get(k).toLowerCase(), b = String(FALLBACK_COLORS[k]).toLowerCase();
    if (a !== b) bad.push(k + "：CSS=" + a + " 兜底表=" + b);
  }
  if (bad.length) throw new Error("调色板与 CSS 不一致：\n      " + bad.join("\n      "));

  // 三维和二维共用的那几个颜色必须定义在 CSS 里，而且必须是 #rrggbb ——
  // Palette.rgb 只认这一种写法，写成 rgba() 会直接抛
  for (const k of ["--bg", "--stone-edge", "--accent", "--danger", "--gold", "--ok", "--hover-line"]) {
    if (!css.has(k)) throw new Error(k + " 必须定义在 :root 里");
    if (!/^#[0-9a-f]{6}$/i.test(css.get(k))) throw new Error(k + " 必须是 #rrggbb，实际 " + css.get(k));
  }
});

step("调色板：Palette.rgb 解析正确，非 #rrggbb 必须报错而不是静默变黑", () => {
  const e = PALETTE.rgb("--stone-edge");
  const hex = FALLBACK_COLORS["--stone-edge"];
  const want = [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255,
                parseInt(hex.slice(5, 7), 16) / 255];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(e[i] - want[i]) > 1e-9)
      throw new Error("--stone-edge 解析错：[" + e.join(",") + "] 应为 [" + want.join(",") + "]");
  }
  const save = PALETTE.map["--bg"];
  PALETTE.map["--bg"] = "rgb(1,2,3)";
  let threw = false;
  try { PALETTE.rgb("--bg"); } catch (err) { threw = true; }
  PALETTE.map["--bg"] = save;
  if (!threw) throw new Error("非 #rrggbb 的颜色必须抛异常，而不是静默变成黑色");
});

step("四维模式：给长方体会退化成立方；内核层面转动一律有理由地被拒", () => {
  Game.setSetupMode(true);
  // UI 层兜底：四维 + 长方体 → newGame 强制立方，
  // 免得出现"开局成功、但一颗子都转不动"这种只能靠点按钮才发现的坏状态
  Game.newGame([10, 20, 10], 1);
  if (Game.session.board.isCube !== true)
    throw new Error("四维模式下 newGame 应强制立方，实际 " + Game.session.board.dims.join(","));

  // 内核层兜底：直接拿长方体开四维局，rotate 必须返回"拒绝"而不是抛异常，而且原因要能读懂
  const K = CoreNS;
  const rs = new K.RuleSet();
  rs.allowRotation = true;
  rs.rotationCooldownPlacements = 0;
  const s = K.FourDSession.create([10, 20, 10], 1, rs);
  const out = s.rotateBy(2, 0, 0, 1);
  if (out.status !== K.RotateStatus.Rejected)
    throw new Error("长方体上的转动应被拒，实际 " + out.status);
  if (String(out.reason).indexOf("立方") < 0)
    throw new Error("拒绝原因应说明需要立方棋盘，实际：" + out.reason);

  Game.setSetupMode(false);
  Game.newGame(15, 1);
});

step("规则全文：页面里嵌的两段必须逐字节等于各自的源文件", () => {
  // 这条是整个功能的支点。游戏里显示"规则全文"，如果嵌的是手抄的一份，
  // 就有了第二份规则文本 —— 改了一边忘了另一边，玩家看到的规则和代码执行的规则
  // 就会不一致，而那种不一致没有任何东西会报警。
  // 所以：每种语言正文只此一份（RULES_SPEC.md / RULES_SPEC.en.md），页面里那两段是
  // 生成物，这里钉死它们各等于自己的源文件。两种语言同样查，不是只查中文那份。
  const DOCS = [
    { rel: "RULES_SPEC.md", path: RULES_PATH, begin: "<!-- RULES-EMBED-BEGIN -->",
      end: "<!-- RULES-EMBED-END -->", id: "rulesSrc" },
    { rel: "RULES_SPEC.en.md", path: RULES_EN_PATH, begin: "<!-- RULES-EMBED-EN-BEGIN -->",
      end: "<!-- RULES-EMBED-EN-END -->", id: "rulesSrcEn" },
  ];

  let prevEnd = -1;
  for (const d of DOCS) {
    const src = fs.readFileSync(d.path, "utf8");
    const i = html.indexOf(d.begin);
    const j = html.indexOf(d.end);
    if (i < 0 || j < 0) throw new Error("index.html 里找不到 " + d.begin + " / " + d.end);
    // 顺序：后一条整个排在前一条 END 之后。反过来的话重新生成会把它整段吃掉。
    if (i < prevEnd) throw new Error(d.rel + " 的标记排在 " + DOCS[0].rel + " 的 END 之前");
    prevEnd = j + d.end.length;

    const re = new RegExp('<script type="text\\/plain" id="' + d.id + '">\\n([\\s\\S]*?)\\n<\\/script>');
    const m = html.slice(i, j).match(re);
    if (!m) throw new Error("标记之间找不到 #" + d.id + " 的 script 块");
    const embedded = m[1] + "\n";

    if (embedded !== src) {
      const a = embedded.split("\n"), b = src.split("\n");
      let firstDiff = -1;
      for (let k = 0; k < Math.max(a.length, b.length); k++) {
        if (a[k] !== b[k]) { firstDiff = k; break; }
      }
      // 报出第一处差异所在的行 —— 否则"两份一万字的文档不一样"这句话没法用
      throw new Error("嵌进页面的 " + d.rel + " 和源文件不一致（第 " + (firstDiff + 1) + " 行起）\n" +
        "      页面：" + JSON.stringify((a[firstDiff] || "").slice(0, 60)) + "\n" +
        "      文件：" + JSON.stringify((b[firstDiff] || "").slice(0, 60)) + "\n" +
        "      修法：node _verify/embed-rules.mjs");
    }

    // 顺带把"能不能安全嵌进 script 标签"钉住：正文里出现 </script 就会被当场截断
    if (/<\/script/i.test(src)) throw new Error(d.rel + " 里出现了 </script，无法原样嵌入");
    if (src.indexOf("\r") >= 0) throw new Error(d.rel + " 不是纯 LF —— 先统一行尾");
    if (!/^# /.test(src)) throw new Error(d.rel + " 不像是一份 Markdown（开头不是一级标题）");

    // 渲染器只认这几样，另外三样会【静默降级】成原样文字：
    // 有序列表和围栏代码块渲染器根本不支持，写成 *斜体* 则会原样显示星号。
    // 英文技术写作比中文更爱用这三种，所以这里对两份都钉死，不是只钉英文那份。
    if (/^\s*\d+\.\s/m.test(src)) throw new Error(d.rel + " 里出现了有序列表（渲染器不支持，会掉成普通段落）");
    if (/```/.test(src)) throw new Error(d.rel + " 里出现了围栏代码块（渲染器不支持）");
    if (/(^|[^*])\*[^*\n]+\*(?!\*)/m.test(src)) throw new Error(d.rel + " 里出现了 *斜体*（渲染器只认 **粗体**）");
  }
});

step("规则全文：中英两份的章节结构和数字必须对得上", () => {
  // 逐字对译做不到，但【结构】和【数字】是两件必须一致的事：
  // 少一节（"这一节忘了翻"）、或者哪边的数字抄错一个（23639 写成 2363），
  // 单独读一份文档都看不出来，而玩家按哪一份玩都可能不对。
  const zh = fs.readFileSync(RULES_PATH, "utf8");
  const en = fs.readFileSync(RULES_EN_PATH, "utf8");
  const heads = (s) => [1, 2, 3].map((n) => (s.match(new RegExp("^#{" + n + "} ", "gm")) || []).length);
  const hz = heads(zh), he = heads(en);
  if (hz.join("/") !== he.join("/"))
    throw new Error("中英两份的章节数对不上（# / ## / ###）：中文 " + hz.join("/") + "，英文 " + he.join("/"));
  if (hz[0] === 0) throw new Error("两份都没有一级标题，上面的比较是 0 == 0 的空断言");

  const nums = (s) => [...new Set(s.match(/\d+/g) || [])].sort((a, b) => Number(a) - Number(b));
  const nz = nums(zh), ne = nums(en);
  const onlyZh = nz.filter((x) => ne.indexOf(x) < 0);
  const onlyEn = ne.filter((x) => nz.indexOf(x) < 0);
  if (onlyZh.length || onlyEn.length)
    throw new Error("两份文档里的数字对不上：\n" +
      "      只在中文里有：" + (onlyZh.join(", ") || "（无）") + "\n" +
      "      只在英文里有：" + (onlyEn.join(", ") || "（无）") +
      "\n      规则里的每个数字都是判据，抄错一个不会有人看出来。");
});

step("起始界面：规则摘要必须还在（玩家点「开始游戏」之前唯一能看到规则的地方）", () => {
  // 直接读 HTML 文件，不走桩 —— 桩的 textContent 一律是空字符串，
  // 这类"静态文案还在不在"的问题它一个字都答不了（#rulesSrc 那条是靠补丁灌进去的，
  // 灌进去的文本只能证明补丁对，证明不了 HTML 里真有）。
  //
  // 为什么要钉这一段：起始界面上原本还挂着一句开发者向的"规则全文见 RULES_SPEC.md …"，
  // 删掉它是对的（要看全文，右上角有「具体规则」按钮，比让玩家去工程目录里找文件合理）。
  // 但它和上面两行【玩家向】的规则摘要挨在一起，删的时候多删一行不会有任何测试报警。
  // 标签上允许有别的属性（现在挂着 data-i18n-html）：这条钉的是"摘要还在、还在这一段里"，
  // 不是"这个标签一个属性都不能有" —— 加 [^>]* 不放松任何东西。
  const m = html.match(/<div id="ruleNote"[^>]*>([\s\S]*?)<\/div>/);
  if (!m) throw new Error("index.html 里找不到 <div id=\"ruleNote\">，起始界面就没有规则摘要了");
  const text = m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  for (const [needle, why] of [
    ["恰好 5 连", "先手的胜利条件是「恰好 5 连」；不写明，玩家会以为 6 连也算赢"],
    ["长连", "长连判负是这套规则里最反直觉的一条，不能只写在规则全文里"],
    ["后手", "先后手胜利条件不同（先手恰好 5、后手 ≥5），两半都得写"],
    ["13 个", "获胜方向数是三维五子棋的核心设定"],
  ]) {
    if (text.indexOf(needle) < 0)
      throw new Error("起始界面的规则摘要里丢了「" + needle + "」—— " + why +
        "\n      现在这段文字是：" + text);
  }
  // 反方向：开发者向的句子必须【不在】。这条是注入验证逼出来的 ——
  // 只断言"玩家向的那几句还在"，把删掉的那句加回来照样全绿（注入 3 最初漏检）。
  // 而它恰恰是最容易被加回来的一句：以后有人问"规则全文在哪"，第一反应就是往这儿写一行。
  for (const gone of ["RULES_SPEC", "测试向量", "C#"]) {
    if (text.indexOf(gone) >= 0)
      throw new Error("起始界面又出现了开发者向的「" + gone + "」—— 玩家要规则全文，" +
        "右上角的「具体规则」按钮就是入口，不该让他去工程目录里找文件" +
        "\n      现在这段文字是：" + text);
  }
});

step("规则渲染器：先转义再插标签，标题/表格/列表续行/行内 code 都对", () => {
  // 1) 必须先转义再插标签。规则文本是本地文件，但渲染器不该依赖"输入可信"。
  const esc = renderRulesMarkdown("普通 <script>alert(1)</script> 与 a & b");
  if (esc.indexOf("<script>") >= 0) throw new Error("渲染器没有转义 HTML：" + esc);
  if (esc.indexOf("&lt;script&gt;") < 0) throw new Error("转义后的实体不对：" + esc);
  if (escapeHtmlNS("a & b") !== "a &amp; b") throw new Error("escapeHtml 的 & 转义不对");

  // 2) 标题：# → h2（浮层里最高一级），## → h3，### → h4
  const h = renderRulesMarkdown(["# 一级", "", "## 二级", "", "### 三级"].join("\n"));
  for (const want of ["<h2>一级</h2>", "<h3>二级</h3>", "<h4>三级</h4>"])
    if (h.indexOf(want) < 0) throw new Error("标题渲染不对，缺 " + want + "：" + h);

  // 3) 表格：| 开头的一段；带 |---|---| 分隔行时第一行当表头
  const t = renderRulesMarkdown(["| 项目 | 规定 |", "|---|---|", "| 尺寸 | 15 ≤ N ≤ 50 |"].join("\n"));
  if (t.indexOf("<table>") < 0 || t.indexOf("<th>项目</th>") < 0 || t.indexOf("<td>尺寸</td>") < 0)
    throw new Error("表格渲染不对：" + t);
  if (t.indexOf("---") >= 0) throw new Error("表格分隔行没有被吃掉：" + t);
  const t2 = renderRulesMarkdown(["| a | b |", "| c | d |"].join("\n"));
  if (t2.indexOf("<th>") >= 0) throw new Error("没有分隔行时不该有表头：" + t2);

  // 4) 列表续行：源文件里有 4 处 `- ` 条目是折行的，续行以缩进开头。
  //    不处理的话它们会掉到列表外面变成独立段落 —— 读起来是"每句话单独一段"。
  const li = renderRulesMarkdown(["- 第一条很长", "  接着写", "- 第二条"].join("\n"));
  if (li.indexOf("<li>第一条很长 接着写</li>") < 0) throw new Error("列表续行没有接上：" + li);
  if (li.indexOf("<li>第二条</li>") < 0) throw new Error("第二条丢了：" + li);

  // 5) 引用与分隔线
  const q = renderRulesMarkdown(["> 引一句", "> 再引一句", "", "---"].join("\n"));
  if (q.indexOf("<blockquote>引一句 再引一句</blockquote>") < 0) throw new Error("引用不对：" + q);
  if (q.indexOf("<hr>") < 0) throw new Error("分隔线不对：" + q);

  // 6) 行内 code 里的 ** 必须原样显示（code 先于粗体处理）
  const inline = renderRulesMarkdown("用 `a**b**c` 和 **真粗体**");
  if (inline.indexOf("<code>a**b**c</code>") < 0)
    throw new Error("行内 code 被粗体规则吃掉了：" + inline);
  if (inline.indexOf("<b>真粗体</b>") < 0) throw new Error("粗体没渲染：" + inline);
});

step("规则浮层：按钮能开、Esc 能关，开着时不吃快捷键，关掉后恢复", () => {
  if (!Game.el.rulesBtn) throw new Error("找不到 #rulesBtn");
  if (!Game.el.rulesBtn._listeners || !Game.el.rulesBtn._listeners.click)
    throw new Error("#rulesBtn 没有挂上 click");
  if (!Game.el.rulesClose._listeners.click) throw new Error("#rulesClose 没有挂上 click");

  Game.closeRules();
  if (Game.rulesOpen) throw new Error("closeRules 之后 rulesOpen 应为 false");
  if (!Game.el.rulesPanel.classList.contains("off")) throw new Error("浮层应带 off 类");

  Game.el.rulesBtn.dispatch("click");
  if (!Game.rulesOpen) throw new Error("点了按钮之后浮层应该打开");
  const body = Game.el.rulesBody.innerHTML;
  if (body.length < 1000) throw new Error("规则正文渲染出来太短：" + body.length + " 字符");
  for (const want of ["<h2>", "<h3>", "<table>", "<code>"])
    if (body.indexOf(want) < 0) throw new Error("正文里缺少 " + want);
  if (body.indexOf("棋盘") < 0) throw new Error("正文里没有正文内容");
  // 正文里必须真的出现规则里的关键数字，避免"渲染出来一堆空标签"也能过
  if (body.indexOf("恰好") < 0) throw new Error("正文里没有出现规则原文");

  // 渲染只做一次（正文永远不变，没必要每次重排上千个节点）
  const first = Game.el.rulesBody.innerHTML;
  Game.closeRules(); Game.el.rulesBtn.dispatch("click");
  if (Game.el.rulesBody.innerHTML !== first) throw new Error("第二次打开时正文变了");

  // 开着浮层时快捷键必须全部失效 —— 否则"看规则时按了下 R 把棋局重开了"，
  // 而屏幕上唯一可见的是规则，玩家想不到是自己按的
  if (!windowStubListeners.keydown) throw new Error("桩没有记录 window 的 keydown 监听器");

  // 【断言的取法很重要】：只比 moveCount 是抓不住这个 bug 的 —— 空盘上按
  // r（重开）和 z（悔棋）本来就什么都不改，t/y（转动）在三维模式下也一律被拒，
  // 于是"快捷键没被屏蔽"和"屏蔽了"在 moveCount 上长得一模一样。
  // （注入验证就是这么漏掉的：把 rulesOpen 那道守卫删掉，测试照样全绿。）
  // 所以要挑【一定会有可观察后果】的键：g 切换幽灵层/切片，q/e 换层。
  // 先把状态摆成"按了就会变"，再按。
  Game.newGame(15, 1);
  Game.session.place(3, 3, 3);
  Game.session.place(4, 4, 4);
  Game.onBoardChanged(true);
  Game.setActiveLayer(5);
  Game.setGhostMode(true);

  const snap = () => [Game.session.moveCount, Game.ghostMode, Game.activeLayer].join(",");
  const before = snap();
  if (before !== "2,true,5") throw new Error("准备状态不对：" + before);

  for (const key of ["r", "z", "g", "t", "y", "q", "e"]) pressKey(key);
  if (snap() !== before)
    throw new Error("规则浮层开着时不该响应快捷键：之前 " + before + " 之后 " + snap());
  if (Game.rulesOpen !== true) throw new Error("那些键不该把浮层关掉");

  pressKey("Escape");
  if (Game.rulesOpen) throw new Error("Esc 应该关闭规则浮层");

  // 关掉之后快捷键要恢复。这一条不能省：只测"开着时没反应"的话，
  // 把整个 keydown 监听删掉也能过 —— 那就成了用一个哑巴证明另一个哑巴。
  const ghostAfter = Game.ghostMode;
  pressKey("g");
  if (Game.ghostMode === ghostAfter)
    throw new Error("浮层关掉之后快捷键应该恢复（G 应切换视图模式）");
  const layerAfter = Game.activeLayer;
  pressKey("q");
  if (Game.activeLayer === layerAfter)
    throw new Error("浮层关掉之后换层键应该恢复（Q 应换层）");
  Game.setGhostMode(true);
  Game.newGame(15, 1);
  Game.closeRules();
});
step("键盘与面板事件回调都能挂上", () => {
  for (const id of ["undoBtn", "restartBtn", "swapBtn", "prevLayer", "nextLayer",
                    "topLayer", "modeGhost", "modeSlice", "sliceUp", "sliceDown",
                    "bannerUndo", "bannerRestart", "startBtn", "firstBlack", "firstWhite",
                    "mode3d", "mode4d", "rotLayerDown", "rotLayerUp", "rotCW", "rotCCW",
                    "rotGo", "rotRestore"]) {
    const el = Game.el[id];
    if (!el || !el._listeners || !el._listeners.click)
      throw new Error("'" + id + "' 没有挂上 click 回调");
  }
  if (!Game.el.gl._listeners.pointerdown) throw new Error("gl 没有挂 pointerdown");
  if (!Game.el.gl._listeners.wheel) throw new Error("gl 没有挂 wheel");
  if (!Game.el.layerBase._listeners.click) throw new Error("活动层网格没有挂 click");
  if (!Game.el.strip._listeners.click) throw new Error("缩略条没有挂 click");
});

// ---------------------------------------------------------------------------
// 界面语言
//
// 这组刻意放在【最后】：它会把界面切到英文再切回来，中间的每一条断言读的都是
// 另一种语言的界面。放在前面的话，后面那些按中文写的断言会读到英文 ——
// 那是"测试顺序影响结果"，比它想抓的 bug 更难查。
// 最后一条会把语言复位，且它自己就断言复位成功。
// ---------------------------------------------------------------------------
step("语言：HTML 里每个 data-i18n 键在英文表里都有，且表里没有多余的键", () => {
  const keys = new Set();
  // 【只数标签里的属性，不数整份源码里的子串】：源码里提到这个属性的地方不止标签 ——
  // index.html 里 collectStatic() 的注释就用 data-i18n="modeGhostTypo" 举例说明
  // "属性值写错会怎样"，那句话被当成第 42 个元素，于是这条断言报的是
  // "这些键没有英文：modeGhostTypo" —— 一个注释引起的假警报，而真正的漏翻会被它淹掉。
  // 要求前面是个开标签（<标签名 后跟属性）就能把注释和正文都挡在外面。
  for (const m of html.matchAll(/<\w+\b[^>]*\bdata-i18n(?:-html)?="([^"]+)"/g)) keys.add(m[1]);
  if (keys.size < 30) throw new Error("只解析出 " + keys.size + " 个键，太少了 —— 正则或属性写错了");
  const missing = [...keys].filter((k) => STATIC_EN[k] === undefined);
  if (missing.length) throw new Error("这些键没有英文：" + missing.join(", "));
  const extra = Object.keys(STATIC_EN).filter((k) => !keys.has(k));
  if (extra.length) throw new Error("英文表里这些键在 HTML 里没有对应元素（拼错了？）：" + extra.join(", "));
});

// 从源码里把 t()/tn()/say()/sayN() 的键抠出来。
//
// 【为什么值得写一个真扫描器而不是一条正则】：这几种调用的实参形态差得太远 ——
// t("k")、t("k", {}),、say(() => "中文" + x, "k")、sayN(fn, "k.one", "k.many", n)，
// 而且第一个实参箭头函数里本来就有逗号。用正则去"按逗号切"必然在某个形态上静默抓不全，
// 而抓不全的后果是"漏一条英文永远不报警"——界面上只表现为那一句还是中文。
// 所以这里做的是括号配平 + 跳过字符串/注释，按实参位置取。
//
// 键必须写成字面量，也正是为了让这段扫描能看见它们。
const isWordChar = (c) => c !== undefined && /[A-Za-z0-9_$]/.test(c);

/** 从 i 处的引号开始，返回闭引号的下标（跳过 \x 转义）。没闭合就返回末位。 */
function skipStr(src, i) {
  const q = src[i];
  for (let k = i + 1; k < src.length; k++) {
    if (src[k] === "\\") { k++; continue; }
    if (src[k] === q) return k;
  }
  return src.length;
}

/** j 是某个标识符左边界的前一个位置；返回它前面那个词（跳过空白）。 */
function precedingKeyword(src, j) {
  let m = j;
  while (m >= 0 && /\s/.test(src[m])) m--;
  const end = m + 1;
  while (m >= 0 && isWordChar(src[m])) m--;
  return src.slice(m + 1, end);
}

/** return /case 这类关键字后面跟的是正则不是除号。 */
const REGEX_AFTER_WORD = ["return", "typeof", "case", "delete", "void", "new",
                          "in", "of", "instanceof", "do", "else", "yield", "await"];

/**
 * 这个 / 是正则字面量的开头还是除号？
 *
 * 【为什么必须判】：脚本里有一句 .replace(/"/g, "&quot;")，那个 / 后面跟着一个
 * 双引号。不把它当正则读的话，扫描会把 /" 里的 " 当成字符串开头，然后一路跑到
 * 几百字符之外的下一个引号才"闭合" —— 从此整段代码都在字符串里，后面所有调用点
 * 一个也扫不到。【而扫描结果是 0 个键时，如果只断言"扫到的键都在表里"，
 * 就是全绿的空转】。所以这条判断是这段扫描能不能成立的地基，不是优化。
 *
 * 判据是标准的那条：能作为值的结尾（标识符、数字、) ] }）之后是除号，其余是正则。
 */
function regexAllowed(src, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  if (j < 0) return true;                                  // 行首
  if (/[A-Za-z0-9_$]/.test(src[j])) {
    const end = j + 1;
    while (j >= 0 && isWordChar(src[j])) j--;
    return REGEX_AFTER_WORD.indexOf(src.slice(j + 1, end)) >= 0;
  }
  return ")]}".indexOf(src[j]) < 0;
}

/** / 处的正则字面量，返回闭 / 的下标。字符组 [...] 里的 / 不算结束。 */
function skipRegex(src, i) {
  let inClass = false;
  for (let k = i + 1; k < src.length; k++) {
    const c = src[k];
    if (c === "\\") { k++; continue; }
    if (c === "\n") return k - 1;                          // 正则不跨行：当成没闭合
    if (inClass) { if (c === "]") inClass = false; continue; }
    if (c === "[") { inClass = true; continue; }
    if (c === "/") return k;
  }
  return src.length;
}

/**
 * src[i] 是字符串 / 注释 / 正则的开头吗？是就返回它【之后】的下标，不是返回 -1。
 * 三个扫描循环（主循环、matchParen、skipFunctionBody）共用这一处 ——
 * 各写一份的话，"正则字面量"这种漏一种就是一处静默的错位。
 */
function skipNonCode(src, i) {
  const c = src[i];
  if (c === '"' || c === "'" || c === "`") return skipStr(src, i) + 1;
  if (c === "/" && src[i + 1] === "/") { const e = src.indexOf("\n", i); return e < 0 ? src.length : e; }
  if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); return e < 0 ? src.length : e + 2; }
  if (c === "/" && regexAllowed(src, i)) return skipRegex(src, i) + 1;
  return -1;
}

/** 从 ( 的下标开始，返回配对的那个 ) 的下标。 */
function matchParen(src, i) {
  let depth = 0;
  for (let k = i; k < src.length; k++) {
    const next = skipNonCode(src, k);
    if (next >= 0) { k = next - 1; continue; }
    const d = src[k];
    if (d === "(" || d === "[" || d === "{") depth++;
    else if (d === ")" || d === "]" || d === "}") { depth--; if (depth === 0) return k; }
  }
  return src.length;
}

/** `function t(...) {...}` —— parenAt 是形参表那个 ( 的下标，返回函数体 } 的下标。 */
function skipFunctionBody(src, parenAt) {
  let k = matchParen(src, parenAt) + 1;
  while (k < src.length && /\s/.test(src[k])) k++;
  if (src[k] !== "{") return k;               // 理论上走不到；真走到了就当它到这儿结束
  let depth = 0;
  for (; k < src.length; k++) {
    const next = skipNonCode(src, k);
    if (next >= 0) { k = next - 1; continue; }
    const d = src[k];
    if (d === "{" || d === "(" || d === "[") depth++;
    else if (d === "}" || d === ")" || d === "]") { depth--; if (depth === 0) return k; }
  }
  return src.length;
}

function textKeysInSource(src) {
  const keys = new Set();
  // 实参位置：t/tn 从 0 数，say/sayN 的第 0 个是中文表达式，键从 1 数
  const KEY_ARG = { t: [0], tn: [0, 1], say: [1], sayN: [1, 2] };

  for (let i = 0; i < src.length; i++) {
    const next = skipNonCode(src, i);
    if (next >= 0) { i = next - 1; continue; }
    if (src[i] !== "(") continue;

    // 往左看：被调用的是不是那四个名字（跳过空白，再吃一整个标识符）
    let j = i - 1;
    while (j >= 0 && /\s/.test(src[j])) j--;
    const nameEnd = j + 1;
    while (j >= 0 && isWordChar(src[j])) j--;
    const name = src.slice(j + 1, nameEnd);
    // hasOwnProperty 而不是 KEY_ARG[name] —— 后者会把 "constructor"/"toString"
    // 这些原型上的名字当成命中（脚本里就有 cells.toLocaleString()）。
    if (!Object.prototype.hasOwnProperty.call(KEY_ARG, name)) continue;
    if (j >= 0 && src[j] === ".") continue;   // obj.t(...) 不是这里的东西
    // function t(key, params) {...} 是【定义】不是调用点。它必须整个跳过，不能只跳形参表：
    // say 的形参 zhFn / tn 的函数体里都在转发变量（`return t(n === 1 ? keyOne : keyMany, …)`），
    // 那是机制的内部构造，按定义就不可能是字面量。这四段之外要是出现"变量当键"，
    // 下面照样会报红 —— 而这四段正是唯一豁免的地方，名字写死在这里。
    if (precedingKeyword(src, j) === "function") { i = skipFunctionBody(src, i); continue; }

    // 从 ( 配平到 )，沿途记下【顶层】逗号 —— 第一个实参是箭头函数时里面本来就有逗号，
    // 按逗号硬切会把 say(() => a + b, "k") 切错。
    const close = matchParen(src, i);
    const argStart = [i + 1];
    {
      let depth = 1;
      for (let k = i + 1; k < close; k++) {
        const nx = skipNonCode(src, k);
        if (nx >= 0) { k = nx - 1; continue; }
        const d = src[k];
        if (d === "(" || d === "[" || d === "{") depth++;
        else if (d === ")" || d === "]" || d === "}") depth--;
        else if (d === "," && depth === 1) argStart.push(k + 1);
      }
    }
    const args = argStart.map((s, n) => {
      const e = n + 1 < argStart.length ? argStart[n + 1] - 1 : close;
      return src.slice(s, e).trim();
    });
    for (const idx of KEY_ARG[name]) {
      const a = args[idx];
      if (a === undefined) continue;
      const m = a.match(/^"([^"\\]*)"$/);
      if (!m) {
        // 键写成字面量是硬要求 —— 写成变量或拼出来的字符串，这条检查就看不见它了。
        // 那种情况下【漏一条英文不会报警】，所以这里当场报错而不是跳过。
        throw new Error(name + "() 的第 " + (idx + 1) + " 个实参不是字符串字面量：" +
          JSON.stringify(a.slice(0, 60)) + "\n      （键写成变量后" +
          "这条检查就看不见它了 —— 要么改成字面量，要么把它加进一个显式清单）");
      }
      keys.add(m[1]);
    }
  }
  return keys;
}

step("语言：脚本里每个 t()/tn() 的键在英文表里都有", () => {
  const used = textKeysInSource(fullScript);
  if (used.size < 30) throw new Error("只从脚本里抓到 " + used.size + " 个键，太少了 —— 扫描漏了，检查会空转");
  const missing = [...used].filter((k) => TEXT_EN[k] === undefined);
  if (missing.length) throw new Error("脚本里用了但英文表里没有的键：" + missing.join(", "));
  // 反方向：表里有、代码里没人用 —— 多半是改名时漏改了一处，留着只会烂在那儿
  const dead = Object.keys(TEXT_EN).filter((k) => !used.has(k));
  if (dead.length) throw new Error("英文表里这些键没人用（改名漏改？）：" + dead.join(", "));
});

step("语言：切到英文后界面真的变了，且状态行/信息行是英文", () => {
  Game.setLang("en");
  if (documentStub.documentElement.lang !== "en")
    throw new Error("documentElement.lang 应为 en，实际 " + documentStub.documentElement.lang);
  if (!documentStub.documentElement.classList.contains("lang-en"))
    throw new Error("documentElement 上没有 .lang-en —— 英文排版那一段 CSS 不会生效");
  if (Game.el.langBtn.textContent !== "中文")
    throw new Error("英文界面下语言按钮应写「中文」，实际 " + JSON.stringify(Game.el.langBtn.textContent));
  if (Game.el.startBtn.textContent !== "Start game")
    throw new Error("开始按钮应为英文，实际 " + JSON.stringify(Game.el.startBtn.textContent));

  // 状态行：走的是内核的 describeStatus(lang)，数字必须和中文那份一样
  const s = Game.session;
  const zh = s.describeStatus();
  const en = s.describeStatus("en");
  if (en === zh) throw new Error("describeStatus 在两种语言下返回了同一句话：" + en);
  if (/[一-鿿]/.test(en)) throw new Error("英文状态行里还有汉字：" + en);
  const nums = (x) => (String(x).match(/\d+/g) || []).join(",");
  if (nums(en) !== nums(zh))
    throw new Error("中英状态行的数字对不上（很可能是英文那侧漏了分支）：\n" +
      "      中：" + zh + "\n      英：" + en);
  if (Game.el.status.textContent !== en)
    throw new Error("状态行没有跟着语言走，实际：" + Game.el.status.textContent);

  // 规则浮层的正文按语言选块。选错了没有任何东西会报警：英文界面里出现一整篇
  // 中文规则看着"像"是漏翻，而渲染缓存还会把它一直挂在那儿，重新打开也不修。
  Game.rulesRendered = false;          // 强制重渲染（正常路径上由 applyLang 置回 false）
  Game.openRules();
  const bodyEn = Game.el.rulesBody.innerHTML;
  if (bodyEn.indexOf("Winning directions") < 0)
    throw new Error("英文界面下规则浮层渲染的不是英文正文：" + bodyEn.slice(0, 80));
  if (/[一-鿿]/.test(bodyEn))
    throw new Error("英文规则浮层里还有汉字（多半是取到了 #rulesSrc）");
  Game.setLang("zh");
  Game.rulesRendered = false;
  Game.openRules();
  if (Game.el.rulesBody.innerHTML.indexOf("获胜方向") < 0)
    throw new Error("切回中文后规则浮层没有跟着回去");
  Game.closeRules();
  Game.setLang("en");                  // 还原成这一步进来时的语言，别影响后面的 step
});

step("语言：切回中文后，每个静态元素都与 HTML 原文逐字节相等", () => {
  // 这是这一组里最重要的一条：applyStatic 的中文方向是"写回快照"，
  // 快照抄错了、或者哪次切英文把中文盖掉了，都只会在【切回来】的时候才看得出来。
  Game.setLang("zh");
  if (Game.el.startBtn.textContent !== "开始游戏")
    throw new Error("切回中文后开始按钮不对：" + JSON.stringify(Game.el.startBtn.textContent));
  if (documentStub.documentElement.lang !== "zh-CN")
    throw new Error("切回后 lang 应为 zh-CN，实际 " + documentStub.documentElement.lang);
  if (documentStub.documentElement.classList.contains("lang-en"))
    throw new Error("切回中文后 .lang-en 还在，英文排版会继续生效");

  const bad = [];
  for (const key of Object.keys(STATIC_EN)) {
    const el = elementsById.get(key);
    if (!el) { bad.push(key + "（元素不存在）"); continue; }
    const el0 = i18nHtmlEls.indexOf(el) >= 0 ? i18nHtmlEls[i18nHtmlEls.indexOf(el)]
                                             : i18nEls[i18nEls.indexOf(el)];
    const prop = i18nHtmlEls.indexOf(el) >= 0 ? "innerHTML" : "textContent";
    if (!el0) { bad.push(key + "（没被桩解析到）"); continue; }
    if (el[prop] !== el0[prop]) bad.push(key + "：" + JSON.stringify(el[prop]).slice(0, 50));
  }
  if (bad.length) throw new Error("切回中文后有 " + bad.length + " 个元素和 HTML 原文不一致：\n      " + bad.join("\n      "));
});

step("语言：未知语言名被夹回中文，不认识的键显示键名而不是 undefined", () => {
  Game.setLang("fr");
  if (Game.lang !== "zh") throw new Error("未知语言应退回 zh，实际 " + Game.lang);
  Game.setLang("en");
  // 缺键时必须显示键名 —— 显示 undefined 或空白会看起来像"界面坏了"，
  // 显示 "no.such.key" 一眼就知道是漏了翻译。
  if (t("no.such.key") !== "no.such.key")
    throw new Error("缺键时应返回键名，实际 " + JSON.stringify(t("no.such.key")));
  Game.setLang("zh");
  if (Game.lang !== "zh") throw new Error("复位失败");
});

step("语言：英文单复数在【界面上够得到】的那几处都换了形", () => {
  // 钉的是"every 1 moves"同一类错误的另外四个落点。四个都够得到，不是理论值：
  //   #rotHint    冷却 3 时落满 2 子 → 只剩 1 手
  //   #rotStatus  冷却 1 时落 1 子、转 1 次 → 只剩 1 手
  //   拒转动原因  同上状态再转一次 —— 这句是【内核】拼的，lang 少传一层就变回中文
  //   起始界面    4D + 冷却 10 + 8³：实测中位 11 手 → 最多转 1 次
  // 只在英文下判：中文没有复数，换形换的一直是英文那一侧。
  // 【为什么放在 node 里而不是 browser-check】第 8 步是可选的（没装浏览器就跳过），
  // 这几条不该跟着一起被跳过。
  //
  // 【进来什么样、出去什么样】这一步要动四样全局状态（语言、四维、冷却、尺寸）和设置浮层。
  // 不还原的话后面那几步会红得很远：keydown 处理器开头就是 `if (this.setupOpen) return`（H / R 全失灵），
  // 而 tryPlace 也会直接返回 —— "造一局黑胜"那几步就是这么被弄红的（只剩最后一手落了子）。
  const keep = { lang: Game.lang, fourD: Game.fourD, cool: Game.setupCool,
                 dims: Game.setupDims.slice(), setupOpen: Game.setupOpen };
  Game.setLang("en");
  try {
    // 1) 冷却提示：#rotHint，走文案表的 .one / .many
    Game.setSetupMode(true);
    Game.setSetupCool(3);
    Game.newGame([15, 15, 15], 1);
    Game.closeSetup();
    Game.session.place(0, 0, 0);
    Game.session.place(1, 1, 1);
    Game.onBoardChanged(true);
    const hint = Game.el.rotHint.textContent;
    if (hint.indexOf("1 more move.") < 0 || hint.indexOf("1 more moves") >= 0)
      throw new Error("冷却剩 1 手时 #rotHint 该写 \"1 more move\"，实际 " + JSON.stringify(hint));

    // 2) 状态行 + 拒转动的原因句：这两句在内核里拼（内核放不下文案表，就地换形）
    Game.setSetupCool(1);
    Game.newGame([15, 15, 15], 1);
    Game.closeSetup();
    Game.session.place(0, 0, 0);
    const o = Game.session.rotateBy(0, 0, true, 1, Game.lang);
    if (!o.accepted) throw new Error("这一步本该转成功：" + o.status + " / " + o.reason);
    Game.onBoardChanged(true);
    const st = Game.el.rotStatus.textContent;
    if (st.indexOf("1 more move before the next rotation") < 0 || st.indexOf("1 more moves") >= 0)
      throw new Error("冷却剩 1 手时 #rotStatus 该写 \"1 more move\"，实际 " + JSON.stringify(st));

    const r = Game.session.rotateBy(0, 0, true, 1, Game.lang);
    if (r.accepted) throw new Error("冷却没到，这一步本该被拒");
    if (/[一-鿿]/.test(r.describe("en")))
      throw new Error("英文界面下拒转动的原因句里混进了中文：" + JSON.stringify(r.describe("en")));
    if (r.describe("en").indexOf("1 more move before you can rotate") < 0)
      throw new Error("拒转动的原因句单复数不对：" + JSON.stringify(r.describe("en")));

    // 3) UI 那条路：doRotate 必须把 lang 一路带到内核 —— 少传一层就是半中半英的提示
    Game.rotLayer = 12;                       // 空层，转不成
    Game.doRotate();
    const toast = Game.el.toast.textContent;
    if (/[一-鿿]/.test(toast))
      throw new Error("英文界面下「转不成」的提示里混进了中文：" + JSON.stringify(toast));

    // 4) 起始界面小结：times 被 Math.max(1, …) 兜成 1 的情形
    Game.setSetupCool(10);
    Game.setSetupSize(8);
    Game.openSetup();
    const sum = Game.el.sizeSummary.textContent;
    if (sum.indexOf("at most 1 rotation (") < 0 || sum.indexOf("1 rotations") >= 0)
      throw new Error("最多转 1 次时小结该写 \"at most 1 rotation\"，实际 " + JSON.stringify(sum));
  } finally {
    Game.setLang(keep.lang);
    Game.setSetupMode(keep.fourD);
    Game.setSetupCool(keep.cool);
    Game.setSetupDims(keep.dims[0], keep.dims[1], keep.dims[2]);
    if (keep.setupOpen) Game.openSetup(); else Game.closeSetup();
  }
});

// ---------------------------------------------------------------------------
// 格线开关（#modeGrid / Game.gridVisible）
// ---------------------------------------------------------------------------

step("格线开关：默认可见，按钮带 sel", () => {
  Game.newGame(15, 1);
  if (Game.gridVisible !== true) throw new Error("默认应可见");
  if (!Game.el.modeGrid.classList.contains("sel"))
    throw new Error("默认 #modeGrid 应带 sel（sel = 格线可见，与 modeGhost 同一套语义）");
});

step("格线开关：关闭只闸 draw、不闸 upload —— staticGridCount 必须原样不动", () => {
  Game.newGame(15, 1);
  const want = (3 * 15 * 15 + 12) * 12;
  const before = Game.staticGridCount;
  if (before !== want) throw new Error("前置：staticGridCount 应为 " + want + "，实际 " + before);

  Game.setGridVisible(false);
  if (Game.gridVisible !== false) throw new Error("应已关闭");
  if (Game.el.modeGrid.classList.contains("sel")) throw new Error("关闭后 sel 应去掉");
  // 这一条是这个实现的**核心不变量**：改成"关闭时不 upload"会让计数变 0，
  // （上面那条 gridSegments 的断言会先红），而且每次切换都要重传 GPU 缓冲。
  if (Game.staticGridCount !== before)
    throw new Error("关闭格线不应改变 staticGridCount：" + before + " → " + Game.staticGridCount);

  Game.setGridVisible(true);
  if (!Game.el.modeGrid.classList.contains("sel")) throw new Error("再打开后 sel 应回来");
});

step("格线开关：关掉之后 draw3D 不再画 static 线，但仍然画 active 蓝框", () => {
  Game.newGame(15, 1);
  const real = RendererNS.drawLines;
  const calls = [];
  RendererNS.drawLines = function (key) { calls.push(key); };
  try {
    Game.draw3D();
    if (calls.indexOf("static") < 0) throw new Error("前置：开着的时候应该画 static，实际画了 " + calls.join(","));
    Game.setGridVisible(false);
    calls.length = 0;
    Game.draw3D();
    if (calls.indexOf("static") >= 0)
      throw new Error("关掉格线后不应再画 static，实际画了 " + calls.join(","));
    // 这一条钉住的是**产品选择本身**：只隐藏静态灰网。
    // 蓝框（当前层）、红线（落点校准）、绿框（待转层）、金线（获胜连线）全都必须留着 ——
    // 全关掉之后点击落子就变成盲猜了。以后有人"顺手"把蓝框也关掉，这里会红。
    if (calls.indexOf("active") < 0)
      throw new Error("关掉格线后仍应画 active 当前层框，实际画了 " + calls.join(","));
  } finally {
    RendererNS.drawLines = real;
  }
});

step("格线开关：开新局时回到默认可见（与 ghostMode 同一类视图状态）", () => {
  Game.newGame(15, 1);
  Game.setGridVisible(false);
  Game.newGame(15, 1);
  if (Game.gridVisible !== true) throw new Error("新局应回到默认可见");
  if (!Game.el.modeGrid.classList.contains("sel")) throw new Error("新局 #modeGrid 应带 sel");
});

step("格线开关：H 键能切；R 重开保留设置、开新局回到默认", () => {
  Game.newGame(15, 1);
  pressKey("h");
  if (Game.gridVisible !== false) throw new Error("按 H 应关掉格线");
  pressKey("h");
  if (Game.gridVisible !== true) throw new Error("再按 H 应打开");
  pressKey("h");   // 关掉
  // 这两条的差别是**照抄 ghostMode 的既有语义**，不是新发明的：
  //   · R「重开」= 还在同一局里接着玩，视图设置保留（ghostMode 也是保留的）
  //   · 设置页「开始游戏」= 新局，视图状态复位（newGame 里 ghostMode 就是复位成 true 的）
  // 两条都钉住，是为了以后有人"顺手统一"时能看见这里是有意的。
  Game.restart();
  if (Game.gridVisible !== false)
    throw new Error("R 重开应保留视图设置（与 ghostMode 一致），实际 " + Game.gridVisible);
  Game.newGame(15, 1);
  if (Game.gridVisible !== true) throw new Error("开新局应回到默认可见");
  if (!Game.el.modeGrid.classList.contains("sel")) throw new Error("开新局 #modeGrid 应带 sel");
});

// ---------------------------------------------------------------------------
// 终局横幅：关闭 + 拖动
// ---------------------------------------------------------------------------

/** 造一局黑胜（黑在 z=0 连五），并把横幅显示出来。 */
function makeDecidedGame() {
  Game.newGame(15, 1);
  for (let x = 0; x < 4; x++) { Game.tryPlace(x, 0); Game.tryPlace(x, 1); }
  const o = Game.session.place(4, 0, 0);
  if (o.status !== "Win") throw new Error("前置：黑棋第 5 手应判胜，实际 " + o.status);
  Game.onMoveApplied(Game.session.history[Game.session.moveCount - 1], o);
}

step("终局横幅：默认显示；点 #bannerClose 关掉；Esc 也能关", () => {
  makeDecidedGame();
  if (!Game.bannerOpen) throw new Error("前置：终局后横幅应显示");

  Game.el.bannerClose.dispatch("click");
  if (Game.bannerOpen) throw new Error("点关闭后横幅应隐藏");

  Game.showBanner();
  if (!Game.bannerOpen) throw new Error("前置：showBanner 后应显示");
  pressKey("Escape");
  if (Game.bannerOpen) throw new Error("Esc 也应能关掉横幅");
});

step("关掉横幅不改变棋局：仍然不能落子，且会给出可读的提示", () => {
  // 上一步留下的状态：终局 + 横幅已关
  if (Game.session.status !== "Decided")
    throw new Error("前置：状态应为 Decided，实际 " + Game.session.status);

  const n = Game.session.moveCount;
  Game.tryPlace(7, 7);
  if (Game.session.moveCount !== n)
    throw new Error("终局后不该能落子，手数从 " + n + " 变成了 " + Game.session.moveCount);
  // 原来这里是静默 return —— 点了完全没反应和"页面卡了"在玩家眼里是同一件事。
  if (Game.el.toast.textContent.indexOf("本局已结束") < 0)
    throw new Error("终局后点棋盘应给出提示，实际 " + JSON.stringify(Game.el.toast.textContent));
});

step("悔棋之后才能继续本局（这是唯一的出路）", () => {
  if (Game.session.status !== "Decided") throw new Error("前置：应为终局");
  const n = Game.session.moveCount;
  Game.undo();
  if (Game.session.status !== "Playing") throw new Error("悔棋后应回到进行中");
  Game.tryPlace(7, 7);
  if (Game.session.moveCount !== n)
    throw new Error("悔棋后应能落子（手数应回到 " + n + "），实际 " + Game.session.moveCount);
  const v = Game.session.board.getOrDefault(7, 7, Game.activeLayer);
  if (v !== 1) {
    const h = Game.session.history;
    throw new Error("(7,7," + Game.activeLayer + ") 上应有黑子(1)，实际 " + v +
      "；手数 " + Game.session.moveCount + " / dims " + Game.session.board.dims.join("×") +
      "；末手 " + JSON.stringify(h[h.length - 1] && { x: h[h.length - 1].x, y: h[h.length - 1].y,
                                                      z: h[h.length - 1].z, p: h[h.length - 1].player }));
  }
});

step("横幅拖动：位移跟手、transform 是两个 translate 叠加", () => {
  const banner = Game.el.banner, view = Game.el.view;
  // 桩里每个元素的 getBoundingClientRect 都是 {0,0,800,600}（clientWidth/Height 是常量），
  // 于是"可拖范围"会塌缩成 [0,0]，拖什么都得 0 —— 那等于什么都没测。
  // 所以这里替成一组真实几何：800×600 的 #view 里居中一个 300×150 的横幅。
  const rectOf = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b,
                                    width: r - l, height: b - t, x: l, y: t });
  const bannerRect = rectOf(250, 225, 550, 375);
  const realBanner = banner.getBoundingClientRect, realView = view.getBoundingClientRect;
  banner.getBoundingClientRect = () => bannerRect;
  view.getBoundingClientRect = () => rectOf(0, 0, 800, 600);
  const move = (x, y) => { for (const fn of (windowStubListeners.pointermove || [])) fn({ clientX: x, clientY: y }); };
  const up = (x, y) => { for (const fn of (windowStubListeners.pointerup || [])) fn({ button: 0, clientX: x, clientY: y }); };
  try {
    Game.bannerDX = 0; Game.bannerDY = 0; Game.bannerDrag = null;
    Game.applyBannerOffset();
    // 归零时必须是空串，落回 CSS 的居中规则 —— 写成 "translate(0px,0px)" 会把
    // CSS 里的 translate(-50%,-50%) 抹掉，横幅跳到右下角。
    if (banner.style.transform)
      throw new Error("位移归零时 style.transform 应为空串，实际 " + JSON.stringify(banner.style.transform));

    banner.dispatch("pointerdown", { button: 0, clientX: 400, clientY: 300 });
    move(460, 340);
    if (Game.bannerDX !== 60 || Game.bannerDY !== 40)
      throw new Error("位移应跟手 (60,40)，实际 (" + Game.bannerDX + "," + Game.bannerDY + ")");
    up(460, 340);

    const tf = banner.style.transform;
    // 只写一个 translate 就会把 CSS 里居中的那个覆盖掉 —— 这是这个功能最容易写错的地方。
    if (tf.indexOf("translate(-50%,-50%)") !== 0)
      throw new Error("transform 应以居中的 translate(-50%,-50%) 开头，实际 " + JSON.stringify(tf));
    if (tf.indexOf("translate(60px,40px)") < 0)
      throw new Error("transform 里应含位移，实际 " + JSON.stringify(tf));

    // 拖到远超边界：横幅四边都必须留在 #view 里（#view 是 overflow:hidden，
    // 拖出去就永久够不着了）。可拖范围 x ∈ [0-250, 800-550] = [-250,250]，
    // y ∈ [0-225, 600-375] = [-225,225]。
    banner.dispatch("pointerdown", { button: 0, clientX: 400, clientY: 300 });
    move(5400, 5300);
    if (Game.bannerDX !== 250 || Game.bannerDY !== 225)
      throw new Error("越界应夹到 (250,225)，实际 (" + Game.bannerDX + "," + Game.bannerDY + ")");
    if (bannerRect.left + Game.bannerDX < 0 || bannerRect.right + Game.bannerDX > 800 ||
        bannerRect.top + Game.bannerDY < 0 || bannerRect.bottom + Game.bannerDY > 600)
      throw new Error("夹取之后横幅仍在 #view 之外：dx=" + Game.bannerDX + " dy=" + Game.bannerDY);
    up(5400, 5300);

    // 反方向同样要夹住
    banner.dispatch("pointerdown", { button: 0, clientX: 400, clientY: 300 });
    move(-5400, -5300);
    if (Game.bannerDX !== -250 || Game.bannerDY !== -225)
      throw new Error("反向越界应夹到 (-250,-225)，实际 (" + Game.bannerDX + "," + Game.bannerDY + ")");
    up(-5400, -5300);

    // 窄视口：横幅（min-width 300px + 34px 内边距 ≈ 368px）可能比 #view 还宽，
    // 这时可拖范围是 min > max。夹取会返回怪值，必须显式归零。
    view.getBoundingClientRect = () => rectOf(0, 0, 200, 600);
    banner.dispatch("pointerdown", { button: 0, clientX: 400, clientY: 300 });
    move(600, 300);
    if (Game.bannerDX !== 0)
      throw new Error("#view 比横幅还窄时应归零（居中溢出），实际 " + Game.bannerDX);
    up(600, 300);
  } finally {
    banner.getBoundingClientRect = realBanner;
    view.getBoundingClientRect = realView;
    Game.bannerDX = 0; Game.bannerDY = 0; Game.bannerDrag = null; Game.applyBannerOffset();
  }
});

step("横幅拖动：微位移不吞掉按钮的 click（与 canvas 的 <6 像素约定同构）", () => {
  const banner = Game.el.banner, view = Game.el.view;
  const rectOf = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b,
                                    width: r - l, height: b - t, x: l, y: t });
  const realBanner = banner.getBoundingClientRect, realView = view.getBoundingClientRect;
  banner.getBoundingClientRect = () => rectOf(250, 225, 550, 375);
  view.getBoundingClientRect = () => rectOf(0, 0, 800, 600);
  const move = (x, y) => { for (const fn of (windowStubListeners.pointermove || [])) fn({ clientX: x, clientY: y }); };
  const up = (x, y) => { for (const fn of (windowStubListeners.pointerup || [])) fn({ button: 0, clientX: x, clientY: y }); };
  makeDecidedGame();
  let undone = 0;
  const origUndo = Game.undo;
  Game.undo = function () { undone++; return origUndo.apply(this, arguments); };
  try {
    // 按在"悔棋"上、手抖移动 2 像素：横幅挪 2 像素（看不出来），但悔棋必须照常生效。
    banner.dispatch("pointerdown", { button: 0, clientX: 400, clientY: 300 });
    move(402, 302);
    up(402, 302);
    Game.el.bannerUndo.dispatch("click");
    if (undone !== 1)
      throw new Error("微位移之后按钮的 click 被吞掉了（悔棋调用次数 " + undone + "）");
    if (Game.session.status !== "Playing") throw new Error("悔棋应已生效");
  } finally {
    Game.undo = origUndo;
    banner.getBoundingClientRect = realBanner;
    view.getBoundingClientRect = realView;
    Game.bannerDX = 0; Game.bannerDY = 0; Game.bannerDrag = null; Game.applyBannerOffset();
    Game.newGame(15, 1);
  }
});

step("横幅位置：新局复位，悔棋不动它", () => {
  // 顺序要紧：makeDecidedGame 里会 newGame，而 newGame 会复位位移。
  // 先建局、再挪横幅，才测得到"悔棋不动它"。
  makeDecidedGame();
  Game.bannerDX = 120; Game.bannerDY = -60; Game.applyBannerOffset();
  if (Game.el.banner.style.transform.indexOf("translate(120px,-60px)") < 0)
    throw new Error("前置：位移没写进 transform");
  // 悔棋不走 onReset，所以位置要留着 —— 玩家把横幅挪开是为了看棋，
  // 悔一步接着下的时候没有理由让它跳回中间。
  Game.undo();
  if (Game.bannerDX !== 120 || Game.bannerDY !== -60)
    throw new Error("悔棋不应复位横幅位置，实际 (" + Game.bannerDX + "," + Game.bannerDY + ")");
  Game.restart();
  if (Game.bannerDX !== 0 || Game.bannerDY !== 0)
    throw new Error("重开应复位横幅位置，实际 (" + Game.bannerDX + "," + Game.bannerDY + ")");
  if (Game.el.banner.style.transform)
    throw new Error("复位后 style.transform 应为空串，实际 " + JSON.stringify(Game.el.banner.style.transform));
});

// ---------------------------------------------------------------------------
// 相机拖拽（全项目第一组钉住拖动映射的测试）
// ---------------------------------------------------------------------------

step("相机常量：夹取留余量（不能是 90），且比原来的 85 更宽", () => {
  const deg = camConst("CAM_DEG_PER_PX");
  const pole = camConst("CAM_POLE");
  if (Math.abs(deg - 0.32) > 1e-9)
    throw new Error("拖拽灵敏度变了（原本 0.32 度/像素）：" + deg);
  // 上限必须严格小于 90：pitch 正好 ±90° 时 up×dir 退化成零向量，
  // M4.lookAt 会把 x 轴硬设成 (1,0,0)，画面突然滚半圈。
  // 这是"能不能把夹取改成 90"的看门测试。
  if (!(pole > 0 && pole < 90))
    throw new Error("CAM_POLE 必须严格落在 (0,90)，实际 " + pole);
  // 也不能离 90 太近 —— 要留够远离那个 1e-6 退化阈值。cos(89.5°)=8.7e-3。
  if (pole > 89.9) throw new Error("CAM_POLE 离 90 太近，余量不够：" + pole);
  // 相对原来的 85° 必须是放宽，不是收紧。
  if (pole <= 85) throw new Error("CAM_POLE 应比原来的 85° 更宽，实际 " + pole);
});

step("相机拖拽：水平无限转，yaw 不设上限", () => {
  const cam = Game.camera;
  cam.yaw = 0; cam.pitch = 24;
  Game.applyDrag(1000, 0);
  if (Math.abs(cam.yaw - 320) > 1e-9) throw new Error("水平应线性累加，实际 yaw=" + cam.yaw);
  Game.applyDrag(100000, 0);
  if (!isFinite(cam.yaw)) throw new Error("yaw 不该变成非有限数");
  if (cam.pitch !== 24) throw new Error("纯水平拖拽不该改 pitch，实际 " + cam.pitch);
});

step("相机拖拽：顶视和底视真的够得到（原来是 ±85 夹在偏轴 5° 处）", () => {
  const cam = Game.camera;
  const DEG = camConst("CAM_DEG_PER_PX");
  const pole = camConst("CAM_POLE");
  cam.yaw = 0; cam.pitch = 0;
  Game.applyDrag(0, -100000);            // 一直往上拖
  if (Math.abs(cam.pitch - pole) > 1e-9)
    throw new Error("往上拖到底应停在 +CAM_POLE=" + pole + "，实际 " + cam.pitch);
  // 真正要钉的是"离极轴有多远"：85° 时 cos=0.087（偏轴 5°），仍然明显是个斜视；
  // 89.5° 时 cos=0.0087（偏轴 0.5°），才是真的正对顶面。
  if (Math.cos(cam.pitch * Math.PI / 180) > 0.02)
    throw new Error("顶视不够正：离极轴 " + (Math.acos(Math.cos(cam.pitch * Math.PI / 180)) * 180 / Math.PI).toFixed(2) + "°");
  cam.pitch = 0;
  Game.applyDrag(0, 100000);             // 一直往下拖
  if (Math.abs(cam.pitch + pole) > 1e-9)
    throw new Error("往下拖到底应停在 -CAM_POLE=" + (-pole) + "，实际 " + cam.pitch);
});

step("相机拖拽：垂直方向不会在极点附近震荡（这是被砍掉的'翻越极点'版本的病）", () => {
  const cam = Game.camera;
  const DEG = camConst("CAM_DEG_PER_PX");
  const oneDeg = 1 / DEG;
  // 被砍掉的那版实现，越过极点会把状态折回极点之内，于是每一拍都再跨一次，
  // 实测序列是 89 89.95 89.05 89.95 89.05 … —— 棋盘在极点边上永远抖。
  // 这一条就是钉住它不再发生：一直往上拖，pitch 单调不减、yaw 一次都不翻。
  cam.yaw = 0; cam.pitch = 85;
  let prev = cam.pitch, flips = 0, prevYaw = cam.yaw;
  for (let i = 0; i < 30; i++) {
    Game.applyDrag(0, -oneDeg);
    if (cam.pitch < prev - 1e-9)
      throw new Error("第 " + i + " 拍 pitch 倒退了：" + prev + " → " + cam.pitch + "（震荡）");
    prev = cam.pitch;
    if (cam.yaw !== prevYaw) { flips++; prevYaw = cam.yaw; }
    if (!isFinite(cam.pitch) || Math.abs(cam.pitch) > camConst("CAM_POLE") + 1e-9)
      throw new Error("第 " + i + " 拍越界：pitch=" + cam.pitch);
  }
  if (flips !== 0) throw new Error("垂直拖拽不该翻 yaw（翻越极点那版每拍翻一次），实际 " + flips + " 次");
  if (Math.abs(cam.pitch - camConst("CAM_POLE")) > 1e-9)
    throw new Error("应该稳定停在上限，实际 " + cam.pitch);
});

step("相机拖拽：任意猛拖都不会出 NaN、不会越界、不会改 distance", () => {
  const cam = Game.camera;
  const pole = camConst("CAM_POLE");
  cam.yaw = -32; cam.pitch = 24;
  // 用固定序列而不是随机：失败要能一模一样地复现。这一串覆盖了单帧巨大位移
  // （触控板惯性、切回标签页）和正负交替。
  const seq = [1e6, -1e6, 12345.6, -98765.4, 0.5, -0.5, 7e4, -3e5, 1e7, -1e7];
  for (const dy of seq) {
    for (const dx of seq) {
      Game.applyDrag(dx, dy);
      if (!isFinite(cam.pitch) || Math.abs(cam.pitch) > pole + 1e-9)
        throw new Error("pitch 跑飞了：dy=" + dy + " dx=" + dx + " → " + cam.pitch);
      const eye = cam.eye();
      if (!isFinite(eye[0]) || !isFinite(eye[1]) || !isFinite(eye[2]))
        throw new Error("eye() 出现非有限数：dx=" + dx + " dy=" + dy);
      if (cam.distance !== 22) throw new Error("拖拽不该改 distance");
    }
  }
  // 收尾复位，别把状态留给后面的步骤
  cam.yaw = -32; cam.pitch = 24;
});

step("相机拖拽：任意猛拖都不会出 NaN、不会把 pitch 放到 90", () => {
  const cam = Game.camera;
  cam.yaw = -32; cam.pitch = 24;
  // 用固定序列而不是随机：失败要能一模一样地复现。这一串覆盖了单帧巨大位移
  // （触控板惯性、切回标签页）和正负交替。
  const seq = [1e6, -1e6, 12345.6, -98765.4, 0.5, -0.5, 7e4, -3e5, 1e7, -1e7];
  for (const dy of seq) {
    for (const dx of seq) {
      Game.applyDrag(dx, dy);
      if (!isFinite(cam.pitch) || Math.abs(cam.pitch) >= 90)
        throw new Error("pitch 跑飞了：dy=" + dy + " dx=" + dx + " → " + cam.pitch);
      const eye = cam.eye();
      if (!isFinite(eye[0]) || !isFinite(eye[1]) || !isFinite(eye[2]))
        throw new Error("eye() 出现非有限数：dx=" + dx + " dy=" + dy);
      // 距离不能被拖拽改到
      if (cam.distance !== 22) throw new Error("拖拽不该改 distance");
    }
  }
  // 收尾复位，别把状态留给后面的步骤
  cam.yaw = -32; cam.pitch = 24;
});

// ---------------------------------------------------------------------------
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
console.log("注意：这套桩只能证明代码跑得通、没有空引用和拼写错误。");
console.log("      GLSL 能否编译、布局是否错位、视觉效果是否可读，仍然必须在真实浏览器里看。");
