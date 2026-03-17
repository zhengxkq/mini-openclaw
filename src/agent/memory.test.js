// src/agent/memory.test.js
import "dotenv/config";
import { MemoryManager } from "./memory.js";

const memory = new MemoryManager();

async function main() {
  console.log("=== 测试1：读取 soul.md ===\n");
  const soul = memory.readSoul();
  console.log(soul || "（soul.md 为空）");

  console.log("\n=== 测试2：写入用户信息 ===\n");
  memory.appendToSoul("用户信息", "- 用户叫小明\n- 职业是前端工程师\n- 偏好用中文回答");
  console.log("写入成功，重新读取：");
  console.log(memory.readSoul());

  console.log("\n=== 测试3：模拟对话压缩 ===\n");

  // 构造 12 轮假对话（超过 MAX_HISTORY_ROUNDS=10）
  const fakeMessages = [];
  for (let i = 1; i <= 12; i++) {
    fakeMessages.push({ role: "user", content: `这是第 ${i} 轮的问题，关于话题${i}` });
    fakeMessages.push({ role: "assistant", content: `这是第 ${i} 轮的回答，解答了话题${i}` });
  }

  console.log(`压缩前：${fakeMessages.length} 条消息`);

  const compressed = await memory.compressIfNeeded(fakeMessages);

  console.log(`压缩后：${compressed.length} 条消息`);
  console.log("\n压缩后的第一条（摘要）：");
  console.log(compressed[0].content.slice(0, 200));

  console.log("\n查看 soul.md，确认摘要已写入：");
  const updatedSoul = memory.readSoul();
  console.log(updatedSoul.includes("历史摘要") ? "✅ 摘要已写入 soul.md" : "❌ 摘要未写入");
}

main();