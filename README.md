# Hotspot Monitor

一个轻量级的 AI 热点监控工具，支持多源搜索、Twitter (X) 热点抓取、DeepSeek AI 判真伪和响应式 Web 页面展示。

## 功能

- 用户可手动输入监控关键词
- 支持监控范围配置，例如 `AI 编程`
- 定时自动从 Bing / DuckDuckGo / Bing News / Twitter 多源抓取候选热点
- 通过 DeepSeek AI（兜底 OpenRouter）判定热点是否真实、是否值得关注
- Web 页面实时展示热点与通知

## 快速启动

1. 安装依赖

```bash
npm install
```

2. 拷贝环境变量

```bash
copy .env.example .env
```

3. 填写 `.env` 中的 `DEEPSEEK_API_KEY`、`TWITTERAPI_KEY` 和通知相关配置

4. 运行 Web 开发环境

```bash
npm run dev
```

5. 运行后端服务

```bash
npm start
```

6. 访问 `http://localhost:5173` 查看前端页面，后端 API 运行在 `http://localhost:4000`

> 建议先在 `.env` 中配置 `SMTP_*` 或 `VAPID_*`，以启用邮件和浏览器推送通知。

前端开发服务器默认代理 `/api` 到 `http://localhost:4000`。

## 目录结构

- `server/` 后端 API 和定时扫描
- `src/` React 前端代码
- `public/` 静态页面模板
- `data/` 本地持久化关键词、热点与通知
