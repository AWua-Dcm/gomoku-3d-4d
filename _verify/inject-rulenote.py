# 注入验证：把 index.html 里的规则摘要故意改坏，确认新加的断言真的会红。
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
SCRATCH = tempfile.mkdtemp(prefix="gomoku-inject-rulenote-shots-")


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


def tail_of(out, name):
    """从失败输出里挑一行能说明问题的 —— 有 FAIL 就报 FAIL。"""
    for line in out.split("\n"):
        if "FAIL" in line or "错误" in line or "Error" in line:
            return line.strip()[:150]
    return "(没有明显的失败行)"


ORIG = read(HTML)

LINE5 = "    规则：任意空格可落子，无重力约束。先手必须【恰好 5 连】，连成 6 个及以上判长连负；后手 ≥5 连即胜。<br>\n"
LINE13 = "    获胜方向为 13 个：3 轴向 + 6 面对角 + 4 体对角。右侧面板可以逐层查看与落子。\n"
# 标签上现在还挂着 data-i18n-html（界面语言切换要用）。注入锚点必须逐字符对上
# 【当前的】HTML，改了实现就得跟着改锚点 —— 对不上时这个脚本 exit(2) 而不是静默跳过，
# 就是为了逼出这次修改。改完必须重跑，确认三处注入仍然 3/3 被抓到。
BLOCK = '  <div id="ruleNote" data-i18n-html="ruleNote">\n' + LINE5 + LINE13 + "  </div>\n"
DEV = ('    <span style="color:#8a7d69">规则全文见工程根目录的 RULES_SPEC.md，'
       '尺寸与规则内核与 Unity 版共用同一套测试向量。</span>\n')

INJECTIONS = [
    ("1. 整个规则摘要块被删掉", lambda h: h.replace(BLOCK, "")),
    ("2. 只删掉「长连」那半句（最容易手滑多删一行的情况）",
     lambda h: h.replace(LINE5,
                         LINE5.replace("，连成 6 个及以上判长连负", ""))),
    ("3. 开发者向的句子被加回来",
     lambda h: h.replace(BLOCK, '  <div id="ruleNote">\n' + LINE5 + LINE13 + DEV + "  </div>\n")),
]

try:
    # 先确认三处锚点都真的匹配得到 —— 锚点写错的话，注入会"什么都没改"，
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

        d = "抓到" if rc_dom else "!! 漏了"
        b = "抓到" if rc_brw else "!! 漏了"
        if rc_dom and rc_brw:
            caught += 1
        print("注入 " + name)
        print("    dom-smoke     : " + d + "   " + tail_of(out_dom, "dom"))
        print("    browser-check : " + b + "   " + tail_of(out_brw, "brw"))
    print()
    print(str(caught) + "/" + str(len(INJECTIONS)) + " 处注入被两套检查同时抓到")
    print("注入期间的截图在 " + SCRATCH + "（_verify/shots/ 里那六张基线图没被碰）")
    sys.exit(0 if caught == len(INJECTIONS) else 1)
finally:
    write(HTML, ORIG)
    print("已还原 index.html")
