// JSON 文件存储 —— 零原生依赖, 换设备直接拷贝 data/db.json 即可备份
// 成绩与推断结果均按"学年"维度嵌套: students[name][subject][year] = {s, a}
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ABILITIES, DEFAULT_COURSE_FORMULAS } = require("./model");

const DB_PATH = path.join(__dirname, "..", "data", "db.json");
const DEFAULT_YEAR = "2025-2026";

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
  return _db;
}

function save() {
  fs.writeFileSync(DB_PATH, JSON.stringify(_db, null, 2), "utf-8");
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
function getStudents() { return load().students; }
function getStudentNames() { return Object.keys(load().students); }
function addStudent(name) {
  const db = load();
  if (db.students[name]) return false;
  db.students[name] = {}; save(); return true;
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

// ── 逆向推断结果 (按学年) ──
function getInferred(name, year) { const db = load(); return (db.inferred[name] && db.inferred[name][year]) || null; }
function setInferred(name, year, obj) { const db = load(); if (!db.inferred[name]) db.inferred[name] = {}; db.inferred[name][year] = obj; save(); }
function getInferredByYear(year) {
  const db = load(); const out = {};
  for (const n in db.inferred) if (db.inferred[n][year]) out[n] = db.inferred[n][year];
  return out;
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
    model: obj.model || defaultDB().model,
    meta: obj.meta || { importedAt: new Date().toISOString() }
  };
  save();
}

module.exports = {
  DB_PATH, load, save,
  getUsers, getUser, addUser, updateUser, deleteUser,
  getYears, getActiveYear, addYear, setActiveYear,
  getStudents, getStudentNames, addStudent, removeStudent, renameStudent,
  getStudentScoresForYear, setSubjectScore, removeSubjectYear,
  getInferred, setInferred, getInferredByYear,
  getModel, setModel,
  exportData, importData
};
