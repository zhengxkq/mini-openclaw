// src/gateway/index.js
import "dotenv/config";
import fs from "fs";
import readline from "node:readline";
import path from "path";
import os from "os";
import { SessionManager } from "./session-manager.js";
import { runAgentLoop, buildSystemPrompt } from "../agent/loop.js";
import { HeartbeatScheduler, buildHeartbeatMessage } from "./hearbeat.js";
import { ReminderStore } from "../agent/reminder-store.js";
import { Sandbox } from "../agent/sandbox.js";
import { executeTool } from "../agent/tools.js";
import { runMultiAgent } from "../agent/orchestrator.js";
import { shouldUseMultiAgent } from "../agent/loop.js";
import { Tracer, generateTraceId } from "../observability/tracer.js";
import { costTracker } from "../observability/cost-tracker.js";
import { createLogger } from "../observability/logger.js";
import { paths, ensureDataDirs } from "../config/paths.js";
import { AgentRunError } from "../agent/run-policy.js";
import { handleMemoryCommand } from "../agent/memory-command.js";
import { memoryStore } from "../agent/memory-runtime.js";
import { formatMemoryPrompt, selectMemories, replaceSystemContext } from "../agent/memory-input.js";


const logger = createLogger('Gateway');

export class Gateway {
  #sessionManager;
  #channels = [];
  #reminderStore;
  #heartbeat;
  #agentDir;
  #sandbox;


  constructor() {
    this.#sessionManager = new SessionManager();
    this.#reminderStore = new ReminderStore();
    this.#sandbox = new Sandbox();

    ensureDataDirs(); // 启动时确保所有目录存在
    this.#agentDir = paths.agentDir();
    fs.mkdirSync(this.#agentDir, { recursive: true });
    console.log("🦞 Gateway 初始化完成");
  }

  registerChannel(channel) {
    this.#channels.push(channel);
    channel.onMessage = (msg) => this.#handleMessage(msg);
    console.log(`[Gateway] 注册 Channel: ${channel.name}`);
  }

  async #replyMemoryCommand(msg, text) {
    const channel = this.#channels.find(c => c.name === msg.channelName);
    if (msg.channelName === "http") {
      await channel?.sendChunk(msg.sessionId, text);
      await channel?.sendDone(msg.sessionId);
    } else await channel?.send(msg.sessionId, text);
  }

  async #handleMessage(msg) {

    const memoryReply = handleMemoryCommand(msg.text, {
      root: paths.root, store: memoryStore, sessionId: msg.sessionId
    });
    if (memoryReply !== null) {
      await this.#replyMemoryCommand(msg, memoryReply);
      return;
    }

    // ── 先检查是不是 HITL 审批命令，是的话直接处理不走 Agent ──
    const approvalResult = this.#sandbox.handleApproval(msg.text, msg.sessionId);
    if (approvalResult) {
      const channel = this.#channels.find(c => c.name === msg.channelName);
      await channel?.send(msg.sessionId, approvalResult);
      return;
    }


    const session = this.#sessionManager.getOrCreate(msg.sessionId);

    return session.queue.enqueue(async () => {
      console.log(`\n[Gateway] 收到消息 | Session: ${msg.sessionId}`);
      
      // ── 初始化 Trace ──────────────────────────────────────
      const tracer = new Tracer(generateTraceId());
      const spanTotal = tracer.startSpan("handle_message", {
        sessionId: msg.sessionId,
        messageLength: msg.text.length,
        startTime: new Date().toISOString()
      });

      logger.info("收到消息", { sessionId: msg.sessionId, text: msg.text.slice(0, 50) });
      // 记录用户消息到 JSONL
      this.#sessionManager.appendTranscript(session, {
        type: "user_message",
        content: msg.text
      });

