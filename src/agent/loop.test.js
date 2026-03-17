// src/agent/loop.test.js
import "dotenv/config";
import { runAgentLoop, buildSystemPrompt } from "./loop.js";

async function test(label, userMessage) {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`测试：${label}`);
  console.log(`用户：${userMessage}`);
  console.log("AI：");

  const messages = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: userMessage }
  ];

  const toolLog = [];

  const reply = await runAgentLoop(
    messages,
    (chunk) => process.stdout.write(chunk),   // 流式打印
    (toolCall) => {
      toolLog.push(toolCall);
      console.log(`\n  [工具调用] ${toolCall.name}(${JSON.stringify(toolCall.args)})`);
      process.stdout.write("AI（续）：");
    }
  );

  console.log(`\n\n调用了 ${toolLog.length} 个工具:`, toolLog.map(t => t.name));
}

// 测试1：不需要工具的问题
await test("纯对话", "用一句话介绍一下你自己");

// 测试2：需要一个工具
await test("单工具", "北京今天天气怎么样？");

// 测试3：需要多个工具
await test("多工具", "帮我算一下 (123 + 456) * 2 等于多少，顺便查一下上海的天气");