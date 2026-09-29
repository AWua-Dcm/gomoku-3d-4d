import io

p = "Web_Gomoku3D/index.html"
s = io.open(p, encoding="utf-8").read()

# ---------- 1) RuleSet：相位周期 ----------
a = """       【默认关】关掉时下面所有环绕分支都不走，现有行为逐位不变。 */
    this.wrapEdges = false;
  }"""
b = """       【默认关】关掉时下面所有环绕分支都不走，现有行为逐位不变。 */
    this.wrapEdges = false;

    /* v3.0.0「晨昏」的相位周期。0 = 关闭（默认）。
       一个相位持续 P 次落子，之后自动翻转。转动/回溯都不推进它 —— 只有落子算时间。
       【为什么下限是 10 而不是随便定】一个窗口里先手落 ⌈P/2⌉ 子、后手 ⌊P/2⌋ 子；
       要凑出"连续 5 颗同色同相位"，先手至少得在同一个窗口内落满 5 子 → P ≥ 9，
       后手要 P ≥ 10。P ≤ 8 时凑不出五连，唯一的路是让一条线熬过整个对相位窗口，
       而对手落一子就能永久打断它 → 那种档位会变成和棋机器。 */
    this.phasePeriod = 0;
  }"""
assert s.count(a) == 1, ("ruleset", s.count(a))
s = s.replace(a, b)

a = "    r.wrapEdges = this.wrapEdges;\n    return r;"
b = "    r.wrapEdges = this.wrapEdges;\n    r.phasePeriod = this.phasePeriod;\n    return r;"
assert s.count(a) == 1, ("clone", s.count(a))
s = s.replace(a, b)

# ---------- 2) countRun：参数改名成 match（比的是"完整的值"） ----------
a = """  countRun(board, c, d, player) {
    const nx = board.nx, ny = board.ny, nz = board.nz;"""
b = """  /**
   * 从 c 出发沿 d 方向，连续与 `match` 相等的格子个数（不含 c 本身）。
   *
   * 【参数叫 match 而不是 player】比的是**完整的格子值**，不是颜色。
   * 晨昏模式下值里编了相位，所以"颜色相同但相位不同"的两颗子天然不相等 ——
   * "异相位的子打断连线"这条规则就是这么落成代码的，不需要额外分支。
   */
  countRun(board, c, d, match) {
    const nx = board.nx, ny = board.ny, nz = board.nz;"""
assert s.count(a) == 1, ("countRun sig", s.count(a))
s = s.replace(a, b)
s = s.replace("        if (board.cells[x + nx * (y + ny * z)] !== player) break;",
              "        if (board.cells[x + nx * (y + ny * z)] !== match) break;")
s = s.replace("    while (board.getOrDefault(x, y, z) === player) {",
              "    while (board.getOrDefault(x, y, z) === match) {")

# ---------- 3) judge：多收一个 matchValue ----------
a = """  judge(board, c, player, firstPlayer, rules) {
    const restricted = rules.isRestricted(player, firstPlayer);"""
b = """  judge(board, c, player, firstPlayer, rules, matchValue) {
    // 【player 和 matchValue 必须分开】player 是**颜色身份**（isRestricted 要用它），
    // matchValue 是**要匹配的格子值**（晨昏模式下它带着相位）。两者只在关掉相位时相等。
    // 拿带相位的值去问 isRestricted，受限身份会判错 —— 而那个错只在"先手 + 相位 1"时出现。
    const mv = matchValue === undefined ? player : matchValue;
    const restricted = rules.isRestricted(player, firstPlayer);"""
assert s.count(a) == 1, ("judge sig", s.count(a))
s = s.replace(a, b)

a = """      const neg = RuleEngine.countRun(board, c, [-d[0], -d[1], -d[2]], player);
      const pos = RuleEngine.countRun(board, c, d, player);"""
b = """      const neg = RuleEngine.countRun(board, c, [-d[0], -d[1], -d[2]], mv);
      const pos = RuleEngine.countRun(board, c, d, mv);"""
assert s.count(a) == 1, ("judge runs", s.count(a))
s = s.replace(a, b)

io.open(p, "w", encoding="utf-8", newline="").write(s)
print("规则层改完（RuleSet / countRun / judge）")
