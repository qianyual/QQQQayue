const { chromium } = require("playwright-core");
(async () => {
  const browser = await chromium.launch({ executablePath: "C://Program Files (x86)//Microsoft//Edge//Application//msedge.exe", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push(e.message));
  await page.goto("http://127.0.0.1:4173/index.html", { waitUntil: "load" });
  await page.waitForTimeout(800);

  // 新建一本书（空白）
  await page.click("#btn-new");
  await page.fill("#np-name", "返回键测试");
  await page.click("#np-blank");
  await page.waitForTimeout(500);
  const inNovel = (await page.innerHTML("#app")).includes("返回键测试");

  // 进入章节页
  await page.click('[data-tab="chapters"]').catch(() => {});
  await page.waitForTimeout(400);
  const rows = await page.$$("[data-ch]");
  let inChapter = false;
  if (rows.length) { await rows[0].click(); await page.waitForTimeout(500); inChapter = (await page.innerHTML("#app")).includes("ch-input") || (await page.$("#ch-editor")) !== null; }

  // 模拟安卓返回键：浏览器后退
  const depth = await page.evaluate(() => history.length);
  await page.goBack().catch(() => {});
  await page.waitForTimeout(600);
  const afterBack = await page.innerHTML("#app");
  const backToNovel = afterBack.includes("返回键测试") && !(await page.$("#ch-editor"));

  console.log("进入作品页:", inNovel, "| 进入章节页:", inChapter, "| 返回后回到作品页:", backToNovel, "| history 层数:", depth, "| JS错误:", errs.length ? errs.join("/") : "无");
  await browser.close();
  process.exit(backToNovel && !errs.length ? 0 : 1);
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
