/* 书童移动版 E2E：v1.4 新功能（逐段合并 / 逐字对比 / 关系图谱 / 导出 zip / 外观 / 模板编辑 / 命令面板） */
const { chromium } = require("playwright-core");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:4173";

(async () => {
  const results = [];
  const t = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? "PASS" : "FAIL") + " | " + name + (detail ? " | " + detail : "")); };

  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  /* 准备一部有角色、有章节的作品 */
  await page.evaluate(async () => {
    const n = DB.newNovel("E2E新功能");
    n.characters = [
      { id: "c1", name: "林砚", role: "protagonist", relationships: "与沈灯（青梅竹马）；与赵无极：师徒" },
      { id: "c2", name: "沈灯", role: "supporting", relationships: "林砚是她的救命恩人" },
      { id: "c3", name: "赵无极", role: "antagonist", relationships: "与林砚：表面师徒，实则夺舍" },
    ];
    const c1 = DB.newChapter(n, 1, "雾夜");
    c1.content = "第一段原文，写得很平。\n\n第二段原文，信息量偏少。\n\n第三段原文，保留不动。";
    c1.status = "草稿";
    c1.wordCount = countWords(c1.content);
    n.chapters.push(c1);
    await DB.putNovel(n);
    await openNovel(n.id);
  });
  await page.waitForTimeout(400);

  /* T1 段落对齐：差异段落数正确 */
  const seg = await page.evaluate(() => {
    const s = Merge.computeSegments("甲段。\n\n乙段。\n\n丙段。", "甲段。\n\n乙段改。\n\n丙段。");
    return { same: s.filter(x => x.type === "same").length, hunk: Merge.hunkCount(s) };
  });
  t("T1 段落对齐识别 1 处改动", seg.hunk === 1, JSON.stringify(seg));

  /* T2 逐段合并面板 */
  await page.evaluate(() => { nav({ page: "chapter", chNum: 1 }); });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const c = getChapter(State.novel, 1);
    mergeSheet(1, c.content, "第一段原文，改得更有张力。\n\n第二段原文，补足了细节。\n\n第三段原文，保留不动。");
  });
  await page.waitForTimeout(300);
  const mg = await page.evaluate(() => ({
    hunks: document.querySelectorAll(".mg-hunk").length,
    hasAllOrig: !!document.querySelector("#mg-all-orig"),
    hasAllRev: !!document.querySelector("#mg-all-rev"),
  }));
  t("T2 合并面板列出 2 处改动", mg.hunks === 2 && mg.hasAllOrig && mg.hasAllRev, JSON.stringify(mg));

  /* T3 逐段选择：第二处改成修稿 */
  await page.evaluate(() => {
    const hunk = document.querySelectorAll(".mg-hunk")[1];
    hunk.querySelector('.mg-choice.revised').click();
  });
  await page.waitForTimeout(150);
  const picked = await page.evaluate(() => {
    const hunk = document.querySelectorAll(".mg-hunk")[1];
    return hunk.querySelector(".mg-choice.revised").classList.contains("active")
      && !hunk.querySelector(".mg-choice.original").classList.contains("active");
  });
  t("T3 单段可切到修稿", picked);

  /* T4 合并应用：只有选中的那段变 */
  await page.evaluate(() => document.querySelector("#mg-apply").click());
  await page.waitForTimeout(500);
  const merged = await page.evaluate(() => getChapter(State.novel, 1).content);
  t("T4 合并结果按段拼装", merged.includes("写得很平") && merged.includes("补足了细节") && merged.includes("保留不动"), merged.replace(/\n/g, "⏎").slice(0, 60));

  /* T5 合并前自动存历史 */
  const verCount = await page.evaluate(() => (getChapter(State.novel, 1).versions || []).length);
  t("T5 合并前自动备份", verCount >= 1, "versions=" + verCount);

  /* T6 逐字对比 */
  await page.evaluate(() => diffSheet(1, "他把门推开，屋里没有人。", "他把窗推开，屋里空无一人。", "旧版", "新版"));
  await page.waitForTimeout(250);
  const df = await page.evaluate(() => ({
    del: document.querySelectorAll(".df-change del").length,
    ins: document.querySelectorAll(".df-change ins").length,
  }));
  t("T6 逐字对比有增删标记", df.del > 0 && df.ins > 0, JSON.stringify(df));

  /* T7 关系图谱：解析 + 渲染 */
  await page.evaluate(() => { closeSheet(); graphSheet(); });
  await page.waitForTimeout(350);
  const gp = await page.evaluate(() => ({
    nodes: document.querySelectorAll("#gp-canvas .g-node").length,
    edges: document.querySelectorAll("#gp-canvas path").length,
    legend: document.querySelector("#gp-legend").textContent.trim(),
  }));
  t("T7 图谱渲染 3 节点 + 关系边", gp.nodes === 3 && gp.edges >= 2 && gp.legend.includes("人"), JSON.stringify(gp));

  /* T8 点节点只看相关关系 */
  await page.evaluate(() => document.querySelector("#gp-canvas .g-node").dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await page.waitForTimeout(250);
  const detail = await page.evaluate(() => document.querySelector("#gp-detail").textContent);
  t("T8 点节点高亮相邻关系", detail.includes("林砚") && detail.includes("条关系"), detail.slice(0, 40));

  /* T9 导出：zip 结构正确（PK 头 + UTF-8 名） */
  const zipInfo = await page.evaluate(async () => {
    const files = Exporter.splitMd(State.novel);
    const blob = Exporter.zip(files);
    const buf = new Uint8Array(await blob.arrayBuffer());
    return { count: files.length, size: buf.length, sig: [buf[0], buf[1], buf[2], buf[3]], name: files[1] && files[1].name };
  });
  t("T9 分章 zip 可生成", zipInfo.count >= 1 && zipInfo.size > 100 && zipInfo.sig.join(",") === "80,75,3,4", JSON.stringify(zipInfo));

  /* T10 合并稿含大纲与人物 */
  const mdText = await page.evaluate(() => Exporter.mergedMd(State.novel, { includeOutline: true, includeCharacters: true }));
  t("T10 合并稿带大纲/角色/正文", mdText.includes("## 作品设定") && mdText.includes("## 角色") && mdText.includes("第1章"), "len=" + mdText.length);

  /* T11 导出面板三格式 */
  await page.evaluate(() => { closeSheet(); exportSheet(); });
  await page.waitForTimeout(250);
  const ex = await page.evaluate(() => document.querySelectorAll("#ex-format .chip").length);
  t("T11 导出面板含三种格式", ex === 3, "chips=" + ex);
  await page.evaluate(() => closeSheet());

  /* T12 外观设置：字号变量即时生效 */
  await page.evaluate(() => nav({ page: "settings" }));
  await page.waitForTimeout(300);
  const hasAppearance = await page.evaluate(() => !!document.querySelector("#st-fs") && !!document.querySelector("#st-font") && !!document.querySelector("#st-autonext"));
  await page.evaluate(() => {
    const el = document.querySelector("#st-fs");
    el.value = "21";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(200);
  const fontVar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--editor-size").trim());
  t("T12 外观面板 + 字号变量生效", hasAppearance && fontVar === "21px", "size=" + fontVar);

  /* T13 字体切换 */
  await page.evaluate(() => document.querySelectorAll("#st-font .chip")[2].click());
  await page.waitForTimeout(200);
  const fontFamily = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--editor-font"));
  t("T13 字体切换写入变量", /Kaiti|KaiTi/i.test(fontFamily), fontFamily.slice(0, 30));

  /* T14 提示词模板列表 */
  await page.evaluate(() => promptSheet());
  await page.waitForTimeout(300);
  const pl = await page.evaluate(() => document.querySelectorAll("[data-p]").length);
  t("T14 模板列表可打开", pl >= 20, "templates=" + pl);

  /* T15 改模板 → 立即生效 → 可恢复 */
  const editRes = await page.evaluate(async () => {
    const before = T.chapter_draft.task;
    await DB.kvSet("promptOverrides", { chapter_draft: "测试用自定义模板" });
    applyPromptOverrides(await DB.kvGet("promptOverrides", {}));
    const applied = T.chapter_draft.task;
    resetPrompt("chapter_draft");
    return { before: before.slice(0, 10), applied, restored: T.chapter_draft.task === before };
  });
  t("T15 覆盖与恢复模板", editRes.applied === "测试用自定义模板" && editRes.restored, JSON.stringify(editRes).slice(0, 70));
  await page.evaluate(async () => {
    const map = await DB.kvGet("promptOverrides", {});
    delete map.chapter_draft;
    await DB.kvSet("promptOverrides", map);
    closeSheet();
  });

  /* T16 命令面板搜索 */
  await page.evaluate(() => { nav({ page: "shelf" }); });
  await page.waitForTimeout(400);
  await page.evaluate(() => { document.querySelector("#btn-search").click(); });
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const i = document.querySelector("#cp-input");
    i.value = "导出";
    i.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(200);
  const cp = await page.evaluate(() => ({
    items: document.querySelectorAll(".cp-item").length,
    text: document.querySelector("#cp-list").textContent,
  }));
  t("T16 命令面板可按功能搜索", cp.items >= 1 && cp.text.includes("导出"), "items=" + cp.items);
  await page.evaluate(() => closeSheet());

  /* T17 命令面板搜章节 */
  await page.evaluate(() => { document.querySelector("#btn-search").click(); });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const i = document.querySelector("#cp-input");
    i.value = "雾夜";
    i.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(200);
  const cp2 = await page.evaluate(() => document.querySelector("#cp-list").textContent);
  t("T17 命令面板可搜到章节", cp2.includes("第1章"), cp2.slice(0, 40));
  await page.evaluate(() => closeSheet());

  t("T18 全程无 JS 错误", errors.length === 0, errors.slice(0, 3).join(" / "));

  await browser.close();
  const passed = results.filter(r => r.ok).length;
  console.log(`\n======== SUMMARY: ${passed}/${results.length} passed ========`);
  process.exit(passed === results.length ? 0 : 1);
})();
