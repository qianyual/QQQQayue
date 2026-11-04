/* 书童移动版 E2E：EPUB 解析 + 素材检索 */
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

  /* T1 环境支持 deflate-raw */
  const support = await page.evaluate(() => ({ dcs: typeof DecompressionStream === "function", epub: Epub.supports() }));
  t("T1 原生解压可用", support.dcs && support.epub, JSON.stringify(support));

  /* T2 解析 EPUB：章数 / 书名 / 正文 */
  const parsed = await page.evaluate(async () => {
    const buf = await (await fetch("test-fixtures/test.epub")).arrayBuffer();
    const p = await Epub.parse(buf);
    return { title: p.title, count: p.chapters.length, first: p.chapters[0].title, text: p.chapters[0].text.slice(0, 40), joined: Epub.toText(p).slice(0, 30) };
  });
  t("T2 EPUB 解析出 2 章", parsed.count === 2 && parsed.title === "测试之书", JSON.stringify(parsed).slice(0, 90));

  /* T3 章节标题与实体解码 */
  t("T3 标题与实体正确", parsed.first.includes("雾港") && parsed.text.includes("雾从海面"), parsed.first + " / " + parsed.text);

  /* T4 规范文本带「第N章」标记，能走原有拆章 */
  const split = await page.evaluate(() => {
    const s = splitChapters(Epub.toText({ chapters: [{ title: "雾港", text: "甲甲甲" }, { title: "旧信", text: "乙乙乙" }] }));
    return s.map(c => c.number + ":" + c.title);
  });
  t("T4 解析结果可被拆章识别", split.length === 2 && split[0].startsWith("1:"), JSON.stringify(split));

  /* T5 非 epub 内容给出明确错误 */
  const bad = await page.evaluate(async () => {
    try { await Epub.parse(new TextEncoder().encode("not a zip at all").buffer); return "no-error"; }
    catch (e) { return e.message; }
  });
  t("T5 非法文件报错清晰", bad.includes("EPUB"), bad);

  /* T6 导入面板接受 epub */
  await page.evaluate(() => nav({ page: "shelf" }));
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector("#btn-import").click());
  await page.waitForTimeout(250);
  const accept = await page.evaluate(() => document.querySelector("#im-file").getAttribute("accept"));
  t("T6 导入面板支持 .epub", accept.includes(".epub"), accept);

  t("T7 全程无 JS 错误", errors.length === 0, errors.slice(0, 2).join(" / "));

  await browser.close();
  const passed = results.filter(r => r.ok).length;
  console.log(`\n======== SUMMARY: ${passed}/${results.length} passed ========`);
  process.exit(passed === results.length ? 0 : 1);
})();
