// 长方体（三轴不等）棋盘 + 尺寸约束的测试。
//
// 【为什么单独一个文件】
// rules.test.mjs 回放的是 vectors.json（由原 C# 内核导出，现已冻结），那是规则内核
// 唯一的外部证据。而长方体是【网页版独有的扩展】—— 原 C# 侧的 Board3D 只有一个 Size，
// vectors.json 每条用例也只有一个 "size" 字段。所以：
//
//   * 立方路径的证据仍然全在 vectors.json / rules.test.mjs 里，一个字节都没变；
//   * 长方体这条路径【向量完全不覆盖】，它的证据只有这个文件。
//
// 把这件事写在这里而不是含糊过去，是因为"证据覆盖到哪"本身就是要维护的东西：
// 谁要是以为 11733 项向量也覆盖了长方体，那才是真正的风险。
//
// 运行：node Web_Gomoku3D/tests/dims.test.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.join(HERE, "..", "index.html");

let passed = 0;
const failures = [];

function check(ok, name, detail) {
  if (ok) { passed++; return; }
  failures.push(name + (detail ? "\n      " + detail : ""));
}
function eq(actual, expected, name, ctx) {
  check(actual === expected, name,
    (ctx ? ctx + " | " : "") + "期望 " + JSON.stringify(expected) + " 实际 " + JSON.stringify(actual));
}
function throws(fn, needle, name) {
  try {
    fn();
  } catch (e) {
    const msg = String(e && e.message);
    check(msg.indexOf(needle) >= 0, name,
      "异常信息里应含有 " + JSON.stringify(needle) + "，实际是 " + JSON.stringify(msg));
    return;
  }
  check(false, name, "应该抛异常，但没有");
}

// ---------------------------------------------------------------------------
// 抽内核
// ---------------------------------------------------------------------------
const html = fs.readFileSync(HTML_PATH, "utf8");
const scriptStart = html.indexOf("<script>");
const scriptEnd = html.lastIndexOf("</script>");
const fullScript = html.slice(scriptStart + "<script>".length, scriptEnd);

const BEGIN = "/* GOMOKU-CORE-BEGIN */";
const END = "/* GOMOKU-CORE-END */";
const bi = fullScript.indexOf(BEGIN), ei = fullScript.indexOf(END);
if (bi < 0 || ei < 0 || ei <= bi) {
  console.error("index.html 里找不到 GOMOKU-CORE 标记区间");
  process.exit(2);
}
const coreSource = fullScript.slice(bi + BEGIN.length, ei);

let Core;
try {
  Core = new Function(coreSource + `
    return { Board3D, RuleSet, RuleEngine, GameSession, DIRS13, MoveStatus, RestrictionTarget,
             EMPTY, BLACK, WHITE, opponentOf, BoardLimits, normalizeDims,
             AXIS_X, AXIS_Y, AXIS_Z, RotationOps, RotationMove, RotateStatus, RotateOutcome,
             FourDSession };`)();
} catch (e) {
  console.error("内核求值失败：" + e.message + "\n" + (e.stack || ""));
  process.exit(2);
}
const { Board3D, RuleSet, RuleEngine, GameSession, MoveStatus, EMPTY, BLACK, WHITE,
        BoardLimits, normalizeDims, AXIS_X, AXIS_Y, AXIS_Z, RotationOps, RotationMove,
        RotateStatus, FourDSession } = Core;

console.log("尺寸范围：" + BoardLimits.Min + " .. " + BoardLimits.Max);

