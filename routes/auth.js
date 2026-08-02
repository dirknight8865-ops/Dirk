const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const store = require("../lib/store");

// 管理员登录
router.get("/login", (req, res) => {
  if (req.session.user) return res.redirect(req.session.user.role === "admin" ? "/admin" : "/student");
  res.render("admin/login", { error: null });
});
router.post("/login", (req, res) => {
  const { username, password } = req.body;
  const user = store.getUser(username);
  if (!user || user.role !== "admin" || !bcrypt.compareSync(password || "", user.passwordHash)) {
    return res.render("admin/login", { error: "用户名或密码错误" });
  }
  req.session.user = { username: user.username, role: user.role, studentName: user.studentName };
  res.redirect("/admin");
});

// 学生登录
router.get("/student/login", (req, res) => {
  if (req.session.user) return res.redirect(req.session.user.role === "student" ? "/student" : "/admin");
  res.render("student/login", { error: null });
});
router.post("/student/login", (req, res) => {
  const { username, password } = req.body;
  const user = store.getUser(username);
  if (!user || user.role !== "student" || !bcrypt.compareSync(password || "", user.passwordHash)) {
    return res.render("student/login", { error: "用户名或密码错误" });
  }
  if (!user.studentName) return res.render("student/login", { error: "账号未关联学生档案, 请联系管理员" });
  req.session.user = { username: user.username, role: user.role, studentName: user.studentName };
  res.redirect("/student");
});

router.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

module.exports = router;
