const express = require("express");
const router = express.Router();
const store = require("../lib/store");
const model = require("../lib/model");
const { requireRole } = require("../middleware/auth");

router.use(requireRole("admin"));

// 注入通用数据
function withCommon(req) {
  const m = store.getModel();
  const yi = store.getYears();
  return { user: req.session.user, model: m, abilities: m.abilities, courseNames: Object.keys(m.courseFormulas), years: yi.years, activeYear: yi.activeYear };
}

// ── 页面 ──
router.get("/", (req, res) => {
  const year = store.getActiveYear();
  const students = store.getStudents();
  const names = Object.keys(students);
  let totalSubjects = 0, totalScores = 0, withActual = 0;
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const n of names) {
    const subs = students[n];
    for (const sj in subs) {
      if (!subs.hasOwnProperty(sj) || sj === "cls") continue;
      const entry = subs[sj][year];
      if (!entry) continue;
      totalSubjects++;
      if (entry.s) {
        totalScores++;
        const p = model.predictAP(entry.s, store.getModel().courseFormulas[sj]);
        dist[p.final] = (dist[p.final] || 0) + 1;
        if (entry.a != null) withActual++;
      }
    }
  }
  res.render("admin/dashboard", Object.assign(withCommon(req), {
    stats: { students: names.length, totalSubjects, totalScores, withActual, dist },
    year
  }));
});

router.get("/students", (req, res) => {
  const students = store.getStudents();
  const users = store.getUsers().filter(u => u.role === "student");
  const year = store.getActiveYear();
  const rows = Object.keys(students).map(name => {
    const acct = users.find(u => u.studentName === name);
    const subs = students[name];
    let subjectCount = 0;
    for (const sj in subs) { if (sj === "cls") continue; if (subs[sj][year]) subjectCount++; }
    return { name, subjectCount, account: acct ? acct.username : null };
  });
  res.render("admin/students", Object.assign(withCommon(req), { rows }));
});

router.get("/scoring", (req, res) => res.render("admin/scoring", withCommon(req)));
router.get("/model", (req, res) => res.render("admin/model", withCommon(req)));
router.get("/calibration", (req, res) => res.render("admin/calibration", withCommon(req)));
router.get("/analytics", (req, res) => {
  const year = store.getActiveYear();
  res.render("admin/analytics", Object.assign(withCommon(req), { year }));
});
router.get("/ops", (req, res) => res.render("admin/ops", withCommon(req)));
router.get("/infer", (req, res) => res.render("admin/infer", withCommon(req)));

// 逆向能力推断辅助: 用学生某学年历史实际分反推能力向量, 并与老师手写均值对比
function computeInferred(name, year) {
  const students = store.getStudents();
  const subs = students[name];
  if (!subs) return null;
  const formulas = store.getModel().courseFormulas;
  const pairs = [], manualVectors = [];
  for (const sj in subs) {
    if (!subs.hasOwnProperty(sj) || sj === "cls" || sj === "inferred") continue;
    const e = year ? (subs[sj][year] || null) : null;
    if (!e) continue;
    if (e.a != null) pairs.push({ subject: sj, actual: e.a });
    if (e.s && e.s.length === 6) manualVectors.push(e.s);
  }
  if (manualVectors.length === 0) return { exists: false, reason: "该生本学年(" + year + ")无能力录入" };
  const manualProfile = [0, 0, 0, 0, 0, 0].map((_, i) =>
    Math.round(manualVectors.reduce((s, v) => s + v[i], 0) / manualVectors.length * 10) / 10);
  let inf, source;
  const infResult = model.inferAbilities(pairs, formulas, manualProfile);
  if (infResult) {
    inf = infResult; source = 'calibrated';
  } else {
    // 无任何实际 AP 分: 以能力评估均值为预测六维(未校准, 仅作预测, 不计入模型)
    inf = { abilities: manualProfile, rmse: null, n: 0, reliable: false,
            note: '本学年暂无实际 AP 分, 预测六维取自能力评估输入, 尚未计入模型校准' };
    source = 'assessment';
  }
  const predictedAll = Object.keys(subs).filter(k => k !== "cls" && k !== "inferred").map(sj => {
    const e = subs[sj][year];
    const predicted = (e && formulas[sj]) ? model.predictAP(inf.abilities, formulas[sj]).final : null;
    return {
      subject: sj,
      actual: e && e.a != null ? e.a : null,
      counted: !!(e && e.a != null),   // 只有实际 AP 分才计入模型校准
      predicted
    };
  });
  return { exists: true, name, year, inferred: inf, manualProfile, predictedAll, source, hasActual: pairs.length > 0 };
}

