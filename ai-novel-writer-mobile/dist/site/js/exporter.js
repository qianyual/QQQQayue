/* ============================================================
 * 书童移动版 — 导出
 * 对齐桌面版 src/services/export-service.ts 的三种格式：
 *   merged-md 合并稿 / split-md 分章稿（打包 zip）/ txt 纯文本
 * zip 用 store（不压缩）自写，避免引入第三方库；中文名走 UTF-8 标志位
 * ============================================================ */
"use strict";

const Exporter = (() => {
  /* ---------------- CRC32 ---------------- */
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  const enc = new TextEncoder();

  function dosDateTime(d) {
    const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
    const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
    return { time, date };
  }

  /** files: [{name, text}] → Blob（zip，store 模式） */
  function zip(files, when) {
    const now = when || new Date();
    const { time, date } = dosDateTime(now);
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const f of files) {
      const nameBytes = enc.encode(f.name);
      const data = enc.encode(f.text);
      const crc = crc32(data);

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);          // version needed
      lh.setUint16(6, 0x0800, true);      // UTF-8 文件名
      lh.setUint16(8, 0, true);           // store
      lh.setUint16(10, time, true);
      lh.setUint16(12, date, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, nameBytes.length, true);
      lh.setUint16(28, 0, true);

      const localParts = [new Uint8Array(lh.buffer), nameBytes, data];
      const localSize = 30 + nameBytes.length + data.length;
      locals.push(...localParts);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, time, true);
      ch.setUint16(14, date, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true);
      ch.setUint32(24, data.length, true);
      ch.setUint16(28, nameBytes.length, true);
      ch.setUint16(30, 0, true);
      ch.setUint16(32, 0, true);
      ch.setUint16(34, 0, true);
      ch.setUint16(36, 0, true);
      ch.setUint32(38, 0, true);
      ch.setUint32(42, offset, true);
      centrals.push(new Uint8Array(ch.buffer), nameBytes);

      offset += localSize;
    }

    const centralSize = centrals.reduce((n, b) => n + b.length, 0);
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(8, files.length, true);
    eocd.setUint16(10, files.length, true);
    eocd.setUint32(12, centralSize, true);
    eocd.setUint32(16, offset, true);

    return new Blob([...locals, ...centrals, new Uint8Array(eocd.buffer)], { type: "application/zip" });
  }

  /* ---------------- 内容拼装 ---------------- */
  function pad3(n) { return String(n).padStart(3, "0"); }

  /** 章节正文去掉重复的章标题行 */
  function bodyOf(c, num) {
    const lines = String(c.content || "").replace(/\r\n/g, "\n").split("\n");
    if (lines.length && new RegExp(`^\\s*第\\s*${num}\\s*章`).test(lines[0])) lines.shift();
    return lines.join("\n").replace(/^\n+/, "").trim();
  }

  function chapterHeading(c, num) {
    const t = String(c.title || "").replace(new RegExp(`^第\\s*${num}\\s*章\\s*`), "").trim();
    return t ? `第${num}章 ${t}` : `第${num}章`;
  }

  function sortedChapters(n) {
    return [...(n.chapters || [])].filter(c => (c.content || "").trim()).sort((a, b) => a.chapterNumber - b.chapterNumber);
  }

  function outlineMd(n) {
    const cfg = n.config || {};
    const out = [`# ${n.name || "未命名作品"} · 大纲`, ""];
    out.push("## 作品设定", "");
    const field = (k, v) => { if (v) out.push(`- **${k}**：${v}`); };
    field("题材", [cfg.genre, cfg.subGenre].filter(Boolean).join(" / "));
    field("目标读者", cfg.targetAudience);
    field("计划章数", cfg.totalChapters ? `${cfg.totalChapters} 章` : "");
    field("单章目标", cfg.wordsPerChapter ? `${cfg.wordsPerChapter} 字` : "");
    field("叙事视角", cfg.narrativePOV);
    if (cfg.coreOutline) out.push("", "### 故事前提", "", cfg.coreOutline);
    if (cfg.worldSetting) out.push("", "### 世界观", "", cfg.worldSetting);
    if (cfg.goldenFinger) out.push("", "### 核心设定", "", cfg.goldenFinger);
    if (cfg.protagonistProfile) out.push("", "### 主角", "", cfg.protagonistProfile);
    if (cfg.writingStyle) out.push("", "### 文风", "", cfg.writingStyle);
    if (cfg.globalGuidance) out.push("", "### 全局写作指导", "", cfg.globalGuidance);

    if ((n.characters || []).length) {
      out.push("", "## 角色", "");
      for (const c of n.characters) {
        const bits = [c.role, c.gender, c.age].filter(Boolean).join(" · ");
        out.push(`### ${c.name || "未命名"}${bits ? `（${bits}）` : ""}`);
        if (c.personality) out.push(`- 性格：${c.personality}`);
        if (c.background) out.push(`- 背景：${c.background}`);
        if (c.motivation) out.push(`- 动机：${c.motivation}`);
        if (c.relationships) out.push(`- 关系：${c.relationships}`);
        out.push("");
      }
    }

    if ((n.blueprints || []).length) {
      out.push("## 分章蓝图", "");
      const bps = [...n.blueprints].sort((a, b) => a.chapterNumber - b.chapterNumber);
      for (const b of bps) {
        out.push(`### 第${b.chapterNumber}章 ${b.title || ""}`.trim());
        if (b.keyEvents) out.push(b.keyEvents);
        if (b.suspenseHook) out.push(`> 钩子：${b.suspenseHook}`);
        out.push("");
      }
    }
    return out.join("\n");
  }

  function mergedMd(n, opts) {
    const o = opts || {};
    const out = [`# ${n.name || "未命名作品"}`, ""];
    if (o.includeOutline) {
      out.push(outlineMd(n), "");
      out.push("---", "");
    }
    if (o.includeCharacters && !o.includeOutline && (n.characters || []).length) {
      out.push("## 人物表", "");
      for (const c of n.characters) out.push(`- **${c.name || "未命名"}**${c.role ? `（${c.role}）` : ""}：${c.personality || c.background || ""}`);
      out.push("", "---", "");
    }
    for (const c of sortedChapters(n)) {
      out.push(`## ${chapterHeading(c, c.chapterNumber)}`, "");
      const body = bodyOf(c, c.chapterNumber);
      if (body) out.push(body, "");
    }
    return out.join("\n");
  }

  function splitMd(n) {
    const files = [];
    if ((n.blueprints || []).length) files.push({ name: "00-大纲.md", text: outlineMd(n) });
    for (const c of sortedChapters(n)) {
      const body = bodyOf(c, c.chapterNumber);
      files.push({
        name: `第${pad3(c.chapterNumber)}章 ${String(c.title || "").replace(new RegExp(`^第\\s*${c.chapterNumber}\\s*章\\s*`), "").trim() || "正文"}.md`
          .replace(/[\\/:*?"<>|]/g, "_"),
        text: `# ${chapterHeading(c, c.chapterNumber)}\n\n${body}\n`,
      });
    }
    return files;
  }

  function txt(n) {
    const out = [n.name || "未命名作品", ""];
    for (const c of sortedChapters(n)) {
      out.push(chapterHeading(c, c.chapterNumber), "", bodyOf(c, c.chapterNumber), "");
    }
    return out.join("\n");
  }

  /* ---------------- 下载 ---------------- */
  function download(blob, filename) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  const safeName = (s) => String(s || "作品").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);

  function run(n, format, opts) {
    const o = opts || {};
    const base = safeName(n.name) + "-" + new Date().toISOString().slice(0, 10);
    if (format === "split-md") {
      const files = splitMd(n);
      if (!files.length) throw new Error("还没有可导出的章节");
      download(zip(files), base + "-分章.zip");
      return files.length;
    }
    if (format === "txt") {
      const text = txt(n);
      if (!text.trim()) throw new Error("还没有可导出的正文");
      download(new Blob(["\ufeff" + text], { type: "text/plain;charset=utf-8" }), base + ".txt");
      return 1;
    }
    const md = mergedMd(n, o);
    if (!md.trim()) throw new Error("还没有可导出的内容");
    download(new Blob([md], { type: "text/markdown;charset=utf-8" }), base + ".md");
    return 1;
  }

  return { run, zip, mergedMd, splitMd, outlineMd, txt, download, safeName };
})();
