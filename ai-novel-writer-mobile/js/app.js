/* ============================================================
 * 书童移动版 — 应用主逻辑
 * 复刻桌面版工作流：书房 → 设定 → 架构 → 蓝图 → 正文（写稿/审稿/修稿/定稿）
 * ============================================================ */
"use strict";

/* ---------------- 全局状态 ---------------- */
const State = {
  route: { page: "shelf" },
  stack: [{ page: "shelf" }],   // 页面栈：返回键的唯一依据（history 只做镜像）
  depth: 0,             // = stack.length - 1，保留给旧代码判断
  novel: null,          // 当前打开的作品（内存副本，变更后持久化）
  settings: { theme: "auto", models: [], defaultModelId: "", stageModels: {} },
  appearance: { fontSize: 17.5, lineHeight: 2.0, font: "serif", autoNext: false, paraIndent: true },
  editorSel: null,      // 选中文本 {start, end, text}
  abortCtrl: null,
  runState: null,       // {title, status}
};

const APP_VERSION = "1.8.2";

const STAGE_NAMES = { planning: "规划（设定/架构/蓝图）", drafting: "写稿", review: "审稿", refinement: "润色/修稿" };

/* ---------------- 小工具 ---------------- */
const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function fmtDate(ts) { const d = new Date(ts); return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
function countWords(s) { return (s || "").replace(/\s/g, "").length; }

/* ---------------- 高频更新节流 ----------------
 * 流式输出会把每个 SSE chunk 都推给 UI。若每个 chunk 都写 textarea/DOM，
 * 长文本下每帧重排整段，就是「生成时卡成 PPT」的原因。这里统一降频。 */
function rafThrottle(fn) {
  let id = 0, lastArgs = null;
  return (...args) => {
    lastArgs = args;
    if (id) return;
    id = requestAnimationFrame(() => { id = 0; fn(...lastArgs); });
  };
}
function throttleMs(fn, ms) {
  let last = 0, timer = null, lastArgs = null;
  return (...args) => {
    lastArgs = args;
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...lastArgs); return; }
    if (timer) return;
    timer = setTimeout(() => { timer = null; last = Date.now(); fn(...lastArgs); }, ms - (now - last));
  };
}

function toast(msg, isErr) {
  const el = document.createElement("div");
  el.className = "toast" + (isErr ? " err" : "");
  el.textContent = msg;
  $("#toast-layer").appendChild(el);
  setTimeout(() => el.remove(), isErr ? 4200 : 2400);
}

/* 底部弹层 */
function openSheet(html, onMounted) {
  const layer = $("#modal-layer");
  layer.innerHTML = `<div class="sheet-mask"><div class="sheet"><div class="grab"></div>${html}</div></div>`;
  $(".sheet-mask", layer).addEventListener("click", (e) => { if (e.target === e.currentTarget) closeSheet(); });
  if (onMounted) onMounted($(".sheet", layer));
}
function closeSheet() { $("#modal-layer").innerHTML = ""; }

function confirmSheet(title, text, onOk, okLabel) {
  openSheet(`
    <h3 style="font-size:16px">${esc(title)}</h3>
    <p class="muted" style="margin:8px 0 16px">${esc(text)}</p>
    <div class="row">
      <button class="btn" id="c-cancel">取消</button>
      <button class="btn primary" id="c-ok">${esc(okLabel || "确定")}</button>
    </div>`);
  $("#c-cancel").onclick = closeSheet;
  $("#c-ok").onclick = () => { closeSheet(); onOk(); };
}

/* ---------------- 运行条（生成任务可见/可取消） ---------------- */
function showRun(title) {
  State.runState = { title, preview: "", ctrl: new AbortController() };
  renderRunBar();
}
function updateRunTitle(title) {
  if (!State.runState) return;
  State.runState.title = title;
  const el = $("#run-bar .t");
  if (el) el.textContent = title;
}
function updateRun(preview) {
  if (!State.runState) return;
  State.runState.preview = preview.slice(-80);
  const el = $("#run-bar .s");
  if (el) el.textContent = State.runState.preview.replace(/\n/g, " ");
}
function renderRunBar() {
  let bar = $("#run-bar");
  if (!State.runState) { if (bar) bar.remove(); return; }
  if (bar) { $("#run-bar .t").textContent = State.runState.title; return; }
  bar = document.createElement("div");
  bar.id = "run-bar";
  bar.className = "run-bar";
  bar.innerHTML = `
    <span class="pulse"></span>
    <div class="info"><div class="t">${esc(State.runState.title)}</div><div class="s">正在生成…</div></div>
    <button class="btn small" id="run-cancel">取消</button>`;
  document.body.appendChild(bar);
  $("#run-cancel").onclick = () => {
    if (State.abortCtrl) State.abortCtrl.abort();
    toast("已取消");
  };
}
function hideRun() { State.runState = null; renderRunBar(); }

/* 通用 AI 任务包装：流式，可取消 */
async function runAI(title, stage, messages, opts = {}) {
  const model = modelFor(stage);
  showRun(title + ` · ${model.name || model.modelName}`);
  State.abortCtrl = State.runState.ctrl;
  let acc = "";
  const paintRun = rafThrottle(updateRun);
  try {
    const text = await LLM.streamChat(model, messages, {
      signal: State.runState.ctrl.signal,
      onDelta: (piece, full) => { acc = full; if (opts.onDelta) opts.onDelta(piece, full); else paintRun(full); },
    });
    recordCall(stage, messages, text);
    return text;
  } finally {
    hideRun();
    State.abortCtrl = null;
  }
}

function modelFor(stage) {
  const ss = State.settings;
  const id = (ss.stageModels && ss.stageModels[stage]) || ss.defaultModelId;
  return ss.models.find(m => m.id === id) || ss.models[0];
}
function ensureModel(stage) {
  const m = modelFor(stage);
  if (!m) { toast("请先到「设置」添加模型并设为默认", true); nav({ page: "settings" }); return null; }
  return m;
}

/* ---------------- AI 模式：创作 / 辅助 ---------------- */
/* 创作模式：AI 可以凭空写（起稿、续写、批量、生成设定/蓝图）。
   辅助模式：AI 只帮你看稿子（拆书、查漏洞、审稿、润色建议、抽取事实），不产出新正文。
   这是硬开关：所有生成入口都会先过 genBlocked()，不靠 UI 藏按钮兜底。 */
function isAssistMode() { return State.settings.aiMode === "assist"; }
function modeLabel() { return isAssistMode() ? "辅助" : "创作"; }
function modePill() {
  const off = isAssistMode();
  return `<button class="mode-pill ${off ? "off" : "on"}" id="btn-mode" aria-label="切换 AI 模式（当前：${modeLabel()}）">
    <i></i><span>AI ${modeLabel()}</span></button>`;
}
function toggleMode() {
  const keepDrawer = document.body.classList.contains("ed-drawer-open");
  State.settings.aiMode = isAssistMode() ? "auto" : "assist";
  DB.kvSet("settings", State.settings);
  if (State.runState) { try { State.runState.ctrl.abort(); } catch (e) {} }
  render();
  /* 从抽屉里切的模式，切完抽屉留在原地，可以直接接着点操作 */
  if (keepDrawer) setTimeout(() => setEdDrawer(true), 0);
  toast(isAssistMode()
    ? "AI 辅助模式：只查不写，起稿与续写已关闭"
    : "AI 创作模式：起稿、续写已开放");
}
function bindModePill() {
  const b = $("#btn-mode");
  if (b) b.onclick = toggleMode;
}
/* 生成类操作的统一闸门：辅助模式下直接拦下并说明原因 */
function genBlocked() {
  if (!isAssistMode()) return false;
  toast("现在是 AI 辅助模式，不会生成新内容。点顶栏「AI 辅助」切到创作模式再来", true);
  return true;
}

/* ---------------- 数据读写 ---------------- */
let saveTimer = null;
function saveNovel(immediate) {
  if (!State.novel) return;
  clearTimeout(saveTimer);
  /* 只在停顿后落盘：每次按键都写整本书（尤其 localStorage 降级时是同步序列化）
     是打字卡顿的另一大原因。 */
  const doSave = () => DB.putNovel(State.novel).catch(() => {});
  if (immediate) doSave(); else saveTimer = setTimeout(doSave, 1200);
}
/* 切后台/关闭前强制保存，避免节流期内丢字 */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && State.novel) DB.putNovel(State.novel).catch(() => {});
});
window.addEventListener("pagehide", () => {
  if (State.novel) DB.putNovel(State.novel).catch(() => {});
});

/* ---------------- 路由 ---------------- */
/* 页面栈自己维护，history 只做镜像：
   - 安卓物理返回键由原生层调用 window.__wbBack()，不再依赖 WebView history（原来会被系统直接结束 Activity）
   - 浏览器 / PWA 的手势返回走 popstate，按镜像里的 idx 把栈削到对应深度
   这样两条路径最终都落到同一个栈上，不会出现“按一次退两层”或卡死。 */
function applyRoute(route) {
  State.route = route;
  if (route.page !== "chapter") {
    State.editorSel = null;
    State._edDrawerOpen = false;
    document.body.classList.remove("immersive", "ed-drawer-open");
  }
  window.scrollTo(0, 0);
  render();
}

function nav(route, opts = {}) {
  if (!opts.silent) {
    if (opts.replace && State.stack.length) {
      State.stack[State.stack.length - 1] = route;
      State.depth = State.stack.length - 1;
      try { history.replaceState({ idx: State.stack.length }, "", "#" + route.page); } catch (e) {}
    } else {
      State.stack.push(route);
      State.depth = State.stack.length - 1;
      try { history.pushState({ idx: State.stack.length }, "", "#" + route.page); } catch (e) {}
    }
  }
  applyRoute(route);
}

/* 返回上一级（页面内返回按钮 / 安卓返回键共用）。返回 true 表示栈内已处理。 */
function goBack(fallback) {
  if (State.stack.length > 1) {
    const hIdx = history.state && typeof history.state.idx === "number" ? history.state.idx : -1;
    if (hIdx === State.stack.length) {
      /* 镜像和栈同步时走 history.back()，保证浏览器前进后退不错位；
         真正的出栈在 popstate 里完成 */
      history.back();
      return true;
    }
    State.stack.pop();
    State.depth = State.stack.length - 1;
    applyRoute(State.stack[State.stack.length - 1]);
    return true;
  }
  if (fallback) { nav(fallback, { replace: true }); return true; }
  return false;
}

window.addEventListener("popstate", (e) => {
  const idx = e.state && typeof e.state.idx === "number" ? e.state.idx : 1;
  if (idx >= State.stack.length) return;      // 前进或同层，忽略
  while (State.stack.length > idx) State.stack.pop();
  State.depth = Math.max(0, State.stack.length - 1);
  applyRoute(State.stack[State.stack.length - 1] || { page: "shelf" });
});
async function openNovel(id) {
  State.novel = await DB.getNovel(id);
  nav({ page: "novel", novelId: id, tab: State.novel.novelInfoSet ? "chapters" : "setup" });
}

/* ---------------- 物理返回键 ----------------
   安卓原生层把返回键交给 window.__wbBack()，按层级依次消费：
   关弹层 → 退沉浸 → 收悬浮窗 → 保存正文并回上一页 → 根页面再按一次才退出。
   返回 true 表示 App 内已处理；返回 false 才交回系统（退到后台，不结束进程）。 */
let backArmedAt = 0;

/* 返回键优先级最高的一层：任何盖在页面上的东西先收掉 */
function closeTopLayer() {
  const layer = $("#modal-layer");
  if (layer && layer.innerHTML.trim()) { closeSheet(); return true; }
  if (typeof isEdDrawerOpen === "function" && isEdDrawerOpen()) {
    State._edDrawerOpen = false;
    setEdDrawer(false);
    return true;
  }
  if (document.body.classList.contains("immersive")) {
    document.body.classList.remove("immersive");
    return true;
  }
  if (window.Compass && Compass.isOpen && Compass.isOpen()) return Compass.closePanel();
  if (window.HUD && HUD.isOpen && HUD.isOpen()) { HUD.close(); return true; }
  return false;
}

window.__wbBack = function () {
  try {
    if (closeTopLayer()) { backArmedAt = 0; return true; }
    if (State.route.page === "chapter" && State.novel) saveNovel(true);
    if (State.stack.length > 1) { backArmedAt = 0; goBack(); return true; }
    const now = Date.now();
    if (now - backArmedAt < 2000) { backArmedAt = 0; return false; }
    backArmedAt = now;
    toast("再按一次返回键退出");
    return true;
  } catch (e) {
    return false;
  }
};

/* ================= 渲染入口 ================= */
async function render() {
  applyTheme();
  document.body.classList.toggle("assist-mode", isAssistMode());
  const app = $("#app");
  const r = State.route;
  /* 冷启动兜底：资料库依赖当前作品，没有作品时退回书房 */
  if (r.page === "materials" && !State.novel) { State.route = { page: "shelf" }; }
  const route = State.route;
  if (route.page !== "chapter" && window.HUD) HUD.stop();
  if (route.page !== "chapter" && window.Compass) Compass.destroy();
  if (route.page === "shelf") { app.innerHTML = await viewShelf(); bindShelf(); }
  else if (route.page === "settings") { app.innerHTML = viewSettings(); bindSettings(); }
  else if (route.page === "novel") { app.innerHTML = viewNovel(); bindNovel(); }
  else if (route.page === "chapter") { app.innerHTML = viewChapter(); bindChapter(); }
  else if (route.page === "materials") { app.innerHTML = viewMaterials(); bindMaterials(); }
  if (isAssistMode()) {
    $$("#bp-gen,#bp-batch,#sf-ai,#ch-ai,[data-arch-ai]").forEach(b => { b.dataset.gen = "1"; });
  }
  bindModePill();
}

function applyTheme() {
  const t = State.settings.theme;
  const dark = t === "dark" || (t === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.body.classList.toggle("dark", dark);
}

/* 外观：字号/行距/字体写成变量，编辑器与预览共用 */
const FONT_STACKS = {
  serif: 'var(--font-serif)',
  sans: 'var(--font-ui)',
  kai: '"Kaiti SC", "KaiTi", "STKaiti", "Noto Serif SC", serif',
  song: '"Songti SC", "SimSun", "Noto Serif SC", serif',
};
function applyAppearance() {
  const a = State.appearance || {};
  const root = document.documentElement;
  root.style.setProperty("--editor-size", (a.fontSize || 17.5) + "px");
  root.style.setProperty("--editor-lh", String(a.lineHeight || 2));
  root.style.setProperty("--editor-font", FONT_STACKS[a.font] || FONT_STACKS.serif);
  document.body.classList.toggle("hide-indent", a.paraIndent === false);
}

function topbar(title, opts = {}) {
  return `<div class="topbar">
    ${opts.back ? `<button class="icon-btn" id="btn-back" aria-label="返回">${svgIcon("back", 19)}</button>` : `<span style="width:36px"></span>`}
    <h1>${esc(title)}</h1>
    ${opts.right || ""}
  </div>`;
}

/* ================= 书房（书架） ================= */
async function viewShelf() {
  const all = (await DB.listNovels()).sort((a, b) => b.updatedAt - a.updatedAt);
  State._shelfCache = all;   // 命令面板的搜索源
  const works = all.filter(n => n.kind !== "reference");
  const refs = all.filter(n => n.kind === "reference");
  const card = (n, isRef) => {
    const chapters = n.chapters || [];
    const done = chapters.filter(c => c.status === "定稿").length;
    const total = (n.config && n.config.totalChapters) || 0;
    const words = chapters.reduce((s, c) => s + (c.wordCount || 0), 0);
    const wTxt = words > 10000 ? (words / 10000).toFixed(1) + " 万字" : words + " 字";
    const pct = total ? Math.min(100, Math.round(done / total * 100)) : 0;
    return `<button class="book-card" data-id="${n.id}" ${isRef ? 'data-ref="1"' : ""}>
      <div class="book-cover" style="background:${esc(n.cover)}"><span>${esc(n.name)}</span></div>
      <div class="book-meta">
        ${isRef
          ? `<div class="tiny"><span class="tag accent">参考书</span> ${(n.blueprints || []).length} 章蓝图</div>`
          : `<div class="stat-bar"><span>定稿 <b>${done}</b>/${total || "?"}</span><span>${wTxt}</span></div>
             <div class="progressbar" style="margin-top:8px"><div style="width:${pct}%"></div></div>`}
      </div>
    </button>`;
  };
  let grid;
  if (!all.length) {
    grid = `<div class="empty">
      <div class="big">${svgIcon("bookOpen", 34)}</div>
      <div class="e-title">书房还是空的</div>
      <div class="e-hint">点右下角「＋」写下第一本书<br/>或从右上角导入一部小说，让 AI 拆解其章法与文风</div>
    </div>`;
  } else {
    grid = `<div class="shelf-grid">` + works.map(n => card(n, false)).join("") + `</div>`
      + (refs.length ? `<div class="section-label">参考书 · 拆解与仿写</div><div class="shelf-grid">` + refs.map(n => card(n, true)).join("") + `</div>` : "");
  }
  return `
    ${topbar("书房", { right: `<div class="tb-actions">${modePill()}<button class="icon-btn" id="btn-search" title="搜索">${svgIcon("search", 18)}</button><button class="icon-btn" id="btn-import" title="拆书导入">${svgIcon("import", 18)}</button><button class="icon-btn" id="btn-settings" title="设置">${svgIcon("gear", 18)}</button></div>` })}
    <div class="page">${grid}</div>
    <button class="fab" id="btn-new" aria-label="新建作品">${svgIcon("plus", 24)}</button>`;
}

function bindShelf() {
  $("#btn-settings").onclick = () => nav({ page: "settings" });
  $("#btn-import").onclick = () => importSheet();
  $("#btn-search").onclick = () => commandPalette();
  $("#btn-new").onclick = () => {
    openSheet(`
      <h3>新建作品</h3>
      <label>书名</label><input id="np-name" placeholder="例如：灯塔" />
      <label>一句话构想（可选，AI 将据此补全设定）</label>
      <textarea id="np-idea" rows="3" placeholder="例如：一个失忆的守塔人在雾夜救了一个会说话的漂流瓶…"></textarea>
      <div class="row" style="margin-top:14px">
        <button class="btn" id="np-blank">空白创建</button>
        <button class="btn primary" id="np-ai" data-gen="1">AI 设定并创建</button>
      </div>`, (sheet) => {
      $("#np-blank", sheet).onclick = async () => {
        const n = DB.newNovel($("#np-name", sheet).value.trim() || "未命名作品");
        await DB.putNovel(n);
        closeSheet(); openNovel(n.id);
      };
      $("#np-ai", sheet).onclick = async () => {
        if (genBlocked()) return;
        const name = $("#np-name", sheet).value.trim();
        const idea = $("#np-idea", sheet).value.trim();
        if (!idea) { toast("先写一句构想，或用空白创建"); return; }
        if (!ensureModel("planning")) return;
        closeSheet();
        const n = DB.newNovel(name);
        try {
          const prompt = renderPrompt(T.infer_novel_config, { idea });
          const cfg = await runAI("正在生成作品设定", "planning",
            [{ role: "system", content: T.infer_novel_config.system }, { role: "user", content: prompt }]);
          const parsed = LLM.extractJSON(cfg);
          n.name = parsed.name || n.name || "未命名作品";
          Object.keys(n.config).forEach(k => { if (parsed[k] != null && parsed[k] !== "") n.config[k] = parsed[k]; });
          n.config.totalChapters = Math.min(500, Math.max(5, parseInt(parsed.totalChapters) || 100));
          n.config.wordsPerChapter = Math.min(10000, Math.max(500, parseInt(parsed.wordsPerChapter) || 2500));
          await DB.putNovel(n);
          openNovel(n.id);
          toast("设定完成，可到「设定」页微调");
        } catch (e) {
          await DB.putNovel(n);
          openNovel(n.id);
          toast("设定生成失败：" + e.message, true);
        }
      };
    });
  };
  $$(".book-card").forEach(card => {
    const longPress = (e) => {
      const id = card.dataset.id;
      confirmSheet("删除作品？", "该作品及其全部章节将从本机删除，且无法恢复。", async () => {
        await DB.deleteNovel(id);
        render(); toast("已删除");
      }, "删除");
    };
    card.onclick = () => {
      if (card.dataset.ref) openRefReport(card.dataset.id);
      else openNovel(card.dataset.id);
    };
    card.oncontextmenu = (e) => { e.preventDefault(); longPress(e); };
    let pressTimer = null;
    card.addEventListener("touchstart", () => { pressTimer = setTimeout(longPress, 600); }, { passive: true });
    card.addEventListener("touchend", () => clearTimeout(pressTimer), { passive: true });
    card.addEventListener("touchmove", () => clearTimeout(pressTimer), { passive: true });
  });
}

/* ================= 拆书与仿写 ================= */

/* 按章节标题拆分文本；无标题时按 ~3000 字切块 */
function splitChapters(text) {
  const re = /[ \t]*第[0-9零一二三四五六七八九十百千两]+[章回节][^\n]*/g;
  const marks = [];
  let m;
  while ((m = re.exec(text)) !== null) marks.push({ index: m.index, title: m[0].trim() });
  const chapters = [];
  if (marks.length >= 2) {
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].index + marks[i].title.length;
      const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
      const content = text.slice(start, end).trim();
      if (content) chapters.push({ number: i + 1, title: marks[i].title, content });
    }
  } else {
    const size = 3000;
    const total = Math.ceil(text.length / size);
    for (let i = 0; i < total; i++) {
      const part = text.slice(i * size, (i + 1) * size).trim();
      if (part) chapters.push({ number: i + 1, title: `片段${i + 1}`, content: part });
    }
  }
  return chapters;
}

function chapterBriefs(chapters, briefLen) {
  return chapters.map(c => `第${c.number}章 ${c.title}\n${(c.content || "").replace(/\s+/g, " ").slice(0, briefLen || 160)}${(c.content || "").length > (briefLen || 160) ? "…" : ""}`).join("\n\n");
}

/* 拆书导入入口 */
function importSheet() {
  openSheet(`
    <h3>${svgIcon("import", 15)} 拆书与仿写</h3>
    <p class="tiny" style="margin-top:4px">导入一部小说（.txt / .md，或直接粘贴文本）。所有解析都在本机完成，文本只在调用 AI 时发给你的模型。</p>
    <label>用途</label>
    <div class="chip-row" id="im-purpose">
      <button class="chip active" data-v="deconstruct">拆解仿写（生成参考书）</button>
      <button class="chip" data-v="continue">导入原稿续写（导入为我的书）</button>
    </div>
    <label>书名（可留空，AI 会推断）</label>
    <input id="im-name" placeholder="例如：诡秘之主" />
    <label>小说文本</label>
    <textarea id="im-text" rows="6" placeholder="粘贴小说文本，或点下方选择文件"></textarea>
    <div class="row" style="margin-top:8px">
      <button class="btn" id="im-file-btn">${svgIcon("import", 16)} 选择文件</button>
    </div>
    <p class="tiny" style="margin-top:5px">支持 .txt / .md / .epub（EPUB 会在本机解压并抽取正文，带 DRM 的不支持）</p>
    <input type="file" id="im-file" accept=".txt,.md,.epub,text/plain,application/epub+zip" style="display:none" />
    <button class="btn primary block" id="im-go" style="margin-top:14px">开始导入</button>`, (sheet) => {
    let purpose = "deconstruct";
    $$("#im-purpose .chip", sheet).forEach(chip => chip.onclick = () => {
      $$("#im-purpose .chip", sheet).forEach(x => x.classList.remove("active"));
      chip.classList.add("active");
      purpose = chip.dataset.v;
    });
    $("#im-file-btn", sheet).onclick = () => $("#im-file", sheet).click();
    $("#im-file", sheet).onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const isEpub = /\.epub$/i.test(f.name) || f.type === "application/epub+zip";
      if (isEpub) {
        if (!Epub.supports()) { toast("系统组件不支持解压 EPUB，请改用 .txt", true); return; }
        if (f.size > 20 * 1024 * 1024) { toast("EPUB 超过 20MB，请换小一些的版本", true); return; }
        const btn = $("#im-file-btn", sheet);
        btn.textContent = "正在解析 EPUB…";
        try {
          const parsed = await Epub.parse(await f.arrayBuffer(), (i, total) => {
            btn.textContent = `解析中 ${i}/${total}…`;
          });
          const text = Epub.toText(parsed);
          $("#im-text", sheet).value = text;
          if (!$("#im-name", sheet).value) $("#im-name", sheet).value = parsed.title || f.name.replace(/\.epub$/i, "");
          btn.textContent = `${svgIcon("import", 16)} 选择文件`;
          toast(`已解析 ${parsed.chapters.length} 章 · ${countWords(text).toLocaleString()} 字`);
        } catch (err) {
          btn.textContent = `${svgIcon("import", 16)} 选择文件`;
          toast(err.message || "EPUB 解析失败", true);
        }
        return;
      }
      if (f.size > 8 * 1024 * 1024) { toast("文件超过 8MB，请只导入需要拆解的部分", true); return; }
      const text = await f.text();
      $("#im-text", sheet).value = text;
      if (!$("#im-name", sheet).value) $("#im-name", sheet).value = f.name.replace(/\.(txt|md)$/i, "");
      toast(`已读取 ${f.name}（${(f.size / 1024).toFixed(0)} KB）`);
    };
    $("#im-go", sheet).onclick = () => {
      const text = $("#im-text", sheet).value.trim();
      if (text.length < 200) { toast("文本太短（至少 200 字）", true); return; }
      const name = $("#im-name", sheet).value.trim();
      closeSheet();
      if (purpose === "deconstruct") deconstructNovel(name, text);
      else importAsWork(name, text);
    };
  });
}