      let pusher;
      try {
        // 读取当前有效记忆
        const memoryScopes = ["agent:default", `session:${msg.sessionId}`];
        const memoryContent = formatMemoryPrompt(memoryStore, memoryScopes);

        // 构建本次对话的 messages
        // session.messages 保存历史，每次都带上
        const messages = [
          { role: "system", content: buildSystemPrompt(memoryContent, msg.sessionId) },
          ...session.messages,
          { role: "user", content: msg.text }
        ];

        // 找到发送这条消息的 channel，用它来推送回复
        const sourceChannel = this.#channels.find(c => c.name === msg.channelName);

        // 发送「正在输入」状态
        await sourceChannel?.sendTyping?.(msg.sessionId);

        
        const isHttp = msg.channelName === "http";
        

        if (isHttp) {
          // HTTP 用 SSE chunk 推送，实时打字机效果
          pusher = {
            push: async chunk => {
              await sourceChannel?.sendChunk(msg.sessionId, chunk);
            },
            flush: async () => {}
          };
        } else {
          // Telegram 用原来的批量推送
          pusher = sourceChannel
            ? createStreamPusher(msg.sessionId, sourceChannel)
            : null;
        }

        // ── Agent 执行 ────────────────────────────────────
        const spanAgent = tracer.startSpan("agent_loop", { mode: shouldUseMultiAgent(msg.text) ? "multi" : "single" });
        
        let reply;

        if (shouldUseMultiAgent(msg.text)) {
          console.log("[Gateway] 启动多 Agent 模式");
          // 先给用户一个即时反馈
          sourceChannel?.sendTyping?.(msg.sessionId);

          reply = await runMultiAgent(msg.text, (chunk) => {
            process.stdout.write(chunk);
            pusher?.push(chunk);
          });
        } else {
          session.contextState ??= {};
          // 原有单 Agent 逻辑
          reply = await runAgentLoop(
            messages,
            (chunk) => {
              process.stdout.write(chunk);
              return pusher?.push(chunk);
            },
            async (toolCall) => {
              const { id, name, args, status = "running" } = toolCall;
              if (status === "running") {
                logger.debug("工具调用", { tool: name, args });
                this.#sessionManager.appendTranscript(session, {
                  type: "tool_call", tool: name, args, callId: id
                });
                console.log(`\n  [工具] ${name}(${JSON.stringify(args)})`);
              }
              if (isHttp) {
                await sourceChannel?.sendToolCall(msg.sessionId, { id, name, args, status });
              }
            },
            (toolName, args) => this.#sandbox.executeTool(
              toolName, args, msg.sessionId, executeTool
            ),
            {
              onEvent: isHttp ? event => sourceChannel.sendRunEvent(msg.sessionId, event) : undefined,
              contextState: session.contextState,
              refreshContext: input => {
                const current = formatMemoryPrompt(memoryStore, memoryScopes);
                replaceSystemContext(input, buildSystemPrompt(current, msg.sessionId));
                console.log("[当前记忆]", selectMemories(memoryStore, memoryScopes)
                  .map(row => ({ key: row.key, version: row.version, scope: row.scope })));
              }
            }
          );
        }

        tracer.endSpan(spanAgent, { replyLength: reply.length });
        // 把剩余内容全部发出去
        await pusher?.flush();

        session.messages.push({ role: "user", content: msg.text });
        session.messages.push({ role: "assistant", content: reply });

        this.#sessionManager.appendTranscript(session, {
          type: "agent_reply",
          content: reply
        });

        // ── 费用检查 ──────────────────────────────────────
        const budget = costTracker.checkBudget(10);
        if (budget.exceeded) {
          logger.warn("今日费用超预算", {
            current: `¥${budget.current.toFixed(4)}`,
            limit: `¥${budget.limit}`
          });
          sourceChannel?.send(msg.sessionId, "⚠️ 今日 API 费用已超预算，请联系管理员");
        }

        // ── 保存 Trace ────────────────────────────────────
        tracer.endSpan(spanTotal, { success: true, replyLength: reply.length });
        tracer.save({ sessionId: msg.sessionId, success: true });

        logger.info("消息处理完成", {
          sessionId: msg.sessionId,
          replyLength: reply.length
        });

        console.log();
        return reply;

      } catch (error) {
        pusher?.cancel?.();
        const code = error instanceof AgentRunError ? error.code : "INTERNAL_ERROR";
        const message = error instanceof AgentRunError
          ? error.message
          : "服务执行异常，本次任务未完成，请稍后重试。";
        const sourceChannel = this.#channels.find(c => c.name === msg.channelName);

        if (msg.channelName === "http") {
          await sourceChannel?.sendError(msg.sessionId, `${code}：${message}`);
        } else {
          await sourceChannel?.send(msg.sessionId, `❌ ${code}：${message}`);
        }

        this.#sessionManager.appendTranscript(session, {
          type: "run_failed", code, message
        });
        tracer.endSpan(spanTotal, { error: message, code });
        tracer.save({ sessionId: msg.sessionId, success: false, code, error: message });
        logger.error("消息处理失败", { sessionId: msg.sessionId, code, error: error.message });
        // 已经向用户报告失败；这里结束本次渠道任务，队列继续服务下一条消息。
        return;
      } finally {
        if (msg.channelName === "http") {
          const sourceChannel = this.#channels.find(c => c.name === msg.channelName);
          await sourceChannel?.sendDone(msg.sessionId);
        }
      }
      
    });
  }

  async start() {
    for (const channel of this.#channels) {
      await channel.start();
    }

    this.#sandbox.setNotifyFn(async (sessionId, message) => {
      const channel = this.#channels.find(c => sessionId.startsWith(c.name));
      await channel?.send(sessionId, message);
    });

    this.#heartbeat = new HeartbeatScheduler({
      intervalMs: 5 * 60 * 1000,
      onBeat: ({timestamp, sinceLastBeat, now}) => this.#handleHeartbeat({timestamp, sinceLastBeat, now})
    });

    this.#heartbeat.start();

    console.log(`🦞 Gateway 运行中，${this.#channels.length} 个 Channel 已连接\n`);
  }



   getSessionInfo(sessionId) {
    const session = this.#sessionManager.getOrCreate(sessionId);
    return {
      messageCount: session.messages.length,
      isRunning: session.queue.isRunning,
      pending: session.queue.pendingCount
    };
  }


  async #handleHeartbeat({ timestamp, sinceLastBeat }) {
    const dueReminders = this.#reminderStore.getDue();

    console.log(`[Heartbeat] 到期提醒数量: ${dueReminders.length}`);
    if (dueReminders.length > 0) {
      dueReminders.forEach(r => console.log(`  - ${r.message} (session: ${r.sessionId})`));
    }

    const heartbeatMsg = buildHeartbeatMessage(timestamp, sinceLastBeat, dueReminders);

    // 如果没有到期提醒，直接跳过 AI 调用，静默完成
    if (dueReminders.length === 0) {
      console.log("[Heartbeat] 无到期提醒，静默完成");
      return;
    }

    const session = this.#sessionManager.getOrCreate("heartbeat", "default");

    // ← 加了 await，等任务真正完成
    await session.queue.enqueue(async () => {
      console.log("[Heartbeat] 开始执行心跳任务");

      const memoryScopes = ["agent:default", "session:heartbeat"];
      const memoryContent = formatMemoryPrompt(memoryStore, memoryScopes);
      const messages = [
        { role: "system", content: buildSystemPrompt(memoryContent) },
        ...session.messages,
        { role: "user", content: heartbeatMsg }
      ];

      const reply = await runAgentLoop(
        messages,
        chunk => process.stdout.write(chunk),
        toolCall => console.log(`\n[Heartbeat] 工具 ${toolCall.status}: ${toolCall.name}`),
        (name, args) => this.#sandbox.executeTool(name, args, "heartbeat", executeTool),
        {
          refreshContext: input => replaceSystemContext(input,
            buildSystemPrompt(formatMemoryPrompt(memoryStore, memoryScopes)))
        }
      );

      console.log("\n[Heartbeat] AI 回复完成");

      session.messages.push({ role: "user", content: heartbeatMsg });
      session.messages.push({ role: "assistant", content: reply });
      if (session.messages.length > 10) {
        session.messages = session.messages.slice(-10);
      }

      // 直接推送提醒内容，不依赖 AI 的回复判断
      // AI 的职责只是生成推送文案，我们自己决定推不推
      await this.#pushReminders(dueReminders);

      // 标记完成
      for (const r of dueReminders) {
        this.#reminderStore.markDone(r.id);
        console.log(`[Heartbeat] 提醒已完成: ${r.id}`);
      }
    });
  }

  // 直接按提醒的 session_id 推送，不走 AI 判断
  async #pushReminders(dueReminders) {
    for (const reminder of dueReminders) {
      // 找到对应的 channel
      // session_id 格式是 "telegram-xxxxx" 或 "cli-user"
      const channel = this.#channels.find(c => reminder.sessionId.startsWith(c.name));

      if (!channel) {
        console.error(`[Heartbeat] 找不到 channel，session_id: ${reminder.sessionId}`);
        console.error(`[Heartbeat] 当前 channels: ${this.#channels.map(c => c.name).join(", ")}`);
        console.error(`[Heartbeat] 所有 sessions: ${this.#sessionManager.getAllSessionIds().join(", ")}`);
        continue;
      }

      const msg = `⏰ 提醒：${reminder.message}`;
      console.log(`[Heartbeat] 推送到 ${reminder.sessionId}: ${msg}`);
      await channel.send(reminder.sessionId, msg);
    }
  }


  async triggerHeartbeat() {
    await this.#heartbeat?.triggerNow();
  }
}

