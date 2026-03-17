// day2-stream.mjs
import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: process.env.BASE_URL
});

async function main() {
  console.log("AI 开始回答：\n");

  // stream: true 开启流式
  const stream = await client.chat.completions.create({
    model: process.env.MODEL,
    stream: true,
    messages: [
      {
        role: "system",
        content: "你是 Molty，一个太空龙虾助手。"
      },
      {
        role: "user",
        content: "给我讲一个关于龙虾在太空迷路的小故事，100字左右。"
      }
    ]
  });

  // 逐块处理——每来一个 chunk 就立刻打印
  let fullReply = "";

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;

    if (delta) {
      process.stdout.write(delta);  // 不换行，直接追加输出
      fullReply += delta;
    }

    // 最后一个 chunk，finish_reason 会变成 "stop"
    if (chunk.choices[0]?.finish_reason === "stop") {
      console.log("\n\n=== 流式结束 ===");
      console.log(`完整回复共 ${fullReply.length} 个字符`);
    }
  }
}

main();