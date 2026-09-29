// 拓扑（贯通）对「先手优势」的影响 —— 设计决策用的实测，不是断言。
//
// 【问的是什么】棋盘边缘在五子棋里是有战略含义的：贴着边做单侧威胁，一条边等于半道
// 免费的墙。环面上没有免费的墙，所有威胁两头都开着。设计上的担心是：**去掉边缘会让
// 先手优势大到需要再加限制**。
//
// 【怎么量】同一套 AI、同一批随机开局，只切 wrapEdges 开关，数**先手（黑）的胜率**。
// 两边的 AI 完全相同，所以任何系统性差异只能来自规则本身。
// 随机开局是为了让对局有变化（AI 是确定性的，空盘开局会每局一模一样）。
//
// 用法：node _verify/topology-measure.mjs [局数] [档位] [盘面]
import fs from "node:fs";

const games = parseInt(process.argv[2] || "200", 10);
const level = process.argv[3] || "high";
const N = parseInt(process.argv[4] || "15", 10);

const html = fs.readFileSync("Web_Gomoku3D/index.html", "utf8");
const s = html.indexOf("<script>"), e = html.lastIndexOf("</script>");
const full = html.slice(s + 8, e);
const B = "/* GOMOKU-CORE-BEGIN */", E = "/* GOMOKU-CORE-END */";
const core = full.slice(full.indexOf(B) + B.length, full.indexOf(E));
const C = new Function(core + `return {GameSession,RuleSet,MoveStatus,EMPTY,BLACK,WHITE,
  aiChooseMove,aiRng};`)();
const { GameSession, RuleSet, MoveStatus, EMPTY, BLACK, WHITE, aiChooseMove, aiRng } = C;

function playOne(wrap, seed, maxPlies) {
  const r = new RuleSet();
  r.wrapEdges = wrap;
  const s1 = GameSession.create(N, BLACK, r);
  const rng = aiRng(seed);
  // 随机开局：2..8 手，落在中心附近
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
  let plies = 0;
  while (s1.status === "Playing" && plies < maxPlies) {
    const a = aiChooseMove(s1, { level, seed: (rng() * 4294967296) >>> 0 });
    if (a.kind !== "place") break;
    if (s1.place(a.x, a.y, a.z).status === MoveStatus.Rejected) break;
    plies++;
  }
  return { winner: s1.winner, plies, full: s1.board.isFull };
}

function run(wrap) {
  let black = 0, white = 0, draw = 0, plies = 0, full = 0;
  for (let i = 0; i < games; i++) {
    const r = playOne(wrap, 9000 + i * 37, 400);
    plies += r.plies;
    if (r.full) full++;
    if (r.winner === BLACK) black++; else if (r.winner === WHITE) white++; else draw++;
  }
  return { black, white, draw, avgPlies: plies / games, full };
}

console.log(`盘面 ${N}³，档位 ${level}，每侧 ${games} 局，随机开局 2..8 手\n`);
const off = run(false);
const on = run(true);

function line(tag, r) {
  const decided = r.black + r.white;
  const pct = decided ? (100 * r.black / decided).toFixed(1) : "—";
  console.log(`${tag}：先手胜 ${r.black} / 后手胜 ${r.white} / 和 ${r.draw}` +
              `  → 先手胜率 ${pct}%（已分胜负的局）  平均 ${r.avgPlies.toFixed(1)} 手` +
              (r.full ? `  盘满 ${r.full}` : ""));
}
line("不环绕", off);
line("环绕  ", on);

const dOff = off.black + off.white, dOn = on.black + on.white;
const pOff = dOff ? off.black / dOff : 0, pOn = dOn ? on.black / dOn : 0;
console.log("");
console.log(`先手胜率变化：${(100 * pOff).toFixed(1)}% → ${(100 * pOn).toFixed(1)}%` +
            `（${pOn >= pOff ? "+" : ""}${(100 * (pOn - pOff)).toFixed(1)} 个百分点）`);
console.log(`和棋率：${(100 * off.draw / games).toFixed(1)}% → ${(100 * on.draw / games).toFixed(1)}%`);
