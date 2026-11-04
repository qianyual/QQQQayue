/* ============================================================
 * 书童移动版 — 角色关系图谱
 * 桌面版只有 GraphGeneration 走大模型出图；移动端做成本地渲染：
 *   1) 先从角色卡 relationships 文本解析关系边（零成本）
 *   2) 需要更完整时再调 AI 抽取（JSON → 边）
 * 布局用环形 + 按角色阵营分色，点击节点高亮相邻关系
 * ============================================================ */
"use strict";

const Graph = (() => {
  /* 关系类型 → 线色 / 线型 */
  const KINDS = [
    { id: "kin", label: "血缘亲情", test: /父|母|子|女|兄|弟|姐|妹|亲|族|血缘|养父|养母|舅舅|叔叔|姑姑|姨/ },
    { id: "love", label: "情感", test: /恋|爱|夫|妻|婚|青梅|暗恋|情侣|白月光|红颜|倾心/ },
    { id: "master", label: "师承", test: /师|徒|弟子|传承|授业|门人/ },
    { id: "enemy", label: "敌对", test: /敌|仇|对立|宿敌|叛|恨|追杀|竞争|对手/ },
    { id: "ally", label: "同盟", test: /友|盟|伙伴|同伴|队友|搭档|并肩|合作/ },
    { id: "serve", label: "从属", test: /下属|上司|主仆|效忠|麾下|部下|老板|属下/ },
  ];
  const KIND_COLOR = { kin: "#a2402c", love: "#c2607a", master: "#3e7d4f", enemy: "#8c3524", ally: "#2e5e8c", serve: "#7a4a8c", other: "#968e7f" };

  function kindOf(relation) {
    for (const k of KINDS) if (k.test.test(relation)) return k.id;
    return "other";
  }

  const NAME_RE = /[\u4e00-\u9fa5A-Za-z·]{2,7}/;

  /** 名字归一：命中已有角色名或别名则返回该角色 id */
  function resolve(name, characters) {
    const raw = String(name || "").replace(/[（(].*?[）)]/g, "").trim();
    if (!raw) return null;
    for (const c of characters) {
      if (c.name === raw) return c.id || c.name;
      if (Array.isArray(c.aliases) && c.aliases.includes(raw)) return c.id || c.name;
      if (typeof c.aliases === "string" && c.aliases.split(/[、,，\s]/).includes(raw)) return c.id || c.name;
    }
    /* 允许简称：角色名包含解析名（如「林小满」写作「小满」） */
    const fuzzy = characters.find(c => c.name && (c.name.includes(raw) || raw.includes(c.name)));
    return fuzzy ? (fuzzy.id || fuzzy.name) : null;
  }

  /** 从自由文本关系解析出边 */
  function parseRelations(characters) {
    const edges = [];
    const seen = new Set();
    const push = (fromId, toId, relation, source) => {
      if (!fromId || !toId || fromId === toId) return;
      const key = [fromId, toId].sort().join("|") + "|" + relation.slice(0, 8);
      if (seen.has(key)) return;
      seen.add(key);
      edges.push({ a: fromId, b: toId, relation, kind: kindOf(relation), source: source || "card" });
    };

    for (const c of characters) {
      const selfId = c.id || c.name;
      const text = c.relationships;
      if (!text) continue;
      for (const chunk of String(text).split(/[；;。\n]/)) {
        const seg = chunk.trim();
        if (!seg) continue;
        let matched = false;

        /* 形式一：与张三（师徒） / 张三（青梅竹马） */
        const paren = seg.match(/(?:与|和|跟|同)?\s*([\u4e00-\u9fa5A-Za-z·]{2,7})\s*[（(]([^）)]{1,20})[）)]/);
        if (paren) {
          const id = resolve(paren[1], characters);
          if (id) { push(selfId, id, paren[2].trim(), "card"); matched = true; }
        }

        /* 形式二：与张三：师徒关系 */
        if (!matched) {
          const colon = seg.match(/(?:与|和|跟|同)?\s*([\u4e00-\u9fa5A-Za-z·]{2,7})\s*[：:]\s*(.{1,30})/);
          if (colon) {
            const id = resolve(colon[1], characters);
            if (id) { push(selfId, id, colon[2].trim().replace(/[，,]$/, ""), "card"); matched = true; }
          }
        }

        /* 形式三：张三是他的师父 */
        if (!matched) {
          const plain = seg.match(NAME_RE);
          if (plain) {
            const id = resolve(plain[0], characters);
            if (id && id !== selfId) push(selfId, id, seg.replace(plain[0], "").replace(/^[是为，,、\s]+/, "").trim() || "相关", "card");
          }
        }
      }
    }
    return edges;
  }

  /** 合并 AI 结果与卡片解析结果 */
  function mergeEdges(parsed, ai) {
    const seen = new Set();
    const out = [];
    for (const e of [...(ai || []), ...parsed]) {
      const key = [e.a, e.b].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
    return out;
  }

  /* ---------------- 渲染 ---------------- */
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  const ROLE_COLOR = { protagonist: "#a2402c", antagonist: "#5b554a", supporting: "#2e5e8c", minor: "#968e7f" };
  const ROLE_LABEL = { protagonist: "主角", antagonist: "反派", supporting: "配角", minor: "次要" };

  function nodeRadius(count) { return count > 16 ? 13 : count > 9 ? 16 : 19; }

  /** 生成 SVG 字符串；size 为画布边长 */
  function svg(characters, edges, activeId, size) {
    const W = size || 340;
    const cx = W / 2, cy = W / 2;
    const nodes = characters.map((c, i) => {
      const n = characters.length;
      const R = n <= 8 ? W * 0.34 : W * 0.38;
      const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
      return {
        id: c.id || c.name,
        name: c.name || "未命名",
        role: c.role || "minor",
        x: cx + Math.cos(ang) * R,
        y: cy + Math.sin(ang) * R,
      };
    });
    const byId = new Map(nodes.map(n => [n.id, n]));
    const r = nodeRadius(nodes.length);

    const edgeSvg = edges.map(e => {
      const A = byId.get(e.a), B = byId.get(e.b);
      if (!A || !B) return "";
      const active = !activeId || e.a === activeId || e.b === activeId;
      const color = KIND_COLOR[e.kind] || KIND_COLOR.other;
      const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
      /* 轻微弯折，避免多条边重叠成一条 */
      const dx = B.x - A.x, dy = B.y - A.y;
      const len = Math.hypot(dx, dy) || 1;
      const bow = e.kind === "enemy" ? 0.12 : e.kind === "love" ? -0.12 : 0.05;
      const qx = mx - dy * bow, qy = my + dx * bow;
      return `<path d="M${A.x.toFixed(1)} ${A.y.toFixed(1)} Q${qx.toFixed(1)} ${qy.toFixed(1)} ${B.x.toFixed(1)} ${B.y.toFixed(1)}"
        fill="none" stroke="${color}" stroke-width="${active ? 1.9 : 1.1}" opacity="${active ? 0.85 : 0.18}"
        stroke-dasharray="${e.kind === "enemy" ? "5 3" : e.kind === "serve" ? "2 3" : "none"}"/>`;
    }).join("");

    const nodeSvg = nodes.map(n => {
      const active = !activeId || n.id === activeId;
      const color = ROLE_COLOR[n.role] || ROLE_COLOR.minor;
      const label = n.name.length > 4 ? n.name.slice(0, 4) : n.name;
      return `<g class="g-node" data-node="${esc(n.id)}" style="cursor:pointer" opacity="${active ? 1 : 0.35}">
        <circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${r}" fill="var(--bg-elev)" stroke="${color}" stroke-width="${activeId === n.id ? 3 : 1.8}"/>
        <circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${r - 5}" fill="${color}" opacity="0.12"/>
        <text x="${n.x.toFixed(1)}" y="${(n.y + 4).toFixed(1)}" text-anchor="middle" font-size="${r > 15 ? 11 : 9.5}"
          fill="var(--ink)" font-family="var(--font-serif)">${esc(label)}</text>
        ${activeId === n.id ? `<text x="${n.x.toFixed(1)}" y="${(n.y + r + 13).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--ink-3)">${esc(ROLE_LABEL[n.role] || "")}</text>` : ""}
      </g>`;
    }).join("");

    return `<svg viewBox="0 0 ${W} ${W}" width="100%" style="display:block;max-height:56vh" xmlns="http://www.w3.org/2000/svg">
      <g>${edgeSvg}</g><g>${nodeSvg}</g>
    </svg>`;
  }

  return { parseRelations, mergeEdges, svg, kindOf, resolve, KIND_COLOR, ROLE_LABEL };
})();
