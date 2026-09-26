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
  // 【六种语言各一份】界面能切六种语言，规则浮层就得有六份正文 ——
  // 少一份的表现是"切到那种语言后点「具体规则」，看到的是英文/中文"，
  // 而不是报错。顺序必须和 index.html 里那六对标记的出现顺序一致（脚本会检查）。
  { key: "ja", srcPath: path.join(HERE, "..", "Web_Gomoku3D", "RULES_SPEC.ja.md"),
    srcRel: "Web_Gomoku3D/RULES_SPEC.ja.md",
    begin: "<!-- RULES-EMBED-JA-BEGIN -->", end: "<!-- RULES-EMBED-JA-END -->", id: "rulesSrcJa" },
  { key: "ko", srcPath: path.join(HERE, "..", "Web_Gomoku3D", "RULES_SPEC.ko.md"),
    srcRel: "Web_Gomoku3D/RULES_SPEC.ko.md",
    begin: "<!-- RULES-EMBED-KO-BEGIN -->", end: "<!-- RULES-EMBED-KO-END -->", id: "rulesSrcKo" },
  { key: "ru", srcPath: path.join(HERE, "..", "Web_Gomoku3D", "RULES_SPEC.ru.md"),
    srcRel: "Web_Gomoku3D/RULES_SPEC.ru.md",
    begin: "<!-- RULES-EMBED-RU-BEGIN -->", end: "<!-- RULES-EMBED-RU-END -->", id: "rulesSrcRu" },
  { key: "fr", srcPath: path.join(HERE, "..", "Web_Gomoku3D", "RULES_SPEC.fr.md"),
    srcRel: "Web_Gomoku3D/RULES_SPEC.fr.md",
    begin: "<!-- RULES-EMBED-FR-BEGIN -->", end: "<!-- RULES-EMBED-FR-END -->", id: "rulesSrcFr" },
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
  if (!/\n$/.test(raw)) {
    // 末尾少了这一个换行不会报任何错，但会同时坏掉两件事：
    //   · renderBlock 会去掉一个不存在的换行，--check 比对的是【替换结果】，
    //     于是它照样打印"已经是最新的"，而嵌进去的正文其实少了一行；
    //   · dom-smoke 那条逐字节断言会红，而它给出的修法（重跑生成）是个死循环。
    // 所以在这里当场拦下来。
    throw new Error(doc.srcRel + " 末尾没有换行 —— 补上一个再嵌入" +
      "（少了它 --check 会误报“已经是最新的”，dom-smoke 却会红）");
  }
  // 【先查本工程自己的标记】它比下面那条更要紧，也更常见：标记自己就长着 `<!--`，
  // 放到后面查会被下面那条先拦下、报出一个容易误导的错。
  // 生成是按"本条 BEGIN 到本条 END"整段替换的，而 indexOf 找的是第一个 END ——
  // 正文里那一个会先被找到，切错位置之后每跑一次生成文件就长一截，
  // 而 --check 一直不通过、提示里那句"重新生成"正是让它继续长大的原因。
  for (const d of DOCS) {
    if (raw.indexOf(d.begin) >= 0 || raw.indexOf(d.end) >= 0) {
      throw new Error(doc.srcRel + " 正文里出现了嵌入标记（" + d.begin + " / " + d.end +
        "）—— 生成时会被当成真正的标记切错位置，每跑一次文件就变大一点");
    }
  }
  // 【只查 </script 是不够的】HTML 的 script-data 分词器还有另外两个状态：
  //   正文里出现 `<!--` 会切到 escaped 状态，其中再出现 `<script`（后面跟空格、`/` 或 `>`）
  //   会切到 **double escaped** —— 那个状态下 `</script>` **不再关闭元素**。
  // 后果不是"规则少了一半"，而是从这个 script 开始、一直到文件末尾全被吞进这一块：
  // 主游戏脚本（十几万字符）会整段消失，页面只剩一个空壳，而生成器和 --check 都报成功
  // （它们只看字节，分词器怎么读它们看不见）。只有跑真浏览器的第 8 步能发现，
  // 而它报的是 `Renderer is not defined` 之类离现场很远的错。
  // 三道一起查才闭合：这一份是纯文本规则，三种都不该出现。
  const bad = [[/<\/script/i, "</script"], [/<!--/, "<!--"], [/<script/i, "<script"]]
    .find(([re]) => re.test(raw));
  if (bad) {
    throw new Error(doc.srcRel + " 里出现了 " + bad[1] +
      " —— 它会改变浏览器对 <script> 的分词方式（`<!--` 加 `<script` 会让下一个 </script> 失效，" +
      "整份页面被吞掉），不能原样嵌进 script 标签");
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
    // 【每个标记必须只出现一次】这条不是洁癖：多出来的那一个（合并冲突、手滑粘两遍、
    // 或者误把标记写进正文）会让"从 BEGIN 切到 END"切在错的地方 —— 最坏的一种是
    // BEGIN 后面紧跟一个 END，替换之后其余内容被推到标记外面，变成页面上一大片
    // 可见的规则原文，而生成器报成功、--check 从此也认为"已经是最新的"，
    // 因为之后的比对都是拿【已经被弄坏的结果】当基准。
    for (const m of [doc.begin, doc.end]) {
      if (html.indexOf(m) !== html.lastIndexOf(m)) {
        throw new Error("index.html 里 " + m + " 出现了不止一次 —— " +
          "生成时按第一个/最后一个切会切错位置，而且生成完 --check 会把坏掉的结果当成基准。" +
          "先确保四个标记各只出现一次。");
      }
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

  // 【目标文件的行尾也要查】上面只查了两个源文件。index.html 要是被别人（某个编辑器）
  // 整份转成了 CRLF，生成写回的是 LF 的规则块、其余部分是 CRLF —— 一份文件混着两种行尾，
  // 而写回之后 --check 报"已经是最新的"、dom-smoke 也绿，没有任何东西会再提起这件事。
  if (html.indexOf("\r") >= 0) {
    console.error("index.html 里出现了 CR（CRLF）—— 这个工程全是 LF。");
    console.error("先把它统一回 LF 再生成，否则嵌入的规则块是 LF、文件其余部分是 CRLF。");
    process.exit(2);
  }

  let next = html;
  const stats = [];
  try {
    for (const doc of DOCS) {
      const rules = readRules(doc);
      stats.push(doc.key + "：" + rules.split("\n").length + " 行 / " + rules.length + " 字符");
      // 每条都从【当前结果】里现找位置：切掉一条之后后面那条的下标会变，
      // 拿循环外算好的下标去切就会切错地方。
      const i = next.indexOf(doc.begin);
      const j = next.indexOf(doc.end);
      next = next.slice(0, i) + renderBlock(doc, rules) + next.slice(j + doc.end.length);
    }
  } catch (e) {
    // 上面那些 throw 都是写给人的（缺文件、CRLF、</script、多出来的标记…），
    // 不接住的话 Node 会打一整段堆栈，真正的说明反而被埋起来。
    console.error(e.message);
    process.exit(2);
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
