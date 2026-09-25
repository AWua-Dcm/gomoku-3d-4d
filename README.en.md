# gomoku-3d-4d

[中文](README.md) | **English**

**3D & 4D Gomoku** — one HTML file, double-click to play, zero dependencies.
*三维与四维五子棋 —— 单文件网页版，双击即玩，零依赖。*

**▶ Play online: <https://awua-dcm.github.io/gomoku-3d-4d/>** — the same single file, hosted on GitHub Pages.

The game's interface switches between English and Chinese too: the button in the top-right
corner. It starts in Chinese.

![Setup screen](_verify/shots/6-起始界面-英文.png)

---

## What this is

Gomoku (five-in-a-row) played on an **N×N×N board**. The big difference from the flat game
is that there are far more ways to line stones up — **13 directions** in all (3 axes +
6 face diagonals + 4 body diagonals). Blocking the front is not enough: a line can cut
diagonally, run straight up through the layers, or thread several layers at once.

Three things you don't see every day:

| | |
|---|---|
| **4D mode** | A layer can be **rotated like a Rubik's cube**. Once every few moves you may rotate one layer, and every stone in it moves with it — a threat you set up two moves ago can be rotated right out from under you |
| **Rectangular boards** | In 3D mode the three axes may have different lengths (say `8 × 12 × 30`). Each axis accepts `8 – 50` |
| **The first player is restricted** | The first player must make **exactly five in a row**; six or more is an **overline loss**. The second player wins with five or more. The reason is that on a 3D board the first player's advantage is otherwise overwhelming — see the [full rules](Web_Gomoku3D/RULES_SPEC.en.md) |

---

## How to play

**Double-click `Web_Gomoku3D/index.html`** and it opens in any modern browser.

No server, no network, nothing to install.
To confirm nothing is broken: press `F12` → Console and look for red text.

### Controls

| Action | What it does |
|---|---|
| Drag with the left button | Rotate the board. Left/right turns forever; dragging up/down **all the way gives you a true top-down or bottom-up view** (89.5°) instead of stopping 5° off the axis |
| Scroll wheel | Zoom |
| Click | Place a stone on the current layer |
| Hover | Red lines mark the x / y / z lines through the cell under the cursor |
| Right-hand panel | Step through the board layer by layer; click an empty cell to play there |
| **Grid lines** button, top-left | Hide the 3D lattice so only the stones remain. The blue current-layer frame, the red hover lines and the gold winning line all stay — hide those and you cannot aim |
| End-of-game banner | Can be **dragged** (it cannot leave the left-hand view), and closed with **Close Esc** or the Esc key. Closing it does not let you play on: to continue the same game you must press **Undo** |
| `Z` / `R` / `G` | Undo / Restart / Toggle the view mode (ghost layers ↔ slice) |
| `H` | Hide / show the grid lines (same as the top-left button) |
| `Q` `E` or `[` `]` | Change the current layer |
| `T` / `Y` | (4D) Rotate a layer / undo that rotation |

The **Full rules** button in the top-right corner opens the complete rule text.

---

## Running the tests

```bash
bash _verify/run-all.sh
```

**All you need is node** — no Unity, no .NET, no npm packages. Eight steps; expected result:

```
11733 + 19408 + 98 + 77 + 8845 + 115 + 124 = 40400 assertions, all green
```

Step 8 (a real headless-browser check) is optional: if Chrome or Edge isn't installed it is
skipped rather than failed. It also writes screenshots to `_verify/shots/`.

To run one piece on its own:

| Command | Count | What it covers |
|---|---|---|
| `node Web_Gomoku3D/tests/rules.test.mjs` | 11733 | 3D rule baseline (replays frozen vectors) |
| `node Web_Gomoku3D/tests/rotation.test.mjs` | 19408 | 4D rotation consistency |
| `node Web_Gomoku3D/tests/dims.test.mjs` | 98 | Rectangular boards + size constraints |
| `node Web_Gomoku3D/tests/dom-smoke.test.mjs` | 77 | UI against a DOM stub (includes the language switch) |
| `node Web_Gomoku3D/tests/online.test.mjs` | 8845 | Networking kernel, cell-by-cell against the web build (1156 cases) |
| `node Web_Gomoku3D/tests/online-http.test.mjs` | 115 | Networking HTTP layer (loopback) |
| `node _verify/browser-check.mjs` | 124 | Real browser (GLSL compilation, layout geometry, console errors, English layout) |

The two networking tests run inside step 7 and **cannot be skipped**.

Three more scripts exist to prove the checks above actually fail when they should —
each deliberately breaks the code and requires that the tests catch every case:

| Command | What it does |
|---|---|
| `python _verify/inject-rulenote.py` | Breaks the on-screen rule summary 3 ways; both suites must catch 3/3 |
| `python _verify/inject-i18n.py` | Breaks the language switching 4 ways; both suites must catch 4/4 |
| `node _verify/inject-online.mjs` | Breaks the networking code 25 ways; every case must turn a test red (slow, not part of `run-all.sh`) |

> The first two temporarily break `index.html` and restore it in a `finally` block.
> They run `browser-check` against a scratch directory, so the six baseline PNGs in
> `_verify/shots/` are never overwritten: screenshots are taken *before* the failures are
> reported, so writing to the default directory would put captures of a deliberately broken
> page into version control — after which `git status` can no longer tell "the image went
> stale" from "the UI really changed".