// ─── 流式推送器 ───────────────────────────────────────────────
// 把零散的 chunk 攒起来批量发送，避免触发 Telegram 频率限制
function createStreamPusher(sessionId, channel) {
  let buffer = "";
  let timer = null;
  let deliveryError = null;
  let inFlight = Promise.resolve();
  const FLUSH_INTERVAL = 1500;

  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (buffer.trim()) {
      const toSend = buffer;
      buffer = "";
      inFlight = inFlight.then(() => channel.send(sessionId, toSend));
      inFlight.catch(error => { deliveryError = error; });
    }
    // 没有新缓冲时，也要等已开始的发送结束。
    return inFlight;
  };

  const push = (chunk) => {
    if (deliveryError) throw deliveryError;
    buffer += chunk;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      flush().catch(error => { deliveryError = error; });
    }, FLUSH_INTERVAL);
  };

  const cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    buffer = "";
  };

  return { push, flush, cancel };
}

// ─── 启动入口：根据环境决定用哪个 Channel ─────────────────────
const gateway = new Gateway();
const { HttpChannel } = await import("../channels/http.js");
const http = new HttpChannel(process.env.HTTP_PORT ?? 3000);
gateway.registerChannel(http);

if (process.env.TELEGRAM_TOKEN) {
  // 有 Telegram Token 就用 Telegram
  const { TelegramChannel } = await import("../channels/telegram.js");
  const telegram = new TelegramChannel();
  // 让 Channel 知道自己的名字，Gateway 路由回复时要用
  telegram.name = "telegram";
  gateway.registerChannel(telegram);
} else {
  // 没有就降级到命令行
  console.log("未配置 TELEGRAM_TOKEN，使用命令行模式");
  const cliChannel = await createCliChannel();
  gateway.registerChannel(cliChannel);
}

