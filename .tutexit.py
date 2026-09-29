# -*- coding: utf-8 -*-
import io

p = "Web_Gomoku3D/index.html"
lines = io.open(p, encoding="utf-8").read().split("\n")

# 6658（1 基）是 STATIC_TEXT.en 里的孤条（元素没了）；6659 是 TEXT.en 里新加的。
# 把 STATIC 那条删掉，其余四语言的 tutExit 从 STATIC 挪进 TEXT 的做法：
#   —— 它们的 tutExit/tutNext 现在都在 STATIC_TEXT 里（元素 id 的那张），
#      而 tutExit 现在是 say() 的键，必须进 TEXT。
# 先看清 6658/6659 谁是谁：6658 在 STATIC_TEXT 区间，6659 在 TEXT 区间。
i_static = next(i for i, l in enumerate(lines) if l.startswith("const STATIC_TEXT"))
i_text = next(i for i, l in enumerate(lines) if l.startswith("const TEXT"))
print("STATIC 起 %d，TEXT 起 %d" % (i_static + 1, i_text + 1))
for ln in (6658, 6659):
    print("  %d: %s  →  %s" % (ln, "STATIC" if ln - 1 < i_text else "TEXT", lines[ln - 1]))

# 1) 删 STATIC 里那条孤立的 "tutExit": "Exit",
assert lines[6658 - 1].strip() == '"tutExit": "Exit",', lines[6658 - 1]
del lines[6658 - 1]

# 2) 四语言的 STATIC 行 `"tutExit": "X", "tutNext": "Y",` 里只有 tutExit 需要挪进 TEXT。
#    最简单：把它们拆成两条 —— tutExit 留在原处（STATIC，供 data-i18n 用）不行（元素没了）。
#    所以：删掉 STATIC 里的 tutExit，在 TEXT 的对应语言块里补一条。
MOVES = {
    '"tutExit": "終了", "tutNext": "次の関",': ('"tutNext": "次の関",', '"tutExit": "終了",'),
    '"tutExit": "나가기", "tutNext": "다음 단계",': ('"tutNext": "다음 단계",', '"tutExit": "나가기",'),
    '"tutExit": "Выйти", "tutNext": "Дальше",': ('"tutNext": "Дальше",', '"tutExit": "Выйти",'),
    '"tutExit": "Quitter", "tutNext": "Suivant",': ('"tutNext": "Suivant",', '"tutExit": "Quitter",'),
}
for i, l in enumerate(lines):
    key = l.strip()
    if key in MOVES:
        keep, moved = MOVES[key]
        lines[i] = "  " + keep
        # 插到同一语言块里的 phase.dawn 那行之后
        print("  挪 %s" % l.strip()[:24])
        MOVED = moved
        # 记下来稍后统一插
        MOVES[key] = (keep, moved)

# 统一把挪出来的四条插进各自语言的 TEXT 块（锚点：该语言的 phase.dawn 行）
s = "\n".join(lines)
INSERTS = [
    ('"phase.dawn": "黎明", "phase.night": "長い夜",', '"tutExit": "終了",'),
    ('"phase.dawn": "여명", "phase.night": "긴 밤",', '"tutExit": "나가기",'),
    ('"phase.dawn": "Рассвет", "phase.night": "Долгая ночь",', '"tutExit": "Выйти",'),
    ('"phase.dawn": "Aube", "phase.night": "Longue nuit",', '"tutExit": "Quitter",'),
]
for anchor, line in INSERTS:
    assert s.count(anchor) == 1, (anchor[:26], s.count(anchor))
    s = s.replace(anchor, anchor + "\n  " + line, 1)

io.open(p, "w", encoding="utf-8", newline="").write(s)
print("ok")
