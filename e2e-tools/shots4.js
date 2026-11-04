/* v1.5 截图：AI 模式开关 / 码字仪表 */
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
    const n = DB.newNovel("雾港");
    n.config.genre = "悬疑";
    n.config.coreOutline = "守塔人林砚在雾夜捡到一封十年前的信。";
    const c = DB.newChapter(n, 1, "雾夜");
    c.content = "雾从海面压上来，把灯塔裹成一根将熄的烛。\n\n林砚把灯芯挑亮，听见门外有人敲门——三长两短。\n\n他握紧了那盏铜灯，指节发白。";
    c.status = "草稿";
    c.wordCount = countWords(c.content);
    n.chapters.push(c);
    await DB.putNovel(n);
    return n.id;
  });
  await page.waitForTimeout(300);

  /* 1. 书房顶栏 */
  await page.screenshot({ path: OUT + "v15-shelf.png" });

  /* 2. 正文页（创作模式 + 悬浮窗）*/
  await page.evaluate(async (id) => { await openNovel(id); nav({ page: "chapter", chNum: 1 }); }, nid);
  await page.waitForTimeout(400);
  await page.click("#ch-editor");
  await page.evaluate(() => {
    const ed = document.querySelector("#ch-editor");
    ed.setSelectionRange(ed.value.length, ed.value.length);
    HUD.addAI(1240);
  });
  await page.keyboard.type("门外没有回应，只有雾在动。他数着呼吸，把门闩推开半寸。", { delay: 16 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: OUT + "v15-chapter-gen.png" });

  /* 3. 展开仪表 */
  await page.click(".wb-pill");
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + "v15-hud-panel.png" });
  await page.click("#wb-x");
  await page.waitForTimeout(200);

  /* 4. 辅助模式工具栏 */
  await page.evaluate(() => toggleMode());
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + "v15-chapter-assist.png" });

  /* 5. 辅助模式下点查漏洞（无模型 → 弹设置引导，这里直接渲染假结果面板） */
  await page.evaluate(() => {
    const items = [
      { severity: "high", dimension: "角色状态", quote: "他握紧了那盏铜灯", comment: "第 7 章铜灯已碎在礁石上，这里又出现，属于硬伤。建议改成随手抓起的马灯，或补一句他后来修补过。" },
      { severity: "medium", dimension: "剧情逻辑", quote: "门外有人敲门——三长两短", comment: "雾夜里认得来客的敲门暗号，但前文没交代过约定。建议在这句后面补半句回忆，读者才不会觉得突兀。" },
      { severity: "low", dimension: "文字质量", quote: "把灯塔裹成一根将熄的烛", comment: "比喻不错，但「一根」与灯塔体积不匹配，可改为「一簇」。" },
    ];
    openSheet(`
      <h3>查漏洞 · 3 处</h3>
      <p class="tiny">只做诊断，不动你的稿子。点「定位」跳到原文对应位置。</p>
      <div style="margin-top:10px">
        ${items.map(it => `<div class="card" style="margin-bottom:8px;padding:12px 13px">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span class="tag ${it.severity === "high" ? "err" : it.severity === "low" ? "" : "warn"}">${it.severity === "high" ? "硬伤" : it.severity === "low" ? "小问题" : "需留意"}</span>
            <span class="tiny">${it.dimension}</span>
          </div>
          <div class="muted" style="margin-top:7px;font-size:13.5px">「${it.quote}」</div>
          <div style="margin-top:5px;font-size:13px;line-height:1.7">${it.comment}</div>
          <button class="btn small" style="margin-top:8px">定位原文</button>
        </div>`).join("")}
      </div>
      <button class="btn block" id="cc-close">关掉，继续写</button>`, (sheet) => {
      document.querySelector("#cc-close", sheet).onclick = closeSheet;
    });
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + "v15-check.png" });
  await page.evaluate(() => closeSheet());

  /* 6. 设置页两张新卡片 */
  await page.evaluate(() => nav({ page: "settings" }));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, 700));
  await page.screenshot({ path: OUT + "v15-settings.png" });

  /* 7. 深色模式下的仪表 */
  await page.evaluate(() => {
    State.settings.theme = "dark"; DB.kvSet("settings", State.settings);
    State.settings.aiMode = "auto"; DB.kvSet("settings", State.settings);
  });
  await page.evaluate(async (id) => { await openNovel(id); nav({ page: "chapter", chNum: 1 }); }, nid);
  await page.waitForTimeout(500);
  await page.click(".wb-pill");
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + "v15-dark.png" });

  await b.close();
  console.log("shots done");
})();
