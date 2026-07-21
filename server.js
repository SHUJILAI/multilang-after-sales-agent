// 多语售后 Agent 服务端（零依赖，Node 18+ 直接跑）
// 路由：
//   GET  /            聊天界面
//   GET  /api/health  运行状态（LLM 是否已配置、知识库条目数）
//   POST /api/chat    对话 {message, history?, lang?} → {reply, lang, mode, escalated, sources, latencyMs}
//   GET  /api/kb      知识库条目列表
//   GET  /api/stats   真实统计数据（从 logs/chat.jsonl 聚合，无假数据）
const http = require("http");
const fs = require("fs");
const path = require("path");
const { detectLang, LANG_NAME } = require("./lib/detect");
const kbLib = require("./lib/kb");
const llm = require("./lib/llm");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const KB_DIR = path.join(ROOT, "knowledge");
const LOG_DIR = path.join(ROOT, "logs");
const LOG_FILE = path.join(LOG_DIR, "chat.jsonl");

// ---------- .env 加载 ----------
(function loadEnv() {
  const f = path.join(ROOT, ".env");
  if (!fs.existsSync(f)) return;
  fs.readFileSync(f, "utf8").split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });
})();

const PORT = Number(process.env.PORT || 8787);
const DEVICE = process.env.DEVICE_NAME || "LTX-3015 光纤激光切割机";
const MANUAL = process.env.MANUAL_NAME || "《LTX-3015 使用维护手册 V3.2》";

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
let KB = kbLib.load(KB_DIR);

// ---------- 文案 ----------
const T = {
  noAnswer: {
    zh: "这个问题超出了当前知识库（" + MANUAL + "）的范围。为避免误判，已为你转接工程师人工处理。",
    en: "This is beyond the current knowledge base (" + MANUAL + "). To avoid misjudgment, it has been escalated to a human engineer.",
    es: "Esto está fuera de la base de conocimientos actual. Para evitar errores, se ha derivado a un ingeniero.",
    ru: "Это выходит за рамки текущей базы знаний. Во избежание ошибки вопрос передан инженеру.",
    th: "คำถามนี้อยู่นอกฐานความรู้ปัจจุบัน เพื่อหลีกเลี่ยงความผิดพลาด ได้ส่งต่อให้วิศวกรแล้ว",
    ar: "هذا السؤال خارج قاعدة المعرفة الحالية. لتجنب أي خطأ، تم تحويله إلى مهندس بشري."
  },
  ticket: {
    zh: "🎫 已生成工单 #SZ-NUM，服务工程师将在 2 小时内通过 WhatsApp / 邮件联系你（本对话记录已随工单附上）。",
    en: "🎫 Ticket #SZ-NUM created. A service engineer will contact you within 2 hours via WhatsApp / email (this conversation is attached).",
    es: "🎫 Ticket #SZ-NUM creado. Un ingeniero te contactará en 2 horas por WhatsApp / correo (esta conversación va adjunta).",
    ru: "🎫 Заявка #SZ-NUM создана. Инженер свяжется с вами в течение 2 часов через WhatsApp / e-mail (переписка приложена).",
    th: "🎫 สร้างใบงาน #SZ-NUM แล้ว วิศวกรจะติดต่อภายใน 2 ชั่วโมงทาง WhatsApp / อีเมล (แนบบทสนทนานี้แล้ว)",
    ar: "🎫 تم إنشاء التذكرة #SZ-NUM. سيتواصل معك مهندس خلال ساعتين عبر WhatsApp / البريد الإلكتروني."
  },
  offlineNote: {
    zh: "⚠️ 当前为离线规则模式（未配置 LLM_API_KEY），以下为手册原文摘录：",
    en: "⚠️ Offline rule mode (LLM_API_KEY not set). Excerpt from the manual:",
    es: "⚠️ Modo sin conexión (LLM_API_KEY no configurada). Extracto del manual:",
    ru: "⚠️ Автономный режим (LLM_API_KEY не задан). Выдержка из руководства:",
    th: "⚠️ โหมดออฟไลน์ (ยังไม่ได้ตั้ง LLM_API_KEY) ข้อความจากคู่มือ:",
    ar: "⚠️ الوضع دون اتصال (لم يتم ضبط LLM_API_KEY). مقتطف من الدليل:"
  },
  llmError: {
    zh: "⚠️ AI 接口暂时不可用，已切换为手册原文直出：",
    en: "⚠️ The AI API is temporarily unavailable; showing the manual excerpt directly:",
    es: "⚠️ La API de IA no está disponible temporalmente; se muestra el extracto del manual:",
    ru: "⚠️ API ИИ временно недоступен; показан фрагмент руководства:",
    th: "⚠️ API ของ AI ไม่พร้อมใช้งานชั่วคราว แสดงข้อความจากคู่มือโดยตรง:",
    ar: "⚠️ واجهة الذكاء الاصطناعي غير متاحة مؤقتًا؛ يتم عرض مقتطف الدليل مباشرة:"
  }
};
const t = (dict, lang) => dict[lang] || dict.en;

