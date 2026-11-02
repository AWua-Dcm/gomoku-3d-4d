// 战术题集：防守强制胜（VCT）。方法论与基线见 知识库/验证/AI 战术题集.md。
//
// 题目怎么来：让 medium 档自对局走到中盘，取快照；如果"刚走完的那一方"（现在轮到你走）
// 的对手在**对手执子**时存在 VCT 强制胜，那这就是一道防守题：
//   你能不能找到一手，让对手再也算不出强制胜。
// 题目只收录"确实存在一手能拆掉"的局面（用同一套 aiVct 找到的），
// 并且防守方不能已经有一手成五（那种题太简单，测不出东西）。
//
// 判据的边界（照抄项目习惯，说清楚）：aiVct 返回非 null 才是"证明有胜"，
// 返回 null 可能只是"没算出来"。所以本脚本判"失败"是**硬**的（引擎被证明确实没防住），
// 判"通过"则依赖于同一套算杀的完备性 —— 它测的是"引擎自己的算杀能不能被自己防住"，
// 不是形式化证明。
//
// 用法：
//   node _verify/ai-tactics.mjs --gen --n 12 --out _verify/tactics.json
//   node _verify/ai-tactics.mjs --puzzles _verify/tactics.json --html Web_Gomoku3D/index.html
//   node _verify/ai-tactics.mjs --puzzles _verify/tactics.json --levels low,medium,high,xhigh,ultra

import fs from "node:fs";

function parseArgs(argv) {
  const o = { html: "Web_Gomoku3D/index.html", puzzles: "", out: "",
              levels: "low,medium,high,xhigh,ultra", n: 12, depth: 8, seed: 12345, gen: false, genGames:240 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--gen") { o.gen = true; continue; }
    const k = a.replace(/^--/, "");
    const v = argv[++i];
    if (k === "html") o.html = v;
    else if (k === "puzzles") o.puzzles = v;
    else if (k === "out") o.out = v;
    else if (k === "levels") o.levels = v;
    else if (k === "n") o.n = parseInt(v, 10);
    else if (k === "depth") o.depth = parseInt(v, 10);
    else if (k === "seed") o.seed = parseInt(v, 10);
    else if (k === "gen-games") o.genGames = parseInt(v, 10);
    else { console.error("未知参数 --" + k); process.exit(2); }
  }
  return o;
}

function loadCore(file) {
  const html = fs.readFileSync(file, "utf8");
  const s = html.indexOf("<script>"), e = html.lastIndexOf("</script>");
  const full = html.slice(s + 8, e);
  const B = "/* GOMOKU-CORE-BEGIN */", E = "/* GOMOKU-CORE-END */";
  const at = full.indexOf(B), bt = full.indexOf(E);
  if (at < 0 || bt < 0) throw new Error("找不到内核标记");
  const core = full.slice(at + B.length, bt);
  return new Function(core + `
    return { FourDSession, RuleSet, RuleEngine, MoveStatus, EMPTY, BLACK, WHITE,
             opponentOf, aiChooseMove, aiRng, aiCandidates, aiVct, aiVcfBudgetReset,
             AI_VCT_DEPTH, aiOrderTop, aiOutcomeAt, aiThreatAt, aiThreatValue, AI_W, cellOf,
             __setPhase: (p) => { aiPhase = p | 0; },
             __resetPoints: () => { aiPointsUsed = 0; } };`)();
}

function mkSession(C, n) {
  const rules = new C.RuleSet();
  rules.allowRotation = false;
  return C.FourDSession.create(n, C.BLACK, rules);
}

function snapshot(C, s, side) {
  const stones = [];
  s.board.forEachStone((x, y, z) => stones.push([x, y, z, s.board.get(x, y, z) & 3]));
  return { size: s.board.nx, side: side, stones: stones };
}

