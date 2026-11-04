/* ============================================================
 * 书童移动版 — 本地持久层
 * 对应桌面版 better-sqlite3 + 项目文件夹；移动端坚持“本地优先”：
 * 首选 IndexedDB；不可用/被禁（无痕模式、受限 WebView、企业策略）时
 * 自动降级到 localStorage。两种模式对外 API 完全一致。
 * ============================================================ */
"use strict";

const DB = (() => {
  const DB_NAME = "anw-mobile";
  const DB_VERSION = 1;
  const LS_NOVELS = "anw-mobile:novels";
  const LS_KV = "anw-mobile:kv";
  let mode = null; // 'idb' | 'ls'
  let dbPromise = null;

  /* ---------- 模式探测：IDB 能打开且能完成一次真实读写才可用，否则降级 localStorage ---------- */
  function detect() {
    if (mode) return Promise.resolve(mode);
    if (typeof indexedDB === "undefined") { mode = "ls"; return Promise.resolve(mode); }
    return new Promise((resolve) => {
      let settled = false;
      const fallback = () => { if (!settled) { settled = true; mode = "ls"; resolve(mode); } };
      const timer = setTimeout(fallback, 2500);
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("novels")) db.createObjectStore("novels", { keyPath: "id" });
          if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        };
        req.onsuccess = () => {
          const db = req.result;
          dbPromise = Promise.resolve(db);
          // 真实读写往返：证明事务真的能完成
          try {
            const tx = db.transaction("kv", "readwrite");
            const store = tx.objectStore("kv");
            store.put(1, "__probe__");
            const get = store.get("__probe__");
            get.onsuccess = () => {
              if (settled) return;
              settled = true; clearTimeout(timer);
              mode = "idb";
              tx.objectStore("kv").delete("__probe__"); // 清理探针
              resolve(mode);
            };
            get.onerror = () => { clearTimeout(timer); try { db.close(); } catch {} dbPromise = null; fallback(); };
          } catch { clearTimeout(timer); dbPromise = null; fallback(); }
        };
        req.onerror = () => { clearTimeout(timer); fallback(); };
        req.onblocked = () => { clearTimeout(timer); fallback(); };
      } catch { clearTimeout(timer); fallback(); }
    });
  }

  /* ---------- IndexedDB 实现 ---------- */
  function idb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("novels")) db.createObjectStore("novels", { keyPath: "id" });
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  function reqVal(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /* ---------- localStorage 实现 ---------- */
  function lsNovels() { try { return JSON.parse(localStorage.getItem(LS_NOVELS) || "{}"); } catch { return {}; } }
  function lsSaveNovels(map) { localStorage.setItem(LS_NOVELS, JSON.stringify(map)); }
  function lsKv() { try { return JSON.parse(localStorage.getItem(LS_KV) || "{}"); } catch { return {}; } }

  /* ---------- 结构迁移：老版本作品缺字段时补齐 ---------- */
  function migrate(n) {
    if (!n || typeof n !== "object") return n;
    if (!Array.isArray(n.facts)) n.facts = [];
    if (!Array.isArray(n.threads)) n.threads = [];
    if (!Array.isArray(n.characters)) n.characters = [];
    if (!Array.isArray(n.blueprints)) n.blueprints = [];
    if (!Array.isArray(n.chapters)) n.chapters = [];
    if (!Array.isArray(n.materials)) n.materials = [];
    n.characters.forEach(c => {
      if (!c.state || typeof c.state !== "object") c.state = {};
      if (c.stateSource !== "author") c.stateSource = c.stateSource || "unknown";
    });
    n.chapters.forEach(c => {
      if (!Array.isArray(c.review)) c.review = [];
      if (!Array.isArray(c.reviewResolved)) c.reviewResolved = [];
      if (typeof c.factsDone !== "boolean") c.factsDone = false;
    });
    return n;
  }

  /* ---------- 对外 API ---------- */
  async function listNovels() {
    if (await detect() === "ls") return Object.values(lsNovels()).map(migrate).sort((a, b) => b.updatedAt - a.updatedAt);
    const db = await idb();
    const all = await reqVal(db.transaction("novels").objectStore("novels").getAll());
    return (all || []).map(migrate);
  }
  async function getNovel(id) {
    if (await detect() === "ls") return migrate(lsNovels()[id]);
    const db = await idb();
    return migrate(await reqVal(db.transaction("novels").objectStore("novels").get(id)));
  }
  async function putNovel(novel) {
    novel.updatedAt = Date.now();
    if (await detect() === "ls") { const m = lsNovels(); m[novel.id] = novel; lsSaveNovels(m); return novel.id; }
    const db = await idb();
    return reqVal(db.transaction("novels", "readwrite").objectStore("novels").put(novel));
  }
  async function deleteNovel(id) {
    if (await detect() === "ls") { const m = lsNovels(); delete m[id]; lsSaveNovels(m); return; }
    const db = await idb();
    return reqVal(db.transaction("novels", "readwrite").objectStore("novels").delete(id));
  }
  async function kvGet(key, fallback) {
    if (await detect() === "ls") { const m = lsKv(); return key in m ? m[key] : fallback; }
    const db = await idb();
    const v = await reqVal(db.transaction("kv").objectStore("kv").get(key));
    return v === undefined ? fallback : v;
  }
  async function kvSet(key, value) {
    if (await detect() === "ls") { const m = lsKv(); m[key] = value; localStorage.setItem(LS_KV, JSON.stringify(m)); return; }
    const db = await idb();
    return reqVal(db.transaction("kv", "readwrite").objectStore("kv").put(value, key));
  }

  /* ---------- 工厂 ---------- */
  function newNovel(name) {
    const palettes = [
      ["#8c3b2e", "#c96f4a"], ["#2e5e8c", "#5a9bc9"], ["#3e7d4f", "#7db88f"],
      ["#7a4a8c", "#b58ac9"], ["#8c6d2e", "#c9a75a"], ["#414a54", "#7d8a99"],
    ];
    const p = palettes[Math.floor(Math.random() * palettes.length)];
    return {
      id: "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name: name || "未命名作品",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      cover: `linear-gradient(135deg, ${p[0]}, ${p[1]})`,
      config: {
        genre: "", subGenre: "", targetAudience: "",
        totalChapters: 100, wordsPerChapter: 2500,
        plotStructure: "three_act", narrativePOV: "third_limited",
        coreOutline: "", worldSetting: "", goldenFinger: "",
        protagonistProfile: "", writingStyle: "", globalGuidance: "",
      },
      characters: [],
      blueprints: [],
      chapters: [],      // {chapterNumber, title, status, content, summary, wordCount, updatedAt, versions:[]}
      facts: [],         // 连续性事实（定稿后沉淀）: {chapterNumber, characterStates[], timeline, openThreads[], plotFacts[]}
      threads: [],       // 伏笔线索: {id, thread, status, plantedAt, lastMovedAt}
      materials: [],     // 参考资料: {id, title, source, chars, chunks[], enabled}
      novelInfoSet: false, // 架构四节是否已确认过
    };
  }

  function newChapter(n, num, title) {
    return {
      chapterNumber: num, title: title || `第${num}章`,
      status: "待写", content: "", summary: "",
      wordCount: 0, updatedAt: Date.now(), versions: [],
      review: [],        // 最近一次审稿意见（结构化）
      reviewResolved: [],// 复验结果
      factsDone: false,  // 是否已抽取连续性事实
    };
  }

  return { listNovels, getNovel, putNovel, deleteNovel, kvGet, kvSet, newNovel, newChapter, detect };
})();
