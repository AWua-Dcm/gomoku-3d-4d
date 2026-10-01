# 3D Gomoku · Rules

Gomoku (five in a row) played on a solid N×N×N board: **whoever first lines up five stones of one color along a single straight line wins**.

The big difference from flat Gomoku is that there are far more straight lines — **13 directions** in all.
So blocking the front is not enough: a line can cut through diagonally, run straight up, or pass through several layers.

There is no gravity on the board. **Stones can float** with nothing under them, and any empty cell is playable.

---

## 1. The board

| Item | Rule |
|---|---|
| Shape | A cubic board, N × N × N playable cells |
| Size | 8 ≤ N ≤ 30, default 15 |
| Coordinates | `(x, y, z)`, each axis numbered 0 to N−1 |
| Layer | All cells with the same `z` form one layer; "layer k" means the layer at `z = k` |
| Cell state | empty / black stone / white stone |

The directions of the three axes:

- `x`: increases to the right
- `y`: increases upward
- `z`: increases into the screen

So from the default viewpoint **layer 0 is closest to you and the least likely to be hidden behind other layers**, and a new game starts there.

In 3D mode the three axes need not be the same length (an 8×12×30 rectangular board, for example):
turn off "Link all three axes" to set them separately.

## 2. Placing a stone

- You may play on **any empty cell**. There is no gravity and no rule that something must support the stone — it can hang in mid-air.
- One stone per turn, and the turn passes to the opponent at once.
- A stone cannot be taken back on its own, but you can undo.

## 3. Who moves first

- Before the game you choose "Black first" or "White first", and that choice **does not change for the rest of the game**.
- **"First player" means whoever makes the opening move of this game**, not black in particular.
- To change it mid-game, "Swap first player" **restarts the game** with the new first player — it does not flip the sides of the game in progress.

## 4. Winning directions: 13 of them

Every cell takes part in at most 13 lines at once:

| Kind | Count | Directions |
|---|---|---|
| Axes | 3 | one along each of x / y / z |
| Face diagonals | 6 | the diagonals within each coordinate plane (`(1,1,0)`, `(1,-1,0)` and the like) |
| Body diagonals | 4 | diagonals crossing all three axes (`(±1,±1,±1)`) |

3 axes + 6 face diagonals + 4 body diagonals = 13.

The check looks only at the 13 lines through **the stone just played**, and it counts **both ways along each of them**:
a whole line's length = 1 + the run of same-colored stones on one side + the run on the other side.
Counting one side only would miss the case where a single move joins two separate runs into one.

## 5. Winning and losing

### 5.1 Second player: five or more wins

If any line through the stone just played holds five or more stones of one color, that player wins immediately.

### 5.2 First player: exactly five in a row

The first player **loses by making the line too long**:

- **Exactly five** on any line → wins.
- **Six or more** on any line (an overline) → **loses immediately**, and the opponent wins.

**The overline loss follows the "first player" role, whoever holds it**: choose black first and black carries it, choose white first and white carries it — in which case black is free (five or more wins).

### 5.3 One move making both five and six

On a solid board it is common for one move to land on two lines at once. In that case **the overline wins out**: it is an overline loss.

### 5.4 A useful consequence

When the first player builds a line one stone at a time, **reaching the fifth stone already wins and the game ends on the spot**,
so the sixth stone is never reached. Therefore:

> An overline can only come from a move that joins two runs together — with `0,1,2` and `4,5`
> already on the board, playing `3` joins them into six. You cannot reach an overline by placing stones one at a time.

## 6. Undo

- You can undo all the way back to before the game started.
- Undoing clears the win/loss state too: the game returns to "in progress" and it is the turn of the player whose move was taken back.
- Shortcut `Z`, or the "Undo Z" button on the panel.

## 7. Draw

The board fills up with no winner → a draw.
15×15×15 has 3375 cells, so this almost never happens in practice, but the rules allow for it.

## 8. Why the first player is restricted

A solid board has far more lines than a flat one. On a 15×15×15 board there are **23639** lines of length exactly 5,
which is **41 times** as many as on a flat board of the same side length. With that many directions, "one move making two
threats at once, so the opponent can block only one" is far easier than in the flat game — and if both sides played by
identical rules, the first player's advantage would be too large for the second player to have a game at all.

