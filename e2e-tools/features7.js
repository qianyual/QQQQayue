/* 书童移动版 E2E：v1.7（物理返回键逐级返回 + 各层浮层优先消费） */
const { chromium } = require("playwright-core");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:4173";

(async () => {
  const results = [];
  const t = (name, ok, detail) => {
    results.push({ name, ok });
    console.log((ok ? "PASS" : "FAIL") + " | " + name + (detail ? " | " + detail : ""));
  };

  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  /* 造一本带正文的书 */
  await page.evaluate(async () => {
    localStorage.clear();
    const n = DB.newNovel("返回键测试");
    n.config.coreOutline = "守塔人在雾夜收到十年前的信。";
    const c = DB.newChapter(n, 1, "雾港来信");
    c.content = "雾从海面压上来，把灯塔裹成一根将熄的烛。";
    c.wordCount = countWords(c.content);
    c.status = "草稿";
    n.chapters.push(c);
    await DB.putNovel(n);
    State.novel = n;
    State.stack = [{ page: "shelf" }];
    State.depth = 0;
    history.replaceState({ idx: 1 }, "", location.pathname);
    nav({ page: "shelf" }, { replace: true });
  });
  await page.waitForTimeout(400);

  /* T1 原生调用的入口存在 */
  const hasFn = await page.evaluate(() => typeof window.__wbBack === "function");
  t("T1 暴露 window.__wbBack 给原生返回键", hasFn === true, String(hasFn));

  /* T2 根页面第一次按返回：拦下并提示，不退出 */
  const first = await page.evaluate(() => window.__wbBack());
  const toastText = await page.evaluate(() => {
    const el = document.querySelector("#toast-layer .toast");
    return el ? el.textContent : "";
  });
  t("T2 书房按返回先提示「再按一次」而不退出",
    first === true && /再按一次/.test(toastText), `handled=${first} toast=${toastText}`);

  /* T3 两秒内再按一次：交回系统（原生最小化） */
  const second = await page.evaluate(() => window.__wbBack());
  t("T3 连续两次按返回才交回系统", second === false, String(second));

  /* T4 进作品 → 进正文 → 返回回到作品页 */
  await page.evaluate(() => nav({ page: "novel", novelId: State.novel.id, tab: "chapters" }));
  await page.waitForTimeout(200);
  await page.evaluate(() => nav({ page: "chapter", chNum: 1 }));
  await page.waitForTimeout(300);
  const beforeBack = await page.evaluate(() => ({ page: State.route.page, stack: State.stack.length }));
  await page.evaluate(() => window.__wbBack());
  await page.waitForTimeout(260);
  const afterBack = await page.evaluate(() => ({ page: State.route.page, stack: State.stack.length }));
  t("T4 正文页按返回回到作品页，不退出",
    beforeBack.page === "chapter" && afterBack.page === "novel" && afterBack.stack === 2,
    JSON.stringify({ beforeBack, afterBack }));

  /* T5 再按一次回到书房 */
  await page.evaluate(() => window.__wbBack());
  await page.waitForTimeout(260);
  const shelf = await page.evaluate(() => ({ page: State.route.page, stack: State.stack.length }));
  t("T5 作品页再按返回回到书房", shelf.page === "shelf" && shelf.stack === 1, JSON.stringify(shelf));

  /* T6 弹层优先：sheet 打开时返回只关 sheet */
  await page.evaluate(() => {
    nav({ page: "novel", novelId: State.novel.id, tab: "chapters" });
    nav({ page: "chapter", chNum: 1 });
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => openSheet("<h3>测试弹层</h3><p>内容</p>"));
  const sheetHandled = await page.evaluate(() => window.__wbBack());
  await page.waitForTimeout(180);
  const sheetAfter = await page.evaluate(() => ({
    open: !!document.querySelector("#modal-layer .sheet"),
    page: State.route.page,
    stack: State.stack.length,
  }));
  t("T6 有弹层时返回只关弹层、页面不动",
    sheetHandled === true && sheetAfter.open === false && sheetAfter.page === "chapter" && sheetAfter.stack === 3,
    JSON.stringify(sheetAfter));

  /* T7 沉浸写作：返回先退沉浸 */
  await page.evaluate(() => document.body.classList.add("immersive"));
  const immHandled = await page.evaluate(() => window.__wbBack());
  await page.waitForTimeout(150);
  const immAfter = await page.evaluate(() => ({
    imm: document.body.classList.contains("immersive"),
    page: State.route.page,
  }));
  t("T7 沉浸模式按返回先退出沉浸", immHandled === true && immAfter.imm === false && immAfter.page === "chapter",
    JSON.stringify(immAfter));

  /* T8 章纲罗盘展开时：返回只收罗盘（连同遮罩） */
  await page.evaluate(() => { if (!Compass.isOpen()) Compass.toggle(); });
  await page.waitForTimeout(220);
  const cpBefore = await page.evaluate(() => ({
    open: Compass.isOpen(),
    scrim: !!document.getElementById("cp-scrim"),
  }));
  await page.evaluate(() => window.__wbBack());
  await page.waitForTimeout(220);
  const cpAfter = await page.evaluate(() => ({
    open: Compass.isOpen(),
    scrim: !!document.getElementById("cp-scrim"),
    page: State.route.page,
  }));
  t("T8 罗盘展开时返回只收罗盘并撤掉遮罩",
    cpBefore.open === true && cpAfter.open === false && cpAfter.scrim === false && cpAfter.page === "chapter",
    JSON.stringify({ cpBefore, cpAfter }));

  /* T9 码字仪表面板展开时：返回先收面板 */
  await page.evaluate(() => { if (window.HUD) HUD.open(); });
  await page.waitForTimeout(200);
  const hudBefore = await page.evaluate(() => (window.HUD ? HUD.isOpen() : false));
  await page.evaluate(() => window.__wbBack());
  await page.waitForTimeout(180);
  const hudAfter = await page.evaluate(() => ({
    open: window.HUD ? HUD.isOpen() : false,
    page: State.route.page,
  }));
  t("T9 码字仪表面板展开时返回只收面板",
    hudBefore === true && hudAfter.open === false && hudAfter.page === "chapter", JSON.stringify(hudAfter));

  /* T10 正文页返回会先落盘未保存的输入 */
  await page.evaluate(() => {
    const ed = document.querySelector("#ch-editor");
    ed.value = ed.value + "  门外传来三长两短的敲击。";
    ed.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(120);
  await page.evaluate(() => window.__wbBack());
  await page.waitForTimeout(400);
  const saved = await page.evaluate(async () => {
    const n = await DB.getNovel(State.novel.id);
    return n.chapters.find(c => c.chapterNumber === 1).content;
  });
  t("T10 按返回前会把正文落盘，不丢字", /三长两短/.test(saved), saved.slice(-18));

  /* T11 浏览器/PWA 的历史返回同样只退一级 */
  await page.evaluate(() => {
    State.stack = [{ page: "shelf" }];
    State.depth = 0;
    history.replaceState({ idx: 1 }, "", location.pathname);
    nav({ page: "novel", novelId: State.novel.id, tab: "chapters" });
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => history.back());
  await page.waitForTimeout(400);
  const pop = await page.evaluate(() => ({ page: State.route.page, stack: State.stack.length }));
  t("T11 浏览器手势返回也只退一级且栈同步", pop.page === "shelf" && pop.stack === 1, JSON.stringify(pop));

  /* T12 页面内返回按钮仍走同一套栈 */
  await page.evaluate(() => {
    nav({ page: "novel", novelId: State.novel.id, tab: "chapters" });
    nav({ page: "chapter", chNum: 1 });
  });
  await page.waitForTimeout(300);
  await page.click("#btn-back");
  await page.waitForTimeout(300);
  const btn = await page.evaluate(() => ({ page: State.route.page, stack: State.stack.length }));
  t("T12 页面内返回按钮与物理返回行为一致", btn.page === "novel" && btn.stack === 2, JSON.stringify(btn));

  /* T13 栈不会因为反复进出而无限增长 */
  await page.evaluate(async () => {
    State.stack = [{ page: "shelf" }];
    history.replaceState({ idx: 1 }, "", location.pathname);
    nav({ page: "shelf" }, { replace: true });
    for (let i = 0; i < 5; i++) {
      nav({ page: "novel", novelId: State.novel.id, tab: "chapters" });
      window.__wbBack();
      await new Promise(r => setTimeout(r, 60));
    }
  });
  await page.waitForTimeout(400);
  const loop = await page.evaluate(() => ({ page: State.route.page, stack: State.stack.length }));
  t("T13 反复进出后仍停在书房且栈长度回到 1", loop.page === "shelf" && loop.stack === 1, JSON.stringify(loop));

  /* T14 无 JS 错误 */
  t("T14 全程无 JS 报错", errors.length === 0, errors.slice(0, 2).join(" ; "));

  await browser.close();
  const pass = results.filter(r => r.ok).length;
  console.log(`\n${pass}/${results.length} 通过`);
  process.exit(pass === results.length ? 0 : 1);
})();
