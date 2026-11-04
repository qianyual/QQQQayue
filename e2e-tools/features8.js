/* 书童移动版 E2E：v1.8（资料库检索 / 全书搜索 / 章节操作 / 线索时间线 / 数据体检） */
const { chromium } = require("playwright-core");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:4173";

(async () => {
  const results = [];
  const t = (name, ok, detail) => {
    results.push({ name, ok });
    console.log((ok ? "PASS" : "FAIL") + " | " + name + (detail ? " | " + detail : ""));
  };

  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(700);

  /* 造一本书：两章正文、蓝图、线索、角色 */
  await page.evaluate(async () => {
    localStorage.clear();
    const n = DB.newNovel("雾港");
    n.config.coreOutline = "守塔人林砚在雾夜收到十年前的信。";
    n.config.totalChapters = 12;
    const c1 = DB.newChapter(n, 1, "雾港来信");
    c1.content = "雾从海面压上来，把灯塔裹成一根将熄的烛。林砚把灯芯挑亮，听见门外有人敲门——三长两短。";
    c1.wordCount = countWords(c1.content);
    c1.status = "定稿";
    const c2 = DB.newChapter(n, 2, "铜座下的旧信");
    c2.content = "那封信压在铜座底下，纸角已经发脆。落款是十年前的日期。";
    c2.wordCount = countWords(c2.content);
    c2.status = "草稿";
    n.chapters.push(c1, c2);
    n.blueprints.push({
      chapterNumber: 1, title: "雾港来信", purpose: "让林砚决定是否拆信",
      keyEvents: "陌生人来访；铜座下的旧信被发现", suspenseHook: "落款是十年前的日期",
      characters: ["林砚"], tension: 3, targetWords: 2000, beats: [],
    });
    n.characters.push({ id: "c1", name: "林砚", role: "protagonist", profile: "雾港守塔人，寡言", state: {} });
    n.threads = [
      { id: "t1", thread: "灯塔为何十年不灭", status: "已埋", plantedAt: 1, lastMovedAt: 1 },
      { id: "t2", thread: "三长两短的敲门暗号", status: "已埋", plantedAt: 2, lastMovedAt: 2 },
    ];
    await DB.putNovel(n);
    State.novel = n;
    State.stack = [{ page: "shelf" }];
    history.replaceState({ idx: 1 }, "", location.pathname);
    nav({ page: "novel", novelId: n.id, tab: "chapters" });
  });
  await page.waitForTimeout(500);

  /* ---------- 一、资料库 ---------- */
  const modOk = await page.evaluate(() => typeof Materials === "object" && typeof Materials.search === "function");
  t("T1 资料库模块已加载", modOk === true, String(modOk));

  const added = await page.evaluate(async () => {
    const n = State.novel;
    const r = Materials.add(n, {
      title: "雾港地名志",
      text: "灯塔建在雾港最北的礁石上，塔高三十丈，铜制灯座由首任守塔人亲手铸造。\n\n雾港常年有雾，渔船靠钟声辨位，钟楼在灯塔西侧三百步。\n\n守塔人世代居住于塔下的石屋，屋后有一口咸水井。",
    });
    State.novel = n;
    await DB.putNovel(n);
    return { err: r.error || null, count: (n.materials || []).length, chunks: r.material ? r.material.chunks.length : 0 };
  });
  t("T2 添加资料并按段落切块", !added.err && added.count === 1 && added.chunks >= 1, JSON.stringify(added));

  const hit = await page.evaluate(() => {
    const hits = Materials.search(State.novel, "灯塔 铜制灯座", 4);
    return { n: hits.length, first: hits[0] ? hits[0].text.slice(0, 24) : "", title: hits[0] ? hits[0].title : "" };
  });
  t("T3 检索能命中资料里的段落", hit.n >= 1 && /灯塔/.test(hit.first) && hit.title === "雾港地名志", JSON.stringify(hit));

  const off = await page.evaluate(() => {
    const n = State.novel;
    const id = n.materials[0].id;
    Materials.setEnabled(n, id, false);
    const hits = Materials.search(n, "灯塔", 4);
    Materials.setEnabled(n, id, true);
    return hits.length;
  });
  t("T4 停用后不参与检索", off === 0, "命中 " + off + " 条");

  const ctxBlock = await page.evaluate(() => {
    const n = State.novel;
    const bp = getBlueprint(n, 1);
    const c = getChapter(n, 1);
    return buildChapterPrompt(n, 1, bp, c).then(msgs => {
      const user = msgs[msgs.length - 1].content;
      return { has: /<参考资料/.test(user), hasText: /铜制灯座/.test(user), len: user.length };
    });
  });
  t("T5 写本章的提示词里带上了检索到的资料",
    ctxBlock.has && ctxBlock.hasText, JSON.stringify(ctxBlock));

  const persisted = await page.evaluate(async () => {
    const n = await DB.getNovel(State.novel.id);
    return (n.materials || []).length;
  });
  t("T6 资料已持久化", persisted === 1, String(persisted));

  /* 资料库页面 */
  await page.evaluate(() => nav({ page: "materials", novelId: State.novel.id }));
  await page.waitForTimeout(400);
  const pageUi = await page.evaluate(() => ({
    rows: document.querySelectorAll("[data-mt]").length,
    text: (document.querySelector(".page") || {}).textContent || "",
    probe: !!document.querySelector("#mt-probe"),
    title: (document.querySelector(".topbar h1") || {}).textContent || "",
  }));
  t("T7 资料库页面渲染出列表与检索入口",
    pageUi.rows === 1 && pageUi.probe && pageUi.title === "资料库" && /1 份资料/.test(pageUi.text),
    JSON.stringify({ rows: pageUi.rows, probe: pageUi.probe, title: pageUi.title }));

  /* 检索测试面板 */
  await page.click("#mt-probe");
  await page.waitForTimeout(250);
  await page.fill("#mp-q", "灯塔");
  await page.waitForTimeout(500);
  const probe = await page.evaluate(() => document.querySelectorAll("#mp-out .card").length);
  t("T8 检索测试能列出命中段落", probe >= 1, "命中 " + probe + " 段");
  await page.evaluate(() => closeSheet());

  /* ---------- 二、章节操作 ---------- */
  await page.evaluate(() => nav({ page: "novel", novelId: State.novel.id, tab: "chapters" }));
  await page.waitForTimeout(400);
  const rowCount = await page.evaluate(() => document.querySelectorAll("[data-chm]").length);
  t("T9 章节列表每行都有操作入口", rowCount >= 12, String(rowCount));

  await page.click('[data-chm="2"]');
  await page.waitForTimeout(300);
  const menu = await page.evaluate(() => ({
    open: !!document.querySelector("#cm-rename"),
    del: !!document.querySelector("#cm-del"),
    copy: !!document.querySelector("#cm-copy"),
  }));
  t("T10 章节操作菜单包含重命名/复制/删除", menu.open && menu.del && menu.copy, JSON.stringify(menu));

  /* 重命名 */
  await page.click("#cm-rename");
  await page.waitForTimeout(250);
  await page.fill("#cm-title", "旧信重现");
  await page.click("#cm-title-ok");
  await page.waitForTimeout(400);
  const renamed = await page.evaluate(async () => {
    const n = await DB.getNovel(State.novel.id);
    State.novel = n;
    return getChapter(n, 2).title;
  });
  t("T11 重命名同时改到章节与蓝图标题", renamed === "旧信重现", renamed);

  /* 删除第 2 章 */
  await page.click('[data-chm="2"]');
  await page.waitForTimeout(250);
  await page.click("#cm-del");
  await page.waitForTimeout(250);
  await page.click("#c-ok");
  await page.waitForTimeout(500);
  const afterDel = await page.evaluate(async () => {
    const n = await DB.getNovel(State.novel.id);
    State.novel = n;
    return { chs: n.chapters.length, has2: !!getChapter(n, 2), facts: n.facts.length };
  });
  t("T12 删除章节后正文消失、其它章节保留",
    afterDel.chs === 1 && afterDel.has2 === false, JSON.stringify(afterDel));

  /* ---------- 三、线索时间线 ---------- */
  await page.evaluate(() => threadsSheet("timeline"));
  await page.waitForTimeout(400);
  const tl = await page.evaluate(() => ({
    rows: document.querySelectorAll(".tl-row").length,
    dots: document.querySelectorAll(".tl-row .tl-dot.plant").length,
    active: !!document.querySelector("#th-v-time.active"),
    axis: (document.querySelector(".tl-axis") || {}).textContent || "",
  }));
  t("T13 线索时间线按章节画出埋点",
    tl.rows === 2 && tl.dots === 2 && tl.active && /第1章/.test(tl.axis), JSON.stringify(tl));

  /* 切回列表 */
  await page.click("#th-v-list");
  await page.waitForTimeout(350);
  const listMode = await page.evaluate(() => ({
    cards: document.querySelectorAll("[data-tm]").length,
    tl: document.querySelectorAll(".tl-row").length,
  }));
  t("T14 可以在列表与时间线之间切换", listMode.cards === 2 && listMode.tl === 0, JSON.stringify(listMode));
  await page.evaluate(() => closeSheet());

  /* ---------- 四、全书搜索 ---------- */
  await page.evaluate(() => commandPalette());
  await page.waitForTimeout(300);
  await page.fill("#cp-input", "三长两短");
  await page.waitForTimeout(700);
  const search = await page.evaluate(() => {
    const items = [...document.querySelectorAll("#cp-list .cp-item .name")].map(e => e.textContent);
    return { n: items.length, items: items.slice(0, 4) };
  });
  t("T15 搜索能按正文命中章节并给出结果",
    search.n >= 1 && search.items.some(x => /第1章/.test(x)), JSON.stringify(search));

  await page.fill("#cp-input", "林砚");
  await page.waitForTimeout(700);
  const search2 = await page.evaluate(() =>
    [...document.querySelectorAll("#cp-list .cp-item .name")].map(e => e.textContent));
  t("T16 搜索覆盖角色名", search2.includes("林砚"), JSON.stringify(search2.slice(0, 3)));
  await page.evaluate(() => closeSheet());

  /* ---------- 五、数据体检 + 关于 ---------- */
  await page.evaluate(async () => {
    const n = State.novel;
    const c3 = DB.newChapter(n, 3, "无蓝图的一章");
    c3.content = "这一章写了一半，但还没做蓝图。";
    c3.wordCount = countWords(c3.content);
    c3.status = "草稿";
    n.chapters.push(c3);
    await DB.putNovel(n);
    State.novel = n;
    healthSheet();
  });
  await page.waitForTimeout(350);
  const health = await page.evaluate(() => ({
    rows: document.querySelectorAll(".sk-rv").length,
    hasBp: [...document.querySelectorAll(".sk-rv")].some(e => /蓝图/.test(e.textContent)),
  }));
  t("T17 数据体检能查出缺蓝图等问题", health.rows >= 1 && health.hasBp, JSON.stringify(health));
  await page.evaluate(() => closeSheet());

  await page.evaluate(() => nav({ page: "settings" }));
  await page.waitForTimeout(500);
  const about = await page.evaluate(() => ({
    ver: document.body.textContent.includes(APP_VERSION),
    storage: (document.querySelector("#st-storage") || {}).textContent || "",
    count: (document.querySelector("#st-novel-count") || {}).textContent || "",
    mat: !!document.querySelector("#st-mat"),
  }));
  t("T18 设置页有关于信息与资料库入口",
    about.ver && /IndexedDB|localStorage/.test(about.storage) && about.mat, JSON.stringify(about));

  /* T19 无 JS 错误 */
  t("T19 全程无 JS 报错", errors.length === 0, errors.slice(0, 2).join(" ; "));

  await browser.close();
  const pass = results.filter(r => r.ok).length;
  console.log(`\n${pass}/${results.length} 通过`);
  process.exit(pass === results.length ? 0 : 1);
})();