function loadPosition(C, p) {
  const s = mkSession(C, p.size);
  for (const [x, y, z, c] of p.stones) s.board.set(x, y, z, c);
  s.inner.currentPlayer = p.side;
  C.__setPhase(0);
  C.aiVcfBudgetReset();
  C.__resetPoints();
  return s;
}

function alreadyDecided(C, s, p) {
  for (const [x, y, z, c] of p.stones) {
    const o = C.RuleEngine.judge(s.board, { x: x, y: y, z: z }, c,
                                 s.firstPlayer, s.rules, C.cellOf(c, 0));
    if (o.status === C.MoveStatus.Win || o.status === C.MoveStatus.LoseByOverline) return true;
  }
  return false;
}

/** medium 自对局里的中盘快照。开局随机，保证不是同一盘棋重复。 */
function collectSnapshots(C, games, seed=9000) {
  const snaps = [];
  for (let g = 0; g < games; g++) {
    const s = mkSession(C, 15);
    const rng = C.aiRng(seed + g * 37);
    const open = 2 + ((rng() * 5) | 0);
    for (let j = 0; j < open && s.status === "Playing"; j++) {
      const cells = [];
      for (let z = 4; z < 11; z++) for (let y = 4; y < 11; y++) for (let x = 4; x < 11; x++) {
        if (s.board.isEmpty(x, y, z)) cells.push([x, y, z]);
      }
      const m = cells[(rng() * cells.length) | 0];
      s.place(m[0], m[1], m[2]);
    }
    let plies = open;
    while (s.status === "Playing" && plies < 40) {
      const a = C.aiChooseMove(s, { level: "medium", seed: (rng() * 4294967296) >>> 0 });
      if (a.kind !== "place") break;
      if (s.place(a.x, a.y, a.z).status === C.MoveStatus.Rejected) break;
      plies++;
      if (plies >= 10 && plies % 2 === 0) snaps.push({...snapshot(C, s, s.currentPlayer),sourceGame:g});
    }
  }
  return snaps;
}

/**
 * 防守方有没有一手能让攻方的 VCT 归零。
 * 只试按引擎自己的排序排在前 maxMoves 的应手 —— 题目因此偏向"引擎看得见的那一类"，
 * 但这是刻意的：题集要测的是"该防的防没防住"，不是"能不能想出冷门妙手"。
 */
function findDefense(C, s, p, maxMoves, depth) {
  const attacker = p.attacker, defender = p.defender;
  const cands = C.aiCandidates(s.board, 20000);
  if (cands.length === 0) return null;
  const aRes = s.rules.isRestricted(attacker, s.firstPlayer);
  const dRes = s.rules.isRestricted(defender, s.firstPlayer);
  const ordered = C.aiOrderTop(s.board, cands, defender, attacker,
                               s.rules.winLength, dRes, aRes);
  const k = Math.min(maxMoves, ordered.length);
  let tried = 0;
  for (let i = 0; i < k; i++) {
    const m = ordered[i];
    const om = C.aiOutcomeAt(s, m.x, m.y, m.z, defender, null);
    if (om && om.status === C.MoveStatus.Win) return { winNow: true };
    if (om && om.status === C.MoveStatus.LoseByOverline) continue;  // 自尽点不算"会先看的那手"
    s.board.set(m.x, m.y, m.z, C.cellOf(defender, 0));
    C.aiVcfBudgetReset(); C.__resetPoints();
    const r = C.aiVct(s, attacker, depth, null);
    s.board.set(m.x, m.y, m.z, C.EMPTY);
    if (!r) return { move: [m.x, m.y, m.z], rank: tried };
    tried++;
  }
  return null;
}