// ── API ──
router.get("/api/students", (req, res) => res.json({ ok: true, data: store.getStudentNames() }));
router.get("/api/students/detail", (req, res) => {
  const students = store.getStudents();
  const year = store.getActiveYear();
  const data = Object.keys(students).map(name => {
    const subs = students[name];
    let subjectCount = 0;
    for (const sj in subs) { if (sj === "cls") continue; if (subs[sj][year]) subjectCount++; }
    return { name, subjectCount };
  });
  res.json({ ok: true, data });
});
router.get("/api/accounts", (req, res) => {
  const data = store.getUsers().filter(u => u.role === "student").map(u => ({ username: u.username, studentName: u.studentName }));
  res.json({ ok: true, data });
});

router.post("/api/students", (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) return res.json({ ok: false, error: "姓名不能为空" });
  if (!store.addStudent(name)) return res.json({ ok: false, error: "已存在该学生" });
  res.json({ ok: true });
});

router.post("/api/students/delete", (req, res) => {
  store.removeStudent(req.body.name);
  res.json({ ok: true });
});

router.post("/api/students/rename", (req, res) => {
  const { oldName, newName } = req.body;
  if (!store.renameStudent(oldName, (newName || "").trim())) return res.json({ ok: false, error: "重命名失败" });
  res.json({ ok: true });
});

// 学生账号管理
router.post("/api/accounts", (req, res) => {
  const { username, password, studentName } = req.body;
  if (!username || !password) return res.json({ ok: false, error: "用户名和密码必填" });
  const hash = require("bcryptjs").hashSync(password, 10);
  if (!store.addUser({ username, passwordHash: hash, role: "student", studentName: studentName || null }))
    return res.json({ ok: false, error: "用户名已存在" });
  res.json({ ok: true });
});
router.post("/api/accounts/delete", (req, res) => { store.deleteUser(req.body.username); res.json({ ok: true }); });
router.post("/api/accounts/link", (req, res) => {
  store.updateUser(req.body.username, { studentName: req.body.studentName || null });
  res.json({ ok: true });
});

// 评分录入 (按学年)
router.get("/api/student/:name", (req, res) => {
  const year = req.query.year || store.getActiveYear();
  const subs = store.getStudents()[req.params.name];
  if (!subs) return res.json({ ok: false, error: "无该学生" });
  const formulas = store.getModel().courseFormulas;
  const rows = Object.keys(subs).filter(k => k !== "cls").map(sj => {
    const e = subs[sj][year];
    return {
      subject: sj,
      scores: e && e.s ? e.s : [],
      actual: e && e.a != null ? e.a : null,
      prediction: (e && e.s) ? model.predictAP(e.s, formulas[sj]).final : null
    };
  });
  res.json({ ok: true, data: { name: req.params.name, year, rows } });
});

router.post("/api/score", (req, res) => {
  const { name, subject, scores, actual } = req.body;
  if (!name || !subject || !Array.isArray(scores) || scores.length !== 6)
    return res.json({ ok: false, error: "参数不完整" });
  const year = req.body.year || store.getActiveYear();
  store.setSubjectScore(name, subject, year, scores.map(Number), actual == null ? null : Number(actual));
  // 录入后即时更新该生本学年推断(最新估算)
  const r = computeInferred(name, year);
  if (r && r.exists) store.setInferred(name, year, r.inferred);
  res.json({ ok: true, year });
});
router.post("/api/score/delete", (req, res) => {
  const year = req.body.year || store.getActiveYear();
  store.removeSubjectYear(req.body.name, req.body.subject, year);
  const r = computeInferred(req.body.name, year);
  if (r && r.exists) store.setInferred(req.body.name, year, r.inferred); else store.setInferred(req.body.name, year, null);
  res.json({ ok: true });
});

