// 纯函数评估模型 —— 从 demo 移植, 脱离 DOM, 后端可直接复用
// 所有能力分统一使用 1-5 量表

const ABILITIES = ["学习能力", "学习态度", "基础能力", "英语能力", "考试能力", "抗压能力"];

// 统一等级释义
const LEVEL_NAMES = { 1: "严重不足", 2: "差", 3: "合格", 4: "良好", 5: "优" };

// 学生多维能力评价准则 (全局通用, 跨科目) —— 1-5 分档描述
const ABILITY_CRITERIA = {
  "学习能力": {
    def: "接触新知识时，能否跟随教师讲解完成理解，并对知识进行迁移应用。",
    levels: {
      1: "完全听不懂：无法领会课堂讲授内容，基础概念难以接收，即便多次重复讲解仍不能理解核心逻辑，无法开展任何知识应用。",
      2: "差：勉强接收部分课堂信息，对知识点理解碎片化，需要大量额外辅导才能勉强看懂基础例题，自主运用知识存在明显障碍。",
      3: "合格：能够接受并且理解老师当堂教学的内容，可以独立完成和课堂例题高度相近的基础习题；题型发生小幅变化时容易思路受阻，很难自主延伸拓展。",
      4: "良好：可以举一应用一；听懂新知后，能够将课堂所学方法迁移运用到设问形式略有变化的同类题目中。",
      5: "优：具备自主探究归纳能力，能够依托一道典型题目自主钻研，总结提炼出该类题型通用解题模型，独立解决同类型多种变式题目。"
    }
  },
  "学习态度": {
    def: "学生课堂参与、作业完成、自主规划学习的主观投入状态。",
    levels: {
      1: "完全不参与：仅保证出勤，课堂全程不参与任何学习活动，不完成作业、不记录笔记，无主动学习行为。",
      2: "差：上课基本出勤，课堂参与度偏低，极少主动回应互动，不会主动向老师提问，笔记记录混乱、完整性差。",
      3: "合格：上课按时出勤，可以部分参与课堂活动，能够完成大部分作业。",
      4: "良好：课堂表现积极，能够和老师频繁交流互动；主动向教师提问，按时提交大部分作业。",
      5: "优：笔记条理清晰、重点完整；可以自主制定计划，主动对各科内容整理复习；善于借助老师指导，主动追求学业提升，向更高目标努力。"
    }
  },
  "基础能力": {
    def: "完成本门课程学习所需具备的前置课程知识与必备基础素养。",
    levels: {
      1: "基本都不达标：前置基础指标绝大多数无法达标，缺少开展本课程学习所需的必备知识。",
      2: "差：达标基础指标不足50%，较多前置知识存在明显缺口，学习新课持续受到基础短板制约。",
      3: "合格：勉强达到课程入门要求，约70%前置基础指标达标，存在部分知识漏洞，需要额外补基础才能跟上进度。",
      4: "良好：绝大多数前置基础指标全部达标，仅有少量细碎知识点存在薄弱之处，不影响主线内容学习。",
      5: "优：全部前置基础指标达标，基础扎实，能够顺畅衔接本课程所有教学内容。"
    }
  },
  "英语能力": {
    def: "结合雅思/托福官方分数、校内教师组织模考成绩，综合课堂听说读写实际英语运用水平，衡量满足课程学习所需的语言能力。以课程规定英语入门分数线为基准线。",
    levels: {
      1: "基础严重不足：语言成绩远低于课程入门标准；课堂几乎无法使用英语开展交流，难以读懂英文学习材料，无法跟上英文授课节奏。",
      2: "差：语言成绩低于课程入门标准；仅能进行极简单英文表达，阅读、听力障碍突出，理解英文教材与课堂指令存在较大困难。",
      3: "合格：达到课程学习入门基本语言要求；可以应对基础英文授课内容，能够读懂基础学习材料，完成简单英文交流与书面任务。",
      4: "良好：语言水平高于入门基准0.5档；可以流畅参与英文课堂讨论，独立阅读英文学习资料，能够熟练完成课程要求内各项英文作业。",
      5: "优：语言水平高于入门基准1档；英语综合运用能力突出，可自主研读拓展英文素材，能够自如开展深度英文交流与学术写作。"
    }
  },
  "考试能力": {
    def: "学生在正式考试环境中的心态调控、抗干扰能力与临场发挥水平。",
    levels: {
      1: "考试完全失常：受考场压力、环境干扰影响极大，心态失控，无法正常调动已掌握知识，考试成绩显著低于日常真实水平。",
      2: "勉强发挥部分实力：考场抗压偏弱，容易紧张分心，仅能勉强发挥出自身一部分真实水平，大量掌握的知识点难以正常输出。",
      3: "合格：具备基础考场抗干扰能力，心态稳定，考试中能够基本发挥自身真实学习水平，成绩和日常表现大体匹配。",
      4: "良好：临场状态较好，不易受外界干扰；在考试氛围下可以适度调动状态，最终成绩相比日常水平实现小幅提升。",
      5: "优：心理素质优秀，抗干扰能力强；能够充分调动自身状态，在考场上完全爆发个人潜力，最大化展现自身真实实力。"
    }
  },
  "抗压能力": {
    def: "面对多项任务、高强度学习负荷以及考前冲刺阶段的情绪管理、时间协调与自我调控能力。",
    levels: {
      1: "完全放弃：遭遇多任务叠加、考前高压阶段时直接摆烂放弃学习，无法启动学习计划，被压力完全困住，停止有效学习。",
      2: "情绪内耗严重：学习状态随情绪起伏，仅能间歇性学习；大部分时间陷入自我焦虑，难以稳定推进既定学习任务，任务推进严重滞后。",
      3: "合格：能够勉强调节自身情绪与时间分配，在多重任务压力下尽力协调各项学习安排，基本完成既定任务，但容易出现疲惫、节奏紧张的情况。",
      4: "良好：具备前瞻性调节意识，能够提前预判任务压力，主动规划时间、疏导情绪，有序推进多项学习任务，妥善应对考前冲刺压力。",
      5: "优：可以完美平衡高压下的多项学习任务，心态稳定；在完成规定任务之余，能够主动寻找额外练习巩固薄弱点，将压力转化为自我提升的动力。"
    }
  }
};