// ---------------------------------------------------------------------------
// 1. normalizeDims
// ---------------------------------------------------------------------------
{
  eq(normalizeDims(15).join(","), "15,15,15", "数字 → 立方");
  eq(normalizeDims([8, 12, 30]).join(","), "8,12,30", "数组 → 原样三条边");
  eq(normalizeDims([9, 9, 9]).join(","), "9,9,9", "数组形式的立方");
  // 返回的必须是新数组：共享同一个数组的话，调用方改一处会改到别人手里那份
  const src = [8, 9, 10];
  normalizeDims(src)[0] = 99;
  eq(src[0], 8, "normalizeDims 不能把入参数组直接交出去");

  throws(() => normalizeDims(0), ">= 1", "尺寸 0 必须报错");
  throws(() => normalizeDims(-3), ">= 1", "负数尺寸必须报错");
  throws(() => normalizeDims(8.5), "整数", "非整数尺寸必须报错");
  throws(() => normalizeDims([8, 0, 8]), ">= 1", "数组里出现 0 必须报错");
  throws(() => normalizeDims([8, 8]), "数字（立方）或 [x,y,z]", "两维数组必须报错");
  throws(() => normalizeDims([8, 8, 8, 8]), "数字（立方）或 [x,y,z]", "四维数组必须报错");
  throws(() => normalizeDims("15"), "数字（立方）或 [x,y,z]", "字符串必须报错");
  throws(() => normalizeDims(undefined), "数字（立方）或 [x,y,z]", "undefined 必须报错");
  check(BoardLimits.Min <= BoardLimits.Max, "尺寸上下限不能反");
  check(BoardLimits.Min >= new RuleSet().minSizeFourD,
    "UI 下限必须 >= 内核下限 minSizeFourD —— 否则能开出一局永远分不出胜负的棋");
}

// ---------------------------------------------------------------------------
// 2. 长方体的索引 / 边界 / 遍历
// ---------------------------------------------------------------------------
{
  const d = [8, 12, 30];
  const b = new Board3D(d[0], d[1], d[2]);
  eq(b.nx + "," + b.ny + "," + b.nz, "8,12,30", "三条边各自记着");
  eq(b.dims.join(","), "8,12,30", "dims");
  eq(b.isCube, false, "8×12×30 不是立方");
  eq(b.cellCount, 8 * 12 * 30, "格子总数 = nx*ny*nz");
  eq(new Board3D(15).isCube, true, "Board3D(15) 是立方");
  eq(new Board3D(15).dims.join(","), "15,15,15", "Board3D(15) 的三条边都是 15");
  eq(new Board3D(15).size, 15, "立方下 size 就是边长");

  // 索引公式：index = x + nx*(y + ny*z)。和 C# 的 Index(size,x,y,z) 同一个形状，
  // 只是那条轴换成了各自的长。这一条必须钉死：x/y/z 三个系数写错任何一个，
  // 表现都只是"某一层的棋子跑到了别处"。
  let idxOK = true, sample = "";
  for (const [x, y, z] of [[0, 0, 0], [7, 11, 29], [3, 4, 5], [7, 0, 0], [0, 11, 0], [0, 0, 29]]) {
    const want = x + d[0] * (y + d[1] * z);
    const got = b.index(x, y, z);
    if (got !== want) { idxOK = false; sample = "(" + x + "," + y + "," + z + ") 期望 " + want + " 实际 " + got; }
  }
  check(idxOK, "长方体索引公式 index = x + nx*(y + ny*z)", sample);

  // 边界：三条边各不相同，写错一条就会在短边上越界、或在长边上提前截断
  eq(b.inBounds(7, 11, 29), true, "最大坐标在界内");
  eq(b.inBounds(8, 11, 29), false, "x 超一格");
  eq(b.inBounds(7, 12, 29), false, "y 超一格");
  eq(b.inBounds(7, 11, 30), false, "z 超一格");
  eq(b.inBounds(-1, 0, 0), false, "负数越界");
  eq(b.getOrDefault(8, 0, 0), EMPTY, "越界读返回 EMPTY");
  throws(() => b.get(8, 0, 0), "坐标越界", "越界 get 必须报错");

  // size 必须抛：返回 nx 会让"只改了三个轴里的一个"静默地用一个错的数继续跑
  throws(() => b.size, "没有单一 size", "长方体读 .size 必须抛异常");

  // 遍历：每颗子恰好访问一次，坐标和值都要对得上
  const seen = new Map();
  for (const [x, y, z] of [[0, 0, 0], [7, 11, 29], [3, 4, 5]]) b.set(x, y, z, (x + y + z) % 2 ? BLACK : WHITE);
  b.forEachStone((x, y, z, v) => seen.set(x + "," + y + "," + z, v));
  eq(seen.size, 3, "forEachStone 访问到的棋子数");
  eq(seen.get("7,11,29"), (7 + 11 + 29) % 2 ? BLACK : WHITE, "forEachStone 的坐标没有错位");
  eq(b.stoneCount, 3, "stoneCount");

  // countColumnStones：dst 的下标约定是 x + nx*y（不含 z），长度 nx*ny。
  //
  // 【期望值用最笨的办法在这里独立算一遍，然后逐个元素比对】。
  // 只抽查几个格子是不够的，而且这个教训是实测出来的：最开始我抽查了
  // (0,0)/(7,11)/(3,4) 三列，看着挺分散 —— 结果把行步长从 nx(8) 误写成 nz(30) 之后，
  // 那三颗棋子恰好被搬到与我抽查的槽位【完全相同】的下标上（0/35/95 三个都是错误映射的
  // 不动点），总数 3 也没变（计数是置换不变量），于是注入验证报"没抓到"。
  // 全量比对没有这种运气成分：任何下标错位都至少会让一个槽位对不上。
  const group = [[0, 0, 0], [7, 11, 29], [3, 4, 5], [3, 4, 0], [1, 11, 7], [7, 0, 29], [2, 2, 2]];
  const gb = new Board3D(d[0], d[1], d[2]);
  const want = new Int32Array(d[0] * d[1]);
  group.forEach(([x, y, z], i) => {
    gb.set(x, y, z, i % 2 ? BLACK : WHITE);
    want[x + d[0] * y]++;          // (3,4) 出现两次，专门测"沿 z 累加"
  });
  const got = new Int32Array(d[0] * d[1]);
  gb.countColumnStones(got);
  let diff = "", nonzero = 0;
  for (let i = 0; i < want.length; i++) {
    if (got[i] !== want[i]) diff += i + "(实际" + got[i] + "≠期望" + want[i] + ") ";
    if (want[i] > 0) nonzero++;
  }
  check(diff === "", "countColumnStones 整个 dst 必须与独立算出的期望逐格一致", diff);
  // 非空列数由 group 自己算出来，不写死 —— 写死的话改一个坐标就要跟着改这里
  const distinct = new Set(group.map(([x, y]) => x + "," + y)).size;
  eq(nonzero, distinct, "非空列数应等于 group 里不同的 (x,y) 个数");
  eq(got[3 + d[0] * 4], 2, "同一列的两颗子必须累加成 2");

  // 立方时退化回原来的公式 —— 这条保证"改宽"没有把老路径改坏
  const c = new Board3D(15);
  let same = true;
  for (const [x, y, z] of [[0, 0, 0], [14, 14, 14], [3, 7, 11]])
    if (c.index(x, y, z) !== x + 15 * (y + 15 * z)) same = false;
  check(same, "立方棋盘的索引与 C# 的 x + n*(y + n*z) 逐位一致");
}

