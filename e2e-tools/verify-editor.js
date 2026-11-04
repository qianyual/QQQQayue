/* 验证编辑页是否撑满：测量正文框高度 / 与底部工具栏的间距，并出对比图 */
const { chromium } = require("playwright-core");
const EDGE = "C://Program Files (x86)//Microsoft//Edge//Application//msedge.exe";
const OUT = "C://Users//JiaoLong16Pro2025//WorkBuddy//2026-11-03-21-38-31//ui-shots//";

(async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const p = await b.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
  p.on("pageerror", (e) => console.log("PAGEERR:", e.message));

  await p.goto("http://127.0.0.1:4173/index.html", { waitUntil: "networkidle" });
  await p.waitForTimeout(400);

  const id = await p.evaluate(() => {
    const n = DB.newNovel("雾港");
    n.novelInfoSet = true;
    n.config.totalChapters = 24;
    n.config.coreOutline = "守塔人在雾夜收到十年前的信。";
    const body = "眼前只剩面板。灰底，白字。\n\n最下面一行小字，比别的都暗：\n\n【下次使用将叠加至 III 级】\n\n黑透了。";
    for (let i = 1; i <= 3; i++) {
      const c = DB.newChapter(n, i, "七格全灰" + (i > 1 ? " · " + i : ""));
      c.content = body;
      c.wordCount = countWords(body);
      n.chapters.push(c);
    }
    n.blueprints.push({
      chapterNumber: 1, title: "七格全灰", purpose: "推进主线",
      keyEvents: "主角在存档界面看到隐藏提示", suspenseHook: "III 级之后会怎样",
      beats: [], targetWords: 3000,
    });
    DB.putNovel(n);
    return n.id;
  });

  await p.waitForTimeout(300);
  await p.evaluate((nid) => openNovel(nid), id);
  await p.waitForTimeout(500);

  const measure = () => p.evaluate(() => {
    const ed = document.getElementById("ch-editor");
    const bar = document.querySelector(".editor-toolbar");
    const page = document.querySelector(".page.editor-page");
    const r = ed.getBoundingClientRect(), br = bar.getBoundingClientRect();
    const card = document.querySelector(".editor-card");
    const cr = card ? card.getBoundingClientRect() : r;
    const pg = document.querySelector(".page.editor-page");
    const cs = getComputedStyle(ed);
    const pcs = getComputedStyle(pg);
    return {
      winH: window.innerHeight,
      edTop: Math.round(r.top),
      edH: Math.round(r.height),
      edBottom: Math.round(r.bottom),
      barTop: Math.round(br.top),
      paddingBottom: cs.paddingBottom,
      cardBottom: Math.round(cr.bottom),
      textBottom: Math.round(r.bottom),
      gapCardToBar: Math.round(br.top - cr.bottom),
      gapTextToBar: Math.round(br.top - r.bottom),
      fillRatio: +(r.height / (br.top - r.top)).toFixed(3),
      pageH: Math.round(pg.getBoundingClientRect().height),
      pagePadBottom: Math.round(parseFloat(pcs.paddingBottom)),
      supportsDvh: CSS.supports("height", "calc(100dvh - 250px)"),
    };
  });

  // 进编辑页
  await p.evaluate(() => nav({ page: "chapter", novelId: State.novel.id, chNum: 1 }));
  await p.waitForTimeout(900);

  // 关掉码字仪表浮窗，避免遮挡截图（但不影响测量）
  await p.evaluate(() => { if (window.HUD) HUD.setEnabled && HUD.setEnabled(false); });
  await p.waitForTimeout(300);

  console.log("=== 新版（flex 撑满）===");
  console.log(await measure());
  await p.screenshot({ path: OUT + "fix-editor-after.png" });

  // 模拟旧 WebView：dvh 不受支持 → height 声明失效 → 只剩 min-height
  const oldCss = await p.addStyleTag({ content: ".editor-area{height:auto!important;min-height:260px!important}" });
  await p.waitForTimeout(400);
  console.log("=== 旧版（dvh 失效回退）===");
  console.log(await measure());
  await p.screenshot({ path: OUT + "fix-editor-before.png" });

  await oldCss.evaluate((el) => el.remove());

  // 沉浸模式：走真实按钮，触发 setImmersive 里的重算
  await p.evaluate(() => { const b = document.querySelector("#ch-immersive"); if (b) b.click(); });
  await p.waitForTimeout(300);
  const im = await p.evaluate(() => {
    const r = document.getElementById("ch-editor").getBoundingClientRect();
    return { winH: window.innerHeight, edH: Math.round(r.height), ratio: +(r.height / window.innerHeight).toFixed(3) };
  });
  console.log("=== 沉浸模式 ===", im);
  await p.screenshot({ path: OUT + "fix-editor-immersive.png" });

  await b.close();
})();
