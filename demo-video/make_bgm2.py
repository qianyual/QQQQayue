"""113 BPM / 33 小节 / 70.09s —— 《We Never (Remix)》同速度的原创配乐
   十层：808 sub / kick / snare / hat / perc / pad / lead(永远差半拍) / arp / fx / atmos
   纯 Python 合成，立体声，无版权音源。"""
import wave, math, random
from array import array

SR = 44100
BPM = 113.0
BEAT = 60.0 / BPM
BAR = BEAT * 4
BARS = 33
DUR = BAR * BARS
N = int(SR * DUR)
random.seed(20261104)

LX = array('f', [0.0]) * N
RX = array('f', [0.0]) * N
TP = 2 * math.pi

def put(i0, mono, pan=0.5, gain=1.0, rev=0.0, revpan=None):
    n = len(mono)
    if i0 >= N: return
    a = 0.0 if i0 < 0 else i0
    skip = -i0 if i0 < 0 else 0
    end = min(N, i0 + n)
    th = pan * 1.5707963
    gl, gr = math.cos(th) * gain, math.sin(th) * gain
    for k in range(a, end):
        v = mono[k - i0]
        LX[k] += v * gl
        RX[k] += v * gr
    if rev > 0:
        d = int(0.148 * SR)
        rp = revpan if revpan is not None else 1.0 - pan
        th2 = rp * 1.5707963
        hl, hr = math.cos(th2) * gain * rev, math.sin(th2) * gain * rev
        for k in range(a, end):
            j = k + d
            if j >= N: break
            v = mono[k - i0]
            LX[j] += v * hl
            RX[j] += v * hr

# ---------------- 乐器 ----------------
def kick(dur=0.46):
    n = int(dur * SR); o = array('f', [0.0]) * n
    ph = 0.0
    for k in range(n):
        t = k / SR
        f = 46 + 96 * math.exp(-t * 30)
        ph += TP * f / SR
        env = math.exp(-t * 6.6)
        v = math.sin(ph) * env
        if t < 0.005:
            v += (1 - t / 0.005) * 0.5 * random.uniform(-1, 1)
        o[k] = v * 0.92
    return o

def sub808(f, dur):
    n = int(dur * SR); o = array('f', [0.0]) * n
    ph = 0.0
    for k in range(n):
        t = k / SR
        ff = f * (1 + 0.06 * math.exp(-t * 14))
        ph += TP * ff / SR
        env = min(1, t / 0.012) * math.exp(-t * 1.15) * min(1, (dur - t) / 0.06)
        o[k] = (math.sin(ph) + 0.12 * math.sin(2 * ph)) * env * 0.52
    return o

def snare(dur=0.30):
    n = int(dur * SR); o = array('f', [0.0]) * n
    prev = 0.0; sm = 0.0
    for k in range(n):
        t = k / SR
        x = random.uniform(-1, 1)
        d = x - prev; prev = x
        sm = sm * 0.52 + d * 0.48
        env = math.exp(-t * 17)
        tone = math.sin(TP * 196 * t) * math.exp(-t * 26) * 0.34
        o[k] = (sm * 0.8 + tone) * env * 0.55
    return o

def hat(dur=0.07, amp=0.15):
    n = int(dur * SR); o = array('f', [0.0]) * n
    prev = 0.0
    for k in range(n):
        t = k / SR
        x = random.uniform(-1, 1)
        hp = x - prev; prev = x
        o[k] = hp * math.exp(-t * 92) * amp
    return o

def rim(dur=0.09):
    n = int(dur * SR); o = array('f', [0.0]) * n
    for k in range(n):
        t = k / SR
        o[k] = (math.sin(TP * 1180 * t) * 0.6 + math.sin(TP * 760 * t) * 0.4) * math.exp(-t * 60) * 0.30
    return o

def pad(freqs, dur):
    n = int(dur * SR); o = array('f', [0.0]) * n
    det = [0.9985, 1.0, 1.0035]
    for k in range(n):
        t = k / SR
        env = min(1, t / 0.42) * min(1, max(0.0, (dur - t) / 0.5))
        s = 0.0
        for f in freqs:
            for d in det:
                s += math.sin(TP * f * d * t) + 0.16 * math.sin(TP * 2 * f * d * t)
        o[k] = s * env * 0.0125
    return o

def lead(f, dur=1.5):
    n = int(dur * SR); o = array('f', [0.0]) * n
    for k in range(n):
        t = k / SR
        env = min(1, t / 0.006) * math.exp(-t * 2.6) * min(1, max(0.0, (dur - t) / 0.2))
        s = (math.sin(TP * f * t) + 0.30 * math.sin(TP * 2 * f * t)
             + 0.12 * math.sin(TP * 3 * f * t) + 0.05 * math.sin(TP * 5 * f * t))
        o[k] = s * env * 0.15
    return o

def arp(f, dur=0.30):
    n = int(dur * SR); o = array('f', [0.0]) * n
    for k in range(n):
        t = k / SR
        env = math.exp(-t * 16) * min(1, t / 0.002)
        o[k] = (math.sin(TP * f * t) + 0.22 * math.sin(TP * 2 * f * t)) * env * 0.062
    return o

