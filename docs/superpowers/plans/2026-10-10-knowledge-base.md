# 工程知识库（Obsidian）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给仓库建 Obsidian 工程知识库：`知识库/` 下 42 条互相链接的笔记（五类）+ 首页 + 词汇表，根 `CLAUDE.md` 维护约定，`_verify/kb-links.mjs` 链接完整性检查，并把 18 条工程类 Claude 记忆收编为指针。

**Architecture:** 仓库根即 Obsidian vault（零插件零依赖）：首页是 42 条链接的全量索引，按类灌内容时用 `kb-links.mjs` 的「悬空」计数当进度尺（42 → 0）。笔记只组织信息、不复制现有文档（能说明问题的链接过去）。记忆收编在仓库外（`~/.claude` 记忆目录）单独一步，不产生 git 提交。

**Tech Stack:** Markdown + Obsidian wikilink（无插件）；`_verify/kb-links.mjs` 用 Node 24 ESM、零依赖（本机 v24.19.0）；Git Bash 跑检查。

**Spec:** `docs/superpowers/specs/2026-10-10-knowledge-base-design.md`

## Global Constraints

- **零依赖、无插件**：知识库只用 Obsidian 核心功能（文件夹 + wikilink + 锚点）；脚本只用 `node:` 内置模块，不许 `npm install`。
- **不抄写**：现有文档（README / RULES_SPEC / Web_Gomoku3D/README / 打开流程 / ONLINE / spec）一个字不改、正文不进知识库；能说明问题的**链接过去**。
- **文件命名**：中文短语；禁用字符 `[ ] # ^ | : / \`；笔记 H1 与文件名一致。
- **笔记形态**：半屏到一屏、结论先行；决策类＝结论/为什么/代价与边界/证据，坑类＝症状/原因/规矩/出处；出处必须可查（提交号或文档章节），**涉及提交号与数字的，落笔前回源核对，不许照抄本计划的表述**。
- **锚点规矩**：写 `#锚点` 前先 `grep -n '^#' <目标文件>` 拿到标题清单，逐字使用。
- **公开边界**：4 条留记忆的条目（`ask-before-expanding-scope`、`cleanup-keep-preferences`、`npm12-allow-scripts-leaves-claude-stub`、`npmjs-direct-ok-proxy-stale`）**不进库**；spec 对照表里用户划掉的条目不做。
- **每完成一个 Task 单独提交**，commit message 里写上当时 `kb-links` 的悬空计数（这个仓库的既有做法）。
- **不碰**：`tests/vectors.json`、`tests/rotation-vectors.json`、`Web_Gomoku3D/` 任何文件、`_verify/run-all.sh`；**不跑 `run-all.sh`**（按已知行为第 8 步会重拍 shots 基线图，与本次无关的噪声会混进 git status）。
- **记忆目录**（Task 8 只动这里，不进 git）：`C:\Users\Lenovo\.claude\projects\d--Lenovo-OfficeSoft-VS-Code-My-project\memory\`。
- **推送 GitHub 不在本计划范围**：完成后单独问用户（推送要走代理）。

## Review Focus

规格没有明说、但最可能出事的地方。每条都在下面的 Task 里有对应检查：

1. **写成"第二次抄写"**——与原文逐句重合就是失败；只允许"重述 + 新组织 + 链接"。Task 3–7 每篇按"不粘贴"执行，Task 9 抽查 5 篇核对。
2. **出处错 / 数字过时**——提交号、实测数字、断言总数都有漂的风险；执行时逐条回源（`git show` / 打开文档），Task 9 抽查。
3. **链接形态不对**——`[[README]]` 撞上两个同名文件、锚点文本差一个字、文件名里混进禁用字符；`kb-links.mjs` 全程兜底（Task 1 夹具 5 例 + Task 9 真库自证会红）。
4. **公开边界失守**——4 条留记忆的条目、用户划掉的条目不得出现在 `知识库/`；Task 9 有专门的关键词扫描。
5. **记忆指针化搞坏召回**——指针必须保留"什么时候用得上"的一句话 + 明确目标；Task 8 有读回验证。
6. **Obsidian 里实际打开效果差**（首页链接落点、图谱观感）——Task 9 由用户实开验收；README 重名链接若落点不对，改用相对 md 链接（`[README](../README.md)`），`kb-links` 同样会检查它。

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `_verify/kb-links.mjs` | 知识库链接完整性检查（悬空/歧义/锚点/孤儿） | 新建（Task 1） |
| `知识库/首页.md` | 全量索引（42 条笔记直链）+ 常去的地方 + 给 Claude 的话 | 新建（Task 2） |
| `知识库/词汇表.md` | 项目黑话一句话版 | 新建（Task 2） |
| `CLAUDE.md` | 维护约定（进公开仓库） | 新建（Task 2） |
| `.gitignore` | 追加 `.obsidian/` | 修改（Task 2） |
| `知识库/决策/*.md` | 14 条"为什么" | 新建（Task 3） |
| `知识库/坑/*.md` | 12 条坑 | 新建（Task 4） |
| `知识库/验证/*.md` | 5 条证据体系 | 新建（Task 5） |
| `知识库/历史/*.md` | 6 条脉络 | 新建（Task 6） |
| `知识库/待办/*.md` | 5 条欠账 | 新建（Task 7） |
| `~/.claude/.../memory/` 18 条 + `MEMORY.md` | 记忆指针化（仓库外） | 修改（Task 8） |

悬空计数的用法：Task 2 结束时**精确等于 42**（首页对 42 条未建笔记的链接——此时还没有任何笔记，不存在笔记间的前向链接）；之后每类任务把对应笔记建出来，中间态的**明细**里只应剩下"尚未创建的那些笔记"（含笔记之间的前向链接，所以中间态不报精确数字，只查明细）；出现计划之外的陌生目标名＝链接写错；Task 7 结束时必须**全零**。

---

### Task 1: 链接检查器 `_verify/kb-links.mjs`

**Files:**
- Create: `_verify/kb-links.mjs`

**Interfaces:**
- Produces: 命令行 `node _verify/kb-links.mjs [--root <目录>]`（默认 root＝仓库根）。扫描 `<root>/知识库/**/*.md`，输出一行 `知识库：文件 N / 链接 M / 悬空 X / 歧义 Y / 锚点 A / 孤儿 Z`，失败附逐条明细；任何非零计数 → exit 1，全绿 → exit 0。后续所有 Task 拿它当门（`--root` 供夹具自测）。（输出比 spec §八 多一个「锚点」计数——spec 要求查锚点但输出格式只列了四项，这里把锚点失败数单列出来便于诊断，其余与 spec 一致。）
- Consumes: 无。

- [ ] **Step 1: 先建夹具 A（干净，3 篇笔记）——测试先行**

```bash
cd "D:/Lenovo/OfficeSoft/VS Code/My project"
rm -rf .kb-fixtures && mkdir -p ".kb-fixtures/知识库/决策" ".kb-fixtures/知识库/坑"
printf '# 首页\n\n[[决策/AAA]]\n[[坑/BBB]]\n' > ".kb-fixtures/知识库/首页.md"
printf '# AAA\n\n[[坑/BBB]]\n' > ".kb-fixtures/知识库/决策/AAA.md"
printf '# BBB\n\n[[决策/AAA]]\n' > ".kb-fixtures/知识库/坑/BBB.md"
```

- [ ] **Step 2: 跑（还不存在的）脚本，确认它红**

Run: `node _verify/kb-links.mjs --root .kb-fixtures; echo "exit=$?"`
Expected: `Cannot find module ...kb-links.mjs`，exit=1

- [ ] **Step 3: 写 `_verify/kb-links.mjs`（完整代码）**

```js
#!/usr/bin/env node
// kb-links.mjs —— 工程知识库的链接完整性检查（零依赖，Node ESM）。
//
// 扫「知识库/**/*.md」里的两类链接，目标必须真实存在：
//   · wikilink：[[目标]]、[[目标|别名]]、[[目标#锚点]]、![[…]]
//   · markdown 链接：[文字](相对路径)
// 解析规矩（与 Obsidian 对齐，见 知识库/首页.md 的"链接规矩"）：
//   · 带 / 的按路径后缀匹配（唯一才算数）；不带 / 的先看库根同名文件，
//     再看全库文件名（唯一才算数；≥2 命中报「歧义」）
//   · #锚点 按目标文件的标题文本精确匹配；^块引用不支持，出现即报
//   · 除 知识库/首页.md 外，每篇笔记必须至少被另一篇笔记链到（孤儿检查）
//   · 围栏代码块与行内代码里的 [[…]] 不算（示例不参与检查）
//
// 用法: node _verify/kb-links.mjs [--root <目录>]   （--root 供夹具自测）
// 输出: 知识库：文件 N / 链接 M / 悬空 X / 歧义 Y / 锚点 A / 孤儿 Z
// 任何非零计数 → 附逐条明细并 exit 1；全绿 exit 0。
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const rootIdx = args.indexOf('--root');
const ROOT = rootIdx === -1 ? path.resolve(import.meta.dirname, '..') : path.resolve(args[rootIdx + 1]);
const KB = path.join(ROOT, '知识库');
if (!fs.existsSync(KB)) {
  console.error(`找不到知识库目录：${KB}`);
  process.exit(1);
}
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const noExt = (s) => s.replace(/\.md$/i, '');

// ---------- 建索引：跳过点开头目录与 node_modules ----------
function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.isFile()) out.push(p);
  }
  return out;
}
const vaultFiles = walk(ROOT).sort();
const kbNotes = vaultFiles.filter((p) => p.startsWith(KB + path.sep) && p.endsWith('.md'));
const isKbNote = (p) => p.startsWith(KB + path.sep) && p.endsWith('.md');
const HOME = path.join(KB, '首页.md');

