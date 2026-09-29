// 晨昏（相位）对「能不能分出胜负」的影响 —— 设计决策用的实测。
//
// 【问的是什么】相位规则要求一条五连的五颗子**同色且同相位**。而一个窗口里
// 先手只能落 ⌈P/2⌉ 子。所以核心问题是：**五连到底出得来吗？** 出不来这个机制就是死的
// （它会变成一个和棋机器），跟好不好玩无关。
//
// 【结果怎么读】这里的 AI 对相位是**天真**的：它当前的威胁评估已经按相位过滤
// （所以它在该堵的时候会堵、该赢的时候会赢），但它**不会为"我的线还有三手就活过来"
// 做计划**。所以任何胜局都是**悲观下界** —— 真下了计划会更多，不会更少。
//
// 用法：node _verify/phase-measure.mjs [局数] [档位] [盘面]
import fs from "node:fs";

const games = parseInt(process.argv[2] || "120", 10);
const level = process.argv[3] || "high";
const N = parseInt(process.argv[4] || "15", 10);
const PERIODS = [0, 10, 12, 16, 20];

const html = fs.readFileSync("Web_Gomoku3D/index.html", "utf8");
const s = html.indexOf("<script>"), e = html.lastIndexOf("</script>");
const full = html.slice(s + 8, e);
const B = "/* GOMOKU-CORE-BEGIN */", E = "/* GOMOKU-CORE-END */";
const core = full.slice(full.indexOf(B) + B.length, full.indexOf(E));
const C = new Function(core + `return {GameSession,RuleSet,RuleEngine,MoveStatus,EMPTY,BLACK,WHITE,
  aiChooseMove,aiRng};`)();
const { GameSession, RuleSet, RuleEngine, MoveStatus, EMPTY, BLACK, WHITE, aiChooseMove, aiRng } = C;

function playOne(P, seed, maxPlies) {
  const r = new RuleSet();
  r.phasePeriod = P;
  const s1 = GameSession.create(N, BLACK, r);
  const rng = aiRng(seed);
  const open = 2 + (seed % 7);
  const lo = Math.max(0, ((N / 2) | 0) - 3), hi = Math.min(N, ((N / 2) | 0) + 3);
  for (let j = 0; j < open && s1.status === "Playing"; j++) {
    const em = [];
    for (let z = lo; z < hi; z++) for (let y = lo; y < hi; y++) for (let x = lo; x < hi; x++) {
      if (s1.board.isEmpty(x, y, z)) em.push([x, y, z]);
    }
    if (em.length === 0) break;
    const m = em[(rng() * em.length) | 0];
    s1.place(m[0], m[1], m[2]);
  }
  let plies = 0, maxRun = 0;
  const scanMax = () => {
    const runs = RuleEngine.fullScan(s1.board, 1);
    for (const r2 of runs) if (r2.length > maxRun) maxRun = r2.length;
  };
  while (s1.status === "Playing" && plies < maxPlies) {
    const a = aiChooseMove(s1, { level, seed: (rng() * 4294967296) >>> 0 });
    if (a.kind !== "place") break;
    if (s1.place(a.x, a.y, a.z).status === MoveStatus.Rejected) break;
    plies++;
    if (plies % 4 === 0) scanMax();
  }
  scanMax();
  return { winner: s1.winner, plies, maxRun, full: s1.board.isFull };
}

console.log(`盘面 ${N}³，档位 ${level}，每个周期 ${games} 局，随机开局 2..8 手`);
console.log(`（"最长同值连线"= 盘上任意时刻出现过的、颜色与相位都相同的最长连续子数；五连 = 5）\n`);
console.log("周期P  先手胜  后手胜   和棋   和棋率   平均手数  最长同值连线(均值/最大)");
for (const P of PERIODS) {
  let black = 0, white = 0, draw = 0, plies = 0, runSum = 0, runMax = 0, fullCount = 0;
  for (let i = 0; i < games; i++) {
    const r = playOne(P, 9000 + i * 37, 500);
    plies += r.plies;
    runSum += r.maxRun;
    if (r.maxRun > runMax) runMax = r.maxRun;
    if (r.full) fullCount++;
    if (r.winner === BLACK) black++; else if (r.winner === WHITE) white++; else draw++;
  }
  const tag = P === 0 ? "  关" : String(P).padStart(4);
  console.log(`${tag}  ${String(black).padStart(5)}  ${String(white).padStart(5)}  ` +
              `${String(draw).padStart(5)}  ${(100 * draw / games).toFixed(1).padStart(5)}%  ` +
              `${(plies / games).toFixed(1).padStart(7)}  ` +
              `${(runSum / games).toFixed(2).padStart(6)} / ${String(runMax).padStart(2)}` +
              (fullCount ? `   盘满 ${fullCount}` : ""));
}