/* 拆解仿写：建参考书并分步 AI 拆解 */
async function deconstructNovel(name, text) {
  if (!ensureModel("planning")) return;
  const chapters = splitChapters(text);
  if (!chapters.length) { toast("没有解析出任何章节内容", true); return; }
  const ref = DB.newNovel(name || "未命名参考书");
  ref.kind = "reference";
  ref.chapters = chapters.map(c => ({ chapterNumber: c.number, title: c.title, brief: c.content.slice(0, 300), length: c.content.length }));
  await DB.putNovel(ref);
  nav({ page: "shelf" });
  toast(`已拆出 ${chapters.length} 章，开始 AI 拆解…`);
  const briefs = chapterBriefs(chapters);
  const sample = chapters.slice(0, 2).map(c => `【${c.title}】\n${c.content}`).join("\n\n").slice(0, 6000);
  try {
    // 1) 反推设定
    updateRunTitle(`拆解 1/4 · 反推设定`);
    const cfgText = await LLM.streamChat(modelFor("planning"), [
      { role: "system", content: T.import_infer.system },
      { role: "user", content: renderPrompt(T.import_infer, { text: sample }) },
    ], { signal: State.runState.ctrl.signal, onDelta: (_, full) => updateRun(full) });
    const cfg = LLM.extractJSON(cfgText);
    ref.name = name || cfg.name || ref.name;
    Object.keys(ref.config).forEach(k => { if (cfg[k] != null && cfg[k] !== "") ref.config[k] = cfg[k]; });
    ref.config.totalChapters = Math.max(chapters.length, parseInt(cfg.totalChapters) || chapters.length);
    await DB.putNovel(ref); render();
    // 2) 文风分析
    updateRunTitle(`拆解 2/4 · 文风分析`);
    ref.styleAnalysis = await LLM.streamChat(modelFor("planning"), [
      { role: "system", content: T.analyze_writing_style.system },
      { role: "user", content: renderPrompt(T.analyze_writing_style, { sample }) },
    ], { signal: State.runState.ctrl.signal, onDelta: (_, full) => updateRun(full) });
    await DB.putNovel(ref);
    // 3) 结构拆解
    updateRunTitle(`拆解 3/4 · 结构拆解`);
    ref.structureAnalysis = await LLM.streamChat(modelFor("planning"), [
      { role: "system", content: T.deconstruct_structure.system },
      { role: "user", content: renderPrompt(T.deconstruct_structure, { config: serializeConfig(ref), chapterBriefs: briefs }) },
    ], { signal: State.runState.ctrl.signal, onDelta: (_, full) => updateRun(full) });
    await DB.putNovel(ref);
    // 4) 反推蓝图（只拆前 30 章的章法）
    updateRunTitle(`拆解 4/4 · 反推章节蓝图`);
    const bpText = await LLM.streamChat(modelFor("planning"), [
      { role: "system", content: T.reverse_blueprint.system },
      { role: "user", content: renderPrompt(T.reverse_blueprint, { chapterBriefs: chapterBriefs(chapters.slice(0, 30), 120) }) },
    ], { signal: State.runState.ctrl.signal, onDelta: (_, full) => updateRun(full) });
    const arr = LLM.extractJSON(bpText);
    if (Array.isArray(arr)) {
      ref.blueprints = arr.filter(b => isFinite(parseInt(b.chapterNumber))).map(b => ({
        chapterNumber: parseInt(b.chapterNumber), title: b.title || "",
        purpose: b.purpose || "", keyEvents: b.keyEvents || "",
        characters: Array.isArray(b.characters) ? b.characters : [], suspenseHook: b.suspenseHook || "",
      }));
    }
    await DB.putNovel(ref);
    render();
    toast("拆解完成 ✓ 点开参考书查看报告");
  } catch (e) {
    await DB.putNovel(ref); render();
    toast(e.name === "AbortError" ? "已取消（已完成的部分保留了）" : "拆解中断：" + e.message, true);
  } finally {
    hideRun();
  }
}

/* 原稿续写：导入为我的书（定稿） */
async function importAsWork(name, text) {
  if (!ensureModel("planning")) return;
  const chapters = splitChapters(text);
  if (!chapters.length) { toast("没有解析出任何章节内容", true); return; }
  const novel = DB.newNovel(name || "导入的作品");
  novel.chapters = chapters.map(c => ({
    chapterNumber: c.number, title: c.title, status: "定稿",
    content: c.content, summary: "", wordCount: countWords(c.content),
    updatedAt: Date.now(), versions: [],
  }));
  showRun("导入 1/1 · 反推设定");
  try {
    const sample = chapters.slice(0, 3).map(c => `【${c.title}】\n${c.content.slice(0, 1500)}`).join("\n\n").slice(0, 6000);
    const cfgText = await LLM.streamChat(modelFor("planning"), [
      { role: "system", content: T.import_infer.system },
      { role: "user", content: renderPrompt(T.import_infer, { text: sample }) },
    ], { signal: State.runState.ctrl.signal, onDelta: (_, full) => updateRun(full) });
    const cfg = LLM.extractJSON(cfgText);
    novel.name = name || cfg.name || novel.name;
    Object.keys(novel.config).forEach(k => { if (cfg[k] != null && cfg[k] !== "") novel.config[k] = cfg[k]; });
    novel.config.totalChapters = Math.max(chapters.length, parseInt(cfg.totalChapters) || chapters.length);
    novel.novelInfoSet = true;
    await DB.putNovel(novel);
    openNovel(novel.id);
    toast(`已导入 ${chapters.length} 章为定稿，可直接续写`);
  } catch (e) {
    await DB.putNovel(novel);
    nav({ page: "shelf" });
    toast(e.name === "AbortError" ? "已取消" : "设定推断失败（章节已导入）：" + e.message, true);
  } finally {
    hideRun();
  }
}

/* 参考书报告查看 */
async function openRefReport(id) {
  const ref = await DB.getNovel(id);
  if (!ref) return;
  const sec = (title, body) => body ? `<div class="card"><h3>${title}</h3><p class="muted" style="white-space:pre-wrap">${esc(body)}</p></div>` : "";
  const bpList = (ref.blueprints || []).map(b => `第${b.chapterNumber}章 ${b.title}｜${b.keyEvents || b.purpose || ""}`).join("\n");
  openSheet(`
    <h3>${svgIcon("book", 15)} ${esc(ref.name)} · 拆解报告</h3>
    <div class="chip-row" style="margin:6px 0 10px">
      <span class="tag">${esc(ref.config.genre || "题材未知")}</span>
      <span class="tag">${(ref.chapters || []).length} 章</span>
    </div>
    ${ref.config.coreOutline ? sec("故事前提（反推）", ref.config.coreOutline) : ""}
    ${sec("文风报告", ref.styleAnalysis)}
    ${sec("结构拆解", ref.structureAnalysis)}
    ${bpList ? sec("反推章节蓝图（前 " + (ref.blueprints || []).length + " 章）", bpList) : ""}
    <div class="row" style="margin-top:6px">
      <button class="btn danger" id="ref-del">删除参考书</button>
      <button class="btn" id="ref-close">关闭</button>
    </div>`, (sheet) => {
    $("#ref-close", sheet).onclick = closeSheet;
    $("#ref-del", sheet).onclick = () => {
      closeSheet();
      confirmSheet("删除参考书？", "拆解报告将从本机删除。已绑定它的作品不受影响，但写作时不再注入仿写参考。", async () => {
        await DB.deleteNovel(id);
        // 清理引用
        const novels = await DB.listNovels();
        for (const n of novels) if (n.referenceId === id) { n.referenceId = null; await DB.putNovel(n); }
        render(); toast("已删除");
      }, "删除");
    };
  });
}

/* ================= 作品工作台 ================= */
const NOVEL_TABS = [
  ["setup", "sliders", "设定"], ["arch", "arch", "架构"], ["blueprint", "layers", "蓝图"],
  ["chars", "users", "角色"], ["chapters", "doc", "正文"],
];

function viewNovel() {
  const n = State.novel;
  const tab = State.route.tab || "setup";
  const total = n.config.totalChapters || 0;
  const done = n.chapters.filter(c => c.status === "定稿").length;
  const words = n.chapters.reduce((s, c) => s + (c.wordCount || 0), 0);
  let body = "";
  if (tab === "setup") body = viewSetup();
  else if (tab === "arch") body = viewArch();
  else if (tab === "blueprint") body = viewBlueprint();
  else if (tab === "chars") body = viewChars();
  else body = viewChapters();
  return `
    ${topbar(n.name, { back: true, right: `<div class="tb-actions">${modePill()}<button class="icon-btn" id="btn-export" title="更多">${svgIcon("more", 18)}</button></div>` })}
    <div class="page">
      ${tab === "setup" ? "" : `<div class="card" style="padding:13px 15px">
        <div class="stat-bar" style="justify-content:space-between">
          <span>定稿 <b>${done}</b> / ${total || "?"} 章</span>
          <span>${words > 10000 ? (words / 10000).toFixed(1) + " 万字" : words + " 字"}</span>
        </div>
        <div class="progressbar" style="margin-top:9px"><div style="width:${total ? Math.min(100, done / total * 100) : 0}%"></div></div>
      </div>`}
      ${body}
    </div>
    <nav class="bottom-nav">${NOVEL_TABS.map(([id, ico, name]) =>
      `<button data-tab="${id}" class="${tab === id ? "active" : ""}">${svgIcon(ico, 21)}<span>${name}</span></button>`).join("")}
    </nav>`;
}

function bindNovel() {
  $("#btn-back").onclick = async () => { await DB.putNovel(State.novel); goBack({ page: "shelf" }); };
  $("#btn-export").onclick = moreSheet;
  $$(".bottom-nav button").forEach(b => b.onclick = () => {
    State.route.tab = b.dataset.tab;
    render();
  });
  if (State.route.tab === "setup") bindSetup();
  else if (State.route.tab === "arch") bindArch();
  else if (State.route.tab === "blueprint") bindBlueprint();
  else if (State.route.tab === "chars") bindChars();
  else bindChapters();
}

/* ---------- 导出 ----------
 * 对齐桌面版 export-service：合并 Markdown / 分章 Markdown（zip）/ TXT，
 * 可选附带大纲与人物表。分章稿的文件名带章号，方便直接丢进别的编辑器。
 */
function exportSheet() {
  const n = State.novel;
  const chapters = n.chapters.filter(c => (c.content || "").trim());
  openSheet(`
    <h3>导出</h3>
    <p class="tiny">已写 ${chapters.length} 章 · 约 ${chapters.reduce((s, c) => s + (c.wordCount || 0), 0).toLocaleString()} 字</p>
    <div class="section-label">格式</div>
    <div class="chip-row" id="ex-format">
      <button class="chip active" data-f="merged-md">合并 Markdown</button>
      <button class="chip" data-f="split-md">分章 Markdown（zip）</button>
      <button class="chip" data-f="txt">纯文本 TXT</button>
    </div>
    <div id="ex-opts" style="margin-top:4px">
      <label style="display:flex;align-items:center;gap:8px;margin-top:10px">
        <input type="checkbox" id="ex-outline" checked style="width:auto" /> 附带大纲（设定 / 角色 / 分章蓝图）
      </label>
      <label style="display:flex;align-items:center;gap:8px;margin-top:4px">
        <input type="checkbox" id="ex-chars" style="width:auto" /> 合并稿里插入人物表
      </label>
    </div>
    <button class="btn primary block" id="ex-go" style="margin-top:14px">导出</button>
    <hr/>
    <div style="display:flex;flex-direction:column;gap:9px">
      <button class="btn block" id="ex-json">备份为 JSON（含全部设定）</button>
      <button class="btn block danger" id="ex-del">删除本作品</button>
    </div>`, (sheet) => {
    let format = "merged-md";
    $$("#ex-format .chip", sheet).forEach(chip => chip.onclick = () => {
      $$("#ex-format .chip", sheet).forEach(x => x.classList.remove("active"));
      chip.classList.add("active");
      format = chip.dataset.f;
      $("#ex-opts", sheet).style.display = format === "merged-md" ? "block" : "none";
    });
    $("#ex-go", sheet).onclick = async () => {
      try {
        const count = Exporter.run(n, format, {
          includeOutline: $("#ex-outline", sheet).checked,
          includeCharacters: $("#ex-chars", sheet).checked,
        });
        closeSheet();
        toast(format === "split-md" ? `已打包 ${count} 个文件` : "已导出");
      } catch (e) { toast(e.message, true); }
    };
    $("#ex-json", sheet).onclick = async () => {
      const blob = new Blob([JSON.stringify(n, null, 2)], { type: "application/json" });
      Exporter.download(blob, `${Exporter.safeName(n.name)}-${new Date().toISOString().slice(0, 10)}.json`);
      closeSheet();
    };
    $("#ex-del", sheet).onclick = () => {
      const id = n.id;
      closeSheet();
      confirmSheet("删除作品？", "全部章节将从本机删除，无法恢复。", async () => {
        await DB.deleteNovel(id);
        nav({ page: "shelf" });
      }, "删除");
    };
  });
}

/* ================= Tab：设定 ================= */
const SETUP_FIELDS = [
  ["genre", "题材"], ["subGenre", "细分题材"], ["targetAudience", "目标读者"],
  ["totalChapters", "总章数", "number"], ["wordsPerChapter", "每章字数", "number"],
  ["coreOutline", "故事前提", "textarea"], ["goldenFinger", "金手指 / 主角核心优势", "textarea"],
  ["protagonistProfile", "主角小传", "textarea"], ["worldSetting", "世界观概述", "textarea"],
  ["writingStyle", "文风要求", "textarea"], ["globalGuidance", "全局写作指导", "textarea"],
];

function viewSetup() {
  const c = State.novel.config;
  return `
    <div class="card">
      <h3>书名</h3>
      <input id="sf-name" value="${esc(State.novel.name)}" placeholder="给你的书起个名字" />
    </div>
    <div class="card">
      <h3>创作设定 <span class="spacer"></span><button class="btn small primary" id="sf-ai">AI 补全</button></h3>
      <label>一句话构想（给 AI 的起点）</label>
      <textarea id="sf-idea" rows="2" placeholder="填一句构想，点「AI 补全」自动填好下面所有字段">${esc(c.idea || "")}</textarea>
      ${SETUP_FIELDS.map(([k, label, type]) => {
        if (type === "textarea") return `<label>${label}</label><textarea data-cfg="${k}" rows="3">${esc(c[k] || "")}</textarea>`;
        if (type === "number") return `<div class="row"><div><label>${label}</label><input data-cfg="${k}" type="number" value="${esc(c[k] || "")}" /></div><div></div></div>`;
        return `<label>${label}</label><input data-cfg="${k}" value="${esc(c[k] || "")}" />`;
      }).join("")}
      <label>故事结构</label>
      <div class="chip-row" id="sf-structure">${Object.entries(STRUCTURE_NAMES).map(([k, v]) =>
        `<button class="chip ${c.plotStructure === k ? "active" : ""}" data-v="${k}">${v}</button>`).join("")}</div>
      <label>叙事视角</label>
      <div class="chip-row" id="sf-pov">${Object.entries(POV_NAMES).map(([k, v]) =>
        `<button class="chip ${c.narrativePOV === k ? "active" : ""}" data-v="${k}">${v}</button>`).join("")}</div>
    </div>
    <div class="card">
      <h3>${svgIcon("book", 15)} 拆书仿写参考 <span class="spacer"></span><span class="tiny">写作时自动注入</span></h3>
      <div id="ref-bind"><span class="tiny">加载中…</span></div>
    </div>
    <button class="btn primary block" id="sf-done">确认设定，进入架构 →</button>`;
}

function bindSetup() {
  $("#sf-name").oninput = (e) => { State.novel.name = e.target.value; saveNovel(); };
  $("#sf-idea").oninput = (e) => { State.novel.config.idea = e.target.value; saveNovel(); };

  /* 参考书绑定（异步加载） */
  (async () => {
    const box = $("#ref-bind");
    if (!box) return;
    const refs = (await DB.listNovels()).filter(n => n.kind === "reference");
    if (!refs.length) {
      box.innerHTML = `<span class="tiny">还没有参考书。到书房右上角 📖 导入一部小说，AI 会拆解其文风、结构与章法，写作时作为仿写约束注入。</span>`;
      return;
    }
    box.innerHTML = `
      <select id="ref-select">
        <option value="">不使用参考书</option>
        ${refs.map(r => `<option value="${r.id}" ${State.novel.referenceId === r.id ? "selected" : ""}>${esc(r.name)}</option>`).join("")}
      </select>
      <div id="ref-preview" style="margin-top:8px"></div>`;
    const showPreview = async () => {
      const id = $("#ref-select").value;
      State.novel.referenceId = id || null;
      saveNovel();
      const pv = $("#ref-preview");
      if (!id) { pv.innerHTML = `<span class="tiny">未绑定。写作时将不注入仿写参考。</span>`; return; }
      const r = await DB.getNovel(id);
      pv.innerHTML = `<span class="tiny">已绑定：文风报告 ${((r.styleAnalysis || "").length)} 字 · 结构拆解 ${((r.structureAnalysis || "").length)} 字 · 蓝图 ${(r.blueprints || []).length} 章。写正文时自动作为仿写约束。</span>`;
    };
    $("#ref-select").onchange = showPreview;
    showPreview();
  })();
  $$("[data-cfg]").forEach(el => el.oninput = () => {
    State.novel.config[el.dataset.cfg] = el.type === "number" ? (parseInt(el.value) || 0) : el.value;
    saveNovel();
  });
  const chips = (id, key) => $$(id + " .chip").forEach(b => b.onclick = () => {
    $$(id + " .chip").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    State.novel.config[key] = b.dataset.v;
    saveNovel();
  });
  chips("#sf-structure", "plotStructure");
  chips("#sf-pov", "narrativePOV");

  $("#sf-ai").onclick = async () => {
    if (genBlocked()) return;
    if (!ensureModel("planning")) return;
    const idea = $("#sf-idea").value.trim();
    if (!idea) { toast("先写一句话构想", true); return; }
    try {
      const prompt = renderPrompt(T.infer_novel_config, { idea });
      const out = await runAI("生成创作设定", "planning",
        [{ role: "system", content: T.infer_novel_config.system }, { role: "user", content: prompt }]);
      const parsed = LLM.extractJSON(out);
      Object.keys(State.novel.config).forEach(k => {
        if (parsed[k] != null && parsed[k] !== "" && k !== "name") State.novel.config[k] = parsed[k];
      });
      State.novel.config.totalChapters = Math.min(500, Math.max(5, parseInt(parsed.totalChapters) || 100));
      State.novel.config.wordsPerChapter = Math.min(10000, Math.max(500, parseInt(parsed.wordsPerChapter) || 2500));
      if (parsed.name && $("#sf-name").value.trim() === "") State.novel.name = parsed.name;
      await DB.putNovel(State.novel);
      render(); toast("设定已生成，请检查并修改");
    } catch (e) { toast(e.message, true); }
  };

  $("#sf-done").onclick = async () => {
    State.novel.novelInfoSet = true;
    await DB.putNovel(State.novel);
    State.route.tab = "arch";
    render();
  };
}

/* ================= Tab：架构 ================= */
function viewArch() {
  const n = State.novel;
  const section = (title, key, rows, aiKey) => `
    <div class="card">
      <h3>${title} <span class="spacer"></span><button class="btn small primary" data-arch-ai="${aiKey}">AI 生成</button></h3>
      <textarea data-arch="${key}" rows="${rows}">${esc(key === "synopsis" ? (n.synopsis || "") : (n.config[key] || ""))}</textarea>
    </div>`;
  const chars = n.characters.length
    ? n.characters.map((c, i) => `
      <button class="chapter-item" data-char="${i}">
        <span class="no">${esc(ROLE_NAME[c.role] || "角色")}</span>
        <span class="t"><span class="name">${esc(c.name)}</span><span class="sub">${esc((c.personality || "").slice(0, 40))}</span></span>
        <span>›</span>
      </button>`).join("")
    : `<div class="tiny" style="padding:8px 0">还没有角色，点「AI 生成」或手动添加。</div>`;
  return `
    ${section("故事前提", "coreOutline", 5, "premise")}
    <div class="card">
      <h3>角色名单 <span class="spacer"></span>
        <button class="btn small" id="ch-add">${svgIcon("plus", 14)} 手动</button>
        <button class="btn small primary" id="ch-ai">AI 生成</button>
      </h3>
      <div>${chars}</div>
    </div>
    ${section("世界观设定", "worldSetting", 8, "world")}
    ${section("情节大纲", "synopsis", 10, "synopsis")}
    <button class="btn primary block" id="arch-done">架构确认，进入蓝图 →</button>`;
}

function bindArch() {
  $$("[data-arch]").forEach(el => el.oninput = () => {
    if (el.dataset.arch === "synopsis") State.novel.synopsis = el.value;
    else State.novel.config[el.dataset.arch] = el.value;
    saveNovel();
  });

  $$("[data-arch-ai]").forEach(btn => btn.onclick = async () => {
    if (genBlocked()) return;
    if (!ensureModel("planning")) return;
    const kind = btn.dataset.archAi;
    const n = State.novel;
    const vars = { config: serializeConfig(n), premise: n.config.coreOutline || "", world: n.config.worldSetting || "", characters: serializeCharacters(n.characters), totalChapters: n.config.totalChapters };
    const tplKey = { premise: "premise", world: "world_building", synopsis: "synopsis", characters: "character_dynamics" }[kind];
    const tpl = T[tplKey];
    const messages = [{ role: "system", content: tpl.system }, { role: "user", content: renderPrompt(tpl, vars) }];
    try {
      if (kind === "characters") {
        const out = await runAI("生成角色名单", "planning", messages);
        const arr = LLM.extractJSON(out);
        if (!Array.isArray(arr)) throw new Error("角色格式不正确");
        n.characters = arr.map(c => ({ id: "c" + Math.random().toString(36).slice(2, 8), ...c }));
        await DB.putNovel(n);
        render(); toast(`已生成 ${arr.length} 个角色`);
      } else {
        const target = { premise: "coreOutline", world: "worldSetting", synopsis: "synopsis" }[kind];
        const out = await runAI("生成" + { premise: "故事前提", world: "世界观", synopsis: "情节大纲" }[kind], "planning", messages, {
          onDelta: (piece, full) => {
            const el = $(`[data-arch="${target}"]`);
            if (el) { el.value = full; el.scrollTop = el.scrollHeight; }
            updateRun(full);
          },
        });
        if (target === "synopsis") n.synopsis = out; else n.config[target] = out;
        await DB.putNovel(n);
        toast("已生成");
      }
    } catch (e) { toast(e.message, true); }
  });

  $("#ch-add").onclick = () => characterSheet(null);
  $$("[data-char]").forEach(b => b.onclick = () => characterSheet(State.novel.characters[parseInt(b.dataset.char)]));

  $("#ch-ai").onclick = async () => {
    if (genBlocked()) return;
    if (!ensureModel("planning")) return;
    const n = State.novel;
    const tpl = T.character_dynamics;
    const messages = [{ role: "system", content: tpl.system }, { role: "user", content: renderPrompt(tpl, {
      config: serializeConfig(n), premise: n.config.coreOutline || "（尚未撰写前提，请根据设定自行构思）",
    }) }];
    try {
      const out = await runAI("生成角色名单", "planning", messages);
      const arr = LLM.extractJSON(out);
      if (!Array.isArray(arr)) throw new Error("角色格式不正确");
      n.characters = arr.map(c => ({ id: "c" + Math.random().toString(36).slice(2, 8), ...c }));
      await DB.putNovel(n);
      render(); toast(`已生成 ${arr.length} 个角色`);
    } catch (e) { toast(e.message, true); }
  };

  $("#arch-done").onclick = async () => {
    State.novel.novelInfoSet = true;
    await DB.putNovel(State.novel);
    State.route.tab = "blueprint";
    render();
  };
}

/* ================= Tab：角色 ================= */
const STATE_FIELDS = [
  ["location", "所在位置"], ["condition", "身体/伤势"], ["mental", "心理状态"],
  ["items", "关键持有物"], ["recent", "近期经历"],
];

function charStateOf(c) { return (c && c.state) || {}; }
function charStateLine(c) {
  const s = charStateOf(c);
  const parts = STATE_FIELDS.map(([k, label]) => s[k] ? `${label}：${s[k]}` : "").filter(Boolean);
  return parts.join("；");
}

