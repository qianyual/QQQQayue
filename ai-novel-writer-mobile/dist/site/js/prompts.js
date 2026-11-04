/* ============================================================
 * 书童移动版 — Prompt 模板体系
 * 仿照桌面版 src/services/builtin-prompt-templates.ts 的三级模板
 * 思想：{{变量}} 插值 + 系统合同（输出格式约束）不可编辑。
 * ============================================================ */
"use strict";

const SYSTEM_CONTRACT = [
  "你是一位资深中文长篇小说写作助手。",
  "规则：",
  "1. 只输出被要求的内容，不要输出解释、前言、致歉或重复指令。",
  "2. 内容必须与给定的人物、世界观、前情保持一致，不得擅自增加主线设定。",
  "3. 使用给定作品设定的写作语言与文风。",
  "4. 需要输出 JSON 时，输出裸 JSON（不带 ``` 代码块标记、不带注释）。",
].join("\n");

const T = {
  /* ---------- 设定（NovelConfig 逐字段生成） ---------- */
  infer_novel_config: {
    system: SYSTEM_CONTRACT,
    task: `根据作者的一句话构想，为长篇小说补全创作设定。作者构想：
<idea>{{idea}}</idea>

输出 JSON（字段值用中文，totalChapters 为 20-300 的整数，wordsPerChapter 为 1000-6000 的整数）：
{
 "name": "书名（简短有辨识度）",
 "genre": "题材，如 都市、玄幻、悬疑、科幻、历史、言情",
 "subGenre": "细分题材",
 "targetAudience": "目标读者",
 "totalChapters": 100,
 "wordsPerChapter": 2500,
 "plotStructure": "one of: three_act | heros_journey | save_the_cat | kishotenketsu | multi_thread | freeform",
 "narrativePOV": "one of: third_limited | first_person | third_omniscient | multi_pov",
 "coreOutline": "一句话故事前提（50-120字）",
 "worldSetting": "世界观概述（150-300字）",
 "goldenFinger": "主角的金手指/核心优势（50-150字）",
 "protagonistProfile": "主角小传（80-200字）",
 "writingStyle": "文风要求（30-80字）",
 "globalGuidance": "全局写作指导（30-80字）"
}`,
    vars: ["idea"],
  },

  /* ---------- 架构四节 ---------- */
  premise: {
    system: SYSTEM_CONTRACT,
    task: `基于以下作品设定，撰写【故事前提】：把设定中的构想扩展为 300-600 字的故事梗概，写清主角起点、核心冲突、金手指如何介入、故事的走向与情感底色。

<设定>
{{config}}
</设定>`,
    vars: ["config"],
  },
  character_dynamics: {
    system: SYSTEM_CONTRACT,
    task: `基于以下作品设定与故事前提，设计主要角色名单（4-8人，含主角）。输出 JSON 数组：
[{
 "name":"姓名","role":"protagonist|supporting|antagonist|minor","gender":"","age":"",
 "appearance":"外貌 20-60字","personality":"性格 30-80字","background":"背景 50-150字",
 "abilities":"能力/特长","motivation":"核心动机 20-60字","relationships":"与其他角色的关系（写明对方姓名）",
 "arc":"角色成长弧线 30-80字"
}]

<设定>
{{config}}
</设定>

<故事前提>
{{premise}}
</故事前提>`,
    vars: ["config", "premise"],
  },
  world_building: {
    system: SYSTEM_CONTRACT,
    task: `基于以下作品设定，撰写详细【世界观设定】500-1200 字：时代与地理、力量/规则体系、社会结构与组织、关键势力、主角所处位置。用小标题分节。只输出正文。

<设定>
{{config}}
</设定>`,
    vars: ["config"],
  },
  synopsis: {
    system: SYSTEM_CONTRACT,
    task: `基于设定、世界观与角色，撰写全书【情节大纲】。总章数 {{totalChapters}} 章。按幕/阶段划分（如起承转合或三幕），每个阶段给出：章节范围、阶段目标、关键事件、转折点、该阶段结束时主角处境与主要伏笔。600-1500 字。只输出大纲正文。

<设定>
{{config}}
</设定>

<世界观>
{{world}}
</世界观>

<角色>
{{characters}}
</角色>`,
    vars: ["config", "world", "characters", "totalChapters"],
  },

  /* ---------- 章节蓝图 ---------- */
  chapter_blueprint: {
    system: SYSTEM_CONTRACT,
    task: `基于作品设定与情节大纲，为第 {{from}} 章到第 {{to}} 章设计章节蓝图。共需输出 {{count}} 个对象，按章节顺序排列。输出 JSON 数组：
[{
 "chapterNumber": {{from}},
 "title": "章节标题（6-14字）",
 "purpose": "本章在全书中的作用 30-80字",
 "keyEvents": "本章关键事件与冲突转折 80-250字",
 "characters": ["出场角色姓名"],
 "suspenseHook": "章末悬念钩子 20-60字"
}]

<设定>
{{config}}
</设定>

<角色名单>
{{characters}}
</角色名单>

<情节大纲>
{{synopsis}}
</情节大纲>
{{extraContext}}`,
    vars: ["from", "to", "count", "config", "characters", "synopsis", "extraContext"],
  },

  /* ---------- 正文草稿 ---------- */
  chapter_draft: {
    system: SYSTEM_CONTRACT,
    task: `为本书创作第 {{chapterNumber}} 章正文。要求：约 {{wordsPerChapter}} 字；直接以正文开始，不要写章节标题、序号或任何说明文字。

<作品设定与文风>
{{config}}
</作品设定>

<全书情节大纲>
{{synopsis}}
</全书情节大纲>

<出场角色档案>
{{characters}}
</出场角色档案>
{{continuity}}
<本章蓝图>
{{blueprint}}
</本章蓝图>
{{future}}
<前情摘要>
{{summary}}
</前情摘要>

<上一章结尾>
{{previousEnding}}
</上一章结尾>`,
    vars: ["chapterNumber", "wordsPerChapter", "config", "synopsis", "characters", "continuity", "blueprint", "future", "summary", "previousEnding"],
  },

  /* ---------- 选中文本编辑 ---------- */
  edit_selected_text: {
    system: SYSTEM_CONTRACT,
    task: `对选中的小说片段执行操作：{{operation}}。要求：保持与上下文一致的人称、时态与文风{{styleHint}}。只输出改写后的文字，不要解释。

<选中的片段>
{{selection}}
</选中的片段>`,
    vars: ["operation", "selection", "styleHint"],
  },

  /* ---------- 审稿 ---------- */
  consistency_check: {
    system: SYSTEM_CONTRACT,
    task: `你是严格的责任编辑。请审阅本章草稿，从以下维度检查：1)与设定/世界观矛盾 2)人物性格或称谓不一致 3)情节逻辑与因果 4)节奏与注水 5)文字质量与 AI 腔。输出 JSON 数组（没有问题就输出 []），每条：
[{"severity":"high|medium|low","dimension":"维度","quote":"原文摘录(20字内)","comment":"问题与修改建议 40-120字"}]

<作品设定>
{{config}}
</作品设定>

<本章蓝图>
{{blueprint}}
</本章蓝图>

<前情摘要>
{{summary}}
</前情摘要>

<章节草稿>
{{draft}}
</章节草稿>`,
    vars: ["config", "blueprint", "summary", "draft"],
  },

  /* ---------- 审稿（四维结构化，对应桌面版 reviewDimensions） ---------- */
  review_chapter: {
    system: SYSTEM_CONTRACT,
    task: `你是严格的责任编辑。只从以下四个维度审阅本章草稿：
1. 剧情连贯性 —— 与前面章节、已定稿事实是否接得上
2. 剧情合理性 —— 因果链、人物动机、逻辑是否成立
3. 角色状态 —— 位置、伤势、持有物品、心理状态是否与前文一致
4. 前后章节串联 —— 是否接住上一章的钩子、是否为下一章留好接口

输出 JSON 数组（确实没有问题时输出 []），每条：
[{"dimension":"剧情连贯性|剧情合理性|角色状态|前后章节串联","severity":"high|medium|low","quote":"原文摘录(20字内)","comment":"问题与具体修改建议 40-120字"}]

<作品设定>
{{config}}
</作品设定>

<已定稿事实>
{{facts}}
</已定稿事实>

<本章蓝图>
{{blueprint}}
</本章蓝图>

<前情摘要>
{{summary}}
</前情摘要>

<章节草稿>
{{draft}}
</章节草稿>`,
    vars: ["config", "facts", "blueprint", "summary", "draft"],
  },

  /* ---------- 按勾选意见修稿（只改被采纳的部分） ---------- */
  refine_from_review: {
    system: SYSTEM_CONTRACT,
    task: `根据作者勾选采纳的审稿意见重写本章。硬性要求：
1. 只针对下列意见做修改，未被指出的段落尽量保持原样（可做必要的衔接收尾）。
2. 不要改变本章蓝图规定的关键事件与章末钩子。
3. 篇幅与原稿相当（±15%）。
4. 只输出修改后的完整正文，不要标题、不要说明、不要逐条回复意见。

<本章蓝图>
{{blueprint}}
</本章蓝图>

<作者采纳的审稿意见>
{{review}}
</作者采纳的审稿意见>

<额外指导>
{{guidance}}
</额外指导>

<原稿>
{{draft}}
</原稿>`,
    vars: ["blueprint", "review", "guidance", "draft"],
  },

  /* ---------- 修稿后复验（对应桌面版合并后自动复验） ---------- */
  recheck_review: {
    system: SYSTEM_CONTRACT,
    task: `下面给出了若干条审稿意见，以及按这些意见修改后的新稿。请逐条判断每条意见是否已被真正解决。

输出 JSON 数组，顺序与输入意见一致：
[{"index":1,"resolved":true,"note":"若未解决，说明还差什么 20-60字；已解决则填空字符串"}]

<审稿意见>
{{review}}
</审稿意见>

<修改后的稿件>
{{draft}}
</修改后的稿件>`,
    vars: ["review", "draft"],
  },

  /* ---------- 连续性事实抽取（定稿后沉淀，供后续预检与召回） ---------- */
  extract_facts: {
    system: SYSTEM_CONTRACT,
    task: `从本章定稿正文中抽取「连续性事实」，供后续章节做一致性检查。只抽取文中明确写出的事实，不要推测。

输出 JSON：
{
 "characterStates":[{"name":"角色名","location":"所在位置","condition":"身体/伤势状态","mental":"心理状态","items":"关键持有物","recent":"本章经历的关键事件"}],
 "timeline":"本章故事内时间（如：第三日傍晚；无法判断写'未明确'）",
 "openThreads":[{"thread":"尚未收束的线索/悬念","status":"已埋|推进中"}],
 "plotFacts":["其他必须记住的情节事实，每条 20 字内"]
}
只输出 JSON。

<本章正文>
{{draft}}
</本章正文>`,
    vars: ["draft"],
  },

  /* ---------- 写前一致性预检（对应桌面版 consistency-preflight） ---------- */
  preflight: {
    system: SYSTEM_CONTRACT,
    task: `在正式写第 {{chapterNumber}} 章之前，检查本章蓝图与既有事实是否存在冲突。

输出 JSON：
{"risks":[{"level":"high|medium|low","conflict":"冲突点 20-40字","suggestion":"怎么处理 20-60字"}],"verdict":"pass|caution"}

只检查真实冲突：人物不该出现却出现、位置/时间矛盾、已死或已失去的能力又被使用、已收束的线索被重复使用等。没有冲突就输出 {"risks":[],"verdict":"pass"}。

<已定稿事实>
{{facts}}
</已定稿事实>

<角色当前状态>
{{characters}}
</角色当前状态>

<下一章蓝图>
{{blueprint}}
</下一章蓝图>`,
    vars: ["chapterNumber", "facts", "characters", "blueprint"],
  },

  /* ---------- 从架构文本抽取角色（角色卡 AI 导入） ---------- */
  extract_characters: {
    system: SYSTEM_CONTRACT,
    task: `从以下作品设定与角色名单文本中，抽取结构化角色档案。已在现有名单中的角色可以补全字段，但不要重名重复。

输出 JSON 数组：
[{"name":"姓名","role":"protagonist|supporting|antagonist|minor","gender":"","age":"","appearance":"外貌 20-60字","personality":"性格 30-80字","background":"背景 40-120字","abilities":"能力/特长","motivation":"核心动机 20-60字","relationships":"与其他角色的关系（写明对方姓名）","arc":"成长弧线 30-80字"}]

<现有角色姓名>
{{existing}}
</现有角色姓名>

<设定>
{{config}}
</设定>

<架构文本>
{{text}}
</架构文本>`,
    vars: ["existing", "config", "text"],
  },

  /* ---------- 定稿后更新角色当前状态 ---------- */
  update_states: {
    system: SYSTEM_CONTRACT,
    task: `本章已定稿。请根据正文更新相关角色的「当前状态」，只改发生变化的部分。

输出 JSON 数组（只列有变化的角色）：
[{"name":"角色名","location":"","condition":"","mental":"","items":"","recent":"本章经历 20-40字"}]

<角色当前状态>
{{characters}}
</角色当前状态>

<本章正文>
{{draft}}
</本章正文>`,
    vars: ["characters", "draft"],
  },

  /* ---------- 伏笔线索盘点 ---------- */
  extract_threads: {
    system: SYSTEM_CONTRACT,
    task: `盘点本章涉及的伏笔线索。对每条已有线索判断本章是「推进了」还是「没动」，并指出本章新埋的线索。

输出 JSON：
{"existing":[{"id":"线索编号","advanced":true,"note":"本章怎么推进的 15-40字"}],"new":[{"thread":"新线索描述 15-40字","status":"已埋|推进中"}]}
只输出 JSON。

<现有线索>
{{threads}}
</现有线索>

<本章正文>
{{draft}}
</本章正文>`,
    vars: ["threads", "draft"],
  },

  /* ---------- 修稿 ---------- */
  refine_chapter: {
    system: SYSTEM_CONTRACT,
    task: `根据审稿意见与作者指导，重写本章草稿。要求：采纳意见中合理部分，保持未受批评部分的连续性，篇幅与原稿相当。只输出修改后的完整正文，不要标题与说明。

<本章蓝图>
{{blueprint}}
</本章蓝图>

<审稿意见>
{{review}}
</审稿意见>

<作者指导>
{{guidance}}
</作者指导>

<原稿>
{{draft}}
</原稿>`,
    vars: ["blueprint", "review", "guidance", "draft"],
  },

  /* ---------- 章节要点（前情摘要） ---------- */
  chapter_notes: {
    system: SYSTEM_CONTRACT,
    task: `用 120-200 字概括本章发生的关键事件、人物状态变化、新出现的伏笔。只输出摘要正文。写作时会把这段作为"前情摘要"传给后续章节。

<本章正文>
{{draft}}
</本章正文>`,
    vars: ["draft"],
  },

  /* ---------- 导入原稿推断设定 ---------- */
  import_infer: {
    system: SYSTEM_CONTRACT,
    task: `以下是小说开头若干章。请推断其创作设定，输出 JSON：
{"name":"书名(若可判断，否则起名)","genre":"","subGenre":"","targetAudience":"","totalChapters":100,"wordsPerChapter":2500,"plotStructure":"three_act","narrativePOV":"third_limited","coreOutline":"从已有内容推断的故事前提","worldSetting":"世界观","goldenFinger":"金手指(若无写'暂无')","protagonistProfile":"","writingStyle":"模仿其文风的写作指令","globalGuidance":""}

<小说开头>
{{text}}
</小说开头>`,
    vars: ["text"],
  },

  /* ---------- 拆书：文风分析 ---------- */
  analyze_writing_style: {
    system: SYSTEM_CONTRACT,
    task: `你是小说文风分析师。分析以下样章，输出一份可执行的【文风报告】（400-800字），供另一个 AI 仿写时作为硬约束。必须包含：
1. 叙事视角与人称习惯；
2. 句式特征（长短句比例、常用句式、段落长度）；
3. 对话与叙述的比例及对话风格（口语化程度、语气词、提示语位置）；
4. 描写偏好（环境/心理/动作描写占比与手法）；
5. 用词与节奏特征（高频词汇类型、章内节奏、爽点/情绪点如何安排）；
6. "去 AI 味"要点：这份文风里哪些特征最容易被 AI 写丢，逐条列为写作指令。
只输出报告正文。

<样章>
{{sample}}
</样章>`,
    vars: ["sample"],
  },

  /* ---------- 拆书：结构拆解 ---------- */
  deconstruct_structure: {
    system: SYSTEM_CONTRACT,
    task: `你是小说结构分析师。基于作品设定与章节概览，输出【结构拆解报告】（400-900字）：
1. 整体结构（属于什么结构模型、分几个阶段、各阶段章节占比）；
2. 单章模板（一章内部通常怎么组织：开场承接、冲突推进、转折点位置、章末钩子类型）；
3. 节奏规律（多少章一个小高潮、多少章一个大转折、日常与主线交替规律）；
4. 驱动方式（爽点驱动/悬念驱动/情感驱动，具体怎么落地）。
只输出报告正文。

<作品设定>
{{config}}
</作品设定>

<章节概览>
{{chapterBriefs}}
</章节概览>`,
    vars: ["config", "chapterBriefs"],
  },

  /* ---------- 拆书：反推章节蓝图 ---------- */
  reverse_blueprint: {
    system: SYSTEM_CONTRACT,
    task: `基于章节概览，反推每章的结构化蓝图（供仿写参考其章法，不是抄袭情节）。逐章输出 JSON 数组：
[{"chapterNumber":1,"title":"章节主题概括","purpose":"该章在结构中的作用 20-60字","keyEvents":"事件推进模式概括（写'模式'而非具体情节，如'主角展示能力+引入对手'）30-120字","characters":["出场角色类型，如：主角/对手/盟友"],"suspenseHook":"章末钩子类型概括 15-40字"}]

<章节概览>
{{chapterBriefs}}
</章节概览>`,
    vars: ["chapterBriefs"],
  },

  /* ---------- 角色关系抽取（图谱用，对应桌面版 graph-generation 的关系图） ---------- */
  extract_relations: {
    system: SYSTEM_CONTRACT,
    task: `阅读角色档案，抽取出所有人物之间的**关系边**（双向只保留一条，写清方向与内容）。只输出 JSON 数组：
[{"a":"角色A的姓名","b":"角色B的姓名","relation":"关系内容 4-16字（如 师徒/青梅竹马/杀父之仇/上下级）","kind":"one of: kin|love|master|enemy|ally|serve|other","note":"这条关系当前的状态 10-30字"}]

要求：
- a、b 必须使用档案里出现的姓名原文；
- 只写档案中有依据的关系，不要臆造；
- 关系要有张力描述，不要只写"朋友"两个字。

<角色档案>
{{characters}}
</角色档案>`,
    vars: ["characters"],
  },
};

