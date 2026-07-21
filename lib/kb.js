// 知识库：扫描 knowledge/ 下的 .md 文件，frontmatter + 正文的极简格式
// 新增手册 = 往 knowledge/ 丢一个 md 文件，无需改代码、无需重启以外的任何操作
const fs = require("fs");
const path = require("path");

function parseFile(file) {
  const raw = fs.readFileSync(file, "utf8");
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  let meta = {}, body = raw;
  if (m) {
    m[1].split(/\r?\n/).forEach(line => {
      const i = line.indexOf(":");
      if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });
    body = m[2].trim();
  }
  meta.keywords = (meta.keywords || "").split(",").map(s => s.trim()).filter(Boolean);
  return { ...meta, body, file: path.basename(file) };
}

function load(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith(".md"))
    .map(f => parseFile(path.join(dir, f)));
}

// 检索打分：故障代码精确命中权重最高，其次关键词包含（越长越具体分越高）
function score(query, entry) {
  const q = query.toLowerCase();
  let s = 0;
  const cm = q.match(/\be\s*-?\s*(\d{3})\b/i) || q.match(/\bm\s*-?\s*(\d{2})\b/i);
  if (cm && entry.code) {
    const norm = entry.code.toLowerCase().replace(/[^a-z0-9]/g, "");
    const qcode = (cm[0][0].toLowerCase() + cm[1]).replace(/[^a-z0-9]/g, "");
    if (norm === qcode) s += 100;
  }
  for (const k of entry.keywords || []) {
    if (k && q.includes(k.toLowerCase())) s += 10 + k.length;
  }
  if (entry.title && q.includes(entry.title.toLowerCase())) s += 15;
  return s;
}

function search(entries, query, limit = 3) {
  return entries
    .map(e => ({ e, s: score(query, e) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(x => x.e);
}

module.exports = { load, search };
