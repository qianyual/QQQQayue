const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");
const EDGE = "C://Program Files (x86)//Microsoft//Edge//Application//msedge.exe";
const FILE = "file:///C:/Users/JiaoLong16Pro2025/WorkBuddy/2026-11-03-21-38-31/demo-video/index.html";
const OUT = "C:/Users/JiaoLong16Pro2025/WorkBuddy/2026-11-03-21-38-31/demo-video/preview/";
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  p.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE:", m.text()); });
  await p.goto(FILE, { waitUntil: "load" });
  await p.waitForFunction(() => window.__ready === true, { timeout: 15000 });
  const times = (process.argv[2] || "3,10,21,33,46,60,74,86,99,110").split(",").map(Number);
  for (const t of times) {
    await p.evaluate((tt) => window.render(tt), t);
    await p.waitForTimeout(120);
    await p.screenshot({ path: `${OUT}t${String(t).padStart(5, "0")}.png` });
    console.log("frame", t);
  }
  await b.close();
})();