/* ---------- 模板元信息（供「提示词模板」编辑页分组显示） ---------- */
const PROMPT_META = {
  infer_novel_config: ["一句话生成设定", "设定"],
  premise: ["故事前提", "架构"],
  character_dynamics: ["角色动力关系", "架构"],
  world_building: ["世界观", "架构"],
  synopsis: ["故事梗概", "架构"],
  chapter_blueprint: ["分章蓝图", "蓝图"],
  chapter_draft: ["写正文", "正文"],
  edit_selected_text: ["编辑选中文本", "正文"],
  consistency_check: ["一致性检查", "正文"],
  review_chapter: ["审稿", "审稿"],
  refine_from_review: ["按意见修稿", "审稿"],
  recheck_review: ["合并后复验", "审稿"],
  refine_chapter: ["自由修稿", "审稿"],
  extract_facts: ["抽取连续性事实", "沉淀"],
  preflight: ["写前一致性预检", "沉淀"],
  extract_characters: ["抽取角色档案", "沉淀"],
  update_states: ["更新角色状态", "沉淀"],
  extract_threads: ["盘点伏笔线索", "沉淀"],
  chapter_notes: ["章节要点摘要", "沉淀"],
  extract_relations: ["角色关系抽取", "沉淀"],
  import_infer: ["拆书 · 逆向设定", "拆书"],
  analyze_writing_style: ["拆书 · 文风分析", "拆书"],
  deconstruct_structure: ["拆书 · 结构解构", "拆书"],
  reverse_blueprint: ["拆书 · 反推蓝图", "拆书"],
};