function viewChars() {
  const n = State.novel;
  const list = [...n.characters].sort((a, b) => {
    const order = { protagonist: 0, supporting: 1, antagonist: 2, minor: 3 };
    return (order[a.role] ?? 9) - (order[b.role] ?? 9) || (a.name || "").localeCompare(b.name || "");
  });
  const total = list.length;
  const withState = list.filter(c => charStateLine(c)).length;
  return `
    <div class="card">
      <h3>${svgIcon("users", 15)} 角色名单 <span class="spacer"></span><span class="tiny">${total} 人 · ${withState} 人有当前状态</span></h3>
      <div class="row" style="margin-top:2px">
        <button class="btn small primary" id="cr-new">${svgIcon("plus", 14)} 新建</button>
        <button class="btn small" id="cr-graph">${svgIcon("map", 14)} 关系图谱</button>
        <button class="btn small" id="cr-extract">从架构抽取</button>
      </div>
      <div class="tiny" style="margin-top:7px">写作时只会把「本章出场角色 + 主角」的档案注入 prompt，不会一股脑塞满上下文。</div>
    </div>
    ${total ? `<div id="cr-list">${list.map(c => {
      const st = charStateLine(c);
      return `<button class="card" style="width:100%;text-align:left;margin-bottom:9px" data-char="${c.id}">
        <div style="display:flex;align-items:center;gap:9px">
          <span class="avatar">${esc((c.name || "?").slice(0, 1))}</span>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px">
              <b style="font-size:15px">${esc(c.name || "未命名")}</b>
              <span class="tag">${esc(ROLE_NAME[c.role] || c.role || "")}</span>
            </div>
            <div class="tiny" style="margin-top:3px">${esc((c.personality || c.background || "暂无档案").slice(0, 42))}</div>
            ${st ? `<div class="tiny clamp1" style="margin-top:3px;color:var(--accent)">${esc(st).slice(0, 46)}</div>` : `<div class="tiny" style="margin-top:3px;color:var(--ink-3)">当前状态未记录</div>`}
          </div>
        </div>
      </button>`;
    }).join("")}</div>`
      : `<div class="empty"><div class="big">${svgIcon("users", 26)}</div>还没有角色<br/>点「从架构抽取」，AI 会从前提/世界观/大纲里整理出角色名单</div>`}`;
}

function bindChars() {
  const n = State.novel;
  $("#cr-new").onclick = () => characterSheet(null);
  $("#cr-extract").onclick = extractRoster;
  $("#cr-graph").onclick = () => graphSheet();
  $$("[data-char]").forEach(b => b.onclick = () => {
    const ch = n.characters.find(x => x.id === b.dataset.char);
    if (ch) characterSheet(ch);
  });
}

/* 从架构文本抽取角色（对应桌面版角色卡 AI 导入） */
async function extractRoster() {
  if (!ensureModel("planning")) return;
  const n = State.novel;
  const text = [n.premise, n.worldbuilding, n.synopsis, n.characters.length ? serializeCharacters(n.characters) : ""]
    .filter(Boolean).join("\n\n");
  if (!text.trim()) { toast("架构还是空的，先生成架构", true); return; }
  const tpl = T.extract_characters;
  const msgs = [{ role: "system", content: tpl.system }, { role: "user", content: renderPrompt(tpl, {
    existing: n.characters.map(c => c.name).join("、") || "（无）",
    config: serializeConfig(n),
    text: text.slice(0, 12000),
  }) }];
  try {
    const out = await runAI("抽取角色", "planning", msgs);
    const arr = LLM.extractJSON(out);
    const items = Array.isArray(arr) ? arr : (arr && Array.isArray(arr.characters) ? arr.characters : []);
    if (!items.length) { toast("没有抽取到角色，架构可能还不够具体", true); return; }
    let added = 0, merged = 0;
    for (const it of items) {
      if (!it || !it.name) continue;
      const exist = n.characters.find(c => c.name === it.name);
      if (exist) { Object.assign(exist, pickCharFields(it)); merged++; }
      else { n.characters.push({ id: "c" + Math.random().toString(36).slice(2, 8), state: {}, ...pickCharFields(it) }); added++; }
    }
    await DB.putNovel(n);
    render();
    toast(`新增 ${added} 人${merged ? `，补全 ${merged} 人` : ""}`);
  } catch (e) { toast(e.message, true); }
}

function pickCharFields(src) {
  const out = {};
  for (const k of ["name", "role", "gender", "age", "appearance", "personality", "background", "abilities", "motivation", "relationships", "arc"]) {
    if (src[k] != null && src[k] !== "") out[k] = String(src[k]);
  }
  if (!ROLE_NAME[out.role]) out.role = "supporting";
  return out;
}

function characterSheet(ch) {
  const isNew = !ch;
  const c = ch || { name: "", role: "supporting", gender: "", age: "", appearance: "", personality: "", background: "", abilities: "", motivation: "", relationships: "", arc: "", state: {} };
  const s = charStateOf(c);
  const F = [["name", "姓名"], ["gender", "性别"], ["age", "年龄"], ["appearance", "外貌"], ["personality", "性格"], ["background", "背景"], ["abilities", "能力/特长"], ["motivation", "核心动机"], ["relationships", "人际关系"], ["arc", "成长弧线"]];
  openSheet(`
    <h3>${isNew ? "新角色" : esc(c.name || "编辑角色")}</h3>
    <label>定位</label>
    <div class="chip-row" id="cs-role">${Object.entries(ROLE_NAME).map(([k, v]) =>
      `<button class="chip ${c.role === k ? "active" : ""}" data-v="${k}">${v}</button>`).join("")}</div>
    <div class="section-label">档案</div>
    ${F.map(([k, label]) => `<label>${label}</label><input data-ch="${k}" value="${esc(c[k] || "")}" />`).join("")}
    <div class="section-label">当前状态 <span class="tiny" style="font-weight:400">（随剧情推进，定稿时可自动更新）</span></div>
    ${STATE_FIELDS.map(([k, label]) => `<label>${label}</label><input data-state="${k}" value="${esc(s[k] || "")}" />`).join("")}
    <div class="row" style="margin-top:14px">
      ${isNew ? "" : `<button class="btn danger" id="cs-del">删除</button>`}
      <button class="btn primary" id="cs-save">保存</button>
    </div>`, (sheet) => {
    let role = c.role;
    $$("#cs-role .chip", sheet).forEach(b => b.onclick = () => {
      $$("#cs-role .chip", sheet).forEach(x => x.classList.remove("active"));
      b.classList.add("active"); role = b.dataset.v;
    });
    $("#cs-save", sheet).onclick = async () => {
      const data = { role };
      $$("[data-ch]", sheet).forEach(el => { if (el.value.trim()) data[el.dataset.ch] = el.value.trim(); else if (el.dataset.ch === "name") data.name = ""; });
      const st = {};
      $$("[data-state]", sheet).forEach(el => { if (el.value.trim()) st[el.dataset.state] = el.value.trim(); });
      if (!data.name) { toast("姓名必填", true); return; }
      if (isNew) State.novel.characters.push({ id: "c" + Math.random().toString(36).slice(2, 8), ...data, state: st, stateSource: "author" });
      else { Object.assign(ch, data); ch.state = { ...(ch.state || {}), ...st }; ch.stateSource = "author"; }
      await DB.putNovel(State.novel);
      closeSheet(); render(); toast("已保存");
    };
    if (!isNew) $("#cs-del", sheet).onclick = () => {
      confirmSheet("删除这个角色？", "角色档案会从本机删除，已写的正文不受影响。", async () => {
        State.novel.characters = State.novel.characters.filter(x => x !== ch);
        await DB.putNovel(State.novel);
        closeSheet(); render();
      }, "删除");
    };
  });
}

/* ================= Tab：蓝图 ================= */
function getBlueprint(n, num) { return n.blueprints.find(b => b.chapterNumber === num); }

function viewBlueprint() {
  const n = State.novel;
  const total = n.config.totalChapters || 10;
  const sorted = [...n.blueprints].sort((a, b) => a.chapterNumber - b.chapterNumber);
  const lastNum = sorted.length ? sorted[sorted.length - 1].chapterNumber : 0;
  const fromDefault = lastNum ? lastNum + (getChapter(n, lastNum) && getChapter(n, lastNum).content ? 1 : 0) : 1;
  const toDefault = Math.min(total, fromDefault + 4);
  return `
    <div class="card">
      <h3>生成章节蓝图</h3>
      <div class="row">
        <div><label>起始章</label><input id="bp-from" type="number" value="${fromDefault}" /></div>
        <div><label>结束章</label><input id="bp-to" type="number" value="${toDefault}" /></div>
      </div>
      <button class="btn primary block" id="bp-gen" style="margin-top:10px">AI 生成该范围蓝图</button>
      <button class="btn block" id="bp-batch" style="margin-top:8px">${svgIcon("bolt", 16)} 批量创作 · 连写多章</button>
      <div class="tiny" style="margin-top:6px">按情节大纲分批生成；已有蓝图的章节会被覆盖。</div>
    </div>
    <div class="card">
      <h3>章节蓝图（${sorted.length}/${total}）</h3>
      ${sorted.length ? sorted.map(b => `
        <button class="bp-item" data-bp="${b.chapterNumber}">
          <div class="name">第${b.chapterNumber}章 · ${esc(b.title || "")}</div>
          <div class="sub">${esc(b.keyEvents || b.purpose || "")}</div>
        </button>`).join("") : `<div class="tiny">还没有蓝图。设定架构后，按范围生成。</div>`}
    </div>`;
}

function bindBlueprint() {
  $("#bp-from").oninput = () => {
    const to = $("#bp-to");
    to.value = Math.min(State.novel.config.totalChapters || 10, (parseInt($("#bp-from").value) || 1) + 4);
  };
  $("#bp-gen").onclick = async () => {
    if (genBlocked()) return;
    if (!ensureModel("planning")) return;
    const n = State.novel;
    const from = parseInt($("#bp-from").value) || 1;
    const to = parseInt($("#bp-to").value) || from;
    if (to < from) { toast("结束章不能小于起始章", true); return; }
    const tpl = T.chapter_blueprint;
    const vars = {
      from, to, count: to - from + 1,
      config: serializeConfig(n),
      characters: serializeCharacters(n.characters),
      synopsis: n.synopsis || n.config.coreOutline || "",
      extraContext: "",
    };
    const messages = [{ role: "system", content: tpl.system }, { role: "user", content: renderPrompt(tpl, vars) }];
    try {
      const out = await runAI(`生成第${from}-${to}章蓝图`, "planning", messages);
      const arr = LLM.extractJSON(out);
      if (!Array.isArray(arr)) throw new Error("蓝图格式不正确");
      for (const b of arr) {
        const num = parseInt(b.chapterNumber);
        if (!isFinite(num)) continue;
        const existing = getBlueprint(n, num);
        const rec = {
          chapterNumber: num, title: b.title || `第${num}章`,
          purpose: b.purpose || "", keyEvents: b.keyEvents || "",
          characters: Array.isArray(b.characters) ? b.characters : [],
          suspenseHook: b.suspenseHook || "",
        };
        if (existing) Object.assign(existing, rec); else n.blueprints.push(rec);
      }
      await DB.putNovel(n);
      render();
      toast(`已生成 ${arr.length} 章蓝图`);
    } catch (e) { toast(e.message, true); }
  };
  $$("[data-bp]").forEach(b => b.onclick = () => blueprintSheet(parseInt(b.dataset.bp)));

  /* 批量创作（对应桌面版 batch-chapter-workflow） */
  $("#bp-batch").onclick = () => {
    const n = State.novel;
    const from = parseInt($("#bp-from").value) || 1;
    openSheet(`
      <h3>${svgIcon("bolt", 15)} 批量创作</h3>
      <div class="row">
        <div><label>从第几章开始</label><input id="bt-from" type="number" value="${from}" /></div>
        <div><label>连写几章（1-10）</label><input id="bt-count" type="number" value="3" min="1" max="10" /></div>
      </div>
      <label style="display:flex;align-items:center;gap:6px;margin-top:10px"><input type="checkbox" id="bt-skip" checked style="width:auto" /> 跳过已有内容的章节</label>
      <p class="tiny" style="margin-top:6px">逐章生成草稿并自动生成前情摘要，保证连贯；随时可取消，已完成章节保留。没有蓝图的章节会停止。</p>
      <button class="btn primary block" id="bt-go" style="margin-top:12px">开始连写</button>`, (sheet) => {
      $("#bt-go", sheet).onclick = () => {
        const f = parseInt($("#bt-from", sheet).value) || 1;
        const cnt = Math.min(10, Math.max(1, parseInt($("#bt-count", sheet).value) || 1));
        const skip = $("#bt-skip", sheet).checked;
        closeSheet();
        batchWrite(f, cnt, skip);
      };
    });
  };
}

async function batchWrite(from, count, skipExisting) {
  if (genBlocked()) return;
  if (!ensureModel("drafting")) return;
  const n = State.novel;
  showRun(`批量创作 0/${count}`);
  let written = 0, lastNum = from - 1;
  try {
    for (let i = 0; i < count; i++) {
      const num = from + i;
      if (n.config.totalChapters && num > n.config.totalChapters) break;
      let c = getChapter(n, num);
      if (c && c.content.trim() && skipExisting) { updateRunTitle(`批量 ${i + 1}/${count} · 第${num}章已有内容，跳过`); lastNum = num; continue; }
      const b = getBlueprint(n, num);
      if (!b) { toast(`第${num}章没有蓝图，批量停止（可先生成蓝图）`, true); break; }
      updateRunTitle(`批量创作 ${i + 1}/${count} · 写第${num}章`);
      if (!c) { c = DB.newChapter(n, num, b.title); n.chapters.push(c); }
      if (c.content.trim()) pushVersion(c, "批量重写前备份");
      const msgs = await buildChapterPrompt(n, num, b, c);
      const out = await LLM.streamChat(modelFor("drafting"), msgs, {
        signal: State.runState.ctrl.signal,
        onDelta: (_, full) => updateRun(`第${num}章 ` + full.slice(-60).replace(/\n/g, " ")),
      });
      c.content = out;
      c.wordCount = countWords(out);
      c.status = "草稿";
      c.updatedAt = Date.now();
      await DB.putNovel(n);
      written++; lastNum = num;
      // 前情摘要（下一章连贯性依赖它）
      try {
        const tpl = T.chapter_notes;
        c.summary = await LLM.streamChat(modelFor("summary"), [
          { role: "system", content: tpl.system },
          { role: "user", content: renderPrompt(tpl, { draft: out.slice(0, 8000) }) },
        ], { signal: State.runState.ctrl.signal });
        await DB.putNovel(n);
      } catch {}
    }
    toast(`批量完成：本次写了 ${written} 章（至第${lastNum}章草稿），记得逐章审稿`);
  } catch (e) {
    toast(e.name === "AbortError" ? `批量已取消，已写 ${written} 章保留` : "批量中断：" + e.message, true);
  } finally {
    hideRun();
    render();
  }
}

function blueprintSheet(num) {
  const n = State.novel;
  const b = getBlueprint(n, num) || { chapterNumber: num, title: "", purpose: "", keyEvents: "", characters: [], suspenseHook: "" };
  const F = [["title", "章节标题"], ["purpose", "本章作用"], ["keyEvents", "关键事件与冲突"], ["suspenseHook", "章末悬念钩子"], ["characters", "出场角色（逗号分隔）"]];
  openSheet(`
    <h3>第${num}章蓝图</h3>
    ${F.map(([k, label]) => `<label>${label}</label><textarea data-bpf="${k}" rows="${k === "keyEvents" ? 5 : 2}">${esc(Array.isArray(b[k]) ? b[k].join("、") : (b[k] || ""))}</textarea>`).join("")}
    <div class="row" style="margin-top:14px">
      <button class="btn" id="bps-write">写本章 →</button>
      <button class="btn primary" id="bps-save">保存</button>
    </div>`, (sheet) => {
    $("#bps-save", sheet).onclick = () => {
      const data = {};
      $$("[data-bpf]", sheet).forEach(el => data[el.dataset.bpf] = el.value.trim());
      data.characters = (data.characters || "").split(/[,，、\s]+/).filter(Boolean);
      const existing = getBlueprint(n, num);
      if (existing) Object.assign(existing, data);
      else n.blueprints.push({ chapterNumber: num, ...data });
      DB.putNovel(n).then(() => { closeSheet(); render(); });
    };
    $("#bps-write", sheet).onclick = () => {
      $("#bps-save", sheet).click();
      closeSheet();
      nav({ page: "chapter", novelId: n.id, chNum: num });
    };
  });
}

/* ================= Tab：正文（章节列表） ================= */
function getChapter(n, num) { return n.chapters.find(c => c.chapterNumber === num); }

function viewChapters() {
  const n = State.novel;
  const total = n.config.totalChapters || 10;
  const statusTag = (s) => s === "定稿" ? `<span class="tag ok">定稿</span>`
    : s === "已修" ? `<span class="tag accent">已修</span>`
      : s === "已审" ? `<span class="tag accent">已审</span>`
        : s === "审稿中" ? `<span class="tag accent">审稿</span>`
          : s === "草稿" ? `<span class="tag">草稿</span>` : "";
  let items = "";
  for (let i = 1; i <= total; i++) {
    const b = getBlueprint(n, i);
    const c = getChapter(n, i);
    const title = (c && c.title) || (b && b.title) || "";
    items += `
      <div class="chapter-row">
        <button class="chapter-item" data-ch="${i}" style="border-bottom:none">
          <span class="no">${i}</span>
          <span class="t">
            <span class="name">${esc(title || "待写")}</span>
            <span class="sub">${c ? ((c.wordCount || 0) + " 字 · " + fmtDate(c.updatedAt)) : (b ? "蓝图已就绪" : "无蓝图，也可直接写")}</span>
          </span>
          ${statusTag(c && c.status)}
        </button>
        <button class="ch-more" data-chm="${i}" aria-label="章节操作">${svgIcon("more", 16)}</button>
      </div>`;
  }
  return `<div class="card">${items}</div>`;
}

function bindChapters() {
  $$("[data-ch]").forEach(b => b.onclick = () => nav({ page: "chapter", novelId: State.novel.id, chNum: parseInt(b.dataset.ch) }));
  $$("[data-chm]").forEach(b => b.onclick = (e) => { e.stopPropagation(); chapterMenuSheet(parseInt(b.dataset.chm)); });
}

/* ================= 页面：单章编辑 ================= */
function viewChapter() {
  const n = State.novel;
  const num = State.route.chNum;
  let c = getChapter(n, num);
  if (!c) { c = DB.newChapter(n, num, (getBlueprint(n, num) || {}).title); n.chapters.push(c); saveNovel(true); }
  const b = getBlueprint(n, num);
  /* 标题里若已含「第N章」就不再重复 */
  const rawTitle = (c.title || "").trim();
  const dupPrefix = new RegExp(`^第\\s*${num}\\s*章\\s*`);
  const headTitle = rawTitle.replace(dupPrefix, "").trim()
    ? `第${num}章 ${rawTitle.replace(dupPrefix, "").trim()}`
    : `第${num}章`;
  /* 操作全部收进右侧抽屉：正文区不再被两行按钮压掉一截。
     顶栏只留一枚「模式 · 状态」胶囊，点开抽屉才看得到按钮。 */
  const assist = isAssistMode();
  const words = c.wordCount || countWords(c.content || "");
  const canFinalize = (c.content || "").trim() && c.status !== "定稿";
  const ops = assist
    ? [["ed-check", "shield", "查漏洞", "逻辑、伏笔、设定冲突", 1],
       ["ed-polish", "pen", "润色", "只改表达，不添情节", 0],
       ["ed-review", "check", "审稿", "按维度打分并给修改项", 0]]
    : [["ed-write", "spark", "AI 写本章", "按蓝图与章纲起稿", 1],
       ["ed-continue", "arrowRight", "续写", "接着正文往下写", 0],
       ["ed-polish", "pen", "润色", "只改表达，不添情节", 0],
       ["ed-review", "check", "审稿", "按维度打分并给修改项", 0]];
  const opHTML = ops.map(([id, ico, name, hint, pri]) => `
        <button class="ed-op${pri ? " primary" : ""}" id="${id}">
          <span class="ed-op-ico">${svgIcon(ico, 16)}</span>
          <span class="ed-op-txt"><b>${name}</b><small>${hint}</small></span>
          ${svgIcon("arrowRight", 14)}
        </button>`).join("");
  return `
    ${topbar(headTitle, {
      back: true,
      right: `<button class="ed-status-pill ${assist ? "assist" : "create"}" id="ch-tools" data-status="${esc(c.status)}" aria-label="本章状态与操作">
        <i></i><span class="ed-status-txt"><em>${modeLabel()}</em><b id="ch-status">${esc(c.status)}</b></span>${svgIcon("sliders", 15)}
      </button>`,
    })}
    <button class="immersive-exit" id="ch-exit-immersive">${svgIcon("close", 14)} 退出沉浸</button>
    <div class="page editor-page">
      <div class="editor-wrap">
        <div class="card editor-card" style="padding:6px 14px 0;margin-bottom:0">
          <textarea id="ch-editor" class="editor-area" placeholder="在这里写下正文，点右上角状态胶囊用 AI 起稿…">${esc(c.content)}</textarea>
        </div>
      </div>
    </div>
    <div class="ed-drawer-mask" id="ed-drawer-mask"></div>
    <aside class="ed-drawer" id="ed-drawer" aria-hidden="true">
      <div class="ed-drawer-head">
        <div class="ed-drawer-ht">
          <div class="ed-drawer-title">${esc(headTitle)}</div>
          <div class="ed-drawer-sub"><span id="ed-words">${words} 字</span> · <span id="ed-status-2">${esc(c.status)}</span></div>
        </div>
        <button class="icon-btn" id="ed-drawer-close" aria-label="收起">${svgIcon("close", 18)}</button>
      </div>
      <div class="ed-drawer-scroll">
        <div class="ed-group">
          <div class="ed-group-label">AI 模式</div>
          <button class="ed-mode-toggle ${assist ? "assist" : "create"}" id="btn-mode">
            <span class="ed-mode-main"><i></i>${assist ? "辅助模式" : "创作模式"}</span>
            <span class="ed-mode-hint">${assist ? "只查不写" : "可起稿 · 续写"}</span>
          </button>
        </div>
        <div class="ed-group">
          <div class="ed-group-label">AI 处理</div>
          ${opHTML}
        </div>
        <div class="ed-group">
          <div class="ed-group-label">稿件</div>
          <button class="ed-op" id="ed-refine">
            <span class="ed-op-ico">${svgIcon("refresh", 16)}</span>
            <span class="ed-op-txt"><b>修稿</b><small>按审稿意见批量改写</small></span>
            ${svgIcon("arrowRight", 14)}
          </button>
          <button class="ed-op" id="ed-finalize">
            <span class="ed-op-ico">${svgIcon("flag", 16)}</span>
            <span class="ed-op-txt"><b>定稿</b><small>${canFinalize ? "锁定本章并标记完成" : c.status === "定稿" ? "本章已是定稿" : "正文为空，先写再定稿"}</small></span>
            ${svgIcon("arrowRight", 14)}
          </button>
          <button class="ed-op" id="ed-skills">
            <span class="ed-op-ico">${svgIcon("layers", 16)}</span>
            <span class="ed-op-txt"><b>技能</b><small>写作技能与风格模板</small></span>
            ${svgIcon("arrowRight", 14)}
          </button>
          <button class="ed-op" id="ed-history">
            <span class="ed-op-ico">${svgIcon("clock", 16)}</span>
            <span class="ed-op-txt"><b>历史版本</b><small>回滚到之前的稿子</small></span>
            ${svgIcon("arrowRight", 14)}
          </button>
        </div>
        <div class="ed-group">
          <div class="ed-group-label">视图</div>
          <button class="ed-op" id="ch-immersive">
            <span class="ed-op-ico">${svgIcon("eye", 16)}</span>
            <span class="ed-op-txt"><b>沉浸写作</b><small>隐藏全部外壳，只留纸面</small></span>
            ${svgIcon("arrowRight", 14)}
          </button>
          ${b ? `<details class="ed-bp">
            <summary>本章蓝图 · ${esc(b.title || "（无标题）")}</summary>
            <p>${esc(b.keyEvents || "")}</p>
            ${b.suspenseHook ? `<p class="tiny">钩子：${esc(b.suspenseHook)}</p>` : ""}
          </details>` : ""}
        </div>
      </div>
    </aside>`;
}

/* 抽屉开合：右上角胶囊唤出，遮罩/返回键/右上关闭都能收起 */
function setEdDrawer(open) {
  const d = $("#ed-drawer");
  if (!d) { document.body.classList.remove("ed-drawer-open"); return; }
  document.body.classList.toggle("ed-drawer-open", !!open);
  d.setAttribute("aria-hidden", open ? "false" : "true");
  if (open) {
    const s = $(".ed-drawer-scroll");
    if (s) s.scrollTop = 0;
  } else {
    const a = document.activeElement;
    if (a && d.contains(a)) try { a.blur(); } catch (e) {}
  }
}
function isEdDrawerOpen() { return document.body.classList.contains("ed-drawer-open"); }

/* ============ 正文框高度：按可用区域实算 ============
 * 原来写 height: calc(100dvh - 250px)，但 dvh 是 Chrome 108+ 才有的单位。
 * 旧版安卓 WebView 不认，整条声明失效 → 掉回 min-height: 260px，
 * 正文框只剩三分之一屏，下面是空的（v1.8.0 真机就是这个症状）。
 * v1.8.2 起底部操作栏收进右侧抽屉，正文框直接量到屏幕底部（只留安全区），
 * 沉浸模式额外留 58px 给「退出沉浸」浮钮。 */
let edFitRaf = 0, edFitBound = false;
/* env() 在 getComputedStyle 里读不出像素值，用一个探针 div 实测安全区高度 */
let _safeB = null;
function safeBottomPx() {
  if (_safeB != null) return _safeB;
  const p = document.createElement("div");
  p.style.cssText = "position:fixed;left:0;bottom:0;width:1px;height:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none";
  document.body.appendChild(p);
  const h = p.getBoundingClientRect().height;
  p.remove();
  _safeB = Math.round(h) || 0;
  return _safeB;
}
function fitEditorHeight() {
  const ed = $("#ch-editor");
  if (!ed) return;
  const vh = (window.visualViewport && window.visualViewport.height)
    || window.innerHeight || document.documentElement.clientHeight;
  const top = ed.getBoundingClientRect().top;
  const immersive = document.body.classList.contains("immersive");
  const bottom = vh - (immersive ? 58 : safeBottomPx() + 10);
  const h = Math.max(180, Math.round(bottom - top));
  if (ed.style.height !== h + "px") ed.style.height = h + "px";
}
function scheduleFitEditor() {
  if (edFitRaf) return;
  edFitRaf = requestAnimationFrame(() => { edFitRaf = 0; fitEditorHeight(); });
}

