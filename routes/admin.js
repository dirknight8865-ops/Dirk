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
  return { user: req.session.user, model: m, abilities: m.abilities, courseNames: Object.keys(m.courseFormulas), years: yi.years, activeYear: yi.activeYear, criteria: model.ABILITY_CRITERIA, levelNames: model.LEVEL_NAMES };
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
    const meta = store.getStudentMeta(name);
    return { name, subjectCount, account: acct ? acct.username : null, grade: meta.grade, graduated: meta.graduated };
  });
  res.render("admin/students", Object.assign(withCommon(req), { rows, grades: store.GRADES }));
});

router.get("/scoring", (req, res) => res.render("admin/scoring", Object.assign(withCommon(req), { grades: store.GRADES, currentMonth: store.currentMonth() })));
router.get("/model", (req, res) => res.render("admin/model", withCommon(req)));
router.get("/calibration", (req, res) => res.render("admin/calibration", withCommon(req)));
router.get("/analytics", (req, res) => {
  const year = store.getActiveYear();
  res.render("admin/analytics", Object.assign(withCommon(req), { year }));
});
router.get("/reports", (req, res) => {
  // 可选: 从查询串预选学生/科目
  const students = store.getStudents();
  const rows = Object.keys(students).map(name => {
    const meta = store.getStudentMeta(name);
    return { name, grade: meta.grade, graduated: meta.graduated };
  });
  res.render("admin/reports", Object.assign(withCommon(req), { studentRows: rows }));
});
// 单科能力分布明细(从成绩报告点预估分进入)
router.get("/ability-dist", (req, res) => {
  const name = req.query.name || "";
  const subject = req.query.subject || "";
  const year = req.query.year || store.getActiveYear();
  res.render("admin/ability-dist", Object.assign(withCommon(req), { name, subject, year }));
});