// ---------- 剥代码：示例里的 [[…]] 不算链接 ----------
const stripCode = (md) =>
  md.replace(/```[\s\S]*?```/g, '').replace(/~~~[\s\S]*?~~~/g, '').replace(/`[^`\n]*`/g, '');

// ---------- wikilink 目标解析 ----------
function resolveWiki(target) {
  const t = noExt(target.replace(/^\.\//, '')).trim();
  // 1) 库根精确路径优先（解决根 README 与 Web_Gomoku3D/README 重名）
  for (const cand of [path.join(ROOT, t), path.join(ROOT, t + '.md')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return { ok: true, file: cand };
  }
  if (t.includes('/')) {
    const hits = vaultFiles.filter((p) => {
      const r = noExt(rel(p));
      return r === t || r.endsWith('/' + t);
    });
    if (hits.length === 1) return { ok: true, file: hits[0] };
    return { ok: false, kind: hits.length === 0 ? '悬空' : '歧义', hits };
  }
  const hits = vaultFiles.filter((p) => {
    const b = path.basename(p);
    return b === t || b === t + '.md';
  });
  if (hits.length === 1) return { ok: true, file: hits[0] };
  return { ok: false, kind: hits.length === 0 ? '悬空' : '歧义', hits };
}

// ---------- 标题清单（锚点检查用） ----------
const headingCache = new Map();
function headingTexts(file) {
  if (!headingCache.has(file)) {
    const md = stripCode(fs.readFileSync(file, 'utf8'));
    headingCache.set(file, [...md.matchAll(/^#{1,6}[ \t]+(.+?)[ \t]*$/gm)].map((m) => m[1]));
  }
  return headingCache.get(file);
}

// ---------- 主循环 ----------
let linkCount = 0;
const dangling = [], ambiguous = [], anchorBad = [];
const linkedTo = new Set();

for (const note of kbNotes) {
  const text = stripCode(fs.readFileSync(note, 'utf8'));

  for (const m of text.matchAll(/!?\[\[([^\[\]]+?)\]\]/g)) {
    linkCount++;
    const raw = m[1];
    const bar = raw.indexOf('|');
    let tgt = (bar === -1 ? raw : raw.slice(0, bar)).trim();
    let anchor = null;
    const hash = tgt.indexOf('#');
    if (hash !== -1) {
      anchor = tgt.slice(hash + 1).trim();
      tgt = tgt.slice(0, hash).trim();
    }
    if (tgt === '') tgt = path.basename(note, '.md'); // [[#锚点]] → 本篇
    const res = resolveWiki(tgt);
    if (!res.ok) {
      (res.kind === '歧义' ? ambiguous : dangling).push({ raw, source: note, hits: res.hits });
      continue;
    }
    if (isKbNote(res.file) && res.file !== note) linkedTo.add(res.file);
    if (anchor && (anchor.startsWith('^') || !headingTexts(res.file).includes(anchor))) {
      anchorBad.push({ raw, source: note });
    }
  }

  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    let href = m[1];
    if (/^(https?:|mailto:|#|\/\/)/.test(href)) continue;
    linkCount++;
    const hash = href.indexOf('#');
    if (hash !== -1) href = href.slice(0, hash);
    if (href === '') continue;
    const abs = path.resolve(path.dirname(note), href);
    if (!fs.existsSync(abs)) dangling.push({ raw: href, source: note });
    else if (isKbNote(abs) && abs !== note) linkedTo.add(abs);
  }
}

// ---------- 孤儿与报告 ----------
const orphans = kbNotes.filter((p) => p !== HOME && !linkedTo.has(p));
console.log(
  `知识库：文件 ${kbNotes.length} / 链接 ${linkCount} / 悬空 ${dangling.length} / ` +
  `歧义 ${ambiguous.length} / 锚点 ${anchorBad.length} / 孤儿 ${orphans.length}`
);
for (const d of dangling) console.log(`  悬空: [[${d.raw}]]  ← ${rel(d.source)}`);
for (const a of ambiguous) console.log(`  歧义: [[${a.raw}]]（命中：${a.hits.map(rel).join('、')}）  ← ${rel(a.source)}`);
for (const a of anchorBad) console.log(`  锚点: [[${a.raw}]]  ← ${rel(a.source)}`);
for (const o of orphans) console.log(`  孤儿: ${rel(o)}（没有任何笔记链接它）`);
process.exit(dangling.length + ambiguous.length + anchorBad.length + orphans.length === 0 ? 0 : 1);
```

- [ ] **Step 4: 跑夹具 A —— 全绿**

Run: `node _verify/kb-links.mjs --root .kb-fixtures; echo "exit=$?"`
Expected:
```
知识库：文件 3 / 链接 4 / 悬空 0 / 歧义 0 / 锚点 0 / 孤儿 0
exit=0
```

- [ ] **Step 5: 夹具 B —— 悬空**

```bash
printf '# 首页\n\n[[决策/AAAx]]\n[[坑/BBB]]\n' > ".kb-fixtures/知识库/首页.md"
node _verify/kb-links.mjs --root .kb-fixtures; echo "exit=$?"
```
Expected: `悬空 1`（明细 `[[决策/AAAx]] ← 知识库/首页.md`），exit=1，其余 0。

- [ ] **Step 6: 夹具 C —— 歧义 + 连带孤儿**

```bash
printf '# 首页\n\n[[决策/AAA]]\n[[坑/BBB]]\n' > ".kb-fixtures/知识库/首页.md"
printf '# CCC\n' > ".kb-fixtures/知识库/决策/CCC.md"
printf '# CCC\n' > ".kb-fixtures/知识库/坑/CCC.md"
printf '# BBB\n\n[[CCC]]\n' > ".kb-fixtures/知识库/坑/BBB.md"
node _verify/kb-links.mjs --root .kb-fixtures; echo "exit=$?"
```
Expected: `文件 5 / 悬空 0 / 歧义 1 / 锚点 0 / 孤儿 2` —— 两个 CCC 因为链接歧义收不到入链所以报孤儿，exit=1。

- [ ] **Step 7: 夹具 D —— 锚点不匹配**

```bash
rm ".kb-fixtures/知识库/决策/CCC.md" ".kb-fixtures/知识库/坑/CCC.md"
printf '# BBB\n\n[[决策/AAA]]\n' > ".kb-fixtures/知识库/坑/BBB.md"
printf '# 首页\n\n[[决策/AAA]]\n[[坑/BBB]]\n[[决策/AAA#不存在的节]]\n' > ".kb-fixtures/知识库/首页.md"
node _verify/kb-links.mjs --root .kb-fixtures; echo "exit=$?"
```
Expected: `文件 3 / 链接 5 / 悬空 0 / 歧义 0 / 锚点 1 / 孤儿 0`，exit=1。

- [ ] **Step 8: 夹具 E —— 孤儿 + 锚点正例**

```bash
printf '# 首页\n\n[[决策/AAA]]\n[[坑/BBB]]\n[[决策/AAA#AAA]]\n' > ".kb-fixtures/知识库/首页.md"
printf '# DDD\n\n没有入链。\n' > ".kb-fixtures/知识库/坑/DDD.md"
node _verify/kb-links.mjs --root .kb-fixtures; echo "exit=$?"
```
Expected: `文件 4 / 链接 5 / 悬空 0 / 歧义 0 / 锚点 0 / 孤儿 1`（`#AAA` 锚点在、DDD 无入链），exit=1。

- [ ] **Step 9: 清理夹具，跑真库**

```bash
rm -rf .kb-fixtures
node _verify/kb-links.mjs; echo "exit=$?"
```
Expected: `找不到知识库目录：…知识库`，exit=1 —— 正常，知识库还没建。

- [ ] **Step 10: 提交**

```bash
git add _verify/kb-links.mjs
git status --short   # 确认没有 .kb-fixtures 残留
git commit -m "知识库：链接完整性检查 kb-links.mjs（夹具自测 5 例）"
```

---

### Task 2: 骨架（.gitignore、CLAUDE.md、首页、词汇表）

**Files:**
- Modify: `.gitignore`（末尾追加）
- Create: `CLAUDE.md`、`知识库/首页.md`、`知识库/词汇表.md`

**Interfaces:**
- Consumes: Task 1 的 `kb-links.mjs`（本任务起每次跑都附上计数）。
- Produces: 首页的 42 条笔记链接（后续 Task 3–7 逐类把它从「悬空」变成「已解析」）；`.obsidian/` 的 ignore 规则。

- [ ] **Step 1: `.gitignore` 末尾追加（用 Edit 在文件最后一行 `_verify/.chrome-profile/` 之后加）**

```
# Obsidian 打开仓库根当 vault 时生成（工具配置不进库，同 .vscode/）
.obsidian/
```

验证：`git check-ignore -v .obsidian/workspace.json` → 输出里含 `.gitignore:…:.obsidian/`。

- [ ] **Step 2: 新建 `CLAUDE.md`（完整内容）**

```markdown
# 给 Claude 的约定

- 仓库有一份工程知识库在 `知识库/`（用 Obsidian 打开仓库根即可浏览，不用装插件）。
- 动手前先读 `知识库/首页.md` —— 设计决策、踩过的坑、验证方法都在里面。
- 做完非平凡改动、做出新决策、踩到新坑时，把"为什么"补进知识库对应分类；
  现有文档 / 代码注释已写清的，链接过去，不要抄写。
- 改完知识库跑 `node _verify/kb-links.mjs`。
```

- [ ] **Step 3: 新建 `知识库/首页.md`（完整内容）**

````markdown
# 五子魔方 · 工程知识库

