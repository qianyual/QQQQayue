const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");
const EDGE = "C://Program Files (x86)//Microsoft//Edge//Application//msedge.exe";
const DIR = "C:/Users/JiaoLong16Pro2025/WorkBuddy/2026-11-03-21-38-31/demo-video";
const OUT = path.join(DIR, "prev");
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const times = (process.argv[2] || "2,5.5,9.5").split(",").map(Number);
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await p.goto("file:///" + path.join(DIR, "reel.html"), { waitUntil: "load" });
  await p.waitForFunction(() => window.__ready === true, { timeout: 20000 });
  console.log("duration", await p.evaluate(() => window.DURATION));
  for (const t of times) {
    await p.evaluate((x) => window.render(x), t);
    await p.screenshot({ path: path.join(OUT, `t${String(t).replace(".", "_")}.png`) });
    console.log("shot", t);
  }
  await b.close();
})();
