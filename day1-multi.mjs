// day1-multi.mjs
import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: "https://coding.dashscope.aliyuncs.com/v1"
});

async function main() {
  // messages 是一个数组，保存完整对话历史
  // AI 没有记忆——你每次调用都要把历史记录带上，它才知道之前说了什么
  const messages = [];

  // 第一轮
  messages.push({ role: "user", content: "我叫小明，我在学习 AI 开发。" });

  const response1 = await client.chat.completions.create({
    model: "qwen3-max-2026-01-23",
    messages: messages
  });

  const reply1 = response1.choices[0].message.content;
  console.log("AI:", reply1);

  // 把 AI 的回复也加进历史——这步很多初学者会忘
  messages.push({ role: "assistant", content: reply1 });

  // 第二轮——AI 应该记得你叫小明
  messages.push({ role: "user", content: "你还记得我叫什么吗？" });

  const response2 = await client.chat.completions.create({
    model: "qwen3-max-2026-01-23",
    messages: messages    // 带上完整历史
  });

  console.log("AI:", response2.choices[0].message.content);

  // 看看现在 messages 数组长什么样
  console.log("\n=== 完整对话历史 ===");
  console.log(JSON.stringify(messages, null, 2));
  console.log("\n历史条数:", messages.length);
}

main();