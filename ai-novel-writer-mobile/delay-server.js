/* 测试服务器：静态服务 + /slow.js 延迟 5 秒返回（拖住 load 事件，等 IndexedDB 回调完成后再 dump-dom） */
const http = require("http");
const fs = require("fs");
const path = require("path");
const ROOT = __dirname;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json" };
http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const send = (file) => {
    fs.readFile(path.join(ROOT, file), (err, data) => {
      if (err) { res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    });
  };
  if (urlPath === "/slow.js") {
    setTimeout(() => { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end("// slow ok"); }, 5000);
    return;
  }
  send(urlPath === "/" ? "index.html" : urlPath.slice(1));
}).listen(4174, () => console.log("test server on 4174"));
