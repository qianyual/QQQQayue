/* ============================================================
 * 书童移动版 — LLM 调用层
 * 对应桌面版 electron/llm/{openai-provider,gemini-provider,llm-factory}.ts
 * 两种线协议：openai（Chat Completions SSE）、gemini（streamGenerateContent alt=sse）
 * 浏览器直连：要求服务商允许 CORS（DeepSeek/SiliconFlow/Gemini/OpenAI 均可）
 * ============================================================ */
"use strict";

const LLM = (() => {

  function normalizeBaseUrl(url) {
    return (url || "").trim().replace(/\/+$/, "");
  }

  /* ---------------- 字段清洗与请求头安全校验 ----------------
   * 从微信/备忘录/输入法复制 Key 时，常会带上全角空格(U+3000)、不间断空格(U+00A0)、
   * 零宽字符(U+200B~200D)、BOM(U+FEFF) 或换行。浏览器 fetch 构造请求头只接受
   * ISO-8859-1 字符，一旦混入中文或全角符号就会抛
   * "Failed to read the 'headers' property ... non ISO-8859-1 code point"。 */
  const INVISIBLE = /[\u00A0\u1680\u2000-\u200D\u2028\u2029\u202F\u205F\u3000\uFEFF]/g;

  function cleanField(v) {
    return String(v == null ? "" : v)
      .replace(INVISIBLE, "")   // 全角空格/零宽字符/BOM
      .replace(/[\r\n\t]/g, "") // 换行与制表符
      .trim();
  }

  /* 清洗后仍含非 ASCII 字符 → 给出人能看懂的定位提示，而不是底层 TypeError */
  function assertHeaderSafe(model) {
    const fields = [
      ["API Key", model.apiKey, "API Key 只能包含字母、数字、- 和 _，请删掉重填"],
      ["Base URL", model.baseUrl, "Base URL 只能包含英文和符号"],
      ["模型名", model.modelName, "模型名只能包含英文、数字、- 和 .（如 deepseek-chat）"],
    ];
    const bad = fields.filter(([, v]) => /[^\x20-\x7E]/.test(String(v || "")));
    if (bad.length) {
      throw new Error(
        `${bad.map(b => b[0]).join("、")} 里混入了中文、全角符号或乱码字符。` +
        bad.map(b => b[2]).join("；")
      );
    }
  }

  /* 统一入口：streamChat(model, messages, {onDelta, signal, temperature, maxTokens})
   * messages: [{role:'system'|'user'|'assistant', content}] 返回完整文本。
   * 非 model 对象则抛错。 */
  async function streamChat(model, messages, opts = {}) {
    if (!model || !model.modelName) throw new Error("请先在「设置」里配置模型");
    /* 先自动清洗三个可能被污染成请求头的字段（多数情况这样就自动修好了） */
    model = Object.assign({}, model, {
      baseUrl: cleanField(model.baseUrl),
      modelName: cleanField(model.modelName),
      apiKey: cleanField(model.apiKey),
    });
    assertHeaderSafe(model);
    const onDelta = opts.onDelta || (() => {});
    let text = "";
    if (model.protocol === "gemini") {
      text = await streamGemini(model, messages, opts, onDelta);
    } else {
      text = await streamOpenAI(model, messages, opts, onDelta);
    }
    return text;
  }

  async function streamOpenAI(model, messages, opts, onDelta) {
    const base = normalizeBaseUrl(model.baseUrl);
    if (!base) throw new Error("该模型缺少 Base URL");
    const url = base + "/chat/completions";
    const body = {
      model: model.modelName,
      messages,
      stream: true,
      temperature: numOr(model.temperature, 0.8),
    };
    const mt = numOr(model.maxTokens, 0);
    if (mt > 0) body.max_tokens = mt;
    const headers = { "Content-Type": "application/json" };
    if (model.apiKey) headers["Authorization"] = "Bearer " + model.apiKey;

    const resp = await fetchWithTimeout(url, {
      method: "POST", headers, body: JSON.stringify(body), signal: opts.signal,
    });
    if (!resp.ok) throw new Error(await readHttpError(resp));
    return consumeSSE(resp, (json) => {
      const d = json.choices && json.choices[0] && json.choices[0].delta;
      return (d && d.content) || "";
    }, onDelta);
  }

  async function streamGemini(model, messages, opts, onDelta) {
    const base = normalizeBaseUrl(model.baseUrl || "https://generativelanguage.googleapis.com");
    const url = `${base}/v1beta/models/${encodeURIComponent(model.modelName)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(model.apiKey || "")}`;
    const sysParts = messages.filter(m => m.role === "system").map(m => ({ text: m.content }));
    const contents = messages.filter(m => m.role !== "system").map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
    const body = {
      contents,
      generationConfig: {
        temperature: numOr(model.temperature, 0.8),
        ...(numOr(model.maxTokens, 0) > 0 ? { maxOutputTokens: numOr(model.maxTokens, 0) } : {}),
      },
    };
    if (sysParts.length) body.systemInstruction = { parts: sysParts };
    const resp = await fetchWithTimeout(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: opts.signal,
    });
    if (!resp.ok) throw new Error(await readHttpError(resp));
    return consumeSSE(resp, (json) => {
      const c = json.candidates && json.candidates[0];
      const parts = c && c.content && c.content.parts;
      return parts ? parts.map(p => p.text || "").join("") : "";
    }, onDelta);
  }

  /* SSE 消费：逐行解析 data: 前缀，[DONE] 结束 */
  async function consumeSSE(resp, pick, onDelta) {
    if (!resp.body || typeof resp.body.getReader !== "function") {
      /* 兜底：环境不支持流式读取（如原生桥接 fetch）时一次性解析全文 */
      return parseSSEText(await resp.text(), pick, onDelta);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "", full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        let json;
        try { json = JSON.parse(payload); } catch { continue; }
        const piece = pick(json);
        if (piece) { full += piece; onDelta(piece, full); }
      }
    }
    if (!full) throw new Error("模型没有返回内容（检查模型名或余额）");
    return full;
  }

  /* 整段 SSE 文本解析（非流式兜底用） */
  function parseSSEText(text, pick, onDelta) {
    let full = "";
    for (const line of String(text).split("\n")) {
      const l = line.trim();
      if (!l.startsWith("data:")) continue;
      const payload = l.slice(5).trim();
      if (payload === "[DONE]") continue;
      let json;
      try { json = JSON.parse(payload); } catch { continue; }
      const piece = pick(json);
      if (piece) { full += piece; onDelta(piece, full); }
    }
    if (!full) throw new Error("模型没有返回内容（检查模型名或余额）");
    return full;
  }

  async function fetchWithTimeout(url, init) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 180000); // 长文生成给足 3 分钟
    if (init.signal) init.signal.addEventListener("abort", () => ctrl.abort());
    try {
      const resp = await fetch(url, { ...init, signal: ctrl.signal });
      return resp;
    } catch (e) {
      if (e.name === "AbortError") throw e;
      const msg = String((e && e.message) || e);
      if (msg.includes("ISO-8859-1")) {
        throw new Error("请求头里有非法字符：API Key 或模型名中混入了中文/全角符号，请重新粘贴（只需字母数字）");
      }
      if (/Failed to fetch|NetworkError|Load failed|Network request failed/i.test(msg)) {
        throw new Error("网络请求失败：无法连接到服务商（检查网络，或确认该地址允许跨域访问）");
      }
      throw new Error("请求出错：" + msg);
    } finally {
      clearTimeout(t);
    }
  }

  async function readHttpError(resp) {
    let detail = "";
    try { detail = (await resp.text()).slice(0, 300); } catch {}
    const s = resp.status;
    if (s === 401 || s === 403) return `鉴权失败（${s}）：API Key 无效、填错服务商，或该 Key 没有此模型的权限。请重新复制 Key。`;
    if (s === 402) return `余额不足（${s}）：请到服务商后台充值后再试。`;
    if (s === 404) return `接口/模型不存在（404）：检查 Base URL 是否多写或漏写路径，模型名是否写全（DeepSeek 是 deepseek-chat）。`;
    if (s === 400) return `请求被拒绝（400）：常见是模型名写错或参数不支持。${detail}`;
    if (s === 429) return `请求过于频繁或额度用尽（429）：稍等一会儿再试。`;
    if (s >= 500) return `服务商服务器异常（${s}）：稍后重试。`;
    return `请求失败（${s}）${detail}`;
  }

  function numOr(v, d) { const n = Number(v); return isFinite(n) && n > 0 ? n : d; }

  /* ---------- JSON 宽容解析 ---------- */
  function extractJSON(text) {
    let t = text.trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    const start = Math.min(...["[", "{"].map(c => { const i = t.indexOf(c); return i < 0 ? Infinity : i; }));
    if (!isFinite(start)) throw new Error("输出中没有找到 JSON");
    t = t.slice(start);
    // 从后往前找闭合
    const endBrackets = { "[": "]", "{": "}" };
    const open = t[0];
    const close = endBrackets[open];
    let depth = 0, end = -1, inStr = false, esc = false;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === open) depth++;
      else if (ch === close) { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) throw new Error("JSON 不完整");
    return JSON.parse(t.slice(0, end + 1));
  }

  /* ---------- 便捷：一次生成 + JSON 解析（带一次重试） ---------- */
  async function generateJSON(model, messages, opts) {
    try {
      const text = await streamChat(model, messages, opts || {});
      return extractJSON(text);
    } catch (e) {
      // 重试一次，强调裸 JSON
      const retry = [...messages];
      const last = retry[retry.length - 1];
      retry[retry.length - 1] = { role: last.role, content: last.content + "\n\n【注意】上一次输出解析失败，请严格输出裸 JSON，不要任何多余文字或代码块。" };
      const text = await streamChat(model, retry, opts || {});
      return extractJSON(text);
    }
  }

  return { streamChat, generateJSON, extractJSON };
})();
