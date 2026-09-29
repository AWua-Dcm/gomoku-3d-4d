// 环绕规则的正确性探针。不是正式断言（正式断言等设计定了再进 ai.test.mjs），
// 目的是在跑测量之前先确认「环绕真的接通了」，否则量出来的数字没有意义。
import fs from "node:fs";

const html = fs.readFileSync("Web_Gomoku3D/index.html", "utf8");
const s = html.indexOf("<script>"), e = html.lastIndexOf("</script>");
const full = html.slice(s + 8, e);
const B = "/* GOMOKU-CORE-BEGIN */", E = "/* GOMOKU-CORE-END */";
const core = full.slice(full.indexOf(B) + B.length, full.indexOf(E));
const C = new Function(core + `return {Board3D,RuleSet,RuleEngine,GameSession,MoveStatus,
  EMPTY,BLACK,WHITE,aiCandidates,aiThreatAt,aiThreatValue,aiChooseMove,aiRng};`)();
const { Board3D, RuleSet, RuleEngine, GameSession, MoveStatus, EMPTY, BLACK, WHITE,
        aiCandidates, aiThreatAt, aiThreatValue, aiChooseMove, aiRng } = C;

let bad = 0;
const ok = (cond, name, extra) => {
  if (cond) console.log("  ✓ " + name);
  else { bad++; console.log("  ✗ " + name + (extra ? "  —— " + extra : "")); }
};

function mk(n, wrap) {
  const r = new RuleSet(); r.wrapEdges = wrap;
  return GameSession.create(n, BLACK, r);
}

console.log("A. 跨边界的五连");
{
  // 15³ 上，x = 13,14,0,1,2 是一条跨边界的五连
  const s1 = mk(15, true);
  for (const x of [13, 14, 0, 1]) s1.board.set(x, 7, 7, BLACK);
  s1.inner = s1;                       // GameSession 没有 inner，占位
  s1.board.set(2, 7, 7, BLACK);
  const o = RuleEngine.judge(s1.board, { x: 2, y: 7, z: 7 }, BLACK, BLACK, s1.rules);
  ok(o.status === MoveStatus.Win, "跨边界连成 5 判胜", o.status);

  // 同一局面，不环绕 → 不该判胜
  const s2 = mk(15, false);
  for (const x of [13, 14, 0, 1, 2]) s2.board.set(x, 7, 7, BLACK);
  const o2 = RuleEngine.judge(s2.board, { x: 2, y: 7, z: 7 }, BLACK, BLACK, s2.rules);
  ok(o2.status !== MoveStatus.Win, "同一局面在不环绕下不判胜", o2.status);
}

console.log("B. 整圈同色的长度封顶（8³ 一圈 8 颗）");
{
  const s1 = mk(8, true);
  for (let x = 0; x < 8; x++) s1.board.set(x, 3, 3, BLACK);
  const o = RuleEngine.judge(s1.board, { x: 0, y: 3, z: 3 }, WHITE, WHITE, s1.rules);
  // 白方在别处放一颗，问的是黑那一圈的长度 —— 直接用 fullScan 之外的路子：
  // judge 算的是"该点所在方向的最长连线"，所以拿黑自己问，且黑不是受限方
  const o2 = RuleEngine.judge(s1.board, { x: 0, y: 3, z: 3 }, BLACK, WHITE, s1.rules);
  ok(o2.longestRun === 8, "整圈同色长度算作 n（8），不是 2n−1（15）", "longestRun=" + o2.longestRun);
}

console.log("C. 环绕下的候选点");
{
  const s1 = mk(8, true);
  s1.board.set(0, 0, 0, BLACK);        // 放在角上
  const cands = aiCandidates(s1.board, 20000);
  let hasWrapped = false;
  for (let i = 0; i < cands.length; i += 3) {
    if (cands[i] === 7 && cands[i + 1] === 7 && cands[i + 2] === 7) hasWrapped = true;
  }
  ok(hasWrapped, "角上那颗子的邻域包含 (7,7,7)（对面那个角）");

  const s2 = mk(8, false);
  s2.board.set(0, 0, 0, BLACK);
  const c2 = aiCandidates(s2.board, 20000);
  let bad2 = false;
  for (let i = 0; i < c2.length; i += 3) if (c2[i] === 7) bad2 = true;
  ok(!bad2, "不环绕时候选里没有 x=7 的绕回点");
}

console.log("D. 环绕下的威胁计数");
{
  const s1 = mk(8, true);
  for (const x of [6, 7, 0]) s1.board.set(x, 2, 2, WHITE);
  // (1,2,2) 接上就是四连（6,7,0,1）
  const t = aiThreatAt(s1.board, 1, 2, 2, WHITE, 5, false);
  ok(t.fours >= 1, "环绕下 (1,2,2) 被看成四连点", JSON.stringify(t));

  const s2 = mk(8, false);
  for (const x of [6, 7, 0]) s2.board.set(x, 2, 2, WHITE);
  const t2 = aiThreatAt(s2.board, 1, 2, 2, WHITE, 5, false);
  ok(t2.fours === 0, "不环绕时它只是普通二连", JSON.stringify(t2));
}

console.log("E. 环绕下 AI 仍能正常出招且被引擎接受");
{
  let rejected = 0, plies = 0;
  for (let g = 0; g < 3; g++) {
    const s1 = mk(15, true);
    const rng = aiRng(500 + g);
    while (s1.status === "Playing" && plies < 120) {
      const a = aiChooseMove(s1, { level: "ultra", seed: (rng() * 4294967296) >>> 0 });
      if (a.kind !== "place") break;
      const r = s1.place(a.x, a.y, a.z);
      if (r.status === MoveStatus.Rejected) { rejected++; break; }
      plies++;
    }
  }
  ok(rejected === 0, "环绕模式下自对局每一手都被引擎接受", "rejected=" + rejected + " plies=" + plies);
}

console.log(bad === 0 ? "\n全部通过" : "\n有 " + bad + " 项失败");
process.exit(bad === 0 ? 0 : 1);
