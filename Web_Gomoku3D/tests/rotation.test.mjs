// 四维模式（转动层）的跨实现一致性测试。
//
// 这份测试回答的唯一问题：**rotation-vectors.json 里那份转动结果，JS 内核能不能逐格复现？**
//
// 为什么必须有它：转动置换这种东西，一处 u/v 写反、一处 (n-1) 写成 n，光看代码"很对"，
// 跑自己写的单元测试也全能过（因为测试可能带着同一个错误假设）。
// 唯一可靠的办法是拿一份【独立产生】的结果去卡它 —— 这里读的 rotation-vectors.json
// 由原来的 C# 内核（_verify/emit-rotation-vectors.cs）导出，在 JS 上原样回放。
//
// 运行：node Web_Gomoku3D/tests/rotation.test.mjs
//
// ！rotation-vectors.json 【无法重新生成】—— 导出它的 C# 内核已经被删除。
//   不要为了让它变绿而改它（_verify/run-all.sh 第 2 步会用 md5 当场抓出来）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.join(HERE, "..", "index.html");
const VECTORS_PATH = path.join(HERE, "rotation-vectors.json");

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

// ---------------------------------------------------------------------------
// 把内核抽出来（和 rules.test.mjs 同一套标记区间）
// ---------------------------------------------------------------------------
const html = fs.readFileSync(HTML_PATH, "utf8");
const BEGIN = "/* GOMOKU-CORE-BEGIN */";
const END = "/* GOMOKU-CORE-END */";
const a = html.indexOf(BEGIN);
const b = html.indexOf(END);
if (a < 0 || b < 0) {
  console.error("index.html 里找不到 GOMOKU-CORE 标记区间");
  process.exit(2);
}
const core = html.slice(a + BEGIN.length, b);

const M = new Function(core + `
  return { Board3D, RuleSet, GameSession, FourDSession, RotationOps, RotationMove, RotateStatus,
           AxisName: axisName, AXIS_X, AXIS_Y, AXIS_Z, EMPTY, BLACK, WHITE };
`)();
const { Board3D, RuleSet, GameSession, FourDSession, RotationOps, RotationMove, RotateStatus,
        AxisName, EMPTY, BLACK, WHITE } = M;

const vectors = JSON.parse(fs.readFileSync(VECTORS_PATH, "utf8"));

// ---------------------------------------------------------------------------
// 和 C# 侧逐位一致的 FNV-1a 32 位
//
// 刻意手动写、不用任何内建哈希：C# 的 string.GetHashCode() 在 .NET Core 上每次进程启动
// 都换种子，根本没法跨进程比。这里必须是一个写死的算法。
// Math.imul 给出和 C# unchecked 乘法一致的 32 位结果。
// ---------------------------------------------------------------------------
function fnv1a(bytes) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h = (h ^ bytes[i]) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** 走公开的 get()，不直接读 cells —— 这样哈希的是"逻辑盘面"，和存储布局无关。 */
function boardHash(board) {
  const n = board.size;
  const raw = new Uint8Array(n * n * n);
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        raw[x + n * (y + n * z)] = board.get(x, y, z);
  return fnv1a(raw);
}

/** 和 C# Pattern() 必须完全一致：三态、每格不同。 */
function pattern(x, y, z) {
  const k = (x * 3 + y * 5 + z * 7) % 3;
  return k === 0 ? BLACK : (k === 1 ? WHITE : EMPTY);
}

console.log("向量生成方：" + vectors.generatedBy);
console.log("置换用例 " + vectors.rotateMaps.length + " 组；动作用例 " + vectors.actionCases.length + " 局");

if (vectors.rotateMaps.length === 0) {
  failures.push("rotateMaps 是空的 —— 向量导出没跑成功，这份测试什么都没验到");
}
if (vectors.actionCases.length === 0) {
  failures.push("actionCases 是空的 —— 向量导出没跑成功，这份测试什么都没验到");
}

