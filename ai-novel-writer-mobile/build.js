/* 打包脚本：
 * 1) dist/书童移动版-单文件.html —— 内联全部 CSS/JS，手机本地直接打开
 * 2) dist/书童移动版-site.zip   —— 标准静态站点（PWA 完整能力）
 */
const fs = require("fs");
const path = require("path");
const ROOT = __dirname;

fs.mkdirSync(path.join(ROOT, "dist"), { recursive: true });

/* ---------- 单文件版 ---------- */
let html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
html = html.replace(/<link rel="stylesheet" href="css\/style.css" ?\/?>/, () => {
  const css = fs.readFileSync(path.join(ROOT, "css", "style.css"), "utf8");
  return "<style>\n" + css + "\n</style>";
});
html = html.replace(/<script src="(js\/[a-z]+\.js)"><\/script>/g, (_, p) => {
  const js = fs.readFileSync(path.join(ROOT, p), "utf8");
  return "<script>\n" + js + "\n</script>";
});
// 单文件下 SW/manifest 无意义，去掉引用避免 404
html = html.replace(/<link rel="manifest"[^>]*>\s*/i, "");
html = html.replace(/<script>[\s\S]*?serviceWorker[\s\S]*?<\/script>/, (m) => m); // app.js 内部已有 http 判断，无需处理
const singlePath = path.join(ROOT, "dist", "书童移动版-单文件.html");
fs.writeFileSync(singlePath, html, "utf8");
console.log("OK  " + singlePath + "  (" + Math.round(fs.statSync(singlePath).size / 1024) + " KB)");

/* ---------- 站点 zip ---------- */
const { execSync } = require("child_process");
const stage = path.join(ROOT, "dist", "site");
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
for (const item of ["index.html", "css", "js", "manifest.webmanifest", "sw.js", "icon.svg"]) {
  fs.cpSync(path.join(ROOT, item), path.join(stage, item), { recursive: true });
}
const zipPath = path.join(ROOT, "dist", "书童移动版-site.zip");
try {
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${stage}\\*' -DestinationPath '${zipPath}' -Force"`, { stdio: "inherit" });
  console.log("OK  " + zipPath + "  (" + Math.round(fs.statSync(zipPath).size / 1024) + " KB)");
} catch (e) {
  console.error("zip failed:", e.message);
}
console.log("DONE");
