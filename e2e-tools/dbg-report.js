const { chromium } = require("playwright-core");
const EDGE = "C://Program Files (x86)//Microsoft//Edge//Application//msedge.exe";
(async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  p.on("pageerror", e => console.log("ERR:", e.message));
  await p.goto("http://127.0.0.1:4173/index.html", { waitUntil: "networkidle" });
  await p.waitForTimeout(500);
  const out = await p.evaluate(() => {
    const n = DB.newNovel("调试");
    const c = DB.newChapter(n, 1, "测试");
    c.content = "他握紧了那盏铜灯。";
    n.chapters.push(c);
    State.novel = n;
    closeSheet();
    skillReportSheet({ id: "logic-audit", name: "逻辑硬伤" },
      [{ severity: "high", dimension: "因果断裂", quote: "他握紧了那盏铜灯", comment: "灯从哪来的？", fix: "补一句来历。" }], 1);
    const rv = document.querySelector(".sk-rv");
    const body = document.querySelector(".sk-rv-body");
    return {
      html: document.querySelector(".sk-report") ? document.querySelector(".sk-report").innerHTML.slice(0, 400) : "NO REPORT",
      rvRect: rv ? rv.getBoundingClientRect() : null,
      bodyRect: body ? body.getBoundingClientRect() : null,
      bodyText: body ? body.textContent.trim().slice(0, 60) : null,
      rvStyle: rv ? getComputedStyle(rv).display + " / " + getComputedStyle(rv).height : null,
      bodyStyle: body ? getComputedStyle(body).display + " / " + getComputedStyle(body).height + " / " + getComputedStyle(body).color : null,
      reportStyle: (() => { const e = document.querySelector(".sk-report"); return e ? getComputedStyle(e).height + " ovf:" + getComputedStyle(e).overflowY : null; })(),
    };
  });
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