// 默认各科目 AP 预测公式 (管理员可在后台覆盖)
const DEFAULT_COURSE_FORMULAS = {
  "AP Calculus BC": { penaltyRates: [0.00, 0.20, 0.00, 0.00, 0.00, 0.00], boostFactor: 0.00, offset: -0.20, threshold: 3.0, hasSpecial: false },
  "AP Macroeconomics": { penaltyRates: [0.40, 0.00, 0.00, 0.20, 0.00, 0.00], boostFactor: 0.20, offset: 0.40, threshold: 3.0, hasSpecial: false },
  "AP Microeconomics": { penaltyRates: [0.00, 0.00, 0.00, 0.20, 0.60, 0.00], boostFactor: 0.00, offset: 0.00, threshold: 3.0, hasSpecial: false },
  "AP Physics C: Electricity & Magnetism": { penaltyRates: [0.60, 0.80, 0.00, 0.00, 0.00, 0.00], boostFactor: 0.00, offset: 0.00, threshold: 4.0, hasSpecial: false },
  "AP Physics C: Mechanics": { penaltyRates: [0.60, 0.80, 0.00, 0.00, 0.00, 0.00], boostFactor: 0.00, offset: 0.00, threshold: 4.0, hasSpecial: false },
  "AP Statistics": { penaltyRates: [0.00, 0.00, 0.00, 0.00, 0.40, 0.00], boostFactor: 0.00, offset: -0.20, threshold: 3.0, hasSpecial: false }
};

// 预测单个 (学生能力向量 1-5, 科目公式) -> 预测 AP 分
function predictAP(scores5, fmt) {
  fmt = fmt || DEFAULT_COURSE_FORMULAS["AP Physics C: Mechanics"];
  const PR = fmt.penaltyRates;
  const boostFactor = fmt.boostFactor || 0;
  const offset = fmt.offset || 0;
  const TH = fmt.threshold || 3.0;
  let base = 0;
  for (let i = 0; i < ABILITIES.length; i++) base += scores5[i];
  base = base / ABILITIES.length;
  const maxScore = Math.max.apply(null, scores5);
  const boostAmt = Math.min(boostFactor * Math.max(0, maxScore - base), 0.5);
  let penalty = 0;
  for (let i = 0; i < ABILITIES.length; i++) {
    if (scores5[i] < TH) penalty += (TH - scores5[i]) * PR[i];
  }
  const final = Math.max(1, Math.min(5, Math.round(base + boostAmt + offset - penalty)));
  return { base: base, boost: boostAmt, offset: offset, penalty: penalty, final: final };
}

