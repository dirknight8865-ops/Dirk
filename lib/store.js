// JSON 文件存储 —— 零原生依赖, 换设备直接拷贝 data/db.json 即可备份
// 成绩与推断结果均按"学年"维度嵌套: students[name][subject][year] = {s, a}
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ABILITIES, DEFAULT_COURSE_FORMULAS } = require("./model");

const DB_PATH = path.join(__dirname, "..", "data", "db.json");
const BACKUP_DIR = path.join(__dirname, "..", "data", "backups");
const MAX_BACKUPS = 30; // 自动备份最多保留份数, 超出则删除最旧
const DEFAULT_YEAR = "2025-2026";

// 自动备份: 每次 save() 都复制一份带时间戳的数据文件到 data/backups/
// 命名形如 db-2026-08-25T09-43-12-123Z.json, 仅保留最近 MAX_BACKUPS 份
function writeBackup(json) {
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(path.join(BACKUP_DIR, `db-${ts}.json`), json, "utf-8");
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith("db-") && f.endsWith(".json"))
      .sort();
    while (files.length > MAX_BACKUPS) {
      const old = files.shift();
      try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch (_) {}
    }
  } catch (e) {
    console.error("[store] 自动备份失败:", e.message);
  }
}

function defaultDB() {
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
  const adminHash = bcrypt.hashSync(adminPassword, 10);
  return {
    users: [{ username: "admin", passwordHash: adminHash, role: "admin", studentName: null }],
    years: [DEFAULT_YEAR],
    activeYear: DEFAULT_YEAR,
    students: {},
    inferred: {},
    model: { abilities: ABILITIES.slice(), courseFormulas: JSON.parse(JSON.stringify(DEFAULT_COURSE_FORMULAS)) },
    meta: { createdAt: new Date().toISOString(), version: 2 }
  };
}

let _db = null;

function load() {
  if (_db) return _db;
  try {
    if (fs.existsSync(DB_PATH)) {
      _db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
    } else {
      _db = defaultDB();
      save();
    }
  } catch (e) {
    console.error("加载数据库失败, 使用默认库:", e.message);
    _db = defaultDB();
  }
  // 向后兼容 / 迁移
  if (!_db.model) _db.model = { abilities: ABILITIES.slice(), courseFormulas: JSON.parse(JSON.stringify(DEFAULT_COURSE_FORMULAS)) };
  if (!_db.users) _db.users = [];
  if (!_db.students) _db.students = {};
  if (!_db.inferred) _db.inferred = {};
  if (!_db.years || !Array.isArray(_db.years) || _db.years.length === 0) _db.years = [DEFAULT_YEAR];
  if (!_db.activeYear || !_db.years.includes(_db.activeYear)) _db.activeYear = _db.years[_db.years.length - 1];

  // 迁移: 旧的扁平结构 {s, a} -> 按学年嵌套 {year: {s, a}}
  for (const name in _db.students) {
    const subs = _db.students[name];
    if (!subs || typeof subs !== "object") continue;
    for (const sj in subs) {
      if (sj === "cls") continue;
      const e = subs[sj];
      if (e && typeof e === "object" && Array.isArray(e.s) &&
          Object.keys(e).every(k => k === "s" || k === "a")) {
        subs[sj] = { [_db.activeYear]: { s: e.s.slice(0, 6), a: e.a != null ? e.a : null } };
      }
    }
  }
  // 迁移: inferred 扁平 -> 按学年嵌套
  for (const name in _db.inferred) {
    const v = _db.inferred[name];
    if (v && typeof v === "object" && Array.isArray(v.abilities) && v.rmse != null && !v[_db.activeYear]) {
      _db.inferred[name] = { [_db.activeYear]: v };
    }
  }
  // 归档区(学年重置用): archived = { year: { studentName: { subject: entry } } }
  if (!_db.archived || typeof _db.archived !== "object") _db.archived = {};
  return _db;
}

