const { chromium } = require("playwright-core");
const out = "C:/Users/JiaoLong16Pro2025/WorkBuddy/2026-11-03-21-38-31/ui-shots/";
(async () => {
  const browser = await chromium.launch({ executablePath: "C://Program Files (x86)//Microsoft//Edge//Application//msedge.exe", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:4173/index.html", { waitUntil: "load" });
  await page.waitForTimeout(900);
  await page.click("#btn-new");
  await page.fill("#np-name", "长夜将至");
  await page.fill("#np-idea", "废土世界靠修复旧书为生的少年，能读出不存在的记忆。");
  await page.click("#np-blank");
  await page.waitForTimeout(600);

  // 造点角色数据
  await page.evaluate(async () => {
    const n = State.novel;
    n.characters = [
      { id: "c1", name: "林野", role: "protagonist", personality: "沉默、认死理，认定的事九头牛拉不回", state: { location: "废土集市", condition: "左臂骨裂未愈" }, stateSource: "history" },
      { id: "c2", name: "老周", role: "supporting", personality: "收书人，嘴碎心软", state: { location: "旧书铺" }, stateSource: "author" },
      { id: "c3", name: "白鸢", role: "antagonist", personality: "体面、精确、从不亲自动手", state: {}, stateSource: "unknown" },
    ];
    n.threads = [
      { id: "t1", thread: "母亲留下的铜钱为何能发热", status: "已埋", plantedAt: 1, lastMovedAt: 1 },
      { id: "t2", thread: "旧书铺地窖里的铁门", status: "推进中", plantedAt: 2, lastMovedAt: 6 },
    ];
    n.chapters = [{ chapterNumber: 1, title: "第1章 灰烬里的字", status: "定稿", content: "正文", summary: "摘", wordCount: 2400, versions: [] }];
    await DB.putNovel(n); render();
  });
  await page.waitForTimeout(600);
  await page.click('.bottom-nav button[data-tab="chars"]');
  await page.waitForTimeout(700);
  await page.screenshot({ path: out + "10-角色页.png" });

  await page.evaluate(() => reviewSheet([
    { severity: "high", dimension: "角色状态", comment: "林野左臂骨裂未愈，本章却写他单手把石碑从土里拔出来，与第 3 章的状态冲突。建议改为用撬棍借力，或补充一段时间跳跃。", quote: "他单手把石碑拔了出来" },
    { severity: "medium", dimension: "剧情合理性", comment: "白鸢突然答应合作缺少动机铺垫，建议在本章前半加一句她也在找同一批书的暗示。", quote: "" },
    { severity: "low", dimension: "前后章节串联", comment: "上一章章末提到夜里有人跟踪，本章完全没有回应，确认是否有意为之。", quote: "" },
  ], { num: 4 }));
  await page.waitForTimeout(500);
  await page.screenshot({ path: out + "11-审稿勾选.png" });

  await page.evaluate(() => closeSheet());
  await page.evaluate(() => threadsSheet());
  await page.waitForTimeout(500);
  await page.screenshot({ path: out + "12-剧情伏笔.png" });

  await page.evaluate(() => closeSheet());
  await page.evaluate(() => statsSheet());
  await page.waitForTimeout(700);
  await page.screenshot({ path: out + "13-统计.png" });

  await page.evaluate(() => closeSheet());
  await page.evaluate(() => { State.route = { page: "chapter", novelId: State.novel.id, chNum: 1 }; render(); });
  await page.waitForTimeout(700);
  await page.click("#ch-immersive");
  await page.waitForTimeout(500);
  await page.screenshot({ path: out + "14-沉浸模式.png" });
  console.log("shots2 done");
  await browser.close();
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