// ---------------------------------------------------------------------------
// 3. 判定：长方体上 13 个方向仍然都成立
// ---------------------------------------------------------------------------
// 直接用 RuleEngine.judge 摆局面，不走 GameSession.place ——
// place 是【双方轮流】的，想摆一条 5 连得在别处替对手也落一子，
// 那是"顺便测了对局流程"，而这里要测的只是判定本身。
{
  const rules = new RuleSet();          // winLength 5，先手长连判负
  const win = (b, c, player, first) => RuleEngine.judge(b, { x: c[0], y: c[1], z: c[2] }, player, first, rules);

  // 沿 x（最短边 8）连 5
  {
    const b = new Board3D(8, 12, 30);
    for (let x = 0; x <= 4; x++) b.set(x, 3, 7, BLACK);
    const o = win(b, [4, 3, 7], BLACK, BLACK);
    eq(o.status, MoveStatus.Win, "沿 x 连 5 应判胜");
    eq(o.longestRun, 5, "沿 x 的最长连线");
    eq(o.line.length, 5, "获胜连线的坐标数");
    eq(JSON.stringify(o.line[0]), "[0,3,7]", "x 向连线的起点");
  }
  // 沿 y（12）连 5
  {
    const b = new Board3D(8, 12, 30);
    for (let y = 0; y <= 4; y++) b.set(2, y, 9, BLACK);
    const o = win(b, [2, 4, 9], BLACK, BLACK);
    eq(o.status, MoveStatus.Win, "沿 y 连 5 应判胜");
    eq(o.longestRun, 5, "沿 y 的最长连线");
    eq(JSON.stringify(o.line[0]), "[2,0,9]", "y 向连线的起点");
  }
  // 沿 z（最长边 30）连 5
  {
    const b = new Board3D(8, 12, 30);
    for (let z = 0; z <= 4; z++) b.set(1, 5, z, BLACK);
    const o = win(b, [1, 5, 4], BLACK, BLACK);
    eq(o.status, MoveStatus.Win, "沿 z 连 5 应判胜");
    eq(o.longestRun, 5, "沿 z 的最长连线");
    eq(JSON.stringify(o.line[0]), "[1,5,0]", "z 向连线的起点");
  }
  // 体对角 —— 长方体上最容易写错的一条，因为三个轴的步长现在不一样，
  // 而这条线要同时跨过三条长度不同的边
  {
    const b = new Board3D(8, 12, 30);
    for (let k = 0; k <= 4; k++) b.set(k, k, k, BLACK);
    const o = win(b, [4, 4, 4], BLACK, BLACK);
    eq(o.status, MoveStatus.Win, "体对角连 5 应判胜");
    eq(o.longestRun, 5, "体对角的最长连线");
  }
  // 面对角（x-y 平面）—— 两条边的长度不同，方向向量还是 (1,1,0)
  {
    const b = new Board3D(8, 20, 10);
    for (let k = 0; k <= 4; k++) b.set(k, 10 + k, 5, WHITE);
    const o = win(b, [4, 14, 5], WHITE, WHITE);
    eq(o.status, MoveStatus.Win, "面对角连 5 应判胜");
  }
  // 恰好 5 连在最短边（8 格）上也合法
  {
    const b = new Board3D(8, 8, 8);
    for (let x = 0; x <= 4; x++) b.set(x, 0, 0, BLACK);
    eq(win(b, [4, 0, 0], BLACK, BLACK).status, MoveStatus.Win, "8 格边上连 5 应判胜");
  }
  // 先手连 8 = 长连判负（8 格边上正好塞得下）
  {
    const b = new Board3D(8, 8, 8);
    for (let x = 0; x < 8; x++) b.set(x, 0, 0, BLACK);
    const o = win(b, [7, 0, 0], BLACK, BLACK);
    eq(o.status, MoveStatus.LoseByOverline, "先手连 8 应判长连负");
    eq(o.longestRun, 8, "长连的长度");
    eq(o.isOverlineFoul, true, "长连犯规标记");
  }
  // 后手不受长连限制：连 6 即胜
  {
    const b = new Board3D(8, 8, 8);
    for (let x = 0; x <= 5; x++) b.set(x, 2, 2, WHITE);
    const o = win(b, [5, 2, 2], WHITE, BLACK);   // 黑是先手，白是后手
    eq(o.status, MoveStatus.Win, "后手连 6 应判胜");
    eq(o.isOverlineFoul, false, "后手的长连不算犯规");
  }
  // 长方体上"另一条轴不参与"：沿 x 的 5 连必须只在 x 上，不能被 y/z 的长度干扰。
  // 这一条盯的是把 nz 当成 x 的上界这类错法 —— 那样会在 8 格的轴上数到 30 去，
  // 数出一堆越界的 EMPTY，line 也会拖出一条不存在的长线。
  {
    const b = new Board3D(8, 12, 30);
    for (let x = 0; x <= 4; x++) b.set(x, 11, 29, BLACK);
    const o = win(b, [4, 11, 29], BLACK, BLACK);
    eq(o.longestRun, 5, "角落上的 5 连不应被邻轴长度影响");
    eq(o.line.length, 5, "角落上的获胜连线不应超出棋盘");
  }
}

