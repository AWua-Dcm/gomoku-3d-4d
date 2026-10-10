#!/usr/bin/env node
// kb-links.mjs —— 工程知识库的链接完整性检查（零依赖，Node ESM）。
//
// 扫「知识库/**/*.md」里的两类链接，目标必须真实存在：
//   · wikilink：[[目标]]、[[目标|别名]]、[[目标#锚点]]、![[…]]
//   · markdown 链接：[文字](相对路径)
// 解析规矩（与 Obsidian 对齐，见 知识库/首页.md 的"链接规矩"）：
//   · 带 / 的按「库根精确路径 + 路径后缀」一起匹配（命中两处不同文件＝歧义）
//   · 不带 / 的先看库根同名文件，再看全库文件名（唯一才算数；≥2 命中报「歧义」）
//   · #锚点 按目标文件的标题文本精确匹配；^块引用不支持，出现即报
//   · 除 知识库/首页.md 外，每篇笔记必须至少被另一篇笔记链到（孤儿检查）
//   · 围栏代码块与行内代码里的 [[…]] 不算（示例不参与检查）
//
// 用法: node _verify/kb-links.mjs [--root <目录>]   （--root 供夹具自测）
// 输出: 知识库：文件 N / 链接 M / 悬空 X / 歧义 Y / 锚点 A / 孤儿 Z
// 任何非零计数 → 附逐条明细并 exit 1；全绿 exit 0。
//
// 注意：它按「vault 根＝仓库根」解析。Obsidian 必须打开仓库根（不是 知识库/ 子文件夹）——
// 开错根时跨目录链接全断、点未解析链接还会就地生成空笔记；本脚本全绿只保证在这一前提下成立。
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

// ---------- 剥代码与注释：这些位置里的 [[…]] 不算链接 ----------
// 围栏用按行状态机（按开栏长度配对）；%% 注释与 HTML 注释整段剥掉。
const stripCode = (md) => {
  const s = md.replace(/%%[\s\S]*?%%/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const out = [];
  let fence = null; // { char, len }
  for (const line of s.split('\n')) {
    const m = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (m && m[1][0] === fence.char && m[1].length >= fence.len) fence = null;
      continue;
    }
    if (m) { fence = { char: m[1][0], len: m[1].length }; continue; }
    out.push(line);
  }
  return out.join('\n').replace(/`[^`\n]*`/g, '');
};

// ---------- wikilink 目标解析 ----------
function resolveWiki(target) {
  const t = noExt(target.replace(/^\.\//, '')).trim();
  const rootHits = [path.join(ROOT, t), path.join(ROOT, t + '.md')]
    .filter((p) => fs.existsSync(p) && fs.statSync(p).isFile());
  if (t.includes('/')) {
    // 路径式：「库根精确路径」与「路径后缀」一起算——命中两个不同文件就是歧义。
    // （曾经让库根命中短路返回，结果知识库里混进同名文件时静默漏报。）
    const suffixHits = vaultFiles.filter((p) => {
      const r = noExt(rel(p));
      return r === t || r.endsWith('/' + t);
    });
    const hits = [...new Set([...rootHits, ...suffixHits])];
    if (hits.length === 1) return { ok: true, file: hits[0] };
    return { ok: false, kind: hits.length === 0 ? '悬空' : '歧义', hits };
  }
  // 裸名：库根精确命中优先——知识库的笔记都在 知识库/ 下，与 Obsidian"离引用者最近"的落点一致
  if (rootHits.length === 1) return { ok: true, file: rootHits[0] };
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

  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\n]+)\)/g)) {
    // markdown 链接：允许含空格的目标（尖括号形式 <路径 带 空格> 与裸空格都试），
    // 也校验 #锚点（按目标文件标题文本精确匹配，含 URL 编码解码尝试）。
    let href = m[1].trim();
    if (href.startsWith('<') && href.endsWith('>')) href = href.slice(1, -1).trim();
    if (/^(https?:|mailto:|#|\/\/)/.test(href)) continue;
    linkCount++;
    let anchor = null;
    const hash = href.indexOf('#');
    if (hash !== -1) {
      anchor = href.slice(hash + 1).trim();
      href = href.slice(0, hash);
    }
    if (href === '') continue;
    const dir = path.dirname(note);
    let abs = path.resolve(dir, href);
    if (!fs.existsSync(abs)) {
      try { abs = path.resolve(dir, decodeURIComponent(href)); } catch { /* 保持原样 */ }
    }
    if (!fs.existsSync(abs)) { dangling.push({ raw: m[1], source: note }); continue; }
    if (isKbNote(abs) && abs !== note) linkedTo.add(abs);
    if (anchor && abs.endsWith('.md')) {
      let a = anchor;
      try { a = decodeURIComponent(anchor); } catch { /* 保持原样 */ }
      const heads = headingTexts(abs);
      if (!heads.includes(a) && !heads.includes(anchor)) anchorBad.push({ raw: m[1], source: note });
    }
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
