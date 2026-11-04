/* ============================================================
 * 书童移动版 — EPUB 解析
 * 桌面版用 yauzl + Node 流；浏览器里用原生 DecompressionStream('deflate-raw')
 * 自己读 zip 中央目录，再按 META-INF/container.xml → OPF → spine 取章节
 * 不做 DRM 破解：检测到加密正文直接报错
 * ============================================================ */
"use strict";

const Epub = (() => {
  const dec = new TextDecoder("utf-8");
  const decGb = new TextDecoder("gb18030");

  function hasInflate() {
    return typeof DecompressionStream === "function";
  }

  /* ---------------- zip 目录 ---------------- */
  function readZip(buf) {
    const view = new DataView(buf);
    /* EOCD 在文件尾部，最多回溯 64KB（含注释） */
    let eocd = -1;
    const floor = Math.max(0, buf.byteLength - 66000);
    for (let i = buf.byteLength - 22; i >= floor; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("不是有效的 EPUB（zip 结构缺失）");
    const count = view.getUint16(eocd + 10, true);
    const cdOffset = view.getUint32(eocd + 16, true);
    if (!count || cdOffset >= buf.byteLength) throw new Error("EPUB 目录为空");

    const entries = new Map();
    let p = cdOffset;
    for (let i = 0; i < count; i++) {
      if (p + 46 > buf.byteLength || view.getUint32(p, true) !== 0x02014b50) break;
      const method = view.getUint16(p + 10, true);
      const csize = view.getUint32(p + 20, true);
      const usize = view.getUint32(p + 24, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const localOffset = view.getUint32(p + 42, true);
      /* 少数打包工具（含 Windows 自带压缩）用反斜杠分隔，统一成正斜杠 */
      const name = dec.decode(new Uint8Array(buf, p + 46, nameLen)).replace(/\\/g, "/");
      entries.set(name, { method, csize, usize, localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  async function entryBytes(buf, entry) {
    const view = new DataView(buf);
    const p = entry.localOffset;
    if (p + 30 > buf.byteLength || view.getUint32(p, true) !== 0x04034b50) throw new Error("EPUB 条目损坏");
    const nameLen = view.getUint16(p + 26, true);
    const extraLen = view.getUint16(p + 28, true);
    const start = p + 30 + nameLen + extraLen;
    const raw = new Uint8Array(buf, start, entry.csize);
    if (entry.method === 0) return raw;
    if (entry.method !== 8) throw new Error("EPUB 使用了不支持的压缩方式");
    if (!hasInflate()) throw new Error("当前系统组件太旧，无法解压 EPUB。请改用 .txt 导入，或升级系统 WebView");
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function entryText(buf, entries, name) {
    const e = entries.get(name);
    if (!e) return "";
    const bytes = await entryBytes(buf, e);
    const utf8 = dec.decode(bytes);
    /* 老书常见 GBK 声明，替换字符过多时用 gb18030 重解 */
    if ((utf8.match(/\ufffd/g) || []).length > 8) return decGb.decode(bytes);
    return utf8;
  }

  /* ---------------- 路径与 XML ---------------- */
  function resolvePath(baseDir, rel) {
    const clean = decodeURIComponent(String(rel || "").split(/[?#]/)[0]);
    const parts = (baseDir ? baseDir.split("/") : []).concat(clean.split("/"));
    const stack = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") stack.pop();
      else stack.push(part);
    }
    return stack.join("/");
  }
  function dirOf(p) { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); }

  function decodeEntities(s) {
    const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
    return s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, body) => {
      if (body[0] !== "#") return named[body.toLowerCase()] ?? m;
      const hex = body[1] && body[1].toLowerCase() === "x";
      const cp = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      try { return Number.isFinite(cp) ? String.fromCodePoint(cp) : m; } catch { return m; }
    });
  }

  function attrs(source) {
    const out = {};
    for (const m of source.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)) out[m[1].toLowerCase()] = decodeEntities(m[3]);
    return out;
  }

  /** xhtml → 纯段落文本 */
  function htmlToText(html) {
    let s = String(html || "");
    s = s.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "");
    s = s.replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote)>/gi, "\n");
    s = s.replace(/<br\s*\/?>/gi, "\n");
    s = s.replace(/<[^>]+>/g, "");
    s = decodeEntities(s);
    return s
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map(l => l.replace(/[\t\u00a0\u3000]+/g, " ").trim())
      .filter((l, i, arr) => l || (arr[i - 1] && arr[i - 1] !== ""))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function titleOf(html, fallback) {
    const h = String(html || "");
    for (const tag of ["h1", "h2", "h3", "title"]) {
      const m = h.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      if (m) {
        const t = decodeEntities(m[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
        if (t && t.length <= 60) return t;
      }
    }
    return fallback;
  }

  /* ---------------- 主流程 ---------------- */
  async function parse(arrayBuffer, onProgress) {
    const buf = arrayBuffer instanceof ArrayBuffer ? arrayBuffer : arrayBuffer.buffer;
    const entries = readZip(buf);
    if (!entries.size) throw new Error("EPUB 里没有文件");

    /* DRM：加密正文直接拒绝（字体混淆不算） */
    if (entries.has("META-INF/encryption.xml")) {
      const encXml = await entryText(buf, entries, "META-INF/encryption.xml");
      if (/EncryptedData/i.test(encXml) && !/font/i.test(encXml)) {
        throw new Error("这本 EPUB 带 DRM 加密，无法解析。请用无 DRM 的版本或转成 .txt");
      }
    }

    const container = await entryText(buf, entries, "META-INF/container.xml");
    let opfPath = "";
    const rootMatch = container.match(/<rootfile[^>]*full-path\s*=\s*(["'])(.*?)\1/i);
    if (rootMatch) opfPath = decodeURIComponent(rootMatch[2]);
    if (!opfPath) opfPath = [...entries.keys()].find(k => /\.opf$/i.test(k)) || "";
    if (!opfPath) throw new Error("EPUB 缺少 OPF 清单");

    const opf = await entryText(buf, entries, opfPath);
    const baseDir = dirOf(opfPath);

    /* manifest */
    const manifest = new Map();
    for (const m of opf.matchAll(/<item\b([^>]*)\/?>/gi)) {
      const a = attrs(m[1]);
      if (a.id && a.href) manifest.set(a.id, { href: a.href, type: a["media-type"] || "", props: a.properties || "" });
    }
    /* spine */
    const order = [];
    for (const m of opf.matchAll(/<itemref\b([^>]*)\/?>/gi)) {
      const a = attrs(m[1]);
      if (a.idref && manifest.has(a.idref)) order.push(manifest.get(a.idref));
    }
    let docs = order;
    if (!docs.length) {
      docs = [...manifest.values()].filter(it => /x?html/i.test(it.type) || /\.x?html?$/i.test(it.href));
    }
    if (!docs.length) throw new Error("EPUB 里没有可读的章节文件");

    const chapters = [];
    let i = 0;
    for (const doc of docs) {
      i++;
      const path = resolvePath(baseDir, doc.href);
      if (!entries.has(path)) continue;
      if (onProgress) onProgress(i, docs.length);
      const html = await entryText(buf, entries, path);
      const text = htmlToText(html);
      if (text.length < 20) continue;   // 封面、版权页、目录页跳过
      chapters.push({ title: titleOf(html, `第${chapters.length + 1}节`), text });
    }
    if (!chapters.length) throw new Error("没有解析出正文（可能是纯图片版 EPUB）");

    /* 书名 */
    const titleTag = opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
    const title = titleTag ? decodeEntities(titleTag[1].replace(/<[^>]+>/g, "")).trim() : "";

    return { title, chapters };
  }

  /** 章节 → 规范文本（带「第N章」标记，复用现有拆章与拆书流程） */
  function toText(parsed) {
    return parsed.chapters.map((c, i) => {
      const head = new RegExp(`^第\\s*${i + 1}\\s*章`).test(c.title) ? c.title : `第${i + 1}章 ${c.title}`;
      return `${head}\n\n${c.text}`;
    }).join("\n\n");
  }

  return { parse, toText, htmlToText, supports: hasInflate };
})();
