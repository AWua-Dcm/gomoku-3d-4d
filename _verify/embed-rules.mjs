// 把 RULES_SPEC.md 的全文嵌进 Web_Gomoku3D/index.html。
//
// 【为什么要用生成而不是手抄】
// RULES_SPEC.md 是**唯一一份规则文本**，而且是写给玩家看的（2026-09-25 起）：
// 内核开关、判定顺序、测试名那些工程侧内容搬到了 Web_Gomoku3D/README.md
// 的「规则实现细节」一节，这里嵌的只是玩家该看的那份。
// 游戏里要显示"规则全文"，如果手抄一份进 index.html，就有了第二份规则文本 ——
// 改了一边忘了另一边，玩家看到的规则和代码实际执行的规则就会不一致，
// 而那种不一致没有任何东西会报警（这个工程已经被"同一件事写两遍"坑过一次：
// 颜色散在五处、worldOf 有两份拷贝）。
//
// 所以：正文只此一份（RULES_SPEC.md），index.html 里那段是【生成物】，
// 由这个脚本写入，并由 tests/dom-smoke.test.mjs 断言"逐字节等于源文件"。
// 改了 RULES_SPEC.md 之后跑一次这个脚本即可；忘了跑，测试会红。
//
// 用法：
//   node _verify/embed-rules.mjs          # 重新生成
//   node _verify/embed-rules.mjs --check  # 只检查是否一致（不写文件），不一致就退出码 1

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const HTML_PATH = path.join(HERE, "..", "Web_Gomoku3D", "index.html");
export const RULES_PATH = path.join(HERE, "..", "Web_Gomoku3D", "RULES_SPEC.md");

export const BEGIN = "<!-- RULES-EMBED-BEGIN -->";
export const END = "<!-- RULES-EMBED-END -->";

/**
 * 读源文件。用二进制读再按 UTF-8 解码，行尾统一成 LF ——
 * 这个工程全是 LF，任何一处悄悄变成 CRLF 都会让"逐字节相等"的断言变得毫无意义。
 */
export function readRules() {
  const raw = fs.readFileSync(RULES_PATH, "utf8");
  if (raw.indexOf("\r\n") >= 0) {
    throw new Error("RULES_SPEC.md 里出现了 CRLF —— 这个工程用 LF，先统一行尾再嵌入");
  }
  // 嵌进 <script type="text/plain"> 里的内容不能含 </script>，否则浏览器会当场截断
  if (/<\/script/i.test(raw)) {
    throw new Error("RULES_SPEC.md 里出现了 </script，不能原样嵌进 script 标签");
  }
  return raw;
}

/** 生成要写进 index.html 的那一段（含首尾标记行）。 */
export function renderBlock(rules) {
  return [
    BEGIN,
    "<!-- 由 _verify/embed-rules.mjs 从 Web_Gomoku3D/RULES_SPEC.md 生成，不要手改。",
    "     改了 RULES_SPEC.md 之后跑：node _verify/embed-rules.mjs -->",
    // type="text/plain" 的 script 不会被执行，浏览器把它当纯文本存着，
    // 页面里用 .textContent 就能拿到原文。比塞进 JS 字符串安全：
    // 反引号、${}、反斜杠都不需要转义。
    '<script type="text/plain" id="rulesSrc">',
    rules.replace(/\n$/, ""),   // 文件末尾那个换行由 </script> 前的换行补回来
    "</script>",
    END,
  ].join("\n");
}

/** 从 index.html 里取出当前嵌着的那段（不含首尾标记行）。不一致时返回 null。 */
export function extractEmbedded(html) {
  const i = html.indexOf(BEGIN);
  const j = html.indexOf(END);
  if (i < 0 || j < 0 || j <= i) return null;
  const inner = html.slice(i, j + END.length);
  const m = inner.match(/<script type="text\/plain" id="rulesSrc">\n([\s\S]*?)\n<\/script>/);
  return m ? m[1] + "\n" : null;   // 补回被 </script> 前那个换行占掉的一个
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const rules = readRules();
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const block = renderBlock(rules);

  const i = html.indexOf(BEGIN);
  const j = html.indexOf(END);
  if (i < 0 || j < 0) {
    console.error("index.html 里找不到 " + BEGIN + " / " + END + " 标记。");
    console.error("这两个标记是一次性的，必须先在文件里放好（见 Web_Gomoku3D/README.md）。");
    process.exit(2);
  }
  const next = html.slice(0, i) + block + html.slice(j + END.length);

  if (next === html) {
    console.log("已经是最新的：" + rules.split("\n").length + " 行 / " + rules.length + " 字符");
    return;
  }
  if (checkOnly) {
    console.error("index.html 里嵌的规则和 RULES_SPEC.md 不一致 —— 跑 node _verify/embed-rules.mjs 重新生成。");
    process.exit(1);
  }
  // newline="" 原样写回，不让 Windows 的文本模式把整份文件改成 CRLF
  fs.writeFileSync(HTML_PATH, next, { encoding: "utf8", newline: "" });
  console.log("已嵌入：" + rules.split("\n").length + " 行 / " + rules.length + " 字符");
}

// 直接运行时才执行 main（被 import 做测试时不跑）
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