// ---------------------------------------------------------------------------
// 4. fullScan：长方体上"每条极大连线只记一次"仍然成立
// ---------------------------------------------------------------------------
{
  const rules = new RuleSet();
  const b = new Board3D(8, 8, 8);
  // 一条 5 连（沿 x）+ 一个孤立子
  for (let x = 0; x < 5; x++) b.set(x, 1, 1, BLACK);
  b.set(7, 7, 7, WHITE);
  const runs = RuleEngine.fullScan(b, 5);
  eq(runs.length, 1, "只应找到 1 条 >=5 的极大连线（孤立子不算）");
  eq(runs[0].length, 5, "该连线的长度");
  eq(RuleEngine.lineCoords(runs[0]).length, 5, "lineCoords 的坐标数");
  // 6 连只算一条，不是两条（起点守卫的职责）
  const b2 = new Board3D(8, 8, 8);
  for (let x = 0; x < 6; x++) b2.set(x, 2, 2, WHITE);
  eq(RuleEngine.fullScan(b2, 5).length, 1, "6 连只算一条极大连线");

  // 长方体：一条沿最长边（z）的连线上，起点守卫也必须只放行一次
  const b3 = new Board3D(8, 8, 30);
  for (let z = 10; z < 15; z++) b3.set(4, 4, z, BLACK);
  const r3 = RuleEngine.fullScan(b3, 5);
  eq(r3.length, 1, "长方体上的 z 向 5 连应恰好找到 1 条");
  eq(JSON.stringify(RuleEngine.lineCoords(r3[0])[0]), "[4,4,10]", "z 向连线的起点");
}

