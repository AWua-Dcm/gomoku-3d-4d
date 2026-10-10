# python 改文件会 CRLF 化

**症状**：整份文件在 git 里算"全改"；或者报一个看起来毫无关系的错——「index.html 里找不到 `#rulesSrc` 的 script 块」。`git diff` 里那条 "CRLF will be replaced by LF the next time Git touches it" 警告是唯一的直接线索。

**原因**：Windows 上 python 的文本模式写文件默认把 `\n` 翻译成 `\r\n`（`newline=None`）。这个仓库的文件是 LF，于是整个文件都成了改动；而 dom-smoke 是拿正则按 `>\n` 去抽规则正文的，行尾一变就匹配不上。

**规矩**：凡是用 python 改仓库文件，读写都写 `newline=''`：

```python
s = io.open(p, encoding='utf-8', newline='').read()
io.open(p, 'w', encoding='utf-8', newline='').write(s)
```

改完先数一遍：`python -c "import io;d=io.open(p,'rb').read();print(d.count(b'\r\n'))"`——不是 0 就是中招（修复＝把 `\r\n` 换回 `\n` 再跑测试）。

**出处**：v3.1.7 前后的注入脚本会话（2026-10）。