function bindChapter() {
  const n = State.novel;
  const num = State.route.chNum;
  const c = getChapter(n, num);
  const b = getBlueprint(n, num);
  const editor = $("#ch-editor");
  State.currentEditor = editor;
  /* 模式切换后某些按钮不存在，绑定用安全包装 */
  const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
  if (window.HUD) HUD.start(editor);

  /* 先算一次正文框高度，再挂自适应监听（只挂一次，切页不重复绑） */
  fitEditorHeight();
  if (!edFitBound) {
    edFitBound = true;
    window.addEventListener("resize", scheduleFitEditor);
    window.addEventListener("orientationchange", () => setTimeout(fitEditorHeight, 140));
    if (window.visualViewport) window.visualViewport.addEventListener("resize", scheduleFitEditor);
  }
  /* 抽屉里没有会影响正文框高度的元素，蓝图 details 展开只滚抽屉自身 */

  const updateChTag = () => {
    const t = $("#ch-status");
    if (t) t.textContent = c.status;
    const pill = $("#ch-tools");
    if (pill) pill.dataset.status = c.status;
    const t2 = $("#ed-status-2");
    if (t2) t2.textContent = c.status;
  };
  const updateWords = () => {
    const w = $("#ed-words");
    if (w) w.textContent = countWords(c.content || "") + " 字";
  };

  /* ---- 右侧操作抽屉 ---- */
  setEdDrawer(State._edDrawerOpen === true);
  State._edDrawerOpen = false;
  on("#ch-tools", () => { State._edDrawerOpen = true; setEdDrawer(true); });
  on("#ed-drawer-close", () => { State._edDrawerOpen = false; setEdDrawer(false); });
  on("#ed-drawer-mask", () => { State._edDrawerOpen = false; setEdDrawer(false); });
  /* 抽屉里的操作点完就收起，把屏幕还给正文（handler 先跑，收起放下一帧） */
  $$(".ed-op", $("#ed-drawer") || document).forEach(btn => {
    btn.addEventListener("click", () => setTimeout(() => {
      State._edDrawerOpen = false;
      setEdDrawer(false);
    }, 0));
  });

  /* 输入处理：节流到每帧最多一次，避免每次按键都做 DOM 写入与重排（卡顿主因之一） */
  let pendingFrame = 0, dirty = false;
  editor.addEventListener("input", () => {
    dirty = true;
    if (pendingFrame) return;
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = 0;
      c.content = editor.value;
      c.wordCount = countWords(c.content);
      c.updatedAt = Date.now();
      if (c.status === "定稿" || c.status === "已审" || c.status === "已修") { c.status = "草稿"; updateChTag(); }
      updateWords();
      saveNovel();
    });
  });
  /* 失焦立即落盘，避免切页丢字 */
  editor.addEventListener("blur", () => { if (dirty) { saveNovel(true); dirty = false; } });

  $("#btn-back").onclick = () => { saveNovel(true); goBack({ page: "novel", novelId: n.id, tab: "chapters" }); };

  /* ---- 沉浸写作模式（隐藏全部外壳，只留纸面） ---- */
  const setImmersive = (on) => {
    if (on) { State._edDrawerOpen = false; setEdDrawer(false); }
    document.body.classList.toggle("immersive", on);
    /* 外壳显隐会改变可用高度，等样式生效后重算 */
    setTimeout(fitEditorHeight, 90);
  };
  $("#ch-immersive").onclick = () => {
    setImmersive(true);
    toast("沉浸模式：点「退出沉浸」或按 Esc 返回");
  };
  $("#ch-exit-immersive").onclick = () => setImmersive(false);
  if (State._escHandler) document.removeEventListener("keydown", State._escHandler);
  State._escHandler = (e) => {
    if (e.key !== "Escape") return;
    if (isEdDrawerOpen()) { State._edDrawerOpen = false; setEdDrawer(false); return; }
    setImmersive(false);
  };
  document.addEventListener("keydown", State._escHandler);

  /* ---- AI 写本章（重写前自动把原稿存入历史，无需弹确认） ---- */
  on("#ed-write", async () => {
    if (genBlocked()) return;
    if (!ensureModel("drafting")) return;
    if (!(await preflightGate(num))) return;               // 写前一致性预检
    if (c.content.trim()) { pushVersion(c, "重写前备份"); toast("原稿已存入历史版本"); }
    const msgs = await buildChapterPrompt(n, num, b, c);
    editor.value = "";
    c.content = "";
    c.status = "草稿";
    updateChTag();
    let latest = "";
    const tip = rafThrottle(updateRun);
    const paint = throttleMs(() => {
      editor.value = latest;
      editor.scrollTop = editor.scrollHeight;
    }, 120);
    try {
      const out = await runAI(`写第${num}章`, "drafting", msgs, {
        onDelta: (piece, full) => { latest = full; paint(); tip(full); },
      });
      c.content = out;
      c.wordCount = countWords(out);
      c.status = "草稿";
      c.updatedAt = Date.now();
      await DB.putNovel(n);
      updateChTag();
      if (window.HUD) { HUD.addAI(c.wordCount); HUD.sync(); }
      toast(`完成，${c.wordCount} 字`);
    } catch (e) {
      c.content = latest || editor.value; // 取消/失败时保留已生成的部分
      editor.value = c.content;
      c.wordCount = countWords(c.content);
      c.status = "草稿";
      updateChTag();
      saveNovel(true);
      toast(e.name === "AbortError" ? "已取消，已生成部分已保留" : e.message, true);
    }
  });

  /* ---- 续写 ---- */
  on("#ed-continue", async () => {
    if (genBlocked()) return;
    if (!ensureModel("drafting")) return;
    if (!c.content.trim()) { toast("还没有内容可续写，先用「AI 写本章」", true); return; }
    const tail = c.content.slice(-1000);
    const msgs = [
      { role: "system", content: SYSTEM_CONTRACT },
      { role: "user", content: `继续为本书写第${num}章的后续内容，从下面文字的结尾自然接续，写出 400-900 字后停在一个合适的段落。不要重复已有文字，不要解释。\n\n<前文结尾>\n${tail}\n</前文结尾>` +
        (window.Materials && (n.materials || []).length ? "\n\n" + (Materials.context(n, tail, 3) || "") : "") },
    ];
    pushVersion(c, "续写前备份");
    const base = c.content;
    let added = "";
    const tip2 = rafThrottle(updateRun);
    const paint2 = throttleMs(() => {
      editor.value = base + added;
      editor.scrollTop = editor.scrollHeight;
    }, 120);
    try {
      const out = await runAI("续写中", "drafting", msgs, {
        onDelta: (piece, full) => { added = full; paint2(); tip2(full); },
      });
      c.content = base + out;
      editor.value = c.content;
      c.wordCount = countWords(c.content);
      c.status = "草稿";
      await DB.putNovel(n);
      updateChTag();
      if (window.HUD) { HUD.addAI(countWords(out)); HUD.sync(); }
      toast("续写完成");
    } catch (e) {
      /* 取消时把已续写的部分留下，不丢字 */
      if (added) { c.content = base + added; c.wordCount = countWords(c.content); saveNovel(true); }
      toast(e.name === "AbortError" ? "已取消，已续写部分已保留" : e.message, true);
    }
  });

  /* ---- 润色选中文本 ---- */
  $("#ed-polish").onclick = () => {
    const sel = State.editorSel || (editor.selectionStart !== editor.selectionEnd ? { start: editor.selectionStart, end: editor.selectionEnd, text: editor.value.slice(editor.selectionStart, editor.selectionEnd) } : null);
    if (!sel || !sel.text.trim()) { toast("先在正文里选中一段文字", true); return; }
    openSheet(`
      <h3>编辑选中文本</h3>
      <p class="ai-output" style="max-height:14vh">${esc(sel.text.slice(0, 200))}</p>
      <div class="chip-row">
        <button class="chip" data-op="润色这段文字，让它更生动自然">润色</button>
        <button class="chip" data-op="扩写这段文字，增加细节描写，篇幅扩到原来的2倍左右">扩写</button>
        <button class="chip" data-op="把这段叙述改写成人物对话来推进">改成对话</button>
        <button class="chip" data-op="删减压缩这段文字，只保留必要信息，去除注水">精简</button>
      </div>
      <div id="polish-out" style="margin-top:12px;display:none">
        <div class="ai-output" id="polish-text"></div>
        <div class="row" style="margin-top:10px">
          <button class="btn" id="polish-retry">重试</button>
          <button class="btn primary" id="polish-apply">替换原文</button>
        </div>
      </div>`, (sheet) => {
      let currentOp = null;
      const doRun = async () => {
        if (!ensureModel("refinement")) return;
        $("#polish-out", sheet).style.display = "block";
        $("#polish-text", sheet).textContent = "…";
        const tpl = T.edit_selected_text;
        const msgs = [{ role: "system", content: tpl.system }, { role: "user", content: renderPrompt(tpl, {
          operation: currentOp, selection: sel.text,
          styleHint: n.config.writingStyle ? `，文风：${n.config.writingStyle}` : "",
        }) }];
        try {
          const out = await runAI("编辑选中文本", "refinement", msgs, {
            onDelta: (piece, full) => { $("#polish-text", sheet).textContent = full; updateRun(full); },
          });
          $("#polish-text", sheet).dataset.result = out;
        } catch (e) { toast(e.message, true); }
      };
      $$(".chip", sheet).forEach(chip => chip.onclick = () => {
        currentOp = chip.dataset.op;
        $$(".chip", sheet).forEach(x => x.classList.remove("active"));
        chip.classList.add("active");
        doRun();
      });
      $("#polish-retry", sheet).onclick = () => currentOp && doRun();
      $("#polish-apply", sheet).onclick = () => {
        const result = $("#polish-text", sheet).dataset.result;
        if (!result) { toast("还没有生成结果", true); return; }
        editor.setRangeText(result, sel.start, sel.end, "end");
        editor.dispatchEvent(new Event("input"));
        closeSheet(); toast("已替换");
      };
    });
  };

  /* ---- 查漏洞（仅辅助模式出现，只诊断不改稿） ---- */
  on("#ed-check", () => consistencyCheck(num));

  /* ---- 审稿（四维 + 勾选采纳 + 复验闭环） ---- */
  $("#ed-review").onclick = async () => {
    if (!ensureModel("review")) return;
    if (!c.content.trim()) { toast("先写点什么再审稿", true); return; }
    const tpl = T.review_chapter;
    const msgs = [{ role: "system", content: tpl.system }, { role: "user", content: renderPrompt(tpl, {
      config: serializeConfig(n),
      facts: factsText(n),
      blueprint: b ? `第${b.chapterNumber}章 ${b.title}：${b.keyEvents}` : "（无蓝图）",
      summary: getRollingSummary(n, num),
      draft: c.content,
    }) }];
    try {
      const out = await runAI("审稿中", "review", msgs);
      const arr = LLM.extractJSON(out);
      const items = Array.isArray(arr) ? arr : (arr && Array.isArray(arr.issues) ? arr.issues : []);
      c.lastReview = items;
      if (c.status === "草稿" || c.status === "待写") { c.status = "已审"; updateChTag(); }
      saveNovel(true);
      reviewSheet(items, { num });
    } catch (e) { toast(e.message, true); }
  };

  /* ---- 修稿 ---- */
  $("#ed-refine").onclick = async () => {
    if (!ensureModel("refinement")) return;
    if (!c.content.trim()) { toast("没有可修的稿件", true); return; }
    openSheet(`
      <h3>修稿</h3>
      <label>你的修改方向 / 指导（可选）</label>
      <textarea id="rf-guidance" rows="3" placeholder="例如：节奏太慢，把开头压缩；加强悬念"></textarea>
      ${c.lastReview && c.lastReview.length ? `<label>使用最近一次审稿意见（${c.lastReview.length} 条）</label><label style="display:flex;align-items:center;gap:6px;margin-top:0"><input type="checkbox" id="rf-use-review" checked style="width:auto" /> 附带审稿意见</label>` : ""}
      <button class="btn primary block" id="rf-go" style="margin-top:12px">开始修稿</button>
      <div id="rf-out" style="display:none;margin-top:12px">
        <div class="ai-output" id="rf-text" style="max-height:44vh"></div>
        <div class="row" style="margin-top:10px">
          <button class="btn" id="rf-discard">放弃</button>
          <button class="btn" id="rf-diff">逐段合并</button>
          <button class="btn primary" id="rf-merge">全部采用</button>
        </div>
      </div>`, (sheet) => {
      $("#rf-go", sheet).onclick = async () => {
        if (!ensureModel("refinement")) return;
        const guidance = $("#rf-guidance", sheet).value.trim() || "无特别指导";
        const useReview = $("#rf-use-review", sheet) ? $("#rf-use-review", sheet).checked : false;
        const review = useReview && c.lastReview ? c.lastReview.map(r => `[${r.severity}] ${r.dimension}：${r.comment}${r.quote ? "（原文：" + r.quote + "）" : ""}`).join("\n") : "无";
        const tpl = T.refine_chapter;
        const msgs = [{ role: "system", content: tpl.system }, { role: "user", content: renderPrompt(tpl, {
          blueprint: b ? `第${b.chapterNumber}章 ${b.title}：${b.keyEvents}` : "（无蓝图）",
          review, guidance, draft: c.content,
        }) }];
        $("#rf-out", sheet).style.display = "block";
        try {
          const out = await runAI("修稿中", "refinement", msgs, {
            onDelta: (piece, full) => {
              const el = $("#rf-text", sheet);
              if (el) { el.textContent = full; el.scrollTop = el.scrollHeight; }
              updateRun(full);
            },
          });
          $("#rf-text", sheet).dataset.result = out;
        } catch (e) { toast(e.message, true); }
      };
      $("#rf-discard", sheet).onclick = closeSheet;
      $("#rf-diff", sheet).onclick = () => {
        const result = $("#rf-text", sheet).dataset.result;
        if (!result) { toast("先生成修稿结果", true); return; }
        closeSheet();
        mergeSheet(num, c.content, result);
      };
      $("#rf-merge", sheet).onclick = () => {
        const result = $("#rf-text", sheet).dataset.result;
        if (!result) { toast("先生成修稿结果", true); return; }
        pushVersion(c);
        c.content = result;
        c.wordCount = countWords(result);
        c.status = "草稿";
        c.updatedAt = Date.now();
        DB.putNovel(n).then(() => { closeSheet(); render(); toast("已采用为新稿"); });
      };
    });
  };

  /* ---- 定稿 ---- */
  $("#ed-finalize").onclick = async () => {
    if (!c.content.trim()) { toast("空章不能定稿", true); return; }
    if (c.status === "定稿") {
      confirmSheet("取消定稿？", "本章将退回草稿状态（内容不变）。", async () => { c.status = "草稿"; await DB.putNovel(n); render(); }, "退回");
      return;
    }
    pushVersion(c);
    c.status = "定稿";
    c.updatedAt = Date.now();
    await DB.putNovel(n);
    toast("已定稿 ✓");
    render();
    // 定稿后处理流水线：要点 / 连续性事实 / 伏笔线索（对应桌面版 post-process steps）
    postFinalize(num);
    if (State.appearance.autoNext) setTimeout(() => maybeAutoNext(num), 700);
  };

  /* ---- 历史版本（含逐字对比） ---- */
  $("#ed-history").onclick = () => {
    const vs = c.versions || [];
    if (!vs.length) { toast("还没有历史版本（生成/修稿时会自动存一份）", true); return; }
    openSheet(`
      <h3>历史版本</h3>
      <p class="tiny">「对比」会把该版本与当前稿逐字比对，红色是删掉的字，绿色是新增的字。</p>
      <div style="margin-top:8px">
      ${vs.map((v, i) => `
        <div class="ver-row">
          <span class="no">#${vs.length - i}</span>
          <span class="t"><span class="name">${v.wordCount} 字</span><span class="sub">${fmtDate(v.savedAt)}${v.note ? " · " + esc(v.note) : ""}</span></span>
          <button class="btn small" data-diff="${i}">对比</button>
          <button class="btn small" data-restore="${i}">恢复</button>
        </div>`).join("")}
      </div>`, (sheet) => {
      $$("[data-diff]", sheet).forEach(btn => btn.onclick = () => {
        closeSheet();
        diffSheet(num, vs[parseInt(btn.dataset.diff)].content, c.content,
          `版本 #${vs.length - parseInt(btn.dataset.diff)}`, "当前稿");
      });
      $$("[data-restore]", sheet).forEach(btn => btn.onclick = () => {
        const v = vs[parseInt(btn.dataset.restore)];
        confirmSheet("恢复此版本？", "当前稿会先存入历史，再恢复所选版本为草稿。", async () => {
          pushVersion(c, "恢复前备份");
          c.content = v.content;
          c.wordCount = v.wordCount;
          c.status = "草稿";
          await DB.putNovel(n);
          closeSheet(); render(); toast("已恢复为新草稿");
        }, "恢复");
      });
    });
  };

  /* ---- 技能库 + 章纲罗盘 ---- */
  on("#ed-skills", () => skillLibrarySheet(num));
  if (window.Compass) Compass.mount(n, num);
}

function ensureModelSilent() { return !!modelFor("summary"); }
async function runAIQuiet(stage, messages) {
  const model = modelFor(stage);
  return LLM.streamChat(model, messages, {});
}

function pushVersion(c, note) {
  if (!c.content.trim()) return;
  c.versions = c.versions || [];
  c.versions.push({ content: c.content, wordCount: c.wordCount, savedAt: Date.now(), note: note || "" });
  if (c.versions.length > 20) c.versions = c.versions.slice(-20);
}

/* ---- 组装写章 prompt（对应桌面版 ChapterPromptBuilder） ---- */
async function buildChapterPrompt(n, num, b, c) {
  const tpl = T.chapter_draft;
  const prev = [...n.chapters].filter(x => x.chapterNumber < num && x.content).sort((a, z) => z.chapterNumber - a.chapterNumber)[0];
  const summary = getRollingSummary(n, num);
  const bp = b || { title: "", purpose: "", keyEvents: "", suspenseHook: "" };
  const chars = n.characters.length
    ? serializeCharacters(filterRelevantChars(n, bp))
    : "（暂无角色档案，依据设定中的主角自行组织）";
  const future = n.blueprints.filter(x => x.chapterNumber > num && x.chapterNumber <= num + 3)
    .sort((a, z) => a.chapterNumber - z.chapterNumber)
    .map(x => `第${x.chapterNumber}章《${x.title}》：${x.keyEvents || ""}`).join("\n");
  const messages = [{ role: "system", content: tpl.system }];
  let user = renderPrompt(tpl, {
    chapterNumber: num,
    wordsPerChapter: n.config.wordsPerChapter || 2500,
    config: serializeConfig(n),
    synopsis: n.synopsis || n.config.coreOutline || "（尚未撰写大纲）",
    characters: chars,
    continuity: n.facts && n.facts.length ? `<已定稿的连续性事实（必须遵守，不得矛盾）>\n${factsText(n)}\n</已定稿的连续性事实>\n` : "",
    blueprint: `第${bp.chapterNumber || num}章《${bp.title || ""}》\n作用：${bp.purpose || ""}\n关键事件：${bp.keyEvents || ""}\n章末钩子：${bp.suspenseHook || ""}`,
    future: future ? `\n<后续章节走向>\n${future}\n</后续章节走向>\n` : "",
    summary: summary || "（这是全书开头，没有前情）",
    previousEnding: prev ? prev.content.slice(-1200) : "",
  });
  // 去掉空段落标签
  user = user.replace(/<[^>]+>\s*<\/[^>]+>/g, "").replace(/\n{3,}/g, "\n\n");
  if (n.config.globalGuidance) user += `\n\n<作者全局指导>\n${n.config.globalGuidance}\n</作者全局指导>`;
  // 拆书仿写约束（对应桌面版参考小说知识库注入）
  if (n.referenceId) {
    const ref = await DB.getNovel(n.referenceId);
    if (ref && ref.kind === "reference") {
      user += `\n\n<仿写参考（只学其文风与章法，严禁借用其情节、人名与设定）>`;
      if (ref.styleAnalysis) user += `\n【文风报告】\n${ref.styleAnalysis}`;
      if (ref.structureAnalysis) user += `\n\n【结构要点】\n${ref.structureAnalysis}`;
      user += `\n</仿写参考>`;
    }
  }
  /* 资料库检索：按本章蓝图 + 上一章结尾把最相关的几段资料塞进上下文 */
  if (window.Materials && (n.materials || []).length) {
    const query = [
      bp.title, bp.purpose, bp.keyEvents, bp.suspenseHook,
      (bp.beats || []).map(x => x.text).join(" "),
      n.config.coreOutline, n.config.worldSetting,
    ].filter(Boolean).join(" ");
    let block = Materials.context(n, query, 4);
    if (!block && prev) block = Materials.context(n, prev.content.slice(-500), 3);
    if (block) user += "\n\n" + block;
  }
  messages.push({ role: "user", content: user });
  return messages;
}

function filterRelevantChars(n, bp) {
  const names = (bp.characters || []).map(s => (s || "").trim());
  if (!names.length) return n.characters.slice(0, 8);
  const picked = n.characters.filter(ch => names.includes(ch.name));
  // 补主角
  for (const ch of n.characters) {
    if (ch.role === "protagonist" && !picked.includes(ch)) picked.unshift(ch);
  }
  return picked.slice(0, 8);
}

function getRollingSummary(n, num) {  const parts = [...n.chapters]
    .filter(x => x.chapterNumber < num && x.summary)
    .sort((a, b) => b.chapterNumber - a.chapterNumber)
    .slice(0, 3)
    .reverse()
    .map(x => `第${x.chapterNumber}章：${x.summary}`);
  return parts.join("\n");
}

/* ---------- 连续性事实 / 角色状态的文本化（注入 prompt 用） ---------- */
function factsText(n) {
  if (!n.facts || !n.facts.length) return "（还没有定稿章节的事实记录）";
  return n.facts.slice(-8).map(f => {
    const cs = (f.characterStates || []).map(s => {
      const bits = [s.location && `位置:${s.location}`, s.condition && `身体:${s.condition}`,
        s.mental && `心理:${s.mental}`, s.items && `物品:${s.items}`, s.recent && `经历:${s.recent}`]
        .filter(Boolean).join("，");
      return `- ${s.name}：${bits}`;
    }).join("\n");
    const pf = (f.plotFacts || []).map(x => `- ${x}`).join("\n");
    const th = (f.openThreads || []).map(t => `- ${t.thread}（${t.status || "已埋"}）`).join("\n");
    return `【第${f.chapterNumber}章】` +
      (f.timeline ? `\n时间：${f.timeline}` : "") +
      (cs ? `\n角色状态：\n${cs}` : "") +
      (pf ? `\n情节事实：\n${pf}` : "") +
      (th ? `\n未收束线索：\n${th}` : "");
  }).join("\n\n");
}

function charsStateText(n) {
  const withState = (n.characters || []).filter(c => charStateLine(c));
  if (!withState.length) return "（角色当前状态未记录）";
  return withState.map(c => `${c.name}：${charStateLine(c)}`).join("\n");
}

/* ---------- 审稿报告 + 勾选采纳 + 定向修稿 + 复验（对应桌面版审稿闭环） ---------- */
const SEV_NAME = { high: "严重", medium: "建议", low: "待核实" };

function reviewSheet(items, ctx) {
  const n = State.novel;
  if (!items.length) { toast("审稿完成：四个维度都没发现明显问题 ✓"); return; }
  const sevCount = { high: 0, medium: 0, low: 0 };
  items.forEach(r => { const k = r.severity === "high" ? "high" : r.severity === "low" ? "low" : "medium"; sevCount[k]++; });
  openSheet(`
    <h3>审稿报告</h3>
    <div class="stat-bar" style="margin-bottom:10px">
      <span class="tag err">严重 ${sevCount.high}</span>
      <span class="tag warn">建议 ${sevCount.medium}</span>
      <span class="tag">待核实 ${sevCount.low}</span>
    </div>
    <p class="tiny">勾选要采纳的意见，AI 只改这些；未勾选的段落保持原样。</p>
    <div id="rv-list" style="margin-top:10px">
      ${items.map((r, i) => {
        const sev = r.severity === "high" ? "high" : r.severity === "low" ? "low" : "medium";
        return `<label class="rv-item" data-rv="${i}">
          <input type="checkbox" class="rv-cb" ${sev === "high" ? "checked" : ""} data-i="${i}" />
          <div style="flex:1;min-width:0">
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <span class="tag ${sev === "high" ? "err" : sev === "medium" ? "warn" : ""}">${SEV_NAME[sev]}</span>
              <span class="tiny">${esc(r.dimension || "其他")}</span>
            </div>
            ${r.quote ? `<div class="tiny" style="margin-top:5px;color:var(--ink-3)">「${esc(r.quote)}」</div>` : ""}
            <div class="muted" style="margin-top:4px;font-size:13.5px">${esc(r.comment || "")}</div>
          </div>
        </label>`;
      }).join("")}
    </div>
    <div class="row" style="margin-top:14px">
      <button class="btn small" id="rv-all-high">全选严重项</button>
      <button class="btn small" id="rv-none">全不选</button>
    </div>
    <button class="btn primary block" id="rv-refine" style="margin-top:10px">按勾选意见修稿</button>
    <div class="tiny" style="margin-top:6px">修完会自动复验一遍，确认这些问题是否真的改掉了。</div>`, (sheet) => {
    const adopted = () => items.filter((_, i) => $(".rv-cb[data-i='" + i + "']", sheet)?.checked);
    $("#rv-all-high").onclick = () => $$(".rv-cb", sheet).forEach(cb => cb.checked = items[+cb.dataset.i].severity === "high");
    $("#rv-none").onclick = () => $$(".rv-cb", sheet).forEach(cb => cb.checked = false);
    $("#rv-refine").onclick = async () => {
      const chosen = adopted();
      if (!chosen.length) { toast("先勾选至少一条意见", true); return; }
      closeSheet();
      await refineFromReview(ctx.num, chosen);
    };
  });
}

