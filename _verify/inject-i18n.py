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

import io, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 本文件在 _verify/ 下
HTML = os.path.join(ROOT, "Web_Gomoku3D", "index.html")
DOM = os.path.join(ROOT, "Web_Gomoku3D", "tests", "dom-smoke.test.mjs")
BROWSER = os.path.join(ROOT, "_verify", "browser-check.mjs")


def read(p):
    with io.open(p, "r", encoding="utf-8", newline="") as f:
        return f.read()


def write(p, t):
    with io.open(p, "w", encoding="utf-8", newline="") as f:
        f.write(t)


def run(cmd):
    r = subprocess.run(["node", cmd], cwd=ROOT, capture_output=True,
                       encoding="utf-8", errors="replace")
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def tail_of(out):
    """从失败输出里挑一行能说明问题的 —— 有 FAIL 就报 FAIL。"""
    for line in out.split("\n"):
        if "FAIL" in line or "错误" in line or "Error" in line:
            return line.strip()[:150]
    return "(没有明显的失败行)"


ORIG = read(HTML)

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

    # ---- (c) 中文方向不回写快照，改成"永远显示英文"。
    # 症状：切回中文时界面还是英文 —— 而"切到英文"那条通路一切正常，看不出问题。
    ("c. applyStatic 的中文方向不再回写快照（切回中文失效）",
     lambda h: h.replace(
         "const want = LANG === \"en\" && mapped !== undefined ? mapped : s.zh;",
         "const want = mapped !== undefined ? mapped : s.zh;", 1)),

    # ---- (d) JS 现拼的句子退回硬编码中文。
    # 【这条是这一版真正的教训】：实现完成时 #dimRange 的"可填"和 #coolNote 的
    # "四维模式才有"都还是中文，而它们【不在 HTML 里、也不经过任何一张表】——
    # 源码扫描和"表里有没有这个键"两类检查都看不见。是靠英文截图用眼睛发现的。
    # browser-check 里那条"英文界面下没有一处可见文字还是中文"就是为它写的。
    ("d. 可填范围退回硬编码中文（JS 现拼的句子漏翻）",
     lambda h: h.replace(
         'say(() => "可填 " + range, "range.allowed", { range: range });',
         '"可填 " + range;', 1)),
]

try:
    # 先确认每条锚点都真的匹配得到 —— 锚点写错的话，注入会"什么都没改"，
    # 然后测试全绿，看起来像"测试抓不住"，其实是注入根本没生效。
    for name, fn in INJECTIONS:
        if fn(ORIG) == ORIG:
            print("锚点没匹配上，注入 " + name + " 无效 —— 先修注入脚本")
            sys.exit(2)
        if fn(ORIG) == ORIG:
            sys.exit(2)

    caught = 0
    for name, fn in INJECTIONS:
        bad = fn(ORIG)
        write(HTML, bad)
        rc_dom, out_dom = run(DOM)
        rc_brw, out_brw = run(BROWSER)
        write(HTML, ORIG)

        d = "抓到" if rc_dom else "!! 漏了"
        b = "抓到" if rc_brw else "!! 漏了"
        if rc_dom and rc_brw:
            caught += 1
        print("注入 " + name)
        print("    dom-smoke     : " + d + "   " + tail_of(out_dom))
        print("    browser-check : " + b + "   " + tail_of(out_brw))
    print()
    print(str(caught) + "/" + str(len(INJECTIONS)) + " 处注入被两套检查同时抓到")
    sys.exit(0 if caught == len(INJECTIONS) else 1)
finally:
    write(HTML, ORIG)
    print("已还原 index.html")
