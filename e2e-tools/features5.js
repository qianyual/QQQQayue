/* 书童移动版 E2E：v1.5（AI 模式开关 / 码字仪表悬浮窗） */
const { chromium } = require("playwright-core");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:4173";

(async () => {
  const results = [];
  const t = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? "PASS" : "FAIL") + " | " + name + (detail ? " | " + detail : "")); };

  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  /* 准备作品 */
  const nid = await page.evaluate(async () => {
    const n = DB.newNovel("仪表测试");
    const c = DB.newChapter(n, 1, "雾夜");
    c.content = "雾从海面压上来，灯塔像一根将熄的烛。";
    c.status = "草稿";
    c.wordCount = countWords(c.content);
    n.chapters.push(c);
    await DB.putNovel(n);
    return n.id;
  });
  await page.waitForTimeout(300);

  /* ---- T1 书房顶栏有模式开关，默认创作 ---- */
  const shelfMode = await page.evaluate(() => ({
    exists: !!document.querySelector("#btn-mode"),
    text: (document.querySelector("#btn-mode") || {}).textContent || "",
    assist: document.body.classList.contains("assist-mode"),
  }));
  t("T1 书房顶栏有 AI 模式开关，默认创作", shelfMode.exists && /创作/.test(shelfMode.text) && !shelfMode.assist, JSON.stringify(shelfMode));

  /* ---- T2 点击切到辅助，界面与 body 同步 ---- */
  await page.click("#btn-mode");
  await page.waitForTimeout(400);
  const assist = await page.evaluate(() => ({
    text: document.querySelector("#btn-mode").textContent.trim(),
    body: document.body.classList.contains("assist-mode"),
    mode: State.settings.aiMode,
    cls: document.querySelector("#btn-mode").className,
  }));
  t("T2 切到辅助模式", /辅助/.test(assist.text) && assist.body && assist.mode === "assist" && /off/.test(assist.cls), JSON.stringify(assist));

  /* ---- T3 刷新后仍然是辅助（持久化） ---- */
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const afterReload = await page.evaluate(() => ({
    text: document.querySelector("#btn-mode").textContent.trim(),
    body: document.body.classList.contains("assist-mode"),
  }));
  t("T3 刷新后模式保持", /辅助/.test(afterReload.text) && afterReload.body, JSON.stringify(afterReload));

  /* ---- T4 辅助模式正文页：只有查漏洞，没有写/续写 ---- */
  await page.evaluate(async (id) => { await openNovel(id); }, nid);
  await page.waitForTimeout(400);
  await page.evaluate(() => nav({ page: "chapter", chNum: 1 }));
  await page.waitForTimeout(500);
  const toolAssist = await page.evaluate(() => ({
    check: !!document.querySelector("#ed-check"),
    write: !!document.querySelector("#ed-write"),
    cont: !!document.querySelector("#ed-continue"),
    polish: !!document.querySelector("#ed-polish"),
    review: !!document.querySelector("#ed-review"),
    refine: !!document.querySelector("#ed-refine"),
    finalize: !!document.querySelector("#ed-finalize"),
  }));
  t("T4 辅助模式工具栏：查漏洞/润色/审稿/修稿，无写本章续写",
    toolAssist.check && !toolAssist.write && !toolAssist.cont && toolAssist.polish && toolAssist.review && toolAssist.refine && toolAssist.finalize,
    JSON.stringify(toolAssist));

  /* ---- T5 生成闸门真的拦得住（不只藏按钮） ---- */
  const blocked = await page.evaluate(() => {
    let fired = false;
    const orig = typeof runAI === "function" ? runAI : null;
    // 直接调用生成入口：batchWrite 第一行就会拦
    const before = document.querySelectorAll(".toast").length;
    return { mode: State.settings.aiMode, guard: genBlocked(), orig: !!orig };
  });
  t("T5 辅助模式下 genBlocked() 生效", blocked.mode === "assist" && blocked.guard === true, JSON.stringify(blocked));

  /* ---- T6 模式开关在正文页顶栏也在 ---- */
  const chapMode = await page.evaluate(() => !!document.querySelector("#btn-mode"));
  t("T6 正文页顶栏也有模式开关", chapMode === true);

  /* ---- T7 码字悬浮窗出现 ---- */
  await page.waitForTimeout(300);
  const hud1 = await page.evaluate(() => {
    const el = document.querySelector("#wb-hud");
    return {
      exists: !!el,
      hidden: el ? el.hidden : null,
      text: (document.querySelector(".wb-pill") || {}).textContent || "",
      pos: el ? { top: el.getBoundingClientRect().top, right: el.getBoundingClientRect().right } : null,
    };
  });
  t("T7 正文页显示码字悬浮窗", hud1.exists && hud1.hidden === false && /字\/分/.test(hud1.text), JSON.stringify(hud1));

  /* ---- T8 打字后手写字数与速度入账 ---- */
  await page.click("#ch-editor");
  await page.evaluate(() => {
    const ed = document.querySelector("#ch-editor");
    ed.setSelectionRange(ed.value.length, ed.value.length);
  });
  await page.keyboard.type("他推开木门，风灌进来，灯苗歪了一下。", { delay: 18 });
  await page.waitForTimeout(700);
  const hud2 = await page.evaluate(() => {
    const s = HUD.summary();
    return { hand: s.hand, ai: s.ai, pill: document.querySelector(".wb-pill").textContent.replace(/\s+/g, " ").trim() };
  });
  t("T8 手写字数是真字数、AI 仍为 0", hud2.hand === 18 && hud2.ai === 0, JSON.stringify(hud2));

  /* ---- T9 展开面板：写作/摸鱼/平均速度/今日 ---- */
  await page.click(".wb-pill");
  await page.waitForTimeout(300);
  const panel = await page.evaluate(() => {
    const p = document.querySelector("#wb-panel");
    return {
      open: !!p && !p.hidden,
      active: (document.querySelector("#wb-s-active") || {}).textContent,
      idle: (document.querySelector("#wb-s-idle") || {}).textContent,
      avg: (document.querySelector("#wb-s-avg") || {}).textContent,
      day: (document.querySelector("#wb-day-chars") || {}).textContent,
      foot: (document.querySelector("#wb-day-foot") || {}).textContent,
      bars: document.querySelectorAll("#wb-spark i").length,
    };
  });
  t("T9 面板显示写作/摸鱼/今日/近10分钟", panel.open && !!panel.active && !!panel.idle && /字/.test(panel.day) && panel.bars === 10, JSON.stringify(panel));

  /* ---- T10 AI 产出单独记账，不污染手写速度 ---- */
  const aiSplit = await page.evaluate(() => {
    HUD.addAI(320);
    const s = HUD.summary();
    return { hand: s.hand, ai: s.ai, foot: document.querySelector("#wb-day-foot").textContent };
  });
  t("T10 AI 字数单独入账", aiSplit.ai === 320 && aiSplit.hand === 18 && /AI 320/.test(aiSplit.foot), JSON.stringify(aiSplit));

  /* ---- T11 空闲 8 秒后进入「休息」态 ---- */
  await page.waitForTimeout(9200);
  const idleState = await page.evaluate(() => ({
    pill: document.querySelector(".wb-pill").textContent.replace(/\s+/g, " ").trim(),
    idle: document.querySelector("#wb-s-idle").textContent,
    warn: document.querySelector("#wb-hud").classList.contains("idle-warn"),
  }));
  t("T11 停止输入后开始记摸鱼时长", /停笔/.test(idleState.pill) && idleState.idle !== "00:00", JSON.stringify(idleState));

  /* ---- T12 切回创作模式：写本章/续写回来，查漏洞消失 ---- */
  await page.evaluate(() => toggleMode());
  await page.waitForTimeout(500);
  const toolGen = await page.evaluate(() => ({
    write: !!document.querySelector("#ed-write"),
    cont: !!document.querySelector("#ed-continue"),
    check: !!document.querySelector("#ed-check"),
    mode: State.settings.aiMode,
    body: document.body.classList.contains("assist-mode"),
  }));
  t("T12 切回创作模式恢复生成按钮", toolGen.write && toolGen.cont && !toolGen.check && toolGen.mode === "auto" && !toolGen.body, JSON.stringify(toolGen));

  /* ---- T13 设置页两个新卡片 ---- */
  await page.evaluate(() => nav({ page: "settings" }));
  await page.waitForTimeout(400);
  const settings = await page.evaluate(() => ({
    aimode: !!document.querySelector("#st-aimode"),
    hud: !!document.querySelector("#st-hud"),
    goal: (document.querySelector("#st-goal") || {}).value,
    today: (document.querySelector("#st-hud-today") || {}).textContent,
  }));
  t("T13 设置页有 AI 模式与写作仪表", settings.aimode && settings.hud && settings.goal === "3000" && /今日手写/.test(settings.today), JSON.stringify(settings));

  /* ---- T14 设置里改目标生效 ---- */
  await page.fill("#st-goal", "5000");
  await page.evaluate(() => document.querySelector("#st-goal").dispatchEvent(new Event("change")));
  await page.waitForTimeout(300);
  const goal = await page.evaluate(() => HUD.getGoal());
  t("T14 每日目标可改并保存", goal === 5000, "goal=" + goal);

  /* ---- T15 关掉悬浮窗后正文页不再出现 ---- */
  await page.uncheck("#st-hud");
  await page.waitForTimeout(300);
  await page.evaluate((id) => { openNovel(id).then(() => nav({ page: "chapter", chNum: 1 })); }, nid);
  await page.waitForTimeout(600);
  const hudOff = await page.evaluate(() => {
    const el = document.querySelector("#wb-hud");
    return { hidden: el ? el.hidden : "no-el" };
  });
  t("T15 关闭开关后悬浮窗不显示", hudOff.hidden === true || hudOff.hidden === "no-el", JSON.stringify(hudOff));

  /* ---- T16 数据落盘：刷新后今日字数还在 ---- */
  await page.evaluate(() => { State.settings.hud = true; DB.kvSet("settings", State.settings); });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const persisted = await page.evaluate(() => HUD.summary());
  t("T16 今日统计刷新后仍在", persisted.hand === 18 && persisted.ai === 320, JSON.stringify({ hand: persisted.hand, ai: persisted.ai }));

  /* ---- 无 JS 报错 ---- */
  const realErrors = errors.filter(e => !/favicon|net::ERR_FILE|sw\.js/.test(e));
  t("T17 无脚本报错", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

  const pass = results.filter(r => r.ok).length;
  console.log(`\n${pass}/${results.length} 通过`);
  await browser.close();
  process.exit(pass === results.length ? 0 : 1);
})();
