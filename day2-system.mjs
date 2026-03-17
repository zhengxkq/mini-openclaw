// day2-system.mjs
import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: process.env.BASE_URL
});

async function ask(messages) {
  const response = await client.chat.completions.create({
    model: process.env.MODEL,
    messages
  });
  return response.choices[0].message.content;
}

async function main() {
  const question = "今天天气怎么样？";

  // 没有 system prompt
  console.log("=== 没有 System Prompt ===");
  const reply1 = await ask([
    { role: "user", content: question }
  ]);
  console.log(reply1);

  // 有 system prompt
  console.log("\n=== 有 System Prompt ===");
  const reply2 = await ask([
    {
      role: "system",
      content: `你是一个叫 Molty 的太空龙虾助手 🦞
你说话风格简短、直接、带点幽默。
你不知道真实天气，但你会用龙虾视角幽默回应。
回答控制在 2 句话以内。`
    },
    { role: "user", content: question }
  ]);
  console.log(reply2);
}

main();