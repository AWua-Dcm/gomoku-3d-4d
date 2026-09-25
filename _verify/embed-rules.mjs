// 把 RULES_SPEC.md / RULES_SPEC.en.md 的全文嵌进 Web_Gomoku3D/index.html。
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
// 所以：正文只此一份（每种语言各一个源文件），index.html 里那段是【生成物】，
// 由这个脚本写入，并由 tests/dom-smoke.test.mjs 断言"逐字节等于源文件"。
// 改了源文件之后跑一次这个脚本即可；忘了跑，测试会红。
//
// 【两对标记，不是一对】：界面能切语言，规则浮层就得有两种语言的正文。
// 两对标记各带各的 id（#rulesSrc / #rulesSrcEn），openRules() 按当前语言取。
// 这里最容易出事的一点写在 DOCS 下面那条顺序检查里。
//
// 用法：
//   node _verify/embed-rules.mjs          # 重新生成
//   node _verify/embed-rules.mjs --check  # 只检查是否一致（不写文件），不一致就退出码 1

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const HTML_PATH = path.join(HERE, "..", "Web_Gomoku3D", "index.html");

/**
 * 两种语言各一条。顺序【就是】它们必须出现在 index.html 里的顺序。
 *
 * 【为什么英文那条必须整个排在中文那条的 END 之后】：重新生成是按
 * "从本条的 BEGIN 切到本条的 END" 替换的。英文块要是落在中文那对的中间，
 * 生成一次就会把它整段删掉 —— 而 --check 那一遍是比对【替换结果】，
 * 替换把它删了、比对自然也认为"一致"，于是删掉这件事没有任何东西会报警。
 * 所以下面有 checkOrder() 把"顺序不对"变成当场退出，而不是等生成时静默吃掉。
 */
export const DOCS = [
  {
    key: "zh",
    srcPath: path.join(HERE, "..", "Web_Gomoku3D", "RULES_SPEC.md"),
    srcRel: "Web_Gomoku3D/RULES_SPEC.md",
    begin: "<!-- RULES-EMBED-BEGIN -->",
    end: "<!-- RULES-EMBED-END -->",
    id: "rulesSrc",
  },
  {
    key: "en",
    srcPath: path.join(HERE, "..", "Web_Gomoku3D", "RULES_SPEC.en.md"),
    srcRel: "Web_Gomoku3D/RULES_SPEC.en.md",
    begin: "<!-- RULES-EMBED-EN-BEGIN -->",
    end: "<!-- RULES-EMBED-EN-END -->",
    id: "rulesSrcEn",
  },
];

/**
 * 读源文件。用二进制读再按 UTF-8 解码，行尾统一成 LF ——
 * 这个工程全是 LF，任何一处悄悄变成 CRLF 都会让"逐字节相等"的断言变得毫无意义。
 *
 * 两种语言的文档【都要过这两道检查】，不是只查中文那份：英文那份同样是嵌进
 * <script type="text/plain"> 的，同样一个 </script 就会让浏览器当场截断，
 * 而截断之后页面只是规则少了一半，不会报错。
 */
export function readRules(doc = DOCS[0]) {
  const raw = fs.readFileSync(doc.srcPath, "utf8");
  if (raw.indexOf("\r\n") >= 0 || /\r(?!\n)/.test(raw)) {
    throw new Error(doc.srcRel + " 里出现了 CRLF —— 这个工程用 LF，先统一行尾再嵌入");
  }
  if (/<\/script/i.test(raw)) {
    throw new Error(doc.srcRel + " 里出现了 </script，不能原样嵌进 script 标签");
  }
  return raw;
}

/** 生成要写进 index.html 的那一段（含首尾标记行）。 */
export function renderBlock(doc, rules) {
  return [
    doc.begin,
    "<!-- 由 _verify/embed-rules.mjs 从 " + doc.srcRel + " 生成，不要手改。",
    "     改了 " + doc.srcRel + " 之后跑：node _verify/embed-rules.mjs -->",
    // type="text/plain" 的 script 不会被执行，浏览器把它当纯文本存着，
    // 页面里用 .textContent 就能拿到原文。比塞进 JS 字符串安全：
    // 反引号、${}、反斜杠都不需要转义。
    '<script type="text/plain" id="' + doc.id + '">',
    rules.replace(/\n$/, ""),   // 文件末尾那个换行由 </script> 前的换行补回来
    "</script>",
    doc.end,
  ].join("\n");
}

/** 从 index.html 里取出本条当前嵌着的那段（不含首尾标记行）。不一致时返回 null。 */
export function extractEmbedded(html, doc = DOCS[0]) {
  const i = html.indexOf(doc.begin);
  const j = html.indexOf(doc.end);
  if (i < 0 || j < 0 || j <= i) return null;
  const inner = html.slice(i, j + doc.end.length);
  const re = new RegExp('<script type="text\\/plain" id="' + doc.id + '">\\n([\\s\\S]*?)\\n<\\/script>');
  const m = inner.match(re);
  return m ? m[1] + "\n" : null;   // 补回被 </script> 前那个换行占掉的一个
}

/**
 * 标记顺序必须是 DOCS 的顺序，一条也不能套在另一条里面。
 * 顺序错了 → 生成时会静默吃掉后面那条，所以这里当场报错。
 */
export function checkOrder(html) {
  let prevEnd = -1;
  for (const doc of DOCS) {
    const i = html.indexOf(doc.begin);
    const j = html.indexOf(doc.end);
    if (i < 0 || j < 0 || j <= i) {
      throw new Error("index.html 里找不到成对的 " + doc.begin + " / " + doc.end + " 标记");
    }
    if (i < prevEnd) {
      throw new Error(doc.srcRel + " 的那对标记排在了前一条的 END 之前 —— " +
        "重新生成会把它整段吃掉，而且 --check 不会察觉。把它挪到前一条 END 的后面。");
    }
    prevEnd = j + doc.end.length;
  }
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const html = fs.readFileSync(HTML_PATH, "utf8");

  try {
    checkOrder(html);
  } catch (e) {
    console.error(e.message);
    console.error("这两个标记是一次性的，必须先按 DOCS 的顺序在文件里放好（见 Web_Gomoku3D/README.md）。");
    process.exit(2);
  }

  let next = html;
  const stats = [];
  for (const doc of DOCS) {
    const rules = readRules(doc);
    stats.push(doc.key + "：" + rules.split("\n").length + " 行 / " + rules.length + " 字符");
    // 每条都从【当前结果】里现找位置：切掉一条之后后面那条的下标会变，
    // 拿循环外算好的下标去切就会切错地方。
    const i = next.indexOf(doc.begin);
    const j = next.indexOf(doc.end);
    next = next.slice(0, i) + renderBlock(doc, rules) + next.slice(j + doc.end.length);
  }

  if (next === html) {
    console.log("已经是最新的 —— " + stats.join("；"));
    return;
  }
  if (checkOnly) {
    console.error("index.html 里嵌的规则和源文件不一致 —— 跑 node _verify/embed-rules.mjs 重新生成。");
    process.exit(1);
  }
  // newline="" 原样写回，不让 Windows 的文本模式把整份文件改成 CRLF
  fs.writeFileSync(HTML_PATH, next, { encoding: "utf8", newline: "" });
  console.log("已嵌入 —— " + stats.join("；"));
}

// 直接运行时才执行 main（被 import 做测试时不跑）
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
