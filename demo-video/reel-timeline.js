/* ============================================================
 * 竖屏短视频 · 113 BPM（原曲《若如初见》实测）
 * 33 小节 = 132 拍 = 70.09s；1 拍 = 0.53097s；1 小节 = 2.1239s
 * 切镜全部落在小节线；元素按 1/2、1/4 拍递进
 * ============================================================ */
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const ease = t => 1 - Math.pow(1 - clamp(t), 3);
const easeIO = t => { t = clamp(t); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const snap = t => { t = clamp(t); const c = 2.0; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const lerp = (a, b, p) => a + (b - a) * p;
const q = id => document.getElementById(id);

const BPM = 113, BEAT = 60 / BPM, BAR = BEAT * 4;
const pL = (b, s, d) => clamp((b - s) / d);
const pE = (b, s, d) => ease((b - s) / d);
const pS = (b, s, d) => snap((b - s) / d);

const SC = {
  s1: [0, 3], s2: [3, 6], s3: [6, 10], s4: [10, 13], s5: [13, 16],
  s6: [16, 19], s7: [19, 22], s8: [22, 26], s9: [26, 29], s10: [29, 33],
};
const DIR = { s1: 1, s2: 1, s3: -1, s4: 1, s5: -1, s6: 1, s7: -1, s8: 1, s9: -1, s10: 1 };
const CUTS = [3, 6, 10, 13, 16, 19, 22, 26, 29];
const DURATION = 33 * BAR;

/* ---------------- 构建：16 技能格 ---------------- */
const SKILLS = [
  "逻辑硬伤", "设定连续性", "节奏诊断", "伏笔呼应",
  "动机与选择", "视角与信息", "章末钩子", "场景可视化",
  "错字与病句", "AI 味检测", "重复与口头禅", "对话质感",
  "文风教练", "角色弧检查", "拆本章节拍", "卡文破局",
];
(function buildGrid() {
  const g = q("s3-grid");
  const W = 216, G = 24;
  SKILLS.forEach((name, i) => {
    const col = i % 4, row = (i / 4) | 0;
    const el = document.createElement("div");
    el.id = "sk" + i;
    el.style.cssText = `position:absolute;left:${col * (W + G)}px;top:${row * (W + G)}px;width:${W}px;height:${W}px;
      border-radius:28px;background:rgba(255,253,247,.94);border:2px solid rgba(27,25,21,.09);
      box-shadow:0 22px 40px -26px rgba(20,14,8,.45);padding:22px 20px;overflow:hidden`;
    el.innerHTML = `<div class="num" style="font-size:22px;color:#a2402c;letter-spacing:2px">${String(i + 1).padStart(2, "0")}</div>
      <div class="serif" style="position:absolute;left:20px;bottom:26px;right:14px;font-size:30px;
        line-height:1.2;letter-spacing:-1px;white-space:nowrap">${name}</div>`;
    g.appendChild(el);
  });
})();

/* ---------------- 构建：对比表 ---------------- */
const ROWS = [
  ["随身随时写", "✓", "—"],
  ["AI 生成 / 续写", "✓", "✓"],
  ["16 个审稿技能", "✓", "✓"],
  ["码字速度仪表", "✓", "—"],
  ["资料库检索", "✓", "✓"],
  ["大屏改稿", "—", "✓"],
];
(function buildRows() {
  const box = q("s8-rows");
  box.className = "u";
  box.style.cssText = "position:absolute;left:64px;top:470px;width:952px";
  ROWS.forEach(([name, a, c], i) => {
    const last = i === ROWS.length - 1;
    const el = document.createElement("div");
    el.id = "rw" + i;
    el.style.cssText = `display:flex;align-items:center;height:${last ? 120 : 130}px;
      border-bottom:${last ? "none" : "2px solid rgba(27,25,21,.10)"}`;
    el.innerHTML = `<div style="flex:1;font-size:40px;letter-spacing:1px;color:${last ? "#a2402c" : "#2b2720"}">${name}</div>
      <div style="width:190px;text-align:center;font-size:44px;color:${a === "✓" ? "#a2402c" : "rgba(27,25,21,.22)"}">${a}</div>
      <div style="width:190px;text-align:center;font-size:44px;color:${c === "✓" ? "#6f6656" : "rgba(27,25,21,.22)"}">${c}</div>`;
    box.appendChild(el);
  });
})();

/* ---------------- 场景进出（硬切 + 快甩） ---------------- */
const DARK = { s2: 1, s4: 1, s6: 1, s7: 1, s9: 1 };
function sceneShow(b) {
  let cur = "s1";
  for (const id in SC) {
    const [s, e] = SC[id], bs = s * 4, be = e * 4;
    const inside = b >= bs - 0.001 && b < be - 0.001;
    if (inside) cur = id;
    const el = q(id);
    if (!inside) { el.style.opacity = 0; el.style.visibility = "hidden"; continue; }
    /* 只在切点做 0.05 拍的极短过渡，避免单帧空屏 */
    const a = Math.min(clamp((b - bs) / 0.05), clamp((be - b) / 0.05));
    el.style.opacity = a;
    el.style.visibility = "visible";
    const p = clamp((b - bs) / 0.42);
    const sc = 1 + 0.055 * (1 - easeIO(p));
    el.style.transform = `translate3d(0,0,0) scale(${sc})`;
  }
  q("stage").style.background = DARK[cur] ? "#0d0b09" : "#f2ead9";
}

/* ---------------- S1 开场 ---------------- */
function sc1(b) {
  q("s1-ring").style.transform = `rotate(${b * 2.4}deg)`;
  q("s1-ring2").style.transform = `rotate(${-b * 1.8}deg) translate3d(0,${Math.sin(b * 0.5) * 14}px,0)`;

  const k = pE(b, 0.03, 0.45);
  q("s1-k").style.opacity = k;
  q("s1-k").style.transform = `translate3d(0,${lerp(26, 0, k)}px,0)`;

  [["s1-t1", 0.32], ["s1-t2", 0.68], ["s1-t3", 1.04]].forEach(([id, st]) => {
    const p = pS(b, st, 0.8);
    const el = q(id);
    el.style.opacity = pE(b, st, 0.3);
    el.style.transformOrigin = "0% 100%";
    el.style.transform = `translate3d(0,${lerp(112, 0, p)}px,0) scale(${lerp(1.14, 1, p)}) rotate(${lerp(2.4, 0, p)}deg)`;
  });

  const l = pE(b, 1.82, 0.6);
  q("s1-line").style.opacity = l;
  q("s1-line").style.width = lerp(0, 96, l) + "px";
  const s = pE(b, 2.0, 0.7);
  q("s1-sub").style.opacity = s;
  q("s1-sub").style.transform = `translate3d(0,${lerp(24, 0, s)}px,0)`;

  [["s1-c1", 2.62], ["s1-c2", 2.84], ["s1-c3", 3.06]].forEach(([id, st]) => {
    const p = pS(b, st, 0.55);
    const el = q(id);
    el.style.opacity = pE(b, st, 0.28);
    el.style.transform = `translate3d(0,${lerp(34, 0, p)}px,0) scale(${lerp(0.84, 1, p)})`;
  });

  const pp = pS(b, 1.36, 1.6);
  const push = 1 + 0.09 * easeIO((b - 9.9) / 2.0);
  q("s1-ph").style.opacity = pE(b, 1.36, 0.7);
  q("s1-ph").style.transformOrigin = "50% 4%";
  q("s1-ph").style.transform =
    `translate3d(${lerp(210, 0, pp)}px,${lerp(96, 0, pp) + Math.sin(b * 0.9) * 7}px,0) ` +
    `rotate(${lerp(9, -2.6, pp)}deg) scale(${lerp(0.9, 1, pp) * push})`;
  q("s1-glow").style.opacity = pE(b, 2.1, 0.9) * 0.95;
}

/* ---------------- S2 双模式 ---------------- */
function sc2(b) {
  const gl = pE(b, 12.0, 1.2);
  q("s2-glow").style.opacity = gl * 0.9;
  q("s2-glow").style.transform = `translate3d(0,${Math.sin(b * 0.6) * 20}px,0)`;

  const k = pE(b, 12.02, 0.45);
  q("s2-k").style.opacity = k; q("s2-k").style.transform = `translate3d(0,${lerp(24, 0, k)}px,0)`;
  const h = pS(b, 12.07, 0.85);
  q("s2-h").style.opacity = pE(b, 12.07, 0.32);
  q("s2-h").style.transform = `translate3d(0,${lerp(74, 0, h)}px,0) scale(${lerp(1.06, 1, h)})`;

  const sw = pS(b, 12.7, 1.0);
  q("s2-sw").style.opacity = pE(b, 12.7, 0.45);
  q("s2-sw").style.transform = `translate3d(0,${lerp(90, 0, sw)}px,0) scale(${lerp(0.92, 1, sw)})`;

  /* 拨动：14.3 起 1.3 拍滑到底 */
  const mv = easeIO((b - 14.3) / 1.3);
  q("s2-knob").style.top = lerp(74, 262, mv) + "px";
  q("s2-ring").style.top = lerp(56, 244, mv) + "px";
  q("s2-ring").style.opacity = clamp((b - 14.28) / 0.28) * (1 - clamp((b - 16.4) / 0.4));
  q("s2-rowA").style.opacity = lerp(1, 0.26, mv);
  q("s2-rowB").style.opacity = lerp(0.3, 1, mv);
  q("s2-knob").style.background = mv > 0.58 ? "#a2402c" : "#f7f2e6";

  const lk = pS(b, 15.8, 0.8);
  q("s2-lock").style.opacity = pE(b, 15.8, 0.35);
  q("s2-lock").style.transform = `translate3d(0,${lerp(54, 0, lk)}px,0) scale(${lerp(0.86, 1, lk)}) rotate(${lerp(4, 0, lk)}deg)`;

  const f1 = pE(b, 16.4, 0.7);
  q("s2-f1").style.opacity = f1 * 0.96;
  q("s2-f1").style.transform = `translate3d(0,${lerp(20, 0, f1)}px,0)`;

  const f2 = pS(b, 22.2, 0.9);
  q("s2-f2").style.opacity = pE(b, 22.2, 0.4);
  q("s2-f2").style.transform = `translate3d(${lerp(-46, 0, f2)}px,0,0)`;
}

/* ---------------- S3 技能 ---------------- */
function sc3(b) {
  const k = pE(b, 24.02, 0.45);
  q("s3-k").style.opacity = k; q("s3-k").style.transform = `translate3d(0,${lerp(22, 0, k)}px,0)`;
  const h = pS(b, 24.07, 0.85);
  q("s3-h").style.opacity = pE(b, 24.07, 0.32);
  q("s3-h").style.transform = `translate3d(0,${lerp(72, 0, h)}px,0) scale(${lerp(1.05, 1, h)})`;

  SKILLS.forEach((_, i) => {
    const st = 24.34 + i * 0.19;
    const p = pS(b, st, 0.5);
    const el = q("sk" + i);
    el.style.opacity = pE(b, st, 0.26);
    el.style.transform = `translate3d(0,${lerp(60, 0, p)}px,0) scale(${lerp(0.8, 1, p)})`;
  });

  const pushBack = easeIO((b - 30.1) / 1.0);
  q("s3-grid").style.transform = `translate3d(0,${lerp(0, -40, pushBack)}px,0) scale(${lerp(1, 0.93, pushBack)})`;
  q("s3-grid").style.opacity = lerp(1, 0.26, pushBack);
  q("s3-f").style.opacity = pE(b, 28.4, 0.6) * (1 - pushBack);

  const rp = easeIO((b - 30.1) / 1.4);
  q("s3-report").style.opacity = clamp((b - 30.0) / 0.45);
  q("s3-report").style.transform = `translate3d(0,${lerp(940, 0, rp)}px,0)`;

  const bd = pS(b, 31.8, 0.7);
  q("s3-badge").style.opacity = pE(b, 31.8, 0.3);
  q("s3-badge").style.transform = `translate3d(0,${lerp(-34, 0, bd)}px,0) scale(${lerp(0.78, 1, bd)}) rotate(-4deg)`;
}

/* ---------------- S4 章纲罗盘 ---------------- */
function sc4(b) {
  const en = easeIO((b - 40.02) / 1.1);
  q("s4-hero").style.opacity = clamp((b - 40.0) / 0.4);
  q("s4-hero").style.transform = `translate3d(0,${lerp(52, 0, en)}px,0) scale(${lerp(1.05, 1, en)})`;
  q("s4-img").style.transform = `translateY(${lerp(0, -96, clamp((b - 40) / 12))}px) scale(${lerp(1, 1.05, clamp((b - 40) / 12))})`;

  const k = pE(b, 40.04, 0.45);
  q("s4-k").style.opacity = k;
  q("s4-k").style.transform = `translate3d(0,${lerp(22, 0, k)}px,0)`;
  const h = pS(b, 40.10, 0.9);
  q("s4-h").style.opacity = pE(b, 40.10, 0.32);
  q("s4-h").style.transform = `translate3d(0,${lerp(76, 0, h)}px,0) scale(${lerp(1.05, 1, h)})`;

  [["s4-c1", 42.0], ["s4-c2", 42.5], ["s4-c3", 43.2]].forEach(([id, st]) => {
    const p = pS(b, st, 0.65);
    const el = q(id);
    el.style.opacity = pE(b, st, 0.3);
    el.style.transform = `translate3d(${lerp(-80, 0, p)}px,0,0)`;
  });
  const f = pE(b, 44.4, 0.8);
  q("s4-c4").style.opacity = f;
  q("s4-c4").style.transform = `translate3d(0,${lerp(26, 0, f)}px,0)`;
}

/* ---------------- S5 码字仪表 ---------------- */
function sc5(b) {
  q("s5-ring").style.transform = `rotate(${b * 1.4}deg) scale(${1 + 0.02 * clamp((b - 52) / 12)})`;
  const k = pE(b, 52.02, 0.45);
  q("s5-k").style.opacity = k; q("s5-k").style.transform = `translate3d(0,${lerp(22, 0, k)}px,0)`;
  const lb = pE(b, 52.08, 0.55);
  q("s5-lab").style.opacity = lb; q("s5-lab").style.transform = `translate3d(0,${lerp(26, 0, lb)}px,0)`;

  const p = easeIO((b - 52.55) / 3.9);
  const val = Math.round(1267 * p);
  q("s5-num").innerHTML = `${val.toLocaleString("en-US")}<span style="font-size:110px;color:#a2402c;margin-left:16px">字</span>`;
  q("s5-num").style.opacity = pE(b, 52.12, 0.3);
  q("s5-num").style.transformOrigin = "4% 62%";
  q("s5-num").style.transform = `translate3d(0,${lerp(60, 0, pE(b, 52.12, 0.7))}px,0) scale(${lerp(1.05, 1, Math.max(p, 0.001))})`;

  q("s5-fill").style.width = (948 * (1267 / 2000) * p) + "px";
  q("s5-goal").style.width = (948 * p) + "px";
  const gt = pE(b, 53.1, 0.6);
  q("s5-gt").style.opacity = gt * 0.9;

  const fi = pS(b, 53.7, 0.9);
  q("s5-fish").style.opacity = pE(b, 53.7, 0.4);
  q("s5-fish").style.transform = `translate3d(0,${lerp(64, 0, fi)}px,0) scale(${lerp(0.94, 1, fi)})`;

  const pl = pS(b, 54.6, 1.1);
  q("s5-pill").style.opacity = pE(b, 54.6, 0.45);
  q("s5-pill").style.transform = `translate3d(${lerp(140, 0, pl)}px,${lerp(60, 0, pl)}px,0) rotate(${lerp(9, 2.6, pl)}deg)`;

  const cp = pE(b, 55.4, 0.7);
  q("s5-cap").style.opacity = cp;
  q("s5-cap").style.transform = `translate3d(0,${lerp(24, 0, cp)}px,0)`;
}

/* ---------------- S6 资料库 ---------------- */
function sc6(b) {
  const en = easeIO((b - 64.02) / 1.1);
  q("s6-hero").style.opacity = clamp((b - 64.0) / 0.4);
  q("s6-hero").style.transform = `translate3d(0,${lerp(52, 0, en)}px,0) scale(${lerp(1.05, 1, en)})`;
  q("s6-img").style.transform = `translateY(${lerp(0, -110, clamp((b - 64) / 12))}px) scale(${lerp(1, 1.05, clamp((b - 64) / 12))})`;

  const k = pE(b, 64.04, 0.45);
  q("s6-k").style.opacity = k; q("s6-k").style.transform = `translate3d(0,${lerp(22, 0, k)}px,0)`;
  const h = pS(b, 64.10, 0.9);
  q("s6-h").style.opacity = pE(b, 64.10, 0.32);
  q("s6-h").style.transform = `translate3d(0,${lerp(76, 0, h)}px,0) scale(${lerp(1.05, 1, h)})`;

  const f = pE(b, 66.3, 0.9);
  q("s6-f").style.opacity = f;
  q("s6-f").style.transform = `translate3d(0,${lerp(30, 0, f)}px,0)`;
  const bd = pS(b, 67.6, 0.7);
  q("s6-badge").style.opacity = pE(b, 67.6, 0.3);
  q("s6-badge").style.transform = `translate3d(0,${lerp(28, 0, bd)}px,0) scale(${lerp(0.86, 1, bd)})`;
}

/* ---------------- S7 图谱 → 搜索 ---------------- */
function sc7(b) {
  const sw = 82;
  const wA = 1 - clamp((b - (sw - 0.32)) / 0.4);
  const wB = clamp((b - sw) / 0.42);

  q("s7-a").style.opacity = wA;
  q("s7-a").style.transform = `translate3d(${lerp(0, -300, 1 - wA)}px,0,0) scale(${lerp(1.06, 1.02, wA)})`;
  q("s7-b").style.opacity = wB;
  q("s7-b").style.transform = `translate3d(${lerp(300, 0, easeIO(wB))}px,0,0) scale(${lerp(1.06, 1.0, easeIO(wB))})`;

  q("s7-ia").style.transform = `translateY(${-400 - 40 * clamp((b - 76) / 6)}px)`;
  q("s7-ib").style.transform = `translateY(${-380 - 40 * clamp((b - 82) / 6)}px)`;

  q("s7-ta").style.opacity = 1 - clamp((b - 81.6) / 0.3);
  q("s7-ta").style.transform = `translate3d(${lerp(0, -80, 1 - (1 - clamp((b - 81.6) / 0.3)))}px,0,0)`;
  const tb = pS(b, 82.1, 0.8);
  q("s7-tb").style.opacity = pE(b, 82.1, 0.35);
  q("s7-tb").style.transform = `translate3d(0,${lerp(56, 0, tb)}px,0)`;

  const f = pE(b, 77.0, 0.8);
  q("s7-f").style.opacity = f * 0.92;
  q("s7-f").style.transform = `translate3d(0,${lerp(24, 0, f)}px,0)`;
}

/* ---------------- S8 对比 ---------------- */
function sc8(b) {
  const k = pE(b, 88.03, 0.45);
  q("s8-k").style.opacity = k; q("s8-k").style.transform = `translate3d(0,${lerp(22, 0, k)}px,0)`;
  const h = pS(b, 88.07, 0.85);
  q("s8-h").style.opacity = pE(b, 88.07, 0.32);
  q("s8-h").style.transform = `translate3d(0,${lerp(70, 0, h)}px,0) scale(${lerp(1.05, 1, h)})`;

  const hd = pE(b, 88.2, 0.6);
  q("s8-head").style.opacity = hd;
  q("s8-head").style.transform = `translate3d(0,${lerp(24, 0, hd)}px,0)`;

  ROWS.forEach((_, i) => {
    const st = 88.5 + i * 0.46;
    const p = pS(b, st, 0.5);
    const el = q("rw" + i);
    el.style.opacity = pE(b, st, 0.28);
    el.style.transform = `translate3d(${lerp(76, 0, p)}px,0,0)`;
  });

  const f = pE(b, 92.0, 0.8);
  q("s8-f").style.opacity = f;
  q("s8-f").style.transform = `translate3d(0,${lerp(26, 0, f)}px,0)`;

  const sc = pS(b, 92.5, 0.9);
  q("s8-score").style.opacity = pE(b, 92.5, 0.35);
  q("s8-score").style.transform = `translate3d(0,${lerp(48, 0, sc)}px,0) scale(${lerp(0.9, 1, sc)})`;
  q("s8-score").style.transformOrigin = "0% 50%";

  const drift = easeIO((b - 96) / 8);
  q("s8-rows").style.transform = `translate3d(0,${lerp(0, -20, drift)}px,0)`;
}

/* ---------------- S9 三连快切 ---------------- */
function sc9(b) {
  const seg = [[104, 108, "s9-a", "s9-l1", "s9-ia"], [108, 112, "s9-b", "s9-l2", "s9-ib"],
               [112, 116, "s9-c", "s9-l3", "s9-ic"]];
  seg.forEach(([s, e, wrapId, labId, imgId]) => {
    const a = Math.min(clamp((b - s) / 0.35), clamp((e - b) / 0.32));
    const en = easeIO((b - s) / 0.9);
    const el = q(wrapId);
    el.style.opacity = a;
    el.style.transform = `translate3d(0,${lerp(70, 0, en)}px,0) scale(${lerp(1.05, 1, en)})`;
    q(imgId).style.transform = `translateY(${-400 - 50 * clamp((b - s) / 4)}px) scale(${lerp(1, 1.02, clamp((b - s) / 4))})`;

    const lp = pS(b, s + 0.4, 0.65);
    const lab = q(labId);
    const out = clamp((e - b) / 0.3);
    lab.style.opacity = pE(b, s + 0.4, 0.35) * out;
    lab.style.transform = `translate3d(0,${lerp(70, 0, lp) - (1 - out) * 50}px,0)`;
  });
}

/* ---------------- S10 收尾 ---------------- */
function sc10(b) {
  q("s10-ring").style.transform = `rotate(${-b * 1.8}deg) scale(${1 + 0.03 * clamp((b - 116) / 16)})`;
  const big = pS(b, 116.08, 1.05);
  q("s10-big").style.opacity = pE(b, 116.08, 0.32);
  q("s10-big").style.transformOrigin = "0% 90%";
  q("s10-big").style.transform = `translate3d(0,${lerp(150, 0, big)}px,0) scale(${lerp(1.12, 1, big)})`;

  const v = pS(b, 117.1, 0.8);
  q("s10-ver").style.opacity = pE(b, 117.1, 0.35);
  q("s10-ver").style.transform = `translate3d(${lerp(-40, 0, v)}px,0,0)`;

  const h = pE(b, 117.7, 0.8);
  q("s10-h").style.opacity = h;
  q("s10-h").style.transform = `translate3d(0,${lerp(40, 0, h)}px,0)`;

  const l = pE(b, 118.6, 0.7);
  q("s10-line").style.opacity = l;
  q("s10-line").style.width = lerp(0, 120, l) + "px";
  const i2 = pE(b, 118.9, 0.7);
  q("s10-info").style.opacity = i2;
  q("s10-info").style.transform = `translate3d(0,${lerp(18, 0, i2)}px,0)`;
  const br = pE(b, 119.8, 0.8);
  q("s10-brand").style.opacity = br;
  q("s10-brand").style.transform = `translate3d(0,${lerp(18, 0, br)}px,0)`;

  const se = pS(b, 120.6, 1.0);
  q("s10-seal").style.opacity = clamp((b - 120.6) / 0.35);
  q("s10-seal").style.transform = `scale(${lerp(0.42, 1.12, se) - Math.max(0, se - 1) * 0.12}) rotate(${lerp(-22, -7, se)}deg)`;
  q("s10-seal").style.transformOrigin = '50% 50%';
  q("s10-seal").style.boxShadow = `0 ${lerp(44, 16, se)}px ${lerp(70, 34, se)}px -10px rgba(120,30,16,${0.35 + 0.3 * se})`;
}

/* ---------------- 主渲染 ---------------- */
const CUTS_SEC = CUTS.map(b => b * BAR);

function render(t) {
  const b = t / BEAT;

  sceneShow(b);
  sc1(b); sc2(b); sc3(b); sc4(b); sc5(b); sc6(b); sc7(b); sc8(b); sc9(b); sc10(b);

  /* 每拍下压 + 小节首拍重拍 */
  const ph = b - Math.floor(b);
  const hit = Math.exp(-ph * 8.4);
  const strong = Math.floor(b) % 4 === 0 ? 1 : 0.42;
  q("stage").style.transform = `scale(${1 + 0.011 * hit * strong})`;

  q("prog").style.width = (clamp(t / DURATION) * 1080) + "px";

  const bi = Math.floor(b) % 4;
  const lit = Math.exp(-ph * 5.5);
  for (let i = 0; i < 4; i++) {
    const el = q("beats").children[i];
    el.style.background = i === bi ? `rgba(162,64,44,${0.34 + 0.66 * lit})` : "rgba(27,25,21,.13)";
    el.style.transform = i === bi ? `scaleY(${1 + 1.2 * lit})` : "scaleY(1)";
  }

  /* 切镜时扫过的速度线 + 闪白 */
  let fl = 0, st = -1;
  for (const c of CUTS_SEC) { const d = t - c; if (d >= 0 && d < 0.34 && d > st) { st = d; fl = Math.exp(-d * 12); } }
  q("flash").style.opacity = fl * 0.11;
  const lines = q("streaks").children;
  for (let i = 0; i < 3; i++) {
    if (st < 0) { lines[i].style.opacity = 0; continue; }
    const p = st / 0.34;
    lines[i].style.opacity = (1 - p) * 0.32;
    lines[i].style.transform = `translate3d(${lerp(-260, 340, p) - i * 40}px,0,0) scaleX(${lerp(0.35, 1.5, p)})`;
  }

  q("fadeout").style.opacity = clamp((t - (DURATION - 2.3)) / 2.3);
  window.__t = t;
}
window.render = render;
window.DURATION = DURATION;

render(0);
Promise.all(Array.from(document.images).map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; })))
  .then(() => document.fonts.ready)
  .then(() => { render(0); window.__ready = true; });
