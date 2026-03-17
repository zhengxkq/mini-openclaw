// day2-stream-fn.mjs
import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: process.env.BASE_URL
});

// 封装后的流式调用
// onChunk: 每来一片内容就调用一次，由调用方决定怎么处理
// 返回值: 完整的回复文本
async function streamChat(messages, onChunk) {
  const stream = await client.chat.completions.create({
    model: process.env.MODEL,
    stream: true,
    messages
  });

  let fullReply = "";

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      fullReply += delta;
      onChunk(delta);  // 通知调用方
    }
  }

  return fullReply;
}

// 使用示例 1：输出到终端
async function demo1() {
  console.log("=== 场景1：打印到终端 ===\n");
  const messages = [
    { role: "system", content: "你是 Molty，回答简洁。" },
    { role: "user", content: "太空龙虾吃什么？" }
  ];

  const reply = await streamChat(messages, (chunk) => {
    process.stdout.write(chunk);
  });

  console.log(`\n\n总字符数: ${reply.length}`);
}

// 使用示例 2：收集所有内容后一次性处理（比如发到 Telegram）
async function demo2() {
  console.log("\n=== 场景2：模拟发到 Telegram ===\n");
  const messages = [
    { role: "system", content: "你是 Molty，回答简洁。" },
    { role: "user", content: "用一句话描述宇宙。" }
  ];

  const chunks = [];
  const reply = await streamChat(messages, (chunk) => {
    chunks.push(chunk);
    // 实际发 Telegram 时，可以每攒够 100 个字符就推送一次
    // 避免 API 调用太频繁
  });

  console.log("模拟推送到 Telegram:", reply);
  console.log(`共收到 ${chunks.length} 个 chunk`);
}

async function main() {
  await demo1();
  await demo2();
}

main();