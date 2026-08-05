# 🦞 Mini-OpenClaw

一个自托管的 AI 助手（Agent），内置记忆系统与多通道接入。核心是 **Molty**——一只太空龙虾，通过 Web / Telegram / 命令行与它对话。

## 功能特性

- **多通道接入**：Web（SSE 流式 + 打字机效果）、Telegram、命令行，统一消息路由
- **Agent 循环**：流式工具调用，支持连续多工具、多 Agent 编排（对比/并行类任务自动触发）
- **多层记忆系统**：
  - **情景记忆**（Episodic）：对话向量化存储，回复时检索相关历史注入 prompt
  - **行为规则**（Procedural）：用户自定义规则（如"回复用英文"），Agent 可自行增删
  - **会话摘要**：长对话自动压缩，重要信息沉淀进 soul.md
- **工具集**：网页搜索（Tavily）、天气、文件读取、计算、定时提醒、费用统计、行为规则管理
- **安全沙箱**：工具权限分级 + 危险命令检测 + 人工审批（HITL）
- **可观测性**：链路追踪（trace）、日志、API 成本统计与预算告警

## 快速开始

### 1. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入 DashScope API Key 等
```

| 变量 | 说明 |
|---|---|
| `DASHSCOPE_API_KEY` | DashScope（通义千问）API Key，必填 |
| `BASE_URL` / `MODEL` | 对话模型接口与模型名（默认 `qwen3.6-plus`） |
| `EMBEDDING_MODEL` 等 | Embedding 模型（情景记忆用） |
| `TELEGRAM_TOKEN` | Telegram Bot Token，可选；不填则降级为命令行模式 |
| `TAVILY_API_KEY` | Tavily 搜索 API Key，可选（web_search 工具用） |

### 2. 本地开发

```bash
# 后端（HTTP 端口 3000）
npm run dev

# 前端（Vite 端口 5173，/api 代理到 3000）
cd client && npm install && npm run dev
```

打开 http://localhost:5173 即可对话。未配置 Telegram Token 时，后端会进入命令行模式，可直接在终端对话（`/soul` 查看记忆，`/status` 查看状态）。

### 3. Docker 部署

```bash
cp .env.example .env
docker compose up -d --build
```

前端通过 Nginx 暴露 80/443 端口（HTTPS 证书挂载 `/app/my-openlaw/ssl`），后端仅在容器内网通信，数据持久化在 `openclaw-data` 卷。

> 运行时数据（会话记录、记忆、提醒）默认存放在 `~/.my-openclaw/`，可用 `DATA_DIR` 环境变量覆盖（Docker 中为 `/data`）。**这些数据不入库**。

## 测试

```bash
npm test
```

运行 5 个纯逻辑单元测试（队列、会话管理、技能加载、记忆模块），不调用真实 API。

## 项目结构

```
src/
├── gateway/          # 网关：会话队列、心跳、消息路由（入口 index.js）
├── agent/            # Agent 核心：循环、工具、记忆、沙箱、编排、Skills
│   └── default/      # 内置 Agent 配置（soul.md 人设、agents.md 行为规则、skills）
├── channels/         # 渠道适配：HTTP（SSE）/ Telegram / 命令行
├── observability/    # 日志、链路追踪、成本统计
└── config/           # 路径管理（数据目录）
client/               # 前端（React 19 + Vite + Tailwind + Zustand）
```

## 相关

- 底层模型：阿里云 DashScope（OpenAI 兼容接口）
- 向量存储：vectra（本地）
- 网页搜索：Tavily