// ── 表现分析(教师端): 横向(按科目对比学生) / 纵向(按学生对比学科) / 学生间对比 ──
// 注意: 三种视图都包含已毕业学生(带 graduated 标记), 便于历史学期横向对比
router.get("/performance", (req, res) => {
  const year = req.query.year || store.getActiveYear();
  res.render("admin/performance", Object.assign(withCommon(req), { year }));
});
// 横向: 某学年某科目的全体学生表现
router.get("/api/performance/horizontal", (req, res) => {
  const year = req.query.year || store.getActiveYear();
  const subject = req.query.subject || "";
  const formulas = store.getModel().courseFormulas;
  const students = store.getStudents();
  // 该学年实际有数据的科目集合(供前端下拉)
  const subjSet = new Set(Object.keys(formulas));
  for (const name in students) {
    const subs = students[name];
    for (const sj in subs) {
      if (sj === "cls") continue;
      if (subs[sj][year]) subjSet.add(sj);
    }
  }
  const subjects = Array.from(subjSet).sort();
  if (!subject) return res.json({ ok: true, year, subject: "", subjects, rows: [], classAvg: null, abilities: model.ABILITIES });
  const rows = [];
  for (const name in students) {
    const subs = students[name];
    const entry = subs[subject] && subs[subject][year];
    if (!entry || !entry.s || entry.s.length !== 6) continue;
    const meta = store.getStudentMeta(name);
    const fmt = formulas[subject];
    const avg = +(entry.s.reduce((a, b) => a + b, 0) / 6).toFixed(2);
    rows.push({
      name, grade: meta.grade, graduated: meta.graduated,
      scores: entry.s.slice(0, 6), avg,
      prediction: fmt ? model.predictAP(entry.s, fmt).final : null,
      actual: entry.a != null ? entry.a : null
    });
  }
  rows.sort((a, b) => (b.prediction || 0) - (a.prediction || 0));
  rows.forEach((r, i) => { r.rank = i + 1; });
  const withPred = rows.filter(r => r.prediction != null);
  const classAvg = withPred.length ? +(withPred.reduce((s, r) => s + r.prediction, 0) / withPred.length).toFixed(2) : null;
  res.json({ ok: true, year, subject, subjects, rows, classAvg, abilities: model.ABILITIES });
});
// 纵向: 某学生某学年的全科表现
router.get("/api/performance/vertical", (req, res) => {
  const year = req.query.year || store.getActiveYear();
  const name = req.query.name || "";
  const formulas = store.getModel().courseFormulas;
  const subs = (store.getStudents()[name]) || {};
  const rows = [];
  for (const sj in subs) {
    if (sj === "cls") continue;
    const entry = subs[sj][year];
    if (!entry || !entry.s || entry.s.length !== 6) continue;
    const fmt = formulas[sj];
    const avg = +(entry.s.reduce((a, b) => a + b, 0) / 6).toFixed(2);
    const pred = fmt ? model.predictAP(entry.s, fmt).final : null;
    rows.push({
      subject: sj, scores: entry.s.slice(0, 6), avg,
      prediction: pred, actual: entry.a != null ? entry.a : null,
      err: (pred != null && entry.a != null) ? entry.a - pred : null
    });
  }
  rows.sort((a, b) => a.subject.localeCompare(b.subject));
  const withScores = rows.filter(r => r.scores);
  const avg6 = model.ABILITIES.map((_, i) => {
    const vals = withScores.map(r => r.scores[i]);
    return vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : null;
  });
  res.json({ ok: true, year, name, rows, avg6, abilities: model.ABILITIES });
});
// 学生间对比: 多学生(含毕业)某学年横向对照
router.get("/api/performance/compare", (req, res) => {
  const year = req.query.year || store.getActiveYear();
  const names = String(req.query.names || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 6);
  const formulas = store.getModel().courseFormulas;
  const students = store.getStudents();
  const subjects = new Set();
  const out = names.map(name => {
    const subs = students[name] || {};
    const meta = store.getStudentMeta(name);
    const sMap = {};
    for (const sj in subs) {
      if (sj === "cls") continue;
      const entry = subs[sj][year];
      if (!entry || !entry.s || entry.s.length !== 6) continue;
      subjects.add(sj);
      const fmt = formulas[sj];
      sMap[sj] = {
        scores: entry.s.slice(0, 6),
        prediction: fmt ? model.predictAP(entry.s, fmt).final : null,
        actual: entry.a != null ? entry.a : null
      };
    }
    const preds = Object.values(sMap).map(v => v.prediction).filter(v => v != null);
    return {
      name, grade: meta ? meta.grade : null, graduated: meta ? meta.graduated : false,
      subjects: sMap,
      avg6: Object.values(sMap).length ? +(Object.values(sMap).reduce((s, v) => s + v.scores.reduce((a, b) => a + b, 0) / 6, 0) / Object.values(sMap).length).toFixed(2) : null,
      avgPred: preds.length ? +(preds.reduce((a, b) => a + b, 0) / preds.length).toFixed(2) : null
    };
  });
  res.json({ ok: true, year, students: out, subjects: Array.from(subjects).sort(), abilities: model.ABILITIES });
});
router.get("/ops", (req, res) => res.render("admin/ops", Object.assign(withCommon(req), { yearStats: store.getYearStats(), archivedYears: store.getArchivedYears() })));
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
// 全部学生(含毕业); query: all=1 默认; active=1 只要在读
router.get("/api/students", (req, res) => {
  const names = req.query.active === "1" ? store.getActiveStudentNames() : store.getStudentNames();
  const data = names.map(name => {
    const meta = store.getStudentMeta(name);
    return { name, grade: meta.grade, graduated: meta.graduated };
  });
  res.json({ ok: true, data });
});
router.get("/api/students/detail", (req, res) => {
  const students = store.getStudents();
  const year = store.getActiveYear();
  const onlyActive = req.query.active === "1";
  const data = Object.keys(students).map(name => {
    const subs = students[name];
    let subjectCount = 0;
    for (const sj in subs) { if (sj === "cls") continue; if (subs[sj][year]) subjectCount++; }
    const meta = store.getStudentMeta(name);
    return { name, subjectCount, grade: meta.grade, graduated: meta.graduated };
  }).filter(s => !onlyActive || !s.graduated);
  res.json({ ok: true, data });
});
router.get("/api/accounts", (req, res) => {
  const data = store.getUsers().filter(u => u.role === "student").map(u => ({ username: u.username, studentName: u.studentName }));
  res.json({ ok: true, data });
});

