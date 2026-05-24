# Hotspot Monitor 项目方案

## 需求概述

1. 用户手动输入监控关键词。
2. 系统每 30 分钟自动从多个信息源抓取最新候选热点。
3. 使用 AI 对候选内容做真伪判别，过滤假冒/噪声内容。
4. 能通过浏览器实时推送或邮件通知用户热点发现。
5. 提供响应式 Web 页面展示监控范围、关键词、热点列表、通知记录。
6. 后续支持封装为 Agent Skills，供其他 AI 调用。

## 信息源设计

- 关键词搜索引擎：Bing、DuckDuckGo。
- 新闻搜索：Bing News。
- X/Twitter 实时搜索：使用 `twitterapi.io` 的 `advanced_search` 端点。
- 采用多源抓取避免单一依赖。

## AI 判别方案

- 使用 DeepSeek API 作为主要 AI 判别引擎，符合“使用 DeepSeek 的 key”要求。
- DeepSeek 文档显示其 API 与 OpenAI/Anthropic 兼容：`
  https://api.deepseek.com/chat/completions`。
- 若需要，后续也可增加 OpenRouter 的接入方式。

## 通知方案

- 浏览器实时推送：采用 Web Push API + `web-push`，前端通过 service worker 订阅推送。
- 邮件通知：采用 `nodemailer`，通过 SMTP 配置发送到指定收件人。
- 后端发现新热点时，向所有订阅者发送通知。

## 架构设计

- 前端：React + Vite，响应式页面，包含关键词管理、监控范围、手动扫描、通知卡片、热点列表。
- 后端：Express + Node，负责：
  - 关键词存储与管理
  - 多源抓取候选热点
  - DeepSeek AI 判别
  - 定时任务（每 30 分钟）
  - 浏览器推送与邮件通知
  - 推送订阅管理

## 数据持久化

- 本地 JSON 文件：`data/keywords.json`、`data/hotspots.json`、`data/subscriptions.json`
- 轻量、敏捷，适合小型工具类项目。

## 关键接口

- `GET /api/config`：获取当前关键词与监控范围
- `POST /api/keywords`：添加关键词
- `DELETE /api/keywords/:keyword`：删除关键词
- `POST /api/scope`：更新监控范围
- `POST /api/scan`：立即触发扫描
- `GET /api/hotspots`：获取热点列表
- `GET /api/notifications`：获取通知记录
- `POST /api/subscribe`：浏览器推送订阅
- `POST /api/test-email`：测试邮件通知配置

## 开发计划

1. 先完成 Web 页面与后端基础功能。
2. 加入 DeepSeek AI 判别接口。
3. 实现多源搜索抓取与去重。
4. 实现 30 分钟定时扫描。
5. 补充浏览器推送与邮件通知。
6. 验证整体流程。
7. 包装 Agent Skills 版本（后续扩展）。

## MCP 文档参考

- DeepSeek API 文档：`https://api-docs.deepseek.com/`，支持 OpenAI-compatible chat completions。
- OpenRouter API 文档：`https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request`，说明了最新认证与请求参数。

---

## 结论

当前实现方向为：

- 使用 `DEEPSEEK_API_KEY` 作为 AI 判别引擎。
- 使用 `twitterapi.io` 获取 Twitter/X 热点。
- 每 30 分钟执行扫描。
- 支持浏览器推送与邮件通知。
- 先完成 Web 版，再封装为 Agent Skills。