// ---------- 系统提示词 ----------
function buildSystem(chunks, lang) {
  const ctx = chunks.map((c, i) =>
    "[S" + (i + 1) + "] " + (c.code || "") + " " + (c.title || "") +
    "（来源 " + (c.ref || MANUAL) + "）\n" + c.body
  ).join("\n\n");
  return [
    "你是「" + DEVICE + "」的多语言售后技术支持助手，服务对象是海外工厂的一线操作工。",
    "铁律：",
    "1. 始终用【用户提问的语言】回答（当前用户语言：" + (LANG_NAME[lang] || lang) + "），禁止混用其他语言。",
    "2. 只能依据下方手册摘录作答；摘录里没有的内容，禁止编造参数、数值或步骤。",
    "3. 如果摘录无法回答用户问题：用用户语言简短说明超出范围，并在最后一行单独输出 [ESCALATE]。",
    "4. 回答结构：一句结论 → 编号处理步骤 → 注意事项；步骤里引用来源标记如 [S1]。",
    "5. 高风险故障（激光器、光路、电气）必须提醒：无法排除时停机并联系工程师，禁止自行拆修。",
    "6. 语气专业、简洁、可执行，面向车间现场。",
    "",
    "手册摘录：",
    ctx
  ].join("\n");
}

function offlineAnswer(chunks, lang) {
  const c = chunks[0];
  return t(T.offlineNote, lang) + "\n\n**" + (c.code || "") + " " + (c.title || "") + "**\n\n" +
    c.body + "\n\n— 📖 " + (c.ref || MANUAL);
}

