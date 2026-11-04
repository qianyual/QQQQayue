/* v1.8.2 正文页：右上状态胶囊 + 右侧操作抽屉 */
const { chromium } = require("playwright-core");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:4173";
const OUT = "C:\\Users\\JiaoLong16Pro2025\\WorkBuddy\\2026-11-03-21-38-31\\ui-shots\\";
let pass = 0, fail = 0;
const t = (name, ok, extra) => { console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  → " + extra : "")); ok ? pass++ : fail++; };

(async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await b.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
  const errs = [];
  page.on("pageerror", e => errs.push(e.message));
  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  const nid = await page.evaluate(async () => {
    const n = DB.newNovel("雾港");
    n.config.genre = "悬疑";
    const c = DB.newChapter(n, 1, "雾夜");
    c.content = "雾从海面压上来，把灯塔裹成一根将熄的烛。\n\n林砚把灯芯挑亮，听见门外有人敲门——三长两短。\n\n他握紧了那盏铜灯，指节发白。";
    c.status = "草稿";
    c.wordCount = countWords(c.content);
    n.chapters.push(c);
    await DB.putNovel(n);
    return n.id;
  });
  await page.evaluate(async (id) => { await openNovel(id); nav({ page: "chapter", chNum: 1 }); }, nid);
  await page.waitForTimeout(700);

  /* 1. 抽屉关闭时：正文框应吃满到屏幕底 */
  const closed = await page.evaluate(() => {
    const ed = document.querySelector("#ch-editor");
    const r = ed.getBoundingClientRect();
    const bar = document.querySelector(".editor-toolbar");
    const card = document.querySelector(".editor-card").getBoundingClientRect();
    return {
      edH: Math.round(r.height), edBottom: Math.round(r.bottom),
      winH: window.innerHeight, barExists: !!bar,
      cardGap: Math.round(window.innerHeight - card.bottom),
      pill: !!document.querySelector("#ch-tools"),
      drawerX: Math.round(document.querySelector("#ed-drawer").getBoundingClientRect().left),
    };
  });
  t("顶部状态胶囊存在", closed.pill);
  t("旧底部工具栏已移除", !closed.barExists);
  t("正文框占屏 ≥ 78%", closed.edH / closed.winH >= 0.78, `${closed.edH}/${closed.winH} = ${(closed.edH / closed.winH * 100).toFixed(1)}%`);
  t("正文框底边贴到屏幕底（差<40px）", closed.winH - closed.edBottom < 40, `差 ${closed.winH - closed.edBottom}px`);
  t("抽屉默认在屏外", closed.drawerX >= 412, `left=${closed.drawerX}`);
  await page.screenshot({ path: OUT + "v182-editor-clean.png" });

  /* 2. 点胶囊 → 抽屉滑出 */
  await page.click("#ch-tools");
  await page.waitForTimeout(420);
  const open = await page.evaluate(() => {
    const d = document.querySelector("#ed-drawer").getBoundingClientRect();
    return {
      open: document.body.classList.contains("ed-drawer-open"),
      left: Math.round(d.left), width: Math.round(d.width), right: Math.round(d.right),
      ops: document.querySelectorAll("#ed-drawer .ed-op").length,
      hasWrite: !!document.querySelector("#ed-write"),
      mask: getComputedStyle(document.querySelector("#ed-drawer-mask")).opacity,
    };
  });
  t("抽屉打开", open.open && open.right <= 412 && open.left > 60, `left=${open.left} w=${open.width}`);
  t("操作项齐全（≥7）", open.ops >= 7, String(open.ops));
  t("AI 操作在抽屉内（创作模式→AI写本章）", open.hasWrite);
  t("遮罩可见", Number(open.mask) > 0.5, open.mask);
  await page.screenshot({ path: OUT + "v182-drawer-open.png" });

  /* 3. 点遮罩关闭 */
  await page.mouse.click(30, 500);
  await page.waitForTimeout(420);
  t("点遮罩收起", await page.evaluate(() => !document.body.classList.contains("ed-drawer-open")));

  /* 4. 返回键先收抽屉，不退页面 */
  await page.click("#ch-tools");
  await page.waitForTimeout(380);
  const backRes = await page.evaluate(() => {
    const handled = window.__wbBack();
    return { handled, stillChapter: State.route.page === "chapter", drawer: document.body.classList.contains("ed-drawer-open") };
  });
  t("返回键先收抽屉", backRes.handled && backRes.stillChapter && !backRes.drawer);

  /* 5. 抽屉里点沉浸 */
  await page.click("#ch-tools");
  await page.waitForTimeout(380);
  await page.click("#ch-immersive");
  await page.waitForTimeout(500);
  const im = await page.evaluate(() => {
    const r = document.querySelector("#ch-editor").getBoundingClientRect();
    const d = document.querySelector("#ed-drawer");
    return {
      immersive: document.body.classList.contains("immersive"),
      drawerHidden: getComputedStyle(d).display === "none",
      drawerOpen: document.body.classList.contains("ed-drawer-open"),
      ratio: +(r.height / window.innerHeight).toFixed(3),
    };
  });
  t("沉浸模式生效", im.immersive);
  t("沉浸时抽屉隐藏且已收起", im.drawerHidden && !im.drawerOpen);
  t("沉浸正文占屏 ≥ 88%", im.ratio >= 0.88, String(im.ratio));

  /* 6. 辅助模式下的按钮组 */
  await page.evaluate(() => { State.settings.aiMode = "assist"; render(); });
  await page.waitForTimeout(500);
  await page.evaluate(() => setEdDrawer(true));
  await page.waitForTimeout(400);
  const assist = await page.evaluate(() => ({
    check: !!document.querySelector("#ed-check"),
    write: !!document.querySelector("#ed-write"),
    modeTxt: document.querySelector(".ed-mode-main") ? document.querySelector(".ed-mode-main").textContent.trim() : "",
  }));
  t("辅助模式只给查漏洞等审查项", assist.check && !assist.write, assist.modeTxt);

  /* 7. 暗色 */
  await page.evaluate(() => { State.settings.aiMode = "auto"; State.settings.theme = "dark"; render(); });
  await page.waitForTimeout(500);
  await page.evaluate(() => setEdDrawer(true));
  await page.waitForTimeout(420);
  await page.screenshot({ path: OUT + "v182-drawer-dark.png" });

  t("全程无 JS 错误", errs.length === 0, errs.slice(0, 3).join(" / "));
  console.log(`\n======== SUMMARY: ${pass}/${pass + fail} passed ========`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("ERR", e.stack); process.exit(1); });
