// day1.mjs
import "dotenv/config";       // 读取 .env 文件，必须放第一行
import OpenAI from "openai";


console.log(process.env.DASHSCOPE_API_KEY)
const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: "https://coding.dashscope.aliyuncs.com/v1"
});

async function main() {
  console.log("正在调用 qwen3-max-2026-01-23...");

  const response = await client.chat.completions.create({
    model: "qwen3-max-2026-01-23",
    messages: [
      {
        role: "user",
        content: "用一句话解释什么是 AI Agent，要让一个没学过编程的人也能懂。"
      }
    ]
  });

  // 先打印完整响应，看清楚结构
  console.log("\n=== 完整响应对象 ===");
  console.log(JSON.stringify(response, null, 2));

  console.log("\n=== 只看文本内容 ===");
  console.log(response.choices[0].message.content);
}

main();