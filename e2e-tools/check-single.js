const { chromium } = require("playwright-core");
(async () => {
  const browser = await chromium.launch({ executablePath: "C://Program Files (x86)//Microsoft//Edge//Application//msedge.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("file:///C:/Users/JiaoLong16Pro2025/WorkBuddy/2026-11-03-21-38-31/ai-novel-writer-mobile/dist/%E4%B9%A6%E7%AB%A5%E7%A7%BB%E5%8A%A8%E7%89%88-%E5%8D%95%E6%96%87%E4%BB%B6.html", { waitUntil: "load" });
  await page.waitForTimeout(1500);
  const shelf = await page.innerHTML("#app");
  await page.click("#btn-new");
  await page.fill("#np-name", "单文件测试");
  await page.click("#np-blank");
  await page.waitForTimeout(600);
  const setup = await page.innerHTML("#app");
  console.log("shelf ok:", shelf.includes("书房"), "| create ok:", setup.includes("单文件测试"), "| errors:", errs.length ? errs.join(" / ") : "none");
  await browser.close();
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