function appendLog(entry) {
  try { fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n"); } catch (e) { /* 日志失败不影响对话 */ }
}

// ---------- 对话主逻辑 ----------
async function handleChat(body) {
  const started = Date.now();
  const message = String(body.message || "").trim();
  const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
  if (!message) return { error: "message required" };

  const lang = body.lang && body.lang !== "auto" ? body.lang : detectLang(message);
  const chunks = kbLib.search(KB, message, 3);

  let reply, mode = "llm", escalated = false;
  const ticketNo = "SZ-" + (1000 + Math.floor(Math.random() * 9000));

  if (chunks.length === 0) {
    escalated = true;
    mode = "no-hit";
    reply = t(T.noAnswer, lang) + "\n\n" + t(T.ticket, lang).replace("NUM", ticketNo.slice(3));
  } else if (!llm.isConfigured()) {
    mode = "offline";
    reply = offlineAnswer(chunks, lang);
  } else {
    try {
      const sys = buildSystem(chunks, lang);
      const msgs = [{ role: "system", content: sys },
        ...history.map(h => ({ role: h.role, content: String(h.content).slice(0, 2000) })),
        { role: "user", content: message }];
      reply = await llm.chatCompletion({ messages: msgs });
      if (!reply) { mode = "offline"; reply = offlineAnswer(chunks, lang); }
      else if (reply.includes("[ESCALATE]")) {
        escalated = true;
        reply = reply.replace("[ESCALATE]", "").trim() + "\n\n" +
          t(T.ticket, lang).replace("NUM", ticketNo.slice(3));
      }
    } catch (e) {
      mode = "llm-error";
      reply = t(T.llmError, lang) + "\n\n" + offlineAnswer(chunks, lang);
      console.error("[LLM]", e.message);
    }
  }

  const latencyMs = Date.now() - started;
  const sources = chunks.map(c => ({ code: c.code || "", title: c.title || "", ref: c.ref || MANUAL }));
  const logEntry = {
    ts: new Date().toISOString(), hour: new Date().getHours(),
    lang, message: message.slice(0, 300), mode, escalated,
    codes: sources.map(s => s.code).filter(Boolean), latencyMs
  };
  if (escalated) logEntry.ticket = ticketNo;
  appendLog(logEntry);

  return { reply, lang, langName: LANG_NAME[lang] || lang, mode, escalated, sources, latencyMs };
}

// ---------- 真实统计 ----------
function handleStats() {
  const empty = { total: 0, solved: 0, escalated: 0, avgLatencyMs: 0, nightRatio: 0,
    byLang: {}, byCode: {}, byDay: [], recent: [], llmConfigured: llm.isConfigured() };
  if (!fs.existsSync(LOG_FILE)) return empty;
  const lines = fs.readFileSync(LOG_FILE, "utf8").split("\n").filter(Boolean);
  const rows = [];
  for (const ln of lines) { try { rows.push(JSON.parse(ln)); } catch (e) {} }
  if (!rows.length) return empty;

  const byLang = {}, byCode = {}, dayMap = {};
  let latSum = 0, night = 0;
  rows.forEach(r => {
    byLang[r.lang] = (byLang[r.lang] || 0) + 1;
    (r.codes || []).forEach(c => { byCode[c] = (byCode[c] || 0) + 1; });
    const day = (r.ts || "").slice(0, 10);
    if (day) dayMap[day] = (dayMap[day] || 0) + 1;
    latSum += r.latencyMs || 0;
    if (typeof r.hour === "number" && (r.hour >= 22 || r.hour < 8)) night++;
  });
  const byDay = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    byDay.push({ day: d.slice(5), count: dayMap[d] || 0 });
  }
  return {
    total: rows.length,
    solved: rows.filter(r => !r.escalated).length,
    escalated: rows.filter(r => r.escalated).length,
    avgLatencyMs: Math.round(latSum / rows.length),
    nightRatio: Math.round(night / rows.length * 100),
    byLang, byCode, byDay,
    recent: rows.slice(-8).reverse().map(r => ({
      ts: r.ts, lang: r.lang, message: r.message, escalated: r.escalated, mode: r.mode
    })),
    llmConfigured: llm.isConfigured()
  };
}

// ---------- HTTP ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

function sendJson(res, obj, code = 200) {
  const s = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  res.end(s);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const p = decodeURIComponent(u.pathname);

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST,GET", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }
  if (p === "/api/health") {
    return sendJson(res, { ok: true, llm: llm.isConfigured(),
      model: llm.isConfigured() ? (process.env.LLM_MODEL || "gpt-4o-mini") : null,
      kbEntries: KB.length, device: DEVICE });
  }
  if (p === "/api/kb") {
    return sendJson(res, KB.map(c => ({ code: c.code || "", title: c.title || "",
      severity: c.severity || "", ref: c.ref || MANUAL, file: c.file })));
  }
  if (p === "/api/stats") return sendJson(res, handleStats());
  if (p === "/api/reload-kb") { KB = kbLib.load(KB_DIR); return sendJson(res, { ok: true, kbEntries: KB.length }); }
  if (p === "/api/chat" && req.method === "POST") {
    let raw = "";
    req.on("data", c => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on("end", async () => {
      let body = {};
      try { body = JSON.parse(raw || "{}"); } catch (e) { return sendJson(res, { error: "bad json" }, 400); }
      try { sendJson(res, await handleChat(body)); }
      catch (e) { console.error(e); sendJson(res, { error: "internal" }, 500); }
    });
    return;
  }

  // 静态文件
  let fp = p === "/" ? "/index.html" : p;
  const full = path.normalize(path.join(PUBLIC_DIR, fp));
  if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.writeHead(404); return res.end("not found");
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(full).toLowerCase()] || "application/octet-stream" });
  fs.createReadStream(full).pipe(res);
});

server.listen(PORT, () => {
  console.log("========================================");
  console.log("  多语售后 Agent 已启动");
  console.log("  本机访问:  http://localhost:" + PORT);
  console.log("  LLM:      " + (llm.isConfigured()
    ? (process.env.LLM_MODEL || "gpt-4o-mini") + " @ " + (process.env.LLM_BASE_URL || "openai")
    : "未配置（离线规则模式，配 .env 后重启即可）"));
  console.log("  知识库:    " + KB.length + " 个条目（knowledge/ 目录，改完访问 /api/reload-kb 热加载）");
  console.log("========================================");
});
