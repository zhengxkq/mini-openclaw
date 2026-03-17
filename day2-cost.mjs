// day2-cost.mjs
import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: process.env.BASE_URL
});

// qwen-max 的价格（单位：元/千token，2025年参考价格，以实际官网为准）
const PRICE = {
  input: 0.04,   // 元/千 token
  output: 0.12   // 元/千 token
};

function calcCost(usage) {
  const inputCost = (usage.prompt_tokens / 1000) * PRICE.input;
  const outputCost = (usage.completion_tokens / 1000) * PRICE.output;
  return {
    inputCost: inputCost.toFixed(6),
    outputCost: outputCost.toFixed(6),
    total: (inputCost + outputCost).toFixed(6)
  };
}

async function main() {
  const messages = [
    {
      role: "system",
      content: "你是 Molty，一个简洁的 AI 助手，回答控制在 50 字以内。"
    }
  ];

  const questions = [
    "什么是机器学习？",
    "它和深度学习有什么区别？",
    "那和 AI Agent 又有什么关系？"
  ];

  let totalCost = 0;

  for (let i = 0; i < questions.length; i++) {
    messages.push({ role: "user", content: questions[i] });

    const response = await client.chat.completions.create({
      model: process.env.MODEL,
      messages
    });

    const reply = response.choices[0].message.content;
    const usage = response.usage;
    const cost = calcCost(usage);
    totalCost += parseFloat(cost.total);

    messages.push({ role: "assistant", content: reply });

    console.log(`\n--- 第 ${i + 1} 轮 ---`);
    console.log(`问：${questions[i]}`);
    console.log(`答：${reply}`);
    console.log(`Token: 输入 ${usage.prompt_tokens} + 输出 ${usage.completion_tokens} = ${usage.total_tokens}`);
    console.log(`费用: ¥${cost.total}（输入 ¥${cost.inputCost} + 输出 ¥${cost.outputCost}）`);
  }

  console.log(`\n=== 三轮对话总费用: ¥${totalCost.toFixed(6)} ===`);
  console.log("注意观察：随着对话变长，每轮的输入 token 是不断增加的");
}

main();