So the first player carries the "exactly five in a row" restriction. This is the most fundamental difference between this
game and flat Gomoku.

## 9. The right panel: looking at one layer

The right panel draws **layer k as seen from the front**:

- `x` runs across, increasing to the right
- `y` runs up, increasing upward
- The layer number `z` is depth, changed with `＜` `＞` or by clicking the layer strip below

The panel is oriented exactly like the 3D view, so nothing has to be rotated in your head — the two always show the same layer.

## 10. 4D mode: three extra mechanics

4D is the 3D rules untouched, **plus three mechanics**. Pick "4D · Myriad" before the game and all three are on:

- **Rubik rotation**: rotate one layer 90° like a Rubik cube; the stones already on that layer are carried along.
- **Space wrapping**: the six faces of the board are connected, so a five may cross an edge.
- **Day and night**: the board alternates between two phases, and only lines of the current phase count.

"4D" refers to time — the board itself changes, while the coordinates are still three axes and the total number of cells is
still N×N×N.

**The first two can also be turned on individually in 3D.** In 3D mode, two checkboxes sit under the board-size row —
"Rubik rotation" and "Space wrapping" — both empty by default. Each one you tick adds that mechanic to the 3D game;
ticking both is 4D without day and night. **Day and night exists only in 4D.**

Ticking "Rubik rotation" locks the board to a cube (rotating a layer requires that layer's two sides to be equal, and a
cuboid cannot rotate at all), and the "Link all three axes" key is then disabled — the same reason and the same treatment
as in 4D.

The mode is chosen before the game and **cannot be changed during it**. In 3D with neither box ticked, none of this section
applies, and sections 1 through 9 are unaffected by it.

### 10.1 Rubik rotation: how to rotate

| Parameter | Values |
|---|---|
| Axis | x / y / z |
| Layer | which layer (0 to N−1) |
| Direction | clockwise / counterclockwise |
| Turns | 1 / 2 / 3 quarter-turns, that is 90° / 180° / 270° |

**"Clockwise" is seen from the negative end of that axis, looking towards the origin.**
For the `z` axis that is the direction you see on screen, with no conversion needed;
for `x` and `y` the viewpoint is to the left of and below the board respectively.

One counterclockwise turn equals three clockwise turns. Four turns are no turn at all, so that option is **not offered**.

**Rotating takes two steps: "Rotate" shows you the result, "Confirm" makes it count.**
After you press Rotate the board **turns immediately so you can see it**, but the move has not landed: it does not use up
the turn, does not count as a move, and is not written into the record. The Confirm and Cancel keys are **always on the
panel** — normally greyed out and inert; now they light up with a ring around them, reminding you that a decision is
pending: Confirm really turns it, Cancel turns the board back exactly as it was, as if nothing had happened.
You cannot place a stone during the preview — the board is showing the rotated position, so clicking on it would land in the
wrong cell.

### 10.2 Rubik rotation: what a rotation does

Only the cells of the rotated layer move; everything outside it stays put.
Every cell in that layer has exactly one destination, so two stones never collide, and **the total number of stones never changes**.

### 10.3 Rubik rotation: which rotations are rejected

The checks run in order; if any one of them fails, the whole thing is dropped: the board does not move, it does not count as a
move, and no record is kept.

| Check | When it fails |
|---|---|
| The game must be in 4D mode, or in 3D with "Rubik rotation" ticked | rejected |
| The game must still be in progress | rejected |
| The layer number must exist | rejected |
| The cooldown must be ready | rejected |
| The rotated board must be **different** from before | "nothing changed"; not counted as a move |
| The rotated board must **not make five in a row for the opponent** | the whole thing is rolled back |

"Must be different" looks at **what the board looks like**, not at how many turns you asked for: a layer that was already
empty, or a pattern that happens to rotate back onto itself, both count as "nothing changed". The interface tells you which
of the two it was, because otherwise the button just looks broken.

The last check only stops **the opponent's** lines. A rotation **may make five for you** — that is a win, exactly like
making five by placing, and the game ends there and then. If the rotation hands the **opponent** five in a row (you swung
their stones into place), it is still rolled back: gifting the opponent a five is not what that move meant.

So **a rotation can be an attack**: it breaks up the opponent's lines, rearranges your own stones, or swings the last
stone you need into place to win.

### 10.4 Space wrapping: the six faces are joined