/* ---------- 模板覆盖（作者可改 task，内置版本永久保留） ---------- */
function applyPromptOverrides(map) {
  if (!map || typeof map !== "object") return;
  for (const [key, task] of Object.entries(map)) {
    if (!T[key] || typeof task !== "string" || !task.trim()) continue;
    if (!T[key].__builtin) T[key].__builtin = T[key].task;
    T[key].task = task;
  }
}
/** 列出全部模板（编辑页用） */
function promptList() {
  return Object.keys(T).map(key => ({
    key,
    name: (PROMPT_META[key] || [key])[0],
    group: (PROMPT_META[key] || ["", "其它"])[1],
    task: T[key].task,
    builtin: T[key].__builtin || T[key].task,
    edited: !!T[key].__builtin && T[key].__builtin !== T[key].task,
  }));
}
/** 恢复内置 */
function resetPrompt(key) {
  if (T[key] && T[key].__builtin) { T[key].task = T[key].__builtin; delete T[key].__builtin; }
}

/* ---------- 插值渲染 ---------- */
function renderPrompt(tpl, vars) {
  let text = tpl.task;
  for (const [k, v] of Object.entries(vars)) {
    text = text.split(`{{${k}}}`).join(v == null ? "" : String(v));
  }
  // 清掉未被替换的整段变量占位
  text = text.replace(/\n*<[a-zA-Z\u4e00-\u9fa5]+>\n*\{\{[a-zA-Z]+\}\}\n*<\/[a-zA-Z\u4e00-\u9fa5]+>/g, "\n");
  return text;
}

