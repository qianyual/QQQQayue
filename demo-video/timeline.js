/* ============================================================
 * 128 BPM 卡点时间轴（《We Never》节奏型）
 * 60 小节 = 112.5 秒；1 拍 = 0.46875s；1 小节 = 1.875s
 * 所有切换落在小节线，元素入场按拍/半拍递进
 * ============================================================ */
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const ease = t => 1 - Math.pow(1 - clamp(t), 3);
const easeIO = t => { t = clamp(t); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const snap = t => { t = clamp(t); const c = 1.55; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const lerp = (a, b, p) => a + (b - a) * p;
const BPM = 128, BEAT = 60 / BPM, BAR = BEAT * 4;

const q = id => document.getElementById(id);
/* 拍内进度 0..1（线性 / 缓动 / 弹性） */
const pL = (b, s, d) => clamp((b - s) / d);
const pE = (b, s, d) => ease((b - s) / d);
const pS = (b, s, d) => snap((b - s) / d);

function P(id, o) {
  const el = typeof id === "string" ? q(id) : id;
  if (!el) return;
  el.style.opacity = o.o === undefined ? 1 : o.o;
  el.style.transform = `translate3d(${o.x || 0}px,${o.y || 0}px,0) scale(${o.s === undefined ? 1 : o.s}) rotate(${o.r || 0}deg)`;
}

/* 场景区间（单位：小节） */
const SC = {
  s1: [0, 4], s2: [4, 8], s3: [8, 14], s4: [14, 22], s5: [22, 30],
  s6: [30, 36], s7: [36, 42], s8: [42, 48], s9: [48, 56], s10: [56, 60],
};
const DURATION = 112.5;
const CUTS = [4, 8, 14, 22, 30, 36, 42, 48, 56];

/* ---------------- S1 开场 ---------------- */
function sc1(b) {
  const w = pE(b, 0.2, 2.0);
  P("s1-water", { o: 0.05 * w, y: lerp(30, 0, w), s: lerp(1.06, 1, w) });
  const k = pE(b, 0.5, 1); P("s1-kicker", { o: k, y: lerp(14, 0, k) });
  const t = pS(b, 1, 1.4); P("s1-title", { o: pE(b, 1, 0.8), y: lerp(52, 0, t), s: lerp(1.08, 1, t) });
  const s = pS(b, 2, 1.0); P("s1-seal", { o: clamp((b - 2) / 0.4), s: lerp(0.4, 1, s), r: lerp(-20, -6, s) });
  const l = pE(b, 2.5, 1); q("s1-line").style.opacity = l; q("s1-line").style.width = lerp(0, 64, l) + "px"; q("s1-line").style.transform = "none";
  const e = pE(b, 3, 1); P("s1-en", { o: e, y: lerp(12, 0, e) });
  const g = pS(b, 3.5, 1.2); P("s1-slogan", { o: pE(b, 3.5, 0.7), y: lerp(22, 0, g) });
  const idle = pE(b, 4, 4); P("s1-slogan", { o: pE(b, 3.5, 0.7), y: lerp(22, 0, g) - idle * 4 });
  const out = clamp((b - 15) / 1);
  q("s1").style.transform = `scale(${lerp(1, 1.02, out)})`;
}

/* ---------------- S2 痛点 ---------------- */
function sc2(b) {
  const k = pE(b, 16.05, 0.8); q("s2-k").style.opacity = k; q("s2-k").style.transform = `translate3d(0,${lerp(12, 0, k)}px,0)`;
  const t1 = pS(b, 16.15, 0.9); q("s2-t1").style.opacity = pE(b, 16.1, 0.5); q("s2-t1").style.transform = `translate3d(0,${lerp(28, 0, t1)}px,0)`;
  [["a", 18], ["b", 19], ["c", 20]].forEach(([id, s]) => {
    const p = pE(b, s, 0.8);
    const el = q("s2-" + id);
    el.style.opacity = p;
    el.style.transform = `translate3d(${lerp(-30, 0, snap((b - s) / 1))}px,0,0)`;
  });
  const t2 = pS(b, 22, 1.2);
  q("s2-t2").style.opacity = pE(b, 22, 0.5);
  q("s2-t2").style.transform = `translate3d(0,${lerp(30, 0, t2)}px,0) scale(${lerp(0.94, 1, t2)})`;
  const t3 = pE(b, 24, 1); q("s2-t3").style.opacity = t3; q("s2-t3").style.transform = `translate3d(0,${lerp(14, 0, t3)}px,0)`;
}

/* ---------------- S3 书房 ---------------- */
function sc3(b) {
  const tg = pE(b, 32.05, 0.8); q("s3-tag").style.opacity = tg; q("s3-tag").style.transform = `translate3d(${lerp(-18, 0, tg)}px,0,0)`;
  const h = pS(b, 32.15, 0.9); q("s3-h").style.opacity = pE(b, 32.1, 0.5); q("s3-h").style.transform = `translate3d(0,${lerp(26, 0, h)}px,0)`;
  [["s3-p1", 34], ["s3-p2", 35], ["s3-p3", 36]].forEach(([id, s]) => {
    const p = pE(b, s, 1);
    const el = q(id); el.style.opacity = p; el.style.transform = `translate3d(${lerp(-22, 0, snap((b - s) / 1.2))}px,0,0)`;
  });
  const pf = pE(b, 38, 1); q("s3-foot").style.opacity = pf; q("s3-foot").style.transform = `translate3d(0,${lerp(10, 0, pf)}px,0)`;
  const pp = pS(b, 32.3, 2.0);
  const fl = Math.sin((b - 32) * 0.42) * 7;
  const el = q("s3-ph");
  el.style.opacity = pE(b, 32.25, 1.0);
  el.style.transform = `translate3d(${lerp(120, 0, pp)}px,${lerp(60, 0, pp) + fl}px,0) rotateY(-5deg) rotateX(1.5deg)`;
}

/* ---------------- S4 双模式 ---------------- */
function sc4(b) {
  const h = pS(b, 56.1, 0.9); q("s4-h").style.opacity = pE(b, 56.05, 0.5); q("s4-h").style.transform = `translate3d(0,${lerp(26, 0, h)}px,0)`;
  const s = pE(b, 56.4, 0.9); q("s4-sub").style.opacity = s; q("s4-sub").style.transform = `translate3d(0,${lerp(12, 0, s)}px,0)`;
  const c1 = pS(b, 58, 1.5), c2 = pS(b, 58.5, 1.5);
  q("s4-c1").style.opacity = pE(b, 58, 0.7); q("s4-c1").style.transform = `translate3d(${lerp(-50, 0, c1)}px,${lerp(24, 0, c1)}px,0)`;
  q("s4-c2").style.opacity = pE(b, 58.5, 0.7); q("s4-c2").style.transform = `translate3d(${lerp(50, 0, c2)}px,${lerp(24, 0, c2)}px,0)`;

  const toA = easeIO((b - 64) / 1.6);
  const back = easeIO((b - 78) / 1.6);
  const kx = lerp(4, 70, toA) - lerp(0, 66, back);
  const knob = q("s4-knob"); knob.style.left = kx + "px";
  const assist = toA * (1 - back);
  knob.style.background = assist > 0.5 ? "#a2402c" : "#fffdf7";
  q("s4-c1").style.borderColor = `rgba(162,64,44,${lerp(0.55, 0.10, assist)})`;
  q("s4-c2").style.borderColor = `rgba(162,64,44,${lerp(0.10, 0.55, assist)})`;
  q("s4-c1").style.boxShadow = `0 26px 50px -34px rgba(40,30,18,${lerp(0.55, 0.24, assist)})`;
  q("s4-c2").style.boxShadow = `0 26px 50px -34px rgba(40,30,18,${lerp(0.24, 0.55, assist)})`;
  q("s4-c1-badge").textContent = assist > 0.5 ? "生成已锁" : "已开启";
  q("s4-c1-badge").style.color = assist > 0.5 ? "#9a8f7d" : "#a2402c";
  q("s4-c1-badge").style.borderColor = assist > 0.5 ? "rgba(27,25,21,.16)" : "rgba(162,64,44,.4)";
  q("s4-c2-badge").textContent = assist > 0.5 ? "已开启" : "待切换";
  q("s4-c2-badge").style.color = assist > 0.5 ? "#a2402c" : "#8c8072";
  q("s4-c2-badge").style.borderColor = assist > 0.5 ? "rgba(162,64,44,.4)" : "rgba(27,25,21,.18)";

  const sw = pE(b, 59.5, 1);
  ["s4-sw", "s4-swl", "s4-swr"].forEach(id => { const el = q(id); el.style.opacity = sw; el.style.transform = "none"; });
  const n = pE(b, 66, 1.2);
  q("s4-note").style.opacity = n; q("s4-note").style.transform = `translate3d(0,${lerp(18, 0, n)}px,0)`;
  const f = pE(b, 82, 1); q("s4-foot").style.opacity = f; q("s4-foot").style.transform = `translate3d(0,${lerp(10, 0, f)}px,0)`;
}

/* ---------------- S5 技能库 ---------------- */
const SKILLS = [
  ["逻辑硬伤", "#a2402c"], ["设定连续性", "#a2402c"], ["节奏诊断", "#a2402c"], ["伏笔呼应", "#a2402c"],
  ["动机与选择", "#a2402c"], ["视角与信息", "#a2402c"], ["章末钩子", "#a2402c"], ["场景可视化", "#a2402c"],
  ["错字与病句", "#2e5e8c"], ["AI 味检测", "#2e5e8c"], ["重复与口头禅", "#2e5e8c"], ["对话质感", "#2e5e8c"],
  ["文风教练", "#3e7d4f"], ["角色弧检查", "#3e7d4f"], ["卡文破局", "#8c6d2e"], ["拆本章节拍", "#7a4a8c"],
];
(function () {
  const box = q("s5-grid"); if (!box) return;
  const W = 254, H = 74, GX = 21, GY = 12;
  SKILLS.forEach(([name, color], i) => {
    const d = document.createElement("div");
    d.className = "sk"; d.id = "sk" + i;
    d.style.left = (i % 4) * (W + GX) + "px";
    d.style.top = Math.floor(i / 4) * (H + GY) + "px";
    d.style.width = W + "px";
    d.innerHTML = `<b style="background:${color}"></b><span>${name}</span>`;
    box.appendChild(d);
  });
})();

function sc5(b) {
  const pp = pS(b, 88.3, 2.0);
  const fl = Math.sin((b - 88) * 0.4) * 6;
  const ph = q("s5-ph");
  const sw = easeIO((b - 106) / 2);
  ph.style.opacity = pE(b, 88.2, 1.0);
  ph.style.transform = `translate3d(${lerp(-90, 0, pp)}px,${fl}px,0) scale(${lerp(1, 0.994, sw)}) rotateY(4deg) rotateX(1.5deg)`;
  const tg = pE(b, 88.05, 0.8); q("s5-tag").style.opacity = tg; q("s5-tag").style.transform = `translate3d(${lerp(-18, 0, tg)}px,0,0)`;
  const h = pS(b, 88.15, 0.9); q("s5-h").style.opacity = pE(b, 88.1, 0.5); q("s5-h").style.transform = `translate3d(0,${lerp(26, 0, h)}px,0)`;
  const s = pE(b, 89.6, 1); q("s5-sub").style.opacity = s; q("s5-sub").style.transform = `translate3d(0,${lerp(14, 0, s)}px,0)`;

  for (let i = 0; i < SKILLS.length; i++) {
    const st = 92 + i * 0.5;           /* 每半拍点亮一格 */
    const p = pL(b, st, 0.5);
    const el = q("sk" + i);
    el.style.opacity = clamp(p * 1.6);
    el.style.transform = `translate3d(0,${lerp(18, 0, snap(p))}px,0) scale(${lerp(0.92, 1, snap(p))})`;
    if (p > 0 && p < 1) el.style.borderColor = `rgba(162,64,44,${0.55 * (1 - p)})`;
    else if (p >= 1) el.style.borderColor = "rgba(27,25,21,.09)";
  }
  q("s5-img1").style.opacity = 1 - sw;
  q("s5-img2").style.opacity = sw;

  const f1 = pE(b, 102, 1); q("s5-foot").style.opacity = f1; q("s5-foot").style.transform = `translate3d(0,${lerp(12, 0, f1)}px,0)`;
  const f2 = pE(b, 103, 1); q("s5-foot2").style.opacity = f2; q("s5-foot2").style.transform = `translate3d(0,${lerp(10, 0, f2)}px,0)`;
}

/* ---------------- S6 罗盘 ---------------- */
(function () {
  const box = q("s6-beats"); if (!box) return;
  ["开场", "推进", "转折", "收束"].forEach((n, i) => {
    const d = document.createElement("div");
    d.id = "bt" + i;
    d.style.cssText = "display:flex;align-items:center;gap:10px;padding:11px 18px 11px 14px;border:1px solid rgba(27,25,21,.14);border-radius:24px;font-size:19px;color:#5b554a;background:rgba(255,253,247,.6)";
    d.innerHTML = `<span id="btk${i}" style="width:17px;height:17px;border-radius:4px;border:1px solid rgba(27,25,21,.28);display:flex;align-items:center;justify-content:center;font-size:12px;color:#fffdf7"></span>${n}`;
    box.appendChild(d);
  });
})();

function sc6(b) {
  const pp = pS(b, 120.3, 2.0);
  const fl = Math.sin((b - 120) * 0.38) * 6;
  q("s6-ph").style.opacity = pE(b, 120.2, 1.0);
  q("s6-ph").style.transform = `translate3d(${lerp(-90, 0, pp)}px,${fl}px,0) rotateY(4deg) rotateX(1.5deg)`;
  const tg = pE(b, 120.05, 0.8); q("s6-tag").style.opacity = tg; q("s6-tag").style.transform = `translate3d(${lerp(-18, 0, tg)}px,0,0)`;
  const h = pS(b, 120.15, 0.95); q("s6-h").style.opacity = pE(b, 120.1, 0.55); q("s6-h").style.transform = `translate3d(0,${lerp(28, 0, h)}px,0)`;
  [["s6-q1", 124], ["s6-q2", 125], ["s6-q3", 126]].forEach(([id, s]) => {
    const p = pE(b, s, 1.2);
    const el = q(id);
    el.style.opacity = p;
    el.style.transform = `translate3d(${lerp(-24, 0, snap((b - s) / 1.4))}px,0,0)`;
  });
  const pb = pE(b, 127, 1);
  q("s6-beats").style.opacity = pb; q("s6-beats").style.transform = `translate3d(0,${lerp(12, 0, pb)}px,0)`;
  for (let i = 0; i < 3; i++) {
    const p = clamp((b - (130 + i)) / 0.55);
    const k = q("btk" + i);
    k.style.background = p > 0.02 ? "#a2402c" : "transparent";
    k.style.borderColor = p > 0.02 ? "#a2402c" : "rgba(27,25,21,.28)";
    k.textContent = p > 0.02 ? "✓" : "";
    k.style.transform = `scale(${lerp(0.5, 1, snap(p))})`;
  }
  const bar = easeIO((b - 130) / 6);
  q("s6-bar-in").style.width = (700 * 0.34 * bar) + "px";
  q("s6-word").textContent = Math.round(1020 * bar).toLocaleString();
  const pbar = pE(b, 129.5, 0.8);
  q("s6-bar").style.opacity = pbar; q("s6-bar").style.transform = "none";
  q("s6-barl").style.opacity = pbar; q("s6-barl").style.transform = "none";
  const ft = pE(b, 140, 1.2); q("s6-foot").style.opacity = ft; q("s6-foot").style.transform = `translate3d(0,${lerp(12, 0, ft)}px,0)`;
}

/* ---------------- S7 仪表 ---------------- */
function sc7(b) {
  const pp = pS(b, 144.3, 2.0);
  const fl = Math.sin((b - 144) * 0.42) * 7;
  q("s7-ph").style.opacity = pE(b, 144.2, 1.0);
  q("s7-ph").style.transform = `translate3d(${lerp(100, 0, pp)}px,${fl}px,0) rotateY(-5deg) rotateX(1.5deg)`;
  const tg = pE(b, 144.05, 0.8); q("s7-tag").style.opacity = tg; q("s7-tag").style.transform = `translate3d(${lerp(-18, 0, tg)}px,0,0)`;
  const h = pS(b, 144.15, 0.9); q("s7-h").style.opacity = pE(b, 144.1, 0.5); q("s7-h").style.transform = `translate3d(0,${lerp(26, 0, h)}px,0)`;
  const pin = pS(b, 146, 1.2);
  q("s7-big").style.opacity = pE(b, 146, 0.6); q("s7-big").style.transform = `scale(${lerp(0.9, 1, pin)})`;
  const cnt = ease((b - 148) / 6);
  q("s7-num").textContent = Math.round(1267 * cnt).toLocaleString();
  const kp = pE(b, 152, 1); q("s7-kpi").style.opacity = kp; q("s7-kpi").style.transform = `translate3d(0,${lerp(16, 0, kp)}px,0)`;
  [["s7-l1", 156], ["s7-l2", 157], ["s7-l3", 158]].forEach(([id, s]) => {
    const p = pE(b, s, 1);
    const el = q(id); el.style.opacity = p; el.style.transform = `translate3d(${lerp(-16, 0, snap((b - s) / 1.2))}px,0,0)`;
  });
  const ft = pE(b, 160, 1); q("s7-foot").style.opacity = ft; q("s7-foot").style.transform = `translate3d(0,${lerp(10, 0, ft)}px,0)`;
}

/* ---------------- S8 四卡 ---------------- */
const CARDS = [
  ["资料库", "按本章蓝图自动检索最相关的 4 段参考", "../ui-shots/v18-materials.png", -4],
  ["关系图谱", "点一个角色，只看跟他有关的线", "../ui-shots/v14-graph.png", -206],
  ["全书搜索", "作品、正文、角色、线索一起搜", "../ui-shots/v18-search.png", -232],
  ["导出", "分章 Markdown · TXT · JSON · EPUB", "../ui-shots/v14-export.png", -296],
];
(function () {
  const box = q("s8-cards"); if (!box) return;
  CARDS.forEach(([t, d, img, top], i) => {
    const w = 400, gap = 40, H = 672;
    const el = document.createElement("div");
    el.className = "card"; el.id = "cd" + i;
    el.style.cssText += `left:${i * (w + gap)}px;top:0;width:${w}px;height:${H}px;padding:14px 14px 0;overflow:hidden`;
    el.innerHTML = `
      <div style="width:100%;height:448px;border-radius:12px;overflow:hidden;background:#f0eadf;position:relative">
        <img src="${img}" style="position:absolute;left:0;top:${top}px;width:100%;display:block">
        <div style="position:absolute;inset:0;background:linear-gradient(180deg,#fffdf7 0%,rgba(255,253,247,0) 13%,rgba(255,253,247,0) 92%,#fffdf7 100%)"></div>
      </div>
      <div class="serif" style="font-size:30px;margin:24px 6px 0">${t}</div>
      <div style="font-size:18px;line-height:1.7;color:#5b554a;margin:10px 6px 0">${d}</div>`;
    box.appendChild(el);
  });
})();

function sc8(b) {
  const h = pS(b, 168.1, 0.9); q("s8-h").style.opacity = pE(b, 168.05, 0.5); q("s8-h").style.transform = `translate3d(0,${lerp(26, 0, h)}px,0)`;
  const s = pE(b, 168.4, 0.9); q("s8-sub").style.opacity = s; q("s8-sub").style.transform = `translate3d(0,${lerp(12, 0, s)}px,0)`;
  CARDS.forEach((_, i) => {
    const st = 172 + i;
    const p = pS(b, st, 1.6);
    const el = q("cd" + i);
    el.style.opacity = pE(b, st, 0.7);
    el.style.transform = `translate3d(0,${lerp(70, 0, p)}px,0) scale(${lerp(0.94, 1, p)})`;
  });
  const f = pE(b, 178, 1); q("s8-foot").style.opacity = f; q("s8-foot").style.transform = `translate3d(0,${lerp(10, 0, f)}px,0)`;
}

/* ---------------- S9 对比 ---------------- */
const ROWS = [
  ["地铁上、床上、排队时都能写", "得先坐到桌前、开机、打开文件"],
  ["竖屏单手，拇指够得着所有按钮", "键盘加鼠标，需要一张桌子"],
  ["码字仪表随手浮在正文上", "要另外装插件、开小窗"],
  ["返回键逐层回退，自动存稿", "多半靠 Ctrl+S 和肌肉记忆"],
  ["AI 生成有硬闸门，辅助只挑毛病", "多数工具没有这层边界"],
  ["离线可用，安装包 5.4 MB", "安装包更大，常需联网"],
  ["数据只在本机，不登录也能用", "云同步往往先要一个账号"],
  ["大屏改稿、多章对照 —— 这一点电脑更强", "27 寸屏一次看三章，手机做不到"],
];
(function () {
  const box = q("s9-rows"); if (!box) return;
  ROWS.forEach(([l, r], i) => {
    const d = document.createElement("div");
    d.className = "row"; d.id = "rw" + i;
    d.style.top = i * 74 + "px";
    const last = i === ROWS.length - 1;
    d.innerHTML = `<div class="l">${last
      ? '<span style="width:22px;text-align:center;color:#9a8f7d;font-size:16px">—</span>'
      : '<span class="tick">✓</span>'}<span${last ? ' style="color:#6b6355"' : ''}>${l}</span></div>
      <div class="r">${last
      ? '<span class="tick" style="background:#1b1915">✓</span>'
      : '<span class="cross">✕</span>'}<span${last ? ' style="color:#2b2720"' : ''}>${r}</span></div>`;
    box.appendChild(d);
  });
})();

function sc9(b) {
  const h = pS(b, 192.1, 0.9); q("s9-h").style.opacity = pE(b, 192.05, 0.5); q("s9-h").style.transform = `translate3d(0,${lerp(24, 0, h)}px,0)`;
  const s = pE(b, 192.4, 0.9); q("s9-sub").style.opacity = s; q("s9-sub").style.transform = `translate3d(0,${lerp(12, 0, s)}px,0)`;
  const hd = pE(b, 194, 0.8); q("s9-head").style.opacity = hd; q("s9-head").style.transform = "none";
  ROWS.forEach((_, i) => {
    const st = 196 + i;
    const p = pE(b, st, 0.8);
    const el = q("rw" + i);
    el.style.opacity = p;
    el.style.transform = `translate3d(${lerp(-18, 0, snap((b - st) / 1))}px,0,0)`;
    if (i === ROWS.length - 1) el.style.borderBottom = "none";
  });
  const f = pE(b, 210, 1.2); q("s9-foot").style.opacity = f; q("s9-foot").style.transform = `translate3d(0,${lerp(12, 0, f)}px,0)`;
}

/* ---------------- S10 收尾 ---------------- */
function sc10(b) {
  const h = pS(b, 224.1, 1.0);
  q("s10-h").style.opacity = pE(b, 224.05, 0.6);
  q("s10-h").style.transform = `translate3d(0,${lerp(34, 0, h)}px,0) scale(${lerp(0.96, 1, h)})`;
  const l = pE(b, 227, 1);
  q("s10-line").style.opacity = l; q("s10-line").style.width = lerp(0, 64, l) + "px"; q("s10-line").style.transform = "none";
  const i2 = pE(b, 228, 1.2); q("s10-info").style.opacity = i2; q("s10-info").style.transform = `translate3d(0,${lerp(16, 0, i2)}px,0)`;
  const br = pE(b, 230, 1.2); q("s10-brand").style.opacity = br; q("s10-brand").style.transform = `translate3d(0,${lerp(16, 0, br)}px,0)`;
  const se = pS(b, 232, 1.2); P("s10-seal", { o: clamp((b - 232) / 0.5), s: lerp(0.45, 1, se), r: lerp(-20, -7, se) });
}

/* ---------------- 主渲染 ---------------- */
const CUTS_SEC = CUTS.map(b => b * BEAT);

function render(t) {
  const b = t / BEAT;
  Object.keys(SC).forEach(id => {
    const [s, e] = SC[id];
    const a = Math.min(clamp((b - s * 4) / 0.2), clamp((e * 4 - b) / 0.18));
    const el = q(id);
    el.style.opacity = a;
    el.style.visibility = a > 0.002 ? "visible" : "hidden";
  });
  sc1(b); sc2(b); sc3(b); sc4(b); sc5(b); sc6(b); sc7(b); sc8(b); sc9(b); sc10(b);

  /* 节拍脉冲：每拍轻推，小节首拍更重 */
  const ph = b - Math.floor(b);
  const hit = Math.exp(-ph * 7.5);
  const strong = Math.floor(b) % 4 === 0 ? 1 : 0.4;
  q("stage").style.transform = `scale(${1 + 0.0055 * hit * strong})`;

  /* 换场闪光 */
  let fl = 0;
  for (const c of CUTS_SEC) { const d = t - c; if (d >= 0 && d < 0.65) fl = Math.max(fl, Math.exp(-d * 7) * 0.55); }
  q("flash").style.opacity = fl * 0.16;

  /* 末尾收黑 */
  q("fadeout").style.opacity = clamp((t - (DURATION - 1.6)) / 1.6);
  window.__t = t;
}
window.render = render;
window.DURATION = DURATION;

render(0);
Promise.all(Array.from(document.images).map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; })))
  .then(() => document.fonts.ready)
  .then(() => { render(0); window.__ready = true; });