// ---------------------------------------------------------------------------
// 1. 置换穷举：轴 × 层 × 次数，比对整盘哈希
// ---------------------------------------------------------------------------
let mapCases = 0;
for (const c of vectors.rotateMaps) {
  const ctx = `${c.size}³ 轴${AxisName(c.axis)} 层${c.layer} 转${c.turns}次`;
  mapCases++;

  const board = new Board3D(c.size);
  for (let z = 0; z < c.size; z++)
    for (let y = 0; y < c.size; y++)
      for (let x = 0; x < c.size; x++)
        board.set(x, y, z, pattern(x, y, z));

  eq(board.stoneCount, c.stonesBefore, "初始棋子数", ctx);
  eq(boardHash(board), c.hashBefore, "初始盘面哈希", ctx);
  eq(board.countLayerStones(c.axis, c.layer), c.layerStones, "本层棋子数", ctx);

  const changed = board.rotateLayer(c.axis, c.layer, c.turns);

  eq(changed, c.changed, "changed 标志", ctx);
  eq(board.stoneCount, c.stonesAfter, "转动后棋子数（置换不变量）", ctx);
  eq(boardHash(board), c.hashAfter, "转动后盘面哈希", ctx);

  // 逆转动必须完全复位 —— C# 侧导出时自检过，这里在 JS 上再验一遍
  board.rotateLayer(c.axis, c.layer, 4 - c.turns);
  eq(boardHash(board), c.hashBefore, "逆转动后应回到原样", ctx);
}

// ---------------------------------------------------------------------------
// 1b. MapCoord 和 rotateLayer 必须描述【同一个置换】
//
// 这条不是"顺手多验一遍"。rotateLayer 走的是扁平下标、MapCoord 走的是坐标，
// 是同一件事的两份独立实现 —— 而向量回放只经过 rotateLayer。
//
// 实测：把 JS 里 y 轴那支的自由轴顺序写反（u=z,v=x 改成 u=x,v=z），
// 252 组置换哈希 + 161 步动作序列**全部依然通过**，因为只有 UI 和这一节用得到 mapCoord。
// 也就是说，少了这条断言，mapCoord 写错了没有任何东西会报警。
//
// 做法是穷举：空盘上只放一颗子，转一层，它必须恰好出现在 MapCoord 说的那个格子上。
// ---------------------------------------------------------------------------
for (const n of [2, 3, 4, 5, 6]) {
  for (const axis of [M.AXIS_X, M.AXIS_Y, M.AXIS_Z]) {
    for (let layer = 0; layer < n; layer++) {
      for (let turns = 1; turns <= 3; turns++) {
        for (let x = 0; x < n; x++) {
          for (let y = 0; y < n; y++) {
            for (let z = 0; z < n; z++) {
              const onAxis = axis === M.AXIS_X ? x : (axis === M.AXIS_Y ? y : z);
              if (onAxis !== layer) continue;

              const ctx = `${n}³ 轴${AxisName(axis)} 层${layer} 转${turns}次 (${x},${y},${z})`;
              const exp = RotationOps.mapCoord(axis, layer, n, { x, y, z }, turns);

              // 预期位置必须还在本层，否则 mapCoord 的层约束就破了
              const expOnAxis = axis === M.AXIS_X ? exp.x : (axis === M.AXIS_Y ? exp.y : exp.z);
              if (expOnAxis !== layer) {
                check(false, "mapCoord 把格子搬出了本层", ctx + " → " + `(${exp.x},${exp.y},${exp.z})`);
                continue;
              }

              const board = new Board3D(n);
              board.set(x, y, z, BLACK);
              board.rotateLayer(axis, layer, turns);

              check(board.get(exp.x, exp.y, exp.z) === BLACK,
                "MapCoord 和 rotateLayer 对不上：子没落在 MapCoord 说的位置",
                ctx + ` | mapCoord 说去 (${exp.x},${exp.y},${exp.z})`);
              check(board.stoneCount === 1,
                "转动后棋子数应该还是 1（置换不能把子弄丢或复制）", ctx);
              if (!(exp.x === x && exp.y === y && exp.z === z)) {
                check(board.isEmpty(x, y, z), "源格子应该空了", ctx);
              }
            }
          }
        }
      }
    }
  }
}

// MapCoord 的层约束：层外的坐标必须原样返回
{
  const s = 6;
  for (const axis of [M.AXIS_X, M.AXIS_Y, M.AXIS_Z]) {
    for (let layer = 0; layer < s; layer++) {
      for (let x = 0; x < s; x++)
        for (let y = 0; y < s; y++)
          for (let z = 0; z < s; z++) {
            const onAxis = axis === M.AXIS_X ? x : (axis === M.AXIS_Y ? y : z);
            if (onAxis === layer) continue;
            const r = RotationOps.mapCoord(axis, layer, s, { x, y, z }, 1);
            check(r.x === x && r.y === y && r.z === z,
              "MapCoord 不该动层外的格子", `轴${AxisName(axis)} 层${layer} (${x},${y},${z}) 得到 (${r.x},${r.y},${r.z})`);
          }
    }
  }
}