(One caveat: the assertion total above is hard-coded, so it always lags a little behind.
The real total is whatever `bash _verify/run-all.sh` prints.)

### About the "frozen vectors"

`tests/vectors.json` and `tests/rotation-vectors.json` were **exported from a C# kernel
that has since been deleted**. The export script and the C# source are both gone. That means:

> **Those two files can never be regenerated.**

Step 2 of `run-all.sh` pins them by md5. Editing them to make a test go green
**is not fixing a bug, it is tampering with evidence**. What they mean today is
"this implementation agrees move-for-move with the C# one as of 2026-09" — a **frozen
historical baseline**, not a comparison against something still alive.
See the header of [`_verify/run-all.sh`](_verify/run-all.sh) for the full story.

---

## Repository layout

```
.
├── README.md                   ← the Chinese README (this file is README.en.md)
├── Web_Gomoku3D/
│   ├── index.html              ← all the code. 3D/4D rendering + rule kernel + UI, one file, no dependencies
│   ├── server.js               ← the networking server (zero dependencies). Protocol and tests are in place; the page is not wired to it yet
│   ├── README.md               ← engineering notes: architecture, evidence boundaries, known limits (Chinese only — much deeper than this file)
│   ├── RULES_SPEC.md           ← full rules, for players (Chinese). This is what "Full rules" shows
│   ├── RULES_SPEC.en.md        ← the same rules in English. This is what "Full rules" shows in English
│   ├── ONLINE.md               ← design for two-player networking (Chinese only)
│   └── tests/                  ← offline tests + the two frozen vector files
├── _verify/
│   ├── run-all.sh              ← one command runs every offline check
│   ├── browser-check.mjs       ← headless Chrome/Edge: GLSL, console, layout geometry, screenshots
│   ├── embed-rules.mjs         ← generator that embeds both RULES_SPEC files into index.html
│   ├── inject-rulenote.py      ← injection check: proves the rule-summary assertions can fail
│   ├── inject-i18n.py          ← injection check: proves the language-switch assertions can fail
│   ├── inject-online.mjs       ← injection check: proves the networking assertions can fail (slow, 25 cases)
│   └── shots/                  ← screenshots written by browser-check
├── 打开流程.md                  ← setup walkthrough + acceptance checklist (Chinese only)
└── LICENSE
```

### A deliberate design choice: one file

The section of `index.html` between `/* GOMOKU-CORE-BEGIN */` and `/* GOMOKU-CORE-END */`
is a **pure rule kernel** — it touches no DOM, no WebGL, no browser API. So the same source
runs in three places:

1. The browser (normal play)
2. Node (`tests/rules.test.mjs` extracts it with `new Function` and replays the vectors)
3. A server, when networking lands (as the referee)

**One implementation**, so there is no way for "the web build changed but the server didn't"
to happen.

---

## English and Chinese

The button in the top-right corner switches the interface between Chinese and English.
It **starts in Chinese** — it does not read `navigator.language`. That is switching, not guessing.

Three things worth knowing:

- **The Chinese text stays in the HTML; English lives in a string table.** Switching back to
  Chinese writes the original HTML text back, so there is exactly one copy of the Chinese —
  the two languages can't quietly drift apart
- **The rule kernel contains English text as well.** The kernel was already building Chinese
  sentences (`黑`/`白`, status descriptions), and there was no way around translating it: it has
  to be extractable verbatim by `server.js` and three test files, so it cannot reference an
  outside string table. The cost is that the kernel is no longer purely an algorithm. Every
  text-building function takes a trailing `lang = "zh"` argument; called without it, the output
  is byte-for-byte what it always was
- **Leftover Chinese in the English UI is guarded by assertions.** `browser-check` switches to
  English and sweeps the whole rendered tree, screen by screen; no visible text may be Chinese,
  and none may be a leaked translation key like `info.moves.one`

### Which documents are English?

The player-facing material is bilingual: this README, the full rules (`RULES_SPEC.en.md`),
and the whole interface. The **deep engineering documentation is Chinese only** —
`Web_Gomoku3D/README.md` (architecture, evidence boundaries, the reasoning behind each design
decision), `打开流程.md`, and `ONLINE.md`. That is a real gap for English-speaking contributors,
and it is stated here rather than papered over.

---

## Known limitations

- **No computer opponent.** Two people take turns on the same device.
  (Cross-machine networking: the **server and protocol are implemented and tested**
  — `Web_Gomoku3D/server.js`, 8960 assertions in step 7 — but the page is not wired to it,
  so you cannot actually play across machines yet. Design and trade-offs:
  [ONLINE.md](Web_Gomoku3D/ONLINE.md))
- **No saved games.**
- The 3D grid lines have **no sense of depth**: looking through the cube stacks n parallel
  grid lines at exactly the same screen position, and since they are alpha-blended the inside
  reads as a gray mesh. This is inherent to drawing coincident primitives — adjusting alpha only
  makes it uniformly fainter. Real depth needs `depthMask = true` in `draw3D`, at the cost of
  barely being able to see inside when looking straight down an axis
- On very full boards (more than 4000 stones) the **thumbnail degrades into an occupancy bar**
- Coordinate picking on rectangular boards falls back to "ray × current layer plane", so
  looking exactly edge-on at the current layer makes depth ambiguous

A more complete list (including which claims are verified and which are merely my belief)
is in [Web_Gomoku3D/README.md](Web_Gomoku3D/README.md) — in Chinese.

---

## License

[MIT](LICENSE)
