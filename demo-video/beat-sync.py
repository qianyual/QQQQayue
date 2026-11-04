#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
beat-sync.py  —  给定任意音频，测出 BPM / 首拍相位 / 小节网格，
并算出"要用哪一段才能对上现有 33 小节（或指定小节数）的分镜"。

用法：
  python beat-sync.py song.mp3
  python beat-sync.py song.mp3 --bars 33 --search 60
  python beat-sync.py song.mp3 --bars 33 --start-at 45     # 指定从第 45 秒附近的小节线起
"""
import argparse, json, subprocess, sys
import numpy as np

SR = 22050
N_FFT = 1024
HOP = 256


def load_audio(path, sr=SR):
    cmd = ["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr),
           "-f", "f32le", "-acodec", "pcm_f32le", "-"]
    p = subprocess.run(cmd, capture_output=True)
    if p.returncode != 0:
        raise SystemExit("ffmpeg 解码失败：" + p.stderr.decode("utf-8", "ignore")[:400])
    if not p.stdout:
        raise SystemExit("解码结果为空，检查文件是否损坏")
    return np.frombuffer(p.stdout, dtype=np.float32)


def onset_envelope(x):
    win = np.hanning(N_FFT).astype(np.float32)
    n = 1 + (len(x) - N_FFT) // HOP
    if n < 8:
        raise SystemExit("音频太短")
    idx = np.arange(N_FFT)[None, :] + HOP * np.arange(n)[:, None]
    frames = x[idx] * win
    S = np.abs(np.fft.rfft(frames, axis=1)).astype(np.float32)
    logS = np.log1p(S * 12.0)
    diff = np.diff(logS, axis=0)
    o = np.maximum(diff, 0).sum(axis=1)
    # 去掉低频漂移（局部均值），再半波整流
    k = 24
    pad = np.pad(o, (k, k), mode="edge")
    ma = np.convolve(pad, np.ones(2 * k + 1) / (2 * k + 1), mode="same")[k:-k]
    o = np.maximum(o - ma, 0)
    if o.max() > 0:
        o = o / o.max()
    return o.astype(np.float32)


def estimate_tempo(o, fps):
    """自相关找周期，再按 70–170 BPM 做倍频校正。"""
    v = o - o.mean()
    ac = np.correlate(v, v, mode="full")[len(v) - 1:]
    ac = ac / (ac[0] + 1e-9)
    lo, hi = int(fps * 60 / 200), int(fps * 60 / 55)
    lo = max(lo, 2)
    seg = ac[lo:hi]
    if len(seg) < 3:
        raise SystemExit("音频太短，无法估计速度")
    # 取若干峰，做倍频一致性打分
    cands = []
    for i in range(1, len(seg) - 1):
        if seg[i] >= seg[i - 1] and seg[i] >= seg[i + 1]:
            cands.append((seg[i], lo + i))
    cands.sort(reverse=True)
    cands = cands[:8]
    best = None
    for score, lag in cands:
        bpm = 60 * fps / lag
        # 折到 70–170
        while bpm < 70:
            bpm *= 2
        while bpm > 170:
            bpm /= 2
        # 支持度：基频 + 2 倍 + 4 倍周期的自相关和
        s = 0.0
        beats_per = 60 * fps / bpm          # 一拍对应多少帧
        for m in (1, 2, 4):
            l = int(round(beats_per * m))
            if 0 <= l < len(ac):
                s += ac[l]
        item = (s, bpm, lag)
        if best is None or item[0] > best[0]:
            best = item
    return best[1], best[2]


def refine_phase(o, fps, period):
    """在 [0, period) 内找让网格能量最大的相位。"""
    n = len(o)
    best = (None, -1e9)
    steps = 400
    for i in range(steps):
        ph = period * i / steps
        pos = ph + period * np.arange(int((n - ph) / period) + 1)
        pos = pos[pos < n - 1]
        if len(pos) < 4:
            continue
        val = float(np.interp(pos, np.arange(n), o).sum())
        if val > best[1]:
            best = (ph, val)
    return best[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--bars", type=int, default=33, help="分镜需要多少小节")
    ap.add_argument("--search", type=float, default=None, help="从第几秒开始找合适的段落（默认自动）")
    ap.add_argument("--bpm", type=float, default=None, help="已知 BPM，跳过估计")
    a = ap.parse_args()

    x = load_audio(a.audio)
    o = onset_envelope(x)
    fps = SR / HOP
    dur = len(x) / SR

    if a.bpm:
        bpm = a.bpm
        period = 60 * fps / bpm
    else:
        bpm, period = estimate_tempo(o, fps)
    beat = 60 / bpm
    bar = beat * 4
    phase = refine_phase(o, fps, period)
    first_beat = phase / fps

    need = a.bars * bar
    # 选段落：在整曲里滑动，找"起始点靠近首拍、且能量最强"的位置
    best_start = None
    if dur > need + 1:
        starts = np.arange(first_beat, max(first_beat + 0.1, dur - need), bar)
        scores = []
        for s in starts:
            i0, i1 = int(s * fps), int(min(len(o), (s + need) * fps))
            seg = o[i0:i1]
            if len(seg) < 10:
                continue
            # 前半要够响（钩子），整体要稳
            head = seg[: int(len(seg) * .12)].mean()
            scores.append((head * .6 + seg.mean() * .4, s))
        if scores:
            if a.search is not None:
                scores.sort(key=lambda t: abs(t[1] - a.search))
                best_start = scores[0][1]
            else:
                best_start = max(scores)[1]
    else:
        best_start = first_beat

    out = {
        "file": a.audio,
        "duration": round(dur, 2),
        "bpm": round(bpm, 2),
        "beat": round(beat, 4),
        "bar": round(bar, 4),
        "first_beat": round(first_beat, 3),
        "bars_needed": a.bars,
        "need_seconds": round(need, 2),
        "cut_from": round(best_start, 3) if best_start is not None else None,
        "cut_to": round(best_start + need, 3) if best_start is not None else None,
        "trim_offset": round(best_start % bar, 3) if best_start is not None else None,
        "match_existing_113": abs(bpm - 113) < 1.2,
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))

    if best_start is not None:
        print("\n--- 建议命令 ---")
        print(f'ffmpeg -v error -ss {best_start:.3f} -t {need:.2f} -i "{a.audio}" '
              f'-ac 2 -ar 44100 -af "afade=t=in:st=0:d=0.05" -y song_cut.wav')
        if abs(bpm - 113) >= 1.2:
            r = 113 / bpm
            print(f"# 速度不同（{bpm:.1f} → 113），需变速 {r:.4f}x：")
            print(f'# ffmpeg -i song_cut.wav -filter:a "atempo={r:.5f}" song_113.wav')


if __name__ == "__main__":
    main()
