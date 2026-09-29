import io

p = "Web_Gomoku3D/index.html"
s = io.open(p, encoding="utf-8").read()

# ---------- 4) GameSession：相位状态 ----------
a = """    this.board = new Board3D(...normalizeDims(dims));
    this.rules = rules.clone();
    // 【和 reset 里那一行必须成对】棋盘自己不知道规则，wrap 是会话同步过去的几何事实。"""
b = """    this.board = new Board3D(...normalizeDims(dims));
    this.rules = rules.clone();
    /** v3.0.0「晨昏」：当前相位（0 黎明 / 1 永夜）与本相位已落的子数。 */
    this.phase = 0;
    this.placementsInPhase = 0;
    // 【和 reset 里那一行必须成对】棋盘自己不知道规则，wrap 是会话同步过去的几何事实。"""
assert s.count(a) == 1, ("ctor", s.count(a))
s = s.replace(a, b)

a = """    this.board = new Board3D(d[0], d[1], d[2]);
    this.rules = rules.clone();"""
b = """    this.board = new Board3D(d[0], d[1], d[2]);
    this.rules = rules.clone();
    this.phase = 0;
    this.placementsInPhase = 0;"""
assert s.count(a) == 1, ("reset", s.count(a))
s = s.replace(a, b)

# ---------- 5) place：打相位标记 + 推进 ----------
a = """    const player = this.currentPlayer;
    this.board.set(x, y, z, player);
    let outcome = RuleEngine.judge(this.board, { x: x, y: y, z: z }, player, this.firstPlayer, this.rules);"""
b = """    const player = this.currentPlayer;
    // 【落子的值是带相位的】关掉相位时 cellOf(player,0) === player，逐位不变。
    const v = cellOf(player, this.phase);
    this.board.set(x, y, z, v);
    let outcome = RuleEngine.judge(this.board, { x: x, y: y, z: z }, player, this.firstPlayer,
                                   this.rules, v);"""
assert s.count(a) == 1, ("place", s.count(a))
s = s.replace(a, b)

a = """    } else {
      this.currentPlayer = opponentOf(player);
    }

    for (const fn of this.onMoveApplied) fn(this, record, outcome);
    return outcome;
  }"""
b = """    } else {
      this.currentPlayer = opponentOf(player);
      this._advancePhase();
    }

    for (const fn of this.onMoveApplied) fn(this, record, outcome);
    return outcome;
  }

  /**
   * 推进相位。**这是「连成不算数、对上相位才算」的落点。**
   *
   * 计数只由落子驱动 —— 转动、回溯都不推进它（和"冷却只数落子"同一条理由：
   * 只有落子才算时间）。
   *
   * 翻转之后要**立刻整盘清算一次**：新相位下已经存在的线要当场结算。
   * 注意这**不是**某一手的 judge —— 是"时间自己走出来的终局"，所以要单独一条路径。
   * 没有它的话，"我连成了、就等相位对上"这件事永远不会发生，晨昏就只剩个名字。
   */
  _advancePhase() {
    const P = this.rules.phasePeriod | 0;
    if (P <= 0) return;
    if (++this.placementsInPhase < P) return;
    this.placementsInPhase = 0;
    this.phase = 1 - this.phase;

    const runs = RuleEngine.fullScan(this.board, this.rules.winLength);
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i];
      if (phaseOf(r.player) !== this.phase) continue;      // 不是当前相位 → 不结算
      const colour = colourOf(r.player);
      const fouled = this.rules.isRestricted(colour, this.firstPlayer) &&
                     r.length > this.rules.winLength;
      this.winner = fouled ? opponentOf(colour) : colour;
      this.status = "Decided";
      this.lastOutcome = { status: fouled ? MoveStatus.LoseByOverline : MoveStatus.Win,
                           winner: this.winner, longestRun: r.length,
                           line: RuleEngine.lineCoords(r), isOverlineFoul: fouled };
      return;
    }
  }"""
assert s.count(a) == 1, ("advance call", s.count(a))
s = s.replace(a, b)

# ---------- 6) FourDSession 转发相位 ----------
a = """  get rotationEnabled() { return this.inner.rules.allowRotation; }"""
b = """  get rotationEnabled() { return this.inner.rules.allowRotation; }
  /** v3.0.0「晨昏」的相位。三维模式下恒为 0。 */
  get phase() { return this.inner.phase | 0; }"""
assert s.count(a) == 1, ("4d forward", s.count(a))
s = s.replace(a, b)

io.open(p, "w", encoding="utf-8", newline="").write(s)
print("会话层改完")
