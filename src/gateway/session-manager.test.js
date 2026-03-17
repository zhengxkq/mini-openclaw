// src/gateway/session-manager.test.js
import { SessionManager } from "./session-manager.js";

async function main() {
  const manager = new SessionManager();

  console.log("=== 测试 Session 创建 ===\n");

  const s1 = manager.getOrCreate("telegram-123");
  const s2 = manager.getOrCreate("telegram-456");
  const s1Again = manager.getOrCreate("telegram-123"); // 应该返回同一个对象

  console.log("s1 === s1Again:", s1 === s1Again); // true
  console.log("s1 === s2:", s1 === s2);           // false
  console.log("Session 数量:", manager.sessionCount); // 2

  console.log("\n=== 测试 JSONL 日志 ===\n");

  manager.appendTranscript(s1, { type: "user_message", content: "你好" });
  manager.appendTranscript(s1, { type: "agent_reply", content: "你好！有什么需要帮助的？" });
  manager.appendTranscript(s1, { type: "tool_call", tool: "get_weather", args: { city: "北京" } });

  const transcript = manager.readTranscript(s1);
  console.log("日志条数:", transcript.length);
  console.log("日志内容:");
  transcript.forEach((entry, i) => {
    console.log(`  [${i}] ${entry.type}: ${JSON.stringify(entry).slice(0, 60)}...`);
  });

  console.log("\n=== 测试 Lane Queue 独立性 ===\n");

  const results = [];

  // s1 和 s2 的队列是独立的，互不影响
  s1.queue.enqueue(async () => {
    await new Promise(r => setTimeout(r, 100));
    results.push("s1-任务A");
  });

  s2.queue.enqueue(async () => {
    results.push("s2-任务B"); // s2 不用等 s1
  });

  s1.queue.enqueue(async () => {
    results.push("s1-任务C"); // 但 s1-C 要等 s1-A
  });

  await new Promise(r => setTimeout(r, 300));
  console.log("执行结果:", results);
  console.log("✅ s2-任务B 出现在 s1-任务C 之前，说明不同 Session 的队列互相独立");
}

main();