async function refineFromReview(num, chosen) {
  const n = State.novel;
  const c = getChapter(n, num);
  const b = getBlueprint(n, num);
  if (!ensureModel("refinement")) return;
  const reviewText = chosen.map((r, i) => `${i + 1}. [${r.dimension || "问题"}] ${r.comment || ""}${r.quote ? `（原文：${r.quote}）` : ""}`).join("\n");
  pushVersion(c, "修稿前备份");
  const tpl = T.refine_from_review;
  const msgs = [{ role: "system", content: tpl.system }, { role: "user", content: renderPrompt(tpl, {
    blueprint: b ? `第${b.chapterNumber}章《${b.title || ""}》：${b.keyEvents || ""}` : "（无蓝图）",
    review: reviewText,
    guidance: n.config.globalGuidance || "（无）",
    draft: c.content,
  }) }];
  try {
    const out = await runAI("按意见修稿", "refinement", msgs);
    c.content = out;
    c.wordCount = countWords(out);
    c.status = "已修";
    c.updatedAt = Date.now();
    await DB.putNovel(n);
    render();
    toast("修稿完成，开始复验…");
    await recheckReview(num, chosen);
  } catch (e) {
    toast(e.name === "AbortError" ? "已取消，原稿已存入历史版本" : e.message, true);
  }
}

async function recheckReview(num, chosen) {
  const n = State.novel;
  const c = getChapter(n, num);
  const reviewText = chosen.map((r, i) => `${i + 1}. [${r.dimension || ""}] ${r.comment || ""}`).join("\n");
  const tpl = T.recheck_review;
  const msgs = [{ role: "system", content: tpl.system }, { role: "user", content: renderPrompt(tpl, { review: reviewText, draft: c.content }) }];
  try {
    const out = await runAIQuiet("recheck", msgs);
    const arr = LLM.extractJSON(out);
    const list = Array.isArray(arr) ? arr : [];
    c.reviewResolved = chosen.map((r, i) => {
      const hit = list.find(x => Number(x.index) === i + 1) || list[i] || {};
      return { comment: r.comment || "", resolved: hit.resolved !== false, note: hit.note || "" };
    });
    await DB.putNovel(n);
    const ok = c.reviewResolved.filter(x => x.resolved).length;
    const left = c.reviewResolved.filter(x => !x.resolved);
    openSheet(`
      <h3>复验结果</h3>
      <p class="muted">${ok} / ${chosen.length} 条意见已解决。</p>
      ${left.length ? `<div style="margin-top:10px">${left.map(x => `<div class="card" style="margin-bottom:8px"><div class="tag warn">仍待处理</div><div class="muted" style="margin-top:6px;font-size:13.5px">${esc(x.comment)}</div>${x.note ? `<div class="tiny" style="margin-top:4px">${esc(x.note)}</div>` : ""}</div>`).join("")}</div>` : `<p class="muted" style="margin-top:10px">全部通过 ✓ 可以定稿了。</p>`}
      <button class="btn block" id="rc-close" style="margin-top:12px">知道了</button>`, (sheet) => {
      $("#rc-close", sheet).onclick = closeSheet;
    });
  } catch (e) { toast("复验失败：" + e.message, true); }
}

/* ---------- 写前一致性预检（对应桌面版 consistency-preflight） ---------- */
async function preflightGate(num) {
  const n = State.novel;
  if (!n.facts || !n.facts.length) return true;          // 还没有既成事实，无需预检
  const b = getBlueprint(n, num);
  if (!b) return true;
  if (!ensureModelSilent()) return true;                  // 没配模型就别拦着写作
  try {
    const tpl = T.preflight;
    const out = await runAIQuiet("review", [
      { role: "system", content: tpl.system },
      { role: "user", content: renderPrompt(tpl, {
        chapterNumber: num,
        facts: factsText(n),
        characters: charsStateText(n),
        blueprint: `第${b.chapterNumber}章《${b.title || ""}》\n关键事件：${b.keyEvents || ""}\n出场：${(b.characters || []).join("、")}`,
      }) },
    ]);
    const data = LLM.extractJSON(out) || {};
    const risks = Array.isArray(data.risks) ? data.risks : [];
    if (!risks.length) return true;
    return await new Promise((resolve) => {
      openSheet(`
        <h3>写前预检：${risks.length} 处可能冲突</h3>
        <p class="tiny">这是根据已定稿内容做的机械比对，可能是误会。确认后仍可继续写。</p>
        <div style="margin-top:10px">
          ${risks.map(r => `<div class="card" style="margin-bottom:8px">
            <span class="tag ${r.level === "high" ? "err" : "warn"}">${r.level === "high" ? "很可能冲突" : "需留意"}</span>
            <div class="muted" style="margin-top:6px;font-size:13.5px">${esc(r.conflict || "")}</div>
            ${r.suggestion ? `<div class="tiny" style="margin-top:4px">建议：${esc(r.suggestion)}</div>` : ""}
          </div>`).join("")}
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn" id="pf-stop">先不写</button>
          <button class="btn primary" id="pf-go">忽略，继续写</button>
        </div>`, (sheet) => {
        $("#pf-stop", sheet).onclick = () => { closeSheet(); resolve(false); };
        $("#pf-go", sheet).onclick = () => { closeSheet(); resolve(true); };
      });
    });
  } catch { return true; }   // 预检失败不阻塞写作
}

/* ---------- 查漏洞：只诊断、不动稿（AI 辅助模式的核心动作） ---------- */
async function consistencyCheck(num) {
  const n = State.novel;
  const c = getChapter(n, num);
  const b = getBlueprint(n, num);
  if (!c || !c.content.trim()) { toast("本章还没有正文，先写点东西再来查", true); return; }
  if (!ensureModel("review")) return;
  const tpl = T.consistency_check;
  const msgs = [
    { role: "system", content: tpl.system },
    { role: "user", content: renderPrompt(tpl, {
      config: serializeConfig(n),
      blueprint: b ? `第${b.chapterNumber}章 ${b.title}：${b.keyEvents}` : "（无蓝图）",
      summary: getRollingSummary(n, num),
      draft: c.content,
    }) },
  ];
  try {
    const out = await runAI("查漏洞", "review", msgs);
    const raw = LLM.extractJSON(out);
    const items = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.issues) ? raw.issues : []);
    const rank = { high: 0, medium: 1, low: 2 };
    items.sort((x, y) => (rank[x.severity] ?? 9) - (rank[y.severity] ?? 9));
    if (!items.length) {
      openSheet(`
        <h3>没查出硬伤</h3>
        <p class="muted" style="margin-top:8px">设定、人物状态、逻辑链都对得上。可以定稿了。</p>
        <button class="btn block" id="cc-ok" style="margin-top:14px">知道了</button>`, (sheet) => {
        $("#cc-ok", sheet).onclick = closeSheet;
      });
      return;
    }
    openSheet(`
      <h3>查漏洞 · ${items.length} 处</h3>
      <p class="tiny">只做诊断，不动你的稿子。点「定位」跳到原文对应位置。</p>
      <div style="margin-top:10px">
        ${items.map((it, i) => `<div class="card" style="margin-bottom:8px;padding:12px 13px">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span class="tag ${it.severity === "high" ? "err" : it.severity === "low" ? "" : "warn"}">${it.severity === "high" ? "硬伤" : it.severity === "low" ? "小问题" : "需留意"}</span>
            ${it.dimension ? `<span class="tiny">${esc(it.dimension)}</span>` : ""}
          </div>
          ${it.quote ? `<div class="muted" style="margin-top:7px;font-size:13.5px;white-space:pre-wrap">「${esc(it.quote)}」</div>` : ""}
          <div style="margin-top:5px;font-size:13px;line-height:1.7">${esc(it.comment || "")}</div>
          ${it.quote ? `<button class="btn small" data-locate="${esc(it.quote).replace(/"/g, "&quot;")}" style="margin-top:8px">定位原文</button>` : ""}
        </div>`).join("")}
      </div>
      <button class="btn block" id="cc-close" style="margin-top:4px">关掉，继续写</button>`, (sheet) => {
      $("#cc-close", sheet).onclick = closeSheet;
      $$("[data-locate]", sheet).forEach(btn => btn.onclick = () => {
        const q = btn.dataset.locate;
        closeSheet();
        locateInEditor(q);
      });
    });
  } catch (e) { toast(e.message, true); }
}

/* 把编辑器滚到引用处并选中，方便直接改 */
function locateInEditor(quote) {
  const ed = $("#ch-editor");
  if (!ed) return;
  const i = ed.value.indexOf(quote);
  if (i < 0) { toast("原文里没找到这句，可能已经被改过了", true); return; }
  ed.focus();
  try { ed.setSelectionRange(i, i + quote.length); } catch (e) {}
  const lh = parseFloat(getComputedStyle(ed).lineHeight) || 34;
  const line = ed.value.slice(0, i).split("\n").length;
  ed.scrollTop = Math.max(0, (line - 3) * lh);
}

/* ---------- 定稿后处理流水线：要点 / 事实 / 伏笔 / 角色状态 ---------- */
async function postFinalize(num) {
  const n = State.novel;
  const c = getChapter(n, num);
  if (!c || !c.content.trim() || !ensureModelSilent()) return;
  const draft = c.content.slice(0, 12000);
  let done = 0;

  // ① 章节要点（前情摘要）
  if (!c.summary) {
    try {
      const tpl = T.chapter_notes;
      c.summary = await runAIQuiet("summary", [
        { role: "system", content: tpl.system },
        { role: "user", content: renderPrompt(tpl, { draft }) },
      ]);
      done++;
    } catch {}
  }

  // ② 连续性事实
  try {
    const tpl = T.extract_facts;
    const out = await runAIQuiet("summary", [
      { role: "system", content: tpl.system },
      { role: "user", content: renderPrompt(tpl, { draft }) },
    ]);
    const f = LLM.extractJSON(out);
    if (f && typeof f === "object") {
      n.facts = (n.facts || []).filter(x => x.chapterNumber !== num);
      n.facts.push({
        chapterNumber: num,
        characterStates: Array.isArray(f.characterStates) ? f.characterStates : [],
        timeline: f.timeline || "",
        openThreads: Array.isArray(f.openThreads) ? f.openThreads : [],
        plotFacts: (Array.isArray(f.plotFacts) ? f.plotFacts : []).map(String).slice(0, 12),
        at: Date.now(),
      });
      n.facts.sort((a, z) => a.chapterNumber - z.chapterNumber);
      c.factsDone = true;
      // 顺带把角色当前状态同步过去
      for (const s of (n.facts.find(x => x.chapterNumber === num)?.characterStates || [])) {
        const ch = n.characters.find(x => x.name === s.name);
        if (ch && ch.stateSource !== "author") {
          ch.state = { ...(ch.state || {}), ...Object.fromEntries(Object.entries({
            location: s.location, condition: s.condition, mental: s.mental, items: s.items, recent: s.recent,
          }).filter(([, v]) => v)) };
          ch.stateSource = "history";
        }
      }
      done++;
    }
  } catch {}

  // ③ 伏笔线索
  try {
    const tpl = T.extract_threads;
    const existing = (n.threads || []).map(t => `#${t.id} ${t.thread}（${t.status}，最近推进：第${t.lastMovedAt || t.plantedAt || "?"}章）`).join("\n") || "（暂无）";
    const out = await runAIQuiet("summary", [
      { role: "system", content: tpl.system },
      { role: "user", content: renderPrompt(tpl, { threads: existing, draft }) },
    ]);
    const d = LLM.extractJSON(out) || {};
    for (const e of (Array.isArray(d.existing) ? d.existing : [])) {
      const t = (n.threads || []).find(x => String(x.id) === String(e.id));
      if (t && e.advanced) t.lastMovedAt = num;
    }
    for (const nt of (Array.isArray(d.new) ? d.new : [])) {
      if (!nt || !nt.thread) continue;
      if ((n.threads || []).some(t => t.thread === nt.thread)) continue;
      n.threads = n.threads || [];
      n.threads.push({
        id: "t" + Math.random().toString(36).slice(2, 7),
        thread: nt.thread, status: nt.status || "已埋",
        plantedAt: num, lastMovedAt: num,
      });
    }
    done++;
  } catch {}

  await DB.putNovel(n);
  renderPostsync(done);
}

function renderPostsync(done) {
  if (done > 0) toast(`定稿后处理完成（${done}/3 步）`);
}

/* ---------- 调用统计（本地） ---------- */
async function recordCall(stage, messages, output) {
  try {
    const s = await DB.kvGet("stats", { calls: 0, chars: 0, byStage: {} });
    s.calls = (s.calls || 0) + 1;
    s.chars = (s.chars || 0) + (output ? output.length : 0);
    s.byStage = s.byStage || {};
    s.byStage[stage] = (s.byStage[stage] || 0) + 1;
    s.updatedAt = Date.now();
    await DB.kvSet("stats", s);
  } catch {}
}

/* ---------- 作品「更多」菜单 ---------- */
function moreSheet() {
  const n = State.novel;
  const rows = [
    ["mo-export", "import", "导出与备份", "Markdown / TXT / 全量 JSON"],
    ["mo-skills", "layers", "技能库", `审查 / 纠错 · ${window.Skills ? Skills.all().filter(s => s.enabled).length : 0} 个已启用`],
    ["mo-materials", "book", "资料库", `${(n.materials || []).length} 份参考资料`],
    ["mo-threads", "map", "剧情与伏笔", `${(n.threads || []).length} 条线索`],
    ["mo-health", "shield", "数据体检", "结构、缺口、悬空线索"],
    ["mo-stats", "chart", "写作统计", "字数、章数、AI 调用"],
    ["mo-clear", "trash", "清除生成内容", "蓝图 / 正文 / 设定"],
  ];
  openSheet(`
    <h3>${esc(n.name)}</h3>
    <div style="margin-top:6px">
      ${rows.map(([id, ico, name, sub]) => `<button class="chapter-item" id="${id}">
        <span class="t"><span class="name">${svgIcon(ico, 16)} ${name}</span><span class="sub">${sub}</span></span>
        <span style="color:var(--ink-3)">›</span>
      </button>`).join("")}
    </div>`, (sheet) => {
    $("#mo-export", sheet).onclick = () => { closeSheet(); exportSheet(); };
    $("#mo-skills", sheet).onclick = () => { closeSheet(); skillLibrarySheet(); };
    $("#mo-materials", sheet).onclick = () => { closeSheet(); nav({ page: "materials", novelId: n.id }); };
    $("#mo-threads", sheet).onclick = () => { closeSheet(); threadsSheet(); };
    $("#mo-health", sheet).onclick = () => { closeSheet(); healthSheet(); };
    $("#mo-stats", sheet).onclick = () => { closeSheet(); statsSheet(); };
    $("#mo-clear", sheet).onclick = () => { closeSheet(); clearSheet(); };
  });
}

/* ---------- 剧情与伏笔 ---------- */
function threadsSheet(view) {
  const n = State.novel;
  const lastNum = Math.max(0, ...n.chapters.filter(c => c.content).map(c => c.chapterNumber));
  const total = Math.max(n.config.totalChapters || 0, lastNum, 1);
  const dormantOf = t => Math.max(0, lastNum - (t.lastMovedAt || t.plantedAt || 0));
  const list = [...(n.threads || [])].sort((a, b) => dormantOf(b) - dormantOf(a));
  const mode = view || State._threadView || "list";
  State._threadView = mode;
  openSheet(`
    <div class="sheet-head">
      <h3 style="flex:1">${svgIcon("map", 16)} 剧情与伏笔</h3>
      <div class="chip-row" style="margin:0">
        <button class="chip ${mode === "list" ? "active" : ""}" id="th-v-list">列表</button>
        <button class="chip ${mode === "timeline" ? "active" : ""}" id="th-v-time">时间线</button>
      </div>
    </div>
    <p class="tiny">连续 3 章以上未推进的线索会标红，提醒你别把坑挖忘了。</p>
    ${mode === "timeline" ? timelineHtml(n, list, total, lastNum, dormantOf) : `<div style="margin-top:10px">
      ${list.length ? list.map(t => {
        const d = dormantOf(t);
        const overdue = d >= 3 && t.status !== "已收" && t.status !== "已弃";
        return `<div class="card" style="margin-bottom:8px">
          <div class="muted" style="font-size:14px;line-height:1.5">${esc(t.thread)}</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:8px;flex-wrap:wrap">
            <span class="tag ${t.status === "已收" ? "ok" : overdue ? "err" : ""}">${esc(t.status || "已埋")}</span>
            ${overdue ? `<span class="tiny" style="color:var(--err)">${d} 章未动</span>` : ""}
            <span class="tiny">埋 ${t.plantedAt || "?"} · 推 ${t.lastMovedAt || "?"}</span>
            <span class="spacer"></span>
            <button class="btn small" data-tm="${t.id}">推进</button>
            <button class="btn small" data-tc="${t.id}">已收</button>
          </div>
        </div>`;
      }).join("") : `<div class="empty" style="padding:28px 8px">还没有线索<br/>定稿章节后会自动盘点，也可以手动添加</div>`}
    </div>`}
    <button class="btn block" id="th-add" style="margin-top:6px">${svgIcon("plus", 14)} 手动添加线索</button>`, (sheet) => {
    $("#th-v-list", sheet).onclick = () => { closeSheet(); threadsSheet("list"); };
    $("#th-v-time", sheet).onclick = () => { closeSheet(); threadsSheet("timeline"); };
    $$("[data-tm]", sheet).forEach(b => b.onclick = async () => {
      const t = n.threads.find(x => x.id === b.dataset.tm);
      if (t) { t.lastMovedAt = lastNum || 1; await DB.putNovel(n); closeSheet(); threadsSheet(); }
    });
    $$("[data-tc]", sheet).forEach(b => b.onclick = async () => {
      const t = n.threads.find(x => x.id === b.dataset.tc);
      if (t) { t.status = "已收"; await DB.putNovel(n); closeSheet(); threadsSheet(); }
    });
    $("#th-add", sheet).onclick = () => {
      openSheet(`
        <h3>添加线索</h3>
        <label>线索内容</label>
        <input id="th-text" placeholder="例：主角母亲留下的那枚铜钱" />
        <div class="row" style="margin-top:14px"><button class="btn primary block" id="th-save">保存</button></div>`, (s2) => {
        $("#th-save", s2).onclick = async () => {
          const v = $("#th-text", s2)?.value.trim();
          if (!v) { toast("写点什么", true); return; }
          n.threads = n.threads || [];
          n.threads.push({ id: "t" + Math.random().toString(36).slice(2, 7), thread: v, status: "已埋", plantedAt: lastNum || 1, lastMovedAt: lastNum || 1 });
          await DB.putNovel(n);
          closeSheet(); render(); toast("已添加");
        };
      });
    };
  });
}

/* 线索时间线：每条线索横跨章节，圆点标出埋下 / 推进 / 收束的位置 */
function timelineHtml(n, list, total, lastNum, dormantOf) {
  if (!list.length) {
    return `<div class="empty" style="padding:30px 8px">还没有线索<br/>定稿章节后会自动盘点</div>`;
  }
  const cols = Math.min(total, 40);           // 最多画 40 列，再多就按比例压缩
  const step = total / cols;
  const pos = (chNum) => {
    const v = Math.max(1, Math.min(total, chNum || 1));
    return Math.min(99, ((v - 0.5) / cols) * 100);
  };
  const rows = list.slice(0, 18).map(t => {
    const d = dormantOf(t);
    const overdue = d >= 3 && t.status !== "已收" && t.status !== "已弃";
    const planted = t.plantedAt || 1;
    const moved = t.lastMovedAt || planted;
    const done = t.status === "已收";
    const left = pos(Math.min(planted, moved));
    const right = pos(Math.max(planted, moved));
    return `<div class="tl-row">
      <div class="tl-label ${overdue ? "warn" : ""}">
        <span>${esc(t.thread.length > 14 ? t.thread.slice(0, 14) + "…" : t.thread)}</span>
        <i>${done ? "已收" : overdue ? d + " 章未动" : t.status || "已埋"}</i>
      </div>
      <div class="tl-track">
        <div class="tl-bar" style="left:${left}%;width:${Math.max(1.5, right - left)}%"></div>
        <span class="tl-dot plant" style="left:${left}%" title="第${planted}章埋下"></span>
        ${moved !== planted ? `<span class="tl-dot move" style="left:${right}%" title="第${moved}章推进"></span>` : ""}
        ${done ? `<span class="tl-dot done" style="left:100%" title="已收束"></span>` : ""}
      </div>
    </div>`;
  }).join("");
  return `<div class="card" style="margin-top:10px;padding:12px 12px 8px">
    <div class="tl-axis"><span>第1章</span><span>第${Math.round(cols / 2)}章</span><span>第${total}章</span></div>
    ${rows}
    <div class="tl-legend">
      <span><i class="tl-dot plant"></i>埋下</span>
      <span><i class="tl-dot move"></i>推进</span>
      <span><i class="tl-dot done"></i>收束</span>
      <span class="spacer"></span><em>共 ${list.length} 条${list.length > 18 ? "，只画前 18 条" : ""}</em>
    </div>
    <div class="tiny" style="margin-top:8px">横条长度＝这条线索已经挂了多久；越靠右越接近现在。</div>
  </div>`;
}

/* ---------- 写作统计 ---------- */
async function statsSheet() {
  const n = State.novel;
  const s = await DB.kvGet("stats", { calls: 0, chars: 0, byStage: {} });
  const chs = n.chapters.filter(c => c.content);
  const words = chs.reduce((a, c) => a + (c.wordCount || 0), 0);
  const done = n.chapters.filter(c => c.status === "定稿").length;
  const avg = chs.length ? Math.round(words / chs.length) : 0;
  const target = (n.config.wordsPerChapter || 2500);
  const stageName = { planning: "规划", drafting: "写稿", review: "审稿", refinement: "润色修稿", summary: "摘要抽取" };
  const estTokens = Math.round((s.chars || 0) * 0.75);
  openSheet(`
    <h3>${svgIcon("chart", 16)} 写作统计</h3>
    <div class="card" style="margin-top:10px">
      <div class="stat-bar" style="justify-content:space-between"><span>正文字数</span><b>${words.toLocaleString()}</b></div>
      <div class="stat-bar" style="justify-content:space-between;margin-top:8px"><span>已写章节 / 定稿</span><b>${chs.length} / ${done}</b></div>
      <div class="stat-bar" style="justify-content:space-between;margin-top:8px"><span>平均每章</span><b>${avg} 字</b></div>
      <div class="stat-bar" style="justify-content:space-between;margin-top:8px"><span>每章目标</span><b>${target} 字</b></div>
      <div class="progressbar" style="margin-top:10px"><div style="width:${target ? Math.min(100, avg / target * 100) : 0}%"></div></div>
      <div class="tiny" style="margin-top:6px">平均章长达成度 ${target ? Math.round(avg / target * 100) : 0}%</div>
    </div>
    <div class="card">
      <h3 style="font-size:14px">AI 调用</h3>
      <div class="stat-bar" style="justify-content:space-between;margin-top:8px"><span>累计调用</span><b>${s.calls || 0} 次</b></div>
      <div class="stat-bar" style="justify-content:space-between;margin-top:8px"><span>累计输出</span><b>${(s.chars || 0).toLocaleString()} 字符</b></div>
      <div class="stat-bar" style="justify-content:space-between;margin-top:8px"><span>估算输出 tokens</span><b>≈ ${estTokens.toLocaleString()}</b></div>
      ${Object.keys(s.byStage || {}).length ? `<div class="tiny" style="margin-top:8px">${Object.entries(s.byStage).map(([k, v]) => `${stageName[k] || k} ${v} 次`).join(" · ")}</div>` : ""}
      <div class="tiny" style="margin-top:6px">只统计本机产生的调用，不含服务商账单口径。</div>
    </div>
    <button class="btn block" id="st-close">关闭</button>`, (sheet) => {
    $("#st-close", sheet).onclick = closeSheet;
  });
}

