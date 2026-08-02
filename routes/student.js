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

router.get("/", (req, res) => res.redirect("/student/profile"));

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
  const formulas = store.getModel().courseFormulas;
  const advice = data.subjects.map(s => {
    if (!s.prediction) return { subject: s.subject, items: ["暂无足够评分"] };
    const fmt = formulas[s.subject];
    const TH = (fmt && fmt.threshold) || 3.0;
    const items = [];
    s.scores.forEach((v, i) => {
      if (v < TH) items.push("提升「" + model.ABILITIES[i] + "」(" + v + "分 < 合格线" + TH + ")");
    });
    if (s.prediction < 5 && s.weakest) items.unshift("优先补强「" + s.weakest.ability + "」(最弱 " + s.weakest.value + "分)");
    if (items.length === 0) items.push("各项均已达标, 保持即可");
    return { subject: s.subject, prediction: s.prediction, items };
  });
  res.render("student/advice", { user: req.session.user, data, advice, year });
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
