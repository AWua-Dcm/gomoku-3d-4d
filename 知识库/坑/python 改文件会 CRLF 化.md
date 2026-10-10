# python 改文件会 CRLF 化

**症状**：两种面孔——要么整份文件在 git 里显示"全改"，要么报一个乍看毫无关系的错：dom-smoke 说「index.html 里找不到 `#rulesSrc` 的 script 块」。唯一直接线索是 `git diff` 打出的一条警告：CRLF will be replaced by LF the next time Git touches it。

**原因**：这是 Windows 上 python 文本模式写文件的默认行为——`newline=None` 时 `\n` 出盘就变 `\r\n`。仓库里的文件全部是 LF，行尾一换、整个文件都算改动；而那个"找不到 script 块"的报错，是因为抽取规则正文的正则按 `>\n` 断句，行尾变了就断不开。

**规矩**：凡是用 python 改仓库文件，读写都写 `newline=''`：

```python
s = io.open(p, encoding='utf-8', newline='').read()
io.open(p, 'w', encoding='utf-8', newline='').write(s)
```

改完先数一遍：`python -c "import io;d=io.open(p,'rb').read();print(d.count(b'\r\n'))"`——不是 0 就是中招（修复＝把 `\r\n` 换回 `\n` 再跑测试）。

**出处**：v3.1.7 前后的注入脚本会话（2026-10）。
