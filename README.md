# AP 学生能力评估系统

一个面向 AP 课程老师的**学生能力评估与成绩预测**工具，支持老师后台录入、模型配置、能力推断，以及学生端查询本人数据。

## 在线访问

- 后台（老师）：`https://students-ability-system.onrender.com`
  - 账号：`admin`
  - 密码：`AbleTrack-2026!`
- 学生端：`https://students-ability-system.onrender.com/student/login`
  - 示例账号：`stuWode`
  - 示例密码：`pass123`

> 当前部署在 Render 免费实例，15 分钟无访问会自动休眠，首次打开可能需要等待约 50 秒唤醒。

## 主要功能

| 模式 | 功能 |
|------|------|
| **后台（Admin）** | 学生管理、手动评分、能力推断、模型配置、学年管理、分析图表 |
| **学生端（Student）** | 登录后查看本人能力评估、预测分、历史成绩 |

## 本地运行

```bash
git clone https://github.com/dirknight8865-ops/Dirk.git
cd Dirk
npm install
node seed.js   # 可选：重新生成种子数据
npm start      # http://localhost:3000
```

## 默认账号

- 管理员：`admin / AbleTrack-2026!`
- 学生示例：`stuWode / pass123`

## 技术栈

- Node.js + Express
- EJS 服务端渲染
- JSON 文件存储（`data/db.json`）
- Chart.js 图表