await gateway.start();

// ─── 命令行 Channel（开发备用）────────────────────────────────
async function createCliChannel() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const channel = {
    name: "cli",
    onMessage: null,
    send: async (sessionId, text) => console.log(`\nMolty：${text}`),
    sendTyping: async () => process.stdout.write("\n[思考中...]"),
    start: async () => {
      const ask = () => {
        rl.question("\n你：", async (input) => {
          const text = input.trim();
          if (!text) return ask();
          if (text === "/quit") { rl.close(); return; }
          if (text === "/soul") {
              console.log("\n=== 当前有效记忆 ===\n" +
              formatMemoryPrompt(memoryStore, ["agent:default", "session:cli-user"]));
            return ask();
          }
          if (text === "/status") {
            const info = gateway.getSessionInfo("cli-user");
            console.log(`\n历史: ${info.messageCount} 条，运行中: ${info.isRunning}`);
            return ask();
          }

          if (text === "/heartbeat") {
            console.log("\n手动触发心跳...");
            await gateway.triggerHeartbeat();
            return ask();
          }
          await channel.onMessage({ sessionId: "cli-user", text, channelName: "cli" });
          ask();
        });
      };
      console.log("命令行模式（/quit 退出，/soul 查看当前记忆，/memory list 管理入口，/status 查看状态）");
      ask();
    }
  };

  return channel;
}
