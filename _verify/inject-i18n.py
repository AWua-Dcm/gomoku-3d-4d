# 注入验证：把界面语言的几条通路各弄坏一处，确认新加的断言真的会红。
#
# 【为什么必须有这个脚本】"英文界面能切换"这件事没法靠读代码确认 ——
# 漏一条英文的表现是"那一处还是中文"，界面上不报错、控制台也不报错。
# 所以这一版的每条检查都得先证明它【会红】，否则它只是看起来像检查。
#
# 跑完无论如何都在 finally 里还原（内存里留原文，不依赖备份文件）。
#
# 行尾：工程是 LF，一律 newline="" 读写，不让 Windows 文本模式把它改成 CRLF。
# 子进程：必须 encoding="utf-8", errors="replace"，否则中文在 GBK 下解码崩掉。

import io, os, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 本文件在 _verify/ 下
HTML = os.path.join(ROOT, "Web_Gomoku3D", "index.html")
DOM = os.path.join(ROOT, "Web_Gomoku3D", "tests", "dom-smoke.test.mjs")
BROWSER = os.path.join(ROOT, "_verify", "browser-check.mjs")

# 【注入期间 browser-check 必须写到临时目录，不能写 _verify/shots/】
# 它的六张图是在报告失败【之前】拍的（截图在断言前面，见 browser-check.mjs），
# 所以哪怕检查全红，图也已经落盘了。走默认目录的话，这里每注入一次就把
# 【故意弄坏的页面】的截图写进版本库 —— 而 finally 只还原 index.html，
# 于是 _verify/shots/ 里的基线图和真实状态对不上，而 git status 看不出是谁干的
# （那六张图本来就是版本库里的文件，"被改脏"和"真的改了界面"长得一模一样）。
# browser-check 支持 `node browser-check.mjs [输出目录]`，传一个临时目录即可。
SCRATCH = tempfile.mkdtemp(prefix="gomoku-inject-i18n-shots-")


def read(p):
    with io.open(p, "r", encoding="utf-8", newline="") as f:
        return f.read()


def write(p, t):
    with io.open(p, "w", encoding="utf-8", newline="") as f:
        f.write(t)


def run(cmd, *args):
    r = subprocess.run(["node", cmd] + list(args), cwd=ROOT, capture_output=True,
                       encoding="utf-8", errors="replace")
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def tail_of(out):
    """从失败输出里挑一行能说明问题的 —— 有 FAIL 就报 FAIL。"""
    for line in out.split("\n"):
        if "FAIL" in line or "错误" in line or "Error" in line:
            return line.strip()[:150]
    return "(没有明显的失败行)"


ORIG = read(HTML)

# 每条注入【预期由谁抓到】。
#
# 【为什么不一律要求两套都抓到】有几条天然只有一套看得见，硬要求两套会让这个脚本
# 永远红 —— 而"永远红"和"永远绿"一样没用（没人会再看它）。逐条写清楚之后，
# 缺了任何一个【预期】抓到的都算失败，而"预期之外多抓到"不扣分：
#   b 英文少一条单数形：只有真浏览器里造一局 1 手才露得出来（桩里不会渲染那句话）
#   c 中文不回写快照：桩里那条"切回中文逐字节等于 HTML 原文"是唯一的证据
#   g 列表不高亮 / h 复数不选形：都只有真浏览器里那两条断言盯着
EXPECT = {"a": ("dom", "brw"), "b": ("brw",), "c": ("dom",), "d": ("dom", "brw"),
          "e": ("dom", "brw"), "f": ("dom", "brw"), "g": ("brw",), "h": ("brw",)}

# 下面每条锚点都必须在【当前的】index.html 里逐字符存在。对不上时这个脚本
# exit(2) 而不是静默跳过 —— 实现改了就得跟着改锚点，而"锚点过期"这件事
# 只有在这里会报警。改完必须重跑，确认 4/4 仍然被抓到。

