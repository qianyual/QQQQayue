/* 按原有尺寸生成各密度启动图 */
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const root = __dirname;
const res = path.join(root, "android", "app", "src", "main", "res");

(async () => {
  const dirs = fs.readdirSync(res).filter(d => /^drawable(-|$)/.test(d));
  for (const d of dirs) {
    const f = path.join(res, d, "splash.png");
    if (!fs.existsSync(f)) continue;
    const meta = await sharp(f).metadata();
    const isLand = meta.width > meta.height;
    const master = path.join(root, isLand ? "splash-land.png" : "splash-port.png");
    await sharp(master)
      .resize(meta.width, meta.height, { fit: "cover" })
      .png()
      .toFile(f + ".new");
    fs.renameSync(f + ".new", f);
    console.log(d, `${meta.width}x${meta.height}`, "done");
  }
  console.log("ALL SPLASH DONE");
})().catch(e => { console.error(e); process.exit(1); });