function save() {
  const json = JSON.stringify(_db, null, 2);
  fs.writeFileSync(DB_PATH, json, "utf-8");
  writeBackup(json); // 每次更新都本地保存一份带时间戳的数据文件
}

// ── 用户 ──
function getUsers() { return load().users; }
function getUser(username) { return load().users.find(u => u.username === username) || null; }
function addUser(user) { const db = load(); if (db.users.find(u => u.username === user.username)) return false; db.users.push(user); save(); return true; }
function updateUser(username, patch) {
  const db = load(); const u = db.users.find(x => x.username === username);
  if (!u) return false;
  Object.assign(u, patch); save(); return true;
}
function deleteUser(username) {
  const db = load(); const i = db.users.findIndex(u => u.username === username);
  if (i < 0) return false; db.users.splice(i, 1); save(); return true;
}

// ── 学年 ──
function getYears() { const db = load(); return { years: db.years.slice(), activeYear: db.activeYear }; }
function getActiveYear() { return load().activeYear; }
function addYear(year) {
  const db = load();
  year = (year || "").trim();
  if (!year) return { ok: false, error: "学年不能为空" };
  if (db.years.includes(year)) return { ok: false, error: "该学年已存在" };
  db.years.push(year);
  db.activeYear = year; // 新建即设为当前, 方便直接录入
  save();
  return { ok: true, years: db.years.slice(), activeYear: year };
}
function setActiveYear(year) {
  const db = load();
  if (!db.years.includes(year)) return { ok: false, error: "学年不存在" };
  db.activeYear = year; save();
  return { ok: true, activeYear: year };
}

// ── 学生数据 (按学年) ──
// students[name].cls = { grade: "G10"|"G11"|"G12", graduated: bool } —— 元数据键,
// 所有科目遍历均已跳过 "cls", 互不干扰
const GRADES = ["G10", "G11", "G12"];

function getStudents() { return load().students; }
function getStudentNames() { return Object.keys(load().students); }
function getStudentMeta(name) {
  const db = load();
  const s = db.students[name];
  if (!s) return null;
  const c = s.cls || {};
  return { grade: GRADES.includes(c.grade) ? c.grade : null, graduated: !!c.graduated };
}
function setStudentGrade(name, grade) {
  const db = load();
  if (!db.students[name]) return false;
  if (!GRADES.includes(grade)) return false;
  if (!db.students[name].cls) db.students[name].cls = {};
  db.students[name].cls.grade = grade;
  save(); return true;
}
function setStudentGraduated(name, graduated) {
  const db = load();
  if (!db.students[name]) return false;
  if (!db.students[name].cls) db.students[name].cls = {};
  db.students[name].cls.graduated = !!graduated;
  save(); return true;
}
// 在读学生(未毕业) —— 评分录入等"能力值设定点"只用这个
function getActiveStudentNames() {
  const db = load();
  return Object.keys(db.students).filter(n => !(db.students[n].cls && db.students[n].cls.graduated));
}
function addStudent(name, grade) {
  const db = load();
  if (db.students[name]) return false;
  db.students[name] = {};
  if (grade && GRADES.includes(grade)) db.students[name].cls = { grade: grade, graduated: false };
  save(); return true;
}
function removeStudent(name) {
  const db = load();
  if (!db.students[name]) return false;
  delete db.students[name];
  // 解除关联账号
  db.users.forEach(u => { if (u.role === "student" && u.studentName === name) u.studentName = null; });
  save(); return true;
}
function renameStudent(oldName, newName) {
  const db = load();
  if (!db.students[oldName] || db.students[newName]) return false;
  db.students[newName] = db.students[oldName];
  delete db.students[oldName];
  db.users.forEach(u => { if (u.role === "student" && u.studentName === oldName) u.studentName = newName; });
  save(); return true;
}
// 取某学生某学年的 {subject: {s, a}}
function getStudentScoresForYear(name, year) {
  const subs = load().students[name];
  if (!subs) return {};
  const out = {};
  for (const sj in subs) {
    if (sj === "cls") continue;
    const y = subs[sj][year];
    if (y) out[sj] = { s: (y.s || []).slice(0, 6), a: y.a != null ? y.a : null };
  }
  return out;
}
function setSubjectScore(name, subject, year, scores5, actual) {
  const db = load();
  if (!db.students[name]) db.students[name] = {};
  if (!db.students[name][subject]) db.students[name][subject] = {};
  db.students[name][subject][year] = { s: scores5.slice(0, 6), a: (actual == null ? null : actual) };
  save();
}
function removeSubjectYear(name, subject, year) {
  const db = load();
  if (db.students[name] && db.students[name][subject]) {
    if (year) delete db.students[name][subject][year];
    if (Object.keys(db.students[name][subject]).length === 0) delete db.students[name][subject];
    save(); return true;
  }
  return false;
}

