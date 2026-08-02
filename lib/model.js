// 纯函数评估模型 —— 从 demo 移植, 脱离 DOM, 后端可直接复用
// 所有能力分统一使用 1-5 量表

const ABILITIES = ["学习能力", "学习态度", "基础能力", "英语能力", "考试能力", "抗压能力"];

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
  DEFAULT_COURSE_FORMULAS,
  predictAP,
  kmeans,
  genClusterName,
  computeRegression,
  buildPoints,
  inferAbilities,
  decodeAbility
};