三维 / 四维五子棋，单文件网页版，零依赖。玩家向说明：[[README|README]]（[[README.en|English]]）；
工程细节（架构、证据边界、已知限制）：[[Web_Gomoku3D/README|Web_Gomoku3D/README]]。

> **给 Claude 会话**：动手前先读这一页；找"为什么"进 `决策/`，踩坑前查 `坑/`，
> 改完把新的"为什么"写回对应分类（约定见 [[CLAUDE.md|根 CLAUDE.md]]）。
> 链接规矩：重名文件用路径式（`[[Web_Gomoku3D/README]]`）；代码文件写路径文本，不指望点开。

## 🎯 决策 —— 为什么是这样

- [[决策/单文件零依赖]] —— 全部代码一个文件；内核一段三处跑
- [[决策/先手恰好五连]] —— 长连负；后手 ≥5 即胜
- [[决策/四维必须立方]] —— 不是"没做"
- [[决策/转动两步走]] —— 先预览后落地；落地只有一条路径
- [[决策/转动按威胁触发]] —— 电脑只在拆得掉威胁时才转
- [[决策/视角操作不做惯性]] —— 跟手指走；松手即停是刻意的
- [[决策/默认中文不猜语言]] —— 切换不是猜；列表不是循环
- [[决策/中文原文留在 HTML]] —— 中文只有一份；内核 CORE_TEXT 是真实代价
- [[决策/规则全文是生成的]] —— 改 md 要重嵌，别手改 HTML
- [[决策/单文件里塞书法字体]] —— OFL 子集化内联；改文案要重切
- [[决策/AI 评估按方向数威胁]] —— 以及三条"量过没留"的变强路
- [[决策/贯通看得见]] —— 判定＝周期空间；影子圈让它看得见
- [[决策/仓库不收工具链内容]] —— skill 清单为什么不在这里
- [[决策/古风视觉的规矩]] —— 再做视觉之前先读这一篇

## ⚠️ 坑 —— 掉进去过，还会再掉

- [[坑/冻结向量不能改]] —— 改它＝篡改证据
- [[坑/路径里的空格会静默失败]] —— 命令看着跑了，其实什么都没发生
- [[坑/python 改文件会 CRLF 化]] —— 症状出现在别处
- [[坑/ev() 里别写反引号]] —— 症状是 JSON.parse(undefined)
- [[坑/fixed 只写 top50 会截高度]] —— 竖排文字因此断句
- [[坑/宋体会把西里尔画成全角]] —— 俄语宽 60% 的元凶
- [[坑/起始界面高度预算极紧]] —— 法语是约束边界
- [[坑/截图对拍先钉住会动的东西]] —— 先量噪声底
- [[坑/shots 基线图的真假判定]] —— 对拍表随环境变
- [[坑/自对局量棋力必须配对]] —— 对照组不是 50.0% 就别信
- [[坑/推送 GitHub 与 Pages 验证]] —— 代理、`-c` 的位置、查序
- [[坑/curl 抓大文件看退出码]] —— 半截文件伪装成"线上被改"

## 🔬 验证 —— 凭什么说它是对的

- [[验证/九步与断言地图]] —— 41036 项都是什么
- [[验证/browser-check 解剖]] —— 真实浏览器里查什么
- [[验证/注入验证]] —— 证不了会红＝没测
- [[验证/假测试的两起案例]] —— 只测一半、先摆状态
- [[验证/证据的分级]] —— 已验 / 无法验 / 我认为对

## 📜 历史 —— 现在为什么长这样

- [[历史/从 Unity 到单文件]] —— 提"C# 内核"的地方怎么读
- [[历史/版本脉络]] —— v1.0.0 → v3.1.7 的转折
- [[历史/AI 棋力提升史]] —— 排序 bug、两次负收益实验
- [[历史/被否掉与被撤掉的东西]] —— 撤了什么、试过什么没留
- [[历史/视觉重构 v3.1.6]] —— 古风化与粒子层
- [[历史/代码质量审计]] —— 量过了，别再重做一遍

## 📌 待办 —— 还欠的活

- [[待办/AI 棋力欠账]] —— 70% 验收线未达；瓶颈是叶子评估
- [[待办/联机·页面未接线]] —— 服务器与测试就绪，页面没接
- [[待办/拓扑玩法的两档]] —— 可选拓扑 / 7 关旅程
- [[待办/已知限制里的取舍项]] —— 为什么留着不修
- [[待办/报告过没修的清单]] —— 等拍板的一批

## 🧭 常去的地方

- 玩：双击 `Web_Gomoku3D/index.html`（零依赖，不需要服务器）
- 跑测试：`bash _verify/run-all.sh`（九步，期望 41036 项全绿）
- 验收清单与未验证项：[[打开流程]]
- 规则全文（六语言）：[[RULES_SPEC]]
- 联机方案与取舍：[[ONLINE]]
- 项目黑话表：[[词汇表]]
````

- [ ] **Step 4: 新建 `知识库/词汇表.md`（完整内容；只链现有文档，不链尚未创建的笔记）**

````markdown
# 词汇表 · 项目黑话

规则术语的权威解释在 [[RULES_SPEC]]，实现术语在 [[Web_Gomoku3D/README|工程细节]]。
这里只收一句话版，给读知识库和代码注释的人垫底。

| 黑话 | 一句话 |
|---|---|
| 13 方向 | 三维棋盘上全部直线：3 轴向 + 6 面对角 + 4 体对角 |
| 长连负 | 先手方连成 ≥6 判负；后手 ≥5 即胜（见 [[RULES_SPEC]]） |
| 幽灵层 | 三维视图模式之一：非当前层的子画成半透明 |
| 切片 | 与幽灵层相对：只画当前层 |
| 相位 | 二维「晨昏」玩法里每颗子所属的时间状态（黎明 / 永夜） |
| 黎明 · 永夜 | 棋盘的两个相位，只有当前相位的连线算数 |
| 缓 · 催 | 落子时的宣告：缓＝把相位拖住一手，催＝推快一手（只挪不造） |
| 贯通 | 立方体六面打通（环面），五连可以跨过边界 |
| 影子圈 | 棋盘外紧贴的一圈：画出边界棋子的"续集"，让贯通看得见 |
| 转动冷却 | 四维下每落几手才允许转一层（落子才计数，转动不计数） |
| 算杀（VCT） | 连续冲四的强制取胜搜索，只走对手必须应的着 |
| 静止搜索 | 引擎工程术语：消除叶子评估奇偶偏差的扩展搜索（本项目还没做，见「AI 棋力欠账」那条笔记） |
| Zobrist · 置换表 | 局面散列与搜索缓存（极限档在用） |
| 演示盘 | 起始界面左侧那张缓慢自转的示例棋盘 |
| 教学关 | 起始界面按玩法生成的引导关卡（四维三关；三维按勾选的机制开） |
| 人机五档 | 低 / 中 / 高 / 极高 / 极限 |
````

- [ ] **Step 5: 跑链接检查（悬空 42，其余全零）**

Run: `node _verify/kb-links.mjs; echo "exit=$?"`
Expected: `知识库：文件 2 / 链接 <M> / 悬空 42 / 歧义 0 / 锚点 0 / 孤儿 0`，exit=1。
（M 是信息性数字，不必对齐；**悬空必须是 42**——首页对 42 条未创建笔记的各一条链接。若不等，对着 Step 3 的首页清单点一遍。）

- [ ] **Step 6: 提交**

```bash
git add .gitignore CLAUDE.md 知识库/
git commit -m "知识库：骨架（首页全量索引 + 词汇表 + CLAUDE.md + .gitignore）（悬空 42）"
```

---

### Task 3: 决策/ 14 条

**Files:**
- Create: `知识库/决策/` 下 14 个文件（名字与首页链接逐字一致）

**Interfaces:**
- Consumes: Task 2 首页里的 42 条链接（本任务把其中 14 条从悬空变已解析）、Task 1 的检查器。
- Produces: `知识库/决策/` 全部 14 篇；后续 Task 的笔记会反向链到它们。

**通用执行规矩（本任务每篇都适用）：**

- 按模板写：`**结论**` / `**为什么**` / `**代价与边界**` / `**证据**` 四段齐全（没有代价就写"无"）；H1 与文件名一致。
- **不粘贴**：现有文档的文字不进笔记；用自己的话重述"为什么"，证据段落用 `[[文档]]` 链接 + 一句"见哪一节"。
- 涉及提交号的先用 `git log --oneline --all | grep <关键词>` 或 `git show <短号>` 定位；涉及锚点的先 `grep -n '^#' Web_Gomoku3D/RULES_SPEC.md`（或目标文件）逐字取标题。**不许凭记忆写提交号。**
- 每篇结尾加一行 `相关：[[…]]`（本任务给出的链接）。

**14 篇的内容要点（写作依据，不是终稿）：**