// ── 月度能力评估 ──
// 数据结构: students[name][subject][year] = { s, a, months: { "YYYY-MM": { s, a } } }
// s/a 始终是"最新一次评估"快照(所有既有页面继续读它, 零改动);
// months 是完整月度序列(学生端评估曲线页读取)
function currentMonth() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}
function shiftMonth(ym, delta) {
  const parts = String(ym).split("-");
  const y = +parts[0], m = +parts[1];
  if (!y || !m) return ym;
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}
// 写入一次月度评估: 写 months[month] + 同步 s/a 快照
// 若该科该学年首次录月度(months 为空)且存在旧快照, 先把旧快照归档到"录入月的上一个月"
// —— 兼容历史数据(旧数据即上一个月评估), 保证曲线从旧快照连续过渡
function saveAssessment(name, subject, year, month, scores5, actual) {
  month = String(month || "").trim();
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, error: "评估月份格式应为 YYYY-MM" };
  if (!scores5 || scores5.length !== 6) return { ok: false, error: "能力评分须为 6 维" };
  const db = load();
  if (!db.students[name]) db.students[name] = {};
  if (!db.students[name][subject]) db.students[name][subject] = {};
  let entry = db.students[name][subject][year];
  if (!entry || typeof entry !== "object") entry = { s: null, a: null };
  if (!entry.months || typeof entry.months !== "object") entry.months = {};
  const snap = scores5.slice(0, 6);
  const act = actual == null ? null : actual;
  // 归档旧快照(仅当 months 为空——即该科该学年第一次按月度录入)
  if (Object.keys(entry.months).length === 0 && Array.isArray(entry.s) && entry.s.length === 6) {
    const prev = shiftMonth(month, -1);
    entry.months[prev] = { s: entry.s.slice(0, 6), a: entry.a != null ? entry.a : null };
  }
  entry.months[month] = { s: snap, a: act };
  entry.s = snap;
  entry.a = act;
  db.students[name][subject][year] = entry;
  save();
  return { ok: true, month, archived: true };
}
// 取某学生某科目某学年的月度序列(按月份升序)
// 老数据(无 months)降级: 返回单点 {month:null}, 由调用方决定如何展示
function getAssessmentSeries(name, subject, year) {
  const subs = load().students[name];
  const entry = subs && subs[subject] && subs[subject][year];
  if (!entry) return [];
  if (entry.months && Object.keys(entry.months).length) {
    return Object.keys(entry.months).sort().map(m => ({
      month: m,
      s: (entry.months[m].s || []).slice(0, 6),
      a: entry.months[m].a != null ? entry.months[m].a : null
    }));
  }
  if (Array.isArray(entry.s) && entry.s.length === 6) {
    return [{ month: null, s: entry.s.slice(0, 6), a: entry.a != null ? entry.a : null }];
  }
  return [];
}
// 该学生某学年已有评估的月份列表(升序, 跨科目汇总)
function getAssessmentMonths(name, year) {
  const subs = load().students[name];
  if (!subs) return [];
  const set = new Set();
  for (const sj in subs) {
    if (sj === "cls") continue;
    const entry = subs[sj][year];
    if (entry && entry.months) for (const m in entry.months) set.add(m);
  }
  return Array.from(set).sort();
}

