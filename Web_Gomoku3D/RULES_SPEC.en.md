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
| Size | 8 ≤ N ≤ 50, default 15 |
| Coordinates | `(x, y, z)`, each axis numbered 0 to N−1 |
| Layer | All cells with the same `z` form one layer; "layer k" means the layer at `z = k` |
| Cell state | empty / black stone / white stone |

The directions of the three axes:

- `x`: increases to the right
- `y`: increases upward
- `z`: increases into the screen

So from the default viewpoint **layer 0 is closest to you and the hardest to block**, and a new game starts there.

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

## 10. 4D mode: you can rotate a layer

This is an optional way to play; turn it on before the game with "4D · Rotatable": **rotate one layer 90° like a Rubik's cube**,
and the stones already on that layer are carried along. "4D" refers to time — the board itself changes, while the coordinates
are still three axes and the total number of cells is still N×N×N.

The mode is chosen before the game and **cannot be changed during it**. If you did not pick it, none of this section applies,
and sections 1 through 9 are unaffected by it.

### 10.1 How to rotate

| Parameter | Values |
|---|---|
| Axis | x / y / z |
| Layer | which layer (0 to N−1) |
| Direction | clockwise / counterclockwise |
| Turns | 1 / 2 / 3, that is 90° / 180° / 270° |

**"Clockwise" is viewed from the negative end of that axis, looking toward the origin.**
For the `z` axis that is the direction you see on screen, with no conversion needed;
the `x` and `y` axes are viewed from the left of the board and from below it.

One counterclockwise turn equals three clockwise turns. Four turns equal no turn, so **that option is not offered**.

### 10.2 What a rotation does

Only the cells of the rotated layer move; everything outside it stays put.
Every cell in that layer has exactly one destination, so two stones never collide, and **the total number of stones never changes**.

### 10.3 Which rotations are rejected

The checks run in order; if any one of them fails, the whole thing is dropped: the board does not move, it does not count as a
move, and no record is kept.

| Check | When it fails |
|---|---|
| The game must be in 4D mode | rejected |
| The game must still be in progress | rejected |
| The layer number must exist | rejected |
| The cooldown must be ready | rejected |
| The rotated board must be **different** from before | "nothing changed"; not counted as a move |
| The rotated board must **not contain five in a row** | the whole thing is rolled back |

"Must be different" looks at **what the board looks like**, not at how many turns you asked for: a layer that was already
empty, or a pattern that happens to rotate back onto itself, both count as "nothing changed". The interface tells you which
of the two it was, because otherwise the button just looks broken.

The last check means **a rotation can never win the game**: it cannot be used as an attack, only to break up an opponent's
line or to rearrange your own stones.

### 10.4 Rotation cooldown

> Between two rotations you must **place** at least 5 stones.

- **Only placements count**; a rotation itself does not — otherwise it becomes "only one turn in five may be a rotation", which is too hard to keep track of.
- It can be set to 3 / 5 / 8 / 10, default 5.
- The first rotation is subject to it too: you must place 5 stones after the game starts before you can rotate.
- Undo rolls the cooldown back as well, so the counter and the board never disagree.

### 10.5 What a rotation costs

A rotation **uses up the whole turn**: the opponent moves immediately afterward, and you cannot "rotate and then place".
Every turn is therefore "place or rotate, one or the other".

A rotation does not count as move number N; the Nth move always means the Nth placement (the interface reports rotations separately).

### 10.6 Undoing a rotation

| Action | Effect |
|---|---|
| Undo `Z` | Takes back the last step — a rotation or a placement — and can go back to before the game started |
| Restore rotation `Y` | Available only when the last move was exactly a rotation |

Once someone places a stone, that rotation has landed and can no longer be taken back on its own — otherwise it would become a
time machine spanning many moves.

Undoing also returns the cooldown to what it was before the rotation.

### 10.7 Sizes

| Mode | Sizes | Default |
|---|---|---|
| 3D | 8 ≤ N ≤ 50, the three axes may differ | 15 |
| 4D | 8 ≤ N ≤ 50, **must be cubic** | 8 |

4D having to be cubic is not laziness: rotating a layer requires that layer's two sides to be equal, and all three axes must
be rotatable, so all three must be the same length.

4D defaults to 8 rather than 15 because **the bigger the board, the fewer stones a layer holds, and the less a rotation shows** —
on a 15×15×15 board a layer holds less than one stone on average, and most rotations hit the "nothing changed" case.

## 11. What this game does not do

- **No double-three or double-four restrictions.** In traditional Renju (Gomoku's competitive form) the first player is also
  barred from "one move making two open threes / two fours" and the like; this game implements the overline loss only. The
  penalty falls after the move — there is no cell you are forbidden to play.
- **No computer opponent.** Two people take turns on the same device.
- **Rotations are not animated**; they land instantly, with only a brief highlight on the rotated layer.
- **Rotations can only be made with the panel buttons**, not by dragging in the 3D view.
