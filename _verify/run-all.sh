#!/usr/bin/env bash
# 一条命令跑完全部离线验证。
#
# 这个工程【只有网页版】—— 原 Unity/C# 实现已经删除。
# 所以这些检查既不需要 Unity，也不需要 .NET，只要有 node。
#
# 九步（第 9 步可选）：
#   1. 规则正文自检           —— 页面里嵌的规则全文 == RULES_SPEC.md
#   2. 向量文件完整性          —— 见下面【冻结的向量】
#   3. 网页版规则内核测试      —— 回放 vectors.json + 自身断言
#   4. 网页版转动一致性测试    —— 回放 rotation-vectors.json + MapCoord/RotateLayer 互校
#   5. 网页版长方体棋盘测试    —— 网页版独有的扩展，向量不覆盖它，证据只有这一份
#   6. 电脑对手测试            —— 两条硬规则（能赢必赢、绝不自尽）、三档强弱关系、
#                                自对局逐手真喂给引擎（保证它永远不会卡住）、计算量上界
#   7. 网页版 DOM 冒烟测试     —— 桩环境里真的把界面跑一遍
#   8. 联机协议测试            —— 进程内直调逐格对拍（不经过网络）
#                                + 真 HTTP / 真 SSE（自己起服务器，绑 127.0.0.1）
#   9. 真实浏览器检查（可选）  —— 无头 Chrome/Edge：GLSL 编译、控制台报错、布局几何
#                                本机没装浏览器就自动跳过，不算失败
#
# ============================================================================
# 【冻结的向量】—— 改这个文件之前必须先读这一段
# ============================================================================
# tests/vectors.json 和 tests/rotation-vectors.json 是【从 C# 内核导出的】，
# 导出脚本（_verify/emit-vectors*.sh + emit-vectors*.cs）编译的是
# Assets/_Gomoku3D/Core 下的 C# 源码。
#
# 那套 C# 源码和导出脚本本身【都已经删除了】（Unity 工程外壳也已整体删除）。
# 后果：
#
#     ★ 这两个向量文件从此【永远无法重新生成】。★
#
# 它们仍然是网页版规则正确性的唯一外部证据（31141 项断言全靠回放它们），
# 但它们的含义变了：从"和当前 C# 实现一致"变成了
# **"和 2026-09 那份 C# 实现一致"** —— 是一份冻结的历史基线，不是活的对拍。
#
# 所以第 2 步用 md5 把它们钉死。如果有人（或某次重构）为了让测试变绿而
# 改动向量文件，这一步会当场报出来。那【不是修 bug，是篡改证据】——
# 真要让测试通过，应该去改网页版内核，然后接受"再也无法交叉验证"这个事实。
#
# 以后想改规则怎么办：改网页版内核，然后【明确地】在 rules.test.mjs 里
# 加一条只针对新规则的断言。不要动向量。
# ============================================================================
#
# 用法：bash _verify/run-all.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PROJ="$(cd "$HERE/.." && pwd)"
FAIL=0

# 冻结的向量 —— 见文件头的说明。改动这两个文件必须同时改这里，且改之前先想清楚。
VECTORS_MD5_EXPECT="3bcead846a4ad6804080b03205b2985e"
ROTATION_MD5_EXPECT="33d638c973e4f4a5ccb2be67ad475ae4"

banner() { echo; echo "################ $1 ################"; echo; }

banner "1/9  规则正文自检"
# 网页版把 RULES_SPEC.md 全文嵌进了 index.html 给"具体规则"按钮用。
# 正文只此一份，页面上那段是生成物 —— 这里先确认它没被改脏，
# 不然规则文档改了两边，玩家看到的和代码执行的就会不一致。
node "$HERE/embed-rules.mjs" --check || FAIL=1

