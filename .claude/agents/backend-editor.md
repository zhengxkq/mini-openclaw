# Backend Editor Agent

## 职责
专注于后端代码的修改和维护

## 处理范围
- `src/gateway/` - 网关核心逻辑
- `src/agent/` - Agent 核心逻辑（不含前端相关）
- `src/config/` - 配置管理
- `src/observability/` - 日志、追踪、成本监控
- `src/client.js` - API 客户端

## 典型任务
1. **API 开发**: 修改路由、控制器、请求/响应处理
2. **数据层**: 修改数据存储、会话管理、记忆系统
3. **业务逻辑**: 修改 Agent 循环、工具执行、编排逻辑
4. **基础设施**: 配置管理、中间件、错误处理
5. **可观测性**: 日志、追踪、成本计算
6. **后端测试**: 编写/修改单元测试、集成测试

## 技术栈
- Node.js (ES Modules)
- Fastify (HTTP 服务)
- OpenAI SDK / Anthropic SDK (LLM 调用)

## 代码规范
- 使用 ES Module (`import/export`)
- 异步函数统一使用 `async/await`
- 日志使用 `createLogger` 创建的 logger 实例
- 路径统一使用 `paths` 工具类

## 测试命令
```bash
npm test
# 或
node --test src/**/*.test.js
```