def riser(dur):
    n = int(dur * SR); o = array('f', [0.0]) * n
    prev = 0.0; y = 0.0
    for k in range(n):
        t = k / n
        x = random.uniform(-1, 1)
        hp = x - prev; prev = x
        y += (hp - y) * (0.02 + 0.5 * t * t)
        o[k] = y * (t ** 2.2) * 0.42
    return o

def impact(dur=1.1):
    n = int(dur * SR); o = array('f', [0.0]) * n
    ph = 0.0
    for k in range(n):
        t = k / SR
        f = 78 * math.exp(-t * 2.2) + 34
        ph += TP * f / SR
        o[k] = math.sin(ph) * math.exp(-t * 3.4) * 0.5 + random.uniform(-1, 1) * math.exp(-t * 40) * 0.10
    return o

# ---------------- 和声（A 小调 Am-F-C-G） ----------------
CH = {
    "Am": dict(root=55.00, pad=[220.00, 261.63, 329.63, 440.00], arp=[440.00, 523.25, 659.25, 880.00],
               lead=[440.00, 523.25, 659.25, 392.00]),
    "F":  dict(root=43.65, pad=[174.61, 220.00, 261.63, 349.23], arp=[349.23, 440.00, 523.25, 698.46],
               lead=[349.23, 440.00, 523.25, 329.63]),
    "C":  dict(root=65.41, pad=[261.63, 329.63, 392.00, 523.25], arp=[523.25, 659.25, 783.99, 1046.50],
               lead=[523.25, 659.25, 783.99, 493.88]),
    "G":  dict(root=49.00, pad=[196.00, 246.94, 293.66, 392.00], arp=[392.00, 493.88, 587.33, 783.99],
               lead=[392.00, 493.88, 587.33, 440.00]),
}
PROG = ["Am", "F", "C", "G"]
def chord_at(bar): return CH[PROG[(bar // 2) % 4]]

# ---------------- 能量表（每小节） ----------------
def energy(bar):
    e = dict(kick=0, snare=0, hat=0, perc=0, sub=0, pad=1, lead=1, arp=0, atmos=1)
    if bar < 2:                      # 前奏
        e.update(hat=0.0, lead=0.75, pad=0.9, atmos=1.0)
    elif bar < 4:
        e.update(kick=0.75, sub=0.55, hat=0.45, lead=0.8, pad=0.95)
    elif bar < 6:
        e.update(kick=0.9, snare=0.0, sub=0.7, hat=0.6, lead=0.85, perc=0.3)
    elif bar < 10:
        e.update(kick=0.95, snare=0.85, sub=0.8, hat=0.7, arp=0.6, lead=0.9, perc=0.5)
    elif bar < 16:
        e.update(kick=1.0, snare=0.9, sub=0.85, hat=0.85, arp=0.55, lead=1.0, perc=0.6)
    elif bar < 22:
        e.update(kick=1.0, snare=0.95, sub=0.9, hat=0.9, arp=0.7, lead=1.0, perc=0.7)
    elif bar < 26:
        e.update(kick=1.0, snare=1.0, sub=0.95, hat=0.95, arp=0.8, lead=1.0, perc=0.7)
    elif bar < 29:
        e.update(kick=1.0, snare=1.0, sub=1.0, hat=1.0, arp=0.9, lead=1.0, perc=0.8)
    elif bar < 31:                   # 收尾
        e.update(kick=0.55, snare=0, sub=0.45, hat=0.35, lead=1.0, arp=0.25)
    else:
        e.update(kick=0, snare=0, sub=0, hat=0, lead=0.85, arp=0, pad=1.15)
    return e

print("synth…", flush=True)

# 1) pad（两小节一换，带侧链感）
for bar in range(0, BARS, 2):
    c = chord_at(bar)
    put(int(bar * BAR * SR), pad(c["pad"], BAR * 2 + 0.25), pan=0.5, gain=energy(bar)["pad"] * 0.9, rev=0.5)

# 2) 808 sub
for bar in range(2, 31):
    e = energy(bar)["sub"]
    if not e: continue
    c = chord_at(bar)
    put(int(bar * BAR * SR), sub808(c["root"], BEAT * 2.5), gain=e * 0.95)
    if bar % 2 == 1:
        put(int((bar * BAR + BEAT * 2.75) * SR), sub808(c["root"] * 1.5, BEAT * 1.05), gain=e * 0.62)

# 3) kick（半拍感：1、3 正拍 + 偶发切分）
KICK_PAT = [(0, 1.0), (1.75, 0.55), (2.0, 0.9), (2.75, 0.5)]
for bar in range(2, 31):
    e = energy(bar)["kick"]
    if not e: continue
    for pos, acc in KICK_PAT:
        if pos == 1.75 and bar % 2 == 0: continue
        if pos == 2.75 and bar % 4 != 3: continue
        put(int((bar * BAR + pos * BEAT) * SR), kick(), gain=e * acc * 0.9)

# 4) snare / clap
for bar in range(4, 31):
    e = energy(bar)["snare"]
    if not e: continue
    put(int((bar * BAR + 2 * BEAT) * SR), snare(), pan=0.54, gain=e * 0.8, rev=0.22)
    if bar % 4 == 3:
        put(int((bar * BAR + 3.5 * BEAT) * SR), snare(0.18), pan=0.46, gain=e * 0.36)
    if bar % 2 == 1:
        put(int((bar * BAR + 3.75 * BEAT) * SR), snare(0.12), pan=0.58, gain=e * 0.2)

# 5) hat（八分，末拍十六分滚奏）
for bar in range(2, 31):
    e = energy(bar)["hat"]
    if not e: continue
    for i in range(8):
        amp = 0.18 if i % 2 == 0 else 0.10
        put(int((bar * BAR + i * BEAT / 2) * SR), hat(0.06, amp), pan=0.62, gain=e * 0.85)
    if bar % 4 == 3:
        for i in range(4):
            put(int((bar * BAR + 3 * BEAT + i * BEAT / 4) * SR), hat(0.045, 0.09), pan=0.66, gain=e)

# 6) perc：永远落在半拍上的木鱼点，强化"差半拍"
for bar in range(5, 30):
    e = energy(bar)["perc"]
    if not e: continue
    for pos in (0.5, 2.5):
        put(int((bar * BAR + pos * BEAT) * SR), rim(), pan=0.36, gain=e * 0.55, rev=0.2)

# 7) lead 主旋律：全部落在 x.5 拍上（永远差半拍）
MOTIF = [(0.5, 0), (1.5, 1), (2.5, 2), (3.5, 2), (4.5, 1), (5.5, 0), (6.5, 3), (7.5, 1)]
MOTIF_HI = [(0.5, 2), (1.5, 3), (2.5, 4), (3.5, 3), (4.5, 2), (5.5, 1), (6.5, 0), (7.5, 2)]
for bar in range(0, 33, 2):
    e = energy(bar)["lead"]
    if not e: continue
    c = chord_at(bar)
    tone = c["lead"]
    var = MOTIF if (bar // 2) % 2 == 0 else MOTIF_HI
    for pos, idx in var:
        f = tone[idx % len(tone)] * (2 if idx >= 4 else 1)
        put(int((bar * BAR + pos * BEAT) * SR), lead(f, BEAT * 2.2), pan=0.44, gain=e * 0.95, rev=0.42)
    if bar >= 2:
        c2 = CH[PROG[((bar + 1) // 2) % 4]]
        for pos, idx in var[:4]:
            f = c2["lead"][idx % 4] * 2
            put(int((bar * BAR + (pos + 4) * BEAT) * SR), lead(f, BEAT * 1.6), pan=0.58, gain=e * 0.42, rev=0.5)

# 8) arp 星点
for bar in range(6, 30):
    e = energy(bar)["arp"]
    if not e: continue
    c = chord_at(bar)
    for i in range(16):
        f = c["arp"][i % 4] * (2 if i % 8 >= 4 else 1)
        amp = 1.0 if i % 4 == 0 else 0.66
        put(int((bar * BAR + i * BEAT / 4) * SR), arp(f, 0.26), pan=0.3 + 0.4 * ((i % 8) / 8), gain=e * amp * 0.9, rev=0.4)

# 9) fx：转场 riser + 落点 impact
CUTS = [3, 6, 10, 13, 16, 19, 22, 26, 29]
for cut in CUTS:
    put(int((cut * BAR - BEAT * 1.6) * SR), riser(BEAT * 1.6), pan=0.5, gain=0.85, rev=0.3)
    put(int(cut * BAR * SR), impact(), pan=0.5, gain=0.9, rev=0.25)

put(int(0 * BAR * SR), impact(1.6), pan=0.5, gain=0.55, rev=0.3)
put(int(31 * BAR * SR), impact(2.2), pan=0.5, gain=0.75, rev=0.5)

# 10) atmos：气声底噪
n = N
at = array('f', [0.0]) * n
p1 = 0.0; y1 = 0.0; y2 = 0.0
for k in range(n):
    x = random.uniform(-1, 1)
    y1 += (x - y1) * 0.006
    y2 += (y1 - y2) * 0.02
    at[k] = y2 * 0.5
for k in range(n):
    LX[k] += at[k] * 0.5
    RX[k] += at[k] * 0.5

print("master…", flush=True)
peak = 0.0
for k in range(N):
    l = math.tanh(LX[k] * 1.18)
    r = math.tanh(RX[k] * 1.18)
    LX[k] = l; RX[k] = r
    m = max(abs(l), abs(r))
    if m > peak: peak = m
g = 0.93 / (peak or 1)
out = array('h', [0]) * (N * 2)
fi = int(0.18 * SR); fo = int(2.4 * SR)
for k in range(N):
    env = 1.0
    if k < fi: env = k / fi
    elif k > N - fo: env = (N - k) / fo
    out[k * 2] = int(max(-1.0, min(1.0, LX[k] * g * env)) * 32767)
    out[k * 2 + 1] = int(max(-1.0, min(1.0, RX[k] * g * env)) * 32767)

with wave.open("bgm2.wav", "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(out.tobytes())
print("ok", round(N / SR, 2), "s")
