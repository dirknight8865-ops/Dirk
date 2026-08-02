// 认证与权限中间件
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect("/login");
  next();
}

function requireRole(role) {
  return function (req, res, next) {
    if (!req.session || !req.session.user) return res.redirect("/login");
    if (req.session.user.role !== role) return res.status(403).send("无权限访问");
    next();
  };
}

// 学生端: 必须已登录且关联了学生档案
function requireStudent(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect("/student/login");
  if (req.session.user.role !== "student") return res.redirect("/student/login");
  if (!req.session.user.studentName) return res.status(403).send("账号未关联学生档案, 请联系管理员");
  next();
}

module.exports = { requireAuth, requireRole, requireStudent };
