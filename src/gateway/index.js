// src/gateway/index.js
import "dotenv/config";
import fs from "fs";
import path from "path";
import os from "os";
import { SessionManager } from "./session-manager.js";
import { MemoryManager } from "../agent/memory.js";
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
const logger = createLogger('Gateway');

export class Gateway {
  #sessionManager;
  #memoryManager;
  #channels = [];
  #reminderStore;
  #heartbeat;
  #agentDir;
  #sandbox;

  constructor() {
    this.#sessionManager = new SessionManager();
    this.#memoryManager = new MemoryManager();
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

  async #handleMessage(msg) {

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

      // 读取 soul.md（每次处理消息都重新读，方便热更新）
      // session.messages = await this.#memoryManager.compressIfNeeded(
      //   session.messages
      // );

      try {
        // ── 记忆压缩 ──────────────────────────────────────
        const spanMemory = tracer.startSpan("memory_compress");
        session.messages = await this.#memoryManager.compressIfNeeded(session.messages);
        tracer.endSpan(spanMemory);

        // 读取 soul.md（压缩后可能已更新，重新读）
        const soulContent = this.#memoryManager.readSoul();

        // 构建本次对话的 messages
        // session.messages 保存历史，每次都带上
        const messages = [
          { role: "system", content: buildSystemPrompt(soulContent, msg.sessionId) },
          ...session.messages,
          { role: "user", content: msg.text }
        ];

        // 找到发送这条消息的 channel，用它来推送回复
        const sourceChannel = this.#channels.find(c => c.name === msg.channelName);

        // 发送「正在输入」状态
        sourceChannel?.sendTyping?.(msg.sessionId);

        // 流式推送器：攒够内容或超时就发一次
        const isHttp = msg.channelName === "http";
        let pusher;

        if (isHttp) {
          // HTTP 用 SSE chunk 推送，实时打字机效果
          pusher = {
            push: async (chunk) => {
              await sourceChannel?.sendChunk(msg.sessionId, chunk);
            },
            flush: async () => {
              await sourceChannel?.sendDone(msg.sessionId);
            }
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
          // 原有单 Agent 逻辑
          reply = await runAgentLoop(
            messages,
            (chunk) => {
              process.stdout.write(chunk);
              pusher?.push(chunk);
            },
            (toolCall) => {
              logger.debug("工具调用", { tool: toolCall.name, args: toolCall.args });
              this.#sessionManager.appendTranscript(session, {
                type: "tool_call",
                tool: toolCall.name,
                args: toolCall.args
              });

              // HTTP channel 推送工具调用状态给前端
              if (isHttp) {
                sourceChannel?.sendToolCall(msg.sessionId, {
                  name: toolCall.name,
                  args: toolCall.args,
                  status: "running"
                });
              }
              console.log(`\n  [工具] ${toolCall.name}(${JSON.stringify(toolCall.args)})`);
              sourceChannel?.sendTyping?.(msg.sessionId);
            },
            (toolName, args) => this.#sandbox.executeTool(
              toolName, args, msg.sessionId, executeTool
            )
          );
        }

        tracer.endSpan(spanAgent, { replyLength: reply.length });
        // 把剩余内容全部发出去
        await pusher?.flush();

        session.messages.push({ role: "user", content: msg.text });
        session.messages.push({ role: "assistant", content: reply });

        const rounds = session.messages.filter(m => m.role === "user").length;
        if (rounds % 5 === 0) {
          this.#memoryManager.extractAndSaveUserInfo(session.messages)
            .catch(e => console.error("[Memory] 提取用户信息失败:", e));
        }

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

      } catch(e) {
        // ── 错误追踪 ──────────────────────────────────────
        tracer.endSpan(spanTotal, { error: e.message });
        tracer.save({ sessionId: msg.sessionId, success: false, error: e.message });

        logger.error("消息处理失败", {
          sessionId: msg.sessionId,
          error: e.message,
          stack: e.stack?.slice(0, 200)
        });

        const sourceChannel = this.#channels.find(c => c.name === msg.channelName);
        await sourceChannel?.send(msg.sessionId, `❌ 出错了：${e.message}`);
        throw e;
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

      const soulContent = this.#memoryManager.readSoul();
      const messages = [
        { role: "system", content: buildSystemPrompt(soulContent) },
        ...session.messages,
        { role: "user", content: heartbeatMsg }
      ];

      const reply = await runAgentLoop(
        messages,
        (chunk) => process.stdout.write(chunk),
        (toolCall) => {
          console.log(`\n[Heartbeat] 工具调用: ${toolCall.name}`);
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
  const FLUSH_INTERVAL = 1500; // 每 1.5 秒发一次

  const flush = async () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!buffer.trim()) return;
    const toSend = buffer;
    buffer = "";
    await channel.send(sessionId, toSend);
  };

  const push = (chunk) => {
    buffer += chunk;
    // 重置定时器——有新内容就延迟发送
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, FLUSH_INTERVAL);
  };

  return { push, flush };
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
            const m = new MemoryManager();
            console.log("\n=== soul.md ===\n" + m.readSoul());
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
      console.log("命令行模式（/quit 退出，/soul 查看记忆，/status 查看状态）");
      ask();
    }
  };

  return channel;
}
