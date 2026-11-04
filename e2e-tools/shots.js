const { chromium } = require("playwright-core");
const path = require("path");
const out = "C:/Users/JiaoLong16Pro2025/WorkBuddy/2026-11-03-21-38-31/ui-shots/";
require("fs").mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: "C://Program Files (x86)//Microsoft//Edge//Application//msedge.exe", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:4173/index.html", { waitUntil: "load" });
  await page.waitForTimeout(900);
  await page.screenshot({ path: out + "01-书架.png" });

  await page.click("#btn-new");
  await page.waitForTimeout(400);
  await page.screenshot({ path: out + "02-新建.png" });
  await page.fill("#np-name", "长夜将至");
  await page.fill("#np-idea", "一个在废土世界靠修复旧书为生的少年，发现自己能读出不存在的记忆。");
  await page.click("#np-blank");
  await page.waitForTimeout(700);
  await page.screenshot({ path: out + "03-设定.png" });

  await page.click('[data-tab="chapters"]').catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: out + "04-正文列表.png" });

  const rows = await page.$$("[data-ch]");
  if (rows.length) { await rows[0].click(); await page.waitForTimeout(600); await page.screenshot({ path: out + "05-编辑器.png" }); }
  else {
    await page.goto("http://127.0.0.1:4173/index.html", { waitUntil: "load" });
    await page.waitForTimeout(600);
    await page.click(".book-card"); await page.waitForTimeout(700);
    await page.click('[data-tab="chapters"]').catch(()=>{});
    await page.waitForTimeout(400);
    const r2 = await page.$$("[data-ch]");
    if (r2.length) { await r2[0].click(); await page.waitForTimeout(600); await page.screenshot({ path: out + "05-编辑器.png" }); }
  }

  // 设置页 + 模型编辑
  await page.evaluate(() => { document.querySelector("#btn-back")?.click(); });
  await page.waitForTimeout(500);
  await page.evaluate(() => { document.querySelector("#btn-back")?.click(); });
  await page.waitForTimeout(600);
  await page.click("#btn-settings");
  await page.waitForTimeout(600);
  await page.screenshot({ path: out + "06-设置.png" });
  const addBtn = await page.$("#st-add-model");
  if (addBtn) { await addBtn.click(); await page.waitForTimeout(500); await page.screenshot({ path: out + "07-模型编辑.png" }); }
  console.log("shots done");
  await browser.close();
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