1. `单文件零依赖.md` —— 结论：全部代码在 `Web_Gomoku3D/index.html` 一个文件；零依赖、零构建，双击即玩；GitHub Pages 发布的就是这份原件。为什么：file:// 直开；`/* GOMOKU-CORE-BEGIN/END */` 夹着纯规则内核（不引用 DOM/WebGL），同一份源码在浏览器、node 测试、将来当裁判的服务器三处跑，不存在"网页改了服务器忘改"。代价：近万行一个文件，改一次动全身；字体要子集内联（链第 10 篇）。证据：[[README]]「一个刻意的设计：单文件」节、[[Web_Gomoku3D/README]]。相关：[[决策/单文件里塞书法字体]]。
2. `先手恰好五连.md` —— 结论：先手（黑）必须恰好 5 连，≥6 判长连负；后手 ≥5 即胜。为什么：立体棋盘 13 方向、先手优势过大，这条把先手拉回平衡（精确表述与理由以 [[RULES_SPEC]] 长连负一节为准）。代价与边界：判定有优先序——一手同时造出五连和六连时长连优先（v3.1.7 修过「转动同时造出两种时按先扫到的线判」的 bug）；贯通下同一条绕边线不能数成两条。证据：[[RULES_SPEC]]、`git log` 里 v3.1.7（`00663be`）。
3. `四维必须立方.md` —— 结论：四维只允许立方盘，三维才可以长方体（8–30 不等长）。为什么：转层的"层"在长方体上没有良定义的转法（论证与细节见 [[Web_Gomoku3D/README]]「四维模式为什么必须立方（不是『没做』）」节）。代价与边界：贯通机制也因此没有"长方体 + 环面"的组合问题。证据：同节文档。相关：[[决策/转动两步走]]、[[决策/贯通看得见]]。
4. `转动两步走.md` —— 结论：点「执行转动」只**预览**（把棋盘转给你看，不记账、不占回合、不发事件）；「确定操作」才落地、「取消操作」转回去；`T` 键在预览期刻意不做确定（只弹提示），`Y` 或悔棋＝取消。为什么：转层是位置关系全变的大动作，先给玩家看清。代价与边界（承重墙）：确定＝先 `cancelPreviewRotate` 还原、再走原来的 `rotate(move)`，落地永远只有这一条路径；容易漏的四处——预览期禁落子、悔棋＝取消预览、开设置/新局要 `dropRotPreview()`、预览不发事件所以重画要自己调 `onBoardChanged(false)`。证据：v2.10.10 / v2.10.11 的 commit（用 git log 定位）、[[打开流程]] 验收表里四维那几行。相关：[[历史/被否掉与被撤掉的东西]]。
5. `转动按威胁触发.md` —— 结论：四维电脑只在两种情况下转：`brk`（对方有活三以上、转完真拆掉了）或 `build`（自己跨档建形且对方无威胁）；两条都必须**跨一整档**；铁律：转完不许给对方留活三以上。为什么：旧判据（带内最好一手变高就转）每局转 3 次、占回合 1/3、只有 1/3 真降威胁。实测：改后每局约 2 次、占 3–7%、100% 是"对方有活三时转的、转完真降了"。坑中坑：候选点集合 `cand` 是"已有子周围一圈"，转动会把子搬走，每次探针必须在转后的盘面上重算。证据：v2.10.9 的 commit、[[历史/AI 棋力提升史]]。相关：[[决策/转动两步走]]、[[历史/AI 棋力提升史]]。
6. `视角操作不做惯性.md` —— 结论：单指/左键旋转 + 双指/右键平移缩放（与 three.js OrbitControls 的 `ONE: ROTATE, TWO: DOLLY_PAN` 同款）；方向一律"内容跟着手指走"；极角夹 ±89.5°（离极点 0.5°）；**松手完全静止**（无惯性，刻意：选点精度优先）；双击＝复位。为什么有先例：OrbitControls 的 `enableDamping` 默认就是 false（"要么给开关"）；±89.5° 与 Babylon 默认 0.01rad 同量级。代价与边界："双击复位"不是 3D 查看器主流（主流双击＝聚焦，复位走显式入口）——我们保留了它，且复位按当前 aspect **重新取景**而不是回到写死的相机位；点击 vs 拖拽的 50px 阈值是应用层自定（平台基准 8–10pt）。证据：2026-09-26 调研记录、[[README]] 操作表。相关：[[历史/版本脉络]]。
7. `默认中文不猜语言.md` —— 结论：默认中文，不读 `navigator.language`；语言键点开是六种语言的**列表**（本族名，当前高亮），选择记 localStorage。为什么：要的是"切换"不是"猜"；调研结论——语言多于两种的主流做法全是列表、没有循环按钮（"languages aren't countries"）；零依赖单文件不引 i18n 库（`data-i18n` + 内联表就是主流做法；不 fetch JSON——file:// 下会被 CORS 挡）。代价与边界：file:// 下 localStorage 抛 SecurityError 要安静降级。证据：[[README]]「六种语言」节、调研出处（LanguageSwitcher 两个已读实现：hermes-agent 与 OpenMAIC——从 Claude 记忆 `language-switcher-research` 取，写进笔记后可查）。相关：[[决策/中文原文留在 HTML]]。
8. `中文原文留在 HTML.md` —— 结论：中文文案留在 HTML 里，外语进字符串表；切回中文＝把 HTML 里那份原文写回去。为什么：中文只有一份，不会"HTML 一份、表里一份"各自漂移。代价与边界（真实代价）：**规则内核里也有六种语言的文案**——内核要能被 server.js 和三个测试原样抽出去跑、叫不到界面文案，所以自带 `CORE_TEXT` 表；不传 `lang` 时逐字节等于从前（联机协议因此仍是中文）；单复数按语言选形（中文日韩无复数、英法两形且法语把 0 算单数、俄语三形且 11–19 归第三形）。规则只有一份，住在内核里。证据：[[Web_Gomoku3D/README]]「界面语言」各节。相关：[[决策/默认中文不猜语言]]。
9. `规则全文是生成的.md` —— 结论：页面上「具体规则」浮层显示的六份规则全文由 `_verify/embed-rules.mjs` 从六份 `RULES_SPEC*.md` 嵌进 index.html。为什么：手写两份必然漂移；生成器保证"改 md → 重嵌 → 页面跟着变"。代价与边界：改规则必须重跑 embed 并提交生成结果；起始界面因此不再提「RULES_SPEC.md」这个文件名（玩家不需要知道文件名）。证据：[[Web_Gomoku3D/README]]「规则全文：为什么它是生成的」节。相关：[[决策/单文件零依赖]]。
10. `单文件里塞书法字体.md` —— 结论：主标题的行书是 OFL 字体子集化后 base64 内联的（约 6.5KB，14→16 字），不放文件、不引 CDN。为什么：单文件 + file:// + 不发网络请求的前提；整支 CJK 字体是 5MB 级。代价与边界：**改水印/标题文案必须重新切子集**（新字渲染成豆腐块且不报错）；商业字体（华文行楷）只能当 CSS 兜底不能嵌进仓库；Canvas 里不用子集字体画字（混笔迹），子集只给 DOM 文本。证据：v3.1.6 的 commit（00663be 提到重切与 pyftsubset 命令）、[[Web_Gomoku3D/README]] 或 index.html 内注释。相关：[[决策/单文件零依赖]]、[[历史/视觉重构 v3.1.6]]。
11. `AI 评估按方向数威胁.md` —— 结论：叶子评估按**方向数威胁**（wins/fours/openFours/threes/twos/over）+ 量纲对齐，取代旧的 `max(各方向棋型分)`（几乎没梯度的分段常数）。三个收益：滑窗天然认得跳形（旧 aiGappedBonus 删除）、双四/四三/双活三有专门档位、长连对受限方是负分。代价与边界（一串量过的数，写清"别再试一遍"）：深 5→7 反而 33.3%；转动交给同一段搜索估值 31.3%；算杀进叶子 50.0% 且耗时翻倍；低档三条变强路 46.7/40.8/47.5%；深 6 要 577ms 且只强 60%（所以极高从深 6 改深 4）；**深度一律奇数**（深 2 打深 1 只有 29.2%）；分支宽度越小越强（支 4 打支 8 拿 22.5%）；候选排序必须用加号（我攻＋对方守）；叶子评估里对方项要打折（`AI_EVAL_W = 0.5`）。瓶颈结论：叶子评估太粗，不是算得不够多——要真变强得先做静止搜索（另一个工程）。证据：index.html 里 `AI_PARAMS` 上方的注释、v2.10.2/v2.10.14/v2.10.15 的 commit、[[Web_Gomoku3D/README]]「电脑对手」节。相关：[[历史/AI 棋力提升史]]、[[待办/AI 棋力欠账]]。
12. `贯通看得见.md` —— 结论：贯通（环面）的判定＝把棋盘展开成周期空间——27 副 3×3×3 棋盘叠起来只下中间那副，每手印到其余 26 副；v3.1.0 起用**影子圈**（棋盘外紧贴一圈画边界棋子的续集）让它看得见。为什么：判定本身早就等价于参考实现，缺的一直是"让玩家看得见"。代价与边界：现在 `wrapEdges` 只被教学第二关写死打开，正常对局玩不到（→[[待办/拓扑玩法的两档]]）；参考游戏把拓扑做成 7 关旅程（平面/圆柱/环面/莫比乌斯/克莱因/射影/球面），我们只做了最保守的"影子"档。证据：v3.0.0 / v3.1.0 的 commit、[[RULES_SPEC]] 贯通节、2026-09-29 调研记录。相关：[[待办/拓扑玩法的两档]]。
13. `仓库不收工具链内容.md` —— 结论：Claude Code 的 skill 清单/官方市场内容不进这个仓库、也不进 README。为什么：那些内容是 Anthropic 官方插件市场的（MIT 仓库拷进去是许可问题）；副本会跟插件版本漂移成假文档；对仓库读者零价值；skill 住本机、跟机器走不跟仓库走。代价与边界：值得写进仓库的是**项目规约**（改完跑什么、什么不许改）——那是 `CLAUDE.md` 的活。证据：2026-09-28 的决定（本地记录）、[[CLAUDE.md]]。相关：[[CLAUDE.md]]。
14. `古风视觉的规矩.md` —— 结论（可复用的设计规矩，将来再做视觉先读）：①只借方法论不搬画面，纹样按几何规则自绘，不扒素材站 SVG（免费≠可商用；博物馆高清文件有特别经营权）；②浅底上做赛博＝把已有的黛青"通电"（色相微移 + 饱和度拉起），不加新色相；③全页只有一处发光、面积 <2%、只动 alpha 不动色相；④浅色主题里霓虹发不出光（原生霓虹青在纸白上对比度 1.45:1）——这个"缺陷"本身是克制，别修；⑤别用大阵列 radial-gradient 铺点阵（有卡顿实测案例），要铺换 SVG data-URI 平铺。实测对比度（纸底）：朱砂 5.87、黛青 5.79、赭石金 3.80（只够大字）。三轮废稿的教训：白线框后铺网格＝糊、横贯装饰带压正文、暖米底低透明青＝灰绿脏点、48px 回纹角花＝四个污点。证据：v2.10.13（`6299ed2`）与 v3.1.6 的 commit、2026-09-28 调研记录。相关：[[历史/视觉重构 v3.1.6]]。

