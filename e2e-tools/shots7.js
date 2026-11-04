const { chromium } = require("playwright-core");
const EDGE = "C://Program Files (x86)//Microsoft//Edge//Application//msedge.exe";
const OUT = "C://Users//JiaoLong16Pro2025//WorkBuddy//2026-11-03-21-38-31//ui-shots//";
(async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  p.on("pageerror", e => console.log("ERR:", e.message));
  await p.goto("http://127.0.0.1:4173/index.html", { waitUntil: "networkidle" });
  await p.waitForTimeout(600);
  await p.evaluate(async () => {
    localStorage.clear();
    const n = DB.newNovel("雾港");
    n.config.coreOutline = "守塔人林砚在雾夜收到十年前的信，信里写着灯塔第一次熄灭的原因。";
    n.config.genre = "悬疑"; n.config.totalChapters = 24;
    for (let i = 1; i <= 6; i++) {
      const c = DB.newChapter(n, i, ["雾港来信", "铜座下的旧信", "钟楼夜话", "咸水井", "第二封信", "灯塔熄灭"][i - 1]);
      c.content = "雾从海面压上来，把灯塔裹成一根将熄的烛。林砚把灯芯挑亮，听见门外有人敲门——三长两短。".repeat(2);
      c.wordCount = countWords(c.content);
      c.status = i <= 3 ? "定稿" : "草稿";
      n.chapters.push(c);
      if (i <= 5) n.blueprints.push({ chapterNumber: i, title: c.title, purpose: "推进信件的线索", keyEvents: "发现铜座下的旧信", suspenseHook: "落款是十年前的日期", beats: [] });
    }
    n.characters.push({ id: "c1", name: "林砚", role: "protagonist", profile: "守塔人，寡言", state: {} });
    n.threads = [
      { id: "t1", thread: "灯塔为何十年不灭", status: "已埋", plantedAt: 1, lastMovedAt: 1 },
      { id: "t2", thread: "三长两短的敲门暗号", status: "已埋", plantedAt: 2, lastMovedAt: 5 },
      { id: "t3", thread: "铜座下的旧信是谁放的", status: "已埋", plantedAt: 3, lastMovedAt: 3 },
      { id: "t4", thread: "咸水井里的倒影", status: "已收", plantedAt: 4, lastMovedAt: 6 },
    ];
    Materials.add(n, { title: "雾港地名志", text: "灯塔建在雾港最北的礁石上，塔高三十丈，铜制灯座由首任守塔人亲手铸造。\n\n雾港常年有雾，渔船靠钟声辨位，钟楼在灯塔西侧三百步。守塔人世代居住于塔下的石屋。" });
    Materials.add(n, { title: "人物小传·林砚", text: "林砚，二十七岁，雾港第七代守塔人。父亲在他十二岁那年失踪，只留下一盏铜灯。他不爱说话，习惯在天亮前擦一遍灯罩。" });
    await DB.putNovel(n);
    State.novel = n;
    State.stack = [{ page: "shelf" }];
    history.replaceState({ idx: 1 }, "", location.pathname);
  });
  const shot = async (name) => { await p.waitForTimeout(400); await p.screenshot({ path: OUT + name }); };

  await p.evaluate(() => nav({ page: "materials", novelId: State.novel.id }));
  await shot("v18-materials.png");

  await p.click("#mt-probe"); await p.waitForTimeout(250);
  await p.fill("#mp-q", "灯塔 灯座 守塔人");
  await p.waitForTimeout(700);
  await shot("v18-probe.png");
  await p.evaluate(() => closeSheet());

  await p.evaluate(() => nav({ page: "novel", novelId: State.novel.id, tab: "chapters" }));
  await p.waitForTimeout(400);
  await p.evaluate(() => chapterMenuSheet(2));
  await shot("v18-chapter-menu.png");
  await p.evaluate(() => closeSheet());

  await p.evaluate(() => threadsSheet("timeline"));
  await shot("v18-timeline.png");
  await p.evaluate(() => closeSheet());

  await p.evaluate(() => commandPalette());
  await p.fill("#cp-input", "灯塔");
  await p.waitForTimeout(800);
  await shot("v18-search.png");
  await p.evaluate(() => closeSheet());

  await p.evaluate(() => healthSheet());
  await shot("v18-health.png");
  await p.evaluate(() => closeSheet());

  await p.evaluate(() => nav({ page: "settings" }));
  await p.waitForTimeout(600);
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot("v18-about.png");
  await b.close();
})();