function gen(o) {
  const C = loadCore(o.html);
  const snaps = collectSnapshots(C, o.genGames, o.seed);
  console.log("快照 " + snaps.length + " 个，开始筛战术题……");
  const puzzles = [];
  for (const snap of snaps) {
    if (puzzles.length >= o.n) break;
    // 题目的攻方 = 轮到的那一方的对手（它刚刚走完，威胁已经摆在盘上）
    const defender = snap.side;
    const attacker = C.opponentOf(defender);
    const s = loadPosition(C, snap);
    if (alreadyDecided(C, s, snap)) continue;
    C.aiVcfBudgetReset(); C.__resetPoints();
    const win = C.aiVct(s, attacker, o.depth, null);
    if (!win) continue;
    // 【难度闸一】起手就成活四的题太便宜：任何一档都会在"对方能做活四"的点上堵。
    const aRes0 = s.rules.isRestricted(attacker, s.firstPlayer);
    const tw = C.aiThreatValue(C.aiThreatAt(s.board, win.x, win.y, win.z,
                                            C.cellOf(attacker, 0), s.rules.winLength, aRes0), aRes0);
    if (tw >= C.AI_W.OPEN_FOUR) continue;
    // 【难度闸二】只收"最像的两手都防不住、第三手往后才防得住"的题。
    // 排序前两名就是引擎默认会先看的那两手；它们都失败，说明这题要求看懂后续连招，
    // 而不是"把最像威胁的那一点占住"。低档在这类题上才会真的失手。
    const def = findDefense(C, s, { attacker: attacker, defender: defender }, 16, o.depth);
    if (!def || !def.move || !(def.rank >= 2)) continue;
    puzzles.push({ size: snap.size, side: defender, attacker: attacker, defender: defender,
                   sourceGame:snap.sourceGame,
                   stones: snap.stones, defense: def.move,
                   firstWin: [win.x, win.y, win.z] });
    console.log("  收入第 " + puzzles.length + " 题：攻方强制胜起手 " +
                JSON.stringify([win.x, win.y, win.z]) + "，已知拆解 " + JSON.stringify(def.move));
  }
  if (puzzles.length !== o.n) {
    console.error("只收到 "+puzzles.length+"/"+o.n+" 题，拒绝写不足量的题集；请增加 --gen-games。");
    process.exit(1);
  }
  const out = { depth: o.depth, seed:o.seed,genGames:o.genGames,n:o.n,note: "攻方执子时存在 VCT 强制胜；side 是轮到的一方（防守方）",
                puzzles: puzzles };
  if (o.out) fs.writeFileSync(o.out, JSON.stringify(out, null, 2), "utf8");
  console.log("共 " + puzzles.length + " 题" + (o.out ? "，写入 " + o.out : ""));
}

function test(o) {
  const C = loadCore(o.html);
  const data = JSON.parse(fs.readFileSync(o.puzzles, "utf8"));
  const depth = data.depth || o.depth;
  const levels = o.levels.split(",");
  for (const lv of levels) {
    let pass = 0;
    const fails = [];
    for (let i = 0; i < data.puzzles.length; i++) {
      const p = data.puzzles[i];
      const s = loadPosition(C, p);
      const act = C.aiChooseMove(s, { level: lv, seed: o.seed + i });
      if (act.kind !== "place") { fails.push({ i: i, why: act.kind }); continue; }
      const r = s.place(act.x, act.y, act.z);
      if (r.status === C.MoveStatus.Win) { pass++; continue; }
      if (r.status === C.MoveStatus.Rejected) { fails.push({ i: i, why: "rejected" }); continue; }
      C.aiVcfBudgetReset(); C.__resetPoints();
      const still = C.aiVct(s, p.attacker, depth, null);
      if (still) fails.push({ i: i, why: "攻方仍有强制胜", move: [act.x, act.y, act.z] });
      else pass++;
    }
    console.log(lv + "：防住 " + pass + "/" + data.puzzles.length +
                (fails.length ? "  失手 " + JSON.stringify(fails) : ""));
  }
}

const o = parseArgs(process.argv.slice(2));
if (o.gen) gen(o);
else if (o.puzzles) test(o);
else { console.error("要 --gen 或 --puzzles"); process.exit(2); }
