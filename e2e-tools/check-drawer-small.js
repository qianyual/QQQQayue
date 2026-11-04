/* 小屏 360x640 + 暗色：抽屉可用性快检 */
const { chromium } = require("playwright-core");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:4173";
const OUT = "C:\\Users\\JiaoLong16Pro2025\\WorkBuddy\\2026-11-03-21-38-31\\ui-shots\\";

(async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  for (const [w, h, tag] of [[360, 640, "small"], [412, 915, "normal"]]) {
    const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const nid = await page.evaluate(async () => {
      const n = DB.newNovel("雾港");
      const c = DB.newChapter(n, 1, "雾夜");
      c.content = "雾从海面压上来，把灯塔裹成一根将熄的烛。\n\n林砚把灯芯挑亮，听见门外有人敲门——三长两短。";
      c.status = "草稿";
      n.chapters.push(c);
      await DB.putNovel(n);
      return n.id;
    });
    await page.evaluate(async (id) => { await openNovel(id); nav({ page: "chapter", chNum: 1 }); }, nid);
    await page.waitForTimeout(600);
    const top = await page.evaluate(() => {
      const p = document.querySelector("#ch-tools").getBoundingClientRect();
      const t = document.querySelector(".topbar h1").getBoundingClientRect();
      return { pillW: Math.round(p.width), pillRight: Math.round(window.innerWidth - p.right), h1W: Math.round(t.width) };
    });
    console.log(tag, "胶囊", top);
    await page.click("#ch-tools");
    await page.waitForTimeout(400);
    const d = await page.evaluate(() => {
      const r = document.querySelector("#ed-drawer").getBoundingClientRect();
      const s = document.querySelector(".ed-drawer-scroll");
      return { left: Math.round(r.left), w: Math.round(r.width), scrollH: s.scrollHeight, clientH: s.clientHeight };
    });
    console.log(tag, "抽屉", d);
    await page.screenshot({ path: OUT + `v182-drawer-${tag}.png` });
    await page.evaluate(() => { State.settings.theme = "dark"; render(); setEdDrawer(true); });
    await page.waitForTimeout(450);
    await page.screenshot({ path: OUT + `v182-drawer-dark-${tag}.png` });
    await page.close();
  }
  await b.close();
})();
