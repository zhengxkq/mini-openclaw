import fs from "node:fs";
import path from "node:path";

export class UsageLedger {
  constructor(file) { this.file = file; }

  append(event) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, JSON.stringify(event) + "\n", { mode: 0o600 });
  }

  read() {
    if (!fs.existsSync(this.file)) return [];
    const lines = fs.readFileSync(this.file, "utf8").split("\n");
    const events = new Map();
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); }
      catch { throw new Error(`用量记录第 ${index + 1} 行损坏，不能当成零调用。`); }
      if (typeof event?.id !== "string" || typeof event.at !== "string") {
        throw new Error(`用量记录第 ${index + 1} 行结构不正确。`);
      }
      events.set(event.id, event);
    }
    return [...events.values()];
  }

  summary(date = new Date().toISOString().slice(0, 10)) {
    const calls = this.read().filter(event => event.at.startsWith(date));
    const measured = calls.filter(event => event.usageSource === "provider");
    return {
      date, timezone: "UTC", callCount: calls.length,
      measuredCalls: measured.length, unknownUsageCalls: calls.length - measured.length,
      completedCalls: calls.filter(event => event.status === "completed").length,
      knownInputTokens: measured.reduce((sum, event) => sum + event.tokens.inputTokens, 0),
      knownOutputTokens: measured.reduce((sum, event) => sum + event.tokens.outputTokens, 0),
      totalTokens: measured.length === calls.length && calls.every(event => event.status === "completed")
        ? measured.reduce((sum, event) => sum + event.tokens.inputTokens + event.tokens.outputTokens, 0)
        : null,
      estimatedCost: null,
      scope: "已接入计量的对话模型请求；不含 embedding、搜索、部署费用或未落盘请求"
    };
  }
}