/* v1.4 新面板截图 */
const { chromium } = require("playwright-core");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:4173";
const OUT = "C:\\Users\\JiaoLong16Pro2025\\WorkBuddy\\2026-11-03-21-38-31\\ui-shots\\";

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  await page.evaluate(async () => {
    const n = DB.newNovel("雾港灯语");
    n.characters = [
      { id: "c1", name: "林砚", role: "protagonist", relationships: "与沈灯（青梅竹马）；与赵无极：师徒" },
      { id: "c2", name: "沈灯", role: "supporting", relationships: "林砚是她的救命恩人；与赵无极：杀父之仇" },
      { id: "c3", name: "赵无极", role: "antagonist", relationships: "与林砚：表面师徒，实则夺舍；与沈灯：灭门之仇" },
      { id: "c4", name: "老周", role: "minor", relationships: "与林砚：上下级" },
      { id: "c5", name: "苏弥", role: "supporting", relationships: "与林砚：盟友" },
    ];
    const c1 = DB.newChapter(n, 1, "雾夜");
    c1.content = "雾从海面压上来，把灯塔裹成一根将熄的烛。\n\n林砚把灯芯挑亮，听见门外有人敲门——三长两短。\n\n他没有开。那个暗号，只有死人才会用。";
    c1.status = "草稿";
    c1.wordCount = countWords(c1.content);
    n.chapters.push(c1);
    await DB.putNovel(n);
    await openNovel(n.id);
    nav({ page: "chapter", chNum: 1 });
  });
  await page.waitForTimeout(400);

  /* 1 合并面板 */
  await page.evaluate(() => {
    const c = getChapter(State.novel, 1);
    mergeSheet(1, c.content,
      "雾从海面压上来，把灯塔裹成一根将熄的烛。\n\n林砚把灯芯挑亮，指腹蹭过铜座上的旧划痕。门外有人敲门——三长两短。\n\n他想起师父说过的话，手停在门闩上。");
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + "v14-merge.png" });

  /* 2 逐字对比 */
  await page.evaluate(() => {
    closeSheet();
    diffSheet(1, "雾从海面压上来，把灯塔裹成一根将熄的烛。\n\n他没有开。那个暗号，只有死人才会用。",
      "雾从海上压来，灯塔像一根将熄的烛。\n\n他没有开门。那个暗号，只有死人才知道。", "版本 #1", "当前稿");
  });
  await page.waitForTimeout(350);
  await page.screenshot({ path: OUT + "v14-diff.png" });

  /* 3 关系图谱 */
  await page.evaluate(() => { closeSheet(); graphSheet(); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + "v14-graph.png" });

  /* 4 设置外观 */
  await page.evaluate(() => { closeSheet(); nav({ page: "settings" }); });
  await page.waitForTimeout(400);
  await page.evaluate(() => { const el = document.querySelector(".page"); if (el) el.scrollTop = 0; });
  await page.screenshot({ path: OUT + "v14-settings.png", fullPage: true });

  /* 5 导出 */
  await page.evaluate(() => { nav({ page: "novel", novelId: State.novel.id, tab: "chapters" }, { silent: true }); exportSheet(); });
  await page.waitForTimeout(350);
  await page.screenshot({ path: OUT + "v14-export.png" });

  /* 6 命令面板 */
  await page.evaluate(() => { closeSheet(); nav({ page: "shelf" }, { silent: true }); });
  await page.waitForTimeout(350);
  await page.evaluate(() => document.querySelector("#btn-search").click());
  await page.waitForTimeout(250);
  await page.screenshot({ path: OUT + "v14-palette.png" });

  await browser.close();
  console.log("shots done");
})();