function dist(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += Math.pow(a[i] - b[i], 2); return Math.sqrt(s); }
function distSq(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += Math.pow(a[i] - b[i], 2); return s; }

// K-Means 聚类 (data: [{vector:[...]}])
function kmeans(data, k, maxIter, restarts) {
  if (maxIter === undefined) maxIter = 100;
  if (restarts === undefined) restarts = 15;
  const n = data.length;
  if (n < k) return null;
  const d = data[0].vector.length;
  let best = { wcss: 1e100 };
  for (let run = 0; run < restarts; run++) {
    const centroids = []; const used = {};
    for (let i = 0; i < k; i++) { let idx; do { idx = Math.floor(Math.random() * n); } while (used[idx]); used[idx] = true; centroids.push(data[idx].vector.slice()); }
    const asgn = new Array(n).fill(-1);
    for (let iter = 0; iter < maxIter; iter++) {
      let changed = false;
      for (let i = 0; i < n; i++) {
        let md = 1e100, bc = 0;
        for (let j = 0; j < k; j++) { const dd = dist(data[i].vector, centroids[j]); if (dd < md) { md = dd; bc = j; } }
        if (asgn[i] !== bc) changed = true; asgn[i] = bc;
      }
      if (!changed) break;
      for (let j = 0; j < k; j++) {
        const mem = []; for (let i = 0; i < n; i++) { if (asgn[i] === j) mem.push(data[i].vector); }
        if (mem.length > 0) {
          centroids[j] = mem[0].slice();
          for (let dim = 0; dim < centroids[j].length; dim++) {
            let s = 0; for (let mi = 0; mi < mem.length; mi++) s += mem[mi][dim];
            centroids[j][dim] = s / mem.length;
          }
        }
      }
    }
    let wcss = 0;
    for (let i = 0; i < n; i++) wcss += distSq(data[i].vector, centroids[asgn[i]]);
    if (wcss < best.wcss) best = { assignments: asgn.slice(), centroids: centroids.map(c => c.slice()), wcss: wcss };
  }
  return best;
}

function genClusterName(centroid) {
  const idxs = centroid.map((v, i) => ({ i: i, v: v })).sort((a, b) => b.v - a.v);
  const avg = centroid.reduce((a, b) => a + b, 0) / centroid.length;
  const type = avg >= 4.0 ? "全能" : avg >= 3.0 ? "均衡" : "待发展";
  const gap = idxs[0].v - idxs[idxs.length - 1].v;
  const spec = gap > 1.5 ? "偏科型" : gap > 0.75 ? "倾向型" : "综合型";
  return type + "·" + spec + "（" + ABILITIES[idxs[0].i] + "突出）";
}

// 基于真实 AP 分的回归校准: 找最小化 |penalty - (base - actual)| 的权重
function computeRegression(points, subject) {
  let pts = points.filter(p => p.actual != null);
  if (subject) pts = pts.filter(p => p.subject === subject);
  if (pts.length < 5) return null;
  const shortfalls = [], penalties = [];
  for (const p of pts) {
    const s5 = p.vector;
    const base = s5.reduce((a, b) => a + b, 0) / ABILITIES.length;
    const targetPenalty = base - p.actual;
    if (targetPenalty <= 0) continue;
    const sf = ABILITIES.map((_, qi) => Math.max(0, 3 - s5[qi]));
    shortfalls.push(sf); penalties.push(targetPenalty);
  }
  if (shortfalls.length < 5) return null;
  const candidates = [0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50];
  function tryCombo(w) {
    let totalErr = 0;
    for (let pi = 0; pi < shortfalls.length; pi++) {
      let pred = 0;
      for (let qi = 0; qi < ABILITIES.length; qi++) pred += shortfalls[pi][qi] * w[qi];
      totalErr += Math.abs(pred - penalties[pi]);
    }
    return totalErr / shortfalls.length;
  }
  const current = [0, 0, 0, 0, 0, 0];
  for (let iter = 0; iter < 20; iter++) {
    for (let qi = 0; qi < ABILITIES.length; qi++) {
      let bestW = current[qi], bestLocal = tryCombo(current);
      for (const c of candidates) {
        const test = current.slice(); test[qi] = c;
        const err = tryCombo(test);
        if (err < bestLocal) { bestLocal = err; bestW = c; }
      }
      current[qi] = bestW;
    }
  }
  return { weights: current.slice(), mae: tryCombo(current), count: shortfalls.length, total: pts.length };
}