// ── 逆向推断结果 (按学年) ──
function getInferred(name, year) { const db = load(); return (db.inferred[name] && db.inferred[name][year]) || null; }
function setInferred(name, year, obj) { const db = load(); if (!db.inferred[name]) db.inferred[name] = {}; db.inferred[name][year] = obj; save(); }
function getInferredByYear(year) {
  const db = load(); const out = {};
  for (const n in db.inferred) if (db.inferred[n][year]) out[n] = db.inferred[n][year];
  return out;
}

// ── 学年重置(归档) ──
// 归档区: db.archived = { year: { studentName: { subject: entry } } }
// 与学生数据结构完全隔离, 不影响任何现有遍历; 归档后该学年数据从所有视图消失, 可随时恢复
// 各学年统计(在役): { year: { students, entries } }
function getYearStats() {
  const db = load();
  const out = {};
  for (const y of db.years) out[y] = { year: y, students: 0, entries: 0, archived: false, _names: new Set() };
  for (const name in db.students) {
    const subs = db.students[name];
    for (const sj in subs) {
      if (sj === "cls") continue;
      for (const y in subs[sj]) {
        if (!out[y]) out[y] = { year: y, students: 0, entries: 0, archived: false, _names: new Set() };
        out[y].entries++;
        out[y]._names.add(name);
      }
    }
  }
  for (const y in out) {
    out[y].students = out[y]._names.size;
    delete out[y]._names;
  }
  for (const y in db.archived) {
    if (!out[y]) out[y] = { year: y, students: 0, entries: 0, archived: true };
    out[y].archived = true;
  }
  return out;
}
function getArchivedYears() { return Object.keys(load().archived).sort().reverse(); }
// 归档某学年: 把该学年全部科目记录(含 cls 之外的一切)移到 db.archived[year], 原位置删除
function archiveYear(year) {
  const db = load();
  if (!db.years.includes(year)) return { ok: false, error: "学年不存在" };
  if (db.archived[year]) return { ok: false, error: "该学年已归档" };
  if (year === db.activeYear) return { ok: false, error: "不能归档当前学年, 请先切换当前学年" };
  const moved = {};
  let count = 0;
  for (const name in db.students) {
    const subs = db.students[name];
    for (const sj in subs) {
      if (sj === "cls" || sj === "archived") continue;
      if (subs[sj][year]) {
        if (!moved[name]) moved[name] = {};
        moved[name][sj] = subs[sj][year];
        delete subs[sj][year];
        count++;
      }
    }
    // 清理空科目节点
    for (const sj of Object.keys(subs)) {
      if (sj === "cls" || sj === "archived") continue;
      if (Object.keys(subs[sj]).length === 0) delete subs[sj];
    }
  }
  db.archived[year] = moved;
  // 同步归档该学年的推断结果
  if (db.inferred) {
    for (const n in db.inferred) {
      if (db.inferred[n][year]) {
        if (!db.archived[year + "__inferred"]) db.archived[year + "__inferred"] = {};
        db.archived[year + "__inferred"][n] = db.inferred[n][year];
        delete db.inferred[n][year];
      }
    }
  }
  save();
  return { ok: true, moved: count };
}
// 恢复某学年归档
function restoreYear(year) {
  const db = load();
  if (!db.archived[year]) return { ok: false, error: "该学年无归档数据" };
  const moved = db.archived[year];
  let count = 0;
  for (const name in moved) {
    if (!db.students[name]) db.students[name] = {};
    for (const sj in moved[name]) {
      if (!db.students[name][sj]) db.students[name][sj] = {};
      db.students[name][sj][year] = moved[name][sj];
      count++;
    }
  }
  delete db.archived[year];
  // 恢复推断结果
  const infKey = year + "__inferred";
  if (db.archived[infKey]) {
    for (const n in db.archived[infKey]) {
      if (!db.inferred[n]) db.inferred[n] = {};
      db.inferred[n][year] = db.archived[infKey][n];
    }
    delete db.archived[infKey];
  }
  save();
  return { ok: true, moved: count };
}
// 彻底删除某学年数据(不可恢复; 归档态与在役态都删)
function deleteYearData(year) {
  const db = load();
  if (!db.years.includes(year)) return { ok: false, error: "学年不存在" };
  let count = 0;
  for (const name in db.students) {
    const subs = db.students[name];
    for (const sj in subs) {
      if (sj === "cls" || sj === "archived") continue;
      if (subs[sj][year]) { delete subs[sj][year]; count++; }
    }
    for (const sj of Object.keys(subs)) {
      if (sj === "cls" || sj === "archived") continue;
      if (Object.keys(subs[sj]).length === 0) delete subs[sj];
    }
  }
  if (db.archived[year]) { delete db.archived[year]; }
  const infKey = year + "__inferred";
  if (db.archived[infKey]) delete db.archived[infKey];
  for (const n in db.inferred) if (db.inferred[n][year]) delete db.inferred[n][year];
  if (year === db.activeYear && db.years.length > 1) {
    db.years = db.years.filter(y => y !== year);
    db.activeYear = db.years[db.years.length - 1];
  } else if (year !== db.activeYear) {
    db.years = db.years.filter(y => y !== year);
  }
  save();
  return { ok: true, moved: count };
}