/* ---------- 清除生成内容 ---------- */
function clearSheet() {
  const n = State.novel;
  const pending = n.chapters.filter(c => c.content && c.status !== "定稿");
  const rows = [
    ["cl-bp", "章节蓝图", `${n.blueprints.length} 条`, n.blueprints.length],
    ["cl-draft", "未定稿正文", `${pending.length} 章`, pending.length],
    ["cl-setup", "AI 生成的设定与架构", "设定/角色/大纲", (n.premise || n.synopsis || n.characters.length) ? 1 : 0],
  ];
  openSheet(`
    <h3>清除生成内容</h3>
    <p class="tiny">定稿正文不会被清除，避免误删。清除后无法恢复，请先导出备份。</p>
    <div style="margin-top:10px">
      ${rows.map(([id, name, sub, count]) => `<div class="card" style="margin-bottom:8px;display:flex;align-items:center;gap:10px">
        <div style="flex:1"><div style="font-weight:600">${name}</div><div class="tiny">${sub}</div></div>
        <button class="btn small danger" id="${id}" ${count ? "" : "disabled"}>清除</button>
      </div>`).join("")}
    </div>`, (sheet) => {
    const run = (fn, label) => confirmSheet(`清除${label}？`, "操作不可撤销。建议先「导出全部数据」备份。", async () => {
      fn(); await DB.putNovel(n); render(); toast(`已清除${label}`);
    }, "清除");
    $("#cl-bp", sheet).onclick = () => run(() => { n.blueprints = []; }, "章节蓝图");
    $("#cl-draft", sheet).onclick = () => run(() => { n.chapters = n.chapters.filter(c => !(c.content && c.status !== "定稿")); }, "未定稿正文");
    $("#cl-setup", sheet).onclick = () => run(() => { n.characters = []; n.premise = ""; n.worldbuilding = ""; n.synopsis = ""; }, "设定与架构");
  });
}

/* ================= 设置页 ================= */
function viewSettings() {
  const s = State.settings;
  const models = s.models.length ? s.models.map(m => `
    <button class="chapter-item" data-model="${m.id}">
      <span class="t">
        <span class="name">${esc(m.name || m.modelName)} ${s.defaultModelId === m.id ? '<span class="tag accent">默认</span>' : ""}</span>
        <span class="sub">${esc(m.protocol === "gemini" ? "Gemini" : "OpenAI 兼容")} · ${esc(m.modelName)}</span>
      </span>
      <span>›</span>
    </button>`).join("") : `<div class="tiny" style="padding:8px 0">还没有模型。添加一个（填自己的 API Key，仅保存在本机）。</div>`;
  const stages = Object.entries(STAGE_NAMES).map(([k, name]) => `
    <label>${name}</label>
    <select data-stage="${k}">
      <option value="">跟随默认模型</option>
      ${s.models.map(m => `<option value="${m.id}" ${s.stageModels?.[k] === m.id ? "selected" : ""}>${esc(m.name || m.modelName)}</option>`).join("")}
    </select>`).join("");
  return `
    ${topbar("设置", { back: true })}
    <div class="page">
      <div class="card">
        <h3>模型 <span class="spacer"></span><button class="btn small primary" id="st-add">${svgIcon("plus", 14)} 添加</button></h3>
        ${models}
      </div>
      ${s.models.length ? `<div class="card"><h3>分阶段模型</h3>${stages}</div>` : ""}
      <div class="card">
        <h3>外观</h3>
        <div class="chip-row" id="st-theme">
          ${[["auto", "跟随系统"], ["light", "浅色"], ["dark", "深色"]].map(([k, v]) =>
            `<button class="chip ${s.theme === k ? "active" : ""}" data-v="${k}">${v}</button>`).join("")}
        </div>
        <label>正文字号 <span class="spacer"></span><b id="st-fs-val" class="tiny" style="font-weight:600">${State.appearance.fontSize}px</b></label>
        <input type="range" id="st-fs" min="14" max="24" step="0.5" value="${State.appearance.fontSize}" style="padding:0" />
        <label>行距 <span class="spacer"></span><b id="st-lh-val" class="tiny" style="font-weight:600">${State.appearance.lineHeight}</b></label>
        <input type="range" id="st-lh" min="1.4" max="2.6" step="0.05" value="${State.appearance.lineHeight}" style="padding:0" />
        <label>正文字体</label>
        <div class="chip-row" id="st-font">
          ${[["serif", "宋体"], ["sans", "黑体"], ["kai", "楷体"], ["song", "思源宋"]].map(([k, v]) =>
            `<button class="chip ${(State.appearance.font || "serif") === k ? "active" : ""}" data-v="${k}">${v}</button>`).join("")}
        </div>
        <label style="display:flex;align-items:center;gap:9px;margin-top:12px">
          <input type="checkbox" id="st-autonext" ${State.appearance.autoNext ? "checked" : ""} style="width:auto" />
          定稿后自动打开下一章
        </label>
        <div class="preview-paper" id="st-preview">纸上一盏灯，笔下一座城。<br/>调好的字号行距会立刻应用到这里和正文编辑器。</div>
      </div>
      <div class="card">
        <h3>AI 模式</h3>
        <p class="tiny">一键决定 AI 是「替你写」还是「只帮你看」。开关同时出现在书房、作品页和正文页的顶栏。</p>
        <div class="chip-row" id="st-aimode" style="margin-top:9px">
          <button class="chip ${isAssistMode() ? "" : "active"}" data-v="auto">AI 创作</button>
          <button class="chip ${isAssistMode() ? "active" : ""}" data-v="assist">AI 辅助</button>
        </div>
        <p class="tiny" id="st-aimode-hint" style="margin-top:8px">${isAssistMode()
          ? "当前：只能查不能写 —— 拆书、查漏洞、审稿、润色、抽取设定都可用；起稿、续写、批量创作已关闭。"
          : "当前：AI 可以起稿、续写、批量创作，也可以做审稿和检查。"}</p>
      </div>
      <div class="card">
        <h3>写作仪表</h3>
        <p class="tiny">正文页右上角的悬浮窗：实时码字速度、本次写作与摸鱼时长、今日进度。手写与 AI 生成的字分开记账（AI 的字不算进你的速度）。</p>
        <label style="display:flex;align-items:center;gap:9px;margin-top:11px">
          <input type="checkbox" id="st-hud" ${State.settings.hud === false ? "" : "checked"} style="width:auto" />
          显示码字悬浮窗
        </label>
        <label>每日字数目标</label>
        <input type="number" id="st-goal" min="200" max="50000" step="100" value="${window.HUD ? HUD.getGoal() : 3000}" />
        <div class="stat-bar" id="st-hud-today" style="margin-top:10px;justify-content:space-between"></div>
        <div class="row" style="margin-top:10px">
          <button class="btn" id="st-hud-open">预览悬浮窗</button>
          <button class="btn" id="st-hud-reset">清空今日统计</button>
        </div>
      </div>
      <div class="card">
        <h3>技能库</h3>
        <p class="tiny">审查与纠错的插件组：逻辑硬伤、设定连续性、节奏、伏笔呼应、错字病句、AI 味……共 ${window.Skills ? Skills.all().length : 0} 个。可启停、可改检查重点、也可自建。</p>
        <button class="btn block" id="st-skills" style="margin-top:8px">打开技能库</button>
      </div>
      <div class="card">
        <h3>章纲罗盘</h3>
        <p class="tiny">正文页右上角的第二个悬浮窗：本章目的、可勾选的节拍、要埋的伏笔、该收的旧线索、张力。默认开启，可在这里关掉。</p>
        <label style="display:flex;align-items:center;gap:9px;margin-top:11px">
          <input type="checkbox" id="st-compass" ${window.Compass && Compass.isHidden() ? "" : "checked"} style="width:auto" />
          显示章纲罗盘
        </label>
      </div>
      <div class="card">
        <h3>提示词模板</h3>
        <p class="tiny">写正文、审稿、修稿、拆书等 ${promptList().length} 个模板都能改。改完立即生效，可一键恢复内置版本。</p>
        <button class="btn block" id="st-prompts" style="margin-top:8px">编辑提示词模板</button>
      </div>
      <div class="card">
        <h3>资料库</h3>
        <p class="tiny">参考资料（世界观笔记、人物小传、地名志）会按本章蓝图检索，把最相关的几段注入提示词。写作用不到资料时留空即可。</p>
        <div class="stat-bar" id="st-mat-stat" style="justify-content:space-between;margin-top:8px"></div>
        <div class="row" style="margin-top:8px">
          <button class="btn" id="st-mat">管理资料</button>
          <button class="btn" id="st-health">数据体检</button>
        </div>
      </div>
      <div class="card">
        <h3>关于</h3>
        <div class="stat-bar" style="justify-content:space-between"><span>书童移动版</span><b>${APP_VERSION}</b></div>
        <div class="stat-bar" style="justify-content:space-between;margin-top:8px"><span>存储方式</span><b id="st-storage">检测中…</b></div>
        <div class="stat-bar" style="justify-content:space-between;margin-top:8px"><span>本机作品</span><b id="st-novel-count">—</b></div>
        <p class="tiny" style="margin-top:10px">复刻自开源项目 Pagekin（GPL-3.0）。模型调用由你配置的服务商直接提供，App 不中转、不收集任何内容。</p>
      </div>
      <div class="card">
        <h3>数据</h3>
        <p class="tiny">所有作品仅保存在本机浏览器中。清除浏览器数据会丢失作品，请定期备份。</p>
        <div class="row" style="margin-top:8px">
          <button class="btn" id="st-backup">导出全部数据</button>
          <button class="btn" id="st-restore">导入备份</button>
        </div>
        <input type="file" id="st-file" accept=".json" style="display:none" />
      </div>
      <p class="tiny" style="text-align:center;margin-top:16px">书童移动版 · 复刻自开源项目 Pagekin (GPL-3.0)<br/>模型调用由你配置的服务商直接提供</p>
    </div>`;
}

