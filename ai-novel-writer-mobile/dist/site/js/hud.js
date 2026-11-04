/* ============================================================
   码字仪表（悬浮窗）
   ------------------------------------------------------------
   参考了几个开源实现的做法，没有直接引依赖，按移动端重写：
   · yilujian/easy-writing       —— 今日字数 / 目标 / 手写与 AI 产出分开记账
   · Novel-Helper-Project/andrea-novel-helper —— CPM 实时码字速度
   · ZZ0R0/Overlay (typing-pause-overlay) —— writing / idle 双计时、闲置提醒
   · lociere/novel-helper        —— 累计码字时间、平均速度
   纯本地：数据只写进 IndexedDB（kv），不联网、不上报。
   ============================================================ */
(function () {
  "use strict";

  const IDLE_GAP = 8000;        // 8 秒没有输入 → 开始计「摸鱼」
  const IDLE_WARN = 180000;     // 摸鱼超过 3 分钟 → 变琥珀色提示
  const TICK = 1000;
  const KEEP_DAYS = 60;
  const STORE_KEY = "writingStats";

  /* ---------------- 状态 ---------------- */
  let mainEl = null, pillEl = null, panelEl = null;
  let ta = null, lastLen = 0, lastInputAt = 0;
  let timer = 0, lastTick = 0, saveTick = 0;
  let enabled = true, paused = false;
  let store = { days: {}, goal: 3000 };
  let session = null;           // { startAt, activeMs, idleMs, hand, ai, samples: [] }
  let dirty = false;

  /* ---------------- 小工具 ---------------- */
  const pad = (n) => String(n).padStart(2, "0");
  function dayKey(d) {
    const x = d || new Date();
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  }
  function today() {
    const k = dayKey();
    if (!store.days[k]) store.days[k] = { hand: 0, ai: 0, activeMs: 0, idleMs: 0 };
    return store.days[k];
  }
  function hms(ms, short) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (short) return h ? `${h}h${m}m` : m ? `${m}m` : `${sec}s`;
    return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  }
  const fmtN = (n) => (n || 0).toLocaleString("en-US");
  const charCount = (s) => (s || "").replace(/\s/g, "").length;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------------- 数据持久化 ---------------- */
  function persist(force) {
    if (!DB || !DB.kvSet) return;
    const now = Date.now();
    if (!force && now - saveTick < 8000) { dirty = true; return; }
    saveTick = now; dirty = false;
    const keys = Object.keys(store.days).sort();
    if (keys.length > KEEP_DAYS) keys.slice(0, keys.length - KEEP_DAYS).forEach(k => delete store.days[k]);
    try { DB.kvSet(STORE_KEY, store); } catch (e) {}
  }

  /* ---------------- 计时 ---------------- */
  function resetSession() {
    session = {
      startAt: Date.now(),
      activeMs: 0, idleMs: 0, hand: 0, ai: 0,
      samples: [],           // [{t, n}] 最近 10 分钟
    };
    lastInputAt = 0;
    lastTick = Date.now();
  }

  function tick() {
    if (!enabled || !session) return;
    const now = Date.now();
    const dt = clamp(now - lastTick, 0, 5000);
    lastTick = now;
    if (paused || document.visibilityState === "hidden") return;

    const d = today();
    if (now - lastInputAt <= IDLE_GAP) { session.activeMs += dt; d.activeMs += dt; }
    else { session.idleMs += dt; d.idleMs += dt; }

    /* AI 流式写入不走 input 事件，长度突变时静默对齐，避免把 AI 的字算成手写 */
    if (ta && now - lastInputAt > 1500) {
      const len = charCount(ta.value);
      if (len !== lastLen) lastLen = len;
    }
    paint();
    if (dirty) persist();
    else if (now - saveTick > 15000) persist();
  }

  /* ---------------- 输入采集 ---------------- */
  function onInput() {
    if (!enabled || !session) return;
    const now = Date.now();
    const len = charCount(ta.value);
    const delta = len - lastLen;
    lastLen = len;
    if (delta > 0) {
      session.hand += delta;
      today().hand += delta;
      session.samples.push({ t: now, n: delta });
    }
    lastInputAt = now;
    /* 输入当下的空闲时间由 tick 累计，这里只负责把状态切回「在写」 */
    paint();
    persist();
  }

  function recentChars(windowMs) {
    const now = Date.now();
    return (session ? session.samples : []).filter(s => now - s.t < windowMs).reduce((a, s) => a + s.n, 0);
  }

  /* ---------------- 渲染 ---------------- */
  function ensureDom() {
    if (mainEl) return;
    mainEl = document.createElement("div");
    mainEl.id = "wb-hud";
    mainEl.className = "wb-hud";
    mainEl.hidden = true;
    mainEl.innerHTML = `
      <button class="wb-pill" id="wb-pill" aria-label="码字仪表">
        <span class="wb-lead"><i id="wb-dot"></i></span>
        <span class="wb-body">
          <span class="wb-l1"><b id="wb-cpm">0</b><em>字/分</em></span>
          <span class="wb-l2" id="wb-line2">今日 0 字</span>
        </span>
      </button>
      <div class="wb-panel" id="wb-panel" hidden>
        <div class="wb-ph">
          <span>码字仪表</span>
          <button class="wb-x" id="wb-x" aria-label="收起">×</button>
        </div>
        <div class="wb-grid">
          <div><b id="wb-s-active">00:00</b><span>本次写作</span></div>
          <div><b id="wb-s-idle" class="warm">00:00</b><span>本次摸鱼</span></div>
          <div><b id="wb-s-avg">0</b><span>平均 字/分</span></div>
        </div>
        <div class="wb-day">
          <div class="wb-day-h"><span>今日</span><b id="wb-day-chars">0 字</b></div>
          <div class="wb-bar"><i id="wb-goal-bar"></i></div>
          <div class="wb-day-f" id="wb-day-foot">手写 0 · AI 0</div>
        </div>
        <div class="wb-spark-cap"><span>近 10 分钟</span><b id="wb-peak"></b></div>
        <div class="wb-spark" id="wb-spark"></div>
        <div class="wb-acts">
          <button id="wb-pause">暂停</button>
          <button id="wb-reset">清零本次</button>
          <button id="wb-hide">隐藏</button>
        </div>
      </div>`;
    document.body.appendChild(mainEl);
    bindDom();
    restorePos();
  }

  function bindDom() {
    pillEl = document.getElementById("wb-pill");
    panelEl = document.getElementById("wb-panel");

    let drag = null;
    const onDown = (e) => {
      const r = mainEl.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false, pid: e.pointerId };
      mainEl.classList.add("dragging");
      try { pillEl.setPointerCapture(e.pointerId); } catch (err) {}
    };
    const onMove = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      drag.moved = true;
      const w = mainEl.offsetWidth, h = mainEl.offsetHeight;
      const left = clamp(drag.left + dx, 6, window.innerWidth - w - 6);
      const top = clamp(drag.top + dy, 56, window.innerHeight - h - 6);
      mainEl.style.left = left + "px";
      mainEl.style.top = top + "px";
      mainEl.style.right = "auto";
      mainEl.style.bottom = "auto";
    };
    const onUp = () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      mainEl.classList.remove("dragging");
      if (moved) savePos();
      else togglePanel();
    };
    pillEl.addEventListener("pointerdown", onDown);
    pillEl.addEventListener("pointermove", onMove);
    pillEl.addEventListener("pointerup", onUp);
    pillEl.addEventListener("pointercancel", () => { drag = null; mainEl.classList.remove("dragging"); });

    document.getElementById("wb-x").onclick = (e) => { e.stopPropagation(); togglePanel(false); };
    document.getElementById("wb-pause").onclick = (e) => {
      e.stopPropagation();
      paused = !paused;
      lastTick = Date.now();
      e.currentTarget.textContent = paused ? "继续" : "暂停";
      mainEl.classList.toggle("paused", paused);
      paint();
    };
    document.getElementById("wb-reset").onclick = (e) => {
      e.stopPropagation();
      resetSession();
      paint();
      persist(true);
    };
    document.getElementById("wb-hide").onclick = (e) => {
      e.stopPropagation();
      setEnabled(false);
      if (State && State.settings) {
        State.settings.hud = false;
        DB.kvSet("settings", State.settings);
        toast("已隐藏，可在「设置 · 写作仪表」重新打开");
      }
    };
  }

  function savePos() {
    try {
      localStorage.setItem("wb.hud.pos", JSON.stringify({ left: mainEl.offsetLeft, top: mainEl.offsetTop }));
    } catch (e) {}
  }
  function restorePos() {
    try {
      const p = JSON.parse(localStorage.getItem("wb.hud.pos") || "null");
      if (p && typeof p.left === "number") {
        mainEl.style.left = clamp(p.left, 6, window.innerWidth - 140) + "px";
        mainEl.style.top = clamp(p.top, 56, window.innerHeight - 80) + "px";
        mainEl.style.right = "auto";
        mainEl.style.bottom = "auto";
      }
    } catch (e) {}
  }

  function togglePanel(force) {
    ensureDom();
    const open = typeof force === "boolean" ? force : panelEl.hidden;
    panelEl.hidden = !open;
    mainEl.classList.toggle("open", open);
    if (open) paint();
  }

  function paint() {
    if (!mainEl || mainEl.hidden || !session) return;
    const now = Date.now();
    const d = today();
    const cpm = recentChars(60000);
    const avg = session.activeMs > 3000 ? Math.round(session.hand / (session.activeMs / 60000)) : 0;
    const idle = now - lastInputAt > IDLE_GAP ? (now - lastInputAt) : 0;
    const warned = idle > IDLE_WARN;

    setText("wb-cpm", paused ? "—" : String(cpm));
    const line2 = mainEl.querySelector("#wb-line2");
    if (line2) {
      line2.textContent = paused
        ? "已暂停"
        : warned
          ? `已停笔 ${hms(idle)}`
          : `今日 ${fmtN(d.hand)} 字${idle > IDLE_GAP ? " · 停笔 " + hms(idle) : ""}`;
    }
    mainEl.classList.toggle("idle-warn", warned && !paused);
    mainEl.classList.toggle("typing", idle <= IDLE_GAP && !paused);
    /* 长时间没打字（在读稿/想情节）时淡出，别挡住字数；摸鱼提醒态保持清晰 */
    mainEl.classList.toggle("muted", idle > 10000 && !warned && !paused);

    if (!panelEl || panelEl.hidden) return;
    setText("wb-s-active", hms(session.activeMs));
    setText("wb-s-idle", hms(session.idleMs));
    setText("wb-s-avg", String(avg));
    setText("wb-day-chars", fmtN(d.hand + d.ai) + " 字");
    const goal = Math.max(200, store.goal || 3000);
    const pct = clamp((d.hand + d.ai) / goal * 100, 0, 100);
    const bar = document.getElementById("wb-goal-bar");
    if (bar) bar.style.width = pct.toFixed(1) + "%";
    setText("wb-day-foot", `手写 ${fmtN(d.hand)} · AI ${fmtN(d.ai)} · 写作 ${hms(d.activeMs, true)} · 摸鱼 ${hms(d.idleMs, true)}`);
    paintSpark();
  }

  function setText(id, v) {
    const el = document.getElementById(id);
    if (el && el.textContent !== v) el.textContent = v;
  }

  /* 最近 10 分钟，每分钟一根柱 */
  function paintSpark() {
    const host = document.getElementById("wb-spark");
    if (!host) return;
    const now = Date.now();
    const buckets = new Array(10).fill(0);
    (session.samples || []).forEach(s => {
      const idx = 9 - Math.floor((now - s.t) / 60000);
      if (idx >= 0 && idx < 10) buckets[idx] += s.n;
    });
    const max = Math.max(1, ...buckets);
    host.innerHTML = buckets.map((n, i) => {
      const h = n ? Math.max(8, Math.round(n / max * 100)) : 3;
      return `<i style="height:${h}%" class="${i === 9 ? "now" : ""}" title="${n} 字"></i>`;
    }).join("");
    const peak = Math.max(...buckets);
    const pk = document.getElementById("wb-peak");
    if (pk) pk.textContent = peak ? `峰值 ${peak} 字/分` : "";
  }

  /* ---------------- 对外接口 ---------------- */
  const HUD = {
    /** 启动/恢复本次写作会话（编辑器渲染后调用） */
    start(textarea) {
      if (!enabled) return;
      ensureDom();
      if (!session) resetSession();
      lastTick = Date.now();
      if (ta && ta !== textarea) ta.removeEventListener("input", onInput);
      ta = textarea;
      lastLen = charCount(ta.value);
      lastInputAt = Date.now();
      if (!ta._wbBound) { ta.addEventListener("input", onInput); ta._wbBound = true; }
      mainEl.hidden = false;
      clearInterval(timer);
      timer = setInterval(tick, TICK);
      paint();
    },
    /** 离开编辑页：结账并隐藏 */
    stop() {
      if (session) persist(true);
      clearInterval(timer);
      timer = 0;
      session = null;
      if (mainEl) { mainEl.hidden = true; togglePanel(false); }
      ta = null;
    },
    /** AI 生成的字单独记账，不混进手写速度 */
    addAI(n) {
      const v = Math.max(0, n | 0);
      if (!v) return;
      today().ai += v;
      if (session) session.ai += v;
      dirty = true;
      paint();
      persist();
    },
    /** 生成结束后把文本长度对齐，避免下次手写把 AI 的字算成自己的 */
    sync() {
      if (!ta) { lastLen = 0; return; }
      lastLen = charCount(ta.value);
      lastInputAt = Date.now();
    },
    setEnabled(on) {
      enabled = !!on;
      ensureDom();
      if (!enabled) { mainEl.hidden = true; togglePanel(false); clearInterval(timer); timer = 0; session = null; }
    },
    isEnabled() { return enabled; },
    open() { ensureDom(); mainEl.hidden = false; togglePanel(true); },
    /* 返回键用：展开面板时先收起 */
    isOpen() { return !!(panelEl && !panelEl.hidden && mainEl && !mainEl.hidden); },
    close() { togglePanel(false); },
    /** 手动改每日目标 */
    setGoal(n) { store.goal = clamp(parseInt(n) || 3000, 200, 50000); persist(true); paint(); },
    getGoal() { return store.goal || 3000; },
    /** 今日汇总，给「我的」页用 */
    summary() {
      const d = today();
      return { hand: d.hand, ai: d.ai, activeMs: d.activeMs, idleMs: d.idleMs, goal: store.goal || 3000, days: store.days };
    },
    /** 清空今日统计（历史日期保留） */
    resetToday() {
      const k = dayKey();
      store.days[k] = { hand: 0, ai: 0, activeMs: 0, idleMs: 0 };
      resetSession();
      dirty = true;
      persist(true);
      paint();
    },
    async load() {
      try {
        const s = await DB.kvGet(STORE_KEY, null);
        if (s && s.days) store = { days: s.days, goal: s.goal || 3000 };
      } catch (e) {}
      ensureDom();
    },
  };

  /* 切后台/翻页时落盘，避免节流期内丢数据 */
  document.addEventListener("visibilitychange", () => {
    if (!session) return;
    if (document.visibilityState === "hidden") persist(true);
    else lastTick = Date.now();
  });
  window.addEventListener("pagehide", () => { if (session) persist(true); });
  window.addEventListener("resize", () => {
    if (!mainEl || mainEl.hidden) return;
    if (mainEl.style.left) savePos();
  });

  window.HUD = HUD;
})();
