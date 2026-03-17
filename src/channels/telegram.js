// src/channels/telegram.js
import TelegramBot from "node-telegram-bot-api";
import { BaseChannel } from "./base.js";
import { HttpsProxyAgent } from "https-proxy-agent";

export class TelegramChannel extends BaseChannel {
  #bot;
  #allowedUserIds;
  // sessionId → chatId 的映射，发消息时需要用 chatId
  #chatMap = new Map();

  constructor() {
    super("telegram");

    if (!process.env.TELEGRAM_TOKEN) {
      throw new Error("缺少环境变量 TELEGRAM_TOKEN");
    }

    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    // 在 telegram.js 构造函数里临时加这行
    console.log("[Telegram] 代理配置:", process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "未配置");
    console.log('proxyUrl', proxyUrl);


    this.#bot = new TelegramBot(process.env.TELEGRAM_TOKEN, {
        polling: false,
        // request: proxyUrl ? { agent: new HttpsProxyAgent(proxyUrl) } : undefined
        request: proxyUrl
    });

    // 从环境变量读白名单，支持多个 ID 用逗号分隔
    this.#allowedUserIds = (process.env.TELEGRAM_ALLOWED_USER_IDS || "")
      .split(",")
      .map(id => id.trim())
      .filter(Boolean);

    console.log(`[Telegram] 白名单用户: ${this.#allowedUserIds.join(", ")}`);
  }

  async start() {
    // 启动轮询模式——Bot 每隔一段时间问 Telegram「有新消息吗」
    // 另一种是 Webhook 模式（Telegram 主动推送），需要公网域名，第 14 天讲
    await this.#bot.startPolling();

    this.#bot.on("message", (msg) => this.#handleIncoming(msg));
    this.#bot.on("polling_error", (err) => {
      console.error("[Telegram] 轮询出错:", err.message);
    });

    console.log("[Telegram] Bot 启动成功，开始监听消息");
  }

  async stop() {
    await this.#bot.stopPolling();
    console.log("[Telegram] Bot 已停止");
  }

  // 发消息给用户
  async send(sessionId, text) {
    const chatId = this.#chatMap.get(sessionId);
    if (!chatId) {
      console.error(`[Telegram] 找不到 sessionId 对应的 chatId: ${sessionId}`);
      return;
    }

    try {
      // Telegram 单条消息有 4096 字符上限
      // 超长时自动分段发送
      const chunks = splitMessage(text, 4000);
      for (const chunk of chunks) {
        await this.#bot.sendMessage(chatId, chunk, {
          parse_mode: "Markdown"
        });
      }
    } catch (e) {
      // Markdown 解析失败时降级为纯文本重试
      console.error("[Telegram] 发送失败，降级为纯文本:", e.message);
      try {
        await this.#bot.sendMessage(chatId, text);
      } catch (e2) {
        console.error("[Telegram] 纯文本发送也失败了:", e2.message);
      }
    }
  }

  // 发送「正在输入」状态，让用户知道 Bot 在处理
  async sendTyping(sessionId) {
    const chatId = this.#chatMap.get(sessionId);
    if (!chatId) return;
    try {
      await this.#bot.sendChatAction(chatId, "typing");
    } catch {}
  }

  // 处理收到的消息
  #handleIncoming(msg) {
    const userId = String(msg.from?.id);
    const chatId = msg.chat.id;
    const text = msg.text?.trim();

    // 没有文字内容（比如图片、贴纸）暂时忽略
    if (!text) {
      this.#bot.sendMessage(chatId, "暂时只支持文字消息 🦞");
      return;
    }

    // 白名单检查
    if (this.#allowedUserIds.length > 0 && !this.#allowedUserIds.includes(userId)) {
      console.log(`[Telegram] 拒绝非白名单用户: ${userId}`);
      this.#bot.sendMessage(chatId, "⛔ 你没有权限使用这个 Bot");
      return;
    }

    // 用 chatId 作为 sessionId，同一个聊天窗口共享同一个 session
    const sessionId = `telegram-${chatId}`;
    this.#chatMap.set(sessionId, chatId);

    console.log(`[Telegram] 收到消息 | 用户: ${userId} | 内容: ${text}`);

    // 交给 Gateway 处理
    this.onMessage?.({ sessionId, text, userId, channelName: "telegram" });
  }
}

// 把长文本按最大长度分段
function splitMessage(text, maxLength) {
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    // 尽量在换行处截断，避免截断单词或句子
    let cutAt = remaining.lastIndexOf("\n", maxLength);
    if (cutAt < maxLength * 0.5) cutAt = maxLength; // 找不到换行就硬截
    chunks.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt).trim();
  }

  return chunks;
}