**The six faces of the board are connected**: walk off one edge and you come back in on the opposite one.
This holds for all three axes.

There is a cheaper way to picture it: **think of 3×3×3, that is 27 identical boards stacked together**. You only play on the
middle one, and every move is stamped onto the other 26 as well. Those 26 are not drawn — so "two stones on the right plus
three on the left" really is one run of five in the stacked space.

- You place stones the same way: **a stone has exactly one position** — where you put it is where it is.
- But so that you can **see** it, the ring of cells hugging the outside of the board draws **shadows**: every stone on the
  boundary has its own image one cell outside the board. A line leaving the right edge shows its continuation one cell past
  it — a five across the seam no longer has to be imagined. Shadows are smaller and fainter; they are **not stones**: only
  real stones count, and you cannot play on a shadow.
- **A full ring of one colour (N stones) is an overline too.** Wrapping makes lines longer, so check the far side before
  completing a five; the overline rule itself is unchanged — the first player still loses with 6 or more in a row.
- It does not interfere with Rubik rotation: one is "how a layer permutes its own cells", the other is "what happens past an
  edge"; both can be on at once and each minds its own business.

### 10.5 Day and night: only the current phase counts

The board alternates between two phases: **day** and **night**. Each stone remembers the phase it was placed in.

- **Only lines of the current phase are settled.** A night five that exists during the day is there, but does not count;
  the moment the phase turns to night and it is still there, it settles at once.
- **Stones of the other phase still occupy their cell and break lines** (they are solid, not empty).
- Every stone on the board wears a thin **halo** whose colour is its phase: **pale red is day, pale blue is night**. Stones
  of both phases are drawn equally clearly (no more fading by opacity), so you can see at a glance which stones belong to
  which side. The layer thumbnails on the right use a small square of the same colour (where the cell is too small to fit a
  halo, none is drawn rather than falling back to a different encoding).
- The phase turns every 12 moves (changeable on the start screen, 10 to 30).

A move may declare:

| Declaration | Effect |
|---|---|
| normal | the clock advances one step |
| hold | the clock does not advance; one step is borrowed from the next phase |
| hasten | the clock advances two steps, repaying one borrowed step |

**You can only shift time, never create it**: a full cycle is always 2 × the period, and what you borrow is deducted from the
next phase. No phase may be shorter than 2 moves, and borrowing and repaying are both capped.

### 10.6 Rotation cooldown

> Between two rotations you must **place** at least 5 stones.

- **Only placements count**; a rotation itself does not — otherwise it becomes "only one turn in five may be a rotation", which is too hard to keep track of.
- It can be set to 3 / 5 / 8 / 10, default 5.
- The first rotation is subject to it too: you must place 5 stones after the game starts before you can rotate.
- **The cooldown only starts once you press Confirm** — the preview has not landed, so it must not consume cooldown.
- Undo rolls the cooldown back as well, so the counter and the board never disagree.

### 10.7 What a rotation costs

A rotation **uses up the whole turn**: the opponent moves immediately afterward, and you cannot "rotate and then place".
Every turn is therefore "place or rotate, one or the other".

A rotation does not count as move number N; the Nth move always means the Nth placement (the interface reports rotations separately).

### 10.8 Undoing a rotation

| Action | Effect |
|---|---|
| Undo `Z` | Takes back the last step — a rotation or a placement — and can go back to before the game started |
| Restore rotation `Y` | Available only when the last move was exactly a rotation. **Keyboard only — there is no such button on the panel** (that slot belongs to Confirm / Cancel); with a mouse or on a touch screen use Undo, which takes back that rotation when it is the last move |

Once someone places a stone, that rotation has landed and can no longer be taken back on its own — otherwise it would become a
time machine spanning many moves.

> **To take back a landed rotation, use Undo** (`Z`, or the button). The panel used to have a
> dedicated "Restore rotation" key; that slot now belongs to Confirm and Cancel, and the capability
> itself is not gone — when the last move was exactly a rotation, Undo takes back that rotation.

Undoing also returns the cooldown to what it was before the rotation.

### 10.9 Sizes

| Mode | Sizes | Default |
|---|---|---|
| 3D | 8 ≤ N ≤ 30, the three axes may differ | 15 |
| 4D | 8 ≤ N ≤ 30, **must be cubic** | 8 |

