"""128 BPM 电子卡点 BGM —— 60 小节 = 112.5 秒（《We Never》同节奏型）"""
import wave, math, random
from array import array

SR = 44100
BPM = 128.0
BEAT = 60.0 / BPM          # 0.46875
BAR = BEAT * 4             # 1.875
BARS = 60
DUR = BAR * BARS           # 112.5
N = int(SR * DUR)
random.seed(11)

buf = array('f', [0.0]) * N
TP = 2 * math.pi

def add(i0, samples):
    n = len(samples)
    end = min(N, i0 + n)
    if i0 >= N: return
    for k in range(end - i0):
        buf[i0 + k] += samples[k]

# ---------- 乐器 ----------
def kick(dur=0.42):
    n = int(dur * SR); out = array('f', [0.0]) * n
    ph = 0.0
    for k in range(n):
        t = k / SR
        f = 44 + 105 * math.exp(-t * 32)
        ph += TP * f / SR
        env = math.exp(-t * 7.2)
        v = math.sin(ph) * env
        if t < 0.006:
            v += (1 - t / 0.006) * 0.55 * random.uniform(-1, 1)
        out[k] = v * 0.95
    return out

def clap(dur=0.34):
    n = int(dur * SR); out = array('f', [0.0]) * n
    for k in range(n):
        t = k / SR
        env = math.exp(-t * 26)
        if t < 0.012: env *= 0.35 + t / 0.012
        out[k] = random.uniform(-1, 1) * env * 0.42
    prev = 0.0; sm = 0.0
    for k in range(n):
        d = out[k] - prev; prev = out[k]
        sm = sm * 0.72 + d * 0.28
        out[k] = sm * 1.6
    return out

def hat(dur=0.075, amp=0.13):
    n = int(dur * SR); out = array('f', [0.0]) * n
    prev = 0.0
    for k in range(n):
        t = k / SR
        x = random.uniform(-1, 1)
        hp = x - prev; prev = x
        out[k] = hp * math.exp(-t * 95) * amp
    return out

def bass(f, dur):
    n = int(dur * SR); out = array('f', [0.0]) * n
    for k in range(n):
        t = k / SR
        env = min(1, t / 0.004) * math.exp(-t * 5.2)
        s = 0.0
        for h in range(1, 6):
            s += math.sin(TP * f * h * t) / h
        out[k] = s * env * 0.30
    return out

def pluck(f, dur=0.24, amp=0.16):
    n = int(dur * SR); out = array('f', [0.0]) * n
    for k in range(n):
        t = k / SR
        env = math.exp(-t * 13) * min(1, t / 0.003)
        out[k] = (math.sin(TP * f * t) + 0.34 * math.sin(TP * 2 * f * t) + 0.12 * math.sin(TP * 3 * f * t)) * env * amp
    return out

def pad_chord(freqs, dur):
    n = int(dur * SR); out = array('f', [0.0]) * n
    for k in range(n):
        t = k / SR
        env = min(1, t / 0.18) * min(1, (dur - t) / 0.25)
        s = 0.0
        for f in freqs:
            s += math.sin(TP * f * t) + 0.22 * math.sin(TP * 2 * f * t)
        out[k] = s * env * 0.040
    return out

# ---------- 和声 ----------
CH = [
    [110.00, 164.81, 220.00, 261.63],   # Am
    [87.31, 130.81, 174.61, 220.00],    # F
    [130.81, 196.00, 261.63, 329.63],   # C
    [98.00, 146.83, 196.00, 246.94],    # G
]
ROOT = [55.00, 43.65, 65.41, 49.00]
ARP = [
    [440.00, 523.25, 659.25, 523.25],
    [349.23, 440.00, 523.25, 440.00],
    [523.25, 659.25, 783.99, 659.25],
    [392.00, 493.88, 587.33, 493.88],
]

print("synth...", flush=True)
for b in range(0, BARS, 2):
    ch = CH[(b // 2) % 4]
    add(int(b * BAR * SR), pad_chord(ch, BAR * 2 + 0.2))

K = kick()
for b in range(2, BARS):
    for beat in range(4):
        add(int((b * BAR + beat * BEAT) * SR), K)

C = clap()
for b in range(4, BARS - 2):
    for beat in (1, 3):
        add(int((b * BAR + beat * BEAT) * SR), C)

for b in range(2, BARS - 2):
    for i in range(8):
        amp = 0.15 if i % 2 == 0 else 0.085
        add(int((b * BAR + i * BEAT / 2) * SR), hat(amp=amp))

PAT = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0]
for b in range(2, BARS - 2):
    root = ROOT[(b // 2) % 4]
    for i, on in enumerate(PAT):
        if not on: continue
        f = root * (2 if (i in (3, 11) and b % 4 == 3) else 1)
        add(int((b * BAR + i * BEAT / 4) * SR), bass(f, BEAT * 0.62))

for b in range(4, BARS - 2):
    seq = ARP[(b // 2) % 4]
    for i in range(16):
        f = seq[i % 4] * (2 if i % 8 >= 4 else 1)
        amp = 0.15 if i % 4 == 0 else 0.10
        add(int((b * BAR + i * BEAT / 4) * SR), pluck(f, 0.2, amp))

for cut in [4, 8, 14, 22, 30, 36, 42, 48, 56]:
    b = cut
    i0 = int((b * BAR - BEAT * 0.5) * SR)
    n = int(BEAT * 0.5 * SR)
    for k in range(n):
        if i0 + k >= N: break
        t = k / n
        buf[i0 + k] += random.uniform(-1, 1) * (t ** 2) * 0.10

add(int((BARS - 2) * BAR * SR), pad_chord(CH[0], BAR * 2))

print("master...", flush=True)
peak = 0.0
for i in range(N):
    v = math.tanh(buf[i] * 1.15)
    buf[i] = v
    if abs(v) > peak: peak = abs(v)
g = 0.94 / (peak or 1)
data = array('h', [0]) * N
for i in range(N):
    data[i] = int(max(-1.0, min(1.0, buf[i] * g)) * 32767)

fi = int(0.25 * SR); fo = int(2.2 * SR)
for i in range(fi):
    data[i] = int(data[i] * i / fi)
for i in range(N - fo, N):
    data[i] = int(data[i] * (N - i) / fo)

with wave.open("bgm.wav", "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(data.tobytes())
print("ok", round(N / SR, 2), "s")
