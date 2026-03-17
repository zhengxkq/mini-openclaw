// src/gateway/heartbeat.js
import { ReminderStore } from "../agent/reminder-store.js";
import { runAgentLoop, buildSystemPrompt } from "../agent/loop.js";
import { MemoryManager } from "../agent/memory.js";

export class HeartbeatScheduler {
  #intervalMs;
  #timer = null;
  #onBeat;           // 心跳触发时的回调
  #lastBeatAt = null;
  #isRunning = false;

  constructor({ intervalMs = 5 * 60 * 1000, onBeat }) {
    this.#intervalMs = intervalMs;
    this.#onBeat = onBeat;
  }

  start() {
    if (this.#isRunning) return;
    this.#isRunning = true;

    console.log(`[Heartbeat] 启动，间隔 ${this.#intervalMs / 1000} 秒`);

    // 启动后 10 秒触发第一次，方便测试
    setTimeout(() => this.#beat(), 10 * 1000);

    // 之后按固定间隔触发
    this.#timer = setInterval(() => this.#beat(), this.#intervalMs);
  }

  stop() {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#isRunning = false;
    console.log("[Heartbeat] 已停止");
  }

  // 手动触发一次（调试用）
  async triggerNow() {
    console.log("[Heartbeat] 手动触发");
    await this.#beat();
  }

  async #beat() {
    const now = new Date();
    const sinceLastBeat = this.#lastBeatAt
      ? Math.round((now - this.#lastBeatAt) / 1000 / 60) + " 分钟"
      : "首次";

    this.#lastBeatAt = now;

    const timestamp = now.toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour12: false
    });

    console.log(`\n[Heartbeat] 心跳触发 ${timestamp}`);

    await this.#onBeat({ timestamp, sinceLastBeat, now });
  }
}

// ─── 构建心跳触发时给 AI 的消息 ──────────────────────────────
export function buildHeartbeatMessage(timestamp, sinceLastBeat, dueReminders) {
  const reminderSection = dueReminders.length > 0
    ? `\n⏰ 以下提醒已到期，请逐一处理：\n${dueReminders.map(
        (r, i) => `${i + 1}. [ID:${r.id}] ${r.message}（目标session：${r.sessionId}）`
      ).join("\n")}`
    : "";

  return `[心跳触发]
当前时间：${timestamp}
距上次心跳：${sinceLastBeat}
${reminderSection}

请检查待处理事项并执行。如果没有任何需要处理的事情，只回复「✓」，不要发送其他消息给用户。`;
}