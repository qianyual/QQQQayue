const { chromium } = require("playwright-core");
const EDGE = "C://Program Files (x86)//Microsoft//Edge//Application//msedge.exe";
const OUT = "C://Users//JiaoLong16Pro2025//WorkBuddy//2026-11-03-21-38-31//ui-shots//";
(async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await p.goto("http://127.0.0.1:4173/index.html", { waitUntil: "networkidle" });
  await p.waitForTimeout(600);
  await p.evaluate(async () => {
    localStorage.clear();
    const n = DB.newNovel("雾港");
    const c = DB.newChapter(n, 1, "雾港来信");
    c.content = "雾从海面压上来，把灯塔裹成一根将熄的烛。";
    c.wordCount = countWords(c.content);
    n.chapters.push(c);
    await DB.putNovel(n);
    State.novel = n;
  });
  await p.waitForTimeout(300);
  await p.evaluate(() => { history.replaceState({ idx: 1 }, "", location.pathname); State.stack = [{ page: "shelf" }]; nav({ page: "shelf" }, { replace: true }); });
  await p.waitForTimeout(500);
  await p.evaluate(() => window.__wbBack());
  await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + "v17-back-toast.png" });
  await b.close();
})();
