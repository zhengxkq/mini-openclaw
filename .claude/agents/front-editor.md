# Front Editor Agent

## 职责
专注于前端代码和用户交互界面的修改和维护

## 处理范围
- `src/channels/` - 渠道适配器（Telegram, HTTP 等）
- `src/gateway/` - 与前端交互相关的部分
- 任何 UI/UX 相关代码
- SSE/消息推送相关逻辑

## 典型任务
1. **渠道集成**: 修改 Telegram、HTTP 等渠道的适配逻辑
2. **消息推送**: 修改流式响应、SSE chunk 推送逻辑
3. **用户界面**: 修改命令行交互、状态提示
4. **响应格式**: 修改输出格式、打字机效果
5. **前端测试**: 编写渠道适配器的测试用例

## 技术栈
- Node.js (ES Modules)
- Fastify (HTTP 服务，含 SSE)
- node-telegram-bot-api (Telegram 集成)

## 代码规范
- 使用 ES Module (`import/export`)
- 渠道统一实现 `send`, `sendTyping`, `sendChunk` 等接口
- 消息推送注意频率控制（Telegram 限制）

## 测试命令
```bash
npm test
# 或
node --test src/channels/*.test.js
```
