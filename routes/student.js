const express = require("express");
const router = express.Router();
const store = require("../lib/store");
const model = require("../lib/model");
const { requireStudent } = require("../middleware/auth");

router.use(requireStudent);

// 取学生某学年的数据 (year 指定)
function ownData(name, year) {
  const students = store.getStudents();
  const formulas = store.getModel().courseFormulas;
  const subs = students[name] || {};
  const subjects = Object.keys(subs).filter(k => k !== "cls").map(sj => {
    const entry = subs[sj][year];
    const scores = entry && entry.s ? entry.s : [];
    const pred = scores.length === 6 ? model.predictAP(scores, formulas[sj]).final : null;
    let weakest = null, strongest = null;
    if (scores.length === 6) {
      weakest = { index: 0, value: scores[0] }; strongest = { index: 0, value: scores[0] };
      for (let i = 1; i < scores.length; i++) {
        if (scores[i] < weakest.value) weakest = { index: i, value: scores[i] };
        if (scores[i] > strongest.value) strongest = { index: i, value: scores[i] };
      }
    }
    return {
      subject: sj, scores, actual: entry && entry.a != null ? entry.a : null, prediction: pred,
      weakest: weakest ? { ability: model.ABILITIES[weakest.index], value: weakest.value } : null,
      strongest: strongest ? { ability: model.ABILITIES[strongest.index], value: strongest.value } : null
    };
  });
  const avg = model.ABILITIES.map((_, i) => {
    const vals = subjects.map(s => s.scores[i]).filter(v => typeof v === "number");
    return vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : 0;
  });
  return { name, year, subjects, avg };
}

router.get("/", (req, res) => res.redirect("/student/dashboard"));

// 仪表盘(入口): 列出该生所有考试(科目), 每个考试给出六边形能力图案
router.get("/dashboard", (req, res) => {
  const year = store.getActiveYear();
  const data = ownData(req.session.user.studentName, year);
  res.render("student/dashboard", { user: req.session.user, abilities: store.getModel().abilities, data, year, active: "dashboard" });
});

// 个人能力画像: 选择科目 -> 显示该科目六边形
router.get("/ability", (req, res) => {
  const year = store.getActiveYear();
  const data = ownData(req.session.user.studentName, year);
  res.render("student/ability", { user: req.session.user, abilities: store.getModel().abilities, data, year, active: "ability" });
});

// 提升建议所需的模型计算(全部基于 lib/model 的 predictAP)
function planImprove(scores, fmt, target) {
  const PR = fmt.penaltyRates, TH = fmt.threshold || 3.0;
  const AB = model.ABILITIES;
  const cur = scores.slice();
  const plan = [];
  let guard = 0;
  while (model.predictAP(cur, fmt).final < target && guard < 40) {
    guard++;
    let bestI = -1, bestGain = -1;
    for (let i = 0; i < 6; i++) {
      if (cur[i] >= 5) continue;
      const gain = 1 / 6 + (cur[i] < TH ? PR[i] : 0);
      if (gain > bestGain) { bestGain = gain; bestI = i; }
    }
    if (bestI < 0) break;
    plan.push({ ability: AB[bestI], from: cur[bestI], to: cur[bestI] + 1, gain: +bestGain.toFixed(3) });
    cur[bestI] += 1;
  }
  return { targetVector: cur, plan, achievable: model.predictAP(cur, fmt).final >= target, newPredicted: model.predictAP(cur, fmt).final };
}

function perLevelMatrix(fmt) {
  const AB = model.ABILITIES, PR = fmt.penaltyRates, TH = fmt.threshold || 3.0;
  const starts = [1, 2, 3, 4]; // 1->2, 2->3, 3->4, 4->5
  const matrix = AB.map((_, i) => starts.map(s => +(1 / 6 + (s < TH ? PR[i] : 0)).toFixed(3)));
  return { bands: ["1→2", "2→3", "3→4", "4→5"], matrix };
}

// 提升建议计算接口(学生端交互用, 始终以 predictAP 为准)
router.get("/api/advice", (req, res) => {
  const name = req.session.user.studentName;
  const year = store.getActiveYear();
  const students = store.getStudents();
  const formulas = store.getModel().courseFormulas;
  const subs = students[name] || {};
  const avail = Object.keys(subs).filter(k => k !== "cls" && subs[k][year]);
  let subject = req.query.subject;
  if (!subject || !subs[subject] || !subs[subject][year]) subject = avail[0];
  if (!subject) return res.json({ ok: false, error: "暂无评分数据, 请联系老师录入。" });
  const entry = subs[subject][year];
  const scores = entry.s && entry.s.length === 6 ? entry.s : null;
  const fmt = formulas[subject];
  if (!scores || !fmt) return res.json({ ok: false, error: "数据不完整" });
  const target = parseInt(req.query.target, 10);
  const t = (target >= 1 && target <= 5) ? target : model.predictAP(scores, fmt).final;
  const TH = fmt.threshold || 3.0, PR = fmt.penaltyRates;
  const currentPredicted = model.predictAP(scores, fmt).final;
  const penalty = model.ABILITIES.map((a, i) => ({ ability: a, rate: PR[i] })).filter(x => x.rate > 0).sort((x, y) => y.rate - x.rate);
  const weights = model.ABILITIES.map((a, i) => ({ ability: a, base: +(1 / 6).toFixed(3), penaltySensitivity: PR[i], effective: +(1 / 6 + PR[i]).toFixed(3) })).sort((x, y) => y.effective - x.effective);
  const perLevel = perLevelMatrix(fmt);
  const plan = planImprove(scores, fmt, t);
  res.json({ ok: true, subject, threshold: TH, current: scores, currentPredicted, target: t, gap: t - currentPredicted, penalty, weights, perLevel, plan });
});

router.get("/profile", (req, res) => {
  const year = store.getActiveYear();
  const data = ownData(req.session.user.studentName, year);
  res.render("student/profile", { user: req.session.user, abilities: store.getModel().abilities, data, year });
});

router.get("/assessment", (req, res) => {
  const year = store.getActiveYear();
  const data = ownData(req.session.user.studentName, year);
  res.render("student/assessment", { user: req.session.user, abilities: store.getModel().abilities, data, year });
});

router.get("/advice", (req, res) => {
  const year = store.getActiveYear();
  const data = ownData(req.session.user.studentName, year);
  res.render("student/advice", { user: req.session.user, abilities: store.getModel().abilities, subjects: data.subjects.map(s => s.subject), year, active: "advice" });
});

router.get("/history", (req, res) => {
  const students = store.getStudents();
  const formulas = store.getModel().courseFormulas;
  const years = store.getYears().years;
  const subs = students[req.session.user.studentName] || {};
  const rows = [];
  for (const sj of Object.keys(subs).filter(k => k !== "cls")) {
    for (const y of years) {
      const e = subs[sj][y];
      if (e && e.a != null) {
        const pred = (e.s && e.s.length === 6) ? model.predictAP(e.s, formulas[sj]).final : null;
        rows.push({ year: y, subject: sj, actual: e.a, prediction: pred, scores: e.s || [] });
      }
    }
  }
  rows.sort((a, b) => (b.year < a.year ? -1 : b.year > a.year ? 1 : 0));
  res.render("student/history", { user: req.session.user, history: rows });
});

module.exports = router;
