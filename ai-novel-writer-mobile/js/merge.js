/* ============================================================
 * 书童移动版 — 文本对齐 / 修稿合并 / 逐字对比
 * 段落对齐 DP 算法移植自桌面版 src/components/editor/merge-segments.ts
 *   支持 1:1 改写、1:2 / 1:3 拆段、2:1 / 3:1 并段
 * 字符级 diff 用 LCS（与 jsdiff 同源的思路），只在变化段落内计算
 * ============================================================ */
"use strict";

const Merge = (() => {
  /* ---------------- 文本工具 ---------------- */
  function stripFrontmatter(text) {
    const m = String(text || "").match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    return m ? text.slice(m[0].length) : String(text || "");
  }

  /** 段落 = 非空行块；空行是分隔符 */
  function extractParagraphs(text) {
    const lines = stripFrontmatter(text).replace(/\r\n/g, "\n").split("\n");
    const paras = [];
    let buf = [];
    for (const line of lines) {
      if (line.trim() === "") {
        if (buf.length) { paras.push(buf.join("\n")); buf = []; }
      } else buf.push(line);
    }
    if (buf.length) paras.push(buf.join("\n"));
    return paras;
  }

  function buildCharFreq(text) {
    const freq = new Map();
    for (const c of text) freq.set(c, (freq.get(c) || 0) + 1);
    return freq;
  }
  function mergeFreqs(...maps) {
    const merged = new Map();
    for (const m of maps) for (const [c, n] of m) merged.set(c, (merged.get(c) || 0) + n);
    return merged;
  }
  function simFromFreqs(fa, lenA, fb, lenB) {
    if (lenA === 0 && lenB === 0) return 1;
    if (lenA === 0 || lenB === 0) return 0;
    if (lenA > lenB * 5 || lenB > lenA * 5) return 0;
    let common = 0;
    const [smaller, larger] = fa.size <= fb.size ? [fa, fb] : [fb, fa];
    for (const [c, n] of smaller) common += Math.min(n, larger.get(c) || 0);
    return (2 * common) / (lenA + lenB);
  }

  /* ---------------- DP 段落对齐 ---------------- */
  const MATCH = 0, DELETE = 1, INSERT = 2, SPLIT_1_2 = 3, SPLIT_1_3 = 4, MERGE_2_1 = 5, MERGE_3_1 = 6;

  function alignParagraphs(origParas, modParas) {
    const n = origParas.length, m = modParas.length;
    const SIM_THRESH = 0.15, GAP = -0.05;

    const oFreqs = origParas.map(buildCharFreq);
    const mFreqs = modParas.map(buildCharFreq);
    const oLens = origParas.map(p => p.length);
    const mLens = modParas.map(p => p.length);

    const mPairFreqs = new Array(m), mPairLens = new Array(m);
    for (let j = 1; j < m; j++) { mPairFreqs[j] = mergeFreqs(mFreqs[j - 1], mFreqs[j]); mPairLens[j] = mLens[j - 1] + mLens[j]; }
    const mTriFreqs = new Array(m), mTriLens = new Array(m);
    for (let j = 2; j < m; j++) { mTriFreqs[j] = mergeFreqs(mFreqs[j - 2], mFreqs[j - 1], mFreqs[j]); mTriLens[j] = mLens[j - 2] + mLens[j - 1] + mLens[j]; }
    const oPairFreqs = new Array(n), oPairLens = new Array(n);
    for (let i = 1; i < n; i++) { oPairFreqs[i] = mergeFreqs(oFreqs[i - 1], oFreqs[i]); oPairLens[i] = oLens[i - 1] + oLens[i]; }
    const oTriFreqs = new Array(n), oTriLens = new Array(n);
    for (let i = 2; i < n; i++) { oTriFreqs[i] = mergeFreqs(oFreqs[i - 2], oFreqs[i - 1], oFreqs[i]); oTriLens[i] = oLens[i - 2] + oLens[i - 1] + oLens[i]; }

    const W = m + 1;
    const dp = new Float64Array((n + 1) * W).fill(-1e9);
    const op = new Uint8Array((n + 1) * W);
    dp[0] = 0;
    for (let i = 1; i <= n; i++) { dp[i * W] = i * GAP; op[i * W] = DELETE; }
    for (let j = 1; j <= m; j++) { dp[j] = j * GAP; op[j] = INSERT; }

    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        let best = -1e9, bestOp = MATCH;
        const cur = i * W + j;

        const s11 = simFromFreqs(oFreqs[i - 1], oLens[i - 1], mFreqs[j - 1], mLens[j - 1]);
        const v11 = dp[(i - 1) * W + j - 1] + (s11 >= SIM_THRESH ? s11 : s11 - 0.5);
        if (v11 > best) { best = v11; bestOp = MATCH; }

        const vd = dp[(i - 1) * W + j] + GAP;
        if (vd > best) { best = vd; bestOp = DELETE; }
        const vi = dp[i * W + j - 1] + GAP;
        if (vi > best) { best = vi; bestOp = INSERT; }

        if (j >= 2) {
          const s = simFromFreqs(oFreqs[i - 1], oLens[i - 1], mPairFreqs[j - 1], mPairLens[j - 1]);
          if (s >= SIM_THRESH) { const v = dp[(i - 1) * W + j - 2] + s * 0.95; if (v > best) { best = v; bestOp = SPLIT_1_2; } }
        }
        if (j >= 3) {
          const s = simFromFreqs(oFreqs[i - 1], oLens[i - 1], mTriFreqs[j - 1], mTriLens[j - 1]);
          if (s >= SIM_THRESH) { const v = dp[(i - 1) * W + j - 3] + s * 0.9; if (v > best) { best = v; bestOp = SPLIT_1_3; } }
        }
        if (i >= 2) {
          const s = simFromFreqs(oPairFreqs[i - 1], oPairLens[i - 1], mFreqs[j - 1], mLens[j - 1]);
          if (s >= SIM_THRESH) { const v = dp[(i - 2) * W + j - 1] + s * 0.95; if (v > best) { best = v; bestOp = MERGE_2_1; } }
        }
        if (i >= 3) {
          const s = simFromFreqs(oTriFreqs[i - 1], oTriLens[i - 1], mFreqs[j - 1], mLens[j - 1]);
          if (s >= SIM_THRESH) { const v = dp[(i - 3) * W + j - 1] + s * 0.9; if (v > best) { best = v; bestOp = MERGE_3_1; } }
        }
        dp[cur] = best; op[cur] = bestOp;
      }
    }

    const pairs = [];
    let ci = n, cj = m;
    while (ci > 0 || cj > 0) {
      if (ci === 0) { pairs.unshift({ origIdx: [], modIdx: [--cj] }); continue; }
      if (cj === 0) { pairs.unshift({ origIdx: [--ci], modIdx: [] }); continue; }
      switch (op[ci * W + cj]) {
        case MATCH: pairs.unshift({ origIdx: [ci - 1], modIdx: [cj - 1] }); ci--; cj--; break;
        case DELETE: pairs.unshift({ origIdx: [ci - 1], modIdx: [] }); ci--; break;
        case INSERT: pairs.unshift({ origIdx: [], modIdx: [cj - 1] }); cj--; break;
        case SPLIT_1_2: pairs.unshift({ origIdx: [ci - 1], modIdx: [cj - 2, cj - 1] }); ci--; cj -= 2; break;
        case SPLIT_1_3: pairs.unshift({ origIdx: [ci - 1], modIdx: [cj - 3, cj - 2, cj - 1] }); ci--; cj -= 3; break;
        case MERGE_2_1: pairs.unshift({ origIdx: [ci - 2, ci - 1], modIdx: [cj - 1] }); ci -= 2; cj--; break;
        case MERGE_3_1: pairs.unshift({ origIdx: [ci - 3, ci - 2, ci - 1], modIdx: [cj - 1] }); ci -= 3; cj--; break;
        default: pairs.unshift({ origIdx: [ci - 1], modIdx: [cj - 1] }); ci--; cj--;
      }
    }
    return pairs;
  }

  function buildSegments(origParas, modParas, pairs) {
    const segments = [];
    let hunkIdx = 0;
    const parasToLines = (paras, indices) => {
      const lines = [];
      indices.forEach((idx, i) => {
        if (i > 0) lines.push("");
        lines.push(...paras[idx].split("\n"));
      });
      return lines;
    };
    for (let p = 0; p < pairs.length; p++) {
      const pair = pairs[p];
      const origLines = pair.origIdx.length ? parasToLines(origParas, pair.origIdx) : [];
      const modLines = pair.modIdx.length ? parasToLines(modParas, pair.modIdx) : [];
      const isSame = origLines.length > 0 && modLines.length > 0 &&
        origLines.length === modLines.length && origLines.every((l, i) => l === modLines[i]);
      if (isSame) segments.push({ type: "same", lines: origLines });
      else segments.push({ type: "hunk", hunk: { index: hunkIdx++, originalLines: origLines, modifiedLines: modLines } });
      if (p < pairs.length - 1) segments.push({ type: "same", lines: [""] });
    }
    return segments;
  }

  /** 入口：段落级对齐片段 */
  function computeSegments(original, modified) {
    const o = extractParagraphs(original);
    const m = extractParagraphs(modified);
    if (!o.length && !m.length) return [];
    /* 极端长文保护：段数过大时退化为顺序配对，避免 DP 卡住 */
    if (o.length * m.length > 250000) {
      const len = Math.max(o.length, m.length);
      const pairs = [];
      for (let i = 0; i < len; i++) pairs.push({ origIdx: i < o.length ? [i] : [], modIdx: i < m.length ? [i] : [] });
      return buildSegments(o, m, pairs);
    }
    return buildSegments(o, m, alignParagraphs(o, m));
  }

  /** 合并：segments + 每段选中的文字 → 全文 */
  function joinSegments(segments, texts) {
    return segments.map((s, i) => (texts[i] === undefined ? (s.lines || []).join("\n") : texts[i])).join("\n");
  }

  /** 统计改动处数 */
  function hunkCount(segments) {
    return segments.reduce((n, s) => n + (s.type === "hunk" ? 1 : 0), 0);
  }

  return { computeSegments, extractParagraphs, joinSegments, hunkCount, buildCharFreq, stripFrontmatter };
})();

