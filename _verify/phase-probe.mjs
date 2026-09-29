// 晨昏规则的正确性探针。跑测量之前先确认相位真的接通了。
import fs from "node:fs";

const html = fs.readFileSync("Web_Gomoku3D/index.html", "utf8");
const s = html.indexOf("<script>"), e = html.lastIndexOf("</script>");
const full = html.slice(s + 8, e);
const B = "/* GOMOKU-CORE-BEGIN */", E = "/* GOMOKU-CORE-END */";
const core = full.slice(full.indexOf(B) + B.length, full.indexOf(E));
const C = new Function(core + `return {Board3D,RuleSet,RuleEngine,GameSession,MoveStatus,
  EMPTY,BLACK,WHITE,aiThreatAt,aiThreatValue,cellOf,colourOf,phaseOf,aiChooseMove,aiRng,
  MoveMode};`)();
const { Board3D, RuleSet, RuleEngine, GameSession, MoveStatus, EMPTY, BLACK, WHITE,
        aiThreatAt, aiThreatValue, cellOf, colourOf, phaseOf, aiChooseMove, aiRng, MoveMode } = C;

let bad = 0;
const ok = (c, name, extra) => {
  if (c) console.log("  ✓ " + name);
  else { bad++; console.log("  ✗ " + name + (extra ? "  —— " + extra : "")); }
};

function mk(n, P) {
  const r = new RuleSet(); r.phasePeriod = P || 0;
  return GameSession.create(n, BLACK, r);
}

console.log("A. 编码是自洽的");
{
  ok(cellOf(BLACK, 0) === 1 && cellOf(WHITE, 0) === 2, "相位 0 时编码是恒等（1/2）");
  ok(cellOf(BLACK, 1) === 5 && cellOf(WHITE, 1) === 6, "相位 1 时是 5/6");
  ok(colourOf(5) === BLACK && colourOf(6) === WHITE, "取颜色");
  ok(phaseOf(5) === 1 && phaseOf(1) === 0, "取相位");
}

console.log("B. 混相位的五连【不算】");
{
  const s1 = mk(15, 0);
  // 手摆：4 颗相位 0 + 1 颗相位 1，位置连成 5
  for (const x of [3, 4, 5, 6]) s1.board.set(x, 7, 7, cellOf(BLACK, 0));
  s1.board.set(7, 7, 7, cellOf(BLACK, 1));
  const o = RuleEngine.judge(s1.board, { x: 7, y: 7, z: 7 }, BLACK, WHITE, s1.rules, cellOf(BLACK, 1));
  ok(o.status !== MoveStatus.Win, "同色但混相位 → 不判胜", "longestRun=" + o.longestRun);
  ok(o.longestRun === 1, "最长连线只有那颗异相位的自己（1）", "longestRun=" + o.longestRun);

  // 五颗同相位 → 判胜
  for (const x of [3, 4, 5, 6]) s1.board.set(x, 9, 9, cellOf(BLACK, 1));
  s1.board.set(7, 9, 9, cellOf(BLACK, 1));
  const o2 = RuleEngine.judge(s1.board, { x: 7, y: 9, z: 9 }, BLACK, WHITE, s1.rules, cellOf(BLACK, 1));
  ok(o2.status === MoveStatus.Win, "五颗同相位 → 判胜", o2.status);
}

console.log("C. 相位真的会翻转，且翻转时整盘清算");
{
  const s1 = mk(15, 4);          // 每 4 手翻一次
  const seen = [];
  for (let i = 0; i < 6; i++) seen.push(s1.phase);
  // 落 2(2手) → 相位应还是 0；落满 4 手 → 翻到 1
  s1.place(1, 1, 1); s1.place(2, 1, 1);
  const mid = s1.phase;
  s1.place(3, 1, 1); s1.place(4, 1, 1);
  ok(mid === 0, "落满 2 手时相位还是 0", mid);
  ok(s1.phase === 1, "落满 4 手后翻到 1", s1.phase);
  ok(s1.board.cells[1 + 15 * (1 + 15 * 1)] === cellOf(BLACK, 0), "第一颗子仍是相位 0（相位是落下时定死的）");
}

console.log("D. 翻转瞬间结算「已经存在、但刚才不算」的那条线");
{
  const s1 = mk(15, 2);
  // 手摆一条相位 1 的五连（永夜），但当前是相位 0（黎明）→ 现在不算
  for (const x of [2, 3, 4, 5, 6]) s1.board.set(x, 8, 8, cellOf(WHITE, 1));
  s1.elapsedInPhase = s1.phaseTarget - 1;   // 再落一手就翻
  s1.place(0, 0, 0);             // 黑落一手 → 翻到相位 1
  ok(s1.phase === 1, "翻到了相位 1", s1.phase);
  ok(s1.status === "Decided" && s1.winner === WHITE,
     "翻转那一刻，那条永夜五连当场结算（白胜）", s1.status + "/" + s1.winner);
}

