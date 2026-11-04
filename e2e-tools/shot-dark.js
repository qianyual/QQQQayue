const { chromium } = require("playwright-core");
const out = "C:/Users/JiaoLong16Pro2025/WorkBuddy/2026-11-03-21-38-31/ui-shots/";
(async () => {
  const browser = await chromium.launch({ executablePath: "C://Program Files (x86)//Microsoft//Edge//Application//msedge.exe", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:4173/index.html", { waitUntil: "load" });
  await page.waitForTimeout(900);
  await page.click("#btn-new");
  await page.fill("#np-name", "深色测试");
  await page.fill("#np-idea", "废土世界修书少年。");
  await page.click("#np-blank");
  await page.waitForTimeout(800);
  await page.evaluate(() => { document.documentElement.setAttribute("data-theme", "dark"); document.body.classList.add("dark"); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: out + "07-深色设定.png" });
  // 深色编辑器
  await page.click(".bottom-nav button[data-tab='chapters']");
  await page.waitForTimeout(500);
  const rows = await page.$$("[data-ch]");
  if (rows.length) { await rows[0].click(); await page.waitForTimeout(700); await page.screenshot({ path: out + "08-深色编辑器.png" }); }
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  console.log("dark bg:", bg);
  await browser.close();
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