// ---------------------------------------------------------------------------
// 5. judge 与 fullScan 的交叉一致性（和 rules.test.mjs 同一套做法，随机局面）
// ---------------------------------------------------------------------------
{
  const rules = new RuleSet();
  let games = 0, crossChecked = 0, mismatch = "";
  // 固定种子的线性同余，不依赖 Math.random —— 失败必须能复现
  let seed = 20240924;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };

  for (const dims of [[8, 8, 8], [8, 12, 10], [10, 9, 14]]) {
    for (let g = 0; g < 12; g++) {
      const s = GameSession.create(dims, g % 2 ? BLACK : WHITE, rules);
      games++;
      for (let k = 0; k < 60 && s.status === "Playing"; k++) {
        const x = rnd(dims[0]), y = rnd(dims[1]), z = rnd(dims[2]);
        if (!s.board.isEmpty(x, y, z)) continue;
        const player = s.currentPlayer;
        const o = s.place(x, y, z);
        if (o.status === MoveStatus.Rejected) continue;
        crossChecked++;
        // 落子后：盘面上的极大连线里，>=5 的那些必须和判定结果对得上
        const runs = RuleEngine.fullScan(s.board, rules.winLength);
        const restrictNow = rules.isRestricted(player, s.firstPlayer);
        if (runs.length > 0 && !restrictNow) {
          if (o.status !== MoveStatus.Win) { mismatch = dims.join("×") + " 有连线却不是 Win"; }
        }
      }
    }
  }
  check(mismatch === "", "长方体随机对局里 judge 与 fullScan 不矛盾", mismatch);
  check(crossChecked > 500, "随机对局的有效落子数要够多（实际 " + crossChecked + "）");
  check(games === 36, "跑了 " + games + " 局");
}

// ---------------------------------------------------------------------------
// 6. GameSession 在长方体上的流程（悔棋 / 重开 / reset 的尺寸语义）
// ---------------------------------------------------------------------------
{
  const s = GameSession.create([8, 12, 30], BLACK, new RuleSet());
  eq(s.dims.join(","), "8,12,30", "GameSession.dims");
  s.place(0, 0, 0); s.place(1, 1, 1);
  eq(s.moveCount, 2, "落子数");
  eq(s.board.stoneCount, 2, "棋子数");
  s.undo();
  eq(s.board.stoneCount, 1, "悔棋后棋子数");
  eq(s.board.get(0, 0, 0), BLACK, "悔棋只撤最后一手");

  // 沿用 C# 的语义：尺寸 <= 0 表示"保持现在的棋盘"
  s.reset(0, BLACK, new RuleSet());
  eq(s.board.dims.join(","), "8,12,30", "reset(0) 应保持长方体尺寸不变");
  s.reset(undefined, BLACK, new RuleSet());
  eq(s.board.dims.join(","), "8,12,30", "reset(undefined) 应保持尺寸不变");
  s.restart();
  eq(s.board.dims.join(","), "8,12,30", "restart 应保持尺寸不变");
  eq(s.moveCount, 0, "restart 清空历史");

  // 长方体的某一维 <= 0 属于写错了，不能当成"保持"
  throws(() => s.reset([8, 0, 8], BLACK, new RuleSet()), ">= 1", "数组里 0 不能当成保持");

  // 换尺寸要能用数组
  s.reset([12, 12, 12], BLACK, new RuleSet());
  eq(s.board.dims.join(","), "12,12,12", "reset 用数组换尺寸");
  eq(s.board.isCube, true, "reset 之后是立方");
}