function bindSettings() {
  $("#btn-back").onclick = () => {
    if (State.depth > 0) { history.back(); return; }
    if (State.novel) openNovel(State.novel.id); else nav({ page: "shelf" }, { replace: true });
  };
  $("#st-add").onclick = () => modelSheet(null);
  $$("[data-model]").forEach(b => b.onclick = () => modelSheet(State.settings.models.find(m => m.id === b.dataset.model)));
  $$("#st-theme .chip").forEach(chip => chip.onclick = () => {
    State.settings.theme = chip.dataset.v;
    DB.kvSet("settings", State.settings);
    render();
  });
  /* ---- 外观：拖动即时预览，松手落盘 ---- */
  const saveAppearance = () => DB.kvSet("appearance", State.appearance);
  $("#st-fs").oninput = (e) => {
    State.appearance.fontSize = parseFloat(e.target.value);
    $("#st-fs-val").textContent = State.appearance.fontSize + "px";
    applyAppearance();
  };
  $("#st-fs").onchange = saveAppearance;
  $("#st-lh").oninput = (e) => {
    State.appearance.lineHeight = parseFloat(e.target.value);
    $("#st-lh-val").textContent = State.appearance.lineHeight;
    applyAppearance();
  };
  $("#st-lh").onchange = saveAppearance;
  $$("#st-font .chip").forEach(chip => chip.onclick = () => {
    State.appearance.font = chip.dataset.v;
    $$("#st-font .chip").forEach(x => x.classList.remove("active"));
    chip.classList.add("active");
    applyAppearance(); saveAppearance();
  });
  $("#st-autonext").onchange = (e) => {
    State.appearance.autoNext = e.target.checked;
    saveAppearance();
    toast(e.target.checked ? "定稿后会自动翻到下一章" : "已关闭自动下一章");
  };
  $("#st-prompts").onclick = () => promptSheet();
  $("#st-mat").onclick = () => {
    if (!State.novel) { toast("先在书房打开一本书", true); return; }
    nav({ page: "materials", novelId: State.novel.id });
  };
  $("#st-health").onclick = () => {
    if (!State.novel) { toast("先在书房打开一本书", true); return; }
    healthSheet();
  };
  /* 关于：存储模式与作品数 */
  (async () => {
    const modeEl = $("#st-storage");
    if (modeEl) {
      const m = await DB.detect();
      modeEl.textContent = m === "idb" ? "IndexedDB" : "localStorage（降级）";
    }
    const cntEl = $("#st-novel-count");
    if (cntEl) {
      const all = await DB.listNovels();
      cntEl.textContent = all.filter(x => x.kind !== "reference").length + " 本";
    }
    const statEl = $("#st-mat-stat");
    if (statEl) {
      if (!State.novel) statEl.innerHTML = `<span class="tiny">先打开一本书，再看它的资料</span>`;
      else {
        const st = window.Materials ? Materials.stats(State.novel) : { count: 0, enabled: 0, chars: 0, chunks: 0 };
        statEl.innerHTML = `<span>${st.count} 份 · ${st.enabled} 启用</span><b>${st.chars > 10000 ? (st.chars / 10000).toFixed(1) + " 万字" : st.chars + " 字"}</b>`;
      }
    }
  })();

  /* ---- 技能库 ---- */
  const stSkills = $("#st-skills");
  if (stSkills) stSkills.onclick = () => {
    if (!State.novel) { toast("先打开一部作品，再到正文页使用技能库", true); return; }
    skillLibrarySheet(State.route.chNum || 1);
  };
  const stCompass = $("#st-compass");
  if (stCompass) stCompass.onchange = (e) => {
    if (!window.Compass) return;
    if (e.target.checked) { toast("已开启，回到正文页即可看到"); localStorage.removeItem("wb.compass.hide"); }
    else { Compass.hide(); toast("已隐藏章纲罗盘"); }
  };

  /* ---- AI 模式 ---- */
  $$("#st-aimode .chip").forEach(chip => chip.onclick = () => {
    if (chip.dataset.v === (isAssistMode() ? "assist" : "auto")) return;
    toggleMode();
  });

  /* ---- 写作仪表 ---- */
  if (window.HUD) {
    const s = HUD.summary();
    const dur = (ms) => {
      const sec = Math.round(ms / 1000), m = Math.floor(sec / 60), h = Math.floor(m / 60);
      if (h) return `${h}h${m % 60}m`;
      if (m) return `${m}m`;
      return `${sec}s`;
    };
    const box = $("#st-hud-today");
    if (box) box.innerHTML = `<span>今日手写 <b>${s.hand.toLocaleString()}</b></span><span>AI <b>${s.ai.toLocaleString()}</b></span><span>写作 <b>${dur(s.activeMs)}</b> · 摸鱼 <b>${dur(s.idleMs)}</b></span>`;
  }
  $("#st-hud").onchange = (e) => {
    State.settings.hud = e.target.checked;
    DB.kvSet("settings", State.settings);
    if (window.HUD) HUD.setEnabled(e.target.checked);
    toast(e.target.checked ? "悬浮窗已打开，进正文页就能看到" : "已关闭悬浮窗");
  };
  $("#st-goal").onchange = (e) => {
    if (window.HUD) { HUD.setGoal(e.target.value); toast(`每日目标：${HUD.getGoal()} 字`); }
  };
  $("#st-hud-open").onclick = () => {
    if (!window.HUD) return;
    State.settings.hud = true;
    DB.kvSet("settings", State.settings);
    HUD.setEnabled(true);
    HUD.open();
    toast("这就是正文页右上角的那个小窗，可以直接拖动");
  };
  $("#st-hud-reset").onclick = () => {
    confirmSheet("清空今日统计？", "只清今天的手写 / AI 字数与时长，历史日期不动。", () => {
      if (window.HUD) HUD.resetToday();
      render();
      toast("今日统计已清零");
    }, "清空");
  };
  $$("[data-stage]").forEach(sel => sel.onchange = () => {
    State.settings.stageModels = State.settings.stageModels || {};
    State.settings.stageModels[sel.dataset.stage] = sel.value || null;
    DB.kvSet("settings", State.settings);
    toast("已保存");
  });
  $("#st-backup").onclick = async () => {
    const novels = await DB.listNovels();
    const blob = new Blob([JSON.stringify({ exportedAt: Date.now(), settings: { ...State.settings, models: State.settings.models }, novels }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `shutong-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  $("#st-restore").onclick = () => $("#st-file").click();
  $("#st-file").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.novels)) throw new Error("备份格式不正确");
      for (const novel of data.novels) await DB.putNovel(novel);
      toast(`已导入 ${data.novels.length} 部作品`);
      if (State.route.page === "settings") render();
    } catch (err) { toast(err.message, true); }
  };
}

function modelSheet(m) {
  const isNew = !m;
  const c = m || { id: "m" + Date.now().toString(36), name: "", protocol: "openai", provider: "custom", baseUrl: "", modelName: "", apiKey: "", temperature: 0.8, maxTokens: 0 };
  openSheet(`
    <h3>${isNew ? "添加模型" : "编辑模型"}</h3>
    <label>服务商预设（点击自动填充）</label>
    <div class="chip-row" id="ms-presets">${PROVIDER_PRESETS.map(p =>
      `<button class="chip ${c.provider === p.id ? "active" : ""}" data-p="${p.id}">${esc(p.name)}</button>`).join("")}</div>
    <label>备注名</label><input id="ms-name" value="${esc(c.name || "")}" placeholder="例如：DeepSeek 主力" />
    <label>协议</label>
    <div class="chip-row" id="ms-proto">
      <button class="chip ${c.protocol === "openai" ? "active" : ""}" data-v="openai">OpenAI 兼容</button>
      <button class="chip ${c.protocol === "gemini" ? "active" : ""}" data-v="gemini">Gemini 原生</button>
    </div>
    <label>Base URL</label><input id="ms-url" value="${esc(c.baseUrl || "")}" placeholder="https://api.deepseek.com" />
    <label>模型名</label><input id="ms-model" value="${esc(c.modelName || "")}" placeholder="deepseek-chat" />
    <label>API Key（仅保存在本机）</label><input id="ms-key" type="password" value="${esc(c.apiKey || "")}" />
    <div class="row">
      <div><label>Temperature</label><input id="ms-temp" type="number" step="0.1" min="0" max="2" value="${esc(c.temperature)}" /></div>
      <div><label>Max Tokens（0 不限）</label><input id="ms-maxtok" type="number" step="256" min="0" value="${esc(c.maxTokens || 0)}" /></div>
    </div>
    <div class="row" style="margin-top:14px">
      <button class="btn" id="ms-test">测试连接</button>
      ${isNew ? "" : `<button class="btn" id="ms-default">设为默认</button>`}
      ${isNew ? "" : `<button class="btn danger" id="ms-del">删除</button>`}
      <button class="btn primary" id="ms-save">保存</button>
    </div>`, (sheet) => {
    let protocol = c.protocol, provider = c.provider;
    /* 去掉复制 Key 时常见的全角空格/零宽字符/换行 */
    const clean = (v) => String(v || "").replace(/[\u00A0\u2000-\u200D\u2028\u2029\u3000\uFEFF\r\n\t]/g, "").trim();
    const readForm = () => ({
      ...c,
      name: $("#ms-name", sheet).value.trim() || $("#ms-model", sheet).value.trim() || "未命名模型",
      protocol, provider,
      baseUrl: clean($("#ms-url", sheet).value),
      modelName: clean($("#ms-model", sheet).value),
      apiKey: clean($("#ms-key", sheet).value),
      temperature: parseFloat($("#ms-temp", sheet).value) || 0.8,
      maxTokens: parseInt($("#ms-maxtok", sheet).value) || 0,
    });
    /* 校验：定位到具体字段，避免只抛底层报错 */
    const validate = (data) => {
      if (!data.modelName) return "先填模型名（如 deepseek-chat）";
      if (/[^\x20-\x7E]/.test(data.apiKey)) return "API Key 里有中文或全角符号，请清空后重新粘贴";
      if (/[^\x20-\x7E]/.test(data.baseUrl)) return "Base URL 里有中文或全角符号，请检查";
      if (/[^\x20-\x7E]/.test(data.modelName)) return "模型名里有中文或全角符号，请检查";
      if (/[-_.]$/.test(data.modelName)) return "模型名好像没写完（DeepSeek 是 deepseek-chat 或 deepseek-reasoner）";
      if (!data.apiKey) return "还没填 API Key";
      return "";
    };
    $$("#ms-presets .chip", sheet).forEach(chip => chip.onclick = () => {
      const p = PROVIDER_PRESETS.find(x => x.id === chip.dataset.p);
      provider = p.id; protocol = p.protocol;
      $("#ms-url", sheet).value = p.baseUrl || "";
      $("#ms-model", sheet).value = p.modelName || "";
      $("#ms-key", sheet).placeholder = p.keyHint || "";
      $$("#ms-presets .chip", sheet).forEach(x => x.classList.remove("active"));
      chip.classList.add("active");
      syncProtoChips();
    });
    function syncProtoChips() {
      $$("#ms-proto .chip", sheet).forEach(x => x.classList.toggle("active", x.dataset.v === protocol));
    }
    $$("#ms-proto .chip", sheet).forEach(chip => chip.onclick = () => { protocol = chip.dataset.v; syncProtoChips(); });

    $("#ms-test", sheet).onclick = async () => {
      const test = readForm();
      const err = validate(test);
      if (err) { toast(err, true); return; }
      $("#ms-test", sheet).textContent = "测试中…";
      try {
        const out = await LLM.streamChat(test, [
          { role: "system", content: "你是连通性测试器。" },
          { role: "user", content: "只回复两个字：正常" },
        ], {});
        $("#ms-test", sheet).textContent = "✓ 连通";
        toast("连接正常：" + out.slice(0, 20));
      } catch (e) {
        $("#ms-test", sheet).textContent = "测试连接";
        toast(e.message, true);
      }
    };
    $("#ms-save", sheet).onclick = async () => {
      const data = readForm();
      if (!data.modelName) { toast("模型名必填", true); return; }
      const bad = validate(data);
      if (bad && bad !== "还没填 API Key") { toast(bad, true); return; }
      const idx = State.settings.models.findIndex(x => x.id === data.id);
      if (idx >= 0) State.settings.models[idx] = data;
      else State.settings.models.push(data);
      if (!State.settings.defaultModelId) State.settings.defaultModelId = data.id;
      await DB.kvSet("settings", State.settings);
      closeSheet(); render(); toast("已保存");
    };
    if (!isNew) {
      $("#ms-default", sheet).onclick = async () => {
        State.settings.defaultModelId = c.id;
        await DB.kvSet("settings", State.settings);
        closeSheet(); render(); toast("已设为默认模型");
      };
      $("#ms-del", sheet).onclick = () => {
        State.settings.models = State.settings.models.filter(x => x.id !== c.id);
        if (State.settings.defaultModelId === c.id) State.settings.defaultModelId = State.settings.models[0]?.id || "";
        DB.kvSet("settings", State.settings).then(() => { closeSheet(); render(); });
      };
    }
  });
}

/* ================= 修稿逐段合并 =================
 * 桌面版 merge-segments 的移动实现：段落对齐后逐处选择「原稿 / 修稿 / 手改」，
 * 最后按顺序拼回全文。改稿不再是「整章接受或整章放弃」。
 */
function mergeSheet(num, original, revised) {
  const n = State.novel;
  const c = getChapter(n, num);
  const segments = Merge.computeSegments(original, revised);
  const half = Merge.hunkCount(segments);
  if (!half) { toast("两稿没有实质差异", true); return; }

  const texts = {};
  const picks = {};
  segments.forEach((s, i) => {
    if (s.type === "same") texts[i] = (s.lines || []).join("\n");
    else { texts[i] = s.hunk.originalLines.join("\n"); picks[s.hunk.index] = "original"; }
  });

  const inner = segments.map((s, i) => {
    if (s.type === "same") return `<div class="mg-same">${esc((s.lines || []).join("\n")) || "&nbsp;"}</div>`;
    const h = s.hunk;
    return `<div class="mg-hunk" data-i="${i}" data-h="${h.index}">
      <div class="mg-choice original active" data-pick="original">
        <span class="mg-tag">原稿</span>
        <div class="mg-text">${h.originalLines.length ? esc(h.originalLines.join("\n")) : '<i class="tiny">（修稿新加的一段）</i>'}</div>
      </div>
      <div class="mg-choice revised" data-pick="revised">
        <span class="mg-tag">修稿</span>
        <div class="mg-text">${h.modifiedLines.length ? esc(h.modifiedLines.join("\n")) : '<i class="tiny">（修稿删掉了这段）</i>'}</div>
      </div>
      <button class="btn small mg-edit" data-edit="${h.index}">${svgIcon("pen", 12)} 手改</button>
    </div>`;
  }).join("");

  openSheet(`
    <div class="sheet-head">
      <h3 style="margin:0">逐段合并 <span class="tag accent">${half} 处改动</span></h3>
      <span class="spacer"></span>
      <button class="btn small" id="mg-all-orig">全用原稿</button>
      <button class="btn small" id="mg-all-rev">全用修稿</button>
    </div>
    <p class="tiny">点一段选一版；拿不准就点「手改」自己写。合并后写入本章草稿，原稿会进历史。</p>
    <div class="mg-list" id="mg-list">${inner}</div>
    <button class="btn primary block" id="mg-apply" style="margin-top:12px">合并并应用</button>`, (sheet) => {
    const list = $("#mg-list", sheet);
    const setPick = (hunkEl, pick, customText) => {
      const i = parseInt(hunkEl.dataset.i);
      const hIndex = parseInt(hunkEl.dataset.h);
      picks[hIndex] = pick;
      $$(".mg-choice", hunkEl).forEach(el => el.classList.toggle("active", el.dataset.pick === pick));
      const h = segments[i].hunk;
      texts[i] = customText !== undefined ? customText
        : (pick === "revised" ? h.modifiedLines.join("\n") : h.originalLines.join("\n"));
    };
    $$(".mg-scroll, .mg-list", sheet);
    list.addEventListener("click", (e) => {
      const choice = e.target.closest(".mg-choice");
      if (choice) {
        const hunkEl = choice.closest(".mg-hunk");
        setPick(hunkEl, choice.dataset.pick);
        return;
      }
      const editBtn = e.target.closest("[data-edit]");
      if (editBtn) {
        const hunkEl = editBtn.closest(".mg-hunk");
        const i = parseInt(hunkEl.dataset.i);
        const active = $(".mg-choice.active .mg-text", hunkEl);
        if (!active || active.dataset.editing) return;
        active.dataset.editing = "1";
        const ta = document.createElement("textarea");
        ta.className = "mg-textarea";
        ta.rows = 4;
        ta.value = texts[i] || "";
        active.innerHTML = "";
        active.appendChild(ta);
        ta.focus();
        ta.addEventListener("input", () => setPick(hunkEl, "edit", ta.value));
      }
    });
    $("#mg-all-orig", sheet).onclick = () => {
      $$(".mg-hunk", sheet).forEach(el => setPick(el, "original"));
      toast("全部用原稿");
    };
    $("#mg-all-rev", sheet).onclick = () => {
      $$(".mg-hunk", sheet).forEach(el => setPick(el, "revised"));
      toast("全部用修稿");
    };
    $("#mg-apply", sheet).onclick = async () => {
      const merged = Merge.joinSegments(segments, texts);
      pushVersion(c, "合并前备份");
      c.content = merged;
      c.wordCount = countWords(merged);
      c.status = "草稿";
      c.updatedAt = Date.now();
      await DB.putNovel(n);
      closeSheet(); render();
      const kept = Object.values(picks).filter(p => p !== "revised").length;
      toast(`已合并：保留原稿 ${kept} 处 · 采用修稿 ${half - kept} 处`);
    };
  });
}

/* ================= 版本逐字对比 ================= */
function diffSheet(num, a, b, labelA, labelB) {
  const paras = TextDiff.diffParagraphs(a, b);
  const changeCount = paras.filter(p => p.kind === "change").length;
  if (!changeCount) { toast("两版内容一致", true); return; }
  let added = 0, removed = 0;
  const html = paras.map(p => {
    if (p.kind === "same") {
      const t = p.original || "";
      if (!t.trim()) return "";
      if (t.length > 80) return `<div class="df-same-fold">… 未改动 ${t.length} 字 …</div>`;
      return `<div class="df-same">${esc(t)}</div>`;
    }
    const ops = (p.ops || []).map(o => o.type === "eq" ? esc(o.text)
      : o.type === "del" ? `<del>${esc(o.text)}</del>`
        : `<ins>${esc(o.text)}</ins>`).join("");
    const st = TextDiff.stat(p.ops || []);
    added += st.added; removed += st.removed;
    return `<div class="df-change">${ops}</div>`;
  }).join("");
  openSheet(`
    <h3>逐字对比</h3>
    <div class="df-head">
      <span class="tiny">${esc(labelA)}</span>
      <span class="tiny">→</span>
      <span class="tiny">${esc(labelB)}</span>
      <span class="spacer"></span>
      <span class="tag err">−${removed}</span>
      <span class="tag ok">+${added}</span>
    </div>
    <div class="df-body">${html}</div>
    <button class="btn block" id="df-close" style="margin-top:12px">关闭</button>`, (sheet) => {
    $("#df-close", sheet).onclick = closeSheet;
  });
}

/* ================= 角色关系图谱 ================= */
function graphEdges(n) {
  return Graph.mergeEdges(Graph.parseRelations(n.characters || []), n.relations || []);
}

function graphSheet() {
  const n = State.novel;
  if (!(n.characters || []).length) { toast("先在角色页建立角色档案", true); return; }
  let activeId = null;

  openSheet(`
    <div class="sheet-head">
      <h3 style="margin:0">关系图谱</h3>
      <span class="spacer"></span>
      <button class="btn small" id="gp-ai">${svgIcon("spark", 13)} AI 补全关系</button>
    </div>
    <div id="gp-canvas"></div>
    <div class="gp-legend" id="gp-legend"></div>
    <div id="gp-detail" class="tiny" style="margin-top:6px">点一个角色，只看跟他有关的关系。</div>
    <div class="row" style="margin-top:10px">
      <button class="btn" id="gp-reset">看全部</button>
      <button class="btn" id="gp-close">关闭</button>
    </div>`, (sheet) => {
    const KIND_LABEL = { kin: "血缘", love: "情感", master: "师承", enemy: "敌对", ally: "同盟", serve: "从属", other: "其它" };
    const paint = () => {
      const edges = graphEdges(n);
      $("#gp-canvas", sheet).innerHTML = Graph.svg(n.characters, edges, activeId, 340);
      const order = ["kin", "love", "master", "enemy", "ally", "serve", "other"];
      const kinds = order.filter(k => edges.some(e => e.kind === k));
      $("#gp-legend", sheet).innerHTML = kinds.length
        ? kinds.map(k => `<span class="gp-lg"><i style="background:${Graph.KIND_COLOR[k] || "#968e7f"}"></i>${KIND_LABEL[k] || "其它"}</span>`).join("")
          + `<span class="tiny" style="margin-left:auto">${n.characters.length} 人 · ${edges.length} 条关系</span>`
        : `<span class="tiny">还没有关系数据，点「AI 补全关系」从档案里抽取</span>`;
      if (activeId) {
        const me = n.characters.find(c => (c.id || c.name) === activeId);
        const mine = edges.filter(e => e.a === activeId || e.b === activeId);
        $("#gp-detail", sheet).innerHTML = `<b>${esc(me ? me.name : "")}</b> · ${mine.length} 条关系<br/>` +
          (mine.map(e => {
            const otherId = e.a === activeId ? e.b : e.a;
            const other = n.characters.find(c => (c.id || c.name) === otherId);
            return `<span class="gp-rel"><i style="background:${Graph.KIND_COLOR[e.kind] || "#968e7f"}"></i>${esc(other ? other.name : otherId)}：${esc(e.relation)}</span>`;
          }).join("") || "暂无记录");
      }
      $$("#gp-canvas .g-node", sheet).forEach(g => g.onclick = () => {
        const id = g.dataset.node;
        activeId = activeId === id ? null : id;
        if (!activeId) $("#gp-detail", sheet).innerHTML = "点一个角色，只看跟他有关的关系。";
        paint();
      });
    };
    paint();
    $("#gp-reset", sheet).onclick = () => { activeId = null; $("#gp-detail", sheet).innerHTML = "点一个角色，只看跟他有关的关系。"; paint(); };
    $("#gp-close", sheet).onclick = closeSheet;

    $("#gp-ai", sheet).onclick = async () => {
      if (!ensureModel("planning")) return;
      const tpl = T.extract_relations;
      const msgs = [{ role: "system", content: tpl.system }, { role: "user", content: renderPrompt(tpl, {
        characters: serializeCharacters(n.characters),
      }) }];
      try {
        const out = await runAI("抽取角色关系", "planning", msgs);
        const arr = LLM.extractJSON(out);
        const items = Array.isArray(arr) ? arr : (arr && Array.isArray(arr.relations) ? arr.relations : []);
        const edges = [];
        for (const it of items) {
          if (!it || !it.a || !it.b) continue;
          const ia = Graph.resolve(it.a, n.characters);
          const ib = Graph.resolve(it.b, n.characters);
          if (!ia || !ib || ia === ib) continue;
          edges.push({
            a: ia, b: ib,
            relation: String(it.relation || "相关").slice(0, 24),
            kind: ["kin", "love", "master", "enemy", "ally", "serve", "other"].includes(it.kind) ? it.kind : Graph.kindOf(String(it.relation || "")),
            note: String(it.note || "").slice(0, 60),
            source: "ai",
          });
        }
        if (!edges.length) { toast("没有抽到有效关系，先把角色档案写具体些", true); return; }
        n.relations = edges;
        await DB.putNovel(n);
        activeId = null;
        paint();
        toast(`已补全 ${edges.length} 条关系`);
      } catch (e) { toast(e.message, true); }
    };
  });
}

/* ================= 提示词模板编辑 ================= */
async function promptSheet() {
  const overrides = await DB.kvGet("promptOverrides", {});
  const list = promptList();
  const groups = {};
  for (const p of list) (groups[p.group] = groups[p.group] || []).push(p);
  const edited = list.filter(p => p.edited).length;
  openSheet(`
    <div class="sheet-head">
      <h3 style="margin:0">提示词模板</h3>
      <span class="spacer"></span>
      <span class="tag ${edited ? "accent" : ""}">${edited} 个已改</span>
    </div>
    <p class="tiny">模板决定 AI 怎么理解任务。改坏了可以单独恢复。<code>{{变量}}</code> 是运行时替换的占位符，别删。</p>
    <div class="sheet-scroll">
      ${Object.entries(groups).map(([g, items]) => `
        <div class="section-label">${esc(g)}</div>
        ${items.map(p => `<button class="chapter-item" data-p="${p.key}">
          <span class="t"><span class="name">${esc(p.name)}${p.edited ? ' <span class="tag accent">已改</span>' : ""}</span>
          <span class="sub">${esc(p.task.replace(/\s+/g, " ").slice(0, 40))}…</span></span>
          <span style="color:var(--ink-3)">›</span>
        </button>`).join("")}`).join("")}
    </div>
    <button class="btn block" id="pt-close" style="margin-top:10px">关闭</button>`, (sheet) => {
    $("#pt-close", sheet).onclick = closeSheet;
    $$("[data-p]", sheet).forEach(btn => btn.onclick = () => {
      const key = btn.dataset.p;
      const p = promptList().find(x => x.key === key);
      openSheet(`
        <h3>${esc(p.name)}</h3>
        <p class="tiny">可用变量：${(T[key].vars || []).map(v => "{{" + v + "}}").join(" ") || "（无）"}</p>
        <textarea id="pt-text" class="prompt-edit">${esc(p.task)}</textarea>
        <div class="row" style="margin-top:10px">
          <button class="btn" id="pt-reset">恢复内置</button>
          <button class="btn primary" id="pt-save">保存</button>
        </div>`, (s2) => {
        $("#pt-save", s2).onclick = async () => {
          const v = $("#pt-text", s2).value;
          if (!v.trim()) { toast("内容不能为空", true); return; }
          T[key].task = v;
          const map = await DB.kvGet("promptOverrides", {});
          map[key] = v;
          await DB.kvSet("promptOverrides", map);
          closeSheet(); toast("已保存，下次生成即生效");
        };
        $("#pt-reset", s2).onclick = async () => {
          resetPrompt(key);
          const map = await DB.kvGet("promptOverrides", {});
          delete map[key];
          await DB.kvSet("promptOverrides", map);
          closeSheet(); toast("已恢复内置模板");
        };
      });
    });
  });
}

/* ================= 命令面板（全局搜索） ================= */
/* 全书搜索：作品、章节正文、角色、线索、资料库。返回分组结果，供命令面板渲染。 */
async function searchAll(q) {
  const novels = await DB.listNovels();
  const ql = q.toLowerCase();
  const hit = (s) => String(s || "").toLowerCase().includes(ql);
  const groups = [];

  const novelHits = [], chapterHits = [];
  for (const n of novels) {
    if (n.kind === "reference") continue;
    if (hit(n.name) || hit(n.config && n.config.coreOutline)) {
      novelHits.push({ novelId: n.id, title: n.name, sub: "作品 · " + ((n.chapters || []).length + " 章") });
    }
    for (const c of n.chapters || []) {
      const idx = (c.content || "").toLowerCase().indexOf(ql);
      if (hit(c.title) || idx >= 0) {
        const from = Math.max(0, idx - 24);
        const snippet = idx >= 0
          ? (c.content.slice(from, idx + 44).replace(/\n/g, " ") + "…")
          : (c.summary || c.status || "标题命中");
        chapterHits.push({ novelId: n.id, chNum: c.chapterNumber, title: `${n.name} · 第${c.chapterNumber}章 ${c.title || ""}`, sub: snippet });
      }
    }
  }
  if (novelHits.length) groups.push({ label: "作品", icon: "book", items: novelHits.slice(0, 6) });
  if (chapterHits.length) groups.push({ label: "章节", icon: "doc", items: chapterHits.slice(0, 18) });

  /* 当前作品内的角色、线索、资料 */
  const cur = State.novel;
  if (cur) {
    const chars = (cur.characters || []).filter(c => hit(c.name) || hit(c.profile) || hit(c.role)).slice(0, 6)
      .map(c => ({ novelId: cur.id, title: c.name, sub: "角色 · " + (c.role === "protagonist" ? "主角" : (c.role || "配角")) }));
    if (chars.length) groups.push({ label: "角色", icon: "users", items: chars });
    const ths = (cur.threads || []).filter(t => hit(t.thread)).slice(0, 6)
      .map(t => ({ novelId: cur.id, title: t.thread, sub: `线索 · ${t.status || "已埋"} · 埋于第${t.plantedAt || "?"}章` }));
    if (ths.length) groups.push({ label: "线索", icon: "map", items: ths });
    if (window.Materials && (cur.materials || []).length) {
      const ms = (cur.materials || []).filter(m => hit(m.title) || hit(m.preview)).slice(0, 6)
        .map(m => ({ novelId: cur.id, title: m.title, sub: `资料 · ${m.chars.toLocaleString()} 字${m.enabled === false ? " · 已停用" : ""}` }));
      if (ms.length) groups.push({ label: "资料", icon: "bookOpen", items: ms });
    }
  }
  return groups;
}

function commandPalette() {
  const n = State.novel;
  const cmds = [
    { id: "c-export", name: "导出作品", sub: "Markdown / 分章 zip / TXT", icon: "import", run: () => exportSheet() },
    { id: "c-stats", name: "写作统计", sub: "字数、章数、AI 调用", icon: "chart", run: () => statsSheet() },
    { id: "c-materials", name: "资料库", sub: "参考资料、检索测试", icon: "book", run: () => nav({ page: "materials", novelId: n && n.id }) },
    { id: "c-threads", name: "剧情与伏笔", sub: "查看所有线索", icon: "map", run: () => threadsSheet() },
    { id: "c-health", name: "数据体检", sub: "结构化检查整本书", icon: "shield", run: () => healthSheet() },
    { id: "c-clear", name: "清除生成内容", sub: "蓝图 / 未定稿正文", icon: "trash", run: () => clearSheet() },
    { id: "c-graph", name: "角色关系图谱", sub: "人物关系可视化", icon: "users", run: () => graphSheet() },
    { id: "c-skills", name: "技能库", sub: "审查 / 纠错插件", icon: "layers", run: () => skillLibrarySheet(State.route.chNum || 1) },
    ...(n && window.Skills ? Skills.enabled().filter(s => s.group !== "plan").map(s => ({
      id: "sk-" + s.id, name: "技能 · " + s.name, sub: s.desc || "", icon: s.icon,
      run: () => runSkill(s.id, State.route.chNum || 1),
    })) : []),
    { id: "c-set", name: "设置", sub: "模型、外观、提示词", icon: "settings", run: () => nav({ page: "settings" }) },
  ];
  const novels = State._shelfCache || [];

  openSheet(`
    <div class="palette">
      <input id="cp-input" placeholder="搜索作品、章节、功能…" autocomplete="off" />
      <div class="cp-list" id="cp-list"></div>
    </div>`, (sheet) => {
    const input = $("#cp-input", sheet);
    const list = $("#cp-list", sheet);
    let seq = 0;
    const paint = (hits) => {
      list.innerHTML = hits.length ? hits.map((h, i) => `<button class="cp-item" data-i="${i}">
        <span class="cp-ico">${svgIcon(h.icon || "search", 15)}</span>
        <span class="t"><span class="name">${esc(h.name)}</span><span class="sub">${esc(h.sub || "")}</span></span>
      </button>`).join("") : `<div class="empty" style="padding:24px 8px">没有匹配项</div>`;
      $$(".cp-item", sheet).forEach(btn => btn.onclick = () => {
        const h = hits[parseInt(btn.dataset.i)];
        closeSheet();
        setTimeout(() => h.run(), 60);
      });
    };
    const renderList = (q) => {
      const term = (q || "").trim().toLowerCase();
      const hits = [];
      for (const c of cmds) {
        if (!term || c.name.toLowerCase().includes(term) || (c.sub || "").toLowerCase().includes(term)) {
          hits.push({ kind: "cmd", ...c });
        }
      }
      paint(hits);
      if (!term) return;
      const my = ++seq;
      /* 全书搜索：作品、章节正文、角色、线索、资料库 */
      searchAll(q).then(groups => {
        if (my !== seq) return;
        const extra = [];
        for (const g of groups) {
          for (const it of g.items) {
            extra.push({
              name: it.title, sub: it.sub, icon: g.icon,
              run: async () => {
                if (State.novel && State.novel.id === it.novelId) {
                  if (it.chNum) nav({ page: "chapter", chNum: it.chNum });
                } else {
                  await openNovel(it.novelId);
                  if (it.chNum) nav({ page: "chapter", chNum: it.chNum });
                }
              },
            });
          }
        }
        paint(hits.concat(extra));
      }).catch(() => {});
    };
    renderList("");
    input.addEventListener("input", () => renderList(input.value));
    input.focus();
  });
}

/* 定稿后按设置自动翻到下一章 */
function maybeAutoNext(num) {
  if (!State.appearance.autoNext) return;
  const n = State.novel;
  const total = n.config.totalChapters || 0;
  const next = num + 1;
  if (total && next > total) { toast("已经是最后一章了"); return; }
  if (!getBlueprint(n, next) && !getChapter(n, next)) { toast("下一章还没有蓝图"); return; }
  nav({ page: "chapter", chNum: next });
  toast(`已翻到第${next}章`);
}

/* ============================================================
   技能库：审查 / 纠错插件
   ============================================================ */
/* 极简 Markdown 渲染（教练型技能输出用） */
function mdLite(src) {
  /* 先解析结构再转义：否则 > 被转成 &gt; 就匹配不上引用了 */
  const lines = String(src || "").split(/\r?\n/);
  const out = [];
  let inList = false;
  const close = () => { if (inList) { out.push("</ul>"); inList = false; } };
  const inline = (t) => esc(t)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { close(); continue; }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      close();
      const lv = Math.min(5, m[1].length + 2);
      out.push(`<h${lv} class="md-h">${inline(m[2])}</h${lv}>`);
    } else if ((m = line.match(/^[-*]\s+(.*)$/))) {
      if (!inList) { out.push('<ul class="md-ul">'); inList = true; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      close();
      out.push(`<blockquote class="md-q">${inline(m[1])}</blockquote>`);
    } else {
      close();
      out.push(`<p class="md-p">${inline(line)}</p>`);
    }
  }
  close();
  return out.join("");
}

function skillIco(name, size) {
  return svgIcon(name || "spark", size || 15) || svgIcon("spark", size || 15);
}

/* ---------- 技能库面板 ---------- */
function skillLibrarySheet(num) {
  const n = State.novel;
  const chNum = num || State.route.chNum || 1;
  const c = getChapter(n, chNum);
  const hasDraft = !!(c && (c.content || "").trim());
  const groups = Skills.byGroup();
  const total = Skills.all().length;
  const onCount = Skills.all().filter(s => s.enabled).length;
  const order = ["check", "fix", "craft", "plan", "idea"];
  openSheet(`
    <div class="sheet-head">
      <h3 style="margin:0">技能库</h3>
      <span class="tag accent" style="margin-left:auto">${onCount}/${total} 启用</span>
    </div>
    <p class="tiny" style="margin-top:7px">每个技能是一套固定的审查视角，跑在第${chNum}章上。只诊断、不动正文；勾选意见后才按你选的改。</p>
    ${hasDraft ? "" : `<p class="tiny" style="color:var(--warn);margin-top:4px">本章还没有正文，字句类技能会提示你先写一点。</p>`}
    <div class="sheet-scroll">
      ${order.filter(g => groups[g]).map(g => `
        <div class="sk-group">
          <div class="sk-gh"><span>${Skills.GROUPS[g].name}</span><em>${Skills.GROUPS[g].hint}</em></div>
          ${groups[g].map(s => `
            <div class="sk-item ${s.enabled ? "" : "off"}" data-row="${s.id}">
              <button class="sk-main" data-run="${s.id}">
                <span class="sk-ico">${skillIco(s.icon)}</span>
                <span class="sk-t">
                  <b>${esc(s.name)}${s.custom ? '<i class="sk-tag new">自建</i>' : s.edited ? '<i class="sk-tag">已改</i>' : ""}</b>
                  <span>${esc(s.desc || "")}</span>
                </span>
              </button>
              <button class="sk-more" data-detail="${s.id}" aria-label="设置">${svgIcon("more", 15)}</button>
            </div>`).join("")}
        </div>`).join("")}
    </div>
    <div class="row" style="margin-top:10px">
      <button class="btn small" id="sk-new">${svgIcon("plus", 14)} 自建技能</button>
      <button class="btn small" id="sk-reset">全部恢复默认</button>
    </div>`, (sheet) => {
    $$("[data-run]", sheet).forEach(b => b.onclick = () => runSkill(b.dataset.run, chNum));
    $$("[data-detail]", sheet).forEach(b => b.onclick = (e) => {
      e.stopPropagation(); e.preventDefault();
      skillDetailSheet(b.dataset.detail, chNum);
    });
    $("#sk-new", sheet).onclick = () => skillEditSheet(null, chNum);
    $("#sk-reset", sheet).onclick = () => {
      confirmSheet("恢复默认？", "会重新启用全部内置技能，并丢弃对提示词的修改。自建技能保留。", () => {
        Skills.resetAll();
        skillLibrarySheet(chNum);
        toast("已恢复默认");
      }, "恢复");
    };
  });
}

/* ---------- 技能详情 / 编辑 ---------- */
function skillDetailSheet(id, num) {
  const s = Skills.get(id);
  if (!s) return;
  const chNum = num || State.route.chNum || 1;
  openSheet(`
    <div class="sheet-head">
      <h3 style="margin:0">${esc(s.name)}</h3>
      <span class="tag" style="margin-left:auto">${Skills.GROUPS[s.group].name}</span>
    </div>
    <p class="tiny" style="margin-top:7px">${esc(s.desc || "")} · ${s.output === "issue" ? "输出问题清单" : s.output === "prose" ? "输出整段建议" : "回写章纲"}</p>
    <label style="display:flex;align-items:center;gap:9px;margin-top:12px">
      <input type="checkbox" id="sd-on" ${s.enabled ? "checked" : ""} style="width:auto" /> 在技能库中启用
    </label>
    <label style="margin-top:14px">检查重点（原样放进提示词）</label>
    <textarea id="sd-focus" class="prompt-edit">${esc(s.focus || "")}</textarea>
    <p class="tiny" style="margin-top:6px">写清楚「要找哪几类问题、怎么算问题」，比写「请检查」有效得多。</p>
    <div class="row" style="margin-top:10px">
      <button class="btn small" id="sd-reset">恢复内置</button>
      ${s.custom ? `<button class="btn small danger" id="sd-del">删除技能</button>` : ""}
    </div>
    <button class="btn primary block" id="sd-run" style="margin-top:12px">在第${chNum}章上运行</button>
    <button class="btn block" id="sd-save" style="margin-top:8px">保存修改</button>`, (sheet) => {
    $("#sd-on", sheet).onchange = (e) => { Skills.setEnabled(s.id, e.target.checked); };
    $("#sd-reset", sheet).onclick = () => {
      if (!s.custom) Skills.setFocus(s.id, null);
      $("#sd-focus", sheet).value = s.builtinFocus || "";
      toast("已恢复内置提示词，点保存生效");
    };
    const delBtn = $("#sd-del", sheet);
    if (delBtn) delBtn.onclick = () => {
      confirmSheet("删除这个技能？", "自建技能删除后无法恢复。", () => {
        Skills.removeCustom(s.id);
        skillLibrarySheet(chNum);
        toast("已删除");
      }, "删除");
    };
    $("#sd-run", sheet).onclick = () => runSkill(s.id, chNum);
    $("#sd-save", sheet).onclick = () => {
      if (!s.custom) Skills.setFocus(s.id, $("#sd-focus", sheet).value);
      else {
        const idx = Skills.all().find(x => x.id === s.id);
        if (idx) Skills.setFocus(s.id, $("#sd-focus", sheet).value);
      }
      Skills.setEnabled(s.id, $("#sd-on", sheet).checked);
      skillLibrarySheet(chNum);
      toast("已保存");
    };
  });
}

function skillEditSheet(_base, num) {
  const chNum = num || State.route.chNum || 1;
  openSheet(`
    <h3>自建技能</h3>
    <p class="tiny" style="margin-top:6px">把你自己的审稿习惯写成一段检查清单，以后一键复用。</p>
    <label>技能名称</label>
    <input id="se-name" placeholder="例如：古风用词审查" />
    <label>分组</label>
    <div class="chip-row" id="se-group">
      ${Object.entries(Skills.GROUPS).map(([k, v], i) => `<button class="chip ${i === 0 ? "active" : ""}" data-v="${k}">${v.name}</button>`).join("")}
    </div>
    <label>一句话说明</label>
    <input id="se-desc" placeholder="例如：检查现代词混入古风场景" />
    <label>检查重点（越具体越好）</label>
    <textarea id="se-focus" class="prompt-edit" style="min-height:24vh" placeholder="1. 现代词汇、网络用语混入古代场景&#10;2. 称谓与身份不符&#10;3. 器物、货币、时间单位与朝代不合"></textarea>
    <p class="tiny" style="margin-top:6px">输出为问题清单，每条会附上原文和改法。</p>
    <button class="btn primary block" id="se-save" style="margin-top:12px">创建</button>`, (sheet) => {
    let group = "check";
    $$("#se-group .chip", sheet).forEach(chip => chip.onclick = () => {
      $$("#se-group .chip", sheet).forEach(x => x.classList.remove("active"));
      chip.classList.add("active"); group = chip.dataset.v;
    });
    $("#se-save", sheet).onclick = () => {
      const name = $("#se-name", sheet).value.trim();
      const focus = $("#se-focus", sheet).value.trim();
      if (!name) { toast("给技能起个名字", true); return; }
      if (!focus) { toast("写点检查重点，否则跑起来会很空", true); return; }
      Skills.addCustom({ name, group, desc: $("#se-desc", sheet).value.trim(), focus, output: "issue" });
      skillLibrarySheet(chNum);
      toast("已创建");
    };
  });
}

