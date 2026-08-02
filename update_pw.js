// 一次性脚本：把 admin 密码改为强密码，并同步 seed.js
const fs = require("fs");
const bcrypt = require("bcryptjs");

const NEW_PW = "AbleTrack-2026!";
const hash = bcrypt.hashSync(NEW_PW, 10);

const DB = path_join("data", "db.json");
const db = JSON.parse(fs.readFileSync(DB, "utf8"));
const u = db.users.find(x => x.username === "admin");
if (!u) { console.error("admin 用户未找到"); process.exit(1); }
u.passwordHash = hash;
fs.writeFileSync(DB, JSON.stringify(db, null, 2));

// 同步 seed.js，使 node seed.js 重建时也用新密码
let s = fs.readFileSync("seed.js", "utf8");
s = s.replace(/bcrypt\.hashSync\("admin123",\s*10\)/, `bcrypt.hashSync(${JSON.stringify(NEW_PW)}, 10)`);
fs.writeFileSync("seed.js", s);

console.log("admin 密码已更新。新密码:", NEW_PW);
console.log("hash:", hash);

function path_join(...p) { return require("path").join(__dirname, ...p); }