/* ============================================================
 * 字符级 / 行级 diff（用于「版本逐字对比」）
 * 段落先做对齐，只有真正改写的段落才进 LCS，长章也不会卡
 * ============================================================ */
const TextDiff = (() => {
  const MAX_CELLS = 1_200_000;

  /** LCS 前缀/后缀裁剪 + DP 回溯 */
  function lcsOps(a, b) {
    let start = 0;
    const aLen = a.length, bLen = b.length;
    while (start < aLen && start < bLen && a[start] === b[start]) start++;
    let endA = aLen, endB = bLen;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

    const A = a.slice(start, endA), B = b.slice(start, endB);
    const n = A.length, m = B.length;
    const ops = [];
    const push = (type, text) => {
      if (!text) return;
      const last = ops[ops.length - 1];
      if (last && last.type === type) last.text += text;
      else ops.push({ type, text });
    };
    push("eq", a.slice(0, start));

    if (!n && !m) { push("eq", a.slice(start, endA)); push("eq", a.slice(endA)); return ops; }
    if (!n) { push("ins", B); push("eq", a.slice(endA)); return ops; }
    if (!m) { push("del", A); push("eq", a.slice(endA)); return ops; }

    if ((n + 1) * (m + 1) > MAX_CELLS) {
      /* 太大：整段视为替换，避免一次性吃满内存 */
      push("del", A); push("ins", B); push("eq", a.slice(endA));
      return ops;
    }

    const W = m + 1;
    const dp = new Uint16Array((n + 1) * W);
    for (let i = 1; i <= n; i++) {
      const ai = A.charCodeAt(i - 1);
      for (let j = 1; j <= m; j++) {
        dp[i * W + j] = ai === B.charCodeAt(j - 1)
          ? dp[(i - 1) * W + j - 1] + 1
          : Math.max(dp[(i - 1) * W + j], dp[i * W + j - 1]);
      }
    }
    const stack = [];
    let i = n, j = m;
    while (i > 0 && j > 0) {
      if (A[i - 1] === B[j - 1]) { stack.push({ type: "eq", text: A[i - 1] }); i--; j--; }
      else if (dp[(i - 1) * W + j] >= dp[i * W + j - 1]) { stack.push({ type: "del", text: A[i - 1] }); i--; }
      else { stack.push({ type: "ins", text: B[j - 1] }); j--; }
    }
    while (i > 0) { stack.push({ type: "del", text: A[--i] }); }
    while (j > 0) { stack.push({ type: "ins", text: B[--j] }); }
    for (let k = stack.length - 1; k >= 0; k--) push(stack[k].type, stack[k].text);

    push("eq", a.slice(endA));
    return ops;
  }

  /** 字符级差异：返回 [{type:'eq'|'del'|'ins', text}] */
  function diffChars(a, b) { return lcsOps(String(a || ""), String(b || "")); }

  /**
   * 段落级差异视图：返回 [{kind:'same'|'change', original, modified, ops?}]
   * same 段落直接跳过字符计算；change 段落带字符级 ops
   */
  function diffParagraphs(original, modified) {
    const segments = Merge.computeSegments(original, modified);
    const out = [];
    for (const s of segments) {
      if (s.type === "same") { out.push({ kind: "same", original: (s.lines || []).join("\n") }); continue; }
      const h = s.hunk;
      out.push({
        kind: "change",
        original: h.originalLines.join("\n"),
        modified: h.modifiedLines.join("\n"),
        ops: lcsOps(h.originalLines.join("\n"), h.modifiedLines.join("\n")),
      });
    }
    return out;
  }

  /** 差异统计：新增/删除字符数 */
  function stat(ops) {
    let added = 0, removed = 0;
    for (const o of ops) {
      if (o.type === "ins") added += o.text.length;
      else if (o.type === "del") removed += o.text.length;
    }
    return { added, removed };
  }

  return { diffChars, diffParagraphs, stat };
})();