console.log("E. 催 / 缓：时间债的记账与上限");
{
  const r = new RuleSet(); r.phasePeriod = 12;
  const s1 = GameSession.create(15, BLACK, r);
  const o = (x, mode) => s1.place(x, 0, 0, "zh", mode);
  ok(s1.phaseTarget === 12 && s1.handsUntilFlip === 12, "初始：本相位长 12 格");

  o(1, C.MoveMode.Slow);
  ok(s1.handsUntilFlip === 12, "缓一手 → 倒计时不动", s1.handsUntilFlip);
  ok(s1.phaseDebt === 1, "缓一手 → 债 +1", s1.phaseDebt);

  o(2, C.MoveMode.Fast);
  ok(s1.handsUntilFlip === 10, "催一手 → 倒计时走两格（12−2）", s1.handsUntilFlip);
  ok(s1.phaseDebt === 0, "催一手 → 债还掉一格", s1.phaseDebt);

  // 借满：maxDebt = P − 2 = 10
  const s2 = GameSession.create(15, BLACK, r);
  let slowOk = 0;
  for (let i = 0; i < 20; i++) {
    const rr = s2.place(i, 0, 0, "zh", C.MoveMode.Slow);
    if (rr.status === MoveStatus.Rejected) break;
    slowOk++;
  }
  ok(slowOk === 10, "缓最多只能借 P−2 = 10 格，第 11 次被拒", "实际 " + slowOk);

  // 催也有上限：连续催，债不许越过 −maxDebt。
  // 【原来的写法测不出来】它一直落在同一条线上，坐标先越界了 —— 于是"被拒"的原因是
  // 越界不是债上限，而断言只是 `fastOk <= 12`，越界恰好也满足它。**假绿。**
  // 改成：散布在所有轴上、盯着债的实际取值范围。
  const s3 = GameSession.create(20, BLACK, r);
  let worst = 0, accepted = 0;
  for (let i = 0; i < 20 && s3.status === "Playing"; i++) {
    for (let j = 0; j < 20 && s3.status === "Playing"; j++) {
      if (s3.board.isEmpty(i, j, 0)) {
        const rr = s3.place(i, j, 0, "zh", C.MoveMode.Fast);
        if (rr.status !== MoveStatus.Rejected) accepted++;
      }
      if (Math.abs(s3.phaseDebt) > worst) worst = Math.abs(s3.phaseDebt);
      if (worst > r.maxDebt) break;
    }
  }
  ok(accepted > 10, "催能连着用不少次（说明没被误拒）", "接受 " + accepted + " 次");
  ok(worst <= r.maxDebt, "债始终没越过 ±maxDebt（催和缓是对称封顶的）",
     "实际最大 |债| = " + worst + "，上限 " + r.maxDebt);
}

console.log("F. 债翻转时结算给下一相位");
{
  const r = new RuleSet(); r.phasePeriod = 12;
  const s1 = GameSession.create(15, BLACK, r);
  // 借 3 格，然后把时间走满
  for (let i = 0; i < 3; i++) s1.place(i, 0, 0, "zh", C.MoveMode.Slow);
  for (let i = 0; i < 12 && s1.phase === 0; i++) s1.place(i, 2, 0, "zh", C.MoveMode.Normal);
  ok(s1.phase === 1, "相位翻到了 1", s1.phase);
  ok(s1.phaseTarget === 9, "下一相位长度 = P − 债 = 12 − 3 = 9", s1.phaseTarget);
  ok(s1.phaseDebt === 0, "债已清零", s1.phaseDebt);
}

console.log("G. AI 不会把「异相位的连续子」当成自己的威胁");
{
  const s1 = mk(15, 0);
  for (const x of [3, 4, 5, 6]) s1.board.set(x, 7, 7, cellOf(BLACK, 0));
  // 问 (7,7,7)：若按相位 0 算，它是第五颗 → wins；若按相位 1 算，它接不上 → 不是
  const t0 = aiThreatAt(s1.board, 7, 7, 7, cellOf(BLACK, 0), 5, false);
  const t1 = aiThreatAt(s1.board, 7, 7, 7, cellOf(BLACK, 1), 5, false);
  ok(t0.wins >= 1, "按相位 0 问：是成五点", JSON.stringify(t0));
  ok(t1.wins === 0, "按相位 1 问：不是成五点（那四颗是相位 0 的，接不上）", JSON.stringify(t1));
}

console.log("H. 开启相位后自对局仍能正常跑完");
{
  for (const P of [10, 12]) {
    const r = new RuleSet(); r.phasePeriod = P;
    const s1 = GameSession.create(15, BLACK, r);
    const rng = aiRng(77);
    let plies = 0;
    while (s1.status === "Playing" && plies < 400) {
      const a = aiChooseMove(s1, { level: "high", seed: (rng() * 4294967296) >>> 0 });
      if (a.kind !== "place") break;
      if (s1.place(a.x, a.y, a.z).status === MoveStatus.Rejected) break;
      plies++;
    }
    ok(plies > 20 || s1.status !== "Playing",
       "P=" + P + " 的自对局真的在下棋", "走了 " + plies + " 手，状态 " + s1.status +
       "，胜者 " + s1.winner);
  }
}

console.log(bad === 0 ? "\n全部通过" : "\n有 " + bad + " 项失败");
process.exit(bad === 0 ? 0 : 1);