/* ---------- 数据 → 文本 的序列化工具 ---------- */
function serializeConfig(novel) {
  const c = novel.config || {};
  const structureNames = { three_act: "三幕结构", heros_journey: "英雄之旅", save_the_cat: "救猫咪", kishotenketsu: "起承转合", multi_thread: "多线叙事", freeform: "自由结构" };
  const povNames = { third_limited: "第三人称限知", first_person: "第一人称", third_omniscient: "第三人称全知", multi_pov: "多视角" };
  return [
    `书名：${novel.name}`,
    c.genre && `题材：${c.genre}${c.subGenre ? " / " + c.subGenre : ""}`,
    c.targetAudience && `目标读者：${c.targetAudience}`,
    c.totalChapters && `总章数：${c.totalChapters} 章，每章约 ${c.wordsPerChapter} 字`,
    c.plotStructure && `结构：${structureNames[c.plotStructure] || c.plotStructure}`,
    c.narrativePOV && `叙事视角：${povNames[c.narrativePOV] || c.narrativePOV}`,
    c.coreOutline && `故事前提：${c.coreOutline}`,
    c.worldSetting && `世界观：${c.worldSetting}`,
    c.goldenFinger && `金手指：${c.goldenFinger}`,
    c.protagonistProfile && `主角：${c.protagonistProfile}`,
    c.writingStyle && `文风：${c.writingStyle}`,
    c.globalGuidance && `全局指导：${c.globalGuidance}`,
  ].filter(Boolean).join("\n");
}

