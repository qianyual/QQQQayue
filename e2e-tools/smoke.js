/* 书童移动版 E2E 冒烟测试：playwright-core + 本机 Edge */
const { chromium } = require("playwright-core");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:4173";

(async () => {
  const results = [];
  const t = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? "PASS" : "FAIL") + " | " + name + (detail ? " | " + detail : "")); };

  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); // iPhone 尺寸
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  // T1 书架
  const shelf = await page.innerHTML("#app");
  t("T1 书架渲染", shelf.includes("书房") && shelf.length > 100, "len=" + shelf.length);

  // T2 新建作品（空白）
  await page.click("#btn-new");
  await page.fill("#np-name", "E2E测试书");
  await page.click("#np-blank");
  await page.waitForTimeout(500);
  const setup = await page.innerHTML("#app");
  t("T2 新建作品进入设定页", setup.includes("E2E测试书") && setup.includes("AI 补全"));

  // T3 填写设定并保存
  await page.fill("[data-cfg='genre']", "都市异能");
  await page.fill("[data-cfg='totalChapters']", "12");
  await page.fill("[data-cfg='coreOutline']", "外卖骑手获得时间暂停能力。");
  await page.waitForTimeout(900); // 等待防抖保存
  t("T3 设定填写不报错", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" / "));

  // T4 架构页
  await page.click("#sf-done");
  await page.waitForTimeout(300);
  const arch = await page.innerHTML("#app");
  t("T4 架构页", arch.includes("角色名单") && arch.includes("情节大纲"));

  // T5 手动加角色
  await page.click("#ch-add");
  await page.fill("[data-ch='name']", "林野");
  await page.click("#cs-save");
  await page.waitForTimeout(300);
  const arch2 = await page.innerHTML("#app");
  t("T5 添加角色", arch2.includes("林野"));

  // T6 蓝图页（无模型，蓝图列表渲染）
  await page.click("#arch-done");
  await page.waitForTimeout(300);
  const bp = await page.innerHTML("#app");
  t("T6 蓝图页", bp.includes("生成章节蓝图"));
  // 无模型点生成 → 应有 toast 引导
  await page.fill("#bp-from", "1");
  await page.fill("#bp-to", "3");
  await page.click("#bp-gen");
  await page.waitForTimeout(300);
  const toastText = await page.innerHTML("#toast-layer");
  t("T7 无模型时引导去设置", toastText.includes("设置"), toastText.trim().slice(0, 40));

  // T8 设置页添加模型（不实际调用）
  await page.click(".bottom-nav button:has-text('正文')").catch(() => {});
  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  // 打开刚才的书
  const shelf2 = await page.innerHTML("#app");
  if (shelf2.includes("E2E测试书")) {
    await page.click(".book-card");
    await page.waitForTimeout(400);
  }
  await page.click(".bottom-nav button[data-tab='chapters']").catch(() => {});
  await page.waitForTimeout(300);
  const chapters = await page.innerHTML("#app");
  t("T8 正文列表", chapters.includes("待写") || chapters.includes("蓝图已就绪"));

  // T9 打开第 1 章编辑器
  await page.click("[data-ch='1']");
  await page.waitForTimeout(400);
  const editorOk = await page.$("#ch-editor");
  const toolbarOk = await page.$("#ed-write");
  t("T9 章节编辑器", !!editorOk && !!toolbarOk);

  // T10 手动输入正文 + 自动保存 + 历史版本（保存为 1.2s 防抖，留足余量）
  await page.fill("#ch-editor", "夜色像一块浸了水的绒布。林野把电动车停在巷口，抬头看了看天。");
  await page.waitForTimeout(1800);
  const stored = await page.evaluate(async () => {
    const ns = await DB.listNovels();
    const n = ns.find(x => x.name === "E2E测试书");
    return n && n.chapters.length && n.chapters[0].content.includes("绒布") ? "saved" : "missing";
  });
  t("T10 正文持久化", stored === "saved", stored);

  // T11 导出菜单能开
  await page.click("#btn-back");
  await page.waitForTimeout(300);
  await page.click("#btn-export");
  await page.waitForTimeout(300);
  const exportSheet = await page.innerHTML(".sheet");
  t("T11 导出菜单", exportSheet.includes("Markdown") && exportSheet.includes("JSON"));

  // T12 设置页 + 添加模型表单
  await page.click("#c-cancel").catch(() => closeSheetSafe());
  async function closeSheetSafe() { await page.evaluate(() => closeSheet()); }
  await page.click(".sheet-mask").catch(() => {});
  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.click("#btn-settings");
  await page.waitForTimeout(300);
  await page.click("#st-add");
  await page.fill("#ms-model", "deepseek-chat");
  await page.fill("#ms-key", "sk-test");
  await page.click("#ms-save");
  await page.waitForTimeout(400);
  const settingsAfter = await page.innerHTML("#app");
  t("T12 添加模型", settingsAfter.includes("deepseek-chat") && settingsAfter.includes("分阶段模型"));

  // T13 刷新后书还在
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const shelf3 = await page.innerHTML("#app");
  t("T13 刷新持久", shelf3.includes("E2E测试书"));

  // ===== 新功能：拆书与仿写 / 批量创作 =====
  // T14 拆书入口
  const hasImport = await page.$("#btn-import");
  t("T14 拆书入口", !!hasImport);

  // T15 章节拆分逻辑
  const split = await page.evaluate(() => {
    const txt = "第一章 雾夜\n" + "夜色如墨。".repeat(50) + "\n\n第二章 漂流瓶\n" + "海上漂来一只瓶子。".repeat(50) + "\n\n第三章 低语\n" + "瓶子里传出声音。".repeat(50);
    const cs = splitChapters(txt);
    return cs.length === 3 && cs[1].title.includes("漂流瓶") && cs[0].content.length > 100;
  });
  t("T15 章节拆分", split);

  // T16 无标题文本按长度切块
  const split2 = await page.evaluate(() => {
    const cs = splitChapters("无标题长文本。".repeat(1000));
    return cs.length >= 2 && cs[0].title.includes("片段");
  });
  t("T16 无标题切块", split2);

  // T17 建一本参考书并检查绑定 UI + 写作 prompt 注入
  const refOk = await page.evaluate(async () => {
    const ref = DB.newNovel("参考书《雾中灯塔》");
    ref.kind = "reference";
    ref.styleAnalysis = "短句为主，对话占四成，情绪点在章末。";
    ref.structureAnalysis = "每3章一个小高潮，章末必留钩子。";
    ref.blueprints = [{ chapterNumber: 1, title: "模式A", purpose: "开场", keyEvents: "主角遇险+能力初现", characters: ["主角"], suspenseHook: "悬念钩" }];
    await DB.putNovel(ref);
    const ns = await DB.listNovels();
    const work = ns.find(x => x.name === "E2E测试书");
    work.referenceId = ref.id;
    await DB.putNovel(work);
    State.novel = work;
    const msgs = await buildChapterPrompt(work, 2, { chapterNumber: 2, title: "t", purpose: "", keyEvents: "", suspenseHook: "" }, { content: "", chapterNumber: 2 });
    return msgs[1].content.includes("仿写参考") && msgs[1].content.includes("文风报告") && msgs[1].content.includes("严禁借用其情节");
  });
  t("T17 仿写约束注入", refOk);

  // T18 批量创作弹层
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.click(".book-card");
  await page.waitForTimeout(400);
  await page.click(".bottom-nav button[data-tab='blueprint']");
  await page.waitForTimeout(300);
  const hasBatch = await page.$("#bp-batch");
  let batchSheetOk = false;
  if (hasBatch) {
    await page.click("#bp-batch");
    await page.waitForTimeout(300);
    batchSheetOk = (await page.innerHTML(".sheet")).includes("批量创作");
    await page.click(".sheet-mask").catch(() => {});
  }
  t("T18 批量创作入口", !!hasBatch && batchSheetOk);

  // T19 全程无页面错误
  t("T19 无 JS 错误", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" / "));

  // 截图存档
  await page.screenshot({ path: "C:/Users/JiaoLong16Pro2025/WorkBuddy/2026-11-03-21-38-31/e2e-tools/last-shot.png" });

  const failed = results.filter(r => !r.ok);
  console.log("======== SUMMARY: " + (results.length - failed.length) + "/" + results.length + " passed ========");
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error("HARNESS ERROR:", e); process.exit(2); });