// ---------------------------------------------------------------------------
// 7. 四维模式：长方体上转层在数学上不存在，必须被明确拒绝
// ---------------------------------------------------------------------------
{
  // 证明放在代码里：绕 x 轴转一层把 (y,z) 映到 (z, nx-1-y)。要让结果还在原来的盒子里，
  // 需要 nz >= ny（z 分量）且 ny >= nz（y 分量），即 ny == nz。三个轴都要能转 ⇒ 立方。
  const b = new Board3D(8, 12, 30);
  throws(() => b.rotateLayer(AXIS_Z, 0, 1), "立方棋盘", "长方体上 rotateLayer 必须报错");
  throws(() => b.layerIndex(AXIS_Z, 0, 0, 0), "立方棋盘", "长方体上 layerIndex 必须报错");
  throws(() => b.countLayerStones(AXIS_Z, 0), "立方棋盘", "长方体上 countLayerStones 必须报错");

  // 立方上一切照旧（这是回归保护：守卫不能误伤立方路径）
  const c = new Board3D(8);
  c.set(2, 3, 0, BLACK);                     // 在第 0 层，但不在旋转不动点上
  const before = c.cells.slice();
  eq(c.rotateLayer(AXIS_Z, 0, 1), true, "立方上转动应报告盘面变了");
  eq(c.rotateLayer(AXIS_Z, 0, 4 - 1), true, "逆置换应转回去");
  let same = true;
  for (let i = 0; i < before.length; i++) if (before[i] !== c.cells[i]) same = false;
  check(same, "立方上顺时针转 t 次再转 4-t 次，必须逐格复原");

  // FourDSession 的入口：长方体 + 允许转动 → 返回"拒绝"，带一句能读懂的原因，
  // 而不是抛异常、也不是静默什么都不做
  const rs = new RuleSet();
  rs.allowRotation = true;
  rs.rotationCooldownPlacements = 0;
  const s4 = FourDSession.create([8, 12, 30], BLACK, rs);
  const out = s4.rotateBy(AXIS_Z, 0, 0, 1);
  eq(out.status, RotateStatus.Rejected, "长方体上的转动应是 Rejected");
  eq(out.accepted, false, "Rejected 不是 accepted");
  check(String(out.reason).indexOf("立方") >= 0 && String(out.reason).indexOf("自由轴") >= 0,
    "拒绝原因要说清是立方约束", String(out.reason));
  eq(s4.rotationCount, 0, "被拒的转动不留痕迹");
  eq(s4.currentPlayer, BLACK, "被拒的转动不消耗回合");

  // 立方 + 允许转动 → 转动照常工作（守卫没有把四维本身弄坏）
  const rs2 = new RuleSet();
  rs2.allowRotation = true;
  rs2.rotationCooldownPlacements = 0;
  const s5 = FourDSession.create(8, BLACK, rs2);
  s5.place(0, 0, 0);
  const ok = s5.rotateBy(AXIS_Z, 0, 0, 1);
  eq(ok.status, RotateStatus.Rotated, "立方上的转动应成功");
  // 绕 z 轴转一层：自由轴是 (x,y)，置换是 (x,y) -> (y, m-x)，m = 7。
  // (0,0,0) -> (0,7,0) —— 注意不是 (7,0,0)：那是逆时针的结果。
  eq(s5.board.get(0, 7, 0), BLACK, "绕 z 轴顺时针转一次：(0,0,0) 的子应到 (0,7,0)");
  eq(s5.board.get(0, 0, 0), EMPTY, "原来那一格应该空了");
}

