import io

p = "Web_Gomoku3D/index.html"
s = io.open(p, encoding="utf-8").read()

# ---------- 7) aiPhase 模块级 + aiTag ----------
a = """const AI_POINT_BUDGET_MAX = 6000000;
let aiPointsUsed = 0;"""
b = """const AI_POINT_BUDGET_MAX = 6000000;
let aiPointsUsed = 0;

/**
 * v3.0.0「晨昏」：本次出招时盘上的相位。**由 aiChooseMove 在开头设好。**
 *
 * 【为什么是模块级变量而不是参数一路传】相位要穿透 aiOrderKey / aiThreatBest /
 * aiEvalLeaf / aiVcfThreats / aiVct 五层调用，每一层都加一个参数会让签名全线变长，
 * 而它们本来就已经有 6~8 个参数了。这和 AI_PT / aiSeenBits / aiPointsUsed 是同一类
 * "热循环里的隐式上下文"，且它**不参与决策时序**（一次 aiChooseMove 内恒定）。
 * 默认 0 = 相位关闭，此时 aiTag 是恒等函数，行为逐位不变。
 */
let aiPhase = 0;

/**
 * 某颜色在当前相位下的"落子值"。**aiThreatAt 的 player 参数要换成它。**
 *
 * 【为什么这样就够了】aiThreatAt 对 player 只做**相等比较**（"这一格是不是我的"），
 * 不做任何颜色语义。把带相位的值传进去，"颜色相同但相位不同"的两颗子自然不等 ——
 * "异相位的子打断连线"这条规则自动成立，函数体一个字都不用改。
 * 这也正是把相位编进格子值（而不是另开一张数组）换来的好处。
 */
function aiTag(colour) { return cellOf(colour, aiPhase); }"""
assert s.count(a) == 1, ("aiPhase", s.count(a))
s = s.replace(a, b)

# ---------- 8) 全部 aiThreatAt 调用点打标记 ----------
sites = [
 ("aiThreatValue(aiThreatAt(board, cands[i], cands[i + 1], cands[i + 2], player, winLength, restricted), restricted)",
  "aiThreatValue(aiThreatAt(board, cands[i], cands[i + 1], cands[i + 2], aiTag(player), winLength, restricted), restricted)"),
 ("const mine = aiThreatValue(aiThreatAt(board, x, y, z, mover, winLength, moverRes), moverRes);",
  "const mine = aiThreatValue(aiThreatAt(board, x, y, z, aiTag(mover), winLength, moverRes), moverRes);"),
 ("return mine + AI_ORDER_W * aiThreatValue(aiThreatAt(board, x, y, z, foe, winLength, foeRes), foeRes);",
  "return mine + AI_ORDER_W * aiThreatValue(aiThreatAt(board, x, y, z, aiTag(foe), winLength, foeRes), foeRes);"),
 ("const t = aiThreatAt(board, x, y, z, attacker, wl, res);",
  "const t = aiThreatAt(board, x, y, z, aiTag(attacker), wl, res);"),
 ("const t = aiThreatAt(board, x, y, z, attacker, rules.winLength, attRes);",
  "const t = aiThreatAt(board, x, y, z, aiTag(attacker), rules.winLength, attRes);"),
 ("const theirsT = aiThreatAt(board, x, y, z, foe, winLength, foeRes);",
  "const theirsT = aiThreatAt(board, x, y, z, aiTag(foe), winLength, foeRes);"),
 ("mover, winLength, myRes), myRes));",
  "mover, winLength, myRes), myRes));"),
]
for a2, b2 in sites:
    n = s.count(a2)
    assert n >= 1, (a2[:44], n)
    s = s.replace(a2, b2)
    print("  x%d  %s" % (n, a2[:44]))

# 6152 那条跨两行，单独处理
a3 = """      const placeTier = aiTier(aiThreatValue(aiThreatAt(board, move.x, move.y, move.z,
                                                        mover, winLength, myRes), myRes));"""
b3 = """      const placeTier = aiTier(aiThreatValue(aiThreatAt(board, move.x, move.y, move.z,
                                                        aiTag(mover), winLength, myRes), myRes));"""
assert s.count(a3) == 1, ("placeTier", s.count(a3))
s = s.replace(a3, b3)

# ---------- 9) aiOutcomeAt 落子带相位 ----------
a = """  b.set(x, y, z, player);
  AI_PT.x = x; AI_PT.y = y; AI_PT.z = z;
  const o = RuleEngine.judge(b, AI_PT, player, session.firstPlayer, session.rules);"""
b = """  const v = cellOf(player, session.phase | 0);
  b.set(x, y, z, v);
  AI_PT.x = x; AI_PT.y = y; AI_PT.z = z;
  const o = RuleEngine.judge(b, AI_PT, player, session.firstPlayer, session.rules, v);"""
assert s.count(a) == 1, ("aiOutcomeAt", s.count(a))
s = s.replace(a, b)

# ---------- 10) aiChooseMove 开头设 aiPhase ----------
a = """  aiPointsUsed = 0;                   // 单手扫过多少候选点，见 AI_POINT_BUDGET_MAX"""
b = """  aiPointsUsed = 0;                   // 单手扫过多少候选点，见 AI_POINT_BUDGET_MAX
  aiPhase = session.phase | 0;        // v3.0.0「晨昏」：本次出招的相位，见 aiPhase"""
assert s.count(a) == 1, ("aiChooseMove", s.count(a))
s = s.replace(a, b)

io.open(p, "w", encoding="utf-8", newline="").write(s)
print("AI 层改完")
