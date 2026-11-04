/* 书童移动版 E2E：v1.6（技能库审查纠错插件 + 章纲罗盘悬浮窗） */
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

  /* 准备作品：带蓝图（节拍/伏笔/张力）、正文、线索表 */
  const nid = await page.evaluate(async () => {
    const n = DB.newNovel("罗盘测试");
    n.config.coreOutline = "一个守塔人在雾夜收到十年前的信。";
    n.config.wordsPerChapter = 2000;
    const c = DB.newChapter(n, 1, "雾港来信");
    c.content = "雾从海面压上来，把灯塔裹成一根将熄的烛。林砚把灯芯挑亮，听见门外有人敲门——三长两短。";
    c.wordCount = countWords(c.content);
    c.status = "草稿";
    n.chapters.push(c);
    n.blueprints.push({
      chapterNumber: 1, title: "雾港来信",
      purpose: "让林砚决定是否拆开那封信",
      keyEvents: "陌生人来访；铜座下的旧信被发现；灯灭",
      suspenseHook: "信的落款是十年前的日期",
      characters: ["林砚"], tension: 3, targetWords: 2000,
      beats: [{ text: "开场：雾里有人敲门", done: true }, { text: "转折：铜座下摸到信", done: false }, { text: "收束：灯灭", done: false }],
      plantThreads: [{ text: "三长两短的敲门暗号", done: false }, { text: "铜座下的旧信", done: false }],
      payoffThreads: [],
    });
    n.threads = [
      { id: "t-old", thread: "灯塔为何十年不灭", status: "已埋", plantedAt: 1, lastMovedAt: 1 },
    ];
    n.chapters.push(Object.assign(DB.newChapter(n, 8, "旧账"), { content: "这一章离得很远。", wordCount: 9, status: "草稿" }));
    await DB.putNovel(n);
    return n.id;
  });
  await page.waitForTimeout(300);

  /* ================= 一、技能库 ================= */
  const lib = await page.evaluate(() => ({
    total: Skills.all().length,
    groups: Object.keys(Skills.GROUPS),
    enabled: Skills.enabled().length,
    names: Skills.all().map(s => s.name),
    ids: Skills.all().map(s => s.id),
  }));
  t("T1 技能库内置 16 个技能、5 个分组",
    lib.total === 16 && lib.groups.length === 5 && lib.enabled === 16,
    `total=${lib.total} groups=${lib.groups.join(",")}`);

  const covers = ["logic-audit", "continuity", "pacing", "threads", "motivation", "pov", "hook", "scene", "proofread", "ai-tone", "repetition", "dialogue"];
  const missing = covers.filter(x => !lib.ids.includes(x));
  t("T2 审查与纠错类技能齐全（12 项）", missing.length === 0, missing.join(","));

  /* 打开正文页 */
  await page.evaluate(async (id) => { await openNovel(id); }, nid);
  await page.waitForTimeout(400);
  await page.evaluate(() => nav({ page: "chapter", chNum: 1 }));
  await page.waitForTimeout(500);

  /* T3 工具栏有「技能」入口 */
  const hasEntry = await page.evaluate(() => !!document.querySelector("#ed-skills"));
  t("T3 正文页工具栏有技能入口", hasEntry);

  await page.click("#ed-skills");
  await page.waitForTimeout(400);
  const sheetInfo = await page.evaluate(() => ({
    open: !!document.querySelector(".sheet"),
    items: document.querySelectorAll(".sk-item").length,
    groups: [...document.querySelectorAll(".sk-gh span")].map(e => e.textContent),
    tag: (document.querySelector(".sheet-head .tag") || {}).textContent || "",
  }));
  t("T4 技能库面板列出全部技能并分组",
    sheetInfo.open && sheetInfo.items === 16 && sheetInfo.groups.join("/") === "审查/纠错/打磨/章纲/创意",
    JSON.stringify(sheetInfo.groups));

  /* T5 打开单个技能的设置，改检查重点并保存 */
  await page.click('[data-detail="proofread"]');
  await page.waitForTimeout(300);
  const detail = await page.evaluate(() => ({
    hasFocus: !!document.querySelector("#sd-focus"),
    val: (document.querySelector("#sd-focus") || {}).value || "",
    hasOn: !!document.querySelector("#sd-on"),
    hasRun: !!document.querySelector("#sd-run"),
  }));
  t("T5 技能详情含检查重点、启用开关、运行按钮",
    detail.hasFocus && detail.val.includes("错别字") && detail.hasOn && detail.hasRun, detail.val.slice(0, 20));

  await page.evaluate(() => { document.querySelector("#sd-focus").value = "只查：1. 错别字 2. 的地得 3. 标点。"; });
  await page.click("#sd-save");
  await page.waitForTimeout(350);
  const afterEdit = await page.evaluate(() => ({
    focus: Skills.get("proofread").focus,
    edited: Skills.get("proofread").edited,
    backToList: document.querySelectorAll(".sk-item").length,
  }));
  t("T6 改提示词生效且标为「已改」",
    afterEdit.focus.includes("的地得") && afterEdit.edited && afterEdit.backToList === 16,
    JSON.stringify(afterEdit));

  /* T7 停用技能并持久化 */
  await page.click('[data-detail="dialogue"]');
  await page.waitForTimeout(300);
  await page.uncheck("#sd-on");
  await page.click("#sd-save");
  await page.waitForTimeout(350);
  const disabled = await page.evaluate(() => ({
    enabled: Skills.get("dialogue").enabled,
    count: document.querySelector(".sheet-head .tag").textContent.trim(),
    offRows: document.querySelectorAll(".sk-item.off").length,
  }));
  t("T7 停用技能后计数与灰显同步", !disabled.enabled && /15\/16/.test(disabled.count) && disabled.offRows === 1, JSON.stringify(disabled));

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const persisted = await page.evaluate(() => ({
    off: Skills.get("dialogue").enabled,
    focus: Skills.get("proofread").focus,
  }));
  t("T8 技能启停与改词刷新后仍在", !persisted.off && persisted.focus.includes("的地得"), JSON.stringify(persisted));

  /* 回到正文页 */
  const nid2 = await page.evaluate(async () => {
    const list = await DB.listNovels();
    const n = list.find(x => x.name === "罗盘测试");
    await openNovel(n.id);
    return n.id;
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => nav({ page: "chapter", chNum: 1 }));
  await page.waitForTimeout(500);

  /* T9 自建技能 */
  await page.click("#ed-skills");
  await page.waitForTimeout(350);
  await page.click("#sk-new");
  await page.waitForTimeout(300);
  await page.fill("#se-name", "古风用词审查");
  await page.fill("#se-desc", "检查现代词混入古风场景");
  await page.fill("#se-focus", "1. 现代词汇 2. 称谓不合 3. 器物与朝代不符");
  await page.click("#se-save");
  await page.waitForTimeout(400);
  const custom = await page.evaluate(() => {
    const s = Skills.all().find(x => x.name === "古风用词审查");
    return {
      exists: !!s, custom: !!(s && s.custom), group: s && s.group,
      focus: s && s.focus, rows: document.querySelectorAll(".sk-item").length,
    };
  });
  t("T9 可自建技能并出现在库里", custom.exists && custom.custom && custom.group === "check" && custom.focus.includes("现代词汇") && custom.rows === 17, JSON.stringify(custom));

  await page.evaluate(() => closeSheet());
  await page.waitForTimeout(200);

  /* T10 技能 prompt 注入了作品上下文 */
  const prompt = await page.evaluate(() => {
    const msgs = Skills.buildMessages(Skills.get("logic-audit"), State.novel, 1);
    const u = msgs[1].content;
    return {
      sys: msgs[0].content,
      hasName: u.includes("罗盘测试"),
      hasDraft: u.includes("林砚把灯芯挑亮"),
      hasBlueprint: u.includes("让林砚决定是否拆开那封信"),
      hasThreads: u.includes("灯塔为何十年不灭"),
      hasJSON: msgs[0].content.includes("JSON"),
      len: u.length,
    };
  });
  t("T10 提示词注入了设定/正文/章纲/未回收线索",
    prompt.hasName && prompt.hasDraft && prompt.hasBlueprint && prompt.hasThreads && prompt.hasJSON && prompt.len > 500,
    `len=${prompt.len}`);

  /* T11 教练型技能用 Markdown 指令而非 JSON */
  const proseSys = await page.evaluate(() => Skills.buildMessages(Skills.get("style-coach"), State.novel, 1)[0].content);
  t("T11 教练型技能输出格式不同", /Markdown/.test(proseSys) && !/只输出 JSON 数组/.test(proseSys));

  /* ================= 二、章纲罗盘 ================= */
  const hud = await page.evaluate(() => ({
    exists: !!document.querySelector("#cp-hud"),
    pill: (document.querySelector(".cp-pn") || {}).textContent || "",
    hidden: document.querySelector(".cp-panel") ? document.querySelector(".cp-panel").hidden : null,
  }));
  t("T12 正文页出现章纲罗盘胶囊", hud.exists && /1\/3/.test(hud.pill) && hud.pill.length > 0, JSON.stringify(hud));

  await page.click(".cp-pill");
  await page.waitForTimeout(350);
  const opened = await page.evaluate(() => {
    const p = document.querySelector(".cp-panel");
    return {
      open: p && !p.hidden,
      tabs: [...document.querySelectorAll(".cp-tab")].map(e => e.textContent.trim()),
      purpose: (document.querySelector(".cp-goal") || {}).textContent || "",
      beats: document.querySelectorAll(".cp-beat").length,
      doneBeats: document.querySelectorAll(".cp-beat.done").length,
      plants: document.querySelectorAll(".cp-th[data-plant]").length,
      words: (document.querySelector(".cp-wordrow b") || {}).textContent || "",
      hook: (document.querySelector(".cp-hook") || {}).textContent || "",
    };
  });
  t("T13 展开后面板显示章纲/节拍/伏笔/字数",
    opened.open && opened.tabs.join("/") === "本章/大纲" && opened.purpose.includes("拆开那封信") &&
    opened.beats === 3 && opened.doneBeats === 1 && opened.plants === 2 && parseInt(opened.words) > 30 && opened.hook.includes("十年前的日期"),
    JSON.stringify(opened));

  /* T14 勾选节拍 → 进度与数据同步 */
  await page.click('.cp-beat[data-beat="1"]');
  await page.waitForTimeout(350);
  const beat = await page.evaluate(() => {
    const b = State.novel.blueprints.find(x => x.chapterNumber === 1);
    return {
      done: b.beats[1].done,
      pill: document.querySelector(".cp-pn").textContent,
      doneCount: document.querySelectorAll(".cp-beat.done").length,
    };
  });
  t("T14 勾选节拍回写并刷新进度", beat.done === true && beat.pill === "2/3" && beat.doneCount === 2, JSON.stringify(beat));

  /* T15 勾选待埋伏笔 → 线索表新增 */
  await page.click('[data-plant="0"]');
  await page.waitForTimeout(350);
  const plant = await page.evaluate(() => {
    const th = State.novel.threads.find(x => x.thread === "三长两短的敲门暗号");
    const b = State.novel.blueprints.find(x => x.chapterNumber === 1);
    return { added: !!th, status: th && th.status, plantedAt: th && th.plantedAt, done: b.plantThreads[0].done };
  });
  t("T15 勾选待埋伏笔写入线索表", plant.added && plant.status === "已埋" && plant.plantedAt === 1 && plant.done === true, JSON.stringify(plant));

  /* T16 张力点选 */
  await page.click('[data-tension="5"]');
  await page.waitForTimeout(300);
  const tension = await page.evaluate(() => {
    const b = State.novel.blueprints.find(x => x.chapterNumber === 1);
    return { v: b.tension, on: document.querySelectorAll(".cp-star.on").length };
  });
  t("T16 张力点选写入并高亮", tension.v === 5 && tension.on === 5, JSON.stringify(tension));

  /* T17 大纲 tab */
  await page.click('[data-tab="outline"]');
  await page.waitForTimeout(300);
  const outline = await page.evaluate(() => ({
    text: (document.querySelector(".cp-outline") || {}).textContent || "",
    rows: document.querySelectorAll(".cp-row").length,
    cur: document.querySelectorAll(".cp-row.cur").length,
  }));
  t("T17 大纲页显示故事大纲与分章章纲", outline.text.includes("守塔人") && outline.rows === 1 && outline.cur === 1, JSON.stringify(outline));

  /* T18 离开正文页罗盘销毁 */
  await page.evaluate(() => nav({ page: "novel" }));
  await page.waitForTimeout(400);
  const gone = await page.evaluate(() => !!document.querySelector("#cp-hud"));
  t("T18 离开正文页罗盘自动移除", !gone);

  await page.evaluate((id) => nav({ page: "chapter", novelId: id, chNum: 1 }), nid2);
  await page.waitForTimeout(500);
  const back = await page.evaluate(() => !!document.querySelector("#cp-hud"));
  t("T19 回到正文页罗盘恢复", back);

  /* T20 隐藏后不再出现，设置页可恢复 */
  await page.evaluate(() => localStorage.setItem("wb.compass.hide", "1"));
  await page.evaluate(() => nav({ page: "novel" }));
  await page.waitForTimeout(300);
  await page.evaluate(() => nav({ page: "chapter", chNum: 1 }));
  await page.waitForTimeout(500);
  const hidden = await page.evaluate(() => ({
    hud: !!document.querySelector("#cp-hud"),
    flag: localStorage.getItem("wb.compass.hide"),
  }));
  t("T20 关闭后正文页不再出现", !hidden.hud && hidden.flag === "1", JSON.stringify(hidden));

  await page.evaluate(() => localStorage.removeItem("wb.compass.hide"));

  /* T21 设置页有两个新卡片 */
  await page.evaluate(() => nav({ page: "settings" }));
  await page.waitForTimeout(400);
  const settings = await page.evaluate(() => ({
    skills: !!document.querySelector("#st-skills"),
    compass: !!document.querySelector("#st-compass"),
    text: document.querySelector(".page").textContent,
  }));
  t("T21 设置页有技能库与章纲罗盘入口", settings.skills && settings.compass && /技能库/.test(settings.text) && /章纲罗盘/.test(settings.text));

  /* T22 作品「更多」菜单有技能库 */
  await page.evaluate(() => nav({ page: "novel" }));
  await page.waitForTimeout(400);
  const moreHas = await page.evaluate(() => {
    moreSheet();
    return !!document.querySelector("#mo-skills");
  });
  t("T22 作品更多菜单可进技能库", moreHas);
  await page.evaluate(() => closeSheet());

  /* T23 命令面板能搜到技能 */
  const palette = await page.evaluate(() => {
    commandPalette();
    const items = [...document.querySelectorAll(".cp-item .name")].map(e => e.textContent);
    closeSheet();
    return items;
  });
  t("T23 命令面板能搜到技能与技能库",
    palette.some(x => /技能库/.test(x)) && palette.filter(x => /^技能 ·/.test(x)).length >= 10,
    `技能项 ${palette.filter(x => /^技能 ·/.test(x)).length} 个`);


  /* ================= 三、技能执行链路（桩模型） ================= */
  await page.evaluate(() => nav({ page: "chapter", chNum: 1 }));
  await page.waitForTimeout(400);

  /* T25 问题清单链路：AI 返回 JSON → 渲染清单（按严重度排序） */
  await page.evaluate(async () => {
    State.settings.models = [{ id: "m1", name: "桩模型", protocol: "openai", baseUrl: "http://x", modelName: "stub", apiKey: "k" }];
    State.settings.defaultModelId = "m1";
    State.settings.aiMode = "auto";
    LLM.streamChat = async () => JSON.stringify([
      { severity: "low", dimension: "标点", quote: "纸角已经发脆", comment: "句末缺句号。", fix: "补句号。" },
      { severity: "high", dimension: "因果断裂", quote: "他握紧了那盏铜灯", comment: "灯从哪来的没交代。", fix: "补一句灯的来源。" },
    ]);
    await runSkill("logic-audit", 1);
  });
  await page.waitForTimeout(600);
  const chain = await page.evaluate(() => ({
    rows: document.querySelectorAll(".sk-rv").length,
    first: (document.querySelector(".sk-rv .sk-comment") || {}).textContent || "",
    quote: (document.querySelector(".sk-rv .sk-quote") || {}).textContent || "",
    fix: (document.querySelector(".sk-rv .sk-fix") || {}).textContent || "",
    highChecked: (document.querySelector('.sk-rv .rv-cb[data-i="0"]') || {}).checked,
    lowChecked: (document.querySelector('.sk-rv .rv-cb[data-i="1"]') || {}).checked,
    fixBtn: !!document.querySelector("#sr-refine"),
  }));
  t("T25 AI 返回的问题渲染成清单并按严重度排序",
    chain.rows === 2 && chain.first.includes("灯从哪来") && chain.quote.includes("铜灯") &&
    chain.fix.includes("来源") && chain.highChecked === true && chain.lowChecked === false && chain.fixBtn,
    JSON.stringify(chain));

  /* T26 教练型链路：Markdown 渲染 */
  await page.evaluate(async () => {
    closeSheet();
    LLM.streamChat = async () => "## 判断\n文字干净。\n\n> 雾从海面压上来\n\n- 删重复\n- 改短句";
    await runSkill("style-coach", 1);
  });
  await page.waitForTimeout(600);
  const prose = await page.evaluate(() => ({
    h: document.querySelectorAll(".md-body .md-h").length,
    q: document.querySelectorAll(".md-body .md-q").length,
    li: document.querySelectorAll(".md-body .md-ul li").length,
    raw: (document.querySelector(".md-body") || {}).textContent || "",
  }));
  t("T26 教练型输出渲染为标题/引用/列表",
    prose.h === 1 && prose.q === 1 && prose.li === 2 && !/^##/.test(prose.raw.trim()), JSON.stringify({ h: prose.h, q: prose.q, li: prose.li }));

  /* T27 章纲链路：JSON 回写蓝图 + 罗盘刷新 */
  await page.evaluate(async () => {
    closeSheet();
    LLM.streamChat = async () => JSON.stringify({
      beats: ["开场：雾更浓了", "转折：信上的字显形", "收束：灯塔熄灭"],
      plantThreads: ["信纸的材质"],
      payoffThreads: ["灯塔为何十年不灭"],
      tension: 5, targetWords: 2600, hook: "门外的人叫出了他的名字",
    });
    await runSkill("blueprint-breakdown", 1);
  });
  await page.waitForTimeout(700);
  const plan = await page.evaluate(() => {
    const b = State.novel.blueprints.find(x => x.chapterNumber === 1);
    return {
      beats: b.beats.length, first: b.beats[0].text, done: b.beats.filter(x => x.done).length,
      plant: b.plantThreads.length, payoff: b.payoffThreads.length,
      tension: b.tension, target: b.targetWords, hook: b.suspenseHook,
      hudPill: (document.querySelector(".cp-pn") || {}).textContent || "",
    };
  });
  t("T27 拆章纲结果写回蓝图并刷新浮窗",
    plan.beats === 3 && plan.first.includes("雾更浓") && plan.done === 0 &&
    plan.plant === 1 && plan.payoff === 1 && plan.tension === 5 && plan.target === 2600 &&
    plan.hook.includes("叫出了他的名字") && plan.hudPill === "0/3",
    JSON.stringify(plan));

  /* T28 辅助模式下禁止生成章纲 */
  const blockedPlan = await page.evaluate(async () => {
    State.settings.aiMode = "assist";
    const before = State.novel.blueprints.find(x => x.chapterNumber === 1).beats.length;
    await runSkill("blueprint-breakdown", 1);
    const after = State.novel.blueprints.find(x => x.chapterNumber === 1).beats.length;
    State.settings.aiMode = "auto";
    return { before, after, sheet: !!document.querySelector(".sheet") };
  });
  t("T28 辅助模式下拆章纲被拦住", blockedPlan.before === blockedPlan.after && !blockedPlan.sheet, JSON.stringify(blockedPlan));

  /* T24 无 JS 错误 */
  t("T24 无 JS 错误", errors.length === 0, errors.slice(0, 3).join(" | "));

  await browser.close();
  const pass = results.filter(r => r.ok).length;
  console.log(`\n======== SUMMARY: ${pass}/${results.length} passed ========`);
  process.exit(pass === results.length ? 0 : 1);
})();
