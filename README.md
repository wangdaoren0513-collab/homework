# 📚 每周作业小管家

给小学生用的每周作业记录看板：按周展示、每天可多条作业、一键标记完成、历史完成率统计，手机 / 平板 / 电脑自适应。

作业数据可以存在**云数据库**里，这样手机、平板、电脑不管在哪、用什么网络，看到的都是**同一份**，真正做到「在手机上做的作业，电脑立刻能看到」。

---

## 一、云端存储怎么选？

打开「设置 → 云端存储」，下拉框里选一种：

| 方式 | 适合谁 | 数据存在哪 | 要不要服务器 |
| --- | --- | --- | --- |
| **Supabase 云数据库**（推荐） | 想要真正的云端、随时跨设备 | Supabase 的免费 Postgres | 不用，注册填 key 即可 |
| **自建服务 / Cloudflare Worker** | 想数据完全自己掌控、零月费 | 你自己跑的 `server.js` | 需要（家里电脑或任意云） |
| **只存在这台设备** | 只用一台设备、不共享 | 本机浏览器 | 不用 |

三种方式在网页「设置」里可随时切换，切换后按提示填对应信息即可，不用改代码。

---

## 二、方式 A：Supabase 云数据库（推荐，约 3 分钟）

> 数据存在 Supabase 免费 Postgres 里，手机 / 电脑 / 平板填**同一个家庭码**就能看到同一份作业，在外面也能同步。

### 1. 建项目
打开 [supabase.com](https://supabase.com) 注册并新建项目（免费套餐即可，地区建议 Singapore 或 Tokyo，国内访问更快）。

### 2. 建数据表
左侧 **SQL Editor → New query**，粘贴下面这段后点 **Run**：

```sql
create table homework (
  code text primary key,
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table homework enable row level security;

create policy "homework_all" on homework
  for all to anon using (true) with check (true);
```

> 每个「家庭码」对应表里的一行，`items` 是一个 JSON 数组，存这个家庭所有作业。

### 3. 填 key
左侧 **Project Settings → API**，把 **Project URL** 和 **anon public key** 复制回来，填到网页设置里，再填一个**家庭码**（建议用 `姓名+班级+随机数字` 这种难猜的组合）。点「测试连接」，出现绿色的「已连接云端」就成功了。

### 隐私说明
anon key 是公开的（它就在网页里），配合上面的策略，**家庭码就相当于数据的密码**：只要知道「项目地址 + 家庭码」就能读 / 写这一份数据。所以请务必用**难猜的家庭码**。若对隐私要求更高，可改用下面的「自建服务 / Cloudflare Worker」方式（数据不经过公开 key）。

---

## 三、方式 B：自建服务 / Cloudflare Worker（数据完全自己掌控）

### 家里电脑当服务器（零成本）
1. 电脑装 Node.js（[nodejs.org](https://nodejs.org) LTS 版）
2. 双击 `启动.command`（macOS）或 `启动.bat`（Windows）
3. 屏幕显示地址，例如 `http://192.168.1.5:3000`
4. 手机连**家里同一个 Wi-Fi**，用浏览器打开这个地址
5. 两边填**同一个家庭码**，打开「开启自动同步」

> 电脑关机或关掉黑窗口，手机就访问不了；重新双击启动即可，数据在 `data/` 目录里一直保留。

### 部署到公网（在外面也能用）
把目录放到任意能跑 Node 的地方（Render / Railway / Zeabur / 轻量应用服务器等）：

```bash
node server.js          # 端口读环境变量 PORT
pm2 start server.js --name homework   # 生产环境用 pm2 守护
```

网页端「设置 → 云端存储」选「自建服务 / Cloudflare Worker」，云端地址填后端地址（同源部署留空即可，例如 `https://hwk.example.com/api`）。

---

## 四、技术方案

| 项目 | 选型 | 理由 |
| --- | --- | --- |
| 前端 | 原生 HTML + CSS + JavaScript（零框架、零构建） | 无编译步骤，双击就能跑；加载秒开，老设备也流畅 |
| 布局 | CSS Grid + 媒体查询 | 手机 1 列、平板 2 列、电脑 4~7 列看板，同一套代码自适应 |
| 本地缓存 | `localStorage` | 刷新、关浏览器都不丢；无需登录即可使用 |
| 云端存储 | Supabase Postgres（REST API）或自建 `server.js` | 可插拔：同一套前端，选哪种后端就填对应配置 |
| 一致性 | 上传前先拉取合并，按 `updatedAt` 取最新，删除用软删除标记 | 避免一端全量数据把另一端还没上传的新作业覆盖掉 |

**为什么不用框架 / 数据库中间件**：应用只有「增删改查 + 统计」四件事，引入 React、MySQL 会让部署和运维成本翻倍，而这个应用需要的是「打开就能用、坏了容易修」。

---

## 五、功能

- **按周看板**：周一起算 7 列看板，今天高亮；每天可添加多条作业
- **作业类型**：预习、写、读、背、说、听、复习、其他（原来的「做」已合并进「写」）
- **作业字段**：科目（语文 / 数学 / 英语）、类型、内容描述、安排日期、截止日期
- **状态管理**：新增、编辑、删除；圆圈按钮一键切换未完成 / 已完成；逾期未完成标红
- **筛选查看**：本周视图按科目 + 状态筛选；历史视图按时间范围（近 4 周 / 近 12 周 / 全部）+ 科目 + 状态筛选
- **完成率统计**：本周完成率环形图、各科进度条；历史视图列出每一周的完成率，点击可跳回该周
- **跨设备同步**：同一个家庭码共享数据；开启后每 30 秒自动同步，切回页面时也会同步；顶部横幅会明确提示「现在是不是单机模式」
- **数据备份**：一键导出 / 导入 JSON 备份文件

---

## 六、本地运行

```bash
cd homework-app
node server.js
# 打开 http://localhost:3000
```

不装任何依赖（`server.js` 只用 Node 内置模块）。换端口：`PORT=8080 node server.js`。

---

## 七、接口说明（自建服务方式）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/state?code=家庭码` | 拉取该家庭码下的全部作业 |
| POST | `/api/state` | 合并后写回，`body: { code, items: [...] }` |

Supabase 方式走其官方 REST：`GET/POST /rest/v1/homework`，由家庭码过滤，详见上面的建表语句。

---

## 八、目录结构

```
homework-app/
├── index.html       # 页面结构（含云端存储设置 UI）
├── styles.css       # 响应式样式
├── app.js           # 全部前端逻辑（存储、渲染、筛选、统计、同步）
├── server.js        # 零依赖后端：静态托管 + /api/state 数据接口
├── 启动.command      # macOS 双击启动
├── 启动.bat         # Windows 双击启动
└── data/            # 服务端数据目录（自动创建，按家庭码存 JSON）
```

---

## 九、给家长的两点提醒

1. 浏览器「清除浏览数据 / 无痕模式」会清掉本机的 localStorage，重要数据请定期用「导出备份」保存，或开启云端同步。
2. 家庭码等同于数据钥匙，别用太简单的组合，也不要发到公开场合。