// ---------------------------------------------------------------------------
// 2. 动作序列：冷却 / 无变化 / 回滚 / 悔棋 / 回合，逐步比对
// ---------------------------------------------------------------------------
let actionSteps = 0;
for (const c of vectors.actionCases) {
  const rules = new RuleSet();
  rules.winLength = c.winLength;
  rules.allowRotation = c.allowRotation;
  rules.rotationCooldownPlacements = c.cooldown;

  const s = FourDSession.create(c.size, c.firstPlayer, rules);
  for (const st of c.stones) s.board.set(st[0], st[1], st[2], st[3]);

  eq(boardHash(s.board), c.initialHash, "初始盘面哈希", c.name);

  for (let i = 0; i < c.steps.length; i++) {
    const step = c.steps[i];
    const ctx = `${c.name} · 第 ${i + 1} 步 ${step.kind}`;
    actionSteps++;

    if (step.kind === "place") {
      const o = s.place(step.x, step.y, step.z);
      eq(o.status, step.status, "落子结果", ctx);
      eq(o.winner, step.winner, "胜者", ctx);
    } else if (step.kind === "rotate") {
      const o = s.rotate(RotationMove.fromClockwiseTurns(step.axis, step.layer, step.turns));
      eq(o.status, step.status, "转动结果", ctx + " → " + (o.reason || ""));
      eq(o.layerStones, step.layerStones, "本层棋子数", ctx);
    } else if (step.kind === "undo") {
      eq(s.undo(), step.ok, "悔棋返回值", ctx);
    } else if (step.kind === "undoRotation") {
      eq(s.undoLastRotation(), step.ok, "恢复本次转动的返回值", ctx);
    } else {
      check(false, "遇到了未知的动作类型", ctx + " " + step.kind);
      continue;
    }

    eq(s.currentPlayer, step.currentPlayer, "轮到谁", ctx);
    eq(s.moveCount, step.placements, "落子数", ctx);
    eq(s.rotationCount, step.rotations, "转动次数", ctx);
    eq(s.status, step.gameStatus, "棋局状态", ctx);
    eq(boardHash(s.board), step.hash, "盘面哈希", ctx);
  }
}

// ---------------------------------------------------------------------------
// 3. 内核自身的断言（和 C# 侧 FourDCoreTests 一一对应）
// ---------------------------------------------------------------------------

// 方向归一化：逆时针 t 次 == 顺时针 (4-t) 次
for (const axis of [M.AXIS_X, M.AXIS_Y, M.AXIS_Z]) {
  for (let layer = 0; layer < 5; layer++) {
    const ccw1 = RotationMove.create(axis, layer, 1 /* CounterClockwise */, 1);
    eq(ccw1.turns, 3, "逆时针 1 次应归一化成顺时针 3 次", `轴${AxisName(axis)} 层${layer}`);
    const ccw2 = RotationMove.create(axis, layer, 1, 2);
    eq(ccw2.turns, 2, "逆时针 2 次仍是 2 次", `轴${AxisName(axis)} 层${layer}`);
    const cw1 = RotationMove.create(axis, layer, 0, 1);
    eq(cw1.turns, 1, "顺时针 1 次就是 1 次", `轴${AxisName(axis)} 层${layer}`);
  }
}

// 次数越界必须抛异常
{
  let threw = false;
  try { RotationMove.create(0, 0, 0, 4); } catch (e) { threw = true; }
  check(threw, "转 4 次必须被拒绝（它等于不动）");
  threw = false;
  try { RotationMove.create(0, 0, 0, 0); } catch (e) { threw = true; }
  check(threw, "转 0 次必须被拒绝");
  threw = false;
  try { RotationMove.create(0, -1, 0, 1); } catch (e) { threw = true; }
  check(threw, "负层号必须被拒绝");
}

// 方向直觉：z 轴第 0 层，玩家俯视看到的顺时针 = 左上 -> 右上
{
  const n = 3;
  const r = RotationOps.mapCoord(M.AXIS_Z, 0, n, { x: 0, y: 2, z: 0 }, 1);
  check(r.x === 2 && r.y === 2, "左上角顺时针一转应该到右上角", `得到 (${r.x},${r.y},${r.z})`);
  const r2 = RotationOps.mapCoord(M.AXIS_Z, 0, n, { x: 2, y: 0, z: 0 }, 1);
  check(r2.x === 0 && r2.y === 0, "右下角顺时针一转应该到左下角", `得到 (${r2.x},${r2.y},${r2.z})`);
}