INJECTIONS = [
    # ---- (a) HTML 里一个键在英文表里没有。
    # 症状：那一处永远是中文，页面上不报错。
    # 【这条一开始只被 dom-smoke 抓到，而那不是"检查不够多"，是实现有毛病】：
    # 当时 collectStatic() 取的键是元素的 id，属性值没人读 —— 于是把属性值改成
    # modeGhostTypo，运行时【什么都没变】，只有源码扫描会红。那种注入是假的：
    # 它证明的是"测试会喊"，不是"界面会坏"。现在键取属性值，属性写错就是真漏翻，
    # browser-check 在真浏览器里当场看见中文。两侧都抓到才算数。
    ("a. 幽灵层按钮的键改成表里没有的（漏翻一处静态文案）",
     lambda h: h.replace('data-i18n="modeGhost"', 'data-i18n="modeGhostTypo"', 1)),

    # ---- (b) 英文表里删掉一条 JS 文案。
    # 症状：英语下那一句显示成键名 "info.moves.one" 或者还是中文（取决于走哪条通路）。
    # 【这条一开始也漏了，两个原因叠在一起】：一是键名混在 "info.moves.one · board …"
    # 这种长句中间，browser-check 当时只认"整串恰好是键名"；二是 info.moves.one
    # 只在【恰好 1 手】时才用得上，而当时扫的那一屏走了 2 手，用的是复数键 ——
    # 单数那条键压根没露过面，删了当然没人喊。两处都补了：扫描改按子串找，
    # 另外专门造一局 1 手 + 1 次转动（冷却要临时调成 1，否则第 1 手转不了）。
    ("b. 从 TEXT.en 里删掉 info.moves.one（漏翻一句 JS 拼的文案）",
     lambda h: h.replace('  "info.moves.one": "{n} move played",\n', "", 1)),

    # ---- (c) 中文方向不回写快照，改成"切回中文时不写任何东西"。
    # 症状：切回中文时界面还是上一种语言 —— 而"切到外语"那条通路一切正常，看不出问题。
    ("c. applyStatic 的中文方向不再回写快照（切回中文失效）",
     lambda h: h.replace(
         "    if (s.isHtml) s.el.innerHTML = want;\n    else s.el.textContent = want;",
         "    if (LANG === \"zh\") continue;\n    if (s.isHtml) s.el.innerHTML = want;\n"
         "    else s.el.textContent = want;", 1)),

    # ---- (d) JS 现拼的句子退回硬编码中文。
    # 【这条是这一版真正的教训】：实现完成时 #dimRange 的"可填"和 #coolNote 的
    # "四维模式才有"都还是中文，而它们【不在 HTML 里、也不经过任何一张表】——
    # 源码扫描和"表里有没有这个键"两类检查都看不见。是靠英文截图用眼睛发现的。
    # browser-check 里那条"英文界面下没有一处可见文字还是中文"就是为它写的。
    ("d. 可填范围退回硬编码中文（JS 现拼的句子漏翻）",
     lambda h: h.replace(
         'say(() => "可填 " + range, "range.allowed", { range: range });',
         '"可填 " + range;', 1)),

    # ---- (e) 内核文案缺一种语言 —— 【六语言那一版真出过的事故，必须钉住】。
    # 症状：那一条在日语界面上退回中文，而前后半句还是日语，于是出现
    # "半句日语半句中文"（实测："黒が先手 · 先手（黒）须恰好 5 连，6 连及以上判负"）。
    # 【为什么这条最要紧】它不报错、不留空、也不在静态表里 —— 只靠"表里有没有这个键"
    # 那类检查完全看不见。靠的是两样：browser-check 里日语那条【简体专有字】扫描
    # （需/负/连 这些字日语里不会用），以及 dom-smoke 里按"会被选中的那一形"查齐全性。
    ("e. 内核 status.turn 的日语译文删掉（内核文案缺一种语言）",
     lambda h: h.replace('ja: "{who}の手番（{n}手目）", ', "", 1)),

    # ---- (f) 某种语言的静态表里少一条。
    # 症状：那一处退回英文（表里没有 → 退到 en → 再没有才留中文快照）。
    # 【只查 CJK 的扫描抓不住它】（英语残留不是汉字），所以靠的是 browser-check 里
    # 那条【正向】检查：带 data-i18n 的元素必须等于该语言的表值。
    ("f. 从 STATIC_TEXT.ja 里删掉 modeGhost（某种语言少一条静态文案）",
     lambda h: h.replace('  "modeGhost": "ゴースト表示",\n', "", 1)),

    # ---- (g) 语言列表不再高亮当前语言。
    # 症状：点开列表看不出自己在哪种语言上；切换功能本身还是好的。
    # 这条盯的是"列表里恰好一项高亮、且那一项就是当前语言"。
    ("g. syncLangList 变成空操作（列表不再标出当前语言）",
     lambda h: h.replace("  syncLangList() {\n    for (let i = 0;",
                         "  syncLangList() {\n    if (1) return;\n    for (let i = 0;", 1)),

    # ---- (h) 复数选形退化成"永远 many"。
    # 症状：俄语该用"少数形"的地方全用复数形 —— 中文英文都看不出来（它们没有这一形），
    # 只有 browser-check 里那条"3 手用的是 .few"会红。
    ("h. pluralForm 的俄语分支失效（永远选 many）",
     lambda h: h.replace('  if (lang === "ru") {', "  if (false) {", 1)),
]

try:
    # 先确认每条锚点都真的匹配得到 —— 锚点写错的话，注入会"什么都没改"，
    # 然后测试全绿，看起来像"测试抓不住"，其实是注入根本没生效。
    for name, fn in INJECTIONS:
        if fn(ORIG) == ORIG:
            print("锚点没匹配上，注入 " + name + " 无效 —— 先修注入脚本")
            sys.exit(2)

    caught = 0
    for name, fn in INJECTIONS:
        bad = fn(ORIG)
        write(HTML, bad)
        rc_dom, out_dom = run(DOM)
        rc_brw, out_brw = run(BROWSER, SCRATCH)
        write(HTML, ORIG)

        got = set()
        if rc_dom:
            got.add("dom")
        if rc_brw:
            got.add("brw")
        want = set(EXPECT.get(name[0], ("dom", "brw")))
        ok = want <= got
        if ok:
            caught += 1
        print("注入 " + name + ("（预期 " + "/".join(sorted(want)) + " 抓到）" if not ok else ""))
        print("    dom-smoke     : " + ("抓到" if rc_dom else "没抓到") + "   " + tail_of(out_dom))
        print("    browser-check : " + ("抓到" if rc_brw else "没抓到") + "   " + tail_of(out_brw))
        if not ok:
            print("    !! 预期由 " + "/".join(sorted(want)) + " 抓到，实际只有 " +
                  ("/".join(sorted(got)) or "谁都没抓到"))
    print()
    print(str(caught) + "/" + str(len(INJECTIONS)) + " 处注入被【预期的检查】抓到")
    print("注入期间的截图在 " + SCRATCH + "（_verify/shots/ 里那六张基线图没被碰）")
    sys.exit(0 if caught == len(INJECTIONS) else 1)
finally:
    write(HTML, ORIG)
    print("已还原 index.html")
