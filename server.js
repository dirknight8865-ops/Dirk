const express = require("express");
const session = require("express-session");
const path = require("path");
const store = require("./lib/store");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(session({
  secret: process.env.SESSION_SECRET || "ability-system-dev-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

// 确保数据库初始化
store.load();

app.use("/", require("./routes/auth"));
app.use("/admin", require("./routes/admin"));
app.use("/student", require("./routes/student"));

// 根路径: 按角色跳转
app.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  res.redirect(req.session.user.role === "admin" ? "/admin" : "/student");
});

app.use((req, res) => res.status(404).send("页面不存在"));

app.listen(PORT, () => {
  console.log("学生能力评估系统已启动: http://localhost:" + PORT);
  console.log("管理员账号: admin / " + (process.env.ADMIN_PASSWORD || "admin123"));
});
