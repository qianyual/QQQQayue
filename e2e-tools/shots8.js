/* 视频专用截图：干净 profile + 4 本书，供介绍视频使用 */
const { chromium } = require("playwright-core");
const fs = require("fs");
const EDGE = "C://Program Files (x86)//Microsoft//Edge//Application//msedge.exe";
const OUT = "C://Users//JiaoLong16Pro2025//WorkBuddy//2026-11-03-21-38-31//ui-shots//";
const PROFILE = "C://Users//JiaoLong16Pro2025//WorkBuddy//2026-11-03-21-38-31//e2e-tools//.profile-video";

const BOOKS = [
  {
    name: "雾港", cover: "linear-gradient(135deg,#8c3b2e,#c96f4a)", genre: "悬疑", total: 24, written: 6, final: 3,
    outline: "守塔人林砚在雾夜收到十年前的信，信里写着灯塔第一次熄灭的原因。",
    titles: ["雾港来信", "铜座下的旧信", "钟楼夜话", "咸水井", "第二封信", "灯塔熄灭"],
    text: "雾从海面压上来，把灯塔裹成一根将熄的烛。林砚把灯芯挑亮，听见门外有人敲门——三长两短。\n\n他没有立刻起身。铜座上的信还摊着，落款的日期比父亲失踪那年早了整整十年。\n\n楼梯在脚下发出细碎的声响，像有人在数着台阶往上走。林砚把手按在灯罩上，烫得发疼。\n\n“谁？”他问。\n\n门外的敲声停了。雾里传来一声很轻的笑，随即是第二遍——三长两短。",
  },
  {
    name: "长夜行舟", cover: "linear-gradient(135deg,#2e5e8c,#5a9bc9)", genre: "古代言情", total: 60, written: 12, final: 9,
    outline: "漕运女掌舵人沈昭，在一条不该出现的船上遇见了本该死去的人。",
    titles: ["夜泊", "旧帆", "渡口无人", "灯下书", "第七日", "沉舟"],
    text: "雨落了三日，河面涨得比岸还高。沈昭把最后一盏灯挑上船头，才看见下游漂来一条没有旗的船。\n\n那船的帆是旧的，补丁的位置她认得——是她父亲的手艺。",
  },
  {
    name: "第七次搬家", cover: "linear-gradient(135deg,#3e7d4f,#7db88f)", genre: "都市", total: 40, written: 3, final: 1,
    outline: "一个总在搬家的女人，发现每一间旧屋都留着同一把钥匙。",
    titles: ["押金", "房东", "空房间"], text: "第七次搬家那天，我在新家的抽屉里摸到一把钥匙。铜的，齿口磨得很圆，像是被人反复插进锁孔里过。",
  },
  {
    name: "山海拾遗", cover: "linear-gradient(135deg,#8c6d2e,#c9a75a)", genre: "玄幻", total: 120, written: 28, final: 25,
    outline: "少年在旧书摊拾得半卷山海图，图上每一座山都还在长。",
    titles: ["旧书摊", "第一座山", "山在长", "守图人", "第八页", "借山"], text: "旧书摊的书都带着潮气，只有那一卷是干的。少年翻开第一页，看见一座山正在纸面上缓慢地长高。",
  },
  {
    name: "雪落无声", cover: "linear-gradient(135deg,#5a4a6e,#8e7ba8)", genre: "悬疑", total: 40, written: 18, final: 15,
    outline: "暴雪封山的第七天，民宿里的六个人开始互相怀疑。",
    titles: ["封山", "第一夜", "脚印", "雪下的车", "第五个人", "回声"], text: "雪把山路埋了。老板娘说，这雪要下七天，七天里谁也上不来，谁也别想下去。",
  },
  {
    name: "旧钟表店", cover: "linear-gradient(135deg,#2e6e6a,#6fb3ad)", genre: "都市奇幻", total: 36, written: 9, final: 6,
    outline: "钟表店老板能修好任何时间，除了自己的那一天。",
    titles: ["停摆", "修表人", "倒退的针", "第三根发条", "旧日", "重新上弦"], text: "店里所有的钟都停在三点十七分。老人说，不是坏了，是那天还没过去。",
  },
];

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: EDGE, headless: true,
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  });
  const p = ctx.pages()[0] || (await ctx.newPage());
  p.on("pageerror", (e) => console.log("ERR:", e.message));
  await p.goto("http://127.0.0.1:4173/index.html", { waitUntil: "networkidle" });
  await p.waitForTimeout(500);

  const ids = await p.evaluate(async (BOOKS) => {
    const out = [];
    for (const b of BOOKS) {
      const n = DB.newNovel(b.name);
      n.cover = b.cover;
      n.config.genre = b.genre;
      n.config.totalChapters = b.total;
      n.config.coreOutline = b.outline;
      n.novelInfoSet = true;
      for (let i = 1; i <= b.written; i++) {
        const c = DB.newChapter(n, i, b.titles[(i - 1) % b.titles.length] + (i > b.titles.length ? " · " + i : ""));
        c.content = b.text.repeat(Math.max(1, Math.ceil(180 / b.text.length)));
        c.wordCount = countWords(c.content);
        c.status = i <= b.final ? "定稿" : "草稿";
        n.chapters.push(c);
        if (i <= b.final) n.blueprints.push({ chapterNumber: i, title: c.title, purpose: "推进主线", keyEvents: b.outline, suspenseHook: "落款是十年前的日期", beats: [], targetWords: 3000 });
      }
      n.characters.push({ id: "c1", name: "林砚", role: "protagonist", profile: "守塔人，寡言", state: {} });
      n.threads = [
        { id: "t1", thread: "灯塔为何十年不灭", status: "已埋", plantedAt: 1, lastMovedAt: 1 },
        { id: "t2", thread: "三长两短的敲门暗号", status: "已埋", plantedAt: 2, lastMovedAt: 5 },
        { id: "t3", thread: "铜座下的旧信是谁放的", status: "已埋", plantedAt: 3, lastMovedAt: 3 },
        { id: "t4", thread: "咸水井里的倒影", status: "已收", plantedAt: 4, lastMovedAt: 6 },
      ];
      Materials.add(n, { title: "雾港地名志", text: "灯塔建在雾港最北的礁石上，塔高三十丈，铜制灯座由首任守塔人亲手铸造。\n\n雾港常年有雾，渔船靠钟声辨位，钟楼在灯塔西侧三百步。" });
      await DB.putNovel(n);
      out.push(n.id);
    }
    return out;
  }, BOOKS);

  const shot = async (name, wait = 450) => { await p.waitForTimeout(wait); await p.screenshot({ path: OUT + name }); console.log("shot", name); };

  await p.reload({ waitUntil: "networkidle" });
  await p.waitForTimeout(700);
  await shot("vid-shelf.png");

  // 作品页
  await p.evaluate((id) => openNovel(id), ids[0]);
  await shot("vid-novel.png", 700);

  // 编辑器（定稿章节）
  await p.evaluate(() => nav({ page: "chapter", novelId: State.novel.id, chNum: 1 }));
  await shot("vid-editor.png", 900);

  // 深色编辑器
  await p.evaluate(() => { document.documentElement.classList.add("dark"); document.body.classList.add("dark"); });
  await shot("vid-editor-dark.png", 500);
  await p.evaluate(() => { document.documentElement.classList.remove("dark"); document.body.classList.remove("dark"); });

  // 设置页
  await p.evaluate(() => nav({ page: "settings" }));
  await shot("vid-settings.png", 700);
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot("vid-settings-bottom.png", 600);

  // 深色书架
  await p.evaluate(() => { document.documentElement.classList.add("dark"); document.body.classList.add("dark"); nav({ page: "shelf" }); });
  await shot("vid-shelf-dark.png", 800);

  await ctx.close();
})();
