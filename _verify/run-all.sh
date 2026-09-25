#!/usr/bin/env bash
# 一条命令跑完全部离线验证。
#
# 这个工程【只有网页版】—— 原 Unity/C# 实现已经删除。
# 所以这些检查既不需要 Unity，也不需要 .NET，只要有 node。
#
# 七步（第 7 步可选）：
#   1. 规则正文自检           —— 页面里嵌的规则全文 == RULES_SPEC.md
#   2. 向量文件完整性          —— 见下面【冻结的向量】
#   3. 网页版规则内核测试      —— 回放 vectors.json + 自身断言
#   4. 网页版转动一致性测试    —— 回放 rotation-vectors.json + MapCoord/RotateLayer 互校
#   5. 网页版长方体棋盘测试    —— 网页版独有的扩展，向量不覆盖它，证据只有这一份
#   6. 网页版 DOM 冒烟测试     —— 桩环境里真的把界面跑一遍
#   7. 真实浏览器检查（可选）  —— 无头 Chrome/Edge：GLSL 编译、控制台报错、布局几何
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

banner "1/7  规则正文自检"
# 网页版把 RULES_SPEC.md 全文嵌进了 index.html 给"具体规则"按钮用。
# 正文只此一份，页面上那段是生成物 —— 这里先确认它没被改脏，
# 不然规则文档改了两边，玩家看到的和代码执行的就会不一致。
node "$HERE/embed-rules.mjs" --check || FAIL=1

banner "2/7  向量文件完整性（冻结锁）"
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

banner "3/7  网页版规则内核测试"
( cd "$PROJ" && node Web_Gomoku3D/tests/rules.test.mjs ) || FAIL=1

banner "4/7  网页版转动一致性测试"
( cd "$PROJ" && node Web_Gomoku3D/tests/rotation.test.mjs ) || FAIL=1

banner "5/7  网页版长方体棋盘测试"
( cd "$PROJ" && node Web_Gomoku3D/tests/dims.test.mjs ) || FAIL=1

banner "6/7  网页版 DOM 冒烟测试"
( cd "$PROJ" && node Web_Gomoku3D/tests/dom-smoke.test.mjs ) || FAIL=1

banner "7/7  真实浏览器检查（可选，没装浏览器就跳过）"
( cd "$PROJ" && node _verify/browser-check.mjs ) || FAIL=1

echo
if [ $FAIL -eq 0 ]; then
  echo "=================================================="
  echo "  全部离线检查通过"
  echo "=================================================="
  echo
  echo "仍未验证的部分："
  echo "  · 配色好不好看、三维观感、交互手感（第 7 步只验到「能编译 / 没报错 / 布局几何」）"
  echo "  · 四维转动的手感（转层是否直观、提示是否看得懂）"
  echo
  echo "网页版请直接用浏览器打开 Web_Gomoku3D/index.html"
  echo "第 7 步的截图在 _verify/shots/"
else
  echo "=================================================="
  echo "  有检查失败，见上面的输出"
  echo "=================================================="
fi
exit $FAIL
