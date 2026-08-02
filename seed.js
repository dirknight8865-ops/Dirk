// 用原始 demo 的 EXAMPLE_DATA 重建 data/db.json (34 名学生, 能力/实际分由 0-100 换算为 1-5)
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { DEFAULT_COURSE_FORMULAS, ABILITIES } = require("./lib/model");

const INDEX = "/Users/materials/Documents/students ability ranking/index.html";
const DB_PATH = path.join(__dirname, "data", "db.json");

const src = fs.readFileSync(INDEX, "utf-8");
const m = src.match(/const EXAMPLE_DATA = (\{[\s\S]*?\});\s*\n/);
if (!m) { console.error("EXAMPLE_DATA 未找到"); process.exit(1); }
const raw = JSON.parse(m[1]);
const conv = v => (typeof v === "number" && v != null) ? Math.round(v / 20) : null;

const YEAR = "2025-2026";
const students = {};
for (const name in raw) {
  students[name] = {};
  for (const subj in raw[name]) {
    const rec = raw[name][subj];
    students[name][subj] = { [YEAR]: { s: rec.s.slice(0, 6).map(conv), a: conv(rec.a) } };
  }
}

const adminHash = bcrypt.hashSync("AbleTrack-2026!", 10);
const stuHash = bcrypt.hashSync("pass123", 10);

const db = {
  users: [
    { username: "admin", passwordHash: adminHash, role: "admin", studentName: null },
    { username: "stuWode", passwordHash: stuHash, role: "student", studentName: "Wode Wang" }
  ],
  years: [YEAR],
  activeYear: YEAR,
  students,
  inferred: {},
  model: { abilities: ABILITIES.slice(), courseFormulas: JSON.parse(JSON.stringify(DEFAULT_COURSE_FORMULAS)) },
  meta: { createdAt: new Date().toISOString(), version: 2, seededFrom: "EXAMPLE_DATA (initial demo index.html)" }
};

fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
console.log("已载入", Object.keys(students).length, "名学生到", DB_PATH);
