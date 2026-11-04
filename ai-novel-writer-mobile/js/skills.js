/* ============================================================
   技能库（写作审查 / 纠错插件）
   ------------------------------------------------------------
   思路对齐桌面版 src/shared/builtin-writing-skills.ts 的 SKILL 体系：
   一个技能 = 一组固定的检查视角 + 一段可改的提示词。
   技能可在设置里启停、改词、复制自建，也能在正文页一键跑。

   输出分三类：
   - issue   ：结构化问题清单（可定位原文、可勾选采纳去修稿）
   - prose   ：整段建议（教练型，不改稿）
   - blueprint：回写章纲（节拍 / 伏笔 / 张力）
   ============================================================ */
(function () {
  const KEY = "skillState";

  const GROUPS = {
    check: { name: "审查", hint: "挑毛病，不动正文" },
    fix: { name: "纠错", hint: "字句层面的硬错误" },
    craft: { name: "打磨", hint: "整体提升方向" },
    plan: { name: "章纲", hint: "拆节拍与伏笔" },
    idea: { name: "创意", hint: "卡文时给走向" },
  };

  /* ---------------- 内置技能 ---------------- */
  const BUILTIN = [
    /* ===== 审查 ===== */
    {
      id: "logic-audit", name: "逻辑硬伤", group: "check", icon: "shield", output: "issue", max: 8,
      desc: "因果断裂、动机不足、时间线冲突、常识错误",
      focus: `只找「说不通」的地方，共四类：
1. 因果断裂：前面没有铺垫，后面突然发生；或者 A 导致 B 的过程缺了一步。
2. 时间线冲突：昼夜、季节、路程、先后顺序对不上；前文说过了三天，这里说当晚。
3. 空间位置错乱：人物上一句在门外，下一句已在屋里，中间没有交代。
4. 常识错误：器物、职业、时代、生理层面经不起推敲。`,
    },
    {
      id: "continuity", name: "设定连续性", group: "check", icon: "diff", output: "issue", max: 8,
      desc: "与已定稿的事实、角色状态、世界规则撞车",
      focus: `对照「已定稿事实」和「角色当前状态」，找出正文里与之矛盾之处：
1. 人物状态矛盾：伤好了又流血、丢了的东西又拿出来、被抓了又自由行动。
2. 设定规则被破坏：世界观里定死的规则（能力上限、禁忌、地理）被随手打破。
3. 称谓与身份漂移：名字、称呼、职务、亲属关系前后不一致。
4. 已有事实被改写：前文确认过的事，这里给出另一个版本。
如果没有「已定稿事实」，就只依据角色档案与世界观判断，并说明依据。`,
    },
    {
      id: "pacing", name: "节奏诊断", group: "check", icon: "chart", output: "issue", max: 7,
      desc: "哪里拖沓、哪里赶戏、信息密度失衡",
      focus: `只评价节奏，不管文笔好坏：
1. 拖沓：连续多段没有新信息、没有冲突推进（补水词、复述已知、反复心理活动）。
2. 赶戏：重要转折一句话带过，读者来不及反应；或一章塞了太多事件。
3. 信息密度失衡：开头铺垫过久、结尾收得太急；对白段落连成一片没有停点。
4. 场景切换生硬：没有过渡就换场，读者要回头找位置。
每条要指出具体段落，并给出压缩或展开的方向。`,
    },
    {
      id: "threads", name: "伏笔呼应", group: "check", icon: "map", output: "issue", max: 7,
      desc: "该收未收、埋得太生硬、线索断掉",
      focus: `对照「未回收线索」清单检查本章：
1. 生硬埋设：伏笔直接说出来、解释一遍、生怕读者看不见。
2. 呼应缺失：本章提到前文线索却没有推进，或推进了却没有接住。
3. 断线：某条线索已连续多章未动，本章仍无提及（提示该捞起来了）。
4. 新坑无回收计划：本章新增的悬念，后文没有任何接续的余地。
若本章是收线章，反过来检查收得是否草率、代价是否足够。`,
    },
    {
      id: "motivation", name: "动机与选择", group: "check", icon: "users", output: "issue", max: 6,
      desc: "角色为什么这么做，这个选择有没有代价",
      focus: `只查人物行为是否立得住：
1. 无动机行动：角色做了某件重要的事，但读者看不出他为什么要做。
2. 性格不符：平时谨慎的人突然莽撞，冷酷的人突然心软，且没有触发事件。
3. 选择零代价：凡是选择都不痛不痒，角色没有失去任何东西。
4. 工具人化：配角只为主角提供信息或垫背，没有自己的目的。
每条要说明「按他的性格/处境，更可能怎么做」。`,
    },
    {
      id: "pov", name: "视角与信息", group: "check", icon: "eye", output: "issue", max: 6,
      desc: "视角漂移、上帝视角泄底、信息越界",
      focus: `检查叙事视角是否守纪律（以作品设定的视角为准，未设定按第三人称限知）：
1. 视角漂移：同一场戏里从 A 的内心跳到 B 的内心。
2. 越界泄底：限知视角写出了视角人物不可能知道的信息（他人心理、幕后真相）。
3. 摄像机型描写：镜头拉远描述主角看不见的场面。
4. 信息投喂：为了让读者明白，硬塞一段角色本不该想到的解释。`,
    },
    {
      id: "hook", name: "章末钩子", group: "check", icon: "flag", output: "issue", max: 5,
      desc: "结尾有没有拉力，是否断在无张力处",
      focus: `只看结尾 1/5 部分：
1. 收束太平：把冲突解决干净，读者没有翻下一页的理由。
2. 断点无力：断在抒情、总结、日常收尾处，而不是选择、危机、反转前一刻。
3. 硬留悬念：用突然出现的陌生人/电话/响声制造廉价钩子，与本章无关。
4. 钩子与下章蓝图不衔接（若已知下章蓝图）。
每条给一句可直接替换的结尾写法建议。`,
    },
    {
      id: "scene", name: "场景可视化", group: "check", icon: "bookOpen", output: "issue", max: 7,
      desc: "人物在真空里说话、缺少感官与动作",
      focus: `只查「读者能不能看见画面」：
1. 空白对白：连续多句引号，中间没有任何动作、神态、环境，像剧本。
2. 感官缺失：整场戏只有视觉，甚至没有视觉，只有概念和情绪词。
3. 空间不成立：不知道人物站在哪、距离多远、手在做什么。
4. 情绪直说：写「他很愤怒」而不是写他做了什么。
每条指出段落，并给一个具体可插入的画面细节。`,
    },

    /* ===== 纠错 ===== */
    {
      id: "proofread", name: "错字与病句", group: "fix", icon: "check", output: "issue", max: 15,
      desc: "错别字、多字漏字、的地得、标点、量词",
      focus: `逐句校对，只报「客观错误」，不评价风格：
1. 错别字、形近字误用、同音字误用。
2. 多字、漏字、语序颠倒、成分残缺。
3. 「的/地/得」「做/作」「那/哪」「以/已」等误用。
4. 标点：中英文标点混用、引号不配对、省略号写成六个点、逗号一逗到底。
5. 量词与搭配错误、朝代/称谓用词错误。
quote 必须是原文中错误的那一小段（含错误字符），fix 给出改好的写法。严重度一律 low 或 medium。`,
    },
    {
      id: "ai-tone", name: "AI 味检测", group: "fix", icon: "spark", output: "issue", max: 8,
      desc: "模板化排比、空泛总结、情绪直说、翻译腔",
      focus: `只找「读起来像机器写的」句子：
1. 三段式排比堆砌（不是…而是…／既…又…／仿佛…仿佛…）。
2. 空泛总结句：一段描写后紧跟一句抽象概括，把意思又说一遍。
3. 情绪直说：直接命名情绪（愤怒、悲伤、震惊），而不是呈现。
4. 翻译腔：的的不休、「作为一个…」「在…的过程中」「这使得」。
5. 万能形容词：深邃、复杂、莫名、无法言说、五味杂陈。
每条给出改写后的具体句子，不要只讲道理。`,
    },
    {
      id: "repetition", name: "重复与口头禅", group: "fix", icon: "refresh", output: "issue", max: 8,
      desc: "高频词、同义复用、句式雷同",
      focus: `统计并指出：
1. 同一段内重复出现的词（实词，尤其是形容词、动词、人名）。
2. 相邻句式雷同：连续几句都是「他+动词+了+宾语」。
3. 口头禅：某个词在全章高频出现（如「顿时」「缓缓」「不由得」）。
4. 同义反复：两个意思相同的词连用（如「更加愈发」「大约左右」）。
每条指出具体重复片段，并给出替换建议。`,
    },
    {
      id: "dialogue", name: "对话质感", group: "fix", icon: "doc", output: "issue", max: 7,
      desc: "所有人一个腔调、说明性对白、缺动作",
      focus: `只查对白：
1. 腔调同化：不同身份、年龄、教育程度的人说话方式一模一样。
2. 说明性对白：为了向读者解释设定，让人物说出本不必说的话。
3. 答非所问缺失：每句都严丝合缝地回答上一句，像审讯记录。
4. 缺动作与停顿：整段对白没有打断、抢话、沉默、动作。
每条指出是哪一句，并说明「这个人按身份更可能怎么说」。`,
    },

    /* ===== 打磨 ===== */
    {
      id: "style-coach", name: "文风教练", group: "craft", icon: "pen", output: "prose", max: 0,
      desc: "整体文笔诊断 + 三条可执行的改法",
      focus: `不要逐条挑错，做一次整体诊断。按以下结构输出 Markdown（不要 JSON）：
## 一句话判断
用一句话说清这章文字目前的水准和最大短板。
## 三个具体问题
每个问题引用原文一小段（用 > 引用），说清它为什么弱。
## 三条可执行改法
每条给出「改哪里 + 怎么改 + 改后示例」。
## 一处写得好
指出本章最值得保留的一处，说明理由，鼓励保持。`,
    },
    {
      id: "character-analysis", name: "角色弧检查", group: "craft", icon: "users", output: "prose", max: 0,
      desc: "本章主角有没有发生变化",
      focus: `按以下结构输出 Markdown（不要 JSON）：
## 本章的角色变化
主角在本章开始与结束时，处境、认知、关系分别有什么不同。如果没有变化，直接说没有。
## 动机链
把主角本章的每个关键选择列出来，标注每个选择的代价。
## 配角功能
本章出现的配角各自承担什么作用，有没有沦为工具人。
## 一个建议
给一个能让角色弧更完整的具体改动。`,
    },
    {
      id: "brainstorm", name: "卡文破局", group: "idea", icon: "bolt", output: "prose", max: 0,
      desc: "下一步往哪走，给五个方向",
      focus: `根据本章结尾和后续蓝图，给 5 个不同的下一步走向。输出 Markdown（不要 JSON）：
每个方向包含：
### 方向N：一句话标题
- 会发生什么（80 字内）
- 代价 / 风险
- 与前文伏笔的接口（能接上哪条线索）
- 适合的读者爽点
最后用一行给出「如果只能选一个，我推荐 N，因为…」。`,
    },

    /* ===== 章纲 ===== */
    {
      id: "blueprint-breakdown", name: "拆本章节拍", group: "plan", icon: "map", output: "blueprint", max: 0,
      desc: "把本章蓝图拆成可勾选的节拍、待埋伏笔、张力值",
      focus: `把本章蓝图拆成可执行的写作清单。只输出一个 JSON 对象，不要任何解释：
{
  "beats": ["开场：…", "推进：…", "转折：…", "收束：…"],
  "plantThreads": ["本章要埋下的伏笔，一句话一条"],
  "payoffThreads": ["本章要回收/推进的旧线索，一句话一条"],
  "tension": 1到5的整数,
  "targetWords": 建议字数（整数）,
  "hook": "章末钩子，一句话"
}
beats 要 4-7 条，每条是一个具体的场景动作（谁在哪做什么，遇到什么阻力），不要写成抽象概括。
plantThreads 最多 3 条，payoffThreads 最多 3 条，判断依据是「未回收线索」清单和本章目的。
tension 是本章整体张力：1 平缓日常，3 有冲突，5 生死关头。`,
    },
  ];

  /* ---------------- 状态 ---------------- */
  let state = { disabled: [], overrides: {}, custom: [], pos: null };

  function load() {
    try {
      const raw = DB.kvGet(KEY, null);
      return raw;
    } catch (e) { return null; }
  }

  async function init() {
    const s = await DB.kvGet(KEY, null);
    if (s && typeof s === "object") {
      state.disabled = Array.isArray(s.disabled) ? s.disabled : [];
      state.overrides = s.overrides && typeof s.overrides === "object" ? s.overrides : {};
      state.custom = Array.isArray(s.custom) ? s.custom : [];
    }
    return state;
  }

  function save() { DB.kvSet(KEY, state); }

  function all() {
    const merged = [...BUILTIN, ...state.custom.map(c => ({ ...c, custom: true }))];
    return merged.map(s => ({
      ...s,
      enabled: !state.disabled.includes(s.id),
      edited: Object.prototype.hasOwnProperty.call(state.overrides, s.id),
      focus: state.overrides[s.id] != null ? state.overrides[s.id] : s.focus,
      builtinFocus: s.focus,
    }));
  }
  function get(id) { return all().find(s => s.id === id); }
  function enabled() { return all().filter(s => s.enabled); }
  function byGroup() {
    const out = {};
    all().forEach(s => { (out[s.group] = out[s.group] || []).push(s); });
    return out;
  }

  function setEnabled(id, on) {
    const i = state.disabled.indexOf(id);
    if (on && i >= 0) state.disabled.splice(i, 1);
    if (!on && i < 0) state.disabled.push(id);
    save();
  }
  function setFocus(id, text) {
    if (text == null || !text.trim()) delete state.overrides[id];
    else state.overrides[id] = text;
    save();
  }
  function addCustom(def) {
    const id = "u-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    state.custom.push({
      id, name: def.name || "自定义技能", group: def.group || "check",
      icon: def.icon || "spark", output: def.output || "issue", max: 8,
      desc: def.desc || "", focus: def.focus || "", custom: true,
    });
    save();
    return id;
  }
  function removeCustom(id) {
    state.custom = state.custom.filter(c => c.id !== id);
    state.disabled = state.disabled.filter(x => x !== id);
    delete state.overrides[id];
    save();
  }
  function resetAll() {
    state.disabled = []; state.overrides = {};
    save();
  }

  /* ---------------- 上下文组装 ---------------- */
  function blueprintOf(n, num) { return (n.blueprints || []).find(b => b.chapterNumber === num) || null; }
  function chapterOf(n, num) { return (n.chapters || []).find(c => c.chapterNumber === num) || null; }

  function blueText(b) {
    if (!b) return "（本章还没有蓝图）";
    const bits = [`第${b.chapterNumber}章 ${b.title || ""}`];
    if (b.purpose) bits.push(`目的：${b.purpose}`);
    if (b.keyEvents) bits.push(`关键事件：${b.keyEvents}`);
    if (b.suspenseHook || b.hook) bits.push(`章末钩子：${b.suspenseHook || b.hook}`);
    if (Array.isArray(b.beats) && b.beats.length) bits.push(`已有节拍：\n${b.beats.map((x, i) => `${i + 1}. ${x.text || x}`).join("\n")}`);
    if (Array.isArray(b.characters) && b.characters.length) bits.push(`出场：${b.characters.join("、")}`);
    return bits.join("\n");
  }

  function threadsText(n) {
    const open = (n.threads || []).filter(t => t.status !== "已收");
    if (!open.length) return "（未回收线索清单为空）";
    const lastNum = Math.max(0, ...(n.chapters || []).filter(c => c.content).map(c => c.chapterNumber));
    return open.map(t => {
      const d = Math.max(0, lastNum - (t.lastMovedAt || t.plantedAt || 0));
      return `- ${t.thread}（${t.status || "已埋"}，第${t.plantedAt || "?"}章埋下，已 ${d} 章未推进）`;
    }).join("\n");
  }

  function prevTail(n, num) {
    const prev = (n.chapters || [])
      .filter(c => c.content && c.chapterNumber < num)
      .sort((a, b) => a.chapterNumber - b.chapterNumber).pop();
    if (!prev) return "（这是开篇，没有上一章）";
    const tail = prev.content.slice(-400);
    return `第${prev.chapterNumber}章《${prev.title || ""}》结尾：\n…${tail}`;
  }

  function buildMessages(skill, n, num) {
    const c = chapterOf(n, num);
    const b = blueprintOf(n, num);
    const draft = (c && c.content || "").trim();
    const system = [
      "你是中文长篇小说的责任编辑，擅长挑毛病而不是夸奖。",
      "你的输出会被作者直接用来改稿，所以必须具体、可执行、可核对。",
      "规则：",
      "1. 只针对给出的正文文字判断，不臆测没写到的情节。",
      "2. 引用原文时必须逐字照抄，长度 6-40 字，能在正文里找到。",
      "3. 拿不准就把严重度降一档，绝不编造问题凑数。",
      "4. 不要夸奖，不要总结全文，不要复述任务要求。",
      skill.output === "issue"
        ? "5. 只输出 JSON 数组，不要代码块之外的任何文字。字段：severity(high|medium|low)、dimension(维度名)、quote(原文片段)、comment(问题)、fix(怎么改)。"
        : "5. 按要求的 Markdown 结构输出，不要输出 JSON，不要加开场白。",
    ].join("\n");

    const parts = [
      `<作品设定>\n${typeof serializeConfig === "function" ? serializeConfig(n) : n.name}\n</作品设定>`,
      `<角色档案>\n${typeof serializeCharacters === "function" ? serializeCharacters(n.characters) : "（无）"}\n</角色档案>`,
      `<本章蓝图>\n${blueText(b)}\n</本章蓝图>`,
      `<上一章结尾>\n${prevTail(n, num)}\n</上一章结尾>`,
    ];
    if (n.facts && n.facts.length) parts.push(`<已定稿事实>\n${factsText(n)}\n</已定稿事实>`);
    if (typeof charsStateText === "function" && (n.characters || []).some(ch => charStateLine(ch))) {
      parts.push(`<角色当前状态>\n${charsStateText(n)}\n</角色当前状态>`);
    }
    parts.push(`<未回收线索>\n${threadsText(n)}\n</未回收线索>`);
    parts.push(`<正文>\n${draft || "（本章还没写内容）"}\n</正文>`);
    parts.push(`<本次检查重点>\n${skill.focus}\n</本次检查重点>`);

    if (skill.output === "issue") {
      parts.push(`最多输出 ${skill.max || 8} 条；没有问题就输出 []。按严重度从高到低排列。`);
    }
    return [{ role: "system", content: system }, { role: "user", content: parts.join("\n\n") }];
  }

  /* ---------------- 结果归一化 ---------------- */
  const SEV = ["high", "medium", "low"];
  function normIssue(r) {
    const sev = SEV.includes(r.severity) ? r.severity : (r.severity === "严重" ? "high" : r.severity === "低" ? "low" : "medium");
    return {
      severity: sev,
      dimension: String(r.dimension || r.category || "问题").slice(0, 20),
      quote: String(r.quote || r.original || "").trim(),
      comment: String(r.comment || r.issue || r.problem || "").trim(),
      fix: String(r.fix || r.suggestion || "").trim(),
    };
  }
  function normIssueList(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(normIssue)
      .filter(x => x.comment)
      .map(x => ({ ...x, _score: x.severity === "high" ? 3 : x.severity === "medium" ? 2 : 1 }))
      .sort((a, b) => b._score - a._score);
  }

  /* ---------------- 运行 ---------------- */
  async function run(skillId, n, num, onDelta) {
    const skill = get(skillId);
    if (!skill) throw new Error("技能不存在");
    if (typeof ensureModel === "function" && !ensureModel("review")) throw new Error("未配置模型");
    const messages = buildMessages(skill, n, num);
    const c = chapterOf(n, num);
    const hasDraft = c && (c.content || "").trim();
    const needsDraft = skill.output !== "blueprint";
    if (needsDraft && !hasDraft) throw new Error("本章还没有正文，先写点内容再检查");

    const text = await runAI(`技能 · ${skill.name}`, "review", messages, onDelta ? { onDelta } : {});
    if (skill.output === "issue") {
      const arr = LLM.extractJSON(text);
      return { kind: "issue", items: normIssueList(arr), text };
    }
    if (skill.output === "blueprint") {
      const obj = LLM.extractJSON(text);
      return { kind: "blueprint", data: obj, text };
    }
    return { kind: "prose", text: text.trim() };
  }

  window.Skills = {
    GROUPS, init, all, get, enabled, byGroup,
    setEnabled, setFocus, addCustom, removeCustom, resetAll,
    run, buildMessages, blueText, threadsText,
  };
})();
