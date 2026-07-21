// LLM 调用：OpenAI 兼容 /chat/completions，Node 18+ 原生 fetch，零依赖
function isConfigured() {
  return !!process.env.LLM_API_KEY;
}

async function chatCompletion({ messages, temperature = 0.2, maxTokens = 900, timeoutMs = 30000 }) {
  const key = process.env.LLM_API_KEY;
  if (!key) return null;
  const base = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.LLM_MODEL || "gpt-4o-mini";

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + key
      },
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
      signal: ctrl.signal
    });
    if (!r.ok) {
      const txt = await r.text();
      throw new Error("LLM " + r.status + ": " + txt.slice(0, 300));
    }
    const data = await r.json();
    const content = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : "";
    return (content || "").trim();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { chatCompletion, isConfigured };
