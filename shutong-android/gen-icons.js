/* 生成安卓全套 mipmap 图标 */
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const root = __dirname;
const res = path.join(root, "android", "app", "src", "main", "res");

const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const fgSizes = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

(async () => {
  for (const [d, s] of Object.entries(sizes)) {
    const dir = path.join(res, `mipmap-${d}`);
    await sharp(path.join(root, "icon-legacy.png")).resize(s, s).png().toFile(path.join(dir, "ic_launcher.png"));
    await sharp(path.join(root, "icon-round.png")).resize(s, s).png().toFile(path.join(dir, "ic_launcher_round.png"));
    await sharp(path.join(root, "icon-fg.png")).resize(fgSizes[d], fgSizes[d]).png().toFile(path.join(dir, "ic_launcher_foreground.png"));
    console.log(d, "done");
  }
  console.log("ALL ICONS DONE");
})().catch(e => { console.error(e); process.exit(1); });
