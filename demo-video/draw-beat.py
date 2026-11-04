#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把波形 + onset + 候选节拍网格画出来，用于肉眼核对第一拍与 BPM。"""
import subprocess, sys
import numpy as np
from PIL import Image, ImageDraw

SR = 22050


def load(p, sr=SR):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", p, "-ac", "1", "-ar", str(sr),
                          "-f", "f32le", "-acodec", "pcm_f32le", "-"], capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def onset_env(x):
    NF, HOP = 1024, 256
    win = np.hanning(NF).astype(np.float32)
    n = 1 + (len(x) - NF) // HOP
    idx = np.arange(NF)[None, :] + HOP * np.arange(n)[:, None]
    S = np.abs(np.fft.rfft(x[idx] * win, axis=1)).astype(np.float32)
    d = np.diff(np.log1p(S * 12), axis=0)
    o = np.maximum(d, 0).sum(axis=1)
    k = 24
    pad = np.pad(o, (k, k), mode="edge")
    ma = np.convolve(pad, np.ones(2 * k + 1) / (2 * k + 1), mode="same")[k:-k]
    o = np.maximum(o - ma, 0)
    return o / (o.max() + 1e-9), SR / HOP


def draw(x, o, fps, t0, T, t_from, t_to, path, w=1700, h=560):
    img = Image.new("RGB", (w, h), "#ffffff")
    d = ImageDraw.Draw(img)
    L, R = 90, w - 30
    span = t_to - t_from
    X = lambda t: L + (t - t_from) / span * (R - L)

    # 波形
    i0, i1 = int(t_from * SR), int(t_to * SR)
    seg = x[i0:i1]
    step = max(1, len(seg) // ((R - L) * 2))
    mid = h * 0.46
    amp = h * 0.30
    for i in range(0, len(seg) - step, step):
        v = float(np.abs(seg[i:i + step]).max())
        px = X(t_from + i / SR)
        yy = amp * min(1.0, v * 1.6)
        d.line([(px, mid - yy), (px, mid + yy)], fill="#cfc7b6", width=1)

    # onset 折线
    prev = None
    for j in range(int(t_from * fps), min(len(o), int(t_to * fps))):
        t = j / fps
        val = float(o[j])
        px, py = X(t), h * 0.94 - val * h * 0.34
        if prev:
            d.line([prev, (px, py)], fill="#a2402c", width=2)
        prev = (px, py)

    # 节拍网格
    k = 0
    while True:
        t = t0 + k * T
        if t > t_to:
            break
        if t >= t_from:
            is_bar = (k % 4 == 0)
            col = "#1f6feb" if is_bar else "#9ec1f0"
            d.line([(X(t), 20), (X(t), h - 12)], fill=col, width=2 if is_bar else 1)
            if is_bar:
                d.text((X(t) + 3, 22), f"{k//4}", fill="#1f6feb")
        k += 1

    # 刻度
    for m in range(0, 200):
        t = t_from + m * 0.5
        if t > t_to:
            break
        d.line([(X(t), h - 12), (X(t), h - 6)], fill="#8a8578")
        if m % 2 == 0:
            d.text((X(t) - 8, h - 26), f"{t:.0f}", fill="#55504a")

    d.text((L, 4), f"t0={t0:.3f}s  T={T*1000:.2f}ms  {60/T:.2f} BPM   蓝粗线=小节首拍", fill="#222")
    d.rectangle([L, 18, R, h - 12], outline="#e6e0d2")
    img.save(path)
    print("saved", path)


if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "song.mp3"
    t0 = float(sys.argv[2]) if len(sys.argv) > 2 else 0.326
    bpm = float(sys.argv[3]) if len(sys.argv) > 3 else 113.0
    x = load(src)
    o, fps = onset_env(x)
    T = 60 / bpm
    draw(x, o, fps, t0, T, 0.0, 8.0, "beat_8s.png")
    draw(x, o, fps, t0, T, 0.0, 2.6, "beat_2s.png")