// ── 模型配置 ──
function getModel() { return load().model; }
function setModel(model) { const db = load(); db.model = model; save(); }

// ── 导入导出 ──
function exportData() { return JSON.parse(JSON.stringify(load())); }
function importData(obj) {
  const years = (obj.years && obj.years.length) ? obj.years : [DEFAULT_YEAR];
  const activeYear = (obj.activeYear && years.includes(obj.activeYear)) ? obj.activeYear : years[years.length - 1];
  _db = {
    users: obj.users || [],
    years,
    activeYear,
    students: obj.students || {},
    inferred: obj.inferred || {},
    archived: obj.archived || {},
    model: obj.model || defaultDB().model,
    meta: obj.meta || { importedAt: new Date().toISOString() }
  };
  save();
}

// ── 自动备份管理 ──
function listBackups() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith("db-") && f.endsWith(".json"))
      .sort().reverse(); // 最新在前
  } catch (e) { return []; }
}
function restoreBackup(filename) {
  if (!filename) return false;
  const fp = path.join(BACKUP_DIR, path.basename(filename)); // 防目录穿越
  if (!fs.existsSync(fp)) return false;
  try {
    _db = JSON.parse(fs.readFileSync(fp, "utf-8"));
    save(); // 写回 db.json, 同时再生成一份新备份
    return true;
  } catch (e) { return false; }
}

module.exports = {
  DB_PATH, BACKUP_DIR, load, save, GRADES,
  getUsers, getUser, addUser, updateUser, deleteUser,
  getYears, getActiveYear, addYear, setActiveYear,
  getStudents, getStudentNames, getStudentMeta, setStudentGrade, setStudentGraduated, getActiveStudentNames,
  addStudent, removeStudent, renameStudent,
  getStudentScoresForYear, setSubjectScore, removeSubjectYear,
  saveAssessment, getAssessmentSeries, getAssessmentMonths, currentMonth, shiftMonth,
  getInferred, setInferred, getInferredByYear,
  getYearStats, getArchivedYears, archiveYear, restoreYear, deleteYearData,
  getModel, setModel,
  exportData, importData,
  listBackups, restoreBackup
};
