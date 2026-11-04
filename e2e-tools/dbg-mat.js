const { chromium } = require("playwright-core");
const EDGE = "C://Program Files (x86)//Microsoft//Edge//Application//msedge.exe";
(async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  p.on("pageerror", e => console.log("ERR:", e.message));
  await p.goto("http://127.0.0.1:4173/index.html", { waitUntil: "networkidle" });
  await p.waitForTimeout(600);
  const out = await p.evaluate(async () => {
    const n = DB.newNovel("t");
    n.chapters.push(Object.assign(DB.newChapter(n,1,"a"), { content: "雾从海面压上来。", status: "草稿" }));
    n.blueprints.push({ chapterNumber: 1, title: "a", purpose: "p", keyEvents: "k", suspenseHook: "h", beats: [] });
    await DB.putNovel(n);
    State.novel = n;
    const r = Materials.add(n, { title: "地名志", text: "灯塔建在雾港最北的礁石上，铜制灯座由首任守塔人铸造。雾港常年有雾，渔船靠钟声辨位。" });
    const after = {
      err: r.error || null,
      mats: (State.novel.materials || []).length,
      chunks: r.material ? r.material.chunks.length : 0,
    };
    const hits = Materials.search(State.novel, "灯塔 灯座", 4);
    const msgs = await buildChapterPrompt(State.novel, 1, getBlueprint(State.novel,1), getChapter(State.novel,1));
    const user = msgs[msgs.length-1].content;
    return { after, hits: hits.length, user, hasMat: /参考资料/.test(user) };
  });
  console.log(JSON.stringify(out, null, 1).slice(0, 1600));
  await b.close();
})();
