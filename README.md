# Hotspot Monitor

一个轻量级的 AI 热点监控工具：多源抓取候选信息 → DeepSeek 判定真实热点 → 响应式 Web 面板展示，支持浏览器推送与邮件通知。

## 功能

- **多源抓取**：Bing、Bing News、Sogou、Sogou 微信（WeChat）、Bilibili（WBI 签名）、HackerNews、X/Twitter（twitterapi.io）
- **AI 判别**：DeepSeek 为主、OpenRouter 兜底，输出 `isHot / confidence / summary`
- **公平算法**：跨「来源 × 关键词」双层轮询，避免高产源淹没小众源（默认每源最多 10 条送 AI）
- **前端面板**：
  - 关键词增删改、监控范围编辑、手动触发扫描
  - 已发现热点：搜索过滤、按来源筛选、4 种排序（相关性 / 热度 / 收录时间 / 发布时间）、分页（每页 10 条）
  - 通知中心、置信度可视化、发布时间副标签
- **通知**：浏览器 Web Push（VAPID）、邮件（SMTP / nodemailer）
- **定时**：node-cron 定时自动扫描

## 快速启动

1. 安装依赖
   ```bash
   npm install
   ```

2. 拷贝并填写环境变量
   ```bash
   cp .env.example .env
   ```
   至少配置 `DEEPSEEK_API_KEY`；其余按需填写（TwitterAPI、SMTP、VAPID）。

3. 启动后端（端口 4000）
   ```bash
   npm start
   ```

4. 另一终端启动前端（端口 5173，自动代理 `/api` → 4000）
   ```bash
   npm run dev
   ```

5. 浏览器打开 `http://localhost:5173`

### 生产构建

```bash
npm run build         # 产出 dist/
npm run start:prod    # 由 server/start-prod.js 单端口托管前端与 API
# 或一步到位：
npm run deploy
```

## 环境变量

详见 `.env.example`。关键项：

| 变量 | 用途 |
| --- | --- |
| `DEEPSEEK_API_KEY` | AI 判别（必填） |
| `OPENROUTER_API_KEY` | DeepSeek 失败时兜底（可选） |
| `TWITTERAPI_KEY` | X/Twitter 检索（可选；无则跳过） |
| `SMTP_*` / `EMAIL_RECIPIENTS` | 邮件通知（可选） |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | 浏览器推送（可选） |
| `PORT` | 后端端口，默认 4000 |

## 目录结构

```
server/         Express API、定时扫描、各源抓取、AI 调用、推送/邮件
src/            React + Vite 前端（Tailwind / Framer Motion）
public/         service-worker.js 等静态资源
data/           运行时持久化（自动创建，已 gitignore）
.env.example    环境变量样例
```

## 主要接口

- `GET /api/config` 获取关键词与监控范围
- `POST /api/keywords` / `DELETE /api/keywords/:keyword` 关键词增删
- `POST /api/scope` 更新监控范围
- `POST /api/scan` 手动触发扫描
- `GET /api/hotspots` 获取热点列表
- `GET /api/notifications` 获取通知记录
- `GET /api/push-public-key` 获取 VAPID 公钥
- `POST /api/subscribe` 浏览器推送订阅