router.post("/api/students", (req, res) => {
  const name = (req.body.name || "").trim();
  const grade = req.body.grade || null;
  if (!name) return res.json({ ok: false, error: "姓名不能为空" });
  if (grade && !store.GRADES.includes(grade)) return res.json({ ok: false, error: "年级无效(G10-G12)" });
  if (!store.addStudent(name, grade)) return res.json({ ok: false, error: "已存在该学生" });
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

// 年级 / 毕业状态
router.post("/api/students/grade", (req, res) => {
  const { name, grade } = req.body;
  if (!store.setStudentGrade(name, grade)) return res.json({ ok: false, error: "设置失败(学生不存在或年级无效)" });
  res.json({ ok: true });
});
router.post("/api/students/graduate", (req, res) => {
  const { name, graduated } = req.body;
  if (!store.setStudentGraduated(name, graduated !== false)) return res.json({ ok: false, error: "设置失败" });
  res.json({ ok: true, graduated: graduated !== false });
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
  const rows = Object.keys(subs).filter(k => k !== "cls" && subs[k][year]).map(sj => {
    const e = subs[sj][year];
    const months = (e && e.months) ? Object.keys(e.months).sort() : [];
    return {
      subject: sj,
      scores: e && e.s ? e.s : [],
      actual: e && e.a != null ? e.a : null,
      prediction: (e && e.s) ? model.predictAP(e.s, formulas[sj]).final : null,
      months, latestMonth: months.length ? months[months.length - 1] : null
    };
  });
  res.json({ ok: true, data: { name: req.params.name, year, rows } });
});

router.post("/api/score", (req, res) => {
  const { name, subject, scores, actual } = req.body;
  if (!name || !subject || !Array.isArray(scores) || scores.length !== 6)
    return res.json({ ok: false, error: "参数不完整" });
  const year = req.body.year || store.getActiveYear();
  // 评估月份(YYYY-MM, 缺省为当前月); 走月度序列保存, 旧快照自动归档
  const month = (req.body.month && /^\d{4}-\d{2}$/.test(req.body.month)) ? req.body.month : store.currentMonth();
  const r = store.saveAssessment(name, subject, year, month, scores.map(Number), actual == null ? null : Number(actual));
  if (!r.ok) return res.json({ ok: false, error: r.error });
  // 录入后即时更新该生本学年推断(最新估算)
  const inf = computeInferred(name, year);
  if (inf && inf.exists) store.setInferred(name, year, inf.inferred);
  res.json({ ok: true, year, month });
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
// 学年重置: 归档(可恢复)/恢复/彻底删除(不可恢复)
router.post("/api/years/archive", (req, res) => {
  const r = store.archiveYear(req.body.year);
  if (!r.ok) return res.json(r);
  res.json(Object.assign({ ok: true }, r, { stats: store.getYearStats(), archived: store.getArchivedYears() }));
});
router.post("/api/years/restore", (req, res) => {
  const r = store.restoreYear(req.body.year);
  if (!r.ok) return res.json(r);
  res.json(Object.assign({ ok: true }, r, { stats: store.getYearStats(), archived: store.getArchivedYears() }));
});
router.post("/api/years/delete", (req, res) => {
  const r = store.deleteYearData(req.body.year);
  if (!r.ok) return res.json(r);
  res.json(Object.assign({ ok: true }, r, { stats: store.getYearStats(), archived: store.getArchivedYears() }));
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

// ── 成绩报告 ──
// 按科目+学年: 汇总该学年(可再按科目)所有学生的预估分; subject 留空 = 整个学年汇总(各科拆分)
router.get("/api/reports/summary", (req, res) => {
  const year = req.query.year || store.getActiveYear();
  const subject = req.query.subject || null;
  const includeGraduated = req.query.all === "1";
  const students = store.getStudents();
  const formulas = store.getModel().courseFormulas;
  const rows = [];
  const subjectStats = {}; // sj -> {count, predSum, actualCount, actualSum, dist}
  const overallDist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const name in students) {
    if (!students.hasOwnProperty(name)) continue;
    const meta = store.getStudentMeta(name);
    if (!includeGraduated && meta.graduated) continue;
    const subs = students[name];
    for (const sj in subs) {
      if (!subs.hasOwnProperty(sj) || sj === "cls") continue;
      if (subject && sj !== subject) continue;
      const e = subs[sj][year];
      if (!e || !e.s || e.s.length !== 6) continue;
      const pred = model.predictAP(e.s, formulas[sj]).final;
      if (!subjectStats[sj]) subjectStats[sj] = { subject: sj, count: 0, predSum: 0, actualCount: 0, actualSum: 0, dist: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
      const st = subjectStats[sj];
      st.count++; st.predSum += pred; st.dist[pred]++; overallDist[pred]++;
      if (e.a != null) { st.actualCount++; st.actualSum += e.a; }
      rows.push({ student: name, grade: meta.grade, graduated: meta.graduated, subject: sj, scores: e.s, prediction: pred, actual: e.a != null ? e.a : null });
    }
  }
  const subjects = Object.values(subjectStats).map(st => ({
    subject: st.subject, count: st.count,
    avgPrediction: st.count ? +(st.predSum / st.count).toFixed(2) : null,
    avgActual: st.actualCount ? +(st.actualSum / st.actualCount).toFixed(2) : null,
    actualCount: st.actualCount, dist: st.dist
  })).sort((a, b) => b.count - a.count);
  const total = rows.length;
  res.json({
    ok: true, year, subject,
    rows: subject ? rows.sort((a, b) => b.prediction - a.prediction) : rows,
    subjects, overall: {
      count: total,
      avgPrediction: total ? +(rows.reduce((s, r) => s + r.prediction, 0) / total).toFixed(2) : null,
      dist: overallDist
    }
  });
});

// 单个学生全景: 全部学年 × 全部科目 + 六维能力 + 推断
router.get("/api/reports/student", (req, res) => {
  const name = req.query.name;
  const students = store.getStudents();
  const subs = students[name];
  if (!subs) return res.json({ ok: false, error: "学生不存在" });
  const formulas = store.getModel().courseFormulas;
  const years = store.getYears().years;
  const meta = store.getStudentMeta(name);
  const rows = [];
  for (const sj of Object.keys(subs).filter(k => k !== "cls")) {
    for (const y of years) {
      const e = subs[sj][y];
      if (!e) continue;
      const pred = (e.s && e.s.length === 6) ? model.predictAP(e.s, formulas[sj]).final : null;
      rows.push({ year: y, subject: sj, scores: e.s || [], prediction: pred, actual: e.a != null ? e.a : null });
    }
  }
  rows.sort((a, b) => (a.year < b.year ? 1 : a.year > b.year ? -1 : a.subject.localeCompare(b.subject)));
  // 六维平均(有录入的科目)
  const vecs = rows.filter(r => r.scores.length === 6).map(r => r.scores);
  const avgAbilities = vecs.length
    ? [0, 1, 2, 3, 4, 5].map(i => +(vecs.reduce((s, v) => s + v[i], 0) / vecs.length).toFixed(2))
    : null;
  // 各学年推断结果
  const inferredByYear = {};
  for (const y of years) {
    const inf = store.getInferred(name, y);
    if (inf) inferredByYear[y] = { abilities: inf.abilities, rmse: inf.rmse, n: inf.n, reliable: inf.reliable };
  }
  res.json({ ok: true, name, grade: meta.grade, graduated: meta.graduated, years, rows, avgAbilities, inferredByYear });
});

// 单科能力分布明细(成绩报告点分数进入): 该生该科六维 + 预测分解 + 全班对照
router.get("/api/reports/ability-dist", (req, res) => {
  const name = req.query.name, subject = req.query.subject;
  const year = req.query.year || store.getActiveYear();
  const students = store.getStudents();
  const subs = students[name];
  if (!subs || !subs[subject] || !subs[subject][year] || !subs[subject][year].s)
    return res.json({ ok: false, error: "该学生该学年该科目暂无评分记录" });
  const e = subs[subject][year];
  const scores = e.s.slice(0, 6);
  const formulas = store.getModel().courseFormulas;
  const fmt = formulas[subject] || null;
  const meta = store.getStudentMeta(name);
  // 预测分解: 均分(base) + 最高分加成(boost) + 偏移(offset) - 低于阈值扣分(penalty)
  let prediction = null;
  if (fmt) {
    const p = model.predictAP(scores, fmt);
    const TH = fmt.threshold || 3.0;
    const perAbility = model.ABILITIES.map((ab, i) => {
      const below = scores[i] < TH;
      return {
        ability: ab, value: scores[i], below,
        shortfall: below ? +(TH - scores[i]).toFixed(2) : 0,
        rate: fmt.penaltyRates[i] || 0,
        contribution: below ? +((TH - scores[i]) * (fmt.penaltyRates[i] || 0)).toFixed(3) : 0
      };
    });
    prediction = { base: +p.base.toFixed(3), boost: +p.boost.toFixed(3), offset: p.offset, penalty: +p.penalty.toFixed(3), final: p.final, threshold: TH, perAbility };
  }
  // 全班该科该学年: 均分向量 + 每能力分数分布
  const vecs = [];
  for (const n in students) {
    if (!students.hasOwnProperty(n)) continue;
    const s2 = students[n][subject];
    if (s2 && s2[year] && s2[year].s && s2[year].s.length === 6) vecs.push(s2[year].s);
  }
  const classAvg = vecs.length
    ? [0, 1, 2, 3, 4, 5].map(i => +(vecs.reduce((s, v) => s + v[i], 0) / vecs.length).toFixed(2))
    : null;
  const classDist = model.ABILITIES.map((_, i) => {
    const d = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    vecs.forEach(v => { d[v[i]] = (d[v[i]] || 0) + 1; });
    return d;
  });
  res.json({
    ok: true, name, subject, year, grade: meta.grade, graduated: meta.graduated,
    scores, actual: e.a != null ? e.a : null, formula: fmt, prediction,
    classCount: vecs.length, classAvg, classDist
  });
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
