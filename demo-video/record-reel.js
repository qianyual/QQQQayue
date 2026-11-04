/* 竖屏 1080×1920 逐帧渲染 → ffmpeg */
const { chromium } = require("playwright-core");
const { spawn } = require("child_process");
const { once } = require("events");
const path = require("path");

const EDGE = "C://Program Files (x86)//Microsoft//Edge//Application//msedge.exe";
const FFMPEG = "C:/Users/JiaoLong16Pro2025/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build/bin/ffmpeg.exe";
const DIR = "C:/Users/JiaoLong16Pro2025/WorkBuddy/2026-11-03-21-38-31/demo-video";
const FILE = "file:///" + path.join(DIR, "reel.html");
const OUT = path.join(DIR, "reel.mp4");
/* 音轨：可用 --bgm=xxx 或环境变量 BGM 指定，默认 bgm2.wav */
const ARG_BGM = (process.argv.find(a => a.startsWith("--bgm=")) || "").split("=")[1];
const WAV = ARG_BGM ? path.resolve(ARG_BGM) : (process.env.BGM ? path.resolve(process.env.BGM) : path.join(DIR, "bgm2.wav"));
const FPS = 30;

(async () => {
  const probe = process.argv.includes("--probe");
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await p.goto(FILE, { waitUntil: "load" });
  await p.waitForFunction(() => window.__ready === true, { timeout: 20000 });
  const dur = await p.evaluate(() => window.DURATION);
  /* --seconds=N 只渲前 N 秒；--out=path 指定输出 */
  const ARG_SEC = (process.argv.find(x => x.startsWith("--seconds=")) || "").split("=")[1];
  const ARG_OUT = (process.argv.find(x => x.startsWith("--out=")) || "").split("=")[1];
  const TOTAL = ARG_SEC ? Math.round(Number(ARG_SEC) * FPS) : Math.round(dur * FPS);
  console.log("duration", dur, "frames", TOTAL);

  const ff = spawn(FFMPEG, [
    "-y",
    "-f", "image2pipe", "-vcodec", "mjpeg", "-framerate", String(FPS), "-i", "pipe:0",
    "-i", WAV,
    "-c:v", "libx264", "-preset", "slow", "-crf", "20",
    "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.2",
    "-movflags", "+faststart",
    "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
    "-shortest",
    probe ? path.join(DIR, "probe.mp4") : (ARG_OUT ? path.resolve(ARG_OUT) : OUT),
  ], { stdio: ["pipe", "inherit", "inherit"] });

  const t0 = Date.now();
  const limit = probe ? 60 : TOTAL;
  for (let f = 0; f < limit; f++) {
    await p.evaluate((t) => window.render(t), f / FPS);
    const buf = await p.screenshot({ type: "jpeg", quality: 95 });
    if (!ff.stdin.write(buf)) await once(ff.stdin, "drain");
    if (f % 150 === 0 || probe) {
      const el = (Date.now() - t0) / 1000;
      console.log(`frame ${f}/${limit}  ${el.toFixed(1)}s  ${(f / el).toFixed(1)} fps`);
    }
  }
  ff.stdin.end();
  await once(ff, "close");
  console.log("done in", ((Date.now() - t0) / 1000).toFixed(1), "s ->", probe ? "probe.mp4" : OUT);
  await b.close();
})();