function serializeCharacters(chars) {
  if (!chars || !chars.length) return "（暂无角色档案）";
  return chars.map(c => [
    `【${c.name}】(${ROLE_NAME[c.role] || c.role})`,
    c.gender && c.age ? `${c.gender}，${c.age}岁` : (c.gender || c.age || ""),
    c.appearance && `外貌：${c.appearance}`,
    c.personality && `性格：${c.personality}`,
    c.background && `背景：${c.background}`,
    c.abilities && `能力：${c.abilities}`,
    c.motivation && `动机：${c.motivation}`,
    c.relationships && `关系：${c.relationships}`,
    c.arc && `弧线：${c.arc}`,
    c.currentState && `当前状态：${c.currentState}`,
  ].filter(Boolean).join("\n")).join("\n\n");
}
const ROLE_NAME = { protagonist: "主角", supporting: "配角", antagonist: "反派", minor: "龙套" };
const STRUCTURE_NAMES = { three_act: "三幕结构", heros_journey: "英雄之旅", save_the_cat: "救猫咪", kishotenketsu: "起承转合", multi_thread: "多线叙事", freeform: "自由结构" };
const POV_NAMES = { third_limited: "第三人称限知", first_person: "第一人称", third_omniscient: "第三人称全知", multi_pov: "多视角" };
const PROVIDER_PRESETS = [
  { id: "deepseek", name: "DeepSeek", protocol: "openai", baseUrl: "https://api.deepseek.com", modelName: "deepseek-chat", keyHint: "sk-..." },
  { id: "siliconflow", name: "SiliconFlow 硅基流动", protocol: "openai", baseUrl: "https://api.siliconflow.cn/v1", modelName: "deepseek-ai/DeepSeek-V3", keyHint: "sk-..." },
  { id: "bigmodel", name: "BigModel 智谱", protocol: "openai", baseUrl: "https://open.bigmodel.cn/api/paas/v4", modelName: "glm-4-flash", keyHint: "..." },
  { id: "openai", name: "OpenAI", protocol: "openai", baseUrl: "https://api.openai.com/v1", modelName: "gpt-4o-mini", keyHint: "sk-..." },
  { id: "xai", name: "xAI Grok", protocol: "openai", baseUrl: "https://api.x.ai/v1", modelName: "grok-3-mini", keyHint: "xai-..." },
  { id: "gemini", name: "Google Gemini", protocol: "gemini", baseUrl: "https://generativelanguage.googleapis.com", modelName: "gemini-2.0-flash", keyHint: "AIza..." },
  { id: "ollama", name: "Ollama（本机）", protocol: "openai", baseUrl: "http://127.0.0.1:11434/v1", modelName: "qwen3:14b", keyHint: "可留空" },
  { id: "custom", name: "自定义（OpenAI 兼容）", protocol: "openai", baseUrl: "", modelName: "", keyHint: "" },
];
