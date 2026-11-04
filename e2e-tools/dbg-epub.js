const { chromium } = require("playwright-core");
const EDGE = "C://Program Files (x86)//Microsoft//Edge//Application//msedge.exe";
(async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const p = await b.newPage();
  p.on("console", m => console.log("LOG:", m.text()));
  await p.goto("http://127.0.0.1:4173/index.html", { waitUntil: "networkidle" });
  const out = await p.evaluate(async () => {
    const buf = await (await fetch("test-fixtures/test.epub")).arrayBuffer();
    const view = new DataView(buf);
    const names = [];
    for (let i = 0; i < buf.byteLength - 4; i++) if (view.getUint32(i, true) === 0x06054b50) { names.push("EOCD@" + i); }
    // 直接用内部函数不可见，重放一段读目录逻辑
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= 0; i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    const count = view.getUint16(eocd + 10, true);
    const cdOffset = view.getUint32(eocd + 16, true);
    let p2 = cdOffset; const entries = [];
    for (let i = 0; i < count; i++) {
      if (view.getUint32(p2, true) !== 0x02014b50) { entries.push("BAD SIG@" + p2); break; }
      const nameLen = view.getUint16(p2 + 28, true);
      const extraLen = view.getUint16(p2 + 30, true);
      const commentLen = view.getUint16(p2 + 32, true);
      const name = new TextDecoder().decode(new Uint8Array(buf, p2 + 46, nameLen));
      entries.push(name + " m=" + view.getUint16(p2 + 10, true));
      p2 += 46 + nameLen + extraLen + commentLen;
    }
    return { size: buf.byteLength, eocd, count, cdOffset, entries, marks: names };
  });
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