- [ ] **Step 1: 写第 1–4 篇**（单文件零依赖 / 先手恰好五连 / 四维必须立方 / 转动两步走）
- [ ] **Step 2: 写第 5–8 篇**（转动按威胁触发 / 视角操作不做惯性 / 默认中文不猜语言 / 中文原文留在 HTML）
- [ ] **Step 3: 写第 9–11 篇**（规则全文是生成的 / 单文件里塞书法字体 / AI 评估按方向数威胁）
- [ ] **Step 4: 写第 12–14 篇**（贯通看得见 / 仓库不收工具链内容 / 古风视觉的规矩）

- [ ] **Step 5: 结构检查（四段齐全）**

```bash
for f in 知识库/决策/*.md; do
  for k in 结论 为什么 代价与边界 证据; do
    grep -q "\*\*$k\*\*" "$f" || echo "缺 $k：$f"
  done
done
echo "结构检查完（无输出=全过）"
```

- [ ] **Step 6: 链接检查（悬空 42→28）**

Run: `node _verify/kb-links.mjs; echo "exit=$?"`
Expected: `文件 16`；`歧义 0 / 锚点 0 / 孤儿 0`；悬空明细里**每一条的目标都属于 坑/、验证/、历史/、待办/ 四类**（数量不限，取决于这批笔记互链的分量）——出现这四类之外的目标名＝写错了，停下查。exit=1。

- [ ] **Step 7: 提交**

```bash
git add 知识库/决策/
git commit -m "知识库/决策：14 条为什么（kb-links 悬空只剩待建类）"
```

---

### Task 4: 坑/ 12 条

**Files:**
- Create: `知识库/坑/` 下 12 个文件（名字与首页链接逐字一致）

**Interfaces:**
- Consumes: Task 2 首页链接、Task 3 的决策笔记（坑笔记会链过去）。
- Produces: `知识库/坑/` 全部 12 篇。

**通用执行规矩**：同 Task 3，模板换成 `**症状**` / `**原因**` / `**规矩**` / `**出处**` 四段；素材主要来自本机 Claude 记忆目录（路径见 Global Constraints）里对应的条目——**要用自己的话重述成一条笔记，不是复制记忆原文**（记忆里的一句话结论可以留，背景故事压缩成一两句）。

**12 篇的内容要点：**

