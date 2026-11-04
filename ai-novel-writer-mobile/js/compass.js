/* ============================================================
   章纲罗盘（正文页悬浮窗）
   ------------------------------------------------------------
   写作时最常忘的不是设定，是「这一章要干什么」。
   这个浮窗常驻在正文页，随时能看到：
   - 本章目的与关键事件（章纲）
   - 可勾选的节拍清单（写到哪一步了）
   - 本章要埋的伏笔 / 该收的旧线索 / 太久没动的陈线
   - 张力、目标字数、章末钩子
   数据全部来自作品本身的蓝图与线索表，勾选即回写。
   ============================================================ */
(function () {
  const POS_KEY = "wb.compass.pos";
  const HIDE_KEY = "wb.compass.hide";
  let novel = null, num = 0, root = null, tab = "chapter", open = false;

  /* ---------- 工具 ---------- */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function bp() {
    if (!novel) return null;
    return (novel.blueprints || []).find(b => b.chapterNumber === num) || null;
  }
  function ch() {
    if (!novel) return null;
    return (novel.chapters || []).find(c => c.chapterNumber === num) || null;
  }
  /* 节拍：兼容旧数据（纯字符串） */
  function beats() {
    const b = bp();
    if (!b) return [];
    if (!Array.isArray(b.beats)) b.beats = [];
    return b.beats.map(x => (typeof x === "string" ? { text: x, done: false } : x));
  }
  function setBeats(arr) {
    const b = bp();
    if (!b) return;
    b.beats = arr.map(x => (typeof x === "string" ? { text: x, done: false } : x));
  }
  function threadList(key) {
    const b = bp();
    if (!b) return [];
    if (!Array.isArray(b[key])) b[key] = [];
    return b[key].map(x => (typeof x === "string" ? { text: x, done: false } : x));
  }

  function lastNum() {
    return Math.max(0, ...(novel.chapters || []).filter(c => c.content).map(c => c.chapterNumber));
  }
  function dormantOf(t) { return Math.max(0, lastNum() - (t.lastMovedAt || t.plantedAt || 0)); }

  /* ---------- DOM ---------- */
  function ensureDom() {
    if (root && document.body.contains(root)) return root;
    root = document.createElement("div");
    root.className = "cp-hud";
    root.id = "cp-hud";
    document.body.appendChild(root);
    restorePos();
    return root;
  }

  function restorePos() {
    if (!root) return;
    try {
      const p = JSON.parse(localStorage.getItem(POS_KEY) || "null");
      if (p && typeof p.top === "number") {
        root.style.top = p.top + "px";
        root.style.right = "auto";
        root.style.left = p.left + "px";
      }
    } catch (e) {}
  }

  function drag() {
    const pill = root.querySelector(".cp-pill");
    if (!pill) return;
    let sx = 0, sy = 0, ox = 0, oy = 0, moving = false;
    pill.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".cp-x")) return;
      const r = root.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top; moving = false;
      pill.setPointerCapture(e.pointerId);
    });
    pill.addEventListener("pointermove", (e) => {
      if (!pill.hasPointerCapture || !pill.hasPointerCapture(e.pointerId)) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moving && Math.abs(dx) + Math.abs(dy) < 6) return;
      moving = true;
      root.classList.add("dragging");
      const maxL = window.innerWidth - 60, maxT = window.innerHeight - 80;
      const L = Math.min(maxL, Math.max(4, ox + dx));
      const T = Math.min(maxT, Math.max(8, oy + dy));
      root.style.left = L + "px"; root.style.top = T + "px"; root.style.right = "auto";
    });
    pill.addEventListener("pointerup", (e) => {
      if (e.target.closest(".cp-x")) return;
      if (!moving) { toggle(); return; }
      root.classList.remove("dragging");
      const r = root.getBoundingClientRect();
      localStorage.setItem(POS_KEY, JSON.stringify({ left: r.left, top: r.top }));
      // 太靠边就吸回去
      if (r.left > window.innerWidth - 40) {
        root.style.left = "auto"; root.style.right = "12px";
        localStorage.removeItem(POS_KEY);
      }
    });
  }

  /* ---------- 面板 ---------- */
  function stars(v) {
    let out = "";
    for (let i = 1; i <= 5; i++) out += `<button class="cp-star ${i <= v ? "on" : ""}" data-tension="${i}" aria-label="张力 ${i}">●</button>`;
    return out;
  }

  function chapterTab() {
    const b = bp();
    const c = ch();
    const bs = beats();
    const done = bs.filter(x => x.done).length;
    const planted = threadList("plantThreads");
    const payoff = threadList("payoffThreads");
    const words = (c && c.wordCount) || 0;
    const target = (b && b.targetWords) || (novel.config && novel.config.wordsPerChapter) || 3000;
    const pct = Math.min(100, Math.round(words / Math.max(1, target) * 100));
    const openThreads = (novel.threads || []).filter(t => t.status !== "已收");
    const stale = openThreads.filter(t => dormantOf(t) >= 5).sort((a, z) => dormantOf(z) - dormantOf(a)).slice(0, 3);

    return `
      <div class="cp-sec">
        <div class="cp-wordrow">
          <b>${words.toLocaleString()}</b><span>/ ${target.toLocaleString()} 字</span>
          <em class="${pct >= 100 ? "ok" : ""}">${pct}%</em>
        </div>
        <div class="cp-bar"><i style="width:${pct}%"></i></div>
      </div>

      <div class="cp-sec">
        <div class="cp-h"><span>本章任务</span>${b ? `<button class="cp-mini" id="cp-edit-bp">改</button>` : ""}</div>
        ${b
          ? `<div class="cp-goal">${esc(b.purpose || "（没写目的）")}</div>
             ${b.keyEvents ? `<div class="cp-events">${esc(b.keyEvents)}</div>` : ""}
             ${b.suspenseHook ? `<div class="cp-hook"><i>钩</i>${esc(b.suspenseHook)}</div>` : ""}`
          : `<div class="cp-empty">本章还没有蓝图。去「蓝图」页生成，或点下面 AI 拆解。</div>`}
      </div>

      <div class="cp-sec">
        <div class="cp-h"><span>节拍 ${bs.length ? `${done}/${bs.length}` : ""}</span>
          <button class="cp-mini" id="cp-add-beat">+ 加</button></div>
        ${bs.length
          ? `<div class="cp-beats">${bs.map((x, i) => `
              <label class="cp-beat ${x.done ? "done" : ""}" data-beat="${i}">
                <span class="cp-cb">${x.done ? "✓" : ""}</span>
                <span class="cp-bt">${esc(x.text)}</span>
              </label>`).join("")}</div>`
          : `<div class="cp-empty">还没有节拍。点下面「AI 拆本章」，把蓝图拆成可勾的步骤。</div>`}
      </div>

      <div class="cp-sec">
        <div class="cp-h"><span>本章要埋的伏笔</span>${planted.length ? `<em>${planted.filter(x => x.done).length}/${planted.length}</em>` : ""}</div>
        ${planted.length
          ? `<div class="cp-ths">${planted.map((x, i) => `
              <label class="cp-th ${x.done ? "done" : ""}" data-plant="${i}">
                <span class="cp-cb sm">${x.done ? "✓" : ""}</span>
                <span class="cp-tt">${esc(x.text)}</span>
              </label>`).join("")}</div>`
          : `<div class="cp-empty">未指定。生成节拍时会一并给出。</div>`}
      </div>

      ${payoff.length ? `
      <div class="cp-sec">
        <div class="cp-h"><span>本章该收</span><em>${payoff.filter(x => x.done).length}/${payoff.length}</em></div>
        <div class="cp-ths">${payoff.map((x, i) => `
          <label class="cp-th ${x.done ? "done" : ""}" data-payoff="${i}">
            <span class="cp-cb sm">${x.done ? "✓" : ""}</span>
            <span class="cp-tt">${esc(x.text)}</span>
          </label>`).join("")}</div>
      </div>` : ""}

      ${stale.length ? `
      <div class="cp-sec">
        <div class="cp-h"><span>该捞起来的陈线</span></div>
        <div class="cp-ths">${stale.map(t => `
          <div class="cp-th warn">
            <span class="cp-tt">${esc(t.thread)}<i>${dormantOf(t)} 章未动</i></span>
            <button class="cp-mini" data-move="${esc(t.id)}">已推进</button>
          </div>`).join("")}</div>
      </div>` : ""}

      <div class="cp-sec">
        <div class="cp-h"><span>张力</span></div>
        <div class="cp-stars">${stars((b && b.tension) || 0)}</div>
      </div>

      <div class="cp-acts">
        <button class="cp-btn" id="cp-ai">${b ? "AI 拆本章" : "AI 建章纲"}</button>
        <button class="cp-btn" id="cp-full">完整蓝图</button>
      </div>`;
  }

  function outlineTab() {
    const cfg = novel.config || {};
    const sorted = [...(novel.blueprints || [])].sort((a, b) => a.chapterNumber - b.chapterNumber);
    return `
      <div class="cp-sec">
        <div class="cp-h"><span>故事大纲</span></div>
        <div class="cp-outline">${esc(cfg.coreOutline || "（还没写故事前提）")}</div>
        ${cfg.worldSetting ? `<div class="cp-events" style="margin-top:6px">${esc(cfg.worldSetting).slice(0, 180)}</div>` : ""}
      </div>
      <div class="cp-sec">
        <div class="cp-h"><span>分章章纲</span><em>${sorted.length} 章</em></div>
        ${sorted.length ? `<div class="cp-list">${sorted.map(b => `
          <button class="cp-row ${b.chapterNumber === num ? "cur" : ""}" data-goto="${b.chapterNumber}">
            <span class="cp-no">${b.chapterNumber}</span>
            <span class="cp-t">${esc(b.title || "")}<i>${esc((b.keyEvents || b.purpose || "").slice(0, 34))}</i></span>
          </button>`).join("")}</div>`
          : `<div class="cp-empty">还没有分章蓝图。</div>`}
      </div>`;
  }

  /* 遮罩放在 body 上、层级低于浮窗本体，这样点空白收起，点胶囊仍能操作 */
  function setScrim(on) {
    let s = document.getElementById("cp-scrim");
    if (on && !s) {
      s = document.createElement("div");
      s.id = "cp-scrim";
      s.className = "cp-scrim";
      s.addEventListener("click", () => { open = false; render(); });
      document.body.appendChild(s);
    } else if (!on && s) {
      s.remove();
    }
  }

  function render() {
    if (!root || !novel) return;
    const c = ch();
    const bs = beats();
    const done = bs.filter(x => x.done).length;
    const words = (c && c.wordCount) || 0;
    setScrim(open);
    root.innerHTML = `
      <button class="cp-pill" aria-label="章纲罗盘">
        <i class="cp-dot"></i>
        <span class="cp-pl">章纲</span>
        <b class="cp-pn">${bs.length ? `${done}/${bs.length}` : words ? `${(words / 1000).toFixed(1)}k` : "—"}</b>
        <span class="cp-x" id="cp-close" title="隐藏">×</span>
      </button>
      <div class="cp-panel" ${open ? "" : "hidden"}>
        <div class="cp-tabs">
          <button class="cp-tab ${tab === "chapter" ? "on" : ""}" data-tab="chapter">本章</button>
          <button class="cp-tab ${tab === "outline" ? "on" : ""}" data-tab="outline">大纲</button>
          <span class="cp-ch">第${num}章</span>
        </div>
        <div class="cp-body">${tab === "chapter" ? chapterTab() : outlineTab()}</div>
      </div>`;
    root.classList.toggle("open", open);
    bind();
  }

  function persist() {
    if (!novel) return;
    if (typeof saveNovel === "function") saveNovel(true);
    else DB.putNovel(novel);
  }

  function bind() {
    drag();
    const q = (s) => root.querySelector(s);
    const qa = (s) => Array.from(root.querySelectorAll(s));

    qa("[data-tab]").forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      tab = b.dataset.tab; render();
    });
    q("#cp-close").onclick = (e) => {
      e.stopPropagation();
      localStorage.setItem(HIDE_KEY, "1");
      destroy();
      if (typeof toast === "function") toast("章纲罗盘已隐藏，可在设置里重新打开");
    };

    qa("[data-beat]").forEach(el => el.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      const i = +el.dataset.beat;
      const arr = beats();
      arr[i].done = !arr[i].done;
      setBeats(arr); persist(); render();
    });

    qa("[data-plant]").forEach(el => el.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      const i = +el.dataset.plant;
      const b = bp(); const list = threadList("plantThreads");
      const item = list[i];
      item.done = !item.done;
      b.plantThreads = list;
      if (item.done) {
        novel.threads = novel.threads || [];
        const exist = novel.threads.find(t => t.thread === item.text);
        if (!exist) novel.threads.push({ id: "t" + Math.random().toString(36).slice(2, 7), thread: item.text, status: "已埋", plantedAt: num, lastMovedAt: num });
        else { exist.lastMovedAt = num; }
        if (typeof toast === "function") toast("已记入线索表");
      }
      persist(); render();
    });

    qa("[data-payoff]").forEach(el => el.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      const i = +el.dataset.payoff;
      const b = bp(); const list = threadList("payoffThreads");
      list[i].done = !list[i].done;
      b.payoffThreads = list;
      if (list[i].done) {
        const t = (novel.threads || []).find(t => t.thread === list[i].text || list[i].text.includes(t.thread));
        if (t) { t.status = "已收"; t.lastMovedAt = num; }
      }
      persist(); render();
    });

    qa("[data-move]").forEach(el => el.onclick = (e) => {
      e.stopPropagation();
      const t = (novel.threads || []).find(x => x.id === el.dataset.move);
      if (t) { t.lastMovedAt = num; persist(); render(); if (typeof toast === "function") toast(`「${t.thread}」标记为本章推进`); }
    });

    qa("[data-tension]").forEach(el => el.onclick = (e) => {
      e.stopPropagation();
      const b = bp();
      if (!b) return;
      b.tension = +el.dataset.tension;
      persist(); render();
    });

    qa("[data-goto]").forEach(el => el.onclick = (e) => {
      e.stopPropagation();
      const n = +el.dataset.goto;
      open = false;
      if (typeof nav === "function") nav({ page: "chapter", chNum: n });
    });

    const addBeat = q("#cp-add-beat");
    if (addBeat) addBeat.onclick = (e) => {
      e.stopPropagation();
      const b = bp();
      if (!b) { if (typeof toast === "function") toast("先生成本章蓝图", true); return; }
      const head = addBeat.closest(".cp-h");
      if (!head) return;
      const wrap = document.createElement("div");
      wrap.className = "cp-addrow";
      wrap.innerHTML = '<input class="cp-input" placeholder="谁在哪做什么…" /><button class="cp-mini" id="cp-add-ok">加</button>';
      head.insertAdjacentElement("afterend", wrap);
      addBeat.style.display = "none";
      const inp = wrap.querySelector("input");
      inp.focus();
      const commit = () => {
        const v = inp.value.trim();
        if (!v) { wrap.remove(); addBeat.style.display = ""; return; }
        const arr = beats(); arr.push({ text: v, done: false });
        setBeats(arr); persist(); render();
      };
      wrap.querySelector("#cp-add-ok").onclick = (ev) => { ev.stopPropagation(); commit(); };
      inp.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); ev.stopPropagation(); commit(); } };
    };

    const editBp = q("#cp-edit-bp");
    if (editBp) editBp.onclick = (e) => {
      e.stopPropagation();
      open = false; render();
      if (typeof blueprintSheet === "function") blueprintSheet(num);
    };

    const ai = q("#cp-ai");
    if (ai) ai.onclick = async (e) => {
      e.stopPropagation();
      await aiBreakdown(ai);
    };

    const full = q("#cp-full");
    if (full) full.onclick = (e) => {
      e.stopPropagation();
      open = false; render();
      if (typeof blueprintSheet === "function") blueprintSheet(num);
    };
  }

  /* ---------- AI 拆本章 ---------- */
  async function aiBreakdown(btn) {
    if (!novel) return;
    if (typeof isAssistMode === "function" && isAssistMode()) {
      if (typeof toast === "function") toast("AI 辅助模式下不新增章纲。切到创作模式再用", true);
      return;
    }
    if (typeof ensureModel === "function" && !ensureModel("planning")) return;
    const old = btn.textContent;
    btn.disabled = true; btn.textContent = "拆解中…";
    try {
      // 没有蓝图时先造一个空壳，好让技能有上下文可写回
      if (!bp()) {
        novel.blueprints = novel.blueprints || [];
        novel.blueprints.push({
          chapterNumber: num, title: (ch() && ch().title) || `第${num}章`,
          purpose: "", keyEvents: "", characters: [], suspenseHook: "",
        });
      }
      const out = await Skills.run("blueprint-breakdown", novel, num);
      const d = out.data || {};
      const b = bp();
      if (Array.isArray(d.beats) && d.beats.length) b.beats = d.beats.map(x => ({ text: String(x).trim(), done: false }));
      if (Array.isArray(d.plantThreads)) b.plantThreads = d.plantThreads.slice(0, 3).map(x => ({ text: String(x).trim(), done: false }));
      if (Array.isArray(d.payoffThreads)) b.payoffThreads = d.payoffThreads.slice(0, 3).map(x => ({ text: String(x).trim(), done: false }));
      if (d.tension) b.tension = Math.max(1, Math.min(5, parseInt(d.tension) || 3));
      if (d.targetWords) b.targetWords = parseInt(d.targetWords) || b.targetWords;
      if (d.hook) b.suspenseHook = String(d.hook).trim();
      persist();
      render();
      if (typeof toast === "function") toast(`已拆出 ${(b.beats || []).length} 个节拍`);
    } catch (err) {
      btn.disabled = false; btn.textContent = old;
      if (typeof toast === "function") toast(err.message || "拆解失败", true);
    }
  }

  /* ---------- 周期刷新（字数变了同步） ---------- */
  let timer = 0;
  function startTimer() {
    clearInterval(timer);
    timer = setInterval(() => {
      if (!root || !document.body.contains(root)) return;
      const c = ch();
      const w = (c && c.wordCount) || 0;
      const b = bp();
      const bs = beats();
      const pn = root.querySelector(".cp-pn");
      if (pn) {
        const done = bs.filter(x => x.done).length;
        pn.textContent = bs.length ? `${done}/${bs.length}` : w ? `${(w / 1000).toFixed(1)}k` : "—";
      }
      if (open && b) {
        const bar = root.querySelector(".cp-bar i");
        const wr = root.querySelector(".cp-wordrow b");
        const target = b.targetWords || (novel.config && novel.config.wordsPerChapter) || 3000;
        const pct = Math.min(100, Math.round(w / Math.max(1, target) * 100));
        if (bar) bar.style.width = pct + "%";
        if (wr) wr.textContent = w.toLocaleString();
      }
    }, 1200);
  }

  /* ---------- 对外 ---------- */
  function mount(n, chNum) {
    if (!n) { destroy(); return; }
    if (localStorage.getItem(HIDE_KEY) === "1") return;
    novel = n; num = chNum;
    ensureDom();
    /* 每次进入正文页都收起：展开态带遮罩，留着会挡住工具栏 */
    open = false;
    render();
    startTimer();
  }

  function destroy() {
    clearInterval(timer); timer = 0;
    setScrim(false);
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null; open = false;
  }

  function show(n, chNum) {
    localStorage.removeItem(HIDE_KEY);
    novel = n; num = chNum;
    ensureDom(); render(); startTimer();
  }
  function hide() {
    localStorage.setItem(HIDE_KEY, "1");
    destroy();
  }
  function isHidden() { return localStorage.getItem(HIDE_KEY) === "1"; }

  function toggle() {
    open = !open;
    if (!root) { ensureDom(); }
    const p = root.querySelector(".cp-panel");
    if (p) p.hidden = !open;
    root.classList.toggle("open", open);
    setScrim(open);
    if (open) render();
  }

  /* 返回键用：收起面板并撤掉遮罩 */
  function closePanel() {
    if (!open) return false;
    open = false;
    setScrim(false);
    if (root) {
      const p = root.querySelector(".cp-panel");
      if (p) p.hidden = true;
      root.classList.remove("open");
    }
    return true;
  }

  window.Compass = { mount, destroy, show, hide, isHidden, toggle, closePanel, isOpen: () => open, refresh: render };
})();