// 把 0..15624 的索引解码为 6 维能力向量 (每维 1-5)
function decodeAbility(idx) {
  return [
    (idx % 5) + 1,
    (Math.floor(idx / 5) % 5) + 1,
    (Math.floor(idx / 25) % 5) + 1,
    (Math.floor(idx / 125) % 5) + 1,
    (Math.floor(idx / 625) % 5) + 1,
    (Math.floor(idx / 3125) % 5) + 1
  ];
}

// 逆向能力推断
// 给定学生历史 (科目, 实际AP分) 序列, 反推最可能产生这些成绩的能力向量(1-5)
// pairs: [{subject, actual}]  actual 1-5 或 null(忽略)
// courseFormulas: 科目公式表
// prior: 可选, 老师手动能力均值 [6], 用于在数据不确定时保持连续性
// 做法: 在 5^6 = 15625 个候选能力向量中暴力搜索, 最小化 Σ(预测分 - 实际分)^2
function inferAbilities(pairs, courseFormulas, prior) {
  const valid = (pairs || []).filter(p => p && p.actual != null && courseFormulas[p.subject]);
  if (valid.length === 0) return null;
  const n = valid.length;
  // 每科预计算 15625 个候选的预测分, 避免重复计算
  const cache = {};
  for (const p of valid) {
    const fmt = courseFormulas[p.subject];
    const arr = new Array(15625);
    for (let idx = 0; idx < 15625; idx++) arr[idx] = predictAP(decodeAbility(idx), fmt).final;
    cache[p.subject] = arr;
  }
  let bestErr = Infinity, best = 0;
  const eps = 0.5, shortlist = []; // 容差内候选, 用于 tie-break
  for (let idx = 0; idx < 15625; idx++) {
    let err = 0;
    for (const p of valid) err += Math.pow(cache[p.subject][idx] - p.actual, 2);
    if (err < bestErr - 1e-9) { bestErr = err; best = idx; shortlist.length = 0; shortlist.push(idx); }
    else if (Math.abs(err - bestErr) <= eps) shortlist.push(idx);
  }
  // 在并列候选中选与 prior 距离最小者(无 prior 则选 L2 最小)
  let pick = best, pickScore = Infinity;
  for (const idx of shortlist) {
    const v = decodeAbility(idx);
    const d = prior
      ? Math.sqrt(v.reduce((s, val, i) => s + Math.pow(val - prior[i], 2), 0))
      : Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    if (d < pickScore) { pickScore = d; pick = idx; }
  }
  const abilities = decodeAbility(pick);
  const rmse = Math.sqrt(bestErr / n);
  const detail = valid.map(p => {
    const pred = cache[p.subject][pick];
    return { subject: p.subject, actual: p.actual, predicted: pred, err: Math.abs(pred - p.actual) };
  });
  const maxErr = Math.max.apply(null, detail.map(d => d.err));
  let note;
  if (n < 2) note = "样本仅 1 科, 推断不唯一, 仅供参考";
  else if (rmse <= 0.5) note = "模型可很好解释该生历史成绩";
  else if (rmse <= 1.0) note = "模型大体可解释, 个别科目存在偏差";
  else note = "偏差较大, 可能录入有误或模型对该生不适配";
  return { abilities, rmse: +rmse.toFixed(3), maxErr, n, detail, note, reliable: n >= 2 };
}

// 从 students 对象构建分析点 (vector 为 1-5 数组)
// year 指定时只取该学年记录; 不指定则兼容旧扁平结构
function buildPoints(students, filter, year) {
  filter = filter || {};
  const pts = [];
  for (const sn in students) {
    if (!students.hasOwnProperty(sn)) continue;
    if (filter.student && filter.student !== sn) continue;
    const subs = students[sn];
    for (const sj in subs) {
      if (!subs.hasOwnProperty(sj) || sj === "cls") continue;
      if (filter.subject && filter.subject !== sj) continue;
      const entry = year ? (subs[sj][year] || null) : subs[sj];
      if (!entry) continue;
      const vector = (entry.s && entry.s.length === ABILITIES.length) ? entry.s : null;
      if (!vector) continue;
      pts.push({ student: sn, subject: sj, vector: vector, actual: entry.a != null ? entry.a : null, scores5: vector });
    }
  }
  return pts;
}

module.exports = {
  ABILITIES,
  LEVEL_NAMES,
  ABILITY_CRITERIA,
  DEFAULT_COURSE_FORMULAS,
  predictAP,
  kmeans,
  genClusterName,
  computeRegression,
  buildPoints,
  inferAbilities,
  decodeAbility
};
