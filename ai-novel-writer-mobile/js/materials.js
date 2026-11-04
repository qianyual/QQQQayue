/* ============================================================
 * 书童移动版 — 参考资料库（对应桌面版 knowledge-service + LanceDB 检索）
 *
 * 桌面版用向量库做语义检索，手机上跑不动 embedding 模型，这里换成
 * 「切块 + BM25 关键词检索」：资料按段落切成 600 字左右的块，
 * 检索时用中文 2-gram + 英文词打分，取相关度最高的几块注入写稿提示词。
 * 效果不如向量，但对"查设定/查名词/找参考段落"这类需求够用，且完全离线。
 * ============================================================ */
"use strict";

window.Materials = (() => {
  const CHUNK = 620;          // 每块目标字数
  const OVERLAP = 90;         // 块间重叠，避免句子被切断后检索不到
  const MAX_TOTAL = 800000;   // 单本作品资料总量上限（字符），防止把存储撑爆

  const uid = () => "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* ---------- 切词：中文二元组 + 英文/数字词 ---------- */
  const STOP = new Set(["的了", "是在", "我们", "你们", "他们", "这个", "那个", "什么", "一个", "没有", "可以", "就是", "因为", "所以", "但是"]);

  function tokens(text) {
    const s = String(text || "").toLowerCase();
    const out = [];
    const ascii = s.match(/[a-z0-9_]+/g);
    if (ascii) for (const w of ascii) if (w.length > 1) out.push(w);
    const cjk = s.replace(/[^\u4e00-\u9fa5]/g, " ");
    for (const seg of cjk.split(/\s+/)) {
      if (!seg) continue;
      if (seg.length === 1) { out.push(seg); continue; }
      for (let i = 0; i < seg.length - 1; i++) {
        const g = seg.slice(i, i + 2);
        if (!STOP.has(g)) out.push(g);
      }
    }
    return out;
  }

  /* ---------- 切块 ---------- */
  function chunkText(text) {
    const clean = String(text || "").replace(/\r\n/g, "\n").replace(/[ \t\u3000]+/g, " ").trim();
    if (!clean) return [];
    const paras = clean.split(/\n+/).map(s => s.trim()).filter(Boolean);
    const chunks = [];
    let buf = "";
    const flush = () => { if (buf.trim()) chunks.push(buf.trim()); buf = ""; };
    for (const p of paras) {
      if (p.length >= CHUNK) {
        flush();
        for (let i = 0; i < p.length; i += CHUNK - OVERLAP) {
          const piece = p.slice(i, i + CHUNK).trim();
          if (piece) chunks.push(piece);
          if (i + CHUNK >= p.length) break;
        }
        continue;
      }
      if (buf.length + p.length + 1 > CHUNK) {
        const tail = buf.slice(-OVERLAP);
        flush();
        buf = (tail ? tail + "\n" : "") + p;
      } else {
        buf += (buf ? "\n" : "") + p;
      }
    }
    flush();
    return chunks.filter(c => c.length > 20);
  }

  /* ---------- CRUD ---------- */
  function list(novel) { return (novel && novel.materials) || []; }

  function totalChars(novel) {
    return list(novel).reduce((s, m) => s + (m.chars || 0), 0);
  }

  /**
   * 新增一份资料。返回 { material, error }
   * 超出总量上限时拒绝，避免 localStorage 降级模式下写爆。
   */
  function add(novel, { title, text, source }) {
    const clean = String(text || "").replace(/\r\n/g, "\n").trim();
    if (!clean) return { error: "内容为空" };
    if (clean.length < 40) return { error: "内容太短，至少 40 字" };
    if (totalChars(novel) + clean.length > MAX_TOTAL) {
      return { error: `资料总量会超过 ${Math.round(MAX_TOTAL / 10000)} 万字上限，先删掉一些旧资料` };
    }
    const chunks = chunkText(clean);
    if (!chunks.length) return { error: "没能切出有效段落" };
    const material = {
      id: uid(),
      title: (title || "").trim() || clean.slice(0, 16).replace(/\n/g, " "),
      source: source || "粘贴",
      addedAt: Date.now(),
      enabled: true,
      chars: clean.length,
      preview: clean.slice(0, 260),
      chunks,
    };
    if (!Array.isArray(novel.materials)) novel.materials = [];
    novel.materials.push(material);
    return { material };
  }

  function remove(novel, id) {
    if (!Array.isArray(novel.materials)) return false;
    const i = novel.materials.findIndex(m => m.id === id);
    if (i < 0) return false;
    novel.materials.splice(i, 1);
    return true;
  }

  function setEnabled(novel, id, on) {
    const m = list(novel).find(x => x.id === id);
    if (!m) return false;
    m.enabled = !!on;
    return true;
  }

  function rename(novel, id, title) {
    const m = list(novel).find(x => x.id === id);
    if (!m) return false;
    m.title = String(title || "").trim() || m.title;
    return true;
  }

  /* ---------- BM25 检索 ---------- */
  function collect(novel) {
    const rows = [];
    for (const m of list(novel)) {
      if (m.enabled === false) continue;
      for (const text of m.chunks || []) rows.push({ materialId: m.id, title: m.title, text });
    }
    return rows;
  }

  /**
   * @returns [{ text, title, materialId, score }]
   */
  function search(novel, query, k = 4) {
    const rows = collect(novel);
    if (!rows.length) return [];
    const q = [...new Set(tokens(query))];
    if (!q.length) return [];

    /* 预计算每块的词频与长度 */
    const docs = rows.map(r => {
      const tk = tokens(r.text);
      const tf = Object.create(null);
      for (const t of tk) tf[t] = (tf[t] || 0) + 1;
      return { row: r, tf, len: tk.length || 1 };
    });

    const N = docs.length;
    const avgLen = docs.reduce((s, d) => s + d.len, 0) / N;
    const df = Object.create(null);
    for (const t of q) df[t] = docs.reduce((s, d) => s + (d.tf[t] ? 1 : 0), 0);

    const k1 = 1.4, b = 0.72;
    const scored = [];
    for (const d of docs) {
      let score = 0;
      for (const t of q) {
        const f = d.tf[t] || 0;
        if (!f) continue;
        const idf = Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5));
        score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / avgLen));
      }
      /* 命中的查询词越多越相关，按覆盖率加权 */
      const hit = q.filter(t => d.tf[t]).length;
      score *= 0.6 + 0.4 * (hit / q.length);
      if (score > 0) scored.push({ ...d.row, score });
    }
    if (!scored.length) return [];
    scored.sort((a, z) => z.score - a.score);

    /* 资料少的时候 BM25 的 idf 会很低，绝对阈值不可靠：
       改成"相对最高分"的截断，只有明显不相关的才丢掉 */
    const floor = Math.max(0.08, scored[0].score * 0.32);

    /* 同一份资料最多取 2 块，避免一段内容刷屏 */
    const picked = [];
    const perMat = Object.create(null);
    for (const r of scored) {
      if (r.score < floor) break;
      const c = perMat[r.materialId] || 0;
      if (c >= 2) continue;
      perMat[r.materialId] = c + 1;
      picked.push(r);
      if (picked.length >= k) break;
    }
    return picked;
  }

  /* ---------- 注入提示词的上下文块 ---------- */
  function context(novel, query, k = 4) {
    const hits = search(novel, query, k);
    if (!hits.length) return "";
    const body = hits.map((h, i) => `[${i + 1}]《${h.title}》\n${h.text}`).join("\n\n");
    return `<参考资料（从作者导入的资料库里检索到的相关段落，只作事实与用词参考，不要照抄情节）>\n${body}\n</参考资料>\n`;
  }

  function stats(novel) {
    const ms = list(novel);
    return {
      count: ms.length,
      enabled: ms.filter(m => m.enabled !== false).length,
      chunks: ms.reduce((s, m) => s + (m.chunks || []).length, 0),
      chars: totalChars(novel),
    };
  }

  return { add, remove, setEnabled, rename, list, search, context, stats, totalChars, chunkText, tokens, MAX_TOTAL };
})();