4D having to be cubic is not laziness: rotating a layer requires that layer's two sides to be equal, and all three axes must
be rotatable, so all three must be the same length. The same applies in 3D once "Rubik rotation" is ticked.

4D defaults to 8 rather than 15 because **the bigger the board, the fewer stones a layer holds, and the less a rotation shows** —
on a 15×15×15 board a layer holds less than one stone on average, and most rotations hit the "nothing changed" case.

### 10.10 Tutorial

A **Tutorial** button appears next to Start once 4D is selected, or when a 3D game has
Rubik rotation / Space wrapping ticked. Each level is a prepared position with a goal:
in 4D the three levels cover rotation, wrapping and day / night, while in 3D it only
teaches what you ticked (with neither ticked, the button does not appear). There is no
computer opponent in the tutorial; clearing a level moves you on to the next one after a
short pause, and the Previous / Next buttons in the corner let you move back and forth as
well. The last level simply waits there once cleared — the row's Setup button (it reads
**Exit** inside the tutorial) takes you back to the start screen.

## 11. Playing the computer

- **The start screen has an "Opponent" row**: Human (two players, one device), or five computer
  strengths **Low / Mid / High / Very high / Ultra**. **They differ in how far they look ahead,
  whether they prove forced wins, and how they decide whether to rotate in 4D**: Low sees one move;
  Mid one reply; High three plies; Very high five. Ultra is five as well, but deepens further when it
  can afford to (iterative deepening).
  Ultra also runs a **kill search** — forced-win sequences: runs of fours (where each of your replies
  is forced to a single square), and runs of open threes. The latter is far harder, because an open
  three leaves you more than one defence: it works through **every reply that either blocks it or
  makes a four of your own**, and if it cannot get through them all it says "unknown" rather than
  claim a win that does not hold.
  In 4D, Very high and Ultra also **value a rotation with the same search they use for a move** —
  whether a rotation is worth a whole turn is decided on the same scale as placing a stone; Low, Mid
  and High keep the cheaper tier heuristics.
  **In 4D every tier looks one or two plies deeper** — a rotation can move a whole formation, and at
  3D depth the computer cannot see that its own last move has just been slid away. So High and above walk away from positions where your next
  move would make an open four, while Low happily walks into them. All five stay deliberately on
  the weak side — an "easy" opponent that beats beginners every time is the usual failure of this
  feature.
- **Ultra will beat you before you see the danger.** That is the kill search, not luck: it can set
  a trap in the opening that only pays off a dozen moves later.
- **Two choices, two different jobs.** "First player" picks the **colour** that goes first (which is
  also the colour that carries the overline loss); "Who starts" picks **which of the two** plays that
  colour. So "Black first + Computer" means the computer plays Black and opens, and you play White.
  The summary line at the bottom of the settings spells out which colour you are.
- **The computer is bound by the overline rule too** — it avoids the cells that would give it six in a
  row and lose. It still misses open threes and does not see double threats; that is deliberate,
  not a bug.
- **Undo takes back your move and the computer's reply together.** "Restore this rotation" is not
  available against the computer — use Undo instead.
- **In 4D the computer rotates layers, but only when it is worth a move.** It never rotates just to see
  what happens: it does so only when the rotation would genuinely break up an opponent's **open three or
  worse**, or when it lifts its own shape a whole tier. A rotation that would leave the opponent an open
  three is one it rejects itself. The old rule — "rotate if the best move available to me in the affected
  band went up" — rotated three times a game, one turn in three, and only a third of those actually
  lowered the threat. The easy tier still only considers it about once in ten turns. A rotation can never
  win the game; it only breaks up formations and slides your own stones around.

## 12. What this game does not do

- **No double-three or double-four restrictions.** In traditional Renju (Gomoku's competitive form) the first player is also
  barred from "one move making two open threes / two fours" and the like; this game implements the overline loss only. The
  penalty falls after the move — there is no cell you are forbidden to play.
- **The computer opponent is not an engine.** Its threat counting uses a sliding window, so **it does
  recognise gapped shapes and double threats**; but it has no opening book, no joseki and no quiescence
  search.
  Good enough as a sparring partner; for a serious game, use a dedicated engine.
- **Rotations are not animated**; they land instantly, with only a brief highlight on the rotated layer.
- **Rotations can only be made with the panel buttons**, not by dragging in the 3D view.