/* ---------- 运行 ---------- */
async function runSkill(id, num) {
  const n = State.novel;
  const s = Skills.get(id);
  if (!s) return;
  const chNum = num || State.route.chNum || 1;
  if (s.output === "blueprint" && isAssistMode()) {
    toast("AI 辅助模式不生成章纲。切到创作模式再用", true);
    return;
  }
  if (!ensureModel("review")) return;
  closeSheet();
  try {
    const res = await Skills.run(id, n, chNum);
    if (res.kind === "issue") skillReportSheet(s, res.items, chNum);
    else if (res.kind === "prose") proseSheet(s, res.text, chNum);
    else if (res.kind === "blueprint") applyBlueprintPlan(chNum, res.data);
  } catch (e) {
    if (e.name === "AbortError") toast("已取消");
    else toast(e.message || "运行失败", true);
  }
}

/* ---------- 问题清单 ---------- */
function skillReportSheet(skill, items, num) {
  const c = getChapter(State.novel, num);
  if (!items.length) {
    toast(`${skill.name}：没有发现问题 ✓`);
    return;
  }
  const cnt = { high: 0, medium: 0, low: 0 };
  items.forEach(r => { cnt[r.severity === "high" ? "high" : r.severity === "low" ? "low" : "medium"]++; });
  openSheet(`
    <div class="sheet-head">
      <h3 style="margin:0">${esc(skill.name)}</h3>
      <div class="sk-cnt">
        ${cnt.high ? `<span class="tag err">${cnt.high}</span>` : ""}
        ${cnt.medium ? `<span class="tag warn">${cnt.medium}</span>` : ""}
        ${cnt.low ? `<span class="tag">${cnt.low}</span>` : ""}
      </div>
    </div>
    <p class="tiny" style="margin-top:7px">第${num}章 · 共 ${items.length} 条。勾选表示采纳，修稿只改勾中的。</p>
    <div class="sk-report">
      ${items.map((r, i) => `
        <label class="sk-rv" data-rv="${i}">
          <input type="checkbox" class="rv-cb" data-i="${i}" ${r.severity === "high" ? "checked" : ""} />
          <div class="sk-rv-body">
            <div class="sk-rv-h">
              <span class="tag ${r.severity === "high" ? "err" : r.severity === "medium" ? "warn" : ""}">${SEV_NAME[r.severity] || "建议"}</span>
              <span class="tiny">${esc(r.dimension)}</span>
              ${r.quote ? `<button class="sk-locate" data-locate="${i}">定位</button>` : ""}
            </div>
            ${r.quote ? `<div class="sk-quote">${esc(r.quote)}</div>` : ""}
            <div class="sk-comment">${esc(r.comment)}</div>
            ${r.fix ? `<div class="sk-fix">→ ${esc(r.fix)}</div>` : ""}
          </div>
        </label>`).join("")}
    </div>
    <div class="row" style="margin-top:12px">
      <button class="btn small" id="sr-all">全选</button>
      <button class="btn small" id="sr-high">只选严重</button>
      <button class="btn small" id="sr-none">全不选</button>
    </div>
    <button class="btn primary block" id="sr-refine" style="margin-top:10px">按勾选修稿</button>
    <div class="tiny" style="margin-top:6px">修完会自动复验这几条，确认真的改掉了。</div>
    <button class="btn block" id="sr-again" style="margin-top:8px">换一批看看 / 重跑</button>`, (sheet) => {
    const boxes = () => $$(".rv-cb", sheet);
    $("#sr-all", sheet).onclick = () => boxes().forEach(b => b.checked = true);
    $("#sr-high", sheet).onclick = () => boxes().forEach(b => b.checked = items[+b.dataset.i].severity === "high");
    $("#sr-none", sheet).onclick = () => boxes().forEach(b => b.checked = false);
    $$("[data-locate]", sheet).forEach(b => b.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      const q = items[+b.dataset.locate].quote;
      closeSheet();
      locateInEditor(q);
    });
    $("#sr-refine", sheet).onclick = async () => {
      const chosen = items.filter((_, i) => {
        const b = $(`.rv-cb[data-i='${i}']`, sheet);
        return b && b.checked;
      });
      if (!chosen.length) { toast("先勾选至少一条意见", true); return; }
      closeSheet();
      await refineFromReview(num, chosen.map(r => ({ dimension: r.dimension, comment: `${r.comment}${r.fix ? "（建议：" + r.fix + "）" : ""}`, quote: r.quote })));
    };
    $("#sr-again", sheet).onclick = () => runSkill(skill.id, num);
  });
}

/* ---------- 整段建议 ---------- */
function proseSheet(skill, text, num) {
  openSheet(`
    <div class="sheet-head">
      <h3 style="margin:0">${esc(skill.name)}</h3>
      <button class="btn small" id="ps-copy" style="margin-left:auto">复制</button>
    </div>
    <div class="md-body">${mdLite(text)}</div>
    <div class="row" style="margin-top:12px">
      <button class="btn small" id="ps-note">存为本章笔记</button>
      <button class="btn small" id="ps-again">重跑</button>
    </div>`, (sheet) => {
    $("#ps-copy", sheet).onclick = async () => {
      try { await navigator.clipboard.writeText(text); toast("已复制"); }
      catch (e) { toast("复制失败，可长按选择文字", true); }
    };
    $("#ps-note", sheet).onclick = async () => {
      const c = getChapter(State.novel, num);
      if (!c) return;
      c.notes = c.notes || [];
      c.notes.push({ skill: skill.name, text: text.slice(0, 4000), at: Date.now() });
      await DB.putNovel(State.novel);
      toast("已存为本章笔记");
    };
    $("#ps-again", sheet).onclick = () => runSkill(skill.id, num);
  });
}

/* ---------- 章纲拆解结果回写 ---------- */
function applyBlueprintPlan(num, d) {
  const n = State.novel;
  if (!d || typeof d !== "object") { toast("拆解结果格式不对", true); return; }
  let b = getBlueprint(n, num);
  if (!b) {
    const c = getChapter(n, num);
    b = { chapterNumber: num, title: (c && c.title) || `第${num}章`, purpose: "", keyEvents: "", characters: [], suspenseHook: "" };
    n.blueprints.push(b);
  }
  if (Array.isArray(d.beats) && d.beats.length) b.beats = d.beats.map(x => ({ text: String(x).trim(), done: false }));
  if (Array.isArray(d.plantThreads)) b.plantThreads = d.plantThreads.slice(0, 3).map(x => ({ text: String(x).trim(), done: false }));
  if (Array.isArray(d.payoffThreads)) b.payoffThreads = d.payoffThreads.slice(0, 3).map(x => ({ text: String(x).trim(), done: false }));
  if (d.tension) b.tension = Math.max(1, Math.min(5, parseInt(d.tension) || 3));
  if (d.targetWords) b.targetWords = parseInt(d.targetWords) || b.targetWords;
  if (d.hook) b.suspenseHook = String(d.hook).trim();
  saveNovel(true);
  if (window.Compass) Compass.refresh();
  toast(`已写入章纲：${(b.beats || []).length} 个节拍${(b.plantThreads || []).length ? "、" + b.plantThreads.length + " 条待埋伏笔" : ""}`);
}

/* ================= 资料库（对应桌面版知识库） ================= */
function viewMaterials() {
  const n = State.novel;
  const list = (n.materials || []).slice().sort((a, b) => b.addedAt - a.addedAt);
  const st = window.Materials ? Materials.stats(n) : { count: 0, enabled: 0, chunks: 0, chars: 0 };
  const fmt = (c) => c > 10000 ? (c / 10000).toFixed(1) + " 万字" : c + " 字";
  return `
    ${topbar("资料库", { back: true, right: `<button class="icon-btn" id="mt-add" title="添加资料">${svgIcon("plus", 18)}</button>` })}
    <div class="page">
      <div class="card">
        <div class="stat-bar" style="justify-content:space-between">
          <span>${st.count} 份资料 · ${st.enabled} 份启用</span>
          <span>${fmt(st.chars)}</span>
        </div>
        <div class="tiny" style="margin-top:6px">切成 ${st.chunks} 段。写正文时按本章蓝图自动检索最相关的 4 段，作为事实与用词参考注入，不联网、不外传。</div>
        <button class="btn block" id="mt-probe" style="margin-top:10px">${svgIcon("search", 15)} 检索测试</button>
      </div>
      ${list.length ? `<div class="card">${list.map(m => `
        <div class="chapter-row">
          <button class="chapter-item" data-mt="${m.id}">
            <span class="t">
              <span class="name">${esc(m.title)}</span>
              <span class="sub">${esc(m.source)} · ${fmt(m.chars)} · ${(m.chunks || []).length} 段${m.enabled === false ? " · 已停用" : ""}</span>
            </span>
            ${m.enabled === false ? `<span class="tag">停用</span>` : ""}
          </button>
          <button class="ch-more" data-mtm="${m.id}" aria-label="更多">${svgIcon("more", 16)}</button>
        </div>`).join("")}</div>`
      : `<div class="empty" style="padding:44px 16px;text-align:center">
          <div style="font-size:14px;color:var(--ink-2)">还没有参考资料</div>
          <div class="tiny" style="margin-top:6px;line-height:1.7">把世界观笔记、人物小传、地名志、参考小说的设定页导进来。<br/>写这一章时，相关段落会自动出现在提示词里。</div>
        </div>`}
      <button class="btn block primary" id="mt-import" style="margin-top:10px">${svgIcon("import", 15)} 导入资料（txt / md / epub）</button>
    </div>`;
}

function bindMaterials() {
  $("#btn-back").onclick = () => goBack({ page: "novel", novelId: State.novel.id, tab: "blueprint" });
  $("#mt-add").onclick = () => materialAddSheet();
  $("#mt-import").onclick = () => materialAddSheet(true);
  $("#mt-probe").onclick = () => materialProbeSheet();
  $$("[data-mt]").forEach(b => b.onclick = () => materialDetailSheet(b.dataset.mt));
  $$("[data-mtm]").forEach(b => b.onclick = (e) => { e.stopPropagation(); materialMenuSheet(b.dataset.mtm); });
}

/* 添加：粘贴 / 选文件（txt、md、epub 都走这里） */
function materialAddSheet(fromFile) {
  openSheet(`
    <h3>添加资料</h3>
    <label>标题</label>
    <input id="mt-title" placeholder="例：世界观设定 / 雾港地名志" />
    <label>正文</label>
    <textarea id="mt-text" rows="8" placeholder="粘贴资料内容…"></textarea>
    <div class="row" style="margin-top:8px">
      <button class="btn" id="mt-file">${svgIcon("import", 15)} 选择文件</button>
    </div>
    <input type="file" id="mt-input" accept=".txt,.md,.markdown,.epub,text/plain" style="display:none" />
    <button class="btn primary block" id="mt-save" style="margin-top:14px">加入资料库</button>`, (sheet) => {
    const ta = $("#mt-text", sheet);
    $("#mt-file", sheet).onclick = () => $("#mt-input", sheet).click();
    $("#mt-input", sheet).onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > 8 * 1024 * 1024) { toast("文件超过 8MB，先切分后再导入", true); return; }
      try {
        let text = "";
        if (/\.epub$/i.test(f.name)) {
          if (!window.EPUB) { toast("EPUB 解析未加载", true); return; }
          const book = await EPUB.parse(f);
          text = book.chapters.map(c => `${c.title}\n${c.text}`).join("\n\n");
        } else {
          text = await f.text();
        }
        ta.value = text;
        if (!$("#mt-title", sheet).value) $("#mt-title", sheet).value = f.name.replace(/\.(txt|md|markdown|epub)$/i, "");
        toast(`已读取 ${f.name}（${(text.length / 1000).toFixed(0)}k 字）`);
      } catch (err) {
        toast("读取失败：" + err.message, true);
      }
    };
    $("#mt-save", sheet).onclick = async () => {
      const n = State.novel;
      const r = Materials.add(n, {
        title: $("#mt-title", sheet).value,
        text: ta.value,
        source: $("#mt-title", sheet).value ? "手动" : "粘贴",
      });
      if (r.error) { toast(r.error, true); return; }
      await DB.putNovel(n);
      closeSheet(); render();
      toast(`已加入，切了 ${r.material.chunks.length} 段`);
    };
  });
  if (fromFile) setTimeout(() => { const el = $("#mt-input"); if (el) el.click(); }, 120);
}

function materialDetailSheet(id) {
  const n = State.novel;
  const m = (n.materials || []).find(x => x.id === id);
  if (!m) return;
  openSheet(`
    <div class="sheet-head">
      <h3 style="flex:1;min-width:0">${esc(m.title)}</h3>
      <button class="btn small" id="mt-toggle">${m.enabled === false ? "启用" : "停用"}</button>
    </div>
    <p class="tiny">${esc(m.source)} · ${m.chars.toLocaleString()} 字 · ${(m.chunks || []).length} 段 · ${fmtDate(m.addedAt)}</p>
    <div class="section-label">内容预览</div>
    <div class="preview-paper" style="max-height:38vh;overflow-y:auto">${esc(m.preview || (m.chunks[0] || ""))}${m.chars > 260 ? "…" : ""}</div>
    <div class="row" style="margin-top:12px">
      <button class="btn" id="mt-rename">重命名</button>
      <button class="btn danger" id="mt-del">删除</button>
    </div>`, (sheet) => {
    $("#mt-toggle", sheet).onclick = async () => {
      Materials.setEnabled(n, id, m.enabled === false);
      await DB.putNovel(n); closeSheet(); render(); toast(m.enabled === false ? "已启用" : "已停用");
    };
    $("#mt-rename", sheet).onclick = () => {
      openSheet(`
        <h3>重命名</h3>
        <input id="mt-new" value="${esc(m.title)}" />
        <button class="btn primary block" id="mt-new-ok" style="margin-top:14px">保存</button>`, (s2) => {
        $("#mt-new-ok", s2).onclick = async () => {
          Materials.rename(n, id, $("#mt-new", s2).value);
          await DB.putNovel(n); closeSheet(); render();
        };
      });
    };
    $("#mt-del", sheet).onclick = () => {
      confirmSheet("删除这份资料？", "它会从检索里消失，已写的正文不受影响。", async () => {
        Materials.remove(n, id);
        await DB.putNovel(n); render(); toast("已删除");
      }, "删除");
    };
  });
}

function materialMenuSheet(id) {
  const n = State.novel;
  const m = (n.materials || []).find(x => x.id === id);
  if (!m) return;
  openSheet(`
    <h3>${esc(m.title)}</h3>
    <div style="margin-top:8px">
      <button class="chapter-item" id="mm-view"><span class="t"><span class="name">查看内容</span></span><span>›</span></button>
      <button class="chapter-item" id="mm-toggle"><span class="t"><span class="name">${m.enabled === false ? "启用" : "停用"}</span><span class="sub">停用后不参与检索，内容保留</span></span><span>›</span></button>
      <button class="chapter-item" id="mm-del"><span class="t"><span class="name" style="color:var(--err)">删除</span></span><span>›</span></button>
    </div>`, (sheet) => {
    $("#mm-view", sheet).onclick = () => materialDetailSheet(id);
    $("#mm-toggle", sheet).onclick = async () => {
      Materials.setEnabled(n, id, m.enabled === false);
      await DB.putNovel(n); closeSheet(); render(); toast(m.enabled === false ? "已启用" : "已停用");
    };
    $("#mm-del", sheet).onclick = () => {
      confirmSheet("删除这份资料？", "它会从检索里消失，已写的正文不受影响。", async () => {
        Materials.remove(n, id);
        await DB.putNovel(n); render(); toast("已删除");
      }, "删除");
    };
  });
}

/* 检索测试：写作前先确认资料能被找出来 */
function materialProbeSheet() {
  const n = State.novel;
  openSheet(`
    <h3>检索测试</h3>
    <p class="tiny">输入本章要写的内容，看资料库里能捞出哪些段落。写正文时用的是同一套检索。</p>
    <input id="mp-q" placeholder="例：灯塔 铜灯 旧信" />
    <div id="mp-out" style="margin-top:12px"></div>`, (sheet) => {
    const out = $("#mp-out", sheet);
    let t = 0;
    $("#mp-q", sheet).oninput = (e) => {
      clearTimeout(t);
      const q = e.target.value.trim();
      if (!q) { out.innerHTML = `<div class="tiny">输入关键词开始检索</div>`; return; }
      t = setTimeout(() => {
        const hits = Materials.search(n, q, 6);
        out.innerHTML = hits.length
          ? hits.map((h, i) => `<div class="card" style="margin-bottom:8px">
              <div class="tiny" style="display:flex;gap:6px"><b style="color:var(--accent)">#${i + 1}</b><span>${esc(h.title)}</span><span class="spacer"></span><span>${h.score.toFixed(1)}</span></div>
              <div style="font-size:13px;line-height:1.6;margin-top:6px;color:var(--ink-2)">${esc(h.text.slice(0, 180))}${h.text.length > 180 ? "…" : ""}</div>
            </div>`).join("")
          : `<div class="tiny">没有命中。试试更具体的名词（人名、地名、物件名）。</div>`;
      }, 220);
    };
  });
}

/* ================= 章节操作 ================= */
function chapterMenuSheet(num) {
  const n = State.novel;
  const c = getChapter(n, num);
  const b = getBlueprint(n, num);
  const has = !!(c && (c.content || "").trim());
  openSheet(`
    <h3>第${num}章 ${esc((c && c.title) || (b && b.title) || "")}</h3>
    <div style="margin-top:8px">
      <button class="chapter-item" id="cm-rename"><span class="t"><span class="name">重命名</span><span class="sub">改标题，不影响正文</span></span><span>›</span></button>
      <button class="chapter-item" id="cm-copy" ${has ? "" : "disabled"}><span class="t"><span class="name">复制正文</span><span class="sub">${has ? "复制到剪贴板" : "这一章还没写"}</span></span><span>›</span></button>
      <button class="chapter-item" id="cm-bp"><span class="t"><span class="name">${b ? "编辑蓝图" : "补一份蓝图"}</span><span class="sub">章纲、关键事件、钩子</span></span><span>›</span></button>
      <button class="chapter-item" id="cm-del"><span class="t"><span class="name" style="color:var(--err)">删除本章</span><span class="sub">正文、蓝图、版本记录一起删</span></span><span>›</span></button>
    </div>`, (sheet) => {
    $("#cm-rename", sheet).onclick = () => {
      openSheet(`
        <h3>重命名第${num}章</h3>
        <input id="cm-title" value="${esc((c && c.title) || (b && b.title) || "")}" placeholder="章节标题" />
        <button class="btn primary block" id="cm-title-ok" style="margin-top:14px">保存</button>`, (s2) => {
        $("#cm-title-ok", s2).onclick = async () => {
          const v = $("#cm-title", s2).value.trim();
          if (!v) { toast("标题不能为空", true); return; }
          if (c) c.title = v;
          if (b) b.title = v;
          await DB.putNovel(n); closeSheet(); render(); toast("已重命名");
        };
      });
    };
    $("#cm-copy", sheet).onclick = async () => {
      if (!has) return;
      try {
        await navigator.clipboard.writeText(c.content);
        toast("正文字已复制");
      } catch (e) {
        toast("复制失败，请长按正文手动选择", true);
      }
      closeSheet();
    };
    $("#cm-bp", sheet).onclick = () => { closeSheet(); blueprintSheet(num); };
    $("#cm-del", sheet).onclick = () => {
      confirmSheet(`删除第${num}章？`, "这一章的正文、蓝图、版本记录都会删掉，不能恢复。连续性事实里的记录会保留。", async () => {
        if (c) {
          pushVersion(c, "删除前备份");
          const i = n.chapters.indexOf(c);
          if (i >= 0) n.chapters.splice(i, 1);
        }
        const bi = (n.blueprints || []).findIndex(x => x.chapterNumber === num);
        if (bi >= 0) n.blueprints.splice(bi, 1);
        await DB.putNovel(n);
        closeSheet(); render(); toast("已删除");
      }, "删除");
    };
  });
}

/* ================= 校验与维护 ================= */
function healthSheet() {
  const n = State.novel;
  const issues = [];
  const total = n.config.totalChapters || 0;
  const withContent = n.chapters.filter(c => (c.content || "").trim());
  const noBp = withContent.filter(c => !getBlueprint(n, c.chapterNumber));
  if (noBp.length) issues.push({ lv: "warn", text: `${noBp.length} 章有正文但没有蓝图`, tip: "没有蓝图时，续写和审稿都会缺少目标读者与关键事件，建议补上。", act: "去蓝图页" });
  const empty = n.chapters.filter(c => !(c.content || "").trim() && c.status !== "待写");
  if (empty.length) issues.push({ lv: "warn", text: `${empty.length} 章状态不是「待写」但正文是空的`, tip: "通常是生成中断留下的，删掉或重写即可。" });
  const shortCh = withContent.filter(c => (c.wordCount || 0) > 0 && c.wordCount < (n.config.wordsPerChapter || 2500) * 0.6);
  if (shortCh.length) issues.push({ lv: "info", text: `${shortCh.length} 章明显短于目标（${n.config.wordsPerChapter || 2500} 字）`, tip: "短章多半是生成被中断，可以续写补齐。" });
  const noFacts = n.chapters.filter(c => c.status === "定稿" && !c.factsDone);
  if (noFacts.length) issues.push({ lv: "warn", text: `${noFacts.length} 章已定稿但没抽取连续性事实`, tip: "缺事实会让后续章节的连续性检查失准。", act: "去补抽" });
  const noSetting = !n.config.genre || !n.config.coreOutline;
  if (noSetting) issues.push({ lv: "info", text: "设定不完整（题材或核心大纲为空）", tip: "设定越具体，AI 写出来的东西越像这本书。" });
  const stale = (n.threads || []).filter(t => t.status !== "已收" && t.status !== "已弃" && (t.lastMovedAt || t.plantedAt || 0) < total - 5);
  if (stale.length) issues.push({ lv: "info", text: `${stale.length} 条线索超过 5 章没推进`, tip: "长期悬空的线索容易变成烂尾。", act: "看线索" });

  const lvTag = { warn: ["err", "需处理"], info: ["", "建议"] };
  openSheet(`
    <h3>${svgIcon("shield", 16)} 数据体检</h3>
    <p class="tiny">只检查本机的作品数据，不会调用模型。</p>
    <div class="sk-report" style="max-height:52vh">
      ${issues.length ? issues.map((it, i) => `
        <div class="sk-rv">
          <div class="sk-rv-body">
            <div class="sk-rv-h">
              <span class="tag ${lvTag[it.lv][0]}">${lvTag[it.lv][1]}</span>
              <span style="font-size:13.5px">${esc(it.text)}</span>
            </div>
            <div class="sk-comment">${esc(it.tip)}</div>
            ${it.act ? `<button class="sk-locate" data-hact="${i}">${esc(it.act)}</button>` : ""}
          </div>
        </div>`).join("")
      : `<div class="empty" style="padding:30px 8px">没发现问题，这本书的数据是干净的 ✓</div>`}
    </div>`, (sheet) => {
    $$("[data-hact]", sheet).forEach(b => b.onclick = () => {
      const it = issues[parseInt(b.dataset.hact)];
      closeSheet();
      if (it.act === "去蓝图页") nav({ page: "novel", novelId: n.id, tab: "blueprint" });
      else if (it.act === "看线索") threadsSheet();
      else if (it.act === "去补抽") {
        const c = noFacts[0];
        nav({ page: "chapter", chNum: c.chapterNumber });
        setTimeout(() => toast(`第${c.chapterNumber}章可以点「定稿」重新触发抽取`), 600);
      }
    });
  });
}

/* ================= 启动 ================= */
(async function boot() {
  /* 镜像里给首屏打个 idx=1 的底，goBack 才能安全地走 history.back() */
  State.stack = [{ page: "shelf" }];
  State.depth = 0;
  try { history.replaceState({ idx: 1 }, "", location.pathname + location.search); } catch (e) {}
  State.settings = Object.assign({ theme: "auto", models: [], defaultModelId: "", stageModels: {}, aiMode: "auto", hud: true }, await DB.kvGet("settings", {}));
  State.appearance = Object.assign({ fontSize: 17.5, lineHeight: 2.0, font: "serif", autoNext: false, paraIndent: true }, await DB.kvGet("appearance", {}));
  applyAppearance();
  applyPromptOverrides(await DB.kvGet("promptOverrides", {}));
  if (window.Skills) await Skills.init();
  if (window.HUD) { await HUD.load(); HUD.setEnabled(State.settings.hud !== false); }
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
  // 命令面板：桌面调试用 Ctrl/⌘+K，手机走书房顶栏的搜索按钮
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === "k") {
      e.preventDefault();
      if (!$("#modal-layer").children.length) commandPalette();
    }
  });
  // 全局选中文本追踪（正文编辑器的润色/改写依赖它）
  document.addEventListener("selectionchange", () => {
    const ed = State.currentEditor;
    if (!ed || !ed.isConnected || document.activeElement !== ed) return;
    const s = ed.selectionStart, e = ed.selectionEnd;
    State.editorSel = s !== e ? { start: s, end: e, text: ed.value.slice(s, e) } : null;
  });
  // PWA
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  render();
})();