1. `冻结向量不能改.md` —— 症状：想让测试变绿、想"重新生成"向量，做不到。原因：`tests/vectors.json` 与 `rotation-vectors.json` 是从一份**已经删除**的 C# 内核导出的，导出脚本和源码都不存在，这两个文件**永远无法重新生成**；`run-all.sh` 第 2 步用 md5 把它们钉死。规矩：为让测试变绿而改它们不是修 bug，是**篡改证据**；它们的含义是"与 2026-09 那份 C# 实现逐手一致"的冻结历史基线。出处：[[README]]「关于冻结的向量」节、`_verify/run-all.sh` 文件头、[[打开流程]] 的警告框。
2. `路径里的空格会静默失败.md` —— 症状：命令看起来跑了、没有输出、返回码 0，但什么都没发生。原因：路径含空格时 shell 拆成多个参数、拼出不存在的路径后静默失败。规矩：给脚本传路径**永远加双引号**；脚本内部用引号或 `path.join`。出处：[[打开流程]]「一个已知的坑」。
3. `python 改文件会 CRLF 化.md` —— 症状：整份文件在 git 里算"全改"；或报一个看起来毫无关系的错——「index.html 里找不到 `#rulesSrc` 的 script 块」。原因：Windows 上 python 默认文本模式写文件，`\n` 全变 `\r\n`；那个 script 块是正则按 LF 抽的。规矩：读写都 `newline=''`；改完 `python -c "import io;d=io.open(p,'rb').read();print(d.count(b'\r\n'))"` 数一下，不是 0 就是中招；`git diff` 里那条 "CRLF will be replaced by LF" 警告是唯一直接线索。出处：2026-10 的注入脚本会话（记忆 `python-write-converts-lf-to-crlf`）。
4. `ev() 里别写反引号.md` —— 症状：`JSON.parse(undefined)`，位置离真正的原因十几行远；`node --check` 通过；求值里加 try/catch 抓不到（模板串解析期错误）。原因：`browser-check.mjs` 的 `await ev(\`...\`)` 是模板字符串，里面写反引号（比如注释里写 \` \`\` 强调）会提前终止模板串。规矩：`ev()` 里只用普通引号和中文引号，`${}` 同理；排查法：从 `await ev(\`` 往后找到配对结束反引号，看中间有没有多余的。出处：v3.1.6 会话（记忆 `backtick-inside-ev-breaks-assertions`）。
5. `fixed 只写 top50 会截高度.md` —— 症状：竖排文字断句怪、版面被横向拉长（实测外框 422×690 → 782×401），截图上看不出根因。原因：`position: fixed; top: 50%; transform: translateY(-50%)` 没写 `bottom` 时，包含块是"top:50% 到视口底"——可用高度只有视口一半；`writing-mode: vertical-rl` 下 height 决定一列放得下几个字。规矩：竖排元素显式 `top: 7vh; bottom: 7vh` 给足高度；排查断句用 `Range.getClientRects()`——一列＝一个矩形，三句话就该是三个（滤掉 height≤1 的）。已钉进 browser-check（正好 3 列 + 外框高>宽两条断言）。出处：v3.1.6 会话（记忆 `fixed-top50-without-bottom-clips-height`）。
6. `宋体会把西里尔画成全角.md` —— 症状：俄语标题文字异常宽（实测自然宽 856px，65 字符平均 13.2px≈一个汉字宽）。原因：`.serif` 写死楷体栈，楷体没有西里尔字形 → 回退 SimSun（宋体）→ 宋体把西里尔按全角渲染。规矩：加 `.serif` 这类"装饰类"必须同时给它一份按语言的字体栈（类选择器会覆盖 `html.lang-* body` 的规则）；排查自然宽：临时 `white-space: nowrap; width: max-content; max-width: none` 量出来和同长拉丁文对比。换字体后 `max-width` 门槛要一起重算。出处：v3.1.6 会话（记忆 `cyrillic-falls-back-to-fullwidth-cjk`）。
7. `起始界面高度预算极紧.md` —— 症状：加一行/放大标题后某语言「开始游戏」被挤出 800px 视口。原因：硬不变量是"六种语言 1280×800 都不用滚动看到开始游戏"，约束边界永远是**法语**（内容高 800px 固定、与视口无关，余量 2px）；1366×768 从 v3.1.5 起一直超。规矩：动起始界面之前先跑 browser-check 那条断言（会打印六种语言的 `startBtn.bottom / contentH`）；**不要动 `#setup` 的 `gap` 和 `--cool3d-take`**（有外部依赖，挂着"三维↔四维逐像素一致"的断言）；收高度优先收内边距和行高（已归零/已到极限的记录在案）。出处：v3.1.6 会话（记忆 `setup-panel-height-budget`）。
8. `截图对拍先钉住会动的东西.md` —— 症状：同一个坑连踩两次、两次都得到错的结论（25.6% / 16.7% 的"差异"）还据此动了一次手。原因：对局截图里 toast 会自己淡出、起始界面演示盘 yaw 每秒转 6°——量到的是时间差不是改动。规矩：①对拍前**连拍两张同状态图量噪声底**，底不是 0 后面所有差异数字全作废；②时间相关的量先钉死（`Game.showToast=()=>{}`、去 transition、`toastTimer=1e9`、`previewYaw=-28`）；③别"把证人赶走"（`display:none` toast 会正好藏掉唯一能照出污染的浮层，A/B 双零=假绿）；④差异分级：色差>150 的聚块（强差异）一定追，文字抗锯齿（弱差异）别追。出处：2026-09-28 与 v3.1.5 两次实测（记忆 `screenshot-diff-must-pin-motion`、`verify-harnesses-dirty-committed-shots`）。
9. `shots 基线图的真假判定.md` —— 症状：跑完 `run-all.sh` 必然有一批 `_verify/shots/` 图显示 M。原因：第 8 步在报告失败**之前**重拍了那批基线图。规矩：拿 HEAD 干净副本在本机渲染同一张来对拍（`git worktree add` 或 `git show HEAD:path`，写到别处），比三份 md5（已提交 / HEAD 副本 / 工作区）逐张判：**这张表随环境变**（Chrome 版本一换，能复现的图就变），别沿用上一轮结论；噪声按"像素差 + 包围盒"判、别只看 md5（一次 12.8 万 px 的差也可能是噪声）；端口 9401 被上次留下的 headless 占着会连到旧浏览器、报一堆假红（browser-check 现在开头自检、退出码 2 并提示）；`inject-*.py` 会临时改坏 index.html，它们已改成写临时目录——别让故意弄坏的页面拍进版本库。出处：`_verify/run-all.sh` 文件头、2026-09-25/26 与 10-01 三次实测。
10. `自对局量棋力必须配对.md` —— 症状：对照组（两边内核**完全相同**）照样打出 53.3/55.0/53.3/60.0%——第一方被系统性照顾约 5 个点，在那个平台上量出的每个"提升"都不可信。原因："偶数局 A 执黑、奇数局执白"的颜色周期与开局周期（`(i%4)*2`）混在一起。规矩：**第 2k 与 2k+1 局共享同一开局种子、只对调颜色**；自检判据——完全相同内核的对照组必须正好 50.0%，不是就别解读这批数字（`_verify/ai-ab.mjs` 会打印"配对里同色胜的比例"，接近 100% 就是失效；三维 15³ 上 16/16 同色胜、配对会逼出恒等 50.0% 假象）。顺带：搜索深度一律用奇数（深 2 打深 1 只有 29.2%），`tests/ai.test.mjs` 有断言。出处：2026-09-29 实测（记忆 `ai-selfplay-must-pair`）、`tests/ai.test.mjs` §8.7。
11. `推送 GitHub 与 Pages 验证.md` —— 症状：`git push` 直连必失败（`github.com:443` 连接重置；`api.github.com` 通不代表 push 通——不同端口）。规矩：走本机代理、**一次性参数**：`git -c http.proxy=http://127.0.0.1:7897 push origin main`（`-c` 必须写在子命令**之前**，写后面会被当成 push 自己的选项、只打印用法什么都不做）；代理**不一定开着**（7897 无监听时直连也是 reset，唯一出路是让用户把代理客户端打开）；别改全局 git config。推成功但 Pages 没更新时的查序（全走直连，这几条代理反而不通）：①抓线上页面比标记（新版有「五子魔方」，看 `rc` 和字节数完整才作数）；②查 Actions runs 的 status/conclusion；③查 githubstatus.com 的 Actions 组件——当天就是它 degraded，等恢复即可。Pages 由 `.github/workflows/pages.yml` 在 push main 时自动重建，发布的就是 index.html 原件。出处：2026-10-05/06 实测（记忆 `push-to-github-needs-local-proxy`）。
12. `curl 抓大文件看退出码.md` —— 症状：抓线上 `index.html`（257KB）md5 对不上甚至 0 字节，一度怀疑"Pages 发的和本地不一致"。原因：走本地代理 + `--max-time` 给太短，curl 超时退出但**把半截内容落盘**，`-o` 出来的文件看着像正常响应。特征（三条一起看）：Content-Length 完整（如 257510）但 `wc -c` 只有零头、截断点多字节字符中间、**重抓就正常**。规矩：`--max-time 180` + 显式看退出码（`-w '%{http_code}'` 只看状态码，超时照样 200）——`rc=0` 才算抓全；md5 对不上先重抓三次，稳定复现才当回事。出处：2026-09-26 验收实测（记忆 `proxy-truncates-large-curl-fetches`）。

- [ ] **Step 1: 写第 1–4 篇**（冻结向量 / 路径空格 / python CRLF / ev 反引号）
- [ ] **Step 2: 写第 5–8 篇**（fixed top50 / 宋体西里尔 / 高度预算 / 截图钉住）
- [ ] **Step 3: 写第 9–12 篇**（shots 真假 / 自对局配对 / 推送 Pages / curl rc）

- [ ] **Step 4: 结构检查（四段齐全）**

```bash
for f in 知识库/坑/*.md; do
  for k in 症状 原因 规矩 出处; do
    grep -q "\*\*$k\*\*" "$f" || echo "缺 $k：$f"
  done
done
echo "结构检查完（无输出=全过）"
```

- [ ] **Step 5: 链接检查（悬空 28→16）**

Run: `node _verify/kb-links.mjs; echo "exit=$?"`
Expected: `文件 28`；`歧义 0 / 锚点 0 / 孤儿 0`；悬空明细全部属于 验证/、历史/、待办/。exit=1。

- [ ] **Step 6: 提交**

```bash
git add 知识库/坑/
git commit -m "知识库/坑：12 条坑（kb-links 悬空只剩待建类）"
```

---

### Task 5: 验证/ 5 条

**Files:**
- Create: `知识库/验证/` 下 5 个文件

**Interfaces:**
- Consumes: Task 2 首页链接、Task 3/4 的笔记（会互链）。
- Produces: `知识库/验证/` 全部 5 篇。

**通用执行规矩**：结构自由（不是决策/坑模板），但每篇要有 `**出处**` 段（来源清单）。

**5 篇的内容要点：**

1. `九步与断言地图.md` —— 内容：`bash _verify/run-all.sh` 九步各是什么——①rules 11733（三维规则基线，回放冻结向量）②md5 钉两份向量（第 2 步）③rotation 19444（四维转动一致性）④dims 98（长方体 + 尺寸约束）⑤ai 221（两条硬规则、五档强弱关系、自对局逐手喂引擎、四维转动只在必要时发生、计算量上界）⑥dom-smoke 130（界面桩环境、六语言文案齐全性、手势与复位边界、拖拽方向约定）⑦online 8845（联机内核与网页版逐格对拍 1156 组）⑧online-http 134（联机 HTTP 层，本机 loopback；⑦⑧不可跳过）⑨browser-check 431（真实无头浏览器；没装自动跳过、不算失败）。总数 41036。注意：文档里写死的总数总是慢半拍（要手改），**以 run-all 输出为准**。出处：[[README]]「跑测试」、[[打开流程]] §B。
2. `browser-check 解剖.md` —— 内容：第 9 步在真实无头 Chrome/Edge 里查——GLSL 编译、控制台零输出、布局几何（含"六语言 1280×800 开始游戏不滚动"）、六语言逐屏扫描（外语界面里出现汉字/译文语料外汉字串/漏翻键名＝红）、合成多点触摸、真定时器下的人机对局；顺带截图到 `_verify/shots/`；脚本自带 ~40 行 PNG 解码（只用 node 自带 zlib）量合成后的像素；开头有端口 9401 自检（被旧 headless 占着就退出码 2）；用 `fs.mkdtempSync` 建 Chrome profile、正常结束自删——所以 `%TEMP%` 里的 `gomoku-*`、`probe*-cdp-*`、`bc*.log` 等残留＝被中断的运行留下的（2026-10-01 清过一轮约 2GB；uuid 命名的 .tmp/.png 不是本项目的，别误删）。出处：`_verify/browser-check.mjs`、2026-10-01 清理记录。
3. `注入验证.md` —— 内容：三个脚本与各自注入量——`inject-rulenote.py`（改坏起始界面规则摘要 3 处）、`inject-i18n.py`（弄坏语言通路 8 处，逐条写明该由哪套检查抓到）、`inject-online.mjs`（改坏联机 25 处，很慢、不在 run-all 里）。方法论：**把代码改坏，对应检查必须变红——证不了会红的检查等于没测**；前两个用 `finally` 还原 index.html，跑 browser-check 时写临时目录、绝不碰 `_verify/shots/` 基线图（否则每注入一次就把故意弄坏的页面写进版本库，`git status` 从此分不清"图被弄脏"和"界面真改了"）。出处：三个脚本本体、[[README]]「跑测试」尾注。
4. `假测试的两起案例.md` —— 案例一（v3.1.4）：相位光圈断言第一版只测了二维那一遍，三维单独关掉照样绿——**只测一半路径**＝假绿；已补第二条（三维数实例）。案例二（v2.10.8）：拉条禁用/「谁先下」禁用的断言先 `Game.setSetupAi(...)` 摆好状态再断言，查的是"设过的状态"，正好绕过"页面刚打开、一个字没设过时两样都是活的"这个真 bug——**新断言必须在页面刚加载完、什么都没设的时刻跑**。教训一句话：改动前先问"这条断言能不能被绕过/只覆盖一半"。出处：v3.1.4、v2.10.8 的 commit 与记录。
5. `证据的分级.md` —— 内容：这个工程把结论分三档——✅**已由真实执行验证**（测试/实测跑过）、❌**我无法验证**（明确列出）、以及"只是我认为对"（写作时以措辞区分）；[[打开流程]] 专列「还没验证过的部分（需要你确认）」：配色观感、交互手感、四维转动可读性、比 900×700 更窄的窗口、英文文案地不地道、术语一致性、**棋力手感**——这些只有人能验。另一件关键的"证据身份"：冻结向量是**冻结的历史基线**（与已删除 C# 实现逐手一致），不是和某个活对照物的对拍（也见 [[坑/冻结向量不能改]]）。出处：[[Web_Gomoku3D/README]]「验证状态」节、[[打开流程]]。

- [ ] **Step 1: 写 5 篇**（素材按上面要点，出处逐条回源）
- [ ] **Step 2: 出处检查**

```bash
for f in 知识库/验证/*.md; do
  grep -q '\*\*出处\*\*' "$f" || echo "缺出处：$f"
done
echo "出处检查完（无输出=全过）"
```

- [ ] **Step 3: 链接检查（悬空 16→11）**

Run: `node _verify/kb-links.mjs; echo "exit=$?"`
Expected: `文件 33`；`歧义 0 / 锚点 0 / 孤儿 0`；悬空明细全部属于 历史/、待办/。exit=1。

- [ ] **Step 4: 提交**

```bash
git add 知识库/验证/
git commit -m "知识库/验证：5 条证据体系（kb-links 悬空只剩待建类）"
```

---

### Task 6: 历史/ 6 条

**Files:**
- Create: `知识库/历史/` 下 6 个文件（注意 `视觉重构 v3.1.6.md` 文件名里是半点号）

**Interfaces:**
- Consumes: 首页链接、前面的笔记。
- Produces: `知识库/历史/` 全部 6 篇。

**通用执行规矩**：同 Task 5（结构自由 + `**出处**` 段）。

**6 篇的内容要点：**

1. `从 Unity 到单文件.md` —— 内容：这个工程**原来是 Unity 工程**，C# 实现已整个删除，现在只有网页版；文档里凡提"C# 内核""C# 导出的向量"指的都是那段**已经不存在**的历史；[[打开流程]] 文件头专门写着"这是历史沿革，不是当前状态"；两份冻结向量就是从那份 C# 导出、因此无法再生（链 [[坑/冻结向量不能改]]）。网页版与旧 Unity 版的结构对应（哪些模块迁到了哪）见 [[Web_Gomoku3D/README]]「与已删除的 Unity 版的结构对应（历史）」节，含三处刻意差异。出处：[[打开流程]] 文件头、[[Web_Gomoku3D/README]] 对应节。
2. `版本脉络.md` —— 内容：一句话一条的转折线（细节链 [[README]] 更新日志，这里只写"为什么转"）：v1.0.0 三维雏形（09-23）→ v2.0.0 四维转层（09-24，玩法后续补）→ v2.4 中英双语 → v2.7 竖屏/触屏 → v2.10 系列：人机对战从三档到五档、评估函数重写、四维转动从"抢跑"改"同台竞价"→ v3.0 三机制（贯通/晨昏/教学）→ v3.1 视觉重构（五子魔方）+ 逐版清账。写作时以 README 更新日志与 `git log --oneline` 核对，别凭印象排。出处：[[README]]「更新日志」、git log。
3. `AI 棋力提升史.md` —— 内容（时间线 + 每条一句"为什么"）：v2.10.1 排序 bug——"贴自己那颗子"与"贴玩家那颗子"开局恰好同分，平手按坐标升序 → 前 4 名永远是坐标最小那一角（"人机第二手跟着玩家跑到别的层"的根因，修法是平手先比"自己做的形"、再比离中心近、最后才比坐标）；v2.10.2 评估换血（按方向数威胁 + 量纲对齐）并给极限档加算杀，实测相邻档胜分率 94/88/56/63%（16 局口径）；v2.10.14 叶子评估改前两处威胁累加（中 57.5%、高 70.0%）+ 极高深 4→5 + 极限迭代加深（节点预算 1200）；顺手发现**极高档的深度阶梯曾一直写反**（深 4 打不过深 3，33.3%，旧阶梯断言靠 16 局噪声过的）；v2.10.15 两次独立实验都是负的（深度 5→7 得 33.3%；转动交给同一段搜索估值得 31.3%）→ 瓶颈结论=叶子评估太粗（链 [[决策/AI 评估按方向数威胁]]）；实测耗时：极高 95/355/396ms、极限 175/346/352ms（中位/95%/最慢）。出处：commits（4337e18 等，用 git log 定位）、记忆目录里对应条目、index.html `AI_PARAMS` 注释。
4. `被否掉与被撤掉的东西.md` —— 内容：①「恢复本次转动」按钮被撤（位置让给「确定/取消」，能力改走 `Y` 键与悔棋——撤之前核过能力没丢）；② `display:none` 换位被用户否掉（改成常驻灰显 `:disabled`）；③ 试过没留的算法：算杀进叶子（50.0%、耗时翻倍）、低档三条变强路（46.7/40.8/47.5%）、支 6、深 6（577ms 只强 60%）；④ 版本号改号：原挂 v2.11.0 的起始界面改动改成 v2.10.13（"2.10 这条线没走完，不该跳到 2.11"，历史 commit message 不改写）；⑤ 格线 blendFunc 问题：修好过一次又被用户"恢复"（决定不改），后来因另一个需求重新量、发现对局态也中招，最终用 `colorMask` 方案按 `setupOpen` 分开修（起始界面一个像素没动）。出处：各 commit（6299ed2、163d5ed、36eddb3 等，用 git log 定位）、相关记录。
5. `视觉重构 v3.1.6.md` —— 内容：改名「五子魔方 / Gomokube」（六语言）；古风化：宣纸底 + 竹简/玉牌、行书主标题（字体子集内联，链 [[决策/单文件里塞书法字体]]）、竖排古文水印「亦有格五，其法布子成行，以得五者胜」（竖排出过 `top:50%` 断句的坑，链 [[坑/fixed 只写 top50 会截高度]]）；背景字符粒子层——鼠标划过字被推开、移开弹性归位、右密左疏、全静止时连 rAF 都停；更早一版（v2.10.13）背景改良：三版样图用户选了最保守的 F3（只把光重打一遍 + 印章加外发光），规矩见 [[决策/古风视觉的规矩]]。出处：v3.1.6 与 v2.10.13 的 commit、相关记录。
6. `代码质量审计.md` —— 内容（"量过了，别再重做一遍"，2026-09-27，commit 36eddb3）：死代码 9686 行里只有 3 个（已删）；重复块（6 行窗口）只有 6 组/12 处；258 个函数中位数 9 行，>100 行的只有 `bindUi` 和 `aiChooseMove`；0 个 var、0 松散相等、0 TODO；每帧开销：演示盘整套 0.3ms、对局 `draw3D` 0.01ms（一帧的 2%）。唯一值得动的：`uploadInstances()` 的逐颗子循环（每颗调一次 `Palette.rgb()`、拼一次 `"x,y,z"` 当 Set 键——都是循环不变量），提出去后 40³ 铺 800 子 0.37ms→0.11ms。"一模一样"的判据（下次改代码可照用）：run-all 九步全绿 + 截图对拍（⚠️ 10/14 张里有一批每跑必漂，动手前先跑两遍量出哪几张，别事后找补）。出处：commit 36eddb3、2026-09-27 记录。

- [ ] **Step 1: 写 6 篇**
- [ ] **Step 2: 出处检查**（同 Task 5 的命令，换 `知识库/历史/*.md`）
- [ ] **Step 3: 链接检查（悬空 11→5）**

Run: `node _verify/kb-links.mjs; echo "exit=$?"`
Expected: `文件 39`；`歧义 0 / 锚点 0 / 孤儿 0`；悬空明细全部属于 待办/。exit=1。

- [ ] **Step 4: 提交**

```bash
git add 知识库/历史/
git commit -m "知识库/历史：6 条脉络（kb-links 悬空只剩待建类）"
```

---

### Task 7: 待办/ 5 条

**Files:**
- Create: `知识库/待办/` 下 5 个文件

**Interfaces:**
- Consumes: 首页链接、前面的笔记。
- Produces: `知识库/待办/` 全部 5 篇 —— **写完这一批，kb-links 首次全绿**。

**通用执行规矩**：同 Task 5/6；待办类必须写清"现状 / 欠什么 / 再提起时先问什么"。

**5 篇的内容要点：**

1. `AI 棋力欠账.md` —— 现状：五档人机是陪练级（无开局库/定式/静止搜索）；**70% 的验收线还没到**——历史最好的一段是 v2.10.14 口径（中 57.5%、高 70.0%，那是"新打旧"的 A/B），近两轮加深实验反而 31–33%。欠什么：静止搜索（消除叶子评估 0.5 折扣带来的奇偶偏差）——那是另一个工程，不是调参；"加深/转动交给搜索"两条路已经量过是负的，别再试。再提起时先问：是想要"更聪明"（做静止搜索）还是"更好玩"（调档位性格）。出处：[[历史/AI 棋力提升史]]、index.html `AI_PARAMS` 注释、相关 commit。
2. `联机·页面未接线.md` —— 现状：跨机联机的**服务器与协议已实现并有测试覆盖**（`Web_Gomoku3D/server.js` 零依赖，online 8845 + online-http 134 项断言，第 8 步里跑、不可跳过），**但页面还没接上它**——现在不能真的跨机对局。方案与取舍：[[ONLINE]]（注意：里面几处"7/8/9 步"是当时的计划快照，刻意没动）。再提起时先问：是接线（把 server.js 与页面打通）还是先改协议。出处：[[README]] 已知限制第一条尾注、[[Web_Gomoku3D/README]]、[[ONLINE]]。
3. `拓扑玩法的两档.md` —— 现状：贯通判定（周期空间/环面）早就对，最保守的"看得见"档（影子圈）已在 v3.1.0 完成；`wrapEdges` **只被教学第二关写死打开**，正常对局根本玩不到。欠的两档（用户明确留着）：① 拓扑做成**可选玩法**（设置页能选、电脑对手也认）；② 照参考游戏做整条 **7 关拓扑旅程**（平面→圆柱→环面→莫比乌斯→克莱因→射影→球面，含"引着走"的引导）。再提起时**先问是哪一档**，别自作主张扩范围。出处：2026-09-29 调研记录（参考游戏 bilibilitoy 的 topology-gomoku、`assets/level-config.js`）、v3.1.0 commit。
4. `已知限制里的取舍项.md` —— 内容：几条"量到过、决定不修"的排版/设计取舍（不是没人发现的 bug）：① 窄窗口（900×700）+ 长游戏名时主标题与右上角两个固定键重叠——按"缩到不重叠"算字号要掉到 ~40px，是排版取舍；② 四维摘要框在 en/fr/ru 下裁掉最后一行（定高 84/88px vs 内容 123px）——改成按内容长高会当场踩"切三维↔四维时按钮一个像素都不动"的断言（实测动 4~34px）；③ 三维+魔方旋转+人机+非默认尺寸时摘要三行要滚一下（4D 和普通三维装得下）；④ 法语横屏手机模式条折三行。为什么留着：都属于排版决策，要改得砍文案或从别处还高度。出处：[[README]]「已知限制」、v3.1.7 的 commit `00663be`。
5. `报告过没修的清单.md` —— 内容：报告过、按当时的范围**没修**的一批（先问再动）：三维视图和单层棋盘的 x 轴方向相反（RULES_SPEC 写"x 向右递增"，与面板一致、与三维视图相反）；状态行在手机上折两行（断言只钉"不超过两行"）；单层棋盘在电脑上没有缩放/平移（只有触屏够得到）；[[ONLINE]] 的步数快照；以及 [[打开流程]]「还没验证过的部分（需要你确认）」整张表（配色观感、交互手感、四维可读性、更窄窗口、英文地道性、术语一致性、棋力手感——只能人验）。出处：相关记录、[[打开流程]]。

- [ ] **Step 1: 写 5 篇**
- [ ] **Step 2: 出处检查**（同 Task 5 命令，换 `知识库/待办/*.md`）
- [ ] **Step 3: 链接检查 —— 首次全绿**

Run: `node _verify/kb-links.mjs; echo "exit=$?"`
Expected: `知识库：文件 44 / 链接 <M> / 悬空 0 / 歧义 0 / 锚点 0 / 孤儿 0`，**exit=0**。

- [ ] **Step 4: 提交**

```bash
git add 知识库/待办/
git commit -m "知识库/待办：5 条欠账（kb-links 全绿 44 篇）"
```

---

### Task 8: 记忆收编（仓库外，不产生 git 提交）

**Files:**
- Modify: `C:\Users\Lenovo\.claude\projects\d--Lenovo-OfficeSoft-VS-Code-My-project\memory\` 下 18 个文件 + `MEMORY.md`

**Interfaces:**
- Consumes: 知识库最终文件名（上面各 Task 产出）。
- Produces: 18 条"指针"记忆（正文只剩"何时用得上 + 目标"）；`MEMORY.md` 对应行同步。

**改写模板（每条都按这个形状；只改 `description` 与 `---` 之后的正文，frontmatter 其余字段原样不动）：**

```markdown
---
name: <原名>
description: 正文已迁知识库：<何时用得上的一句话>
<其余 frontmatter 原样>

正文已迁：`知识库/<路径>.md`（在仓库里，随 git 走）。<何时用得上的一句话>。
```

**完整示例（`python-write-converts-lf-to-crlf.md`）：**

```markdown
---
name: python-write-converts-lf-to-crlf
description: 正文已迁知识库/坑/：用 python 改仓库文件之前看
（其余字段原样保留）

正文已迁：`知识库/坑/python 改文件会 CRLF 化.md`（在仓库里，随 git 走）。用 python 改仓库文件之前看。
```

**18 条对照表（记忆文件 → 目标笔记 → "何时用得上"）：**

| 记忆 | 目标笔记 | 何时用得上 |
|---|---|---|
| `gomoku-remaining-work.md` | `知识库/待办/` 与 `知识库/历史/版本脉络.md` | 问"进度到哪了/还剩什么"之前 |
| `gomoku-bottleneck-is-leaf-eval.md` | `知识库/历史/AI 棋力提升史.md` | 想给 AI 加深/加转动估值之前 |
| `ai-selfplay-must-pair.md` | `知识库/坑/自对局量棋力必须配对.md` | 量棋力/跑自对局之前 |
| `verify-harnesses-dirty-committed-shots.md` | `知识库/坑/shots 基线图的真假判定.md` | 跑完 run-all 看到 shots 显示 M 时 |
| `screenshot-diff-must-pin-motion.md` | `知识库/坑/截图对拍先钉住会动的东西.md` | 对拍两张截图之前 |
| `push-to-github-needs-local-proxy.md` | `知识库/坑/推送 GitHub 与 Pages 验证.md` | push / 验收 Pages 之前 |
| `proxy-truncates-large-curl-fetches.md` | `知识库/坑/curl 抓大文件看退出码.md` | curl 抓大文件之后对不上时 |
| `language-switcher-research.md` | `知识库/决策/默认中文不猜语言.md` | 改语言切换/文案之前 |
| `camera-gesture-research.md` | `知识库/决策/视角操作不做惯性.md` | 改视角手势之前 |
| `no-skills-in-repo.md` | `知识库/决策/仓库不收工具链内容.md` | 想往仓库塞工具链内容之前 |
| `topology-play-research.md` | `知识库/待办/拓扑玩法的两档.md` | 再提拓扑玩法时 |
| `single-file-font-subsetting.md` | `知识库/决策/单文件里塞书法字体.md` | 改标题/水印文案之前 |
| `fixed-top50-without-bottom-clips-height.md` | `知识库/坑/fixed 只写 top50 会截高度.md` | 写竖排元素之前 |
| `setup-panel-height-budget.md` | `知识库/坑/起始界面高度预算极紧.md` | 动起始界面布局之前 |
| `cyrillic-falls-back-to-fullwidth-cjk.md` | `知识库/坑/宋体会把西里尔画成全角.md` | 加装饰类字体/看俄语排版之前 |
| `backtick-inside-ev-breaks-assertions.md` | `知识库/坑/ev() 里别写反引号.md` | 改 browser-check 的 ev() 之前 |
| `python-write-converts-lf-to-crlf.md` | `知识库/坑/python 改文件会 CRLF 化.md` | 用 python 改仓库文件之前 |
| `gomoku-temp-profile-leftovers.md` | `知识库/验证/browser-check 解剖.md` | 清理 %TEMP% 残留之前 |

**不动**（4 条）：`ask-before-expanding-scope.md`、`cleanup-keep-preferences.md`、`npm12-allow-scripts-leaves-claude-stub.md`、`npmjs-direct-ok-proxy-stale.md`。

- [ ] **Step 1: 改写前 9 条**（表里前 9 行）
- [ ] **Step 2: 改写后 9 条**（表里后 9 行）
- [ ] **Step 3: 更新 `MEMORY.md` 对应 18 行**

每行改成：`- [原标题](file.md) — 正文已迁 知识库/<路径>/（<何时用得上>）`。
标题沿用现有行（从 `MEMORY.md` 原文件读），只要把破折号后的 hook 换成上面的"何时用得上"并注明已迁。

- [ ] **Step 4: 验证**

```bash
MEM="C:/Users/Lenovo/.claude/projects/d--Lenovo-OfficeSoft-VS-Code-My-project/memory"
grep -l "正文已迁" "$MEM"/*.md | wc -l        # 期望 18
grep -c "正文已迁" "$MEM/MEMORY.md"           # 期望 18
```
再读回 2 条（`python-write-converts-lf-to-crlf.md`、`verify-harnesses-dirty-committed-shots.md`）确认：frontmatter 完好、"何时用得上"在、**没有残留正文**。

---

### Task 9: 全面验收（含"自证会红"与用户实开）

**Files:**
- 无新文件；若用户验收提修改意见，按意见修后提交 `知识库：验收修正`。

**Interfaces:**
- Consumes: 前 8 个 Task 的全部产物。
- Produces: 用户的验收结论；是否推送 GitHub 的决定（推送另行执行、走代理）。

- [ ] **Step 1: 全绿基线**

Run: `node _verify/kb-links.mjs; echo "exit=$?"`
Expected: `文件 44 / 悬空 0 / 歧义 0 / 锚点 0 / 孤儿 0`，exit=0。

- [ ] **Step 2: 真库自证会红（沿用注入验证传统）**

```bash
# 故意把首页里一条链接改坏
# 用 Edit 把 `[[决策/单文件零依赖]]` 改成 `[[决策/单文件零依]]`
node _verify/kb-links.mjs; echo "exit=$?"   # 期望：悬空 1，exit=1
# 用 Edit 改回来
node _verify/kb-links.mjs; echo "exit=$?"   # 期望：全零，exit=0
```

- [ ] **Step 3: 公开边界核对**

```bash
grep -rn "npm12\|allow-scripts\|反复推销\|清理偏好\|npmjs\|claude.ai" 知识库/ || echo "干净"
```
Expected: `干净`（4 条留记忆的内容一条都不在；若 spec 复核时有被用户划掉的行，同样确认未出现）。

- [ ] **Step 4: 抽查 5 篇，打印给用户核对**（优先从记忆迁移的）

`知识库/坑/python 改文件会 CRLF 化.md`、`知识库/坑/冻结向量不能改.md`、`知识库/验证/假测试的两起案例.md`、`知识库/待办/AI 棋力欠账.md`、`知识库/历史/版本脉络.md` —— 每篇打印标题 + 证据/出处段（`sed -n` 或直接给用户文件链接），请用户核对事实。

- [ ] **Step 5: 用户用 Obsidian 实开验收**

请用户：用 Obsidian「打开文件夹作为库」打开仓库根 → 看 [[首页]]、看图谱、点几条链接（**重点点** `[[README]]` 与 `[[Web_Gomoku3D/README]]` 两个链接，确认落点分别是根 README 与工程 README；如果 `[[README]]` 落点不对，把首页里这两处改成相对 md 链接 `[README](README.md)` / `[工程 README](Web_Gomoku3D/README.md)`，跑检查后提交）。

- [ ] **Step 6: 汇总与收尾**

- `git log --oneline -8` 确认 6 个提交都在；
- 记录最终数字：kb-links `文件 44 / 全零`、笔记 42 篇 + 首页 + 词汇表、记忆指针 18 条；
- **问用户：要不要推 GitHub**（若推：`git -c http.proxy=http://127.0.0.1:7897 push origin main`，推送前确认代理在听 7897）；
- 本次不更新 README / 不改 run-all（spec 明说不碰现有文档）。

---

## 执行备忘

- 悬空是进度尺、**明细**是护栏：中间态里悬空明细只应出现"稍后才创建的笔记"；出现计划外的名字＝链接拼错，停下查；Task 7 结束时必须全零（只有这时才要求精确数字）。Expected 里省略的"链接 M"是信息性数字。
- 笔记里所有 wikilink 的目标名与本计划逐字一致（含 `·`「v3.1.6」这类字符），改文件名必须同步改首页与互链，然后跑检查。
- 任何一步发现 spec 与本计划冲突：**以 spec 为准**（本计划是 spec 的展开），冲突写进 commit message 存疑处。