// 模型配置
router.get("/api/model", (req, res) => res.json({ ok: true, data: store.getModel().courseFormulas }));
router.post("/api/model", (req, res) => {
  const formulas = req.body.formulas;
  if (!formulas || typeof formulas !== "object") return res.json({ ok: false, error: "格式错误" });
  const m = store.getModel();
  m.courseFormulas = formulas;
  store.setModel(m);
  res.json({ ok: true });
});

// 学年管理
router.get("/api/years", (req, res) => res.json(Object.assign({ ok: true }, store.getYears())));
router.post("/api/years", (req, res) => {
  const r = store.addYear(req.body.year);
  if (!r.ok) return res.json(r);
  res.json({ ok: true, years: r.years, activeYear: r.activeYear });
});
router.post("/api/years/active", (req, res) => {
  const r = store.setActiveYear(req.body.year);
  if (!r.ok) return res.json(r);
  res.json({ ok: true, activeYear: r.activeYear });
});

// 分析点 (供前端聚类/排名/洞察) —— 当前学年
router.get("/api/points", (req, res) => {
  const students = store.getStudents();
  const formulas = store.getModel().courseFormulas;
  const year = store.getActiveYear();
  const filter = {};
  if (req.query.subject) filter.subject = req.query.subject;
  if (req.query.student) filter.student = req.query.student;
  const pts = model.buildPoints(students, filter, year).map(p => ({
    student: p.student, subject: p.subject, vector: p.vector, actual: p.actual,
    prediction: model.predictAP(p.vector, formulas[p.subject]).final
  }));
  res.json({ ok: true, data: pts, year });
});

// 校准回测 —— 当前学年
router.get("/api/calibration", (req, res) => {
  const students = store.getStudents();
  const formulas = store.getModel().courseFormulas;
  const year = store.getActiveYear();
  const pts = model.buildPoints(students, req.query.subject ? { subject: req.query.subject } : {}, year);
  const reg = model.computeRegression(pts.map(p => ({ vector: p.vector, actual: p.actual, subject: p.subject })), req.query.subject || null);
  res.json({ ok: true, data: { regression: reg, sampleCount: pts.filter(p => p.actual != null).length }, year });
});

// 导出 / 导入
router.get("/api/export", (req, res) => {
  res.setHeader("Content-Disposition", "attachment; filename=ability-backup-" + Date.now() + ".json");
  res.json(store.exportData());
});

// 逆向能力推断
router.post("/api/infer", (req, res) => {
  const year = req.body.year || store.getActiveYear();
  const r = computeInferred(req.body.name, year);
  if (!r || !r.exists) return res.json({ ok: false, error: r ? r.reason : "学生不存在" });
  store.setInferred(req.body.name, year, r.inferred);
  res.json({ ok: true, name: r.name, year, inferred: r.inferred, manualProfile: r.manualProfile, predictedAll: r.predictedAll, source: r.source, hasActual: r.hasActual });
});
router.post("/api/infer/all", (req, res) => {
  const year = req.body.year || store.getActiveYear();
  const students = store.getStudents();
  const out = [];
  for (const name in students) {
    const r = computeInferred(name, year);
    if (r && r.exists) {
      store.setInferred(name, year, r.inferred);
      const preds = r.predictedAll.filter(p => p.predicted != null).map(p => p.predicted);
      const avg = preds.length ? Math.round(preds.reduce((a, b) => a + b, 0) / preds.length * 10) / 10 : null;
      out.push({ name, abilities: r.inferred.abilities, rmse: r.inferred.rmse, n: r.inferred.n,
                 reliable: r.inferred.reliable, manualProfile: r.manualProfile,
                 avgPredicted: avg, counted: r.predictedAll.filter(p => p.counted).length, source: r.source });
    }
  }
  res.json({ ok: true, results: out, year });
});

// 用当前模型重新估算全班(当前学年): 改完模型权重后一键重算所有学生的推断能力(评定)
router.post("/api/reestimate", (req, res) => {
  const year = req.body.year || store.getActiveYear();
  const students = store.getStudents();
  let cnt = 0;
  for (const name in students) {
    const r = computeInferred(name, year);
    if (r && r.exists) { store.setInferred(name, year, r.inferred); cnt++; }
  }
  res.json({ ok: true, recomputed: cnt, year });
});
router.post("/api/import", (req, res) => {
  try { store.importData(req.body); res.json({ ok: true }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

module.exports = router;
