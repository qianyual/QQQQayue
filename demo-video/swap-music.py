#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
swap-music.py — 用户给一首歌，自动对拍、裁段、混进竖屏视频。

  python swap-music.py "C:/path/song.mp3"
  python swap-music.py "C:/path/song.mp3" --start 45      # 想从第 45 秒附近的段落起
  python swap-music.py "C:/path/song.mp3" --render        # 检测+裁切+直接重渲
"""
import argparse, json, os, subprocess, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# 文件名含连字符，无法 import，用 exec 载入；预置 __name__ 避免触发它的 main()
_ns = {"__name__": "_beatsync"}
with open(os.path.join(HERE, "beat-sync.py"), encoding="utf-8") as f:
    exec(compile(f.read(), "beat-sync.py", "exec"), _ns)

TARGET_BPM = 113.0
BARS = 33
BEAT = 60 / TARGET_BPM
BAR = BEAT * 4
NEED = BARS * BAR          # 70.09322 s，与 reel-timeline.js 的 DURATION 完全一致
FFMPEG = "ffmpeg"


def run(cmd):
    p = subprocess.run(cmd, capture_output=True)
    if p.returncode != 0:
        raise SystemExit("命令失败：" + " ".join(cmd) + "\n" + p.stderr.decode("utf-8", "ignore")[:600])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--start", type=float, default=None)
    ap.add_argument("--render", action="store_true")
    ap.add_argument("--out", default="song_cut.wav")
    a = ap.parse_args()

    x = _ns["load_audio"](a.audio)
    o = _ns["onset_envelope"](x)
    fps = _ns["SR"] / _ns["HOP"]
    dur = len(x) / _ns["SR"]

    bpm, period = _ns["estimate_tempo"](o, fps)
    phase = _ns["refine_phase"](o, fps, period)
    first_beat = phase / fps
    print(f"检测：{bpm:.2f} BPM / 首拍 {first_beat:.3f}s / 总长 {dur:.2f}s")

    ratio = TARGET_BPM / bpm                     # atempo 倍率
    tempo_ok = abs(bpm - TARGET_BPM) < 0.8
    if not tempo_ok:
        print(f"速度不一致 → atempo {ratio:.5f}（{bpm:.2f} → {TARGET_BPM:.0f}）")

    src_need = NEED * (ratio if not tempo_ok else 1.0)

    # 滑窗挑段落：起点必须落在小节线
    if dur - src_need < 1:
        raise SystemExit(f"音频只有 {dur:.1f}s，凑不满 {BARS} 小节（需要 {src_need:.1f}s）")
    starts = np.arange(first_beat, dur - src_need + 1e-6, BAR)
    scored = []
    for s in starts:
        i0, i1 = int(s * fps), int(min(len(o), (s + src_need) * fps))
        seg = o[i0:i1]
        if len(seg) < 20:
            continue
        head = float(seg[: max(4, int(len(seg) * .12))].mean())
        scored.append((head * .6 + float(seg.mean()) * .4, s))
    if a.start is not None:
        cut = min(scored, key=lambda t: abs(t[1] - a.start))[1]
    else:
        cut = max(scored)[1]
    print(f"取段：{cut:.3f}s → {cut + src_need:.3f}s（能量分 {max(scored)[0]:.3f}）")

    out_path = os.path.join(HERE, a.out)
    filt = [] if tempo_ok else [f"atempo={ratio:.5f}"]
    filt.append("afade=t=in:st=0:d=0.08")
    filt.append(f"afade=t=out:st={NEED - 0.55:.3f}:d=0.5")
    run([FFMPEG, "-v", "error", "-y", "-ss", f"{cut:.4f}", "-t", f"{src_need + 0.3:.4f}",
         "-i", a.audio, "-vn", "-ac", "2", "-ar", "44100",
         "-af", ",".join(filt), "-t", f"{NEED:.4f}", "-acodec", "pcm_s16le", out_path])
    print("输出：", out_path)

    # 复核：时长与电平
    probe = subprocess.run([FFMPEG, "-hide_banner", "-i", out_path, "-af", "volumedetect", "-f", "null", "-"],
                           capture_output=True).stderr.decode("utf-8", "ignore")
    for line in probe.splitlines():
        if "Duration" in line or "mean_volume" in line or "max_volume" in line:
            print("  " + line.strip().split("] ")[-1])

    if a.render:
        mp4 = os.path.join(HERE, "reel-music.mp4")
        e2e = os.path.join(os.path.dirname(HERE), "e2e-tools")
        env = dict(os.environ, NODE_PATH=os.path.join(e2e, "node_modules"))
        print("开始重渲（约 90 秒）…")
        run_args = ["node", os.path.join(HERE, "record-reel.js"), f"--bgm={out_path}"]
        p = subprocess.run(run_args, cwd=e2e, env=env)
        if p.returncode != 0:
            raise SystemExit("重渲失败")
        print("完成：", os.path.join(HERE, "reel.mp4"))


if __name__ == "__main__":
    main()