// 三维模式下 FourDSession 必须完全透明
{
  const n = 8;
  const rules = new RuleSet();   // allowRotation 默认 false
  const plain = GameSession.create(n, BLACK, rules);
  const wrapped = FourDSession.create(n, BLACK, rules);

  let seed = 20260924;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) | 0; return ((seed >>> 16) & 0x7fff) / 0x7fff; };

  for (let step = 0; step < 300; step++) {
    if (plain.status !== "Playing" && wrapped.status !== "Playing") break;
    const x = (rnd() * n) | 0, y = (rnd() * n) | 0, z = (rnd() * n) | 0;
    const o1 = plain.place(x, y, z);
    const o2 = wrapped.place(x, y, z);
    eq(o2.status, o1.status, "三维模式包装层的判定状态", `第 ${step} 手 @${x},${y},${z}`);
    eq(o2.winner, o1.winner, "三维模式包装层的胜者", `第 ${step} 手`);
    eq(o2.longestRun, o1.longestRun, "三维模式包装层的最长连线", `第 ${step} 手`);
    eq(boardHash(wrapped.board), boardHash(plain.board), "三维模式包装层的盘面", `第 ${step} 手`);
    eq(wrapped.currentPlayer, plain.currentPlayer, "三维模式包装层的轮次", `第 ${step} 手`);
  }

  check(!wrapped.canRotate, "三维模式下不该能转动");
  const rej = wrapped.rotate(RotationMove.fromClockwiseTurns(M.AXIS_Z, 0, 1));
  eq(rej.status, RotateStatus.Rejected, "三维模式下转动必须被拒绝");
}

// 悔棋顺序：转动之后落子，就不能再单独撤销那次转动了
{
  const s = FourDSession.create(8, BLACK, (() => { const r = new RuleSet(); r.allowRotation = true; r.rotationCooldownPlacements = 0; return r; })());
  s.board.set(5, 5, 0, BLACK);
  s.rotate(RotationMove.fromClockwiseTurns(M.AXIS_Z, 0, 1));
  check(s.canUndoLastRotation, "刚转完应该能恢复本次转动");
  s.place(7, 7, 7);
  check(!s.canUndoLastRotation, "后面落子了就不该还能单独撤销那次转动");
  check(!s.undoLastRotation(), "被拒绝的撤销应返回 false");
}

// 转动永远不结束棋局
{
  const s = FourDSession.create(6, BLACK, (() => { const r = new RuleSet(); r.allowRotation = true; r.rotationCooldownPlacements = 0; return r; })());
  let seed = 13579;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) | 0; return ((seed >>> 16) & 0x7fff) / 0x7fff; };
  for (let i = 0; i < 120; i++) {
    if (s.status !== "Playing") break;
    s.rotate(RotationMove.fromClockwiseTurns((rnd() * 3) | 0, (rnd() * 6) | 0, 1 + ((rnd() * 3) | 0)));
    eq(s.status, "Playing", "转动不该结束棋局");
    eq(s.winner, EMPTY, "转动不该产生胜者");
  }
}

// 重开必须清空转动时间线
{
  const s = FourDSession.create(8, BLACK, (() => { const r = new RuleSet(); r.allowRotation = true; r.rotationCooldownPlacements = 0; return r; })());
  s.board.set(1, 1, 0, BLACK);
  s.rotate(RotationMove.fromClockwiseTurns(M.AXIS_Z, 0, 1));
  eq(s.rotationCount, 1, "转动应被记录");
  s.restart();
  eq(s.rotationCount, 0, "重开必须清空转动时间线");
  eq(s.moveCount, 0, "重开必须清空落子");
  check(!s.canUndoLastRotation, "重开后不该还能撤销上一局的转动");
}

// ---------------------------------------------------------------------------
console.log("");
console.log("回放：置换 " + mapCases + " 组，动作 " + actionSteps + " 步");
console.log("");
console.log("==================================================");
console.log("  " + passed + " 项通过 / " + failures.length + " 项失败");
console.log("==================================================");
if (failures.length) {
  console.log("");
  for (const f of failures.slice(0, 25)) console.log("FAIL: " + f);
  if (failures.length > 25) console.log("... 还有 " + (failures.length - 25) + " 条");
  process.exit(1);
}
