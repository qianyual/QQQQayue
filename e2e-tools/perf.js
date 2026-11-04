const { chromium } = require("playwright-core");
(async () => {
  const browser = await chromium.launch({ executablePath: "C://Program Files (x86)//Microsoft//Edge//Application//msedge.exe", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:4173/index.html", { waitUntil: "load" });
  await page.waitForTimeout(800);
  await page.click("#btn-new");
  await page.fill("#np-name", "性能测试");
  await page.click("#np-blank");
  await page.waitForTimeout(500);
  await page.click(".bottom-nav button[data-tab='chapters']");
  await page.waitForTimeout(300);
  await page.click("[data-ch='1']");
  await page.waitForTimeout(400);

  const res = await page.evaluate(async () => {
    const ed = document.querySelector("#ch-editor");
    // 先塞入 8000 字长文，模拟写了很多章的状态
    const para = "夜色像一块浸了水的绒布，沉沉地压在城市的屋顶上。林野把电动车停在巷口，抬头看了看天，他知道今晚不会太平。";
    ed.value = Array(60).join(para);
    ed.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));

    const times = [];
    for (let i = 0; i < 120; i++) {
      const t0 = performance.now();
      ed.value += "字";
      ed.dispatchEvent(new Event("input", { bubbles: true }));
      // 强制读取布局，测出真实的重排代价
      void ed.offsetHeight;
      times.push(performance.now() - t0);
      await new Promise(r => setTimeout(r, 8));
    }
    times.sort((a, b) => a - b);
    const sum = times.reduce((a, b) => a + b, 0);
    return {
      len: ed.value.length,
      avg: +(sum / times.length).toFixed(2),
      p95: +times[Math.floor(times.length * 0.95)].toFixed(2),
      max: +times[times.length - 1].toFixed(2),
    };
  });
  console.log(`文本长度 ${res.len} 字 | 每次输入平均 ${res.avg}ms，P95 ${res.p95}ms，最差 ${res.max}ms`);
  console.log(res.p95 < 16 ? "✅ 达标：P95 < 16ms（一帧以内，无感知卡顿）" : "⚠️ 仍有超帧耗时");
  await browser.close();
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
