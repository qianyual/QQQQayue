const { chromium } = require("playwright-core");
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log("PASS | " + name); } else { fail++; console.log("FAIL | " + name + (extra ? " — " + extra : "")); } };

(async () => {
  const browser = await chromium.launch({ executablePath: "C://Program Files (x86)//Microsoft//Edge//Application//msedge.exe", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push(e.message));
  await page.goto("http://127.0.0.1:4173/index.html", { waitUntil: "load" });
  await page.waitForTimeout(900);

  // 建书
  await page.click("#btn-new");
  await page.fill("#np-name", "功能测试书");
  await page.click("#np-blank");
  await page.waitForTimeout(600);

  // T1 底部导航有 5 个 tab，含「角色」
  const tabs = await page.$$eval(".bottom-nav button", els => els.map(e => e.textContent.trim()));
  t("T1 五个阶段入口含角色", tabs.length === 5 && tabs.some(x => x.includes("角色")), tabs.join("/"));

  // T2 角色页空状态 + 新建
  await page.click('.bottom-nav button[data-tab="chars"]');
  await page.waitForTimeout(500);
  let html = await page.innerHTML("#app");
  t("T2 角色页可进入", html.includes("角色名单") && html.includes("从架构抽取"));
  await page.click("#cr-new");
  await page.waitForTimeout(400);
  await page.fill('[data-ch="name"]', "林野");
  await page.fill('[data-ch="personality"]', "沉默，认死理");
  await page.fill('[data-state="location"]', "废土集市");
  await page.click("#cs-save");
  await page.waitForTimeout(600);
  html = await page.innerHTML("#app");
  t("T3 角色保存并显示当前状态", html.includes("林野") && html.includes("废土集市"));

  // T4 更多菜单
  await page.click("#btn-export");
  await page.waitForTimeout(400);
  html = await page.innerHTML("#modal-layer");
  t("T4 更多菜单含剧情/统计/清除", html.includes("剧情与伏笔") && html.includes("写作统计") && html.includes("清除生成内容"));

  // T5 剧情与伏笔
  await page.click("#mo-threads");
  await page.waitForTimeout(500);
  html = await page.innerHTML("#modal-layer");
  t("T5 伏笔面板可打开", html.includes("剧情与伏笔"));
  await page.click("#th-add");
  await page.waitForTimeout(400);
  await page.fill("#th-text", "主角母亲留下的铜钱");
  await page.click("#th-save");
  await page.waitForTimeout(600);
  await page.click("#btn-export");
  await page.waitForTimeout(300);
  await page.click("#mo-threads");
  await page.waitForTimeout(500);
  html = await page.innerHTML("#modal-layer");
  t("T6 线索已保存", html.includes("铜钱"));

  // T7 统计面板
  await page.evaluate(() => closeSheet());
  await page.click("#btn-export");
  await page.waitForTimeout(300);
  await page.click("#mo-stats");
  await page.waitForTimeout(700);
  html = await page.innerHTML("#modal-layer");
  t("T7 统计面板有字数/调用", html.includes("正文字数") && html.includes("AI 调用"), html.slice(0, 60));

  // T8 审稿报告勾选
  await page.evaluate(() => closeSheet());
  await page.evaluate(() => {
    reviewSheet([
      { severity: "high", dimension: "角色状态", comment: "主角左臂已有伤，本章却用左手搬重物", quote: "抬起左手" },
      { severity: "medium", dimension: "剧情合理性", comment: "反派动机不足，缺少交代", quote: "" },
    ], { num: 1 });
  });
  await page.waitForTimeout(500);
  const cbCount = await page.$$eval(".rv-cb", els => els.length);
  const checkedDefault = await page.$$eval(".rv-cb", els => els.filter(e => e.checked).length);
  t("T8 审稿报告有勾选框且默认选严重项", cbCount === 2 && checkedDefault === 1, `cb=${cbCount} checked=${checkedDefault}`);
  await page.click("#rv-none");
  await page.waitForTimeout(200);
  const afterNone = await page.$$eval(".rv-cb", els => els.filter(e => e.checked).length);
  await page.click("#rv-all-high");
  await page.waitForTimeout(200);
  const afterHigh = await page.$$eval(".rv-cb", els => els.filter(e => e.checked).length);
  t("T9 全选/全不选可用", afterNone === 0 && afterHigh === 1, `none=${afterNone} high=${afterHigh}`);

  // T10 事实注入到写作 prompt
  await page.evaluate(() => closeSheet());
  const injected = await page.evaluate(async () => {
    const n = State.novel;
    n.chapters.push({ chapterNumber: 1, title: "第1章", status: "定稿", content: "第一章正文内容。", summary: "摘要", wordCount: 8, versions: [] });
    n.facts = [{ chapterNumber: 1, characterStates: [{ name: "林野", location: "废土集市", condition: "左臂受伤" }], timeline: "第三日傍晚", openThreads: [], plotFacts: ["集市被焚"] }];
    const b = { chapterNumber: 2, title: "第2章", keyEvents: "继续", characters: ["林野"] };
    const msgs = await buildChapterPrompt(n, 2, b, { content: "" });
    return msgs[msgs.length - 1].content;
  });
  t("T10 已定稿事实注入写章 prompt", injected.includes("连续性事实") && injected.includes("左臂受伤"), injected.slice(0, 80));

  // T11 沉浸模式（操作已收进右侧抽屉，先点胶囊唤出）
  await page.evaluate(() => { State.route = { page: "chapter", novelId: State.novel.id, chNum: 1 }; render(); });
  await page.waitForTimeout(600);
  await page.click("#ch-tools");
  await page.waitForTimeout(380);
  await page.click("#ch-immersive");
  await page.waitForTimeout(300);
  const immersive = await page.evaluate(() => document.body.classList.contains("immersive"));
  const toolbarHidden = await page.evaluate(() => {
    const el = document.querySelector(".ed-drawer");
    return el ? getComputedStyle(el).display === "none" : false;
  });
  t("T11 沉浸模式隐藏外壳", immersive && toolbarHidden);
  await page.click("#ch-exit-immersive");
  await page.waitForTimeout(300);
  const exited = await page.evaluate(() => !document.body.classList.contains("immersive"));
  t("T12 可退出沉浸", exited);

  t("T13 全程无 JS 错误", errs.length === 0, errs.slice(0, 3).join(" / "));
  console.log(`\n======== SUMMARY: ${pass}/${pass + fail} passed ========`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
