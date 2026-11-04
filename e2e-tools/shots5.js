/* v1.6 截图：技能库 / 章纲罗盘 */
const { chromium } = require("playwright-core");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:4173";
const OUT = "C:\\Users\\JiaoLong16Pro2025\\WorkBuddy\\2026-11-03-21-38-31\\ui-shots\\";

(async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  const nid = await page.evaluate(async () => {
    localStorage.removeItem("wb.compass.hide");
    const n = DB.newNovel("雾港");
    n.config.genre = "悬疑";
    n.config.coreOutline = "守塔人林砚在雾夜捡到一封十年前的信，信上写着他还没做过的事。";
    n.config.wordsPerChapter = 3000;
    const c = DB.newChapter(n, 1, "雾夜");
    c.content = "雾从海面压上来，把灯塔裹成一根将熄的烛。\n\n林砚把灯芯挑亮，听见门外有人敲门——三长两短。\n\n他握紧了那盏铜灯，指节发白。铜座底下压着什么东西，纸角已经发脆。";
    c.status = "草稿";
    c.wordCount = countWords(c.content);
    n.chapters.push(c);
    n.blueprints.push({
      chapterNumber: 1, title: "雾夜",
      purpose: "让林砚在开门与拆信之间做出选择",
      keyEvents: "陌生人在雾里敲门；铜座下摸到一封旧信；灯芯突然熄灭",
      suspenseHook: "信的落款是十年后的日期",
      characters: ["林砚"], tension: 4, targetWords: 3000,
      beats: [
        { text: "开场：雾封住海面，灯塔只剩一点光", done: true },
        { text: "推进：三长两短的敲门声，林砚不开门", done: true },
        { text: "转折：铜座下摸到一封发脆的旧信", done: false },
        { text: "收束：灯灭，信上的字自己显出来", done: false },
      ],
      plantThreads: [
        { text: "三长两短的敲门暗号", done: false },
        { text: "铜座下的旧信与十年后的落款", done: false },
      ],
      payoffThreads: [],
    });
    n.threads = [
      { id: "t1", thread: "灯塔为何十年不灭", status: "已埋", plantedAt: 1, lastMovedAt: 1 },
      { id: "t2", thread: "林砚父亲的死因", status: "已埋", plantedAt: 1, lastMovedAt: 1 },
    ];
    n.chapters.push(Object.assign(DB.newChapter(n, 9, "旧账"), { content: "远处有船。", wordCount: 6, status: "草稿" }));
    await DB.putNovel(n);
    return n.id;
  });
  await page.waitForTimeout(300);

  await page.evaluate(async (id) => { await openNovel(id); nav({ page: "chapter", chNum: 1 }); }, nid);
  await page.waitForTimeout(600);

  /* 1. 正文页：两个悬浮窗并列 */
  await page.screenshot({ path: OUT + "v16-chapter.png" });

  /* 2. 罗盘展开 */
  await page.click(".cp-pill");
  await page.waitForTimeout(450);
  await page.screenshot({ path: OUT + "v16-compass.png" });

  /* 3. 罗盘大纲 tab */
  await page.click('[data-tab="outline"]');
  await page.waitForTimeout(350);
  await page.screenshot({ path: OUT + "v16-compass-outline.png" });
  await page.click('[data-tab="chapter"]');
  await page.waitForTimeout(250);
  await page.evaluate(() => { document.querySelector(".cp-panel").scrollTo(0, 9999); });
  await page.waitForTimeout(250);
  await page.screenshot({ path: OUT + "v16-compass-bottom.png" });

  /* 4. 技能库 */
  await page.evaluate(() => document.querySelector(".cp-panel").scrollTo(0, 0));
  await page.evaluate(() => nav({ page: "chapter", chNum: 1 }));
  await page.waitForTimeout(400);
  await page.click("#ed-skills");
  await page.waitForTimeout(450);
  await page.screenshot({ path: OUT + "v16-skills.png" });

  /* 5. 技能详情 */
  await page.click('[data-detail="logic-audit"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + "v16-skill-detail.png" });

  /* 6. 问题清单（用假数据渲染） */
  await page.evaluate(() => {
    closeSheet();
    skillReportSheet(
      { id: "logic-audit", name: "逻辑硬伤" },
      [
        { severity: "high", dimension: "因果断裂", quote: "他握紧了那盏铜灯，指节发白", comment: "上一段他刚把灯芯挑亮，这里又握紧铜灯，中间没有交代灯是从哪来的，读者会以为换了件东西。", fix: "补一句「他把铜灯从钩上取下」，或直接把「握紧铜灯」改成「扶住灯罩」。" },
        { severity: "medium", dimension: "时间线", quote: "听见门外有人敲门——三长两短", comment: "雾夜、灯塔、无人岛，敲门的人怎么上来的没有交代；如果是熟人，前文应有一句他今天在等人。", fix: "加一句「今晚只有老周会来」，或改成敲窗/敲铁门。" },
        { severity: "low", dimension: "常识", quote: "把灯芯挑亮", comment: "老式油灯挑灯芯要用针或镊子，徒手会烫伤。", fix: "改成「用针把灯芯挑亮」。" },
      ],
      1
    );
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + "v16-report.png" });

  /* 7. 教练型输出 */
  await page.evaluate(() => {
    closeSheet();
    proseSheet(
      { id: "style-coach", name: "文风教练" },
      "## 一句话判断\n画面感立得住，但节奏偏慢，最大短板是**信息密度低**：三句话只推了一个动作。\n\n## 三个具体问题\n\n### 1. 开场的雾写了两次\n> 雾从海面压上来，把灯塔裹成一根将熄的烛。\n\n意象好，但后面「雾夜」又重复了一次，浪费了第一次的力度。\n\n### 2. 动作被形容词稀释\n> 他握紧了那盏铜灯，指节发白。\n\n「握紧」本身够狠，再加「指节发白」是替读者下结论。\n\n### 3. 断句太整齐\n三句都是「主语 + 动作 + 逗号 + 补语」，读起来像节拍器。\n\n## 三条可执行改法\n- 删掉重复的「雾夜」\n- 「指节发白」换成手心的汗把铜面弄滑\n- 把第三句改成短句：「灯灭了。」\n\n## 一处写得好\n> 三长两短。\n\n四个字就把紧张感钉住了，这种短句该多用。",
      1
    );
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + "v16-prose.png" });

  /* 8. 深色模式下的罗盘 */
  await page.evaluate(async () => {
    closeSheet();
    State.settings.theme = "dark";
    await DB.kvSet("settings", State.settings);
    applyTheme();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => nav({ page: "chapter", chNum: 1 }));
  await page.waitForTimeout(500);
  await page.click(".cp-pill");
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + "v16-dark.png" });

  await b.close();
  console.log("shots done");
})();