banner "2/9  向量文件完整性（冻结锁）"
for pair in "vectors.json:$VECTORS_MD5_EXPECT" \
            "rotation-vectors.json:$ROTATION_MD5_EXPECT"; do
  f="${pair%%:*}"; want="${pair##*:}"
  path="$PROJ/Web_Gomoku3D/tests/$f"
  # md5sum 的输出是 "<hash> *<文件名>"，取第一段
  got="$(md5sum "$path" 2>/dev/null | cut -d' ' -f1)"
  if [ "$got" = "$want" ]; then
    echo "  未改动  $f"
  elif [ -z "$got" ]; then
    echo "  【缺失】$f 不见了 —— 这个文件无法重新生成，只能从备份恢复"
    FAIL=1
  else
    echo "  【被改过】$f"
    echo "      期望 $want"
    echo "      实际 $got"
    echo "      ← 这是冻结的证据，不是可以随便改的测试数据。见本脚本文件头的说明。"
    FAIL=1
  fi
done

banner "3/9  网页版规则内核测试"
( cd "$PROJ" && node Web_Gomoku3D/tests/rules.test.mjs ) || FAIL=1

banner "4/9  网页版转动一致性测试"
( cd "$PROJ" && node Web_Gomoku3D/tests/rotation.test.mjs ) || FAIL=1

banner "5/9  网页版长方体棋盘测试"
( cd "$PROJ" && node Web_Gomoku3D/tests/dims.test.mjs ) || FAIL=1

# 电脑对手。它跑的是内核区间里的那一段，所以排在 DOM 冒烟之前（内核测试在前、界面测试在后）。
banner "6/9  电脑对手测试"
( cd "$PROJ" && node Web_Gomoku3D/tests/ai.test.mjs ) || FAIL=1

banner "7/9  网页版 DOM 冒烟测试"
( cd "$PROJ" && node Web_Gomoku3D/tests/dom-smoke.test.mjs ) || FAIL=1

# 【这一步不可跳过】它和上面几步一样是硬失败，没有"没装就跳过"的说法 ——
# 它只依赖 node，任何能跑这个脚本的机器都跑得了它。
banner "8/9  联机协议测试"
( cd "$PROJ" && node Web_Gomoku3D/tests/online.test.mjs ) || FAIL=1
# 真 HTTP + 真 SSE：自己起一台服务器，绑 127.0.0.1（绑 0.0.0.0 在 Windows 上会弹防火墙框）
( cd "$PROJ" && node Web_Gomoku3D/tests/online-http.test.mjs ) || FAIL=1

banner "9/9  真实浏览器检查（可选，没装浏览器就跳过）"
( cd "$PROJ" && node _verify/browser-check.mjs ) || FAIL=1

echo
if [ $FAIL -eq 0 ]; then
  echo "=================================================="
  echo "  全部离线检查通过"
  echo "=================================================="
  echo
  echo "仍未验证的部分："
  echo "  · 配色好不好看、三维观感、交互手感（第 9 步只验到「能编译 / 没报错 / 布局几何」）"
  echo "  · 电脑对手的棋力手感（弱/中/强三档实际下起来像不像人、弱档是不是真的能被新手赢）"
  echo "    第 6 步只验到「合法、不卡死、算得快、三档的强弱关系是对的」，棋力只能自己下几局感觉"
  echo "  · 四维转动的手感（转层是否直观、提示是否看得懂）"
  echo "  · 联机在**真实跨网**下的表现（心跳、代理缓冲、移动网络切换）"
  echo "    第 7 步只验到本机 loopback，跨网必须真人异地实测"
  echo "  · 公网暴露之后的实际抗扫描情况（ONLINE.md §5.4 那组上限值是经验值，不是测出来的）"
  echo
  echo "另有一条不在这个脚本里的检查（很慢，但改了联机代码就一定该跑）："
  echo "    node _verify/inject-online.mjs"
  echo "  它故意改坏 25 处代码，逐条确认测试会变红 —— 防的是「测试看着全绿其实什么都没验」。"
  echo
  echo "网页版请直接用浏览器打开 Web_Gomoku3D/index.html"
  echo "第 8 步的截图在 _verify/shots/"
else
  echo "=================================================="
  echo "  有检查失败，见上面的输出"
  echo "=================================================="
fi
exit $FAIL