// ---------------------------------------------------------------------------
// 8. 转动置换的几何：与 RotationOps.mapCoord 的参考实现逐格对齐
//    （这一节盯的是"三个轴的自由轴顺序各写一遍下标"里写反分量的错法）
// ---------------------------------------------------------------------------
{
  const n = 6, m = n - 1;
  const ref = (axis, layer, c, turns) => {
    const onAxis = axis === 0 ? c[0] : (axis === 1 ? c[1] : c[2]);
    if (onAxis !== layer) return c.slice();
    let p = c.slice();
    for (let k = 0; k < (turns & 3); k++) {
      if (axis === 0) p = [p[0], p[2], m - p[1]];        // ∥x： (y,z) → (z, m-y)
      else if (axis === 1) p = [m - p[2], p[1], p[0]];   // ∥y： (z,x) → (x, m-z)
      else p = [p[1], m - p[0], p[2]];                   // ∥z： (x,y) → (y, m-x)
    }
    return p;
  };
  let bad = "", count = 0;
  for (const axis of [AXIS_X, AXIS_Y, AXIS_Z]) {
    for (let t = 1; t <= 3; t++) {
      for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) for (let z = 0; z < n; z++) {
        const got = RotationOps.mapCoord(axis, 2, n, { x: x, y: y, z: z }, t);
        const want = ref(axis, 2, [x, y, z], t);
        count++;
        if (got.x !== want[0] || got.y !== want[1] || got.z !== want[2]) {
          bad = "轴" + axis + " 转" + t + "次 (" + x + "," + y + "," + z + ") 期望 " +
                want.join(",") + " 实际 " + [got.x, got.y, got.z].join(",");
        }
      }
    }
  }
  check(bad === "", "RotationOps.mapCoord 与参考置换逐格一致（" + count + " 格）", bad);

  // 不在该层里的坐标必须原样返回（少了这个判断，转一层会变成转整个棋盘）
  const outside = RotationOps.mapCoord(AXIS_Z, 2, n, { x: 1, y: 1, z: 4 }, 1);
  eq(outside.x + "," + outside.y + "," + outside.z, "1,1,4", "不在该层的坐标原样返回");

  // 自由轴的顺序必须和 Board3D.layerIndex 一致，否则会转到"另一条轴"上
  // "绕某轴的第几层"用的是【该轴上的那个坐标】—— 绕 x 轴时层号就是 x。
  // 这一条很容易记反，记反了会表现为"转了一层，结果别的层被搬走了"。
  const board = new Board3D(6);
  board.set(2, 2, 3, BLACK);          // x=2
  board.rotateLayer(AXIS_X, 1, 1);    // 绕 x 轴、第 1 层 —— 这颗子在 x=2，不在该层
  eq(board.get(2, 2, 3), BLACK, "不在该层的子不能被搬走");
  board.rotateLayer(AXIS_X, 2, 1);    // 这次是它所在的那一层
  const movedX = RotationOps.mapCoord(AXIS_X, 2, 6, { x: 2, y: 2, z: 3 }, 1);
  eq(board.get(movedX.x, movedX.y, movedX.z), BLACK,
    "rotateLayer 与 mapCoord 必须把同一颗子搬到同一个地方（绕 x）");

  const board2 = new Board3D(6);
  board2.set(1, 2, 3, BLACK);         // z=3
  board2.rotateLayer(AXIS_Z, 3, 1);
  const movedZ = RotationOps.mapCoord(AXIS_Z, 3, 6, { x: 1, y: 2, z: 3 }, 1);
  eq(board2.get(movedZ.x, movedZ.y, movedZ.z), BLACK,
    "rotateLayer 与 mapCoord 必须把同一颗子搬到同一个地方（绕 z）");
}

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
console.log("注意：这个文件覆盖的是【长方体】路径，而长方体是网页版独有的扩展 ——");
console.log("      vectors.json 不覆盖它（它由原 C# 内核导出，只测立方，且已冻结）。");
console.log("      立方路径的证据仍然全在 rules.test.mjs + vectors.json 里。");
